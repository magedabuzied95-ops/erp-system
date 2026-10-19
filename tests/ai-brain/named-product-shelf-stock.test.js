import test from "node:test";
import assert from "node:assert/strict";

import pool from "../../server/database/db.js";

/**
 * Production, 2026-10-19: "متاح ايرفورس ؟" showed three Air Force cards and OpenAI wrote "they are
 * all sold out". The cards were built from bare catalog rows: products.total_stock was 0 on all
 * three (stock 33 / 107 / 8 in products.stock and the variants), and there were no variants, so no
 * sizes. The rewrite's facts read `total_stock ?? stock`, so that 0 won.
 */

// The production rows, as the catalog query and the full-product query return them.
const rows = {
  25: { id: 25, name: "Nike Air Force 1  Sneakers", sku: "AF1-S", status: "active", stock: 33, total_stock: 0, price: 650, tenant_id: 1, image_url: "https://cdn.example.test/af1s.jpg" },
  61: { id: 61, name: "Nike Air Force 1", sku: "AF1", status: "active", stock: 107, total_stock: 0, price: 1850, tenant_id: 1, image_url: "https://cdn.example.test/af1.jpg" },
};
const variants = {
  25: [
    { id: 2501, size: "41", color: "white", stock: 10, is_active: true },
    { id: 2502, size: "42", color: "white", stock: 8, is_active: true },
    { id: 2503, size: "45", color: "white", stock: 0, is_active: true },
    { id: 2504, size: "46", color: "black", stock: 5, is_active: false },
  ],
  61: [{ id: 6101, size: "40", color: "black", stock: 109, is_active: true }],
};
pool.query = async (sql, params = []) => {
  const query = String(sql);
  if (query.includes("information_schema.columns")) {
    const columns = {
      products: ["id", "name", "sku", "status", "stock", "total_stock", "price", "tenant_id", "image_url"],
      product_variants: ["id", "product_id", "size", "color", "stock", "is_active"],
    }[params[0]] || [];
    return { rows: columns.map((column_name) => ({ column_name })) };
  }
  if (/FROM products p\s+WHERE 1 = 1/.test(query)) return { rows: Object.values(rows) };
  if (query.includes("AS variants")) {
    const row = rows[Number(params[0])];
    return { rows: row ? [{ ...row, variants: variants[row.id] || [], product_variant_images: [] }] : [] };
  }
  return { rows: [] };
};

const { generateAiBrainV2Decision, withShelfStock } = await import("../../server/services/aiBrainV2Service.js");
const { safeProductFacts } = await import("../../server/services/aiUnifiedDecisionService.js");
const { normalizeArabicIntentPayload } = await import("../../server/utils/arabicTextNormalizer.js");

const ask = (raw) => generateAiBrainV2Decision(
  { channel: "facebook_messenger", text: normalizeArabicIntentPayload(raw).normalizedForIntent, metadata: { original_message: raw, tenant_id: 1 } },
  { tenantId: 1, memory: {} },
);

test("a stale total_stock of 0 no longer tells OpenAI an in-stock model is sold out", () => {
  assert.equal(safeProductFacts({ name: "Nike Air Force 1", stock: 33, total_stock: 0 }).total_stock, 33);
  assert.equal(safeProductFacts({ name: "x", total_stock: 12 }).total_stock, 12);
  assert.equal(safeProductFacts({ name: "x" }).total_stock, 0);
});

test("a named model's cards carry its real stock and only the sizes on the shelf", async () => {
  const decision = await ask("متاح ايرفورس ؟");
  const byId = Object.fromEntries((decision.product_cards || []).map((card) => [String(card.product_id || card.id), card]));
  assert.ok(byId[25] && byId[61], `cards: ${JSON.stringify(Object.keys(byId))}`);
  assert.equal(byId[25].total_stock, 18, "10 + 8 in-stock pairs; the 0-stock and inactive variants do not count");
  assert.deepEqual(byId[25].available_sizes, ["41", "42"], "45 is sold out and 46 is inactive");
  assert.equal(byId[61].total_stock, 109);
  for (const card of decision.product_cards) assert.ok(safeProductFacts(card).total_stock > 0, `${card.name} reaches OpenAI as in stock`);
});

test("withShelfStock falls back to products.stock when no variant row has stock", () => {
  assert.equal(withShelfStock({ id: 1, stock: 4 }, { id: 1, stock: 4, total_stock: 0, variants: [] }).total_stock, 4);
  assert.deepEqual(withShelfStock({ id: 1 }, null), { id: 1 });
});
