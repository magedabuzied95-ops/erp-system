import crypto from "crypto";

import fs from "node:fs/promises";
import path from "node:path";

import db from "../database/db.js";
import { buildWhatsappTextDebug } from "../utils/whatsapp.js";
import { ensureAiSupportLogSchema } from "./aiSupportLogService.js";
import {
  AI_AGENT_CHANNELS,
  logChannelEvent,
  upsertChannelConversationMapping,
} from "./aiChannelAdapterService.js";
import { generateWhatsappAiAutoReply, logWhatsappAiOutbound } from "./aiInboxService.js";
import { debugAiImagesLog, normalizeProductCards } from "./aiProductCards.js";
import { appendAiGeneratedSupportReply, appendChannelOutboundSupportReply, appendInboundAiSupportMessage, appendWhatsappOutboundSupportReply, updateAiSupportMessageDeliveryStatus } from "./aiSupportLogService.js";
import { logAIPersistentEvent } from "./aiPersistentEventLogService.js";
import { addTraceStep, failTrace, finishTrace, setTraceInboundMessage, startTrace } from "./aiReplyTraceService.js";
import { normalizeWhatsappPhone, normalizeWhatsappSessionId } from "../utils/whatsappIdentity.js";
import { emitToRooms } from "../utils/socket.js";
import { normalizeArabicForIntent, normalizeArabicIntentPayload, normalizeArabicMessage } from "../utils/arabicTextNormalizer.js";
import { resolveProductAlias } from "../utils/productAliasResolver.js";
import { buildAliasAwareSearchHints } from "../utils/aliasAwareProductSearch.js";
import { buildCodOrderConfirmationMessage } from "../utils/orderConfirmationMessage.js";
import { getConversationMemory } from "./aiConversationMemory.js";
import { resolveFollowupContext, summarizeConversationMemoryV2 } from "../utils/aiConversationMemoryV2.js";

const provider = () => String(process.env.WHATSAPP_GATEWAY_PROVIDER || "evolution").trim().toLowerCase();
const apiUrl = () => String(process.env.EVOLUTION_API_URL || "").trim().replace(/\/+$/g, "");
const apiKey = () => String(process.env.EVOLUTION_API_KEY || "").trim();
const instanceName = () => String(process.env.WHATSAPP_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE_NAME || process.env.instanceName || "m1-store").trim();
const webhookSecret = () => String(process.env.WHATSAPP_WEBHOOK_SECRET || "").trim();
const sentImageDuplicateCache = new Map();
const recentEvolutionWebhookEvents = [];
const evolutionWebhookEventCounts = new Map();
const trackedEvolutionButtonMessages = new Map();
const evolutionProfilePictureCache = new Map();
const EVOLUTION_BUTTONS_DELIVERY_TIMEOUT_MS = 30000;
const EVOLUTION_PROFILE_PICTURE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EVOLUTION_PROFILE_PICTURE_EMPTY_TTL_MS = 30 * 60 * 1000;

const text = (value, fallback = "") => String(value ?? fallback).trim();
const previewText = (value = "", limit = 180) => text(value).replace(/\s+/g, " ").slice(0, limit);
const normalizedTraceMessage = (value = "") => normalizeArabicMessage(text(value));
const WHATSAPP_WEBHOOK_SKIP_REASONS = {
  groupJid: "group_jid",
  missingMessageId: "missing_message_id",
  missingText: "missing_text",
  nonMessageEvent: "non_message_event",
};

export const getEvolutionWebhookSkipReason = ({ event = "", remoteJid = "", messageId = "", textValue = "", hasMedia = false, fromMe = false } = {}) => {
  const normalizedEvent = String(event || "").toLowerCase();
  const hasMessageContent = Boolean(String(textValue || "").trim());

  if (String(remoteJid || "").endsWith("@g.us")) return WHATSAPP_WEBHOOK_SKIP_REASONS.groupJid;
  if (["contacts.update", "chats.update"].includes(normalizedEvent) && !hasMessageContent) {
    return WHATSAPP_WEBHOOK_SKIP_REASONS.nonMessageEvent;
  }
  if (!String(messageId || "").trim()) return WHATSAPP_WEBHOOK_SKIP_REASONS.missingMessageId;
  if (!hasMessageContent && !hasMedia) return WHATSAPP_WEBHOOK_SKIP_REASONS.missingText;
  return "";
};

const applyWhatsappGreetingGuard = ({ customerMessageText = "", replyText = "" } = {}) => {
  const normalizedMessage = normalizedTraceMessage(customerMessageText);
  const normalizedReply = text(replyText);
  const greetingSignal = /(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله)/i.test(normalizedMessage);
  const hasWaAlaykum = /وعليكم\s*السلام/i.test(normalizedReply);
  if (!greetingSignal || hasWaAlaykum) return normalizedReply;
  const strippedReply = normalizedReply
    .replace(/^(اهلا|أهلا|اهلا بيك|أهلا بيك|نورتنا|تحت أمرك|تحت امرك|مرحبا|مرحبًا)\s*[،,.-]?\s*/i, "")
    .trim();
  const guardedReply = `وعليكم السلام ورحمة الله${strippedReply ? `، ${strippedReply}` : "، أهلاً بيك يا فندم"}`;
  console.info("[whatsapp-greeting-guard-applied]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    source: "whatsappGatewayService",
    normalized_message: normalizedMessage,
    detected_intent: "greeting",
    reply_preview: previewText(guardedReply),
    produced_by: "whatsappGatewayService",
  });
  return guardedReply;
};
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

const redactSensitive = (value, seen = new WeakSet()) => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/api[_-]?key|token|secret|password|authorization|apikey/i.test(key)) {
      output[key] = child ? "[REDACTED]" : child;
    } else {
      output[key] = redactSensitive(child, seen);
    }
  }
  return output;
};

const rememberEvolutionWebhookEvent = (entry = {}) => {
  const eventName = String(entry.event || entry.rawEvent || "unknown").trim() || "unknown";
  evolutionWebhookEventCounts.set(eventName, (evolutionWebhookEventCounts.get(eventName) || 0) + 1);
  recentEvolutionWebhookEvents.unshift({
    received_at: new Date().toISOString(),
    ...entry,
  });
  recentEvolutionWebhookEvents.splice(20);
};

export const getRecentEvolutionWebhookEvents = () => ({
  events: recentEvolutionWebhookEvents,
  event_counts: Object.fromEntries(evolutionWebhookEventCounts.entries()),
});

const extractEvolutionButtonsMessageId = (value = {}) => text(
  value?.message_id ||
  value?.messageId ||
  value?.key?.id ||
  value?.result?.message_id ||
  value?.result?.messageId ||
  value?.result?.key?.id ||
  value?.id ||
  value?.mid ||
  ""
);

const normalizeEvolutionButtonsLifecycleStatus = (value = "") => {
  const status = text(value).toLowerCase();
  if (status.includes("read")) return "READ";
  if (status.includes("deliver")) return "DELIVERY_ACK";
  if (status.includes("delivery_ack") || status === "ack" || status === "sent") return "DELIVERY_ACK";
  if (status.includes("fail") || status.includes("error")) return "FAILED";
  if (status === "server_ack") return "SERVER_ACK";
  if (status === "pending") return "PENDING";
  return status ? status.toUpperCase() : "PENDING";
};

const trackEvolutionButtonsMessage = ({
  messageId = "",
  status = "PENDING",
  remoteJid = "",
  messageType = "",
  endpoint = "",
  orderId = null,
  phoneSuffix = "",
  responseBody = null,
  responseStatus = null,
  fallbackOnNotDelivered = null,
} = {}) => {
  const trackedMessageId = text(messageId);
  if (!trackedMessageId) return null;
  const nextStatus = normalizeEvolutionButtonsLifecycleStatus(status);
  const previous = trackedEvolutionButtonMessages.get(trackedMessageId) || {
    messageId: trackedMessageId,
    status: "PENDING",
    remoteJid: "",
    messageType: "",
    endpoint: "",
    orderId: null,
    phoneSuffix: "",
    responseBody: null,
    timer: null,
    fallbackOnNotDelivered: null,
    fallbackTriggered: false,
    createdAt: new Date().toISOString(),
  };
  if (previous.timer && ["DELIVERY_ACK", "READ", "FAILED"].includes(previous.status)) {
    clearTimeout(previous.timer);
    previous.timer = null;
  }
  const updated = {
    ...previous,
    messageId: trackedMessageId,
    status: nextStatus,
    remoteJid: text(remoteJid || previous.remoteJid || ""),
    messageType: text(messageType || previous.messageType || ""),
    endpoint: text(endpoint || previous.endpoint || ""),
    orderId: orderId ?? previous.orderId ?? null,
    phoneSuffix: text(phoneSuffix || previous.phoneSuffix || ""),
    responseBody: responseBody ?? previous.responseBody ?? null,
    responseStatus: responseStatus ?? previous.responseStatus ?? null,
    fallbackOnNotDelivered: fallbackOnNotDelivered ?? previous.fallbackOnNotDelivered ?? null,
    fallbackTriggered: previous.fallbackTriggered ?? false,
    updatedAt: new Date().toISOString(),
  };
  trackedEvolutionButtonMessages.set(trackedMessageId, updated);
  console.info("[evolution:buttons-message-tracking]", {
    messageId: trackedMessageId,
    status: updated.status,
    remoteJid: updated.remoteJid,
    messageType: updated.messageType,
  });
  if (updated.status === "SERVER_ACK") {
    if (previous.timer) clearTimeout(previous.timer);
    updated.timer = setTimeout(() => {
      const current = trackedEvolutionButtonMessages.get(trackedMessageId);
      if (!current) return;
      if (!["DELIVERY_ACK", "READ"].includes(current.status)) {
        console.warn("[evolution:buttons-not-delivered]", {
          messageId: trackedMessageId,
          status: current.status,
          remoteJid: current.remoteJid,
          messageType: current.messageType,
          orderId: current.orderId,
          phoneSuffix: current.phoneSuffix,
          endpoint: current.endpoint,
        });
        if (typeof current.fallbackOnNotDelivered === "function" && !current.fallbackTriggered) {
          current.fallbackTriggered = true;
          trackedEvolutionButtonMessages.set(trackedMessageId, current);
          Promise.resolve()
            .then(() => current.fallbackOnNotDelivered())
            .catch((fallbackError) => {
              console.warn("[evolution:buttons-not-delivered-fallback-error]", {
                messageId: trackedMessageId,
                endpoint: current.endpoint,
                orderId: current.orderId,
                phoneSuffix: current.phoneSuffix,
                message: fallbackError?.message || String(fallbackError),
                code: fallbackError?.code || "",
              });
            });
        }
      }
    }, EVOLUTION_BUTTONS_DELIVERY_TIMEOUT_MS);
  }
  if (["DELIVERY_ACK", "READ", "FAILED"].includes(updated.status) && updated.timer) {
    clearTimeout(updated.timer);
    updated.timer = null;
  }
  trackedEvolutionButtonMessages.set(trackedMessageId, updated);
  return updated;
};

const gatewayError = (message, code = "WHATSAPP_GATEWAY_ERROR", status = 500, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });

const normalizeDuplicateImageUrl = (value = "") => {
  const normalized = resolvePublicImageUrl(value);
  return text(normalized).toLowerCase().replace(/[?#].*$/, "");
};

const duplicateCacheKeyForImage = ({ phone = "", imageUrl = "" } = {}) => {
  const normalizedPhone = normalizeEgyptPhone(phone);
  const normalizedUrl = normalizeDuplicateImageUrl(imageUrl);
  if (!normalizedPhone || !normalizedUrl) return "";
  return `${normalizedPhone}|${normalizedUrl}`;
};

const getSentImageDuplicateEntry = ({ phone = "", imageUrl = "" } = {}) => {
  const duplicate_cache_key = duplicateCacheKeyForImage({ phone, imageUrl });
  return {
    duplicate_cache_key,
    entry: duplicate_cache_key ? sentImageDuplicateCache.get(duplicate_cache_key) || null : null,
  };
};

const markSentImageDuplicateEntry = ({ phone = "", imageUrl = "", status = "success", timestamp = new Date().toISOString() } = {}) => {
  const duplicate_cache_key = duplicateCacheKeyForImage({ phone, imageUrl });
  if (!duplicate_cache_key) return "";
  sentImageDuplicateCache.set(duplicate_cache_key, {
    status: text(status || "success"),
    timestamp: text(timestamp || new Date().toISOString()),
  });
  return duplicate_cache_key;
};

const clearSentImageDuplicateEntry = ({ phone = "", imageUrl = "" } = {}) => {
  const duplicate_cache_key = duplicateCacheKeyForImage({ phone, imageUrl });
  if (!duplicate_cache_key) return "";
  sentImageDuplicateCache.delete(duplicate_cache_key);
  return duplicate_cache_key;
};

const requireEvolutionConfig = () => {
  const current = config();
  if (current.provider !== "evolution") throw gatewayError("Unsupported WhatsApp gateway provider", "WHATSAPP_PROVIDER_UNSUPPORTED", 409);
  if (!current.apiUrl) throw gatewayError("EVOLUTION_API_URL is not configured", "EVOLUTION_API_URL_MISSING", 409);
  if (!apiKey()) throw gatewayError("EVOLUTION_API_KEY is not configured", "EVOLUTION_API_KEY_MISSING", 409);
  if (!current.instanceName) throw gatewayError("EVOLUTION_INSTANCE_NAME or WHATSAPP_INSTANCE_NAME is not configured", "EVOLUTION_INSTANCE_MISSING", 409);
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

export const extractEvolutionProfilePictureUrl = (value = {}) => {
  const queue = [value];
  const visited = new Set();
  const pictureKeys = ["profilePictureUrl", "profilePicUrl", "profile_picture_url", "profile_pic_url", "pictureUrl", "picture", "avatarUrl", "avatar"];
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    for (const key of pictureKeys) {
      const candidate = text(current?.[key]);
      if (/^https?:\/\//i.test(candidate)) return candidate;
    }
    Object.values(current).forEach((item) => {
      if (item && typeof item === "object") queue.push(item);
    });
  }
  return "";
};

export const fetchWhatsappCustomerProfilePicture = async ({ phone = "", instance = "", force = false } = {}) => {
  const normalizedPhone = normalizeEgyptPhone(phone);
  if (!normalizedPhone || config().provider !== "evolution") return "";
  const selectedInstance = text(instance || instanceName());
  const cacheKey = `${selectedInstance}|${normalizedPhone}`;
  const cached = evolutionProfilePictureCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let profilePictureUrl = "";
  try {
    const response = await evolutionFetch(`/chat/fetchProfilePictureUrl/${encodeURIComponent(selectedInstance)}`, {
      method: "POST",
      body: JSON.stringify({ number: normalizedPhone }),
      signal: controller.signal,
    });
    profilePictureUrl = extractEvolutionProfilePictureUrl(response);
  } catch (error) {
    console.warn("[whatsapp:profile-picture-unavailable]", {
      phoneSuffix: normalizedPhone.slice(-4),
      instance: selectedInstance,
      code: error?.code || error?.name || "",
      message: error?.message || String(error),
    });
  } finally {
    clearTimeout(timer);
  }
  evolutionProfilePictureCache.set(cacheKey, {
    url: profilePictureUrl,
    expiresAt: Date.now() + (profilePictureUrl ? EVOLUTION_PROFILE_PICTURE_CACHE_TTL_MS : EVOLUTION_PROFILE_PICTURE_EMPTY_TTL_MS),
  });
  return profilePictureUrl;
};

export const syncWhatsappCustomerProfilePictures = async ({ tenantId = null, limit = 250, force = false } = {}) => {
  await ensureAiSupportLogSchema();
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 250));
  const params = tenantId ? [Number(tenantId), safeLimit] : [safeLimit];
  const tenantFilter = tenantId ? "AND tenant_id = $1" : "";
  const limitParam = tenantId ? "$2" : "$1";
  const result = await db.query(
    `
    SELECT tenant_id, external_conversation_id, external_customer_id, customer_avatar_url, metadata
    FROM ai_channel_conversations
    WHERE channel = 'whatsapp'
      ${tenantFilter}
      AND COALESCE(NULLIF(external_customer_id, ''), metadata->>'resolved_phone', metadata->>'phone', '') <> ''
      ${force ? "" : "AND COALESCE(customer_avatar_url, '') = ''"}
    ORDER BY COALESCE(last_message_at, updated_at) DESC
    LIMIT ${limitParam}
    `,
    params
  );
  let updated = 0;
  let unavailable = 0;
  const rows = result.rows || [];
  const concurrency = 4;
  for (let index = 0; index < rows.length; index += concurrency) {
    const batch = rows.slice(index, index + concurrency);
    await Promise.all(batch.map(async (row) => {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const phone = normalizeEgyptPhone(row.external_customer_id || metadata.resolved_phone || metadata.phone || "");
      const avatarUrl = await fetchWhatsappCustomerProfilePicture({ phone, instance: metadata.instance, force });
      if (!avatarUrl) {
        unavailable += 1;
        return;
      }
      await Promise.all([
        db.query(
          `UPDATE ai_channel_conversations SET customer_avatar_url = $1 WHERE tenant_id = $2 AND channel = 'whatsapp' AND external_conversation_id = $3`,
          [avatarUrl, row.tenant_id, row.external_conversation_id]
        ),
        db.query(
          `UPDATE ai_support_sessions SET customer_avatar_url = $1 WHERE tenant_id = $2 AND session_id = $3`,
          [avatarUrl, row.tenant_id, row.external_conversation_id]
        ),
      ]);
      updated += 1;
    }));
  }
  return { scanned: rows.length, updated, unavailable };
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
  if (isLidJid(phone)) throw gatewayError("Cannot send WhatsApp message to unresolved @lid JID", "WHATSAPP_LID_UNRESOLVED", 422);
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
  const endpoint = `/message/sendText/${encodeURIComponent(current.instanceName)}`;
  console.info("[evolution:send-request]", {
    provider: current.provider,
    instanceName: current.instanceName,
    url: `${current.apiUrl}${endpoint}`,
    endpoint,
    number: normalizedPhone,
    payload_shape: { number: "string", text: "string" },
    textLength: body.length,
  });
  try {
    const data = await evolutionFetch(endpoint, {
      method: "POST",
      body: requestBody,
    });
    console.info("[evolution:send-response]", {
      provider: current.provider,
      instanceName: current.instanceName,
      endpoint,
      status: "ok",
      number: normalizedPhone,
      result: data,
    });
    return { success: true, provider: current.provider, instanceName: current.instanceName, phone: normalizedPhone, result: data };
  } catch (error) {
    console.error("[evolution:send-response]", {
      provider: current.provider,
      instanceName: current.instanceName,
      endpoint,
      status: "error",
      number: normalizedPhone,
      message: error?.message || String(error),
      code: error?.code || "",
      statusCode: error?.status || "",
      response_body: error?.data || error?.responseBody || null,
      response_raw: error?.responseRaw || "",
    });
    console.error("[whatsapp:send-text-error]", {
      provider: current.provider,
      instanceName: current.instanceName,
      endpoint,
      number: normalizedPhone,
      message: error?.message || String(error),
      code: error?.code || "",
      status: error?.status || "",
      response_body: error?.data || error?.responseBody || null,
      response_raw: error?.responseRaw || "",
    });
    throw error;
  }
};

export const sendImageMessage = async ({ phone, imageUrl, caption = "" } = {}) => {
  if (isLidJid(phone)) throw gatewayError("Cannot send WhatsApp image to unresolved @lid JID", "WHATSAPP_LID_UNRESOLVED", 422);
  const normalizedPhone = normalizeEgyptPhone(phone);
  const media = resolvePublicImageUrl(imageUrl);
  const safeCaption = text(caption).slice(0, 500);
  const mimetype = imageMimeType(media) || "image/jpeg";
  if (!normalizedPhone) throw gatewayError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!isPublicImageUrl(media)) throw gatewayError("A valid public image URL is required", "WHATSAPP_IMAGE_URL_REQUIRED", 400);
  const current = requireEvolutionConfig();
  const endpoint = `/message/sendMedia/${encodeURIComponent(current.instanceName)}`;
  const payload = {
    number: normalizedPhone,
    mediatype: "image",
    mimetype,
    media,
    caption: safeCaption,
  };
  const requestBody = JSON.stringify(payload);
  const captionDebug = buildWhatsappTextDebug(safeCaption, 220);
  console.info("[whatsapp:evolution-image-send-start]", {
    instanceName: current.instanceName,
    phoneSuffix: normalizedPhone.slice(-4),
    imageUrl: media,
    captionLength: safeCaption.length,
  });
  console.info("[whatsapp:evolution-image-payload-preview]", {
    instanceName: current.instanceName,
    phoneSuffix: normalizedPhone.slice(-4),
    imageUrl: media,
    captionFirst220Chars: captionDebug.firstChars,
    captionHasEmojis: captionDebug.hasEmojis,
  });
  const payloadLogBase = {
    endpoint,
    instance: current.instanceName,
    number: normalizedPhone,
    request_payload: payload,
    payload_shape: {
      keys: Object.keys(payload),
      number: "string",
      mediatype: "string",
      mimetype: "string",
      media: "string",
      caption: "string",
    },
    mediatype: payload.mediatype,
    mimetype: payload.mimetype,
    media: payload.media,
    caption: payload.caption,
    image_url_length: media.length,
    caption_length: safeCaption.length,
  };
  let response = null;
  let raw = "";
  let data = null;
  try {
    response = await fetch(`${current.apiUrl}${endpoint}`, {
      method: "POST",
      headers: {
        apikey: apiKey(),
        "Content-Type": "application/json",
      },
      body: requestBody,
    });
    raw = await response.text();
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { raw };
    }
    console.info("[whatsapp-image-send-payload]", {
      ...payloadLogBase,
      response_status: response.status,
      response_body: data,
      response_raw: raw,
    });
    if (!response.ok) {
      throw gatewayError(data?.message || data?.error || `Evolution API returned ${response.status}`, "EVOLUTION_API_ERROR", response.status, {
        data,
        responseBody: data,
        responseRaw: raw,
      });
    }
    console.info("[whatsapp:evolution-image-sent]", {
      instanceName: current.instanceName,
      phoneSuffix: normalizedPhone.slice(-4),
      imageUrl: media,
    });
    return { success: true, provider: current.provider, instanceName: current.instanceName, phone: normalizedPhone, imageUrl: media, result: data };
  } catch (error) {
    console.error("[whatsapp:evolution-image-error]", {
      instanceName: current.instanceName,
      phoneSuffix: normalizedPhone.slice(-4),
      imageUrl: media,
      message: error?.message || String(error),
      code: error?.code || "",
      status: error?.status || "",
      response_body: error?.data || error?.responseBody || null,
      response_raw: error?.responseRaw || "",
    });
    if (!response) {
      console.error("[whatsapp-image-send-payload]", {
        ...payloadLogBase,
        response_status: error?.status || "",
        response_body: error?.data || null,
        response_raw: error?.responseRaw || "",
      });
    }
    throw error;
  }
};

const buildOrderConfirmationButtonsPayload = ({ phone = "", title = "", text = "", footer = "", orderId = "", useSafeIds = false, buttonCount = 3 } = {}) => {
  const safeTitle = String(title || "").trim();
  const safeText = String(text || "").trim();
  const safeFooter = String(footer || "").trim();
  const safeOrderId = String(orderId || "").trim();
  const suffix = safeOrderId ? (useSafeIds ? `_${safeOrderId}` : `:${safeOrderId}`) : "";
  const buttons = [
    {
      type: "reply",
      displayText: "✅ تأكيد الطلب",
      id: `confirm_order${suffix}`,
    },
    {
      type: "reply",
      displayText: "✏️ تعديل الطلب",
      id: `edit_order${suffix}`,
    },
    {
      type: "reply",
      displayText: "❌ إلغاء الطلب",
      id: `cancel_order${suffix}`,
    },
  ].slice(0, Math.max(1, Math.min(3, Number(buttonCount) || 3)));
  return {
    number: normalizeEgyptPhone(phone),
    title: safeTitle,
    description: safeText,
    footer: safeFooter,
    buttons,
  };
};

const buildWhatsAppDebugButtonsPayload = ({
  phone = "",
  title = "",
  description = "",
  footer = "",
  buttons = [],
} = {}) => ({
  number: normalizeEgyptPhone(phone),
  title: String(title || "").trim(),
  description: String(description || "").trim(),
  footer: String(footer || "").trim(),
  buttons: Array.isArray(buttons) ? buttons : [],
});

const buildOrderConfirmationListPayload = ({ phone = "", title = "", text = "", footer = "", orderId = "", useSafeIds = false, buttonCount = 3 } = {}) => {
  const safeText = String(text || "").trim();
  const safeOrderId = String(orderId || "").trim();
  const suffix = safeOrderId ? (useSafeIds ? `_${safeOrderId}` : `:${safeOrderId}`) : "";
  const rows = [
    {
      title: "✅ تأكيد الطلب",
      description: "تأكيد تجهيز الطلب",
      rowId: `confirm_order${suffix}`,
    },
    {
      title: "✏️ تعديل الطلب",
      description: "تعديل المقاس أو العنوان",
      rowId: `edit_order${suffix}`,
    },
    {
      title: "❌ إلغاء الطلب",
      description: "إلغاء الطلب الحالي",
      rowId: `cancel_order${suffix}`,
    },
  ].slice(0, Math.max(1, Math.min(3, Number(buttonCount) || 3)));
  return {
    number: normalizeEgyptPhone(phone),
    title: "تأكيد الطلب",
    description: safeText,
    buttonText: "اختر إجراء",
    footerText: "M1Store",
    sections: [
      {
        title: "إجراءات الطلب",
        rows,
      },
    ],
  };
};

const orderSummaryLines = (items = []) =>
  (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => {
      const name = text(item.product_name || item.name || item.title, "منتج");
      const variant = text(item.variant_name || [item.size, item.color].filter(Boolean).join(" / ") || [item.color, item.size].filter(Boolean).join(" / "));
      const quantity = Math.max(1, Number(item.quantity || item.qty || 1));
      return `- ${name}${variant ? ` (${variant})` : ""} x${quantity}`;
    });

const orderAddressLine = (order = {}) =>
  text(
    order.customer_address ||
      order.shipping_address_line ||
      order.address ||
      [order.street_address, order.building_number, order.floor_number, order.apartment_number, order.landmark].filter(Boolean).join(", ")
  );

const orderStoreName = (order = {}) => text(order.store_name || order.storefront_name || order.company_name || order.brand_name || "M1 Store");
const truncateText = (value = "", limit = 500) => text(value).slice(0, limit);

const sendEvolutionButtonsMessage = async ({
  current = {},
  endpoint = "",
  requestBody = "",
  requestTimeoutMs = 9000,
  logBase = {},
  phone = "",
  fallbackOnNotDelivered = null,
} = {}) => {
  const functionName = "sendEvolutionButtonsMessage";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response = null;
  let raw = "";
  try {
    response = await fetch(`${current.apiUrl}${endpoint}`, {
      method: "POST",
      headers: {
        apikey: apiKey(),
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
    raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (parseError) {
      console.error("[evolution:send-buttons-error]", {
        file: "server/services/whatsappGatewayService.js",
        function: functionName,
        endpoint,
        status: response?.status ?? null,
        ...logBase,
        message: parseError?.message || String(parseError),
        code: parseError?.code || "",
      });
      throw parseError;
    }

    if (!response.ok) {
      const error = gatewayError(data?.message || data?.error || `Evolution API returned ${response.status}`, "EVOLUTION_API_ERROR", response.status, {
        data,
        responseBody: data,
        responseRaw: raw,
      });
      console.error("[evolution:send-buttons-error]", {
        file: "server/services/whatsappGatewayService.js",
        function: functionName,
        endpoint,
        status: response.status,
        ...logBase,
        message: error?.message || String(error),
        code: error?.code || "",
      });
      throw error;
    }

    const responseKeys = data && typeof data === "object" ? Object.keys(data) : [];
    const responseMessage = data?.result?.message || data?.message || data?.data?.message || data?.key?.message || {};
    const responseButtons = responseMessage?.buttonsMessage?.buttons || responseMessage?.interactiveMessage?.buttons || responseMessage?.interactiveMessage?.nativeFlowMessage?.buttons || [];
    const nativeFlowButtonNames = Array.isArray(responseMessage?.interactiveMessage?.nativeFlowMessage?.buttons)
      ? responseMessage.interactiveMessage.nativeFlowMessage.buttons
          .map((button) => button?.name || button?.buttonParamsJson?.name || button?.button_params_json?.name || "")
          .filter(Boolean)
      : [];
    const firstButtonParamsJson = Array.isArray(responseButtons)
      ? (() => {
          const firstButton = responseButtons[0] || {};
          const safe = {
            displayText: firstButton?.displayText || firstButton?.display_text || firstButton?.title || "",
            id: firstButton?.id || firstButton?.buttonId || "",
          };
          return safe;
        })()
      : null;
    console.info("[evolution:send-buttons-success-body]", {
      file: "server/services/whatsappGatewayService.js",
      function: functionName,
      endpoint,
      status: response.status,
      ...logBase,
      messageId: extractEvolutionButtonsMessageId(data),
      response_keys: responseKeys,
      remoteJid: data?.key?.remoteJid || data?.remoteJid || data?.result?.key?.remoteJid || data?.result?.remoteJid || "",
      messageType: data?.messageType || data?.type || data?.result?.messageType || data?.result?.type || responseMessage?.type || responseMessage?.messageType || "",
      hasViewOnceMessage: Boolean(responseMessage?.viewOnceMessage),
      hasInteractiveMessage: Boolean(responseMessage?.interactiveMessage),
      hasNativeFlowMessage: Boolean(responseMessage?.interactiveMessage?.nativeFlowMessage),
      nativeFlowButtonNames,
      firstButtonParamsJson,
      warning: data?.warning || data?.warnings || "",
      error: data?.error || data?.errors || "",
    });
    console.info("[evolution:send-buttons-success]", {
      file: "server/services/whatsappGatewayService.js",
      function: functionName,
      endpoint,
      status: response.status,
      ...logBase,
      messageId: extractEvolutionButtonsMessageId(data),
    });
    trackEvolutionButtonsMessage({
      messageId: extractEvolutionButtonsMessageId(data),
      status: "SERVER_ACK",
      remoteJid: `whatsapp:${phone}`,
      messageType: "buttons",
      endpoint,
      orderId: logBase.order_id,
      phoneSuffix: logBase.phoneSuffix,
      responseBody: data,
      responseStatus: response.status,
      fallbackOnNotDelivered,
    });
    return {
      success: true,
      provider: current.provider,
      instanceName: current.instanceName,
      phone,
      result: data,
      endpoint,
      delivery_mode: "interactive",
      used_buttons: true,
    };
  } catch (error) {
    console.error("[evolution:send-buttons-failure-brief]", {
      order_id: logBase.order_id || null,
      endpoint,
      status: error?.status || (controller.signal.aborted ? "timeout" : ""),
      error_message: error?.message || String(error),
      response_raw: truncateText(error?.responseRaw || error?.responseBody || error?.data?.raw || raw || "", 500),
      buttonIds: logBase.buttonIds || [],
      phoneSuffix: logBase.phoneSuffix || "",
    });
    if (error?.code === "EVOLUTION_BUTTONS_TIMEOUT" || error?.message === "Evolution sendButtons request timed out") {
      console.warn("[evolution:send-buttons-timeout]", {
        file: "server/services/whatsappGatewayService.js",
        function: functionName,
        endpoint,
        status: "timeout",
        timeoutMs: requestTimeoutMs,
        ...logBase,
      });
    } else {
      console.error("[evolution:send-buttons-error]", {
        file: "server/services/whatsappGatewayService.js",
        function: functionName,
        endpoint,
        status: error?.status || "",
        ...logBase,
        message: error?.message || String(error),
        code: error?.code || "",
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const sendEvolutionListMessage = async ({
  current = {},
  endpoint = "",
  requestBody = "",
  requestTimeoutMs = 9000,
  logBase = {},
  phone = "",
} = {}) => {
  const functionName = "sendEvolutionListMessage";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response = null;
  let raw = "";
  try {
    console.info("[evolution:send-list-request]", {
      file: "server/services/whatsappGatewayService.js",
      function: functionName,
      endpoint,
      ...logBase,
    });
    response = await fetch(`${current.apiUrl}${endpoint}`, {
      method: "POST",
      headers: {
        apikey: apiKey(),
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });
    raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (parseError) {
      console.error("[evolution:send-list-error]", {
        file: "server/services/whatsappGatewayService.js",
        function: functionName,
        endpoint,
        status: response?.status ?? null,
        ...logBase,
        message: parseError?.message || String(parseError),
        code: parseError?.code || "",
        response_raw: truncateText(raw || "", 500),
      });
      throw parseError;
    }

    if (!response.ok) {
      const error = gatewayError(data?.message || data?.error || `Evolution API returned ${response.status}`, "EVOLUTION_API_ERROR", response.status, {
        data,
        responseBody: data,
        responseRaw: raw,
      });
      console.error("[evolution:send-list-error]", {
        file: "server/services/whatsappGatewayService.js",
        function: functionName,
        endpoint,
        status: response.status,
        ...logBase,
        message: error?.message || String(error),
        code: error?.code || "",
        response_raw: truncateText(raw || error?.responseRaw || error?.responseBody || "", 500),
      });
      throw error;
    }

    console.info("[evolution:send-list-success]", {
      file: "server/services/whatsappGatewayService.js",
      function: functionName,
      endpoint,
      status: response.status,
      ...logBase,
      messageId: extractEvolutionButtonsMessageId(data),
    });
    return {
      success: true,
      provider: current.provider,
      instanceName: current.instanceName,
      phone,
      result: data,
      endpoint,
      delivery_mode: "interactive",
      used_list: true,
    };
  } catch (error) {
    console.error("[evolution:send-list-error]", {
      file: "server/services/whatsappGatewayService.js",
      function: functionName,
      endpoint,
      status: error?.status || (controller.signal.aborted ? "timeout" : ""),
      ...logBase,
      message: error?.message || String(error),
      code: error?.code || "",
      response_raw: truncateText(error?.responseRaw || error?.responseBody || raw || "", 500),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const sendOrderConfirmationListMessage = async ({ phone, title = "", text = "", footer = "", orderId = "", useSafeIds = false, buttonCount = 3 } = {}) => {
  if (provider() !== "evolution") {
    throw gatewayError("Interactive list is only supported on the Evolution provider", "WHATSAPP_BUTTONS_UNSUPPORTED", 409);
  }
  const normalizedPhone = normalizeEgyptPhone(phone);
  if (!normalizedPhone) throw gatewayError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  const current = requireEvolutionConfig();
  const requestTimeoutMs = 9000;
  const payload = buildOrderConfirmationListPayload({ phone: normalizedPhone, title, text, footer, orderId, useSafeIds, buttonCount });
  const requestBody = JSON.stringify(payload);
  const payloadPreview = {
    number: payload.number,
    title: payload.title,
    descriptionLength: payload.description?.length ?? 0,
    footerTextLength: payload.footerText?.length ?? 0,
    buttonTextLength: payload.buttonText?.length ?? 0,
    rowsCount: Array.isArray(payload.sections) ? payload.sections.reduce((total, section) => total + (Array.isArray(section?.rows) ? section.rows.length : 0), 0) : 0,
    rowIds: Array.isArray(payload.sections)
      ? payload.sections.flatMap((section) => (Array.isArray(section?.rows) ? section.rows : [])).map((row) => row?.rowId).filter(Boolean)
      : [],
  };
  const logBase = {
    order_id: orderId || null,
    phoneSuffix: normalizedPhone.slice(-4),
    rowIds: payloadPreview.rowIds,
  };
  const endpoint = `/message/sendList/${encodeURIComponent(current.instanceName)}`;
  return sendEvolutionListMessage({
    current,
    endpoint,
    requestBody,
    requestTimeoutMs,
    logBase,
    phone: normalizedPhone,
  });
};

export const sendOrderConfirmationInteractiveMessage = async ({ phone, title = "", text = "", footer = "", orderId = "", useSafeIds = false, buttonCount = 3 } = {}) => {
  if (provider() !== "evolution") {
    throw gatewayError("Interactive buttons are only supported on the Evolution provider", "WHATSAPP_BUTTONS_UNSUPPORTED", 409);
  }
  const normalizedPhone = normalizeEgyptPhone(phone);
  if (!normalizedPhone) throw gatewayError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  const current = requireEvolutionConfig();
  const requestTimeoutMs = 9000;
  const payload = buildOrderConfirmationButtonsPayload({ phone: normalizedPhone, title, text, footer, orderId, useSafeIds, buttonCount });
  const requestBody = JSON.stringify(payload);
  const payloadPreview = {
    number: payload.number,
    title: payload.title,
    descriptionLength: payload.description?.length ?? 0,
    footerLength: payload.footer?.length ?? 0,
    buttonsCount: Array.isArray(payload.buttons) ? payload.buttons.length : 0,
    buttonIds: Array.isArray(payload.buttons) ? payload.buttons.map((button) => button?.id || button?.buttonId).filter(Boolean) : [],
  };
  const logBase = {
    order_id: orderId || null,
    phoneSuffix: normalizedPhone.slice(-4),
    buttonIds: payloadPreview.buttonIds,
  };

  const endpoint = `/message/sendButtons/${encodeURIComponent(current.instanceName)}`;
  try {
    console.info("[whatsapp:interactive-payload-built]", {
      file: "server/services/whatsappGatewayService.js",
      function: "sendOrderConfirmationInteractiveMessage",
      endpoint,
      ...logBase,
      titleLength: payload.title?.length ?? 0,
      descriptionLength: payload.description?.length ?? 0,
      footerLength: payload.footer?.length ?? 0,
      buttonsCount: payloadPreview.buttonsCount,
    });
    console.info("[evolution:send-buttons-request]", {
      file: "server/services/whatsappGatewayService.js",
      function: "sendOrderConfirmationInteractiveMessage",
      endpoint,
      ...logBase,
    });
    const buttonResult = await sendEvolutionButtonsMessage({
      current,
      endpoint,
      requestBody,
      requestTimeoutMs,
      logBase,
      phone: normalizedPhone,
      fallbackOnNotDelivered: async () => {
        try {
          return await sendOrderConfirmationListMessage({
            phone: normalizedPhone,
            title,
            text,
            footer,
            orderId,
            useSafeIds,
            buttonCount: buttonCount === 1 ? 1 : 3,
          });
        } catch (listError) {
          console.warn("[whatsapp:order-confirmation-list-fallback]", {
            file: "server/services/whatsappGatewayService.js",
            function: "sendOrderConfirmationInteractiveMessage",
            endpoint,
            order_id: orderId || null,
            phoneSuffix: normalizedPhone.slice(-4),
            error_message: listError?.message || String(listError),
            error_status: listError?.status || "",
          });
          return sendTextMessage({ phone: normalizedPhone, message: text });
        }
      },
    });
    const buttonMessageId = extractEvolutionButtonsMessageId(buttonResult?.result);
    if (buttonMessageId) return buttonResult;
    console.warn("[whatsapp:interactive-buttons-missing-message-id]", {
      file: "server/services/whatsappGatewayService.js",
      function: "sendOrderConfirmationInteractiveMessage",
      endpoint,
      ...logBase,
    });
    const listResult = await sendOrderConfirmationListMessage({
      phone: normalizedPhone,
      title,
      text,
      footer,
      orderId,
      useSafeIds,
      buttonCount: buttonCount === 1 ? 1 : 3,
    });
    return {
      ...listResult,
      delivery_mode: "interactive_list",
    };
  } catch (error) {
    throw error;
  }
};

export const buildOrderConfirmationMessage = (order = {}) => {
  const customerName = text(order.customer_name || order.customerName || order.name, "عميلنا");
  return buildCodOrderConfirmationMessage({
    customerName,
    confirmationLink: order.confirmation_link || order.confirmation_url || "",
  });
};

export const sendWhatsAppButtonsDebugTest = async ({ phone = "", mode = "simple", useSafeIds = false } = {}) => {
  if (provider() !== "evolution") {
    throw gatewayError("Interactive buttons are only supported on the Evolution provider", "WHATSAPP_BUTTONS_UNSUPPORTED", 409);
  }
  const normalizedPhone = normalizeEgyptPhone(phone);
  if (!normalizedPhone) throw gatewayError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  const current = requireEvolutionConfig();
  const normalizedMode = String(mode || "simple").trim().toLowerCase();
  const presets = {
    simple: {
      payload: buildWhatsAppDebugButtonsPayload({
        phone: normalizedPhone,
        title: "اختبار",
        description: "اختبار أزرار واتساب",
        footer: "M1Store",
        buttons: [
          { type: "reply", displayText: "نعم", id: `yes${useSafeIds ? "_debug" : ""}` },
          { type: "reply", displayText: "لا", id: `no${useSafeIds ? "_debug" : ""}` },
        ],
      }),
    },
    plain: {
      payload: buildWhatsAppDebugButtonsPayload({
        phone: normalizedPhone,
        title: "Test",
        description: "Button test",
        footer: "M1Store",
        buttons: [
          { type: "reply", displayText: "Yes", id: "yes" },
          { type: "reply", displayText: "No", id: "no" },
        ],
      }),
    },
    legacy: {
      payload: buildWhatsAppDebugButtonsPayload({
        phone: normalizedPhone,
        title: "Test",
        description: "Legacy button test",
        footer: "M1Store",
        buttons: [
          { buttonId: "yes", buttonText: "Yes", type: 1 },
          { buttonId: "no", buttonText: "No", type: 1 },
        ],
      }),
    },
    url: {
      payload: buildWhatsAppDebugButtonsPayload({
        phone: normalizedPhone,
        title: "Test",
        description: "URL button test",
        footer: "M1Store",
        buttons: [
          { type: "url", displayText: "Open", url: "https://erp-system-ten-green.vercel.app/shop" },
        ],
      }),
    },
    cod_safe: {
      payload: buildWhatsAppDebugButtonsPayload({
        phone: normalizedPhone,
        title: "تأكيد الطلب",
        description: "طلبك جاهز للتأكيد",
        footer: "M1Store",
        buttons: [
          { type: "reply", displayText: "✅ تأكيد الطلب", id: "confirm_order_debug" },
          { type: "reply", displayText: "✏️ تعديل الطلب", id: "edit_order_debug" },
          { type: "reply", displayText: "❌ إلغاء الطلب", id: "cancel_order_debug" },
        ],
      }),
    },
  };
  const preset = presets[normalizedMode] || presets.simple;
  const payload = preset.payload;
  const requestBody = JSON.stringify(payload);
  const endpoint = `/message/sendButtons/${encodeURIComponent(current.instanceName)}`;
  const buttonIds = Array.isArray(payload.buttons) ? payload.buttons.map((button) => button?.id || button?.buttonId).filter(Boolean) : [];
  console.info("[whatsapp:buttons-debug-test]", {
    file: "server/services/whatsappGatewayService.js",
    function: "sendWhatsAppButtonsDebugTest",
    endpoint,
    mode: normalizedMode,
    phoneSuffix: normalizedPhone.slice(-4),
    buttonIds,
    payload_keys: Object.keys(payload),
  });
  return sendEvolutionButtonsMessage({
    current,
    endpoint,
    requestBody,
    requestTimeoutMs: 9000,
    logBase: {
      order_id: null,
      phoneSuffix: normalizedPhone.slice(-4),
      buttonIds,
    },
    phone: normalizedPhone,
  });
};

export const sendOrderConfirmationMessage = async ({ order } = {}) => {
  if (!order) throw gatewayError("Order is required", "WHATSAPP_ORDER_REQUIRED", 400);
  const phone = order.customer_phone || order.phone || order.whatsapp || order.mobile;
  const message = buildOrderConfirmationMessage(order);
  const title = "✅ تأكيد الطلب";
  const footer = "اختر الإجراء المناسب";
  try {
    console.info("[buttons-step-1-enter]", {
      file: "server/services/whatsappGatewayService.js",
      function: "sendOrderConfirmationMessage",
      order_id: order?.id || null,
      phoneSuffix: normalizeEgyptPhone(phone).slice(-4),
    });
    const result = await sendOrderConfirmationInteractiveMessage({
      phone,
      title,
      text: message,
      footer,
      orderId: order?.id || "",
    });
    await appendWhatsappOutboundSupportReply({
      tenantId: order.tenant_id || order.tenantId || process.env.WHATSAPP_TENANT_ID || 1,
      sessionId: `whatsapp:${normalizeEgyptPhone(phone)}`,
      clientRequestId: `order_confirmation:${order?.id || normalizeEgyptPhone(phone)}`,
      message,
      messageType: "text",
      senderType: "system",
      source: "whatsapp_order_confirmation",
      channel: "whatsapp",
      deliveryStatus: "sent",
      deliveryError: "",
      externalMessageId: result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || "",
      providerMessageId: result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || "",
      whatsappInstance: result?.instanceName || result?.instance || "",
      remoteJid: `whatsapp:${normalizeEgyptPhone(phone)}`,
      resolvedReplyJid: `whatsapp:${normalizeEgyptPhone(phone)}`,
      resolvedPhone: normalizeEgyptPhone(phone),
      preserveExactMessage: true,
      upsertSession: true,
      sessionStatus: "ai_active",
      sessionSource: "whatsapp",
      sessionChannel: "whatsapp",
      sessionCustomerName: order?.customer_name || "",
      sourcePath: "whatsapp_order_confirmation",
      insertSource: "whatsapp_order_confirmation",
      confidence: 1,
      detectedIntent: "whatsapp_order_confirmation",
    });
    return result;
  } catch (error) {
    console.warn("[whatsapp:order-confirmation-buttons-fallback]", {
      order_id: order?.id || null,
      order_number: orderNumber(order),
      error_message: error?.message || String(error),
      error_status: error?.status || "",
      error_response_raw: truncateText(error?.responseRaw || error?.responseBody || error?.data?.raw || "", 500),
      deliveryMode: "fallback_text",
    });
    const fallbackResult = await sendTextMessage({ phone, message });
    await appendWhatsappOutboundSupportReply({
      tenantId: order.tenant_id || order.tenantId || process.env.WHATSAPP_TENANT_ID || 1,
      sessionId: `whatsapp:${normalizeEgyptPhone(phone)}`,
      clientRequestId: `order_confirmation:${order?.id || normalizeEgyptPhone(phone)}`,
      message,
      messageType: "text",
      senderType: "system",
      source: "whatsapp_order_confirmation",
      channel: "whatsapp",
      deliveryStatus: "sent",
      deliveryError: "",
      externalMessageId: fallbackResult?.result?.message_id || fallbackResult?.result?.messageId || fallbackResult?.result?.key?.id || fallbackResult?.message_id || "",
      providerMessageId: fallbackResult?.result?.message_id || fallbackResult?.result?.messageId || fallbackResult?.result?.key?.id || fallbackResult?.message_id || "",
      whatsappInstance: fallbackResult?.instanceName || fallbackResult?.instance || "",
      remoteJid: `whatsapp:${normalizeEgyptPhone(phone)}`,
      resolvedReplyJid: `whatsapp:${normalizeEgyptPhone(phone)}`,
      resolvedPhone: normalizeEgyptPhone(phone),
      preserveExactMessage: true,
      upsertSession: true,
      sessionStatus: "ai_active",
      sessionSource: "whatsapp",
      sessionChannel: "whatsapp",
      sessionCustomerName: order?.customer_name || "",
      sourcePath: "whatsapp_order_confirmation",
      insertSource: "whatsapp_order_confirmation",
      confidence: 1,
      detectedIntent: "whatsapp_order_confirmation",
    }).catch(() => {});
    return {
      ...fallbackResult,
      delivery_mode: "text",
      used_buttons: false,
      fallback_used: true,
    };
  }
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

const collectStrings = (value, output = [], seen = new WeakSet()) => {
  if (output.length >= 250 || value === null || value === undefined) return output;
  if (typeof value === "string" || typeof value === "number") {
    const current = text(value);
    if (current) output.push(current);
    return output;
  }
  if (typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  for (const child of Object.values(value)) {
    collectStrings(child, output, seen);
    if (output.length >= 250) break;
  }
  return output;
};

const collectStringsWithPaths = (value, path = "payload", output = [], seen = new WeakSet()) => {
  if (output.length >= 500 || value === null || value === undefined) return output;
  if (typeof value === "string" || typeof value === "number") {
    const current = text(value);
    if (current) output.push({ path, value: current });
    return output;
  }
  if (typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectStringsWithPaths(child, `${path}[${index}]`, output, seen));
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    collectStringsWithPaths(child, `${path}.${key}`, output, seen);
    if (output.length >= 500) break;
  }
  return output;
};

const getPathValue = (source, path = "") => {
  const parts = String(path || "").replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
};

const primaryEvolutionData = (payload = {}) => {
  const data = payload?.data ?? payload?.body?.data ?? payload;
  if (Array.isArray(data)) return data[0] || {};
  return data || {};
};

const isLidJid = (value = "") => /@lid$/i.test(text(value));
const isWhatsappPhoneJid = (value = "") => /@(s\.whatsapp\.net|c\.us)$/i.test(text(value));
const isGroupJid = (value = "") => /@g\.us$/i.test(text(value));
const isGroupConversationValue = (value = "") => isGroupJid(value);
const isGroupConversationContext = (...values) => values.some((value) => isGroupConversationValue(value));
const jidNumber = (value = "") => text(value).split("@")[0];
const numberFromWhatsappJid = (value = "") => isWhatsappPhoneJid(value) ? normalizeEgyptPhone(jidNumber(value)) : "";
const jidFromNumber = (value = "") => {
  const normalized = normalizeEgyptPhone(value);
  return normalized ? `${normalized}@s.whatsapp.net` : "";
};
const whatsappGroupRepliesEnabled = () => ["1", "true", "yes", "on"].includes(text(process.env.WHATSAPP_GROUP_REPLIES_ENABLED).toLowerCase());

const replyTargetFromValue = (value = "") => {
  const raw = text(value);
  if (!raw || isLidJid(raw)) return null;
  if (isWhatsappPhoneJid(raw)) {
    const number = numberFromWhatsappJid(raw);
    return number ? { jid: raw, number } : null;
  }
  if (/@/i.test(raw)) return null;
  const number = normalizeEgyptPhone(raw);
  return number ? { jid: jidFromNumber(number), number } : null;
};

const normalizeOwnerJid = (value = "") => {
  const raw = text(value);
  if (!raw || isLidJid(raw) || isGroupJid(raw)) return "";
  if (isWhatsappPhoneJid(raw)) return jidFromNumber(numberFromWhatsappJid(raw));
  if (/@/i.test(raw)) return "";
  return jidFromNumber(raw);
};

const targetEqualsOwner = (target = null, ownerJids = []) => {
  if (!target) return false;
  const owners = Array.isArray(ownerJids) ? ownerJids : [ownerJids];
  return owners.some((ownerJid) => {
    const ownerNumber = numberFromWhatsappJid(ownerJid);
    return Boolean(ownerNumber && target.number === ownerNumber);
  });
};

const ownerJidsFromPayload = ({ payload = {}, data = {}, fromMe = null } = {}) => {
  const candidates = [
    process.env.WHATSAPP_CONNECTED_OWNER_JID,
    process.env.WHATSAPP_INSTANCE_OWNER_JID,
    process.env.EVOLUTION_INSTANCE_OWNER_JID,
    process.env.WHATSAPP_CONNECTED_NUMBER,
    process.env.WHATSAPP_INSTANCE_OWNER_NUMBER,
    process.env.EVOLUTION_INSTANCE_OWNER_NUMBER,
    process.env.WHATSAPP_OWNER_NUMBER,
    process.env.WHATSAPP_NUMBER,
    data?.ownerJid,
    data?.owner_jid,
    data?.connectedOwnerJid,
    data?.connected_owner_jid,
    data?.instanceOwnerJid,
    data?.instance_owner_jid,
    data?.instance?.ownerJid,
    data?.instance?.owner,
    data?.instance?.ownerNumber,
    data?.instance?.number,
    data?.instance?.profile?.id,
    payload?.ownerJid,
    payload?.owner_jid,
    payload?.connectedOwnerJid,
    payload?.connected_owner_jid,
    payload?.instanceOwnerJid,
    payload?.instance_owner_jid,
    payload?.instance?.ownerJid,
    payload?.instance?.owner,
    payload?.instance?.ownerNumber,
    payload?.instance?.number,
    payload?.instance?.profile?.id,
    fromMe === true ? data?.sender : "",
    fromMe === true ? payload?.sender : "",
    "201000659301",
  ];
  const seen = new Set();
  const owners = [];
  for (const candidate of candidates) {
    const jid = normalizeOwnerJid(candidate);
    if (jid && !seen.has(jid)) {
      seen.add(jid);
      owners.push(jid);
    }
  }
  return owners;
};

const ownerJidFromPayload = (input = {}) => ownerJidsFromPayload(input)[0] || "";
const ownerNumberFromJids = (ownerJids = []) => numberFromWhatsappJid(Array.isArray(ownerJids) ? ownerJids[0] : ownerJids) || "";

const logReplyTargetCandidateRejected = ({ candidateJid = "", candidateNumber = "", reason = "owner_number" } = {}) => {
  console.info("[whatsapp:reply-target-candidate-rejected]", {
    candidateJid: text(candidateJid),
    candidateNumber: text(candidateNumber),
    reason,
  });
};

const rejectOwnerTarget = (target = null, ownerJids = [], candidateJid = "") => {
  if (!target || !targetEqualsOwner(target, ownerJids)) return false;
  logReplyTargetCandidateRejected({
    candidateJid: candidateJid || target.jid,
    candidateNumber: target.number,
    reason: "owner_number",
  });
  return true;
};

const logLidResolutionAttempt = (payload = {}) => {
  console.info("[lid-resolution-attempt]", payload);
};

const logLidResolutionSuccess = (payload = {}) => {
  console.info("[lid-resolution-success]", payload);
};

const logLidResolutionFailed = (payload = {}) => {
  console.info("[lid-resolution-failed]", payload);
};

const resolveWhatsappReplyTarget = ({ payload = {}, data = {}, key = {}, remoteJid = "", fromMe = null } = {}) => {
  const message = data?.message || data?.messages?.[0]?.message || {};
  const contextInfo =
    message?.contextInfo ||
    message?.extendedTextMessage?.contextInfo ||
    message?.imageMessage?.contextInfo ||
    message?.videoMessage?.contextInfo ||
    message?.documentMessage?.contextInfo ||
    data?.contextInfo ||
    payload?.contextInfo ||
    {};
  const keyParticipant = text(key?.participant || data?.key?.participant || "");
  const participant = text(keyParticipant || data?.participant || payload?.participant || "");
  const sender = text(data?.sender || payload?.sender || "");
  const contextParticipant = text(contextInfo?.participant || "");
  const ownerJids = ownerJidsFromPayload({ payload, data, fromMe });
  const connectedOwnerJid = ownerJids[0] || "";
  const instanceOwnerJid = connectedOwnerJid;
  const configuredBotNumber = ownerNumberFromJids(ownerJids);
  const remoteTarget = replyTargetFromValue(remoteJid);
  const isGroup = isGroupJid(remoteJid);
  const isLid = isLidJid(remoteJid);
  let rejectedOwnerCandidate = false;
  const rejectOwnTarget = (target = null, candidateJid = "") => {
    const rejected = rejectOwnerTarget(target, ownerJids, candidateJid);
    if (rejected) rejectedOwnerCandidate = true;
    return rejected;
  };
  const base = {
    remoteJid: text(remoteJid),
    participant,
    sender,
    connectedOwnerJid,
    instanceOwnerJid,
    ownerJid: connectedOwnerJid,
    configuredBotNumber,
    isGroup,
    isLid,
    fromMe: fromMe === true,
  };
  if (fromMe === true) {
    return {
      ...base,
      resolvedJid: "",
      resolvedNumber: "",
      reason: "from_me",
    };
  }
  if (isLid) {
    const nestedStrings = collectStringsWithPaths(payload);
    logLidResolutionAttempt({
      remoteJid: base.remoteJid,
      sender,
      participant,
      fromMe: base.fromMe,
      ownerJid: base.ownerJid,
      configuredBotNumber,
      sources: ["key.participant", "data.participant", "data.sender", "contextInfo.participant", "data.key.remoteJid", "data.remoteJid", "embedded_jid_fields", "stored_conversation_mapping", "previous_resolved_customer"],
    });
    const lidCandidates = [
      { label: "key.participant", value: keyParticipant },
      { label: "data.participant", value: data?.participant },
      { label: "data.sender", value: data?.sender },
      { label: "contextInfo.participant", value: contextParticipant },
      { label: "data.key.remoteJid", value: data?.key?.remoteJid },
      { label: "data.remoteJid", value: data?.remoteJid },
      ...nestedStrings
        .filter((item) => isWhatsappPhoneJid(item.value))
        .map((item) => ({ label: `embedded_jid_fields:${item.path}`, value: item.value })),
    ];
    console.info("[evolution:lid-candidates]", {
      remoteJid: base.remoteJid,
      owner_numbers: ownerJids.map(numberFromWhatsappJid).filter(Boolean),
      candidates: lidCandidates.map((candidate) => ({
        label: candidate.label,
        value: text(candidate.value),
        normalized: replyTargetFromValue(candidate.value)?.number || "",
        is_owner: targetEqualsOwner(replyTargetFromValue(candidate.value), ownerJids),
      })).filter((candidate) => candidate.value),
    });
    const seenLidCandidates = new Set();
    for (const candidate of lidCandidates) {
      const candidateValue = text(candidate.value);
      if (!candidateValue || seenLidCandidates.has(candidateValue)) continue;
      seenLidCandidates.add(candidateValue);
      const target = replyTargetFromValue(candidateValue);
      if (!target) continue;
      if (targetEqualsOwner(target, ownerJids)) {
        logReplyTargetCandidateRejected({
          candidateJid: candidateValue,
          candidateNumber: target.number,
          reason: "owner_number",
        });
        continue;
      }
      const resolved = {
        ...base,
        resolvedJid: target.jid,
        resolvedNumber: target.number,
        reason: `lid_${candidate.label}`,
      };
      logLidResolutionSuccess({
        remoteJid: base.remoteJid,
        sender,
        participant,
        fromMe: base.fromMe,
        ownerJid: base.ownerJid,
        configuredBotNumber,
        resolvedJid: resolved.resolvedJid,
        resolvedNumber: resolved.resolvedNumber,
        reason: resolved.reason,
      });
      return resolved;
    }
    return {
      ...base,
      resolvedJid: "",
      resolvedNumber: "",
      reason: "lid_unresolved",
    };
  }
  if (remoteTarget && !isGroup && !isLid) {
    if (!rejectOwnTarget(remoteTarget, remoteJid)) {
      return {
        ...base,
        resolvedJid: remoteTarget.jid,
        resolvedNumber: remoteTarget.number,
        reason: "remoteJid_private_chat",
      };
    }
  }
  const groupParticipantCandidates = [
    { label: "key.participant", value: keyParticipant },
    { label: "data.participant", value: data?.participant },
    { label: "contextInfo.participant", value: contextParticipant },
  ];
  if (isGroup) {
    for (const candidate of groupParticipantCandidates) {
      const target = replyTargetFromValue(candidate.value);
      if (target && !rejectOwnTarget(target, candidate.value)) {
        return {
          ...base,
          resolvedJid: target.jid,
          resolvedNumber: target.number,
          reason: `group_${candidate.label}`,
        };
      }
    }
    if (groupParticipantCandidates.some((candidate) => isLidJid(candidate.value))) {
      return {
        ...base,
        resolvedJid: "",
        resolvedNumber: "",
        reason: "lid_unresolved",
      };
    }
    if (!whatsappGroupRepliesEnabled()) {
      return {
        ...base,
        resolvedJid: "",
        resolvedNumber: "",
        reason: "group_reply_disabled",
      };
    }
  }
  const senderFallbackCandidates = connectedOwnerJid
    ? [
        { label: "data.sender", value: data?.sender },
        { label: "sender", value: payload?.sender },
      ]
    : [];
  const fallbackCandidates = [
    ...groupParticipantCandidates,
    ...(isLid ? senderFallbackCandidates : [
      { label: "data.sender", value: data?.sender },
      { label: "sender", value: payload?.sender },
    ]),
  ];
  for (const candidate of fallbackCandidates) {
    const target = replyTargetFromValue(candidate.value);
    if (target && !rejectOwnTarget(target, candidate.value)) {
      return {
        ...base,
        resolvedJid: target.jid,
        resolvedNumber: target.number,
        reason: candidate.label,
      };
    }
  }
  if (remoteTarget && !isLid && (whatsappGroupRepliesEnabled() || !isGroup)) {
    if (!rejectOwnTarget(remoteTarget, remoteJid)) {
      return {
        ...base,
        resolvedJid: remoteTarget.jid,
        resolvedNumber: remoteTarget.number,
        reason: isGroup ? "group_remote_jid_explicitly_enabled" : "remote_jid_phone",
      };
    }
  }
  const senderValues = new Set([text(data?.sender), text(payload?.sender)].filter(Boolean));
  const recursivePhoneJid = collectStrings(payload).find((value) => {
    if (isLid && senderValues.has(text(value))) return false;
    if (!isWhatsappPhoneJid(value)) return false;
    const target = replyTargetFromValue(value);
    if (!target) return false;
    if (rejectOwnTarget(target, value)) return false;
    return true;
  });
  const recursiveTarget = replyTargetFromValue(recursivePhoneJid);
  if (recursiveTarget) {
    return {
      ...base,
      resolvedJid: recursiveTarget.jid,
      resolvedNumber: recursiveTarget.number,
      reason: "payload_phone_jid",
    };
  }
  return {
    ...base,
    resolvedJid: "",
    resolvedNumber: "",
    reason: rejectedOwnerCandidate ? "owner_target" : isLid ? "lid_unresolved" : isGroup ? "group_reply_target_unresolved" : "no_reply_target",
  };
};

const resolveStoredLidReplyTarget = async ({ tenantId, remoteJid = "", ownerJids = [], base = {} } = {}) => {
  const safeRemoteJid = text(remoteJid);
  if (!tenantId || !isLidJid(safeRemoteJid)) return null;
  const buildTarget = (value = "") => {
    const target = replyTargetFromValue(value);
    if (!target || targetEqualsOwner(target, ownerJids)) return null;
    return target;
  };
  try {
    const messageRows = await db.query(
      `
      SELECT resolved_reply_jid, resolved_phone, session_id, created_at
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND channel = 'whatsapp'
        AND remote_jid = $2
        AND COALESCE(resolved_phone, '') <> ''
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [tenantId, safeRemoteJid]
    );
    for (const row of messageRows.rows || []) {
      const target = buildTarget(row.resolved_reply_jid) || buildTarget(row.resolved_phone);
      if (!target) continue;
      const resolved = {
        ...base,
        resolvedJid: target.jid,
        resolvedNumber: target.number,
        reason: "lid_previous_resolved_message",
      };
      logLidResolutionSuccess({
        remoteJid: safeRemoteJid,
        sender: base.sender || "",
        participant: base.participant || "",
        fromMe: base.fromMe === true,
        ownerJid: base.ownerJid || base.connectedOwnerJid || "",
        configuredBotNumber: base.configuredBotNumber || "",
        resolvedJid: resolved.resolvedJid,
        resolvedNumber: resolved.resolvedNumber,
        reason: resolved.reason,
      });
      return resolved;
    }

    const conversationRows = await db.query(
      `
      SELECT external_customer_id, external_conversation_id, metadata, updated_at
      FROM ai_channel_conversations
      WHERE tenant_id = $1
        AND channel = 'whatsapp'
        AND (
          external_conversation_id = $2
          OR external_customer_id = $3
          OR metadata->>'remote_jid' = $3
          OR metadata->>'lid_jid' = $3
          OR metadata->>'sender_lid' = $3
        )
      ORDER BY updated_at DESC
      LIMIT 10
      `,
      [tenantId, `whatsapp:${safeRemoteJid}`, safeRemoteJid]
    );
    for (const row of conversationRows.rows || []) {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const target =
        buildTarget(metadata.resolved_reply_jid) ||
        buildTarget(metadata.resolved_phone) ||
        buildTarget(metadata.customer_phone) ||
        buildTarget(metadata.phone) ||
        buildTarget(row.external_customer_id) ||
        buildTarget(row.external_conversation_id?.replace(/^whatsapp:/i, ""));
      if (!target) continue;
      const resolved = {
        ...base,
        resolvedJid: target.jid,
        resolvedNumber: target.number,
        reason: "lid_stored_conversation_mapping",
      };
      logLidResolutionSuccess({
        remoteJid: safeRemoteJid,
        sender: base.sender || "",
        participant: base.participant || "",
        fromMe: base.fromMe === true,
        ownerJid: base.ownerJid || base.connectedOwnerJid || "",
        configuredBotNumber: base.configuredBotNumber || "",
        resolvedJid: resolved.resolvedJid,
        resolvedNumber: resolved.resolvedNumber,
        reason: resolved.reason,
      });
      return resolved;
    }
  } catch (error) {
    console.warn("[lid-resolution-lookup-error]", {
      remoteJid: safeRemoteJid,
      tenantId,
      message: error?.message || String(error),
      code: error?.code || "",
    });
  }
  logLidResolutionFailed({
    remoteJid: safeRemoteJid,
    sender: base.sender || "",
    participant: base.participant || "",
    fromMe: base.fromMe === true,
    ownerJid: base.ownerJid || base.connectedOwnerJid || "",
    configuredBotNumber: base.configuredBotNumber || "",
    resolvedJid: "",
    reason: "lid_unresolved",
  });
  return null;
};

const resolveOutboundWhatsappReplyTarget = (message = {}) => {
  const remoteJid = text(message.remoteJid || message.remote_jid || "");
  const participant = text(message.participant || "");
  const sender = text(message.sender || "");
  const connectedOwnerJid = text(message.connectedOwnerJid || message.connected_owner_jid || "");
  const instanceOwnerJid = text(message.instanceOwnerJid || message.instance_owner_jid || connectedOwnerJid);
  const ownerJid = text(message.ownerJid || message.owner_jid || connectedOwnerJid);
  const configuredBotNumber = text(message.configuredBotNumber || message.configured_bot_number || numberFromWhatsappJid(ownerJid || instanceOwnerJid));
  const isGroup = Boolean(message.isGroup ?? message.is_group ?? isGroupJid(remoteJid));
  const isLid = Boolean(message.isLid ?? message.is_lid ?? isLidJid(remoteJid || message.phone));
  const resolvedPhone = normalizeEgyptPhone(message.resolvedPhone || message.resolved_phone || "");
  const replyTargetReason = text(message.replyTargetReason || message.reply_target_reason || "");
  const base = {
    remoteJid,
    participant,
    sender,
    connectedOwnerJid,
    instanceOwnerJid,
    ownerJid,
    configuredBotNumber,
    isGroup,
    isLid,
    fromMe: message.fromMe === true,
  };
  if (resolvedPhone) {
    return {
      ...base,
      resolvedJid: text(message.resolvedReplyJid || message.resolved_reply_jid || jidFromNumber(resolvedPhone)),
      resolvedNumber: resolvedPhone,
      reason: replyTargetReason || "resolved_phone",
    };
  }
  const unresolvedReason = replyTargetReason || (isLid ? "lid_unresolved" : isGroup ? "group_reply_target_unresolved" : "");
  if (unresolvedReason || isGroup || isLid) {
    return {
      ...base,
      resolvedJid: "",
      resolvedNumber: "",
      reason: unresolvedReason || "no_reply_target",
    };
  }
  const target = replyTargetFromValue(message.phone || remoteJid);
  if (target) {
    return {
      ...base,
      resolvedJid: target.jid,
      resolvedNumber: target.number,
      reason: isWhatsappPhoneJid(remoteJid) ? "remote_jid_phone" : "direct_number",
    };
  }
  return {
    ...base,
    resolvedJid: "",
    resolvedNumber: "",
    reason: "no_reply_target",
  };
};

const outboundOwnerJidsForMessage = (message = {}) => {
  const candidates = [
    message.connectedOwnerJid,
    message.connected_owner_jid,
    message.instanceOwnerJid,
    message.instance_owner_jid,
    process.env.WHATSAPP_CONNECTED_OWNER_JID,
    process.env.WHATSAPP_INSTANCE_OWNER_JID,
    process.env.EVOLUTION_INSTANCE_OWNER_JID,
    process.env.WHATSAPP_CONNECTED_NUMBER,
    process.env.WHATSAPP_INSTANCE_OWNER_NUMBER,
    process.env.EVOLUTION_INSTANCE_OWNER_NUMBER,
    process.env.WHATSAPP_OWNER_NUMBER,
    process.env.WHATSAPP_NUMBER,
    "201000659301",
  ];
  const seen = new Set();
  return candidates.map(normalizeOwnerJid).filter((jid) => {
    if (!jid || seen.has(jid)) return false;
    seen.add(jid);
    return true;
  });
};

const errorSummary = (error = {}) => ({
  message: error?.message || String(error),
  causeMessage: error?.cause?.message || "",
  code: error?.code || "",
  status: error?.status || "",
  data: error?.data || error?.responseBody || error?.metaResponse || null,
  responseRaw: error?.responseRaw || "",
});

const asArray = (value) => (Array.isArray(value) ? value : []);

const trimSlashes = (value = "") => text(value).replace(/^\/+|\/+$/g, "");

const publicBaseUrl = () => {
  const candidates = [
    process.env.PUBLIC_BACKEND_URL,
    process.env.BACKEND_PUBLIC_URL,
    process.env.PUBLIC_APP_URL,
    process.env.STORE_FRONT_URL,
    process.env.API_PUBLIC_URL,
    process.env.VITE_API_BASE_URL,
  ];
  for (const candidate of candidates) {
    const safe = text(candidate).replace(/\/+$/g, "");
    if (/^https?:\/\//i.test(safe) && !/localhost|127\.0\.0\.1/i.test(safe)) return safe;
  }
  return "";
};

export const isPublicImageUrl = (url = "") => {
  const safe = text(url);
  if (!safe) return false;
  if (/^file:\/\//i.test(safe)) return false;
  if (/^[a-z]:[\\/]/i.test(safe) || /^\\\\/.test(safe)) return false;
  if (!/^https?:\/\//i.test(safe)) return false;
  if (/localhost|127\.0\.0\.1/i.test(safe)) return false;
  return true;
};

const imageMimeType = (url = "") => {
  const clean = text(url).split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  return "";
};

const resolvePublicImageUrl = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) {
    if (/^http:\/\//i.test(raw)) {
      const https = raw.replace(/^http:\/\//i, "https://");
      return isPublicImageUrl(https) ? https : raw;
    }
    return raw;
  }
  if (/^file:\/\//i.test(raw) || /^[a-z]:[\\/]/i.test(raw) || /^\\\\/.test(raw)) return raw;
  const base = publicBaseUrl();
  if (!base) return raw;
  const path = trimSlashes(raw);
  if (!path) return "";
  return `${base}/${path}`;
};

const isCloudinaryUrl = (value = "") => /cloudinary\.com/i.test(text(value));

const buildImageCandidate = (value, source) => {
  const raw = imageCandidateValue(value);
  if (!raw) return null;
  const resolved = resolvePublicImageUrl(raw);
  return {
    source,
    raw,
    resolved,
    is_cloudinary: isCloudinaryUrl(raw) || isCloudinaryUrl(resolved),
    is_tunnel: /trycloudflare\.com/i.test(raw) || /trycloudflare\.com/i.test(resolved),
    is_public: isPublicImageUrl(resolved),
    is_absolute_public: /^https?:\/\//i.test(resolved) && isPublicImageUrl(resolved),
    is_local_upload: Boolean(raw && !/^https?:\/\//i.test(raw) && !/^file:\/\//i.test(raw) && !/^[a-z]:[\\/]/i.test(raw) && !/^\\\\/.test(raw)),
  };
};

const selectPreferredImage = (product = {}) => {
  const prioritizedCandidates = [
    buildImageCandidate(product.cloudinary_url, "cloudinary_url"),
    buildImageCandidate(product.secure_url, "secure_url"),
    buildImageCandidate(product.cloudinary?.secure_url, "cloudinary.secure_url"),
    buildImageCandidate(asArray(product.images)[0]?.secure_url, "images[0].secure_url"),
    buildImageCandidate(product.product?.cloudinary_url, "product.cloudinary_url"),
    buildImageCandidate(product.product?.secure_url, "product.secure_url"),
    buildImageCandidate(asArray(product.product?.images)[0]?.secure_url, "product.images[0].secure_url"),
    buildImageCandidate(asArray(product.product?.product_images)[0]?.secure_url, "product.product_images[0].secure_url"),
    buildImageCandidate(asArray(product.media)[0]?.secure_url, "media[0].secure_url"),
  ].filter(Boolean);
  const publicCdnCandidates = [
    buildImageCandidate(product.image_url, "image_url"),
    buildImageCandidate(product.imageUrl, "imageUrl"),
    buildImageCandidate(product.image, "image"),
    buildImageCandidate(product.main_image, "main_image"),
    buildImageCandidate(product.mainImage, "mainImage"),
    buildImageCandidate(product.variant_image, "variant_image"),
    buildImageCandidate(product.variant_image_url, "variant_image_url"),
    buildImageCandidate(product.color_image, "color_image"),
    buildImageCandidate(product.color_image_url, "color_image_url"),
    buildImageCandidate(product.product_image_url, "product_image_url"),
    buildImageCandidate(product.matched_variant_image, "matched_variant_image"),
    buildImageCandidate(product.matched_image_url, "matched_image_url"),
    buildImageCandidate(product.matched_visual_candidate?.image_url, "matched_visual_candidate.image_url"),
    buildImageCandidate(product.matched_visual_candidate?.secure_url, "matched_visual_candidate.secure_url"),
    buildImageCandidate(product.product?.image_url, "product.image_url"),
    buildImageCandidate(product.product?.main_image, "product.main_image"),
    buildImageCandidate(product.product?.image, "product.image"),
    buildImageCandidate(product.variant?.image_url, "variant.image_url"),
    buildImageCandidate(product.variant?.main_image, "variant.main_image"),
    buildImageCandidate(product.variant?.variant_image, "variant.variant_image"),
    buildImageCandidate(product.variant?.variant_image_url, "variant.variant_image_url"),
    buildImageCandidate(product.variant?.color_image, "variant.color_image"),
    buildImageCandidate(product.variant?.color_image_url, "variant.color_image_url"),
    buildImageCandidate(product.color?.image_url, "color.image_url"),
    buildImageCandidate(product.color?.main_image, "color.main_image"),
    buildImageCandidate(product.color?.color_image, "color.color_image"),
    buildImageCandidate(product.color?.color_image_url, "color.color_image_url"),
    buildImageCandidate(asArray(product.images)[0], "images[0]"),
    buildImageCandidate(asArray(product.images)[0]?.url, "images[0].url"),
    buildImageCandidate(asArray(product.media)[0], "media[0]"),
    buildImageCandidate(asArray(product.media)[0]?.url, "media[0].url"),
    buildImageCandidate(asArray(product.product_images)[0]?.image_url, "product_images[0].image_url"),
    buildImageCandidate(asArray(product.product_images)[0]?.url, "product_images[0].url"),
    buildImageCandidate(asArray(product.product?.images)[0], "product.images[0]"),
    buildImageCandidate(asArray(product.product?.product_images)[0], "product.product_images[0]"),
    buildImageCandidate(asArray(product.variant?.images)[0], "variant.images[0]"),
    buildImageCandidate(asArray(product.variant?.media)[0], "variant.media[0]"),
    buildImageCandidate(asArray(product.color?.images)[0], "color.images[0]"),
    buildImageCandidate(asArray(product.variants)[0]?.image_url, "variants[0].image_url"),
    buildImageCandidate(asArray(product.variants)[0]?.variant_image_url, "variants[0].variant_image_url"),
    buildImageCandidate(asArray(product.variants)[0]?.color_image_url, "variants[0].color_image_url"),
  ].filter(Boolean);
  const candidates = [...prioritizedCandidates, ...publicCdnCandidates];
  const selected =
    prioritizedCandidates.find((candidate) => candidate.is_cloudinary && candidate.is_public) ||
    publicCdnCandidates.find((candidate) => candidate.is_absolute_public) ||
    publicCdnCandidates.find((candidate) => candidate.is_local_upload && candidate.is_public) ||
    candidates.find((candidate) => candidate.is_public) ||
    null;
  const fallback_used = Boolean(selected && !selected.is_cloudinary);
  if (selected) {
    console.info("[image-url-selection]", {
      selected_url: selected.resolved,
      source: selected.source,
      is_cloudinary: selected.is_cloudinary,
      is_tunnel: selected.is_tunnel,
      fallback_used,
    });
    if (selected.is_tunnel) {
      console.warn("[image-url-warning]", {
        reason: "tunnel_url_used",
        selected_url: selected.resolved,
        source: selected.source,
      });
    }
  }
  return {
    selected_url: selected?.resolved || "",
    raw_url: selected?.raw || "",
    source: selected?.source || "",
    is_cloudinary: selected?.is_cloudinary === true,
    fallback_used,
  };
};

const imageCandidateValue = (value) => {
  if (Array.isArray(value)) return imageCandidateValue(value[0]);
  if (value && typeof value === "object") {
    return text(
      value.cloudinary_url ||
        value.secure_url ||
        value.image_url ||
        value.main_image ||
        value.variant_image ||
        value.variant_image_url ||
        value.color_image ||
        value.color_image_url ||
        value.url ||
        value.path ||
        value.src ||
        value.image
    );
  }
  return text(value);
};

const productImageCandidates = (product = {}) => {
  const selected = selectPreferredImage(product);
  return [selected.raw_url || selected.selected_url].filter(Boolean);
};

const productCardImageUrl = (product = {}) =>
  text(selectPreferredImage(product).selected_url || "");

const productCardImagesCount = (product = {}) =>
  [
    product.images,
    product.media,
    product.product_images,
    product.product?.images,
    product.product?.product_images,
    product.variant?.images,
    product.variant?.media,
    product.color?.images,
    product.variants,
  ].reduce((total, value) => total + asArray(value).length, 0);

const productCardName = (product = {}) =>
  text(product.name || product.title || product.product_name || product.base_name || "Product").slice(0, 120);

const productCardPrice = (product = {}) => {
  const parsed = Number(product.final_price || product.sale_price || product.price || product.regular_price || product.product_price || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed).toLocaleString("en-US") : "";
};

const productCardSizes = (product = {}) =>
  [
    ...asArray(product.available_sizes),
    ...asArray(product.sizes),
    ...asArray(product.inventory_profile?.available_sizes),
    ...asArray(product.variants).map((variant) => variant?.size),
    product.size,
    product.requested_size,
  ]
    .flatMap((value) => text(value).split(","))
    .map(text)
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index)
    .slice(0, 8);

const productCardUrl = (product = {}) => text(product.product_url || product.url || product.productUrl);

const formatWhatsAppCaptionSizes = (sizes = []) =>
  [...new Set(asArray(sizes).map((value) => text(value)).filter(Boolean))];

const resolveImageCardPrice = (product = {}) => {
  const variant = product.selected_variant || product.variant || product.matched_variant || {};
  const candidateSources = [
    { source: "selected_variant.display_price", value: variant?.display_price },
    { source: "selected_variant.sale_price", value: variant?.sale_price, saleActive: true },
    { source: "selected_variant.selling_price", value: variant?.selling_price },
    { source: "variant.display_price", value: product?.variant?.display_price },
    { source: "variant.sale_price", value: product?.variant?.sale_price, saleActive: true },
    { source: "variant.selling_price", value: product?.variant?.selling_price },
    { source: "matched_variant.display_price", value: product?.matched_variant?.display_price },
    { source: "matched_variant.sale_price", value: product?.matched_variant?.sale_price, saleActive: true },
    { source: "matched_variant.selling_price", value: product?.matched_variant?.selling_price },
  ];
  for (const candidate of candidateSources) {
    const parsed = Number(candidate.value);
    if (Number.isFinite(parsed) && parsed > 0) {
      debugAiImagesLog("[image-card-price-source]", {
        product_id: text(product?.product_id || product?.id || ""),
        variant_id: text(variant?.id || variant?.variant_id || product?.variant_id || product?.selected_variant_id || product?.matched_variant_id || ""),
        color: text(product?.color || product?.matched_variant_color || variant?.color || ""),
        selling_price: Number.isFinite(Number(variant?.selling_price)) && Number(variant?.selling_price) > 0 ? Number(variant?.selling_price) : null,
        sale_price: Number.isFinite(Number(variant?.sale_price)) && Number(variant?.sale_price) > 0 ? Number(variant?.sale_price) : null,
        display_price: parsed,
        price_source: candidate.source,
      });
      return Math.round(parsed).toLocaleString("en-US");
    }
  }
  return "";
};

const productImageCaption = (product = {}) => {
  const sizes = formatWhatsAppCaptionSizes(product.available_sizes || product.sizes);
  const sizesLine = sizes.length ? `المقاسات المتاحة: ${sizes.join("، ")}` : "";
  const price = resolveImageCardPrice(product) || productCardPrice(product);
  return [
    productCardName(product),
    sizesLine,
    price ? `السعر: ${price} جنيه` : "",
    productCardUrl(product),
  ].filter(Boolean).join("\n").slice(0, 1024);
};

const summarizeWhatsappProductCards = (cards = []) => {
  const items = asArray(cards).filter(Boolean);
  if (!items.length) return "";
  return items
    .slice(0, 3)
    .map((card) =>
      [
        productCardName(card),
        text(card.color || card.color_name || card.matched_variant_color || ""),
        text(card.size || card.size_name || ""),
        productCardPrice(card) ? `${productCardPrice(card)} جنيه` : "",
      ]
        .filter(Boolean)
        .join(" - ")
    )
    .filter(Boolean)
    .join(" | ")
    .slice(0, 300);
};

const resolveCaptionVariant = (product = {}) => {
  const variantId = text(product?.selected_variant_id || product?.variant_id || product?.matched_variant_id || product?.selected_variant?.id || product?.selected_variant?.variant_id || "");
  const variants = asArray(product?.variants);
  if (!variants.length) return product?.selected_variant || product?.variant || product?.matched_variant || null;
  if (variantId) {
    const exact = variants.find((variant) => String(variant.id || variant.variant_id || "") === String(variantId));
    if (exact) return exact;
  }
  const color = text(product?.color || product?.matched_variant_color || "").toLowerCase();
  if (color) {
    const byColor = variants.find((variant) => text(variant.color || variant.color_name || variant.color_value).toLowerCase() === color);
    if (byColor) return byColor;
  }
  return product?.selected_variant || product?.variant || product?.matched_variant || variants[0] || null;
};
const buildWhatsappOutboundPlan = ({ message = {}, aiPayload = {}, replyText = "", cards = [] } = {}) => {
  const conversationId = text(message.inbox?.session_id || message.sessionId || `whatsapp:${message.phone || ""}`);
  const inboundMessageId = text(message.messageId || message.message_id || message.external_message_id || "");
  const messageText = text(message.message_text || message.text || aiPayload?.message_text || "");
  const wantsAllImages =
    ["more_images", "image_request"].includes(text(aiPayload?.detected_intent || aiPayload?.intent?.type || aiPayload?.intent || "")) &&
    /صور|كلها|الوان|ألوان|صورهم|كل الصور/i.test(messageText || "");
  const inputCards = asArray(cards);
  const productSource = inputCards.find((card) => Array.isArray(card?.variants) && card.variants.length) || inputCards.find((card) => card?.product && Array.isArray(card.product.variants) && card.product.variants.length) || inputCards[0] || null;
  const expandedCards = wantsAllImages
    ? inputCards
    : (productSource ? normalizeProductCards([productSource.product || productSource], { limit: 1 }) : inputCards);
  const collapseReason = wantsAllImages
    ? (inputCards.length > expandedCards.length ? "normalize_or_source_limit" : "all_images_preserved")
    : (inputCards.length > expandedCards.length ? "input_to_product_source_reduction" : "no_collapse");
  const selectionSourceCards = wantsAllImages ? inputCards : expandedCards;
  const selectedProductIds = [...new Set(selectionSourceCards.map((card) => text(card?.product_id || card?.id || card?.product?.id || "")).filter(Boolean))];
  const selectedVariantIds = [...new Set(selectionSourceCards.map((card) => text(card?.variant_id || card?.selected_variant_id || card?.variant?.id || card?.variant?.variant_id || "")).filter(Boolean))];
  const hasCards = expandedCards.length > 0;
  const intent = text(aiPayload?.detected_intent || aiPayload?.intent?.type || aiPayload?.intent || "");
  const route = hasCards ? "product_cards_only" : "text_only";
  const outboundPlan = {
    conversation_id: conversationId,
    inbound_message_id: inboundMessageId,
    channel: "whatsapp",
    instance: instanceName(),
    remoteJid: text(message.remoteJid || message.phone || ""),
    intent,
    route,
    text: hasCards ? "" : text(replyText),
    cards: expandedCards,
    has_cards: hasCards,
    will_send_text: !hasCards && Boolean(text(replyText)),
    will_send_cards: hasCards,
    selected_product_ids: selectedProductIds,
    selected_variant_ids: selectedVariantIds,
  };
  console.log("[whatsapp-outbound-plan]", {
    conversation_id: outboundPlan.conversation_id,
    inbound_message_id: outboundPlan.inbound_message_id,
    intent: outboundPlan.intent,
    route: outboundPlan.route,
    text_length: outboundPlan.text.length,
    cards_count: outboundPlan.cards.length,
    will_send_text: outboundPlan.will_send_text,
    will_send_cards: outboundPlan.will_send_cards,
    selected_product_ids: outboundPlan.selected_product_ids,
    selected_variant_ids: outboundPlan.selected_variant_ids,
  });
  return outboundPlan;
};

const ensureWhatsappOutboundDedupSchema = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_outbound_dedup (
      id uuid PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
      channel text NOT NULL,
      instance text,
      conversation_id text NOT NULL,
      inbound_message_id text NOT NULL,
      outbound_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE(channel, instance, conversation_id, inbound_message_id)
    )
  `).catch(() => {});
};

const blockDuplicateWhatsappReply = async ({ tenantId = 0, plan = {}, outboundType = "unknown" } = {}) => {
  const channel = text(plan.channel || "whatsapp");
  const instance = text(plan.instance || "");
  const conversationId = text(plan.conversation_id || "");
  const inboundMessageId = text(plan.inbound_message_id || "");
  const safeTenantId = number(tenantId, 0);
  if (!conversationId || !inboundMessageId) return { blocked: false };
  await ensureWhatsappOutboundDedupSchema();
  try {
    await db.query(
      `
      INSERT INTO ai_outbound_dedup (channel, instance, conversation_id, inbound_message_id, outbound_type)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (channel, instance, conversation_id, inbound_message_id) DO NOTHING
      `,
      [channel, instance || null, conversationId, inboundMessageId, outboundType]
    );
    const result = await db.query(
      `
      SELECT COUNT(*)::int AS count
      FROM ai_outbound_dedup
      WHERE channel = $1 AND instance IS NOT DISTINCT FROM $2 AND conversation_id = $3 AND inbound_message_id = $4
      `,
      [channel, instance || null, conversationId, inboundMessageId]
    );
    if (Number(result.rows[0]?.count || 0) > 1) {
      console.warn("[whatsapp-duplicate-reply-blocked]", {
        conversation_id: conversationId,
        inbound_message_id: inboundMessageId,
        channel,
        instance,
      });
      await logAIPersistentEvent({
        tenantId: safeTenantId,
        category: "duplicate_prevention",
        eventType: "whatsapp_duplicate_reply_blocked",
        conversationId,
        channel,
        source: "whatsappGatewayService.blockDuplicateWhatsappReply",
        reason: "duplicate_reply",
        message: "WhatsApp duplicate reply blocked",
        metadata: {
          instance: instance || "",
          inbound_message_id: inboundMessageId,
        },
      });
      return { blocked: true, reason: "duplicate_reply" };
    }
    return { blocked: false };
  } catch (error) {
    if (String(error?.code || "") === "23505") {
      console.warn("[whatsapp-duplicate-reply-blocked]", {
        conversation_id: conversationId,
        inbound_message_id: inboundMessageId,
        channel,
        instance,
      });
      await logAIPersistentEvent({
        tenantId: safeTenantId,
        category: "duplicate_prevention",
        eventType: "whatsapp_duplicate_reply_blocked",
        conversationId,
        channel,
        source: "whatsappGatewayService.blockDuplicateWhatsappReply",
        reason: "duplicate_reply",
        message: "WhatsApp duplicate reply blocked",
        metadata: {
          instance: instance || "",
          inbound_message_id: inboundMessageId,
          error_code: error?.code || "",
        },
      });
      return { blocked: true, reason: "duplicate_reply" };
    }
    throw error;
  }
};

const productImageUrlFallbackMessage = ({ imageUrl = "", productUrl = "" } = {}) =>
  [
    "دي صورة المنتج يا فندم:",
    text(imageUrl),
    text(productUrl),
  ].filter(Boolean).join("\n");

const productImageDebugCard = (item = {}) => {
  const product = item.product || item;
  const rawImageUrl = item.raw_image_url || text(productImageCandidates(product).find((candidate) => text(candidate)) || "");
  const resolvedImageUrl = item.resolved_image_url || resolvePublicImageUrl(rawImageUrl);
  const publicImageUrl = isPublicImageUrl(resolvedImageUrl);
  return {
    product_id: product?.product_id || product?.id || product?.product?.id || null,
    product_name: productCardName(product),
    color: text(product?.color || product?.matched_variant_color || product?.variant?.color || product?.color?.name),
    image_url: text(product?.image_url),
    image: text(product?.image),
    main_image: text(product?.main_image || product?.product?.main_image),
    variant_image: text(product?.variant_image || product?.variant?.variant_image || product?.variant?.image_url),
    color_image: text(product?.color_image || product?.color?.image_url || product?.color?.color_image),
    cloudinary_url: text(product?.cloudinary_url || product?.product?.cloudinary_url),
    images_count: productCardImagesCount(product),
    resolved_image_url: resolvedImageUrl,
    is_public_image_url: publicImageUrl,
    skip_reason: item.skip_reason || (publicImageUrl ? "" : (resolvedImageUrl ? "invalid_private_url" : "missing_image_url")),
  };
};

const imageCardDedupeKey = (card = {}) => {
  const productId = text(card?.product_id || card?.id || card?.product?.id || "");
  const variantId = text(card?.variant_id || card?.selected_variant_id || card?.variant?.id || card?.variant?.variant_id || card?.matched_variant_id || "");
  const color = text(card?.color || card?.matched_variant_color || card?.variant?.color || "").toLowerCase().replace(/\s+/g, " ").trim();
  const imageUrl = text(card?.resolved_image_url || card?.imageUrl || card?.image_url || card?.product?.image_url || card?.product?.main_image || "");
  if (productId && color) return `product-color:${productId}:${color}`;
  if (variantId) return `variant:${productId}:${variantId}`;
  if (productId && imageUrl) return `product-image:${productId}:${normalizeDuplicateImageUrl(imageUrl)}`;
  return "";
};

const collectProductImageCards = ({ generated = {} } = {}) => {
  const finalCards = asArray(
    generated?.aiPayload?.whatsapp_image_cards?.length
      ? generated.aiPayload.whatsapp_image_cards
      : generated?.whatsapp_image_cards?.length
        ? generated.whatsapp_image_cards
      : generated?.reply?.product_cards?.length
        ? generated.reply.product_cards
        : generated?.aiPayload?.channel_reply?.product_cards?.length
          ? generated.aiPayload.channel_reply.product_cards
          : generated?.aiPayload?.suggested_products?.length
            ? generated.aiPayload.suggested_products
            : generated?.aiPayload?.product_cards || []
  );
  return finalCards.map((product, cardIndex) => {
    const rawImageUrl = text(productImageCandidates(product).find((candidate) => text(candidate)) || "");
    const resolvedImageUrl = resolvePublicImageUrl(rawImageUrl);
    return {
      product,
      card_index: cardIndex,
      imageUrl: resolvedImageUrl,
      raw_image_url: rawImageUrl,
      resolved_image_url: resolvedImageUrl,
      mime_type: imageMimeType(resolvedImageUrl),
      valid: Boolean(resolvedImageUrl),
      normalized_image_url: normalizeDuplicateImageUrl(resolvedImageUrl),
      dedupe_key: imageCardDedupeKey({ ...product, resolved_image_url: resolvedImageUrl, imageUrl: resolvedImageUrl }),
      skip_reason: resolvedImageUrl ? "" : "missing_image_url",
      variant_id: text(product?.variant_id || product?.selected_variant_id || product?.variant?.id || product?.variant?.variant_id || product?.matched_variant_id || ""),
      color: text(product?.color || product?.matched_variant_color || product?.variant?.color || ""),
      selected_variant: product?.selected_variant || product?.variant || product?.matched_variant || null,
    };
  });
};

const shouldSendProductImages = (generated = {}) => {
  const responseType = text(
    generated.aiPayload?.response_type ||
      generated.aiPayload?.reply_generation?.response_type ||
      generated.aiPayload?.debug?.response_type ||
      generated.aiPayload?.channel_reply?.response_type ||
      generated.reply?.response_type
  ).toLowerCase();
  const intent = text(generated.aiPayload?.detected_intent || generated.aiPayload?.intent?.type || generated.aiPayload?.intent).toLowerCase();
  const hasCards = Boolean(
    generated.reply?.product_cards?.length ||
      generated.aiPayload?.channel_reply?.product_cards?.length ||
      generated.aiPayload?.suggested_products?.length ||
      generated.aiPayload?.product_cards?.length
  );
  if (!hasCards) return false;
  if (["greeting", "greeting_only", "general", "fallback", "conversational", "sales_discovery"].includes(intent)) return false;
  if (["fallback", "greeting", "discovery", "sales_discovery"].includes(responseType)) return false;
  return responseType === "product_card" || Boolean(generated.reply?.product_cards?.length || generated.aiPayload?.channel_reply?.product_cards?.length);
};

const imageFailureLogPayload = ({
  generated = {},
  product = {},
  cardIndex = 0,
  imageUrl = "",
  resolvedImageUrl = "",
  mimeType = "",
  error = null,
  reason = "",
} = {}) => {
  const summary = error ? errorSummary(error) : {};
  const safeResolved = text(resolvedImageUrl || imageUrl);
  return {
    conversation_id: generated.sessionId || "",
    session_id: generated.sessionId || "",
    product_id: product?.id || product?.product_id || null,
    product_name: productCardName(product),
    card_index: cardIndex,
    image_url: text(imageUrl),
    resolved_image_url: safeResolved,
    mime_type: mimeType || imageMimeType(safeResolved),
    http_status: summary.status || "",
    error_message: reason || summary.message || "",
    evolution_response: summary.data || null,
    has_image_url: Boolean(text(imageUrl || resolvedImageUrl)),
    is_cloudinary_url: /cloudinary\.com/i.test(safeResolved),
    is_public_http_url: isPublicImageUrl(safeResolved),
  };
};

const firstProductLink = (cards = []) =>
  asArray(cards).map((item) => productCardUrl(item.product || item)).find(Boolean) || "";

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

const extractMessageText = (data = {}, payload = {}) => {
  const root = { data, payload };
  const directPaths = [
    "data.message.conversation",
    "data.message.extendedTextMessage.text",
    "data.message.imageMessage.caption",
    "data.message.videoMessage.caption",
    "data.body",
    "data.text",
    "data.messageText",
    "data.content",
    "data.messages[0].message.conversation",
    "data.messages[0].message.extendedTextMessage.text",
    "payload.data[0].message.conversation",
    "payload.data[0].message.extendedTextMessage.text",
    "payload.body.data.message.conversation",
    "payload.body.data.message.extendedTextMessage.text",
  ];
  for (const path of directPaths) {
    const value = text(getPathValue(root, path));
    if (value) {
      console.info("[evolution:recursive-text-found]", { path, textPreview: value.slice(0, 160), direct: true });
      return value;
    }
  }
  const recursiveKeys = new Set(["conversation", "text", "caption", "body", "messageText", "content"]);
  const found = collectStringsWithPaths(root).find((item) => {
    const key = item.path.split(".").pop()?.replace(/\[\d+\]$/g, "");
    return recursiveKeys.has(key) && text(item.value);
  });
  if (found) {
    console.info("[evolution:recursive-text-found]", { path: found.path, textPreview: found.value.slice(0, 160), direct: false });
    return found.value;
  }
  return "";
};

export const extractWhatsappMediaDescriptor = (payload = {}) => {
  const data = primaryEvolutionData(payload);
  let message = data?.message || data?.messages?.[0]?.message || payload?.body?.data?.message || payload?.body?.message || payload?.message || {};
  const wrapperKeys = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage"];
  for (let index = 0; index < 5; index += 1) {
    const wrapperKey = wrapperKeys.find((key) => message?.[key]);
    if (!wrapperKey) break;
    message = message[wrapperKey]?.message || message[wrapperKey] || {};
  }
  const definitions = [
    ["imageMessage", "image", "📷 صورة"],
    ["audioMessage", "audio", "🎤 رسالة صوتية"],
    ["videoMessage", "video", "🎬 فيديو"],
    ["documentMessage", "document", "📎 ملف"],
    ["documentWithCaptionMessage", "document", "📎 ملف"],
    ["stickerMessage", "sticker", "🖼️ ملصق"],
  ];
  const match = definitions.find(([key]) => message?.[key]);
  if (!match) return { type: "", label: "", url: "", mimeType: "", fileName: "", durationSeconds: 0, visualAttachments: [] };
  const [key, type, label] = match;
  const media = message[key] || {};
  const rawUrl = text(media.url || media.mediaUrl || media.media_url || data?.mediaUrl || data?.media_url || "");
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : "";
  const mimeType = text(media.mimetype || media.mimeType || media.mime_type || "");
  const fileName = text(media.fileName || media.filename || media.file_name || "");
  const durationSeconds = number(media.seconds || media.duration || media.durationSeconds || 0, 0);
  const visualAttachments = url ? [{ type, media_type: type, url, media_url: url, mime_type: mimeType, file_name: fileName, duration_seconds: durationSeconds }] : [];
  return { type, label, url, mimeType, fileName, durationSeconds, visualAttachments };
};

const whatsappMediaExtension = (mimeType = "", mediaType = "") => {
  const normalizedMime = text(mimeType).toLowerCase().split(";")[0];
  const byMime = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
  };
  return byMime[normalizedMime] || ({ image: "jpg", audio: "ogg", video: "mp4", document: "bin", sticker: "webp" }[mediaType] || "bin");
};

const whatsappMediaPublicBaseUrl = () => text(
  process.env.PUBLIC_BACKEND_URL || process.env.PUBLIC_BASE_URL || process.env.WEBHOOK_PUBLIC_URL || ""
).replace(/\/api\/?$/i, "").replace(/\/+$/g, "");

const materializeEvolutionWebhookMedia = async ({ payload = {}, descriptor = {}, messageId = "", instance = "" } = {}) => {
  if (!descriptor?.type || !messageId) return descriptor;
  const publicBaseUrl = whatsappMediaPublicBaseUrl();
  if (!publicBaseUrl) return descriptor;
  try {
    const media = await evolutionFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance || instanceName())}`, {
      method: "POST",
      body: JSON.stringify({ message: primaryEvolutionData(payload) }),
    });
    const base64 = text(media?.base64 || media?.data?.base64 || "");
    if (!base64) return descriptor;
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > 30 * 1024 * 1024) {
      console.warn("[whatsapp:media-materialize-skipped]", { message_id: messageId, size: bytes.length, reason: "invalid_size" });
      return descriptor;
    }
    const mimeType = text(media?.mimetype || descriptor.mimeType || "");
    const extension = whatsappMediaExtension(mimeType, descriptor.type);
    const safeMessageId = text(messageId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120) || crypto.randomUUID();
    const directory = path.join(process.cwd(), "uploads", "whatsapp-media");
    await fs.mkdir(directory, { recursive: true });
    const fileName = `${safeMessageId}.${extension}`;
    await fs.writeFile(path.join(directory, fileName), bytes);
    const url = `${publicBaseUrl}/uploads/whatsapp-media/${fileName}`;
    return {
      ...descriptor,
      url,
      mimeType,
      fileName: descriptor.fileName || text(media?.fileName || fileName),
      visualAttachments: [{
        type: descriptor.type,
        media_type: descriptor.type,
        url,
        media_url: url,
        mime_type: mimeType,
        file_name: descriptor.fileName || text(media?.fileName || fileName),
        duration_seconds: descriptor.durationSeconds || 0,
      }],
    };
  } catch (error) {
    console.warn("[whatsapp:media-materialize-failed]", { message_id: messageId, type: descriptor.type, message: error?.message || String(error) });
    return descriptor;
  }
};

const extractWhatsappWebhookEnvelope = (payload = {}) => {
  const data = primaryEvolutionData(payload);
  const key = data?.key || payload?.key || {};
  const eventCandidates = [
    payload?.event,
    payload?.type,
    payload?.name,
    payload?.body?.event,
    payload?.body?.type,
    data?.event,
    data?.type,
    data?.name,
    data?.event_name,
    data?.eventName,
    data?.webhookEvent,
    data?.webhook_event,
    data?.action,
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  const rawEvent = text(eventCandidates[0] || "");
  const remoteJid = text(
    key?.remoteJid ||
    data?.remoteJid ||
    data?.remote_jid ||
    data?.chatId ||
    data?.chat_id ||
    data?.conversationId ||
    data?.conversation_id ||
    data?.from ||
    data?.sender ||
    data?.participant ||
    data?.number ||
    findFirstString(data, ["remoteJid", "remote_jid", "from", "sender", "participant", "number", "phone"]) ||
    findFirstString(payload, ["remoteJid", "remote_jid", "from", "sender", "number", "phone"])
  );
  const fromMe = boolValue(key?.fromMe ?? data?.fromMe ?? data?.from_me ?? payload?.fromMe);
  const sender = text(data?.sender || payload?.sender || "");
  const participant = text(key?.participant || data?.key?.participant || data?.participant || payload?.participant || "");
  const ownerJids = ownerJidsFromPayload({ payload, data, fromMe });
  const ownerJid = ownerJids[0] || "";
  const configuredBotNumber = ownerNumberFromJids(ownerJids);
  const isGroup = isGroupConversationContext(
    remoteJid,
    sender,
    participant,
    key?.remoteJid,
    data?.remoteJid,
    data?.remote_jid,
    data?.chatId,
    data?.chat_id,
    data?.conversationId,
    data?.conversation_id,
    payload?.chatId,
    payload?.chat_id,
    payload?.conversationId,
    payload?.conversation_id
  );
  return {
    data,
    key,
    event: rawEvent.toLowerCase().replace(/[_\s]+/g, ".") || rawEvent,
    rawEvent,
    eventCandidates,
    remoteJid,
    sender,
    participant,
    fromMe,
    isGroup,
    ownerJid,
    configuredBotNumber,
    instance: text(payload?.instance || payload?.instanceName || data?.instance || data?.instanceName || instanceName()),
    messageId: text(
      key?.id ||
      data?.messageId ||
      data?.message_id ||
      data?.id ||
      data?.messages?.[0]?.id ||
      findFirstString(data, ["messageId", "message_id", "message_id", "id", "mid"])
    ),
    timestamp: parseWhatsappTimestamp(
      data?.messageTimestamp ||
      data?.timestamp ||
      data?.date_time ||
      payload?.date_time ||
      payload?.timestamp
    ),
  };
};

const extractIncomingWhatsapp = async (payload = {}) => {
  const data = primaryEvolutionData(payload);
  const key = data?.key || payload?.key || {};
  const eventCandidates = [
    payload?.event,
    payload?.type,
    payload?.name,
    payload?.body?.event,
    payload?.body?.type,
    data?.event,
    data?.type,
    data?.name,
    data?.event_name,
    data?.eventName,
    data?.webhookEvent,
    data?.webhook_event,
    data?.action,
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  const rawEvent = text(eventCandidates[0] || "");
  const normalizedEvent = rawEvent.toLowerCase().replace(/[_\s]+/g, ".");
  const remoteJid = text(
    key?.remoteJid ||
    data?.remoteJid ||
    data?.remote_jid ||
    data?.chatId ||
    data?.chat_id ||
    data?.conversationId ||
    data?.conversation_id ||
    data?.from ||
    data?.sender ||
    data?.participant ||
    data?.number ||
    findFirstString(data, ["remoteJid", "remote_jid", "from", "sender", "participant", "number", "phone"]) ||
    findFirstString(payload, ["remoteJid", "remote_jid", "from", "sender", "number", "phone"])
  );
  const fromMe = boolValue(key?.fromMe ?? data?.fromMe ?? data?.from_me ?? payload?.fromMe);
  const sender = text(data?.sender || payload?.sender || "");
  const participant = text(key?.participant || data?.key?.participant || data?.participant || payload?.participant || "");
  let replyTarget = resolveWhatsappReplyTarget({ payload, data, key, remoteJid, fromMe });
  if (fromMe === false && isLidJid(remoteJid) && !replyTarget.resolvedNumber) {
    const storedReplyTarget = await resolveStoredLidReplyTarget({
      tenantId: tenantIdForWhatsapp(payload),
      remoteJid,
      ownerJids: ownerJidsFromPayload({ payload, data, fromMe }),
      base: replyTarget,
    });
    if (storedReplyTarget) replyTarget = storedReplyTarget;
  }
  const phone = replyTarget.resolvedNumber || (isLidJid(remoteJid) ? "" : normalizeEgyptPhone(jidNumber(remoteJid)));
  const isGroup = Boolean(replyTarget.isGroup || isGroupConversationContext(
    remoteJid,
    sender,
    participant,
    key?.remoteJid,
    data?.remoteJid,
    data?.remote_jid,
    data?.chatId,
    data?.chat_id,
    data?.conversationId,
    data?.conversation_id,
    payload?.chatId,
    payload?.chat_id,
    payload?.conversationId,
    payload?.conversation_id
  ));
  console.info("[whatsapp:reply-target-resolution]", {
    remoteJid,
    participant: replyTarget.participant,
    sender: replyTarget.sender,
    fromMe,
    connectedOwnerJid: replyTarget.connectedOwnerJid,
    instanceOwnerJid: replyTarget.instanceOwnerJid,
    ownerJid: replyTarget.ownerJid,
    configuredBotNumber: replyTarget.configuredBotNumber,
    resolvedJid: replyTarget.resolvedJid,
    resolvedNumber: replyTarget.resolvedNumber,
    reason: replyTarget.reason,
    isGroup,
    isLid: replyTarget.isLid,
  });
  let messageId = text(
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
  const customerAvatarUrl = extractEvolutionProfilePictureUrl({ data, payload });
  const messageText = extractMessageText(data, payload);
  const intentPayload = normalizeArabicIntentPayload(messageText);
  const normalizedMessage = intentPayload.normalizedText || normalizeArabicMessage(messageText);
  const normalizedForIntent = intentPayload.normalizedForIntent || normalizeArabicForIntent(messageText);
  const productAlias = resolveProductAlias(messageText || normalizedForIntent);
  const aliasSearchHints = buildAliasAwareSearchHints({ text: messageText || normalizedForIntent, aliasResult: productAlias });
  const conversationId = text(
    payload?.external_conversation_id ||
    payload?.conversation_id ||
    data?.conversationId ||
    data?.conversation_id ||
    data?.sessionId ||
    data?.chatId ||
    ""
  );
  const runtimeConversationMemory = conversationId ? getConversationMemory(conversationId) || {} : {};
  const conversationMemoryV2 = runtimeConversationMemory?.preferences?.aiConversationMemoryV2 || runtimeConversationMemory?.aiConversationMemoryV2 || null;
  const followupContextV2 = resolveFollowupContext({
    memory: conversationMemoryV2,
    messageText,
    normalizedPayload: intentPayload,
    intentPayload,
  });
  console.log("[arabic-normalizer]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: messageText,
    normalized: normalizedMessage,
    normalizedForIntent,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  console.log("[arabic-intent-signals]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: messageText,
    normalizedText: normalizedMessage,
    normalizedForIntent,
    canonicalSignals: intentPayload.canonicalSignals,
  });
  console.log("[product-alias]", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: messageText,
    normalizedText: normalizedMessage,
    canonicalProduct: productAlias.canonicalProduct,
    matchedAlias: productAlias.matchedAlias,
    confidence: productAlias.confidence,
  });
  console.log("[alias-aware-product-search]", {
    original: messageText,
    canonicalProduct: aliasSearchHints.canonicalProduct,
    searchTerms: aliasSearchHints.searchTerms,
    productQueryHints: aliasSearchHints.productQueryHints,
    usedAliasHint: aliasSearchHints.hasAliasHint,
    fallbackUsed: true,
    matchedProductId: null,
    matchedProductName: "",
    confidence: productAlias.confidence || 0,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
  });
  console.log("[conversation-memory-v2]", {
    conversationId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    original: messageText,
    normalizedText: normalizedMessage,
    memoryBeforeSummary: summarizeConversationMemoryV2(conversationMemoryV2),
    followupType: followupContextV2.type || "none",
    resolvedProductId: followupContextV2.productId || null,
    resolvedColor: followupContextV2.color || "",
    resolvedSize: followupContextV2.size || "",
    memoryUpdated: Boolean(followupContextV2.type && followupContextV2.type !== "none"),
  });
  if (!messageId && messageText) {
    messageId = `synthetic:${crypto.createHash("sha256").update([normalizedEvent || rawEvent, remoteJid, phone, messageText].map(text).join("|")).digest("hex").slice(0, 24)}`;
  }
  return {
    event: normalizedEvent || rawEvent,
    rawEvent,
    eventCandidates,
    phone,
    remoteJid,
    resolvedReplyJid: replyTarget.resolvedJid,
    resolvedPhone: replyTarget.resolvedNumber,
    replyTargetReason: replyTarget.reason,
    participant: replyTarget.participant,
    sender: replyTarget.sender,
    connectedOwnerJid: replyTarget.connectedOwnerJid,
    instanceOwnerJid: replyTarget.instanceOwnerJid,
    ownerJid: replyTarget.ownerJid,
    configuredBotNumber: replyTarget.configuredBotNumber,
    isGroup,
    isLid: replyTarget.isLid,
    text: messageText,
    original_message: messageText,
    normalized_message: normalizedMessage,
    normalized_for_intent: normalizedForIntent,
    canonical_signals: intentPayload.canonicalSignals,
    intent_tokens: intentPayload.intentTokens,
    productAliasDetected: Boolean(productAlias.canonicalProduct),
    canonicalProduct: productAlias.canonicalProduct,
    matchedAlias: productAlias.matchedAlias,
    aliasConfidence: productAlias.confidence,
    productQueryHints: aliasSearchHints.productQueryHints,
    aliasSearchTerms: aliasSearchHints.searchTerms,
    aiConversationMemoryV2: conversationMemoryV2,
    followup_context_v2: followupContextV2,
    senderName,
    customerAvatarUrl,
    messageId,
    timestamp,
    instance,
    fromMe,
    conversationId,
    raw: payload,
  };
};

const normalizeEvolutionWebhookEvent = (value = "") => text(value).toLowerCase().replace(/[_\s]+/g, ".");

export const getEvolutionStatusUpdateDecision = (payload = {}, envelope = null) => {
  const data = primaryEvolutionData(payload);
  const normalizedEvent = normalizeEvolutionWebhookEvent(envelope?.event || envelope?.rawEvent || payload?.event || payload?.type || payload?.name || data?.event || data?.type || data?.name || "");
  const eventSources = [
    envelope?.rawEvent,
    payload?.event,
    payload?.type,
    payload?.name,
    data?.event,
    data?.type,
    data?.name,
    data?.status,
    ...(Array.isArray(data?.statuses) ? data.statuses.map((item) => item?.status) : []),
    ...(Array.isArray(payload?.statuses) ? payload.statuses.map((item) => item?.status) : []),
  ]
    .map((value) => text(value).toLowerCase())
    .join(" ");
  const hasStatusesPayload = Array.isArray(data?.statuses) || Array.isArray(payload?.statuses);
  const hasStatusField = ["sent", "delivered", "read", "failed", "delivery_ack", "ack"].includes(text(data?.status).toLowerCase());
  const hasDeliveryAck = eventSources.includes("delivery_ack") || eventSources.includes("delivery.ack");
  const hasStatusEvent = eventSources.includes("status.update") || eventSources.includes("messages.status") || eventSources.includes("message.status");
  const isMessagesUpdate = normalizedEvent === "messages.update" || eventSources.includes("messages.update") || eventSources.includes("message.update");
  const isFromMe = envelope?.fromMe === true;
  const hasMessageContent = Boolean(extractMessageText(data, payload) || extractWhatsappMediaDescriptor(payload).type);

  if (normalizedEvent === "messages.upsert" && envelope?.fromMe === false) {
    return {
      isStatusUpdate: false,
      reason: "inbound_messages_upsert",
      normalizedEvent,
      indicators: { isMessagesUpdate, hasDeliveryAck, hasStatusEvent, hasStatusesPayload, hasStatusField, isFromMe },
    };
  }

  const isStatusUpdate =
    isMessagesUpdate ||
    hasDeliveryAck ||
    hasStatusEvent ||
    hasStatusesPayload ||
    (isFromMe && hasStatusField && !hasMessageContent);

  return {
    isStatusUpdate,
    reason: isMessagesUpdate
      ? "messages_update"
      : hasDeliveryAck
        ? "delivery_ack"
        : hasStatusEvent
          ? "status_event"
          : hasStatusesPayload
            ? "status_payload"
            : isFromMe && hasStatusField
              ? "from_me_outbound_ack"
              : "not_status_update",
    normalizedEvent,
    indicators: {
      isMessagesUpdate,
      hasDeliveryAck,
      hasStatusEvent,
      hasStatusesPayload,
      hasStatusField,
      isFromMe,
      hasMessageContent,
    },
  };
};

const isEvolutionStatusUpdatePayload = (payload = {}, envelope = null) => getEvolutionStatusUpdateDecision(payload, envelope).isStatusUpdate;

const normalizeEvolutionDeliveryStatus = (value = "") => {
  const status = text(value).toLowerCase();
  if (!status) return "sent";
  if (status.includes("delivery_ack") || status === "ack" || status === "sent") return "sent";
  if (status.includes("deliver")) return "delivered";
  if (status.includes("read")) return "read";
  if (status.includes("fail") || status.includes("error")) return "failed";
  return status;
};

const processEvolutionStatusUpdate = async (payload = {}) => {
  const data = primaryEvolutionData(payload);
  const envelope = extractWhatsappWebhookEnvelope(payload);
  const statusItem = Array.isArray(data?.statuses) ? data.statuses[0] : (data?.statuses || payload?.statuses?.[0] || null);
  const providerMessageId = text(
    statusItem?.id ||
    statusItem?.messageId ||
    statusItem?.message_id ||
    statusItem?.key?.id ||
    data?.key?.id ||
    envelope.messageId ||
    data?.messageId ||
    data?.message_id ||
    data?.id
  );
  const remoteJid = text(
    statusItem?.key?.remoteJid ||
    statusItem?.remoteJid ||
    data?.remoteJid ||
    data?.remote_jid ||
    envelope.remoteJid ||
    ""
  );
  const resolvedPhone = remoteJid && !isLidJid(remoteJid) ? normalizeEgyptPhone(jidNumber(remoteJid)) : "";
  const sessionId = normalizeWhatsappSessionId(
    payload?.external_conversation_id ||
    payload?.conversation_id ||
    data?.conversationId ||
    data?.conversation_id ||
    remoteJid,
    resolvedPhone || jidNumber(remoteJid)
  );
  const deliveryStatus = normalizeEvolutionDeliveryStatus(
    statusItem?.status ||
    data?.status ||
    envelope.rawEvent ||
    payload?.event ||
    payload?.type ||
    ""
  );
  const whatsappInstance = text(payload?.instance || payload?.instanceName || data?.instance || data?.instanceName || envelope.instance || instanceName());
  console.info("[whatsapp:evolution-status-update]", {
    provider_message_id: providerMessageId,
    delivery_status: deliveryStatus,
    remoteJid,
    resolvedPhone,
    session_id: sessionId,
    instance: whatsappInstance,
    fromMe: envelope.fromMe,
    event: envelope.event || payload?.event || payload?.type || "",
    rawEvent: envelope.rawEvent || "",
  });
  trackEvolutionButtonsMessage({
    messageId: providerMessageId,
    status: deliveryStatus === "read"
      ? "READ"
      : deliveryStatus === "delivered"
        ? "DELIVERY_ACK"
        : deliveryStatus === "failed"
          ? "FAILED"
          : deliveryStatus === "sent"
            ? "DELIVERY_ACK"
            : "PENDING",
    remoteJid,
    messageType: text(statusItem?.messageType || data?.messageType || data?.type || "buttons"),
    endpoint: "webhook",
    phoneSuffix: resolvedPhone.slice(-4),
  });
  if (!providerMessageId) {
    return { updated: false, reason: "missing_provider_message_id" };
  }
  const updated = await updateAiSupportMessageDeliveryStatus({
    tenantId: tenantIdForWhatsapp(payload),
    sessionId,
    providerMessageId,
    externalMessageId: providerMessageId,
    deliveryStatus,
    whatsappInstance,
    remoteJid,
    resolvedPhone,
    sourcePath: "whatsapp_webhook_delivery_update",
    insertSource: "whatsapp_webhook_delivery_update",
  });
  console.info("[whatsapp:evolution-status-update-result]", {
    provider_message_id: providerMessageId,
    updated: Boolean(updated),
    ai_support_message_id: updated?.id || null,
    delivery_status: updated?.delivery_status || "",
    session_id: updated?.session_id || sessionId,
  });
  return { updated: Boolean(updated), row: updated || null, providerMessageId, deliveryStatus, remoteJid, sessionId, resolvedPhone };
};

const dedupeHash = (value = "") => crypto.createHash("sha256").update(text(value)).digest("hex");

const logAiSupportMessageIndexes = async () => {
  try {
    const result = await db.query(
      `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = CURRENT_SCHEMA()
        AND tablename = 'ai_support_messages'
      ORDER BY indexname ASC
      `
    );
    console.info("[ai-support-messages-indexes]", result.rows.map((row) => ({
      indexname: row.indexname,
      indexdef: row.indexdef,
    })));
  } catch (error) {
    console.error("[ai-support-messages-indexes:error]", {
      message: error?.message || String(error),
      code: error?.code || "",
    });
  }
};

const duplicateDiagnosticText = (value = "") => text(value).slice(0, 160);

const duplicateDiagnosticRow = (row = null) => {
  if (!row) return null;
  return {
    id: row.id || null,
    provider_message_id: row.provider_message_id || "",
    external_message_id: row.external_message_id || "",
    created_at: row.created_at || null,
    session_id: row.session_id || "",
    channel: row.channel || "",
    whatsapp_instance: row.whatsapp_instance || "",
    remote_jid: row.remote_jid || "",
    sender_type: row.sender_type || "",
    source_path: row.source_path || "",
    insert_source: row.insert_source || "",
    message_text_preview: duplicateDiagnosticText(row.message_text || row.customer_message || row.last_message || ""),
  };
};

const loadWhatsappDuplicateDiagnostics = async ({
  tenantId,
  channel,
  instance,
  remoteJid,
  sessionId,
  externalMessageId,
  body,
} = {}) => {
  try {
    const [exactMatch, sameProviderAnyScope, sessionOnly, sameTextInSession, outboundSameProvider] = await Promise.all([
      db.query(
        `
        SELECT id, provider_message_id, external_message_id, created_at, session_id, channel, whatsapp_instance,
               remote_jid, sender_type, source_path, insert_source, message_text, customer_message, last_message
        FROM ai_support_messages
        WHERE tenant_id = $1
          AND channel = $2
          AND whatsapp_instance = $3
          AND remote_jid = $4
          AND provider_message_id <> ''
          AND provider_message_id = $5
        ORDER BY id ASC
        LIMIT 1
        `,
        [tenantId, channel, instance, remoteJid, externalMessageId]
      ),
      db.query(
        `
        SELECT id, provider_message_id, external_message_id, created_at, session_id, channel, whatsapp_instance,
               remote_jid, sender_type, source_path, insert_source, message_text, customer_message, last_message
        FROM ai_support_messages
        WHERE tenant_id = $1
          AND channel = $2
          AND provider_message_id <> ''
          AND provider_message_id = $3
        ORDER BY id DESC
        LIMIT 5
        `,
        [tenantId, channel, externalMessageId]
      ),
      db.query(
        `
        SELECT id, provider_message_id, external_message_id, created_at, session_id, channel, whatsapp_instance,
               remote_jid, sender_type, source_path, insert_source, message_text, customer_message, last_message
        FROM ai_support_messages
        WHERE tenant_id = $1
          AND channel = $2
          AND session_id = $3
        ORDER BY id DESC
        LIMIT 5
        `,
        [tenantId, channel, sessionId]
      ),
      db.query(
        `
        SELECT id, provider_message_id, external_message_id, created_at, session_id, channel, whatsapp_instance,
               remote_jid, sender_type, source_path, insert_source, message_text, customer_message, last_message
        FROM ai_support_messages
        WHERE tenant_id = $1
          AND channel = $2
          AND session_id = $3
          AND COALESCE(NULLIF(message_text, ''), NULLIF(customer_message, ''), NULLIF(last_message, '')) = $4
        ORDER BY id DESC
        LIMIT 5
        `,
        [tenantId, channel, sessionId, body]
      ),
      db.query(
        `
        SELECT id, provider_message_id, external_message_id, created_at, session_id, channel, whatsapp_instance,
               remote_jid, sender_type, source_path, insert_source, message_text, customer_message, last_message
        FROM ai_support_messages
        WHERE tenant_id = $1
          AND channel = $2
          AND provider_message_id <> ''
          AND provider_message_id = $3
          AND COALESCE(sender_type, '') <> 'customer'
        ORDER BY id DESC
        LIMIT 5
        `,
        [tenantId, channel, externalMessageId]
      ),
    ]);
    return {
      exact_provider_remote_match: duplicateDiagnosticRow(exactMatch.rows[0] || null),
      same_provider_message_id_count: sameProviderAnyScope.rows.length,
      same_provider_message_id_rows: sameProviderAnyScope.rows.map(duplicateDiagnosticRow),
      session_only_sample_count: sessionOnly.rows.length,
      session_only_rows: sessionOnly.rows.map(duplicateDiagnosticRow),
      same_text_session_sample_count: sameTextInSession.rows.length,
      same_text_session_rows: sameTextInSession.rows.map(duplicateDiagnosticRow),
      outbound_same_provider_message_id_count: outboundSameProvider.rows.length,
      outbound_same_provider_message_id_rows: outboundSameProvider.rows.map(duplicateDiagnosticRow),
    };
  } catch (error) {
    return {
      diagnostic_error: error?.message || String(error),
      diagnostic_error_code: error?.code || "",
    };
  }
};

const saveWhatsappIncomingToAiInbox = async (message = {}) => {
  const tenantId = tenantIdForWhatsapp(message.raw || {});
  const sessionId = normalizeWhatsappSessionId(message.raw?.external_conversation_id || message.raw?.conversation_id || message.remoteJid || message.phone, message.phone);
  const customerName = text(message.senderName);
  const body = text(message.text);
  const receivedAt = message.timestamp || new Date().toISOString();
  const externalMessageId = text(message.messageId);
  const instance = text(message.instance || "");
  const channel = AI_AGENT_CHANNELS.WHATSAPP;
  const remoteJid = normalizeWhatsappSessionId(message.remoteJid || message.resolvedReplyJid || message.phone, message.phone);
  const resolvedReplyJid = normalizeWhatsappSessionId(message.resolvedReplyJid || message.remoteJid || message.phone, message.phone);
  const resolvedPhone = normalizeWhatsappPhone(message.resolvedPhone || message.phone || "");
  const customerAvatarUrl = text(
    message.customerAvatarUrl ||
    await fetchWhatsappCustomerProfilePicture({ phone: resolvedPhone || message.phone, instance })
  );
  const dedupeKey = externalMessageId
    ? dedupeHash([channel, instance, remoteJid, externalMessageId].join("|"))
    : "";
  console.info("[whatsapp-dedupe-code-version]", "provider_message_id_dedupe_v3");
  console.info("[whatsapp-inbound-save-entry]", {
    channel,
    instance,
    remoteJid,
    resolved_reply_jid: resolvedReplyJid,
    resolved_phone: resolvedPhone,
    provider_message_id: externalMessageId,
    message_text: body,
    code_version: "provider_message_id_dedupe_v3",
  });
  console.log("[whatsapp-dedupe-key]", {
    channel,
    instance,
    remoteJid,
    provider_message_id: externalMessageId,
    dedupe_key: dedupeKey,
  });

  await ensureAiSupportLogSchema();
  await logAiSupportMessageIndexes();
  if (message.isGroup === true) {
    console.info("[whatsapp:inbox-skipped]", {
      reason: "group_chat",
      remoteJid,
      phone,
      messageId: externalMessageId,
      instance,
    });
    return {
      saved: false,
      duplicate: false,
      reason: "group_chat",
      session_id: sessionId,
      dedupe_key: dedupeKey,
      message: null,
    };
  }

  const conversation = await upsertChannelConversationMapping({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    externalConversationId: sessionId,
    externalCustomerId: message.phone,
    customerName,
    customerAvatarUrl,
    metadata: {
      phone: message.phone,
      remote_jid: remoteJid,
      resolved_reply_jid: resolvedReplyJid,
      resolved_phone: resolvedPhone,
      reply_target_reason: message.replyTargetReason || "",
      connected_owner_jid: message.connectedOwnerJid || "",
      instance_owner_jid: message.instanceOwnerJid || "",
      is_group: message.isGroup === true,
      is_lid: message.isLid === true,
      instance: message.instance,
      source: "evolution_api",
      last_message: body,
      external_message_id: externalMessageId,
      dedupe_key: dedupeKey,
      provider_message_id: externalMessageId,
      whatsapp_instance: instance,
      remote_jid: remoteJid,
      resolved_reply_jid: resolvedReplyJid,
      resolved_phone: resolvedPhone,
      connected_owner_jid: message.connectedOwnerJid || "",
      instance_owner_jid: message.instanceOwnerJid || "",
    },
    lastMessageAt: receivedAt,
  });
  if (conversation?.inserted) {
    console.info("[ai-inbox:conversation-created]", {
      tenantId,
      channel,
      sessionId,
      externalCustomerId: message.phone,
      remoteJid,
      messageId: externalMessageId,
      instance,
    });
  }

  const session = await db.query(
    `
    INSERT INTO ai_support_sessions (tenant_id, session_id, source, channel, customer_name, customer_avatar_url, last_message, updated_at)
    VALUES ($1, $2, 'whatsapp', 'whatsapp', $3::text, $4::text, $5::text, NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      source = 'whatsapp',
      channel = 'whatsapp',
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name),
      customer_avatar_url = COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_support_sessions.customer_avatar_url),
      last_message = EXCLUDED.last_message,
      updated_at = NOW()
    RETURNING id
    `,
    [tenantId, sessionId, customerName, customerAvatarUrl, body]
  );

  console.info("[whatsapp-insert-attempt]", {
    provider_message_id: externalMessageId,
    conflict_target_used: "tenant_id, channel, whatsapp_instance, remote_jid, provider_message_id",
  });
  const duplicateDiagnostics = await loadWhatsappDuplicateDiagnostics({
    tenantId,
    channel,
    instance,
    remoteJid,
    sessionId,
    externalMessageId,
    body,
  });
  const exactDiagnosticMatch = duplicateDiagnostics.exact_provider_remote_match || null;
  console.info("[DUPLICATE_CHECK]", {
    message_id: externalMessageId,
    remoteJid,
    session_id: sessionId,
    existing_record_id: exactDiagnosticMatch?.id || null,
    existing_message_id: exactDiagnosticMatch?.provider_message_id || exactDiagnosticMatch?.external_message_id || "",
    existing_created_at: exactDiagnosticMatch?.created_at || null,
    duplicate_reason: exactDiagnosticMatch
      ? "same_provider_message_id_same_instance_remote_jid_before_insert"
      : "no_existing_exact_provider_message_id_before_insert",
    conflict_target_used: "tenant_id, channel, whatsapp_instance, remote_jid, provider_message_id",
    duplicate_query_uses_conversation_id_only: false,
    duplicate_query_uses_session_id_only: false,
    duplicate_query_uses_message_text: false,
    duplicate_query_filters_sender_type: false,
    inbound_outbound_can_conflict_if_same_provider_message_id: true,
    provider_message_id_present: Boolean(externalMessageId),
    same_message_id_seen_before: Boolean(exactDiagnosticMatch),
    same_message_id_any_scope_count: duplicateDiagnostics.same_provider_message_id_count ?? null,
    session_only_sample_count: duplicateDiagnostics.session_only_sample_count ?? null,
    same_text_session_sample_count: duplicateDiagnostics.same_text_session_sample_count ?? null,
    outbound_same_provider_message_id_count: duplicateDiagnostics.outbound_same_provider_message_id_count ?? null,
    exact_provider_remote_match: exactDiagnosticMatch,
    same_provider_message_id_rows: duplicateDiagnostics.same_provider_message_id_rows || [],
    session_only_rows: duplicateDiagnostics.session_only_rows || [],
    same_text_session_rows: duplicateDiagnostics.same_text_session_rows || [],
    outbound_same_provider_message_id_rows: duplicateDiagnostics.outbound_same_provider_message_id_rows || [],
    diagnostic_error: duplicateDiagnostics.diagnostic_error || "",
  });
  const inserted = await db.query(
    `
    INSERT INTO ai_support_messages (
      session_ref_id, tenant_id, session_id, channel, customer_name, last_message, message_text,
      customer_message, ai_answer, confidence, needs_human_support, sources_used, suggested_products,
      visual_attachments, suggested_actions, detected_intent, fallback_reason, sender_type, external_message_id, dedupe_key,
      provider_message_id, whatsapp_instance, remote_jid, resolved_reply_jid, resolved_phone, source_path, insert_source
    )
    VALUES ($1, $2, $3::text, 'whatsapp', $4::text, $5::text, $5::text, $5::text, '', 0, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '', 'ai_status:pending', 'customer', $6::text, $7::text, $8::text, $9::text, $10::text, $11::text, $12::text, $13::text, $14::text)
    ON CONFLICT DO NOTHING
    RETURNING *
    `,
    [session.rows[0]?.id || null, tenantId, sessionId, customerName, body, externalMessageId, dedupeKey, externalMessageId, instance, remoteJid, resolvedReplyJid, resolvedPhone, "whatsapp_webhook", "whatsapp_webhook"]
  );

  if (!inserted.rows[0]) {
    const existingRow = await db.query(
      `
      SELECT
        id,
        created_at,
        provider_message_id,
        external_message_id,
        channel,
        whatsapp_instance,
        remote_jid,
        sender_type,
        session_id,
        session_id AS conversation_id,
        message_text,
        source_path,
        CASE WHEN sender_type = 'staff' THEN TRUE ELSE FALSE END AS from_me,
        tenant_id,
        insert_source
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND (
          (
            channel = $2
            AND whatsapp_instance = $3
            AND remote_jid = $4
            AND provider_message_id = $5
          )
          OR (
            session_id = $6
            AND external_message_id = $5
          )
        )
      ORDER BY id ASC
      LIMIT 1
      `,
      [tenantId, channel, instance, remoteJid, externalMessageId, sessionId]
    ).then((result) => result.rows[0] || null).catch(() => null);
    console.info("[existing-provider-message-row]", {
      id: existingRow?.id || null,
      created_at: existingRow?.created_at || null,
      provider_message_id: existingRow?.provider_message_id || externalMessageId,
      external_message_id: existingRow?.external_message_id || "",
      channel: existingRow?.channel || channel,
      whatsapp_instance: existingRow?.whatsapp_instance || instance,
      remote_jid: existingRow?.remote_jid || remoteJid,
      sender_type: existingRow?.sender_type || "",
      session_id: existingRow?.session_id || sessionId,
      conversation_id: existingRow?.conversation_id || sessionId,
      message_text: existingRow?.message_text || "",
      from_me: existingRow?.from_me ?? false,
      source_path: existingRow?.source_path || "whatsapp_webhook",
      tenant_id: existingRow?.tenant_id || tenantId,
      insert_source: existingRow?.insert_source || null,
    });
    console.info("[DUPLICATE_CHECK_RESULT]", {
      message_id: externalMessageId,
      remoteJid,
      session_id: sessionId,
      existing_record_id: existingRow?.id || exactDiagnosticMatch?.id || null,
      existing_message_id:
        existingRow?.provider_message_id ||
        existingRow?.external_message_id ||
        exactDiagnosticMatch?.provider_message_id ||
        exactDiagnosticMatch?.external_message_id ||
        "",
      existing_created_at: existingRow?.created_at || exactDiagnosticMatch?.created_at || null,
      duplicate_reason: "insert_returned_no_row_provider_message_id_conflict",
      saved: false,
      duplicate: true,
      inserted_record_id: null,
      conflict_target_used: "tenant_id, channel, whatsapp_instance, remote_jid, provider_message_id",
      duplicate_query_uses_conversation_id_only: false,
      duplicate_query_uses_session_id_only: false,
      duplicate_query_uses_message_text: false,
      duplicate_query_filters_sender_type: false,
      inbound_outbound_can_conflict_if_same_provider_message_id: true,
      same_message_id_seen_before_insert: Boolean(exactDiagnosticMatch),
      same_message_id_any_scope_count: duplicateDiagnostics.same_provider_message_id_count ?? null,
      session_only_sample_count: duplicateDiagnostics.session_only_sample_count ?? null,
      same_text_session_sample_count: duplicateDiagnostics.same_text_session_sample_count ?? null,
      outbound_same_provider_message_id_count: duplicateDiagnostics.outbound_same_provider_message_id_count ?? null,
      existing_sender_type: existingRow?.sender_type || exactDiagnosticMatch?.sender_type || "",
      existing_source_path: existingRow?.source_path || exactDiagnosticMatch?.source_path || "",
      existing_insert_source: existingRow?.insert_source || exactDiagnosticMatch?.insert_source || "",
    });
    console.warn("[whatsapp-insert-conflict]", {
      error_code: "duplicate_provider_message_id",
      constraint: "idx_ai_support_messages_provider_message_id",
      provider_message_id: externalMessageId,
      remoteJid,
      instance,
      dedupe_key: dedupeKey,
      detail: "Insert skipped because provider message id already exists for the same WhatsApp channel instance and remote JID.",
      reason: "duplicate_provider_message_id",
    });
    console.info("[whatsapp:inbox-skipped]", {
      reason: "duplicate",
      tenantId,
      session_id: sessionId,
      message_id: externalMessageId,
      dedupe_key: dedupeKey,
    });
    console.info("[whatsapp-inbox-save-result]", {
      saved: false,
      duplicate: true,
      reason: "duplicate_provider_message_id",
      ai_support_message_id: null,
      provider_message_id: externalMessageId,
    });
    return {
      saved: false,
      duplicate: true,
      reason: "duplicate_provider_message_id",
      session_id: sessionId,
      dedupe_key: dedupeKey,
      message: existingRow || null,
    };
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
      resolved_reply_jid: resolvedReplyJid,
      resolved_phone: resolvedPhone,
      reply_target_reason: message.replyTargetReason || "",
      connected_owner_jid: message.connectedOwnerJid || "",
      instance_owner_jid: message.instanceOwnerJid || "",
      is_group: message.isGroup === true,
      is_lid: message.isLid === true,
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
  console.info("[inbound-saved]", {
    provider_message_id: externalMessageId,
    ai_support_message_id: inserted.rows[0]?.id || null,
    conversation_id: sessionId,
  });
  console.info("[provider-message-first-seen]", {
    provider_message_id: externalMessageId,
    created_at: inserted.rows[0]?.created_at || receivedAt,
    source_path: "whatsapp_webhook",
    trace_id: message.trace_id || null,
  });
  console.info("[whatsapp-inbox-save-result]", {
    saved: true,
    duplicate: false,
    reason: "saved",
    ai_support_message_id: inserted.rows[0]?.id || null,
    provider_message_id: externalMessageId,
  });
  console.info("[DUPLICATE_CHECK_RESULT]", {
    message_id: externalMessageId,
    remoteJid,
    session_id: sessionId,
    existing_record_id: exactDiagnosticMatch?.id || null,
    existing_message_id: exactDiagnosticMatch?.provider_message_id || exactDiagnosticMatch?.external_message_id || "",
    existing_created_at: exactDiagnosticMatch?.created_at || null,
    duplicate_reason: "inserted_new_inbound_message",
    saved: true,
    duplicate: false,
    inserted_record_id: inserted.rows[0]?.id || null,
    conflict_target_used: "tenant_id, channel, whatsapp_instance, remote_jid, provider_message_id",
    duplicate_query_uses_conversation_id_only: false,
    duplicate_query_uses_session_id_only: false,
    duplicate_query_uses_message_text: false,
    duplicate_query_filters_sender_type: false,
    inbound_outbound_can_conflict_if_same_provider_message_id: true,
    same_message_id_seen_before_insert: Boolean(exactDiagnosticMatch),
    same_message_id_any_scope_count: duplicateDiagnostics.same_provider_message_id_count ?? null,
    session_only_sample_count: duplicateDiagnostics.session_only_sample_count ?? null,
    same_text_session_sample_count: duplicateDiagnostics.same_text_session_sample_count ?? null,
    outbound_same_provider_message_id_count: duplicateDiagnostics.outbound_same_provider_message_id_count ?? null,
  });
  console.info("[ai-inbox:message-created]", {
    tenantId,
    channel,
    sessionId,
    messageId: externalMessageId,
    aiSupportMessageId: inserted.rows[0]?.id || null,
    phone: message.phone,
    remoteJid,
    instance,
  });
  return {
    saved: true,
    duplicate: false,
    reason: "saved",
    session_id: sessionId,
    message: inserted.rows[0] || null,
    dedupe_key: dedupeKey,
  };
};

export const handleIncomingWebhook = async (payload = {}) => {
  const eventCandidates = [
    payload?.event,
    payload?.type,
    payload?.name,
    payload?.body?.event,
    payload?.body?.type,
    payload?.data?.event,
    payload?.data?.type,
    payload?.data?.name,
    payload?.data?.event_name,
    payload?.data?.eventName,
    payload?.data?.webhookEvent,
    payload?.data?.webhook_event,
    payload?.data?.action,
  ].filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  const payloadKeys = payload && typeof payload === "object" ? Object.keys(payload) : [];
  console.info("[whatsapp:webhook-raw]", {
    event: String(eventCandidates[0] || ""),
    instance: String(payload?.instance || payload?.instanceName || payload?.data?.instance || payload?.data?.instanceName || ""),
    payload_keys: payloadKeys,
    payload_preview: {
      event: payload?.event ?? null,
      type: payload?.type ?? null,
      name: payload?.name ?? null,
      body_keys: payload?.body && typeof payload.body === "object" ? Object.keys(payload.body) : [],
      data_keys: payload?.data && typeof payload.data === "object" ? Object.keys(payload.data) : [],
      data_event: payload?.data?.event ?? null,
      data_type: payload?.data?.type ?? null,
      data_name: payload?.data?.name ?? null,
    },
  });
  console.info("[whatsapp:event-detected]", {
    received_events: eventCandidates.map((value) => String(value)),
  });
  const envelope = extractWhatsappWebhookEnvelope(payload);
  const sanitizedPayload = redactSensitive(payload);
  const fullPayloadText = extractMessageText(envelope.data, payload);
  let mediaDescriptor = extractWhatsappMediaDescriptor(payload);
  const webhookMessage = envelope.data?.message || envelope.data?.messages?.[0]?.message || payload?.body?.data?.message || payload?.body?.message || payload?.message || {};
  const webhookMessageType = text(
    envelope.data?.messageType ||
    envelope.data?.message_type ||
    envelope.data?.type ||
    webhookMessage?.type ||
    webhookMessage?.messageType ||
    webhookMessage?.message_type ||
    payload?.messageType ||
    payload?.message_type ||
    payload?.type ||
    payload?.data?.messageType ||
    payload?.data?.message_type ||
    payload?.data?.type ||
    ""
  );
  const hasViewOnceMessage = Boolean(
    getPathValue(payload, "data.message.viewOnceMessage") ||
    getPathValue(payload, "body.data.message.viewOnceMessage") ||
    getPathValue(envelope.data, "message.viewOnceMessage") ||
    webhookMessage?.viewOnceMessage
  );
  const hasInteractiveMessage = Boolean(
    getPathValue(payload, "data.message.interactiveMessage") ||
    getPathValue(payload, "body.data.message.interactiveMessage") ||
    getPathValue(envelope.data, "message.interactiveMessage") ||
    webhookMessage?.interactiveMessage
  );
  const hasNativeFlowMessage = Boolean(
    getPathValue(payload, "data.message.interactiveMessage.nativeFlowMessage") ||
    getPathValue(payload, "body.data.message.interactiveMessage.nativeFlowMessage") ||
    getPathValue(envelope.data, "message.interactiveMessage.nativeFlowMessage") ||
    webhookMessage?.interactiveMessage?.nativeFlowMessage
  );
  const hasButtonsMessage = Boolean(
    getPathValue(payload, "data.message.buttonsMessage") ||
    getPathValue(payload, "body.data.message.buttonsMessage") ||
    getPathValue(envelope.data, "message.buttonsMessage") ||
    webhookMessage?.buttonsMessage
  );
  const hasTemplateButtonReplyMessage = Boolean(
    getPathValue(payload, "data.message.templateButtonReplyMessage") ||
    getPathValue(payload, "body.data.message.templateButtonReplyMessage") ||
    getPathValue(envelope.data, "message.templateButtonReplyMessage") ||
    webhookMessage?.templateButtonReplyMessage
  );
  console.info("[evolution:buttons-webhook-shape]", {
    messageId: envelope.messageId || "",
    messageType: webhookMessageType,
    hasViewOnceMessage,
    hasInteractiveMessage,
    hasNativeFlowMessage,
    hasButtonsMessage,
    hasTemplateButtonReplyMessage,
    source: envelope.rawEvent || payload?.event || payload?.type || "",
    status: text(payload?.status || envelope.data?.status || envelope.data?.message?.status || payload?.data?.status || ""),
  });
  const skipReason = getEvolutionWebhookSkipReason({
    event: envelope.event,
    remoteJid: envelope.remoteJid,
    messageId: envelope.messageId,
    textValue: fullPayloadText,
    hasMedia: Boolean(mediaDescriptor.type),
    fromMe: envelope.fromMe === true,
  });
  if (skipReason) {
    console.info("[whatsapp:webhook-early-skip]", {
      reason: skipReason,
      event: envelope.event || "",
      rawEvent: envelope.rawEvent || "",
      remoteJid: envelope.remoteJid || "",
      key_remoteJid: envelope.key?.remoteJid || envelope.key?.remote_jid || "",
      message_key_id: envelope.data?.message?.key?.id || envelope.key?.id || "",
      messageId: envelope.messageId || "",
      text: fullPayloadText || "",
      textLength: String(fullPayloadText || "").trim().length,
      fromMe: envelope.fromMe === true,
      instance: envelope.instance || "",
    });
    return {
      event: envelope.event,
      rawEvent: envelope.rawEvent,
      eventCandidates: envelope.eventCandidates,
      phone: "",
      remoteJid: envelope.remoteJid,
      resolvedReplyJid: "",
      resolvedPhone: "",
      replyTargetReason: skipReason,
      participant: envelope.participant,
      sender: envelope.sender,
      connectedOwnerJid: envelope.ownerJid,
      instanceOwnerJid: envelope.ownerJid,
      ownerJid: envelope.ownerJid,
      configuredBotNumber: envelope.configuredBotNumber,
      isGroup: isGroupJid(envelope.remoteJid),
      isLid: isLidJid(envelope.remoteJid),
      text: "",
      senderName: "",
      messageId: envelope.messageId,
      timestamp: envelope.timestamp,
      instance: envelope.instance,
      fromMe: envelope.fromMe,
      raw: payload,
      received_at: envelope.timestamp,
      message_id: envelope.messageId,
      instanceName: envelope.instance,
      trace_id: null,
      skipped: true,
      skipReason,
      inbox: { saved: false, reason: skipReason },
    };
  }
  mediaDescriptor = await materializeEvolutionWebhookMedia({
    payload,
    descriptor: mediaDescriptor,
    messageId: envelope.messageId,
    instance: envelope.instance,
  });
  const fullPayloadLog = {
    event: envelope.event,
    rawEvent: envelope.rawEvent || "",
    instance: envelope.instance,
    data: redactSensitive(envelope.data),
    key: redactSensitive(envelope.key),
    message: redactSensitive(envelope.data?.message || envelope.data?.messages?.[0]?.message || null),
    body: redactSensitive(payload?.body || envelope.data?.body || null),
    text: fullPayloadText,
    sender: envelope.sender,
    remoteJid: envelope.remoteJid,
    pushName: text(envelope.data?.pushName || envelope.data?.pushname || envelope.data?.profileName || envelope.data?.senderName || ""),
    payload: sanitizedPayload,
  };
  console.info("[evolution:webhook-full-payload]", fullPayloadLog);
  rememberEvolutionWebhookEvent(fullPayloadLog);
  console.info("[evolution:webhook-outgoing-event-received]", {
    event: envelope.event || "unknown",
    rawEvent: envelope.rawEvent || "",
    instance: envelope.instance,
    eventCounts: Object.fromEntries(evolutionWebhookEventCounts.entries()),
    recentEvents: recentEvolutionWebhookEvents.map((entry) => ({
      received_at: entry.received_at,
      event: entry.event || "unknown",
      rawEvent: entry.rawEvent || "",
      remoteJid: entry.remoteJid || "",
      messageId: entry.messageId || entry.key?.id || "",
      hasText: Boolean(entry.text),
    })),
  });
  console.info("[evolution:webhook-event]", {
    event: envelope.event,
    rawEvent: envelope.rawEvent || "",
    instance: envelope.instance,
    remoteJid: envelope.remoteJid,
    messageId: envelope.messageId,
    fromMe: envelope.fromMe,
    eventCandidates: envelope.eventCandidates,
  });
  const statusDecision = getEvolutionStatusUpdateDecision(payload, envelope);
  const isInboundMessagesUpsert = statusDecision.normalizedEvent === "messages.upsert" && envelope.fromMe === false;
  console.info("[whatsapp:evolution-status-decision]", {
    event: envelope.event || "",
    rawEvent: envelope.rawEvent || "",
    normalizedEvent: statusDecision.normalizedEvent || "",
    fromMe: envelope.fromMe === true,
    isStatusUpdate: statusDecision.isStatusUpdate === true,
    reason: statusDecision.reason || "",
    indicators: statusDecision.indicators || {},
  });
  if (isInboundMessagesUpsert) {
    console.info("[ai-auto-reply] stage=inbound_route_selected", {
      event: envelope.event || "",
      rawEvent: envelope.rawEvent || "",
      normalizedEvent: statusDecision.normalizedEvent || "",
      fromMe: envelope.fromMe === true,
      remoteJid: envelope.remoteJid || "",
      reason: "messages.upsert_from_customer",
    });
  } else if (statusDecision.isStatusUpdate) {
    console.info("[ai-auto-reply] stage=status_route_selected", {
      event: envelope.event || "",
      rawEvent: envelope.rawEvent || "",
      normalizedEvent: statusDecision.normalizedEvent || "",
      fromMe: envelope.fromMe === true,
      remoteJid: envelope.remoteJid || "",
      reason: statusDecision.reason || "status_update",
      indicators: statusDecision.indicators || {},
    });
    const statusUpdate = await processEvolutionStatusUpdate(payload);
    return {
      event: envelope.event || "messages.update",
      rawEvent: envelope.rawEvent || "",
      eventCandidates: envelope.eventCandidates,
      phone: statusUpdate.resolvedPhone || "",
      remoteJid: statusUpdate.remoteJid || envelope.remoteJid,
      resolvedReplyJid: "",
      resolvedPhone: statusUpdate.resolvedPhone || "",
      replyTargetReason: "status_update",
      participant: envelope.participant,
      sender: envelope.sender,
      connectedOwnerJid: envelope.ownerJid,
      instanceOwnerJid: envelope.ownerJid,
      ownerJid: envelope.ownerJid,
      configuredBotNumber: envelope.configuredBotNumber,
      isGroup: isGroupJid(envelope.remoteJid),
      isLid: isLidJid(envelope.remoteJid),
      text: "",
      senderName: "",
      messageId: statusUpdate.providerMessageId || envelope.messageId,
      timestamp: envelope.timestamp,
      instance: envelope.instance,
      fromMe: true,
      raw: payload,
      received_at: envelope.timestamp,
      message_id: statusUpdate.providerMessageId || envelope.messageId,
      instanceName: envelope.instance,
      trace_id: null,
      inbox: { saved: false, reason: statusUpdate.updated ? "status_update" : "status_update_no_match" },
      delivery_status: statusUpdate.deliveryStatus || "",
    };
  }
  const normalized = await extractIncomingWhatsapp(payload);
  if (envelope.fromMe) {
    const tenantId = tenantIdForWhatsapp(payload);
    const sessionId = normalizeWhatsappSessionId(normalized.remoteJid || normalized.resolvedReplyJid || normalized.phone, normalized.resolvedPhone || normalized.phone);
    const outboundMessage = normalized.text || mediaDescriptor.label;
    const outboundRow = outboundMessage ? await appendChannelOutboundSupportReply({
      tenantId,
      sessionId,
      message: outboundMessage,
      messageType: mediaDescriptor.type || "text",
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      senderType: "staff",
      staffMessage: outboundMessage,
      staffUserName: "أنا",
      visualAttachments: mediaDescriptor.visualAttachments,
      source: "whatsapp_provider_echo",
      sourcePath: "whatsapp_provider_echo",
      insertSource: "whatsapp_provider_echo",
      deliveryStatus: "sent",
      externalMessageId: normalized.messageId,
      providerMessageId: normalized.messageId,
      whatsappInstance: normalized.instance,
      remoteJid: normalized.remoteJid,
      resolvedReplyJid: normalized.resolvedReplyJid,
      resolvedPhone: normalized.resolvedPhone || normalized.phone,
      sessionStatus: "ai_active",
      preserveExistingOnProviderMatch: true,
    }).catch((error) => {
      console.warn("[whatsapp:provider-echo-save-failed]", { message_id: normalized.messageId, message: error?.message });
      return null;
    }) : null;
    if (outboundRow) {
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", {
        tenant_id: tenantId,
        session_id: sessionId,
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        message: { ...outboundRow, from_me: true, direction: "outbound" },
      });
    }
    console.info("[whatsapp:skip-from-me-before-ai]", {
      event: envelope.event,
      rawEvent: envelope.rawEvent || "",
      instance: envelope.instance,
      remoteJid: envelope.remoteJid,
      sender: envelope.sender,
      participant: envelope.participant,
      fromMe: true,
      ownerJid: envelope.ownerJid,
      configuredBotNumber: envelope.configuredBotNumber,
      resolvedJid: "",
      skip_reason: "from_me",
      message_id: envelope.messageId,
    });
    return {
      event: envelope.event,
      rawEvent: envelope.rawEvent,
      eventCandidates: envelope.eventCandidates,
      phone: normalized.phone || normalized.resolvedPhone || "",
      remoteJid: envelope.remoteJid,
      resolvedReplyJid: "",
      resolvedPhone: "",
      replyTargetReason: "from_me",
      participant: envelope.participant,
      sender: envelope.sender,
      connectedOwnerJid: envelope.ownerJid,
      instanceOwnerJid: envelope.ownerJid,
      ownerJid: envelope.ownerJid,
      configuredBotNumber: envelope.configuredBotNumber,
      isGroup: isGroupJid(envelope.remoteJid),
      isLid: isLidJid(envelope.remoteJid),
      text: normalized.text || "",
      senderName: "",
      messageId: envelope.messageId,
      timestamp: envelope.timestamp,
      instance: envelope.instance,
      fromMe: true,
      raw: payload,
      received_at: envelope.timestamp,
      message_id: envelope.messageId,
      instanceName: envelope.instance,
      trace_id: null,
      inbox: { saved: Boolean(outboundRow), reason: outboundRow ? "from_me_saved" : "from_me" },
    };
  }
  console.info("[evolution:message-extracted]", {
    event: normalized.event,
    rawEvent: normalized.rawEvent || "",
    instance: normalized.instance,
    remoteJid: normalized.remoteJid,
    phone: normalized.phone,
    messageId: normalized.messageId,
    textPreview: normalized.text.slice(0, 160),
    fromMe: normalized.fromMe,
  });
  console.info("[evolution:inbound-normalized]", {
    event: normalized.event,
    rawEvent: normalized.rawEvent || "",
    instance: normalized.instance,
    remoteJid: normalized.remoteJid,
    customerPhone: normalized.phone,
    resolvedReplyJid: normalized.resolvedReplyJid,
    resolvedPhone: normalized.resolvedPhone,
    replyTargetReason: normalized.replyTargetReason,
    messageId: normalized.messageId,
    textPreview: normalized.text.slice(0, 160),
    isOwnerTarget: normalizeEgyptPhone(normalized.phone) === normalizeEgyptPhone(process.env.WHATSAPP_NUMBER || "201000659301"),
    fromMe: normalized.fromMe,
  });
  const ignoreNonTextEvents = new Set(["contacts.update", "messages.edited"]);
  if (ignoreNonTextEvents.has(String(normalized.event || "").toLowerCase()) && (!normalized.text || !normalized.messageId)) {
    console.info("[whatsapp:inbox-skipped]", {
      reason: "non_text_or_missing_message_id",
      event: normalized.event,
      message_id: normalized.messageId,
      remoteJid: normalized.remoteJid,
      phoneSuffix: normalized.phone ? normalized.phone.slice(-4) : "",
    });
    return {
      ...normalized,
      received_at: normalized.timestamp,
      trace_id: null,
      inbox: { saved: false, reason: "non_text_or_missing_message_id" },
    };
  }
  const traceTenantId = tenantIdForWhatsapp(normalized.raw || {});
  let trace = null;
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
    rawEvent: normalized.rawEvent || "",
  });
  console.info("[whatsapp:message-extracted]", {
    event: normalized.event,
    rawEvent: normalized.rawEvent || "",
    messageId: normalized.messageId,
    phone: normalized.phone,
    remoteJid: normalized.remoteJid,
    textPreview: normalized.text.slice(0, 120),
    senderName: normalized.senderName,
  });
  trace = await startTrace({
    tenantId: traceTenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    sessionId: normalized.phone ? `whatsapp:${normalized.phone}` : "",
    externalMessageId: normalized.messageId,
    metadata: { source: "evolution_api_webhook" },
  });
  await addTraceStep(trace, "webhook_received", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    instance: normalized.instance,
    remoteJid: normalized.remoteJid,
    normalized_phone: normalized.phone,
    message_text: normalized.text,
    message_id: normalized.messageId,
    fromMe: normalized.fromMe,
  });

  if (normalized.fromMe) {
    console.info("[whatsapp:inbox-skipped]", { reason: "from_me", message_id: normalized.messageId, instance: normalized.instance });
    await finishTrace(trace, { status: "skipped", reason: "from_me" });
    return { ...normalized, received_at: normalized.timestamp, trace_id: trace?.id || null, inbox: { saved: false, reason: "from_me" }, text: "" };
  }
  if (!normalized.phone) {
    console.info("[whatsapp:inbox-skipped]", { reason: "missing_phone", remoteJid: normalized.remoteJid, message_id: normalized.messageId });
    await finishTrace(trace, { status: "skipped", reason: "missing_phone" });
    return { ...normalized, received_at: normalized.timestamp, trace_id: trace?.id || null, inbox: { saved: false, reason: "missing_phone" } };
  }
  if (!normalized.customerAvatarUrl) {
    normalized.customerAvatarUrl = await fetchWhatsappCustomerProfilePicture({
      phone: normalized.resolvedPhone || normalized.phone,
      instance: normalized.instance,
    });
  }
  if (!normalized.text) {
    if (mediaDescriptor.type) {
      const sessionId = normalizeWhatsappSessionId(normalized.resolvedReplyJid || normalized.phone, normalized.resolvedPhone || normalized.phone);
      const mediaMessage = mediaDescriptor.label || "📎 مرفق";
      await upsertChannelConversationMapping({
        tenantId: traceTenantId,
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        externalConversationId: sessionId,
        externalCustomerId: normalized.phone,
        customerName: normalized.senderName,
        customerAvatarUrl: normalized.customerAvatarUrl,
        metadata: {
          phone: normalized.phone,
          remote_jid: normalized.remoteJid,
          resolved_reply_jid: normalized.resolvedReplyJid,
          resolved_phone: normalized.resolvedPhone || normalized.phone,
          instance: normalized.instance,
          source: "evolution_api",
          last_message: mediaMessage,
          provider_message_id: normalized.messageId,
        },
        lastMessageAt: normalized.timestamp,
      });
      const mediaRow = await appendInboundAiSupportMessage({
        tenantId: traceTenantId,
        sessionId,
        message: mediaMessage,
        messageType: mediaDescriptor.type,
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        customerName: normalized.senderName,
        deliveryStatus: "received",
        externalMessageId: normalized.messageId,
        providerMessageId: normalized.messageId,
        visualAttachments: mediaDescriptor.visualAttachments,
        source: "whatsapp_provider_media",
        sourcePath: "whatsapp_provider_media",
        insertSource: "whatsapp_provider_media",
        whatsappInstance: normalized.instance,
        remoteJid: normalized.remoteJid,
        resolvedReplyJid: normalized.resolvedReplyJid,
        resolvedPhone: normalized.resolvedPhone || normalized.phone,
      });
      if (normalized.customerAvatarUrl) {
        await db.query(
          `UPDATE ai_support_sessions SET customer_avatar_url = $1 WHERE tenant_id = $2 AND session_id = $3`,
          [normalized.customerAvatarUrl, traceTenantId, sessionId]
        );
      }
      await setTraceInboundMessage(trace, mediaRow?.id || null);
      await finishTrace(trace, { status: "saved", reason: "media_only_no_ai" });
      return {
        ...normalized,
        text: "",
        received_at: normalized.timestamp,
        customer_name: normalized.senderName,
        message_id: normalized.messageId,
        instanceName: normalized.instance,
        trace_id: trace?.id || null,
        inbox: {
          saved: Boolean(mediaRow),
          duplicate: !mediaRow,
          reason: mediaRow ? "media_saved" : "duplicate",
          message: mediaRow || null,
          session_id: sessionId,
        },
      };
    }
    console.info("[whatsapp:inbox-skipped]", { reason: "missing_text", phoneSuffix: normalized.phone.slice(-4), message_id: normalized.messageId });
    await finishTrace(trace, { status: "skipped", reason: "missing_text" });
    return { ...normalized, received_at: normalized.timestamp, trace_id: trace?.id || null, inbox: { saved: false, reason: "missing_text" } };
  }

  try {
    const inbox = await saveWhatsappIncomingToAiInbox(normalized);
    await setTraceInboundMessage(trace, inbox?.message?.id || null);
    await addTraceStep(trace, "inbox_saved", {
      session_id: inbox?.session_id || `whatsapp:${normalized.phone}`,
      conversation_id: inbox?.session_id || `whatsapp:${normalized.phone}`,
      ai_support_message_id: inbox?.message?.id || null,
      saved: inbox?.saved === true,
      duplicate: inbox?.duplicate === true,
    });
    return {
      ...normalized,
      received_at: normalized.timestamp,
      customer_name: normalized.senderName,
      message_id: normalized.messageId,
      instanceName: normalized.instance,
      trace_id: trace?.id || null,
      inbox,
    };
  } catch (error) {
    console.error("[whatsapp:inbox-error]", {
      message: error?.message || String(error),
      code: error?.code || "",
      phoneSuffix: normalized.phone ? normalized.phone.slice(-4) : "",
      message_id: normalized.messageId,
    });
    await failTrace(trace, error, { phase: "inbox_saved", message_id: normalized.messageId });
    throw error;
  }
};

export const triggerWhatsappAiAutoReply = async (message = {}) => {
  if (String(process.env.WHATSAPP_AI_AUTO_REPLY).toLowerCase() === "false") {
    console.log("[whatsapp:ai-auto-reply-disabled]");
    return { triggered: false, sent: false, reason: "ai_auto_reply_disabled" };
  }
  const rawText = text(message?.text || message?.message_text || message?.body || "");
  console.info("[ai-auto-reply] stage=webhook_received", {
    event: text(message?.event || ""),
    rawEvent: text(message?.rawEvent || ""),
    remoteJid: text(message?.remoteJid || message?.remote_jid || ""),
    key_remoteJid: text(message?.raw?.key?.remoteJid || message?.raw?.key?.remote_jid || ""),
    message_key_id: text(message?.raw?.message?.key?.id || message?.raw?.key?.id || ""),
    messageId: text(message?.message_id || message?.messageId || ""),
    text: rawText,
    textLength: rawText.length,
    fromMe: message?.fromMe === true,
    inbox_saved: message?.inbox?.saved === true,
    inbox_duplicate: message?.inbox?.duplicate === true,
  });
  if (message?.isGroup === true) {
    console.info("[whatsapp:ai-skipped]", {
      reason: "group_chat",
      message_id: message?.message_id || message?.messageId || "",
      remoteJid: text(message?.remoteJid || message?.remote_jid || ""),
    });
    return { triggered: false, sent: false, reason: "group_chat" };
  }
  const inboundText = rawText;
  if (message?.fromMe === true) {
    const ownerJids = outboundOwnerJidsForMessage(message);
    const ownerJid = ownerJids[0] || "";
    console.info("[whatsapp:skip-from-me-before-ai]", {
      remoteJid: text(message?.remoteJid || message?.remote_jid || ""),
      sender: text(message?.sender || ""),
      participant: text(message?.participant || ""),
      fromMe: true,
      ownerJid,
      configuredBotNumber: ownerNumberFromJids(ownerJids),
      resolvedJid: "",
      skip_reason: "from_me",
      message_id: message?.message_id || message?.messageId || "",
    });
    await addTraceStep(message?.trace_id, "ai_mode_check", {
      shouldAutoSend: false,
      skip_reason: "from_me",
    });
    await finishTrace(message?.trace_id, { status: "skipped", reason: "from_me" });
    return { triggered: false, sent: false, reason: "from_me" };
  }
  console.info("[ai-auto-reply] stage=skip_check_passed", {
    messageId: text(message?.message_id || message?.messageId || ""),
    remoteJid: text(message?.remoteJid || message?.remote_jid || ""),
    fromMe: message?.fromMe === true,
    inbox_saved: message?.inbox?.saved === true,
    inbox_duplicate: message?.inbox?.duplicate === true,
  });
  const blockedByInboxGate = !message?.text || message?.fromMe || message?.inbox?.saved === false || message?.inbox?.duplicate === true || message?.inbox?.saved !== true;
  console.info("[ai-duplicate-gate]", {
    message_id: message?.message_id || message?.messageId || message?.inbox?.message?.external_message_id || "",
    conversation_id: message?.inbox?.session_id || message?.conversation_id || `whatsapp:${message?.phone || ""}`,
    saved: message?.inbox?.saved === true,
    duplicate: message?.inbox?.duplicate === true,
    shouldAutoSend: !blockedByInboxGate,
    blocked_ai_send: blockedByInboxGate,
  });
  if (blockedByInboxGate) {
    console.info("[whatsapp:ai-skipped]", {
      reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : message?.inbox?.duplicate === true ? "duplicate_inbox" : "inbox_not_saved",
      message_id: message?.message_id || message?.messageId || "",
    });
    await addTraceStep(message?.trace_id, "ai_mode_check", {
      shouldAutoSend: false,
      skip_reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : message?.inbox?.duplicate === true ? "duplicate_inbox" : "inbox_not_saved",
    });
    await finishTrace(message?.trace_id, { status: "skipped", reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : message?.inbox?.duplicate === true ? "duplicate_inbox" : "inbox_not_saved" });
    return { triggered: false, sent: false, reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : message?.inbox?.duplicate === true ? "duplicate_inbox" : "inbox_not_saved" };
  }
  console.info("[ai-auto-reply] stage=skip_check_passed", {
    messageId: text(message?.message_id || message?.messageId || ""),
    remoteJid: text(message?.remoteJid || message?.remote_jid || ""),
    fromMe: message?.fromMe === true,
    inbox_saved: message?.inbox?.saved === true,
    inbox_duplicate: message?.inbox?.duplicate === true,
  });
  console.info("[ai-auto-reply] stage=inbound_saved", {
    messageId: text(message?.message_id || message?.messageId || ""),
    conversation_id: text(message?.inbox?.session_id || message?.conversation_id || `whatsapp:${message?.phone || ""}`),
    inbox_saved: message?.inbox?.saved === true,
    inbox_duplicate: message?.inbox?.duplicate === true,
    ai_support_message_id: text(message?.inbox?.message?.id || message?.inbox?.message?.external_message_id || ""),
  });
  const generated = await generateWhatsappAiAutoReply({
    tenantId: message.raw?.tenant_id || message.raw?.tenantId || process.env.WHATSAPP_TENANT_ID || 1,
    phone: message.phone,
    sessionId: message.inbox?.session_id || `whatsapp:${message.phone}`,
    customerName: message.customer_name || message.senderName || "",
    messageText: message.text,
    timestamp: message.received_at || message.timestamp,
    traceId: message.trace_id || null,
  });
  console.info("[ai-auto-reply] stage=ai_generation_done", {
    messageId: text(message?.message_id || message?.messageId || ""),
    conversation_id: text(message?.inbox?.session_id || message?.conversation_id || `whatsapp:${message?.phone || ""}`),
    triggered: generated?.triggered === true,
    sent: generated?.sent === true,
    reason: text(generated?.reason || ""),
    reply_length: text(generated?.replyText || "").length,
  });
  const generatedCards = asArray(generated?.aiPayload?.product_cards || generated?.aiPayload?.suggested_products || generated?.reply?.product_cards || generated?.whatsapp_image_cards || []);
  if (!generated.replyText && !generatedCards.length) return generated;

  const outboundReplyTarget = resolveOutboundWhatsappReplyTarget(message);
  const sendTargetNumber = outboundReplyTarget.resolvedNumber;
  console.info("[whatsapp:reply-target-resolution]", {
    remoteJid: outboundReplyTarget.remoteJid,
    participant: outboundReplyTarget.participant,
    sender: outboundReplyTarget.sender,
    fromMe: outboundReplyTarget.fromMe,
    connectedOwnerJid: outboundReplyTarget.connectedOwnerJid,
    instanceOwnerJid: outboundReplyTarget.instanceOwnerJid,
    ownerJid: outboundReplyTarget.ownerJid,
    configuredBotNumber: outboundReplyTarget.configuredBotNumber,
    resolvedJid: outboundReplyTarget.resolvedJid,
    resolvedNumber: outboundReplyTarget.resolvedNumber,
    reason: outboundReplyTarget.reason,
    isGroup: outboundReplyTarget.isGroup,
    isLid: outboundReplyTarget.isLid,
  });
  if (!sendTargetNumber) {
    const skipReason = outboundReplyTarget.reason || "no_reply_target";
    const skipLogLabel = skipReason === "owner_target" ? "[whatsapp:send-skipped-own-number]" : "[whatsapp:send-skipped-lid-unresolved]";
    console.info(skipLogLabel, {
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      remoteJid: outboundReplyTarget.remoteJid,
      participant: outboundReplyTarget.participant,
      sender: outboundReplyTarget.sender,
      fromMe: outboundReplyTarget.fromMe,
      connectedOwnerJid: outboundReplyTarget.connectedOwnerJid,
      instanceOwnerJid: outboundReplyTarget.instanceOwnerJid,
      ownerJid: outboundReplyTarget.ownerJid,
      configuredBotNumber: outboundReplyTarget.configuredBotNumber,
      reason: outboundReplyTarget.reason,
      isGroup: outboundReplyTarget.isGroup,
      isLid: outboundReplyTarget.isLid,
      replyLength: generated.replyText.length,
    });
    await appendAiGeneratedSupportReply({
      tenantId: generated.tenantId,
      sessionId: normalizeWhatsappSessionId(generated.sessionId, message.phone),
      clientRequestId: message.trace_id || traceId || generated.sessionId,
      answer: generated.replyText,
      confidence: generated.aiPayload?.confidence || 0,
      detectedIntent: generated.aiPayload?.detected_intent || "whatsapp_ai_reply",
      suggestedProducts: generated.aiPayload?.suggested_products || [],
      visualAttachments: generated.aiPayload?.visual_attachments || [],
      suggestedActions: generated.aiPayload?.suggested_actions || [],
      productCards: generated.aiPayload?.product_cards || generated.aiPayload?.suggested_products || [],
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      deliveryStatus: "suggested",
      deliveryError: skipReason === "owner_target" ? "owner_target_connected_instance" : "lid_unresolved_no_real_phone_jid",
      sourcePath: skipReason === "owner_target" ? "whatsapp_ai_auto_reply_owner_target" : "whatsapp_ai_auto_reply_lid_unresolved",
      insertSource: "whatsapp_ai_suggestion",
    }).catch((error) => {
      console.warn(skipReason === "owner_target" ? "[whatsapp:send-skipped-own-number:suggestion-save-failed]" : "[whatsapp:send-skipped-lid-unresolved:suggestion-save-failed]", {
        sessionId: generated.sessionId,
        message: error?.message || String(error),
      });
    });
    await logWhatsappAiOutbound({
      tenantId: generated.tenantId,
      phone: message.phone,
      sessionId: generated.sessionId,
      replyText: generated.replyText,
      sent: false,
      metadata: {
        reason: skipReason,
        reply_target: outboundReplyTarget,
      },
    });
    await addTraceStep(message.trace_id, "send_to_whatsapp", {
      target_phone_suffix: "",
      evolution_instance: instanceName(),
      delivery_status: "skipped",
      skip_reason: skipReason,
      reply_target: outboundReplyTarget,
    });
    await finishTrace(message.trace_id, { status: "skipped", reason: skipReason });
    return { ...generated, sent: false, reason: skipReason, replyTarget: outboundReplyTarget };
  }
  console.info("[ai-auto-reply] stage=send_whatsapp_start", {
    conversation_id: outboundReplyTarget.conversation_id || outboundReplyTarget.resolvedJid || outboundReplyTarget.remoteJid || `whatsapp:${message?.phone || ""}`,
    remoteJid: outboundReplyTarget.remoteJid || "",
    resolved_jid: outboundReplyTarget.resolvedJid || "",
    resolved_phone: sendTargetNumber,
    reply_length: generated.replyText.length,
  });
  const ownerTarget = { jid: outboundReplyTarget.resolvedJid || jidFromNumber(sendTargetNumber), number: sendTargetNumber };
  const outgoingTargetsOwner = message.fromMe === false && targetEqualsOwner(ownerTarget, outboundOwnerJidsForMessage(message));
  if (outgoingTargetsOwner) {
    logReplyTargetCandidateRejected({
      candidateJid: ownerTarget.jid,
      candidateNumber: ownerTarget.number,
      reason: "owner_number",
    });
    console.info("[whatsapp:send-skipped-own-number]", {
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      remoteJid: outboundReplyTarget.remoteJid,
      participant: outboundReplyTarget.participant,
      sender: outboundReplyTarget.sender,
      fromMe: outboundReplyTarget.fromMe,
      connectedOwnerJid: outboundReplyTarget.connectedOwnerJid,
      instanceOwnerJid: outboundReplyTarget.instanceOwnerJid,
      ownerJid: outboundReplyTarget.ownerJid,
      configuredBotNumber: outboundReplyTarget.configuredBotNumber,
      resolvedJid: outboundReplyTarget.resolvedJid,
      resolvedNumber: sendTargetNumber,
      reason: "owner_number",
      isGroup: outboundReplyTarget.isGroup,
      isLid: outboundReplyTarget.isLid,
      replyLength: generated.replyText.length,
    });
    await appendAiGeneratedSupportReply({
      tenantId: generated.tenantId,
      sessionId: normalizeWhatsappSessionId(generated.sessionId, message.phone),
      clientRequestId: message.trace_id || traceId || generated.sessionId,
      answer: generated.replyText,
      confidence: generated.aiPayload?.confidence || 0,
      detectedIntent: generated.aiPayload?.detected_intent || "whatsapp_ai_reply",
      suggestedProducts: generated.aiPayload?.suggested_products || [],
      visualAttachments: generated.aiPayload?.visual_attachments || [],
      suggestedActions: generated.aiPayload?.suggested_actions || [],
      productCards: generated.aiPayload?.product_cards || generated.aiPayload?.suggested_products || [],
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      deliveryStatus: "suggested",
      deliveryError: "owner_target_connected_instance",
      sourcePath: "whatsapp_ai_auto_reply_owner_target",
      insertSource: "whatsapp_ai_suggestion",
    }).catch((error) => {
      console.warn("[whatsapp:send-skipped-own-number:suggestion-save-failed]", {
        sessionId: generated.sessionId,
        message: error?.message || String(error),
      });
    });
    await logWhatsappAiOutbound({
      tenantId: generated.tenantId,
      phone: message.phone,
      sessionId: generated.sessionId,
      replyText: generated.replyText,
      sent: false,
      metadata: {
        reason: "owner_target",
        reply_target: outboundReplyTarget,
      },
    });
    await addTraceStep(message.trace_id, "send_to_whatsapp", {
      target_phone_suffix: sendTargetNumber.slice(-4),
      evolution_instance: instanceName(),
      delivery_status: "skipped",
      skip_reason: "owner_target",
      reply_target: outboundReplyTarget,
    });
    await finishTrace(message.trace_id, { status: "skipped", reason: "owner_target" });
    console.info("[ai-auto-reply] stage=send_whatsapp_done", {
      conversation_id: outboundReplyTarget.conversation_id || outboundReplyTarget.resolvedJid || outboundReplyTarget.remoteJid || `whatsapp:${message?.phone || ""}`,
      sent: false,
      reason: "owner_target",
    });
    return { ...generated, sent: false, reason: "owner_target", replyTarget: outboundReplyTarget };
  }

  console.info("[whatsapp:ai-send-start]", {
    target: "evolution-sendText",
    tenantId: generated.tenantId,
    sessionId: generated.sessionId,
    phoneSuffix: sendTargetNumber.slice(-4),
    replyLength: generated.replyText.length,
  });
  await addTraceStep(message.trace_id, "send_to_whatsapp", {
    target_phone_suffix: sendTargetNumber.slice(-4),
    evolution_instance: instanceName(),
    delivery_status: "sending",
    error: "",
  });
  try {
    const isImageFollowup = ["image_request", "more_images"].includes(text(generated.aiPayload?.detected_intent));
    const allImageCards = shouldSendProductImages(generated) ? collectProductImageCards({ generated }) : [];
    const outboundCards = allImageCards.map((card) => ({
      ...card,
      product: {
        ...card.product,
        selected_variant_id: card.product?.selected_variant_id || card.product?.variant_id || card.product?.selected_variant?.id || card.product?.selected_variant?.variant_id || card.product?.variant?.id || card.product?.variant?.variant_id || null,
      },
    }));
    const beforeCardDedupe = outboundCards.length;
    const outboundSeen = new Set();
    const dedupedOutboundCards = [];
    for (const card of outboundCards) {
      const productId = text(card.product_id || card.product?.id || card.id || "");
      const variantId = text(card.variant_id || card.selected_variant_id || "");
      const colorKey = text(card.color || card.product?.color || card.matched_variant_color || "").toLowerCase();
      const imageKey = normalizeDuplicateImageUrl(card.resolved_image_url || card.imageUrl || card.image_url || "");
      const dedupeKey =
        (productId && colorKey ? `${productId}|${colorKey}` : "") ||
        (variantId ? `${productId}|${variantId}` : "") ||
        (!colorKey && imageKey ? `${productId}|${imageKey}` : "") ||
        `${productId || "product"}|${colorKey || variantId || imageKey || "unknown"}`;
      if (outboundSeen.has(dedupeKey)) continue;
      outboundSeen.add(dedupeKey);
      dedupedOutboundCards.push(card);
    }
    if (beforeCardDedupe !== dedupedOutboundCards.length) {
      debugAiImagesLog("[image-card-dedupe]", {
        before_count: beforeCardDedupe,
        after_count: dedupedOutboundCards.length,
        removed_count: beforeCardDedupe - dedupedOutboundCards.length,
      });
    }
    const outboundPlan = buildWhatsappOutboundPlan({
      message,
      aiPayload: generated.aiPayload || {},
      replyText: generated.replyText || "",
      cards: dedupedOutboundCards,
    });
    await addTraceStep(message.trace_id, "outbound_plan", {
      conversation_id: outboundPlan.conversation_id,
      inbound_message_id: outboundPlan.inbound_message_id,
      intent: outboundPlan.intent,
      route: outboundPlan.route,
      text_length: outboundPlan.text.length,
      cards_count: outboundPlan.cards.length,
      will_send_text: outboundPlan.will_send_text,
      will_send_cards: outboundPlan.will_send_cards,
      selected_product_ids: outboundPlan.selected_product_ids,
      selected_variant_ids: outboundPlan.selected_variant_ids,
    });
    const dedupeResult = await blockDuplicateWhatsappReply({
      tenantId: message.tenant_id || message.tenantId || process.env.WHATSAPP_TENANT_ID || 0,
      plan: outboundPlan,
      outboundType: outboundPlan.will_send_cards ? "cards" : "text",
    });
    if (dedupeResult.blocked) {
      await addTraceStep(message.trace_id, "duplicate_reply_blocked", {
        conversation_id: outboundPlan.conversation_id,
        inbound_message_id: outboundPlan.inbound_message_id,
        channel: outboundPlan.channel,
        instance: outboundPlan.instance,
      });
      await finishTrace(message.trace_id, { status: "skipped", reason: "duplicate_reply" });
      console.info("[ai-auto-reply] stage=send_whatsapp_done", {
        conversation_id: outboundPlan.conversation_id,
        sent: false,
        reason: "duplicate_reply",
      });
      return { triggered: true, sent: false, reason: "duplicate_reply", aiPayload: generated.aiPayload, replyText: "", outboundPlan };
    }
    console.info("[whatsapp-image-cards-input]", {
      cards_count: dedupedOutboundCards.length,
      first_5_cards: dedupedOutboundCards.slice(0, 5).map(productImageDebugCard),
    });
    const firstCard = dedupedOutboundCards[0] || {};
    console.info("[CHANNEL_CARD_PAYLOAD]", {
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      product_cards_count: dedupedOutboundCards.length,
      image_cards_count: dedupedOutboundCards.length,
      first_card: {
        product_id: text(firstCard.product_id || firstCard.id || ""),
        variant_id: text(firstCard.variant_id || firstCard.selected_variant_id || firstCard.matched_variant_id || ""),
        name: text(firstCard.name || firstCard.title || firstCard.product_name || ""),
        color: text(firstCard.color || firstCard.matched_variant_color || ""),
        price: text(firstCard.price || ""),
        available_sizes: Array.isArray(firstCard.available_sizes || firstCard.sizes) ? (firstCard.available_sizes || firstCard.sizes).map((item) => text(item)).filter(Boolean) : [],
        product_url: text(firstCard.product_url || firstCard.url || ""),
        image_url: text(firstCard.image_url || firstCard.image || firstCard.main_image || ""),
      },
    });
    for (const card of dedupedOutboundCards.slice(0, 6)) {
      console.info("[whatsapp-card-built]", {
        product_id: text(card.product_id || card.id || ""),
        variant_id: text(card.variant_id || card.selected_variant_id || ""),
        product_name: text(card.name || card.title || ""),
        color: text(card.color || ""),
        price: text(card.price || ""),
        sizes: asArray(card.available_sizes || card.sizes),
        image_url_present: Boolean(text(card.image_url || card.image || card.main_image || card.variant_image || card.color_image || "")),
        product_url: text(card.product_url || card.url || ""),
      });
    }
    const validImageCards = dedupedOutboundCards.filter((card) => card.valid && !card.skip_reason);
    const imageCards = [];
    const skippedImageCards = dedupedOutboundCards.filter((card) => !card.valid || card.skip_reason);
    for (const card of validImageCards) {
      imageCards.push(card);
    }
    const sendableImageCards = imageCards;
    console.info("[WHATSAPP_IMAGE_CARDS_FINAL]", {
      product_id: outboundPlan.selected_product_ids[0] || null,
      requested_all_images: Boolean(isImageFollowup),
      source: Array.isArray(generated?.aiPayload?.whatsapp_image_cards) && generated.aiPayload.whatsapp_image_cards.length
        ? "aiPayload.whatsapp_image_cards"
        : "legacy_sender_path",
      colors_count: [...new Set(sendableImageCards.map((card) => text(card.color || card.color_name || card.matched_variant_color || "")))].filter(Boolean).length,
      colors: [...new Set(sendableImageCards.map((card) => text(card.color || card.color_name || card.matched_variant_color || "")))].filter(Boolean),
      cards_count: sendableImageCards.length,
      sent_count: 0,
    });
    const imageMessages = [];
    const imageSendErrors = [];
    let result = null;
    const currentIntent = text(generated.aiPayload?.detected_intent || generated.aiPayload?.intent?.type || generated.aiPayload?.intent || "");
    console.log("[AI_CHANNEL_ADAPTER_SEND]", {
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      adapter_used: "whatsappAdapter",
      conversation_id: outboundPlan.conversation_id,
      provider_message_id: text(message.external_message_id || message.raw?.event?.message?.mid || ""),
      inbound_text: inboundText,
      intent: currentIntent,
      products_count: Array.isArray(generated.aiPayload?.suggested_products) ? generated.aiPayload.suggested_products.length : 0,
      product_cards_count: Array.isArray(generated.aiPayload?.product_cards) ? generated.aiPayload.product_cards.length : 0,
      image_cards_count: sendableImageCards.length,
      actions_count: Array.isArray(generated.aiPayload?.actions) ? generated.aiPayload.actions.length : 0,
      early_return_reason: "",
    });
    const explicitProductFollowup = /(بكام|السعر|سعره|price|cost|متاح|موجود|الوانه|الوان|صور|صوره|صور اكتر|لينك|لينكه|مقاس|المقاسات|عايز ده|فيه منه|فيه من|ابعت اللينك|ابعته)/i.test(text(message.text || message.message_text || ""));
    const willSendCards = outboundPlan.will_send_cards;
    const shouldSendTextOnly = outboundPlan.will_send_text && !willSendCards;
    const imageDuplicateGroups = new Map();
    for (const [cardIndex, card] of sendableImageCards.entries()) {
      const imageUrl = text(card?.resolved_image_url || card?.imageUrl || card?.image_url || card?.image || card?.main_image || "");
      if (!imageUrl) continue;
      const entry = imageDuplicateGroups.get(imageUrl) || {
        image_url: imageUrl,
        cards: [],
      };
      entry.cards.push({
        card_index: Number.isFinite(Number(card?.card_index)) ? Number(card.card_index) : cardIndex,
        product_id: text(card?.product?.id || card?.product?.product_id || card?.product_id || card?.id || ""),
        variant_id: text(card?.variant_id || card?.selected_variant_id || card?.matched_variant_id || ""),
        color: text(card?.color || card?.matched_variant_color || ""),
        title: text(card?.name || card?.title || card?.product?.name || card?.product?.title || ""),
      });
      imageDuplicateGroups.set(imageUrl, entry);
    }
    for (const group of imageDuplicateGroups.values()) {
      if (group.cards.length < 2) continue;
      const first = group.cards[0] || {};
      const hasDistinctCardMeta = group.cards.some((card) =>
        card.color !== first.color ||
        card.variant_id !== first.variant_id ||
        card.product_id !== first.product_id ||
        card.title !== first.title
      );
      if (hasDistinctCardMeta) {
        console.warn("[whatsapp-product-card-image-duplicate-warning]", {
          duplicated_image_url: group.image_url,
          card_indexes: group.cards.map((card) => card.card_index),
          product_id: group.cards.map((card) => card.product_id).filter(Boolean),
          variant_id: group.cards.map((card) => card.variant_id).filter(Boolean),
          color: group.cards.map((card) => card.color).filter(Boolean),
          title: group.cards.map((card) => card.title).filter(Boolean),
        });
      }
    }
    if (willSendCards) {
      console.info("[whatsapp-standalone-text-skipped]", {
        reason: "cards_present",
        conversation_id: outboundPlan.conversation_id,
        inbound_message_id: outboundPlan.inbound_message_id,
      });
      await addTraceStep(message.trace_id, "standalone_text_skipped", {
        reason: "cards_present",
        conversation_id: outboundPlan.conversation_id,
        inbound_message_id: outboundPlan.inbound_message_id,
      });
    }
    if (shouldSendTextOnly) {
      const rawText = /(^|\s)(سعره|السعر|جنيه|egp|\d+\s*جنيه)/i.test(outboundPlan.text) && !explicitProductFollowup && !isImageFollowup
        ? "وعليكم السلام ورحمة الله، أهلاً بيك يا فندم "
        : outboundPlan.text;
      const safeText = applyWhatsappGreetingGuard({
        customerMessageText: message.message_text || "",
        replyText: rawText,
      });
      console.info("[whatsapp-final-channel-reply]", {
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        source: "whatsappGatewayService",
        normalized_message: normalizedTraceMessage(message.message_text || ""),
        detected_intent: currentIntent,
        reply_preview: previewText(safeText),
        produced_by: "whatsappGatewayService",
      });
      if (safeText !== outboundPlan.text) {
        console.warn("[ai-standalone-price-text-blocked]", {
          conversation_id: outboundPlan.conversation_id,
          inbound_message_id: outboundPlan.inbound_message_id,
          detected_intent: currentIntent,
          text_preview: outboundPlan.text.slice(0, 120),
        });
      }
      result = await sendTextMessage({ phone: sendTargetNumber, message: safeText });
    }
    const runtimeProductId = outboundPlan.selected_product_ids[0] || null;
    const runtimeColorsFound = [...new Set(dedupedOutboundCards.map((card) => text(card.color || card.product?.color || card.matched_variant_color || "")).filter(Boolean))];
    console.info("[PRODUCT_IMAGES_RUNTIME_OWNER]", {
      file: "server/services/whatsappGatewayService.js",
      function: "generateWhatsappAiAutoReply",
      code_version: "color_first_v2",
    });
    console.info("[image-flow-color-source]", {
      product_id: runtimeProductId,
      colors_found: runtimeColorsFound.length,
      distinct_colors: runtimeColorsFound.length,
      sent_colors: sendableImageCards.length,
      colors: runtimeColorsFound,
    });
    for (const skipped of skippedImageCards) {
      const payload = imageFailureLogPayload({
        generated,
        product: skipped.product,
        cardIndex: skipped.card_index,
        imageUrl: skipped.raw_image_url,
        resolvedImageUrl: skipped.resolved_image_url,
        mimeType: skipped.mime_type,
        reason: skipped.skip_reason || "invalid_private_url",
      });
      imageSendErrors.push({
        image_url: skipped.raw_image_url,
        resolved_image_url: skipped.resolved_image_url,
        product_id: skipped.product?.id || skipped.product?.product_id || null,
        error: { message: payload.error_message, status: "", code: skipped.skip_reason || "INVALID_IMAGE_URL" },
      });
      console.error("[whatsapp-image-send-failed]", payload);
    }
    for (const [sendIndex, { product, imageUrl, resolved_image_url, raw_image_url, card_index, mime_type, normalized_image_url }] of sendableImageCards.entries()) {
      const imageSourceUrl = resolved_image_url || imageUrl;
      const productUrl = productCardUrl(product);
      const sizes = [...new Set(asArray(product?.available_sizes || product?.sizes).map((value) => text(value)).filter(Boolean))];
      const captionVariant = resolveCaptionVariant(product);
      const captionProduct = {
        ...product,
        selected_variant: captionVariant || product.selected_variant || null,
        selected_variant_id: captionVariant?.id || captionVariant?.variant_id || product.selected_variant_id || product.variant_id || product.matched_variant_id || null,
        variant: captionVariant || product.variant || null,
        variant_id: captionVariant?.id || captionVariant?.variant_id || product.variant_id || null,
      };
      console.info("[whatsapp-product-card-send-payload]", {
        card_index: Number.isFinite(Number(card_index)) ? Number(card_index) : sendIndex,
        product_id: product?.id || product?.product_id || null,
        variant_id: captionProduct.selected_variant_id || captionProduct.variant_id || product?.variant_id || product?.matched_variant_id || null,
        color: text(product?.color || product?.matched_variant_color || ""),
        image_url: imageSourceUrl,
        title: text(product?.name || product?.title || product?.product_name || ""),
      });
      console.info("[whatsapp-card-sizes-line]", {
        product_id: product?.id || product?.product_id || null,
        variant_id: captionProduct.selected_variant_id || captionProduct.variant_id || product?.matched_variant_id || null,
        color: text(product?.color || product?.matched_variant_color || ""),
        sizes,
      });
      debugAiImagesLog("[image-card-image-url]", {
        product_id: product?.id || product?.product_id || null,
        color: text(product?.color || product?.matched_variant_color || ""),
        image_url: imageSourceUrl,
      });
      const duplicateCacheKey = duplicateCacheKeyForImage({
        phone: sendTargetNumber,
        imageUrl: imageSourceUrl,
      });
      try {
        const imageResult = await sendImageMessage({
          phone: sendTargetNumber,
          imageUrl: imageSourceUrl,
          caption: productImageCaption(captionProduct),
        });
        markSentImageDuplicateEntry({
          phone: sendTargetNumber,
          imageUrl: imageSourceUrl,
          status: "success",
          timestamp: new Date().toISOString(),
        });
        imageMessages.push({
          image_url: imageSourceUrl,
          normalized_url: normalized_image_url || normalizeDuplicateImageUrl(imageSourceUrl),
          duplicate_cache_key: duplicateCacheKey,
          product_id: product?.id || product?.product_id || null,
          result: imageResult?.result || null,
        });
      } catch (imageError) {
        const summary = errorSummary(imageError);
        clearSentImageDuplicateEntry({
          phone: sendTargetNumber,
          imageUrl: imageSourceUrl,
        });
        console.error("[whatsapp-image-send-failed]", imageFailureLogPayload({
          generated,
          product,
          cardIndex: card_index,
          imageUrl: raw_image_url || imageUrl,
          resolvedImageUrl: imageSourceUrl,
          mimeType: mime_type,
          error: imageError,
        }));
        imageSendErrors.push({
          image_url: raw_image_url || imageUrl,
          normalized_url: normalized_image_url || normalizeDuplicateImageUrl(imageSourceUrl),
          resolved_image_url: imageSourceUrl,
          duplicate_cache_key: duplicateCacheKey,
          product_id: product?.id || product?.product_id || null,
          error: summary,
        });
        if (Number(summary.status) === 500 && !willSendCards) {
          const fallbackMessage = productImageUrlFallbackMessage({
            imageUrl: imageSourceUrl,
            productUrl,
          });
          try {
            await sendTextMessage({
              phone: sendTargetNumber,
              message: fallbackMessage,
            });
            console.info("[whatsapp-image-send-fallback-text]", {
              conversation_id: generated.sessionId || "",
              session_id: generated.sessionId || "",
              image_url: imageSourceUrl,
              product_url: productUrl,
              duplicate_cache_key: duplicateCacheKey,
              evolution_status: summary.status || "",
              evolution_response: summary.data || null,
              evolution_response_raw: summary.responseRaw || "",
            });
          } catch (fallbackError) {
            console.error("[whatsapp-image-send-fallback-text-failed]", {
              conversation_id: generated.sessionId || "",
              session_id: generated.sessionId || "",
              image_url: imageSourceUrl,
              product_url: productUrl,
              duplicate_cache_key: duplicateCacheKey,
              evolution_status: summary.status || "",
              evolution_response: summary.data || null,
              evolution_response_raw: summary.responseRaw || "",
              fallback_error: errorSummary(fallbackError),
            });
          }
        }
      }
    }
    const firstFailureReason = imageSendErrors[0]?.error?.message || imageSendErrors[0]?.error?.code || "";
    if (dedupedOutboundCards.length > 0 && sendableImageCards.length === 0) {
      console.info("[whatsapp-image-cards-skipped]", {
        reason: "product_cards_present_but_no_sendable_public_image_url",
        cards_count: dedupedOutboundCards.length,
        first_5_cards: dedupedOutboundCards.slice(0, 5).map(productImageDebugCard),
        skipped_cards: skippedImageCards.map(productImageDebugCard),
      });
    }
    console.info("[product-images-send-summary]", {
      attempted_count: sendableImageCards.length,
      sent_count: imageMessages.length,
      failed_count: imageSendErrors.length,
      skipped_count: skippedImageCards.length,
      first_failure_reason: firstFailureReason,
      successful_urls_count: new Set(imageMessages.map((item) => text(item.image_url)).filter(Boolean)).size,
      invalid_urls_count: skippedImageCards.length,
    });
    await addTraceStep(message.trace_id, "product_images_send", {
      attempted_count: sendableImageCards.length,
      sent_count: imageMessages.length,
      failed_count: imageSendErrors.length,
      skipped_count: skippedImageCards.length,
      first_failure_reason: firstFailureReason,
      successful_urls_count: new Set(imageMessages.map((item) => text(item.image_url)).filter(Boolean)).size,
      invalid_urls_count: skippedImageCards.length,
    });
    let finalReplyText = applyWhatsappGreetingGuard({
      customerMessageText: message.message_text || "",
      replyText: outboundPlan.text || "",
    });
    console.info("[whatsapp-final-channel-reply]", {
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      source: "whatsappGatewayService",
      normalized_message: normalizedTraceMessage(message.message_text || ""),
      detected_intent: currentIntent,
      reply_preview: previewText(finalReplyText),
      produced_by: "whatsappGatewayService",
    });
    if (["image_request", "more_images"].includes(text(generated.aiPayload?.detected_intent))) {
      console.info("[SOURCE_A]", {
        used_memory: generated.aiPayload?.followup_memory_used === true,
        card_count: sendableImageCards.length,
        sent_count: imageMessages.length,
      });
    }
    await logWhatsappAiOutbound({
      tenantId: generated.tenantId,
      phone: sendTargetNumber,
      sessionId: generated.sessionId,
      replyText: finalReplyText,
      sent: true,
      metadata: {
        result: result?.result || null,
        image_card_count: sendableImageCards.length,
        image_messages: imageMessages,
        image_send_errors: imageSendErrors,
        outbound_plan: outboundPlan,
      },
    });
    console.info("[ai-auto-reply] stage=send_whatsapp_done", {
      conversation_id: outboundPlan.conversation_id,
      sent: true,
      send_target_phone: sendTargetNumber,
      evolution_result_ok: Boolean(result?.result || result?.success || result?.message_id || result?.messageId),
      reply_length: finalReplyText.length,
    });
    let savedOutboundMessage = null;
    try {
      const outboundSessionId = normalizeWhatsappSessionId(generated.sessionId, sendTargetNumber || generated.phone || message.phone);
      const transcriptPayload = {
        tenantId: generated.tenantId,
        sessionId: outboundSessionId,
        clientRequestId: message.trace_id || traceId || outboundPlan.inbound_message_id || generated.sessionId,
        answer: finalReplyText || generated.replyText || summarizeWhatsappProductCards(sendableImageCards),
        messageType: sendableImageCards.length ? "product_card" : "text",
        confidence: generated.aiPayload?.confidence || 0,
        detectedIntent: generated.aiPayload?.detected_intent || "whatsapp_ai_reply",
        suggestedProducts: generated.aiPayload?.suggested_products || [],
        visualAttachments: generated.aiPayload?.visual_attachments || [],
        suggestedActions: generated.aiPayload?.suggested_actions || [],
        productCards: sendableImageCards.length ? sendableImageCards : (generated.aiPayload?.product_cards || generated.aiPayload?.suggested_products || []),
        channel: AI_AGENT_CHANNELS.WHATSAPP,
        deliveryStatus: "sent",
        externalMessageId: result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || "",
        providerMessageId: result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || "",
        whatsappInstance: result?.instanceName || result?.provider || instanceName(),
        remoteJid: outboundReplyTarget.remoteJid || "",
        resolvedReplyJid: outboundReplyTarget.resolvedJid || "",
        resolvedPhone: sendTargetNumber || generated.phone || message.phone || "",
        sourcePath: "whatsapp_ai_auto_reply_sent",
        insertSource: "whatsapp_ai_send_success",
      };
      console.info("[ai-auto-reply] outbound-session-debug", {
        session_id: outboundSessionId,
        resolved_phone: sendTargetNumber || generated.phone || message.phone || "",
        resolved_reply_jid: outboundReplyTarget.resolvedJid || "",
        remote_jid: outboundReplyTarget.remoteJid || "",
      });
      console.info("[ai-auto-reply] stage=append_transcript_start", {
        session_id: transcriptPayload.sessionId,
        message_type: transcriptPayload.messageType,
        textLength: text(transcriptPayload.answer).length,
        productCardsCount: asArray(transcriptPayload.productCards).length,
        provider_message_id: transcriptPayload.providerMessageId || "",
      });
      console.info("[ai-auto-reply] append_transcript_payload", {
        session_id: transcriptPayload.sessionId,
        message_type: transcriptPayload.messageType,
        textLength: text(transcriptPayload.answer).length,
        productCardsCount: asArray(transcriptPayload.productCards).length,
        provider_message_id: transcriptPayload.providerMessageId || "",
        payload: {
          ...transcriptPayload,
          suggestedProducts: undefined,
          visualAttachments: undefined,
          suggestedActions: undefined,
          productCards: undefined,
        },
      });
      savedOutboundMessage = await appendAiGeneratedSupportReply(transcriptPayload);
      console.info("[ai-auto-reply] stage=append_transcript_done", {
        session_id: savedOutboundMessage?.session_id || transcriptPayload.sessionId,
        message_type: savedOutboundMessage?.message_type || transcriptPayload.messageType,
        textLength: text(savedOutboundMessage?.message_text || savedOutboundMessage?.ai_answer || savedOutboundMessage?.customer_message || transcriptPayload.answer).length,
        productCardsCount: asArray(savedOutboundMessage?.product_cards || transcriptPayload.productCards).length,
        provider_message_id: savedOutboundMessage?.provider_message_id || savedOutboundMessage?.external_message_id || transcriptPayload.providerMessageId || "",
        saved_message_id: savedOutboundMessage?.id || null,
      });
      console.info("[ai-auto-reply] stage=outbound_saved", {
        conversation_id: outboundPlan.conversation_id,
        sent: true,
        transcript_saved: Boolean(savedOutboundMessage?.id),
        saved_message_id: savedOutboundMessage?.id || null,
        session_id: savedOutboundMessage?.session_id || normalizeWhatsappSessionId(generated.sessionId, sendTargetNumber || generated.phone || message.phone),
        message_type: savedOutboundMessage?.message_type || (sendableImageCards.length ? "product_card" : "text"),
        productCardsCount: asArray(savedOutboundMessage?.product_cards || sendableImageCards).length,
        provider_message_id: savedOutboundMessage?.provider_message_id || savedOutboundMessage?.external_message_id || result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || "",
        send_target_phone: sendTargetNumber,
      });
    } catch (saveError) {
      console.error("[ai-auto-reply] stage=append_transcript_error", {
        tenantId: generated.tenantId,
        sessionId: generated.sessionId,
        conversation_id: outboundPlan.conversation_id,
        message_type: sendableImageCards.length ? "product_card" : "text",
        textLength: finalReplyText.length,
        productCardsCount: sendableImageCards.length,
        provider_message_id: result?.result?.message_id || result?.result?.messageId || result?.result?.key?.id || result?.message_id || "",
        message: saveError?.message || String(saveError),
        stack: saveError?.stack || "",
      });
    }
    console.info("[whatsapp:ai-sent]", {
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      phoneSuffix: sendTargetNumber.slice(-4),
      replyLength: finalReplyText.length,
      image_card_count: sendableImageCards.length,
      image_sent_count: imageMessages.length,
      image_failed_count: imageSendErrors.length,
    });
    console.info("[whatsapp-outbound-send]", {
      conversation_id: outboundPlan.conversation_id,
      inbound_message_id: outboundPlan.inbound_message_id,
      outbound_type: outboundPlan.will_send_cards ? "cards" : "text",
      cards_count: sendableImageCards.length,
      text_length: finalReplyText.length,
    });
    await addTraceStep(message.trace_id, "outbound_send", {
      conversation_id: outboundPlan.conversation_id,
      inbound_message_id: outboundPlan.inbound_message_id,
      outbound_type: outboundPlan.will_send_cards ? "cards" : "text",
      cards_count: sendableImageCards.length,
      text_length: finalReplyText.length,
    });
    await addTraceStep(message.trace_id, "send_to_whatsapp", {
      target_phone_suffix: sendTargetNumber.slice(-4),
      evolution_instance: result?.instanceName || instanceName(),
      delivery_status: "sent",
      error: "",
      result: result?.result || null,
    });
    await finishTrace(message.trace_id, {
      status: "sent",
      replyLength: finalReplyText.length,
      image_card_count: sendableImageCards.length,
      image_sent_count: imageMessages.length,
      image_failed_count: imageSendErrors.length,
    });
    console.info("[ai-auto-reply] stage=send_branch_return", {
      conversation_id: outboundPlan.conversation_id,
      outbound_saved: Boolean(savedOutboundMessage?.id),
      has_reply_text: Boolean(finalReplyText),
      product_cards_count: sendableImageCards.length,
    });
    console.log("[AI_CHANNEL_ADAPTER_RESULT]", {
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      adapter_used: "whatsappAdapter",
      conversation_id: outboundPlan.conversation_id,
      provider_message_id: text(message.external_message_id || message.raw?.event?.message?.mid || ""),
      inbound_text: inboundText,
      intent: currentIntent,
      products_count: Array.isArray(generated.aiPayload?.suggested_products) ? generated.aiPayload.suggested_products.length : 0,
      product_cards_count: Array.isArray(generated.aiPayload?.product_cards) ? generated.aiPayload.product_cards.length : 0,
      image_cards_count: sendableImageCards.length,
      actions_count: Array.isArray(generated.aiPayload?.actions) ? generated.aiPayload.actions.length : 0,
      send_result: result,
    });
    return {
      ...generated,
      replyText: finalReplyText,
      sent: true,
      result,
      image_card_count: sendableImageCards.length,
      image_messages: imageMessages,
      image_send_errors: imageSendErrors,
      outbound_plan: outboundPlan,
    };
  } catch (error) {
    const summary = errorSummary(error);
    console.error("[whatsapp:ai-send-error]", {
      ...summary,
      target: "evolution-sendText",
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      phoneSuffix: sendTargetNumber.slice(-4),
    });
    await appendAiGeneratedSupportReply({
      tenantId: generated.tenantId,
      sessionId: normalizeWhatsappSessionId(generated.sessionId, sendTargetNumber || generated.phone || message.phone),
      clientRequestId: message.trace_id || traceId || outboundPlan.inbound_message_id || generated.sessionId,
      answer: generated.replyText,
      confidence: generated.aiPayload?.confidence || 0,
      detectedIntent: generated.aiPayload?.detected_intent || "whatsapp_ai_reply",
      suggestedProducts: generated.aiPayload?.suggested_products || [],
      visualAttachments: generated.aiPayload?.visual_attachments || [],
      suggestedActions: generated.aiPayload?.suggested_actions || [],
      productCards: generated.aiPayload?.product_cards || generated.aiPayload?.suggested_products || [],
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      deliveryStatus: "failed",
      deliveryError: summary.causeMessage ? `${summary.message} / cause: ${summary.causeMessage}` : summary.message,
    }).catch(() => {});
    console.info("[ai-auto-reply] outbound-session-debug", {
      session_id: normalizeWhatsappSessionId(generated.sessionId, sendTargetNumber || generated.phone || message.phone),
      resolved_phone: sendTargetNumber || generated.phone || message.phone || "",
      resolved_reply_jid: outboundReplyTarget.resolvedJid || "",
      remote_jid: outboundReplyTarget.remoteJid || "",
    });
    await logWhatsappAiOutbound({
      tenantId: generated.tenantId,
      phone: sendTargetNumber || generated.phone || message.phone,
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
      phoneSuffix: (sendTargetNumber || generated.phone || message.phone || "").slice(-4),
    });
    await addTraceStep(message.trace_id, "send_to_whatsapp", {
      target_phone_suffix: (sendTargetNumber || generated.phone || message.phone || "").slice(-4),
      evolution_instance: instanceName(),
      delivery_status: "failed",
      error: summary,
    });
    await addTraceStep(message.trace_id, "product_images_send", {
      attempted_count: 0,
      sent_count: 0,
      failed_count: 0,
      skip_reason: "text_send_failed",
    });
    await failTrace(message.trace_id, error, { phase: "send_to_whatsapp", sessionId: generated.sessionId });
    console.info("[ai-auto-reply] stage=outbound_saved", {
      conversation_id: outboundPlan.conversation_id,
      sent: false,
      transcript_saved: true,
      reason: summary.causeMessage ? `${summary.message} / cause: ${summary.causeMessage}` : summary.message,
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


