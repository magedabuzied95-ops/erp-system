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
    // Phase 11: per-channel assisted enablement for staged rollout (default '{}' = all channels OFF).
    await client.query(`ALTER TABLE ai_workflow_tenant_settings ADD COLUMN IF NOT EXISTS inbound_ai_channels JSONB NOT NULL DEFAULT '{}'::jsonb`);
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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

// Phase 11 — per-channel assisted enablement (staged rollout). Server is authoritative.
export const ASSISTED_CHANNELS = Object.freeze(["facebook_messenger", "instagram", "whatsapp", "telegram"]);
const normalizeAssistedChannel = (ch) => { const c = String(ch || "").toLowerCase(); return c === "facebook" || c === "messenger" || c === "meta_messenger" ? "facebook_messenger" : c === "instagram_dm" ? "instagram" : c; };

export const getInboundAiChannels = async (tenantId) => {
  await ensureInboundIntakeSchema();
  const r = await db.query(`SELECT inbound_ai_channels FROM ai_workflow_tenant_settings WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  const raw = r.rows[0]?.inbound_ai_channels || {};
  const out = {};
  for (const ch of ASSISTED_CHANNELS) out[ch] = raw[ch] === true;
  return out;
};

export const setInboundAiChannel = async (tenantId, channel, enabled, userId) => {
  await ensureInboundIntakeSchema();
  const ch = normalizeAssistedChannel(channel);
  if (!ASSISTED_CHANNELS.includes(ch)) { const e = new Error(`Invalid assisted channel: ${channel}`); e.status = 400; throw e; }
  const current = await getInboundAiChannels(tenantId);
  const next = { ...current, [ch]: enabled === true };
  await db.query(
    `INSERT INTO ai_workflow_tenant_settings (tenant_id, inbound_ai_channels, updated_by, updated_at)
     VALUES ($1,$2::jsonb,$3,NOW()) ON CONFLICT (tenant_id) DO UPDATE SET inbound_ai_channels = EXCLUDED.inbound_ai_channels, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [tenantId, JSON.stringify(next), userId || null]
  );
  await writeAudit({ tenantId, userId, action: "inbound_ai.channel", entityType: "tenant", entityId: tenantId, details: { channel: ch, enabled: enabled === true } });
  return next;
};

// Phase 11 metric: record a send-side assisted outcome (approved / stale / rejected) into the same log.
export const recordAssistedOutcome = async ({ tenantId, channel, conversationId, outcome, reason = "" } = {}) => {
  await logIntake({ tenantId, channel: normalizeAssistedChannel(channel), conversationId, outcome: String(outcome || "").slice(0, 40), reason });
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

// ---- Burst coalescing (process-local; §12 says stale protection is the correctness layer, this is an
// optimization). No Redis/Bull; a simple per-conversation debounce that regenerates from the latest context.
const DEBOUNCE_MS = Math.max(0, Number(process.env.AI_INBOUND_DEBOUNCE_MS || 2500));
const pendingByConversation = new Map();

// Claim idempotency + generate ONE grounded draft from the latest conversation context. Never throws.
const runInboundGeneration = async ({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, mode }) => {
  const startedAt = Date.now();
  try {
    const { claimAiInboxReplyLock } = await import("./aiSupportLogService.js");
    const lockKey = providerMessageId || (canonicalMessageId != null ? `cmid:${canonicalMessageId}` : "");
    const lock = await claimAiInboxReplyLock({ tenantId, channel: `p10:${channel}`, conversationId, providerMessageId: lockKey, triggerSource: "inbound_intake" });
    if (!lock.claimed) return { skipped: true, reason: "duplicate_intake" };
    // Reuse the EXISTING grounded pipeline; it persists a not_sent draft and NEVER sends. One brain.
    const { generateAiInboxReply } = await import("./aiSalesAgentService.js");
    let result;
    try {
      result = await generateAiInboxReply({ tenantId, conversationId, persist: true, sourceMessageId: canonicalMessageId });
    } catch (genErr) {
      const reason = genErr?.code || String(genErr?.message || genErr).slice(0, 80);
      await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, outcome: "skipped", reason: `generation_blocked:${reason}`, durationMs: Date.now() - startedAt });
      return { skipped: true, reason: `generation_blocked:${reason}` };
    }
    const intent = result?.suggestion?.detected_intent || result?.draft?.detected_intent || result?.ai_reply_draft?.detected_intent || result?.intent || null;
    const confidence = Number.isFinite(result?.confidence_engine?.score) ? result.confidence_engine.score
      : Number.isFinite(result?.suggestion?.confidence) ? result.suggestion.confidence : null;
    await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, intent, outcome: "suggested", confidence, reason: mode, durationMs: Date.now() - startedAt });
    await writeAudit({ tenantId, userId: null, action: "inbound_ai.suggested", entityType: "ai_support_session", entityId: null, details: { channel, conversation_id: conversationId, intent, mode } });
    return { ok: true, suggested: true, intent, confidence, mode };
  } catch (e) {
    try { await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, outcome: "error", reason: String(e?.message || e).slice(0, 120), durationMs: Date.now() - startedAt }); } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
};

const scheduleDebouncedGeneration = (args) => {
  const key = `${args.tenantId}:${args.conversationId}`;
  const existing = pendingByConversation.get(key);
  if (existing) { existing.latest = args; return { scheduled: true, coalesced: true }; } // a burst → keep only the latest
  const entry = { latest: args };
  entry.timer = setTimeout(() => { pendingByConversation.delete(key); runInboundGeneration(entry.latest).catch(() => {}); }, DEBOUNCE_MS);
  if (entry.timer && typeof entry.timer.unref === "function") entry.timer.unref();
  pendingByConversation.set(key, entry);
  return { scheduled: true };
};

// The intake. NEVER throws. Returns a small result object. Schedules a grounded suggestion DRAFT via the
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

    // Phase 11: per-channel staged rollout — the channel must be explicitly assisted-enabled (default off).
    const channels = await getInboundAiChannels(tenantId);
    if (!channels[normalizeAssistedChannel(channel)]) return { skipped: true, reason: "channel_not_assisted" };

    // Respect human takeover / AI-disabled (cheap pre-check; generateAiInboxReply also hard-blocks these).
    const { getAiSupportConversationState } = await import("./aiSupportLogService.js");
    const state = await getAiSupportConversationState({ tenantId, sessionId: conversationId }).catch(() => null);
    if (state && (["human_takeover", "closed"].includes(String(state.status || "")) || state.ai_enabled === false)) {
      await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, outcome: "skipped", reason: "human_controlled", durationMs: Date.now() - startedAt });
      return { skipped: true, reason: "human_controlled" };
    }

    // Phase 11: coalesce rapid bursts into ONE suggestion per conversation (debounced), generated from the
    // LATEST context. The idempotency lock + grounded generation run inside the debounced task. Server-side
    // stale protection at send time is the correctness layer (§12); this debounce is an optimization.
    return scheduleDebouncedGeneration({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, mode });
  } catch (e) {
    // Failure isolation: a Phase 10 failure must NEVER break inbound persistence or the webhook.
    try { await logIntake({ tenantId, channel, conversationId, canonicalMessageId, providerMessageId, outcome: "error", reason: String(e?.message || e).slice(0, 120), durationMs: Date.now() - startedAt }); } catch { /* ignore */ }
    return { ok: false, error: String(e?.message || e).slice(0, 160) };
  }
};

// Read APIs (AI Studio observability). Metrics come from real data only (no invented quality scores).
const windowCounts = async (tenantId, interval) => (await db.query(
  `SELECT
     COUNT(*) FILTER (WHERE outcome='suggested')::int AS generated,
     COUNT(*) FILTER (WHERE outcome='approved')::int AS approved,
     COUNT(*) FILTER (WHERE outcome='approved' AND reason='edited')::int AS approved_edited,
     COUNT(*) FILTER (WHERE outcome='approved' AND reason='unchanged')::int AS approved_unchanged,
     COUNT(*) FILTER (WHERE outcome='stale')::int AS stale,
     COUNT(*) FILTER (WHERE outcome='skipped')::int AS skipped,
     COUNT(*) FILTER (WHERE outcome='error')::int AS errored
   FROM ai_inbound_intake_log WHERE tenant_id = $1 AND created_at > NOW() - $2::interval`,
  [tenantId, interval]
)).rows[0] || {};

export const getInboundIntakeStats = async (tenantId, { limit = 20 } = {}) => {
  await ensureInboundIntakeSchema();
  const [last24h, last7d, channels] = await Promise.all([
    windowCounts(tenantId, "24 hours"),
    windowCounts(tenantId, "7 days"),
    getInboundAiChannels(tenantId),
  ]);
  const byChannel = (await db.query(
    `SELECT channel,
        COUNT(*) FILTER (WHERE outcome='suggested')::int AS generated,
        COUNT(*) FILTER (WHERE outcome='approved')::int AS approved,
        COUNT(*) FILTER (WHERE outcome='stale')::int AS stale
      FROM ai_inbound_intake_log WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '7 days' AND channel IS NOT NULL
      GROUP BY channel`, [tenantId]
  )).rows;
  const recent = (await db.query(
    `SELECT id, channel, conversation_id, intent, outcome, confidence, reason, duration_ms, created_at
       FROM ai_inbound_intake_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, Math.min(Number(limit) || 20, 100)]
  )).rows;
  // Back-compat shape (Phase 10 `counts`) + Phase 11 windows/channels.
  return { counts: { suggested: last7d.generated || 0, skipped: last7d.skipped || 0, errored: last7d.errored || 0 }, last24h, last7d, channels, byChannel, recent };
};
