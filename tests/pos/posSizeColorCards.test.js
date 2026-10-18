import test from "node:test";
import assert from "node:assert/strict";
import { buildPosSizeOptions, expandProductsToSizeColorCards } from "../../src/modules/pos/lib/posSizeColorCards.js";

const samba = {
  id: 7,
  product_id: 7,
  name: "Samba",
  image_url: "cover.jpg",
  variants: [
    { variant_id: 1, color: "Black", color_group_key: "a", size: "42", stock: 2, image_url: "black.jpg" },
    { variant_id: 2, color: "Black", color_group_key: "a", size: "43", stock: 1, image_url: "black.jpg" },
    { variant_id: 3, color: "White", color_group_key: "b", size: "42", stock: 0, image_url: "white.jpg" },
    { variant_id: 4, color: "White", color_group_key: "b", size: "44", stock: 3, image_url: "white.jpg" },
    { variant_id: 5, color: "Red", color_group_key: "c", size: "43", stock: 1 },
    { variant_id: 6, color: "Red", color_group_key: "c", size: "40", stock: 0, image_url: "red.jpg" },
  ],
};

test("size options are the in-stock sizes, in numeric order", () => {
  assert.deepEqual(buildPosSizeOptions([samba]).map((option) => option.id), ["42", "43", "44"]);
});

test("no picked size leaves the model cards untouched", () => {
  const products = [samba];
  assert.equal(expandProductsToSizeColorCards(products, []), products);
});

test("one card per colour that has a picked size in stock, with that colour's photo", () => {
  const cards = expandProductsToSizeColorCards([samba], ["42"]);
  assert.equal(cards.length, 1, "White 42 is out of stock, so only Black shows");
  assert.equal(cards[0].image_url, "black.jpg");
  assert.equal(cards[0].stock, 2);
  assert.equal(cards[0].product_id, 7, "favourite and edit keep acting on the model");
  assert.deepEqual(cards[0].variants.map((variant) => variant.variant_id), [1]);
});

test("several sizes: a colour carries every picked size it has, and borrows its photo from another size row", () => {
  const cards = expandProductsToSizeColorCards([samba], ["42", "43"]);
  assert.deepEqual(cards.map((card) => card.employee_card_color), ["Black", "Red"]);
  assert.deepEqual(cards[0].employee_card_sizes, ["42", "43"]);
  assert.equal(cards[1].image_url, "red.jpg");
  assert.notEqual(cards[0].pos_card_key, cards[1].pos_card_key);
});
