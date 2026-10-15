import test from "node:test";
import assert from "node:assert/strict";

process.env.BUSINESS_MODE = "wholesale";
const { waNumber, wholesaleOrderButton, wholesaleUnitsLine } = await import("../../server/modules/wholesale/wholesale.telegram.js");
const { buildTelegramPostPayload, telegramCardFacts } = await import("../../server/services/telegramCatalogPublisherService.js");

test("the wholesale post has no price: units, pieces available and a WhatsApp button", () => {
  const facts = telegramCardFacts({
    card_id: "66:black",
    id: 66,
    name: "Bag",
    display_color: "Black",
    final_price: 999,
    sizes: [],
    wholesale_units: wholesaleUnitsLine({ sell_piece: true, sell_series: true, series_pieces: 6, sell_carton: true, carton_pieces: 24 }),
    wholesale_stock: 120,
  });
  const payload = buildTelegramPostPayload({ facts, settings: { wholesale_order_phone: "01012345678" }, imageUrl: "https://x/y.jpg" });
  assert.doesNotMatch(payload.caption, /999|💰/);
  assert.match(payload.caption, /24/);
  assert.match(payload.caption, /6/);
  assert.match(payload.caption, /120/);
  assert.match(payload.reply_markup.inline_keyboard[0][0].url, /^https:\/\/wa\.me\/201012345678\?text=/);

  const soldOut = buildTelegramPostPayload({ facts, settings: { sold_out_label: "SOLD" }, imageUrl: "https://x/y.jpg", soldOut: true });
  assert.match(soldOut.caption, /SOLD/);
  assert.doesNotMatch(soldOut.caption, /120/);
});

test("wa.me numbers are international without +", () => {
  assert.equal(waNumber("01012345678"), "201012345678");
  assert.equal(waNumber("+20 101 234 5678"), "201012345678");
  assert.equal(waNumber("00201012345678"), "201012345678");
  assert.equal(wholesaleOrderButton({ facts: {}, phone: "" }), null);
});
