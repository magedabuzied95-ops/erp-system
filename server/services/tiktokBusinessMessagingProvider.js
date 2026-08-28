// TikTok Business Messaging — AI Inbox channel provider.
//
// STATUS: WAITING_FOR_TIKTOK_BUSINESS_MESSAGING_PERMISSION
//
// WHY NOTHING HERE TALKS TO TIKTOK
// --------------------------------
// Business Messaging is gated behind a chain we have not completed:
//   1. an approved TikTok API for Business developer app  — ours ("M1 Store
//      ERP") is PENDING;
//   2. a valid Business App ID                            — not issued yet;
//   3. a Data Security & Privacy review                   — not started;
//   4. a separate Business Messaging permission grant     — not requested; it
//      is NOT one of the four permissions on the pending application
//      (Ad Account Management, Measurement, CTX Events Management, TikTok
//      Accounts).
//
// So every network-facing method throws a typed, catchable error. In particular
// listConversations() does NOT return [] — an empty array would render in the
// AI Inbox as "this customer has no messages", which is a false statement about
// the real world. Callers must distinguish "no data" from "no access", and the
// only way to force that is to make the unavailable path impossible to ignore.
//
// WHAT IS AND IS NOT VERIFIED
// ---------------------------
// Verified (TikTok's own published surfaces, Aug 2026):
//   * A Business Messaging API exists under the v1.3 Business API.
//   * It is region-restricted — unavailable for accounts registered in the
//     EEA, Switzerland, or the UK. Our account is Egypt-registered, so this
//     restriction does not block us, but it must be re-checked at onboarding.
//   * Access requires an approved app plus a manual review.
//
// NOT verified (business-api.tiktok.com renders client-side and its Postman
// collection is not machine-readable, so neither could be read programmatically):
//   * exact endpoint paths and their parameters
//   * literal permission/scope names
//   * webhook event names and the signature algorithm
//
// Everything unverified lives in ONE place — TIKTOK_BUSINESS_MESSAGING_WIRE below
// — flagged `verified: false`. Guessed paths are never presented as fact, and the
// live gate refuses to run while that flag is false.

import {
  tiktokBusinessMessagingEnabled,
  TIKTOK_BUSINESS_API_BASE,
  TIKTOK_BUSINESS_API_VERSION,
} from "./tiktokBusinessConfigService.js";

const text = (value = "") => String(value ?? "").trim();

export const TIKTOK_BUSINESS_MESSAGING_STATUS = "WAITING_FOR_TIKTOK_BUSINESS_MESSAGING_PERMISSION";

export const TIKTOK_BUSINESS_MESSAGING_STATE = Object.freeze({
  status: TIKTOK_BUSINESS_MESSAGING_STATUS,
  available: false,
  polling_enabled: false,
  webhook_registered: false,
  reason:
    "TikTok Business Messaging requires a Data Security & Privacy review and a separate Business Messaging permission grant. The M1 Store ERP app was approved on 2026-08-28 for Account Comment only — the messaging permission has not been requested, so messaging stays closed regardless of the comments rollout.",
  blocked_by: "tiktok_business_messaging_permission",
  prerequisites: Object.freeze([
    { key: "developer_app_approved", satisfied: true, detail: "M1 Store ERP approved 2026-08-28 (Account Comment scopes only)" },
    { key: "business_app_id_issued", satisfied: true, detail: "issued with the approval" },
    { key: "data_security_privacy_review", satisfied: false, detail: "not started" },
    { key: "business_messaging_permission", satisfied: false, detail: "separate application" },
  ]),
});

// The single quarantine for every unconfirmed wire detail. Nothing outside this
// object encodes a TikTok path or field name, so correcting it after approval is
// a one-file change — and `verified: false` makes the live gate refuse.
export const TIKTOK_BUSINESS_MESSAGING_WIRE = Object.freeze({
  verified: false,
  base: `${TIKTOK_BUSINESS_API_BASE}/open_api/${TIKTOK_BUSINESS_API_VERSION}`,
  // Research note, NOT a contract. Corrected 2026-08-28: an unauthenticated
  // gateway probe proved the real segment is `message/` — the earlier
  // `messaging/` guess answers `40006 no schema found`. Only conversation/list
  // was confirmed routed; the rest are POST-only or unconfirmed, so the whole
  // block stays `verified: false` until the Business Messaging docs are read
  // under an actual messaging grant.
  candidate_paths: Object.freeze({
    listConversations: "/business/message/conversation/list/",
    listMessages: "/business/message/list/",
    sendMessage: "/business/message/send/",
    uploadMedia: "/business/message/media/upload/",
    downloadMedia: "/business/message/media/download/",
  }),
  // How a TikTok payload maps onto the canonical AI Inbox row. The right-hand
  // side is ours and is stable; the left-hand side is the guess.
  inbound_field_map: Object.freeze({
    conversation_id: "external_conversation_id",
    message_id: "external_message_id",
    sender_id: "external_customer_id",
    nickname: "customer_name",
    avatar_url: "customer_avatar_url",
    content: "body",
    create_time: "created_at",
    attachments: "attachments",
  }),
});

export class TikTokBusinessMessagingUnavailableError extends Error {
  constructor(operation = "", state = TIKTOK_BUSINESS_MESSAGING_STATE) {
    super(
      `TikTok Business Messaging operation "${operation}" is unavailable: ${state.reason}`
    );
    this.name = "TikTokBusinessMessagingUnavailableError";
    this.code = state.status;
    // 501 Not Implemented, not 403: we are not forbidden by policy at runtime,
    // the capability simply does not exist for this deployment yet. A 4xx would
    // invite a retry; 501 tells the caller to stop.
    this.status = 501;
    this.operation = text(operation);
    this.blocked_by = state.blocked_by;
    this.retryable = false;
  }
}

// Every network-facing method funnels through here. Two independent gates must
// BOTH open before a request could ever be built: the operator flag, and the
// verified-wire flag. Today neither is open.
const assertLiveMessagingAllowed = (operation) => {
  if (!tiktokBusinessMessagingEnabled() || !TIKTOK_BUSINESS_MESSAGING_WIRE.verified) {
    throw new TikTokBusinessMessagingUnavailableError(operation);
  }
  // Unreachable today. Left as an explicit failure rather than a fallthrough so
  // that flipping the flags without implementing the client cannot produce a
  // silent no-op.
  throw new TikTokBusinessMessagingUnavailableError(operation);
};

const unavailable = (operation) => async () => assertLiveMessagingAllowed(operation);

// ---------------------------------------------------------------------------
// Pure normalizers.
//
// These are implemented for real — they need no credentials, and having them
// unit-tested now means the post-approval work is "correct the field map", not
// "write and debug a mapper". They read field names from the wire map above, so
// they carry that map's uncertainty and nothing more. They never invent a
// message: given nothing, they return null rather than a hollow row.
// ---------------------------------------------------------------------------

const epochToIso = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  // TikTok timestamps are seconds; anything past ~2001 in ms would be absurd as
  // seconds, so treat 13-digit values as already-ms.
  const ms = raw > 1e12 ? raw : raw * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const normalizeConversation = (raw = {}) => {
  const externalId = text(raw.conversation_id);
  // No id means no identity, and a conversation without identity would collide
  // with every other id-less row in the inbox. Reject rather than synthesise.
  if (!externalId) return null;
  return {
    channel: "tiktok_business_message",
    external_conversation_id: externalId,
    external_customer_id: text(raw.participant_id || raw.sender_id),
    customer_name: text(raw.nickname || raw.display_name),
    customer_avatar_url: text(raw.avatar_url),
    last_message_at: epochToIso(raw.last_message_time ?? raw.update_time),
    unread_count: Number.isFinite(Number(raw.unread_count)) ? Number(raw.unread_count) : 0,
    metadata: { provider: "tiktok_business", raw_keys: Object.keys(raw || {}) },
  };
};

export const normalizeInboundMessage = (raw = {}) => {
  const externalId = text(raw.message_id);
  if (!externalId) return null;
  const attachments = Array.isArray(raw.attachments) ? raw.attachments : [];
  return {
    channel: "tiktok_business_message",
    external_conversation_id: text(raw.conversation_id),
    external_message_id: externalId,
    external_customer_id: text(raw.sender_id),
    direction: text(raw.direction) === "outbound" ? "outbound" : "inbound",
    body: text(raw.content ?? raw.text),
    created_at: epochToIso(raw.create_time),
    attachments: attachments
      .map((item) => ({
        type: text(item?.type) || "unknown",
        url: text(item?.url),
        media_id: text(item?.media_id),
      }))
      // An attachment with neither a URL nor a media id cannot be fetched or
      // rendered; keeping it would show a broken tile in the inbox.
      .filter((item) => item.url || item.media_id),
    metadata: { provider: "tiktok_business" },
  };
};

// Idempotency key for webhook/poll dedupe. TikTok delivers at-least-once on
// every comparable surface, so the caller must dedupe on this, not on arrival.
export const inboundIdempotencyKey = (raw = {}) => {
  const conversationId = text(raw.conversation_id);
  const messageId = text(raw.message_id);
  if (!messageId) return "";
  return `tiktok_business:${conversationId || "unknown"}:${messageId}`;
};

// ---------------------------------------------------------------------------
// The provider object the AI Inbox will register once access is granted.
// ---------------------------------------------------------------------------

export const tiktokBusinessMessagingProvider = Object.freeze({
  provider: "tiktok_business",
  channel: "tiktok_business_message",
  state: TIKTOK_BUSINESS_MESSAGING_STATE,

  // Declared false so a capability-driven UI hides the actions rather than
  // rendering buttons that cannot work.
  capabilities: Object.freeze({
    list_conversations: false,
    list_messages: false,
    send_message: false,
    receive_webhook: false,
    upload_media: false,
    download_media: false,
    attachments: false,
    delivery_events: false,
    typing_indicator: false,
    // Unknown even in principle until we can read a live conversation: TikTok
    // is expected to impose a reply window, and assuming "always replyable"
    // would produce sends that fail at the API. Must be read per conversation.
    reply_window: null,
  }),

  getCapabilities: () => ({
    ...tiktokBusinessMessagingProvider.capabilities,
    state: TIKTOK_BUSINESS_MESSAGING_STATE,
  }),

  listConversations: unavailable("listConversations"),
  listMessages: unavailable("listMessages"),
  sendMessage: unavailable("sendMessage"),
  uploadMedia: unavailable("uploadMedia"),
  downloadMedia: unavailable("downloadMedia"),

  normalizeConversation,
  normalizeInboundMessage,
  inboundIdempotencyKey,
});

// Surfaced by GET /api/tiktok-business/status so Channel Settings can state the
// real reason instead of a generic "not connected".
export const describeTikTokBusinessMessagingCapability = () => ({
  ...TIKTOK_BUSINESS_MESSAGING_STATE,
  capabilities: tiktokBusinessMessagingProvider.capabilities,
  wire_verified: TIKTOK_BUSINESS_MESSAGING_WIRE.verified,
});
