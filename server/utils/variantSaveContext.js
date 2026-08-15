// Pure, DB-free core of the product-save variant path.
//
// Saving a product used to cost 5-8 round trips PER VARIANT: resolve the id, lock the
// row, probe products+product_variants for every SKU candidate, then probe both again
// for the barcode — all issued one variant at a time on a single connection. The
// catalog has a product with 304 variants, so one save meant well over two thousand
// sequential queries inside a write transaction.
//
// The controller now runs two queries up front and answers every per-variant decision
// from the context built here. This module holds no `db` import on purpose: the
// uniqueness rules are the risky part of the change, so they have to be unit-testable
// without a database.
//
// The owner maps track WHO holds each SKU/barcode rather than just that it is taken.
// A plain Set would get two things wrong:
//   * a variant keeping its own SKU would look like a conflict with itself, and the
//     "fix" would rename every SKU on every save;
//   * duplicate errors could no longer name the offending product/variant.

export const buildOwnerKey = (value) => String(value ?? "").trim().toLowerCase();

export const addOwner = (owners, value, owner) => {
  const key = buildOwnerKey(value);
  if (!key) return;
  const list = owners.get(key);
  if (list) list.push(owner);
  else owners.set(key, [owner]);
};

export const removeOwner = (owners, value, { kind, id }) => {
  const key = buildOwnerKey(value);
  if (!key) return;
  const list = owners.get(key);
  if (!list) return;
  const next = list.filter((owner) => !(owner.kind === kind && String(owner.id) === String(id)));
  if (next.length) owners.set(key, next);
  else owners.delete(key);
};

// Mirrors the exclusion the replaced queries applied: a variant never conflicts with
// itself, and a product never conflicts with the product being saved.
export const findOwnerConflict = (owners, value, { kind, selfVariantId = null, selfProductId = null }) => {
  const key = buildOwnerKey(value);
  if (!key) return null;
  const list = owners.get(key);
  if (!list?.length) return null;
  return (
    list.find((owner) => {
      if (owner.kind !== kind) return false;
      if (kind === "variant") return selfVariantId === null || String(owner.id) !== String(selfVariantId);
      return selfProductId === null || String(owner.id) !== String(selfProductId);
    }) || null
  );
};

/**
 * @param ownerRows    rows of { kind: 'product'|'variant', id, owner_product_id, sku, barcode }
 *                     — every product, plus every LIVE variant, in the tenant.
 * @param existingRows the saved product's own variant rows, id-ascending.
 */
export const buildVariantSaveContext = ({ ownerRows = [], existingRows = [] } = {}) => {
  const skuOwners = new Map();
  const barcodeOwners = new Map();
  for (const row of ownerRows) {
    const owner = { kind: row.kind, id: row.id, productId: row.owner_product_id ?? row.product_id ?? row.id };
    addOwner(skuOwners, row.sku, owner);
    addOwner(barcodeOwners, row.barcode, owner);
  }

  const byId = new Map();
  const byColorSize = new Map();
  for (const row of existingRows) {
    byId.set(String(row.id), row);
    const key = `${buildOwnerKey(row.color)}|${buildOwnerKey(row.size)}`;
    const bucket = byColorSize.get(key);
    if (bucket) bucket.push(row);
    else byColorSize.set(key, [row]);
  }
  // The replaced lookup preferred a live row, then the lowest id. Rows arrive
  // id-ascending, so a stable partition on "live" reproduces that ordering exactly.
  const isLive = (row) => row.is_active !== false && !row.deleted_at;
  for (const [key, bucket] of byColorSize) {
    if (bucket.length < 2) continue;
    byColorSize.set(key, [...bucket.filter(isLive), ...bucket.filter((row) => !isLive(row))]);
  }

  return { skuOwners, barcodeOwners, byId, byColorSize };
};

export const resolveExistingVariantIdFromContext = (context, variant = {}) => {
  if (variant.id) return variant.id;
  const color = String(variant.color || "").trim();
  const size = String(variant.size || "").trim();
  if (!color && !size) return null;
  const bucket = context.byColorSize.get(`${buildOwnerKey(color)}|${buildOwnerKey(size)}`);
  return bucket?.[0]?.id || null;
};

/**
 * Returns a description of the first conflict, or null. Kept as a value rather than a
 * throw so this module stays free of the controller's error factory.
 *
 * Order matches the replaced pair of queries: other live variants first, then other
 * products; within each, a barcode match names the barcode field.
 */
export const findSkuBarcodeConflict = (context, { productId = null, variant = {} } = {}) => {
  const sku = String(variant.sku || "").trim();
  const barcode = String(variant.barcode || "").trim();
  if (!sku && !barcode) return null;
  const selfVariantId = variant.id || null;

  const variantBySku = findOwnerConflict(context.skuOwners, sku, { kind: "variant", selfVariantId });
  const variantByBarcode = findOwnerConflict(context.barcodeOwners, barcode, { kind: "variant", selfVariantId });
  const duplicateVariant = variantByBarcode || variantBySku;
  if (duplicateVariant) {
    return {
      scope: "variant",
      field: barcode && variantByBarcode ? "barcode" : "sku",
      variantId: duplicateVariant.id,
      productId: duplicateVariant.productId,
    };
  }

  const selfProductId = productId || null;
  const productBySku = findOwnerConflict(context.skuOwners, sku, { kind: "product", selfProductId });
  const productByBarcode = findOwnerConflict(context.barcodeOwners, barcode, { kind: "product", selfProductId });
  const duplicateProduct = productByBarcode || productBySku;
  if (duplicateProduct) {
    return {
      scope: "product",
      field: barcode && productByBarcode ? "barcode" : "sku",
      productId: duplicateProduct.id,
    };
  }

  return null;
};

/**
 * Same candidate walk the query-per-candidate version did. Claiming also MOVES
 * ownership, so a SKU freed earlier in this save can be taken later in it — which is
 * what re-reading the live table used to achieve.
 */
export const claimUniqueSkuFromContext = (
  context,
  { sku, reservedSkus, productId = null, variantId = null, previousSku = "" },
  normalizeSku
) => {
  const base = normalizeSku(sku) || "PRD";
  let candidate = base;
  let sequence = 2;
  const isTaken = (value) =>
    reservedSkus.has(value.toLowerCase()) ||
    Boolean(findOwnerConflict(context.skuOwners, value, { kind: "product", selfProductId: productId })) ||
    Boolean(findOwnerConflict(context.skuOwners, value, { kind: "variant", selfVariantId: variantId }));

  while (isTaken(candidate)) {
    candidate = `${base}-${sequence}`.slice(0, 60);
    sequence += 1;
  }
  reservedSkus.add(candidate.toLowerCase());
  if (variantId) {
    removeOwner(context.skuOwners, previousSku, { kind: "variant", id: variantId });
    addOwner(context.skuOwners, candidate, { kind: "variant", id: variantId, productId });
  }
  return candidate;
};

export const claimBarcodeFromContext = (context, { barcode, productId = null, variantId = null, previousBarcode = "" }) => {
  if (!variantId) return;
  removeOwner(context.barcodeOwners, previousBarcode, { kind: "variant", id: variantId });
  addOwner(context.barcodeOwners, barcode, { kind: "variant", id: variantId, productId });
};

// A freshly inserted row must be visible to the variants saved after it, exactly as it
// was when every variant re-read the table.
export const registerCreatedVariant = (context, { variant, productId }) => {
  if (!context || !variant?.id) return;
  addOwner(context.skuOwners, variant.sku, { kind: "variant", id: variant.id, productId });
  addOwner(context.barcodeOwners, variant.barcode, { kind: "variant", id: variant.id, productId });
  context.byId.set(String(variant.id), variant);
};
