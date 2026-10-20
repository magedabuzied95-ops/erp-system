// Per-number gate on the inbound path (called by ../inboundIntercept.js before the AI).
//
//   status inactive / suspended  → { handled: true }  nothing automated answers that number
//   away auto-reply (outside working hours, Cairo clock)
//                                 → send the away message once per conversation per away window,
//                                   { handled: true } — Genie semantics: the away reply replaces
//                                   the bot while the business is away
//   handled_by_ai = false         → { handled: true, reason: "ai_off_for_number" } humans answer
//   otherwise                     → { handled: false } and the AI answers as before
//
// No settings row = defaults (active, AI on, no auto reply) = { handled: false }: nothing changes
// for a number nobody has configured. Settings are cached 30s; the send is not awaited so a slow
// Graph call can never hold the webhook.
import db from "../../../database/db.js";
import { sendText } from "../../../services/whatsappCloudProvider.js";
import { appendWhatsappOutboundSupportReply } from "../../../services/aiSupportLogService.js";
import { zonedParts } from "../../../utils/appTimezone.js";
import { getRuntimeSettings } from "./accountSettings.service.js";

const CAIRO = "Africa/Cairo";
const text = (value) => String(value ?? "").trim();
const pad2 = (value) => String(value).padStart(2, "0");

const toMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(text(value));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
};

const dayKey = (parts, offsetDays = 0) => {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

/*
 * Is "now" outside the working hours [start, end) on the Cairo clock, and which away window is it?
 * The window key is the Cairo day on which that away stretch began, so an away period that runs
 * from the evening into the next morning is ONE window (one message), not two.
 *   start < end  (09:00–17:00): away = [end, 24:00) ∪ [00:00, start) → before start belongs to yesterday's window
 *   start > end  (20:00–02:00, hours cross midnight): away = [end, start) → today's window
 *   no times / start == end: always away → one message per conversation per day
 */
export const awayWindow = ({ start = "", end = "", now = new Date() } = {}) => {
  const parts = zonedParts(now, CAIRO);
  const minute = parts.hour * 60 + parts.minute;
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin === null || endMin === null || startMin === endMin) return { away: true, key: dayKey(parts) };
  if (startMin < endMin) {
    if (minute >= startMin && minute < endMin) return { away: false, key: "" };
    return { away: true, key: minute < startMin ? dayKey(parts, -1) : dayKey(parts) };
  }
  if (minute >= endMin && minute < startMin) return { away: true, key: dayKey(parts) };
  return { away: false, key: "" };
};

const sendAwayMessage = async ({ tenantId, phoneNumberId, conversationId, phone, body, windowKey }) => {
  try {
    const result = await sendText({ phone, message: body, phoneNumberId });
    await appendWhatsappOutboundSupportReply({
      tenantId,
      sessionId: conversationId,
      message: body,
      senderType: "system",
      source: "wa_official_auto_reply",
      sourcePath: "wa_official_auto_reply",
      insertSource: "wa_official_auto_reply",
      externalMessageId: result?.message_id || "",
      providerMessageId: result?.message_id || "",
      whatsappInstance: `cloud:${phoneNumberId}`,
      resolvedPhone: phone,
      deliveryStatus: "sent",
      preserveExactMessage: true,
      upsertSession: false,
    }).catch(() => null);
  } catch (error) {
    // Not sent: free the window so the next message tries again.
    await db.query(
      `DELETE FROM wa_auto_reply_log WHERE tenant_id = $1 AND phone_number_id = $2 AND conversation_id = $3 AND window_key = $4`,
      [Number(tenantId) || 0, phoneNumberId, conversationId, windowKey]
    ).catch(() => {});
    console.warn("[wa-official:auto-reply] send failed", { phone_number_id: phoneNumberId, message: text(error?.message).slice(0, 200) });
  }
};

export const handleAutoReplyInbound = async ({ tenantId = 0, phoneNumberId = "", message = {}, now = new Date() } = {}) => {
  const settings = await getRuntimeSettings({ tenantId, phoneNumberId });
  if (!settings) return { handled: false };

  const status = text(settings.status) || "active";
  if (status !== "active") return { handled: true, reason: `number_${status}` };

  const body = text(settings.auto_reply_message);
  if (settings.auto_reply_active && body) {
    const window = awayWindow({ start: settings.auto_reply_start, end: settings.auto_reply_end, now });
    const conversationId = text(message?.external_conversation_id || message?.external_customer_id).slice(0, 191);
    const phone = text(message?.external_customer_id);
    if (window.away && conversationId && phone) {
      const claimed = await db.query(
        `INSERT INTO wa_auto_reply_log (tenant_id, phone_number_id, conversation_id, window_key)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING window_key`,
        [Number(tenantId) || 0, text(phoneNumberId), conversationId, window.key]
      );
      if (claimed.rowCount) {
        void sendAwayMessage({ tenantId, phoneNumberId: text(phoneNumberId), conversationId, phone, body, windowKey: window.key });
        return { handled: true, reason: "away_auto_reply_sent" };
      }
      return { handled: true, reason: "away_auto_reply_already_sent" };
    }
  }

  if (settings.handled_by_ai === false) return { handled: true, reason: "ai_off_for_number" };
  return { handled: false };
};
