// TikTok webhook intake: verify, persist, ack fast, process asynchronously.
//
// Shape follows the Telegram durable-intake precedent (claim/SKIP LOCKED,
// exponential backoff, stale-lock recovery) because TikTok has the same
// constraints, only stricter: at-least-once delivery, retries with exponential
// backoff for up to 72 hours, and a hard requirement to answer 200 immediately.

import crypto from "node:crypto";

import db from "../database/db.js";
import { redactTikTokError } from "./tiktokApiClient.js";
import { tiktokClientSecret } from "./tiktokConfigService.js";
import { markTikTokAuthorizationRemoved } from "./tiktokOAuthService.js";

const text = (value = "") => String(value ?? "").trim();

const MAX_RETRIES = Math.max(1, Math.min(20, Number(process.env.TIKTOK_WEBHOOK_MAX_RETRIES || 8)));
const LOCK_TIMEOUT_MINUTES = 5;
const MAX_BATCH_SIZE = 10;
// TikTok does not publish a required tolerance; 5 minutes matches what the docs
// suggest computing and is generous for clock drift without leaving a wide
// replay window.
const SIGNATURE_TOLERANCE_SECONDS = Math.max(60, Number(process.env.TIKTOK_WEBHOOK_TOLERANCE_SECONDS || 300));

export const TIKTOK_WEBHOOK_EVENTS = Object.freeze({
  AUTHORIZATION_REMOVED: "authorization.removed",
  VIDEO_UPLOAD_FAILED: "video.upload.failed",
  VIDEO_PUBLISH_COMPLETED: "video.publish.completed",
  PORTABILITY_DOWNLOAD_READY: "portability.download.ready",
});

// authorization.removed `reason` codes, per the official event reference.
export const TIKTOK_AUTHORIZATION_REMOVED_REASONS = Object.freeze({
  0: "unknown",
  1: "user_disconnected",
  2: "account_deleted",
  3: "age_changed",
  4: "account_banned",
  5: "developer_revoked",
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

// Header form: `TikTok-Signature: t=1633174587,s=18494715036ac...`
export const parseTikTokSignatureHeader = (header = "") => {
  const parts = text(header).split(",");
  const parsed = {};
  for (const part of parts) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    parsed[text(part.slice(0, index))] = text(part.slice(index + 1));
  }
  const timestamp = Number(parsed.t);
  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    signature: text(parsed.s).toLowerCase(),
  };
};

export const computeTikTokSignature = ({ timestamp, rawBody, clientSecret } = {}) =>
  crypto
    .createHmac("sha256", text(clientSecret))
    // The signed string is `${timestamp}.${rawBody}` — the raw bytes exactly as
    // delivered, NOT a re-serialised JSON.stringify of the parsed object.
    // rawBody is deliberately NOT trimmed: trimming would both diverge from
    // TikTok's own computation for any body with surrounding whitespace and
    // make two different payloads sign identically.
    .update(`${text(timestamp)}.${String(rawBody ?? "")}`, "utf8")
    .digest("hex");

export const verifyTikTokWebhookSignature = ({
  header,
  rawBody,
  clientSecret = tiktokClientSecret(),
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
} = {}) => {
  if (!text(clientSecret)) return { valid: false, reason: "client_secret_missing" };
  const { timestamp, signature } = parseTikTokSignatureHeader(header);
  if (!timestamp || !signature) return { valid: false, reason: "signature_header_malformed" };
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { valid: false, reason: "signature_timestamp_out_of_tolerance" };

  const expected = computeTikTokSignature({ timestamp, rawBody, clientSecret });
  const expectedBuffer = Buffer.from(expected, "utf8");
  const suppliedBuffer = Buffer.from(signature, "utf8");
  // Length check first: timingSafeEqual throws on a length mismatch, and that
  // throw would itself be a (crude) oracle.
  if (expectedBuffer.length !== suppliedBuffer.length) return { valid: false, reason: "signature_mismatch" };
  if (!crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) return { valid: false, reason: "signature_mismatch" };
  return { valid: true, reason: "" };
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

let schemaReadyPromise = null;

export const ensureTikTokWebhookSchema = async (client = db) => {
  if (!schemaReadyPromise || client !== db) {
    const operation = (async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tiktok_webhook_events (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NULL,
          event_signature TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL DEFAULT '',
          user_openid TEXT NOT NULL DEFAULT '',
          event_create_time BIGINT NULL,
          payload JSONB NOT NULL,
          processing_status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          locked_at TIMESTAMPTZ NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          processed_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tiktok_webhook_events_pending
        ON tiktok_webhook_events (processing_status, next_attempt_at, received_at)
        WHERE processing_status IN ('pending', 'failed', 'processing')
      `);
      return true;
    })();
    if (client === db) schemaReadyPromise = operation.catch((error) => { schemaReadyPromise = null; throw error; });
    return operation;
  }
  return schemaReadyPromise;
};

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

// TikTok events carry no delivery/event id, so identity has to be derived. The
// hash covers everything that distinguishes one logical event from another; two
// retries of the same event hash identically and collapse on the UNIQUE index.
export const tiktokEventSignature = (event = {}) =>
  crypto
    .createHash("sha256")
    .update(
      [
        text(event.event),
        text(event.user_openid),
        text(event.create_time),
        text(event.client_key),
        typeof event.content === "string" ? event.content : JSON.stringify(event.content ?? ""),
      ].join("|"),
      "utf8"
    )
    .digest("hex");

// `content` arrives as a JSON-encoded STRING, not an object.
export const parseTikTokEventContent = (event = {}) => {
  const content = event?.content;
  if (content && typeof content === "object") return content;
  const raw = text(content);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const persistTikTokWebhookEvent = async ({ event, client = db } = {}) => {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw Object.assign(new Error("Malformed TikTok event"), { status: 400, code: "TIKTOK_EVENT_MALFORMED" });
  }
  await ensureTikTokWebhookSchema(client);
  const signature = tiktokEventSignature(event);
  const createTime = Number(event.create_time);
  const result = await client.query(
    `INSERT INTO tiktok_webhook_events (event_signature, event_type, user_openid, event_create_time, payload)
     VALUES ($1::text, $2::text, $3::text, $4::bigint, $5::jsonb)
     ON CONFLICT (event_signature) DO NOTHING
     RETURNING id, event_type, processing_status`,
    [
      signature,
      text(event.event),
      text(event.user_openid),
      Number.isFinite(createTime) ? createTime : null,
      JSON.stringify(event),
    ]
  );
  return { accepted: true, duplicate: result.rowCount === 0, record: result.rows[0] || null, signature };
};

export const claimNextTikTokWebhookEvent = async ({ client = db, maxRetries = MAX_RETRIES } = {}) => {
  await ensureTikTokWebhookSchema(client);
  const result = await client.query(
    `WITH candidate AS (
       SELECT id
       FROM tiktok_webhook_events
       WHERE retry_count < $1::int
         AND (
           (processing_status IN ('pending', 'failed') AND next_attempt_at <= NOW())
           OR (processing_status = 'processing' AND locked_at < NOW() - ($2::int * INTERVAL '1 minute'))
         )
       ORDER BY received_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE tiktok_webhook_events queued
     SET processing_status = 'processing', locked_at = NOW(), updated_at = NOW()
     FROM candidate
     WHERE queued.id = candidate.id
     RETURNING queued.*`,
    [Math.max(1, Number(maxRetries) || MAX_RETRIES), LOCK_TIMEOUT_MINUTES]
  );
  return result.rows[0] || null;
};

export const markTikTokWebhookEventProcessed = async ({ id, tenantId = null, client = db } = {}) => {
  await client.query(
    `UPDATE tiktok_webhook_events
     SET processing_status = 'processed', processed_at = NOW(), locked_at = NULL,
         last_error = '', tenant_id = COALESCE($2::bigint, tenant_id), updated_at = NOW()
     WHERE id = $1::bigint`,
    [id, tenantId]
  );
};

export const markTikTokWebhookEventFailed = async ({ id, error, client = db } = {}) => {
  await client.query(
    `UPDATE tiktok_webhook_events
     SET processing_status = 'failed', retry_count = retry_count + 1,
         last_error = $2::text, locked_at = NULL,
         next_attempt_at = NOW() + (LEAST(300, POWER(2, LEAST(retry_count, 8))::int) * INTERVAL '1 second'),
         updated_at = NOW()
     WHERE id = $1::bigint`,
    [id, redactTikTokError(error)]
  );
};

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

export const processTikTokWebhookEventRecord = async (record, {
  onAuthorizationRemoved = markTikTokAuthorizationRemoved,
  client = db,
} = {}) => {
  const event = record?.payload || {};
  const eventType = text(event.event) || text(record?.event_type);
  const content = parseTikTokEventContent(event);
  const openId = text(event.user_openid) || text(record?.user_openid);

  switch (eventType) {
    case TIKTOK_WEBHOOK_EVENTS.AUTHORIZATION_REMOVED: {
      const reasonCode = Number(content.reason);
      const reason = TIKTOK_AUTHORIZATION_REMOVED_REASONS[reasonCode] || "unknown";
      const result = await onAuthorizationRemoved({ openId, reason, client });
      return { handled: true, event: eventType, reason, tenant_ids: result?.tenant_ids || [] };
    }
    case TIKTOK_WEBHOOK_EVENTS.VIDEO_PUBLISH_COMPLETED:
    case TIKTOK_WEBHOOK_EVENTS.VIDEO_UPLOAD_FAILED: {
      const shareId = text(content.share_id);
      const status = eventType === TIKTOK_WEBHOOK_EVENTS.VIDEO_PUBLISH_COMPLETED ? "published" : "failed";
      // share_id is TikTok's identifier for the share, which may or may not
      // correspond to a job we started (the user can also publish an inbox
      // draft manually). A miss is normal and is not an error.
      const updated = await client.query(
        `UPDATE tiktok_publish_jobs
         SET status = $2::text,
             external_post_id = CASE WHEN $2::text = 'published' THEN $1::text ELSE external_post_id END,
             fail_reason = CASE WHEN $2::text = 'failed' THEN 'video_upload_failed' ELSE fail_reason END,
             last_status_checked_at = NOW(), updated_at = NOW()
         WHERE publish_id = $1::text AND publish_id <> ''
         RETURNING id, tenant_id`,
        [shareId, status]
      ).catch(() => ({ rowCount: 0, rows: [] }));
      return { handled: true, event: eventType, share_id: shareId, matched_jobs: updated.rowCount, tenant_ids: updated.rows.map((r) => r.tenant_id) };
    }
    case TIKTOK_WEBHOOK_EVENTS.PORTABILITY_DOWNLOAD_READY:
      // Data Portability is not a product this app uses. Recorded, not acted on.
      return { handled: false, event: eventType, reason: "product_not_enabled" };
    default:
      // Unknown event types are stored and marked processed rather than retried
      // for 72 hours: TikTok can add event types at any time, and a permanent
      // retry loop on an event we will never understand is a self-inflicted DoS.
      return { handled: false, event: eventType || "unknown", reason: "unsupported_event" };
  }
};

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

let workerRunning = false;
let workerTimer = null;

export const runTikTokWebhookBatch = async ({ client = db, processRecord = processTikTokWebhookEventRecord, maxRows = MAX_BATCH_SIZE } = {}) => {
  if (workerRunning && client === db) return { skipped: true, reason: "worker_running" };
  if (client === db) workerRunning = true;
  let processed = 0;
  let failed = 0;
  try {
    for (let index = 0; index < Math.max(1, Number(maxRows) || 1); index += 1) {
      const record = await claimNextTikTokWebhookEvent({ client });
      if (!record) break;
      try {
        const result = await processRecord(record, { client });
        await markTikTokWebhookEventProcessed({ id: record.id, tenantId: result?.tenant_ids?.[0] ?? null, client });
        processed += 1;
      } catch (error) {
        await markTikTokWebhookEventFailed({ id: record.id, error, client });
        failed += 1;
        console.warn("[tiktok-webhook] event processing failed", {
          event_type: record.event_type,
          message: redactTikTokError(error),
        });
      }
    }
    return { processed, failed };
  } finally {
    if (client === db) workerRunning = false;
  }
};

export const wakeTikTokWebhookWorker = () => {
  setImmediate(() => {
    void runTikTokWebhookBatch().catch((error) =>
      console.warn("[tiktok-webhook] worker wake failed", { message: redactTikTokError(error) })
    );
  });
};

export const startTikTokWebhookWorker = (intervalMs) => {
  if (workerTimer) return workerTimer;
  workerTimer = setInterval(wakeTikTokWebhookWorker, Math.max(1_000, Number(intervalMs) || 10_000));
  workerTimer.unref?.();
  wakeTikTokWebhookWorker();
  return workerTimer;
};

export const stopTikTokWebhookWorker = () => {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
};
