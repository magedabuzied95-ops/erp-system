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
const hasPositiveMoneyValue = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  const normalized = typeof value === "number" ? value : parseFloat(String(value).trim());
  return Number.isFinite(normalized) && normalized > 0;
};

const pricingSignalScoreSql = `
  (
    (CASE WHEN COALESCE(NULLIF(last_purchase_cost, 0), NULLIF(average_cost, 0), NULLIF(cost_price, 0), NULLIF(purchase_price, 0)) IS NOT NULL THEN 4 ELSE 0 END) +
    (CASE WHEN COALESCE(NULLIF(selling_price, 0), NULLIF(price, 0), NULLIF(regular_price, 0)) IS NOT NULL THEN 2 ELSE 0 END) +
    (CASE WHEN COALESCE(sale_price_enabled, FALSE) = TRUE AND COALESCE(sale_price, 0) > 0 THEN 1 ELSE 0 END)
  )
`;

export const syncProductPricingFromVariants = async (client, { productId, tenantId = null, variantId = null } = {}) => {
  console.log(`[pricing-sync] entered productId=${productId}`, {
    productId: productId ?? null,
    tenantId: tenantId ?? null,
    variantId: variantId ?? null,
  });
  const numericProductId = Number(productId || 0);
  if (!Number.isInteger(numericProductId) || numericProductId <= 0) {
    console.log("[pricing-sync] early return", {
      reason: "invalid_product_id",
      productId: productId ?? null,
      tenantId: tenantId ?? null,
      variantId: variantId ?? null,
    });
    return 0;
  }

  const productResult = await client.query(
    `
    SELECT
      id,
      tenant_id,
      last_purchase_cost,
      last_purchase_price,
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
  if (!productRow) {
    console.log("[pricing-sync] early return", {
      reason: "product_not_found",
      productId: numericProductId,
      tenantId: tenantId ?? null,
      variantId: variantId ?? null,
    });
    return 0;
  }

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
    ORDER BY
      ${pricingSignalScoreSql} DESC,
      COALESCE(NULLIF(last_purchase_cost, 0), NULLIF(average_cost, 0), NULLIF(cost_price, 0), NULLIF(purchase_price, 0)) DESC,
      COALESCE(NULLIF(selling_price, 0), NULLIF(price, 0), NULLIF(regular_price, 0)) DESC,
      CASE WHEN COALESCE(sale_price_enabled, FALSE) = TRUE AND COALESCE(sale_price, 0) > 0 THEN sale_price ELSE 0 END DESC,
      COALESCE(updated_at, last_purchase_pricing_at) DESC,
      id DESC
    LIMIT 1
    `,
    variantValues
  );
  const variantRow = variantResult.rows?.[0] || null;
  if (!variantRow) {
    console.log("[pricing-sync] early return", {
      reason: "variant_not_found",
      productId: numericProductId,
      tenantId: tenantId ?? null,
      variantId: Number.isInteger(Number(variantId)) && Number(variantId) > 0 ? Number(variantId) : null,
    });
    return 0;
  }

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
  const productSalePriceEnabled = toBoolean(productRow.sale_price_enabled, false);
  const variantSalePriceEnabled = toBoolean(variantRow.sale_price_enabled, false);
  const hasExistingProductSalePrice = hasPositiveMoneyValue(productRow.sale_price);
  const hasValidVariantSalePrice = variantSalePriceEnabled && hasPositiveMoneyValue(variantRow.sale_price);
  const nextSalePrice = hasValidVariantSalePrice ? variantRow.sale_price : productRow.sale_price;
  const nextSalePriceEnabled = hasValidVariantSalePrice ? true : productRow.sale_price_enabled;
  const copiedCostFields = {
    last_purchase_cost: nextLastPurchaseCost,
    last_purchase_price: pickPositiveMoney(
      variantRow.last_purchase_price,
      variantRow.last_purchase_cost,
      variantRow.purchase_price,
      variantRow.cost_price,
      variantRow.average_cost,
      productRow.last_purchase_price,
      productRow.last_purchase_cost,
      productRow.purchase_price,
      productRow.cost_price,
      productRow.average_cost
    ),
    average_cost: nextAverageCost,
    cost_price: nextCostPrice,
    purchase_price: nextPurchasePrice,
  };

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
    salePricePreservation: {
      current_product_sale_price: productRow.sale_price ?? null,
      current_product_sale_price_enabled: productRow.sale_price_enabled ?? null,
      variant_sale_price: variantRow.sale_price ?? null,
      variant_sale_price_enabled: variantRow.sale_price_enabled ?? null,
      hasExistingProductSalePrice,
      hasValidVariantSalePrice,
      productSalePriceEnabled,
    },
  });
  console.log("[product-pricing-sync] copiedCostFields", {
    productId: numericProductId,
    tenantId: tenantId ?? null,
    copiedCostFields,
  });

  const updateResult = await client.query(
    `
    UPDATE products
    SET
      last_purchase_cost = $1,
      last_purchase_price = $2,
      average_cost = $3,
      cost_price = $4,
      purchase_price = $5,
      selling_price = $6,
      regular_price = $7,
      price = $8,
      sale_price = $9,
      sale_price_enabled = $10,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $11
      AND ($12::bigint IS NULL OR tenant_id = $12::bigint OR tenant_id IS NULL)
    `,
    [
      nextLastPurchaseCost,
      copiedCostFields.last_purchase_price,
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
      last_purchase_price: copiedCostFields.last_purchase_price,
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

  const afterSyncResult = await client.query(
    `
    SELECT id, sale_price, sale_price_enabled
    FROM products
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    LIMIT 1
    `,
    [numericProductId, tenantId]
  );

  console.log("DB_SALE_PRICE_AFTER_PRODUCT_PRICING_SYNC", {
    productId: numericProductId,
    tenantId: tenantId ?? null,
    db: afterSyncResult.rows[0] || null,
  });

  return updateResult.rowCount || 0;
};
