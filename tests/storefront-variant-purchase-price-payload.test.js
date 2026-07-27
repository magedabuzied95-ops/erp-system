import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveCurrentSellingPrice } from "../server/services/currentSellingPriceResolver.js";

const controller = readFileSync(
  new URL("../server/controllers/storefrontController.js", import.meta.url),
  "utf8",
);

test("storefront catalog payload preserves each variant purchase selling price", () => {
  assert.match(controller, /'purchase_selling_price', COALESCE\(last_color_purchase_price\.purchase_selling_price, pv\.purchase_selling_price\)/);
  assert.match(controller, /'sale_price', COALESCE\(last_color_purchase_price\.purchase_sale_price, pv\.sale_price\)/);
  assert.match(controller, /'manual_selling_price', pv\.manual_selling_price/);
  assert.match(controller, /'manual_price_override_active', pv\.manual_price_override_active/);
});

test("legacy variants inherit the latest purchase selling price from the same color", () => {
  assert.match(controller, /LEFT JOIN LATERAL \([\s\S]*?FROM purchase_items pi/);
  assert.match(controller, /LOWER\(TRIM\(pi\.metadata->>'color'\)\) = LOWER\(TRIM\(pv\.color\)\)/);
  assert.match(controller, /ORDER BY pu\.created_at DESC NULLS LAST, pi\.id DESC/);
  assert.match(controller, /NULLIF\(pi\.sale_price, 0\) AS purchase_sale_price/);
});

test("different color variants resolve their own purchase-derived prices", () => {
  const product = { selling_price: 1200 };
  const navy = { color: "Navy", purchase_selling_price: 1350, selling_price: 1200 };
  const olive = { color: "Olive", purchase_selling_price: 1500, selling_price: 1200 };

  assert.equal(resolveCurrentSellingPrice({ product, variant: navy }).value, 1350);
  assert.equal(resolveCurrentSellingPrice({ product, variant: olive }).value, 1500);
});
