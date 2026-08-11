// AI Studio Phase 10 — Inbound Omnichannel Intake (human-approved AI replies).
// ---------------------------------------------------------------------------
// A THIN, additive, default-OFF intake that runs AFTER an inbound customer message has been persisted
// canonically (ai_support_messages / ai_support_sessions / ai_channel_conversations). It pre-generates a
// GROUNDED reply SUGGESTION by reusing the EXISTING grounded pipeline (generateAiInboxReply) — it does
// NOT send, does NOT create a second inbox, and does NOT run a second AI brain. The employee approves,
// edits, or rejects the suggestion in the existing AI Inbox and sends via the existing canonical send
// path (messaging.send_customer stays SENSITIVE / human-approved).
//
// Hard guarantees:
//  - Default OFF: global env AI_INBOUND_WORKFLOWS_ENABLED (false) AND per-tenant inbound_ai_mode ('off').
//  - Text-only; outbound echoes and non-text are skipped.
//  - Respects human_takeover / closed / ai_enabled=false (never fights the employee).
//  - Never double-processes: skips when the existing autonomous path already auto-sends (fully_automatic).
//  - Idempotent: one suggestion per inbound provider message (namespaced ai_inbound_ai_reply_locks).
//  - Failure-isolated: NEVER throws into the webhook — a failure leaves the message safely in the Inbox.
//  - No autonomous send. No provider call here.

import db from "../database/db.js";
import { writeAudit } from "./aiWorkflowService.js";

export const INBOUND_AI_MODES = Object.freeze(["off", "suggest_only", "approval_reply"]);
export const INTAKE_OUTCOMES = Object.freeze(["suggested", "skipped", "error"]);

// Global kill switch (default OFF). Manual AI Inbox operation is unaffected when this is off.
export const isInboundWorkflowsEnabled = () => String(process.env.AI_INBOUND_WORKFLOWS_ENABLED || "").toLowerCase() === "true";

let schemaReady = null;
export const ensureInboundIntakeSchema = async (client = db) => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    // Per-tenant mode lives with the other AI-workflow tenant settings (like restock_messaging_mode).
    await client.query(`ALTER TABLE ai_workflow_tenant_settings ADD COLUMN IF NOT EXISTS inbound_ai_mode TEXT NOT NULL DEFAULT 'off'`);
    // Bounded, sanitized observability log (NO message text, NO secrets, NO raw payloads).
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_inbound_intake_log (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        channel TEXT NULL,
        conversation_id TEXT NULL,
        canonical_message_id BIGINT NULL,
        provider_message_id TEXT NULL,
        intent TEXT NULL,
        outcome TEXT NOT NULL,
        confidence NUMERIC NULL,
        reason TEXT NULL,
        duration_ms INT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_inbound_intake_log_tenant ON ai_inbound_intake_log (tenant_id, created_at DESC)`);
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
};

export const getInboundAiMode = async (tenantId) => {
  await ensureInboundIntakeSchema();
  const r = await db.query(`SELECT inbound_ai_mode FROM ai_workflow_tenant_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  const m = r.rows[0]?.inbound_ai_mode;
  return INBOUND_AI_MODES.includes(m) ? m : "off";
};

export const setInboundAiMode = async (tenantId, mode, userId) => {
  await ensureInboundIntakeSchema();
  if (!INBOUND_AI_MODES.includes(mode)) { const e = new Error(`Invalid inbound AI mode: ${mode}`); e.status = 400; throw e; }
  await db.query(
    `INSERT INTO ai_workflow_tenant_settings (tenant_id, inbound_ai_mode, updated_by, updated_at)
     VALUES ($1,$2,$3,NOW()) ON CONFLICT (tenant_id) DO UPDATE SET inbound_ai_mode = EXCLUDED.inbound_ai_mode, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [tenantId, mode, userId || null]
  );
  await writeAudit({ tenantId, userId, action: "inbound_ai.mode", entityType: "tenant", entityId: tenantId, details: { mode } });
  return mode;
};

const logIntake = async (row) => {
  try {
    await db.query(
      `INSERT INTO ai_inbound_intake_log (tenant_id, channel, conversation_id, canonical_message_id, provider_message_id, intent, outcome, confidence, reason, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.tenantId, row.channel || null, row.conversationId || null, row.canonicalMessageId || null, row.providerMessageId || null, row.intent || null, row.outcome, row.confidence ?? null, row.reason || null, row.durationMs ?? null]
    );
  } catch { /* observability is best-effort; never affect the caller */ }
};

// The intake. NEVER throws. Returns a small result object. Generates a grounded suggestion DRAFT via the
// existing pipeline (no send). Every early return is a deliberate, documented skip.
export const handleInboundMessageIntake = async ({ tenantId, channel, conversationId, canonicalMessageId = null, providerMessageId = "", text = "", fromMe = false, autoReplyMode = "", autoSent = false } = {}) => {
  const startedAt = Date.now();
  try {
    if (!isInboundWorkflowsEnabled()) return { skipped: true, reason: "global_disabled" };
    if (!tenantId || !channel || !conversationId) return { skipped: true, reason: "missing_context" };
    if (fromMe) return { skipped: true, reason: "outbound_echo" };
    if (autoSent || String(autoReplyMode || "").toLowerCase() === "fully_automatic") return { skipped: true, reason: "autonomous_channel" }; // never double-process
    const body = String(text || "").trim();
    if (!body) return { skipped: true, reason: "non_text" }; // Phase 10 is text-only

    const mode = await getInboundAiMode(tenantId);
    if (mode === "off") return { skipped: true, reason: "tenant_mode_off" };

    // Respect human takeover / AI-disabled (cheap pre-check; generateAiInboxReply also hard-blocks these).
    const { getAiSupportConversationState } = await import("./aiSupportLogService.js");
    const state = await getAiSupportConversationState({ tenantId, sessionId: conversationId }).catch(() => null);
    if (state && (["human_takeover", "closed"].includes(String(state.status || "")) || state.ai_enabled === false)) {
      await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, outcome: "skipped", reason: "human_controlled", durationMs: Date.now() - startedAt });
      return { skipped: true, reason: "human_controlled" };
    }

    // Idempotency: one suggestion per inbound provider message. Namespaced channel so it can never collide
    // with the existing autonomous auto-reply lock on the same provider_message_id.
    const { claimAiInboxReplyLock } = await import("./aiSupportLogService.js");
    const lockKey = providerMessageId || (canonicalMessageId != null ? `cmid:${canonicalMessageId}` : "");
    const lock = await claimAiInboxReplyLock({ tenantId, channel: `p10:${channel}`, conversationId, providerMessageId: lockKey, triggerSource: "inbound_intake" });
    if (!lock.claimed) return { skipped: true, reason: "duplicate_intake" };

    // Reuse the EXISTING grounded suggestion pipeline. It persists a draft (ai_support_sessions
    // .last_ai_reply_draft, status 'not_sent') and NEVER sends. This is the single AI brain.
    const { generateAiInboxReply } = await import("./aiSalesAgentService.js");
    let result;
    try {
      result = await generateAiInboxReply({ tenantId, conversationId, persist: true });
    } catch (genErr) {
      const reason = genErr?.code || String(genErr?.message || genErr).slice(0, 80);
      await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, outcome: "skipped", reason: `generation_blocked:${reason}`, durationMs: Date.now() - startedAt });
      return { skipped: true, reason: `generation_blocked:${reason}` };
    }

    const intent = result?.suggestion?.detected_intent || result?.draft?.detected_intent || result?.ai_reply_draft?.detected_intent || result?.intent || null;
    const confidence = Number.isFinite(result?.confidence_engine?.score) ? result.confidence_engine.score
      : Number.isFinite(result?.suggestion?.confidence) ? result.suggestion.confidence : null;
    await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, intent, outcome: "suggested", confidence, reason: mode, durationMs: Date.now() - startedAt });
    await writeAudit({ tenantId, userId: null, action: "inbound_ai.suggested", entityType: "ai_support_session", entityId: null, details: { channel, conversation_id: conversationId, provider_message_id: providerMessageId, intent, mode } });
    return { ok: true, suggested: true, intent, confidence, mode };
  } catch (e) {
    // Failure isolation: a Phase 10 failure must NEVER break inbound persistence or the webhook.
    try { await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, outcome: "error", reason: String(e?.message || e).slice(0, 120), durationMs: Date.now() - startedAt }); } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
};

// Read APIs (AI Studio observability).
export const getInboundIntakeStats = async (tenantId, { limit = 20 } = {}) => {
  await ensureInboundIntakeSchema();
  const counts = (await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE outcome='suggested')::int AS suggested,
       COUNT(*) FILTER (WHERE outcome='skipped')::int AS skipped,
       COUNT(*) FILTER (WHERE outcome='error')::int AS errored
     FROM ai_inbound_intake_log WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
    [tenantId]
  )).rows[0] || { suggested: 0, skipped: 0, errored: 0 };
  const recent = (await db.query(
    `SELECT id, channel, conversation_id, intent, outcome, confidence, reason, duration_ms, created_at
       FROM ai_inbound_intake_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, Math.min(Number(limit) || 20, 100)]
  )).rows;
  return { counts, recent };
};
