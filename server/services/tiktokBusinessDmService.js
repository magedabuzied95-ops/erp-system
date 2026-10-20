// TikTok direct messages in the AI Inbox — Business Messaging API.
//
// CONTRACT PROVENANCE (read 2026-10-20 from TikTok's own docs, Business
// Messaging API > Guides + API Reference, v1.3)
// -----------------------------------------------------------------------------
// * Same app, same OAuth as the comments integration: tt_user OAuth on
//   business-api.tiktok.com, `business_id` = the token's `open_id`. Messaging
//   only needs the "Business Messaging" permission on the app, which TikTok
//   grants after its Data Security & Privacy review, plus a re-authorisation so
//   the token carries the message.list.* scopes.
// * Webhook: app-level subscription, `POST /business/webhook/update/` with
//   event_type DIRECT_MESSAGE. Envelope `{client_key, event, create_time,
//   user_openid, content}` where `content` is a JSON STRING. Signed exactly like
//   the comment webhook, so it arrives on the same route and table.
//     im_receive_msg / im_receive_msg_eu  a customer wrote to us
//     im_send_msg                         the business sent something — from our
//                                         API, the TikTok app, or TikTok Web
// * Send: `POST /business/message/send/` {business_id, recipient_type:
//   "CONVERSATION", recipient:<conversation_id>, message_type, text|image}.
//   Text ≤ 6000 chars; a message is text OR image, never both.
// * Images: upload `POST /business/message/media/upload/` (multipart, JPG/PNG,
//   ≤ 3MB) → media_id (30 days). Download `POST /business/message/media/download/`
//   → download_url valid 24h, fetched with header `x-user: <access token>`.
// * The business can never open a conversation, and TikTok rate-limits replies
//   (10 messages in the 48h after the first customer message; 3 once a thread
//   has been quiet 48h). A refusal comes back as an API error and is surfaced.
//
// The channel key is plain "tiktok" and the session id is `tiktok:<conversation_id>`
// so the inbox's session-id prefix rule (server/utils/inboxChannelIdentity.js)
// files every row under TikTok without help.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";
import { handleInboundMessageIntake } from "./aiInboundIntakeService.js";
import { logChannelEvent, upsertChannelConversationMapping } from "./aiChannelAdapterService.js";
import { appendChannelOutboundSupportReply, appendInboundAiSupportMessage } from "./aiSupportLogService.js";
import {
  TikTokBusinessApiError,
  TIKTOK_BUSINESS_PATHS,
  describeTikTokBusinessFailure,
  tiktokBusinessPost,
  tiktokBusinessPostMultipart,
  tiktokBusinessGet,
} from "./tiktokBusinessApiClient.js";
import {
  TIKTOK_BUSINESS_MESSAGING_SCOPES,
  tiktokBusinessEnabled,
  tiktokBusinessMessagingEnabled,
} from "./tiktokBusinessConfigService.js";
import { getValidTikTokBusinessAccessToken } from "./tiktokBusinessOAuthService.js";

const text = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

export const TIKTOK_DM_CHANNEL = "tiktok";
export const TIKTOK_DM_SESSION_PREFIX = "tiktok:";
export const TIKTOK_DM_TEXT_MAX_CHARS = 6000;
export const TIKTOK_DM_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

export const TIKTOK_DM_EVENTS = Object.freeze({
  RECEIVE: "im_receive_msg",
  RECEIVE_EU: "im_receive_msg_eu",
  SEND: "im_send_msg",
});

const DM_EVENT_SET = new Set(Object.values(TIKTOK_DM_EVENTS));
export const isTikTokDmEvent = (eventName = "") => DM_EVENT_SET.has(text(eventName).toLowerCase());

export const tiktokDmSessionId = (conversationId = "") => {
  const id = text(conversationId);
  return id ? `${TIKTOK_DM_SESSION_PREFIX}${id}` : "";
};

export const tiktokConversationIdFromSessionId = (sessionId = "") => {
  const raw = text(sessionId);
  return raw.toLowerCase().startsWith(TIKTOK_DM_SESSION_PREFIX) ? raw.slice(TIKTOK_DM_SESSION_PREFIX.length) : "";
};

// Live sending needs: the feature flags, a connected account, and the token
// actually carrying the send scope. Anything less is reported, never guessed.
export const tiktokDmLiveEnabled = () => tiktokBusinessEnabled() && tiktokBusinessMessagingEnabled();

export class TikTokDmError extends Error {
  constructor(message, { code = "TIKTOK_DM_ERROR", status = 502, retryable = false } = {}) {
    super(message);
    this.name = "TikTokDmError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const parseContent = (content) => {
  if (content && typeof content === "object") return content;
  const raw = text(content);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

// Normalises one Business Messaging webhook envelope. Returns null for anything
// that is not a direct-message event we act on.
export const normalizeTikTokDmEvent = (payload = {}) => {
  const event = text(payload?.event).toLowerCase();
  if (!isTikTokDmEvent(event)) return null;
  const content = parseContent(payload?.content);
  const businessId = text(payload?.user_openid);
  const conversationId = text(content?.conversation_id);
  const messageId = text(content?.message_id);
  if (!conversationId || !messageId) return null;

  const fromUser = content?.from_user || {};
  const toUser = content?.to_user || {};
  const fromRole = text(fromUser.role).toLowerCase();
  // The business is whichever side carries the business role or our own id.
  const fromBusiness = event === TIKTOK_DM_EVENTS.SEND ||
    fromRole === "business_account" ||
    (businessId && text(fromUser.id) === businessId);
  const customer = fromBusiness ? toUser : fromUser;
  const type = text(content?.type || content?.message_type).toLowerCase() || "text";
  const timestampMs = Number(content?.timestamp) || Number(payload?.create_time) * 1000 || Date.now();

  return {
    event,
    business_id: businessId,
    conversation_id: conversationId,
    session_id: tiktokDmSessionId(conversationId),
    message_id: messageId,
    direction: fromBusiness ? "outbound" : "inbound",
    customer_id: text(customer?.id || (!fromBusiness ? content?.unique_identifier : "")),
    customer_username: text(fromBusiness ? content?.to : content?.from),
    business_username: text(fromBusiness ? content?.from : content?.to),
    type,
    text: text(content?.text?.body),
    image_media_id: text(content?.image?.media_id),
    video_media_id: text(content?.video?.media_id),
    share_post: content?.share_post ? {
      embed_url: text(content.share_post.embed_url),
      video_id: text(content.share_post.video_id),
    } : null,
    sticker_url: text(content?.sticker?.url),
    emoji_url: text(content?.emoji?.url),
    template_title: text(content?.template?.elements?.[0]?.title || content?.template?.title),
    referenced_message_id: text(content?.referenced_message_info?.referenced_message_id),
    auto_message_type: text(content?.auto_message_type),
    source: text(content?.message_tag?.source).toUpperCase(),
    is_follower: content?.is_follower === true,
    timestamp: new Date(timestampMs).toISOString(),
  };
};

// What the transcript shows when a message has no text of its own.
export const tiktokDmPreviewText = (normalized = {}) => {
  if (normalized.text) return normalized.text;
  switch (normalized.type) {
    case "image": return "صورة";
    case "video": return "فيديو";
    case "share_post": return normalized.share_post?.embed_url ? `فيديو تيكتوك: ${normalized.share_post.embed_url}` : "فيديو تيكتوك";
    case "sticker": return "ملصق";
    case "emoji": return "إيموجي";
    case "template": return normalized.template_title || "رسالة";
    case "reaction": return "تفاعل";
    default: return "رسالة تيكتوك";
  }
};

// ---------------------------------------------------------------------------
// TikTok API calls
// ---------------------------------------------------------------------------

const resolveConnection = async ({ tenantId, getToken = getValidTikTokBusinessAccessToken } = {}) => {
  const result = await getToken({ tenantId });
  const accessToken = text(result?.accessToken);
  const businessId = text(result?.businessId);
  if (!accessToken || !businessId) {
    throw new TikTokDmError("TikTok Business account is not connected", { code: "TIKTOK_DM_NOT_CONNECTED", status: 409 });
  }
  const granted = new Set(String(result?.row?.granted_scopes || "").split(/[\s,]+/).map(text).filter(Boolean));
  return { accessToken, businessId, granted };
};

const assertSendScope = (granted) => {
  if (!granted.has("message.list.send")) {
    throw new TikTokDmError(
      "TikTok has not granted the Business Messaging permission to this connection yet — reconnect TikTok after the permission is approved.",
      { code: "TIKTOK_DM_SCOPE_MISSING", status: 409 }
    );
  }
};

export const sendTikTokDirectText = async ({ tenantId, conversationId, messageText, deps = {} } = {}) => {
  if (!tiktokDmLiveEnabled()) {
    throw new TikTokDmError("TikTok direct messages are not enabled on this server", { code: "TIKTOK_DM_DISABLED", status: 409 });
  }
  const body = text(messageText);
  const recipient = text(conversationId);
  if (!recipient) throw new TikTokDmError("Conversation has no TikTok conversation id", { code: "TIKTOK_DM_RECIPIENT_MISSING", status: 409 });
  if (!body) throw new TikTokDmError("Message text is required", { code: "TIKTOK_DM_EMPTY", status: 400 });
  if ([...body].length > TIKTOK_DM_TEXT_MAX_CHARS) {
    throw new TikTokDmError(`TikTok messages are limited to ${TIKTOK_DM_TEXT_MAX_CHARS} characters`, { code: "TIKTOK_DM_TOO_LONG", status: 400 });
  }
  const { accessToken, businessId, granted } = await resolveConnection({ tenantId, getToken: deps.getToken });
  assertSendScope(granted);
  const post = deps.post || tiktokBusinessPost;
  const response = await post(TIKTOK_BUSINESS_PATHS.MESSAGE_SEND, {
    accessToken,
    body: {
      business_id: businessId,
      recipient_type: "CONVERSATION",
      recipient,
      message_type: "TEXT",
      text: { body },
    },
  });
  const messageId = text(response?.message?.message_id);
  return { sent: true, delivery_status: "sent", message_id: messageId };
};

const IMAGE_MIME = new Map([["image/jpeg", "jpg"], ["image/jpg", "jpg"], ["image/png", "png"]]);

export const sendTikTokDirectImage = async ({ tenantId, conversationId, bytes, mimeType = "image/jpeg", fileName = "image.jpg", deps = {} } = {}) => {
  if (!tiktokDmLiveEnabled()) {
    throw new TikTokDmError("TikTok direct messages are not enabled on this server", { code: "TIKTOK_DM_DISABLED", status: 409 });
  }
  const recipient = text(conversationId);
  if (!recipient) throw new TikTokDmError("Conversation has no TikTok conversation id", { code: "TIKTOK_DM_RECIPIENT_MISSING", status: 409 });
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const mime = text(mimeType).toLowerCase().split(";")[0];
  if (!IMAGE_MIME.has(mime)) throw new TikTokDmError("TikTok only accepts JPG or PNG images", { code: "TIKTOK_DM_IMAGE_TYPE", status: 415 });
  if (!buffer.length || buffer.length > TIKTOK_DM_IMAGE_MAX_BYTES) {
    throw new TikTokDmError("TikTok images must be under 3MB", { code: "TIKTOK_DM_IMAGE_SIZE", status: 413 });
  }
  const { accessToken, businessId, granted } = await resolveConnection({ tenantId, getToken: deps.getToken });
  assertSendScope(granted);
  const upload = deps.upload || tiktokBusinessPostMultipart;
  const uploaded = await upload(TIKTOK_BUSINESS_PATHS.MESSAGE_MEDIA_UPLOAD, {
    accessToken,
    fields: { business_id: businessId, media_type: "IMAGE" },
    file: { field: "file", bytes: buffer, fileName: text(fileName) || `image.${IMAGE_MIME.get(mime)}`, mimeType: mime },
  });
  const mediaId = text(uploaded?.media_id);
  if (!mediaId) throw new TikTokDmError("TikTok did not return a media id for the image", { code: "TIKTOK_DM_UPLOAD_FAILED" });
  const post = deps.post || tiktokBusinessPost;
  const response = await post(TIKTOK_BUSINESS_PATHS.MESSAGE_SEND, {
    accessToken,
    body: {
      business_id: businessId,
      recipient_type: "CONVERSATION",
      recipient,
      message_type: "IMAGE",
      image: { media_id: mediaId },
    },
  });
  return { sent: true, delivery_status: "sent", message_id: text(response?.message?.message_id), media_id: mediaId };
};

// The inbox stores media as an /uploads path (or occasionally a full URL).
// TikTok only takes uploaded bytes, so read the file ourselves. Videos cannot
// be sent through the API at all.
export const sendTikTokDirectMediaFromUrl = async ({ tenantId, conversationId, url, mimeType = "", caption = "", deps = {} } = {}) => {
  const source = text(url);
  if (!source) throw new TikTokDmError("A media url is required", { code: "TIKTOK_DM_MEDIA_MISSING", status: 400 });
  let bytes;
  let mime = text(mimeType).toLowerCase();
  const uploadsPath = source.replace(/^https?:\/\/[^/]+/i, "");
  if (uploadsPath.startsWith("/uploads/")) {
    const root = path.resolve(process.cwd(), "uploads");
    const local = path.resolve(process.cwd(), `.${decodeURIComponent(uploadsPath)}`);
    if (!local.startsWith(root + path.sep)) throw new TikTokDmError("Media path is outside uploads", { code: "TIKTOK_DM_MEDIA_PATH", status: 400 });
    bytes = await (deps.readFile || fs.readFile)(local);
  } else {
    const response = await (deps.fetch || fetch)(source);
    if (!response.ok) throw new TikTokDmError("Could not read the media to send", { code: "TIKTOK_DM_MEDIA_FETCH_FAILED" });
    mime = mime || text(response.headers?.get?.("content-type")).split(";")[0].toLowerCase();
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (!mime) mime = /\.png$/i.test(uploadsPath) ? "image/png" : "image/jpeg";
  const sent = await sendTikTokDirectImage({ tenantId, conversationId, bytes, mimeType: mime, fileName: path.basename(uploadsPath) || "image.jpg", deps });
  // TikTok refuses text and image in one message, so a caption follows it.
  if (text(caption)) {
    await sendTikTokDirectText({ tenantId, conversationId, messageText: caption, deps }).catch((error) => {
      console.warn("[tiktok-dm] caption after image failed", { code: text(error?.code) });
    });
  }
  return sent;
};

// Reads the scope list straight from the stored connection, so the inbox can
// say exactly what is missing instead of a blanket "unavailable".
export const describeTikTokDmStatus = async ({ tenantId } = {}) => {
  const enabled = tiktokDmLiveEnabled();
  let connected = false;
  let grantedScopes = [];
  try {
    const { rows } = await db.query(
      `SELECT status, granted_scopes FROM tiktok_business_connections WHERE tenant_id = $1::bigint LIMIT 1`,
      [tenantId]
    );
    connected = text(rows[0]?.status) === "connected";
    grantedScopes = String(rows[0]?.granted_scopes || "").split(/[\s,]+/).map(text).filter(Boolean);
  } catch {
    // Table absent while the Business integration is off.
  }
  const missingScopes = TIKTOK_BUSINESS_MESSAGING_SCOPES.filter((scope) => !grantedScopes.includes(scope));
  const canSend = enabled && connected && grantedScopes.includes("message.list.send");
  return {
    channel: TIKTOK_DM_CHANNEL,
    env_enabled: enabled,
    connected,
    missing_scopes: missingScopes,
    live_operational: canSend,
    effective_enabled: canSend,
    status: !enabled ? "disabled" : !connected ? "not_connected" : missingScopes.length ? "missing_permission" : "active",
  };
};

// ---------------------------------------------------------------------------
// Inbound media
// ---------------------------------------------------------------------------

const storeTikTokMedia = async ({ bytes, messageId, extension, storageRoot = process.cwd() } = {}) => {
  const safeId = crypto.createHash("sha1").update(text(messageId)).digest("hex").slice(0, 24);
  const directory = path.join(storageRoot, "uploads", "inbox-media", TIKTOK_DM_CHANNEL);
  await fs.mkdir(directory, { recursive: true });
  const fileName = `${safeId}.${extension}`;
  await fs.writeFile(path.join(directory, fileName), bytes);
  return `/uploads/inbox-media/${TIKTOK_DM_CHANNEL}/${fileName}`;
};

export const materializeTikTokDmImage = async ({
  tenantId,
  normalized,
  deps = {},
  storageRoot = process.cwd(),
  publicBaseUrl = process.env.PUBLIC_BACKEND_URL || "",
} = {}) => {
  const mediaId = normalized?.image_media_id || normalized?.video_media_id;
  if (!mediaId) return [];
  const mediaType = normalized.image_media_id ? "IMAGE" : "VIDEO";
  const base = { type: mediaType === "IMAGE" ? "image" : "video", media_type: mediaType === "IMAGE" ? "image" : "video", media_id: mediaId };
  try {
    const { accessToken, businessId } = await resolveConnection({ tenantId, getToken: deps.getToken });
    const post = deps.post || tiktokBusinessPost;
    const response = await post(TIKTOK_BUSINESS_PATHS.MESSAGE_MEDIA_DOWNLOAD, {
      accessToken,
      body: {
        business_id: businessId,
        conversation_id: normalized.conversation_id,
        message_id: normalized.message_id,
        media_id: mediaId,
        media_type: mediaType,
      },
    });
    const downloadUrl = text(response?.download_url);
    if (!downloadUrl) throw new TikTokDmError("TikTok returned no download url", { code: "TIKTOK_DM_MEDIA_URL_MISSING" });
    const fetchImpl = deps.fetch || fetch;
    const media = await fetchImpl(downloadUrl, { headers: { "x-user": accessToken } });
    if (!media.ok) throw new TikTokDmError("TikTok media download failed", { code: "TIKTOK_DM_MEDIA_DOWNLOAD_FAILED" });
    const mime = text(media.headers?.get?.("content-type")).split(";")[0].toLowerCase();
    const bytes = Buffer.from(await media.arrayBuffer());
    const limit = mediaType === "IMAGE" ? 15 * 1024 * 1024 : 50 * 1024 * 1024;
    if (!bytes.length || bytes.length > limit) throw new TikTokDmError("TikTok media has an invalid size", { code: "TIKTOK_DM_MEDIA_SIZE" });
    const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime.startsWith("video/") ? "mp4" : "jpg";
    const localPath = await storeTikTokMedia({ bytes, messageId: `${normalized.conversation_id}:${normalized.message_id}`, extension, storageRoot });
    const origin = text(publicBaseUrl).replace(/\/+$/g, "");
    const url = origin ? `${origin}${localPath}` : localPath;
    return [{ ...base, url, media_url: url, mime_type: mime, file_size: bytes.length, download_status: "stored", materialized: true }];
  } catch (error) {
    return [{ ...base, download_status: "failed", download_error: text(error?.code || error?.message || "media_download_failed").slice(0, 120) }];
  }
};

// ---------------------------------------------------------------------------
// Webhook row processing
// ---------------------------------------------------------------------------

const tenantForBusinessId = async (businessId) => {
  if (!businessId) return null;
  const { rows } = await db.query(
    `SELECT tenant_id FROM tiktok_business_connections WHERE business_id = $1::text LIMIT 1`,
    [businessId]
  );
  const tenantId = Number(rows[0]?.tenant_id);
  return Number.isSafeInteger(tenantId) && tenantId > 0 ? tenantId : null;
};

export const processTikTokDmEventRow = async (eventRow, deps = {}) => {
  const normalized = normalizeTikTokDmEvent(eventRow?.payload || {});
  if (!normalized) return { processed: false, reason: "not_a_direct_message" };
  // Our own API sends were already written to the transcript by the route that
  // sent them; storing the echo would show every reply twice.
  if (normalized.direction === "outbound" && normalized.source === "API") {
    return { processed: true, ignored: true, reason: "api_echo" };
  }
  const tenantId = await (deps.resolveTenant || tenantForBusinessId)(normalized.business_id);
  if (!tenantId) return { processed: false, reason: "tenant_unresolved" };

  const appendInbound = deps.appendInbound || appendInboundAiSupportMessage;
  const appendOutbound = deps.appendOutbound || appendChannelOutboundSupportReply;
  const upsertConversation = deps.upsertConversation || upsertChannelConversationMapping;
  const logEvent = deps.logEvent || logChannelEvent;
  const emit = deps.emit || emitToRooms;
  const intake = deps.intake || handleInboundMessageIntake;
  const materialize = deps.materialize || materializeTikTokDmImage;

  const attachments = normalized.image_media_id || normalized.video_media_id
    ? await materialize({ tenantId, normalized, deps })
    : normalized.sticker_url || normalized.emoji_url
      ? [{ type: "image", media_type: "image", url: normalized.sticker_url || normalized.emoji_url, media_url: normalized.sticker_url || normalized.emoji_url, download_status: "remote" }]
      : [];
  const messageText = tiktokDmPreviewText(normalized);
  const customerName = normalized.customer_username ? `@${normalized.customer_username}` : "";

  let row = null;
  if (normalized.direction === "inbound") {
    row = await appendInbound({
      tenantId,
      sessionId: normalized.session_id,
      message: messageText,
      messageType: normalized.type === "image" ? "image" : normalized.type === "video" ? "video" : "text",
      channel: TIKTOK_DM_CHANNEL,
      customerName,
      externalMessageId: normalized.message_id,
      providerMessageId: normalized.message_id,
      visualAttachments: attachments,
      source: "tiktok_webhook",
      sourcePath: "tiktok_webhook",
      insertSource: "tiktok_webhook",
    });
  } else {
    // A reply typed in the TikTok app or TikTok Web: keep the thread complete.
    row = await appendOutbound({
      tenantId,
      sessionId: normalized.session_id,
      message: messageText,
      messageType: normalized.type === "image" ? "image" : "text",
      channel: TIKTOK_DM_CHANNEL,
      senderType: "staff",
      deliveryStatus: "sent",
      externalMessageId: normalized.message_id,
      providerMessageId: normalized.message_id,
      visualAttachments: attachments,
      source: "tiktok_app",
      sourcePath: "tiktok_webhook",
      insertSource: "tiktok_app_echo",
      preserveExistingOnProviderMatch: true,
    });
  }

  await upsertConversation({
    tenantId,
    channel: TIKTOK_DM_CHANNEL,
    externalConversationId: normalized.session_id,
    externalCustomerId: normalized.customer_id,
    customerName,
    metadata: {
      tiktok_conversation_id: normalized.conversation_id,
      tiktok_business_id: normalized.business_id,
      tiktok_user_id: normalized.customer_id,
      username: normalized.customer_username,
      is_follower: normalized.is_follower,
      last_message: messageText,
      ...(normalized.direction === "inbound" ? { last_customer_message_at: normalized.timestamp } : {}),
    },
    lastMessageAt: normalized.timestamp,
  });

  await logEvent({
    tenantId,
    channel: TIKTOK_DM_CHANNEL,
    direction: normalized.direction,
    externalCustomerId: normalized.customer_id,
    conversationId: normalized.session_id,
    messagePreview: messageText,
    status: normalized.direction === "inbound" ? "received" : "sent",
    metadata: { external_message_id: normalized.message_id, event: normalized.event, source: normalized.source },
  }).catch(() => {});

  if (row) {
    emit([`tenant:${tenantId}`], "ai_inbox:message", {
      tenant_id: tenantId,
      session_id: normalized.session_id,
      channel: TIKTOK_DM_CHANNEL,
      message: { ...row, from_me: normalized.direction === "outbound", direction: normalized.direction },
    });
    emit([`tenant:${tenantId}`], "ai_inbox:refresh", {
      tenant_id: tenantId,
      session_id: normalized.session_id,
      channel: TIKTOK_DM_CHANNEL,
      reason: normalized.direction === "inbound" ? "tiktok_inbound" : "tiktok_outbound",
      at: new Date().toISOString(),
    });
  }

  if (normalized.direction === "inbound" && !normalized.auto_message_type) {
    await intake({
      tenantId,
      channel: TIKTOK_DM_CHANNEL,
      conversationId: normalized.session_id,
      canonicalMessageId: row?.id || null,
      providerMessageId: normalized.message_id,
      text: normalized.text,
      fromMe: false,
      autoReplyMode: "suggest_only",
      autoSent: false,
    }).catch(() => {});
  }

  return { processed: true, tenant_id: tenantId, session_id: normalized.session_id, direction: normalized.direction };
};

// ---------------------------------------------------------------------------
// Drain: DM rows are processed seconds after they land (the comment worker's
// five-minute cadence is fine for comments, not for a customer waiting on a
// reply). The webhook route wakes it on every DM event; a slow interval sweeps
// anything a crash left pending.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 6;
let draining = false;
let sweepTimer = null;

export const drainTikTokDmEvents = async ({ limit = 25, process: processRow = processTikTokDmEventRow } = {}) => {
  if (draining) return { skipped: true };
  draining = true;
  let processed = 0;
  let failed = 0;
  try {
    const { rows } = await db.query(
      `SELECT * FROM tiktok_business_webhook_events
       WHERE status = 'pending' AND event_type = ANY($1::text[])
       ORDER BY received_at ASC LIMIT $2::int`,
      [[...DM_EVENT_SET], limit]
    );
    for (const eventRow of rows) {
      try {
        const result = await processRow(eventRow);
        await db.query(
          `UPDATE tiktok_business_webhook_events
           SET status = $2::text, processed_at = NOW(), attempts = attempts + 1, last_error = $3::text
           WHERE id = $1::bigint`,
          [eventRow.id, result.processed ? "processed" : "skipped", result.processed ? "" : text(result.reason)]
        );
        processed += 1;
      } catch (error) {
        failed += 1;
        await db.query(
          `UPDATE tiktok_business_webhook_events
           SET status = CASE WHEN attempts + 1 >= $3::int THEN 'failed' ELSE 'pending' END,
               attempts = attempts + 1, last_error = $2::text
           WHERE id = $1::bigint`,
          [eventRow.id, text(describeTikTokBusinessFailure(error).message || error?.message).slice(0, 500), MAX_ATTEMPTS]
        ).catch(() => {});
        console.warn("[tiktok-dm] event processing failed", { id: eventRow.id, code: text(error?.code) });
      }
    }
    return { processed, failed };
  } finally {
    draining = false;
  }
};

export const wakeTikTokDmDrain = () => {
  setImmediate(() => {
    void drainTikTokDmEvents().catch((error) => console.warn("[tiktok-dm] drain failed", { message: text(error?.message).slice(0, 200) }));
  });
};

export const startTikTokDmWorker = () => {
  if (!tiktokDmLiveEnabled()) return null;
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(wakeTikTokDmDrain, 30_000);
  sweepTimer.unref?.();
  wakeTikTokDmDrain();
  console.log("[tiktok-dm] worker started");
  return sweepTimer;
};

export const stopTikTokDmWorker = () => {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
};

// ---------------------------------------------------------------------------
// Webhook registration (app level — one call covers every connected account)
// ---------------------------------------------------------------------------

export const registerTikTokDmWebhook = async ({ appId, appSecret, callbackUrl, deps = {} } = {}) => {
  if (!text(appId) || !text(appSecret) || !text(callbackUrl)) {
    throw new TikTokBusinessApiError("App id, secret and callback url are required", { code: "TIKTOK_DM_WEBHOOK_CONFIG_MISSING", status: 400 });
  }
  const post = deps.post || tiktokBusinessPost;
  const response = await post(TIKTOK_BUSINESS_PATHS.WEBHOOK_UPDATE, {
    body: { app_id: text(appId), secret: text(appSecret), event_type: "DIRECT_MESSAGE", callback_url: text(callbackUrl) },
  });
  return { registered: true, callback_url: text(response?.callback_url || callbackUrl), event_type: "DIRECT_MESSAGE" };
};

export const getTikTokDmWebhook = async ({ appId, appSecret, deps = {} } = {}) => {
  const get = deps.get || tiktokBusinessGet;
  const response = await get(TIKTOK_BUSINESS_PATHS.WEBHOOK_LIST, {
    params: { app_id: text(appId), secret: text(appSecret), event_type: "DIRECT_MESSAGE" },
  });
  const entry = asArray(response?.list || response?.webhooks)[0] || response || {};
  return { callback_url: text(entry.callback_url), event_type: text(entry.event_type) };
};

export const __testing = { parseContent, asArray };
