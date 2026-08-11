// AI Studio Phase 8 — Human-Approved Customer Restock Messaging.
// ---------------------------------------------------------------------------
// SECURITY-CRITICAL. Turns an EXACT restock intent + real restock into a grounded message DRAFT that
// a human must review and explicitly Approve & Send. There is NO autonomous customer messaging.
//
// Guarantees enforced here:
//  - Draft/create/edit/reject have ZERO external side effects (no provider call).
//  - Only EXACT-variant, active, explicit restock_intents may be messaged. Legacy wishlist, product-
//    only, cancelled/fulfilled/expired intents are excluded from the send path.
//  - customer_notified_at is set ONLY after a confirmed successful send.
//  - Send is idempotent (atomic status transition) — double Approve&Send = one message.
//  - Mode gate: off (no drafts) / preview_only (drafts+approval, sending DISABLED) / approval_send.
//  - The real provider send is injectable (deps.sender) so tests never contact a provider.
// Reuses the audited canonical WhatsApp sender + conversation persistence (lazy-imported at send time).

import db from "../database/db.js";
import { normalizePhone } from "../utils/phoneSearch.js";
import { getInventoryFacts } from "./aiBusinessToolsService.js";
import { getIntent, markIntentNotified } from "./restockIntentService.js";
import { writeAudit } from "./aiWorkflowService.js";

export const MESSAGING_MODES = Object.freeze(["off", "preview_only", "approval_send"]);
export const NOTIF_STATUSES = Object.freeze(["draft", "pending_approval", "approved", "sending", "sent", "rejected", "failed", "cancelled"]);
export const NOTIF_DEFAULT_LIMIT = 25;
export const NOTIF_MAX_LIMIT = 100;
// Only these intent states may ever be messaged (explicit + still waiting for the item).
export const SENDABLE_INTENT_STATUSES = Object.freeze(["waiting", "recovery_created"]);

let schemaReady = null;
export const ensureRestockNotificationSchema = async (client = db) => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    // Per-tenant kill switch / mode (off by default). Lives with the other automation settings.
    await client.query(`ALTER TABLE ai_workflow_tenant_settings ADD COLUMN IF NOT EXISTS restock_messaging_mode TEXT NOT NULL DEFAULT 'off'`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS restock_notifications (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        restock_intent_id BIGINT NOT NULL,
        recovery_id BIGINT NULL,
        restock_event_id TEXT NOT NULL,
        customer_id BIGINT NULL,
        phone TEXT NULL,
        product_id BIGINT NULL,
        variant_id BIGINT NULL,
        channel TEXT NULL,
        conversation_id TEXT NULL,
        recipient_reference TEXT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        facts JSONB NOT NULL DEFAULT '{}'::jsonb,
        draft_text TEXT NULL,
        approved_text TEXT NULL,
        provider_message_id TEXT NULL,
        idempotency_key TEXT NOT NULL,
        drafted_at TIMESTAMP NULL,
        approved_at TIMESTAMP NULL,
        approved_by BIGINT NULL,
        rejected_at TIMESTAMP NULL,
        rejected_by BIGINT NULL,
        rejection_reason TEXT NULL,
        sent_at TIMESTAMP NULL,
        failed_at TIMESTAMP NULL,
        failure_reason TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // One notification per (intent, restock event) — replay never creates a second.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_restock_notifications_intent_event ON restock_notifications (tenant_id, restock_intent_id, restock_event_id)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_restock_notifications_idem ON restock_notifications (idempotency_key)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_restock_notifications_tenant ON restock_notifications (tenant_id, status, created_at DESC)`);
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
};

// ---- Mode (kill switch) ----
export const getMessagingMode = async (tenantId) => {
  await ensureRestockNotificationSchema();
  const r = await db.query(`SELECT restock_messaging_mode FROM ai_workflow_tenant_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  const m = r.rows[0]?.restock_messaging_mode;
  return MESSAGING_MODES.includes(m) ? m : "off";
};
export const setMessagingMode = async (tenantId, mode, userId) => {
  await ensureRestockNotificationSchema();
  if (!MESSAGING_MODES.includes(mode)) { const e = new Error(`Invalid messaging mode: ${mode}`); e.status = 400; throw e; }
  await db.query(
    `INSERT INTO ai_workflow_tenant_settings (tenant_id, restock_messaging_mode, updated_by, updated_at)
     VALUES ($1,$2,$3,NOW()) ON CONFLICT (tenant_id) DO UPDATE SET restock_messaging_mode = EXCLUDED.restock_messaging_mode, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [tenantId, mode, userId || null]
  );
  await writeAudit({ tenantId, userId, action: "restock_messaging.mode", entityType: "tenant", entityId: tenantId, details: { mode } });
  return mode;
};

// ---- Pure: grounded draft (deterministic Arabic fallback; invents nothing) ----
// facts must be verified upstream. Optional LLM rewrite happens elsewhere and may NOT alter facts.
export const buildDeterministicDraft = (facts = {}) => {
  const name = (facts.customerName || "").toString().trim();
  const greeting = name ? `أهلاً ${name} 👋` : "أهلاً 👋";
  const item = [facts.productName, facts.color, facts.size ? `مقاس ${facts.size}` : ""].filter(Boolean).join(" ");
  const back = item ? `${item} اللي كنت مستنيه رجع متوفر.` : "المنتج اللي كنت مستنيه رجع متوفر.";
  return `${greeting}\n${back}\nلو حابب تكمل الطلب ابعتلنا تأكيد.`;
};

// Verified facts snapshot for an intent + current stock (no invented fields).
const buildFacts = async ({ tenantId, intent }) => {
  const prod = await db.query(`SELECT name FROM products WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [intent.product_id, tenantId]);
  let available = null, size = intent.size, color = intent.color, productName = prod.rows[0]?.name || null;
  try {
    const f = await getInventoryFacts({ tenantId, productId: intent.product_id, variantId: intent.variant_id || null, query: "" });
    const rows = Array.isArray(f?.variant_stock) ? f.variant_stock : [];
    const m = intent.variant_id ? rows.find((r) => String(r.variant_id) === String(intent.variant_id)) : null;
    available = m ? Number(m.stock || 0) : rows.reduce((a, r) => a + Number(r.stock || 0), 0);
    size = m?.size ?? size; color = m?.color ?? color; productName = f?.product_name || productName;
  } catch { /* facts stay from the intent snapshot */ }
  let customerName = null;
  if (intent.customer_id) { const c = await db.query(`SELECT name FROM customers WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [intent.customer_id, tenantId]); customerName = c.rows[0]?.name || null; }
  return { customerName, productName, size, color, available, requestedAt: intent.created_at };
};

// ---- Eligibility: resolve a SAFE sendable channel from EXISTING identity (never guess IG/Messenger) ----
export const resolveRestockNotificationChannel = async ({ tenantId, customerId = null, phone = null } = {}) => {
  const normPhone = phone ? normalizePhone(String(phone)) : null;
  // Prefer an existing conversation (gives a conversation id + a proven channel identity).
  try {
    const conv = await db.query(
      `SELECT id, channel, external_conversation_id, external_customer_id FROM ai_channel_conversations
        WHERE tenant_id = $1 AND ( ($2::text <> '' AND external_customer_id = $2)
              OR ($3::bigint IS NOT NULL AND customer_profile_id IN (SELECT id FROM ai_customer_profiles WHERE tenant_id = $1 AND (id = $3 OR phone = $2))) )
        ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, normPhone || "", customerId || null]
    );
    const c = conv.rows[0];
    if (c && c.channel === "whatsapp" && c.external_customer_id) {
      return { available: true, channel: "whatsapp", conversationId: c.id, externalConversationId: c.external_conversation_id, recipientId: c.external_customer_id };
    }
    // IG/Messenger sending requires the stored PSID/IGSID; supported only via an existing conversation.
    if (c && (c.channel === "instagram" || c.channel === "facebook_messenger") && c.external_customer_id) {
      return { available: true, channel: c.channel, conversationId: c.id, externalConversationId: c.external_conversation_id, recipientId: c.external_customer_id };
    }
  } catch { /* fall through to WhatsApp-by-phone */ }
  // WhatsApp by phone — the only channel derivable directly from a restock intent (audited).
  if (normPhone) return { available: true, channel: "whatsapp", conversationId: null, externalConversationId: `whatsapp:${normPhone}`, recipientId: normPhone };
  return { available: false, reason: "NO_SENDABLE_CHANNEL" };
};

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// ---- Create a DRAFT notification (NO side effects). Explicit exact-variant intent only. ----
export const createDraftNotification = async ({ tenantId, intentId, restockEventId, recoveryId = null } = {}) => {
  await ensureRestockNotificationSchema();
  const intent = await getIntent(tenantId, intentId);
  if (!intent) return { ok: false, reason: "intent_not_found" };
  // Explicit-intent-only + exact variant + still active. Legacy wishlist never reaches here (it has no intent row).
  if (String(intent.source) === "legacy_wishlist") return { ok: false, reason: "legacy_excluded" };
  if (!intent.variant_id) return { ok: false, reason: "not_exact_variant" };
  if (!SENDABLE_INTENT_STATUSES.includes(intent.status)) return { ok: false, reason: `intent_${intent.status}` };
  if (intent.customer_notified_at) return { ok: false, reason: "already_notified" };

  const channel = await resolveRestockNotificationChannel({ tenantId, customerId: intent.customer_id, phone: intent.phone });
  if (!channel.available) return { ok: false, reason: channel.reason || "no_channel" };

  const facts = await buildFacts({ tenantId, intent });
  const draft = buildDeterministicDraft(facts);
  const eventKey = String(restockEventId || `inv:${tenantId}:${intent.product_id}:${intent.variant_id}`);
  const idem = `notif:${tenantId}:${intentId}:${eventKey}`;
  try {
    const r = await db.query(
      `INSERT INTO restock_notifications
         (tenant_id, restock_intent_id, recovery_id, restock_event_id, customer_id, phone, product_id, variant_id, channel, conversation_id, recipient_reference, status, facts, draft_text, idempotency_key, drafted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending_approval',$12,$13,$14,NOW())
       ON CONFLICT (tenant_id, restock_intent_id, restock_event_id) DO NOTHING RETURNING *`,
      [tenantId, intentId, num(recoveryId), eventKey, num(intent.customer_id), intent.phone, num(intent.product_id), num(intent.variant_id),
       channel.channel, channel.conversationId != null ? String(channel.conversationId) : null, channel.recipientId, JSON.stringify(facts), draft, idem]
    );
    if (!r.rows[0]) { // dedup: existing notification for this intent+event
      const existing = await db.query(`SELECT * FROM restock_notifications WHERE tenant_id=$1 AND restock_intent_id=$2 AND restock_event_id=$3 LIMIT 1`, [tenantId, intentId, eventKey]);
      return { ok: true, duplicate: true, notification: existing.rows[0] };
    }
    await writeAudit({ tenantId, userId: null, action: "restock_notification.drafted", entityType: "restock_notification", entityId: r.rows[0].id, details: { intent_id: intentId, event_id: eventKey, channel: channel.channel } });
    return { ok: true, created: true, notification: r.rows[0] };
  } catch (e) {
    if (String(e?.code) === "23505") {
      const existing = await db.query(`SELECT * FROM restock_notifications WHERE tenant_id=$1 AND restock_intent_id=$2 AND restock_event_id=$3 LIMIT 1`, [tenantId, intentId, eventKey]);
      if (existing.rows[0]) return { ok: true, duplicate: true, notification: existing.rows[0] };
    }
    throw e;
  }
};

// ---- Edit the draft (persists approved_text; original draft_text is never overwritten) ----
export const editNotificationDraft = async (tenantId, id, text, userId) => {
  await ensureRestockNotificationSchema();
  const r = await db.query(
    `UPDATE restock_notifications SET approved_text = $3, updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND status IN ('draft','pending_approval') RETURNING *`,
    [tenantId, id, String(text || "").slice(0, 4000)]
  );
  if (r.rows[0]) await writeAudit({ tenantId, userId, action: "restock_notification.edited", entityType: "restock_notification", entityId: id, details: {} });
  return r.rows[0] || null;
};

export const rejectNotification = async (tenantId, id, { userId, reason = "" } = {}) => {
  await ensureRestockNotificationSchema();
  const r = await db.query(
    `UPDATE restock_notifications SET status = 'rejected', rejected_at = NOW(), rejected_by = $3, rejection_reason = $4, updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND status IN ('draft','pending_approval') RETURNING *`,
    [tenantId, id, num(userId), String(reason || "").slice(0, 500)]
  );
  if (r.rows[0]) await writeAudit({ tenantId, userId, action: "restock_notification.rejected", entityType: "restock_notification", entityId: id, details: { reason } });
  return r.rows[0] || null; // customer_notified_at is never touched
};

// ---- Approved send adapter (SENSITIVE). Idempotent. Real provider send injectable for tests. ----
// Default deps.sender is the audited canonical WhatsApp sender, lazy-imported only when actually sending.
const defaultSender = async ({ channel, recipientId, text, tenantId, conversationId }) => {
  if (channel === "whatsapp") {
    const { sendTextMessage } = await import("./whatsappGatewayService.js");
    const res = await sendTextMessage({ phone: recipientId, message: text });
    const providerId = res?.result?.key?.id || res?.message_id || res?.key?.id || null;
    return { ok: Boolean(res?.success ?? res?.sent ?? providerId), providerMessageId: providerId, raw: { delivery_status: res?.delivery_status } };
  }
  if (channel === "instagram" || channel === "facebook_messenger") {
    const { sendMetaInboxOutboundMessage } = await import("./metaIntegrationService.js");
    const res = await sendMetaInboxOutboundMessage({ tenantId, channel, recipientId, messageText: text, conversationId });
    return { ok: Boolean(res?.sent ?? res?.message_id), providerMessageId: res?.message_id || null, raw: { delivery_status: res?.delivery_status } };
  }
  return { ok: false, providerMessageId: null, error: "unsupported_channel" };
};

// Persist the sent message into the canonical conversation (best-effort; never fails the send record).
const persistOutbound = async ({ tenantId, notif, text, providerMessageId }) => {
  try {
    if (!notif.conversation_id) return; // no existing conversation to append to; audited limitation
    const { appendChannelOutboundSupportReply } = await import("./aiSupportLogService.js");
    await appendChannelOutboundSupportReply({ tenantId, conversationId: notif.conversation_id, channel: notif.channel, messageText: text, providerMessageId, externalMessageId: providerMessageId, source: "restock_notification" });
  } catch { /* persistence is best-effort; the notification record + provider id remain authoritative */ }
};

export const sendApprovedRestockNotification = async ({ tenantId, notificationId, approvedBy, req = null, deps = {} } = {}) => {
  await ensureRestockNotificationSchema();
  const sender = deps.sender || defaultSender;

  // Mode gate: sending only in approval_send. preview_only/off never dispatch.
  const mode = await getMessagingMode(tenantId);
  if (mode !== "approval_send") { const e = new Error("Sending is disabled (messaging mode is not approval_send)."); e.status = 409; e.code = "MODE_BLOCKED"; throw e; }

  const cur = await db.query(`SELECT * FROM restock_notifications WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, notificationId]);
  const notif = cur.rows[0];
  if (!notif) { const e = new Error("Notification not found"); e.status = 404; throw e; }
  if (notif.status === "sent") return { ok: true, alreadySent: true, notification: notif }; // idempotent

  // Re-validate the intent at send time (approval never bypasses server validation).
  const intent = await getIntent(tenantId, notif.restock_intent_id);
  if (!intent || !intent.variant_id || String(intent.source) === "legacy_wishlist" || !SENDABLE_INTENT_STATUSES.includes(intent.status)) {
    await db.query(`UPDATE restock_notifications SET status='failed', failed_at=NOW(), failure_reason='intent_no_longer_sendable', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [notificationId, tenantId]);
    const e = new Error("Restock intent is no longer sendable."); e.status = 409; throw e;
  }
  if (intent.customer_notified_at) { const e = new Error("Customer already notified."); e.status = 409; throw e; }

  // Atomic claim: pending_approval/approved -> sending. Loser of a double-click gets no row -> no second send.
  const claim = await db.query(
    `UPDATE restock_notifications SET status='sending', approved_at=NOW(), approved_by=$3, updated_at=NOW()
      WHERE tenant_id=$1 AND id=$2 AND status IN ('draft','pending_approval','approved') RETURNING *`,
    [tenantId, notificationId, num(approvedBy)]
  );
  if (!claim.rows[0]) return { ok: true, alreadyClaimed: true }; // concurrent send in progress
  const text = String(notif.approved_text || notif.draft_text || "").trim();
  await writeAudit({ tenantId, userId: approvedBy, action: "restock_notification.approved", entityType: "restock_notification", entityId: notificationId, details: { channel: notif.channel } });

  let result;
  try {
    result = await sender({ channel: notif.channel, recipientId: notif.recipient_reference, text, tenantId, conversationId: notif.conversation_id });
  } catch (e) {
    await db.query(`UPDATE restock_notifications SET status='failed', failed_at=NOW(), failure_reason=$3, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [notificationId, tenantId, String(e?.message || e).slice(0, 300)]);
    await writeAudit({ tenantId, userId: approvedBy, action: "restock_notification.send_failed", entityType: "restock_notification", entityId: notificationId, details: { error: String(e?.message || e).slice(0, 200) } });
    return { ok: false, failed: true, reason: String(e?.message || e) }; // customer_notified_at stays NULL
  }

  if (!result?.ok) {
    await db.query(`UPDATE restock_notifications SET status='failed', failed_at=NOW(), failure_reason=$3, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [notificationId, tenantId, String(result?.error || result?.raw?.delivery_status || "send_failed").slice(0, 300)]);
    await writeAudit({ tenantId, userId: approvedBy, action: "restock_notification.send_failed", entityType: "restock_notification", entityId: notificationId, details: { delivery: result?.raw?.delivery_status } });
    return { ok: false, failed: true, reason: result?.error || "send_failed" };
  }

  // Confirmed send.
  await db.query(`UPDATE restock_notifications SET status='sent', sent_at=NOW(), provider_message_id=$3, approved_text=$4, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [notificationId, tenantId, result.providerMessageId || null, text]);
  await markIntentNotified(tenantId, notif.restock_intent_id, { channel: notif.channel }); // <-- ONLY here
  await persistOutbound({ tenantId, notif, text, providerMessageId: result.providerMessageId });
  await writeAudit({ tenantId, userId: approvedBy, action: "restock_notification.sent", entityType: "restock_notification", entityId: notificationId, details: { channel: notif.channel, provider_message_id: result.providerMessageId, intent_id: notif.restock_intent_id } });
  const fresh = await db.query(`SELECT * FROM restock_notifications WHERE id=$1 AND tenant_id=$2`, [notificationId, tenantId]);
  return { ok: true, sent: true, providerMessageId: result.providerMessageId, notification: fresh.rows[0] };
};

// ---- Read APIs ----
export const listNotifications = async (tenantId, { status = null, limit = 100 } = {}) => {
  await ensureRestockNotificationSchema();
  const params = [tenantId]; let where = `n.tenant_id = $1`;
  if (status && status !== "all") { params.push(status); where += ` AND n.status = $${params.length}`; }
  params.push(Math.min(Number(limit) || 100, 300));
  const r = await db.query(
    `SELECT n.*, p.name AS product_name, c.name AS customer_name
       FROM restock_notifications n
       LEFT JOIN products p ON p.id = n.product_id AND p.tenant_id = n.tenant_id
       LEFT JOIN customers c ON c.id = n.customer_id AND c.tenant_id = n.tenant_id
      WHERE ${where} ORDER BY n.created_at DESC LIMIT $${params.length}`, params);
  // Mask the recipient reference (phone/PSID) in list responses.
  return r.rows.map((row) => ({ ...row, recipient_reference: row.recipient_reference ? `${String(row.recipient_reference).slice(0, 2)}***${String(row.recipient_reference).slice(-2)}` : null }));
};

export const getNotification = async (tenantId, id) => {
  await ensureRestockNotificationSchema();
  const r = await db.query(`SELECT * FROM restock_notifications WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return r.rows[0] || null;
};

export const getNotificationCounts = async (tenantId) => {
  await ensureRestockNotificationSchema();
  const r = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status='pending_approval')::int AS pending_approval,
       COUNT(*) FILTER (WHERE status='sent')::int AS sent,
       COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
       COUNT(*) FILTER (WHERE status='failed')::int AS failed
     FROM restock_notifications WHERE tenant_id = $1`, [tenantId]);
  return r.rows[0] || { pending_approval: 0, sent: 0, rejected: 0, failed: 0 };
};
