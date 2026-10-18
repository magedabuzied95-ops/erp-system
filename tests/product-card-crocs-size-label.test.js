import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeProductCards,
  productCardReplyText,
  productCardSizeLabel,
  productCardSizeLabels,
} from "../server/services/aiProductCards.js";

// Crocs are stocked under the factory marking (M6/W8) but the site prints the EU pair (38/39).
// A card sent to a customer must print what the site prints.

test("a Crocs size prints as the EU pair the site shows; other products keep their size", () => {
  assert.equal(productCardSizeLabel({ size_display: "crocs_eu" }, "M6/W8"), "38/39");
  assert.equal(productCardSizeLabel({ product_type: "Crocs" }, "C10"), "27/28");
  assert.equal(productCardSizeLabel({ product_type: "Sneakers" }, "42"), "42");
});

test("two markings that print the same EU pair are listed once", () => {
  assert.deepEqual(productCardSizeLabels({ size_display: "crocs_eu" }, ["J3", "M3/W5", "M6/W8"]), ["34/35", "38/39"]);
});

test("the card remembers it is a Crocs card, so a re-normalised flat card still prints EU", () => {
  const [card] = normalizeProductCards([
    {
      id: 9,
      name: "Crocband",
      product_type: "Crocs",
      price: 300,
      image_url: "https://example.test/a.jpg",
      variants: [{ id: 1, color: "Black", size: "M6/W8", stock: 2, price: 300, image_url: "https://example.test/a.jpg" }],
    },
  ]);
  assert.equal(card.size_display, "crocs_eu");
  const { variants, variant, ...flat } = card;
  const [again] = normalizeProductCards([{ ...flat, send_scope: "color_size", selected_size: "M6/W8" }]);
  assert.equal(again.size_display, "crocs_eu");
  assert.match(productCardReplyText({ ...again, send_scope: "color_size", selected_size: "M6/W8" }), /المقاس: 38\/39/);
});

test("the WhatsApp carousel and the Messenger/Instagram card both print through the label", () => {
  const adapter = readFileSync(new URL("../server/services/aiChannelAdapterService.js", import.meta.url), "utf8");
  assert.match(adapter, /`المقاس: \$\{productCardSizeLabel\(product, pickedSize\)\}`/);
  const meta = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
  assert.match(meta, /`المقاس: \$\{productCardSizeLabel\(product, selectedSize\)\}`/);
});
