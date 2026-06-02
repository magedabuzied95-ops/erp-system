import crypto from "crypto";

import db from "../database/db.js";
import { buildWhatsappTextDebug } from "../utils/whatsapp.js";
import { ensureAiSupportLogSchema } from "./aiSupportLogService.js";
import {
  AI_AGENT_CHANNELS,
  logChannelEvent,
  upsertChannelConversationMapping,
} from "./aiChannelAdapterService.js";
import { generateWhatsappAiAutoReply, logWhatsappAiOutbound } from "./aiInboxService.js";
import { appendAiGeneratedSupportReply } from "./aiSupportLogService.js";
import { emitToRooms } from "../utils/socket.js";

const provider = () => String(process.env.WHATSAPP_GATEWAY_PROVIDER || "evolution").trim().toLowerCase();
const apiUrl = () => String(process.env.EVOLUTION_API_URL || "").trim().replace(/\/+$/g, "");
const apiKey = () => String(process.env.EVOLUTION_API_KEY || "").trim();
const instanceName = () => String(process.env.EVOLUTION_INSTANCE_NAME || "m1-store").trim();
const webhookSecret = () => String(process.env.WHATSAPP_WEBHOOK_SECRET || "").trim();

const text = (value, fallback = "") => String(value ?? fallback).trim();
const money = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
};

const config = () => ({
  provider: provider(),
  apiUrl: apiUrl(),
  apiKeyConfigured: Boolean(apiKey()),
  instanceName: instanceName(),
  webhookSecretConfigured: Boolean(webhookSecret()),
});

const gatewayError = (message, code = "WHATSAPP_GATEWAY_ERROR", status = 500, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });

const requireEvolutionConfig = () => {
  const current = config();
  if (current.provider !== "evolution") throw gatewayError("Unsupported WhatsApp gateway provider", "WHATSAPP_PROVIDER_UNSUPPORTED", 409);
  if (!current.apiUrl) throw gatewayError("EVOLUTION_API_URL is not configured", "EVOLUTION_API_URL_MISSING", 409);
  if (!apiKey()) throw gatewayError("EVOLUTION_API_KEY is not configured", "EVOLUTION_API_KEY_MISSING", 409);
  if (!current.instanceName) throw gatewayError("EVOLUTION_INSTANCE_NAME is not configured", "EVOLUTION_INSTANCE_MISSING", 409);
  return current;
};

const evolutionFetch = async (path, options = {}) => {
  const current = requireEvolutionConfig();
  const url = `${current.apiUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: apiKey(),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    throw gatewayError(data?.message || data?.error || `Evolution API returned ${response.status}`, "EVOLUTION_API_ERROR", response.status, { data });
  }
  return data;
};

export const normalizeEgyptPhone = (phone = "") => {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `20${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) return `20${digits}`;
  return digits;
};

export const getStatus = async () => {
  const current = config();
  if (current.provider !== "evolution" || !current.apiUrl || !current.apiKeyConfigured || !current.instanceName) {
    console.info("[whatsapp:status]", { ...current, connected: false, configured: false });
    return { ...current, configured: false, connected: false, state: "not_configured" };
  }
  const data = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(current.instanceName)}`, { method: "GET" });
  const state = text(data?.instance?.state || data?.state || data?.status || data?.connectionState || "");
  const connected = ["open", "connected", "online"].includes(state.toLowerCase());
  console.info("[whatsapp:status]", { provider: current.provider, instanceName: current.instanceName, connected, state });
  return { ...current, configured: true, connected, state: state || "unknown", raw: data };
};

export const sendTextMessage = async ({ phone, message } = {}) => {
  const normalizedPhone = normalizeEgyptPhone(phone);
  const body = String(message ?? "");
  if (!normalizedPhone) throw gatewayError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!body.trim()) throw gatewayError("Message body is required", "WHATSAPP_MESSAGE_REQUIRED", 400);
  const current = requireEvolutionConfig();
  const requestBody = JSON.stringify({ number: normalizedPhone, text: body });
  const messageDebug = buildWhatsappTextDebug(body, 300);
  const jsonDebug = buildWhatsappTextDebug(requestBody, 500);
  console.info("[whatsapp:evolution-payload-preview]", {
    instanceName: current.instanceName,
    phoneSuffix: normalizedPhone.slice(-4),
    hasEmojis: messageDebug.hasEmojis,
    codePoints: messageDebug.codePoints,
    textFirst300Chars: messageDebug.firstChars,
    jsonHasEmojis: jsonDebug.hasEmojis,
    jsonBodyFirst500Chars: jsonDebug.firstChars,
  });
  if (messageDebug.hasEmojis && !jsonDebug.hasEmojis) {
    console.warn("[whatsapp:evolution-payload-emoji-serialization-warning]", {
      instanceName: current.instanceName,
      phoneSuffix: normalizedPhone.slice(-4),
    });
  }
  const data = await evolutionFetch(`/message/sendText/${encodeURIComponent(current.instanceName)}`, {
    method: "POST",
    body: requestBody,
  });
  return { success: true, provider: current.provider, instanceName: current.instanceName, phone: normalizedPhone, result: data };
};

export const buildOrderConfirmationMessage = (order = {}) => {
  const customerName = text(order.customer_name || order.customerName || order.name, "عميلنا");
  const orderNumber = text(order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || order.id, "-");
  const totalAmount = money(order.total_amount ?? order.grand_total ?? order.total ?? order.net_total);
  return `أهلاً يا ${customerName} 
طلبك من M1 Store جاهز للتأكيد.

رقم الطلب: ${orderNumber}
الإجمالي: ${totalAmount} جنيه

للتاكيد رد بـ 1
للإلغاء رد بـ 2`;
};

export const sendOrderConfirmationMessage = async ({ order } = {}) => {
  if (!order) throw gatewayError("Order is required", "WHATSAPP_ORDER_REQUIRED", 400);
  const phone = order.customer_phone || order.phone || order.whatsapp || order.mobile;
  const message = buildOrderConfirmationMessage(order);
  return sendTextMessage({ phone, message });
};

export const loadOrderForWhatsapp = async ({ orderId, tenantId = null } = {}) => {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) throw gatewayError("Invalid order id", "WHATSAPP_ORDER_ID_INVALID", 400);
  const columnsResult = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'`
  );
  const columns = new Set(columnsResult.rows.map((row) => row.column_name));
  const col = (name, fallback = "NULL") => columns.has(name) ? `o.${name}` : `${fallback} AS ${name}`;
  const clauses = ["o.id = $1"];
  const params = [id];
  if (tenantId && columns.has("tenant_id")) {
    params.push(tenantId);
    clauses.push(`(o.tenant_id = $${params.length} OR o.tenant_id IS NULL)`);
  }
  const result = await db.query(
    `SELECT
       o.id,
       ${col("tenant_id")},
       ${col("invoice_number")},
       ${col("public_order_number")},
       ${col("display_order_number")},
       ${col("order_number")},
       ${col("customer_name", "''")},
       ${col("customer_phone", "''")},
       ${col("total_amount", "0")},
       ${col("grand_total", "0")},
       ${col("total", "0")},
       ${col("created_at", "NULL")}
     FROM orders o
     WHERE ${clauses.join(" AND ")}
     LIMIT 1`,
    params
  );
  const order = result.rows[0] || null;
  if (!order) throw gatewayError("Order not found", "WHATSAPP_ORDER_NOT_FOUND", 404);
  return order;
};

const headerValue = (req, names = []) => {
  for (const name of names) {
    const value = req.get?.(name) || req.headers?.[String(name).toLowerCase()];
    if (value) return String(value);
  }
  return "";
};

export const verifyWebhookSecret = (req) => {
  const secret = webhookSecret();
  if (!secret) return true;
  const provided =
    headerValue(req, ["x-whatsapp-webhook-secret", "x-webhook-secret", "x-evolution-secret"]) ||
    text(req.query?.secret || req.body?.secret);
  return provided === secret;
};

const findFirstString = (value, keys = []) => {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    const found = value[key];
    if (typeof found === "string" || typeof found === "number") return text(found);
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findFirstString(child, keys);
      if (found) return found;
    }
  }
  return "";
};

const errorSummary = (error = {}) => ({
  message: error?.message || String(error),
  causeMessage: error?.cause?.message || "",
  code: error?.code || "",
  status: error?.status || "",
});

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const json = (value) => JSON.stringify(value === undefined ? null : value);

const boolValue = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = text(value).toLowerCase();
  return ["true", "1", "yes"].includes(normalized);
};

const tenantIdForWhatsapp = (payload = {}) => number(payload?.tenant_id || payload?.tenantId || process.env.WHATSAPP_TENANT_ID || 1, 1);

const parseWhatsappTimestamp = (value) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const millis = numeric < 100000000000 ? numeric * 1000 : numeric;
    return new Date(millis).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
};

const extractMessageText = (data = {}) => {
  const message = data?.message || data?.messages?.[0]?.message || {};
  return text(
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.buttonsResponseMessage?.selectedButtonId ||
    message?.listResponseMessage?.title ||
    message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    data?.text ||
    data?.body ||
    data?.messageText ||
    data?.caption ||
    findFirstString(data, ["conversation", "text", "body", "messageText", "caption"])
  );
};

const extractIncomingWhatsapp = (payload = {}) => {
  const data = payload?.data || payload?.body?.data || payload;
  const key = data?.key || payload?.key || {};
  const remoteJid = text(
    key?.remoteJid ||
    data?.remoteJid ||
    data?.remote_jid ||
    data?.from ||
    data?.sender ||
    data?.participant ||
    data?.number ||
    findFirstString(data, ["remoteJid", "remote_jid", "from", "sender", "participant", "number", "phone"]) ||
    findFirstString(payload, ["remoteJid", "remote_jid", "from", "sender", "number", "phone"])
  );
  const phone = normalizeEgyptPhone(remoteJid.split("@")[0]);
  const messageId = text(
    key?.id ||
    data?.messageId ||
    data?.message_id ||
    data?.id ||
    data?.messages?.[0]?.id ||
    findFirstString(data, ["messageId", "message_id", "message_id", "id", "mid"])
  );
  const timestamp = parseWhatsappTimestamp(
    data?.messageTimestamp ||
    data?.timestamp ||
    data?.date_time ||
    payload?.date_time ||
    payload?.timestamp
  );
  const instance = text(payload?.instance || payload?.instanceName || data?.instance || data?.instanceName || instanceName());
  const senderName = text(
    data?.pushName ||
    data?.pushname ||
    data?.profileName ||
    data?.profile_name ||
    data?.senderName ||
    data?.sender_name ||
    payload?.pushName ||
    payload?.profileName ||
    findFirstString(data, ["pushName", "pushname", "profileName", "profile_name", "senderName", "sender_name"])
  );
  return {
    event: text(payload?.event || payload?.type || data?.event || ""),
    phone,
    remoteJid,
    text: extractMessageText(data),
    senderName,
    messageId,
    timestamp,
    instance,
    fromMe: boolValue(key?.fromMe ?? data?.fromMe ?? data?.from_me ?? payload?.fromMe),
    raw: payload,
  };
};

const dedupeHash = (value = "") => crypto.createHash("sha256").update(text(value)).digest("hex");

const saveWhatsappIncomingToAiInbox = async (message = {}) => {
  const tenantId = tenantIdForWhatsapp(message.raw || {});
  const sessionId = `whatsapp:${message.phone}`;
  const customerName = text(message.senderName);
  const body = text(message.text);
  const receivedAt = message.timestamp || new Date().toISOString();
  const externalMessageId = text(message.messageId);
  const dedupeKey = dedupeHash([tenantId, sessionId, externalMessageId || message.remoteJid, receivedAt, body].join("|"));

  await ensureAiSupportLogSchema();
  await upsertChannelConversationMapping({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    externalConversationId: sessionId,
    externalCustomerId: message.phone,
    customerName,
    metadata: {
      phone: message.phone,
      remote_jid: message.remoteJid,
      instance: message.instance,
      source: "evolution_api",
      last_message: body,
      external_message_id: externalMessageId,
      dedupe_key: dedupeKey,
    },
    lastMessageAt: receivedAt,
  });

  const session = await db.query(
    `
    INSERT INTO ai_support_sessions (tenant_id, session_id, source, channel, customer_name, last_message, updated_at)
    VALUES ($1, $2, 'whatsapp', 'whatsapp', $3::text, $4::text, NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      source = 'whatsapp',
      channel = 'whatsapp',
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name),
      last_message = EXCLUDED.last_message,
      updated_at = NOW()
    RETURNING id
    `,
    [tenantId, sessionId, customerName, body]
  );

  const inserted = await db.query(
    `
    INSERT INTO ai_support_messages (
      session_ref_id, tenant_id, session_id, channel, customer_name, last_message, message_text,
      customer_message, ai_answer, confidence, needs_human_support, sources_used, suggested_products,
      visual_attachments, suggested_actions, detected_intent, fallback_reason, sender_type, external_message_id, dedupe_key
    )
    VALUES ($1, $2, $3::text, 'whatsapp', $4::text, $5::text, $5::text, $5::text, '', 0, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '', 'ai_status:pending', 'customer', $6::text, $7::text)
    ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
    RETURNING *
    `,
    [session.rows[0]?.id || null, tenantId, sessionId, customerName, body, externalMessageId, dedupeKey]
  );

  if (!inserted.rows[0]) {
    console.info("[whatsapp:inbox-skipped]", {
      reason: "duplicate",
      tenantId,
      session_id: sessionId,
      message_id: externalMessageId,
      dedupe_key: dedupeKey,
    });
    return { saved: false, duplicate: true, session_id: sessionId, dedupe_key: dedupeKey };
  }

  await logChannelEvent({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    direction: "inbound",
    externalCustomerId: message.phone,
    conversationId: sessionId,
    messagePreview: body,
    status: "saved_to_ai_inbox",
    metadata: {
      source: "evolution_api",
      instance: message.instance,
      remote_jid: message.remoteJid,
      external_message_id: externalMessageId,
      dedupe_key: dedupeKey,
    },
  }).catch(() => {});

  emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", {
    tenant_id: tenantId,
    session_id: sessionId,
    message: inserted.rows[0] || null,
    at: new Date().toISOString(),
  });
  emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
    tenant_id: tenantId,
    session_id: sessionId,
    at: new Date().toISOString(),
  });

  console.info("[whatsapp:inbox-saved]", {
    tenantId,
    session_id: sessionId,
    message_id: inserted.rows[0]?.id || null,
    external_message_id: externalMessageId,
    phoneSuffix: message.phone.slice(-4),
  });
  return { saved: true, session_id: sessionId, message: inserted.rows[0] || null, dedupe_key: dedupeKey };
};

export const handleIncomingWebhook = async (payload = {}) => {
  const normalized = extractIncomingWhatsapp(payload);
  console.info("[whatsapp:inbox-received]", {
    event: normalized.event,
    instance: normalized.instance,
    remoteJid: normalized.remoteJid,
    phoneSuffix: normalized.phone ? normalized.phone.slice(-4) : "",
    senderName: normalized.senderName,
    messageId: normalized.messageId,
    timestamp: normalized.timestamp,
    fromMe: normalized.fromMe,
    textLength: normalized.text.length,
  });

  if (normalized.fromMe) {
    console.info("[whatsapp:inbox-skipped]", { reason: "from_me", message_id: normalized.messageId, instance: normalized.instance });
    return { ...normalized, received_at: normalized.timestamp, inbox: { saved: false, reason: "from_me" }, text: "" };
  }
  if (!normalized.phone) {
    console.info("[whatsapp:inbox-skipped]", { reason: "missing_phone", remoteJid: normalized.remoteJid, message_id: normalized.messageId });
    return { ...normalized, received_at: normalized.timestamp, inbox: { saved: false, reason: "missing_phone" } };
  }
  if (!normalized.text) {
    console.info("[whatsapp:inbox-skipped]", { reason: "missing_text", phoneSuffix: normalized.phone.slice(-4), message_id: normalized.messageId });
    return { ...normalized, received_at: normalized.timestamp, inbox: { saved: false, reason: "missing_text" } };
  }

  try {
    const inbox = await saveWhatsappIncomingToAiInbox(normalized);
    return {
      ...normalized,
      received_at: normalized.timestamp,
      customer_name: normalized.senderName,
      message_id: normalized.messageId,
      instanceName: normalized.instance,
      inbox,
    };
  } catch (error) {
    console.error("[whatsapp:inbox-error]", {
      message: error?.message || String(error),
      code: error?.code || "",
      phoneSuffix: normalized.phone ? normalized.phone.slice(-4) : "",
      message_id: normalized.messageId,
    });
    throw error;
  }
};

export const triggerWhatsappAiAutoReply = async (message = {}) => {
  if (!message?.text || message?.fromMe || message?.inbox?.saved === false) {
    console.info("[whatsapp:ai-skipped]", {
      reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : "inbox_not_saved",
      message_id: message?.message_id || message?.messageId || "",
    });
    return { triggered: false, sent: false, reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : "inbox_not_saved" };
  }
  const generated = await generateWhatsappAiAutoReply({
    tenantId: message.raw?.tenant_id || message.raw?.tenantId || process.env.WHATSAPP_TENANT_ID || 1,
    phone: message.phone,
    sessionId: message.inbox?.session_id || `whatsapp:${message.phone}`,
    customerName: message.customer_name || message.senderName || "",
    messageText: message.text,
    timestamp: message.received_at || message.timestamp,
  });
  if (!generated.replyText) return generated;

  console.info("[whatsapp:ai-send-start]", {
    target: "evolution-sendText",
    tenantId: generated.tenantId,
    sessionId: generated.sessionId,
    phoneSuffix: (generated.phone || message.phone || "").slice(-4),
    replyLength: generated.replyText.length,
  });
  try {
    const result = await sendTextMessage({ phone: generated.phone || message.phone, message: generated.replyText });
    await logWhatsappAiOutbound({
      tenantId: generated.tenantId,
      phone: generated.phone || message.phone,
      sessionId: generated.sessionId,
      replyText: generated.replyText,
      sent: true,
      metadata: { result: result?.result || null },
    });
    console.info("[whatsapp:ai-sent]", {
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      phoneSuffix: (generated.phone || message.phone || "").slice(-4),
      replyLength: generated.replyText.length,
    });
    return { ...generated, sent: true, result };
  } catch (error) {
    const summary = errorSummary(error);
    console.error("[whatsapp:ai-send-error]", {
      ...summary,
      target: "evolution-sendText",
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      phoneSuffix: (generated.phone || message.phone || "").slice(-4),
    });
    await appendAiGeneratedSupportReply({
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      answer: generated.replyText,
      confidence: generated.aiPayload?.confidence || 0,
      detectedIntent: generated.aiPayload?.detected_intent || "whatsapp_ai_reply",
      suggestedProducts: generated.aiPayload?.suggested_products || [],
      visualAttachments: generated.aiPayload?.visual_attachments || [],
      suggestedActions: generated.aiPayload?.suggested_actions || [],
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      deliveryStatus: "failed",
      deliveryError: summary.causeMessage ? `${summary.message} / cause: ${summary.causeMessage}` : summary.message,
    }).catch(() => {});
    await logWhatsappAiOutbound({
      tenantId: generated.tenantId,
      phone: generated.phone || message.phone,
      sessionId: generated.sessionId,
      replyText: generated.replyText,
      sent: false,
      metadata: { error: summary, target: "evolution-sendText" },
    });
    console.error("[whatsapp:ai-error]", {
      ...summary,
      phase: "send",
      target: "evolution-sendText",
      sessionId: generated.sessionId,
      phoneSuffix: (generated.phone || message.phone || "").slice(-4),
    });
    return { ...generated, sent: false, reason: "evolution_send_failed", error: summary };
  }
};

export default {
  getStatus,
  sendTextMessage,
  sendOrderConfirmationMessage,
  normalizeEgyptPhone,
  verifyWebhookSecret,
  handleIncomingWebhook,
  triggerWhatsappAiAutoReply,
};
