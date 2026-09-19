// Picking "Grey" in the send-product sheet used to deliver every colour: the server fanned EVERY
// send out into the whole product, and the pick only named the lead sentence. The picker now
// states its scope on the card, and the expansion obeys it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { productCardSendScope } from "../server/services/aiProductColorCarouselService.js";

test("the row's quick send, and every caller that says nothing, is the whole product", () => {
  assert.equal(productCardSendScope({ product_id: 1, send_scope: "all_colors" }), "all_colors");
  assert.equal(productCardSendScope({ product_id: 1, color: "Grey" }), "all_colors");
  assert.equal(productCardSendScope({}), "all_colors");
});

test("a picked colour is that colour alone", () => {
  assert.equal(productCardSendScope({ send_scope: "color", color: "Grey" }), "color");
});

test("a picked colour and size is that pair", () => {
  assert.equal(productCardSendScope({ send_scope: "color_size", color: "Grey", size: "42" }), "color_size");
});

test("a scope with nothing to scope to falls back instead of sending an empty card", () => {
  assert.equal(productCardSendScope({ send_scope: "color" }), "all_colors");
  assert.equal(productCardSendScope({ send_scope: "color_size", color: "Grey" }), "color");
});

test("the PWA sheet states the scope on both sends", () => {
  const pwa = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");
  assert.match(pwa, /send_scope: sendScope/);
  assert.match(pwa, /handleQuickSendProduct[\s\S]{0,400}send_scope: "all_colors"/);
});
