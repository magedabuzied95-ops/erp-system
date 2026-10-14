import db from "../database/db.js";
import { AI_AGENT_CHANNELS, sendWhatsAppCloudReply } from "./aiChannelAdapterService.js";
import { sendMetaInboxOutboundMessage } from "./metaIntegrationService.js";
import { resolveWhatsappConversationInstance, sendWhatsappMediaMessage } from "./whatsappGatewayService.js";
import { sendTelegramMedia, sendTelegramText, TELEGRAM_CHANNEL } from "./telegramBotService.js";
import { appendManualAiSupportReply } from "./aiSupportLogService.js";
import { normalizeWhatsappLid, normalizeWhatsappPhone } from "../utils/whatsappIdentity.js";
import { absolutePublicUploadUrl } from "../utils/publicUrl.js";
import { emitToRooms } from "../utils/socket.js";

/*
 * One door for anything that is NOT an operator typing in the composer but still
 * has to land in a conversation as an outbound message: a quick reply with
 * photos, a step of a message sequence, a scheduled follow-up.
 *
 * The composer's own send route (`POST /conversations/:id/send`) stays as it is:
 * it carries the AI-draft bookkeeping (stale guards, agreement scoring,
 * assisted-approval outcomes) that an automation has no business touching.
 * What is shared is the part that cannot differ — how a conversation resolves
 * to a recipient, which transport each channel uses, and that the transcript
 * row is written whether or not the channel accepted the message.
 */

const text = (value = "") => String(value ?? "").trim();

export const normalizeInboxSendChannel = (value = "") => {
  const channel = text(value).toLowerCase();
  if (!channel) return "";
  if (channel === "facebook" || channel === "facebook_messenger" || channel === "messenger") return AI_AGENT_CHANNELS.FACEBOOK_MESSENGER;
  if (channel === "instagram" || channel === "instagram_dm") return AI_AGENT_CHANNELS.INSTAGRAM;
  if (channel === "whatsapp") return AI_AGENT_CHANNELS.WHATSAPP;
  if (channel === TELEGRAM_CHANNEL) return TELEGRAM_CHANNEL;
  if (channel === "web" || channel === "web_chat") return AI_AGENT_CHANNELS.WEB_CHAT;
  return channel;
};

const recipientIdFromConversationKey = ({ conversationId = "", channel = "" } = {}) => {
  const safeConversationId = text(conversationId);
  const separatorIndex = safeConversationId.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= safeConversationId.length - 1) return "";
  const conversationChannel = normalizeInboxSendChannel(safeConversationId.slice(0, separatorIndex));
  const normalizedChannel = normalizeInboxSendChannel(channel);
  if (!conversationChannel || !normalizedChannel || conversationChannel !== normalizedChannel) return "";
  return text(safeConversationId.slice(separatorIndex + 1));
};

const whatsappLidRecipient = ({ conversation = {}, channelMetadata = {} } = {}) => {
  const candidates = [channelMetadata.lid_jid, channelMetadata.sender_lid, conversation.external_conversation_id, conversation.session_id];
  for (const candidate of candidates) {
    const lid = normalizeWhatsappLid(candidate);
    if (lid) return `${lid}@lid`;
  }
  return "";
};

// A phone number or a LID — nothing else addresses a WhatsApp chat. Mirrors the
// composer route exactly; a PSID or a row id must never pass for a recipient.
export const whatsappRecipient = ({ conversation = {}, channelMetadata = {} } = {}) => {
  const lidJid = whatsappLidRecipient({ conversation, channelMetadata });
  const lidDigits = normalizeWhatsappLid(lidJid);
  const phone = [
    channelMetadata.resolved_phone,
    channelMetadata.phone,
    channelMetadata.customer_phone,
    conversation.external_customer_id,
    conversation.customer_phone,
    conversation.phone,
  ]
    .map((value) => normalizeWhatsappPhone(value))
    .find((value) => value && value !== lidDigits);
  return phone || lidJid;
};

let conversationKeyColumnPromise = null;
const hasConversationKeyColumn = async () => {
  if (!conversationKeyColumnPromise) {
    conversationKeyColumnPromise = db
      .query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ai_channel_conversations' AND column_name = 'conversation_key'
        LIMIT 1
      `)
      .then((result) => result.rows.length > 0)
      .catch(() => false);
  }
  return conversationKeyColumnPromise;
};

export const resolveInboxConversation = async ({ tenantId, conversationId } = {}) => {
  const safeTenantId = Number(tenantId);
  const safeConversationId = text(conversationId);
  const safeExternalCustomerId = safeConversationId.replace(/^[a-z0-9_]+:/i, "");
  const keyColumn = await hasConversationKeyColumn();

  const sessionResult = await db.query(
    `
    SELECT *
    FROM ai_support_sessions
    WHERE tenant_id = $1
      AND (session_id = $2 OR id::text = $2 OR ($3::text <> '' AND external_customer_id = $3))
    ORDER BY CASE WHEN session_id = $2 THEN 0 WHEN id::text = $2 THEN 1 ELSE 2 END, updated_at DESC, id DESC
    LIMIT 1
    `,
    [safeTenantId, safeConversationId, safeExternalCustomerId]
  );
  let sessionRow = sessionResult.rows[0] || null;

  const channelResult = await db.query(
    `
    SELECT *
    FROM ai_channel_conversations
    WHERE tenant_id = $1
      AND (
        external_conversation_id = $2
        OR external_customer_id = $2
        OR ($3::text <> '' AND external_customer_id = $3)
        ${keyColumn ? "OR conversation_key = $2" : ""}
      )
    ORDER BY
      CASE WHEN LOWER(COALESCE(channel, '')) IN ('whatsapp', 'facebook_messenger', 'facebook', 'messenger', 'instagram') THEN 0 ELSE 1 END,
      CASE
        WHEN external_conversation_id = $2 THEN 0
        WHEN external_customer_id = $2 THEN 1
        ${keyColumn ? "WHEN conversation_key = $2 THEN 2" : ""}
        WHEN external_customer_id = $3 THEN 3
        ELSE 4
      END,
      updated_at DESC,
      id DESC
    LIMIT 1
    `,
    [safeTenantId, safeConversationId, safeExternalCustomerId]
  );
  const channelRow = channelResult.rows[0] || null;

  if (channelRow?.external_conversation_id) {
    const linked = await db.query(
      `SELECT * FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = $2 LIMIT 1`,
      [safeTenantId, channelRow.external_conversation_id]
    );
    sessionRow = linked.rows[0] || sessionRow;
  }

  if (!sessionRow && !channelRow) return null;
  return {
    ...(sessionRow || {}),
    ...(channelRow || {}),
    session_id: channelRow?.external_conversation_id || sessionRow?.session_id || safeConversationId,
    session_status: sessionRow?.status || "",
    channel: channelRow?.channel || sessionRow?.channel || sessionRow?.source || channelRow?.source || "",
    source: sessionRow?.source || channelRow?.channel || channelRow?.source || "",
    external_conversation_id: channelRow?.external_conversation_id || sessionRow?.session_id || safeConversationId,
    external_customer_id: channelRow?.external_customer_id || sessionRow?.external_customer_id || "",
    customer_name: channelRow?.customer_name || sessionRow?.customer_name || "",
    channel_metadata: channelRow?.metadata || sessionRow?.channel_metadata || {},
  };
};

export const resolveInboxRecipient = (conversation = {}) => {
  const channel = normalizeInboxSendChannel(conversation.channel || conversation.source || "");
  const channelMetadata = conversation.channel_metadata || {};
  const sessionId = text(conversation.session_id || conversation.external_conversation_id || "");
  const fromKey = recipientIdFromConversationKey({ conversationId: sessionId, channel });
  if (channel === AI_AGENT_CHANNELS.WHATSAPP) {
    return { channel, recipientId: text(whatsappRecipient({ conversation, channelMetadata }) || fromKey), channelMetadata, sessionId };
  }
  const recipientId = text(
    (channel === TELEGRAM_CHANNEL ? channelMetadata.chat_id : "") ||
      channelMetadata.customer_psid ||
      channelMetadata.sender_psid ||
      channelMetadata.resolved_customer_id ||
      conversation.external_customer_id ||
      fromKey ||
      ""
  );
  return { channel, recipientId, channelMetadata, sessionId };
};

// The phone a conversation belongs to, when the channel knows one. Meta DMs
// usually do not, and then the answer is "" rather than a PSID in disguise.
export const conversationCustomerPhone = async ({ tenantId, conversation = {} } = {}) => {
  const { channel, recipientId, channelMetadata } = resolveInboxRecipient(conversation);
  if (channel === AI_AGENT_CHANNELS.WHATSAPP && recipientId && !normalizeWhatsappLid(recipientId)) return recipientId;
  const direct = normalizeWhatsappPhone(channelMetadata.customer_phone || channelMetadata.phone || conversation.customer_phone || conversation.phone || "");
  if (direct) return direct;
  const sessionId = text(conversation.session_id || "");
  if (!sessionId) return "";
  const profile = await db
    .query(
      `
      SELECT p.phone
      FROM ai_customer_profiles p
      JOIN ai_channel_conversations c ON c.tenant_id = p.tenant_id AND c.external_customer_id = p.external_customer_id
      WHERE p.tenant_id = $1 AND c.external_conversation_id = $2 AND COALESCE(p.phone, '') <> ''
      LIMIT 1
      `,
      [tenantId, sessionId]
    )
    .catch(() => ({ rows: [] }));
  return normalizeWhatsappPhone(profile.rows[0]?.phone || "") || "";
};

const sendableChannel = (channel) =>
  channel === AI_AGENT_CHANNELS.WHATSAPP ||
  channel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER ||
  channel === AI_AGENT_CHANNELS.INSTAGRAM ||
  channel === TELEGRAM_CHANNEL;

const announce = (tenantId, sessionId, message) => {
  emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", { tenant_id: tenantId, session_id: sessionId, message, at: new Date().toISOString() });
};

const whatsappInstanceFor = async ({ tenantId, conversation, channelMetadata }) =>
  text(channelMetadata.whatsapp_instance || channelMetadata.instance) ||
  text(await resolveWhatsappConversationInstance({ tenantId, conversationId: conversation.session_id }).catch(() => ""));

export const sendInboxText = async ({
  tenantId,
  conversationId,
  messageText,
  staff = {},
  clientRequestId = "",
  source = "",
  // Automations pass true: a follow-up the shop scheduled must not pause the AI
  // the way an operator stepping in does.
  preserveSessionState = false,
} = {}) => {
  const body = text(messageText);
  if (!body) throw Object.assign(new Error("Message text is required"), { status: 400 });
  const conversation = await resolveInboxConversation({ tenantId, conversationId });
  if (!conversation) throw Object.assign(new Error(`Conversation not found: ${conversationId}`), { status: 404, code: "AI_INBOX_CONVERSATION_NOT_FOUND" });
  const { channel, recipientId, channelMetadata, sessionId } = resolveInboxRecipient(conversation);
  if (!sendableChannel(channel)) {
    throw Object.assign(new Error("Live sending is only available for WhatsApp, Messenger, Instagram DM, and Telegram conversations."), { status: 409, code: "CHANNEL_SEND_UNAVAILABLE" });
  }
  if (!recipientId) throw Object.assign(new Error("The conversation has no reachable recipient id."), { status: 409, code: "RECIPIENT_MISSING" });

  let sendResult = null;
  let whatsappInstance = "";
  if (channel === AI_AGENT_CHANNELS.WHATSAPP) {
    whatsappInstance = await whatsappInstanceFor({ tenantId, conversation, channelMetadata });
    sendResult = await sendWhatsAppCloudReply({ to: recipientId, reply: { text: body }, messageText: body, instance: whatsappInstance }).catch((error) => ({
      sent: false,
      delivery_status: "failed",
      delivery_error: error?.message || "WhatsApp did not accept the message",
      error_code: error?.code || "WHATSAPP_SEND_FAILED",
    }));
  } else if (channel === TELEGRAM_CHANNEL) {
    sendResult = await sendTelegramText({ chatId: recipientId, messageText: body }).catch((error) => ({
      sent: false,
      delivery_status: "failed",
      delivery_error: error?.message || "Telegram message was not accepted",
      error_code: error?.code || "TELEGRAM_API_ERROR",
    }));
  } else {
    sendResult = await sendMetaInboxOutboundMessage({
      tenantId,
      channel: conversation.channel || conversation.source || channel,
      recipientId,
      messageText: body,
      conversationId: sessionId,
      facebookPageId: channelMetadata.page_id || channelMetadata.facebook_page_id || "",
      instagramBusinessAccountId: channelMetadata.instagram_business_account_id || channelMetadata.instagram_account_id || "",
    }).catch((error) => ({
      sent: false,
      delivery_status: "failed",
      delivery_error: error?.message || "Meta did not accept the message",
      error_code: error?.code || "META_SEND_FAILED",
    }));
  }
  const deliveryStatus = sendResult?.delivery_status || (sendResult?.sent ? "sent" : "failed");
  const deliveryError = deliveryStatus === "sent" ? "" : text(sendResult?.delivery_error || sendResult?.message || "Message was not delivered");
  const providerMessageId = text(sendResult?.message_id || sendResult?.results?.[0]?.result?.key?.id || "");
  const rawChannel = conversation.channel || conversation.source || channel;

  const message = await appendManualAiSupportReply({
    tenantId,
    sessionId,
    clientRequestId,
    message: body,
    staffUserId: staff.id || null,
    staffUserName: staff.name || "",
    source: source || rawChannel,
    channel: rawChannel,
    deliveryStatus,
    deliveryError,
    errorCode: sendResult?.error_code || "",
    externalMessageId: providerMessageId,
    providerMessageId,
    whatsappInstance: channel === AI_AGENT_CHANNELS.WHATSAPP ? (sendResult?.instanceName || sendResult?.instance || whatsappInstance) : "",
    remoteJid: recipientId,
    resolvedReplyJid: recipientId,
    resolvedPhone: channel === AI_AGENT_CHANNELS.WHATSAPP && !normalizeWhatsappLid(recipientId) ? recipientId : "",
    preserveSessionState,
  });
  announce(tenantId, sessionId, message);
  return { message, sent: deliveryStatus === "sent", delivery_status: deliveryStatus, delivery_error: deliveryError, session_id: sessionId, channel };
};

export const sendInboxMedia = async ({
  tenantId,
  conversationId,
  relativeUrl,
  kind = "image",
  mimeType = "",
  fileName = "",
  fileSize = 0,
  caption = "",
  staff = {},
  clientRequestId = "",
  source = "",
  preserveSessionState = false,
} = {}) => {
  const url = text(relativeUrl);
  if (!url) throw Object.assign(new Error("A media url is required"), { status: 400 });
  const attachmentKind = kind === "video" ? "video" : "image";
  const conversation = await resolveInboxConversation({ tenantId, conversationId });
  if (!conversation) throw Object.assign(new Error(`Conversation not found: ${conversationId}`), { status: 404, code: "AI_INBOX_CONVERSATION_NOT_FOUND" });
  const { channel, recipientId, channelMetadata, sessionId } = resolveInboxRecipient(conversation);
  const safeCaption = text(caption);

  let sendResult = null;
  if (!sendableChannel(channel)) {
    sendResult = { sent: true, delivery_status: "stored" };
  } else if (!recipientId) {
    sendResult = { sent: false, delivery_status: "failed", delivery_error: "The conversation has no reachable recipient id." };
  } else if (channel === AI_AGENT_CHANNELS.WHATSAPP) {
    const instance = await whatsappInstanceFor({ tenantId, conversation, channelMetadata });
    sendResult = await sendWhatsappMediaMessage({ phone: recipientId, mediaUrl: url, mediaType: attachmentKind, caption: safeCaption, instance })
      .then((result) => ({ ...result, sent: true, delivery_status: "sent", message_id: text(result?.result?.key?.id || result?.result?.message_id || result?.message_id || "") }))
      .catch((error) => ({ sent: false, delivery_status: "failed", delivery_error: error?.message || `WhatsApp did not accept the ${attachmentKind}`, error_code: error?.code || "WHATSAPP_MEDIA_SEND_FAILED" }));
  } else if (channel === TELEGRAM_CHANNEL) {
    sendResult = await sendTelegramMedia({ chatId: recipientId, mediaUrl: absolutePublicUploadUrl(url) || url, mediaType: attachmentKind === "video" ? "video" : "photo", caption: safeCaption })
      .catch((error) => ({ sent: false, delivery_status: "failed", delivery_error: error?.message || `Telegram did not accept the ${attachmentKind}`, error_code: error?.code || "TELEGRAM_MEDIA_SEND_FAILED" }));
  } else {
    sendResult = await sendMetaInboxOutboundMessage({
      tenantId,
      channel: conversation.channel || conversation.source || channel,
      recipientId,
      messageText: safeCaption,
      conversationId: sessionId,
      attachments: [{ type: attachmentKind, image_url: url, mime_type: mimeType || "" }],
      facebookPageId: channelMetadata.page_id || channelMetadata.facebook_page_id || "",
      instagramBusinessAccountId: channelMetadata.instagram_business_account_id || channelMetadata.instagram_account_id || "",
    }).catch((error) => ({ sent: false, delivery_status: "failed", delivery_error: error?.message || `Meta did not accept the ${attachmentKind}`, error_code: error?.code || "META_MEDIA_SEND_FAILED" }));
  }

  const deliveryStatus = sendResult?.delivery_status || (sendResult?.sent ? "sent" : "failed");
  const deliveryError = deliveryStatus === "failed" ? text(sendResult?.delivery_error || sendResult?.message || `The ${attachmentKind} was not delivered`) : "";
  const providerMessageId = text(sendResult?.message_id || "");
  const rawChannel = conversation.channel || conversation.source || channel || AI_AGENT_CHANNELS.WEB_CHAT;

  const message = await appendManualAiSupportReply({
    tenantId,
    sessionId,
    clientRequestId,
    message: safeCaption,
    preserveExactMessage: true,
    previewMessage: safeCaption || (attachmentKind === "video" ? "🎬 فيديو" : "📷 صورة"),
    messageType: attachmentKind,
    staffUserId: staff.id || null,
    staffUserName: staff.name || "",
    source: source || rawChannel,
    channel: rawChannel,
    deliveryStatus,
    deliveryError,
    errorCode: sendResult?.error_code || "",
    externalMessageId: providerMessageId,
    providerMessageId,
    remoteJid: channel === AI_AGENT_CHANNELS.WHATSAPP ? recipientId : "",
    visualAttachments: [{ type: attachmentKind, url, mime_type: mimeType || "", file_name: fileName || url.split("/").pop(), file_size: Number(fileSize || 0) }],
    preserveSessionState,
  });
  announce(tenantId, sessionId, message);
  return { message, sent: deliveryStatus === "sent", delivery_status: deliveryStatus, delivery_error: deliveryError, session_id: sessionId, channel, url };
};
