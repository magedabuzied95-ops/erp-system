import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { getPosEffectivePrice } from "../src/modules/pos/lib/posPricing.js";
import { resolveCardPrice } from "../server/services/aiProductCards.js";

const catalogSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/services/customerProductCatalog.js", import.meta.url),
  "utf8"
);
const pwaSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url),
  "utf8"
);
const pickerSource = fs.readFileSync(
  new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url),
  "utf8"
);

const product = {
  id: 70,
  regular_price: 2000,
  selling_price: 2000,
  price: 2000,
  sale_price: 1750,
  sale_price_enabled: true,
  is_offer: true,
};

test("customer product cards use regular selling price when the POS Sale button is off", () => {
  const pricing = getPosEffectivePrice({ product, saleModeSettings: { sale_mode_enabled: false } });
  assert.equal(pricing.final_price, 2000);
  assert.equal(pricing.sale_mode_applied, false);
  assert.equal(pricing.sale_source, "regular");
});

test("customer product cards use saved sale price when the POS Sale button is on", () => {
  const pricing = getPosEffectivePrice({ product, saleModeSettings: { sale_mode_enabled: true } });
  assert.equal(pricing.final_price, 1750);
  assert.equal(pricing.sale_mode_applied, true);
  assert.equal(pricing.sale_source, "offer");
});

test("AI Inbox and PWA load the same persisted Sale setting as POS before building cards", () => {
  assert.match(catalogSource, /api\s*\.get\("\/website\/settings"/);
  assert.match(catalogSource, /normalizeSaleModeSettings/);
  assert.match(catalogSource, /getPosSellableProducts\(saleModeSettings\)/);
  assert.match(pwaSource, /loadCustomerProductCatalog\(\{ headers \}\)/);
  assert.match(pickerSource, /loadCustomerProductCatalog\(\)/);
  assert.doesNotMatch(pickerSource, /getPosSellableProducts\(\)/);
});

test("AI product cards preserve the customer-facing regular price when Sale mode is off", () => {
  const card = {
    product_id: 561,
    price: 1700,
    sale_mode_applied: false,
    sale_price: 1600,
    selling_price: 1700,
  };
  const variant = {
    id: 7912,
    sale_price: 1600,
    selling_price: 1700,
    sale_price_enabled: true,
  };

  assert.equal(resolveCardPrice(card, variant, variant), 1700);
});

test("AI product cards preserve the already-selected Sale price when Sale mode is on", () => {
  const card = {
    product_id: 561,
    price: 1600,
    sale_mode_applied: true,
    sale_price: 1600,
    selling_price: 1700,
  };
  const variant = {
    id: 7912,
    sale_price: 1600,
    selling_price: 1700,
    sale_mode_applied: true,
  };

  assert.equal(resolveCardPrice(card, variant, variant), 1600);
});

test("AI product cards can still use a legacy sale-only price as a last fallback", () => {
  assert.equal(resolveCardPrice({ product_id: 561 }, { id: 7912, sale_price: 1600 }), 1600);
});
