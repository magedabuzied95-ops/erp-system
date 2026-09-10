import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

import { projectPosCatalogProducts } from "../server/controllers/productsController.js";
import { buildPosCatalogSnapshot } from "../src/modules/pos/lib/posCatalogCache.js";
import { collectProductManufacturerIds, matchesQuickFilterGroups } from "../src/modules/pos/lib/posQuickFilterLogic.js";

register("./helpers/pos-products-api-loader.mjs", import.meta.url);
const { normalizePosSellableProducts } = await import("../src/modules/pos/services/posProductsApi.js");

// Production, 2026-09-10: Tommy Hilfiger THS-M-ORG (product 6) sat in the POS
// catalog with 20 pieces but vanished as soon as the cashier picked the "Dont
// Stop" factory chip. The editor saves factories per COLOUR, and two of its
// colours carry two factories: product_variants.manufacturer_ids = {8,36}. The
// legacy single manufacturer_id holds only the first (8, Cavo). The POS read only
// that one — and the ?pos=1 projection dropped manufacturer_ids on the way out —
// so factory 36 never reached the filter. 14 live products had the same shape.

const CAVO = "8";
const DONT_STOP = "36";

// Shaped like the /products/with-variants rows for product 6.
const RAW_PRODUCT_6 = {
  id: 6,
  name: "Tommy Hilfiger Sneakers for Men",
  sku: "THS-M-ORG",
  brand_id: 7,
  manufacturer_id: 8,
  variation_mode: "full_variations",
  gender: "men",
  product_type: "sneakers",
  grade: "local",
  variants: [
    { id: 930, product_id: 6, color: "ALL BLACK", size: "42", stock: 3, price: 600, manufacturer_id: 8, manufacturer_ids: [8], manufacturer_name: "Cavo" },
    { id: 1031, product_id: 6, color: "Gray", size: "42", stock: 2, price: 600, manufacturer_id: 8, manufacturer_ids: [8, 36], manufacturer_name: "Cavo" },
    { id: 925, product_id: 6, color: "White-Navy", size: "41", stock: 2, price: 600, manufacturer_id: 8, manufacturer_ids: [8, 36], manufacturer_name: "Cavo" },
  ],
};

const matchesFactory = (product, factoryId) =>
  matchesQuickFilterGroups(
    { manufacturerIds: collectProductManufacturerIds(product), manufacturerNames: [] },
    { manufacturers: [factoryId] }
  );

const loadThroughPosPipeline = () =>
  normalizePosSellableProducts(projectPosCatalogProducts([RAW_PRODUCT_6], "1"));

test("the ?pos=1 projection keeps every factory of the colour", () => {
  const [projected] = projectPosCatalogProducts([RAW_PRODUCT_6], "1");
  assert.deepEqual(projected.variants[1].manufacturer_ids, [8, 36]);
});

test("a colour's second factory finds the product in the POS grid", () => {
  const [product] = loadThroughPosPipeline();
  assert.ok(matchesFactory(product, CAVO), "first factory still matches");
  assert.ok(matchesFactory(product, DONT_STOP), "second factory must match too");
  assert.equal(matchesFactory(product, "999"), false, "an unrelated factory still filters it out");
});

test("a warm open from the offline snapshot keeps the colour factories", () => {
  const snapshot = buildPosCatalogSnapshot(loadThroughPosPipeline());
  const [cached] = snapshot.products;
  assert.ok(matchesFactory(cached, DONT_STOP), "snapshot must not strip manufacturer_ids");
});

test("a product whose factory lives only on its colours is not lost after a warm open", () => {
  // Most products leave products.manufacturer_id empty; the snapshot used to drop
  // the variant factory too, so every one of them fell out of every factory chip.
  const raw = { ...RAW_PRODUCT_6, manufacturer_id: null };
  const snapshot = buildPosCatalogSnapshot(normalizePosSellableProducts(projectPosCatalogProducts([raw], "1")));
  assert.ok(matchesFactory(snapshot.products[0], CAVO));
});

test("POS and the AI Inbox picker both read factories through the shared helper", async () => {
  const pos = await readFile(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8");
  const picker = await readFile(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
  assert.match(pos, /const manufacturerIds = collectProductManufacturerIds\(product\)/);
  assert.match(picker, /const ids = collectProductManufacturerIds\(product\)/);
});

test("a grade no filter offers is refused on save, not stored as an orphan", async () => {
  // THS-M-ORG was saved with grade "original", which no grade option carries, so
  // every grade chip on every surface filtered it out.
  const controller = await readFile(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  const createGuard = /isActiveClassificationValue\("grade", normalizedGrade\)/;
  const updateGuard = /isActiveClassificationValue\("grade", nextGradeValue\)/;
  assert.match(controller, createGuard, "createProduct must check the grade");
  assert.match(controller, updateGuard, "updateProduct must check a changed grade");
});
