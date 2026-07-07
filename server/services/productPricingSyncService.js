const toNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const firstDefined = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const pickMoney = (...values) => toNumber(firstDefined(...values), 0);
const pickPositiveMoney = (...values) => {
  for (const value of values) {
    const numeric = toNumber(value, 0);
    if (numeric > 0) return numeric;
  }
  return 0;
};

const pricingSignalScoreSql = `
  (
    (CASE WHEN COALESCE(NULLIF(last_purchase_cost, 0), NULLIF(average_cost, 0), NULLIF(cost_price, 0), NULLIF(purchase_price, 0)) IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(NULLIF(selling_price, 0), NULLIF(price, 0), NULLIF(regular_price, 0)) IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(NULLIF(sale_price, 0), NULLIF(sale_price_enabled::int, 0)) IS NOT NULL THEN 1 ELSE 0 END)
  )
`;

export const syncProductPricingFromVariants = async (client, { productId, tenantId = null, variantId = null } = {}) => {
  const numericProductId = Number(productId || 0);
  if (!Number.isInteger(numericProductId) || numericProductId <= 0) return 0;

  const productResult = await client.query(
    `
    SELECT
      id,
      tenant_id,
      last_purchase_cost,
      average_cost,
      cost_price,
      purchase_price,
      selling_price,
      price,
      regular_price,
      sale_price,
      sale_price_enabled
    FROM products
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    FOR UPDATE
    LIMIT 1
    `,
    [numericProductId, tenantId]
  );
  const productRow = productResult.rows?.[0] || null;
  if (!productRow) return 0;

  const variantValues = [numericProductId, tenantId];
  const variantFilters = [
    "product_id = $1",
    "AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)",
    "AND is_active IS DISTINCT FROM FALSE",
    "AND deleted_at IS NULL",
  ];
  if (Number.isInteger(Number(variantId)) && Number(variantId) > 0) {
    variantValues.push(Number(variantId));
    variantFilters.push(`AND id = $${variantValues.length}`);
  }

  const variantResult = await client.query(
    `
    SELECT
      id,
      product_id,
      tenant_id,
      last_purchase_cost,
      last_purchase_price,
      average_cost,
      cost_price,
      purchase_price,
      selling_price,
      regular_price,
      price,
      sale_price,
      sale_price_enabled,
      updated_at,
      last_purchase_pricing_at
    FROM product_variants
    WHERE ${variantFilters.join("\n      ")}
    ORDER BY ${pricingSignalScoreSql} DESC, COALESCE(updated_at, last_purchase_pricing_at) DESC, id DESC
    LIMIT 1
    `,
    variantValues
  );
  const variantRow = variantResult.rows?.[0] || null;
  if (!variantRow) return 0;

  const nextLastPurchaseCost = pickPositiveMoney(
    variantRow.last_purchase_cost,
    variantRow.last_purchase_price,
    variantRow.purchase_price,
    variantRow.cost_price,
    variantRow.average_cost,
    productRow.last_purchase_cost,
    productRow.purchase_price,
    productRow.cost_price,
    productRow.average_cost
  );
  const nextAverageCost = pickPositiveMoney(
    variantRow.average_cost,
    variantRow.cost_price,
    variantRow.purchase_price,
    variantRow.last_purchase_cost,
    productRow.average_cost,
    productRow.cost_price,
    productRow.purchase_price
  );
  const nextCostPrice = pickPositiveMoney(
    variantRow.cost_price,
    variantRow.average_cost,
    variantRow.purchase_price,
    variantRow.last_purchase_cost,
    productRow.cost_price,
    productRow.average_cost,
    productRow.purchase_price
  );
  const nextPurchasePrice = pickPositiveMoney(
    variantRow.purchase_price,
    variantRow.last_purchase_price,
    variantRow.cost_price,
    variantRow.last_purchase_cost,
    productRow.purchase_price,
    productRow.cost_price,
    productRow.average_cost
  );
  const nextSellingPrice = pickPositiveMoney(
    variantRow.selling_price,
    variantRow.regular_price,
    variantRow.price,
    productRow.selling_price,
    productRow.regular_price,
    productRow.price
  );
  const nextRegularPrice = pickPositiveMoney(
    variantRow.regular_price,
    variantRow.price,
    variantRow.selling_price,
    productRow.regular_price,
    productRow.price,
    productRow.selling_price
  );
  const nextPrice = pickPositiveMoney(
    variantRow.price,
    variantRow.regular_price,
    variantRow.selling_price,
    productRow.price,
    productRow.regular_price,
    productRow.selling_price
  );
  const nextSalePrice = pickMoney(variantRow.sale_price, productRow.sale_price);
  const nextSalePriceEnabled = (toBoolean(variantRow.sale_price_enabled, toBoolean(productRow.sale_price_enabled, false)) || nextSalePrice > 0) && nextSalePrice > 0;

  console.log("[product-pricing-sync] selected source variant", {
    productId: numericProductId,
    tenantId: tenantId ?? null,
    requestedVariantId: Number.isInteger(Number(variantId)) && Number(variantId) > 0 ? Number(variantId) : null,
    selectedVariantId: variantRow.id,
    selectedVariantPricing: {
      last_purchase_cost: variantRow.last_purchase_cost ?? null,
      last_purchase_price: variantRow.last_purchase_price ?? null,
      average_cost: variantRow.average_cost ?? null,
      cost_price: variantRow.cost_price ?? null,
      purchase_price: variantRow.purchase_price ?? null,
      selling_price: variantRow.selling_price ?? null,
      regular_price: variantRow.regular_price ?? null,
      price: variantRow.price ?? null,
      sale_price: variantRow.sale_price ?? null,
      sale_price_enabled: variantRow.sale_price_enabled ?? null,
    },
    copiedPricing: {
      last_purchase_cost: nextLastPurchaseCost,
      average_cost: nextAverageCost,
      cost_price: nextCostPrice,
      purchase_price: nextPurchasePrice,
      selling_price: nextSellingPrice,
      regular_price: nextRegularPrice,
      price: nextPrice,
      sale_price: nextSalePrice,
      sale_price_enabled: nextSalePriceEnabled,
    },
  });

  const updateResult = await client.query(
    `
    UPDATE products
    SET
      last_purchase_cost = $1,
      average_cost = $2,
      cost_price = $3,
      purchase_price = $4,
      selling_price = $5,
      regular_price = $6,
      price = $7,
      sale_price = $8,
      sale_price_enabled = $9,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $10
      AND ($11::bigint IS NULL OR tenant_id = $11::bigint OR tenant_id IS NULL)
    `,
    [
      nextLastPurchaseCost,
      nextAverageCost,
      nextCostPrice,
      nextPurchasePrice,
      nextSellingPrice,
      nextRegularPrice,
      nextPrice,
      nextSalePrice,
      nextSalePriceEnabled,
      numericProductId,
      tenantId,
    ]
  );

  console.log("[product-pricing-sync] updated product pricing", {
    productId: numericProductId,
    tenantId: tenantId ?? null,
    rowCount: updateResult.rowCount || 0,
    copiedPricing: {
      last_purchase_cost: nextLastPurchaseCost,
      average_cost: nextAverageCost,
      cost_price: nextCostPrice,
      purchase_price: nextPurchasePrice,
      selling_price: nextSellingPrice,
      regular_price: nextRegularPrice,
      price: nextPrice,
      sale_price: nextSalePrice,
      sale_price_enabled: nextSalePriceEnabled,
    },
  });

  return updateResult.rowCount || 0;
};
