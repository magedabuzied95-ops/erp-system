// AI Studio Phase 9 — Messaging Lifecycle & Delivery Reconciliation.
// ---------------------------------------------------------------------------
// A thin, channel-agnostic reconciler that consumes provider DELIVERY / READ / FAILED status events
// (from the EXISTING WhatsApp + Meta webhook paths — never a new public endpoint), persistently
// de-duplicates them, correlates them to the canonical outbound message (ai_support_messages) and to
// the restock notification (restock_notifications) by PROVIDER MESSAGE ID, and applies a MONOTONIC
// status transition. It contains NO AI logic and NEVER sends anything.
//
// Guarantees:
//  - One canonical internal lifecycle: pending < sending < sent < delivered < read (+ failed).
//  - Out-of-order / duplicate callbacks never move a message backwards (read -> delivered is refused).
//  - Every provider event is deduplicated persistently (message_delivery_events.dedup_key UNIQUE).
//  - customer_notified_at is NEVER touched here (it means "provider accepted the send", set in Phase 8).
//  - A malformed / unmatched / duplicate event can never throw into the webhook processor.
//  - No automatic customer-message retry; a failure surfaces for human review only.

import db from "../database/db.js";
import { writeAudit } from "./aiWorkflowService.js";

// ---- Canonical lifecycle ----
export const MESSAGE_LIFECYCLE = Object.freeze(["pending", "sending", "sent", "delivered", "read"]);
// Rank for monotonic ordering. failed shares sent's rank (2): delivered/read may still overtake a
// premature failed, but a late failed can never overwrite a confirmed delivered/read.
const RANK = Object.freeze({ pending: 0, sending: 1, sent: 2, failed: 2, delivered: 3, read: 4 });
export const statusRank = (s) => (Object.prototype.hasOwnProperty.call(RANK, String(s || "").toLowerCase()) ? RANK[String(s).toLowerCase()] : 0);

// A transition from -> to is allowed when it strictly advances the lifecycle, OR it is a failure that
// arrives before the message was confirmed delivered/read.
export const isAllowedTransition = (from, to) => {
  const f = String(from || "").toLowerCase();
  const t = String(to || "").toLowerCase();
  if (!t) return false;
  if (t === f) return false;
  if (t === "failed") return statusRank(f) < RANK.delivered; // never overwrite delivered/read with a late failure
  return statusRank(t) > statusRank(f);
};

// ---- Provider status mapping (one canonical lifecycle; never provider-specific states in the UI) ----
// Accepts strings (WhatsApp/Evolution, Meta) AND numeric Baileys ack levels (0..4). Returns a canonical
// status or null when the outcome is unknown/ambiguous.
export const mapProviderStatus = (channel, raw) => {
  if (raw === null || raw === undefined || raw === "") return null;
  // Numeric Baileys ack: 0 pending, 1 server-ack(sent), 2 delivery-ack(delivered), 3 read, 4 played(read).
  if (typeof raw === "number" || /^\d+$/.test(String(raw).trim())) {
    const n = Number(raw);
    if (n <= 0) return "pending";
    if (n === 1) return "sent";
    if (n === 2) return "delivered";
    if (n >= 3) return "read";
  }
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === "pending" || s === "queued" || s === "scheduled") return "pending";
  if (s === "sending" || s === "inflight" || s === "in_flight") return "sending";
  if (s.includes("read") || s === "played" || s === "seen") return "read";
  // Failure keywords MUST be checked before "deliver" so "undeliverable" is a failure, not a delivery.
  if (s.includes("fail") || s.includes("error") || s.includes("reject") || s.includes("undeliver")) return "failed";
  if (s.includes("deliver")) return "delivered"; // delivered / delivery / delivery_ack (ack level 2)
  if (s === "sent" || s === "ack" || s === "server_ack" || s.includes("send")) return "sent"; // ack level 1
  return null; // unknown -> recorded as unmatched/unknown, never applied
};

// ---- Sanitize: bound every field, allowlist a tiny metadata subset, never store secrets/raw bodies ----
const clip = (v, n) => (v === null || v === undefined ? "" : String(v).slice(0, n));
const METADATA_ALLOW = ["failure_code", "failure_reason", "error_code", "error", "remote_jid", "instance", "watermark", "recipient_id"];
export const sanitizeDeliveryEvent = (input = {}) => {
  const meta = {};
  const src = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  for (const k of METADATA_ALLOW) if (src[k] !== undefined && src[k] !== null && typeof src[k] !== "object") meta[k] = clip(src[k], 300);
  let occurredAt = null;
  const raw = input.occurredAt;
  if (raw) {
    let ms = null;
    if (typeof raw === "number") ms = raw < 1e12 ? raw * 1000 : raw; // seconds vs ms
    else { const p = Date.parse(String(raw)); if (!Number.isNaN(p)) ms = p; }
    if (ms && Number.isFinite(ms)) { const d = new Date(ms); if (!Number.isNaN(d.getTime())) occurredAt = d; }
  }
  return {
    tenantId: input.tenantId ? Number(input.tenantId) : null,
    channel: clip(input.channel, 40),
    providerMessageId: clip(input.providerMessageId, 200),
    providerEventId: clip(input.providerEventId, 200),
    rawStatus: input.providerStatus,
    occurredAt,
    metadata: meta,
  };
};

const buildDedupKey = ({ tenantId, channel, providerEventId, providerMessageId, canonical }) =>
  providerEventId
    ? `evt:${tenantId}:${channel}:${providerEventId}`
    : `msg:${tenantId}:${channel}:${providerMessageId}:${canonical || "unknown"}`;

// ---- Schema (additive) ----
let schemaReady = null;
export const ensureMessageDeliverySchema = async (client = db) => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    // Provider delivery-event ledger: persistent idempotency + unmatched-event observability. No raw bodies.
    await client.query(`
      CREATE TABLE IF NOT EXISTS message_delivery_events (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        channel TEXT NOT NULL,
        provider_message_id TEXT NULL,
        provider_event_id TEXT NULL,
        status TEXT NOT NULL,
        previous_status TEXT NULL,
        new_status TEXT NULL,
        occurred_at TIMESTAMP NULL,
        received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        matched BOOLEAN NOT NULL DEFAULT FALSE,
        matched_message_id BIGINT NULL,
        notification_id BIGINT NULL,
        reason TEXT NULL,
        dedup_key TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_message_delivery_events_dedup ON message_delivery_events (tenant_id, dedup_key)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_message_delivery_events_pmid ON message_delivery_events (tenant_id, channel, provider_message_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_message_delivery_events_unmatched ON message_delivery_events (tenant_id, matched, received_at DESC)`);
    // Additive delivery projection on restock notifications (source of truth stays the event ledger +
    // ai_support_messages; these fields are the notification's monotonic view for the operator UI).
    await client.query(`ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS delivery_status TEXT NULL`);
    await client.query(`ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP NULL`);
    await client.query(`ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL`);
    await client.query(`ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS provider_failed_at TIMESTAMP NULL`);
    await client.query(`ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS provider_failure_code TEXT NULL`);
    await client.query(`ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS provider_failure_reason TEXT NULL`);
    await client.query(`ALTER TABLE restock_notifications ADD COLUMN IF NOT EXISTS last_provider_event_at TIMESTAMP NULL`);
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
};

// Apply the canonical status to the restock notification's delivery projection (monotonic). Returns
// { matched, notificationId, changed, from, to }. Never touches customer_notified_at or intent status.
const applyToRestockNotification = async ({ tenantId, providerMessageId, canonical, occurredAt, metadata }) => {
  const cur = await db.query(
    `SELECT id, status, delivery_status, delivered_at, read_at FROM restock_notifications
      WHERE tenant_id = $1 AND provider_message_id = $2 AND provider_message_id <> '' LIMIT 1`,
    [tenantId, providerMessageId]
  );
  const row = cur.rows[0];
  if (!row) return { matched: false };
  // Baseline: a 'sent' notification whose delivery hasn't been observed yet starts from 'sent'.
  const from = row.delivery_status || (row.status === "sent" ? "sent" : "");
  if (!isAllowedTransition(from, canonical)) return { matched: true, notificationId: row.id, changed: false, from, to: from };

  const sets = [`delivery_status = $3`, `last_provider_event_at = COALESCE($4::timestamptz, NOW())`];
  const params = [tenantId, row.id, canonical, occurredAt];
  if (canonical === "delivered" || canonical === "read") {
    if (!row.delivered_at) { params.push(occurredAt); sets.push(`delivered_at = COALESCE($${params.length}::timestamptz, NOW())`); }
  }
  if (canonical === "read") { params.push(occurredAt); sets.push(`read_at = COALESCE($${params.length}::timestamptz, NOW())`); }
  if (canonical === "failed") {
    params.push(occurredAt); sets.push(`provider_failed_at = COALESCE($${params.length}::timestamptz, NOW())`);
    params.push(clip(metadata?.failure_code || metadata?.error_code || "", 60)); sets.push(`provider_failure_code = NULLIF($${params.length}, '')`);
    params.push(clip(metadata?.failure_reason || metadata?.error || "", 300)); sets.push(`provider_failure_reason = NULLIF($${params.length}, '')`);
  }
  await db.query(`UPDATE restock_notifications SET ${sets.join(", ")}, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, params);
  return { matched: true, notificationId: row.id, changed: true, from, to: canonical };
};

// ---- The reconciler. Failure-isolated: always resolves, never throws into the webhook. ----
export const reconcileOutboundMessageStatus = async (input = {}) => {
  try {
    await ensureMessageDeliverySchema();
    const evt = sanitizeDeliveryEvent(input);
    if (!evt.tenantId || !evt.channel) return { ok: false, reason: "missing_context" };
    if (!evt.providerMessageId && !evt.providerEventId) return { ok: false, reason: "missing_identifier" };

    const canonical = mapProviderStatus(evt.channel, evt.rawStatus);
    const dedupKey = buildDedupKey({ tenantId: evt.tenantId, channel: evt.channel, providerEventId: evt.providerEventId, providerMessageId: evt.providerMessageId, canonical });

    // Persistent idempotency: the same provider event applies exactly once.
    const ins = await db.query(
      `INSERT INTO message_delivery_events (tenant_id, channel, provider_message_id, provider_event_id, status, occurred_at, dedup_key, metadata)
       VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),$5,$6::timestamptz,$7,$8::jsonb)
       ON CONFLICT (tenant_id, dedup_key) DO NOTHING RETURNING id`,
      [evt.tenantId, evt.channel, evt.providerMessageId, evt.providerEventId, canonical || "unknown", evt.occurredAt, dedupKey, JSON.stringify(evt.metadata)]
    );
    if (!ins.rows[0]) return { ok: true, duplicate: true }; // already processed — one effective transition
    const eventId = ins.rows[0].id;

    if (!canonical) {
      await db.query(`UPDATE message_delivery_events SET matched=FALSE, reason='unknown_status' WHERE id=$1`, [eventId]);
      return { ok: true, unknownStatus: true, eventId };
    }

    // Correlate by provider message id — no fuzzy text/timestamp matching.
    let channelRow = null;
    if (evt.providerMessageId) {
      try {
        const { updateAiSupportMessageDeliveryStatus } = await import("./aiSupportLogService.js");
        channelRow = await updateAiSupportMessageDeliveryStatus({
          tenantId: evt.tenantId,
          providerMessageId: evt.providerMessageId,
          externalMessageId: evt.providerMessageId,
          deliveryStatus: canonical,
          deliveryError: canonical === "failed" ? clip(evt.metadata?.failure_reason || evt.metadata?.error || "", 300) : "",
          errorCode: canonical === "failed" ? clip(evt.metadata?.failure_code || evt.metadata?.error_code || "", 60) : "",
          remoteJid: evt.metadata?.remote_jid || "",
          whatsappInstance: evt.metadata?.instance || "",
          sourcePath: "delivery_reconciliation",
          insertSource: "delivery_reconciliation",
        });
      } catch (e) { console.error("[delivery-reconcile] channel-row update failed", { eventId, err: String(e?.message || e).slice(0, 160) }); }
    }

    const notif = evt.providerMessageId ? await applyToRestockNotification({ tenantId: evt.tenantId, providerMessageId: evt.providerMessageId, canonical, occurredAt: evt.occurredAt, metadata: evt.metadata }) : { matched: false };

    const matched = Boolean(channelRow) || notif.matched;
    await db.query(
      `UPDATE message_delivery_events SET matched=$2, matched_message_id=$3, notification_id=$4, previous_status=$5, new_status=$6, reason=$7 WHERE id=$1`,
      [eventId, matched, channelRow?.id || null, notif.notificationId || null, notif.from || null, notif.changed ? canonical : (notif.to || null), matched ? (notif.changed ? "matched" : "no_change") : "unmatched"]
    );

    // Audit only meaningful transitions (never spam duplicate callbacks — duplicates returned earlier).
    if (notif.matched && notif.changed) {
      await writeAudit({ tenantId: evt.tenantId, userId: null, action: "restock_notification.delivery", entityType: "restock_notification", entityId: notif.notificationId, details: { channel: evt.channel, provider_message_id: evt.providerMessageId, from: notif.from, to: canonical } });
    }
    return { ok: true, matched, canonical, duplicate: false, notification: notif, channelMessageId: channelRow?.id || null, eventId };
  } catch (e) {
    console.error("[delivery-reconcile] failed", { err: String(e?.message || e).slice(0, 200) });
    return { ok: false, error: String(e?.message || e).slice(0, 200) }; // never throw into the webhook
  }
};

// Observability: recent unmatched provider events (bounded, sanitized).
export const listUnmatchedDeliveryEvents = async (tenantId, { limit = 50 } = {}) => {
  await ensureMessageDeliverySchema();
  const r = await db.query(
    `SELECT id, channel, provider_message_id, status, reason, received_at FROM message_delivery_events
      WHERE tenant_id = $1 AND matched = FALSE ORDER BY received_at DESC LIMIT $2`,
    [tenantId, Math.min(Number(limit) || 50, 200)]
  );
  return r.rows;
};

// Delivery analytics for the restock Notifications view (cheap, indexed).
export const getDeliveryCounts = async (tenantId) => {
  await ensureMessageDeliverySchema();
  const r = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status='sent' AND COALESCE(delivery_status,'') IN ('','sent'))::int AS sent,
       COUNT(*) FILTER (WHERE delivery_status='delivered')::int AS delivered,
       COUNT(*) FILTER (WHERE delivery_status='read')::int AS read,
       COUNT(*) FILTER (WHERE delivery_status='failed')::int AS delivery_failed
     FROM restock_notifications WHERE tenant_id = $1`,
    [tenantId]
  );
  return r.rows[0] || { sent: 0, delivered: 0, read: 0, delivery_failed: 0 };
};
