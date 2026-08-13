// Phase 15 (P2 batch 1, resolver half) — durable product-context integrity.
//
// Production defect: a text-only assisted approval persisted product_id = 0 (row 7,
// whatsapp:201024960585). The resolver's guard was NULLIF(product_id::text,'') IS NOT NULL, which lets '0'
// through; because corrections are read first with LIMIT 1, that row won AND short-circuited, suppressing the
// valid sent-product-card fallback beneath it. A conversation with real grounded cards had "product 0" as its
// remembered subject.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canonicalProductId, deriveApprovedProductSubject, resolveConversationProductSubject } from "../../server/services/aiInboxGroundingGate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const gateSrc = readFileSync(path.join(here, "../../server/services/aiInboxGroundingGate.js"), "utf8");

// ---------------- 1-9: the validity rule ----------------
test("1: a canonical positive id is accepted", () => {
  assert.equal(canonicalProductId(39), 39);
  assert.equal(canonicalProductId("39"), 39);
  assert.equal(canonicalProductId(" 39 "), 39);
});

test("2-9: every invalid form resolves to null — never a product called zero", () => {
  for (const bad of [undefined, null, "", "   ", 0, "0", -3, "-3", 3.5, "3.5", NaN, "NaN", "abc", "3abc", {}, []]) {
    assert.equal(canonicalProductId(bad), null, `${JSON.stringify(bad)} must not be a product id`);
  }
});

test("the helper returns an id or null, never a boolean (no truthiness fallback)", () => {
  assert.equal(typeof canonicalProductId(39), "number");
  assert.equal(canonicalProductId(0), null);
  assert.notEqual(canonicalProductId(0), false, "0 must not degrade into a falsy sentinel callers can misuse");
});

// ---------------- 20-25: approved subject derivation ----------------
test("20-25: subject derivation — variants collapse, distinct products stay ambiguous", () => {
  const cards = (...ids) => ids.map((id) => ({ product_id: id }));
  assert.deepEqual(deriveApprovedProductSubject([]), { state: "none", productId: null, distinctProductIds: [] });
  assert.equal(deriveApprovedProductSubject(cards(0)).state, "none");
  assert.equal(deriveApprovedProductSubject(cards(39)).productId, 39);
  assert.equal(deriveApprovedProductSubject(cards(39, 39, 39)).productId, 39, "multi-variant = ONE subject");
  assert.equal(deriveApprovedProductSubject(cards(0, 39)).productId, 39, "invalid noise ignored");
  assert.equal(deriveApprovedProductSubject(cards(3, 7, 25)).state, "ambiguous");
  assert.equal(deriveApprovedProductSubject(cards(3, 3, 7)).state, "ambiguous");
});

test("23/24/25: an ambiguous package never picks first, last, or any single card", () => {
  const s = deriveApprovedProductSubject([{ product_id: 3 }, { product_id: 7 }, { product_id: 25 }]);
  assert.equal(s.productId, null);
  assert.deepEqual(s.distinctProductIds, [3, 7, 25]);
  // order must not change the outcome
  const reversed = deriveApprovedProductSubject([{ product_id: 25 }, { product_id: 7 }, { product_id: 3 }]);
  assert.deepEqual(reversed, s);
});

test("accepts variant cards carrying id instead of product_id", () => {
  assert.equal(deriveApprovedProductSubject([{ id: 39, variant_id: 1403 }, { id: 39, variant_id: 2469 }]).productId, 39);
});

// ---------------- 10/11: the resolver no longer takes the poison ----------------
test("10/11: a recent product_id=0 correction is skipped IN SQL, so the valid card fallback still runs", async () => {
  const calls = [];
  const dbClient = {
    query: async (sql, args) => {
      calls.push(sql);
      if (sql.includes("ai_reply_corrections")) {
        // the hardened predicate must exclude the poison row before ORDER BY/LIMIT
        assert.match(sql, /product_id IS NOT NULL AND product_id > 0/);
        assert.doesNotMatch(sql, /NULLIF\(product_id::text/);
        return { rows: [] }; // row 7 is filtered by the query itself
      }
      return { rows: [{ id: 900, product_cards: [{ product_id: 39 }], age_s: 120 }] };
    },
  };
  const subject = await resolveConversationProductSubject({ tenantId: 1, sessionId: "whatsapp:201024960585", dbClient });
  assert.equal(subject?.productId, "39", "the real sent card must win once the invalid row is skipped");
  assert.equal(subject.source, "sent_product_card");
  assert.equal(calls.length, 2, "the fallback query must actually be reached, not short-circuited");
});

test("a valid correction still wins over the card fallback (precedence unchanged)", async () => {
  const dbClient = {
    query: async (sql) => (sql.includes("ai_reply_corrections")
      ? { rows: [{ product_id: 359, message_id: 77, age_s: 30 }] }
      : { rows: [{ id: 900, product_cards: [{ product_id: 39 }], age_s: 10 }] }),
  };
  const subject = await resolveConversationProductSubject({ tenantId: 1, sessionId: "instagram:x", dbClient });
  assert.equal(subject.productId, "359");
  assert.equal(subject.source, "approved_selection");
});

test("a correction row that somehow still carries 0 cannot become a subject in JS either", async () => {
  const dbClient = {
    query: async (sql) => (sql.includes("ai_reply_corrections")
      ? { rows: [{ product_id: 0, message_id: 7, age_s: 5 }] }   // belt-and-braces: SQL bypassed
      : { rows: [] }),
  };
  const subject = await resolveConversationProductSubject({ tenantId: 1, sessionId: "whatsapp:x", dbClient });
  assert.equal(subject, null, "product 0 must never surface as a subject");
});

test("the JS guard uses the canonical rule, not truthiness", () => {
  assert.match(gateSrc, /if \(canonicalProductId\(corr\.rows\[0\]\?\.product_id\)\) \{/);
});

// ---------------- non-regression ----------------
test("subject identity carries NO facts — stock and price are never persisted context", () => {
  const fn = gateSrc.slice(gateSrc.indexOf("export const resolveConversationProductSubject"), gateSrc.indexOf("// Continuation fillers"));
  for (const fact of ["stock", "price", "sale_price"]) {
    assert.doesNotMatch(fn, new RegExp(`\\b${fact}\\b`), `${fact} must never travel with the durable subject`);
  }
});

test("conversation scoping is unchanged — no cross-channel leak", () => {
  const fn = gateSrc.slice(gateSrc.indexOf("export const resolveConversationProductSubject"), gateSrc.indexOf("// Continuation fillers"));
  assert.match(fn, /tenant_id = \$1 AND conversation_id = \$2/, "always tenant + conversation scoped");
});
