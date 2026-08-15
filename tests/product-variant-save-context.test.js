import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVariantSaveContext,
  claimBarcodeFromContext,
  claimUniqueSkuFromContext,
  findSkuBarcodeConflict,
  registerCreatedVariant,
  resolveExistingVariantIdFromContext,
} from "../server/utils/variantSaveContext.js";

// Product save used to issue 5-8 queries PER VARIANT; the catalog has a 304-variant
// product, so one save meant thousands of sequential queries inside a write
// transaction. The loop now resolves everything from a context built by two queries.
//
// The uniqueness rules are the dangerous half of that change — getting them wrong
// renames SKUs or lets duplicates through on a live catalog — so they are pinned here
// against the semantics of the queries they replaced.

const normalizeSku = (value = "") => String(value ?? "").trim().toUpperCase();

const contextWith = ({ products = [], variants = [], own = [] } = {}) =>
  buildVariantSaveContext({
    ownerRows: [
      ...products.map((p) => ({ kind: "product", id: p.id, owner_product_id: p.id, sku: p.sku, barcode: p.barcode })),
      ...variants.map((v) => ({ kind: "variant", id: v.id, owner_product_id: v.product_id, sku: v.sku, barcode: v.barcode })),
    ],
    existingRows: own,
  });

// ---- the regression a plain Set would cause -------------------------------

test("a variant keeping its own SKU is not treated as a conflict with itself", () => {
  const context = contextWith({ variants: [{ id: 7, product_id: 1, sku: "SH-RED-42" }] });

  const claimed = claimUniqueSkuFromContext(
    context,
    { sku: "SH-RED-42", reservedSkus: new Set(), productId: 1, variantId: 7, previousSku: "SH-RED-42" },
    normalizeSku
  );

  // A Set-based check would see "taken" and rename it to SH-RED-42-2 on every save.
  assert.equal(claimed, "SH-RED-42");
});

test("a product keeping its own SKU is not a conflict with itself either", () => {
  const context = contextWith({ products: [{ id: 1, sku: "SH-BASE" }] });
  const claimed = claimUniqueSkuFromContext(
    context,
    { sku: "SH-BASE", reservedSkus: new Set(), productId: 1, variantId: null },
    normalizeSku
  );
  assert.equal(claimed, "SH-BASE");
});

// ---- uniqueness still holds against everyone else -------------------------

test("a SKU held by another product's variant is walked to the next candidate", () => {
  const context = contextWith({ variants: [{ id: 99, product_id: 2, sku: "SH-RED-42" }] });
  const claimed = claimUniqueSkuFromContext(
    context,
    { sku: "SH-RED-42", reservedSkus: new Set(), productId: 1, variantId: 7 },
    normalizeSku
  );
  assert.equal(claimed, "SH-RED-42-2");
});

test("a SKU held by another product row is walked too", () => {
  const context = contextWith({ products: [{ id: 2, sku: "SH-RED-42" }] });
  const claimed = claimUniqueSkuFromContext(
    context,
    { sku: "SH-RED-42", reservedSkus: new Set(), productId: 1, variantId: 7 },
    normalizeSku
  );
  assert.equal(claimed, "SH-RED-42-2");
});

test("two variants in the same save cannot claim the same SKU", () => {
  const context = contextWith({});
  const reservedSkus = new Set();
  const first = claimUniqueSkuFromContext(context, { sku: "DUP", reservedSkus, productId: 1, variantId: 1 }, normalizeSku);
  const second = claimUniqueSkuFromContext(context, { sku: "DUP", reservedSkus, productId: 1, variantId: 2 }, normalizeSku);
  assert.equal(first, "DUP");
  assert.equal(second, "DUP-2");
});

test("the candidate walk keeps stepping past a run of taken SKUs", () => {
  const context = contextWith({
    variants: [
      { id: 91, product_id: 2, sku: "RUN" },
      { id: 92, product_id: 2, sku: "RUN-2" },
      { id: 93, product_id: 2, sku: "RUN-3" },
    ],
  });
  const claimed = claimUniqueSkuFromContext(
    context,
    { sku: "RUN", reservedSkus: new Set(), productId: 1, variantId: 7 },
    normalizeSku
  );
  assert.equal(claimed, "RUN-4");
});

// ---- ownership moves, which is what re-reading the table used to give us ---

test("a SKU freed earlier in the same save can be taken later in it", () => {
  // Variant 7 holds OLD. It renames to NEW, so variant 8 may then take OLD — exactly
  // what the query-per-candidate version did by re-reading the live table each time.
  const context = contextWith({ variants: [{ id: 7, product_id: 1, sku: "OLD" }] });
  const reservedSkus = new Set();

  const renamed = claimUniqueSkuFromContext(
    context,
    { sku: "NEW", reservedSkus, productId: 1, variantId: 7, previousSku: "OLD" },
    normalizeSku
  );
  const reused = claimUniqueSkuFromContext(
    context,
    { sku: "OLD", reservedSkus, productId: 1, variantId: 8, previousSku: "" },
    normalizeSku
  );

  assert.equal(renamed, "NEW");
  assert.equal(reused, "OLD", "the freed SKU must be reusable, not walked to OLD-2");
});

test("a variant created mid-save becomes visible to the variants saved after it", () => {
  const context = contextWith({});
  registerCreatedVariant(context, { variant: { id: 50, sku: "FRESH", barcode: "BFRESH" }, productId: 1 });

  const conflict = findSkuBarcodeConflict(context, { productId: 1, variant: { id: 51, sku: "FRESH" } });
  assert.equal(conflict?.scope, "variant");
  assert.equal(conflict?.variantId, 50);
});

// ---- duplicate reporting keeps naming the offender ------------------------

test("a barcode duplicate reports the barcode field and the owning variant", () => {
  const context = contextWith({ variants: [{ id: 12, product_id: 4, sku: "OTHER", barcode: "6221" }] });
  const conflict = findSkuBarcodeConflict(context, { productId: 1, variant: { id: 7, barcode: "6221" } });
  assert.deepEqual(conflict, { scope: "variant", field: "barcode", variantId: 12, productId: 4 });
});

test("a SKU duplicate against another product reports the product scope", () => {
  const context = contextWith({ products: [{ id: 9, sku: "TAKEN" }] });
  const conflict = findSkuBarcodeConflict(context, { productId: 1, variant: { id: 7, sku: "TAKEN" } });
  assert.deepEqual(conflict, { scope: "product", field: "sku", productId: 9 });
});

test("a variant conflict is reported ahead of a product conflict, as the queries ordered them", () => {
  const context = contextWith({
    products: [{ id: 9, sku: "BOTH" }],
    variants: [{ id: 12, product_id: 4, sku: "BOTH" }],
  });
  const conflict = findSkuBarcodeConflict(context, { productId: 1, variant: { id: 7, sku: "BOTH" } });
  assert.equal(conflict.scope, "variant");
});

test("a variant re-saving its own SKU and barcode reports no conflict", () => {
  const context = contextWith({ variants: [{ id: 7, product_id: 1, sku: "MINE", barcode: "B1" }] });
  assert.equal(findSkuBarcodeConflict(context, { productId: 1, variant: { id: 7, sku: "MINE", barcode: "B1" } }), null);
});

test("an empty SKU and barcode can never conflict", () => {
  const context = contextWith({ variants: [{ id: 7, product_id: 4, sku: "", barcode: "" }] });
  assert.equal(findSkuBarcodeConflict(context, { productId: 1, variant: { id: 8, sku: "", barcode: "" } }), null);
});

test("a released barcode frees up for another variant in the same save", () => {
  const context = contextWith({ variants: [{ id: 7, product_id: 1, sku: "S1", barcode: "B1" }] });
  claimBarcodeFromContext(context, { barcode: "B2", productId: 1, variantId: 7, previousBarcode: "B1" });
  assert.equal(findSkuBarcodeConflict(context, { productId: 1, variant: { id: 8, barcode: "B1" } }), null);
  assert.equal(findSkuBarcodeConflict(context, { productId: 1, variant: { id: 8, barcode: "B2" } })?.variantId, 7);
});

// ---- matching an incoming variant to an existing row ----------------------

test("an explicit id wins over colour/size matching", () => {
  const context = contextWith({ own: [{ id: 3, color: "Red", size: "42", is_active: true, deleted_at: null }] });
  assert.equal(resolveExistingVariantIdFromContext(context, { id: 99, color: "Red", size: "42" }), 99);
});

test("colour and size match case-insensitively and ignore surrounding space", () => {
  const context = contextWith({ own: [{ id: 3, color: "Red", size: "42", is_active: true, deleted_at: null }] });
  assert.equal(resolveExistingVariantIdFromContext(context, { color: "  rED ", size: "42" }), 3);
});

test("a live row is preferred over an archived one, then the lowest id", () => {
  const context = contextWith({
    own: [
      { id: 3, color: "Red", size: "42", is_active: false, deleted_at: null },
      { id: 4, color: "Red", size: "42", is_active: true, deleted_at: null },
      { id: 5, color: "Red", size: "42", is_active: true, deleted_at: null },
    ],
  });
  assert.equal(resolveExistingVariantIdFromContext(context, { color: "Red", size: "42" }), 4);
});

test("a soft-deleted row still loses to a live one", () => {
  const context = contextWith({
    own: [
      { id: 3, color: "Red", size: "42", is_active: true, deleted_at: "2026-01-01T00:00:00Z" },
      { id: 9, color: "Red", size: "42", is_active: true, deleted_at: null },
    ],
  });
  assert.equal(resolveExistingVariantIdFromContext(context, { color: "Red", size: "42" }), 9);
});

test("a variant with neither colour nor size never matches an existing row", () => {
  const context = contextWith({ own: [{ id: 3, color: "", size: "", is_active: true, deleted_at: null }] });
  assert.equal(resolveExistingVariantIdFromContext(context, { color: "", size: "" }), null);
});

test("an unmatched colour/size resolves to null so the caller inserts", () => {
  const context = contextWith({ own: [{ id: 3, color: "Red", size: "42", is_active: true, deleted_at: null }] });
  assert.equal(resolveExistingVariantIdFromContext(context, { color: "Blue", size: "42" }), null);
});
