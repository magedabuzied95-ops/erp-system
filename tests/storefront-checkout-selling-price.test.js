import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resolveCurrentSellingPrice } from "../src/shared/lib/currentSellingPrice.js";

// 2026-08-25: a real cart on m1store-egy.com was rejected with
//   400 "This product does not have a valid selling price" { product_id: 726, variant_id: 8997 }
// while the product page advertised EGP 1750. The storefront card prices through the catalog projection
// (resolveCurrentSellingPrice: manual override -> purchase-invoice price -> legacy columns), but checkout
// read pv.selling_price / pv.price / p.selling_price directly. For this product — and for the large slice of
// the catalogue whose only normal price is a manual override or a purchase invoice — those columns are 0, so
// checkout resolved 0 and refused the order. Same class of leak as the account page's hand-rolled COALESCE.
//
// The production row, from GET /api/storefront/products/726: every legacy price column empty, 1750 in the
// override and on the purchase invoice.
const PRODUCT_726 = {
  id: 726,
  selling_price: 0,
  price: 0,
  regular_price: 0,
  purchase_selling_price: 0,
  manual_selling_price: null,
  manual_price_override_active: false,
};
const VARIANT_8997 = {
  id: 8997,
  size: "42",
  color: "Black",
  stock: 4,
  selling_price: 0,
  price: 0,
  regular_price: 0,
  sale_price: 0,
  purchase_selling_price: 1750,
  manual_selling_price: 1750,
  manual_price_override_active: true,
};

// What the checkout loop used to compute, kept verbatim so the regression is legible.
const legacyOnlySellingPrice = (variant, product) =>
  Number(variant.selling_price || variant.price || product.selling_price || 0);

const controllerSource = () =>
  readFile(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");

test("the cart that 400'd resolves to the advertised price", () => {
  assert.equal(legacyOnlySellingPrice(VARIANT_8997, PRODUCT_726), 0, "the columns checkout used to read are empty");
  assert.equal(resolveCurrentSellingPrice({ product: PRODUCT_726, variant: VARIANT_8997 }).value, 1750);
});

test("a variant priced only by its purchase invoice is sellable too", () => {
  const variant = { ...VARIANT_8997, manual_selling_price: null, manual_price_override_active: false };
  assert.equal(legacyOnlySellingPrice(variant, PRODUCT_726), 0);
  assert.equal(resolveCurrentSellingPrice({ product: PRODUCT_726, variant }).value, 1750);
  assert.equal(resolveCurrentSellingPrice({ product: PRODUCT_726, variant }).source, "variant_purchase_selling_price");
});

test("a product-level override prices a variant that carries no price of its own", () => {
  const product = { ...PRODUCT_726, manual_selling_price: 1750, manual_price_override_active: true };
  const variant = { id: 9001, selling_price: 0, price: 0, regular_price: 0 };
  assert.equal(resolveCurrentSellingPrice({ product, variant }).value, 1750);
});

test("checkout selects the canonical price columns it has to resolve through", async () => {
  const source = await controllerSource();
  for (const column of ["manual_price_override_active", "manual_selling_price", "purchase_selling_price"]) {
    assert.ok(
      source.includes('productPricingColumnSql("' + column + '")} AS product_' + column),
      "the checkout SELECT must read p." + column
    );
  }
});

test("checkout prices through the catalog projection and the canonical resolver, never the raw columns", async () => {
  const source = await controllerSource();
  const checkout = source.slice(source.indexOf("export const createWebsiteOrder"));
  assert.ok(
    checkout.includes("const price = shelfPriceByVariantId.get(String(variant.id)) || resolvedPrice.activePrice"),
    "the shelf price the customer saw must win"
  );
  assert.ok(
    checkout.includes("shelfPriceByVariantId.set(String(shelfVariant.id), shelfPrice)"),
    "the shelf price must come from the catalog projection the cards render from"
  );
  assert.ok(
    checkout.includes("resolveCurrentSellingPrice({"),
    "the fallback must be the canonical resolver, not selling_price || price"
  );
  assert.ok(
    !checkout.includes("roundMoney(variant.selling_price || variant.price || variant.product_selling_price)"),
    "the legacy-columns-only read is what produced the 400 and must not come back"
  );
});

test("the checkout transaction prices on its own client, not a second pooled connection", async () => {
  const source = await controllerSource();
  assert.ok(
    source.includes("pricingSettings = STOREFRONT_PRICING_DEFAULTS, executor = db)"),
    "queryProductsByIds must accept the caller's executor"
  );
  const call = source.slice(source.indexOf("const shelfPricedProducts = await queryProductsByIds("));
  assert.ok(call.slice(0, 260).includes("client"), "checkout must pass its transaction client, or it can starve the pool");
});
