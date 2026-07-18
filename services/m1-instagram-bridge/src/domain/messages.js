import { sha256 } from './identity.js';

export const normalizeMessageText = (value = '') => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');

export function buildMessageFingerprint(input = {}) {
  const timestamp = new Date(input.sentAt || 0).getTime();
  const bucket = Number.isFinite(timestamp) ? Math.floor(timestamp / 30_000) : 0;
  return sha256([
    'instagram', input.externalConversationId, input.direction,
    normalizeMessageText(input.text).toLowerCase(), bucket, input.domFingerprint || '',
  ].join('|'));
}

export function normalizeInstagramTextEvent(input = {}, context = {}) {
  const identity = context.identity || {};
  const text = normalizeMessageText(input.text);
  if (!text) throw Object.assign(new Error('Only non-empty text is supported'), { code: 'TEXT_REQUIRED' });
  const fingerprint = buildMessageFingerprint({ ...input, externalConversationId: identity.external_conversation_id });
  const externalMessageId = String(input.externalMessageId || '').trim() || `ig-fp:${fingerprint}`;
  return {
    version: '1.0',
    event_id: `ig:${context.channelAccountId}:message:${externalMessageId}`,
    tenant_id: Number(context.tenantId),
    connection_id: String(context.connectionId),
    channel: 'instagram',
    direction: input.direction === 'outgoing' ? 'outbound' : 'inbound',
    external_conversation_id: identity.external_conversation_id,
    external_message_id: externalMessageId,
    sender_id: input.direction === 'outgoing' ? context.channelAccountId : identity.external_customer_id,
    recipient_id: input.direction === 'outgoing' ? identity.external_customer_id : context.channelAccountId,
    text,
    attachments: [],
    occurred_at: new Date(input.sentAt || Date.now()).toISOString(),
    idempotency_key: externalMessageId,
    dedupe_hash: fingerprint,
    metadata: {
      external_username: identity.external_username,
      external_display_name: identity.external_display_name,
      conversation_fingerprint: identity.conversation_fingerprint,
      identity_confidence: identity.identity_confidence,
      source: input.source || 'live_watch',
      ai_mode: 'draft_only',
      channel_account_id: context.channelAccountId,
    },
  };
}

export function matchOutgoingConfirmation(expected = {}, candidates = []) {
  const expectedText = normalizeMessageText(expected.text);
  const expectedAt = new Date(expected.sentAt || Date.now()).getTime();
  return candidates.find((candidate) => {
    if (candidate.direction !== 'outgoing') return false;
    if (normalizeMessageText(candidate.text) !== expectedText) return false;
    const candidateAt = new Date(candidate.sentAt || expectedAt).getTime();
    return Math.abs(candidateAt - expectedAt) <= Number(expected.windowMs || 120_000);
  }) || null;
}
