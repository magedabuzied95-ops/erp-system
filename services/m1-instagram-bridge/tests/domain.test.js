import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConversationIdentity, verifyConversationTarget } from '../src/domain/identity.js';
import { buildMessageFingerprint, matchOutgoingConfirmation, normalizeInstagramTextEvent } from '../src/domain/messages.js';
import { mapHealthState } from '../src/domain/health.js';
import { instagramSelectors, SELECTOR_VERSION } from '../src/selectors/instagram.selectors.js';
import { redact } from '../src/security/redaction.js';

test('conversation identity prefers thread id and records confidence', () => {
  const identity = buildConversationIdentity({ url: 'https://www.instagram.com/direct/t/12345/', externalUsername: '@User_A', headerIdentity: 'User A', channelAccountId: 'instagram-test-account', channelConnectionId: 9 });
  assert.equal(identity.external_conversation_id, '12345'); assert.equal(identity.external_username, 'user_a'); assert.equal(identity.identity_confidence, 'high'); assert.equal(identity.conversation_fingerprint.length, 64);
});

test('two customers cannot collapse into one conversation', () => {
  const a = buildConversationIdentity({ threadId: 'a', externalUsername: 'user_a', headerIdentity: 'User A', channelAccountId: 'instagram-test-account' });
  const b = buildConversationIdentity({ threadId: 'b', externalUsername: 'user_b', headerIdentity: 'User B', channelAccountId: 'instagram-test-account' });
  assert.notEqual(a.external_conversation_id, b.external_conversation_id); assert.notEqual(a.conversation_fingerprint, b.conversation_fingerprint);
});

test('low-confidence identity and header mismatch prevent send', () => {
  assert.deepEqual(verifyConversationTarget({ external_conversation_id: 'a', identity_confidence: 'high' }, { external_conversation_id: 'b', identity_confidence: 'high' }), { ok: false, reason: 'conversation_header_mismatch' });
  assert.equal(verifyConversationTarget({ external_conversation_id: 'a', identity_confidence: 'low' }, { external_conversation_id: 'a' }).reason, 'low_identity_confidence');
});

test('message fingerprint is stable for live watch and recovery sync', () => {
  const input = { externalConversationId: 'a', direction: 'incoming', text: ' Test   A 001 ', sentAt: '2026-07-18T10:00:01Z', domFingerprint: 'x' };
  assert.equal(buildMessageFingerprint(input), buildMessageFingerprint({ ...input, text: 'Test A 001' }));
});

test('normalizer emits current gateway schema and draft-only metadata', () => {
  const identity = buildConversationIdentity({ threadId: 'a', externalUsername: 'user_a', headerIdentity: 'User A', channelAccountId: 'instagram-test-account' });
  const event = normalizeInstagramTextEvent({ text: 'hello', direction: 'incoming', externalMessageId: 'm1' }, { identity, tenantId: 1, connectionId: 2, channelAccountId: 'instagram-test-account' });
  assert.equal(event.channel, 'instagram'); assert.equal(event.direction, 'inbound'); assert.equal(event.metadata.ai_mode, 'draft_only'); assert.equal(event.metadata.channel_account_id, 'instagram-test-account'); assert.deepEqual(event.attachments, []);
});

test('outgoing confirmation requires matching text, direction, and time window', () => {
  const match = matchOutgoingConfirmation({ text: 'hello', sentAt: '2026-07-18T10:00:00Z' }, [{ text: 'hello', direction: 'outgoing', sentAt: '2026-07-18T10:00:10Z', externalMessageId: 'm2' }]);
  assert.equal(match.externalMessageId, 'm2');
  assert.equal(matchOutgoingConfirmation({ text: 'hello' }, [{ text: 'hello', direction: 'incoming' }]), null);
});

test('selector registry is centralized and versioned', () => {
  for (const key of ['login','directInbox','conversationList','conversationItem','unreadIndicator','activeConversationHeader','messageList','incomingMessage','outgoingMessage','composer','sendButton','loginChallenge','sessionExpired','loadingState']) {
    assert.equal(instagramSelectors[key].version, SELECTOR_VERSION); assert.ok(instagramSelectors[key].primary); assert.ok(instagramSelectors[key].fallbacks.length);
  }
});

test('health state mapping covers session, selector, crash, and pause states', () => {
  assert.equal(mapHealthState({ paused: true }), 'paused');
  assert.equal(mapHealthState({ browserRunning: false, everStarted: true }), 'browser_crashed');
  assert.equal(mapHealthState({ browserRunning: true, loginRequired: true }), 'login_required');
  assert.equal(mapHealthState({ browserRunning: true, sessionExpired: true }), 'session_expired');
  assert.equal(mapHealthState({ browserRunning: true, inboxLoaded: true, selectorFailures: 3, selectorFailureThreshold: 3 }), 'selector_failure');
  assert.equal(mapHealthState({ browserRunning: true, inboxLoaded: true, selectorFailures: 0 }), 'healthy');
});

test('structured log redaction hides credentials and conversation PII', () => {
  const output = redact({ password: 'secret', cookie: 'abc', username: 'person', text: 'hello', operation: 'sync' });
  assert.equal(output.password, '[REDACTED]'); assert.equal(output.cookie, '[REDACTED]'); assert.match(output.username, /REDACTED/); assert.match(output.text, /REDACTED/); assert.equal(output.operation, 'sync');
});
