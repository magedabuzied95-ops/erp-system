import db from "../../database/db.js";
import { canonicalPhoneKey } from "../../utils/phoneSearch.js";
import { linkedChannelsForConversation } from "../orders/customerChannelLinks.js";

/*
 * What a customer TOLD us, kept past the conversation it was said in — the sales agent's
 * remember / forget (GENI's agent has the same pair, see genie-erp-agent-reference).
 *
 * The 24-message history and the per-thread conversation memory forget «مقاسي 43 بس الجزم
 * بتيجي ضيقة عليا» the moment the topic moves on, and customer 360 only knows what was BOUGHT.
 * A fact here is one short sentence the agent wrote down, and it comes back in every later
 * conversation with that customer, on any channel.
 *
 * Whose fact it is: an Egyptian mobile when one is known (the WhatsApp number, or the number the
 * customer typed in a Messenger / Instagram thread — customerChannelLinks.js), else the thread
 * itself. Loading reads both, so a fact written on Messenger before the number was known still
 * comes back in that thread, and every fact under the number comes back everywhere.
 *
 * Staff see the list on the inbox customer panel and can delete a wrong line; nothing here is
 * ever hard-deleted — a forgotten fact keeps its row with forgotten_at and who forgot it.
 */

const text = (value = "") => String(value ?? "").trim();
const EGYPT_MOBILE_KEY = /^1[0125]\d{8}$/;

export const FACT_CATEGORIES = Object.freeze(["size_fit", "style", "budget", "for_whom", "request", "objection", "other"]);
export const MAX_FACT_LENGTH = 200;
// A customer's memory is a short card, not a transcript: past this the oldest line is forgotten.
export const MAX_ACTIVE_FACTS = 25;

export const mobileKeyOf = (value = "") => {
  const key = canonicalPhoneKey(value);
  return EGYPT_MOBILE_KEY.test(key) ? key : "";
};

// The keys a conversation's facts live under: each known mobile, then the thread.
export const memoryIdentityKeys = ({ sessionId = "", phones = [] } = {}) => {
  const keys = [];
  const fromSession = /^whatsapp:/i.test(text(sessionId)) ? mobileKeyOf(text(sessionId).slice("whatsapp:".length)) : "";
  for (const key of [fromSession, ...phones.map(mobileKeyOf)]) {
    if (key && !keys.includes(`phone:${key}`)) keys.push(`phone:${key}`);
  }
  if (text(sessionId)) keys.push(`session:${text(sessionId)}`);
  return keys;
};

// Where a new fact is written: under the number when there is one, so it follows the customer.
export const primaryIdentityKey = (input = {}) => memoryIdentityKeys(input)[0] || "";

// The same thing said twice is one fact: spacing, punctuation and Arabic letter variants ignored.
export const normalizeFactText = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const cleanFact = (value = "") => text(value).replace(/\s+/g, " ").slice(0, MAX_FACT_LENGTH);

let schemaReady = null;
export const ensureCustomerMemorySchema = async (client = db) => {
  if (!schemaReady) {
    schemaReady = client.query(`
      CREATE TABLE IF NOT EXISTS customer_memory_facts (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NULL,
        identity_key TEXT NOT NULL,
        session_id TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL DEFAULT '',
        fact TEXT NOT NULL,
        fact_norm TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        source TEXT NOT NULL DEFAULT 'agent',
        created_by BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        forgotten_at TIMESTAMPTZ NULL,
        forgotten_by BIGINT NULL,
        forgotten_reason TEXT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_customer_memory_facts_identity
        ON customer_memory_facts (identity_key, updated_at DESC) WHERE forgotten_at IS NULL;
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
};

const tenantClause = (param) => `(${param}::bigint IS NULL OR tenant_id = ${param}::bigint OR tenant_id IS NULL)`;

export const loadCustomerMemoryFacts = async ({ tenantId = null, sessionId = "", phones = [], limit = MAX_ACTIVE_FACTS, client = db } = {}) => {
  const keys = memoryIdentityKeys({ sessionId, phones });
  if (!keys.length) return [];
  await ensureCustomerMemorySchema(client);
  const result = await client.query(
    `
    SELECT id, fact, category, source, channel, created_at, updated_at
    FROM customer_memory_facts
    WHERE identity_key = ANY($1::text[])
      AND forgotten_at IS NULL
      AND ${tenantClause("$2")}
    ORDER BY updated_at DESC, id DESC
    LIMIT $3
    `,
    [keys, tenantId, limit]
  );
  return result.rows;
};

// The thread's own numbers plus any number the customer typed in it (Messenger / Instagram).
export const conversationMemoryPhones = async ({ tenantId = null, sessionId = "", phones = [] } = {}) => {
  const known = phones.map(mobileKeyOf).filter(Boolean);
  if (!text(sessionId) || /^whatsapp:/i.test(text(sessionId))) return known;
  const linked = await linkedChannelsForConversation({ tenantId, sessionId, phones: known }).catch(() => null);
  return [...new Set([...known, ...(linked?.phones || []).map(mobileKeyOf).filter(Boolean)])];
};

export const rememberCustomerFact = async ({
  tenantId = null,
  sessionId = "",
  phones = [],
  channel = "",
  fact = "",
  category = "other",
  source = "agent",
  userId = null,
  client = db,
} = {}) => {
  const clean = cleanFact(fact);
  const norm = normalizeFactText(clean);
  if (norm.length < 3) return { ok: false, reason: "empty_fact" };
  const keys = memoryIdentityKeys({ sessionId, phones });
  const identityKey = keys[0];
  if (!identityKey) return { ok: false, reason: "no_identity" };
  const safeCategory = FACT_CATEGORIES.includes(text(category)) ? text(category) : "other";
  await ensureCustomerMemorySchema(client);

  const existing = await client.query(
    `SELECT id FROM customer_memory_facts WHERE identity_key = ANY($1::text[]) AND fact_norm = $2 AND forgotten_at IS NULL AND ${tenantClause("$3")} LIMIT 1`,
    [keys, norm, tenantId]
  );
  if (existing.rows[0]) {
    await client.query(`UPDATE customer_memory_facts SET updated_at = NOW() WHERE id = $1`, [existing.rows[0].id]);
    return { ok: true, id: Number(existing.rows[0].id), already_known: true };
  }

  const inserted = await client.query(
    `
    INSERT INTO customer_memory_facts (tenant_id, identity_key, session_id, channel, fact, fact_norm, category, source, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id
    `,
    [tenantId, identityKey, text(sessionId), text(channel), clean, norm, safeCategory, text(source) || "agent", userId]
  );
  // Past the cap, the lines nobody touched for longest go.
  await client.query(
    `
    UPDATE customer_memory_facts
    SET forgotten_at = NOW(), forgotten_reason = 'over_limit'
    WHERE id IN (
      SELECT id FROM customer_memory_facts
      WHERE identity_key = ANY($1::text[]) AND forgotten_at IS NULL AND ${tenantClause("$2")}
      ORDER BY updated_at DESC, id DESC
      OFFSET $3
    )
    `,
    [keys, tenantId, MAX_ACTIVE_FACTS]
  );
  return { ok: true, id: Number(inserted.rows[0].id) };
};

// Only a fact that belongs to this conversation's customer can be forgotten from it.
export const forgetCustomerFact = async ({ tenantId = null, sessionId = "", phones = [], factId, reason = "", userId = null, client = db } = {}) => {
  const id = Number(factId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: "bad_id" };
  const keys = memoryIdentityKeys({ sessionId, phones });
  if (!keys.length) return { ok: false, reason: "no_identity" };
  await ensureCustomerMemorySchema(client);
  const result = await client.query(
    `
    UPDATE customer_memory_facts
    SET forgotten_at = NOW(), forgotten_by = $4, forgotten_reason = $5
    WHERE id = $1 AND identity_key = ANY($2::text[]) AND forgotten_at IS NULL AND ${tenantClause("$3")}
    RETURNING id
    `,
    [id, keys, tenantId, userId, cleanFact(reason) || null]
  );
  return result.rows[0] ? { ok: true, id } : { ok: false, reason: "not_found" };
};

// The prompt block: one line per fact, with its id so the agent can forget it.
export const customerMemoryPromptLines = (facts = []) =>
  facts.map((fact) => `- [${fact.id}] ${cleanFact(fact.fact)}`);
