// AI Studio Phase 10.6 — AI Inbox intent accuracy + exact product/variant grounding.
// Regression for the REAL Phase 10.5 failure: "السلام عليكم ورحمة الله / عندكم كروكس اسود مقاس 44 ؟"
// was classified GREETING and answered with Air Jordan. These are deterministic, DB-free tests (the gate's
// impure orchestrator is exercised via injected catalog-shaped fixtures).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const G = await import("../../server/services/aiInboxGroundingGate.js");
const { resolveIntent } = await import("../../server/services/aiIntentResolver.js");
const { extractShoeSize } = await import("../../server/services/aiMessageExtractors.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const gateSrc = readFileSync(path.join(here, "../../server/services/aiInboxGroundingGate.js"), "utf8");

const LIVE = "السلام عليكم ورحمة الله\nعندكم كروكس اسود مقاس 44 ؟";

test("EXACT live message: entities = Crocs / black / 44, greeting is secondary", () => {
  const e = G.extractRequestedEntities(LIVE);
  assert.equal(e.productType, "crocs");
  assert.equal(e.color, "black");
  assert.equal(e.size, "44");
  assert.equal(e.hasGreeting, true);
  assert.equal(e.wantsAvailability, true);
});

test("EXACT live message: intent is NOT GREETING", () => {
  assert.notEqual(resolveIntent(LIVE), "GREETING");
  assert.equal(resolveIntent(LIVE), "AVAILABILITY_INQUIRY");
  assert.equal(G.resolveRequestedIntent(LIVE), "PRODUCT_AVAILABILITY");
});

test("Arabic-digit + hamza normalization: ٤٤ → 44, أسود → black", () => {
  const e = G.extractRequestedEntities("عندكم كروكس أسود مقاس ٤٤؟");
  assert.equal(e.size, "44");
  assert.equal(e.color, "black");
  assert.equal(e.productType, "crocs");
  assert.equal(extractShoeSize("مقاس ٤٤"), "44");
});

test("intent matrix A–H", () => {
  assert.equal(resolveIntent("السلام عليكم"), "GREETING"); // A
  assert.equal(G.resolveRequestedIntent("السلام عليكم"), "GREETING");
  assert.equal(G.resolveRequestedIntent("السلام عليكم عندكم كروكس اسود مقاس 44؟"), "PRODUCT_AVAILABILITY"); // B
  assert.equal(G.resolveRequestedIntent("عندكم كروكس أسود مقاس ٤٤؟"), "PRODUCT_AVAILABILITY"); // C
  assert.equal(G.resolveRequestedIntent("عندكم كروكس؟"), "PRODUCT_AVAILABILITY"); // D
  assert.equal(G.resolveRequestedIntent("عندكم مقاس 44؟"), "PRODUCT_AVAILABILITY"); // E
  assert.equal(G.resolveRequestedIntent("السلام عليكم الاوردر بتاعي وصل فين؟"), "ORDER_STATUS"); // F
  assert.equal(G.resolveRequestedIntent("مساء الخير الاستبدال خلال كام يوم؟"), "RETURN_POLICY"); // G
  assert.equal(G.resolveRequestedIntent("بلغني لما الكروكس الأسود مقاس 44 ينزل"), "RESTOCK_REQUEST"); // H
});

test("compatibility + variant matching primitives", () => {
  const crocsReq = { productType: "crocs", productTerm: "كروكس" };
  assert.equal(G.isCompatibleProduct({ name: "Air Jordan 4 for Men - black", product_type: "sneakers" }, crocsReq), false); // I core
  assert.equal(G.isCompatibleProduct({ name: "Crocs Classic Clog", product_type: "crocs" }, crocsReq), true);
  assert.equal(G.matchesRequestedSize("M8/W10", "44"), false); // Crocs M/W never matches numeric 44
  assert.equal(G.matchesRequestedSize("44", "44"), true);
  assert.equal(G.matchesRequestedSize("43", "44"), false); // J core
  assert.equal(G.matchesRequestedColor("Black", "black"), true);
  assert.equal(G.matchesRequestedColor("White", "black"), false); // K core
});

test("decideGrounding matrix I/J/K/L/M — availability only with exact-variant evidence", () => {
  const e = { productType: "crocs", productTerm: "كروكس", typeLabel: "كروكس", color: "black", colorLabel: "الأسود", size: "44" };
  // I — no compatible product → clarify, never substitute
  const I = G.decideGrounding({ entities: e, compatibleProducts: [], variantGrounding: null });
  assert.equal(I.action, "no_match"); assert.equal(I.cards.length, 0);
  // J — size 44 requested, not present on product → no availability claim (clarify)
  const J = G.decideGrounding({ entities: e, compatibleProducts: [{ id: 1, name: "Crocs", product_type: "crocs" }], variantGrounding: { sizeResolution: { matchType: "NO_VARIANT_MATCH" }, exactVariant: null, availableSizesDisplay: ["43/44"] } });
  assert.equal(J.action, "clarify_size"); assert.doesNotMatch(J.answer, /^أيوه/);
  // K — size resolves but not in the requested color → color clarification, never an availability claim
  const K = G.decideGrounding({ entities: e, compatibleProducts: [{ id: 1, name: "Crocs", product_type: "crocs" }], variantGrounding: { sizeResolution: { matchType: "UNIQUE_CONVERSION" }, exactVariant: null, sizeAvailableOtherColor: true } });
  assert.notEqual(K.action, "available");
  // L — exact compatible variant in stock → available
  const L = G.decideGrounding({ entities: e, compatibleProducts: [{ id: 1, name: "Crocs", product_type: "crocs" }], variantGrounding: { exactVariant: { variantId: 9, size: "44", color: "Black" }, exactStock: 3 } });
  assert.equal(L.action, "available"); assert.match(L.answer, /متوفر/);
  // M — exact compatible variant out of stock → unavailable / restock offer
  const M = G.decideGrounding({ entities: e, compatibleProducts: [{ id: 1, name: "Crocs", product_type: "crocs" }], variantGrounding: { exactVariant: { variantId: 9, size: "44", color: "Black" }, exactStock: 0 } });
  assert.equal(M.action, "unavailable"); assert.match(M.answer, /إشعار|يرجع/);
});

test("END-TO-END gate on the EXACT live message (Crocs M/W catalog): clarify, NO Air Jordan, no fake availability", async () => {
  const deps = {
    queryProducts: async () => ([{ id: 734, name: "Crocs Classic Clog", product_type: "crocs" }]), // crocs-constrained query
    inventoryFacts: async () => ({ variant_stock: [
      { variant_id: 9058, size: "M8/W10", color: "Black", stock: 0 },
      { variant_id: 9057, size: "M8/W10", color: "White", stock: 0 },
    ] }),
  };
  const reply = { answer: "لقيتلك 3 اختيارات... Air Jordan 4", suggested_products: [{ id: 47, name: "Air Jordan 4 for Men - black", product_type: "sneakers" }], confidence: 0.82 };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, message: LIVE, reply, intent: "GREETING", deps });
  assert.equal(r.changed, true);
  assert.equal(r.requestedIntent, "PRODUCT_AVAILABILITY"); // not GREETING
  assert.equal(r.action, "clarify_size"); // 44 is not a Crocs M/W size → clarify, do not claim availability
  // No Air Jordan survives; only Crocs (or empty) cards
  for (const c of r.suggested_products) assert.equal(String(c.product_type || "").includes("croc") || /croc/i.test(c.name || ""), true);
  assert.doesNotMatch(r.answer, /jordan/i);
  assert.doesNotMatch(r.answer, /^أيوه/); // no positive availability claim
});

test("gate E (missing product) → clarify which product; gate H (restock) → suggest only, never auto-create", async () => {
  const e = await G.applyInboxGroundingGate({ tenantId: 1, message: "عندكم مقاس 44؟", reply: { answer: "", suggested_products: [] }, deps: { queryProducts: async () => [], inventoryFacts: async () => ({}) } });
  assert.equal(e.action, "clarify_product");
  const h = await G.applyInboxGroundingGate({ tenantId: 1, message: "بلغني لما الكروكس الأسود مقاس 44 ينزل", reply: { answer: "", suggested_products: [] }, deps: { queryProducts: async () => [], inventoryFacts: async () => ({}) } });
  assert.equal(h.action, "restock_suggestion");
  assert.equal(h.requestedIntent, "RESTOCK_REQUEST");
});

// ---- Phase 10.8 — Product / Brand / Model grounding (reuse the alias engine, NOT a hardcoded shoe list) ----

test("10.8 buildBrandModelTerms: جوردن فور expands (via alias engine) to jordan/jordan 4", () => {
  const terms = G.buildBrandModelTerms("جوردن فور");
  assert.ok(terms.includes("jordan"), "expected 'jordan'");
  assert.ok(terms.includes("jordan 4"), "expected 'jordan 4'");
});

test("10.8 rankBrandModelMatches: explicit model (Jordan 4) outranks the bare-brand row", () => {
  const rows = [
    { id: 208, name: "Jordan 4", product_type: "sneakers" },
    { id: 3, name: "Nike Air Jordan 1 Low Sneakers", product_type: "sneakers" },
  ];
  const ranked = G.rankBrandModelMatches("جوردن فور", rows);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 208); // "jordan 4" (2-word phrase) beats "jordan" (single token)
  // Bare brand "جوردن" is ambiguous → BOTH Jordan rows survive (present/clarify, never silently pick one).
  const brandOnly = G.rankBrandModelMatches("جوردن", rows);
  assert.equal(brandOnly.length, 2);
});

test("10.8 extractRequestedEntities: brand/model term isolated from greeting/availability/size", () => {
  const e = G.extractRequestedEntities("السلام عليكم عندكم جوردن فور مقاس ٤٥؟");
  assert.equal(e.productType, ""); // no CATEGORY term — this is the Phase 10.5 miss
  assert.equal(e.size, "45");
  assert.equal(e.brandModelTerm, "جوردن فور");
  // Latin + a MODEL NUMBER must be preserved (size dropped, model "4" kept).
  const l = G.extractRequestedEntities("عندكم Jordan 4 مقاس 45؟");
  assert.equal(l.size, "45");
  assert.equal(l.brandModelTerm, "jordan 4");
});

test("10.8 END-TO-END: EXACT live Jordan message → Jordan 4 resolved → size 45 in stock → available", async () => {
  const deps = {
    resolveByBrandModel: async () => ([{ id: 208, name: "Jordan 4", product_type: "sneakers" }]),
    inventoryFacts: async () => ({ variant_stock: [
      { variant_id: 4101, size: "41", color: "Black", stock: 2 },
      { variant_id: 4105, size: "45", color: "Black", stock: 1 },
    ] }),
  };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, message: "السلام عليكم\nعندكم جوردن فور مقاس ٤٥؟", deps });
  assert.equal(r.changed, true);
  assert.equal(r.requestedIntent, "PRODUCT_AVAILABILITY"); // NOT clarify_product, NOT GREETING
  assert.equal(r.action, "available");
  assert.match(r.answer, /متوفر/);
  assert.equal(r.grounding.requested.brandModel, true);
  assert.equal(r.grounding.resolved.productId, 208);
  assert.equal(String(r.grounding.resolved.displaySize), "45");
  assert.equal(r.suggested_products[0].id, 208); // grounded to the REAL product
  assert.equal(r.suggested_products[0].grounded, true);
});

test("10.8 Latin 'Jordan 4 مقاس 45' → available (same grounding path)", async () => {
  const deps = {
    resolveByBrandModel: async () => ([{ id: 208, name: "Jordan 4", product_type: "sneakers" }]),
    inventoryFacts: async () => ({ variant_stock: [{ variant_id: 4105, size: "45", color: "Black", stock: 1 }] }),
  };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, message: "عندكم Jordan 4 مقاس 45؟", deps });
  assert.equal(r.action, "available");
  assert.equal(r.grounding.resolved.productId, 208);
});

test("10.8 bare brand 'عندكم جوردن؟' → multiple compatible options (present, never a false availability claim)", async () => {
  const deps = {
    resolveByBrandModel: async () => ([
      { id: 208, name: "Jordan 4", product_type: "sneakers" },
      { id: 3, name: "Nike Air Jordan 1 Low Sneakers", product_type: "sneakers" },
    ]),
    inventoryFacts: async () => ({ variant_stock: [] }),
  };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, message: "عندكم جوردن؟", deps });
  assert.equal(r.changed, true);
  assert.equal(r.action, "soft_match"); // no size → present compatible options, ask
  assert.equal(r.suggested_products.length, 2);
  for (const c of r.suggested_products) assert.equal(c.product_type, "sneakers");
  assert.doesNotMatch(r.answer, /^أيوه/); // never a positive availability claim without an exact variant
});

test("10.8 model + size 'نايك Air Max مقاس 44' → resolved model, exact variant → available", async () => {
  const deps = {
    resolveByBrandModel: async () => ([{ id: 512, name: "Nike Air Max 90", product_type: "sneakers" }]),
    inventoryFacts: async () => ({ variant_stock: [{ variant_id: 900, size: "44", color: "Black", stock: 3 }] }),
  };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, message: "عندكم نايك Air Max مقاس 44؟", deps });
  assert.equal(r.action, "available");
  assert.equal(r.grounding.resolved.productId, 512);
});

test("10.8 UNKNOWN brand/model resolves to NOTHING → clarify (no hallucinated product)", async () => {
  const deps = { resolveByBrandModel: async () => ([]), inventoryFacts: async () => ({}) };
  const r = await G.applyInboxGroundingGate({ tenantId: 1, message: "عندكم سوبر ستار الفلاني مقاس 44؟", deps });
  assert.equal(r.action, "clarify_product"); // falls through — never invents a product
  assert.equal(r.suggested_products.length, 0);
});

test("SAFETY: gate never throws, never sends, never writes stock/orders/restock intents", async () => {
  const bad = await G.applyInboxGroundingGate({ tenantId: 1, message: LIVE, reply: {}, deps: { queryProducts: async () => { throw new Error("boom"); } } });
  assert.equal(bad.changed, false); // failure-isolated
  assert.equal(/sendTextMessage|sendMetaInboxOutboundMessage|createIntent|adjustVariantStock|INSERT INTO restock_intents|UPDATE product_variants/.test(gateSrc), false);
});
