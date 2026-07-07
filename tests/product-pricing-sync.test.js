import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import db from "../server/database/db.js";
import { syncProductPricingFromVariants } from "../server/services/productPricingSyncService.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const toPositiveNumber = (value) => {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
};
const pricingSignalScore = (item = {}) => {
  const costSignal = [item.last_purchase_cost, item.average_cost, item.cost_price, item.purchase_price].some((value) => toPositiveNumber(value) > 0) ? 1 : 0;
  const sellingSignal = [item.selling_price, item.price, item.regular_price].some((value) => toPositiveNumber(value) > 0) ? 1 : 0;
  const saleSignal = [item.sale_price, item.sale_price_enabled ? 1 : 0].some((value) => toPositiveNumber(value) > 0) ? 1 : 0;
  return costSignal + sellingSignal + saleSignal;
};

const makeFakeClient = ({ products, variants }) => ({
  async query(sql, params = []) {
    const text = String(sql || "").trim();
    if (text.includes("FROM products") && text.includes("SELECT") && text.includes("last_purchase_cost") && text.includes("FOR UPDATE")) {
      const [productId, tenantId] = params;
      const row = products.find((item) => Number(item.id) === Number(productId) && (tenantId === null || tenantId === undefined || Number(item.tenant_id ?? null) === Number(tenantId) || item.tenant_id == null));
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes("FROM product_variants") && text.includes("ORDER BY")) {
      const [productId, tenantId, variantId] = params;
      let rows = variants.filter((item) =>
        Number(item.product_id) === Number(productId) &&
        (tenantId === null || tenantId === undefined || Number(item.tenant_id ?? null) === Number(tenantId) || item.tenant_id == null) &&
        item.is_active !== false &&
        item.deleted_at == null
      );
      if (variantId !== undefined) {
        rows = rows.filter((item) => Number(item.id) === Number(variantId));
      }
      rows.sort((a, b) => {
        const scoreDiff = pricingSignalScore(b) - pricingSignalScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        const aTime = new Date(a.updated_at || a.last_purchase_pricing_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.last_purchase_pricing_at || 0).getTime();
        if (aTime !== bTime) return bTime - aTime;
        return Number(b.id) - Number(a.id);
      });
      return { rows: rows.length ? [clone(rows[0])] : [], rowCount: rows.length ? 1 : 0 };
    }
    if (text.startsWith("UPDATE products")) {
      const [lastPurchaseCost, averageCost, costPrice, purchasePrice, sellingPrice, regularPrice, price, salePrice, salePriceEnabled, productId, tenantId] = params;
      const row = products.find((item) =>
        Number(item.id) === Number(productId) &&
        (tenantId === null || tenantId === undefined || Number(item.tenant_id ?? null) === Number(tenantId) || item.tenant_id == null)
      );
      if (!row) return { rows: [], rowCount: 0 };
      Object.assign(row, {
        last_purchase_cost: lastPurchaseCost,
        average_cost: averageCost,
        cost_price: costPrice,
        purchase_price: purchasePrice,
        selling_price: sellingPrice,
        regular_price: regularPrice,
        price,
        sale_price: salePrice,
        sale_price_enabled: salePriceEnabled,
      });
      return { rows: [clone(row)], rowCount: 1 };
    }
    throw new Error(`Unexpected query in test client: ${text.slice(0, 120)}`);
  },
});

test("syncProductPricingFromVariants copies variant prices onto the product row", async () => {
  const products = [
    {
      id: 41,
      tenant_id: 7,
      last_purchase_cost: 0,
      average_cost: 0,
      cost_price: 0,
      purchase_price: 0,
      selling_price: 0,
      price: 0,
      regular_price: 0,
      sale_price: 0,
      sale_price_enabled: false,
    },
  ];
  const variants = [
    {
      id: 71,
      product_id: 41,
      tenant_id: 7,
      last_purchase_cost: 1520,
      average_cost: 1495,
      cost_price: 1500,
      purchase_price: 1510,
      selling_price: 1999,
      regular_price: 1999,
      price: 1999,
      sale_price: 1799,
      sale_price_enabled: true,
      updated_at: "2026-07-01T10:00:00.000Z",
      is_active: true,
      deleted_at: null,
    },
    {
      id: 72,
      product_id: 41,
      tenant_id: 7,
      last_purchase_cost: 0,
      average_cost: 0,
      cost_price: 0,
      purchase_price: 0,
      selling_price: 0,
      regular_price: 0,
      price: 0,
      sale_price: 950,
      sale_price_enabled: true,
      updated_at: "2026-07-03T10:00:00.000Z",
      is_active: true,
      deleted_at: null,
    },
  ];
  const client = makeFakeClient({ products, variants });

  const updatedRows = await syncProductPricingFromVariants(client, { productId: 41, tenantId: 7, variantId: 71 });
  assert.equal(updatedRows, 1);
  assert.equal(products[0].last_purchase_cost, 1520);
  assert.equal(products[0].average_cost, 1495);
  assert.equal(products[0].cost_price, 1500);
  assert.equal(products[0].purchase_price, 1510);
  assert.equal(products[0].selling_price, 1999);
  assert.equal(products[0].regular_price, 1999);
  assert.equal(products[0].price, 1999);
  assert.equal(products[0].sale_price, 1799);
  assert.equal(products[0].sale_price_enabled, true);

  await syncProductPricingFromVariants(client, { productId: 41, tenantId: 7 });
  assert.equal(products[0].last_purchase_cost, 1520);
  assert.equal(products[0].average_cost, 1495);
  assert.equal(products[0].cost_price, 1500);
  assert.equal(products[0].purchase_price, 1510);
  assert.equal(products[0].selling_price, 1999);
  assert.equal(products[0].regular_price, 1999);
  assert.equal(products[0].price, 1999);
  assert.equal(products[0].sale_price, 1799);
  assert.equal(products[0].sale_price_enabled, true);

  variants[0] = {
    ...variants[0],
    selling_price: 2075,
    regular_price: 2075,
    price: 2075,
    sale_price: 0,
    sale_price_enabled: false,
    updated_at: "2026-07-02T10:00:00.000Z",
  };
  await syncProductPricingFromVariants(client, { productId: 41, tenantId: 7, variantId: 71 });
  assert.equal(products[0].selling_price, 2075);
  assert.equal(products[0].regular_price, 2075);
  assert.equal(products[0].price, 2075);
  assert.equal(products[0].sale_price, 0);
  assert.equal(products[0].sale_price_enabled, false);
});

test("syncProductPricingFromVariants copies all pricing fields for a real product with variants", async (t) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const candidateResult = await client.query(
      `
      SELECT
        p.id AS product_id,
        p.tenant_id AS product_tenant_id,
        p.last_purchase_cost AS product_last_purchase_cost,
        p.average_cost AS product_average_cost,
        p.cost_price AS product_cost_price,
        p.purchase_price AS product_purchase_price,
        p.selling_price AS product_selling_price,
        p.price AS product_price,
        p.regular_price AS product_regular_price,
        p.sale_price AS product_sale_price,
        p.sale_price_enabled AS product_sale_price_enabled,
        pv.id AS variant_id,
        pv.last_purchase_cost,
        pv.last_purchase_price,
        pv.average_cost,
        pv.cost_price,
        pv.purchase_price,
        pv.selling_price,
        pv.regular_price,
        pv.price,
        pv.sale_price,
        pv.sale_price_enabled
      FROM products p
      INNER JOIN product_variants pv ON pv.product_id = p.id
      WHERE pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
        AND COALESCE(NULLIF(pv.last_purchase_cost, 0), NULLIF(pv.average_cost, 0), NULLIF(pv.cost_price, 0), NULLIF(pv.purchase_price, 0)) IS NOT NULL
        AND COALESCE(NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), NULLIF(pv.regular_price, 0)) IS NOT NULL
        AND COALESCE(NULLIF(pv.sale_price, 0), NULLIF(pv.sale_price_enabled::int, 0)) IS NOT NULL
      ORDER BY
        (
          (CASE WHEN COALESCE(NULLIF(pv.last_purchase_cost, 0), NULLIF(pv.average_cost, 0), NULLIF(pv.cost_price, 0), NULLIF(pv.purchase_price, 0)) IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN COALESCE(NULLIF(pv.selling_price, 0), NULLIF(pv.price, 0), NULLIF(pv.regular_price, 0)) IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN COALESCE(NULLIF(pv.sale_price, 0), NULLIF(pv.sale_price_enabled::int, 0)) IS NOT NULL THEN 1 ELSE 0 END)
        ) DESC,
        COALESCE(pv.updated_at, pv.last_purchase_pricing_at) DESC,
        pv.id DESC
      LIMIT 1
      `
    );
    const candidate = candidateResult.rows?.[0] || null;
    if (!candidate) {
      t.skip("No real product with a fully priced variant was found in this database");
      return;
    }

    const updatedRows = await syncProductPricingFromVariants(client, {
      productId: candidate.product_id,
      tenantId: candidate.product_tenant_id ?? null,
      variantId: candidate.variant_id,
    });
    assert.equal(updatedRows, 1);

    const refreshedResult = await client.query(
      `
      SELECT
        id,
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
      LIMIT 1
      `,
      [candidate.product_id]
    );
    const refreshed = refreshedResult.rows?.[0] || null;
    assert.ok(refreshed, "Expected the real product to remain available after pricing sync");

    const expectedLastPurchaseCost = [
      candidate.last_purchase_cost,
      candidate.last_purchase_price,
      candidate.purchase_price,
      candidate.cost_price,
      candidate.average_cost,
      candidate.product_last_purchase_cost,
      candidate.product_purchase_price,
      candidate.product_cost_price,
      candidate.product_average_cost,
    ].find((value) => toPositiveNumber(value) > 0) || 0;
    const expectedAverageCost = [
      candidate.average_cost,
      candidate.cost_price,
      candidate.purchase_price,
      candidate.last_purchase_cost,
      candidate.product_average_cost,
      candidate.product_cost_price,
      candidate.product_purchase_price,
    ].find((value) => toPositiveNumber(value) > 0) || 0;
    const expectedCostPrice = [
      candidate.cost_price,
      candidate.average_cost,
      candidate.purchase_price,
      candidate.last_purchase_cost,
      candidate.product_cost_price,
      candidate.product_average_cost,
      candidate.product_purchase_price,
    ].find((value) => toPositiveNumber(value) > 0) || 0;
    const expectedPurchasePrice = [
      candidate.purchase_price,
      candidate.last_purchase_price,
      candidate.cost_price,
      candidate.last_purchase_cost,
      candidate.product_purchase_price,
      candidate.product_cost_price,
      candidate.product_average_cost,
    ].find((value) => toPositiveNumber(value) > 0) || 0;
    const expectedSellingPrice = [
      candidate.selling_price,
      candidate.regular_price,
      candidate.price,
      candidate.product_selling_price,
      candidate.product_regular_price,
      candidate.product_price,
    ].find((value) => toPositiveNumber(value) > 0) || 0;
    const expectedRegularPrice = [
      candidate.regular_price,
      candidate.price,
      candidate.selling_price,
      candidate.product_regular_price,
      candidate.product_price,
      candidate.product_selling_price,
    ].find((value) => toPositiveNumber(value) > 0) || 0;
    const expectedPrice = [
      candidate.price,
      candidate.regular_price,
      candidate.selling_price,
      candidate.product_price,
      candidate.product_regular_price,
      candidate.product_selling_price,
    ].find((value) => toPositiveNumber(value) > 0) || 0;
    const expectedSalePrice = Number(candidate.sale_price || candidate.product_sale_price || 0) || 0;
    const expectedSalePriceEnabled = Boolean((candidate.sale_price_enabled ?? candidate.product_sale_price_enabled) && expectedSalePrice > 0);

    const expected = {
      last_purchase_cost: Number(expectedLastPurchaseCost || 0),
      average_cost: Number(expectedAverageCost || 0),
      cost_price: Number(expectedCostPrice || 0),
      purchase_price: Number(expectedPurchasePrice || 0),
      selling_price: Number(expectedSellingPrice || 0),
      price: Number(expectedPrice || 0),
      regular_price: Number(expectedRegularPrice || 0),
      sale_price: Number(expectedSalePrice || 0),
      sale_price_enabled: expectedSalePriceEnabled,
    };

    assert.equal(Number(refreshed.last_purchase_cost || 0), expected.last_purchase_cost);
    assert.equal(Number(refreshed.average_cost || 0), expected.average_cost);
    assert.equal(Number(refreshed.cost_price || 0), expected.cost_price);
    assert.equal(Number(refreshed.purchase_price || 0), expected.purchase_price);
    assert.equal(Number(refreshed.selling_price || 0), expected.selling_price);
    assert.equal(Number(refreshed.price || 0), expected.price);
    assert.equal(Number(refreshed.regular_price || 0), expected.regular_price);
    assert.equal(Number(refreshed.sale_price || 0), expected.sale_price);
    assert.equal(Boolean(refreshed.sale_price_enabled), expected.sale_price_enabled);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});

test("variant and purchase controllers call the pricing sync helper after price-changing writes", () => {
  const productsSource = readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  const purchasesSource = readFileSync(new URL("../server/routes/purchases.js", import.meta.url), "utf8");
  const variantSource = readFileSync(new URL("../server/controllers/variantController.js", import.meta.url), "utf8");

  assert.match(productsSource, /syncProductPricingFromVariants\(client,\s*\{\s*productId,\s*tenantId,\s*\}\s*\)/);
  assert.match(productsSource, /await syncProductPricingFromVariants\(client,\s*\{\s*productId,\s*tenantId,\s*\}\s*\);/);
  assert.match(productsSource, /syncProductPricingFromVariants\(client,\s*\{\s*productId:\s*req\.params\.id,\s*tenantId,\s*variantId:\s*createdVariant\.id,\s*\}\s*\)/);
  assert.match(productsSource, /syncProductPricingFromVariants\(client,\s*\{\s*productId:\s*currentVariant\.product_id,\s*tenantId,\s*variantId:\s*updated\.rows\[0\]\?\.id\s*\|\|\s*currentVariant\.id,\s*\}\s*\)/);
  assert.match(productsSource, /syncProductPricingFromVariants\(client,\s*\{\s*productId:\s*variant\.product_id,\s*tenantId,\s*\}\s*\)/);
  assert.match(variantSource, /syncProductPricingFromVariants\(pool,\s*\{\s*productId:\s*product_id,\s*tenantId,\s*variantId:\s*newVariant\.rows\[0\]\?\.id\s*\|\|\s*null,\s*\}\s*\)/);
  assert.match(purchasesSource, /syncProductPricingFromVariants\(client,\s*\{\s*productId:\s*snapshot\.product_id \|\| productId,\s*tenantId,\s*variantId:\s*numericVariantId,\s*\}\s*\)/);
  assert.match(purchasesSource, /syncProductPricingFromVariants\(client,\s*\{\s*productId,\s*tenantId,\s*\}\s*\);/);
});
