// What the owner teaches the agent.
//
// Until this file existed there was no way to tell the agent anything it did not already know. The
// Smart Support Knowledge Base fills eleven predetermined blanks, each reachable only when the customer
// trips one of nine keyword intents that are frozen in code — so a sentence like "we don't ship to Sinai
// during Eid" had no path to a customer unless it happened to live in the one field a SHIPPING keyword
// reads. Anything written outside those blanks reached nobody, on any channel, ever.
//
// Two kinds of entry, because they answer two different needs:
//
//   • `fixed_answer` — the owner writes the trigger words AND the exact sentence. When a customer's
//     message contains a trigger, that sentence is sent verbatim. No LLM rewording, so the wording the
//     owner approved is the wording the customer reads. Enforced in aiInboxGroundingGate.
//
//   • `knowledge` — a fact about the shop with no trigger. Every enabled one is added to the agent's
//     instructions, so it can use them in its own words for any question that touches them. Enforced by
//     riding into the instruction block through loadPersona, the same door the action guidance uses.
//
// Stored in its own table, deliberately NOT in `website_settings.settings["ai_support_knowledge_base"]`:
// that blob is rewritten wholesale on every Knowledge Base save (a shallow top-level merge of a fully
// rebuilt object), which is how nine of its own fields get silently blanked. Rows in a table cannot be
// wiped by an unrelated page saving an unrelated form.

import db from "../database/db.js";

const text = (value) => String(value ?? "").trim();
const int = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const KNOWLEDGE_KINDS = Object.freeze(["fixed_answer", "knowledge"]);

// A one- or two-letter trigger matches almost every message. The floor is what stops an owner from
// accidentally routing their whole inbox into a single canned reply.
export const MIN_TRIGGER_LENGTH = 3;
export const MAX_TRIGGERS_PER_ENTRY = 12;
export const MAX_ANSWER_LENGTH = 2000;

// The instruction block is shared with the persona, the grounding rules and the action guidance. A
// knowledge list with no ceiling would crowd them out and cost tokens on every single reply.
export const MAX_KNOWLEDGE_ENTRIES_IN_PROMPT = 40;
export const MAX_KNOWLEDGE_CHARS_IN_PROMPT = 4000;

/*
 * Same normalization the support-fact matcher uses: lowercase, strip tashkeel, fold the alef/ya/ta-marbuta
 * variants, drop punctuation. A customer typing "إزاي" and an owner typing "ازاي" must meet.
 */
export const normalizeKnowledgeText = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

let schemaReadyPromise = null;

export const ensureAgentKnowledgeSchema = async (clientOrPool = db) => {
  const run = async () => {
    await clientOrPool.query(`
      CREATE TABLE IF NOT EXISTS ai_agent_knowledge (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL,
        kind VARCHAR(20) NOT NULL DEFAULT 'knowledge',
        title TEXT NOT NULL DEFAULT '',
        triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
        answer TEXT NOT NULL DEFAULT '',
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        priority INTEGER NOT NULL DEFAULT 0,
        match_count INTEGER NOT NULL DEFAULT 0,
        last_matched_at TIMESTAMPTZ NULL,
        created_by BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await clientOrPool.query(
      `CREATE INDEX IF NOT EXISTS idx_ai_agent_knowledge_tenant_enabled
         ON ai_agent_knowledge (tenant_id, kind, enabled, priority DESC)`
    );
  };
  if (clientOrPool !== db) return run();
  // Memoized per process: this runs on the inbound message path, and an unguarded DDL on a hot path is
  // what caused the 2026-08-26 pool-starvation brownout.
  if (!schemaReadyPromise) {
    schemaReadyPromise = run().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const normalizeTriggers = (value) => {
  const list = Array.isArray(value)
    ? value
    : text(value).split(/[\n,،]+/);
  const seen = new Set();
  const out = [];
  list.forEach((item) => {
    const cleaned = text(item);
    if (cleaned.length < MIN_TRIGGER_LENGTH) return;
    const normalized = normalizeKnowledgeText(cleaned);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(cleaned.slice(0, 120));
  });
  return out.slice(0, MAX_TRIGGERS_PER_ENTRY);
};

const rowToEntry = (row = {}) => ({
  id: Number(row.id),
  kind: text(row.kind) || "knowledge",
  title: text(row.title),
  triggers: Array.isArray(row.triggers) ? row.triggers : [],
  answer: text(row.answer),
  enabled: row.enabled !== false,
  priority: int(row.priority, 0),
  match_count: int(row.match_count, 0),
  last_matched_at: row.last_matched_at || null,
});

export const listAgentKnowledge = async ({ tenantId, kind = "" } = {}) => {
  await ensureAgentKnowledgeSchema();
  const params = [tenantId];
  let where = "tenant_id = $1";
  if (KNOWLEDGE_KINDS.includes(kind)) {
    params.push(kind);
    where += ` AND kind = $${params.length}`;
  }
  const result = await db.query(
    `SELECT * FROM ai_agent_knowledge WHERE ${where} ORDER BY priority DESC, id ASC`,
    params
  );
  return (result.rows || []).map(rowToEntry);
};

export const createAgentKnowledge = async ({ tenantId, kind, title, triggers, answer, enabled, priority, createdBy = null } = {}) => {
  await ensureAgentKnowledgeSchema();
  const safeKind = KNOWLEDGE_KINDS.includes(kind) ? kind : "knowledge";
  const body = text(answer).slice(0, MAX_ANSWER_LENGTH);
  if (!body) throw Object.assign(new Error("An entry needs something to say"), { status: 400 });
  const triggerList = safeKind === "fixed_answer" ? normalizeTriggers(triggers) : [];
  if (safeKind === "fixed_answer" && !triggerList.length) {
    throw Object.assign(
      new Error(`A fixed answer needs at least one trigger of ${MIN_TRIGGER_LENGTH} characters or more`),
      { status: 400, code: "TRIGGERS_REQUIRED" }
    );
  }
  const result = await db.query(
    `
    INSERT INTO ai_agent_knowledge (tenant_id, kind, title, triggers, answer, enabled, priority, created_by)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
    RETURNING *
    `,
    [
      tenantId,
      safeKind,
      text(title).slice(0, 200),
      JSON.stringify(triggerList),
      body,
      enabled !== false,
      int(priority, 0),
      Number(createdBy) || null,
    ]
  );
  invalidateKnowledgeCache(tenantId);
  return rowToEntry(result.rows[0]);
};

export const updateAgentKnowledge = async ({ tenantId, id, patch = {} } = {}) => {
  await ensureAgentKnowledgeSchema();
  const current = await db.query(`SELECT * FROM ai_agent_knowledge WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  const row = current.rows[0];
  if (!row) throw Object.assign(new Error("Entry not found"), { status: 404 });

  const kind = KNOWLEDGE_KINDS.includes(patch.kind) ? patch.kind : text(row.kind) || "knowledge";
  const answer = patch.answer !== undefined ? text(patch.answer).slice(0, MAX_ANSWER_LENGTH) : text(row.answer);
  if (!answer) throw Object.assign(new Error("An entry needs something to say"), { status: 400 });
  const triggers = kind === "fixed_answer"
    ? normalizeTriggers(patch.triggers !== undefined ? patch.triggers : row.triggers)
    : [];
  if (kind === "fixed_answer" && !triggers.length) {
    throw Object.assign(
      new Error(`A fixed answer needs at least one trigger of ${MIN_TRIGGER_LENGTH} characters or more`),
      { status: 400, code: "TRIGGERS_REQUIRED" }
    );
  }

  const result = await db.query(
    `
    UPDATE ai_agent_knowledge
       SET kind = $3, title = $4, triggers = $5::jsonb, answer = $6, enabled = $7, priority = $8, updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
    RETURNING *
    `,
    [
      tenantId,
      id,
      kind,
      patch.title !== undefined ? text(patch.title).slice(0, 200) : text(row.title),
      JSON.stringify(triggers),
      answer,
      patch.enabled !== undefined ? patch.enabled !== false : row.enabled !== false,
      patch.priority !== undefined ? int(patch.priority, 0) : int(row.priority, 0),
    ]
  );
  invalidateKnowledgeCache(tenantId);
  return rowToEntry(result.rows[0]);
};

export const deleteAgentKnowledge = async ({ tenantId, id } = {}) => {
  await ensureAgentKnowledgeSchema();
  const result = await db.query(`DELETE FROM ai_agent_knowledge WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  invalidateKnowledgeCache(tenantId);
  return { deleted: result.rowCount || 0 };
};

/* ── the read path ──────────────────────────────────────────────────────────────────────────── */

const CACHE_TTL_MS = 30_000;
const cache = new Map();

export const invalidateKnowledgeCache = (tenantId = null) => {
  if (tenantId === null) cache.clear();
  else cache.delete(Number(tenantId) || 0);
};

const loadEnabled = async (tenantId) => {
  const key = Number(tenantId) || 0;
  if (!key) return [];
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.entries;
  try {
    await ensureAgentKnowledgeSchema();
    const result = await db.query(
      `SELECT * FROM ai_agent_knowledge WHERE tenant_id = $1 AND enabled = TRUE ORDER BY priority DESC, id ASC`,
      [key]
    );
    const entries = (result.rows || []).map(rowToEntry);
    cache.set(key, { entries, at: Date.now() });
    return entries;
  } catch (error) {
    // A knowledge lookup must never cost a customer their reply.
    console.warn("[agent-knowledge] load failed; continuing without it", {
      tenant_id: key,
      message: error?.message || String(error),
    });
    return [];
  }
};

/**
 * The fixed answer a message triggers, or null.
 *
 * More specific wins: higher priority first, then the entry whose matched trigger is longest — so an
 * owner can write a broad rule for "شحن" and a narrower one for "شحن الاسكندرية" without the broad one
 * swallowing it.
 */
export const matchFixedAnswer = (entries = [], message = "") => {
  const normalized = normalizeKnowledgeText(message);
  if (!normalized) return null;
  let best = null;
  entries.forEach((entry) => {
    if (entry.kind !== "fixed_answer" || entry.enabled === false) return;
    (entry.triggers || []).forEach((trigger) => {
      const normalizedTrigger = normalizeKnowledgeText(trigger);
      if (!normalizedTrigger || normalizedTrigger.length < MIN_TRIGGER_LENGTH) return;
      if (!normalized.includes(normalizedTrigger)) return;
      const candidate = { entry, trigger, length: normalizedTrigger.length };
      if (
        !best ||
        entry.priority > best.entry.priority ||
        (entry.priority === best.entry.priority && candidate.length > best.length)
      ) {
        best = candidate;
      }
    });
  });
  return best;
};

export const findFixedAnswerForMessage = async ({ tenantId, message } = {}) => {
  const entries = await loadEnabled(tenantId);
  return matchFixedAnswer(entries, message);
};

// Fire-and-forget: the owner needs to see which rules actually earn their place, and a counter must
// never delay the reply it is counting.
export const recordKnowledgeMatch = ({ tenantId, id } = {}) => {
  if (!tenantId || !id) return;
  db.query(
    `UPDATE ai_agent_knowledge SET match_count = match_count + 1, last_matched_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  ).catch(() => {});
};

/**
 * The `knowledge` entries as instruction lines, capped.
 *
 * These are facts, not orders: the agent words them itself. They can never override the grounding
 * rules above them in the prompt — price, stock and availability still come from the ERP.
 */
export const buildKnowledgeLines = (entries = []) => {
  const lines = [];
  let budget = MAX_KNOWLEDGE_CHARS_IN_PROMPT;
  entries
    .filter((entry) => entry.kind === "knowledge" && entry.enabled !== false && text(entry.answer))
    .slice(0, MAX_KNOWLEDGE_ENTRIES_IN_PROMPT)
    .forEach((entry) => {
      const line = `- ${text(entry.answer)}`;
      if (line.length > budget) return;
      budget -= line.length;
      lines.push(line);
    });
  return lines;
};

export const loadKnowledgeLines = async ({ tenantId } = {}) => buildKnowledgeLines(await loadEnabled(tenantId));

export const __agentKnowledgeTestHooks = { loadEnabled, cache };

export default findFixedAnswerForMessage;
