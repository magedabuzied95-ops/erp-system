import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getPosEffectivePrice } from "../src/modules/pos/lib/posPricing.js";
import { resolveEffectiveCustomerPrice, isForcedOfferSale } from "../src/shared/lib/effectiveCustomerPrice.js";
import { getDisplayPricing } from "../src/shared/lib/storefrontPricing.js";

// Owner decision, 2026-08-23: the curated Offers section IS the switch. A product sitting in العروض with a
// stored sale price below its normal price is charged at that sale price in POS, on the storefront and in every
// AI quote — WITHOUT the global website_settings.sale_mode_enabled toggle, which stays OFF in production.
//
// Before this rule the storefront FRONTEND already forced offers to their sale price while every server-side
// resolver waited for the global toggle, so m1store-egy.com advertised product 146 at EGP 350 and checkout
// billed EGP 500. These tests exist so those surfaces can never drift apart again.

const SALE_OFF = { sale_mode_enabled: false }; // production
const SALE_ON = { sale_mode_enabled: true };

// Real production rows (GET /api/storefront/products?offer_story=1).
const OFFER = { id: 146, is_offer_story: true, purchase_selling_price: 500, selling_price: 500, sale_price: 350 };
const NON_OFFER = { id: 274, purchase_selling_price: 450, selling_price: 450, sale_price: 350, sale_price_enabled: true };

const posPrice = (product, variant = null, settings = SALE_OFF) =>
  getPosEffectivePrice({ product, variant, saleModeSettings: settings }).final_price;
const canonicalPrice = (product, variant = null, settings = SALE_OFF) =>
  resolveEffectiveCustomerPrice({ product, variant, saleModeSettings: settings }).active_price;
// The storefront frontend takes the global toggle as an argument; production passes false.
const sitePrice = (product, variant = null) => getDisplayPricing(product, false, variant).price;

test("an offer is charged at its sale price on every surface while the global Sale toggle is off", () => {
  assert.equal(posPrice(OFFER), 350, "POS");
  assert.equal(canonicalPrice(OFFER), 350, "AI / server-side storefront");
  assert.equal(sitePrice(OFFER), 350, "storefront frontend");
});

test("POS, the AI resolver and the storefront never disagree about an offer", () => {
  for (const settings of [SALE_OFF, SALE_ON]) {
    assert.equal(posPrice(OFFER, null, settings), canonicalPrice(OFFER, null, settings));
  }
  assert.equal(posPrice(OFFER), sitePrice(OFFER));
});

test("a product outside the Offers section is untouched by this rule", () => {
  assert.equal(posPrice(NON_OFFER), 450, "POS still charges the normal price");
  assert.equal(canonicalPrice(NON_OFFER), 450, "the AI still quotes the normal price");
});

test("the offer flag is read on the product AND the variant, never on a merged scope", () => {
  // Storefront and POS variant rows omit is_offer_story, so a spread of {...product, ...variant} used to be the
  // only thing keeping a product-level offer alive. Each record is now checked on its own.
  const product = { id: 100, is_offer_story: true, purchase_selling_price: 1850 };
  const variant = { id: 5, purchase_selling_price: 1850, sale_price: 1550 };
  assert.equal(posPrice(product, variant), 1550);
  assert.equal(canonicalPrice(product, variant), 1550);

  // An offer flagged on the variant alone counts too.
  const variantOnly = { id: 6, is_offer_story: true, purchase_selling_price: 1850, sale_price: 1550 };
  assert.equal(posPrice({ id: 101, purchase_selling_price: 1850 }, variantOnly), 1550);
  assert.equal(canonicalPrice({ id: 101, purchase_selling_price: 1850 }, variantOnly), 1550);
});

test("a mistyped sale price can never raise what the customer is charged", () => {
  const badData = { ...OFFER, sale_price: 900 };
  assert.equal(posPrice(badData), 500);
  assert.equal(canonicalPrice(badData), 500);
  assert.equal(sitePrice(badData), 500);
});

test("an offer with no stored sale price stays at its normal price", () => {
  const noSale = { ...OFFER, sale_price: 0 };
  assert.equal(posPrice(noSale), 500);
  assert.equal(canonicalPrice(noSale), 500);
});

test("every offer alias activates the rule, on either record", () => {
  for (const key of ["is_offer", "isOffer", "show_in_offers", "showInOffers", "promotion_enabled", "promotionEnabled", "is_offer_story", "isOfferStory"]) {
    assert.equal(isForcedOfferSale({ [key]: true }), true, key);
    assert.equal(posPrice({ purchase_selling_price: 500, sale_price: 350, [key]: true }), 350, key);
  }
  assert.equal(isForcedOfferSale({}), false);
});

test("storefront checkout prices the offer it advertised, not the normal price", async () => {
  const source = await readFile(new URL("../server/controllers/storefrontController.js", import.meta.url), "utf8");
  // The charged price comes from resolveStorefrontActivePrice, which only honours an offer when the caller
  // passes forcedOffer — and the checkout row only knows it is an offer if the SQL selects the flag.
  assert.match(source, /COALESCE\(p\.is_offer_story, FALSE\) AS product_is_offer_story/);
  assert.match(source, /forcedOffer: isForcedOfferSale\(\{ is_offer_story: variant\.product_is_offer_story \}\)/);
  assert.match(source, /const enabled = saleModeEnabled\(pricingSettings\) \|\| forcedOffer === true/);
});

test("the global toggle still gates every sale mechanism that is not a curated offer", async () => {
  const source = await readFile(new URL("../src/shared/lib/effectiveCustomerPrice.js", import.meta.url), "utf8");
  assert.match(source, /reason: "global_sale_mode_off"/);
  // The per-record sale_price_enabled path is the mechanism the toggle exists for: dormant while OFF, live
  // while ON. Only the Offers section is exempt.
  assert.equal(canonicalPrice(NON_OFFER, null, SALE_OFF), 450);
  assert.equal(canonicalPrice(NON_OFFER, null, SALE_ON), 350);
  assert.equal(posPrice(NON_OFFER, null, SALE_OFF), 450);
  assert.equal(posPrice(NON_OFFER, null, SALE_ON), 350);
});
