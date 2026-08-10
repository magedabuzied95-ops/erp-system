import { randomUUID } from "node:crypto";

import db from "../database/db.js";
import { emitToRooms } from "../utils/socket.js";
import { ensureAiChannelAdapterSchema } from "./aiChannelAdapterService.js";
import { ensureAiSupportLogSchema, appendManualAiSupportReply } from "./aiSupportLogService.js";
import { sendMetaInboxOutboundMessage } from "./metaIntegrationService.js";
import {
  extractMetaReviewerIdentity,
  filterMetaReviewerVisibleMessages,
  getMetaReviewerChannelScope,
  loadMetaReviewerScope,
  metaReviewerConversationAllowed,
  metaReviewerConversationRef,
  metaReviewerConversationRefMatches,
  metaReviewerRealtimeRoom,
  normalizeMetaReviewerChannel,
  sanitizeMetaReviewerMessage,
} from "./metaReviewerAccessService.js";

const text = (value = "") => String(value ?? "").trim();
const int = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const CHANNEL_SQL = {
  messenger: {
    aliases: "'facebook', 'facebook_messenger', 'messenger'",
    asset: `COALESCE(NULLIF(c.metadata->>'page_id', ''), NULLIF(c.metadata->>'facebook_page_id', ''), NULLIF(c.metadata->>'resolved_page_id', ''), NULLIF(c.metadata->>'recipient_page_id', ''), NULLIF(c.metadata#>>'{raw_payload,page_id}', ''), NULLIF(c.metadata#>>'{raw_payload,value,page_id}', ''))`,
    outbound: "facebook_messenger",
  },
  instagram: {
    aliases: "'instagram', 'instagram_dm'",
    asset: `COALESCE(NULLIF(c.metadata->>'instagram_business_account_id', ''), NULLIF(c.metadata->>'resolved_instagram_business_account_id', ''))`,
    outbound: "instagram",
  },
};

const SENDER_MATCH_SQL = `ARRAY_REMOVE(ARRAY[
  NULLIF(c.external_customer_id, ''),
  NULLIF(c.metadata->>'customer_psid', ''),
  NULLIF(c.metadata->>'sender_psid', ''),
  NULLIF(c.metadata->>'resolved_customer_id', ''),
  NULLIF(c.metadata->>'resolved_sender_id', '')
], NULL) && $3::text[]`;

export const metaReviewerUsesRawSenderSqlFilter = (config = {}) =>
  Array.isArray(config.allowedSenderIds)
  && config.allowedSenderIds.length > 0
  && (!Array.isArray(config.allowedSenderHmacs) || config.allowedSenderHmacs.length === 0);

const scopedConversationSql = (channel, { includeSearch = false, useRawSenderSqlFilter = true } = {}) => {
  const config = CHANNEL_SQL[channel];
  if (!config) throw Object.assign(new Error("Review channel is forbidden."), { status: 403 });
  return `
    SELECT
      s.session_id,
      COALESCE(NULLIF(c.customer_name, ''), NULLIF(s.customer_name, ''), 'Meta test account') AS customer_name,
      COALESCE(NULLIF(c.customer_avatar_url, ''), NULLIF(s.customer_avatar_url, ''), '') AS customer_avatar_url,
      COALESCE(NULLIF(visible_message.customer_message, ''), NULLIF(visible_message.staff_message, ''), NULLIF(visible_message.message_text, ''), NULLIF(visible_message.ai_answer, ''), NULLIF(visible_message.last_message, ''), '') AS last_message,
      visible_message.created_at AS last_message_at,
      COALESCE(c.read_at, s.read_at) AS read_at,
      c.channel,
      c.external_customer_id,
      c.external_conversation_id,
      c.metadata AS channel_metadata,
      ${config.asset} AS resolved_asset_id,
      (SELECT COUNT(*)::int FROM ai_support_messages unread_message
       WHERE unread_message.tenant_id = s.tenant_id
         AND unread_message.session_id = s.session_id
         AND unread_message.sender_type = 'customer'
         AND unread_message.created_at >= $4::timestamptz
         AND unread_message.created_at > COALESCE(c.read_at, s.read_at, TIMESTAMP 'epoch')) AS unread_count
    FROM ai_support_sessions s
    JOIN LATERAL (
      SELECT channel_conversation.* FROM ai_channel_conversations channel_conversation
      WHERE channel_conversation.tenant_id = s.tenant_id
        AND channel_conversation.external_conversation_id = s.session_id
        AND LOWER(channel_conversation.channel) IN (${config.aliases})
      ORDER BY channel_conversation.updated_at DESC, channel_conversation.id DESC LIMIT 1
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT candidate_message.* FROM ai_support_messages candidate_message
      WHERE candidate_message.tenant_id = s.tenant_id
        AND candidate_message.session_id = s.session_id
        AND candidate_message.created_at >= $4::timestamptz
      ORDER BY candidate_message.created_at DESC, candidate_message.id DESC LIMIT 1
    ) visible_message ON TRUE
    WHERE s.tenant_id = $1::bigint
      AND ${config.asset} = $2::text
      AND ${useRawSenderSqlFilter ? SENDER_MATCH_SQL : "$3::text[] IS NOT NULL"}
      AND LOWER(COALESCE(s.thread_kind, c.thread_kind, 'dm')) <> 'comment'
      ${includeSearch ? `AND ($5::text = '' OR LOWER(COALESCE(c.customer_name, s.customer_name, '')) LIKE $5::text OR EXISTS (
        SELECT 1 FROM ai_support_messages search_message
        WHERE search_message.tenant_id = s.tenant_id
          AND search_message.session_id = s.session_id
          AND search_message.created_at >= $4::timestamptz
          AND LOWER(COALESCE(search_message.customer_message, search_message.staff_message, search_message.message_text, search_message.ai_answer, '')) LIKE $5::text
      ))` : ""}
  `;
};

const metaReviewerIdentityFromRow = (row = {}, channel = "") => extractMetaReviewerIdentity({
  ...row,
  ...(channel === "instagram"
    ? { instagram_business_account_id: row.resolved_asset_id }
    : { page_id: row.resolved_asset_id }),
}, channel);

const authorizedConversationRows = (rows = [], scope, channel) => (Array.isArray(rows) ? rows : []).filter((row) => {
  const identity = metaReviewerIdentityFromRow(row, channel);
  return metaReviewerConversationAllowed({ tenantId: scope.tenantId, channel, ...identity }, scope);
});

const ensureInboxDependencies = async () => {
  await ensureAiChannelAdapterSchema();
  await ensureAiSupportLogSchema();
};

const channelContext = (scope, channel) => {
  const normalized = normalizeMetaReviewerChannel(channel);
  const config = getMetaReviewerChannelScope(scope, normalized);
  if (!CHANNEL_SQL[normalized]) throw Object.assign(new Error("Review channel is forbidden."), { status: 403 });
  return { normalized, config };
};

export const listMetaReviewerConversations = async ({ channel, search = "", limit = 50, scope = loadMetaReviewerScope() } = {}) => {
  const { normalized, config } = channelContext(scope, channel);
  if (!scope.enabled || !config?.enabled) return { enabled: false, channel: normalized, conversations: [], counts: { total: 0, unread: 0 } };
  await ensureInboxDependencies();
  const safeLimit = Math.min(100, Math.max(1, int(limit, 50)));
  const searchValue = text(search).toLowerCase();
  const params = [scope.tenantId, config.assetId, config.allowedSenderIds, config.visibleMessagesAfter, searchValue ? `%${searchValue}%` : "", safeLimit];
  const useRawSenderSqlFilter = metaReviewerUsesRawSenderSqlFilter(config);
  const limitSql = useRawSenderSqlFilter ? " LIMIT $6::int" : "";
  const result = await db.query(`${scopedConversationSql(normalized, { includeSearch: true, useRawSenderSqlFilter })} ORDER BY visible_message.created_at DESC NULLS LAST, s.session_id ASC${limitSql}`, params);
  const authorizedRows = authorizedConversationRows(result.rows, scope, normalized).slice(0, safeLimit);
  const conversations = authorizedRows.map((row) => ({
    id: metaReviewerConversationRef(row.session_id, scope, normalized),
    channel: normalized,
    customer_name: text(row.customer_name || "Meta test account"),
    customer_avatar_url: text(row.customer_avatar_url),
    latest_message_preview: text(row.last_message),
    last_message_at: row.last_message_at || null,
    unread_count: Math.max(0, int(row.unread_count, 0)),
  }));
  return { enabled: true, channel: normalized, conversations, counts: { total: conversations.length, unread: conversations.reduce((sum, item) => sum + item.unread_count, 0) } };
};

export const resolveMetaReviewerConversation = async ({ channel, conversationRef, scope = loadMetaReviewerScope() } = {}) => {
  const { normalized, config } = channelContext(scope, channel);
  if (!scope.enabled || !config?.enabled) return null;
  await ensureInboxDependencies();
  const useRawSenderSqlFilter = metaReviewerUsesRawSenderSqlFilter(config);
  const result = await db.query(scopedConversationSql(normalized, { useRawSenderSqlFilter }), [scope.tenantId, config.assetId, config.allowedSenderIds, config.visibleMessagesAfter]);
  const row = authorizedConversationRows(result.rows, scope, normalized)
    .find((candidate) => metaReviewerConversationRefMatches(conversationRef, candidate.session_id, scope, normalized));
  if (!row) return null;
  const identity = metaReviewerIdentityFromRow(row, normalized);
  if (!metaReviewerConversationAllowed({ tenantId: scope.tenantId, channel: normalized, ...identity }, scope)) return null;
  return { ...row, ...identity, normalizedChannel: normalized };
};

export const loadMetaReviewerMessages = async ({ channel, conversationRef, limit = 50, scope = loadMetaReviewerScope() } = {}) => {
  const conversation = await resolveMetaReviewerConversation({ channel, conversationRef, scope });
  if (!conversation) return null;
  const config = getMetaReviewerChannelScope(scope, conversation.normalizedChannel);
  const safeLimit = Math.min(100, Math.max(1, int(limit, 50)));
  const result = await db.query(`SELECT * FROM ai_support_messages WHERE tenant_id = $1::bigint AND session_id = $2::text AND created_at >= $3::timestamptz ORDER BY created_at DESC, id DESC LIMIT $4::int`, [scope.tenantId, conversation.session_id, config.visibleMessagesAfter, safeLimit]);
  return {
    conversation: { id: conversationRef, channel: conversation.normalizedChannel, customer_name: text(conversation.customer_name || "Meta test account"), customer_avatar_url: text(conversation.customer_avatar_url) },
    messages: filterMetaReviewerVisibleMessages(result.rows.reverse(), scope, conversation.normalizedChannel).map(sanitizeMetaReviewerMessage),
  };
};

export const sendMetaReviewerMessage = async ({ channel, conversationRef, message, actorUserId, scope = loadMetaReviewerScope() } = {}) => {
  const safeMessage = text(message);
  if (!safeMessage || safeMessage.length > 2000) throw Object.assign(new Error("A message between 1 and 2000 characters is required."), { status: 400 });
  const conversation = await resolveMetaReviewerConversation({ channel, conversationRef, scope });
  if (!conversation) throw Object.assign(new Error("Conversation is outside the Meta review scope."), { status: 403 });
  const normalized = conversation.normalizedChannel;
  const channelConfig = getMetaReviewerChannelScope(scope, normalized);
  if (!metaReviewerConversationAllowed({ tenantId: scope.tenantId, channel: normalized, assetId: conversation.assetId, senderScopedId: conversation.senderScopedId }, scope)) {
    throw Object.assign(new Error("Conversation is outside the Meta review scope."), { status: 403 });
  }
  const sendResult = await sendMetaInboxOutboundMessage({
    tenantId: scope.tenantId,
    channel: CHANNEL_SQL[normalized].outbound,
    recipientId: conversation.senderScopedId,
    messageText: safeMessage,
    conversationId: conversationRef,
    facebookPageId: normalized === "messenger" ? channelConfig.assetId : "",
    instagramBusinessAccountId: normalized === "instagram" ? channelConfig.assetId : "",
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
    source: CHANNEL_SQL[normalized].outbound,
    channel: CHANNEL_SQL[normalized].outbound,
    deliveryStatus,
    deliveryError: deliveryStatus === "failed" ? "Message delivery failed" : "",
    externalMessageId: sendResult?.message_id || "",
    providerMessageId: sendResult?.message_id || "",
    redactSessionInLogs: true,
  });
  const safeStored = sanitizeMetaReviewerMessage(stored);
  emitToRooms([metaReviewerRealtimeRoom(scope, normalized)], "meta_reviewer:message", { channel: normalized, conversation_id: conversationRef, message: safeStored, at: new Date().toISOString() });
  return { sent: deliveryStatus === "sent", delivery_status: deliveryStatus, message: safeStored };
};
