import db from "../database/db.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

let schemaReady = false;

const safeString = (value = "", limit = 4000) => {
  const raw = String(value ?? "");
  return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
};

const safeJsonValue = (value, depth = 0) => {
  if (depth > 8) return "[max_depth]";
  if (value === null || value === undefined) return value === undefined ? null : value;
  if (typeof value === "string") return safeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 120).map((item) => safeJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, 160)) {
      out[key] = safeJsonValue(child, depth + 1);
    }
    return out;
  }
  return safeString(value);
};

const traceIdFrom = (traceOrId) => number(typeof traceOrId === "object" ? traceOrId?.id : traceOrId, 0);

export const ensureAiReplyTraceSchema = async () => {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_reply_traces (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      channel TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      inbound_message_id BIGINT NULL,
      external_message_id TEXT NOT NULL DEFAULT '',
      trace JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'running',
      error JSONB NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TIMESTAMP NULL
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_reply_traces_session
    ON ai_reply_traces (tenant_id, channel, session_id, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_reply_traces_external
    ON ai_reply_traces (tenant_id, external_message_id)
  `);
  schemaReady = true;
};

export const startTrace = async ({
  tenantId,
  channel = "whatsapp",
  sessionId = "",
  inboundMessageId = null,
  externalMessageId = "",
  metadata = {},
} = {}) => {
  try {
    await ensureAiReplyTraceSchema();
    const safeTenantId = number(tenantId, number(process.env.WHATSAPP_TENANT_ID, 1));
    const trace = {
      metadata: safeJsonValue(metadata || {}),
      steps: [],
    };
    const result = await db.query(
      `
      INSERT INTO ai_reply_traces (tenant_id, channel, session_id, inbound_message_id, external_message_id, trace, status)
      VALUES ($1, $2::text, $3::text, $4, $5::text, $6::jsonb, 'running')
      RETURNING *
      `,
      [safeTenantId, text(channel, "whatsapp"), text(sessionId), inboundMessageId || null, text(externalMessageId), JSON.stringify(trace)]
    );
    const row = result.rows[0] || null;
    console.info("[ai-trace:start]", {
      trace_id: row?.id || null,
      tenant_id: safeTenantId,
      channel: text(channel, "whatsapp"),
      session_id: text(sessionId),
      external_message_id: text(externalMessageId),
    });
    return row;
  } catch (error) {
    console.error("[ai-trace:error]", {
      phase: "start",
      message: error?.message || String(error),
      channel,
      session_id: sessionId,
    });
    return null;
  }
};

export const addTraceStep = async (traceOrId, step, data = {}) => {
  const traceId = traceIdFrom(traceOrId);
  if (!traceId || !step) return null;
  try {
    await ensureAiReplyTraceSchema();
    const entry = {
      step: text(step),
      at: new Date().toISOString(),
      data: safeJsonValue(data || {}),
    };
    const result = await db.query(
      `
      UPDATE ai_reply_traces
      SET trace = jsonb_set(
            COALESCE(trace, '{}'::jsonb),
            '{steps}',
            COALESCE(trace->'steps', '[]'::jsonb) || $2::jsonb,
            true
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, tenant_id, channel, session_id
      `,
      [traceId, JSON.stringify([entry])]
    );
    const row = result.rows[0] || null;
    console.info("[ai-trace:step]", {
      trace_id: traceId,
      step: entry.step,
      tenant_id: row?.tenant_id || null,
      channel: row?.channel || "",
      session_id: row?.session_id || "",
    });
    return row;
  } catch (error) {
    console.error("[ai-trace:error]", {
      phase: "step",
      trace_id: traceId,
      step,
      message: error?.message || String(error),
    });
    return null;
  }
};

export const setTraceInboundMessage = async (traceOrId, inboundMessageId = null) => {
  const traceId = traceIdFrom(traceOrId);
  const messageId = number(inboundMessageId, 0);
  if (!traceId || !messageId) return null;
  try {
    await ensureAiReplyTraceSchema();
    const result = await db.query(
      `
      UPDATE ai_reply_traces
      SET inbound_message_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, inbound_message_id
      `,
      [traceId, messageId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error("[ai-trace:error]", {
      phase: "set_inbound_message",
      trace_id: traceId,
      inbound_message_id: messageId,
      message: error?.message || String(error),
    });
    return null;
  }
};

export const finishTrace = async (traceOrId, summary = {}) => {
  const traceId = traceIdFrom(traceOrId);
  if (!traceId) return null;
  try {
    await ensureAiReplyTraceSchema();
    const result = await db.query(
      `
      UPDATE ai_reply_traces
      SET trace = jsonb_set(COALESCE(trace, '{}'::jsonb), '{summary}', $2::jsonb, true),
          status = 'finished',
          updated_at = CURRENT_TIMESTAMP,
          finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
      WHERE id = $1
      RETURNING id, tenant_id, channel, session_id, status
      `,
      [traceId, JSON.stringify(safeJsonValue(summary || {}))]
    );
    const row = result.rows[0] || null;
    console.info("[ai-trace:finish]", {
      trace_id: traceId,
      tenant_id: row?.tenant_id || null,
      channel: row?.channel || "",
      session_id: row?.session_id || "",
      status: row?.status || "finished",
    });
    return row;
  } catch (error) {
    console.error("[ai-trace:error]", {
      phase: "finish",
      trace_id: traceId,
      message: error?.message || String(error),
    });
    return null;
  }
};

export const failTrace = async (traceOrId, error = {}, context = {}) => {
  const traceId = traceIdFrom(traceOrId);
  if (!traceId) return null;
  const errorPayload = {
    message: error?.message || String(error),
    causeMessage: error?.cause?.message || "",
    code: error?.code || "",
    status: error?.status || "",
    context: safeJsonValue(context || {}),
  };
  try {
    await ensureAiReplyTraceSchema();
    const result = await db.query(
      `
      UPDATE ai_reply_traces
      SET error = $2::jsonb,
          status = 'failed',
          updated_at = CURRENT_TIMESTAMP,
          finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP)
      WHERE id = $1
      RETURNING id, tenant_id, channel, session_id, status
      `,
      [traceId, JSON.stringify(errorPayload)]
    );
    const row = result.rows[0] || null;
    console.error("[ai-trace:error]", {
      trace_id: traceId,
      tenant_id: row?.tenant_id || null,
      channel: row?.channel || "",
      session_id: row?.session_id || "",
      ...errorPayload,
    });
    return row;
  } catch (writeError) {
    console.error("[ai-trace:error]", {
      phase: "fail",
      trace_id: traceId,
      message: writeError?.message || String(writeError),
      originalMessage: errorPayload.message,
    });
    return null;
  }
};

export const loadAiReplyTraces = async ({ tenantId, channel = "whatsapp", sessionId = "", limit = 10 } = {}) => {
  await ensureAiReplyTraceSchema();
  const safeLimit = Math.min(Math.max(number(limit, 10), 1), 50);
  const result = await db.query(
    `
    SELECT id, tenant_id, channel, session_id, inbound_message_id, external_message_id, trace, status, error, created_at, updated_at, finished_at
    FROM ai_reply_traces
    WHERE tenant_id = $1
      AND session_id = $2::text
      AND ($3::text = '' OR channel = $3::text)
    ORDER BY created_at DESC
    LIMIT $4
    `,
    [number(tenantId, 1), text(sessionId), text(channel), safeLimit]
  );
  return { traces: result.rows, latestTrace: result.rows[0] || null };
};

export default {
  startTrace,
  addTraceStep,
  setTraceInboundMessage,
  finishTrace,
  failTrace,
  loadAiReplyTraces,
};
