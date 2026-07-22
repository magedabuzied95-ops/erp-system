import test from "node:test";
import assert from "node:assert/strict";
import { resolveCurrentSellingPrice } from "../server/services/currentSellingPriceResolver.js";
import { buildMetaCatalogItem } from "../server/services/metaCatalogFeedService.js";
import { getPosEffectivePrice } from "../src/modules/pos/lib/posPricing.js";
import { storefrontSellingPrice } from "../src/shared/lib/storefrontPricing.js";

const base = {
  product: { id: 140, purchase_selling_price: 1000, manual_price_override_active: false },
  variant: { id: 3114, purchase_selling_price: 1000, manual_price_override_active: false },
};

test("purchase suggestion, manual override, later purchase, and cancellation use the documented sequence", () => {
  assert.equal(resolveCurrentSellingPrice(base).value, 1000);
  const overridden = { ...base, variant: { ...base.variant, manual_selling_price: 1200, manual_price_override_active: true } };
  assert.equal(resolveCurrentSellingPrice(overridden).value, 1200);
  const laterPurchase = { ...overridden, variant: { ...overridden.variant, purchase_selling_price: 1100 } };
  assert.equal(resolveCurrentSellingPrice(laterPurchase).value, 1200);
  const cancelled = { ...laterPurchase, variant: { ...laterPurchase.variant, manual_selling_price: null, manual_price_override_active: false } };
  assert.equal(resolveCurrentSellingPrice(cancelled).value, 1100);
  assert.equal(base.variant.purchase_selling_price, 1000, "historical purchase input is not mutated");
});

test("variant override wins over product override and storefront, POS, and Meta agree", () => {
  const product = { manual_selling_price: 1150, manual_price_override_active: true, purchase_selling_price: 1100 };
  const variant = { manual_selling_price: 1200, manual_price_override_active: true, purchase_selling_price: 1100 };
  const current = resolveCurrentSellingPrice({ product, variant }).value;
  assert.equal(current, 1200);
  assert.equal(storefrontSellingPrice({ ...product, current_selling_price: current }, { ...variant, current_selling_price: current }), current);
  assert.equal(getPosEffectivePrice({ product: { ...product, current_selling_price: current }, variant: { ...variant, current_selling_price: current } }).selling_price, current);
  const item = buildMetaCatalogItem({
    product_id: 140, variant_id: 3114, variant_sku: "SKU-3114", sku_count: 1, product_name: "Test", variant_stock: 1,
    product_manual_selling_price: product.manual_selling_price, product_manual_price_override_active: product.manual_price_override_active, product_purchase_selling_price: product.purchase_selling_price,
    variant_manual_selling_price: variant.manual_selling_price, variant_manual_price_override_active: variant.manual_price_override_active, variant_purchase_selling_price: variant.purchase_selling_price,
  });
  assert.equal(item.price, "1200.00 EGP");
});
