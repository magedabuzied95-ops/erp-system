// AI Studio Phase 10.7 — unified footwear size grounding. Uses the ONE canonical Crocs table
// (src/shared/lib/crocsSizes.js) via the pure resolver; DB-free (gate exercised with injected fixtures).
// The live regression: "عندكم كروكس اسود مقاس 44؟" — 44 must resolve against REAL variant sizes.

import test from "node:test";
import assert from "node:assert/strict";

const R = await import("../../server/services/footwearSizeResolver.js");
const G = await import("../../server/services/aiInboxGroundingGate.js");
const C = await import("../../src/shared/lib/crocsSizes.js");
const { SIZE_MATCH, resolveFootwearSize, toDisplaySize } = R;

const crocs = (requestedSize, availableVariantSizes) => resolveFootwearSize({ productType: "crocs", requestedSize, availableVariantSizes });

test("A normal numeric footwear is literal EXACT_CANONICAL (no conversion)", () => {
  assert.equal(resolveFootwearSize({ productType: "sneakers", requestedSize: "44", availableVariantSizes: ["43", "44", "45"] }).matchType, SIZE_MATCH.EXACT_CANONICAL);
  assert.equal(resolveFootwearSize({ productType: "sneakers", requestedSize: "44", availableVariantSizes: ["43", "45"] }).matchType, SIZE_MATCH.NO_VARIANT_MATCH);
});

test("C Crocs EU→M/W unique conversion", () => {
  const r = crocs("44", ["M10/W12"]);
  assert.equal(r.matchType, SIZE_MATCH.UNIQUE_CONVERSION);
  assert.deepEqual(r.canonicalMatches, ["M10/W12"]);
  assert.equal(r.euSize, "43/44");
});

test("D Crocs canonical M/W direct input is EXACT_ALIAS", () => {
  assert.equal(crocs("M10/W12", ["M10/W12"]).matchType, SIZE_MATCH.EXACT_ALIAS);
  assert.equal(crocs("m 10 / w 12", ["M10/W12"]).matchType, SIZE_MATCH.EXACT_ALIAS); // spacing normalized by the canonical util
});

test("F/G/H C-series, J-series, EU-double aliases resolve against real variants", () => {
  assert.equal(crocs("C6", ["C6", "C7"]).matchType, SIZE_MATCH.EXACT_ALIAS);          // F
  assert.equal(crocs("22", ["C6"]).matchType, SIZE_MATCH.UNIQUE_CONVERSION);            // C6 → 22/23, EU 22 unique
  assert.equal(crocs("J5", ["J5"]).matchType, SIZE_MATCH.EXACT_ALIAS);                  // G
  assert.equal(crocs("22/23", ["C6"]).matchType, SIZE_MATCH.EXACT_ALIAS);              // H (C6 ↔ 22/23)
});

test("J unknown size → NO_MAPPING; L mapped-but-absent → NO_VARIANT_MATCH", () => {
  assert.equal(crocs("99", ["M8/W10"]).matchType, SIZE_MATCH.NO_MAPPING);              // J: 99 not in canonical chart
  assert.equal(crocs("44", ["M8/W10", "M9/W11"]).matchType, SIZE_MATCH.NO_VARIANT_MATCH); // L: 44=43/44 not on product
});

test("K ambiguous EU number spanning two canonical doubles → AMBIGUOUS_CONVERSION", () => {
  const r = crocs("44", ["M10/W12", "44/45"]); // 44 ∈ 43/44 AND 44/45
  assert.equal(r.matchType, SIZE_MATCH.AMBIGUOUS_CONVERSION);
  assert.equal(r.ambiguous, true);
});

test("limitation: M-only / W-first inputs are NOT canonical aliases → NO_MAPPING (documented)", () => {
  assert.equal(crocs("M8", ["M8/W10"]).matchType, SIZE_MATCH.NO_MAPPING);   // canonical keys are full M/W labels
  assert.equal(crocs("W12/M10", ["M10/W12"]).matchType, SIZE_MATCH.NO_MAPPING); // canonical normalizer is M-first only
});

test("P storefront round-trip: variant marking → display EU → customer size → same variant", () => {
  const variants = [{ size: "M8/W10", id: 1 }, { size: "M9/W11", id: 2 }];
  const options = C.buildCrocsStorefrontSizeOptions(variants);
  const m8 = options.find((o) => o.variant.id === 1);
  assert.equal(m8.displaySize, "41/42"); // storefront shows EU
  // A customer asking with the displayed EU double resolves back to the same canonical variant
  assert.deepEqual(crocs("41/42", ["M8/W10", "M9/W11"]).canonicalMatches, ["M8/W10"]);
  // A customer asking with a bare EU inside that double resolves uniquely to the same variant
  assert.deepEqual(crocs("41", ["M8/W10", "M9/W11"]).canonicalMatches, ["M8/W10"]);
  assert.equal(toDisplaySize("M8/W10", "crocs"), "41/42");
});

// ---- Gate integration (injected catalog fixtures; N/O/M/live) ----
const gate = (message, variantRows, color = "Black") => G.applyInboxGroundingGate({
  tenantId: 1, message,
  deps: {
    queryProducts: async () => ([{ id: 734, name: "Crocs Classic Clog", product_type: "crocs" }]),
    inventoryFacts: async () => ({ variant_stock: variantRows }),
  },
});

test("live message: 44 vs black M8/W10 only → clarify_size (NO_VARIANT_MATCH), no fake availability", async () => {
  const r = await gate("السلام عليكم ورحمة الله\nعندكم كروكس اسود مقاس 44 ؟", [
    { variant_id: 9058, size: "M8/W10", color: "Black", stock: 0 },
    { variant_id: 9053, size: "M9/W11", color: "Black", stock: 0 },
  ]);
  assert.equal(r.requestedIntent, "PRODUCT_AVAILABILITY");
  assert.equal(r.action, "clarify_size");
  assert.doesNotMatch(r.answer, /^أيوه/);
  assert.match(r.answer, /41\/42|42\/43/); // honest available-sizes hint in EU
});

test("N exact resolved variant in stock → available", async () => {
  const r = await gate("عندكم كروكس اسود مقاس 44؟", [{ variant_id: 900, size: "M10/W12", color: "Black", stock: 3 }]);
  assert.equal(r.action, "available");
  assert.match(r.answer, /متوفر/);
  assert.equal(r.grounding.resolved.erpSize, "M10/W12");
  assert.equal(r.grounding.resolved.stock, 3);
});

test("O exact resolved variant out of stock → unavailable + restock offer", async () => {
  const r = await gate("عندكم كروكس اسود مقاس 44؟", [{ variant_id: 901, size: "M10/W12", color: "Black", stock: 0 }]);
  assert.equal(r.action, "unavailable");
  assert.match(r.answer, /إشعار|يرجع/);
});

test("M size resolves but requested color absent → clarify_color (no availability claim)", async () => {
  const r = await gate("عندكم كروكس اسود مقاس 44؟", [{ variant_id: 902, size: "M10/W12", color: "White", stock: 5 }]);
  assert.equal(r.action, "clarify_color");
  assert.doesNotMatch(r.answer, /^أيوه/);
});

test("normal footwear unaffected: sneakers 44 in stock → available (no crocs conversion)", async () => {
  const r = await G.applyInboxGroundingGate({ tenantId: 1, message: "عندكم سنيكرز اسود مقاس 44؟", deps: {
    queryProducts: async () => ([{ id: 39, name: "Air Jordan 4 Sneakers", product_type: "sneakers" }]),
    inventoryFacts: async () => ({ variant_stock: [{ variant_id: 500, size: "44", color: "Black", stock: 2 }] }),
  } });
  assert.equal(r.action, "available");
});
