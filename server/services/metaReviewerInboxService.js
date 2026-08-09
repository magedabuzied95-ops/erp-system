import { randomUUID } from "node:crypto";

import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";
import { ensureAiChannelAdapterSchema } from "./aiChannelAdapterService.js";
import { ensureAiSupportLogSchema, appendManualAiSupportReply } from "./aiSupportLogService.js";
import { sendMetaInboxOutboundMessage } from "./metaIntegrationService.js";
import {
  extractMetaReviewerIdentity,
  filterMetaReviewerVisibleMessages,
  loadMetaReviewerScope,
  metaReviewerConversationAllowed,
  metaReviewerConversationRef,
  metaReviewerConversationRefMatches,
  metaReviewerRealtimeRoom,
  sanitizeMetaReviewerMessage,
} from "./metaReviewerAccessService.js";

const text = (value = "") => String(value ?? "").trim();
const int = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const PAGE_ID_SQL = `COALESCE(
  NULLIF(c.metadata->>'page_id', ''),
  NULLIF(c.metadata->>'facebook_page_id', ''),
  NULLIF(c.metadata->>'resolved_page_id', ''),
  NULLIF(c.metadata->>'recipient_page_id', ''),
  NULLIF(c.metadata#>>'{raw_payload,page_id}', ''),
  NULLIF(c.metadata#>>'{raw_payload,value,page_id}', '')
)`;

const PSID_MATCH_SQL = `ARRAY_REMOVE(ARRAY[
  NULLIF(c.external_customer_id, ''),
  NULLIF(c.metadata->>'customer_psid', ''),
  NULLIF(c.metadata->>'sender_psid', ''),
  NULLIF(c.metadata->>'resolved_customer_id', '')
], NULL) && $3::text[]`;

const scopedConversationSql = ({ includeSearch = false } = {}) => `
  SELECT
    s.session_id,
    COALESCE(NULLIF(c.customer_name, ''), NULLIF(s.customer_name, ''), 'Meta test account') AS customer_name,
    COALESCE(NULLIF(c.customer_avatar_url, ''), NULLIF(s.customer_avatar_url, ''), '') AS customer_avatar_url,
    COALESCE(
      NULLIF(visible_message.customer_message, ''),
      NULLIF(visible_message.staff_message, ''),
      NULLIF(visible_message.message_text, ''),
      NULLIF(visible_message.ai_answer, ''),
      NULLIF(visible_message.last_message, ''),
      ''
    ) AS last_message,
    visible_message.created_at AS last_message_at,
    COALESCE(c.read_at, s.read_at) AS read_at,
    c.channel,
    c.external_customer_id,
    c.external_conversation_id,
    c.metadata AS channel_metadata,
    ${PAGE_ID_SQL} AS resolved_page_id,
    (
      SELECT COUNT(*)::int
      FROM ai_support_messages unread_message
      WHERE unread_message.tenant_id = s.tenant_id
        AND unread_message.session_id = s.session_id
        AND unread_message.sender_type = 'customer'
        AND unread_message.created_at >= $4::timestamptz
        AND unread_message.created_at > COALESCE(c.read_at, s.read_at, TIMESTAMP 'epoch')
    ) AS unread_count
  FROM ai_support_sessions s
  JOIN LATERAL (
    SELECT channel_conversation.*
    FROM ai_channel_conversations channel_conversation
    WHERE channel_conversation.tenant_id = s.tenant_id
      AND channel_conversation.external_conversation_id = s.session_id
      AND LOWER(channel_conversation.channel) IN ('facebook', 'facebook_messenger', 'messenger')
    ORDER BY channel_conversation.updated_at DESC, channel_conversation.id DESC
    LIMIT 1
  ) c ON TRUE
  LEFT JOIN LATERAL (
    SELECT candidate_message.*
    FROM ai_support_messages candidate_message
    WHERE candidate_message.tenant_id = s.tenant_id
      AND candidate_message.session_id = s.session_id
      AND candidate_message.created_at >= $4::timestamptz
    ORDER BY candidate_message.created_at DESC, candidate_message.id DESC
    LIMIT 1
  ) visible_message ON TRUE
  WHERE s.tenant_id = $1::bigint
    AND ${PAGE_ID_SQL} = $2::text
    AND ${PSID_MATCH_SQL}
    AND LOWER(COALESCE(s.thread_kind, c.thread_kind, 'dm')) <> 'comment'
    ${includeSearch ? `AND (
      $5::text = ''
      OR LOWER(COALESCE(c.customer_name, s.customer_name, '')) LIKE $5::text
      OR EXISTS (
        SELECT 1 FROM ai_support_messages search_message
        WHERE search_message.tenant_id = s.tenant_id
          AND search_message.session_id = s.session_id
          AND search_message.created_at >= $4::timestamptz
          AND LOWER(COALESCE(search_message.customer_message, search_message.staff_message, search_message.message_text, search_message.ai_answer, '')) LIKE $5::text
      )
    )` : ""}
`;

const ensureInboxDependencies = async () => {
  await ensureAiChannelAdapterSchema();
  await ensureAiSupportLogSchema();
};

export const listMetaReviewerConversations = async ({ search = "", limit = 50, scope = loadMetaReviewerScope() } = {}) => {
  if (!scope.enabled) return { conversations: [], counts: { total: 0, unread: 0 } };
  await ensureInboxDependencies();
  const safeLimit = Math.min(100, Math.max(1, int(limit, 50)));
  const searchValue = text(search).toLowerCase();
  const params = [scope.tenantId, scope.pageId, scope.allowedPsids, scope.visibleMessagesAfter, searchValue ? `%${searchValue}%` : "", safeLimit];
  const result = await db.query(
    `${scopedConversationSql({ includeSearch: true })}
     ORDER BY visible_message.created_at DESC NULLS LAST, s.session_id ASC
     LIMIT $6::int`,
    params
  );
  const conversations = result.rows.map((row) => ({
    id: metaReviewerConversationRef(row.session_id, scope),
    channel: "messenger",
    customer_name: text(row.customer_name || "Meta test account"),
    customer_avatar_url: text(row.customer_avatar_url),
    latest_message_preview: text(row.last_message),
    last_message_at: row.last_message_at || null,
    unread_count: Math.max(0, int(row.unread_count, 0)),
  }));
  return {
    conversations,
    counts: {
      total: conversations.length,
      unread: conversations.reduce((sum, item) => sum + item.unread_count, 0),
    },
  };
};

export const resolveMetaReviewerConversation = async ({ conversationRef, scope = loadMetaReviewerScope() } = {}) => {
  if (!scope.enabled) return null;
  await ensureInboxDependencies();
  const result = await db.query(scopedConversationSql(), [scope.tenantId, scope.pageId, scope.allowedPsids, scope.visibleMessagesAfter]);
  const row = result.rows.find((candidate) => metaReviewerConversationRefMatches(conversationRef, candidate.session_id, scope));
  if (!row) return null;
  const identity = extractMetaReviewerIdentity(row);
  if (!metaReviewerConversationAllowed({ tenantId: scope.tenantId, channel: row.channel, ...identity }, scope)) return null;
  return { ...row, pageId: identity.pageId, psid: identity.psid };
};

export const loadMetaReviewerMessages = async ({ conversationRef, limit = 50, scope = loadMetaReviewerScope() } = {}) => {
  const conversation = await resolveMetaReviewerConversation({ conversationRef, scope });
  if (!conversation) return null;
  const safeLimit = Math.min(100, Math.max(1, int(limit, 50)));
  const result = await db.query(
    `SELECT *
     FROM ai_support_messages
     WHERE tenant_id = $1::bigint
       AND session_id = $2::text
       AND created_at >= $3::timestamptz
     ORDER BY created_at DESC, id DESC
     LIMIT $4::int`,
    [scope.tenantId, conversation.session_id, scope.visibleMessagesAfter, safeLimit]
  );
  return {
    conversation: {
      id: conversationRef,
      channel: "messenger",
      customer_name: text(conversation.customer_name || "Meta test account"),
      customer_avatar_url: text(conversation.customer_avatar_url),
    },
    messages: filterMetaReviewerVisibleMessages(result.rows.reverse(), scope).map(sanitizeMetaReviewerMessage),
  };
};

export const sendMetaReviewerMessage = async ({ conversationRef, message, actorUserId, scope = loadMetaReviewerScope() } = {}) => {
  const safeMessage = text(message);
  if (!safeMessage || safeMessage.length > 2000) {
    throw Object.assign(new Error("A message between 1 and 2000 characters is required."), { status: 400 });
  }
  const conversation = await resolveMetaReviewerConversation({ conversationRef, scope });
  if (!conversation) {
    throw Object.assign(new Error("Conversation is outside the Meta review scope."), { status: 403, code: "META_REVIEW_SCOPE_FORBIDDEN" });
  }
  const sendResult = await sendMetaInboxOutboundMessage({
    tenantId: scope.tenantId,
    channel: "facebook_messenger",
    recipientId: conversation.psid,
    messageText: safeMessage,
    conversationId: conversationRef,
    facebookPageId: conversation.pageId,
    replyOwner: "meta_reviewer",
    replySource: "meta_reviewer_manual_reply",
    orchestratorUsed: false,
  });
  const deliveryStatus = sendResult?.delivery_status || (sendResult?.sent ? "sent" : "failed");
  const stored = await appendManualAiSupportReply({
    tenantId: scope.tenantId,
    sessionId: conversation.session_id,
    clientRequestId: randomUUID(),
    message: safeMessage,
    staffUserId: actorUserId || null,
    staffUserName: "Meta Reviewer",
    source: "facebook_messenger",
    channel: "facebook_messenger",
    deliveryStatus,
    deliveryError: deliveryStatus === "failed" ? "Message delivery failed" : "",
    externalMessageId: sendResult?.message_id || "",
    providerMessageId: sendResult?.message_id || "",
    redactSessionInLogs: true,
  });
  const safeStored = sanitizeMetaReviewerMessage(stored);
  emitToRooms([metaReviewerRealtimeRoom(scope)], "meta_reviewer:message", {
    conversation_id: conversationRef,
    message: safeStored,
    at: new Date().toISOString(),
  });
  return { sent: deliveryStatus === "sent", delivery_status: deliveryStatus, message: safeStored };
};
