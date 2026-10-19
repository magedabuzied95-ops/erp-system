import test from "node:test";
import assert from "node:assert/strict";

import pool from "../../server/database/db.js";
import { productNamingTerms } from "../../server/utils/productNamingTerms.js";
import { normalizeArabicIntentPayload } from "../../server/utils/arabicTextNormalizer.js";
import { firstAudience } from "../../server/services/aiCatalogNavigationService.js";

/**
 * 2026-10-19, the owner in the AI playground: "متاح الترا اسكتشر حريمي ؟" came back as
 * catalog_navigation — "177 items in the women's section", a link to the whole section, and boots,
 * Hoka and Converse on the cards. The word "حريمي" alone counted as asking for a section, and
 * "اسكتشر" was not read as Skechers at all. The women's catalog holds Skechers Ultra Light.
 *
 * Brain V2 runs for real against a stubbed catalog (pool.query) shaped like production's.
 */

const catalog = [
  { id: 127, name: "Skechers Ultra Light", gender: "women", status: "active", total_stock: 9, tenant_id: 1 },
  { id: 139, name: "Skechers Go Walk", gender: "women", status: "active", total_stock: 6, tenant_id: 1 },
  { id: 354, name: "Skechers Ultra Go", gender: "men", status: "active", total_stock: 5, tenant_id: 1 },
  { id: 364, name: "Skechers Max Run", gender: "men", status: "active", total_stock: 5, tenant_id: 1 },
  { id: 210, name: "Adidas Ultraboost", gender: "women", status: "active", total_stock: 4, tenant_id: 1 },
  { id: 101, name: "Nike Air Force 1 Low", gender: "men", status: "active", total_stock: 12, tenant_id: 1 },
  { id: 102, name: "Nike Air Force 1 Shadow", gender: "women", status: "active", total_stock: 7, tenant_id: 1 },
  { id: 401, name: "boots", gender: "women", status: "active", total_stock: 20, tenant_id: 1 },
  { id: 402, name: "Hoka Running", gender: "women", status: "active", total_stock: 20, tenant_id: 1 },
];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
pool.query = async (sql, params = []) => {
  const query = String(sql);
  if (query.includes("information_schema.columns")) {
    const columns = {
      products: ["id", "name", "sku", "status", "total_stock", "tenant_id", "description", "gender"],
      product_audiences: ["product_id", "audience"],
    }[params[0]] || [];
    return { rows: columns.map((column_name) => ({ column_name })) };
  }
  if (/FROM products p\s+WHERE 1 = 1/.test(query)) {
    // Filtered only when the SQL itself filters, so the test reads the query, not just the params.
    const audience = /LOWER\(COALESCE\(p\.gender, ''\)\) = ANY\(\$\d+::text\[\]\)/.test(query) ? params.find(Array.isArray) : null;
    const patterns = params.slice(1).filter((param) => typeof param === "string")
      .map((param) => new RegExp(escape(param.replace(/^%|%$/g, "")), "i"));
    return {
      rows: catalog
        .filter((row) => !audience || audience.includes(row.gender))
        .filter((row) => patterns.some((re) => re.test(row.name))),
    };
  }
  // Section browsing reads the whole shop.
  if (/LIMIT 500/.test(query)) return { rows: catalog.map((row) => ({ ...row, variant_stock: row.total_stock, audiences: [row.gender] })) };
  if (/FROM products/.test(query) && params.length) return { rows: catalog.filter((row) => String(row.id) === String(params[0])) };
  return { rows: [] };
};

const { generateAiBrainV2Decision, audienceSearchText } = await import("../../server/services/aiBrainV2Service.js");

const ask = (raw, memory = {}) => generateAiBrainV2Decision(
  { channel: "facebook_messenger", text: normalizeArabicIntentPayload(raw).normalizedForIntent, metadata: { original_message: raw, tenant_id: 1 } },
  { tenantId: 1, memory },
);
const names = (decision) => (decision.products || []).map((product) => product.name);

test("every Arabic spelling of Skechers is read as the brand", () => {
  for (const spelling of ["اسكتشر", "إسكتشر", "سكتشرز", "سكيتشرز", "اسكيتشرز"]) {
    assert.deepEqual(productNamingTerms(spelling), ["skechers"], spelling);
  }
  assert.deepEqual(productNamingTerms("متاح الترا اسكتشر حريمي ؟"), ["ultra", "skechers", "ultra skechers"]);
});

test("who the pair is for is never part of the model name", () => {
  assert.deepEqual(productNamingTerms("skechers ultra women"), ["skechers", "ultra", "skechers ultra"]);
  assert.deepEqual(productNamingTerms("nike men"), ["nike"]);
});

test("women is the women's audience, not men's", () => {
  assert.equal(firstAudience("skechers women")?.key, "women");
  assert.equal(firstAudience("for a woman")?.key, "women");
  assert.equal(firstAudience("متاح الترا اسكتشر حريمي ؟")?.key, "women");
  assert.equal(firstAudience("قسم الحريمي")?.key, "women");
  assert.equal(firstAudience("nike men")?.key, "men");
});

test("a brand and model with a gender is a model search inside that gender", async () => {
  const decision = await ask("متاح الترا اسكتشر حريمي ؟");
  assert.equal(decision.intent, "product_search");
  assert.deepEqual(names(decision), ["Skechers Ultra Light"]);
  assert.equal(decision.text, "أيوه يا فندم، Skechers Ultra Light حريمي متاح بالألوان دي:");
});

test("English spellings and other brands follow the same path", async () => {
  assert.deepEqual(names(await ask("skechers ultra women")), ["Skechers Ultra Light"]);
  assert.deepEqual(names(await ask("ايرفورس حريمي")), ["Nike Air Force 1 Shadow"]);
  const nike = await ask("nike حريمي");
  assert.equal(nike.intent, "product_search");
  assert.deepEqual(names(nike), ["Nike Air Force 1 Shadow"]);
  assert.deepEqual(names(await ask("سكتشرز رجالي")).sort(), ["Skechers Max Run", "Skechers Ultra Go"]);
});

test("a model only stocked for another gender is said so, never swapped for the section", async () => {
  const decision = await ask("max women");
  assert.equal(decision.intent, "product_search");
  assert.deepEqual(names(decision), ["Skechers Max Run"]);
  assert.equal(decision.text, "للأسف مش لاقي Max حريمي دلوقتي. ده المتاح منه رجالي:");
});

test("the closest pairs of that brand for that gender are offered as the closest", async () => {
  const decision = await ask("skechers max women");
  assert.ok(names(decision).every((name) => name.startsWith("Skechers")), JSON.stringify(names(decision)));
  assert.match(decision.text, /^مش لاقي Skechers Max حريمي بالظبط/);
});

test("\"جو\" after a model word is part of the name, never on its own", () => {
  assert.deepEqual(productNamingTerms("الترا جو حريمي"), ["ultra", "go", "ultra go"]);
  assert.deepEqual(productNamingTerms("skechers ultra go"), ["skechers", "ultra", "go", "skechers ultra go"]);
  assert.deepEqual(productNamingTerms("جو حريمي"), []);
  assert.deepEqual(productNamingTerms("i want to go"), []);
});

test("Ultra Go asked for women, where only Ultra Light is, is not passed off as found", async () => {
  const women = await ask("الترا جو حريمي");
  assert.equal(women.intent, "product_search");
  assert.ok(!names(women).includes("Skechers Ultra Go"), JSON.stringify(names(women)));
  assert.match(women.text, /^مش لاقي Ultra Go حريمي بالظبط/);
  const men = await ask("الترا جو رجالي");
  assert.deepEqual(names(men), ["Skechers Ultra Go"]);
  assert.equal(men.text, "أيوه يا فندم، Skechers Ultra Go رجالي متاح بالألوان دي:");
});

test("a two-letter name word matches a whole word, not the inside of one", async () => {
  const { namedProductTermsMatched } = await import("../../server/services/aiBrainV2Service.js");
  assert.equal(namedProductTermsMatched({ name: "Skechers Go Walk" }, ["go"]).words, 1);
  assert.equal(namedProductTermsMatched({ name: "Logo Slipper" }, ["go"]).words, 0);
});

test("the reply for a model missing in that gender names the gender it is in", () => {
  const women = { key: "women", label: "حريمي" };
  assert.equal(
    audienceSearchText({ audience: women, terms: ["ultra", "go", "ultra go"], audienceMissing: true, products: [{ name: "Skechers Ultra Go", gender: "men" }] }),
    "للأسف مش لاقي Ultra Go حريمي دلوقتي. ده المتاح منه رجالي:",
  );
});

test("a section request with no model still browses the section", async () => {
  assert.equal((await ask("عايز كوتشي حريمي")).intent, "catalog_navigation");
  assert.equal((await ask("عايز اشوف قسم الحريمي نايك")).intent, "catalog_navigation");
});
