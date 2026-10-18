import test from "node:test";
import assert from "node:assert/strict";
import { buildSizeColorCards, pickerSizeOptions, withPickedSizes } from "../src/modules/aiSupport/lib/sizeColorCards.js";

const samba = {
  id: 7,
  name: "Samba",
  image_url: "cover.jpg",
  variants: [
    { id: 1, color: "Black", size: "42", stock: 2, image_url: "black.jpg" },
    { id: 2, color: "Black", size: "43", stock: 1, image_url: "black.jpg" },
    { id: 3, color: "White", size: "42", stock: 0, image_url: "white.jpg" },
    { id: 4, color: "White", size: "44", stock: 3, image_url: "white.jpg" },
    { id: 5, color: "Red", size: "43", stock_quantity: 1 },
    { id: 6, color: "Red", size: "40", stock: 0, image_url: "red.jpg" },
  ],
};

test("the size list is the in-stock sizes of the products in view, in numeric order", () => {
  assert.deepEqual(pickerSizeOptions([samba]), ["42", "43", "44"]);
});

test("one card per colour that has a picked size in stock; a sold-out colour does not show", () => {
  const cards = buildSizeColorCards([samba], ["42"]);
  assert.deepEqual(cards.map((card) => card.color), ["Black"]);
  assert.equal(cards[0].image, "black.jpg");
  assert.deepEqual(cards[0].sizes, ["42"]);
});

test("several sizes: each colour carries the picked sizes it has, and borrows its photo from another row", () => {
  const cards = buildSizeColorCards([samba], ["43", "42"]);
  assert.deepEqual(cards.map((card) => [card.color, card.sizes]), [["Black", ["42", "43"]], ["Red", ["43"]]]);
  assert.equal(cards[1].image, "red.jpg");
});

test("one size goes out as colour + size, so ordering from the card already has the size", () => {
  const card = withPickedSizes({ product_id: 7, variant_id: 1, color: "Black" }, ["42"]);
  assert.equal(card.send_scope, "color_size");
  assert.equal(card.selected_size, "42");
  assert.equal(card.variant_id, 1);
});

test("several sizes go out as the colour, listing only the sizes asked about", () => {
  const card = withPickedSizes({ product_id: 7, variant_id: 1, color: "Black", size: "42" }, ["42", "43"]);
  assert.equal(card.send_scope, "color");
  assert.deepEqual(card.picked_sizes, ["42", "43"]);
  assert.deepEqual(card.available_sizes, ["42", "43"]);
  assert.equal(card.size, "");
  assert.equal(card.variant_id, null, "no single variant: the customer still chooses between the sizes");
});
