import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { register } from "node:module";

import { buildPosCatalogSnapshot, POS_CATALOG_SCHEMA_VERSION } from "../src/modules/pos/lib/posCatalogCache.js";

// posProductsApi pulls the HTTP client through productsApi, which Node cannot load
// directly — a test-only loader stubs that one module and adds the .js extensions
// the src tree omits. Everything the tests touch (normalize + reprice) is pure.
register("./helpers/pos-products-api-loader.mjs", import.meta.url);
const { normalizePosSellableProducts, normalizePosCatalogProduct, repricePosCatalogProducts } = await import(
  "../src/modules/pos/services/posProductsApi.js"
);

// The POS sale-price toggle used to re-download and re-normalize the whole ~9MB
// catalog on every flip. It now re-prices the catalog already in memory
// (repricePosCatalogProducts). These tests pin the only thing that makes that
// safe: re-pricing an already-normalized catalog must produce EXACTLY what a
// fresh normalize with the new settings would.

const SALE_OFF = { sale_mode_enabled: false };
const SALE_ON = { sale_mode_enabled: true };

// Shaped like the ?pos=1 /products/with-variants payload.
const RAW_CATALOG = [
  {
    id: 24, name: "Adidas Samba Sneakers", category_id: 3, brand_id: 7,
    sale_price: 550, sale_price_enabled: true, sale_reason: "Summer",
    variants: [
      { id: 2401, product_id: 24, color: "White", size: "42", price: 650, sale_price: 550, sale_price_enabled: true, stock: 4, category_id: 3, brand_id: 7 },
      { id: 2402, product_id: 24, color: "Black", size: "43", price: 650, sale_price: 550, sale_price_enabled: true, stock: 2, category_id: 3, brand_id: 7 },
    ],
  },
  {
    id: 25, name: "Nike Air Force 1", category_id: 3, brand_id: 8,
    variants: [
      // dormant: stored sale but the per-record enable flag is off
      { id: 2501, product_id: 25, color: "White", size: "41", price: 650, sale_price: 550, sale_price_enabled: false, stock: 3 },
      // current_selling_price must survive normalization or reprice drifts
      { id: 2502, product_id: 25, color: "Black", size: "42", price: 600, current_selling_price: 620, sale_price: 550, sale_price_enabled: true, stock: 1 },
    ],
  },
  {
    id: 146, name: "Offer Runner", is_offer_story: true, category_id: 4, brand_id: 9,
    variants: [
      { id: 14601, product_id: 146, color: "Red", size: "40", price: 500, sale_price: 350, stock: 5 },
    ],
  },
  {
    id: 77, name: "Excluded Sneaker", category_id: 5, brand_id: 10,
    variants: [
      { id: 7701, product_id: 77, color: "Grey", size: "44", price: 900, sale_price: 700, sale_price_enabled: true, stock: 2 },
    ],
  },
  {
    id: 88, name: "Expired Window", category_id: 5, brand_id: 10,
    variants: [
      { id: 8801, product_id: 88, color: "Blue", size: "39", price: 800, sale_price: 600, sale_price_enabled: true, sale_end_at: "2020-01-01T00:00:00Z", stock: 2 },
    ],
  },
];

const normalizeFresh = (settings) =>
  normalizePosSellableProducts(structuredClone(RAW_CATALOG), settings).map((product) => normalizePosCatalogProduct(product));

const PRICE_FIELDS = ["price", "sale_price", "final_price", "stored_sale_price", "regular_price", "sale_source", "sale_badge", "sale_mode_applied"];
const pricingOf = (catalog) =>
  catalog.map((product) => ({
    id: product.id,
    ...Object.fromEntries(PRICE_FIELDS.filter((k) => k in product).map((k) => [k, product[k]])),
    min_price: product.min_price,
    max_price: product.max_price,
    variants: (product.variants || []).map((variant) =>
      Object.fromEntries(["id", ...PRICE_FIELDS].map((k) => [k, variant[k]]))),
  }));

test("re-pricing OFF->ON matches a fresh normalize with sale ON, field for field", () => {
  const repriced = repricePosCatalogProducts(normalizeFresh(SALE_OFF), SALE_ON);
  assert.deepEqual(pricingOf(repriced), pricingOf(normalizeFresh(SALE_ON)));
});

test("re-pricing ON->OFF matches a fresh normalize with sale OFF (round trip)", () => {
  const roundTripped = repricePosCatalogProducts(repricePosCatalogProducts(normalizeFresh(SALE_OFF), SALE_ON), SALE_OFF);
  assert.deepEqual(pricingOf(roundTripped), pricingOf(normalizeFresh(SALE_OFF)));
});

test("exclusion lists still bite through a re-price", () => {
  const settings = { ...SALE_ON, sale_mode_excluded_product_ids: ["77"] };
  const repriced = repricePosCatalogProducts(normalizeFresh(SALE_OFF), settings);
  assert.deepEqual(pricingOf(repriced), pricingOf(normalizeFresh(settings)));
  const excluded = repriced.find((product) => String(product.id) === "77");
  assert.equal(excluded.variants[0].final_price, 900);
});

test("the semantics themselves: gated obeys the toggle, dormant and expired stay dormant, offers ignore it", () => {
  const on = repricePosCatalogProducts(normalizeFresh(SALE_OFF), SALE_ON);
  const byId = new Map(on.map((product) => [String(product.id), product]));
  assert.equal(byId.get("24").variants[0].final_price, 550);   // gated + enabled
  assert.equal(byId.get("25").variants[0].final_price, 650);   // dormant flag
  assert.equal(byId.get("25").variants[1].final_price, 550);   // current_selling_price row still sales
  assert.equal(byId.get("88").variants[0].final_price, 800);   // expired window
  assert.equal(byId.get("146").variants[0].final_price, 350);  // offer, and OFF too:
  const off = repricePosCatalogProducts(on, SALE_OFF);
  assert.equal(off.find((product) => String(product.id) === "146").variants[0].final_price, 350);
});

test("a warm-open snapshot survives the sanitizer with enough to re-price", () => {
  const snapshot = buildPosCatalogSnapshot(normalizeFresh(SALE_OFF), "v-test");
  const repriced = repricePosCatalogProducts(snapshot.products, SALE_ON);
  const samba = repriced.find((product) => String(product.id) === "24");
  assert.equal(samba.variants[0].final_price, 550, "sanitized snapshot lost the pricing inputs the toggle needs");
  assert.equal(samba.variants[0].sale_mode_applied, true);
  const backOff = repricePosCatalogProducts(repriced, SALE_OFF);
  assert.equal(backOff.find((product) => String(product.id) === "24").variants[0].final_price, 650);
});

test("snapshots priced before the inputs existed are flushed (schema >= 6)", () => {
  assert.ok(POS_CATALOG_SCHEMA_VERSION >= 6);
});

test("the toggle handler re-prices in memory — no catalog download, no follow-up GET", async () => {
  const source = await readFile(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
  const start = source.indexOf("const saveSaleModeSettings = useCallback");
  assert.ok(start > -1);
  const block = source.slice(start, source.indexOf("useEffect", start));
  assert.ok(block.includes("repricePosCatalogProducts("), "the toggle must re-price the in-memory catalog");
  assert.ok(!block.includes("refreshCatalogProducts("), "the toggle must not re-download the catalog");
  assert.ok(!block.includes('api.get("/website/settings"'), "the PUT response already carries the saved settings");
  assert.ok(block.includes("savePosCatalogSnapshot("), "the offline snapshot must be re-stamped or the next warm open re-downloads");
});
