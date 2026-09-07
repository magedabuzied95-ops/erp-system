/*
 * Backfill customer names and profile pictures for existing Messenger and Instagram
 * conversations, now that "Business Asset User Profile Access" is approved.
 *
 * Goes through the same code the webhook uses (enrichMessengerProfile with
 * forceRefresh), so the endpoint per channel, the token choice and the no-wipe merge
 * are the ones production runs — nothing is hand-rolled here.
 *
 * Safe to re-run: progress lives in a JSON state file on the uploads volume, a
 * customer is skipped when it was refreshed within --skip-hours, Meta's "not
 * available" answers are remembered so they are not asked again every run, and a
 * refused lookup keeps whatever the rows already held.
 *
 *   node server/scripts/backfillMetaCustomerProfiles.js --dry-run
 *   node server/scripts/backfillMetaCustomerProfiles.js --limit 20
 *   node server/scripts/backfillMetaCustomerProfiles.js --channel instagram
 *   node server/scripts/backfillMetaCustomerProfiles.js --all        # refresh stale ones too
 *   node server/scripts/backfillMetaCustomerProfiles.js --probe instagram:1044077131364783
 *
 * --probe asks Meta for one profile and prints which fields came back (presence only)
 * and the error class if it was refused. It writes nothing — use it to verify what the
 * approval unlocked before running the backfill.
 *
 * On the VPS, detached with a log:
 *   docker exec -d erp-backend sh -c "node server/scripts/backfillMetaCustomerProfiles.js >> /app/uploads/meta-profile-backfill.log 2>&1"
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import db from "../database/db.js";
import { enrichMessengerProfile } from "../services/metaIntegrationService.js";
import { isGraphRateLimitError, shouldDeferBackgroundGraphWork } from "../services/metaGraphRateLimiter.js";
import { classifyMetaProfileError, normalizeMetaProfileChannel } from "../services/metaCustomerProfileService.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};

const DRY_RUN = flag("dry-run");
const ALL = flag("all");
const FORCE = flag("force");
const TENANT_ID = Number(option("tenant", process.env.STOREFRONT_TENANT_ID || "1")) || 1;
const LIMIT = Number(option("limit", "0")) || 0;
const BATCH = Math.max(1, Number(option("batch", "25")) || 25);
const PACE_MS = Math.max(0, Number(option("pace-ms", "400")) || 0);
const BATCH_PAUSE_MS = Math.max(0, Number(option("batch-pause-ms", "3000")) || 0);
const SKIP_HOURS = Math.max(0, Number(option("skip-hours", "24")) || 0);
const CHANNEL = normalizeMetaProfileChannel(option("channel", "")) || "";
const PROBE = option("probe", "");
const RATE_LIMIT_SLEEP_MS = Math.max(5000, Number(option("rate-limit-sleep-ms", "65000")) || 65000);
const STATE_FILE =
  option("state-file", "") ||
  process.env.META_PROFILE_BACKFILL_STATE_FILE ||
  (fs.existsSync("/app/uploads") ? "/app/uploads/meta-profile-backfill.json" : path.resolve(".meta-profile-backfill.json"));

const text = (value = "") => String(value ?? "").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...parts) => console.log(`[${stamp()}]`, ...parts);
const mask = (value = "") => {
  const safe = text(value);
  return safe.length <= 6 ? "***" : `${safe.slice(0, 3)}…${safe.slice(-3)}`;
};

const loadState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { started_at: new Date().toISOString(), done: {}, unavailable: {}, failed: {} };
  }
};
const saveState = (state) => {
  if (DRY_RUN) return;
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

// Conversations whose stored identity is incomplete. With --all, every Messenger/
// Instagram DM conversation is a candidate (stale profiles get refreshed too).
const loadCandidates = async () => {
  const params = [TENANT_ID];
  const where = [
    "c.tenant_id = $1",
    "c.channel IN ('facebook_messenger', 'instagram')",
    "COALESCE(c.thread_kind, 'dm') NOT IN ('comment', 'post')",
    "c.external_customer_id ~ '^[0-9]{5,}$'",
  ];
  if (CHANNEL) {
    params.push(CHANNEL);
    where.push(`c.channel = $${params.length}`);
  }
  if (!ALL) {
    where.push(`(
      COALESCE(NULLIF(c.customer_name, ''), '') = ''
      OR c.customer_name ~ '^[0-9]+$'
      OR LOWER(c.customer_name) IN ('customer', 'unknown customer', 'مستخدم instagram')
      OR COALESCE(c.customer_avatar_url, '') = ''
      OR p.id IS NULL
      OR COALESCE(p.display_name, '') = ''
      OR COALESCE(p.profile_pic_url, '') = ''
    )`);
  }
  const sql = `
    SELECT
      c.channel,
      c.external_conversation_id,
      c.external_customer_id,
      c.customer_name,
      c.customer_avatar_url,
      c.metadata,
      c.last_message_at,
      p.id AS profile_id,
      p.display_name AS profile_display_name,
      p.username AS profile_username,
      p.profile_pic_url AS profile_pic_url,
      p.profile_sync_status,
      p.profile_sync_attempted_at,
      p.last_profile_sync_at
    FROM ai_channel_conversations c
    LEFT JOIN ai_customer_profiles p
      ON p.tenant_id = c.tenant_id
      AND (p.id = c.customer_profile_id OR (c.customer_profile_id IS NULL AND p.phone = 'meta:' || c.channel || ':' || c.external_customer_id))
    WHERE ${where.join("\n      AND ")}
    ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
    ${LIMIT ? `LIMIT ${LIMIT}` : ""}
  `;
  const result = await db.query(sql, params);
  return result.rows;
};

const candidateKey = (row) => `${row.channel}:${row.external_customer_id}`;

const recentlyDone = (state, key) => {
  if (FORCE || !SKIP_HOURS) return false;
  const entry = state.done?.[key];
  if (!entry?.at) return false;
  return Date.now() - new Date(entry.at).getTime() < SKIP_HOURS * 60 * 60 * 1000;
};

const rememberedUnavailable = (state, key) => {
  if (FORCE) return false;
  const entry = state.unavailable?.[key];
  if (!entry?.at) return false;
  // Meta's "not available" is retried after a week, not every run.
  return Date.now() - new Date(entry.at).getTime() < 7 * 24 * 60 * 60 * 1000;
};

const messageFor = (row) => ({
  channel: row.channel,
  external_conversation_id: row.external_conversation_id,
  external_customer_id: row.external_customer_id,
  customer_name: text(row.customer_name),
  customer_avatar_url: text(row.customer_avatar_url),
  raw: {
    sender_psid: row.external_customer_id,
    customer_psid: row.external_customer_id,
    page_id: text(row.metadata?.page_id || row.metadata?.resolved_page_id || ""),
    resolved_page_id: text(row.metadata?.resolved_page_id || ""),
    recipient_page_id: text(row.metadata?.recipient_page_id || ""),
    metadata: row.metadata || {},
    messenger_profile: row.metadata?.messenger_profile || null,
  },
});

const configFor = (row) => ({
  tenant_id: TENANT_ID,
  facebook_page_id: text(row.metadata?.page_id || row.metadata?.resolved_page_id || ""),
  instagram_business_account_id: text(row.metadata?.instagram_business_account_id || (row.channel === "instagram" ? row.metadata?.account_id : "") || ""),
});

const refreshOne = async (row) => {
  const enriched = await enrichMessengerProfile({
    message: messageFor(row),
    config: configFor(row),
    facebookPageId: text(row.metadata?.page_id || row.metadata?.resolved_page_id || ""),
    instagramBusinessAccountId: text(row.metadata?.instagram_business_account_id || (row.channel === "instagram" ? row.metadata?.account_id : "") || ""),
    forceRefresh: true,
  });
  return {
    has_name: Boolean(text(enriched?.customer_name || enriched?.display_name)),
    has_username: Boolean(text(enriched?.customer_username)),
    has_avatar: Boolean(text(enriched?.customer_avatar_url)),
    updated_rows: Number(enriched?.updated_rows || 0),
  };
};

// One lookup, nothing written. The enrichment itself persists on success, so the
// probe re-reads the rows afterwards only to report — it never edits them.
const runProbe = async () => {
  const [rawChannel, rawId] = PROBE.split(":");
  const channel = normalizeMetaProfileChannel(rawChannel);
  // "latest" picks the most recently active conversation on that channel, so a probe
  // never needs a customer id typed on a command line.
  let id = text(rawId);
  if (channel && id === "latest") {
    const latest = await db.query(
      `SELECT external_customer_id FROM ai_channel_conversations WHERE tenant_id = $1 AND channel = $2 AND COALESCE(thread_kind, 'dm') NOT IN ('comment', 'post') AND external_customer_id ~ '^[0-9]{5,}$' ORDER BY last_message_at DESC NULLS LAST, id DESC LIMIT 1`,
      [TENANT_ID, channel]
    );
    id = text(latest.rows[0]?.external_customer_id);
  }
  if (!channel || !/^\d{5,}$/.test(id)) {
    console.error("Usage: --probe <facebook_messenger|instagram>:<PSID or IGSID | latest>");
    process.exit(1);
  }
  const lookup = await db.query(
    `SELECT metadata, external_conversation_id FROM ai_channel_conversations WHERE tenant_id = $1 AND channel = $2 AND external_customer_id = $3 ORDER BY updated_at DESC LIMIT 1`,
    [TENANT_ID, channel, id]
  );
  const row = lookup.rows[0] || { metadata: {}, external_conversation_id: `${channel}:${id}` };
  log(`probe ${channel} ${mask(id)} conversation=${lookup.rows[0] ? "found" : "none"}`);
  try {
    const outcome = await refreshOne({ ...row, channel, external_customer_id: text(id), customer_name: "", customer_avatar_url: "" });
    log("probe result", outcome);
    if (!outcome.has_name && !outcome.has_avatar && !outcome.has_username) {
      log("Meta answered without a usable profile — check the backend log line instagram_profile_graph_response / messenger_profile_graph_response for response_keys and error_kind.");
    }
  } catch (error) {
    log("probe failed", classifyMetaProfileError(error));
  }
};

const run = async () => {
  if (PROBE) {
    await runProbe();
    return;
  }
  const state = loadState();
  const candidates = await loadCandidates();
  log(`tenant ${TENANT_ID}: ${candidates.length} candidate conversation(s)${CHANNEL ? ` on ${CHANNEL}` : ""}${ALL ? " (all)" : " (missing name/avatar)"}${DRY_RUN ? " — dry run" : ""}`);
  const summary = { processed: 0, skipped_recent: 0, skipped_unavailable: 0, named: 0, pictured: 0, refused: 0, failed: 0, rate_limited: 0 };
  let inBatch = 0;
  for (const row of candidates) {
    const key = candidateKey(row);
    if (recentlyDone(state, key)) {
      summary.skipped_recent += 1;
      continue;
    }
    if (rememberedUnavailable(state, key)) {
      summary.skipped_unavailable += 1;
      continue;
    }
    if (DRY_RUN) {
      log(`would refresh ${row.channel} ${mask(row.external_customer_id)} name=${row.customer_name ? "yes" : "no"} avatar=${row.customer_avatar_url ? "yes" : "no"} profile=${row.profile_id ? row.profile_id : "none"} last_sync=${row.last_profile_sync_at ? new Date(row.last_profile_sync_at).toISOString().slice(0, 10) : "never"}`);
      summary.processed += 1;
      continue;
    }
    while (shouldDeferBackgroundGraphWork()) {
      log("Graph budget under pressure — pausing 30s");
      await sleep(30000);
    }
    let attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      try {
        const outcome = await refreshOne(row);
        summary.processed += 1;
        if (outcome.has_name) summary.named += 1;
        if (outcome.has_avatar) summary.pictured += 1;
        state.done[key] = { at: new Date().toISOString(), ...outcome };
        delete state.failed?.[key];
        if (!outcome.has_name && !outcome.has_avatar && !outcome.has_username) {
          // The enrichment swallows the Graph error and reports through its own log
          // line; treat "nothing came back" as unavailable so the next run skips it.
          summary.refused += 1;
          state.unavailable[key] = { at: new Date().toISOString() };
        }
        log(`${row.channel} ${mask(row.external_customer_id)} name=${outcome.has_name ? "yes" : "no"} avatar=${outcome.has_avatar ? "yes" : "no"} rows=${outcome.updated_rows}`);
        break;
      } catch (error) {
        if (isGraphRateLimitError(error)) {
          summary.rate_limited += 1;
          log(`rate limited — sleeping ${Math.round(RATE_LIMIT_SLEEP_MS / 1000)}s`);
          await sleep(RATE_LIMIT_SLEEP_MS);
          continue;
        }
        const classified = classifyMetaProfileError(error);
        summary.failed += 1;
        state.failed[key] = { at: new Date().toISOString(), kind: classified.kind, code: classified.code, subcode: classified.subcode };
        if (classified.kind === "unavailable" || classified.kind === "permission") {
          state.unavailable[key] = { at: new Date().toISOString(), kind: classified.kind };
        }
        log(`${row.channel} ${mask(row.external_customer_id)} failed: ${classified.kind} (${classified.code}/${classified.subcode})`);
        break;
      }
    }
    saveState(state);
    inBatch += 1;
    if (inBatch >= BATCH) {
      inBatch = 0;
      if (BATCH_PAUSE_MS) await sleep(BATCH_PAUSE_MS);
    } else if (PACE_MS) {
      await sleep(PACE_MS);
    }
  }
  saveState(state);
  log("done", summary);
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[meta-profile-backfill] fatal", error?.message || error);
    process.exit(1);
  });
