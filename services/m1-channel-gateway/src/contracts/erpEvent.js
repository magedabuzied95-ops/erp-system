export const ERP_EVENT_VERSION = 1;
export const ERP_EVENT_TYPES = Object.freeze([
  'conversation.created', 'conversation.updated', 'message.created',
  'message.outbound_requested', 'message.status_changed',
  'human_takeover.changed', 'assignment.changed',
]);

const text = (value = '') => String(value ?? '').trim();

export function normalizeErpEvent(row = {}) {
  const event = {
    event_id: text(row.event_id),
    event_type: text(row.event_type),
    event_version: Number(row.event_version),
    tenant_id: Number(row.tenant_id),
    aggregate_type: text(row.aggregate_type),
    aggregate_id: text(row.aggregate_id),
    occurred_at: new Date(row.occurred_at).toISOString(),
    payload: row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {},
    correlation_id: text(row.correlation_id),
    causation_id: text(row.causation_id),
    source: text(row.source),
  };
  validateErpEvent(event);
  return event;
}

export function validateErpEvent(event = {}) {
  const errors = [];
  if (!text(event.event_id)) errors.push('event_id_required');
  if (!ERP_EVENT_TYPES.includes(text(event.event_type))) errors.push('unsupported_event_type');
  if (Number(event.event_version) !== ERP_EVENT_VERSION) errors.push('unsupported_event_version');
  if (!Number.isFinite(Number(event.tenant_id)) || Number(event.tenant_id) <= 0) errors.push('invalid_tenant_id');
  if (!text(event.aggregate_type)) errors.push('aggregate_type_required');
  if (!text(event.aggregate_id)) errors.push('aggregate_id_required');
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) errors.push('payload_required');
  if (errors.length) {
    throw Object.assign(new Error(`Invalid ERP event: ${errors.join(', ')}`), {
      code: errors.includes('unsupported_event_version') ? 'UNSUPPORTED_EVENT_VERSION' : 'INVALID_ERP_EVENT',
      errors,
    });
  }
  return true;
}
