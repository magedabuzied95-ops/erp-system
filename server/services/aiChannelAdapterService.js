import crypto from "crypto";

import db from "../database/db.js";
import { resolveAIStatus } from "./aiStatusResolver.js";
import {
  normalizeProductCards as normalizeStructuredProductCards,
  productCardReplyText,
} from "./aiProductCards.js";

const toText = (value = "", fallback = "") => String(value ?? fallback).trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const json = (value) => JSON.stringify(value === undefined ? null : value);
const dedupeHash = (value = "") => crypto.createHash("sha256").update(toText(value)).digest("hex");

export const AI_AGENT_CHANNELS = Object.freeze({
  WEB_CHAT: "web_chat",
  WHATSAPP: "whatsapp",
  INSTAGRAM: "instagram",
  FACEBOOK_MESSENGER: "facebook_messenger",
});

const supportedChannels = new Set(Object.values(AI_AGENT_CHANNELS));

const normalizeChannel = (value = AI_AGENT_CHANNELS.WEB_CHAT) => {
  const channel = toText(value || AI_AGENT_CHANNELS.WEB_CHAT).toLowerCase();
  return supportedChannels.has(channel) ? channel : AI_AGENT_CHANNELS.WEB_CHAT;
};

const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

let channelSchemaReadyPromise = null;

export const ensureAiChannelAdapterSchema = async (clientOrPool = db) => {
  if (!channelSchemaReadyPromise) {
    channelSchemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_channel_conversations (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          channel TEXT NOT NULL,
          external_conversation_id TEXT NOT NULL,
          external_customer_id TEXT NOT NULL DEFAULT '',
          customer_name TEXT NOT NULL DEFAULT '',
          customer_avatar_url TEXT NOT NULL DEFAULT '',
          last_message TEXT NOT NULL DEFAULT '',
          customer_profile_id BIGINT NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_message_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, channel, external_conversation_id)
        )
      `);
      await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS customer_avatar_url TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_channel_conversations ADD COLUMN IF NOT EXISTS last_message TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_channel_conversations_customer ON ai_channel_conversations (tenant_id, channel, external_customer_id)`);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_channel_settings (
          tenant_id BIGINT NOT NULL,
          channel TEXT NOT NULL,
          settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (tenant_id, channel)
        )
      `);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS ai_channel_event_logs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          channel TEXT NOT NULL,
          direction TEXT NOT NULL,
          external_customer_id TEXT NOT NULL DEFAULT '',
          conversation_id TEXT NOT NULL DEFAULT '',
          message_preview TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          error TEXT NOT NULL DEFAULT '',
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_ai_channel_event_logs_tenant_channel_created ON ai_channel_event_logs (tenant_id, channel, created_at DESC)`);
      await clientOrPool.query(`ALTER TABLE ai_channel_event_logs ADD COLUMN IF NOT EXISTS external_message_id TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE ai_channel_event_logs ADD COLUMN IF NOT EXISTS dedupe_key TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`
        DELETE FROM ai_channel_event_logs newer
        USING ai_channel_event_logs older
        WHERE newer.id > older.id
          AND newer.tenant_id = older.tenant_id
          AND newer.channel = older.channel
          AND newer.direction = older.direction
          AND COALESCE(NULLIF(newer.dedupe_key, ''), NULLIF(newer.external_message_id, '')) <> ''
          AND COALESCE(NULLIF(newer.dedupe_key, ''), NULLIF(newer.external_message_id, '')) =
              COALESCE(NULLIF(older.dedupe_key, ''), NULLIF(older.external_message_id, ''))
      `);
      await clientOrPool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_channel_event_logs_dedupe
        ON ai_channel_event_logs (tenant_id, channel, direction, dedupe_key)
        WHERE dedupe_key <> ''
      `);
    })().catch((error) => {
      channelSchemaReadyPromise = null;
      throw error;
    });
  }
  return channelSchemaReadyPromise;
};

export const logChannelEvent = async ({
  tenantId,
  channel,
  direction,
  externalCustomerId = "",
  conversationId = "",
  messagePreview = "",
  status = "",
  error = "",
  metadata = {},
} = {}) => {
  await ensureAiChannelAdapterSchema();
  const externalMessageId = toText(metadata?.external_message_id || metadata?.message_id || metadata?.mid || metadata?.meta_message_id);
  const eventDedupeKey = toText(metadata?.dedupe_key) || (externalMessageId ? dedupeHash([tenantId, channel, direction, externalMessageId].join("|")) : "");
  const result = await db.query(
    `
    INSERT INTO ai_channel_event_logs (
      tenant_id, channel, direction, external_customer_id, conversation_id, message_preview, status, error, metadata, external_message_id, dedupe_key
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
    ON CONFLICT (tenant_id, channel, direction, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
    RETURNING *
    `,
    [
      numberOrNull(tenantId),
      normalizeChannel(channel),
      toText(direction),
      toText(externalCustomerId),
      toText(conversationId),
      toText(messagePreview).slice(0, 500),
      toText(status),
      toText(error).slice(0, 1000),
      json(metadata || {}),
      externalMessageId,
      eventDedupeKey,
    ]
  );
  return result.rows[0] || null;
};

export const listChannelEvents = async ({ tenantId, channel = AI_AGENT_CHANNELS.WHATSAPP, limit = 30 } = {}) => {
  await ensureAiChannelAdapterSchema();
  const result = await db.query(
    `
    SELECT id, channel, direction, external_customer_id, conversation_id, message_preview, status, error, metadata, created_at
    FROM ai_channel_event_logs
    WHERE tenant_id = $1 AND channel = $2
    ORDER BY created_at DESC, id DESC
    LIMIT $3
    `,
    [numberOrNull(tenantId), normalizeChannel(channel), Math.min(100, Math.max(1, Number(limit) || 30))]
  );
  return result.rows;
};

export const getChannelSettings = async ({ tenantId, channel = AI_AGENT_CHANNELS.WHATSAPP } = {}) => {
  await ensureAiChannelAdapterSchema();
  const safeTenantId = numberOrNull(tenantId);
  const normalizedChannel = normalizeChannel(channel);
  const result = await db.query(
    `SELECT settings FROM ai_channel_settings WHERE tenant_id = $1 AND channel = $2`,
    [safeTenantId, normalizedChannel]
  );
  if (result.rows[0]?.settings) {
    return { ...result.rows[0].settings, settings_found: true };
  }
  if (!safeTenantId) return { settings_found: false };
  const defaults = {
    ai_replies_enabled: true,
    auto_reply_mode: "suggest_only",
    settings_found: true,
    auto_created: true,
  };
  const inserted = await db.query(
    `
    INSERT INTO ai_channel_settings (tenant_id, channel, settings, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW())
    ON CONFLICT (tenant_id, channel) DO UPDATE SET settings = ai_channel_settings.settings, updated_at = ai_channel_settings.updated_at
    RETURNING settings
    `,
    [safeTenantId, normalizedChannel, json(defaults)]
  );
  return { ...(inserted.rows[0]?.settings || defaults), settings_found: true, auto_created: true };
};

export const updateChannelSettings = async ({ tenantId, channel = AI_AGENT_CHANNELS.WHATSAPP, settings = {} } = {}) => {
  await ensureAiChannelAdapterSchema();
  const current = await getChannelSettings({ tenantId, channel });
  const requestedMode = toText(settings.auto_reply_mode || settings.mode || current.auto_reply_mode || "");
  const autoReplyMode = ["off", "suggest_only", "auto_reply_after_approval", "fully_automatic"].includes(requestedMode)
    ? requestedMode
    : settings.ai_replies_enabled === true
      ? "fully_automatic"
      : current.auto_reply_mode || "suggest_only";
  const next = {
    ...current,
    ...(settings || {}),
    auto_reply_mode: autoReplyMode,
    ai_replies_enabled: settings.ai_replies_enabled === true || autoReplyMode !== "off",
  };
  const result = await db.query(
    `
    INSERT INTO ai_channel_settings (tenant_id, channel, settings, updated_at)
    VALUES ($1, $2, $3::jsonb, NOW())
    ON CONFLICT (tenant_id, channel) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
    RETURNING settings
    `,
    [numberOrNull(tenantId), normalizeChannel(channel), json(next)]
  );
  return result.rows[0]?.settings || next;
};

const normalizeAttachments = (attachments = []) =>
  asArray(attachments)
    .map((attachment) => ({
      type: toText(attachment?.type || attachment?.mime_type || attachment?.mimeType || "file"),
      url: toText(attachment?.url || attachment?.image_url || attachment?.media_url || attachment?.path),
      title: toText(attachment?.title || attachment?.name || attachment?.filename),
      metadata: attachment?.metadata && typeof attachment.metadata === "object" ? attachment.metadata : {},
    }))
    .filter((attachment) => attachment.url || attachment.title);

const normalizeQuickReplies = (response = {}) => {
  const funnelReplies = asArray(response.quick_funnel?.options).map((option) => option?.label || option?.text || option);
  return [...new Set([...asArray(response.suggested_quick_replies), ...asArray(response.suggested_actions), ...funnelReplies].map(toText).filter(Boolean))];
};

const normalizeBaseIncomingMessage = ({
  tenantId,
  channel,
  externalConversationId,
  externalCustomerId,
  customerName,
  messageText,
  attachments,
  timestamp,
  raw = {},
  externalMessageId = "",
  replyToMessageId = "",
  dedupeKey = "",
} = {}) => ({
  tenant_id: numberOrNull(tenantId),
  channel: normalizeChannel(channel),
  external_conversation_id: toText(externalConversationId),
  external_customer_id: toText(externalCustomerId),
  customer_name: toText(customerName),
  message_text: toText(messageText),
  attachments: normalizeAttachments(attachments),
  timestamp: timestamp || new Date().toISOString(),
  external_message_id: toText(externalMessageId),
  reply_to_message_id: toText(replyToMessageId),
  dedupe_key: toText(dedupeKey || externalMessageId) || dedupeHash([channel, externalConversationId, externalCustomerId, messageText, timestamp].map(toText).join("|")),
  raw,
});

export const normalizeWebChatIncomingMessage = ({ tenantId, body = {}, headers = {} } = {}) => {
  const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};
  return normalizeBaseIncomingMessage({
    tenantId: tenantId ?? body.tenant_id ?? body.tenantId ?? headers["x-tenant-id"],
    channel: AI_AGENT_CHANNELS.WEB_CHAT,
    externalConversationId: metadata.session_id || body.session_id || headers["x-session-id"],
    externalCustomerId: metadata.customer_id || metadata.customer_phone || body.customer_id || body.customerId,
    customerName: metadata.customer_name || metadata.name || body.customer_name || body.customerName,
    messageText: body.message || body.message_text || body.text,
    attachments: body.attachments || metadata.attachments || [],
    timestamp: body.timestamp || metadata.timestamp,
    raw: body,
  });
};

export const placeholderMetaIncomingMessage = ({ channel, tenantId, body = {} } = {}) => {
  // TODO(meta-webhooks): Map Meta webhook entry.messaging / changes payloads into the unified format,
  // verify app secret signatures, resolve tenant from page/account mapping, and persist delivery ids.
  const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};
  return normalizeBaseIncomingMessage({
    tenantId,
    channel,
    externalConversationId: metadata.external_conversation_id || metadata.session_id || body.session_id || body.conversation_id || body.thread_id || body.from || "",
    externalCustomerId: metadata.external_customer_id || metadata.customer_id || body.customer_id || body.from || body.sender_id || "",
    customerName: metadata.customer_name || body.customer_name || body.profile_name || "",
    messageText: body.message || body.text || "",
    attachments: body.attachments || metadata.attachments || [],
    timestamp: body.timestamp || metadata.timestamp || new Date().toISOString(),
    raw: body,
  });
};

const extractWhatsAppText = (message = {}) => {
  if (message.type === "text") return message.text?.body || "";
  if (message.type === "button") return message.button?.text || message.button?.payload || "";
  if (message.type === "interactive") {
    return message.interactive?.button_reply?.title || message.interactive?.button_reply?.id || message.interactive?.list_reply?.title || message.interactive?.list_reply?.id || "";
  }
  if (message.type === "image") return message.image?.caption || "";
  if (message.type === "document") return message.document?.caption || message.document?.filename || "";
  return "";
};

const extractWhatsAppAttachments = (message = {}) => {
  const media = message[message.type] || null;
  if (!media || !["image", "audio", "video", "document", "sticker"].includes(message.type)) return [];
  return [{
    type: message.type,
    url: media.link || "",
    title: media.caption || media.filename || media.id || "",
      metadata: {
        message_id: message.id || "",
        external_message_id: message.id || "",
        media_id: media.id || "",
      mime_type: media.mime_type || "",
      sha256: media.sha256 || "",
    },
  }];
};

export const extractWhatsAppWebhookMessages = ({ body = {}, tenantId = null } = {}) => {
  const messages = [];
  asArray(body.entry).forEach((entry) => {
    asArray(entry.changes).forEach((change) => {
      const value = change.value || {};
      const contactsByWaId = new Map(asArray(value.contacts).map((contact) => [contact.wa_id, contact]));
      asArray(value.messages).forEach((message) => {
        const contact = contactsByWaId.get(message.from) || {};
        messages.push(normalizeBaseIncomingMessage({
          tenantId,
          channel: AI_AGENT_CHANNELS.WHATSAPP,
          externalConversationId: `whatsapp:${message.from}`,
          externalCustomerId: message.from,
          customerName: contact.profile?.name || "",
          messageText: extractWhatsAppText(message),
          attachments: extractWhatsAppAttachments(message),
          timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
          externalMessageId: message.id || "",
          raw: { message, metadata: value.metadata || {}, field: change.field || "" },
        }));
      });
    });
  });
  return messages;
};

const metaEventChannel = ({ body = {}, event = {} } = {}) => {
  const object = toText(body.object).toLowerCase();
  if (object === "instagram") return AI_AGENT_CHANNELS.INSTAGRAM;
  const recipientId = toText(event.recipient?.id);
  if (recipientId && recipientId === toText(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID)) return AI_AGENT_CHANNELS.INSTAGRAM;
  return AI_AGENT_CHANNELS.FACEBOOK_MESSENGER;
};

const extractMetaMessageText = (event = {}) =>
  toText(event.message?.text || event.postback?.title || event.postback?.payload || event.message?.quick_reply?.payload || "");

const extractMetaAttachmentUrl = (attachment = {}) => {
  if (!attachment || typeof attachment !== "object") return "";
  const direct = toText(
    attachment.url ||
      attachment.image_url ||
      attachment.imageUrl ||
      attachment.payload?.url ||
      attachment.payload?.image_url ||
      attachment.payload?.imageUrl ||
      attachment.media?.image?.src ||
      attachment.media?.src ||
      attachment.image?.url ||
      attachment.image?.src
  );
  if (direct) return direct;
  for (const value of Object.values(attachment)) {
    if (value && typeof value === "object") {
      const nested = extractMetaAttachmentUrl(value);
      if (nested) return nested;
    }
  }
  return "";
};

const extractMetaAttachments = (event = {}) =>
  asArray(event.message?.attachments)
    .map((attachment) => ({
      type: attachment.type || "file",
      url: extractMetaAttachmentUrl(attachment),
      image_url: extractMetaAttachmentUrl(attachment),
      title: attachment.title || attachment.type || "",
      metadata: { sticker_id: attachment.payload?.sticker_id || "" },
    }))
    .filter((attachment) => attachment.url || attachment.metadata.sticker_id);

export const extractMetaWebhookMessages = ({ body = {}, tenantId = null } = {}) => {
  const messages = [];
  asArray(body.entry).forEach((entry) => {
    asArray(entry.messaging).forEach((event) => {
      const channel = metaEventChannel({ body, event });
      const senderId = toText(event.sender?.id);
      if (!senderId) return;
      const recipientId = toText(event.recipient?.id);
      const pageId = toText(entry.id || recipientId);
      const isEcho = event.message?.is_echo === true || event.message?.app_id || event.message?.metadata;
      const senderLooksLikePage = channel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER && pageId && senderId === pageId;
      if (isEcho || senderLooksLikePage) {
        console.log("[meta-webhook] skipped page-origin messenger event", {
          channel,
          sender_id: senderId ? "***" : "",
          recipient_id: recipientId ? "***" : "",
          page_id: pageId ? "***" : "",
          is_echo: Boolean(isEcho),
          sender_equals_page: Boolean(senderLooksLikePage),
        });
        return;
      }
      const messageText = extractMetaMessageText(event);
      const attachments = extractMetaAttachments(event);
      const externalMessageId = toText(event.message?.mid || event.message?.id || event.postback?.mid || event.postback?.payload || event.read?.watermark || event.delivery?.watermark);
      const replyToMessageId = toText(
        event.message?.reply_to?.mid ||
          event.message?.reply_to?.id ||
          event.message?.reply_to?.message_id ||
          event.message?.reply_to?.parent_mid ||
          event.message?.reply_to_message?.mid ||
          event.message?.reply_to_message?.id ||
          event.message?.reply_to_message?.message_id ||
          event.message?.reply_to_message?.parent_mid ||
          event.message?.replied_message?.mid ||
          event.message?.replied_message?.id ||
          event.message?.replied_message?.message_id ||
          event.message?.replied_message?.parent_mid ||
          event.message?.context?.mid ||
          event.message?.context?.id ||
          event.message?.context?.message_id ||
          event.message?.context?.parent_mid ||
          event.message?.reply_to_mid ||
          event.message?.parent_mid
      );
      const timestamp = event.timestamp ? new Date(Number(event.timestamp)).toISOString() : new Date().toISOString();
      messages.push(normalizeBaseIncomingMessage({
        tenantId,
        channel,
        externalConversationId: `${channel}:${senderId}`,
        externalCustomerId: senderId,
        customerName: "",
        messageText,
        attachments,
        timestamp,
        externalMessageId,
        replyToMessageId,
        dedupeKey: externalMessageId || dedupeHash([channel, senderId, event.recipient?.id, event.timestamp, messageText].map(toText).join("|")),
        raw: {
          event,
          object: body.object || "",
          page_id: pageId,
          sender_psid: senderId,
          customer_psid: senderId,
          recipient_page_id: recipientId,
          reply_to_message_id: replyToMessageId,
          reply_to: event.message?.reply_to || event.message?.reply_to_message || event.message?.replied_message || event.message?.context || null,
        },
      }));
    });
  });
  return messages;
};

export const channelAdapters = Object.freeze({
  [AI_AGENT_CHANNELS.WEB_CHAT]: {
    normalizeIncoming: normalizeWebChatIncomingMessage,
    sendOutgoing: async () => {
      // Web chat responses are returned directly by the HTTP route.
      throw Object.assign(new Error("Web chat uses HTTP response delivery"), { code: "WEB_CHAT_HTTP_DELIVERY" });
    },
  },
  [AI_AGENT_CHANNELS.WHATSAPP]: {
    normalizeIncoming: (input) => placeholderMetaIncomingMessage({ ...input, channel: AI_AGENT_CHANNELS.WHATSAPP }),
    sendOutgoing: (input) => sendWhatsAppCloudReply(input),
  },
  [AI_AGENT_CHANNELS.INSTAGRAM]: {
    normalizeIncoming: (input) => placeholderMetaIncomingMessage({ ...input, channel: AI_AGENT_CHANNELS.INSTAGRAM }),
    sendOutgoing: (input) => sendMetaPageReply({ ...input, channel: AI_AGENT_CHANNELS.INSTAGRAM }),
  },
  [AI_AGENT_CHANNELS.FACEBOOK_MESSENGER]: {
    normalizeIncoming: (input) => placeholderMetaIncomingMessage({ ...input, channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER }),
    sendOutgoing: (input) => sendMetaPageReply({ ...input, channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER }),
  },
});

export const normalizeIncomingChannelMessage = ({ channel = AI_AGENT_CHANNELS.WEB_CHAT, ...input } = {}) => {
  const normalizedChannel = normalizeChannel(channel);
  return channelAdapters[normalizedChannel].normalizeIncoming(input);
};

export const buildAiFlowPayloadFromNormalizedMessage = ({ normalizedMessage = {}, body = {}, headers = {} } = {}) => {
  const metadata = body?.metadata && typeof body.metadata === "object" ? body.metadata : {};
  return {
    message: normalizedMessage.message_text,
    tenant_id: normalizedMessage.tenant_id,
    tenantId: normalizedMessage.tenant_id,
    session_id: normalizedMessage.external_conversation_id,
    attachments: normalizedMessage.attachments,
    metadata: {
      ...metadata,
      session_id: normalizedMessage.external_conversation_id || metadata.session_id || body.session_id || headers["x-session-id"] || null,
      customer_id: normalizedMessage.external_customer_id || metadata.customer_id || null,
      customer_name: normalizedMessage.customer_name || metadata.customer_name || null,
      channel: normalizedMessage.channel,
      external_conversation_id: normalizedMessage.external_conversation_id,
      external_customer_id: normalizedMessage.external_customer_id,
      attachments: normalizedMessage.attachments,
      timestamp: normalizedMessage.timestamp,
    },
  };
};

export const normalizeOutgoingChannelReply = ({ channel = AI_AGENT_CHANNELS.WEB_CHAT, response = {} } = {}) => ({
  channel: normalizeChannel(channel),
  text: toText(response.answer || response.text),
  visual_attachments: asArray(response.visual_attachments),
  product_cards: normalizeStructuredProductCards(response.suggested_products || response.product_cards, { limit: 6 }),
  suggested_quick_replies: normalizeQuickReplies(response),
});

export const upsertChannelConversationMapping = async ({
  tenantId,
  channel,
  externalConversationId,
  externalCustomerId = "",
  customerName = "",
  customerAvatarUrl = "",
  customerProfileId = null,
  metadata = {},
  lastMessageAt = null,
} = {}) => {
  await ensureAiChannelAdapterSchema();
  const result = await db.query(
    `
    INSERT INTO ai_channel_conversations (
      tenant_id, channel, external_conversation_id, external_customer_id, customer_name, customer_avatar_url, last_message, customer_profile_id, metadata, last_message_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamp, NOW())
    ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
      external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), ai_channel_conversations.external_customer_id),
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_channel_conversations.customer_name),
      customer_avatar_url = COALESCE(NULLIF(EXCLUDED.customer_avatar_url, ''), ai_channel_conversations.customer_avatar_url),
      last_message = COALESCE(NULLIF(EXCLUDED.last_message, ''), ai_channel_conversations.last_message),
      customer_profile_id = COALESCE(EXCLUDED.customer_profile_id, ai_channel_conversations.customer_profile_id),
      metadata = ai_channel_conversations.metadata || EXCLUDED.metadata,
      last_message_at = COALESCE(EXCLUDED.last_message_at, ai_channel_conversations.last_message_at),
      updated_at = NOW()
    RETURNING *
    `,
    [
      numberOrNull(tenantId),
      normalizeChannel(channel),
      toText(externalConversationId),
      toText(externalCustomerId),
      toText(customerName),
      toText(customerAvatarUrl),
      toText(metadata?.last_message || metadata?.message_text || metadata?.messagePreview),
      numberOrNull(customerProfileId),
      json(metadata || {}),
      lastMessageAt || null,
    ]
  );
  return result.rows[0] || null;
};

export const linkChannelConversationToCustomerProfile = async ({
  tenantId,
  channel,
  externalConversationId,
  externalCustomerId = "",
} = {}) => {
  await ensureAiChannelAdapterSchema();
  const result = await db.query(
    `
    UPDATE ai_channel_conversations c
    SET customer_profile_id = p.id,
      updated_at = NOW()
    FROM ai_customer_profiles p
    WHERE c.tenant_id = $1
      AND c.channel = $2
      AND c.external_conversation_id = $3
      AND p.tenant_id = c.tenant_id
      AND p.phone = $4
    RETURNING c.*
    `,
    [numberOrNull(tenantId), normalizeChannel(channel), toText(externalConversationId), toText(externalCustomerId)]
  );
  return result.rows[0] || null;
};

export const resolveTenantIdForChannelAccount = async ({ channel, accountId = "" } = {}) => {
  const safeAccountId = toText(accountId);
  if (!safeAccountId) return null;
  await ensureAiChannelAdapterSchema();
  const result = await db.query(
    `
    SELECT tenant_id
    FROM ai_channel_conversations
    WHERE channel = $1
      AND (
        metadata->>'phone_number_id' = $2
        OR metadata->>'page_id' = $2
        OR metadata->>'instagram_business_account_id' = $2
        OR metadata->>'account_id' = $2
      )
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [normalizeChannel(channel), safeAccountId]
  );
  return numberOrNull(result.rows[0]?.tenant_id);
};

export const verifyMetaWebhookSignature = ({ rawBody, signature, appSecret } = {}) => {
  const secret = toText(appSecret);
  if (!secret) return true;
  const provided = toText(signature).replace(/^sha256=/i, "");
  if (!provided || !rawBody) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const left = Buffer.from(provided, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const whatsappConfig = () => ({
  enabled: String(process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true",
  accessToken: toText(process.env.WHATSAPP_ACCESS_TOKEN),
  phoneNumberId: toText(process.env.WHATSAPP_PHONE_NUMBER_ID),
  graphVersion: toText(process.env.META_GRAPH_VERSION || "v20.0"),
});

const metaPageConfig = (channel = AI_AGENT_CHANNELS.FACEBOOK_MESSENGER) => ({
  channel: normalizeChannel(channel),
  enabled: normalizeChannel(channel) === AI_AGENT_CHANNELS.INSTAGRAM
    ? String(process.env.INSTAGRAM_ENABLED || "false").toLowerCase() === "true"
    : String(process.env.FACEBOOK_MESSENGER_ENABLED || "false").toLowerCase() === "true",
  pageAccessToken: toText(process.env.META_PAGE_ACCESS_TOKEN),
  pageId: toText(process.env.META_PAGE_ID),
  instagramBusinessAccountId: toText(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID),
  graphVersion: toText(process.env.META_GRAPH_VERSION || "v20.0"),
});

const maskSecret = (value = "") => {
  const safe = toText(value);
  if (!safe) return "";
  if (safe.length <= 8) return "****";
  return `${safe.slice(0, 4)}...${safe.slice(-4)}`;
};

export const getWhatsAppChannelStatus = async ({ tenantId } = {}) => {
  await ensureAiChannelAdapterSchema();
  const config = whatsappConfig();
  const settings = await getChannelSettings({ tenantId, channel: AI_AGENT_CHANNELS.WHATSAPP });
  const events = await listChannelEvents({ tenantId, channel: AI_AGENT_CHANNELS.WHATSAPP, limit: 20 });
  const lastInbound = events.find((event) => event.direction === "inbound") || null;
  const lastOutbound = events.find((event) => event.direction === "outbound") || null;
  const verifyToken = toText(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN);
  const appSecret = toText(process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET);
  return {
    whatsapp: {
      env_enabled: config.enabled,
      ai_replies_enabled: settings.ai_replies_enabled === true,
      auto_reply_mode: settings.auto_reply_mode || (settings.ai_replies_enabled === true ? "fully_automatic" : "off"),
      settings_found: settings.settings_found === true,
      auto_created_settings: settings.auto_created === true,
      effective_enabled: (config.enabled || Boolean(lastInbound) || ["sent", "test_sent"].includes(lastOutbound?.status)) && settings.ai_replies_enabled === true,
      live_operational: config.enabled || Boolean(lastInbound) || ["sent", "test_sent"].includes(lastOutbound?.status),
      phone_number_id_configured: Boolean(config.phoneNumberId),
      phone_number_id: config.phoneNumberId ? maskSecret(config.phoneNumberId) : "",
      access_token_configured: Boolean(config.accessToken),
      access_token_masked: maskSecret(config.accessToken),
      verify_token_configured: Boolean(verifyToken),
      app_secret_configured: Boolean(appSecret),
      graph_version: config.graphVersion,
      last_webhook_received_at: lastInbound?.created_at || null,
      last_send_status: lastOutbound?.status || "",
      last_send_error: lastOutbound?.error || "",
      events,
    },
  };
};

const channelEnvStatus = ({ channel, settings, events }) => {
  const normalized = normalizeChannel(channel);
  const config = normalized === AI_AGENT_CHANNELS.WHATSAPP ? whatsappConfig() : metaPageConfig(normalized);
  const lastInbound = events.find((event) => event.direction === "inbound") || null;
  const lastOutbound = events.find((event) => event.direction === "outbound") || null;
  const verifyToken = toText(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN);
  const appSecret = toText(process.env.META_APP_SECRET);
  const connected = config.enabled || Boolean(lastInbound) || ["sent", "test_sent"].includes(lastOutbound?.status);
  const tokenValid = normalized === AI_AGENT_CHANNELS.WHATSAPP ? Boolean(config.accessToken) : Boolean(config.pageAccessToken);
  const webhookHealthy = Boolean(lastInbound) || Boolean(verifyToken && appSecret);
  const base = {
    env_enabled: config.enabled,
    ai_replies_enabled: settings.ai_replies_enabled === true,
    auto_reply_mode: settings.auto_reply_mode || (settings.ai_replies_enabled === true ? "fully_automatic" : "off"),
    settings_found: settings.settings_found === true,
    auto_created_settings: settings.auto_created === true,
    effective_enabled: connected && settings.ai_replies_enabled === true,
    live_operational: connected,
    connected,
    webhook_healthy: webhookHealthy,
    token_valid: tokenValid,
    aiStatus: resolveAIStatus({
      connected,
      aiEnabled: settings.ai_replies_enabled === true,
      humanOverride: false,
      webhookHealthy,
      tokenValid,
    }),
    verify_token_configured: Boolean(verifyToken),
    app_secret_configured: Boolean(appSecret),
    graph_version: config.graphVersion,
    last_webhook_received_at: lastInbound?.created_at || null,
    last_send_status: lastOutbound?.status || "",
    last_send_error: lastOutbound?.error || "",
    events,
  };
  if (normalized === AI_AGENT_CHANNELS.WHATSAPP) {
    return {
      ...base,
      phone_number_id_configured: Boolean(config.phoneNumberId),
      phone_number_id: config.phoneNumberId ? maskSecret(config.phoneNumberId) : "",
      access_token_configured: Boolean(config.accessToken),
      access_token_masked: maskSecret(config.accessToken),
    };
  }
  return {
    ...base,
    page_id_configured: Boolean(config.pageId),
    page_id: config.pageId ? maskSecret(config.pageId) : "",
    page_access_token_configured: Boolean(config.pageAccessToken),
    page_access_token_masked: maskSecret(config.pageAccessToken),
    instagram_business_account_id_configured: normalized === AI_AGENT_CHANNELS.INSTAGRAM ? Boolean(config.instagramBusinessAccountId) : true,
    instagram_business_account_id: config.instagramBusinessAccountId ? maskSecret(config.instagramBusinessAccountId) : "",
  };
};

export const getAiChannelsStatus = async ({ tenantId } = {}) => {
  await ensureAiChannelAdapterSchema();
  let metaStatus = null;
  try {
    const metaIntegration = await import("./metaIntegrationService.js");
    metaStatus = await metaIntegration.getMetaIntegrationStatus({ tenantId });
  } catch (error) {
    console.warn("[ai-channels] fresh Meta status unavailable", {
      tenant_id: numberOrNull(tenantId),
      message: error?.message || "unknown",
    });
  }
  const channels = [AI_AGENT_CHANNELS.WHATSAPP, AI_AGENT_CHANNELS.INSTAGRAM, AI_AGENT_CHANNELS.FACEBOOK_MESSENGER];
  const entries = await Promise.all(channels.map(async (channel) => {
    const settings = await getChannelSettings({ tenantId, channel });
    const events = await listChannelEvents({ tenantId, channel, limit: 20 });
    const status = channelEnvStatus({ channel, settings, events });
    if (![AI_AGENT_CHANNELS.FACEBOOK_MESSENGER, AI_AGENT_CHANNELS.INSTAGRAM].includes(channel) || !metaStatus) {
      return [channel, status];
    }

    const config = metaStatus.config || {};
    const metaChannel = channel === AI_AGENT_CHANNELS.INSTAGRAM ? metaStatus.channels?.instagram || {} : metaStatus.channels?.facebook || {};
    const setup = metaStatus.setup_completion || {};
    const tokenState = toText(config.token_status || config.token_health_status || config.status).toLowerCase();
    const tokenActive = Boolean(
      config.page_access_token_configured &&
        config.token_expired !== true &&
        (metaChannel.token_valid === true || ["active", "connected", "valid", "healthy", "saved"].includes(tokenState))
    );
    const webhookHealthy = Boolean(metaChannel.webhook_healthy || setup.webhook_verified || setup.webhook_enabled || metaStatus.checklist?.webhook_verified);
    const messagingConnected = channel === AI_AGENT_CHANNELS.INSTAGRAM
      ? Boolean(metaChannel.dm_connected || metaChannel.messaging_active || metaChannel.connected)
      : Boolean(metaChannel.messenger_connected || metaChannel.messaging_active || metaChannel.connected);
    const connected = Boolean(tokenActive && webhookHealthy && messagingConnected);
    const merged = {
      ...status,
      env_enabled: status.env_enabled || connected,
      effective_enabled: connected && settings.ai_replies_enabled === true,
      live_operational: connected,
      connected,
      webhook_healthy: webhookHealthy,
      token_valid: tokenActive,
      token_status: tokenActive ? "active" : (config.token_status || config.token_health_status || status.token_status || ""),
      token_health_status: tokenActive ? "active" : (config.token_health_status || config.token_status || status.token_health_status || ""),
      page_id_configured: Boolean(config.facebook_page_id),
      page_id: config.facebook_page_id ? maskSecret(config.facebook_page_id) : status.page_id || "",
      page_access_token_configured: Boolean(config.page_access_token_configured),
      page_access_token_masked: config.page_access_token_masked || status.page_access_token_masked || "",
      instagram_business_account_id_configured: channel === AI_AGENT_CHANNELS.INSTAGRAM ? Boolean(config.instagram_business_account_id) : true,
      instagram_business_account_id: config.instagram_business_account_id ? maskSecret(config.instagram_business_account_id) : status.instagram_business_account_id || "",
      messaging_active: messagingConnected,
      meta_status_fresh: true,
      meta_overall_status: metaStatus.overall_status || "",
    };
    merged.aiStatus = resolveAIStatus({
      connected,
      aiEnabled: settings.ai_replies_enabled === true,
      humanOverride: false,
      webhookHealthy,
      tokenValid: tokenActive,
    });
    return [channel, merged];
  }));
  return Object.fromEntries(entries);
};

const graphUrl = ({ phoneNumberId, graphVersion }) =>
  `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`;

const postWhatsAppMessage = async ({ payload, config }) => {
  const response = await fetch(graphUrl(config), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
    },
    body: json(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = Object.assign(new Error(data?.error?.message || "WhatsApp Cloud API send failed"), {
      status: response.status,
      responseBody: data,
    });
    throw error;
  }
  return data;
};

const visualAttachmentImageUrls = (reply = {}) =>
  [
    ...asArray(reply.product_cards).map((product) => product.image_url || product.image || ""),
    ...asArray(reply.visual_attachments)
    .flatMap((attachment) => [
      attachment.url || attachment.image_url || "",
      ...asArray(attachment.items).map((item) => item.image_url || item.url || ""),
    ]),
  ]
    .map(toText)
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 3);

export const sendWhatsAppCloudReply = async ({ to, reply = {}, messageText = "" } = {}) => {
  const config = whatsappConfig();
  if (!config.enabled) throw Object.assign(new Error("WhatsApp sender is disabled"), { code: "WHATSAPP_DISABLED" });
  if (!config.accessToken || !config.phoneNumberId) throw Object.assign(new Error("WhatsApp credentials are missing"), { code: "WHATSAPP_CONFIG_MISSING" });
  const recipient = toText(to);
  if (!recipient) throw Object.assign(new Error("WhatsApp recipient is required"), { code: "WHATSAPP_RECIPIENT_REQUIRED" });
  const text = toText(messageText || reply.text);
  const results = [];
  if (text) {
    results.push(await postWhatsAppMessage({
      config,
      payload: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: { preview_url: false, body: text.slice(0, 4096) },
      },
    }));
  }
  for (const imageUrl of visualAttachmentImageUrls(reply)) {
    try {
      results.push(await postWhatsAppMessage({
        config,
        payload: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipient,
          type: "image",
          image: { link: imageUrl },
        },
      }));
    } catch (error) {
      console.warn("[ai-agent:whatsapp] image send failed; text reply already attempted", {
        to: recipient,
        image_url: imageUrl,
        message: error?.message,
        status: error?.status,
      });
    }
  }
  return { sent: results.length > 0, results };
};

const metaMessagesUrl = (graphVersion = "v20.0") => `https://graph.facebook.com/${graphVersion}/me/messages`;

const postMetaPageMessage = async ({ payload, config }) => {
  const payloadType = payload?.message?.attachment?.type || (payload?.message?.text ? "text" : "unknown");
  console.log("[meta-send] preparing", {
    channel: config.channel || "",
    pageId: config.pageId ? maskSecret(config.pageId) : "",
    recipientId: payload?.recipient?.id ? maskSecret(payload.recipient.id) : "",
    tokenPresent: Boolean(config.pageAccessToken),
    payloadType,
    source: "aiChannelAdapterService",
  });
  console.log("[meta-send] calling graph API", {
    channel: config.channel || "",
    pageId: config.pageId ? maskSecret(config.pageId) : "",
    recipientId: payload?.recipient?.id ? maskSecret(payload.recipient.id) : "",
    tokenPresent: Boolean(config.pageAccessToken),
    payloadType,
    source: "aiChannelAdapterService",
  });
  const response = await fetch(`${metaMessagesUrl(config.graphVersion)}?access_token=${encodeURIComponent(config.pageAccessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[meta-send] failed", {
      status: response.status,
      code: data?.error?.code || "",
      subcode: data?.error?.error_subcode || "",
      message: data?.error?.message || "Meta page send failed",
      fbtrace_id: data?.error?.fbtrace_id || "",
      payloadType,
      source: "aiChannelAdapterService",
    });
    throw Object.assign(new Error(data?.error?.message || "Meta page send failed"), {
      status: response.status,
      code: data?.error?.code || "",
      responseBody: data,
      metaResponse: data,
    });
  }
  console.log("[meta-send] success", {
    status: response.status,
    message_id: data?.message_id || "",
    recipientId: data?.recipient_id ? maskSecret(data.recipient_id) : "",
    payloadType,
    source: "aiChannelAdapterService",
  });
  return data;
};

export const sendMetaPageReply = async ({ channel, to, reply = {}, messageText = "" } = {}) => {
  const normalized = normalizeChannel(channel);
  const config = metaPageConfig(normalized);
  if (!config.enabled) throw Object.assign(new Error(`${normalized} sender is disabled`), { code: "META_CHANNEL_DISABLED" });
  if (!config.pageAccessToken) {
    console.error("[meta-send] missing page access token", {
      channel: normalized,
      pageId: config.pageId ? maskSecret(config.pageId) : "",
      source: "aiChannelAdapterService",
    });
    throw Object.assign(new Error("META_PAGE_ACCESS_TOKEN is missing"), { code: "META_PAGE_ACCESS_TOKEN_MISSING" });
  }
  if (normalized === AI_AGENT_CHANNELS.INSTAGRAM && !config.instagramBusinessAccountId) {
    throw Object.assign(new Error("INSTAGRAM_BUSINESS_ACCOUNT_ID is missing"), { code: "INSTAGRAM_CONFIG_MISSING" });
  }
  if (normalized === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER && !config.pageId) {
    throw Object.assign(new Error("META_PAGE_ID is missing"), { code: "FACEBOOK_MESSENGER_CONFIG_MISSING" });
  }
  const recipient = toText(to);
  if (!recipient) throw Object.assign(new Error("Meta recipient id is required"), { code: "META_RECIPIENT_REQUIRED" });
  console.log("[meta-send] channel", { channel: normalized, source: "aiChannelAdapterService" });
  console.log("[meta-send] pageId", { pageId: config.pageId ? maskSecret(config.pageId) : "", source: "aiChannelAdapterService" });
  console.log("[meta-send] recipientId/psid", { recipientId: maskSecret(recipient), source: "aiChannelAdapterService" });
  console.log("[meta-send] token present", { tokenPresent: Boolean(config.pageAccessToken), source: "aiChannelAdapterService" });
  const text = toText(messageText || reply.text);
  const results = [];
  const productCards = normalizeStructuredProductCards(reply.product_cards, { limit: 4 });
  if (productCards.length) {
    for (const product of productCards) {
      console.log("[ai-agent:meta] selected product card", {
        channel: normalized,
        product_id: product.product_id || product.id || null,
        image_url_exists: Boolean(product.image_url),
        product_link_generated: product.product_url || product.url || "",
      });
      if (product.image_url) {
        try {
          const imageResult = await postMetaPageMessage({
            config,
            payload: {
              recipient: { id: recipient },
              messaging_type: "RESPONSE",
              message: {
                attachment: {
                  type: "image",
                  payload: { url: product.image_url, is_reusable: true },
                },
              },
            },
          });
          console.log("[ai-agent:meta] messenger send image success", {
            channel: normalized,
            product_id: product.product_id || product.id || null,
            image_url: product.image_url,
          });
          results.push(imageResult);
        } catch (error) {
          console.warn("[ai-agent:meta] messenger send image failure", {
            channel: normalized,
            product_id: product.product_id || product.id || null,
            image_url: product.image_url,
            message: error?.message,
            status: error?.status,
          });
        }
      }
      results.push(await postMetaPageMessage({
        config,
        payload: {
          recipient: { id: recipient },
          messaging_type: "RESPONSE",
          message: { text: productCardReplyText(product).slice(0, 2000) },
        },
      }));
    }
    return { sent: results.length > 0, results };
  }
  for (const imageUrl of visualAttachmentImageUrls(reply)) {
    try {
      const imageResult = await postMetaPageMessage({
        config,
        payload: {
          recipient: { id: recipient },
          messaging_type: "RESPONSE",
          message: {
            attachment: {
              type: "image",
              payload: { url: imageUrl, is_reusable: true },
            },
          },
        },
      });
      console.log("[ai-agent:meta] messenger send image success", {
        channel: normalized,
        image_url: imageUrl,
      });
      results.push(imageResult);
    } catch (error) {
      console.warn("[ai-agent:meta] messenger send image failure", {
        channel: normalized,
        to: recipient,
        image_url: imageUrl,
        message: error?.message,
        status: error?.status,
      });
    }
  }
  if (text) {
    results.push(await postMetaPageMessage({
      config,
      payload: {
        recipient: { id: recipient },
        messaging_type: "RESPONSE",
        message: { text: text.slice(0, 2000) },
      },
    }));
  }
  return { sent: results.length > 0, results };
};
