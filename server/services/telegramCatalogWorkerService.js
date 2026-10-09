import db from "../database/db.js";
import { onCacheInvalidatePattern } from "./cacheService.js";
import {
  TELEGRAM_PARSE_MODE_HTML,
  deleteTelegramMessage,
  editTelegramMessageCaption,
  editTelegramMessagePhoto,
  editTelegramMessageText,
  pinTelegramMessage,
  sendTelegramChannelPhoto,
  sendTelegramChannelText,
  setTelegramChatDescription,
  telegramBotToken,
} from "./telegramBotService.js";
import {
  claimTelegramCatalogJobs,
  completeTelegramCatalogJob,
  failTelegramCatalogJob,
  forgetTelegramCatalogPost,
  TELEGRAM_DIGEST_CARD_ID,
  enqueueTelegramCatalogJob,
  listPendingTelegramDigestEvents,
  listTelegramChannels,
  loadTelegramCatalogSettings,
  markTelegramChannelDigested,
  markTelegramDigestEventsSent,
  recordTelegramCatalogEvent,
  recordTelegramChannelIndex,
  recordTelegramPostResult,
  telegramCatalogTenantId,
} from "./telegramCatalogService.js";
import {
  buildTelegramDigest,
  buildTelegramRestockAnnouncement,
  syncAllTelegramChannels,
} from "./telegramCatalogPublisherService.js";
import { todayInAppTimeZone, zonedParts } from "../utils/appTimezone.js";

/*
 * The paced drain.
 *
 * Telegram starts refusing around 20 messages a minute to one channel, and a
 * first backfill of a real catalogue is thousands of posts. So nothing is sent
 * straight from the sweep: the sweep only writes jobs, and this worker takes
 * them at the configured rate. A 429 is not an error here, it is the pace being
 * corrected -- the job goes back with Telegram's own retry_after.
 *
 * "message is not modified" is a SUCCESS: it means the post already says what
 * we wanted it to say, so the fingerprint is recorded and the job is done. The
 * alternative is a job that retries for ever over a post that is already right.
 */

const text = (value = "") => String(value ?? "").trim();

const TICKS_PER_MINUTE = 12;
const TICK_INTERVAL_MS = Math.max(2_000, Math.round(60_000 / TICKS_PER_MINUTE));

const isNotModified = (error) => text(error?.message).toLowerCase().includes("not modified");

const channelById = async ({ tenantId, client }) => {
  const channels = await listTelegramChannels({ tenantId, includeInactive: true, client });
  return new Map(channels.map((channel) => [Number(channel.id), channel]));
};


/*
 * An announcement is a SEPARATE message. The post itself is still edited in
 * place, so its link, its views and its forwards survive -- what the shop gains
 * here is the notification it would otherwise only get by deleting the post and
 * putting it back, which kills all three and teaches subscribers to mute.
 *
 * Recorded only after Telegram accepted the change, because an announcement for
 * something that never reached the channel is a lie.
 */
const noteTelegramChange = async ({ job, payload, messageId, tenantId, client }) => {
  const kind = text(payload.event);
  if (!kind) return null;
  return recordTelegramCatalogEvent({
    tenantId,
    channelId: job.channel_id,
    cardId: job.card_id,
    kind,
    facts: payload.facts || {},
    messageId,
    client,
  }).catch(() => null);
};

export const processTelegramCatalogJob = async ({
  job,
  channel,
  client = db,
  sendPhoto = sendTelegramChannelPhoto,
  editCaption = editTelegramMessageCaption,
  editPhoto = editTelegramMessagePhoto,
  deleteMessage = deleteTelegramMessage,
  sendText = sendTelegramChannelText,
  editText = editTelegramMessageText,
  pinMessage = pinTelegramMessage,
  setDescription = setTelegramChatDescription,
} = {}) => {
  const tenantId = Number(job.tenant_id) || telegramCatalogTenantId();
  const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
  const chatId = text(channel?.chat_id);
  if (!chatId) throw new Error("telegram_channel_chat_id_missing");

  const caption = text(payload.caption);
  const replyMarkup = payload.reply_markup || null;
  const imageUrl = text(payload.image_url);
  const state = payload.sold_out === true ? "sold_out" : "live";

  if (job.action === "delete") {
    if (payload.message_id) {
      await deleteMessage({ chatId, messageId: payload.message_id }).catch((error) => {
        // A post the owner already removed by hand is not a failure.
        if (!text(error?.message).toLowerCase().includes("message to delete not found")) throw error;
      });
    }
    await forgetTelegramCatalogPost({ tenantId, channelId: job.channel_id, cardId: job.card_id, client });
    return { action: "delete", card_id: job.card_id };
  }

  // The channel's one pinned message: the menu of hashtags. Written once and
  // then edited, like every other message here, so the pin survives and the
  // channel never collects a pile of stale menus.
  if (job.action === "index") {
    const body = text(payload.body);
    if (!body) return { action: "index", skipped: "empty" };
    const indexMarkup = payload.reply_markup || null;
    const existing = channel.index_message_id ? String(channel.index_message_id) : "";
    let messageId = existing;
    if (existing) {
      try {
        await editText({ chatId, messageId: existing, messageText: body, replyMarkup: indexMarkup, parseMode: TELEGRAM_PARSE_MODE_HTML });
      } catch (error) {
        // The owner deleted it by hand. Post a fresh one rather than failing
        // for ever against a message that is gone.
        if (!text(error?.message).toLowerCase().includes("not found")) throw error;
        messageId = "";
      }
    }
    let pinned = null;
    if (!messageId) {
      const sent = await sendText({ chatId, messageText: body, replyMarkup: indexMarkup, parseMode: TELEGRAM_PARSE_MODE_HTML, disablePreview: true });
      messageId = text(sent?.message_id);
      // Pinning needs a right the other three do not imply, so a refusal is a
      // warning: the menu is posted either way.
      pinned = await pinMessage({ chatId, messageId });
    }
    // The channel's own presentation, refreshed with its menu. Needs the
    // "change info" right, so it is best effort: a refusal must not fail the
    // menu that was just posted.
    const describe = text(payload.description)
      ? await setDescription({ chatId, description: payload.description })
      : { updated: false, reason: "empty" };
    await recordTelegramChannelIndex({
      tenantId,
      channelId: job.channel_id,
      messageId: messageId || null,
      indexHash: text(payload.fingerprint),
      client,
    });
    return { action: "index", message_id: messageId, pinned: pinned?.pinned ?? null, pin_error: pinned?.reason || "", described: describe.updated, describe_error: describe.reason || "" };
  }

  // A one-line "it is back" with a link to the post, not a second copy of it.
  if (job.action === "announce") {
    const body = text(payload.body);
    if (!body) return { action: "announce", skipped: "empty" };
    const sent = await sendText({ chatId, messageText: body, parseMode: TELEGRAM_PARSE_MODE_HTML, disablePreview: true });
    return { action: "announce", message_id: sent?.message_id || null };
  }

  // One message for the whole day, instead of a notification per size.
  if (job.action === "digest") {
    const body = text(payload.body);
    if (!body) return { action: "digest", skipped: "empty" };
    const sent = await sendText({ chatId, messageText: body, parseMode: TELEGRAM_PARSE_MODE_HTML, disablePreview: true });
    await markTelegramDigestEventsSent({ ids: Array.isArray(payload.event_ids) ? payload.event_ids : [], client });
    await markTelegramChannelDigested({ tenantId, channelId: job.channel_id, dayKey: text(payload.day_key), client });
    return { action: "digest", message_id: sent?.message_id || null, events: (payload.event_ids || []).length };
  }

  if (job.action === "create") {
    const sent = await sendPhoto({ chatId, photoUrl: imageUrl, caption, replyMarkup, parseMode: TELEGRAM_PARSE_MODE_HTML });
    await recordTelegramPostResult({
      tenantId,
      channelId: job.channel_id,
      cardId: job.card_id,
      messageId: sent?.message_id || null,
      captionHash: text(payload.fingerprint),
      imageUrl,
      state,
      facts: payload.facts || null,
      client,
    });
    await noteTelegramChange({ job, payload, messageId: sent?.message_id || null, tenantId, client });
    return { action: "create", card_id: job.card_id, message_id: sent?.message_id || null };
  }

  // update
  const { rows } = await client.query(
    `SELECT message_id, image_url FROM telegram_catalog_posts
      WHERE tenant_id = $1 AND channel_id = $2 AND card_id = $3`,
    [tenantId, Number(job.channel_id), text(job.card_id)]
  );
  const messageId = rows[0]?.message_id || null;
  if (!messageId) {
    // Nothing to edit. The next sweep queues a create for this colour.
    return { action: "update", card_id: job.card_id, skipped: "no_message" };
  }

  const wantsNewPhoto = payload.replace_media === true && imageUrl && text(rows[0]?.image_url) !== imageUrl;
  try {
    if (wantsNewPhoto) await editPhoto({ chatId, messageId, photoUrl: imageUrl, caption, replyMarkup, parseMode: TELEGRAM_PARSE_MODE_HTML });
    else await editCaption({ chatId, messageId, caption, replyMarkup, parseMode: TELEGRAM_PARSE_MODE_HTML });
  } catch (error) {
    if (!isNotModified(error)) throw error;
  }
  await recordTelegramPostResult({
    tenantId,
    channelId: job.channel_id,
    cardId: job.card_id,
    messageId,
    captionHash: text(payload.fingerprint),
    imageUrl: wantsNewPhoto ? imageUrl : "",
    state,
    facts: payload.facts || null,
    client,
  });
  await noteTelegramChange({ job, payload, messageId, tenantId, client });
  return { action: "update", card_id: job.card_id, message_id: messageId };
};

export const runTelegramCatalogQueueBatch = async ({ client = db, settings = null } = {}) => {
  const config = settings || (await loadTelegramCatalogSettings());
  if (!config.enabled) return { skipped: true, reason: "disabled" };
  if (!telegramBotToken()) return { skipped: true, reason: "no_bot_token" };

  const perTick = Math.max(1, Math.round((config.posts_per_minute || 12) / TICKS_PER_MINUTE));
  const jobs = await claimTelegramCatalogJobs({ limit: perTick, client });
  if (!jobs.length) return { processed: 0 };

  const channels = await channelById({ tenantId: Number(jobs[0].tenant_id) || telegramCatalogTenantId(), client });
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    const channel = channels.get(Number(job.channel_id)) || null;
    try {
      if (!channel || channel.is_active === false) {
        // A channel switched off mid-queue keeps its jobs rather than spending
        // them: drop the job, the next sweep re-queues it if it is switched on.
        await completeTelegramCatalogJob({ id: job.id, client });
        continue;
      }
      await processTelegramCatalogJob({ job, channel, client });
      await completeTelegramCatalogJob({ id: job.id, client });
      processed += 1;
    } catch (error) {
      failed += 1;
      const retryAfter = Number(error?.retryAfter) > 0 ? Number(error.retryAfter) + 1 : 0;
      await failTelegramCatalogJob({
        id: job.id,
        error: error?.message || String(error),
        retryAfterSeconds: retryAfter || 60,
        client,
      });
      // A rate limit applies to the whole channel, not to this one job: stop
      // the tick instead of burning the rest of the batch on refusals.
      if (error?.code === "TELEGRAM_RATE_LIMITED") break;
    }
  }
  return { processed, failed };
};


// ---------------------------------------------------------------------------
// Turning events into the two messages the owner asked for.
//
// Both are OFF by default. A shop that announces every restock the moment it
// happens is a shop people mute, so the instant announcement is reserved for a
// colour that was GONE and came back, and everything else waits for one digest
// a day.
// ---------------------------------------------------------------------------

export const queueTelegramRestockAnnouncements = async ({ client = db, settings = null } = {}) => {
  const config = settings || (await loadTelegramCatalogSettings());
  if (!config.enabled || !config.restock_announcement) return { skipped: true, reason: "disabled" };
  const channels = await listTelegramChannels({ includeInactive: false, client });
  let queued = 0;
  for (const channel of channels) {
    if (!text(channel.chat_id)) continue;
    const { rows } = await client.query(
      `SELECT * FROM telegram_catalog_events
        WHERE channel_id = $1 AND kind = 'restocked' AND announced_at IS NULL
        ORDER BY created_at ASC LIMIT 20`,
      [Number(channel.id)]
    );
    for (const event of rows) {
      const body = buildTelegramRestockAnnouncement({
        facts: event.facts || {},
        channel,
        messageId: event.message_id,
      });
      // Claim it first: a crash between queueing and marking would announce the
      // same restock twice, which is worse than missing one.
      await client.query(`UPDATE telegram_catalog_events SET announced_at = CURRENT_TIMESTAMP WHERE id = $1`, [event.id]);
      if (!body) continue;
      await enqueueTelegramCatalogJob({
        tenantId: Number(event.tenant_id),
        channelId: channel.id,
        cardId: `announce:${event.id}`,
        action: "announce",
        payload: { body },
        client,
      });
      queued += 1;
    }
  }
  return { queued };
};

export const queueTelegramDailyDigest = async ({ client = db, settings = null, now = new Date() } = {}) => {
  const config = settings || (await loadTelegramCatalogSettings());
  if (!config.enabled || !config.daily_digest) return { skipped: true, reason: "disabled" };
  // The shop's clock, not the server's: "today" has to mean today in Cairo.
  const parts = zonedParts(now);
  if (!parts || parts.hour < Number(config.digest_hour)) return { skipped: true, reason: "too_early" };
  const dayKey = todayInAppTimeZone();

  const channels = await listTelegramChannels({ includeInactive: false, client });
  let queued = 0;
  for (const channel of channels) {
    if (!text(channel.chat_id)) continue;
    if (text(channel.last_digest_day) === dayKey) continue;
    const events = await listPendingTelegramDigestEvents({ tenantId: Number(channel.tenant_id), channelId: channel.id, client });
    const body = buildTelegramDigest({ events, channel });
    if (!body) {
      // Nothing happened. Mark the day done anyway so this is not retried every
      // tick until midnight.
      await markTelegramChannelDigested({ tenantId: Number(channel.tenant_id), channelId: channel.id, dayKey, client });
      continue;
    }
    await enqueueTelegramCatalogJob({
      tenantId: Number(channel.tenant_id),
      channelId: channel.id,
      cardId: TELEGRAM_DIGEST_CARD_ID,
      action: "digest",
      payload: { body, day_key: dayKey, event_ids: events.map((event) => Number(event.id)) },
      client,
    });
    queued += 1;
  }
  return { queued };
};

let queueTimer = null;
let queueRunning = false;

export const startTelegramCatalogQueueWorker = () => {
  if (queueTimer) return queueTimer;
  queueTimer = setInterval(() => {
    if (queueRunning) return;
    queueRunning = true;
    runTelegramCatalogQueueBatch()
      .then(() => queueTelegramRestockAnnouncements())
      .then(() => queueTelegramDailyDigest())
      .catch((error) => console.error("[telegram-catalog] queue tick failed", error?.message || error))
      .finally(() => { queueRunning = false; });
  }, TICK_INTERVAL_MS);
  if (typeof queueTimer.unref === "function") queueTimer.unref();
  return queueTimer;
};

export const stopTelegramCatalogQueueWorker = () => {
  if (queueTimer) clearInterval(queueTimer);
  queueTimer = null;
};

// ---------------------------------------------------------------------------
// The sweep.
//
// A product save or a stock movement wakes it within seconds (see the cache
// invalidation hook in server.js); the interval is the safety net for anything
// that changed stock without going through that signal.
// ---------------------------------------------------------------------------

let sweepTimer = null;
let sweepRunning = false;
let sweepQueuedAgain = false;
let lastSweepAt = 0;
const SWEEP_DEBOUNCE_MS = Math.max(5_000, Number(process.env.TELEGRAM_CATALOG_SWEEP_DEBOUNCE_MS || 30_000));

export const runTelegramCatalogSweep = async ({ force = false } = {}) => {
  if (sweepRunning) {
    sweepQueuedAgain = true;
    return { skipped: true, reason: "running" };
  }
  if (!force && Date.now() - lastSweepAt < SWEEP_DEBOUNCE_MS) {
    sweepQueuedAgain = true;
    return { skipped: true, reason: "debounced" };
  }
  sweepRunning = true;
  try {
    const result = await syncAllTelegramChannels();
    lastSweepAt = Date.now();
    return result;
  } finally {
    sweepRunning = false;
    if (sweepQueuedAgain) {
      sweepQueuedAgain = false;
      // One more pass for whatever changed while this one was running, after the
      // debounce window rather than immediately.
      setTimeout(() => { runTelegramCatalogSweep().catch(() => {}); }, SWEEP_DEBOUNCE_MS).unref?.();
    }
  }
};

export const wakeTelegramCatalogSweep = () => {
  runTelegramCatalogSweep().catch((error) =>
    console.error("[telegram-catalog] sweep failed", error?.message || error)
  );
};

let invalidationHooked = false;

export const startTelegramCatalogSweepWorker = async () => {
  if (sweepTimer) return sweepTimer;
  const settings = await loadTelegramCatalogSettings().catch(() => null);
  const minutes = Math.max(2, Number(settings?.sync_minutes) || 15);
  sweepTimer = setInterval(() => { wakeTelegramCatalogSweep(); }, minutes * 60_000);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  // Every path that drops the storefront cache entries -- a product save, a
  // purge, a live stock movement -- goes through invalidateCachePattern, and the
  // storefront's own section cache already follows it. The channels follow the
  // same signal, so a size that sells in the shop is corrected in Telegram
  // within the debounce window instead of waiting for the interval. Registered
  // only once the worker has actually started, so importing this module (a
  // test, a script) never triggers a sweep.
  if (!invalidationHooked) {
    invalidationHooked = true;
    onCacheInvalidatePattern((pattern) => {
      if (String(pattern || "").startsWith("storefront")) wakeTelegramCatalogSweep();
    });
  }
  return sweepTimer;
};

export const stopTelegramCatalogSweepWorker = () => {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
};

export default {
  processTelegramCatalogJob,
  queueTelegramDailyDigest,
  queueTelegramRestockAnnouncements,
  runTelegramCatalogQueueBatch,
  runTelegramCatalogSweep,
  startTelegramCatalogQueueWorker,
  startTelegramCatalogSweepWorker,
  wakeTelegramCatalogSweep,
};
