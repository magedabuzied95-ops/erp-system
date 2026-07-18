import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackDedupeHash,
  normalizeChannelEnvelope,
  normalizeTextForDedupe,
} from '../src/contracts/channelEnvelope.js';
import { retryDecision, RETRY_DELAYS_SECONDS } from '../src/queue/retryPolicy.js';
import { MediaProcessor } from '../src/media/MediaProcessor.js';
import { validateErpEvent } from '../src/contracts/erpEvent.js';
import {
  CHANNEL_EVENT_TYPES,
  buildChannelEvent,
  getChannelGatewayFeatureFlags,
  stableEventUuid,
} from '../../../server/services/channelOutboxPublisher.js';

test('normalizes aliases into one stable channel envelope', () => {
  const result = normalizeChannelEnvelope({
    tenant_id: 1,
    connection_id: '7',
    channel: 'Messenger',
    direction: 'inbound',
    external_conversation_id: 'thread-1',
    external_message_id: 'message-1',
    sender_id: 'customer-1',
    text: '  أهلاً   بك  ',
    occurred_at: '2026-07-18T12:00:00.000Z',
  });
  assert.equal(result.channel, 'facebook_messenger');
  assert.equal(result.text, 'أهلاً   بك');
  assert.match(result.dedupe_hash, /^[a-f0-9]{64}$/);
});

test('fallback dedupe ignores whitespace/case and uses approximate timestamp buckets', () => {
  const base = {
    channel: 'facebook',
    externalConversationId: 'c1',
    senderId: 'u1',
    occurredAt: '2026-07-18T12:00:01.000Z',
  };
  assert.equal(
    buildFallbackDedupeHash({ ...base, text: ' Hello   WORLD ' }),
    buildFallbackDedupeHash({ ...base, text: 'hello world' }),
  );
  assert.equal(normalizeTextForDedupe(' A   B '), 'a b');
});

test('outbound envelope requires caller-provided idempotency', () => {
  assert.throws(() => normalizeChannelEnvelope({
    tenant_id: 1,
    connection_id: '7',
    channel: 'whatsapp',
    direction: 'outbound',
    external_conversation_id: 'c1',
    text: 'hello',
  }, { requireIdempotencyKey: true }), /idempotency_key_required/);
});

test('retry schedule matches the durable queue contract then escalates', () => {
  assert.deepEqual(RETRY_DELAYS_SECONDS, [30, 60, 120, 300, 600, 1800]);
  assert.equal(retryDecision(1).delaySeconds, 30);
  assert.equal(retryDecision(6).delaySeconds, 1800);
  assert.equal(retryDecision(7).status, 'needs_manual_review');
});

test('media processor rejects unsafe protocols and oversized payloads', () => {
  const processor = new MediaProcessor({ maxBytes: 100 });
  assert.equal(processor.validateDescriptor({ url: 'https://cdn.example/image.jpg', size: 50 }).url,
    'https://cdn.example/image.jpg');
  assert.throws(() => processor.validateDescriptor({ url: 'http://internal/media.jpg' }), /HTTPS/);
  assert.throws(() => processor.validateDescriptor({ url: 'https://cdn.example/image.jpg', size: 101 }), /size limit/);
});

test('ERP event contract rejects unsupported versions', () => {
  const base = {
    event_id: stableEventUuid('contract'), event_type: 'message.created', event_version: 1,
    tenant_id: 1, aggregate_type: 'message', aggregate_id: '1', payload: {},
  };
  assert.equal(validateErpEvent(base), true);
  assert.throws(() => validateErpEvent({ ...base, event_version: 2 }), /unsupported_event_version/);
});

test('shadow feature flags are safe by default', () => {
  const flags = getChannelGatewayFeatureFlags({});
  assert.deepEqual(flags, {
    enabled: false, shadowMode: true, outboundEnabled: false,
    inboundEnabled: false, compareEnabled: true,
  });
});

test('ERP contract includes every required shadow event type and metadata field', () => {
  assert.deepEqual(CHANNEL_EVENT_TYPES, [
    'conversation.created', 'conversation.updated', 'message.created',
    'message.outbound_requested', 'message.status_changed',
    'human_takeover.changed', 'assignment.changed',
  ]);
  const event = buildChannelEvent({
    eventType: 'message.created', tenantId: 1, aggregateType: 'message', aggregateId: '12',
    correlationId: 'conversation-1', causationId: 'incoming-1', payload: { channel: 'whatsapp' },
  });
  for (const key of ['event_id', 'event_type', 'event_version', 'tenant_id', 'aggregate_type',
    'aggregate_id', 'occurred_at', 'payload', 'correlation_id', 'causation_id', 'source']) {
    assert.ok(Object.hasOwn(event, key), `missing ${key}`);
  }
});
