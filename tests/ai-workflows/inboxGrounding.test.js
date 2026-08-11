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

test("SAFETY: gate never throws, never sends, never writes stock/orders/restock intents", async () => {
  const bad = await G.applyInboxGroundingGate({ tenantId: 1, message: LIVE, reply: {}, deps: { queryProducts: async () => { throw new Error("boom"); } } });
  assert.equal(bad.changed, false); // failure-isolated
  assert.equal(/sendTextMessage|sendMetaInboxOutboundMessage|createIntent|adjustVariantStock|INSERT INTO restock_intents|UPDATE product_variants/.test(gateSrc), false);
});
