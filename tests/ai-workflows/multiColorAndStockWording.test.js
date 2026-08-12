// Phase 12.2 — multi-colour size disambiguation + Arabic stock-count wording.
// 0 in-stock colours → unavailable; 1 → auto-ground; >1 → color_choice_required (no silent max-stock pick).
// Explicit colour always wins. Facts are always fresh ERP. Stock wording via one deterministic helper.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as G from "../../server/services/aiInboxGroundingGate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const inboxSrc = readFileSync(path.join(here, "../../src/modules/aiSupport/pages/AiInbox.jsx"), "utf8");
const salesSrc = readFileSync(path.join(here, "../../server/services/aiSalesAgentService.js"), "utf8");

const P = { id: 359, name: "Adidas Adistar22", product_type: "sneakers" };
// durable-context deps so a size-only continuation ("طب مقاس 43؟") recalls the product then re-grounds fresh.
const ctx = (variants) => ({
  resolveProductSubject: async () => ({ productId: "359", source: "approved_selection", ageSeconds: 30 }),
  resolveProductById: async () => P,
  resolveByBrandModel: async () => [],
  inventoryFacts: async () => ({ variant_stock: variants }),
});
const run = (message, variants, deps) => G.applyInboxGroundingGate({ tenantId: 1, sessionId: "instagram:X", message, deps: deps || ctx(variants) });

// ---- MULTI-COLOR ----
test("1: only one colour in stock at the size → auto-select it (proven Adistar Navy case stays green)", async () => {
  const r = await run("طب مقاس ٤٣؟", [{ variant_id: 6288, size: "43", color: "Navy", stock: 1 }, { variant_id: 6283, size: "43", color: "White", stock: 0 }]);
  assert.equal(r.action, "available");
  assert.equal(r.grounding.resolved.color, "Navy");
  assert.equal(r.color_choice_required, false);
});

test("2: two in-stock colours → color_choice_required, no arbitrary max-stock pick", async () => {
  const r = await run("طب مقاس ٤٣؟", [{ variant_id: 1, size: "43", color: "Navy", stock: 1 }, { variant_id: 2, size: "43", color: "White", stock: 5 }, { variant_id: 3, size: "43", color: "Black", stock: 0 }]);
  assert.equal(r.action, "color_choice_required");
  assert.equal(r.color_choice_required, true);
  assert.ok(!r.send_ready_card, "no definitive card before a colour is chosen");
  assert.deepEqual(r.color_choices.map((c) => c.color).sort(), ["Navy", "White"]);
});

test("3: three in-stock colours → all distinct grounded colours returned", async () => {
  const r = await run("طب مقاس ٤٣؟", [{ variant_id: 1, size: "43", color: "Navy", stock: 1 }, { variant_id: 2, size: "43", color: "White", stock: 2 }, { variant_id: 3, size: "43", color: "Black", stock: 3 }]);
  assert.equal(r.action, "color_choice_required");
  assert.equal(r.color_choices.length, 3);
});

test("4: duplicate variants of the same normalised colour → one choice, deterministic representative", async () => {
  const r = await run("طب مقاس ٤٣؟", [{ variant_id: 1, size: "43", color: "Navy", stock: 1 }, { variant_id: 2, size: "43", color: "navy", stock: 4 }, { variant_id: 3, size: "43", color: "White", stock: 2 }]);
  assert.equal(r.action, "color_choice_required");
  const navy = r.color_choices.filter((c) => String(c.color).toLowerCase() === "navy");
  assert.equal(navy.length, 1);
  assert.equal(navy[0].variant_id, 2); // best-stock representative for that colour
});

test("5: explicit colour requested & available → exact variant, NO colour choices", async () => {
  const r = await run("طب الاسود مقاس ٤٣؟", [{ variant_id: 3, size: "43", color: "Black", stock: 2 }, { variant_id: 2, size: "43", color: "White", stock: 5 }]);
  assert.equal(r.action, "available");
  assert.equal(r.grounding.resolved.color, "Black");
  assert.equal(r.color_choice_required, false);
});

test("6: explicit colour requested & unavailable → not-available/clarify, NO silent substitute", async () => {
  const r = await run("طب الاسود مقاس ٤٣؟", [{ variant_id: 3, size: "43", color: "Black", stock: 0 }, { variant_id: 2, size: "43", color: "White", stock: 5 }]);
  assert.notEqual(r.action, "available");
  assert.notEqual(r.action, "color_choice_required");
  assert.doesNotMatch(String(r.answer || ""), /White|أبيض/); // never substitutes White
});

test("0-colours: size present but nothing in stock at it → unavailable (not choices)", async () => {
  const r = await run("طب مقاس ٤٣؟", [{ variant_id: 1, size: "43", color: "Navy", stock: 0 }, { variant_id: 2, size: "43", color: "White", stock: 0 }]);
  assert.equal(r.action, "unavailable");
  assert.equal(r.color_choice_required, false);
});

test("7/8: same multi-colour rule applies via context AND via explicit product", async () => {
  const viaContext = await run("طب مقاس ٤٣؟", [{ variant_id: 1, size: "43", color: "Navy", stock: 1 }, { variant_id: 2, size: "43", color: "White", stock: 2 }]);
  assert.equal(viaContext.grounding.product_resolution.source, "conversation_context");
  assert.equal(viaContext.action, "color_choice_required");
  const viaExplicit = await G.applyInboxGroundingGate({ tenantId: 1, sessionId: "instagram:X", message: "متاح اديداس اديستار مقاس ٤٣؟", deps: { resolveByBrandModel: async () => [P], inventoryFacts: async () => ({ variant_stock: [{ variant_id: 1, size: "43", color: "Navy", stock: 1 }, { variant_id: 2, size: "43", color: "White", stock: 2 }] }) } });
  assert.equal(viaExplicit.grounding.product_resolution.source, "explicit_message");
  assert.equal(viaExplicit.action, "color_choice_required");
});

test("9/10: colour choices carry product_id/size/variant + NO cost/wholesale/supplier fields", async () => {
  const r = await run("طب مقاس ٤٣؟", [{ variant_id: 1, size: "43", color: "Navy", stock: 1 }, { variant_id: 2, size: "43", color: "White", stock: 2 }]);
  for (const c of r.color_choices) {
    assert.equal(String(c.product_id), "359");
    assert.equal(c.size, "43");
    assert.ok(c.variant_id);
    for (const k of Object.keys(c)) assert.doesNotMatch(k, /cost|wholesale|supplier|purchase/i);
  }
});

test("11/12: send-ready enrichment includes color_choices; Instagram concise formatter untouched", () => {
  assert.match(salesSrc, /color_choice_required: Boolean\(groundingResult\.color_choice_required\)/);
  assert.match(salesSrc, /color_choices: enrichedColorChoices/);
  // the concise Instagram formatter is unchanged (still name+price+link, no sizes/CTA)
  const cards = readFileSync(path.join(here, "../../server/services/aiProductCards.js"), "utf8");
  assert.match(cards, /export const instagramProductShareText/);
});

test("13/14: frontend gates approval on colour pick + reuses the single-suggestion machinery", () => {
  assert.match(inboxSrc, /color_choice_required && !suggestionChosenCard && !suggestionProductRemoved/);
  assert.match(inboxSrc, /aiSuggestionColorRequired=\{Boolean\(suggestionSendPackage\?\.color_choice_required\)\}/);
});

// ---- ARABIC STOCK WORDING ----
test("15-18: formatArabicPieces grammar", () => {
  assert.equal(G.formatArabicPieces(1), "قطعة واحدة");
  assert.equal(G.formatArabicPieces(2), "قطعتين");
  assert.equal(G.formatArabicPieces(3), "3 قطع");
  assert.equal(G.formatArabicPieces(10), "10 قطع");
});

test("17: available answer uses the helper (1 → قطعة واحدة, never '1 قطع')", async () => {
  const r = await run("طب مقاس ٤٣؟", [{ variant_id: 1, size: "43", color: "Navy", stock: 1 }]);
  assert.match(r.answer, /قطعة واحدة/);
  assert.doesNotMatch(r.answer, /1 قطع/);
});

test("19/20: helper is presentation-only — never alters the factual stock number", async () => {
  const r = await run("طب مقاس ٤٣؟", [{ variant_id: 1, size: "43", color: "Navy", stock: 1 }]);
  assert.equal(r.grounding.resolved.stock, 1); // fact unchanged
  assert.equal(G.formatArabicPieces("not a number"), "0 قطع");
});
