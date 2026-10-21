import crypto from "node:crypto";
import { emitToRooms } from "../utils/socket.js";
import { canonicalPhoneKey } from "../utils/phoneSearch.js";

const text = (value = "") => String(value ?? "").trim();
const uniqueCsv = (value = "") => [...new Set(text(value).split(",").map(text).filter(Boolean))];
const isoDate = (value = "") => {
  const raw = text(value);
  const parsed = new Date(raw);
  return raw && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : "";
};

export const META_REVIEWER_ROLE = "meta_reviewer";
// WhatsApp is the official Cloud API test number only (cloud:<phone_number_id>); an Evolution line
// is never a review tab, even when the same customer wrote to both numbers in one thread.
export const META_REVIEWER_TABS = new Set(["messenger", "instagram", "whatsapp"]);
export const META_REVIEWER_CLOUD_INSTANCE_PREFIX = "cloud:";

export const normalizeMetaReviewerRole = (value = "") => text(value).toLowerCase().replace(/[\s-]+/g, "_");
export const isMetaReviewerRole = (value = "") => normalizeMetaReviewerRole(value) === META_REVIEWER_ROLE;

export const normalizeMetaReviewerChannel = (value = "") => {
  const channel = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["facebook", "facebook_messenger", "messenger"].includes(channel)) return "messenger";
  if (["instagram", "instagram_dm"].includes(channel)) return "instagram";
  if (["whatsapp", "whatsapp_cloud", "whatsapp_official"].includes(channel)) return "whatsapp";
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
  const sender = normalized === "whatsapp" ? canonicalPhoneKey(senderScopedId) : text(senderScopedId);
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

/*
 * WhatsApp review scope: the official test number(s) by phone_number_id - default none, so the tab
 * is closed until META_REVIEWER_WHATSAPP_PHONE_NUMBER_IDS is set. The customer-phone allowlist
 * (raw digits or HMACs) is optional for reading the test number, but every action that SENDS to a
 * phone outside an existing test thread (campaigns, flow tests) requires it.
 */
const whatsappChannelScope = (env = process.env) => {
  const assetIds = uniqueCsv(env.META_REVIEWER_WHATSAPP_PHONE_NUMBER_IDS).filter((id) => /^[0-9]{5,32}$/.test(id));
  const allowedSenderIds = [...new Set(uniqueCsv(env.META_REVIEWER_WHATSAPP_ALLOWED_PHONES).map((phone) => canonicalPhoneKey(phone)).filter(Boolean))];
  const allowedSenderHmacs = uniqueCsv(env.META_REVIEWER_WHATSAPP_ALLOWED_PHONE_HMACS);
  const visibleMessagesAfter = isoDate(env.META_REVIEWER_WHATSAPP_REVIEW_SESSION_STARTED_AT || env.META_REVIEWER_VISIBLE_MESSAGES_AFTER || env.META_REVIEWER_REVIEW_SESSION_STARTED_AT);
  return {
    enabled: assetIds.length > 0 && Boolean(visibleMessagesAfter),
    assetId: assetIds[0] || "",
    assetIds,
    allowedSenderIds,
    allowedSenderHmacs,
    phoneRestricted: allowedSenderIds.length > 0 || allowedSenderHmacs.length > 0,
    visibleMessagesAfter,
  };
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
  const whatsapp = whatsappChannelScope(env);
  if (!baseEnabled) {
    messenger.enabled = false;
    instagram.enabled = false;
    whatsapp.enabled = false;
  }
  return {
    enabled: baseEnabled && (messenger.enabled || instagram.enabled || whatsapp.enabled),
    tenantId: baseEnabled ? tenantId : null,
    referenceSecret: baseEnabled ? referenceSecret : "",
    channels: { messenger, instagram, whatsapp },
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

export const metaReviewerWhatsappPhoneNumberAllowed = (phoneNumberId = "", scope = loadMetaReviewerScope()) => {
  const config = getMetaReviewerChannelScope(scope, "whatsapp");
  const id = text(phoneNumberId);
  return Boolean(scope?.enabled && config?.enabled && id && Array.isArray(config.assetIds) && config.assetIds.includes(id));
};

// "cloud:<phone_number_id>" of an allow-listed test number. An Evolution instance name, an empty
// instance or another Cloud number is never visible to the reviewer.
export const metaReviewerWhatsappInstanceAllowed = (instance = "", scope = loadMetaReviewerScope()) => {
  const value = text(instance);
  if (!value.toLowerCase().startsWith(META_REVIEWER_CLOUD_INSTANCE_PREFIX)) return false;
  return metaReviewerWhatsappPhoneNumberAllowed(value.slice(META_REVIEWER_CLOUD_INSTANCE_PREFIX.length), scope);
};

export const metaReviewerWhatsappInstances = (scope = loadMetaReviewerScope()) => {
  const config = getMetaReviewerChannelScope(scope, "whatsapp");
  return scope?.enabled && config?.enabled ? config.assetIds.map((id) => `${META_REVIEWER_CLOUD_INSTANCE_PREFIX}${id}`) : [];
};

/*
 * Is this customer phone one of the allow-listed test phones? `requireList` (sending outside a
 * test thread: campaigns, flow tests) fails closed when no phone allowlist is configured at all.
 */
export const metaReviewerWhatsappPhoneAllowed = (phone = "", scope = loadMetaReviewerScope(), { requireList = false } = {}) => {
  const config = getMetaReviewerChannelScope(scope, "whatsapp");
  if (!scope?.enabled || !config?.enabled) return false;
  const key = canonicalPhoneKey(phone);
  if (!key) return false;
  if (!config.phoneRestricted) return !requireList;
  if (config.allowedSenderIds.includes(key)) return true;
  return config.assetIds.some((assetId) => safeDigestIncluded(
    metaReviewerSenderScopeHmac({ tenantId: scope.tenantId, channel: "whatsapp", assetId, senderScopedId: key }, scope.referenceSecret),
    config.allowedSenderHmacs,
  ));
};

export const metaReviewerConversationAllowed = ({ tenantId, channel, assetId, senderScopedId, pageId, psid } = {}, scope = loadMetaReviewerScope()) => {
  const normalized = normalizeMetaReviewerChannel(channel);
  const channelConfig = getMetaReviewerChannelScope(scope, normalized);
  if (normalized === "whatsapp") {
    return Boolean(scope?.enabled && channelConfig?.enabled)
      && Number(tenantId) === Number(scope.tenantId)
      && metaReviewerWhatsappPhoneNumberAllowed(assetId || pageId, scope)
      && metaReviewerWhatsappPhoneAllowed(senderScopedId || psid, scope);
  }
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

const sanitizeMetaReviewerProductCard = (card = {}) => {
  const productName = text(card.product_name || card.name || card.title || card.display_name);
  const imageUrl = text(card.image_url || card.product_image_url || card.variant_image_url || card.image || card.thumbnail_url || card.media_url);
  const productUrl = text(card.storefront_url || card.product_url || card.url || card.share_url);
  return {
    id: card.product_id ?? card.id ?? null,
    product_id: card.product_id ?? card.id ?? null,
    variant_id: card.variant_id ?? card.selected_variant_id ?? null,
    product_name: productName,
    name: productName,
    title: productName,
    image_url: imageUrl,
    image: imageUrl,
    thumbnail_url: imageUrl,
    price: Number(card.price ?? card.final_price ?? card.sale_price ?? 0) || 0,
    color: text(card.color || card.variant_color),
    size: text(card.size || card.variant_size),
    storefront_url: productUrl,
    product_url: productUrl,
    url: productUrl,
  };
};

export const sanitizeMetaReviewerProductCards = (cards = []) =>
  (Array.isArray(cards) ? cards : [])
    .slice(0, 5)
    .map(sanitizeMetaReviewerProductCard)
    .filter((card) => card.product_id || card.product_name || card.storefront_url);

// Who wrote an outbound row (AI / chatbot flow / campaign / staff) is part of what the reviewer is
// shown, so the author markers pass through — but only the writer's marker, never internal ids.
// staff_user_name is kept for automated rows only (a flow or campaign name), not a person's name.
const REVIEWER_SENDER_TYPES = new Set(["customer", "ai", "system", "staff"]);
const reviewerActions = (value) => (Array.isArray(value) ? value : [])
  .filter((action) => typeof action === "string" || (action && typeof action === "object" && /^whatsapp_/.test(text(action.type))))
  .slice(0, 12);

export const sanitizeMetaReviewerMessage = (message = {}) => {
  const senderType = REVIEWER_SENDER_TYPES.has(text(message.sender_type)) ? text(message.sender_type) : "staff";
  return {
    id: message.id ?? null,
    text: text(message.staff_message || message.customer_message || message.message_text || message.ai_answer || message.last_message),
    direction: text(message.direction || (senderType === "customer" ? "inbound" : "outbound")),
    sender_type: senderType,
    message_type: text(message.message_type || "text"),
    source_path: text(message.source_path),
    insert_source: text(message.insert_source),
    detected_intent: text(message.detected_intent),
    staff_user_name: senderType === "system" ? text(message.staff_user_name) : "",
    whatsapp_instance: text(message.whatsapp_instance),
    suggested_actions: reviewerActions(message.suggested_actions),
    attachments: Array.isArray(message.visual_attachments) ? message.visual_attachments : [],
    product_cards: sanitizeMetaReviewerProductCards(message.product_cards),
    delivery_status: text(message.delivery_status),
    created_at: message.created_at || null,
  };
};

export const metaReviewerMessageVisible = (message = {}, scope = loadMetaReviewerScope(), channel = "messenger") => {
  const channelConfig = getMetaReviewerChannelScope(scope, channel);
  if (!channelConfig?.enabled || !message?.created_at) return false;
  // A WhatsApp row is visible only when it went through an allow-listed test number. The same
  // thread can hold Evolution messages (the customer also wrote to the store's line): never those.
  if (normalizeMetaReviewerChannel(channel) === "whatsapp" && !metaReviewerWhatsappInstanceAllowed(message.whatsapp_instance, scope)) return false;
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
