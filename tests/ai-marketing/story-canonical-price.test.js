import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { __aiMarketingCenterTestHooks } from "../../server/services/aiMarketingCenterService.js";

const {
  getProductPrice,
  getProductOriginalPrice,
  storyProductPriceFields,
  storyVariantPriceFields,
  storyItemPriceStamp,
} = __aiMarketingCenterTestHooks;

const source = fs.readFileSync(new URL("../../server/services/aiMarketingCenterService.js", import.meta.url), "utf8");

// A row as the story loaders select it (STORY_PRICE_COLUMNS). Product 375 — SKECHERS GLIDE-STEP,
// Black & Blue — which a story quoted at 1,450 while the shop sells every size at 1,550.
const row = (overrides = {}) => ({
  story_p_price: 0,
  story_p_selling_price: 0,
  story_p_regular_price: 0,
  story_p_purchase_selling_price: null,
  story_p_manual_selling_price: null,
  story_p_manual_price_override_active: false,
  story_p_sale_price: 1350,
  story_p_sale_price_enabled: false,
  story_p_is_offer_story: false,
  story_p_use_custom_compare_price: true,
  story_p_custom_compare_price: 2400,
  story_v_price: 0,
  story_v_selling_price: 1450,
  story_v_regular_price: 0,
  story_v_manual_selling_price: null,
  story_v_manual_price_override_active: false,
  story_v_sale_price_enabled: false,
  variant_line_purchase_selling_price: null,
  variant_line_sale_price: null,
  ...overrides,
});

const price = (dbRow, saleModeSettings = { sale_mode_enabled: false }) => {
  const product = { id: 375, ...storyProductPriceFields(dbRow), sale_mode_settings: saleModeSettings };
  const variant = { id: 6607, ...storyVariantPriceFields(dbRow) };
  const current = getProductPrice(product, variant);
  return { current, compare: getProductOriginalPrice(product, variant, current) };
};

test("a size's manual selling price beats its legacy selling_price", () => {
  const priced = price(row({ story_v_manual_selling_price: 1550, story_v_manual_price_override_active: true }));
  assert.equal(priced.current, 1550);
  assert.equal(priced.compare, 2400);
});

test("a product-level manual price beats the size's legacy price, as in POS and the shop", () => {
  assert.equal(price(row({ story_p_manual_selling_price: 1550, story_p_manual_price_override_active: true })).current, 1550);
});

test("the size's own invoice line (the storefront's line) beats its legacy selling_price", () => {
  assert.equal(price(row({ variant_line_purchase_selling_price: 1550 })).current, 1550);
});

test("a stored sale price stays dormant with Sale Mode off and the product outside العروض", () => {
  const priced = price(row({ story_v_manual_selling_price: 1550, story_v_manual_price_override_active: true, story_v_sale_price_enabled: true, variant_line_sale_price: 1350 }));
  assert.equal(priced.current, 1550);
});

test("a curated offer is quoted at its sale price with the normal price or compare struck through", () => {
  const offer = row({ story_p_is_offer_story: true, variant_line_purchase_selling_price: 1550, variant_line_sale_price: 1350 });
  assert.deepEqual(price(offer), { current: 1350, compare: 2400 });
  assert.deepEqual(price({ ...offer, story_p_use_custom_compare_price: false }), { current: 1350, compare: 1550 });
});

test("with Sale Mode on, an enabled sale price is what the story quotes", () => {
  const onSale = row({ variant_line_purchase_selling_price: 1550, variant_line_sale_price: 1350, story_v_sale_price_enabled: true });
  assert.equal(price(onSale, { sale_mode_enabled: true }).current, 1350);
});

test("a stale, higher legacy price is not a strikethrough", () => {
  const priced = price(row({
    story_v_selling_price: 1700,
    story_v_manual_selling_price: 1550,
    story_v_manual_price_override_active: true,
    story_p_use_custom_compare_price: false,
  }));
  assert.deepEqual(priced, { current: 1550, compare: 0 });
});

test("a story image rendered at another price is re-rendered before it is published", () => {
  const rendered = { design_json: { current_price: 1450, old_crossed_price: 2400 } };
  const repriced = { design_json: { current_price: 1550, old_crossed_price: 2400 } };
  assert.notEqual(storyItemPriceStamp(rendered), storyItemPriceStamp(repriced));
  assert.equal(storyItemPriceStamp(repriced), "1550|2400");

  const ensure = source.slice(source.indexOf("const ensureQueueStoryRenderedAsset"), source.indexOf("export const generateAiMarketingQueueStoryAsset"));
  assert.match(ensure, /if \(renderedPriceStamp === priceStamp\) return normalizeQueueRow\(item\);/);
  assert.match(ensure, /story_asset_price_stamp: priceStamp,/);
});

test("every story price query reads the canonical inputs, never a hand-rolled line", () => {
  for (const [start, end] of [
    ["export const listAiMarketingQueue", "const hydrateQueueStoryMetadata"],
    ["const fetchPricingForQueueItem", "const fetchCurrentPriceForQueueItem"],
    ["const loadProducts", "const strategyForProduct"],
  ]) {
    const body = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(body, /AD_FEED_PURCHASE_CTES/, `${start} must splice the storefront's invoice-line definition`);
    assert.match(body, /AD_FEED_PURCHASE_JOINS/, `${start} must join the size to its invoice line`);
    assert.match(body, /STORY_PRICE_(BASE_)?COLUMNS/, `${start} must select the resolver's inputs`);
  }
});
