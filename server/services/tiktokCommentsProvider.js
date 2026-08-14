// TikTok comments — provider boundary ONLY. No implementation, no fake data.
//
// WHY THIS FILE HAS NO API CALLS
// ------------------------------
// Comment management is not reachable from the app we own. There are two
// separate TikTok developer surfaces:
//
//   1. TikTok for Developers (our "M1 Store" app: client_key/client_secret,
//      Login Kit + Content Posting + Webhooks). It exposes NO comment API of
//      any kind, at any scope. There is also no comment webhook event — the
//      complete event list is authorization.removed, video.upload.failed,
//      video.publish.completed, portability.download.ready.
//
//   2. TikTok API for Business (business-api.tiktok.com: a different app, a
//      different authorization, keyed by business_id). Comment list/reply/
//      like/hide/delete on an owned video live only here, and access is granted
//      by application/allowlist — App Review of the Login Kit app does not
//      unlock it.
//
// Therefore the honest state is WAITING_FOR_TIKTOK_BUSINESS_PERMISSION.
// Nothing here polls, and nothing here fabricates a comment. `listComments` and
// friends throw a typed, catchable error rather than returning [] — an empty
// array would render as "this video has no comments", which is a false claim.
//
// WHAT TO DO WHEN ACCESS IS GRANTED
// ---------------------------------
// Implement the five methods below against the Business Account API and flip
// TIKTOK_COMMENTS_STATE to AVAILABLE. Social Comments Center consumes this
// object through the shape declared here, so no consumer needs restructuring.
//
// Two things must be confirmed against the portal FIRST — they are deliberately
// not hardcoded here, because guessing them would produce code that looks
// verified and is not:
//   * the exact business/comment/* endpoint paths and their version prefix
//   * the literal scope/permission names for the organic Business Account API
//
// NOTE ON SCOPE OF THE CURRENT CHANGE
// -----------------------------------
// socialCommentsCenterService.js models platform as a Facebook/Instagram binary
// across ~30 raw-SQL sites. Converting those to a provider registry is a real
// refactor with real regression risk, and it buys nothing until TikTok comments
// actually work. It is deliberately NOT done here. This file is the seam that
// makes that refactor additive when the time comes.

const text = (value = "") => String(value ?? "").trim();

export const TIKTOK_COMMENTS_STATE = Object.freeze({
  status: "WAITING_FOR_TIKTOK_BUSINESS_PERMISSION",
  reason: "TikTok comment management requires TikTok API for Business (Business Account) access, which is a separate application from the Login Kit app.",
  blocked_by: "tiktok_business_account_api_access",
  // Set to true only once the Business Account API is granted AND the endpoint
  // paths/scopes have been confirmed against the portal.
  available: false,
  polling_enabled: false,
});

// The canonical comment shape the Social Comments Center already consumes for
// Facebook/Instagram, restated here as the contract a future TikTok adapter
// must satisfy. Kept as a documented mapping rather than a runtime transform,
// since there is nothing to transform yet.
export const TIKTOK_CANONICAL_COMMENT_MAPPING = Object.freeze({
  platform: "tiktok",
  channel: "tiktok_comment",
  external_conversation_id: "TikTok video_id",
  external_customer_id: "TikTok commenter unique_id / open_id",
  customer_name: "TikTok commenter display name",
  customer_avatar_url: "TikTok commenter avatar (may be absent)",
  external_message_id: "TikTok comment_id",
  parent_external_message_id: "TikTok parent comment_id for replies",
  created_at: "TikTok comment create_time",
});

export class TikTokCommentsUnavailableError extends Error {
  constructor(operation = "") {
    super(
      `TikTok comment operation "${operation}" is unavailable: ${TIKTOK_COMMENTS_STATE.reason}`
    );
    this.name = "TikTokCommentsUnavailableError";
    this.code = TIKTOK_COMMENTS_STATE.status;
    this.status = 501;
    this.operation = text(operation);
  }
}

const unavailable = (operation) => async () => {
  throw new TikTokCommentsUnavailableError(operation);
};

// The provider object Social Comments Center will register once TikTok is a
// third platform. Every capability is declared false, so a capability-driven UI
// hides the actions instead of rendering buttons that cannot work.
export const tiktokCommentsProvider = Object.freeze({
  platform: "tiktok",
  channel: "tiktok_comment",
  state: TIKTOK_COMMENTS_STATE,
  capabilities: Object.freeze({
    list: false,
    reply: false,
    like: false,
    hide: false,
    unhide: false,
    delete_own_reply: false,
  }),
  listComments: unavailable("listComments"),
  replyToComment: unavailable("replyToComment"),
  likeComment: unavailable("likeComment"),
  hideComment: unavailable("hideComment"),
  unhideComment: unavailable("unhideComment"),
  deleteOwnReply: unavailable("deleteOwnReply"),
});

// Surfaced by GET /api/tiktok/status so the Channels page can state the real
// reason rather than showing a generic "not connected".
export const describeTikTokCommentsCapability = () => ({
  ...TIKTOK_COMMENTS_STATE,
  capabilities: tiktokCommentsProvider.capabilities,
});
