import test from "node:test";
import assert from "node:assert/strict";

import { expandProductsToColorCards } from "../server/controllers/storefrontController.js";

const variant = (overrides = {}) => ({ id: 1, size: "42", stock: 1, ...overrides });

test("two colours sharing a name each get their own shop card", () => {
  // Crocs 733 in production: two different shoes, both entered as "Grey".
  const keyA = "f22d94ad-d223-4432-9af3-a7571f12551b";
  const keyB = "0bc71c9e-0c0a-4579-9bf6-b01c5d6789ae";
  const [product] = [{
    id: 733,
    name: "Crocs",
    color_images: [
      { color: "Grey", color_group_key: keyA, images: [{ image_url: "grey-a.jpg", is_primary: true }] },
      { color: "Grey", color_group_key: keyB, images: [{ image_url: "grey-b.jpg", is_primary: true }] },
    ],
    variants: [
      variant({ id: 9001, color: "Grey", color_group_key: keyA, size: "41/42", image_url: "grey-a.jpg" }),
      variant({ id: 9002, color: "Grey", color_group_key: keyB, size: "43/44", image_url: "grey-b.jpg" }),
    ],
  }];

  const cards = expandProductsToColorCards([product]);

  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.display_color_key), [keyA, keyB]);
  assert.deepEqual(cards.map((card) => card.card_id), [`733:${keyA}`, `733:${keyB}`]);
  assert.deepEqual(cards.map((card) => card.image_url), ["grey-a.jpg", "grey-b.jpg"]);
  assert.deepEqual(cards.map((card) => card.sizes), [["41/42"], ["43/44"]]);
  assert.deepEqual(cards.map((card) => card.variants.length), [1, 1]);
});

test("a card never carries a same-named colour's photo", () => {
  const cards = expandProductsToColorCards([{
    id: 733,
    name: "Crocs",
    color_images: [
      { color: "Navy", color_group_key: "navy-a", images: [{ image_url: "navy-a.jpg", is_primary: true }] },
      { color: "Navy", color_group_key: "navy-b", images: [{ image_url: "navy-b.jpg", is_primary: true }] },
    ],
    variants: [
      variant({ id: 1, color: "Navy", color_group_key: "navy-a", images: [{ image_url: "navy-a.jpg", is_primary: true }] }),
      variant({ id: 2, color: "Navy", color_group_key: "navy-b", images: [{ image_url: "navy-b.jpg", is_primary: true }] }),
    ],
  }]);

  assert.deepEqual(cards.map((card) => card.images.map((image) => image.image_url)), [["navy-a.jpg"], ["navy-b.jpg"]]);
});

test("legacy variants without a colour key still group by name", () => {
  const cards = expandProductsToColorCards([{
    id: 12,
    name: "Legacy",
    color_images: [{ color: "White & Navy", images: [{ image_url: "wn.jpg", is_primary: true }] }],
    variants: [
      variant({ id: 1, color: "White & Navy", size: "41" }),
      variant({ id: 2, color: "White & Navy", size: "42" }),
    ],
  }]);

  assert.equal(cards.length, 1);
  assert.equal(cards[0].display_color_key, "white-navy");
  assert.deepEqual(cards[0].sizes, ["41", "42"]);
  assert.equal(cards[0].image_url, "wn.jpg");
});

test("a keyed colour never adopts a keyless legacy record that only shares its name", () => {
  const cards = expandProductsToColorCards([{
    id: 13,
    name: "Mixed",
    color_images: [
      { color: "Grey", images: [{ image_url: "keyless-grey.jpg", is_primary: true }] },
      { color: "Grey", color_group_key: "keyed-grey", images: [{ image_url: "keyed-grey.jpg", is_primary: true }] },
    ],
    variants: [variant({ id: 1, color: "Grey", color_group_key: "keyed-grey" })],
  }]);

  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0].images.map((image) => image.image_url), ["keyed-grey.jpg"]);
});

test("out-of-stock colours stay off the grid", () => {
  const cards = expandProductsToColorCards([{
    id: 14,
    name: "Partly sold",
    variants: [
      variant({ id: 1, color: "Grey", color_group_key: "a", stock: 0, image_url: "a.jpg" }),
      variant({ id: 2, color: "Grey", color_group_key: "b", stock: 3, image_url: "b.jpg" }),
    ],
  }]);

  assert.deepEqual(cards.map((card) => card.display_color_key), ["b"]);
});
