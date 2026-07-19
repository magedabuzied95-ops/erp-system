import { createHash, randomUUID } from 'node:crypto';
import db from '../database/db.js';

export const CHANNEL_EVENT_VERSION = 1;
export const CHANNEL_EVENT_TYPES = Object.freeze([
  'conversation.created',
  'conversation.updated',
  'message.created',
  'message.outbound_requested',
  'message.status_changed',
  'human_takeover.changed',
  'assignment.changed',
]);

const text = (value = '') => String(value ?? '').trim();
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};
const stableJson = (value) => JSON.stringify(stableValue(value));
const fingerprint = (value) => createHash('sha256').update(stableJson(value)).digest('hex');
export const stableEventUuid = (value) => {
  const hex = createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const id = hex.join('');
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
};
const enabledValue = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const getChannelGatewayFeatureFlags = (env = process.env) => Object.freeze({
  enabled: enabledValue(env.CHANNEL_GATEWAY_ENABLED, false),
  shadowMode: enabledValue(env.CHANNEL_GATEWAY_SHADOW_MODE, true),
  outboundEnabled: enabledValue(env.CHANNEL_GATEWAY_OUTBOUND_ENABLED, false),
  inboundEnabled: enabledValue(env.CHANNEL_GATEWAY_INBOUND_ENABLED, false),
  compareEnabled: enabledValue(env.CHANNEL_GATEWAY_COMPARE_ENABLED, true),
});

export const validateChannelEvent = (event = {}) => {
  const errors = [];
  if (!text(event.event_id)) errors.push('event_id_required');
  if (!CHANNEL_EVENT_TYPES.includes(text(event.event_type))) errors.push('unsupported_event_type');
  if (Number(event.event_version) !== CHANNEL_EVENT_VERSION) errors.push('unsupported_event_version');
  if (!Number.isFinite(Number(event.tenant_id)) || Number(event.tenant_id) <= 0) errors.push('invalid_tenant_id');
  if (!text(event.aggregate_type)) errors.push('aggregate_type_required');
  if (!text(event.aggregate_id)) errors.push('aggregate_id_required');
  if (!text(event.occurred_at) || Number.isNaN(new Date(event.occurred_at).getTime())) errors.push('invalid_occurred_at');
  if (!text(event.source)) errors.push('source_required');
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) errors.push('payload_required');
  if (errors.length) {
    throw Object.assign(new Error(`Invalid channel event: ${errors.join(', ')}`), {
      code: 'INVALID_CHANNEL_EVENT', status: 400, errors,
    });
  }
  return true;
};

export const buildChannelEvent = ({
  eventId = randomUUID(), eventType, tenantId, aggregateType, aggregateId,
  occurredAt = new Date().toISOString(), payload = {}, correlationId = '', causationId = '',
  source = 'erp-backend', eventVersion = CHANNEL_EVENT_VERSION,
} = {}) => {
  const event = {
    event_id: text(eventId),
    event_type: text(eventType),
    event_version: Number(eventVersion),
    tenant_id: Number(tenantId),
    aggregate_type: text(aggregateType),
    aggregate_id: text(aggregateId),
    occurred_at: new Date(occurredAt).toISOString(),
    payload: object(payload),
    correlation_id: text(correlationId),
    causation_id: text(causationId),
    source: text(source || 'erp-backend'),
  };
  validateChannelEvent(event);
  return event;
};

export class ChannelOutboxPublisher {
  constructor({ executor = db, flags = getChannelGatewayFeatureFlags() } = {}) {
    this.executor = executor;
    this.flags = flags;
  }

  withExecutor(executor) { return new ChannelOutboxPublisher({ executor, flags: this.flags }); }

  async publish(eventInput) {
    if (!this.flags.enabled || (!this.flags.shadowMode && !this.flags.outboundEnabled && !this.flags.inboundEnabled)) {
      return { published: false, reason: 'channel_gateway_disabled' };
    }
    const event = buildChannelEvent(eventInput);
    const result = await this.executor.query(`
      INSERT INTO erp_channel_outbox_events (
        event_id, event_type, event_version, tenant_id, aggregate_type, aggregate_id,
        occurred_at, payload, payload_fingerprint, correlation_id, causation_id, source
      ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING *
    `, [event.event_id, event.event_type, event.event_version, event.tenant_id,
      event.aggregate_type, event.aggregate_id, event.occurred_at, JSON.stringify(event.payload),
      fingerprint(event.payload), event.correlation_id || null, event.causation_id || null, event.source]);
    return { published: result.rowCount > 0, duplicate: result.rowCount === 0, event, row: result.rows[0] || null };
  }

  publishInboundMessageEvent(input = {}) {
    return this.publishMessageCreatedEvent({ ...input, direction: 'incoming' });
  }

  publishOutboundMessageRequestedEvent(input = {}) {
    return this.publish({ ...input, eventType: 'message.outbound_requested', aggregateType: 'message' });
  }

  publishMessageCreatedEvent(input = {}) {
    return this.publish({ ...input, eventType: 'message.created', aggregateType: 'message' });
  }

  publishMessageStatusChangedEvent(input = {}) {
    return this.publish({ ...input, eventType: 'message.status_changed', aggregateType: 'message' });
  }

  publishConversationUpdatedEvent(input = {}) {
    return this.publish({ ...input, eventType: 'conversation.updated', aggregateType: 'conversation' });
  }

  publishConversationCreatedEvent(input = {}) {
    return this.publish({ ...input, eventType: 'conversation.created', aggregateType: 'conversation' });
  }

  publishHumanTakeoverChangedEvent(input = {}) {
    return this.publish({ ...input, eventType: 'human_takeover.changed', aggregateType: 'conversation' });
  }

  publishAssignmentChangedEvent(input = {}) {
    return this.publish({ ...input, eventType: 'assignment.changed', aggregateType: 'conversation' });
  }
}

export const channelOutboxPublisher = new ChannelOutboxPublisher();
