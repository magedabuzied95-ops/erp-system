// Tables for the chatbot flows. Created lazily, once per process; never on server boot.
import db from "../../../database/db.js";

let schemaReady = null;

export const ensureChatbotFlowSchema = () => {
  schemaReady ||= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS wa_chatbot_flows (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        status VARCHAR(16) NOT NULL DEFAULT 'draft',
        graph JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
        published_graph JSONB NULL,
        version INTEGER NOT NULL DEFAULT 0,
        trigger JSONB NOT NULL DEFAULT '{"type":"any_message","keywords":[]}'::jsonb,
        phone_number_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by BIGINT NULL,
        published_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS wa_chatbot_sessions (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        flow_id BIGINT NOT NULL,
        phone_number_id VARCHAR(64) NOT NULL DEFAULT '',
        conversation_key TEXT NOT NULL DEFAULT '',
        customer_phone VARCHAR(40) NOT NULL DEFAULT '',
        current_node_id TEXT NOT NULL DEFAULT '',
        vars JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(16) NOT NULL DEFAULT 'active',
        is_test BOOLEAN NOT NULL DEFAULT FALSE,
        end_reason VARCHAR(40) NOT NULL DEFAULT '',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ NULL,
        run_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    for (const ddl of [
      `CREATE INDEX IF NOT EXISTS idx_wa_chatbot_flows_tenant ON wa_chatbot_flows (tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_wa_chatbot_sessions_conv ON wa_chatbot_sessions (tenant_id, conversation_key, status)`,
      `CREATE INDEX IF NOT EXISTS idx_wa_chatbot_sessions_flow ON wa_chatbot_sessions (tenant_id, flow_id, started_at DESC)`,
    ]) {
      await db.query(ddl);
    }
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
};

export default ensureChatbotFlowSchema;
