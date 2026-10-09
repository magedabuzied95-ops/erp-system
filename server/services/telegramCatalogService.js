import db from "../database/db.js";
import { getSetting } from "./settingsService.js";
import { telegramDeepLinkToken, telegramTenantId } from "./telegramBotService.js";
import {
  TELEGRAM_CATALOG_AUDIENCES,
  TELEGRAM_CATALOG_DEFAULTS,
} from "../../shared/telegramCatalogDefaults.js";

/*
 * Telegram catalog channels -- schema, settings and repository.
 *
 * One channel per audience (men / women / kids), one post per product colour.
 * A post is written once and then only edited, so telegram_catalog_posts is the
 * ONLY record of which Telegram message belongs to which colour: lose a row and
 * the post becomes an orphan that no stock movement will ever correct again.
 * Every write here is therefore keyed on (tenant, channel, card_id) and never
 * on the message id.
 *
 * The publisher (telegramCatalogPublisherService) decides what should change and
 * the worker (telegramCatalogWorkerService) sends it; neither touches Telegram
 * or the catalogue from this file.
 */

const text = (value = "") => String(value ?? "").trim();

export const TELEGRAM_CATALOG_SETTING_KEYS = Object.freeze({
  enabled: "telegram.catalog_enabled",
  botUsername: "telegram.catalog_bot_username",
  orderMode: "telegram.catalog_order_mode",
  syncMinutes: "telegram.catalog_sync_minutes",
  postsPerMinute: "telegram.catalog_posts_per_minute",
  captionTemplate: "telegram.catalog_caption_template",
  soldOutLabel: "telegram.catalog_sold_out_label",
});

export const TELEGRAM_POST_STATES = Object.freeze(["pending", "live", "sold_out", "failed", "removed"]);
export const TELEGRAM_JOB_ACTIONS = Object.freeze(["create", "update", "delete"]);
export const TELEGRAM_JOB_MAX_ATTEMPTS = Math.max(1, Math.min(20, Number(process.env.TELEGRAM_CATALOG_MAX_ATTEMPTS || 6)));

export const telegramCatalogTenantId = () => telegramTenantId() || 1;

let schemaReadyPromise = null;
export const ensureTelegramCatalogSchema = async (client = db) => {
  if (!schemaReadyPromise || client !== db) {
    const operation = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS telegram_channels (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          channel_key TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          chat_id TEXT NOT NULL DEFAULT '',
          audience TEXT NOT NULL DEFAULT '',
          invite_url TEXT NOT NULL DEFAULT '',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          last_synced_at TIMESTAMPTZ NULL,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, channel_key)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS telegram_catalog_posts (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          channel_id BIGINT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
          card_id TEXT NOT NULL,
          product_id BIGINT NULL,
          color_key TEXT NOT NULL DEFAULT '',
          message_id BIGINT NULL,
          caption_hash TEXT NOT NULL DEFAULT '',
          image_url TEXT NOT NULL DEFAULT '',
          deeplink_token TEXT NOT NULL DEFAULT '',
          facts JSONB NOT NULL DEFAULT '{}'::jsonb,
          state TEXT NOT NULL DEFAULT 'pending',
          last_error TEXT NOT NULL DEFAULT '',
          posted_at TIMESTAMPTZ NULL,
          last_synced_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, channel_id, card_id)
        )
      `);
      // Columns added after the table first shipped. Harmless on a fresh
      // install, and the only thing that repairs a database created by an
      // earlier build of this same feature.
      await client.query(`ALTER TABLE telegram_catalog_posts ADD COLUMN IF NOT EXISTS deeplink_token TEXT NOT NULL DEFAULT ''`);
      await client.query(`ALTER TABLE telegram_catalog_posts ADD COLUMN IF NOT EXISTS facts JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_telegram_catalog_posts_channel
        ON telegram_catalog_posts (tenant_id, channel_id, state)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_telegram_catalog_posts_deeplink
        ON telegram_catalog_posts (tenant_id, deeplink_token)
        WHERE deeplink_token <> ''
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS telegram_catalog_jobs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          channel_id BIGINT NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
          card_id TEXT NOT NULL,
          action TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_telegram_catalog_jobs_pending
        ON telegram_catalog_jobs (status, next_attempt_at, id)
        WHERE status IN ('pending', 'failed')
      `);
      // One open job per (channel, card, action): a sweep that runs while the
      // queue is still draining must not stack a second edit for one colour.
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_catalog_jobs_open
        ON telegram_catalog_jobs (tenant_id, channel_id, card_id, action)
        WHERE status IN ('pending', 'failed')
      `);
      return true;
    })();
    if (client === db) schemaReadyPromise = operation.catch((error) => { schemaReadyPromise = null; throw error; });
    return operation;
  }
  return schemaReadyPromise;
};

const asNumber = (value, fallback, { min, max } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  let result = parsed;
  if (Number.isFinite(min)) result = Math.max(min, result);
  if (Number.isFinite(max)) result = Math.min(max, result);
  return result;
};

export const loadTelegramCatalogSettings = async () => {
  const [enabled, botUsername, orderMode, syncMinutes, postsPerMinute, captionTemplate, soldOutLabel] = await Promise.all([
    getSetting(TELEGRAM_CATALOG_SETTING_KEYS.enabled, false),
    getSetting(TELEGRAM_CATALOG_SETTING_KEYS.botUsername, ""),
    getSetting(TELEGRAM_CATALOG_SETTING_KEYS.orderMode, "both"),
    getSetting(TELEGRAM_CATALOG_SETTING_KEYS.syncMinutes, 15),
    getSetting(TELEGRAM_CATALOG_SETTING_KEYS.postsPerMinute, 12),
    getSetting(TELEGRAM_CATALOG_SETTING_KEYS.captionTemplate, TELEGRAM_CATALOG_DEFAULTS.caption_template),
    getSetting(TELEGRAM_CATALOG_SETTING_KEYS.soldOutLabel, TELEGRAM_CATALOG_DEFAULTS.sold_out_label),
  ]);
  const mode = text(orderMode).toLowerCase();
  return {
    enabled: enabled === true || text(enabled).toLowerCase() === "true",
    bot_username: text(botUsername).replace(/^@+/, ""),
    order_mode: ["mini_app", "bot", "both"].includes(mode) ? mode : "both",
    sync_minutes: asNumber(syncMinutes, 15, { min: 2, max: 1440 }),
    posts_per_minute: asNumber(postsPerMinute, 12, { min: 1, max: 20 }),
    caption_template: text(captionTemplate) || TELEGRAM_CATALOG_DEFAULTS.caption_template,
    sold_out_label: text(soldOutLabel) || TELEGRAM_CATALOG_DEFAULTS.sold_out_label,
  };
};

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const listTelegramChannels = async ({ tenantId = telegramCatalogTenantId(), includeInactive = true, client = db } = {}) => {
  await ensureTelegramCatalogSchema(client);
  const { rows } = await client.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM telegram_catalog_posts p
              WHERE p.channel_id = c.id AND p.state = 'live') AS live_posts,
            (SELECT COUNT(*) FROM telegram_catalog_posts p
              WHERE p.channel_id = c.id AND p.state = 'sold_out') AS sold_out_posts,
            (SELECT COUNT(*) FROM telegram_catalog_jobs j
              WHERE j.channel_id = c.id AND j.status IN ('pending', 'failed')) AS queued_jobs
       FROM telegram_channels c
      WHERE c.tenant_id = $1
        AND ($2::boolean OR c.is_active = TRUE)
      ORDER BY c.sort_order ASC, c.id ASC`,
    [tenantId, includeInactive]
  );
  return rows;
};

export const upsertTelegramChannel = async ({
  tenantId = telegramCatalogTenantId(),
  channelKey,
  title = "",
  chatId = "",
  audience = "",
  inviteUrl = "",
  isActive = true,
  sortOrder = 0,
  client = db,
} = {}) => {
  await ensureTelegramCatalogSchema(client);
  const key = text(channelKey).toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  if (!key) throw new Error("telegram_channel_key_required");
  const { rows } = await client.query(
    `INSERT INTO telegram_channels (tenant_id, channel_key, title, chat_id, audience, invite_url, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id, channel_key) DO UPDATE SET
       title = EXCLUDED.title,
       chat_id = EXCLUDED.chat_id,
       audience = EXCLUDED.audience,
       invite_url = EXCLUDED.invite_url,
       is_active = EXCLUDED.is_active,
       sort_order = EXCLUDED.sort_order,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, key, text(title), text(chatId), text(audience).toLowerCase(), text(inviteUrl), isActive !== false, Number(sortOrder) || 0]
  );
  return rows[0] || null;
};

export const setTelegramChannelActive = async ({ tenantId = telegramCatalogTenantId(), channelId, isActive = true, client = db } = {}) => {
  await ensureTelegramCatalogSchema(client);
  const { rows } = await client.query(
    `UPDATE telegram_channels SET is_active = $3, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, Number(channelId), isActive !== false]
  );
  return rows[0] || null;
};

// Deleting the channel row drops its posts and jobs with it (ON DELETE CASCADE)
// WITHOUT deleting anything inside Telegram: the posts stay in the channel as
// orphans. That is the honest trade -- the alternative is deleting a shopper's
// view of the shop from a settings screen -- so the caller warns first.
export const deleteTelegramChannel = async ({ tenantId = telegramCatalogTenantId(), channelId, client = db } = {}) => {
  await ensureTelegramCatalogSchema(client);
  const { rowCount } = await client.query(
    `DELETE FROM telegram_channels WHERE tenant_id = $1 AND id = $2`,
    [tenantId, Number(channelId)]
  );
  return rowCount > 0;
};

export const markTelegramChannelSynced = async ({ tenantId = telegramCatalogTenantId(), channelId, error = "", client = db } = {}) => {
  await ensureTelegramCatalogSchema(client);
  await client.query(
    `UPDATE telegram_channels
        SET last_synced_at = CURRENT_TIMESTAMP, last_error = $3, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, Number(channelId), text(error).slice(0, 500)]
  );
};

// Seed rows for the three audiences so the settings screen has something to
// paste a chat id into. Nothing is posted until a chat id is filled in and the
// channel is active.
export const seedDefaultTelegramChannels = async ({ tenantId = telegramCatalogTenantId(), client = db } = {}) => {
  await ensureTelegramCatalogSchema(client);
  const titles = { men: "رجالي", women: "حريمي", kids: "أطفالي" };
  const created = [];
  for (const [index, audience] of TELEGRAM_CATALOG_AUDIENCES.entries()) {
    const { rows } = await client.query(
      `INSERT INTO telegram_channels (tenant_id, channel_key, title, audience, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       ON CONFLICT (tenant_id, channel_key) DO NOTHING
       RETURNING *`,
      [tenantId, audience, titles[audience] || audience, audience, index]
    );
    if (rows[0]) created.push(rows[0]);
  }
  return created;
};

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export const listTelegramCatalogPosts = async ({ tenantId = telegramCatalogTenantId(), channelId, client = db } = {}) => {
  await ensureTelegramCatalogSchema(client);
  const { rows } = await client.query(
    `SELECT * FROM telegram_catalog_posts WHERE tenant_id = $1 AND channel_id = $2`,
    [tenantId, Number(channelId)]
  );
  return rows;
};

export const upsertTelegramCatalogPost = async ({
  tenantId = telegramCatalogTenantId(),
  channelId,
  cardId,
  productId = null,
  colorKey = "",
  imageUrl = "",
  client = db,
} = {}) => {
  const safeCardId = text(cardId);
  if (!safeCardId) throw new Error("telegram_card_id_required");
  const { rows } = await client.query(
    `INSERT INTO telegram_catalog_posts (tenant_id, channel_id, card_id, product_id, color_key, image_url, deeplink_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, channel_id, card_id) DO UPDATE SET
       product_id = COALESCE(EXCLUDED.product_id, telegram_catalog_posts.product_id),
       color_key = EXCLUDED.color_key,
       deeplink_token = EXCLUDED.deeplink_token,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, Number(channelId), safeCardId, productId === null ? null : Number(productId) || null, text(colorKey), text(imageUrl), telegramDeepLinkToken(safeCardId)]
  );
  return rows[0] || null;
};

export const recordTelegramPostResult = async ({
  tenantId = telegramCatalogTenantId(),
  channelId,
  cardId,
  messageId = null,
  captionHash = "",
  imageUrl = "",
  state = "live",
  error = "",
  facts = null,
  client = db,
} = {}) => {
  const { rows } = await client.query(
    `UPDATE telegram_catalog_posts
        SET message_id = COALESCE($4::bigint, message_id),
            caption_hash = $5,
            image_url = CASE WHEN $6 = '' THEN image_url ELSE $6 END,
            state = $7,
            last_error = $8,
            facts = COALESCE($9::jsonb, facts),
            posted_at = CASE WHEN posted_at IS NULL AND $4::bigint IS NOT NULL THEN CURRENT_TIMESTAMP ELSE posted_at END,
            last_synced_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND channel_id = $2 AND card_id = $3
      RETURNING *`,
    [
      tenantId,
      Number(channelId),
      text(cardId),
      messageId === null || messageId === "" ? null : Number(messageId),
      text(captionHash),
      text(imageUrl),
      TELEGRAM_POST_STATES.includes(state) ? state : "pending",
      text(error).slice(0, 500),
      facts && typeof facts === "object" ? JSON.stringify(facts) : null,
    ]
  );
  return rows[0] || null;
};

export const forgetTelegramCatalogPost = async ({ tenantId = telegramCatalogTenantId(), channelId, cardId, client = db } = {}) => {
  await client.query(
    `DELETE FROM telegram_catalog_posts WHERE tenant_id = $1 AND channel_id = $2 AND card_id = $3`,
    [tenantId, Number(channelId), text(cardId)]
  );
};

// A shopper's /start payload resolves back to one colour. The token is derived
// from the card id, so the same colour posted in two channels shares it and any
// row answers -- the colour is what matters, not which channel it was seen in.
export const resolveTelegramCatalogPostByToken = async ({ tenantId = telegramCatalogTenantId(), token, client = db } = {}) => {
  const safeToken = text(token);
  if (!safeToken) return null;
  await ensureTelegramCatalogSchema(client);
  const { rows } = await client.query(
    `SELECT * FROM telegram_catalog_posts
      WHERE tenant_id = $1 AND deeplink_token = $2
      ORDER BY (state = 'live') DESC, updated_at DESC
      LIMIT 1`,
    [tenantId, safeToken]
  );
  return rows[0] || null;
};

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export const enqueueTelegramCatalogJob = async ({
  tenantId = telegramCatalogTenantId(),
  channelId,
  cardId,
  action,
  payload = {},
  client = db,
} = {}) => {
  if (!TELEGRAM_JOB_ACTIONS.includes(action)) throw new Error(`telegram_job_action_invalid:${action}`);
  // An open job for this (channel, card, action) is REPLACED rather than
  // duplicated: the newest payload is the only one worth sending, and the
  // partial unique index makes that a single statement.
  const { rows } = await client.query(
    `INSERT INTO telegram_catalog_jobs (tenant_id, channel_id, card_id, action, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (tenant_id, channel_id, card_id, action) WHERE status IN ('pending', 'failed')
     DO UPDATE SET payload = EXCLUDED.payload,
                   status = 'pending',
                   next_attempt_at = CURRENT_TIMESTAMP,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [tenantId, Number(channelId), text(cardId), action, JSON.stringify(payload || {})]
  );
  return rows[0] || null;
};

const LOCK_TIMEOUT_MINUTES = 5;

export const claimTelegramCatalogJobs = async ({ limit = 1, client = db } = {}) => {
  await ensureTelegramCatalogSchema(client);
  const { rows } = await client.query(
    `UPDATE telegram_catalog_jobs
        SET status = 'processing', locked_at = CURRENT_TIMESTAMP, attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (
        SELECT id FROM telegram_catalog_jobs
         WHERE (
                 (status IN ('pending', 'failed') AND next_attempt_at <= CURRENT_TIMESTAMP)
                 OR (status = 'processing' AND locked_at < CURRENT_TIMESTAMP - INTERVAL '${LOCK_TIMEOUT_MINUTES} minutes')
               )
           AND attempts < $2
         ORDER BY next_attempt_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
      )
      RETURNING *`,
    [Math.max(1, Number(limit) || 1), TELEGRAM_JOB_MAX_ATTEMPTS]
  );
  return rows;
};

export const completeTelegramCatalogJob = async ({ id, client = db } = {}) => {
  await client.query(
    `DELETE FROM telegram_catalog_jobs WHERE id = $1`,
    [Number(id)]
  );
};

export const failTelegramCatalogJob = async ({ id, error = "", retryAfterSeconds = 0, client = db } = {}) => {
  const delay = Math.max(5, Number(retryAfterSeconds) || 30);
  const { rows } = await client.query(
    `UPDATE telegram_catalog_jobs
        SET status = CASE WHEN attempts >= $3 THEN 'dead' ELSE 'failed' END,
            last_error = $2,
            locked_at = NULL,
            next_attempt_at = CURRENT_TIMESTAMP + make_interval(secs => $4::int),
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *`,
    [Number(id), text(error).slice(0, 500), TELEGRAM_JOB_MAX_ATTEMPTS, Math.round(delay)]
  );
  return rows[0] || null;
};

export const telegramCatalogQueueDepth = async ({ tenantId = telegramCatalogTenantId(), client = db } = {}) => {
  await ensureTelegramCatalogSchema(client);
  const { rows } = await client.query(
    `SELECT status, COUNT(*)::int AS total
       FROM telegram_catalog_jobs
      WHERE tenant_id = $1
      GROUP BY status`,
    [tenantId]
  );
  return rows.reduce((acc, row) => ({ ...acc, [row.status]: row.total }), {});
};

export default {
  ensureTelegramCatalogSchema,
  loadTelegramCatalogSettings,
  listTelegramChannels,
  upsertTelegramChannel,
  setTelegramChannelActive,
  deleteTelegramChannel,
  seedDefaultTelegramChannels,
  listTelegramCatalogPosts,
  upsertTelegramCatalogPost,
  recordTelegramPostResult,
  forgetTelegramCatalogPost,
  resolveTelegramCatalogPostByToken,
  enqueueTelegramCatalogJob,
  claimTelegramCatalogJobs,
  completeTelegramCatalogJob,
  failTelegramCatalogJob,
  telegramCatalogQueueDepth,
};
