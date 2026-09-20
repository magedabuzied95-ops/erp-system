import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/*
 * THE CARD IN THE INBOX IS THE CARD ON THE PHONE.
 *
 * Side by side, Instagram showed the customer:
 *
 *   Alexander Mcqueen Sneakers — أبيض — 1100 جنيه
 *   المقاسات: 37 | 41 | 42 | 45
 *   [ ✅ اطلب اللون ده ]
 *   [ عرض المنتج ]
 *
 * and the inbox showed the operator "Alexander Mcqueen Sneakers" over a single "عرض المنتج".
 * Three separate things threw the copy away, and these tests hold all three.
 */

const META = fs.readFileSync("server/services/metaIntegrationService.js", "utf8");
const CARD = fs.readFileSync("src/modules/aiSupport/components/ProductCardMessage.jsx", "utf8");

const readBack = META.slice(
  META.indexOf("const templateElementToProductCard"),
  META.indexOf("export const metaTemplateProductCards")
);

// A title is "<name> — <price> جنيه" from buildMetaCarouselElement but "<name> — <colour> —
// <price> جنيه" from the comment automation. Calling the SECOND chunk the price read "أبيض" as
// the price, so price came out null and the colour vanished.
test("a three-part title does not mistake the colour for the price", () => {
  assert.ok(readBack.includes(`const chunks = title.split(" — ")`));
  assert.ok(readBack.includes(`/\\d/.test(chunk)`), "the price is the chunk that carries digits");
  assert.ok(!readBack.includes("const [namePart, pricePart = \"\"] = title.split"), "the positional split is gone");
  assert.ok(readBack.includes("color: colorPart"), "what is left of the title is the colour");
});

// buildMetaCarouselElement sends "choose_color:<id>"; the comment automation sends
// "SOCIAL_COLOR_SELECT::{json}". Recognising only the first turned two buttons into one.
test("both colour-postback shapes are recognised", () => {
  // Match the code, not the comment above it: a prose mention is not a branch.
  assert.match(readBack, /postback\.match\(\/\^choose_color:\(\\d\+\)\$\//, "the metaIntegration shape");
  assert.match(readBack, /postback\.startsWith\("SOCIAL_COLOR_SELECT::"\)/, "the comment-automation shape");
});

// The element Meta drew must survive the round trip whole, or the inbox is rebuilding the
// customer's copy from parts and will drift from it again.
test("the element is carried back verbatim, not just parsed", () => {
  for (const field of ["template_title", "template_subtitle", "template_buttons"]) {
    assert.ok(readBack.includes(`${field}:`), `the card must carry ${field}`);
  }
  assert.match(readBack, /template_buttons:\s*buttons\s*\.map\(\(button\) => \(\{/, "every button is kept, not only the first");
});

test("the inbox renders the sent element before it rebuilds anything", () => {
  const copy = CARD.slice(CARD.indexOf("const metaTemplateCopy"), CARD.indexOf("const whatsappCarouselCopy"));
  const verbatimAt = copy.indexOf("if (templateTitle || templateButtons.length) {");
  const rebuildAt = copy.indexOf("const priceValue = Number(card.price");
  assert.ok(verbatimAt > -1, "there must be a verbatim path");
  assert.ok(rebuildAt > verbatimAt, "the reconstruction is the fallback, not the default");
  assert.ok(copy.includes("clean(card.template_subtitle || card.subtitle)"));
});

// An old row stored before the element was carried back still has the subtitle Meta sent. Ignoring
// it and rebuilding from card.sizes -- which an echo-derived card does not have -- is why the sizes
// line was missing entirely.
test("a stored subtitle beats a rebuilt one", () => {
  const copy = CARD.slice(CARD.indexOf("const metaTemplateCopy"), CARD.indexOf("const whatsappCarouselCopy"));
  assert.ok(copy.includes("const subtitle = clean(card.subtitle) || (selectedSize"));
});

// Messenger stacks every button on the card. Rendering only one is the difference the owner saw.
test("every button on the card is drawn", () => {
  const block = CARD.slice(CARD.indexOf("if (mirrorsMetaTemplate) {"), CARD.indexOf("if (standalone) {"));
  assert.ok(block.includes("asArray(copy.buttons).map("), "the card draws all its buttons");
  assert.ok(!/\{copy\.button\}/.test(block), "the single-button render is gone");
  // A postback has nowhere to go: it is the customer's tap, not ours.
  assert.ok(block.includes("button.url ? ("), "a postback must not render as a link");
});

test("the fallback can still justify both buttons", () => {
  const copy = CARD.slice(CARD.indexOf("const metaTemplateCopy"), CARD.indexOf("const whatsappCarouselCopy"));
  assert.ok(copy.includes("card.color_select_payload"), "an automation card knows it can order a colour");
  assert.ok(copy.includes(`title: "✅ اطلب اللون ده"`));
  assert.ok(copy.includes(`title: "عرض المنتج"`));
});
