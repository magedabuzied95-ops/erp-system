// The AI Center preview builds the post's first comment on the client. A queue row keeps
// its catalogue facts in design_json and ships no variants array, which used to leave the
// comment with no price and an invented "sold out" line.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildSuggestedFirstComment,
  collectFirstCommentAvailability,
} from "../../src/modules/marketing/lib/suggestedFirstComment.js";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

// Shape of what PostEditorModal hands the builder for an AI Center feed post.
const queuePost = (overrides = {}) => ({
  product_id: 933,
  variant_id: 8177,
  title: "Nike Air Jordan 1 Low Sneakers",
  color: "Black & Black",
  size: "42",
  size_name: "42",
  color_name: "Black & Black",
  price: 650,
  stock: 3,
  variants: [],
  product_url: "https://m1store-egy.com/shop/product/nike-air-jordan-1-low-sneakers",
  ...overrides,
});

test("a queue post prices itself and reports the stock it actually has", () => {
  const comment = buildSuggestedFirstComment(queuePost());
  assert.match(comment, /💰 السعر: 650 ج\.م/);
  assert.match(comment, /📏 المقاسات: 42/);
  assert.match(comment, /🎨 اللون: أسود/);
  assert.match(comment, /⚠️ الحالة: الكمية محدودة\./);
  assert.doesNotMatch(comment, /غير متوفر/);
});

test("a sold-out variant still says so", () => {
  const comment = buildSuggestedFirstComment(queuePost({ stock: 0 }));
  assert.match(comment, /❌ الحالة: غير متوفر حالياً\./);
});

test("unknown stock leaves the availability line out instead of inventing a sell-out", () => {
  const { stock_known: stockKnown } = collectFirstCommentAvailability({ size: "42" });
  assert.equal(stockKnown, false);
  const comment = buildSuggestedFirstComment(queuePost({ stock: undefined }));
  assert.doesNotMatch(comment, /الحالة:/);
  assert.match(comment, /💰 السعر: 650 ج\.م/);
});

test("a catalogue product still reads its sizes, colours and stock off the variants", () => {
  const availability = collectFirstCommentAvailability({
    stock_quantity: 0,
    variants: [
      { id: 1, size: "41", color: "White", stock: 4 },
      { id: 2, size: "42", color: "White", stock: 6 },
      { id: 3, size: "43", color: "Black", stock: 0 },
    ],
  });
  assert.deepEqual(availability.sizes, ["41", "42"]);
  assert.deepEqual(availability.colors, ["أبيض"]);
  assert.equal(availability.stock, 10);
  assert.equal(availability.stock_known, true);
});

test("prices keep latin digits whatever locale the browser reports", () => {
  const comment = buildSuggestedFirstComment(queuePost({ price: 2100 }));
  assert.match(comment, /2,100 ج\.م/);
  assert.doesNotMatch(comment, /[٠-٩]/);
});

test("the post editor grounds the comment in the price and live stock it is already showing", async () => {
  const editor = await read("src/modules/marketing/components/PostEditorModal.jsx");
  assert.ok(editor.includes("parseStorefrontPriceValue(resolveMarketingEditorPrice("));
  assert.match(editor, /firstFiniteNumber\(post\.current_variant_stock, design\.stock, post\.stock\)/);
  assert.match(editor, /firstCommentProduct\.stock = queueStock/);
});

test("the queue list ships the live variant stock the comment grounds itself on", async () => {
  const service = await read("server/services/aiMarketingCenterService.js");
  assert.match(service, /pv\.stock AS current_variant_stock/);
});
