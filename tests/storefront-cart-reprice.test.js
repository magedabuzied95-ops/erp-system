import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  STOREFRONT_CART_REPRICE_MAX_VARIANTS,
  repriceStorefrontCartVariants,
} from "../server/controllers/storefrontController.js";
import {
  CART_REPRICE_MAX_VARIANTS,
  applyCartReprice,
  cartRepriceKey,
  cartRepriceVariantIds,
  isStaleCartCheckoutError,
} from "../src/storefront/lib/cartReprice.js";

// 2026-09-14 audit: a cart line stored the price from the moment it was added and nothing ever read the
// catalogue again. Checkout re-prices on the server, so once an offer ended a transfer was refused with
// 400 paid_amount forever, a subtotal near the free-shipping threshold looped on 409 "Shipping fee
// changed", and a COD order was created at a total the shopper never saw. The cart page and checkout
// now ask POST /storefront/cart/reprice, which prices through the same helper checkout charges with.

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// A fake pg client: answers the column probe, the variant SELECT and the catalog projection.
const fakeExecutor = ({ variantRows = [], catalogRows = [] } = {}) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        const columns = params[0] === "products"
          ? ["id", "tenant_id", "manual_price_override_active", "manual_selling_price", "purchase_selling_price"]
          : ["id", "tenant_id", "product_id", "stock", "is_storefront_visible"];
        return { rows: columns.map((column_name) => ({ column_name })) };
      }
      if (sql.includes("FROM product_variants pv") && sql.includes("pv.id = ANY($1::bigint[])")) {
        const wanted = new Set((params[0] || []).map(String));
        return { rows: variantRows.filter((row) => wanted.has(String(row.id))) };
      }
      return { rows: catalogRows };
    },
  };
};

// Product 726's shape from the checkout-selling-price regression: every legacy column empty, the only
// normal price a manual override.
const overridePricedRow = {
  id: 8997,
  product_id: 726,
  stock: 4,
  selling_price: 0,
  price: 0,
  sale_price: 0,
  product_regular_price: 0,
  product_selling_price: 0,
  product_manual_price_override_active: true,
  product_manual_selling_price: 1750,
  product_purchase_selling_price: 0,
  product_sale_price: 0,
  product_is_offer_story: false,
};

test("the re-price answers each variant with today's canonical price, stock and whether it sells", async () => {
  const executor = fakeExecutor({
    variantRows: [
      overridePricedRow,
      { ...overridePricedRow, id: 9001, stock: 0 },
      { ...overridePricedRow, id: 9002, product_manual_price_override_active: false, product_manual_selling_price: null },
    ],
  });
  const variants = await repriceStorefrontCartVariants({
    tenantId: 1,
    variantIds: [8997, "9001", 9002, 777, 8997, -3, "x"],
    pricingSettings: {},
    executor,
  });
  assert.deepEqual(variants.map((entry) => entry.variant_id), [8997, 9001, 9002, 777], "deduplicated, invalid ids dropped, order kept");
  assert.deepEqual(variants[0], { variant_id: 8997, product_id: 726, price: 1750, compare_at_price: 0, stock: 4, available: true, reason: null });
  assert.equal(variants[1].available, false);
  assert.equal(variants[1].reason, "out_of_stock");
  assert.equal(variants[1].price, 1750, "an out-of-stock line still reports its price");
  assert.equal(variants[2].reason, "no_price", "a size with no price is not sellable, never priced at 0");
  assert.deepEqual(variants[3], { variant_id: 777, product_id: null, price: 0, compare_at_price: 0, stock: 0, available: false, reason: "unavailable" });

  const variantQueries = executor.calls.filter((call) => call.sql.includes("FROM product_variants pv"));
  assert.equal(variantQueries.length, 1, "one variant read for the whole cart, not one per line");
  assert.ok(!variantQueries[0].sql.includes("FOR UPDATE"), "a public read must never lock stock rows");
  assert.equal(variantQueries[0].params[1], 1, "scoped to the request's tenant");
});

test("a curated offer re-prices at its sale price with the normal price struck through", async () => {
  const executor = fakeExecutor({
    variantRows: [{
      ...overridePricedRow,
      product_manual_price_override_active: false,
      product_manual_selling_price: null,
      selling_price: 1200,
      sale_price: 900,
      product_regular_price: 1200,
      product_is_offer_story: true,
    }],
  });
  const [entry] = await repriceStorefrontCartVariants({ tenantId: 1, variantIds: [8997], pricingSettings: {}, executor });
  assert.equal(entry.price, 900);
  assert.equal(entry.compare_at_price, 1200);
});

test("the re-price is capped and answers nothing for an empty cart", async () => {
  assert.equal(STOREFRONT_CART_REPRICE_MAX_VARIANTS, CART_REPRICE_MAX_VARIANTS, "client and server agree on the cap");
  const executor = fakeExecutor();
  assert.deepEqual(await repriceStorefrontCartVariants({ tenantId: 1, variantIds: [], pricingSettings: {}, executor }), []);
  assert.equal(executor.calls.length, 0);
  const ids = Array.from({ length: 90 }, (_, index) => index + 1);
  const answered = await repriceStorefrontCartVariants({ tenantId: 1, variantIds: ids, pricingSettings: {}, executor });
  assert.equal(answered.length, STOREFRONT_CART_REPRICE_MAX_VARIANTS);
  const variantQuery = executor.calls.find((call) => call.sql.includes("FROM product_variants pv"));
  assert.equal(variantQuery.params[0].length, STOREFRONT_CART_REPRICE_MAX_VARIANTS);
});

test("checkout and the re-price share one variant SELECT and one pricing helper", async () => {
  const source = await read("../server/controllers/storefrontController.js");
  const checkout = source.slice(source.indexOf("export const createWebsiteOrder"));
  assert.ok(
    /priceStorefrontVariantRows\(\s*lockedItems\.map\(\(\{ variant \}\) => variant\),\s*\{ tenantId, pricingSettings, executor: client \}/.test(checkout),
    "checkout must charge through priceStorefrontVariantRows on its transaction client"
  );
  assert.ok(/storefrontCartVariantSql\(\{[^}]*forUpdate: true/.test(checkout), "checkout locks the rows the re-price reads");
  assert.ok(!checkout.includes("resolveStorefrontActivePrice({"), "no second, hand-rolled price inside checkout");
  const reprice = source.slice(source.indexOf("export const repriceStorefrontCartVariants"), source.indexOf("export const createWebsiteOrder"));
  assert.ok(reprice.includes("await priceStorefrontVariantRows(variantResult.rows"), "the re-price shows the price checkout charges");
});

test("the endpoint is public, and tenant-scoped the storefront way", async () => {
  const routes = await read("../server/routes/storefront.js");
  const line = routes.split(/\r?\n/).find((row) => row.includes('router.post("/cart/reprice"'));
  assert.ok(line, "POST /storefront/cart/reprice is mounted");
  assert.ok(!/protect|storefrontCustomer/.test(line), "no auth: a guest's cart needs today's prices too");
  const handler = routes.slice(routes.indexOf('router.post("/cart/reprice"'), routes.indexOf('router.post("/meta/events"'));
  assert.ok(handler.includes("tenantId: publicTenantId(req)"));
  assert.ok(handler.includes("repriceStorefrontCartVariants("));
});

test("applyCartReprice moves stale prices, flags unsellable lines and never drops one", () => {
  const cart = [
    { lineId: "1:10", product_id: 1, variant_id: 10, name: "Clog", quantity: 2, price: 900, sale_price: 900, compare_at_price: 1200 },
    { lineId: "2:20", product_id: 2, variant_id: 20, name: "Sandal", quantity: 1, price: 500, sale_price: 500 },
    { lineId: "3:30", product_id: 3, variant_id: 30, name: "Boot", quantity: 3, price: 700, sale_price: 700 },
    { lineId: "4:40", product_id: 4, variant_id: 40, name: "Slide", quantity: 1, price: 300, sale_price: 300 },
  ];
  const variants = [
    { variant_id: 10, price: 1200, compare_at_price: 0, stock: 5, available: true, reason: null },
    { variant_id: 20, price: 0, compare_at_price: 0, stock: 0, available: false, reason: "unavailable" },
    { variant_id: 30, price: 700, compare_at_price: 0, stock: 1, available: true, reason: null },
  ];
  const result = applyCartReprice(cart, variants);
  assert.equal(result.cart.length, 4, "no line is silently removed");
  assert.deepEqual(
    { price: result.cart[0].price, sale: result.cart[0].sale_price, current: result.cart[0].current_selling_price, compare: result.cart[0].compare_at_price, total: result.cart[0].total_amount },
    { price: 1200, sale: 1200, current: 1200, compare: 0, total: 2400 },
    "the ended offer's line now shows and totals at the normal price"
  );
  assert.deepEqual(result.changed, [{ lineId: "1:10", name: "Clog", from: 900, to: 1200 }]);
  assert.equal(result.cart[1].reprice_unavailable, "unavailable");
  assert.equal(result.cart[1].price, 500, "an unavailable line keeps its last price for the shopper to see");
  assert.equal(result.cart[2].reprice_unavailable, "low_stock");
  assert.deepEqual(result.unavailable.map((line) => line.reason), ["unavailable", "low_stock"]);
  assert.equal(result.cart[3], cart[3], "a line the server did not answer is untouched");

  const again = applyCartReprice(result.cart, variants);
  assert.equal(again.changed.length, 0, "a second pass reports nothing new");
  assert.equal(again.cart, result.cart, "and returns the same array, so React does not re-render");

  const restocked = applyCartReprice(result.cart, [{ variant_id: 30, price: 700, stock: 9, available: true }]);
  assert.equal("reprice_unavailable" in restocked.cart[2], false, "a flag clears once the line sells again");
});

test("applyCartReprice compares against the price the page shows, not a stored field", () => {
  const line = { lineId: "a", variant_id: 5, quantity: 1, price: 800, current_selling_price: 999 };
  const shown = (item) => Number(item.current_selling_price || item.price);
  const result = applyCartReprice([line], [{ variant_id: 5, price: 800, stock: 3, available: true }], shown);
  assert.deepEqual(result.changed, [{ lineId: "a", name: "", from: 999, to: 800 }]);
  assert.equal(shown(result.cart[0]), 800, "no stale alias outvotes the new price");
});

test("cart ids are unique, positive and capped; the key ignores price updates", () => {
  const cart = [{ variant_id: 3 }, { variant_id: "3" }, { variant_id: 1 }, { variant_id: "" }, {}];
  assert.deepEqual(cartRepriceVariantIds(cart), [3, 1]);
  assert.equal(cartRepriceKey(cart), "1,3");
  assert.equal(cartRepriceKey(cart.map((line) => ({ ...line, price: 1 }))), "1,3");
  assert.equal(cartRepriceVariantIds(Array.from({ length: 80 }, (_, i) => ({ variant_id: i + 1 }))).length, CART_REPRICE_MAX_VARIANTS);
});

test("only the two stale-total refusals trigger a re-price", () => {
  assert.equal(isStaleCartCheckoutError({ status: 409, responseBody: { field: "delivery_fee" } }), true);
  assert.equal(isStaleCartCheckoutError({ status: 400, responseBody: { field: "paid_amount" } }), true);
  assert.equal(isStaleCartCheckoutError({ status: 400, responseBody: { field: "coupon_code" } }), false);
  assert.equal(isStaleCartCheckoutError({ status: 422, responseBody: { field: "primary_phone" } }), false);
  assert.equal(isStaleCartCheckoutError(null), false);
});

test("the storefront re-prices on cart and checkout open, and recovers a stale checkout", async () => {
  const source = await read("../src/storefront/Storefront.jsx");
  assert.ok(source.includes("api.post(CART_REPRICE_ENDPOINT, { variant_ids: variantIds })"));
  assert.ok(source.includes("setCart((prev) => applyCartReprice(prev, variants, displayCartItemPrice).cart)"), "folded into the live cart with the display price rule");
  assert.ok(
    /currentStorefrontPath === ROOT_PATHS\.cart \|\| currentStorefrontPath === ROOT_PATHS\.checkout;\s*if \(!onCartOrCheckout \|\| !cartVariantsKey\) return;\s*repriceCart\(\);/.test(source),
    "re-price when /cart or /checkout opens"
  );
  const checkout = source.slice(source.indexOf("function CheckoutPage("));
  assert.ok(
    /if \(isStaleCartCheckoutError\(error\) && typeof repriceCart === "function"\) \{[\s\S]{0,500}await repriceCart\(\{ checkoutRetry: true \}\);\s*setShippingRequoteToken\(\(token\) => token \+ 1\);[\s\S]{0,200}return;/.test(checkout),
    "a 409 delivery_fee / 400 paid_amount re-prices and re-quotes instead of only toasting"
  );
  assert.ok(checkout.includes("form.district_id, form.zone_id, subtotal, shippingRequoteToken]"), "the shipping quote re-runs on the token");
  assert.ok(checkout.includes("<CartRepriceNotice notice={cartRepriceNotice}"), "checkout shows what changed");
  assert.ok(source.includes("repriceCart={repriceCart}"), "checkout receives the re-price");

  const cartPage = await read("../src/storefront/pages/StorefrontCartPage.jsx");
  assert.ok(cartPage.includes("<CartRepriceNotice notice={cartRepriceNotice}"), "the cart page shows what changed");
});

test("the notice copy exists in both storefront dictionaries", async () => {
  const notice = await read("../src/storefront/components/CartRepriceNotice.jsx");
  const keys = [...new Set([...notice.matchAll(/"storefront\.cart\.(reprice[A-Za-z]+)"/g)].map((match) => match[1]))];
  assert.ok(keys.length >= 7, "the notice reads its copy from locale keys");
  assert.ok(!/[\u0600-\u06FF]/.test(notice), "no inline Arabic in the component");
  for (const language of ["ar", "en"]) {
    const dictionary = JSON.parse(await read(`../src/locales/${language}/storefront.json`));
    for (const key of keys) {
      assert.equal(typeof dictionary.cart?.[key], "string", `${language}: storefront.cart.${key}`);
    }
    assert.ok(dictionary.cart.repriceLowStock.includes("{{stock}}"), `${language}: the low-stock line names the count`);
  }
});
