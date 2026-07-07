import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { syncProductPricingFromVariants } from "../server/services/productPricingSyncService.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const makeFakeClient = ({ products, variants }) => ({
  async query(sql, params = []) {
    const text = String(sql || "").trim();
    if (text.includes("FROM products") && text.includes("SELECT") && text.includes("last_purchase_cost") && text.includes("FOR UPDATE")) {
      const [productId, tenantId] = params;
      const row = products.find((item) => Number(item.id) === Number(productId) && (tenantId === null || tenantId === undefined || Number(item.tenant_id ?? null) === Number(tenantId) || item.tenant_id == null));
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (text.includes("FROM product_variants") && text.includes("ORDER BY COALESCE(updated_at, last_purchase_pricing_at) DESC")) {
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
