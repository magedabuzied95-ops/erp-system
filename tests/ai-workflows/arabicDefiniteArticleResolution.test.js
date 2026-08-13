// Batch 1A-2.1 — Arabic definite article on product/brand/model search terms.
//
// The 1A-2 production proof found the last price-grounding hole: "الجوردن فور بكام؟" kept the article in
// brandModelTerm, matched no catalog row, and the raw LLM price survived. The fix is token-level, additive, and
// scoped to brand/model terms — support-fact words, greetings and price wording must be untouched.
import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../../server/services/aiInboxGroundingGate.js";
import { resolveEffectiveCustomerPrice } from "../../src/shared/lib/effectiveCustomerPrice.js";
import { detectSupportFactIntent } from "../../server/services/aiSupportKnowledgeBaseService.js";

const P39 = { id: 39, name: "Air Jordan 4  Sneakers for Men", product_type: "sneakers",
  selling_price: 1750, price: 1750, regular_price: 1750, sale_price: 1550, sale_price_enabled: true };
const P208 = { id: 208, name: "Air Jordan 4 Retro", product_type: "sneakers", selling_price: 1900, price: 1900 };
const ADISTAR = { id: 359, name: "Adidas Adistar22", product_type: "sneakers", selling_price: 1600, price: 1600 };
const SALE_OFF = { sale_mode_enabled: false };

// A realistic catalog matcher: the SAME ranking the gate uses in production, over real product names.
const catalog = [P39, P208, ADISTAR, { id: 500, name: "Nike Air Max Plus", product_type: "sneakers", selling_price: 1750 },
  { id: 600, name: "Crocs Classic Clog", product_type: "crocs", selling_price: 900 }];
const deps = ({ variants = [], subject = null, saleModeSettings = SALE_OFF } = {}) => ({
  resolveByBrandModel: async (term) => G.rankBrandModelMatches(term, catalog),
  queryProducts: async () => catalog,
  inventoryFacts: async () => ({ variant_stock: variants }),
  resolveProductSubject: subject ? async () => subject : async () => null,
  resolveProductById: async ({ productId }) => catalog.find((p) => String(p.id) === String(productId)) || null,
  loadProductPricing: async ({ productId, variantId }) => {
    const product = catalog.find((p) => String(p.id) === String(productId));
    if (!product) return null;
    const variant = variants.find((v) => String(v.variant_id) === String(variantId)) || null;
    return resolveEffectiveCustomerPrice({ product, variant, saleModeSettings });
  },
});
const ask = (message, opts = {}) =>
  G.applyInboxGroundingGate({ tenantId: 1, sessionId: opts.session || "a21:test", message, deps: deps(opts), reply: opts.reply || null });

// ---------------- the helper itself ----------------
test("token helper strips the article only where it is safe", () => {
  assert.equal(G.normalizeArabicProductSearchToken("الجوردن"), "جوردن");
  assert.equal(G.normalizeArabicProductSearchToken("الاديداس"), "اديداس");
  assert.equal(G.normalizeArabicProductSearchToken("النايك"), "نايك");
  assert.equal(G.normalizeArabicProductSearchToken("الكروكس"), "كروكس");
  // too short overall, or nothing meaningful left → untouched
  assert.equal(G.normalizeArabicProductSearchToken("الله"), "الله");
  assert.equal(G.normalizeArabicProductSearchToken("الان"), "الان");
  assert.equal(G.normalizeArabicProductSearchToken("جوردن"), "جوردن");
});

test("term building is ADDITIVE — the original terms are never dropped", () => {
  const bare = G.buildBrandModelTerms("جوردن فور");
  const withArticle = G.buildBrandModelTerms("الجوردن فور");
  for (const t of bare) assert.ok(withArticle.includes(t), `article form must still contain "${t}"`);
});

// ---------------- 1/2/3: price parity ----------------
test("1/2/3: الجوردن فور resolves the same catalog family as جوردن فور (price path)", async () => {
  const bare = await ask("جوردن فور بكام؟");
  const article = await ask("الجوردن فور بكام؟");
  assert.equal(article.action, bare.action);
  assert.equal(article.action, "price_ambiguous", "39 + 208 both match ⇒ never an arbitrary price");
  assert.doesNotMatch(article.answer, /\d{3,}/);
  const article2 = await ask("سعر الجوردن فور كام؟");
  assert.equal(article2.action, "price_ambiguous");
});

test("11 (MANDATORY): a raw stale 1550 cannot leak through the article form", async () => {
  const r = await ask("الجوردن فور بكام؟", { reply: { answer: "سعره 1550 جنيه", suggested_products: [] } });
  assert.equal(r.changed, true, "the gate must take over the turn");
  assert.doesNotMatch(r.answer, /1550/);
});

test("3b: once ONE product is established, the article form prices it canonically", async () => {
  const r = await ask("الاديداس اديستار بكام؟");
  assert.equal(r.action, "price_grounded");
  assert.equal(r.price_grounding.product_id, 359);
  assert.match(r.answer, /1600/);
});

// ---------------- 4: availability parity ----------------
test("4: availability parity for الجوردن فور", async () => {
  const variants = [{ variant_id: 1, size: "43", color: "black", stock: 2 }];
  const bare = await ask("عندكم جوردن فور؟", { variants });
  const article = await ask("عندكم الجوردن فور؟", { variants });
  assert.equal(article.action, bare.action);
  assert.equal(article.product_ambiguous, bare.product_ambiguous);
  const avail = await ask("الجوردن فور متاح؟", { variants });
  assert.equal(avail.action, (await ask("جوردن فور متاح؟", { variants })).action);
});

// ---------------- 5/6/7: other real brand forms ----------------
for (const [withAl, bare] of [["الاديداس اديستار", "اديداس اديستار"], ["الأديداس أديستار", "اديداس اديستار"],
                              ["النايك", "نايك"], ["الكروكس", "كروكس"]]) {
  test(`5/6/7: "${withAl}" resolves like "${bare}"`, async () => {
    const a = await ask(`${withAl} متاح؟`);
    const b = await ask(`${bare} متاح؟`);
    assert.equal(a.action, b.action, `${withAl} → ${a.action} vs ${bare} → ${b.action}`);
  });
}

// ---------------- 8/9/10: nothing else may change ----------------
test("8: support-fact words are untouched (different module, never brand terms)", async () => {
  for (const [m, intent] of [["العنوان ايه؟", "STORE_LOCATION"], ["الاستبدال ازاي؟", "RETURN_EXCHANGE_POLICY"],
                             ["الاسترجاع؟", "RETURN_EXCHANGE_POLICY"], ["الشحن ازاي؟", "SHIPPING_POLICY"]]) {
    assert.equal(detectSupportFactIntent(m), intent, `${m} must still route to ${intent}`);
  }
  // and the helper does not mangle them if they were ever tokenised
  assert.equal(G.normalizeArabicProductSearchToken("العنوان"), "عنوان");
  assert.equal(detectSupportFactIntent("العنوان ايه؟"), "STORE_LOCATION");
});

test("9: greeting still routes to GREETING and carries no product", async () => {
  const r = await ask("السلام عليكم");
  assert.ok(r.changed === false || r.action === "conversational");
  assert.equal((r.color_choices || []).length, 0);
});

test("10: \"السعر كام؟\" with no subject invents nothing", async () => {
  const r = await ask("السعر كام؟");
  assert.doesNotMatch(String(r.answer || ""), /1750|1550|1600/);
});

// ---------------- 12-15: existing semantics preserved ----------------
test("12: an explicit article-form product still overrides the durable subject", async () => {
  const r = await ask("الاديداس اديستار بكام؟", { subject: { productId: "39", source: "approved_selection", ageSeconds: 30 } });
  assert.equal(r.price_grounding.product_id, 359);
});

test("13/14/15: disambiguation, recommendation and variant-options semantics preserved", async () => {
  const amb = await ask("عندكم الجوردن فور؟");
  assert.equal(amb.product_ambiguous, true);
  assert.ok(["identity_disambiguation", "recommendation"].includes(amb.selection_semantics));
  const variants = [{ variant_id: 1, size: "43", color: "white&green", stock: 1 }, { variant_id: 2, size: "43", color: "Navy", stock: 2 }];
  const opts = await ask("فيه الاديداس اديستار مقاس 43؟", { variants });
  assert.equal(opts.action, "color_choice_required");
  assert.equal(opts.selection_semantics, "multi_variant_options");
});
