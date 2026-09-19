// Whether this customer may be sent a marketing message at all.
//
// Before this file there was no answer to that question anywhere in the system: no consent column,
// no opt-out, nothing. Every WhatsApp message the shop sent was transactional — tied to an order the
// customer had just placed — so the question never came up. A broadcast is the first message a
// customer gets for the shop's reasons rather than their own, and sending those with no way to stop
// them is how a number gets reported and then restricted.
//
// The model is opt-OUT, which is the honest reflection of reality: these are people who bought from
// this shop and gave it their number for that purpose. What is added is the exit — one word, in
// Arabic or English, recorded permanently, honoured by every marketing path.
//
// Transactional messages are deliberately NOT gated by this. A customer who opted out of offers has
// not opted out of being told their order shipped, and silently dropping that would be worse than
// any broadcast.

import db from "../database/db.js";

const text = (value) => String(value ?? "").trim();

let schemaReadyPromise = null;

export const ensureMarketingConsentSchema = async (clientOrPool = db) => {
  const run = async () => {
    await clientOrPool.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_opt_out_at TIMESTAMPTZ NULL`
    );
    await clientOrPool.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_opt_out_source VARCHAR(40) NOT NULL DEFAULT ''`
    );
    await clientOrPool.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_last_sent_at TIMESTAMPTZ NULL`
    );
    // The audience query filters on exactly these two, over the whole customer table.
    await clientOrPool.query(
      `CREATE INDEX IF NOT EXISTS idx_customers_marketing_reachable
         ON customers (tenant_id, marketing_last_sent_at)
       WHERE marketing_opt_out_at IS NULL`
    );
  };
  if (clientOrPool !== db) return run();
  if (!schemaReadyPromise) {
    schemaReadyPromise = run().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

/*
 * The words that stop marketing.
 *
 * Matched as a WHOLE message, never as a substring of a longer sentence. That restriction is
 * deliberate and it is the opposite of how the canonical intent signals work: those match a word
 * anywhere, which is what let "مش مشكلة" cancel a live order. Here the cost of a false positive is
 * a customer silently dropped from every future offer with nobody noticing, so a bare "stop" —
 * a customer who typed nothing else — is the only thing that counts.
 */
export const MARKETING_STOP_WORDS = Object.freeze([
  "stop",
  "unsubscribe",
  "الغاء",
  "إلغاء",
  "الغاء الاشتراك",
  "إلغاء الاشتراك",
  "توقف",
  "مش عايز رسايل",
  "مش عايز رسائل",
  "بطل رسايل",
  "لا تراسلني",
  "متبعتليش",
  "متبعتليش تاني",
]);

const normalize = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const STOP_SET = new Set(MARKETING_STOP_WORDS.map(normalize));

export const isMarketingStopMessage = (message = "") => {
  const normalized = normalize(message);
  if (!normalized) return false;
  return STOP_SET.has(normalized);
};

export const recordMarketingOptOut = async ({ tenantId, customerId = null, phone = "", source = "whatsapp_reply" } = {}) => {
  await ensureMarketingConsentSchema();
  const id = Number(customerId) || 0;
  const digits = text(phone).replace(/\D/g, "");
  if (!id && !digits) return { updated: 0 };
  const result = await db.query(
    `
    UPDATE customers
       SET marketing_opt_out_at = COALESCE(marketing_opt_out_at, NOW()),
           marketing_opt_out_source = CASE
             WHEN marketing_opt_out_at IS NULL THEN $3::text
             ELSE marketing_opt_out_source
           END,
           updated_at = NOW()
     WHERE tenant_id = $1
       AND ($2::bigint IS NULL OR id = $2::bigint)
       AND ($4::text = '' OR RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = RIGHT($4::text, 10))
    RETURNING id
    `,
    [tenantId, id || null, text(source).slice(0, 40), digits]
  );
  if (result.rowCount) {
    console.log("[marketing-consent] opt-out recorded", { tenant_id: tenantId, customers: result.rowCount, source });
  }
  return { updated: result.rowCount || 0, customer_ids: result.rows.map((row) => Number(row.id)) };
};

export const recordMarketingOptIn = async ({ tenantId, customerId } = {}) => {
  await ensureMarketingConsentSchema();
  const id = Number(customerId) || 0;
  if (!id) return { updated: 0 };
  const result = await db.query(
    `
    UPDATE customers
       SET marketing_opt_out_at = NULL, marketing_opt_out_source = '', updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2
    `,
    [tenantId, id]
  );
  return { updated: result.rowCount || 0 };
};

export const isMarketingReachable = async ({ tenantId, customerId } = {}) => {
  await ensureMarketingConsentSchema();
  const id = Number(customerId) || 0;
  if (!id) return false;
  const result = await db.query(
    `SELECT marketing_opt_out_at FROM customers WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, id]
  );
  if (!result.rows.length) return false;
  return !result.rows[0].marketing_opt_out_at;
};

/**
 * Called for every inbound customer message. Cheap: one normalize, one Set lookup, and a DB write
 * only when the whole message was a stop word.
 */
export const handleInboundMarketingStopWord = async ({ tenantId, message = "", customerId = null, phone = "" } = {}) => {
  if (!isMarketingStopMessage(message)) return { opted_out: false };
  const result = await recordMarketingOptOut({ tenantId, customerId, phone, source: "whatsapp_reply" }).catch((error) => {
    // Never let a consent write fail the reply that carried it.
    console.warn("[marketing-consent] opt-out write failed", { tenant_id: tenantId, message: error?.message });
    return { updated: 0 };
  });
  return { opted_out: result.updated > 0, updated: result.updated };
};

export default handleInboundMarketingStopWord;
