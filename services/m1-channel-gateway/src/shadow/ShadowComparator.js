const text = (value = '') => String(value ?? '').trim();

const differenceOf = (expected, actual, keys) => Object.fromEntries(keys.flatMap((key) => {
  const left = expected[key] ?? null;
  const right = actual[key] ?? null;
  return String(left ?? '') === String(right ?? '') ? [] : [[key, { expected: left, actual: right }]];
}));

export class ShadowComparator {
  constructor(pool) { this.pool = pool; }

  async compare(event) {
    if (event.aggregate_type === 'message') return this.#compareMessage(event);
    if (event.aggregate_type === 'conversation') return this.#compareConversation(event);
    return {
      status: 'unsupported', expected: { aggregate_type: event.aggregate_type },
      actual: {}, difference: { aggregate_type: 'unsupported' }, internalEntityId: event.aggregate_id,
    };
  }

  async #compareMessage(event) {
    const result = await this.pool.query(`
      SELECT id, tenant_id, session_id, channel, sender_type, message_type, delivery_status,
        external_message_id, provider_message_id, idempotency_key
      FROM ai_support_messages WHERE tenant_id = $1 AND id = $2::bigint LIMIT 1
    `, [event.tenant_id, event.aggregate_id]);
    const row = result.rows[0];
    const payload = event.payload || {};
    const [mappingResult, connectionResult] = await Promise.all([
      this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM channel_conversation_map
          WHERE tenant_id = $1 AND (
            internal_conversation_id = $2 OR external_conversation_id = $2
          )
        ) present
      `, [event.tenant_id, text(payload.conversation_id)]),
      this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM channel_connections WHERE tenant_id = $1 AND channel = $2
        ) present
      `, [event.tenant_id, text(payload.channel)]),
    ]);
    const expected = {
      tenant_id: event.tenant_id,
      message_id: text(event.aggregate_id),
      conversation_id: text(payload.conversation_id),
      channel: text(payload.channel),
      direction: text(payload.direction),
      message_type: text(payload.message_type),
      status: text(payload.status),
      idempotency_key: text(payload.idempotency_key),
      conversation_mapping_present: true,
      channel_connection_present: true,
    };
    const actual = row ? {
      tenant_id: Number(row.tenant_id),
      message_id: text(row.id),
      conversation_id: text(row.session_id),
      channel: text(row.channel),
      direction: row.sender_type === 'customer' ? 'incoming' : 'outgoing',
      message_type: text(row.message_type),
      status: text(row.delivery_status),
      idempotency_key: text(row.idempotency_key),
      conversation_mapping_present: mappingResult.rows[0]?.present === true,
      channel_connection_present: connectionResult.rows[0]?.present === true,
    } : { missing: true };
    const keys = ['tenant_id', 'message_id', 'conversation_id', 'channel', 'direction', 'message_type', 'status',
      'idempotency_key', 'conversation_mapping_present', 'channel_connection_present'];
    const difference = row ? differenceOf(expected, actual, keys) : { entity: { expected: 'present', actual: 'missing' } };
    return {
      status: Object.keys(difference).length ? 'mismatched' : 'matched',
      expected, actual, difference, internalEntityId: text(event.aggregate_id),
    };
  }

  async #compareConversation(event) {
    const result = await this.pool.query(`
      SELECT id, tenant_id, session_id, channel, status, ai_enabled,
        assigned_user_id, assigned_user_name
      FROM ai_support_sessions WHERE tenant_id = $1 AND session_id = $2 LIMIT 1
    `, [event.tenant_id, event.aggregate_id]);
    const row = result.rows[0];
    const payload = event.payload || {};
    const expected = {
      tenant_id: event.tenant_id,
      conversation_id: text(event.aggregate_id),
      channel: text(payload.channel),
      status: text(payload.status),
      ai_enabled: payload.ai_enabled !== false,
      assigned_user_id: payload.assigned_user_id || null,
    };
    const actual = row ? {
      tenant_id: Number(row.tenant_id),
      conversation_id: text(row.session_id),
      channel: text(row.channel),
      status: text(row.status),
      ai_enabled: row.ai_enabled !== false,
      assigned_user_id: row.assigned_user_id || null,
    } : { missing: true };
    const difference = row
      ? differenceOf(expected, actual, ['tenant_id', 'conversation_id', 'channel', 'status', 'ai_enabled', 'assigned_user_id'])
      : { entity: { expected: 'present', actual: 'missing' } };
    return {
      status: Object.keys(difference).length ? 'mismatched' : 'matched',
      expected, actual, difference, internalEntityId: text(event.aggregate_id),
    };
  }
}
