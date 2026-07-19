import { createHash } from 'node:crypto';

const clean = (value = '') => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const sha256 = (value) => createHash('sha256').update(String(value ?? '')).digest('hex');

export function buildConversationIdentity(input = {}) {
  const threadId = clean(input.threadId || extractThreadId(input.url));
  const username = clean(input.externalUsername).replace(/^@/, '');
  const header = clean(input.headerIdentity);
  const account = clean(input.channelAccountId);
  const connectedAccount = clean(input.connectedAccountUsername || input.expectedUsername).replace(/^@/, '');
  const displayName = String(input.externalDisplayName || input.headerIdentity || '').trim();
  const cleanDisplayName = clean(displayName).replace(/^@/, '');
  const externalDisplayName = connectedAccount && cleanDisplayName === connectedAccount
    ? username
    : displayName;
  const externalConversationId = threadId || (username && `ig-user:${username}`) || '';
  const confidence = threadId && username ? 'high' : threadId || (username && header) ? 'medium' : 'low';
  return {
    channel_connection_id: String(input.channelConnectionId || ''),
    external_conversation_id: externalConversationId || `ig-fingerprint:${sha256([account, username, header].join('|')).slice(0, 32)}`,
    external_customer_id: clean(input.externalCustomerId) || (username ? `ig-user:${username}` : ''),
    external_username: username,
    external_display_name: externalDisplayName,
    conversation_fingerprint: sha256([account, threadId, username, header].join('|')),
    identity_confidence: confidence,
    last_verified_at: new Date(input.verifiedAt || Date.now()).toISOString(),
  };
}

export function extractThreadId(url = '') {
  const match = String(url).match(/\/direct\/t\/([^/?#]+)/i);
  return match?.[1] || '';
}

export function verifyConversationTarget(expected = {}, actual = {}) {
  if (!actual.external_conversation_id) return { ok: false, reason: 'conversation_not_found' };
  if (expected.external_conversation_id !== actual.external_conversation_id) return { ok: false, reason: 'conversation_header_mismatch' };
  if (expected.external_username && actual.external_username && clean(expected.external_username) !== clean(actual.external_username)) return { ok: false, reason: 'username_mismatch' };
  if (expected.conversation_fingerprint && actual.conversation_fingerprint && expected.conversation_fingerprint !== actual.conversation_fingerprint) return { ok: false, reason: 'conversation_fingerprint_mismatch' };
  if ((expected.identity_confidence || actual.identity_confidence) === 'low') return { ok: false, reason: 'low_identity_confidence' };
  return { ok: true, reason: 'verified' };
}
