import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProductCards } from "../server/services/aiProductCards.js";
import { buildSocialCommentColorCards } from "../server/services/socialCommentPrivateReplyService.js";
import { buildSocialCommentMessengerCarouselPayload } from "../server/services/marketingCommentAutomationService.js";

// The owner's screenshot, 2026-09-08: an Air Force whose colours are priced 1200 / 850 / 1200 in
// the system went out on Messenger as a colour carousel with "1,850 جنيه" on EVERY card. 1850 is
// the products row's own legacy `price` column, and `resolveCardPrice` reads the product's loose
// price fields BEFORE any variant field — so one number was stamped on every colour.
//
// The rule these tests pin: a card that names ONE colour prices THAT colour, resolved by the
// canonical authority (variant beats product), and only falls back to the product's price when the
// colour owns none.
const product = {
  id: 764,
  name: "Nike Air Force 1",
  slug: "nike-air-force-1",
  product_url: "https://m1store-egy.com/shop/product/764",
  storefront_url: "https://m1store-egy.com/shop/product/764",
  price: 1850,
  selling_price: 1850,
  variants: [
    // Priced the ordinary way.
    { id: 11, color: "White", size: "41", stock: 4, selling_price: 1200, image_url: "https://cdn.example.com/white.jpg" },
    { id: 12, color: "White", size: "42", stock: 2, selling_price: 1200, image_url: "https://cdn.example.com/white.jpg" },
    // Priced ONLY through the purchase invoice — the column a hand-rolled COALESCE never reaches.
    { id: 13, color: "White High quality", size: "39", stock: 3, purchase_selling_price: 850, image_url: "https://cdn.example.com/white-hq.jpg" },
    // Priced by a manual override on the variant.
    { id: 14, color: "Black", size: "38", stock: 5, manual_price_override_active: true, manual_selling_price: 1200, image_url: "https://cdn.example.com/black.jpg" },
  ],
};

const priceByColor = (cards = []) =>
  Object.fromEntries(cards.map((card) => [card.color, card.price]));

test("each colour card carries ITS OWN price, never the product row's single price", () => {
  const cards = normalizeProductCards([product], { limit: 30 });

  assert.equal(cards.length, 3, "one card per in-stock colour");
  assert.deepEqual(priceByColor(cards), {
    White: 1200,
    "White High quality": 850,
    Black: 1200,
  });
  // The exact symptom: nothing may print the product's 1850 on a colour that is not priced 1850.
  assert.equal(cards.some((card) => card.price === 1850), false);
  assert.equal(cards.find((card) => card.color === "White High quality").price_text, "850 جنيه");
});

test("a colour whose sizes are priced unevenly is represented by a variant that owns a price", () => {
  // The first (lowest-id, highest-stock) row of the colour carries NO price of its own. Electing it
  // as the colour's representative is how a priced colour fell back to the product's price.
  const cards = normalizeProductCards(
    [
      {
        ...product,
        variants: [
          { id: 21, color: "Olive", size: "44", stock: 9, image_url: "https://cdn.example.com/olive.jpg" },
          { id: 22, color: "Olive", size: "45", stock: 1, purchase_selling_price: 1350, image_url: "https://cdn.example.com/olive.jpg" },
          { id: 23, color: "Black", size: "38", stock: 5, selling_price: 1200, image_url: "https://cdn.example.com/black.jpg" },
        ],
      },
    ],
    { limit: 30 }
  );

  assert.deepEqual(priceByColor(cards), { Olive: 1350, Black: 1200 });
});

test("a colour with no price of its own still falls back to the product's price", () => {
  const cards = normalizeProductCards(
    [
      {
        ...product,
        variants: [
          { id: 31, color: "White", size: "41", stock: 4, selling_price: 1200, image_url: "https://cdn.example.com/white.jpg" },
          { id: 32, color: "Black", size: "38", stock: 5, image_url: "https://cdn.example.com/black.jpg" },
        ],
      },
    ],
    { limit: 30 }
  );

  assert.deepEqual(priceByColor(cards), { White: 1200, Black: 1850 });
});

test("Sale Mode is still the global gate — a dormant variant sale price is never quoted", () => {
  const onSale = {
    ...product,
    variants: [
      { id: 41, color: "White", size: "41", stock: 4, selling_price: 1200, sale_price: 999, sale_price_enabled: true, image_url: "https://cdn.example.com/white.jpg" },
      { id: 42, color: "Black", size: "38", stock: 5, selling_price: 1400, image_url: "https://cdn.example.com/black.jpg" },
    ],
  };

  const saleOff = normalizeProductCards([onSale], { limit: 30, saleModeSettings: { sale_mode_enabled: false } });
  assert.deepEqual(priceByColor(saleOff), { White: 1200, Black: 1400 });

  const saleOn = normalizeProductCards([onSale], { limit: 30, saleModeSettings: { sale_mode_enabled: true } });
  assert.deepEqual(priceByColor(saleOn), { White: 999, Black: 1400 });
});

// ── The comment → DM carousel (Messenger + the single Instagram private reply) ────────────────
const colorRow = ({ color, image, variants = [] }) => ({
  color_key: color.toLowerCase(),
  color_label: color,
  color_sort_order: 0,
  gallery_image_url: "",
  variant_image_url: image,
  price_variants: variants,
});

test("the DM colour cards split a price the colours really disagree on", () => {
  const cards = buildSocialCommentColorCards({
    variantRows: [
      { color: "White", size: "41", stock: 3 },
      { color: "Black", size: "38", stock: 3 },
    ],
    colorRows: [
      colorRow({ color: "White", image: "https://cdn.example.com/white.jpg", variants: [{ id: 11, selling_price: 1200 }] }),
      colorRow({ color: "Black", image: "https://cdn.example.com/black.jpg", variants: [{ id: 13, purchase_selling_price: 850 }] }),
    ],
    productName: "Nike Air Force 1",
    productLink: "https://m1store-egy.com/shop/product/764",
  });

  assert.deepEqual(cards.map((card) => card.priceText), ["1200", "850"]);

  const payload = buildSocialCommentMessengerCarouselPayload({
    commentId: "c1",
    colorCards: cards,
    productName: "Nike Air Force 1",
    productPrice: "1850",
  });
  const titles = payload.message.attachment.payload.elements.map((element) => element.title);
  assert.equal(titles.some((title) => title.includes("1850")), false, "the product price never overwrites a colour that is priced differently");
  assert.equal(titles[0].includes("1200 جنيه"), true);
  assert.equal(titles[1].includes("850 جنيه"), true);
});

test("colours that share one price keep the product-level price — nothing moves", () => {
  const cards = buildSocialCommentColorCards({
    variantRows: [
      { color: "White", size: "41", stock: 3 },
      { color: "Black", size: "38", stock: 3 },
    ],
    colorRows: [
      colorRow({ color: "White", image: "https://cdn.example.com/white.jpg", variants: [{ id: 11, selling_price: 1200 }] }),
      colorRow({ color: "Black", image: "https://cdn.example.com/black.jpg", variants: [{ id: 13, selling_price: 1200 }] }),
    ],
    productName: "Nike Air Force 1",
    productLink: "https://m1store-egy.com/shop/product/764",
  });

  assert.deepEqual(cards.map((card) => card.priceText), ["", ""]);

  const payload = buildSocialCommentMessengerCarouselPayload({
    commentId: "c1",
    colorCards: cards,
    productName: "Nike Air Force 1",
    productPrice: "1200",
  });
  for (const element of payload.message.attachment.payload.elements) {
    assert.equal(element.title.includes("1200 جنيه"), true);
  }
});
