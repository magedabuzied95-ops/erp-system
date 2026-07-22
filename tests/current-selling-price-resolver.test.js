import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCurrentSellingPrice } from "../server/services/currentSellingPriceResolver.js";

test("active variant and product overrides have the documented priority", () => {
  assert.deepEqual(resolveCurrentSellingPrice({ product: { manual_price_override_active: true, manual_selling_price: 900, selling_price: 700 }, variant: { manual_price_override_active: true, manual_selling_price: 800, selling_price: 600 } }), { value: 800, source: "variant_manual_override" });
  assert.deepEqual(resolveCurrentSellingPrice({ product: { manual_price_override_active: true, manual_selling_price: 900, selling_price: 700 }, variant: { selling_price: 600 } }), { value: 900, source: "product_manual_override" });
});

test("inactive override leaves the purchase suggestion priority intact", () => {
  assert.deepEqual(resolveCurrentSellingPrice({ product: { manual_price_override_active: false, manual_selling_price: 999, purchase_selling_price: 700 }, variant: { manual_price_override_active: false, manual_selling_price: 888, purchase_selling_price: 600 } }), { value: 600, source: "variant_purchase_selling_price" });
});

test("purchase suggestions and legacy fallbacks remain available", () => {
  assert.deepEqual(resolveCurrentSellingPrice({ product: {}, variant: { purchase_selling_price: 550 } }), { value: 550, source: "variant_purchase_selling_price" });
  assert.deepEqual(resolveCurrentSellingPrice({ product: { price: 500 }, variant: {} }), { value: 500, source: "product_legacy_price" });
});

test("migration only adds nullable/manual-default columns and has no backfill update", () => {
  const sql = readFileSync(new URL("../server/database/migrations/2026-07-22-add-manual-selling-price-overrides.sql", import.meta.url), "utf8");
  assert.match(sql, /products[\s\S]*manual_selling_price NUMERIC\(12,2\) NULL[\s\S]*manual_price_override_active BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(sql, /product_variants[\s\S]*manual_selling_price NUMERIC\(12,2\) NULL[\s\S]*manual_price_override_active BOOLEAN NOT NULL DEFAULT FALSE/i);
  assert.match(sql, /products[\s\S]*purchase_selling_price NUMERIC\(12,2\) NULL/i);
  assert.match(sql, /product_variants[\s\S]*purchase_selling_price NUMERIC\(12,2\) NULL/i);
  assert.doesNotMatch(sql, /UPDATE\s+(products|product_variants)/i);
});
