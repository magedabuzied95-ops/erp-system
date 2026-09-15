import crypto from "node:crypto";

import db from "../../database/db.js";
import { sendEmployeePortalPush } from "../../services/employeePortalPushService.js";

// الرسائل push: a new customer MESSAGE reaches every employee whose messages switch
// is on, through the employee portal's own push channel (the subscription the
// installed portal app already holds — on an iPhone that is the only one that can
// ring). Comments never push here, matching the portal inbox that never shows them.
// Tapping opens the conversation inside the portal.

const text = (value = "") => String(value ?? "").trim();

const idOrNull = (value) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? Math.trunc(next) : null;
};

export const isCommentThreadMessage = ({ sessionId = "", message = {}, channel = "" } = {}) => {
  const session = text(sessionId).toLowerCase();
  if (/(^|:)social_comment:|_post:|comment/.test(session)) return true;
  const kind = [message.thread_kind, message.source_type, message.channel, message.source, channel]
    .map((value) => text(value).toLowerCase())
    .join(" ");
  if (kind.includes("comment")) return true;
  return Boolean(text(message.comment_id || message.external_comment_id || message.post_id));
};

const CHANNEL_LABELS = {
  whatsapp: "واتساب",
  facebook: "ماسنجر",
  facebook_messenger: "ماسنجر",
  messenger: "ماسنجر",
  instagram: "إنستجرام",
  telegram: "تليجرام",
  web_chat: "شات الموقع",
  webchat: "شات الموقع",
};

const previewOf = (message = {}) => {
  const body = text(message.customer_message || message.message_text || message.body || message.text);
  if (body) return body.slice(0, 140);
  const type = text(message.message_type || message.attachment_type || message.media_type).toLowerCase();
  const mime = text(message.attachment_mime || message.mime_type).toLowerCase();
  if (type.includes("image") || mime.startsWith("image/")) return "📷 صورة";
  if (type.includes("voice") || type.includes("audio") || mime.startsWith("audio/")) return "🎤 رسالة صوتية";
  if (type.includes("video") || mime.startsWith("video/")) return "🎬 فيديو";
  if (type.includes("location")) return "📍 موقع";
  if (type) return "📎 مرفق";
  return "رسالة جديدة";
};

// The push `Topic` header only accepts URL-safe base64 (≤32 chars) and our
// conversation ids carry colons, so the tag is a short hash: one per conversation,
// so a burst from one customer collapses into one notification.
export const portalInboxPushTag = (conversationId = "") =>
  `inbox-${crypto.createHash("sha1").update(text(conversationId) || "message").digest("hex").slice(0, 20)}`;

export const buildPortalInboxPush = ({ employee = {}, sessionId = "", message = {}, channel = "" } = {}) => {
  const conversationId = text(sessionId || message.session_id || message.conversation_id);
  const customerName = text(message.customer_name || message.sender_name || message.contact_name) || "عميل";
  const label = CHANNEL_LABELS[text(channel || message.channel || message.source).toLowerCase()] || "";
  const token = encodeURIComponent(text(employee.employee_portal_token));
  return {
    title: label ? `${customerName} · ${label}` : customerName,
    body: previewOf(message),
    // The installed app lives under /employee-app; the push service rewrites
    // /employee-portal/ to it anyway.
    url: `/employee-app/${token}/inbox${conversationId ? `/${encodeURIComponent(conversationId)}` : ""}`,
    tag: portalInboxPushTag(conversationId),
    data: { event: "ai_inbox_message", conversation_id: conversationId, channel: text(channel) },
  };
};

const loadEnabledEmployees = async ({ tenantId, client = db }) => {
  const columns = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'employees' AND column_name = 'portal_inbox_enabled' LIMIT 1"
  );
  if (!columns.rows.length) return [];
  const result = await client.query(
    `SELECT id, tenant_id, employee_portal_token
     FROM employees
     WHERE tenant_id = $1::bigint
       AND portal_inbox_enabled = TRUE
       AND COALESCE(is_deleted, FALSE) = FALSE
       AND LOWER(COALESCE(status, 'active')) = 'active'
       AND COALESCE(employee_portal_token, '') <> ''`,
    [tenantId]
  );
  return result.rows;
};

// Every inbound message lands here, and most shops switch nobody on, so the
// recipient list is cached briefly per tenant. The admin toggle clears it.
const recipientsCache = new Map();
const RECIPIENTS_TTL_MS = 60 * 1000;

export const invalidatePortalInboxPushRecipients = () => recipientsCache.clear();

const cachedEnabledEmployees = async ({ tenantId, client }) => {
  const cached = recipientsCache.get(tenantId);
  if (cached && Date.now() - cached.at < RECIPIENTS_TTL_MS) return cached.rows;
  const rows = await loadEnabledEmployees({ tenantId, client });
  recipientsCache.set(tenantId, { rows, at: Date.now() });
  return rows;
};

export const notifyPortalInboxEmployees = async ({
  tenantId = null,
  sessionId = "",
  message = {},
  channel = "",
  client = db,
  send = sendEmployeePortalPush,
} = {}) => {
  const tenant = idOrNull(tenantId);
  if (!tenant) return { sent: 0, skipped: true, reason: "no-tenant" };
  if (isCommentThreadMessage({ sessionId, message, channel })) return { sent: 0, skipped: true, reason: "comment" };
  const employees = await cachedEnabledEmployees({ tenantId: tenant, client });
  if (!employees.length) return { sent: 0, skipped: true, reason: "nobody-enabled" };
  let sent = 0;
  for (const employee of employees) {
    const push = buildPortalInboxPush({ employee, sessionId, message, channel });
    const result = await send({
      tenantId: tenant,
      employeeId: Number(employee.id),
      ...push,
      // A chat message is not a portal notice: it must not fill the bell list.
      persist: false,
    }).catch((error) => {
      console.warn("[portal-inbox-push] send failed", { employeeId: employee.id, message: error?.message || String(error) });
      return { sent: 0 };
    });
    sent += Number(result?.sent || 0);
  }
  return { sent, recipients: employees.length, skipped: false };
};

