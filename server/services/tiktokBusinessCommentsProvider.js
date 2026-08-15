// TikTok organic comments — Social Comments Center provider (TikTok API for Business).
//
// STATUS: WAITING_FOR_TIKTOK_BUSINESS_APP_APPROVAL
//
// RELATIONSHIP TO tiktokCommentsProvider.js
// -----------------------------------------
// That file is the *TikTok for Developers* app's statement: "the Login Kit /
// Content Posting app exposes no comment API at any scope." It stays true and
// stays untouched.
//
// This file is the *TikTok API for Business* app's statement. It is where the
// real comment integration will land, because the organic comment endpoints
// exist only on business-api.tiktok.com. Keeping the two separate is the whole
// point of the Phase 2 split: two apps, two credentials, two providers.
//
// WHAT RESEARCH ACTUALLY CONFIRMED (Aug 2026)
// -------------------------------------------
// CONFIRMED — there are two distinct comment API families, and conflating them
// would be a serious bug:
//
//   * /open_api/v1.3/comment/*  keyed by `advertiser_id`. These are ADS
//     comments (Spark Ads). Verified against TikTok's own published SDK
//     (tiktok/tiktok-business-api-sdk, python_sdk/docs/CommentsApi.md), which
//     documents comment/list, comment/post, comment/delete, comment/reference,
//     comment/status/update and the blockedword/* family — all advertiser_id.
//     This is NOT what Social Comments Center needs.
//
//   * business/comment/*  keyed by `business_id`. These are ORGANIC comments on
//     an owned TikTok video. TikTok's official Postman collection for Business
//     API v1.3 contains requests named "Business comment list", "Business
//     comment reply", and "Business comment reply create", which confirms the
//     family EXISTS and roughly what it covers.
//
// NOT CONFIRMED — and deliberately not guessed:
//   * exact paths, path segments, and version prefix
//   * request/response parameter names
//   * the literal permission name that grants organic comment access. The
//     pending app requests Ad Account Management, Measurement, CTX Events
//     Management, and TikTok Accounts. "TikTok Accounts" is the plausible home
//     for organic reads but this is UNVERIFIED.
//   * whether hide/unhide, like/unlike, and pin/unpin exist at all for organic
//     comments. They are exposed here as `null` (unknown), never `true`.
//
// Both business-api.tiktok.com/portal/docs and the Postman web viewer render
// client-side, so neither could be read programmatically. They must be confirmed
// against the portal once the app is approved.
//
// Everything unverified is quarantined in TIKTOK_BUSINESS_COMMENTS_WIRE with
// `verified: false`, and the live gate refuses to build a request while that
// flag is false. No path in this file is presented as fact.

import {
  tiktokBusinessCommentsEnabled,
  TIKTOK_BUSINESS_API_BASE,
  TIKTOK_BUSINESS_API_VERSION,
} from "./tiktokBusinessConfigService.js";

const text = (value = "") => String(value ?? "").trim();

export const TIKTOK_BUSINESS_COMMENTS_STATUS = "WAITING_FOR_TIKTOK_BUSINESS_APP_APPROVAL";

export const TIKTOK_BUSINESS_COMMENTS_STATE = Object.freeze({
  status: TIKTOK_BUSINESS_COMMENTS_STATUS,
  available: false,
  polling_enabled: false,
  reason:
    "Organic TikTok comment management requires an approved TikTok API for Business app and a Business Account authorization. The M1 Store ERP developer app is PENDING, so no Business App ID or business_id exists yet.",
  blocked_by: "tiktok_business_app_approval",
  // Recorded so nobody later reaches for the ads endpoints because they are the
  // ones that happen to be documented.
  wrong_api_warning:
    "/open_api/v1.3/comment/* is the ADS comment API keyed by advertiser_id (Spark Ads). It is not organic video comments and must not be substituted.",
});

// The single quarantine for every unconfirmed wire detail.
export const TIKTOK_BUSINESS_COMMENTS_WIRE = Object.freeze({
  verified: false,
  base: `${TIKTOK_BUSINESS_API_BASE}/open_api/${TIKTOK_BUSINESS_API_VERSION}`,
  key_field: "business_id",
  candidate_paths: Object.freeze({
    listVideos: "/business/video/list/",
    listComments: "/business/comment/list/",
    listReplies: "/business/comment/reply/list/",
    createReply: "/business/comment/reply/create/",
    deleteComment: "/business/comment/delete/",
    hideComment: "/business/comment/hide/",
    likeComment: "/business/comment/like/",
    pinComment: "/business/comment/pin/",
  }),
  comment_field_map: Object.freeze({
    comment_id: "external_message_id",
    parent_comment_id: "parent_external_message_id",
    video_id: "external_conversation_id",
    user_id: "external_customer_id",
    nickname: "customer_name",
    avatar_url: "customer_avatar_url",
    text: "body",
    create_time: "created_at",
    like_count: "like_count",
    reply_count: "reply_count",
  }),
});

export class TikTokBusinessCommentsUnavailableError extends Error {
  constructor(operation = "") {
    super(
      `TikTok Business comment operation "${operation}" is unavailable: ${TIKTOK_BUSINESS_COMMENTS_STATE.reason}`
    );
    this.name = "TikTokBusinessCommentsUnavailableError";
    this.code = TIKTOK_BUSINESS_COMMENTS_STATE.status;
    this.status = 501;
    this.operation = text(operation);
    this.blocked_by = TIKTOK_BUSINESS_COMMENTS_STATE.blocked_by;
    this.retryable = false;
  }
}

// Two independent gates, both closed today. Returning [] here instead of
// throwing would render as "this video has no comments" — a false claim.
const assertLiveCommentsAllowed = (operation) => {
  if (!tiktokBusinessCommentsEnabled() || !TIKTOK_BUSINESS_COMMENTS_WIRE.verified) {
    throw new TikTokBusinessCommentsUnavailableError(operation);
  }
  throw new TikTokBusinessCommentsUnavailableError(operation);
};

const unavailable = (operation) => async () => assertLiveCommentsAllowed(operation);

// ---------------------------------------------------------------------------
// Pure helpers — real, credential-free, unit-tested now so that post-approval
// work is "correct the field map", not "write a mapper from scratch".
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

// Maps one raw comment onto the canonical Social Comments Center row. Returns
// null for an id-less payload rather than inventing an identity — an id-less
// comment would collide with every other id-less row on dedupe.
export const normalizeComment = (raw = {}) => {
  const commentId = text(raw.comment_id);
  if (!commentId) return null;
  const parentId = text(raw.parent_comment_id);
  return {
    platform: "tiktok",
    channel: "tiktok_comment",
    external_conversation_id: text(raw.video_id || raw.item_id),
    external_message_id: commentId,
    parent_external_message_id: parentId || null,
    // A comment carrying a parent id is a reply. Derived rather than trusting a
    // separate boolean, so the two can never disagree.
    is_reply: Boolean(parentId),
    external_customer_id: text(raw.user_id || raw.unique_id),
    customer_name: text(raw.nickname || raw.display_name),
    customer_avatar_url: text(raw.avatar_url),
    body: text(raw.text ?? raw.content),
    created_at: epochToIso(raw.create_time),
    like_count: countOrZero(raw.like_count),
    reply_count: countOrZero(raw.reply_count),
    // Tri-state on purpose. `false` would assert "this comment is not hidden",
    // which we cannot know until the field is confirmed; null means unknown and
    // a capability-driven UI renders the control as disabled rather than off.
    is_hidden: typeof raw.is_hidden === "boolean" ? raw.is_hidden : null,
    is_pinned: typeof raw.is_pinned === "boolean" ? raw.is_pinned : null,
    is_liked_by_owner: typeof raw.is_liked === "boolean" ? raw.is_liked : null,
    metadata: { provider: "tiktok_business" },
  };
};

// Cursor/page-token parser. TikTok Business paginates with a `page_info` object;
// `has_more` is authoritative and a cursor without has_more must not be followed
// (following it is how polling loops become infinite).
export const parsePageInfo = (payload = {}) => {
  const info = payload?.page_info || payload?.data?.page_info || {};
  const cursor = text(info.cursor ?? info.next_cursor ?? "");
  const hasMore = info.has_more === true;
  return {
    cursor: hasMore ? cursor : "",
    has_more: hasMore,
    total: countOrZero(info.total_number ?? info.total),
    page_size: countOrZero(info.page_size),
  };
};

export const commentIdempotencyKey = (raw = {}) => {
  const commentId = text(raw.comment_id);
  if (!commentId) return "";
  return `tiktok_business_comment:${text(raw.video_id || raw.item_id) || "unknown"}:${commentId}`;
};

// ---------------------------------------------------------------------------
// Provider object.
// ---------------------------------------------------------------------------

export const tiktokBusinessCommentsProvider = Object.freeze({
  provider: "tiktok_business",
  platform: "tiktok",
  channel: "tiktok_comment",
  state: TIKTOK_BUSINESS_COMMENTS_STATE,

  // false = confirmed unavailable now. null = existence not confirmed at all.
  // Neither renders an enabled control; the distinction tells the next engineer
  // which ones still need a docs check versus which just need the grant.
  capabilities: Object.freeze({
    list_videos: false,
    list_comments: false,
    list_replies: false,
    create_reply: false,
    delete_own_reply: false,
    hide: null,
    unhide: null,
    like: null,
    unlike: null,
    pin: null,
    unpin: null,
    ai_suggested_replies: false,
    webhook: false,
    // No comment webhook exists on either TikTok surface, so ingestion will
    // have to be polled. Recorded now so it is not rediscovered later.
    ingestion_mode: "poll_only",
  }),

  getCapabilities: () => ({
    ...tiktokBusinessCommentsProvider.capabilities,
    state: TIKTOK_BUSINESS_COMMENTS_STATE,
  }),

  listVideos: unavailable("listVideos"),
  listComments: unavailable("listComments"),
  listReplies: unavailable("listReplies"),
  createReply: unavailable("createReply"),
  deleteComment: unavailable("deleteComment"),
  hideComment: unavailable("hideComment"),
  unhideComment: unavailable("unhideComment"),
  likeComment: unavailable("likeComment"),
  unlikeComment: unavailable("unlikeComment"),
  pinComment: unavailable("pinComment"),
  unpinComment: unavailable("unpinComment"),

  normalizeComment,
  parsePageInfo,
  commentIdempotencyKey,
});

export const describeTikTokBusinessCommentsCapability = () => ({
  ...TIKTOK_BUSINESS_COMMENTS_STATE,
  capabilities: tiktokBusinessCommentsProvider.capabilities,
  wire_verified: TIKTOK_BUSINESS_COMMENTS_WIRE.verified,
});
