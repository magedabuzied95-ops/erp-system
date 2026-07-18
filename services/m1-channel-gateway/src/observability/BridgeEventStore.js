import { randomUUID } from 'node:crypto';

export class BridgeEventStore {
  constructor(pool) { this.pool = pool; }

  async record({ eventKey = randomUUID(), tenantId, connectionId = null, severity = 'info',
    eventType, externalConversationId = null, jobKey = null, details = {} }) {
    const result = await this.pool.query(`
      INSERT INTO bridge_events (
        event_key, tenant_id, connection_id, severity, event_type,
        external_conversation_id, job_key, details
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT (event_key) DO NOTHING RETURNING *
    `, [eventKey, tenantId, connectionId, severity, eventType,
      externalConversationId, jobKey, JSON.stringify(details)]);
    return result.rows[0] || null;
  }
}
