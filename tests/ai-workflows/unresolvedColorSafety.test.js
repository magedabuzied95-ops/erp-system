// Colour-safety remediation — an unresolved colour constraint must FAIL CLOSED.
//
// Production proof after 1A-3: "عايز كوتشي بنفسجي مقاس 43" dropped the unrecognised colour, searched
// sneakers+size-43 colourlessly, found 24 rows and answered "متاح" for a colour nobody checked.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../../server/services/aiInboxGroundingGate.js";

const SNEAKERS = [{ id: 3, name: "Nike Air Jordan 1 Low Sneakers", product_type: "sneakers" }];
const GOLDEN = [{ id: 3, name: "Nike Air Jordan 1 Low Sneakers", product_type: "sneakers", variant_id: 824, color: "Black & Black", size: "43", stock: 2 },
  { id: 4, name: "Alexander Mcqueen Sneakers", product_type: "sneakers", variant_id: 898, color: "Black", size: "43", stock: 2 }];

let authoritativeCalls = [];
const deps = ({ authoritative = GOLDEN, variants = [], products = SNEAKERS, subject = null } = {}) => ({
  queryProducts: async () => products,
  resolveByBrandModel: async () => (products === SNEAKERS ? [] : products),
  inventoryFacts: async () => ({ variant_stock: variants }),
  resolveProductSubject: subject ? async () => subject : async () => null,
  resolveProductById: async () => products[0] || null,
  findCategoryAvailability: async (args) => { authoritativeCalls.push(args); return authoritative; },
});
const ask = (message, opts = {}) => {
  authoritativeCalls = [];
  return G.applyInboxGroundingGate({ tenantId: 1, sessionId: opts.session || "color:test", message, deps: deps(opts) });
};

// ---------------- 1/2/3: the three colour states ----------------
test("1: no colour mentioned → colourless category search stays valid", async () => {
  const e = G.extractRequestedEntities("عايز كوتشي مقاس 43");
  assert.equal(e.colorMentioned, false);
  assert.equal(e.color, "");
  const r = await ask("عايز كوتشي مقاس 43");
  assert.notEqual(r.action, "clarify_color_unsupported");
});

test("2/3: a recognised colour keeps its BROAD family (composites still match)", () => {
  const e = G.extractRequestedEntities("عايز كوتشي اسود مقاس 43");
  assert.equal(e.color, "black");
  assert.equal(e.colorMentioned, true);
  const patterns = G.buildColorFamilyPatterns("black");
  const matches = (v) => patterns.some((p) => v.toLowerCase().includes(p.replace(/%/g, "")));
  for (const c of ["Black", "ALL BLACK", "Black & Black", "White & Black", "Black & Red"]) assert.ok(matches(c), c);
});

// ---------------- 4-8: the unresolved-colour invariant ----------------
test("4/7/8: unknown colour → clarification, never available, never unavailable", async () => {
  const r = await ask("عايز كوتشي تركواز مقاس 43");
  assert.equal(r.action, "clarify_color_unsupported");
  assert.doesNotMatch(r.answer, /متاح|متوفر|مش متوفر/);
  assert.match(r.answer, /لون/);
});

test("5 (INVARIANT): unknown colour → the authoritative colourless query is NEVER executed", async () => {
  await ask("عايز كوتشي تركواز مقاس 43");
  assert.equal(authoritativeCalls.length, 0, "no availability query may run without the colour predicate");
});

test("6: unknown colour → zero product cards and no selection semantics", async () => {
  const r = await ask("عايز كوتشي تركواز مقاس 43");
  assert.equal(r.card_choices.length, 0);
  assert.equal(r.color_choices.length, 0);
  assert.equal(r.suggested_products.length, 0);
  assert.equal(r.selection_semantics, null);
  assert.equal(r.send_ready_card, null);
});

test("13: the size constraint survives the colour clarification", async () => {
  const r = await ask("عايز كوتشي تركواز مقاس 43");
  assert.match(r.answer, /43/);
  assert.equal(r.grounding.requested.size, "43");
});

test("a colour word we have never seen at all still fails closed (لون <word>)", async () => {
  const r = await ask("عايز كوتشي لون سلموني مقاس 43");
  assert.equal(r.action, "clarify_color_unsupported");
  assert.equal(authoritativeCalls.length, 0);
});

// ---------------- 9/10: explicit product + durable context ----------------
test("9: explicit product + unknown colour → clarification, no other colour returned", async () => {
  const r = await ask("جوردن فور تركواز مقاس 43", { products: [{ id: 39, name: "Air Jordan 4", product_type: "sneakers" }] });
  assert.equal(r.action, "clarify_color_unsupported");
  assert.equal(r.card_choices.length, 0);
});

test("10: durable subject + unknown colour → the colour constraint is not erased", async () => {
  const r = await ask("والتركواز؟", { subject: { productId: "39", source: "approved_selection", ageSeconds: 30 } });
  assert.equal(r.action, "clarify_color_unsupported");
});

// ---------------- 11/12: purple is real stock, so it must now resolve ----------------
test("11: بنفسجي resolves to the canonical purple family (36 in-stock variants exist)", async () => {
  const e = G.extractRequestedEntities("عايز كوتشي بنفسجي مقاس 43");
  assert.equal(e.color, "purple");
  assert.equal(e.colorMentioned, true);
  const r = await ask("عايز كوتشي بنفسجي مقاس 43", { authoritative: [{ id: 9, name: "Purple Sneaker", product_type: "sneakers", variant_id: 1, color: "Purple", size: "43", stock: 2 }] });
  assert.notEqual(r.action, "clarify_color_unsupported");
  assert.equal(authoritativeCalls[0]?.color, "purple", "the colour predicate IS passed to the authoritative query");
});

test("12: recognised colour with zero authoritative stock → authoritative unavailable", async () => {
  const r = await ask("عايز كوتشي بنفسجي مقاس 43", { authoritative: [] });
  assert.notEqual(r.action, "soft_match");
  assert.match(String(r.answer), /مش متوفر|مش متاح/);
});

test("catalogue vocabulary gaps closed: burgundy / olive / camel / bige", () => {
  for (const [word, canonical] of [["نبيتي", "burgundy"], ["زيتي", "olive"], ["كاميل", "camel"], ["بيج", "beige"]]) {
    assert.equal(G.extractRequestedEntities(`عايز كوتشي ${word} مقاس 43`).color, canonical, word);
  }
  assert.ok(G.buildColorFamilyPatterns("beige").includes("%bige%"), "the catalogue's own 'bige' spelling is in the beige family");
});

// ---------------- 15-19: non-regression ----------------
test("15: the 1A-3 black size-43 positive proof is unchanged", async () => {
  const r = await ask("عايز كوتشي اسود مقاس 43");
  assert.equal(r.action, "soft_match");
  assert.equal(r.selection_semantics, "recommendation");
  assert.equal(authoritativeCalls[0]?.color, "black");
});

test("16/18: variant-options and disambiguation semantics unchanged", async () => {
  const variants = [{ variant_id: 1, size: "43", color: "white&green", stock: 1 }, { variant_id: 2, size: "43", color: "Navy", stock: 2 }];
  const r = await G.applyInboxGroundingGate({
    tenantId: 1, sessionId: "color:opts", message: "فيه جوردن فور مقاس 43؟",
    deps: { resolveByBrandModel: async () => [{ id: 39, name: "Air Jordan 4", product_type: "sneakers" }],
      queryProducts: async () => [], inventoryFacts: async () => ({ variant_stock: variants }),
      resolveProductSubject: async () => null, findCategoryAvailability: async () => [] },
  });
  assert.equal(r.action, "color_choice_required");
  assert.equal(r.selection_semantics, "multi_variant_options");
});

// ---------------- 20/21/22/23 ----------------
test("20/21/22: Messenger / Instagram / WhatsApp reach the same colour decision", async () => {
  const actions = [];
  for (const s of ["messenger:c", "instagram:c", "whatsapp:c"]) actions.push((await ask("عايز كوتشي تركواز مقاس 43", { session: s })).action);
  assert.deepEqual(actions, ["clarify_color_unsupported", "clarify_color_unsupported", "clarify_color_unsupported"]);
});

test("23: the clarification is a draft correction only — nothing is sent", async () => {
  const r = await ask("عايز كوتشي تركواز مقاس 43");
  assert.equal(r.changed, true);
  assert.equal(r.send_ready_card, null);
});
