// TikTok organic comments — Social Comments Center provider (TikTok API for Business).
//
// STATUS: IMPLEMENTED. Runtime availability is computed per tenant by
// tiktokBusinessCapabilityService.js — never assumed from the portal approval.
//
// RELATIONSHIP TO tiktokCommentsProvider.js
// -----------------------------------------
// That file is the *TikTok for Developers* app's statement: the Login Kit /
// Content Posting app exposes no comment API at any scope. That remains true
// and that file remains untouched. This file is the real integration, against
// the Accounts API on business-api.tiktok.com, authorized via the approved
// "M1 Store ERP" Business app (TikTok Accounts > Account Comment: Get + Manage).
//
// CONTRACT PROVENANCE (2026-08-28)
// --------------------------------
// Every endpoint, parameter, and field below was read from TikTok's official
// documentation (Accounts > Comments, v1.3) and the paths were confirmed routed
// against the live gateway. The earlier `verified: false` quarantine is gone
// because the uncertainty it quarantined is gone. Two corrections against the
// old guesses, preserved here so they are not re-guessed:
//   * comment/list is GET with URL params (v1.2 was POST) and paginates via
//     data.cursor + data.has_more — NOT a page_info object.
//   * `parent_comment_id` is present ONLY on replies; `unique_identifier` is
//     the stable cross-API user id (`user_id` is deprecated).
//
// /open_api/v1.3/comment/* (no `business/` prefix) is still the ADS comment API
// keyed by advertiser_id. It is still not organic comments. Do not substitute.

import {
  TIKTOK_BUSINESS_REPLY_MAX_CHARS,
  createTikTokBusinessCommentReply,
  fetchTikTokBusinessCommentReplies,
  fetchTikTokBusinessComments,
  fetchTikTokBusinessVideos,
} from "./tiktokBusinessApiClient.js";
import {
  TIKTOK_BUSINESS_CAPABILITY,
  detectTikTokBusinessCommentsCapability,
} from "./tiktokBusinessCapabilityService.js";
import { getValidTikTokBusinessAccessToken } from "./tiktokBusinessOAuthService.js";

const text = (value = "") => String(value ?? "").trim();

export class TikTokBusinessCommentsUnavailableError extends Error {
  constructor(operation = "", capability = {}) {
    super(
      `TikTok Business comment operation "${operation}" is unavailable: ${text(capability?.reason) || "capability check failed"}`
    );
    this.name = "TikTokBusinessCommentsUnavailableError";
    this.code = text(capability?.status) || "TIKTOK_BUSINESS_COMMENTS_UNAVAILABLE";
    // 501 for structurally-off states, 409 for fix-by-reconnecting states.
    this.status = capability?.status === TIKTOK_BUSINESS_CAPABILITY.TOKEN_EXPIRED ? 409 : 501;
    this.operation = text(operation);
    this.capability = capability;
    this.retryable = false;
  }
}

// Every provider method passes through here first. Returning [] on a closed
// gate is forbidden — it would render as "this video has no comments", which is
// a false claim. Callers get a typed error carrying the precise state instead.
const requireCapability = async ({ tenantId, operation, needReply = false }) => {
  const capability = await detectTikTokBusinessCommentsCapability({ tenantId, probe: false });
  if (!capability.available) throw new TikTokBusinessCommentsUnavailableError(operation, capability);
  if (needReply && !capability.can_reply) {
    throw new TikTokBusinessCommentsUnavailableError(operation, {
      ...capability,
      status: TIKTOK_BUSINESS_CAPABILITY.MISSING_PERMISSION,
      reason: "The authorized TikTok account did not grant the comment manage permission (comment.list.manage), so replying is unavailable.",
    });
  }
  return capability;
};

// ---------------------------------------------------------------------------
// Pure helpers — mapping the documented wire shape onto canonical rows.
// ---------------------------------------------------------------------------

const epochToIso = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const countOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
};

const boolOrNull = (value) => (typeof value === "boolean" ? value : null);

// Maps one raw TikTok comment onto the canonical Social Comments Center row.
// Field names follow the documented v1.3 response. Returns null for an id-less
// payload rather than inventing an identity — an id-less comment would collide
// with every other id-less row on dedupe.
export const normalizeComment = (raw = {}, { videoId = "" } = {}) => {
  const commentId = text(raw.comment_id);
  if (!commentId) return null;
  const parentId = text(raw.parent_comment_id);
  const status = text(raw.status).toUpperCase();
  return {
    platform: "tiktok",
    channel: "tiktok_comment",
    external_conversation_id: text(raw.video_id) || text(videoId),
    external_message_id: commentId,
    parent_external_message_id: parentId || null,
    // A comment carrying parent_comment_id is a reply — documented: the field
    // is returned only for replies. Derived rather than trusting a separate
    // boolean, so the two can never disagree.
    is_reply: Boolean(parentId),
    // unique_identifier is the stable cross-API id; user_id is deprecated and
    // kept only as a fallback for transitional payloads.
    external_customer_id: text(raw.unique_identifier) || text(raw.user_id),
    customer_name: text(raw.display_name) || text(raw.username),
    customer_username: text(raw.username),
    // Documented as temporary (x-expires) — resolve at render time, never treat
    // as durable.
    customer_avatar_url: text(raw.profile_image),
    body: text(raw.text),
    image_url: text(raw.image_url),
    created_at: epochToIso(raw.create_time),
    like_count: countOrZero(raw.likes),
    reply_count: countOrZero(raw.replies),
    // HIDDEN/PUBLIC is documented and definitive; anything else stays unknown.
    is_hidden: status === "HIDDEN" ? true : status === "PUBLIC" ? false : null,
    is_pinned: boolOrNull(raw.pinned),
    is_liked_by_owner: boolOrNull(raw.liked),
    is_owner: boolOrNull(raw.owner),
    metadata: { provider: "tiktok_business" },
  };
};

// Pagination for the documented envelope: { comments, cursor, has_more }.
// has_more is authoritative — a cursor without has_more must not be followed
// (following it is how polling loops become infinite).
export const parseCommentPage = (data = {}) => {
  const hasMore = data?.has_more === true;
  const cursorValue = data?.cursor;
  return {
    cursor: hasMore && cursorValue !== undefined && cursorValue !== null ? String(cursorValue) : "",
    has_more: hasMore,
  };
};

export const commentIdempotencyKey = (raw = {}, { videoId = "" } = {}) => {
  const commentId = text(raw.comment_id);
  if (!commentId) return "";
  return `tiktok_business_comment:${text(raw.video_id) || text(videoId) || "unknown"}:${commentId}`;
};

// ---------------------------------------------------------------------------
// Provider object
// ---------------------------------------------------------------------------

const withConnection = async ({ tenantId, operation, needReply = false }) => {
  await requireCapability({ tenantId, operation, needReply });
  return getValidTikTokBusinessAccessToken({ tenantId });
};

export const tiktokBusinessCommentsProvider = Object.freeze({
  provider: "tiktok_business",
  platform: "tiktok",
  channel: "tiktok_comment",

  // Static shape of what the integration implements. Per-tenant, per-token
  // availability comes from getCapabilities()/the capability service — a UI must
  // not render enabled controls off this object alone.
  capabilities: Object.freeze({
    list_videos: true,
    list_comments: true,
    list_replies: true,
    create_reply: true,
    // Not implemented — the endpoints exist (like/unlike, hide/unhide, delete,
    // pin) but are out of this phase's scope. false = "the ERP does not do
    // this", which is the honest value.
    delete_own_reply: false,
    hide: false,
    unhide: false,
    like: false,
    unlike: false,
    pin: false,
    unpin: false,
    ai_suggested_replies: false,
    // comment.update webhook exists (confirmed in the docs) AND polling is
    // implemented; the webhook is an accelerator, polling is the guarantee.
    webhook: true,
    ingestion_mode: "poll_with_webhook_acceleration",
  }),

  getCapabilities: async ({ tenantId, probe = true } = {}) => {
    const state = await detectTikTokBusinessCommentsCapability({ tenantId, probe });
    return { ...tiktokBusinessCommentsProvider.capabilities, state };
  },

  listVideos: async ({ tenantId, cursor, maxCount } = {}) => {
    const { accessToken, businessId } = await withConnection({ tenantId, operation: "listVideos" });
    const data = await fetchTikTokBusinessVideos({ accessToken, businessId, cursor, maxCount });
    return {
      videos: Array.isArray(data?.videos) ? data.videos : [],
      ...parseCommentPage(data),
    };
  },

  listComments: async ({ tenantId, videoId, cursor, maxCount, commentIds } = {}) => {
    const { accessToken, businessId } = await withConnection({ tenantId, operation: "listComments" });
    const data = await fetchTikTokBusinessComments({ accessToken, businessId, videoId, cursor, maxCount, commentIds });
    const rawComments = Array.isArray(data?.comments) ? data.comments : [];
    return {
      comments: rawComments.map((raw) => normalizeComment(raw, { videoId })).filter(Boolean),
      raw_comments: rawComments,
      ...parseCommentPage(data),
    };
  },

  listReplies: async ({ tenantId, videoId, commentId, cursor, maxCount } = {}) => {
    const { accessToken, businessId } = await withConnection({ tenantId, operation: "listReplies" });
    const data = await fetchTikTokBusinessCommentReplies({ accessToken, businessId, videoId, commentId, cursor, maxCount });
    const rawComments = Array.isArray(data?.comments) ? data.comments : [];
    return {
      comments: rawComments.map((raw) => normalizeComment(raw, { videoId })).filter(Boolean),
      raw_comments: rawComments,
      ...parseCommentPage(data),
    };
  },

  // The only write. Idempotency/duplicate protection is owned by the sync
  // service's reply log (tiktok_business_reply_log) — this method is the raw
  // provider call beneath it.
  createReply: async ({ tenantId, videoId, commentId, text: replyText } = {}) => {
    const { accessToken, businessId } = await withConnection({ tenantId, operation: "createReply", needReply: true });
    const data = await createTikTokBusinessCommentReply({ accessToken, businessId, videoId, commentId, text: replyText });
    return {
      reply_comment_id: text(data?.comment_id),
      video_id: text(data?.video_id) || text(videoId),
      replied_to_comment_id: text(commentId),
      raw: data,
    };
  },

  normalizeComment,
  parseCommentPage,
  commentIdempotencyKey,
});

export { TIKTOK_BUSINESS_REPLY_MAX_CHARS };

// Surfaced by GET /api/tiktok-business/status. Async because the honest answer
// depends on the tenant's live connection, not on a constant.
export const describeTikTokBusinessCommentsCapability = async ({ tenantId, probe = false } = {}) => {
  const state = await detectTikTokBusinessCommentsCapability({ tenantId, probe });
  return { ...state, capabilities: tiktokBusinessCommentsProvider.capabilities };
};
