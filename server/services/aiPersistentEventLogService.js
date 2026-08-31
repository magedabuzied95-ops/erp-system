import db from "../database/db.js";

const text = (value = "", fallback = "") => String(value ?? fallback).trim();
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};
const json = (value) => JSON.stringify(value === undefined ? null : value);
const safeJson = (value, depth = 0) => {
  if (depth > 6) return "[max_depth]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeJson(item, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value).slice(0, 120)) {
      out[key] = safeJson(child, depth + 1);
    }
    return out;
  }
  return text(value);
};

let schemaReadyPromise = null;

export const ensureAIPersistentEventLogSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_event_logs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          category TEXT NOT NULL DEFAULT '',
          event_type TEXT NOT NULL DEFAULT '',
          conversation_id TEXT NOT NULL DEFAULT '',
          session_id TEXT NOT NULL DEFAULT '',
          channel TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          error JSONB NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_event_logs_tenant_created ON ai_event_logs (tenant_id, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_event_logs_tenant_category_created ON ai_event_logs (tenant_id, category, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_event_logs_tenant_type_created ON ai_event_logs (tenant_id, event_type, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_event_logs_conversation_created ON ai_event_logs (tenant_id, conversation_id, created_at DESC)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

export const logAIPersistentEvent = async ({
  tenantId,
  category = "",
  eventType = "",
  conversationId = "",
  sessionId = "",
  channel = "",
  source = "",
  reason = "",
  message = "",
  error = null,
  metadata = {},
} = {}) => {
  const safeTenantId = number(tenantId);
  const safeCategory = text(category);
  const safeEventType = text(eventType);
  if (!safeTenantId || !safeCategory || !safeEventType) return null;
  try {
    await ensureAIPersistentEventLogSchema();
    const result = await db.query(
      `
      INSERT INTO ai_event_logs (
        tenant_id, category, event_type, conversation_id, session_id, channel, source, reason, message, error, metadata, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,NOW())
      RETURNING *
      `,
      [
        safeTenantId,
        safeCategory,
        safeEventType,
        text(conversationId),
        text(sessionId),
        text(channel),
        text(source),
        text(reason),
        text(message),
        error ? json(safeJson(error)) : null,
        json(safeJson(metadata || {})),
      ]
    );
    return result.rows[0] || null;
  } catch (logError) {
    console.warn("[ai-event-log] persist failed", {
      tenant_id: safeTenantId,
      category: safeCategory,
      event_type: safeEventType,
      message: logError?.message || "failed",
    });
    return null;
  }
};
