import { createHash, randomUUID } from "node:crypto";

export const CHANNEL_ENVELOPE_VERSION = "1.0";

export const CHANNELS = Object.freeze([
  "whatsapp",
  "facebook_messenger",
  "instagram",
  "telegram",
  "website_chat",
  "tiktok",
]);

export const DIRECTIONS = Object.freeze(["inbound", "outbound"]);

const text = (value = "") => String(value ?? "").trim();
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => Array.isArray(value) ? value : [];

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
};

export const stableJson = (value) => JSON.stringify(stableValue(value));

export const sha256 = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");

export const normalizeChannelName = (value = "") => {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["facebook", "messenger", "facebook_dm"].includes(normalized)) return "facebook_messenger";
  if (["web", "website", "web_chat"].includes(normalized)) return "website_chat";
  return normalized;
};

export const normalizeTextForDedupe = (value = "") =>
  text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ");

export const normalizeAttachment = (attachment = {}) => {
  const source = object(attachment);
  return {
    type: text(source.type || source.mime_type || source.mimeType || "file").toLowerCase(),
    external_media_id: text(source.external_media_id || source.media_id || source.id),
    url: text(source.url || source.media_url || source.image_url),
    filename: text(source.filename || source.name || source.title),
    mime_type: text(source.mime_type || source.mimeType),
    size_bytes: Number.isFinite(Number(source.size_bytes || source.size)) ? Number(source.size_bytes || source.size) : null,
    checksum_sha256: text(source.checksum_sha256 || source.sha256),
    metadata: object(source.metadata),
  };
};

export const buildFallbackDedupeHash = ({
  channel,
  externalConversationId,
  senderId,
  text: messageText,
  attachments = [],
  occurredAt,
  timestampBucketSeconds = 30,
} = {}) => {
  const timestampMs = new Date(occurredAt || 0).getTime();
  const bucketMs = Math.max(1, Number(timestampBucketSeconds || 30)) * 1000;
  const approximateTimestamp = Number.isFinite(timestampMs) ? Math.floor(timestampMs / bucketMs) : 0;
  const attachmentIdentity = array(attachments)
    .map(normalizeAttachment)
    .map((item) => ({
      type: item.type,
      external_media_id: item.external_media_id,
      checksum_sha256: item.checksum_sha256,
      filename: item.filename,
      size_bytes: item.size_bytes,
    }));

  return sha256(stableJson({
    channel: normalizeChannelName(channel),
    conversation: text(externalConversationId),
    sender: text(senderId),
    text: normalizeTextForDedupe(messageText),
    attachments: attachmentIdentity,
    approximate_timestamp: approximateTimestamp,
  }));
};

export const validateChannelEnvelope = (input = {}, { requireIdempotencyKey = false } = {}) => {
  const source = object(input);
  const channel = normalizeChannelName(source.channel);
  const direction = text(source.direction).toLowerCase();
  const errors = [];

  if (text(source.version || CHANNEL_ENVELOPE_VERSION) !== CHANNEL_ENVELOPE_VERSION) errors.push("unsupported_version");
  if (!CHANNELS.includes(channel)) errors.push("unsupported_channel");
  if (!DIRECTIONS.includes(direction)) errors.push("invalid_direction");
  if (!Number.isFinite(Number(source.tenant_id)) || Number(source.tenant_id) <= 0) errors.push("invalid_tenant_id");
  if (!text(source.connection_id)) errors.push("connection_id_required");
  if (!text(source.external_conversation_id)) errors.push("external_conversation_id_required");
  if (direction === "inbound" && !text(source.sender_id)) errors.push("sender_id_required");
  if (requireIdempotencyKey && !text(source.idempotency_key)) errors.push("idempotency_key_required");
  if (!text(source.text) && array(source.attachments).length === 0) errors.push("message_content_required");

  if (errors.length) {
    const error = Object.assign(new Error(`Invalid channel envelope: ${errors.join(", ")}`), {
      code: "INVALID_CHANNEL_ENVELOPE",
      status: 400,
      errors,
    });
    throw error;
  }

  return true;
};

export const normalizeChannelEnvelope = (input = {}, options = {}) => {
  const source = object(input);
  const occurredAt = text(source.occurred_at || source.timestamp) || new Date().toISOString();
  const envelope = {
    version: text(source.version) || CHANNEL_ENVELOPE_VERSION,
    event_id: text(source.event_id) || randomUUID(),
    tenant_id: Number(source.tenant_id),
    connection_id: text(source.connection_id),
    channel: normalizeChannelName(source.channel),
    direction: text(source.direction).toLowerCase(),
    external_conversation_id: text(source.external_conversation_id),
    external_message_id: text(source.external_message_id),
    sender_id: text(source.sender_id),
    recipient_id: text(source.recipient_id),
    text: text(source.text),
    attachments: array(source.attachments).map(normalizeAttachment),
    occurred_at: new Date(occurredAt).toISOString(),
    received_at: text(source.received_at) || new Date().toISOString(),
    idempotency_key: text(source.idempotency_key),
    dedupe_hash: text(source.dedupe_hash),
    metadata: object(source.metadata),
    raw: object(source.raw),
  };

  validateChannelEnvelope(envelope, options);
  if (!envelope.dedupe_hash) {
    envelope.dedupe_hash = buildFallbackDedupeHash({
      channel: envelope.channel,
      externalConversationId: envelope.external_conversation_id,
      senderId: envelope.sender_id,
      text: envelope.text,
      attachments: envelope.attachments,
      occurredAt: envelope.occurred_at,
    });
  }
  return envelope;
};

export default {
  CHANNEL_ENVELOPE_VERSION,
  CHANNELS,
  DIRECTIONS,
  normalizeChannelEnvelope,
  validateChannelEnvelope,
  buildFallbackDedupeHash,
};
