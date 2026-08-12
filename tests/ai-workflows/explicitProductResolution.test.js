// Phase 12.1-fix — explicit product/model resolution regression ("متاح اديداس اديستار؟" → generic leak).
// Root cause: "متاح" was not an availability word → intent GENERAL → brand/model resolver skipped → the raw
// brain's ungrounded "أطلعلك بديل شبه ده؟" leaked. Fixes: recognise متاح, strip it from the brand term, add
// اديستار→adistar to the alias engine, and FAIL CLOSED (explicit-but-unresolved → clarify, never a generic).
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../../server/services/aiInboxGroundingGate.js";
import { expandSearchAliasTerms } from "../../server/services/productAliasEngine.js";

const ADISTAR_ROWS = [
  { id: 351, name: "Adidas adistar", product_type: "sneakers" },
  { id: 359, name: "Adidas Adistar22", product_type: "sneakers" },
  { id: 67, name: "Adidas Adistar COLD.RDY", product_type: "sneakers" },
];
const ALL_ADIDAS = [...ADISTAR_ROWS, { id: 717, name: "Adidas Superstar", product_type: "sneakers" }, { id: 724, name: "adidas ultra boost", product_type: "sneakers" }];
const inv = (rows) => async () => ({ variant_stock: [{ variant_id: 900, size: "44", color: "Black", stock: 3 }] });

test("1: \"متاح اديداس اديستار؟\" resolves the real Adidas Adistar (not a generic alternative)", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: "instagram:X", message: "متاح اديداس اديستار؟", deps: { resolveByBrandModel: async () => G.rankBrandModelMatches("اديداس اديستار", ALL_ADIDAS), inventoryFacts: inv() } });
  assert.equal(r.changed, true);
  assert.notEqual(r.action, "noop");
  assert.doesNotMatch(String(r.answer || ""), /بديل شبه/); // never the ungrounded generic
  const names = (r.card_choices || []).map((c) => c.name).concat(r.send_ready_card ? [r.send_ready_card.name] : []);
  assert.ok(names.every((n) => /adistar/i.test(n)), "only Adistar products surfaced");
});

test("intent: \"متاح ...\" is now PRODUCT_AVAILABILITY (متاح recognised); term drops متاح", () => {
  const e = G.extractRequestedEntities("متاح اديداس اديستار؟");
  assert.equal(e.wantsAvailability, true);
  assert.equal(e.brandModelTerm, "اديداس اديستار");
  assert.equal(G.resolveRequestedIntent("متاح اديداس اديستار؟"), "PRODUCT_AVAILABILITY");
});

test("2: English \"متاح Adidas Adistar؟\" resolves the same product family", () => {
  assert.ok(expandSearchAliasTerms("Adidas Adistar", { limit: 60 }).some((t) => /adistar/.test(t)));
  const ranked = G.rankBrandModelMatches("Adidas Adistar", ALL_ADIDAS).map((r) => r.name);
  assert.ok(ranked.length && ranked.every((n) => /adistar/i.test(n)));
});

test("3: Arabic spelling variants اديستار/أديستار both expand to adistar", () => {
  for (const term of ["اديستار", "أديستار", "اديداس اديستار", "أديداس أديستار"]) {
    assert.ok(expandSearchAliasTerms(term, { limit: 60 }).some((t) => /adistar/.test(t)), term);
  }
});

test("4: prior Jordan context + explicit Adidas Adistar → Adidas wins, source=explicit_message", async () => {
  let subjectCalled = false;
  const r = await G.applyInboxGroundingGate({
    tenantId: 1, sessionId: "instagram:X", message: "متاح اديداس اديستار؟",
    deps: {
      resolveProductSubject: async () => { subjectCalled = true; return { productId: "39" }; }, // Jordan — must NOT win
      resolveByBrandModel: async () => G.rankBrandModelMatches("اديداس اديستار", ADISTAR_ROWS),
      inventoryFacts: inv(),
    },
  });
  assert.equal(subjectCalled, false, "durable context must not be consulted for an explicit product");
  assert.equal(r.grounding.product_resolution.source, "explicit_message");
});

test("5: grounded explicit resolution is labelled source=explicit_message", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: "instagram:X", message: "متاح اديداس اديستار؟", deps: { resolveByBrandModel: async () => [ADISTAR_ROWS[0]], inventoryFacts: inv() } });
  assert.equal(r.grounding.product_resolution.source, "explicit_message");
});

test("6: bare Adidas with multiple products → disambiguation, not one arbitrary pick", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: "instagram:X", message: "متاح اديداس؟", deps: { resolveByBrandModel: async () => ALL_ADIDAS, inventoryFacts: inv() } });
  assert.equal(r.product_ambiguous, true);
  assert.ok((r.card_choices || []).length > 1);
});

test("7: explicit UNKNOWN model → fail-closed clarify (product_not_found), NO alternatives", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: "instagram:X", message: "متاح XYZABC؟", deps: { resolveByBrandModel: async () => [], queryProducts: async () => [], inventoryFacts: async () => ({}) } });
  assert.equal(r.action, "clarify_product");
  assert.equal(r.grounding.resolved.note, "product_not_found");
  assert.equal((r.suggested_products || []).length, 0);
  assert.doesNotMatch(String(r.answer || ""), /بديل شبه/);
});

test("8/9/10: Jordan, Nike, Crocs aliases remain green", () => {
  assert.ok(expandSearchAliasTerms("جوردن فور", { limit: 60 }).some((t) => /jordan/.test(t)));
  assert.ok(expandSearchAliasTerms("نايك", { limit: 60 }).some((t) => /nike/.test(t)));
  assert.equal(G.extractRequestedEntities("عندكم كروكس اسود مقاس 44؟").productType, "crocs");
});

test("12: the gate never sends — it only returns a corrected draft (no autonomous outbound)", () => {
  // structural: applyInboxGroundingGate has no send/post call; it returns { changed, answer, grounding, ... }
  const src = G.applyInboxGroundingGate.toString();
  assert.doesNotMatch(src, /sendMeta|postMeta|sendWhatsApp|fetch\(/);
});
