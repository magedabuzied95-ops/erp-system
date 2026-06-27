import db from "../database/db.js";
import { loadAiInbox } from "./aiSalesAgentService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();

const CONVERSATION_PREFIX_ALIASES = new Map([
  ["facebook_messenger", "facebook_messenger"],
  ["facebook", "facebook_messenger"],
  ["messenger", "facebook_messenger"],
  ["instagram", "instagram"],
  ["whatsapp", "whatsapp"],
  ["web_chat", "web_chat"],
  ["web", "web_chat"],
]);

const normalizeConversationPrefix = (value = "") => CONVERSATION_PREFIX_ALIASES.get(lower(value)) || "";

const stripConversationPrefixes = (value = "") => {
  let current = text(value);
  let prefix = "";

  while (current) {
    const match = current.match(/^([a-z0-9_]+):(.*)$/i);
    if (!match) break;
    const nextPrefix = normalizeConversationPrefix(match[1]);
    if (!nextPrefix) break;
    prefix = prefix || nextPrefix;
    current = text(match[2]);
  }

  return { prefix, value: current };
};

const normalizeConversationLookupId = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  const stripped = stripConversationPrefixes(raw);
  const prefix = stripped.prefix;
  const base = stripped.value || raw;
  if (!base) return raw;
  return prefix ? `${prefix}:${base}` : base;
};

export const LEAD_STATUSES = Object.freeze(["new", "contacted", "interested", "negotiation", "won", "lost"]);

export const normalizeLeadStatus = (value = "") => {
  const key = lower(value);
  return LEAD_STATUSES.includes(key) ? key : "new";
};

export const isAllowedLeadStatus = (value = "") => LEAD_STATUSES.includes(lower(value));

export const LEAD_SOURCE_LABELS = {
  facebook_comment: "Facebook Comment",
  instagram_comment: "Instagram Comment",
  messenger: "Messenger",
};

export const resolveLeadSourceKey = (conversation = {}) => {
  const channel = lower(conversation.channel || conversation.source || conversation.channel_metadata?.channel || "");
  const threadKind = lower(conversation.thread_kind || conversation.channel_metadata?.thread_kind || "");
  const hasCommentId = Boolean(
    text(conversation.external_comment_id || conversation.comment_id || conversation.channel_metadata?.comment_id || conversation.channel_metadata?.lead?.comment_id)
  );

  if (channel.includes("instagram") && (channel.includes("comment") || threadKind === "comment" || hasCommentId)) {
    return "instagram_comment";
  }
  if ((channel.includes("facebook") || channel.includes("messenger")) && (channel.includes("comment") || threadKind === "comment" || hasCommentId)) {
    return "facebook_comment";
  }
  if (channel.includes("instagram")) return "messenger";
  if (channel.includes("facebook") || channel.includes("messenger")) return "messenger";
  return threadKind === "comment" || hasCommentId ? "facebook_comment" : "messenger";
};

export const resolveLeadSourceLabel = (conversation = {}) => LEAD_SOURCE_LABELS[resolveLeadSourceKey(conversation)] || "Messenger";

export const buildLeadOpportunityPayload = ({ conversation = {}, profile = {} } = {}) => {
  const sourceKey = resolveLeadSourceKey(conversation);
  const sourceLabel = LEAD_SOURCE_LABELS[sourceKey] || "Messenger";
  const customerName = text(
    profile.name ||
      profile.first_name ||
      conversation.customer_profile?.name ||
      conversation.customer_profile?.first_name ||
      conversation.customer_name ||
      conversation.sender_name ||
      conversation.channel_metadata?.messenger_profile?.name ||
      conversation.external_customer_id ||
      "Lead"
  );
  const summary = text(
    profile.conversation_summary ||
      conversation.customer_profile?.conversation_summary ||
      conversation.latest_message_preview ||
      conversation.last_message ||
      ""
  );
  return {
    source_key: sourceKey,
    source_label: sourceLabel,
    title: `${sourceLabel} Lead`,
    notes: summary,
    metadata: {
      source_key: sourceKey,
      source_label: sourceLabel,
      conversation_id: normalizeConversationLookupId(conversation.session_id || conversation.external_conversation_id || ""),
      external_customer_id: conversation.external_customer_id || conversation.customer_profile?.external_customer_id || "",
      customer_name: customerName,
      customer_phone: conversation.phone || conversation.customer_profile?.phone || "",
      platform: text(conversation.channel || conversation.source || conversation.channel_metadata?.platform || ""),
      source_post_id:
        conversation.channel_metadata?.post_id ||
        conversation.post_id ||
        conversation.metadata?.post_id ||
        "",
      source_comment_id:
        conversation.channel_metadata?.comment_id ||
        conversation.comment_id ||
        conversation.metadata?.comment_id ||
        "",
      comment_id:
        conversation.external_comment_id ||
        conversation.comment_id ||
        conversation.channel_metadata?.comment_id ||
        conversation.channel_metadata?.lead?.comment_id ||
        "",
      product_id: conversation.channel_metadata?.product_id || conversation.product_id || "",
      product_name: conversation.channel_metadata?.product_name || conversation.product_name || "",
      product_price: conversation.channel_metadata?.product_price || conversation.product_price || "",
      product_sale_price: conversation.channel_metadata?.product_sale_price || conversation.product_sale_price || "",
      product_url: conversation.channel_metadata?.product_url || conversation.product_url || "",
      website_product_link: conversation.channel_metadata?.website_product_link || conversation.website_product_link || conversation.product_url || "",
      lead_status: conversation.channel_metadata?.lead_status || conversation.lead_status || "new_lead",
    },
  };
};

export const ensureAiInboxLeadActionsSchema = async (clientOrPool = db) => {
  const client = clientOrPool || db;
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_lead_opportunities (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      profile_id BIGINT NOT NULL REFERENCES ai_customer_profiles(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL DEFAULT '',
      source_key TEXT NOT NULL DEFAULT '',
      source_label TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS profile_id BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS conversation_id TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS source_key TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS source_label TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'`);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS ai_lead_opportunities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_lead_opportunities_scope
    ON ai_lead_opportunities (tenant_id, profile_id, conversation_id, source_key)
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_lead_opportunities_tenant_status ON ai_lead_opportunities (tenant_id, status, created_at DESC)`);
};

export const loadLeadConversationForAction = async ({ tenantId, conversationId } = {}) => {
  const inbox = await loadAiInbox({ tenantId, filter: "all", limit: 1000 });
  const normalizedConversationId = normalizeConversationLookupId(conversationId);
  const rawConversationId = stripConversationPrefixes(normalizedConversationId).value || text(conversationId);
  return (inbox.conversations || []).find((item) => {
    const itemSessionId = normalizeConversationLookupId(item.session_id || item.external_conversation_id || item.conversation_key || "");
    const itemRawSessionId = stripConversationPrefixes(itemSessionId).value || text(item.session_id || item.external_conversation_id || item.conversation_key || "");
    return (
      itemSessionId === normalizedConversationId ||
      itemSessionId === rawConversationId ||
      itemRawSessionId === normalizedConversationId ||
      itemRawSessionId === rawConversationId ||
      normalizeConversationLookupId(item.conversation_key || "") === normalizedConversationId ||
      text(item.external_customer_id) === normalizedConversationId ||
      text(item.external_customer_id) === rawConversationId
    );
  }) || null;
};

export const resolveLeadConversationStatus = (conversation = {}) => normalizeLeadStatus(
  conversation.lead_status ||
    conversation.channel_metadata?.lead_status ||
    conversation.metadata?.lead_status ||
    ""
);

export const createOrUpdateLeadOpportunity = async ({ tenantId, conversation = {}, profile = null, clientOrPool = db } = {}) => {
  await ensureAiInboxLeadActionsSchema(clientOrPool);
  const client = clientOrPool || db;
  const payload = buildLeadOpportunityPayload({ conversation, profile: profile || conversation.customer_profile || {} });
  const conversationId = normalizeConversationLookupId(conversation.session_id || conversation.external_conversation_id || "");
  const result = await client.query(
    `
    INSERT INTO ai_lead_opportunities (
      tenant_id, profile_id, conversation_id, source_key, source_label, title, status, notes, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8::jsonb)
    ON CONFLICT (tenant_id, profile_id, conversation_id, source_key) DO UPDATE SET
      source_label = EXCLUDED.source_label,
      title = EXCLUDED.title,
      status = CASE WHEN ai_lead_opportunities.status = 'closed' THEN ai_lead_opportunities.status ELSE EXCLUDED.status END,
      notes = EXCLUDED.notes,
      metadata = ai_lead_opportunities.metadata || EXCLUDED.metadata,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      tenantId,
      profile?.id || conversation.customer_profile?.id || null,
      conversationId,
      payload.source_key,
      payload.source_label,
      payload.title,
      payload.notes,
      JSON.stringify(payload.metadata),
    ]
  );
  return result.rows[0] || null;
};

export const syncLeadAssignmentMetadata = async ({
  tenantId,
  conversation = {},
  assignedEmployeeId = null,
  assignedEmployeeName = "",
  actorUserId = null,
  clientOrPool = db,
} = {}) => {
  const channel = text(conversation.channel || conversation.source || "");
  const externalConversationId = normalizeConversationLookupId(conversation.session_id || conversation.external_conversation_id || "");
  if (!tenantId || !channel || !externalConversationId) return null;
  const customerProfileId = conversation.customer_profile?.id || conversation.profile_id || null;
  const metadata = {
    ...(conversation.channel_metadata || {}),
    assignment: {
      assigned_employee_id: assignedEmployeeId || null,
      assigned_employee_name: assignedEmployeeName || "",
      assigned_by_user_id: actorUserId || null,
      assigned_at: new Date().toISOString(),
    },
    assigned_employee_id: assignedEmployeeId || null,
    assigned_employee_name: assignedEmployeeName || "",
    assigned_by_user_id: actorUserId || null,
  };
  const result = await clientOrPool.query(
    `
    INSERT INTO ai_channel_conversations (
      tenant_id,
      channel,
      external_conversation_id,
      external_customer_id,
      customer_name,
      customer_avatar_url,
      customer_profile_id,
      metadata,
      last_message,
      last_message_at,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::timestamp,NOW())
    ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_channel_conversations.external_customer_id),
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_channel_conversations.customer_name),
      customer_avatar_url = COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_channel_conversations.customer_avatar_url),
      customer_profile_id = COALESCE(EXCLUDED.customer_profile_id, ai_channel_conversations.customer_profile_id),
      metadata = ai_channel_conversations.metadata || EXCLUDED.metadata,
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_channel_conversations.last_message),
      last_message_at = COALESCE(EXCLUDED.last_message_at, ai_channel_conversations.last_message_at),
      updated_at = NOW()
    RETURNING *
    `,
    [
      tenantId,
      channel,
      externalConversationId,
      text(conversation.external_customer_id || conversation.customer_profile?.external_customer_id || ""),
      text(conversation.customer_name || conversation.customer_profile?.name || ""),
      text(conversation.customer_avatar_url || conversation.customer_profile?.avatar_url || ""),
      customerProfileId,
      JSON.stringify(metadata),
      text(conversation.latest_message_preview || conversation.last_message || ""),
      new Date().toISOString(),
    ]
  );
  return result.rows[0] || null;
};
