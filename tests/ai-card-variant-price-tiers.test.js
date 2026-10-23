/*
 * The AI's product loaders must hand the card builder every price tier a variant can own.
 *
 * 2026-10-23, owner's test «عايز ايرفورس اسود ميرور»: the Black Air Force 1 card said 1,850 جنيه
 * while the shop sells it at 1,200. The colour is priced by MANUAL OVERRIDE on the variant, and both
 * loaders (brain V2's loadFullProductForPresentation, aiProductCards' WhatsApp image loader) built
 * their variant JSON without manual_selling_price / manual_price_override_active /
 * purchase_selling_price — so the canonical resolver saw a priceless variant and fell back to the
 * product row's 1,850.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeProductCards } from "../server/services/aiProductCards.js";

const variant = (id, color, extra = {}) => ({
  id, product_id: 61, color, color_name: color, size: "42", stock: 3, quantity: 3,
  price: 0, selling_price: 0, sale_price: 0, image_url: `/uploads/${color}.webp`, ...extra,
});

test("a colour priced by manual override cards at its own price, not the product row's", () => {
  const product = {
    id: 61,
    name: "Nike Air Force 1",
    price: 1850,
    selling_price: 1850,
    variants: [variant(1, "Black", { manual_selling_price: 1200, manual_price_override_active: true }), variant(2, "White")],
  };
  const cards = normalizeProductCards([product], { limit: 6 });
  assert.equal(cards.find((card) => card.color === "Black").price, 1200);
  assert.equal(cards.find((card) => card.color === "White").price, 1850, "a colour without its own price keeps the product's");
});

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

for (const [path, loader] of [
  ["server/services/aiBrainV2Service.js", "const loadFullProductForPresentation"],
  ["server/services/aiProductCards.js", "const loadFullProductForWhatsappImageRequest"],
]) {
  test(`${path}: the variant JSON carries the manual-override and purchase price tiers`, () => {
    const source = read(path);
    const body = source.slice(source.indexOf(loader), source.indexOf("AS variants", source.indexOf(loader)));
    for (const field of ["manual_selling_price", "manual_price_override_active", "purchase_selling_price"]) {
      assert.match(body, new RegExp(`'${field}', \\$\\{variantSelect\\.${field}\\}`), `${field} reaches the card builder`);
    }
  });
}
