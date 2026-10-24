import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { countShippingPieces, extraPiecesShippingFee } from "../shared/shippingExtraPieces.js";
import { buildShippingFeeReply } from "../server/services/aiStoreFactsReplyService.js";

// Owner rule (2026-10-24): the zone price is for one piece, +10 for the second, +10 more for the
// third, and nothing further after that.
const rule = { perPiece: 10, maxExtraPieces: 2 };

test("one piece pays the zone price, two +10, three and more +20", () => {
  assert.equal(extraPiecesShippingFee({ basePrice: 70, pieces: 1, ...rule }), 0);
  assert.equal(extraPiecesShippingFee({ basePrice: 70, pieces: 2, ...rule }), 10);
  assert.equal(extraPiecesShippingFee({ basePrice: 70, pieces: 3, ...rule }), 20);
  assert.equal(extraPiecesShippingFee({ basePrice: 70, pieces: 7, ...rule }), 20);
});

test("a cap of 0 means every extra piece pays", () => {
  assert.equal(extraPiecesShippingFee({ basePrice: 70, pieces: 5, perPiece: 10, maxExtraPieces: 0 }), 40);
});

test("a free zone or a zero fee adds nothing", () => {
  assert.equal(extraPiecesShippingFee({ basePrice: 0, pieces: 3, ...rule }), 0);
  assert.equal(extraPiecesShippingFee({ basePrice: 70, pieces: 3, perPiece: 0, maxExtraPieces: 2 }), 0);
});

test("pieces are counted by quantity, not by lines", () => {
  assert.equal(countShippingPieces([{ quantity: 2 }, { quantity: 1 }]), 3);
  assert.equal(countShippingPieces([{ qty: 3 }]), 3);
  assert.equal(countShippingPieces([{}]), 1);
  assert.equal(countShippingPieces([]), 0);
});

// Owner (2026-10-25): the AI answers "how much is shipping?" with the one-piece price only and
// never explains the per-piece surcharge; the order total still carries it.
test("the AI's shipping answer is the price alone, no per-piece talk", () => {
  const reply = buildShippingFeeReply({ fee: { nameAr: "القاهرة", price: 70, min: null, max: null, threshold: 0, eta: "" } });
  assert.equal(reply, "الشحن للقاهرة 70 جنيه 🚚");
  for (const path of ["server/services/aiStoreFactsReplyService.js", "server/services/aiToolRegistryService.js", "server/services/aiBusinessToolsService.js"]) {
    assert.doesNotMatch(fs.readFileSync(path, "utf8"), /extra_piece|extraPiece/, `${path} must not hand the AI the per-piece rule`);
  }
});

test("every surface that prices an order sends its piece count", () => {
  const read = (path) => fs.readFileSync(path, "utf8");
  assert.match(read("server/controllers/storefrontController.js"), /quantity: countShippingPieces\(normalizedItems\)/);
  assert.match(read("server/controllers/storefrontController.js"), /quantity: req\.query\?\.quantity/);
  assert.match(read("server/services/aiAgentOrderService.js"), /quantity: Math\.max\(1, integer\(payload\.piece_count, 1\)\)/);
  assert.match(read("server/services/aiAgentOrderService.js"), /piece_count: countShippingPieces\(items\)/);
  assert.match(read("server/services/aiAgentOrderService.js"), /piece_count: safeQuantity/);
  assert.match(read("server/modules/shipping/shipping.portal.create.js"), /piece_count: countShippingPieces\(priced\)/);
  assert.match(read("server/routes/aiAgentOrders.js"), /piece_count: req\.query\?\.piece_count/);
  assert.match(read("src/storefront/Storefront.jsx"), /quantity: String\(shippingPieces\)/);
  assert.match(read("src/modules/pos/components/PosOnlineOrderModal.jsx"), /quantity: String\(shippingPieces\)/);
  assert.match(read("src/modules/aiSupport/components/InboxOrderComposer.jsx"), /piece_count: String\(pieceCount\)/);
});
