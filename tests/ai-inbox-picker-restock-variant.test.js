import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { resolveSelectedCards, resolveSubmitBatch } from "../src/modules/aiSupport/lib/pickerSelection.js";

// The restock form ("طلبات التوفر") in the customer drawer received lines with no
// variant_id, colour or size: it drew them as "اختر اللون والمقاس" and its confirm
// button stayed disabled — and the lines that did reach the server named the
// product's first variant, which is usually still in stock, so the server answered
// "available now" and recorded nothing. Two causes, both guarded here.

const picker = fs.readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");

const CARD = { product_id: 7, variant_id: 91, color: "أسود", size: "42" };
const RAW_ROW = { id: 7, name: "Nike Air Jordan 1 Low", variants: [{ id: 91, color: "أسود", size: "42" }] };
const toCard = (product) => ({ product_id: product.id, variant_id: product.variants[0].id, color: product.variants[0].color, size: product.variants[0].size });

// ---- cause 1: the confirm button submitted the raw catalogue row ---------

test("nothing ticked submits the card open in the chooser, not the raw catalogue row", () => {
  const batch = resolveSubmitBatch({ allowMultiple: true, selectedCards: [], activeCard: CARD });
  assert.deepEqual(batch, [CARD]);
  assert.equal(batch[0].variant_id, 91);
  assert.equal(batch[0].size, "42");
});

test("nothing ticked and nothing open submits nothing", () => {
  assert.deepEqual(resolveSubmitBatch({ allowMultiple: true, selectedCards: [], activeCard: null }), []);
});

test("ticked cards win over the open card", () => {
  const ticked = [CARD, { product_id: 8, variant_id: 12, color: "أبيض", size: "43" }];
  assert.deepEqual(resolveSubmitBatch({ allowMultiple: true, selectedCards: ticked, activeCard: { product_id: 99 } }), ticked);
});

test("an un-ticked selection is empty, so the count badge never claims a selection", () => {
  assert.deepEqual(resolveSelectedCards({ allowMultiple: true, selectedProductIds: [], selectedCardsById: {} }), []);
  assert.deepEqual(resolveSelectedCards({ allowMultiple: false, selectedProductIds: ["7"], selectedCardsById: { 7: CARD } }), []);
});

test("every resolved selection carries a variant — a lost snapshot rebuilds a card, never a raw row", () => {
  const resolved = resolveSelectedCards({
    allowMultiple: true,
    selectedProductIds: ["7"],
    selectedCardsById: {},
    findProduct: () => RAW_ROW,
    toCard,
  });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].variant_id, 91, "a raw catalogue row has no variant_id — the restock form cannot submit it");
  assert.equal(resolved[0].color, "أسود");
  assert.ok(!("variants" in resolved[0]), "a raw catalogue row leaked through");
});

test("the ticked snapshot is preferred, so the colour/size the operator chose survives", () => {
  const chosen = { product_id: 7, variant_id: 93, color: "أحمر", size: "44" };
  const resolved = resolveSelectedCards({
    allowMultiple: true,
    selectedProductIds: ["7"],
    selectedCardsById: { 7: chosen },
    findProduct: () => RAW_ROW,
    toCard,
  });
  assert.deepEqual(resolved, [chosen]);
});

// ---- cause 2: tapping a ticked product removed it instead of re-opening it ----
// With one button per tile there was no way back into a product once a second one
// was ticked, so every line but the active one kept its first variant.

test("the product tile opens the product; only the checkbox adds or removes it", () => {
  assert.match(picker, /onClick=\{\(\) => openProductForPreview\(product\)\}/, "the tile must open the product, not toggle it");
  assert.match(
    picker,
    /aria-label=\{isSelected \? t\("aiSupport\.inbox\.picker\.removeFromSelection"\)[\s\S]{0,400}?onClick=\{\(\) => toggleProductSelection\(product\)\}|onClick=\{\(\) => toggleProductSelection\(product\)\}[\s\S]{0,400}?aria-label=\{isSelected \? t\("aiSupport\.inbox\.picker\.removeFromSelection"\)/,
    "the checkbox must be its own control that toggles the selection"
  );
});

test("re-opening a ticked product restores the colour and size it was ticked with", () => {
  const handler = picker.slice(picker.indexOf("const openProductForPreview"), picker.indexOf("const toggleSizeCardSelection"));
  assert.match(handler, /const stored = selectedCardsById\[productId\]/);
  assert.match(handler, /setSelectedColor\(clean\(stored\.color\)\)/);
  assert.match(handler, /setSelectedSize\(clean\(stored\.size\)\)/);
  assert.match(handler, /setPreviewCollapsed\(false\)/, "on the phone the chooser is collapsed — a tap must open it");
});

test("the desktop picker's light theme still reaches the wrapped tile", () => {
  const css = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxDesktop.css", import.meta.url), "utf8");
  assert.match(picker, /className=\{`ai-picker-tile flex w-full/, "the tile needs the class the desktop stylesheet hangs off");
  assert.match(css, /> div > \.ai-picker-tile \{/, "wrapping the tile in a div took it out of the '> button' rule");
});
