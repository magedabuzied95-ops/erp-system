// Batch 1A-3 — authoritative category availability.
//
// Phase 14 proved "عايز كوتشي اسود مقاس 43" answered "مش متوفر" from a recency-ranked 5-of-465 sample while
// products 3/4/6/7 held real size-43 black stock. A bounded sample may find POSITIVE matches; it may never be the
// sole evidence for a category-wide NEGATIVE.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../../server/services/aiInboxGroundingGate.js";

// The bounded discovery path deliberately sees only the newest rows — none of them in stock at 43/black.
const NEWEST = [
  { id: 740, name: "New Winter Sneakers", product_type: "sneakers" },
  { id: 726, name: "New Runner", product_type: "sneakers" },
];
// The real catalogue rows the old path could never reach (production golden dataset).
const GOLDEN = [
  { id: 3, name: "Nike Air Jordan 1 Low Sneakers", product_type: "sneakers", variant_id: 824, color: "Black & Black", size: "43", stock: 2 },
  { id: 3, name: "Nike Air Jordan 1 Low Sneakers", product_type: "sneakers", variant_id: 614, color: "White & Black", size: "43", stock: 1 },
  { id: 4, name: "Alexander Mcqueen Sneakers", product_type: "sneakers", variant_id: 898, color: "Black", size: "43", stock: 2 },
  { id: 6, name: "Tommy Hilfiger Sneakers for Men", product_type: "sneakers", variant_id: 932, color: "ALL BLACK", size: "43", stock: 2 },
  { id: 7, name: "Calvin Klein Sneakers for Men", product_type: "sneakers", variant_id: 947, color: "Black & White", size: "43", stock: 3 },
];

const deps = ({ authoritative = GOLDEN, variants = [], products = NEWEST } = {}) => ({
  queryProducts: async () => products,
  resolveByBrandModel: async () => [],
  inventoryFacts: async () => ({ variant_stock: variants }),
  resolveProductSubject: async () => null,
  findCategoryAvailability: async () => authoritative,
});
const ask = (message, opts = {}) =>
  G.applyInboxGroundingGate({ tenantId: 1, sessionId: opts.session || "1a3:test", message, deps: deps(opts) });

// ---------------- 1/7/8/9: the golden case ----------------
test("1: real stock outside the bounded sample ⇒ NOT unavailable", async () => {
  const r = await ask("عايز كوتشي اسود مقاس 43");
  assert.notEqual(r.action, "unavailable");
  assert.equal(r.action, "soft_match");
  assert.doesNotMatch(r.answer, /مش متوفر/);
  assert.match(r.answer, /متاح/);
});

test("7/15: several real products ⇒ multi_recommendation (operator may pick more than one)", async () => {
  const r = await ask("عايز كوتشي اسود مقاس 43");
  assert.equal(r.product_ambiguous, true);
  assert.equal(r.selection_semantics, "recommendation");
  assert.ok(r.card_choices.length >= 2);
});

test("8: one product with several matching variants is ONE recommendation, not five", async () => {
  const r = await ask("عايز كوتشي اسود مقاس 43");
  const ids = r.card_choices.map((c) => String(c.product_id));
  assert.equal(new Set(ids).size, ids.length, "no product may repeat");
  assert.ok(ids.includes("3") && ids.includes("4"), "the golden products are surfaced");
});

test("9: returned cards carry canonical identity and stay within the recommendation UX bound", async () => {
  const r = await ask("عايز كوتشي اسود مقاس 43");
  assert.ok(r.card_choices.length <= 6);
  for (const c of r.card_choices) {
    assert.ok(c.product_id, "canonical product_id");
    assert.equal(c.grounded, true);
    for (const k of Object.keys(c)) assert.doesNotMatch(k, /cost|wholesale|supplier/i);
  }
});

// ---------------- 2: authoritative negative ----------------
test("2: authoritative query returns zero ⇒ unavailable is allowed", async () => {
  const r = await ask("عايز كوتشي اسود مقاس 43", { authoritative: [] });
  assert.match(String(r.answer), /مش متوفر|مش متاح/);
  assert.ok(["unavailable", "clarify_size"].includes(r.action));
});

test("a FAILED authoritative query is never turned into a definitive negative", async () => {
  // the resolver returns null on query failure — the gate must not claim proof it does not have
  const r = await G.applyInboxGroundingGate({
    tenantId: 1, sessionId: "1a3:err", message: "عايز كوتشي اسود مقاس 43",
    deps: { ...deps({}), findCategoryAvailability: async () => null },
  });
  assert.ok(["unavailable", "clarify_size"].includes(r.action), "falls back to the pre-existing bounded answer, unchanged");
  assert.notEqual(r.action, "soft_match", "a failed query must never be read as 'stock found'");
  // and the authoritative attempt is recorded as not proven
  assert.ok(!r.grounding?.authoritative_availability?.matches);
});

// ---------------- 3/4/5/6: the SQL predicates ----------------
test("3: colour family patterns include composite black colours (reusing COLOR_ALIASES)", () => {
  // entities.color is already normalised to the canonical COLOR_ALIASES key ("black"), the same value
  // matchesRequestedColor is given — the family (black/اسود/بلاك) comes from that one table.
  const patterns = G.buildColorFamilyPatterns("black");
  assert.ok(Array.isArray(patterns) && patterns.length);
  const matches = (value) => patterns.some((p) => value.toLowerCase().includes(p.replace(/%/g, "")));
  for (const c of ["Black", "ALL BLACK", "Black & Black", "White & Black", "Black & Red", "Black & Jeans & White"]) {
    assert.ok(matches(c), `"${c}" must be inside the black family`);
  }
  assert.equal(G.buildColorFamilyPatterns(""), null, "no colour requested ⇒ no colour predicate");
});

test("4/5/6: eligibility predicates are applied in SQL, before any LIMIT", () => {
  const src = G.defaultFindCategoryAvailability.toString();
  assert.match(src, /COALESCE\(p\.is_storefront_visible, TRUE\) = TRUE/);   // hidden products excluded
  assert.match(src, /COALESCE\(v\.stock, 0\) > 0/);                        // zero-stock excluded
  assert.match(src, /REPLACE\(LOWER\(COALESCE\(v\.size, ''\)\), ' ', ''\) ~/); // wrong size excluded
  assert.match(src, /LIKE ANY\(\$4::text\[\]\)/);                          // colour family
  const wherePos = src.indexOf("WHERE");
  assert.ok(wherePos > 0 && src.indexOf("LIMIT") > wherePos, "LIMIT comes AFTER the eligibility predicates");
});

// ---------------- MANDATORY INVARIANT ----------------
test("INVARIANT: a bounded sample is never the sole evidence for a category-wide negative", async () => {
  let authoritativeCalled = false;
  await G.applyInboxGroundingGate({
    tenantId: 1, sessionId: "1a3:inv", message: "عايز كوتشي اسود مقاس 43",
    deps: { ...deps({}), findCategoryAvailability: async () => { authoritativeCalled = true; return []; } },
  });
  assert.equal(authoritativeCalled, true, "the authoritative query MUST run before any category-wide negative");
});

// ---------------- 12/13/14: no regression on explicit-product paths ----------------
test("12: an explicit single-product size miss stays a product-level answer (no category override)", async () => {
  let called = false;
  const r = await G.applyInboxGroundingGate({
    tenantId: 1, sessionId: "1a3:explicit", message: "فيه جوردن فور مقاس 47؟",
    deps: {
      resolveByBrandModel: async () => [{ id: 39, name: "Air Jordan 4", product_type: "sneakers" }],
      queryProducts: async () => [],
      inventoryFacts: async () => ({ variant_stock: [{ variant_id: 1, size: "43", color: "black", stock: 2 }] }),
      resolveProductSubject: async () => null,
      findCategoryAvailability: async () => { called = true; return GOLDEN; },
    },
  });
  assert.equal(called, false, "an explicit product turn must not trigger the category resolver");
  assert.equal(r.action, "clarify_size");
});

test("13/14: disambiguation and variant-options semantics unchanged", async () => {
  const variants = [{ variant_id: 1, size: "43", color: "white&green", stock: 1 }, { variant_id: 2, size: "43", color: "Navy", stock: 2 }];
  const r = await G.applyInboxGroundingGate({
    tenantId: 1, sessionId: "1a3:opts", message: "فيه جوردن فور مقاس 43؟",
    deps: {
      resolveByBrandModel: async () => [{ id: 39, name: "Air Jordan 4", product_type: "sneakers" }],
      queryProducts: async () => [], inventoryFacts: async () => ({ variant_stock: variants }),
      resolveProductSubject: async () => null, findCategoryAvailability: async () => [],
    },
  });
  assert.equal(r.action, "color_choice_required");
  assert.equal(r.selection_semantics, "multi_variant_options");
});

// ---------------- 20/21/22: channel parity ----------------
test("20/21/22: Messenger / Instagram / WhatsApp reach the same decision", async () => {
  const actions = [];
  for (const s of ["messenger:x", "instagram:x", "whatsapp:x"]) actions.push((await ask("عايز كوتشي اسود مقاس 43", { session: s })).action);
  assert.deepEqual(actions, ["soft_match", "soft_match", "soft_match"]);
});

// ---------------- 23: nothing autonomous ----------------
test("23: the resolver only reads — no send path exists in the gate", () => {
  const src = G.defaultFindCategoryAvailability.toString();
  assert.match(src, /SELECT/);
  assert.doesNotMatch(src, /INSERT|UPDATE|DELETE/i);
});
