import test from "node:test";
import assert from "node:assert/strict";

import { detectCatalogBrowseSlots } from "../../server/utils/catalogBrowseRequest.js";
import { buildCatalogBrowseDecision, buildCatalogBrowseUrl } from "../../server/services/aiCatalogBrowseService.js";
import { storefrontQualityAliases } from "../../server/controllers/storefrontController.js";

/*
 * The owner's spec (2026-10-19): the bot browses like a salesperson — product type, size, grade,
 * audience, brand — asks only for what is missing (never "رجالي ولا حريمي" once the size is
 * known), explains the grades on request, and answers with ONE storefront link, no cards.
 */

const BRANDS = ["Unbranded", "Adidas", "Nike", "SKECHERS", "new balance", "PUMA", "crocs"];
const COUNTS = { local: 75, imported_from_vietnam: 126, mirror_original: 113 };

const loadersWith = (counts = COUNTS, seen = []) => ({
  brandNames: async () => BRANDS,
  countByGrade: async (slots) => {
    seen.push({ ...slots });
    return new Map(Object.entries(counts));
  },
});

const turn = async (message, memory = {}, counts = COUNTS, seen = []) =>
  buildCatalogBrowseDecision({ message, memory, channel: "whatsapp", loaders: loadersWith(counts, seen), now: Date.parse("2026-10-19T20:00:00Z") });

const nextMemory = (decision) => ({ preferences: { ...decision.memory_updates } });

test("everything given at once: one link, no question, no cards", async () => {
  const decision = await turn("عايز اشوف الموديلات المستورد الفيتنامي مقاس 42");
  assert.equal(decision.detected_intent, "catalog_browse");
  assert.deepEqual(decision.product_cards, []);
  assert.match(decision.text, /المستورد|مستورد فيتنامي/);
  assert.match(decision.text, /126 اختيار/);
  assert.match(decision.text, /\/share\/available\?size=42&quality=imported_from_vietnam&inStock=1/);
});

test("size known, grade missing: asks the grade (with counts) and never asks رجالي ولا حريمي", async () => {
  const ask = await turn("المتاح مقاس 42 ايه؟");
  assert.equal(ask.detected_intent, "catalog_browse_ask");
  assert.match(ask.text, /أنهي درجة/);
  assert.match(ask.text, /مصري \(75 اختيار\)/);
  assert.doesNotMatch(ask.text, /رجالي|حريمي/);
  const done = await turn("فيتنامي", nextMemory(ask));
  assert.equal(done.detected_intent, "catalog_browse");
  assert.match(done.text, /size=42&quality=imported_from_vietnam/);
});

test("nothing about type or size: asks what kind first", async () => {
  const ask = await turn("عايز اشوف الموديلات المصري");
  assert.equal(ask.detected_intent, "catalog_browse_ask");
  assert.match(ask.text, /كوتشيات ولا سليبر ولا شنط/);
});

test("a sized type with no size asks the size; bags never do", async () => {
  const shoes = await turn("عندك كوتشيات ميرور؟");
  assert.match(shoes.text, /مقاس كام/);
  const bags = await turn("عندك شنط ميرور؟");
  assert.equal(bags.detected_intent, "catalog_browse");
  assert.match(bags.text, /type=bags&quality=mirror_original/);
});

test("brand and gender the customer gives are filters on the link", async () => {
  const decision = await turn("وريني كوتشيات نايكي حريمي ميرور مقاس 38");
  assert.match(decision.url || decision.actions[0].value, /type=sneakers&brand=Nike&gender=women&size=38&quality=mirror_original/);
});

test("ايه الفرق: the owner's grade notes, then the question again", async () => {
  const ask = await turn("المتاح مقاس 42 ايه؟");
  const diff = await turn("ايه الفرق بينهم؟", nextMemory(ask));
  assert.equal(diff.detected_intent, "grade_difference");
  assert.match(diff.text, /مستورد فيتنامي — خامة أعلى/);
  assert.match(diff.text, /أنهي درجة/);
  const done = await turn("ميرور اوريجينال", nextMemory(diff));
  assert.match(done.text, /quality=mirror_original/);
});

test("an empty grade says so and offers the grades that have it", async () => {
  const decision = await turn("عايز كوتشي مصري مقاس 47", {}, { imported_from_vietnam: 4 });
  assert.equal(decision.detected_intent, "catalog_browse_ask");
  assert.match(decision.text, /مش متاح/);
  assert.match(decision.text, /مستورد فيتنامي \(4 اختيار\)/);
});

test("a named model, or a size for the product on screen, is not a browse", async () => {
  assert.equal(await turn("متاح ايرفورس مقاس 42"), null);
  assert.equal(await turn("متاح مقاس 42؟", { preferences: { active_product_id: "39" } }), null);
});

test("a stale question does not capture a later answer", async () => {
  const ask = await turn("المتاح مقاس 42 ايه؟");
  const later = { preferences: { ...ask.memory_updates, last_intent: "product_search" } };
  assert.equal(await turn("فيتنامي", later), null);
});

test("the link's grade reaches the storefront query", () => {
  assert.ok(storefrontQualityAliases("vietnamese_import").includes("imported_from_vietnam"), "the old size link key must match products.grade");
  assert.ok(storefrontQualityAliases("imported_from_vietnam").includes("imported_from_vietnam"));
  assert.ok(storefrontQualityAliases("local").includes("local"));
  assert.ok(storefrontQualityAliases("mirror_original").includes("mirror_original"));
  assert.match(buildCatalogBrowseUrl({ size: "42", grade: "all" }), /size=42&inStock=1/);
});

test("slots: Arabic digits, ميرور اوريجينال is the mirror grade, brands in the catalog spelling", () => {
  const slots = detectCatalogBrowseSlots("عايز اسكتشرز ميرور اوريجينال مقاس ٤٠", { brandNames: BRANDS });
  assert.equal(slots.size, "40");
  assert.equal(slots.grade, "mirror_original");
  assert.equal(slots.brand, "SKECHERS");
});

test("the next turn sees what was asked on both memory stores (WhatsApp snake_case, Meta camelCase)", async () => {
  const { decisionFlowMemoryPatch } = await import("../../server/utils/decisionFlowMemory.js");
  const ask = await turn("المتاح مقاس 44 ايه؟");
  const flow = decisionFlowMemoryPatch(ask);
  assert.equal(flow.last_intent, "catalog_browse_ask");
  assert.equal(flow.catalog_browse.size, "44");
  // WhatsApp: ai_conversation_memories.preferences carries the patch as is.
  const whatsapp = await turn("ايه الفرق", { preferences: { ...flow } });
  assert.equal(whatsapp.detected_intent, "grade_difference");
  // Messenger / Instagram: the runtime memory carries lastIntent / catalogBrowse.
  const meta = await turn("فيتنامي", { lastIntent: flow.last_intent, catalogBrowse: flow.catalog_browse });
  assert.match(meta.text, /size=44&quality=imported_from_vietnam/);
});
