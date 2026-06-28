import { io } from "../utils/socket.js";
import { invalidateSocialCommentCenterFastListCache } from "./socialCommentsCenterService.js";

const text = (value = "") => String(value ?? "").trim();

const asId = (value = "") => {
  const candidate = text(value);
  if (!candidate) return "";
  const numeric = Number(candidate);
  return Number.isFinite(numeric) && String(Math.trunc(numeric)) === candidate ? String(Math.trunc(numeric)) : candidate;
};

const lower = (value = "") => text(value).toLowerCase();

const truncate = (value = "", length = 160) => {
  const candidate = text(value);
  if (!candidate) return "";
  return candidate.length > length ? candidate.slice(0, length) : candidate;
};

const missingSocketLoggedEvents = new Set();
let socialRealtimeEmitCount = 0;

const logSocketMissing = (eventName) => {
  if (missingSocketLoggedEvents.has(eventName)) return;
  missingSocketLoggedEvents.add(eventName);
  console.warn("SOCIAL_REALTIME_SOCKET_MISSING", {
    event: eventName,
    has_io: Boolean(io),
  });
};

const buildSocialRealtimePayload = (payload = {}) => {
  const customerName =
    text(payload.customer_name ||
      payload.commenter_name ||
      payload.author_name ||
      payload.from_name ||
      payload.raw_payload?.from?.name ||
      payload.metadata?.customer_name ||
      "Customer");
  const customerAvatarUrl = text(
    payload.customer_avatar_url ||
      payload.commenter_profile_picture_url ||
      payload.raw_payload?.from?.picture ||
      payload.raw_payload?.customer_avatar_url ||
      payload.metadata?.customer_avatar_url ||
      ""
  );
  const productId = payload.product_id ?? payload.resolved_product_id ?? payload.raw_payload?.product_context?.product_id ?? payload.metadata?.product_id ?? null;
  const productName = text(
    payload.product_name ||
      payload.raw_payload?.product_context?.product_name ||
      payload.metadata?.product_name ||
      ""
  );
  return {
    id: asId(payload.id || payload.comment_id || payload.external_comment_id || payload.provider_comment_id || ""),
    platform: lower(payload.platform || "facebook") === "instagram" ? "instagram" : "facebook",
    post_id: text(payload.post_id || payload.canonical_post_id || payload.raw_payload?.post_id || payload.metadata?.post_id || ""),
    external_comment_id: text(payload.external_comment_id || payload.comment_id || payload.provider_comment_id || payload.id || ""),
    customer_name: customerName,
    customer_avatar_url: customerAvatarUrl,
    message_preview: truncate(
      payload.message_preview ||
        payload.original_comment_text ||
        payload.comment_text ||
        payload.message ||
        payload.customer_message ||
        payload.last_message ||
        payload.raw_payload?.message ||
        "",
      160
    ),
    created_at: text(payload.created_at || payload.processed_at || payload.updated_at || new Date().toISOString()),
    status: text(payload.status || payload.action_taken || payload.reply_status || payload.public_reply_status || payload.dm_status || "pending") || "pending",
    automation_status: text(
      payload.automation_status ||
        payload.reply_status ||
        payload.public_reply_status ||
        payload.dm_status ||
        payload.like_status ||
        payload.status ||
        payload.action_taken ||
        ""
    ),
    product_id: productId === null || typeof productId === "undefined" || productId === "" ? null : productId,
    product_name: productName,
  };
};

const emitSocialRealtimeEvent = (eventName, payload = {}) => {
  socialRealtimeEmitCount += 1;
  if (!io) {
    logSocketMissing(eventName);
    return;
  }
  const nextPayload = buildSocialRealtimePayload(payload);
  console.log(
    eventName === "social_comment:new"
      ? "SOCIAL_REALTIME_EMIT_NEW"
      : eventName === "social_comment:updated"
        ? "SOCIAL_REALTIME_EMIT_UPDATE"
        : "SOCIAL_REALTIME_EMIT_REPLY_STATUS",
    nextPayload
  );
  io.emit(eventName, nextPayload);
  try {
    invalidateSocialCommentCenterFastListCache({
      tenantId: payload?.tenant_id || payload?.tenantId || payload?.raw_payload?.tenant_id || payload?.metadata?.tenant_id || null,
    });
  } catch (error) {
    console.warn("SOCIAL_FAST_LIST_CACHE_INVALIDATE_FAILED", {
      event: eventName,
      message: error?.message || String(error || ""),
    });
  }
};

export const emitSocialCommentNew = (payload = {}) => emitSocialRealtimeEvent("social_comment:new", payload);
export const emitSocialCommentUpdated = (payload = {}) => emitSocialRealtimeEvent("social_comment:updated", payload);
export const emitSocialReplyStatus = (payload = {}) => emitSocialRealtimeEvent("social_comment:reply_status", payload);
export const getSocialRealtimeMetrics = () => ({
  socket_emit_count: socialRealtimeEmitCount,
});
