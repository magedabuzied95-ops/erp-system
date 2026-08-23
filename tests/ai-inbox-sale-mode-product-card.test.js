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

// A curated offer: the manager moved this product into the Offers section.
const product = {
  id: 70,
  regular_price: 2000,
  selling_price: 2000,
  price: 2000,
  sale_price: 1750,
  sale_price_enabled: true,
  is_offer: true,
};

// NOT in the Offers section, but carrying a stored sale price and the legacy per-record enable flag.
// Most of this catalogue looks like this, which is why the global toggle still has to gate it.
const nonOfferProduct = {
  id: 39,
  regular_price: 1750,
  selling_price: 1750,
  price: 1750,
  sale_price: 1550,
  sale_price_enabled: true,
};

test("a curated offer charges its sale price even when the POS Sale button is off", () => {
  const pricing = getPosEffectivePrice({ product, saleModeSettings: { sale_mode_enabled: false } });
  assert.equal(pricing.final_price, 1750);
  assert.equal(pricing.sale_mode_applied, true);
  assert.equal(pricing.sale_source, "offer");
});

test("customer product cards use saved sale price when the POS Sale button is on", () => {
  const pricing = getPosEffectivePrice({ product, saleModeSettings: { sale_mode_enabled: true } });
  assert.equal(pricing.final_price, 1750);
  assert.equal(pricing.sale_mode_applied, true);
  assert.equal(pricing.sale_source, "offer");
});

// The original defect this suite was written for: the AI quoted 1550 while POS charged 1750 because the
// resolver obeyed loose per-record flags instead of the global toggle. Offers are now exempt BY NAME, so
// nothing outside the Offers section may start honouring sale_price_enabled on its own again.
test("a product outside the Offers section still charges regular price when the Sale button is off", () => {
  const pricing = getPosEffectivePrice({ product: nonOfferProduct, saleModeSettings: { sale_mode_enabled: false } });
  assert.equal(pricing.final_price, 1750);
  assert.equal(pricing.sale_mode_applied, false);
  assert.equal(pricing.sale_source, "regular");
});

test("a sale price above the normal price is ignored, never charged", () => {
  const pricing = getPosEffectivePrice({
    product: { ...product, sale_price: 2400 },
    saleModeSettings: { sale_mode_enabled: false },
  });
  assert.equal(pricing.final_price, 2000);
  assert.equal(pricing.sale_mode_applied, false);
});

test("an offer flagged on the product prices every variant, including variant-level sale prices", () => {
  const pricing = getPosEffectivePrice({
    product: { id: 100, is_offer_story: true, purchase_selling_price: 1850 },
    variant: { id: 5, sale_price: 1550, purchase_selling_price: 1850 },
    saleModeSettings: { sale_mode_enabled: false },
  });
  assert.equal(pricing.final_price, 1550);
  assert.equal(pricing.sale_source, "offer");
});

test("AI Inbox and PWA load the same persisted Sale setting as POS before building cards", () => {
  assert.match(catalogSource, /api\s*\.get\("\/website\/settings"/);
  assert.match(catalogSource, /normalizeSaleModeSettings/);
  // saleModeSettings must remain the FIRST argument so the inbox cards use the
  // same persisted POS sale setting. A second requestOptions arg (compact picker
  // projection) is allowed and does not affect the sale mode.
  assert.match(catalogSource, /getPosSellableProducts\(saleModeSettings[,)]/);
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
