import crypto from "node:crypto";
import { emitToRooms } from "../utils/socket.js";

const text = (value = "") => String(value ?? "").trim();
const uniqueCsv = (value = "") => [...new Set(text(value).split(",").map(text).filter(Boolean))];
const isoDate = (value = "") => {
  const raw = text(value);
  const parsed = new Date(raw);
  return raw && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : "";
};

export const META_REVIEWER_ROLE = "meta_reviewer";
export const META_REVIEWER_TABS = new Set(["messenger", "instagram"]);

export const normalizeMetaReviewerRole = (value = "") => text(value).toLowerCase().replace(/[\s-]+/g, "_");
export const isMetaReviewerRole = (value = "") => normalizeMetaReviewerRole(value) === META_REVIEWER_ROLE;

export const normalizeMetaReviewerChannel = (value = "") => {
  const channel = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["facebook", "facebook_messenger", "messenger"].includes(channel)) return "messenger";
  if (["instagram", "instagram_dm"].includes(channel)) return "instagram";
  return channel;
};

const channelScope = ({ assetId, allowedSenderIds, allowedSenderHmacs, visibleMessagesAfter }) => ({
  enabled: Boolean(assetId) && (allowedSenderIds.length > 0 || allowedSenderHmacs.length > 0) && Boolean(visibleMessagesAfter),
  assetId: text(assetId),
  allowedSenderIds,
  allowedSenderHmacs,
  visibleMessagesAfter,
});

export const metaReviewerSenderScopeHmac = ({ tenantId, channel, assetId, senderScopedId } = {}, referenceSecret = "") => {
  const normalized = normalizeMetaReviewerChannel(channel);
  const secret = text(referenceSecret);
  const sender = text(senderScopedId);
  const asset = text(assetId);
  if (!secret || !Number.isFinite(Number(tenantId)) || !META_REVIEWER_TABS.has(normalized) || !asset || !sender) return "";
  return crypto.createHmac("sha256", secret)
    .update(`meta-reviewer-sender:v1:${Number(tenantId)}:${normalized}:${asset}:${sender}`)
    .digest("base64url");
};

const safeDigestIncluded = (candidate = "", allowed = []) => {
  const actual = text(candidate);
  if (!actual) return false;
  return allowed.some((value) => {
    const expected = text(value);
    return expected.length === actual.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  });
};

export const loadMetaReviewerScope = (env = process.env) => {
  const tenantId = Number.parseInt(text(env.META_REVIEWER_TENANT_ID), 10);
  const referenceSecret = text(env.META_REVIEWER_SCOPE_HMAC_KEY);
  const baseEnabled = Number.isFinite(tenantId) && tenantId > 0 && Boolean(referenceSecret);
  const messenger = channelScope({
    assetId: env.META_REVIEWER_FACEBOOK_PAGE_ID,
    allowedSenderIds: uniqueCsv(env.META_REVIEWER_ALLOWED_PSIDS),
    allowedSenderHmacs: uniqueCsv(env.META_REVIEWER_ALLOWED_MESSENGER_SENDER_HMACS),
    visibleMessagesAfter: isoDate(env.META_REVIEWER_MESSENGER_REVIEW_SESSION_STARTED_AT || env.META_REVIEWER_VISIBLE_MESSAGES_AFTER || env.META_REVIEWER_REVIEW_SESSION_STARTED_AT),
  });
  const instagram = channelScope({
    assetId: env.META_REVIEWER_INSTAGRAM_BUSINESS_ACCOUNT_ID,
    allowedSenderIds: uniqueCsv(env.META_REVIEWER_ALLOWED_INSTAGRAM_SCOPED_USER_IDS),
    allowedSenderHmacs: uniqueCsv(env.META_REVIEWER_ALLOWED_INSTAGRAM_SCOPED_USER_HMACS),
    visibleMessagesAfter: isoDate(env.META_REVIEWER_INSTAGRAM_REVIEW_SESSION_STARTED_AT),
  });
  if (!baseEnabled) {
    messenger.enabled = false;
    instagram.enabled = false;
  }
  return {
    enabled: baseEnabled && (messenger.enabled || instagram.enabled),
    tenantId: baseEnabled ? tenantId : null,
    referenceSecret: baseEnabled ? referenceSecret : "",
    channels: { messenger, instagram },
    // Compatibility for the existing Messenger deployment and management script.
    pageId: messenger.assetId,
    allowedPsids: messenger.allowedSenderIds,
    visibleMessagesAfter: messenger.visibleMessagesAfter,
  };
};

export const getMetaReviewerChannelScope = (scope = loadMetaReviewerScope(), channel = "") => {
  const normalized = normalizeMetaReviewerChannel(channel);
  return META_REVIEWER_TABS.has(normalized) ? scope?.channels?.[normalized] || null : null;
};

export const metaReviewerScopeIsClosed = (scope = loadMetaReviewerScope(), channel = "") => {
  const channelConfig = getMetaReviewerChannelScope(scope, channel);
  return !scope?.enabled || !channelConfig?.enabled;
};

export const metaReviewerConversationAllowed = ({ tenantId, channel, assetId, senderScopedId, pageId, psid } = {}, scope = loadMetaReviewerScope()) => {
  const normalized = normalizeMetaReviewerChannel(channel);
  const channelConfig = getMetaReviewerChannelScope(scope, normalized);
  const resolvedAssetId = text(assetId || pageId);
  const resolvedSenderId = text(senderScopedId || psid);
  const senderHmac = metaReviewerSenderScopeHmac({
    tenantId,
    channel: normalized,
    assetId: resolvedAssetId,
    senderScopedId: resolvedSenderId,
  }, scope?.referenceSecret);
  return Boolean(scope?.enabled && channelConfig?.enabled)
    && Number(tenantId) === Number(scope.tenantId)
    && resolvedAssetId === channelConfig.assetId
    && (channelConfig.allowedSenderIds.includes(resolvedSenderId)
      || safeDigestIncluded(senderHmac, channelConfig.allowedSenderHmacs));
};

export const metaReviewerConversationRef = (sessionId = "", scope = loadMetaReviewerScope(), channel = "messenger") => {
  const normalized = normalizeMetaReviewerChannel(channel);
  if (!scope?.enabled || !META_REVIEWER_TABS.has(normalized) || !text(sessionId)) return "";
  return crypto.createHmac("sha256", scope.referenceSecret)
    .update(`meta-reviewer-conversation:v2:${scope.tenantId}:${normalized}:${text(sessionId)}`)
    .digest("base64url").slice(0, 32);
};

export const metaReviewerConversationRefMatches = (candidateRef = "", sessionId = "", scope = loadMetaReviewerScope(), channel = "messenger") => {
  const expected = metaReviewerConversationRef(sessionId, scope, channel);
  const actual = text(candidateRef);
  return Boolean(expected && expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual)));
};

export const metaReviewerRealtimeRoom = (scope = loadMetaReviewerScope(), channel = "") => {
  const normalized = normalizeMetaReviewerChannel(channel);
  return getMetaReviewerChannelScope(scope, normalized)?.enabled
    ? `meta-reviewer:tenant:${scope.tenantId}:${normalized}-test`
    : "";
};

export const extractMetaReviewerIdentity = (record = {}, channel = record.channel) => {
  const metadata = record.channel_metadata || record.metadata || record.raw || {};
  const normalized = normalizeMetaReviewerChannel(channel);
  const assetId = normalized === "instagram"
    ? text(record.instagram_business_account_id || metadata.instagram_business_account_id || metadata.resolved_instagram_business_account_id)
    : text(record.page_id || record.facebook_page_id || metadata.page_id || metadata.facebook_page_id || metadata.resolved_page_id || metadata.recipient_page_id || metadata.raw_payload?.page_id || metadata.raw_payload?.value?.page_id || record.raw?.page_id || record.raw?.recipient_page_id);
  const senderScopedId = text(record.sender_scoped_id || record.external_customer_id || metadata.customer_psid || metadata.sender_psid || metadata.resolved_customer_id || metadata.resolved_sender_id || record.raw?.sender_psid || record.raw?.sender_id);
  return { assetId, senderScopedId };
};

export const sanitizeMetaReviewerMessage = (message = {}) => ({
  id: message.id ?? null,
  text: text(message.staff_message || message.customer_message || message.message_text || message.ai_answer || message.last_message),
  direction: text(message.direction || (message.sender_type === "customer" ? "inbound" : "outbound")),
  sender_type: message.sender_type === "customer" ? "customer" : "staff",
  message_type: text(message.message_type || "text"),
  attachments: Array.isArray(message.visual_attachments) ? message.visual_attachments : [],
  delivery_status: text(message.delivery_status),
  created_at: message.created_at || null,
});

export const metaReviewerMessageVisible = (message = {}, scope = loadMetaReviewerScope(), channel = "messenger") => {
  const channelConfig = getMetaReviewerChannelScope(scope, channel);
  if (!channelConfig?.enabled || !message?.created_at) return false;
  const createdAt = new Date(message.created_at);
  const visibleAfter = new Date(channelConfig.visibleMessagesAfter);
  return !Number.isNaN(createdAt.getTime()) && createdAt.getTime() >= visibleAfter.getTime();
};

export const filterMetaReviewerVisibleMessages = (messages = [], scope = loadMetaReviewerScope(), channel = "messenger") =>
  (Array.isArray(messages) ? messages : []).filter((message) => metaReviewerMessageVisible(message, scope, channel));

export const metaReviewerAccountExpired = (value, now = new Date()) => {
  if (!value) return false;
  const expiresAt = new Date(value);
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime();
};

export const emitMetaReviewerInboundEvent = ({ tenantId, channel, assetId, senderScopedId, pageId, psid, sessionId, message } = {}, scope = loadMetaReviewerScope()) => {
  const normalized = normalizeMetaReviewerChannel(channel);
  if (!metaReviewerConversationAllowed({ tenantId, channel: normalized, assetId: assetId || pageId, senderScopedId: senderScopedId || psid }, scope)) return false;
  if (!metaReviewerMessageVisible(message, scope, normalized)) return false;
  const room = metaReviewerRealtimeRoom(scope, normalized);
  if (!room) return false;
  emitToRooms([room], "meta_reviewer:message", {
    channel: normalized,
    conversation_id: metaReviewerConversationRef(sessionId, scope, normalized),
    message: sanitizeMetaReviewerMessage(message),
    at: new Date().toISOString(),
  });
  emitToRooms([room], "meta_reviewer:refresh", { channel: normalized, at: new Date().toISOString() });
  return true;
};
