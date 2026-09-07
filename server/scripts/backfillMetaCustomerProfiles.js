/*
 * Backfill customer names and profile pictures for existing Messenger and Instagram
 * conversations, now that "Business Asset User Profile Access" is approved.
 *
 * Goes through the same code the webhook uses (enrichMessengerProfile with
 * forceRefresh), so the endpoint per channel, the token choice and the no-wipe merge
 * are the ones production runs — nothing is hand-rolled here. The orchestration lives
 * in lib/metaProfileBackfillRunner.js and is unit-tested with fakes.
 *
 * Safety:
 *   - one run at a time (atomic lock file; a dead holder's lock is taken over)
 *   - every Graph call goes through the shared limiter's background lane, and the
 *     run pauses (bounded) when the app budget is under pressure
 *   - total wait for the budget is capped: META_PROFILE_BACKFILL_MAX_WAIT_MS or
 *     --max-wait-ms (default 15 min). Past it the run stops with exit code 75, the
 *     state saved, and a suggested retry time printed.
 *   - resumable: state file written after every customer; a customer refreshed within
 *     --skip-hours is skipped, an id Meta refused is skipped for a week
 *   - no flag disables the rate-limit protection
 *
 *   node server/scripts/backfillMetaCustomerProfiles.js --dry-run
 *   node server/scripts/backfillMetaCustomerProfiles.js --limit 5
 *   node server/scripts/backfillMetaCustomerProfiles.js --channel instagram --max-calls 50
 *   node server/scripts/backfillMetaCustomerProfiles.js --all        # refresh stale ones too
 *   node server/scripts/backfillMetaCustomerProfiles.js --probe instagram:latest
 *
 * --probe asks Meta for one profile and prints which fields came back (presence only)
 * and the error class if it was refused.
 *
 * Files (state, lock, log) live in META_PROFILE_BACKFILL_DIR, else /app/uploads/backfill,
 * else server/data/backfill, else the OS temp dir — the directory is created if missing.
 *
 * Exit codes: 0 done (or --max-calls reached), 1 fatal, 2 interrupted (SIGINT/SIGTERM),
 * 3 another run holds the lock, 75 wait budget exhausted — try again later.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../database/db.js";
import { enrichMessengerProfile } from "../services/metaIntegrationService.js";
import { isGraphRateLimitError, shouldDeferBackgroundGraphWork, runGraphRequest, getMetaGraphBudgetSnapshot } from "../services/metaGraphRateLimiter.js";
import { classifyMetaProfileError, normalizeMetaProfileChannel } from "../services/metaCustomerProfileService.js";
import {
  EXIT_CODES,
  acquireBackfillLock,
  createFileStateStore,
  resolveBackfillDir,
  runMetaProfileBackfill,
} from "./lib/metaProfileBackfillRunner.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const envNumber = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
const AUDIT = flag("audit");
const MAX_CALLS = Math.max(0, Number(option("max-calls", "0")) || 0);
const MAX_WAIT_MS = Math.max(0, Number(option("max-wait-ms", String(envNumber("META_PROFILE_BACKFILL_MAX_WAIT_MS", 15 * 60 * 1000)))) || 0);
const MAX_PAUSE_MS = Math.max(5000, envNumber("META_PROFILE_BACKFILL_MAX_PAUSE_MS", 60 * 1000));
const RATE_LIMIT_SLEEP_MS = Math.max(5000, Number(option("rate-limit-sleep-ms", "65000")) || 65000);
const LOCK_STALE_MS = Math.max(60 * 1000, envNumber("META_PROFILE_BACKFILL_LOCK_STALE_MS", 6 * 60 * 60 * 1000));

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
// The container's uploads volume is used only when it is really there; a recursive
// mkdir of "/app/uploads/backfill" on a developer machine would otherwise create it
// at the drive root.
const { dir: BACKFILL_DIR, tried } = resolveBackfillDir({
  explicit: process.env.META_PROFILE_BACKFILL_DIR || option("dir", ""),
  candidates: [
    fs.existsSync("/app/uploads") && process.platform !== "win32" ? "/app/uploads/backfill" : "",
    path.resolve(scriptsDir, "../data/backfill"),
  ].filter(Boolean),
});
const STATE_FILE = option("state-file", "") || process.env.META_PROFILE_BACKFILL_STATE_FILE || path.join(BACKFILL_DIR, "meta-profile-backfill.json");

const text = (value = "") => String(value ?? "").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...parts) => console.log(`[${stamp()}]`, ...parts);
const mask = (value = "") => {
  const safe = text(value);
  return safe.length <= 6 ? "***" : `${safe.slice(0, 3)}…${safe.slice(-3)}`;
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

const instagramAccountFor = (row) =>
  text(row.metadata?.instagram_business_account_id || (row.channel === "instagram" ? row.metadata?.account_id : "") || "");

// One customer: through the limiter's background lane (spacing + breaker wait), then
// the production enrichment with forceRefresh. Throws on rate limit so the runner can
// pause and retry; every other failure is absorbed by the enrichment itself.
const refreshOne = async (row) =>
  runGraphRequest({
    lane: "background",
    label: `profile-backfill:${row.channel}`,
    run: async () => {
      const enriched = await enrichMessengerProfile({
        message: messageFor(row),
        config: {
          tenant_id: TENANT_ID,
          facebook_page_id: text(row.metadata?.page_id || row.metadata?.resolved_page_id || ""),
          instagram_business_account_id: instagramAccountFor(row),
        },
        facebookPageId: text(row.metadata?.page_id || row.metadata?.resolved_page_id || ""),
        instagramBusinessAccountId: instagramAccountFor(row),
        forceRefresh: true,
      });
      return {
        has_name: Boolean(text(enriched?.customer_name || enriched?.display_name)),
        has_username: Boolean(text(enriched?.customer_username)),
        has_avatar: Boolean(text(enriched?.customer_avatar_url)),
        updated_rows: Number(enriched?.updated_rows || 0),
      };
    },
  });

// One lookup. The enrichment persists on success like production would; the probe
// only reports what came back.
const runProbe = async () => {
  const [rawChannel, rawId] = PROBE.split(":");
  const channel = normalizeMetaProfileChannel(rawChannel);
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
    return EXIT_CODES.FATAL;
  }
  const lookup = await db.query(
    `SELECT metadata, external_conversation_id FROM ai_channel_conversations WHERE tenant_id = $1 AND channel = $2 AND external_customer_id = $3 ORDER BY updated_at DESC LIMIT 1`,
    [TENANT_ID, channel, id]
  );
  const row = lookup.rows[0] || { metadata: {}, external_conversation_id: `${channel}:${id}` };
  log(`probe ${channel} ${mask(id)} conversation=${lookup.rows[0] ? "found" : "none"} budget=${JSON.stringify(shouldDeferBackgroundGraphWork())}`);
  try {
    const outcome = await refreshOne({ ...row, channel, external_customer_id: id, customer_name: "", customer_avatar_url: "" });
    log("probe result", outcome);
    if (!outcome.has_name && !outcome.has_avatar && !outcome.has_username) {
      log("Meta answered without a usable profile — check the backend log line instagram_profile_graph_response / messenger_profile_graph_response for response_keys and error_kind.");
    }
    return EXIT_CODES.OK;
  } catch (error) {
    log("probe failed", classifyMetaProfileError(error));
    return EXIT_CODES.FATAL;
  }
};

// Read-only: what identity is actually STORED for each conversation, and — for a
// stored picture — which CDN host it points at and when its signature expires.
// Answers "the picture is missing: was it never returned, has the link died, or is
// the link fine and the browser is not loading it?" without calling Meta at all.
const avatarExpiry = (url = "") => {
  try {
    const parsed = new URL(url);
    // fbsbx/lookaside signs with ?ext=<unix>, fbcdn/cdninstagram with ?oe=<hex unix>
    const ext = Number(parsed.searchParams.get("ext"));
    if (Number.isFinite(ext) && ext > 0) return new Date(ext * 1000);
    const oe = parsed.searchParams.get("oe");
    if (oe && /^[0-9a-f]+$/i.test(oe)) return new Date(parseInt(oe, 16) * 1000);
    return null;
  } catch {
    return null;
  }
};
const avatarHost = (url = "") => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

const runAudit = async () => {
  const params = [TENANT_ID];
  const where = ["c.tenant_id = $1", "c.channel IN ('facebook_messenger', 'instagram')", "COALESCE(c.thread_kind, 'dm') NOT IN ('comment', 'post')"];
  if (CHANNEL) {
    params.push(CHANNEL);
    where.push(`c.channel = $${params.length}`);
  }
  const result = await db.query(
    `
    SELECT
      c.channel,
      c.external_customer_id,
      c.customer_name,
      c.customer_avatar_url,
      p.display_name AS profile_display_name,
      p.username AS profile_username,
      p.profile_pic_url,
      p.profile_sync_status,
      p.last_profile_sync_at
    FROM ai_channel_conversations c
    LEFT JOIN ai_customer_profiles p
      ON p.tenant_id = c.tenant_id
      AND (p.id = c.customer_profile_id OR (c.customer_profile_id IS NULL AND p.phone = 'meta:' || c.channel || ':' || c.external_customer_id))
    WHERE ${where.join(" AND ")}
    ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
    ${LIMIT ? `LIMIT ${LIMIT}` : ""}
    `,
    params
  );
  const now = Date.now();
  const totals = {};
  const hosts = {};
  for (const row of result.rows) {
    const key = row.channel;
    totals[key] = totals[key] || { total: 0, named: 0, avatar_stored: 0, avatar_live: 0, avatar_expired: 0, avatar_unknown_expiry: 0, synced: 0, never_synced: 0 };
    const bucket = totals[key];
    bucket.total += 1;
    if (text(row.customer_name) || text(row.profile_display_name)) bucket.named += 1;
    if (row.last_profile_sync_at) bucket.synced += 1;
    else bucket.never_synced += 1;
    const url = text(row.customer_avatar_url || row.profile_pic_url);
    if (!url) continue;
    bucket.avatar_stored += 1;
    const host = avatarHost(url);
    hosts[host] = (hosts[host] || 0) + 1;
    const expiry = avatarExpiry(url);
    if (!expiry) bucket.avatar_unknown_expiry += 1;
    else if (expiry.getTime() < now) bucket.avatar_expired += 1;
    else bucket.avatar_live += 1;
  }
  log("stored identity per channel", totals);
  log("avatar CDN hosts", hosts);
  const sample = result.rows.filter((row) => text(row.customer_name || row.profile_display_name) && !text(row.customer_avatar_url || row.profile_pic_url)).slice(0, 10);
  if (sample.length) {
    log(`named but no picture stored (${sample.length} shown):`);
    for (const row of sample) {
      log(`  ${row.channel}:${mask(row.external_customer_id)} synced=${row.last_profile_sync_at ? new Date(row.last_profile_sync_at).toISOString().slice(0, 16) : "never"} status=${text(row.profile_sync_status) || "-"} username=${text(row.profile_username) ? "yes" : "no"}`);
    }
  }
  return EXIT_CODES.OK;
};

const main = async () => {
  if (tried.length) log(`state dir: ${BACKFILL_DIR} (skipped: ${tried.map((entry) => `${entry.dir} [${entry.error}]`).join(", ")})`);
  if (AUDIT) return runAudit();
  if (PROBE) return runProbe();

  const lock = acquireBackfillLock({ dir: BACKFILL_DIR, staleMs: LOCK_STALE_MS });
  if (!lock.acquired) {
    log(`another backfill holds the lock (pid ${lock.holder?.pid || "?"}, started ${lock.holder?.started_at || "?"}); refusing to start a second one. Remove ${lock.file} only if that process is gone.`);
    return EXIT_CODES.LOCKED;
  }
  if (lock.takenOver) log(`took over a stale lock (pid ${lock.holder?.pid || "?"}, started ${lock.holder?.started_at || "?"})`);

  const controller = new AbortController();
  const onSignal = (name) => {
    log(`${name} received — finishing the customer in flight, saving state, then exiting`);
    controller.abort();
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGHUP", () => log("SIGHUP received (terminal closed) — continuing detached; state is saved after every customer"));

  try {
    const stateStore = createFileStateStore({ file: STATE_FILE, readOnly: DRY_RUN });
    const candidates = await loadCandidates();
    log(`tenant ${TENANT_ID}: ${candidates.length} candidate conversation(s)${CHANNEL ? ` on ${CHANNEL}` : ""}${ALL ? " (all)" : " (missing name/avatar)"}${DRY_RUN ? " — dry run" : ""}; state ${STATE_FILE}; max wait ${Math.round(MAX_WAIT_MS / 1000)}s${MAX_CALLS ? `; max calls ${MAX_CALLS}` : ""}`);
    const result = await runMetaProfileBackfill({
      candidates,
      refresh: refreshOne,
      shouldDefer: shouldDeferBackgroundGraphWork,
      sleep,
      stateStore,
      isRateLimitError: isGraphRateLimitError,
      classifyError: classifyMetaProfileError,
      log: (line) => log(line.replace(/(facebook_messenger|instagram):(\d{5,})/g, (match, channel, id) => `${channel}:${mask(id)}`)),
      signal: controller.signal,
      options: {
        dryRun: DRY_RUN,
        force: FORCE,
        batch: BATCH,
        paceMs: PACE_MS,
        batchPauseMs: BATCH_PAUSE_MS,
        skipHours: SKIP_HOURS,
        maxWaitMs: MAX_WAIT_MS,
        maxPauseMs: MAX_PAUSE_MS,
        rateLimitSleepMs: RATE_LIMIT_SLEEP_MS,
        maxCalls: MAX_CALLS,
      },
    });
    log("done", { stop_reason: result.stopReason, exit_code: result.exitCode, retry_at: result.retryAt ? new Date(result.retryAt).toISOString() : null, ...result.summary });
    log("graph budget at exit", getMetaGraphBudgetSnapshot());
    return result.exitCode;
  } finally {
    lock.release();
  }
};

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("[meta-profile-backfill] fatal", error?.message || error);
    process.exit(EXIT_CODES.FATAL);
  });
