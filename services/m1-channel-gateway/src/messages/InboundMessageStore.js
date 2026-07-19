import { withTransaction } from '../db/pool.js';
import { normalizeChannelEnvelope } from '../contracts/channelEnvelope.js';

export class InboundMessageStore {
  constructor(pool) {
    this.pool = pool;
  }

  async accept(input) {
    const envelope = normalizeChannelEnvelope({ ...input, direction: 'inbound' });
    return withTransaction(this.pool, async (client) => {
      const eventKey = envelope.external_message_id
        ? `${envelope.channel}:${envelope.connection_id}:${envelope.external_message_id}`
        : `dedupe:${envelope.connection_id}:${envelope.external_conversation_id}:${envelope.dedupe_hash}`;
      const inserted = await client.query(`
        INSERT INTO channel_inbound_events (
          event_key, tenant_id, connection_id, channel, external_conversation_id,
          external_message_id, dedupe_hash, raw_payload, normalized_payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
        ON CONFLICT DO NOTHING RETURNING *
      `, [eventKey, envelope.tenant_id, envelope.connection_id, envelope.channel,
        envelope.external_conversation_id, envelope.external_message_id || null, envelope.dedupe_hash,
        JSON.stringify(envelope.raw), JSON.stringify(envelope)]);
      if (!inserted.rowCount) {
        const existing = await client.query(`
          SELECT * FROM channel_inbound_events
          WHERE connection_id = $1 AND (
            ($2::text IS NOT NULL AND external_message_id = $2)
            OR (external_conversation_id = $3 AND dedupe_hash = $4)
          ) ORDER BY id LIMIT 1
        `, [envelope.connection_id, envelope.external_message_id || null,
          envelope.external_conversation_id, envelope.dedupe_hash]);
        return { event: existing.rows[0], duplicate: true, envelope };
      }

      const event = inserted.rows[0];
      const conversationMap = await client.query(`
        INSERT INTO channel_conversation_map (
          tenant_id, connection_id, external_conversation_id, external_customer_id,
          last_message_at, metadata, external_username, external_display_name,
          conversation_fingerprint, identity_confidence, last_verified_at
        ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
        ON CONFLICT (connection_id, external_conversation_id) DO UPDATE SET
          external_customer_id = COALESCE(NULLIF(EXCLUDED.external_customer_id, ''), channel_conversation_map.external_customer_id),
          external_username = COALESCE(NULLIF(EXCLUDED.external_username, ''), channel_conversation_map.external_username),
          external_display_name = COALESCE(NULLIF(EXCLUDED.external_display_name, ''), channel_conversation_map.external_display_name),
          conversation_fingerprint = COALESCE(NULLIF(EXCLUDED.conversation_fingerprint, ''), channel_conversation_map.conversation_fingerprint),
          identity_confidence = COALESCE(NULLIF(EXCLUDED.identity_confidence, ''), channel_conversation_map.identity_confidence),
          last_verified_at = COALESCE(EXCLUDED.last_verified_at, channel_conversation_map.last_verified_at),
          metadata = channel_conversation_map.metadata || EXCLUDED.metadata,
          last_message_at = GREATEST(channel_conversation_map.last_message_at, EXCLUDED.last_message_at),
          updated_at = NOW()
        RETURNING id, internal_conversation_id
      `, [envelope.tenant_id, envelope.connection_id, envelope.external_conversation_id,
        envelope.sender_id || null, envelope.occurred_at, JSON.stringify({ source: envelope.metadata?.source || 'channel_gateway' }),
        envelope.metadata?.external_username || null, envelope.metadata?.external_display_name || null,
        envelope.metadata?.conversation_fingerprint || null, envelope.metadata?.identity_confidence || null,
        envelope.metadata?.identity_confidence ? new Date().toISOString() : null]);
      const map = conversationMap.rows[0];
      await client.query(`
        INSERT INTO channel_message_map (
          tenant_id, connection_id, conversation_map_id, external_conversation_id,
          external_message_id, direction, status, dedupe_hash, provider_timestamp, metadata
        ) VALUES ($1,$2,$3,$4,$5,'inbound','accepted',$6,$7,$8::jsonb)
        ON CONFLICT DO NOTHING
      `, [envelope.tenant_id, envelope.connection_id, map.id, envelope.external_conversation_id,
        envelope.external_message_id || null, envelope.dedupe_hash, envelope.occurred_at,
        JSON.stringify({ event_id: envelope.event_id })]);
      await client.query(`
        INSERT INTO channel_gateway_outbox_events (
          event_key, tenant_id, aggregate_type, aggregate_id, event_type, payload
        ) VALUES ($1,$2,'channel_inbound_event',$3,'channel.message.accepted',$4::jsonb)
      `, [`outbox:${eventKey}`, envelope.tenant_id, String(event.id), JSON.stringify({
        version: envelope.version,
        event_id: envelope.event_id,
        inbound_event_id: event.id,
        connection_id: envelope.connection_id,
        external_conversation_id: envelope.external_conversation_id,
        conversation_map_id: map.id,
        internal_conversation_id: map.internal_conversation_id,
      })]);
      return { event, duplicate: false, envelope };
    });
  }
}
