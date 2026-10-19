import test from "node:test";
import assert from "node:assert/strict";

import pool from "../../server/database/db.js";
import { normalizeArabicIntentPayload } from "../../server/utils/arabicTextNormalizer.js";
import { resolveFollowupContext } from "../../server/utils/aiConversationMemoryV2.js";
import { detectNamedColorway, missingColorwayText } from "../../server/utils/namedColorways.js";

/**
 * The owner's WhatsApp test, production, 2026-10-19 22:00: with an Air Force on screen, "متاح بلاك
 * كات ؟" got "أيوه يا فندم، Nike Air Force 1 Sneakers باللون الأبيض والأسود متاحة عندنا" — a
 * different shoe presented as the one asked. The catalog has no Black Cat.
 *
 * Brain V2 runs for real against a stubbed catalog (pool.query).
 */

const JORDANS = [
  { id: 301, name: "Air Jordan 4 Retro - Black", sku: "AJ4-BLK", status: "active", total_stock: 5, price: 1900, tenant_id: 1 },
  { id: 302, name: "Air Jordan 4 Retro - White", sku: "AJ4-WHT", status: "active", total_stock: 5, price: 1900, tenant_id: 1 },
];
const AIR_FORCE = { id: 201, name: "Nike Air Force 1 Sneakers", sku: "AF1", status: "active", total_stock: 9, price: 650, tenant_id: 1 };
let catalog = [];

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
pool.query = async (sql, params = []) => {
  const query = String(sql);
  if (query.includes("information_schema.columns")) {
    const columns = params[0] === "products" ? ["id", "name", "sku", "status", "total_stock", "price", "tenant_id", "description"] : [];
    return { rows: columns.map((column_name) => ({ column_name })) };
  }
  if (/FROM products p\s+WHERE 1 = 1/.test(query)) {
    const patterns = params.slice(1).filter((param) => typeof param === "string").map((param) => new RegExp(escape(param.replace(/^%|%$/g, "")), "i"));
    return { rows: catalog.filter((row) => patterns.some((re) => re.test(row.name) || re.test(row.sku) || re.test(row.description || ""))) };
  }
  if (/FROM products/.test(query) && params.length) return { rows: catalog.filter((row) => String(row.id) === String(params[0])) };
  return { rows: [] };
};

const { generateAiBrainV2Decision } = await import("../../server/services/aiBrainV2Service.js");
const { generateUnifiedConversationDecision, rewriteStructuredDecision } = await import("../../server/services/aiUnifiedDecisionService.js");

const ask = (raw, memory = {}) => generateAiBrainV2Decision(
  { channel: "whatsapp", text: normalizeArabicIntentPayload(raw).normalizedForIntent, metadata: { original_message: raw, tenant_id: 1 } },
  { tenantId: 1, memory },
);
const names = (decision) => (decision.product_cards || decision.products || []).map((card) => card.name || card.title);
const card = (row, color) => ({ product_id: String(row.id), id: String(row.id), name: row.name, title: row.name, color, price: row.price, image_url: `https://img.test/${row.id}.jpg`, available_sizes: ["42", "43"] });

// The Air Force the bot had just shown, with a size already picked (the shape the brain saves).
const airForceOnScreen = {
  preferences: { active_product_id: "201", activeSize: "42", last_product_cards: [card(AIR_FORCE, "White Black")] },
};

test("a colourway by name is detected; a colour word alone is not one", () => {
  assert.equal(detectNamedColorway("متاح بلاك كات ؟")?.key, "black_cat");
  assert.equal(detectNamedColorway("عايز البلاك كات")?.key, "black_cat");
  assert.equal(detectNamedColorway("Black Cat 42")?.key, "black_cat");
  assert.equal(detectNamedColorway("متاح ميليتري بلاك")?.key, "military_black");
  assert.equal(detectNamedColorway("ريد ثاندر")?.key, "red_thunder");
  for (const colour of ["بلاك", "الاسود", "اسود", "عايز البلاك", "black", "كات"]) {
    assert.equal(detectNamedColorway(colour), null, colour);
  }
});

test("بلاك كات with no such product: said plainly, other Jordan 4s offered as the alternative", async () => {
  // A Dunk whose description mentions the Jordan 4 is found by the search, but is not a Jordan 4.
  const lookalike = { id: 401, name: "Nike Dunk Low Black", sku: "DUNK-BLK", status: "active", total_stock: 4, price: 900, tenant_id: 1, description: "شكل الجوردن 4 بسعر اقل" };
  catalog = [AIR_FORCE, ...JORDANS, lookalike];
  const decision = await ask("متاح بلاك كات ؟", airForceOnScreen);
  assert.notEqual(decision.intent, "post_product_color_selected");
  assert.equal(decision.text, "للأسف بلاك كات مش متاح عندنا دلوقتي 🙏\nبس متاح جوردن 4 بألوان تانية، ممكن تعجبك كبديل 👇");
  assert.ok(names(decision).length > 0, "the alternatives are shown");
  for (const name of names(decision)) assert.match(name, /Jordan 4/, "only the same model is offered");
  assert.equal(names(decision)[0], "Air Jordan 4 Retro - Black", "the closest colour first");
  assert.equal(decision.debug.colorway_missing_reply.colorway, "black_cat");
});

test("بلاك كات when the model is not stocked at all: no unrelated shoe is shown", async () => {
  catalog = [AIR_FORCE];
  const decision = await ask("متاح بلاك كات ؟", airForceOnScreen);
  assert.equal(decision.text, missingColorwayText({ colorway: detectNamedColorway("بلاك كات") }));
  assert.match(decision.text, /^للأسف بلاك كات مش متاح عندنا دلوقتي/);
  assert.deepEqual(names(decision), []);
});

test("a stocked Black Cat is shown alone", async () => {
  catalog = [AIR_FORCE, ...JORDANS, { id: 303, name: "Air Jordan 4 Black Cat", sku: "AJ4-CAT", status: "active", total_stock: 2, price: 2100, tenant_id: 1 }];
  const decision = await ask("متاح بلاك كات ؟", airForceOnScreen);
  assert.deepEqual(names(decision), ["Air Jordan 4 Black Cat"]);
  assert.doesNotMatch(decision.text, /مش متاح/);
});

test("عايز البلاك كات is not an order for the Air Force on screen", async () => {
  catalog = [AIR_FORCE, ...JORDANS];
  const memory = { lastMentionedProductId: "201", lastShownProductCards: [{ productId: "201", name: AIR_FORCE.name, color: "White Black" }] };
  for (const raw of ["عايز البلاك كات", "متاح ميليتري بلاك 42"]) {
    const payload = normalizeArabicIntentPayload(raw);
    assert.equal(resolveFollowupContext({ memory, messageText: raw, normalizedPayload: payload, intentPayload: payload }).type, "none", raw);
  }
  const decision = await ask("عايز البلاك كات", { preferences: { ...airForceOnScreen.preferences, aiConversationMemoryV2: memory } });
  assert.notEqual(decision.intent, "post_product_order_confirmation");
  assert.ok(!names(decision).includes(AIR_FORCE.name));
});

test("a real colour pick after a model's cards still selects that colour", async () => {
  catalog = [AIR_FORCE, ...JORDANS];
  const jordansOnScreen = {
    preferences: { active_product_id: "302", last_product_cards: [card(JORDANS[1], "White"), card(JORDANS[0], "Black")] },
  };
  for (const raw of ["الاسود", "بلاك", "البلاك"]) {
    const decision = await ask(raw, jordansOnScreen);
    assert.equal(decision.intent, "post_product_color_selected", raw);
    assert.equal(decision.product_cards[0].product_id, "301", raw);
  }
  const memory = { lastMentionedProductId: "301", lastShownProductCards: [{ productId: "301", name: JORDANS[0].name, color: "Black" }] };
  const payload = normalizeArabicIntentPayload("الاسود");
  assert.equal(resolveFollowupContext({ memory, messageText: "الاسود", normalizedPayload: payload, intentPayload: payload }).color, "black");
});

test("the shared colour shortcut does not pick the Air Force's black for بلاك كات", async () => {
  catalog = [AIR_FORCE, ...JORDANS];
  const memory = {
    active_product_id: "201",
    activeSize: "42",
    last_product_cards: [card(AIR_FORCE, "White Black")],
    preferences: { ...airForceOnScreen.preferences },
  };
  const decision = await generateUnifiedConversationDecision({ channel: "whatsapp", text: "متاح بلاك كات ؟", metadata: { tenant_id: 1 } }, { tenantId: 1, memory });
  assert.notEqual(decision.intent, "post_product_color_selected");
  assert.ok(!names(decision).includes(AIR_FORCE.name), "the Air Force is not presented as Black Cat");
  assert.match(decision.text, /^للأسف بلاك كات مش متاح عندنا دلوقتي/);
});

test("the rewrite keeps the missing-colourway sentence word for word", async () => {
  const sentence = "للأسف بلاك كات مش متاح عندنا دلوقتي 🙏\nبس متاح جوردن 4 بألوان تانية، ممكن تعجبك كبديل 👇";
  const decision = {
    intent: "product_search",
    text: sentence,
    product_cards: [
      { name: "Air Jordan 4 Retro - Black", grade: "imported_from_vietnam" },
      { name: "Air Jordan 4 Retro - White", grade: "local" },
    ],
    debug: { colorway_missing_reply: { text: sentence, colorway: "black_cat" } },
  };
  const out = await rewriteStructuredDecision({ decision, inbound: { text: "متاح بلاك كات ؟" } });
  assert.equal(out.text, sentence);
});
