import crypto from "node:crypto";
import { emitToRooms } from "../utils/socket.js";

const text = (value = "") => String(value ?? "").trim();

export const META_REVIEWER_ROLE = "meta_reviewer";
export const META_REVIEWER_CHANNELS = new Set(["facebook", "facebook_messenger", "messenger"]);

export const normalizeMetaReviewerRole = (value = "") =>
  text(value).toLowerCase().replace(/[\s-]+/g, "_");

export const isMetaReviewerRole = (value = "") =>
  normalizeMetaReviewerRole(value) === META_REVIEWER_ROLE;

export const normalizeMetaReviewerChannel = (value = "") => {
  const channel = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  return META_REVIEWER_CHANNELS.has(channel) ? "facebook_messenger" : channel;
};

export const parseAllowedPsids = (value = "") =>
  [...new Set(text(value).split(",").map(text).filter(Boolean))];

export const loadMetaReviewerScope = (env = process.env) => {
  const tenantId = Number.parseInt(text(env.META_REVIEWER_TENANT_ID), 10);
  const pageId = text(env.META_REVIEWER_FACEBOOK_PAGE_ID);
  const allowedPsids = parseAllowedPsids(env.META_REVIEWER_ALLOWED_PSIDS);
  const referenceSecret = text(env.META_REVIEWER_SCOPE_HMAC_KEY);
  const enabled = Number.isFinite(tenantId) && tenantId > 0 && Boolean(pageId) && allowedPsids.length > 0 && Boolean(referenceSecret);
  return {
    enabled,
    tenantId: enabled ? tenantId : null,
    pageId: enabled ? pageId : "",
    allowedPsids: enabled ? allowedPsids : [],
    referenceSecret: enabled ? referenceSecret : "",
  };
};

export const metaReviewerScopeIsClosed = (scope = loadMetaReviewerScope()) => !scope?.enabled;

export const metaReviewerConversationAllowed = ({ tenantId, channel, pageId, psid } = {}, scope = loadMetaReviewerScope()) => {
  if (!scope?.enabled) return false;
  return Number(tenantId) === Number(scope.tenantId)
    && normalizeMetaReviewerChannel(channel) === "facebook_messenger"
    && text(pageId) === text(scope.pageId)
    && scope.allowedPsids.includes(text(psid));
};

export const metaReviewerConversationRef = (sessionId = "", scope = loadMetaReviewerScope()) => {
  if (!scope?.enabled || !text(sessionId)) return "";
  return crypto
    .createHmac("sha256", scope.referenceSecret)
    .update(`meta-reviewer-conversation:v1:${scope.tenantId}:${text(sessionId)}`)
    .digest("base64url")
    .slice(0, 32);
};

export const metaReviewerConversationRefMatches = (candidateRef = "", sessionId = "", scope = loadMetaReviewerScope()) => {
  const expected = metaReviewerConversationRef(sessionId, scope);
  const actual = text(candidateRef);
  if (!expected || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
};

export const metaReviewerRealtimeRoom = (scope = loadMetaReviewerScope()) =>
  scope?.enabled ? `meta-reviewer:tenant:${scope.tenantId}:messenger-test` : "";

export const extractMetaReviewerIdentity = (record = {}) => {
  const metadata = record.channel_metadata || record.metadata || record.raw || {};
  const pageId = text(
    record.page_id ||
    record.facebook_page_id ||
    metadata.page_id ||
    metadata.facebook_page_id ||
    metadata.resolved_page_id ||
    metadata.recipient_page_id ||
    metadata.raw_payload?.page_id ||
    metadata.raw_payload?.value?.page_id ||
    record.raw?.page_id ||
    record.raw?.recipient_page_id
  );
  const psid = text(
    record.psid ||
    record.external_customer_id ||
    metadata.customer_psid ||
    metadata.sender_psid ||
    metadata.resolved_customer_id ||
    record.raw?.sender_psid ||
    record.raw?.sender_id
  );
  return { pageId, psid };
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

export const metaReviewerAccountExpired = (value, now = new Date()) => {
  if (!value) return false;
  const expiresAt = new Date(value);
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime();
};

export const emitMetaReviewerInboundEvent = ({ tenantId, channel, pageId, psid, sessionId, message } = {}, scope = loadMetaReviewerScope()) => {
  if (!metaReviewerConversationAllowed({ tenantId, channel, pageId, psid }, scope)) return false;
  const room = metaReviewerRealtimeRoom(scope);
  if (!room) return false;
  emitToRooms([room], "meta_reviewer:message", {
    conversation_id: metaReviewerConversationRef(sessionId, scope),
    message: sanitizeMetaReviewerMessage(message),
    at: new Date().toISOString(),
  });
  emitToRooms([room], "meta_reviewer:refresh", { at: new Date().toISOString() });
  return true;
};
