import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { resolveCardSendScope } from "../src/modules/aiSupport/lib/pickerSelection.js";

// The ERP picker sent a colour+size card with no send_scope, so the server expanded it into
// EVERY colour of the product: the seller picked White/40 on the laptop and the customer got
// the whole model. The phone already sent the scope. These pin the two surfaces together.
//
// The trap this rule exists for: the desktop chooser PRE-SELECTS the first colour and the first
// size the moment a product is opened, so reading the scope off the card would make every send
// a colour+size send and no product would ever leave as a colour carousel again.

const CARD = { product_id: 788, color: "White", size: "40" };

test("a size click sends that colour in that size", () => {
  assert.equal(resolveCardSendScope({ card: CARD, pickedScope: "color_size" }), "color_size");
});

test("a colour click sends that colour with its sizes", () => {
  assert.equal(resolveCardSendScope({ card: CARD, pickedScope: "color" }), "color");
});

test("a pre-filled colour and size that nobody clicked still sends the whole product", () => {
  assert.equal(resolveCardSendScope({ card: CARD, pickedScope: "" }), "all_colors");
});

test("a size scope with no size on the card falls back to the colour", () => {
  assert.equal(resolveCardSendScope({ card: { ...CARD, size: "" }, pickedScope: "color_size" }), "color");
});

test("no colour on the card can only be the whole product", () => {
  assert.equal(resolveCardSendScope({ card: { product_id: 788 }, pickedScope: "color_size" }), "all_colors");
  assert.equal(resolveCardSendScope({}), "all_colors");
});

// The scope is only worth sending if the server honours these exact three words, and if the
// picker actually stamps it on the batch it submits.
test("the three scopes are the ones the server reads", () => {
  const service = fs.readFileSync(new URL("../server/services/aiProductColorCarouselService.js", import.meta.url), "utf8");
  assert.match(service, /\["color", "color_size"\]\.includes\(scope\)/);
  assert.match(service, /return "all_colors"/);
});

test("the picker stamps the scope on every card it submits", () => {
  const picker = fs.readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
  assert.match(picker, /resolveSubmitBatch\(\{[^}]*\}\)\.map\(withSendScope\)/);
  assert.match(picker, /send_scope: resolveCardSendScope\(/);
});

// The caption is the other half: a picked size must read as a size, not as what is in stock.
test("a colour+size card captions the size, not the available list", async () => {
  const { productCardReplyText } = await import("../server/services/aiProductCards.js");
  const picked = productCardReplyText({
    name: "Dior - White",
    color: "White",
    price: 750,
    size: "40",
    selected_size: "40",
    available_sizes: ["40"],
    send_scope: "color_size",
  });
  assert.match(picked, /المقاس: 40/);
  assert.doesNotMatch(picked, /المتاح: 40/);

  const wholeColour = productCardReplyText({
    name: "Dior - White",
    color: "White",
    price: 750,
    available_sizes: ["40", "41", "42"],
    send_scope: "color",
  });
  assert.match(wholeColour, /المتاح: 40، 41، 42/);
});
