import test from "node:test";
import assert from "node:assert/strict";

import {
  SOCIAL_COMMENT_AUTOMATION_SUPPORTED_PLATFORMS,
  buildSalesPriceLabel,
  firstUsablePriceText,
  usablePriceText,
} from "../server/services/socialCommentAutomationService.js";

test("a zero price is not usable, however it is spelled", () => {
  // Postgres numeric arrives as a non-empty string, which is what let it through before.
  assert.equal(usablePriceText("0.00"), "");
  assert.equal(usablePriceText("0"), "");
  assert.equal(usablePriceText(0), "");
  assert.equal(usablePriceText("0.000"), "");
  assert.equal(usablePriceText(""), "");
  assert.equal(usablePriceText(null), "");
  assert.equal(usablePriceText(undefined), "");
});

test("a real price survives untouched", () => {
  assert.equal(usablePriceText("1300"), "1300");
  assert.equal(usablePriceText("1250.50"), "1250.50");
  assert.equal(usablePriceText(1850), "1850");
});

test("a non-numeric price label is kept rather than dropped", () => {
  assert.equal(usablePriceText("السعر عند الطلب"), "السعر عند الطلب");
});

test("the first usable price wins over an earlier zero", () => {
  assert.equal(firstUsablePriceText("0.00", "1300"), "1300");
  assert.equal(firstUsablePriceText("0.00", "0", "", "1250"), "1250");
  assert.equal(firstUsablePriceText("0.00", "0"), "");
});

test("the sales price label skips a zero price instead of quoting it", () => {
  // The bug: product 693 had price 0.00 on the linked snapshot and a real sale price,
  // and the customer was told "السعر: 0.00".
  assert.equal(
    buildSalesPriceLabel({ price: "0.00", final_price: "1250", sale_price: "1250", selling_price: "1300" }),
    "1250"
  );
  // Nothing usable at all means no price line, not a zero one.
  assert.equal(buildSalesPriceLabel({ price: "0.00", final_price: "0.00" }), "");
  assert.equal(buildSalesPriceLabel({}), "");
});

test("instagram is a supported automation platform alongside facebook", () => {
  assert.ok(SOCIAL_COMMENT_AUTOMATION_SUPPORTED_PLATFORMS.has("facebook"));
  assert.ok(SOCIAL_COMMENT_AUTOMATION_SUPPORTED_PLATFORMS.has("instagram"));
  assert.ok(!SOCIAL_COMMENT_AUTOMATION_SUPPORTED_PLATFORMS.has("tiktok"));
});
