import test from "node:test";
import assert from "node:assert/strict";

import {
  displaySellingPrice,
  getDisplayPricing,
  parseSaleModeEnabled,
  resolveStorefrontPrice,
  storefrontSaleModeOn,
} from "../../src/shared/lib/storefrontPricing.js";

const product = {
  id: 63,
  selling_price: 1750,
  price: 1750,
  sale_price: 1500,
  regular_price: 2100,
};

test("a stored sale price does not activate sale mode", () => {
  assert.equal(storefrontSaleModeOn(product), false);
  assert.equal(displaySellingPrice(product), 1750);
  assert.equal(resolveStorefrontPrice(product).current_price, 1750);
});

test("the POS sale-mode flag activates the saved sale price", () => {
  const saleProduct = { ...product, sale_mode_enabled: true, sale_mode_applied: true };
  const pricing = getDisplayPricing(saleProduct, saleProduct.sale_mode_enabled);

  assert.equal(pricing.price, 1500);
  assert.equal(pricing.isOnSale, true);
  assert.equal(displaySellingPrice(saleProduct), 1500);
});

test("turning sale mode off restores the normal selling price", () => {
  const pricing = getDisplayPricing({ ...product, sale_mode_enabled: false }, false);

  assert.equal(pricing.price, 1750);
  assert.equal(pricing.isOnSale, false);
});

test("a custom storefront compare price is shown without sale mode", () => {
  const pricing = getDisplayPricing({
    ...product,
    sale_mode_enabled: false,
    use_custom_compare_price: true,
    custom_compare_price: 2300,
  }, false);

  assert.equal(pricing.price, 1750);
  assert.equal(pricing.comparePrice, 2300);
  assert.equal(pricing.discountPercent, 24);
  assert.equal(pricing.isOnSale, true);
});

test("a storefront offer always uses its saved sale price when POS sale mode is off", () => {
  const offerProduct = {
    ...product,
    is_offer_story: true,
    sale_price_enabled: false,
    sale_mode_enabled: false,
  };
  const pricing = getDisplayPricing(offerProduct, false);

  assert.equal(pricing.price, 1500);
  assert.equal(pricing.comparePrice, 1750);
  assert.equal(pricing.isOnSale, true);
  assert.equal(displaySellingPrice(offerProduct), 1500);
  assert.equal(resolveStorefrontPrice(offerProduct).current_price, 1500);
});

test("a missing public sale-mode setting fails closed", () => {
  const saleModeEnabled = parseSaleModeEnabled(undefined, false);
  const pricing = getDisplayPricing(product, saleModeEnabled);

  assert.equal(saleModeEnabled, false);
  assert.equal(pricing.price, 1750);
  assert.equal(pricing.isOnSale, false);
});
