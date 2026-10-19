import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import pool from "../../server/database/db.js";
import { productNamingTerms } from "../../server/utils/productNamingTerms.js";
import { normalizeArabicIntentPayload } from "../../server/utils/arabicTextNormalizer.js";

/**
 * 2026-10-19, the owner in the AI playground: "متاح ايرفورس ؟" came back as size_followup with no
 * products, and OpenAI wrote "we have no information about Air Force". The word "متاح" classified
 * it before anything noticed a model name, size/price/greeting intents never search, and the
 * search itself only tried the Arabic words against English product names.
 *
 * Brain V2 runs here for real against a stubbed catalog (pool.query), so each case below is the
 * answer a customer would get.
 */

const catalog = [
  { id: 101, name: "Nike Air Force 1 Low", sku: "AF1-LOW", status: "active", total_stock: 12, price: 1450, tenant_id: 1 },
  { id: 102, name: "Adidas Samba OG", sku: "SAMBA", status: "active", total_stock: 4, price: 1600, tenant_id: 1 },
  { id: 103, name: "Nike Dunk Low", sku: "DUNK", status: "active", total_stock: 3, price: 1500, tenant_id: 1, description: "متاح بمقاسات كتير" },
];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sqlSeen = [];
pool.query = async (sql, params = []) => {
  const query = String(sql);
  sqlSeen.push(query);
  if (query.includes("information_schema.columns")) {
    const columns = params[0] === "products" ? ["id", "name", "sku", "status", "total_stock", "price", "tenant_id", "description"] : [];
    return { rows: columns.map((column_name) => ({ column_name })) };
  }
  if (/FROM products p\s+WHERE 1 = 1/.test(query)) {
    const patterns = params.slice(1).map((param) => new RegExp(escape(String(param).replace(/^%|%$/g, "")), "i"));
    return { rows: catalog.filter((row) => patterns.some((re) => re.test(row.name) || re.test(row.sku) || re.test(row.description || ""))) };
  }
  if (/FROM products/.test(query) && params.length) return { rows: catalog.filter((row) => String(row.id) === String(params[0])) };
  return { rows: [] };
};

const { generateAiBrainV2Decision, shouldSearchNamedProduct } = await import("../../server/services/aiBrainV2Service.js");

// The shape every channel hands brain V2: the intent-normalized text plus the customer's own words.
const ask = (raw, memory = {}) => generateAiBrainV2Decision(
  { channel: "facebook_messenger", text: normalizeArabicIntentPayload(raw).normalizedForIntent, metadata: { original_message: raw, tenant_id: 1 } },
  { tenantId: 1, memory },
);
const names = (decision) => (decision.products || []).map((product) => product.name);

test("the Arabic spelling of a model is read as its catalog name", () => {
  assert.deepEqual(productNamingTerms("متاح ايرفورس ؟"), ["air", "force", "air force"]);
  assert.deepEqual(productNamingTerms("بكام الاير فورس"), ["air", "force", "air force"]);
  assert.deepEqual(productNamingTerms("عندكم سامبا؟"), ["samba"]);
  assert.deepEqual(productNamingTerms("عايز الترابوست مقاس 43"), ["ultraboost"]);
  for (const plain of ["فيه مقاس 42", "متاح؟", "السلام عليكم", "بكام؟", "غالي اوي", "عايز اسود", "ممكن صور"]) {
    assert.deepEqual(productNamingTerms(plain), [], `${plain} names no product`);
  }
});

test("the intent-normalized text cannot be the source: it spells فورس as 4س", () => {
  assert.deepEqual(productNamingTerms(normalizeArabicIntentPayload("متاح ايرفورس ؟").normalizedForIntent), []);
});

test("availability, price and greeting questions that name a model answer with that model", async () => {
  for (const [raw, expected] of [
    ["متاح ايرفورس ؟", "Nike Air Force 1 Low"],
    ["بكام الاير فورس", "Nike Air Force 1 Low"],
    ["السلام عليكم عندكم سامبا", "Adidas Samba OG"],
    ["عايز ايرفورس", "Nike Air Force 1 Low"],
  ]) {
    const decision = await ask(raw);
    assert.equal(decision.intent, "product_search", raw);
    assert.deepEqual(names(decision), [expected], raw);
  }
});

test("the whole name beats a product that only shares the brand", async () => {
  assert.deepEqual(names(await ask("عندك نايك دانك مقاس 42؟")), ["Nike Dunk Low"]);
});

test("messages that name nothing keep their old answers", async () => {
  assert.equal((await ask("السلام عليكم")).intent, "greeting");
  const bare = await ask("متاح؟");
  assert.equal(bare.intent, "size_followup");
  assert.deepEqual(names(bare), []);
});

test("asking about the product already shown stays a follow-up on it", () => {
  const memory = { last_product_cards: [{ product_id: 101, id: 101, name: "Nike Air Force 1 Low" }] };
  assert.equal(shouldSearchNamedProduct({ intent: "size_followup", namedProductTerms: ["air", "force", "air force"], memory }), false);
  assert.equal(shouldSearchNamedProduct({ intent: "size_followup", namedProductTerms: ["samba"], memory }), true);
  assert.equal(shouldSearchNamedProduct({ intent: "size_followup", namedProductTerms: [], memory: {} }), false);
  assert.equal(shouldSearchNamedProduct({ intent: "human_takeover", namedProductTerms: ["samba"], memory: {} }), false);
});

test("the catalog query ranks rows by how many terms their NAME matches", async () => {
  sqlSeen.length = 0;
  await ask("متاح ايرفورس ؟");
  const search = sqlSeen.find((query) => /FROM products p\s+WHERE 1 = 1/.test(query));
  assert.match(search, /ORDER BY \(CASE WHEN p\.name ILIKE \$2 THEN 1 ELSE 0 END/);
});

test("WhatsApp hands brain V2 the customer's own words", () => {
  const source = fs.readFileSync(new URL("../../server/services/aiInboxService.js", import.meta.url), "utf8");
  const call = source.slice(source.indexOf("unifiedDecision = await generateUnifiedConversationDecision({"));
  assert.match(call.slice(0, 700), /original_message: originalBody,/);
});
