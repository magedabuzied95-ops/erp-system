import test from "node:test";
import assert from "node:assert/strict";

import { articleCodeSearchValues, resolveEffectiveArticleCode } from "../shared/articleCode.js";

test("falls back to the color Article Code when the variant value is empty", () => {
  assert.equal(resolveEffectiveArticleCode({ article_code: "" }, { color_article_code: "COLOR-12" }), "COLOR-12");
});

test("variant Article Code has priority over the color value", () => {
  assert.equal(resolveEffectiveArticleCode({ article_code: "SIZE-40" }, { color_article_code: "COLOR-12" }), "SIZE-40");
});

test("different size Article Codes remain independent", () => {
  const color = { color_article_code: "COLOR-12" };
  assert.equal(resolveEffectiveArticleCode({ article_code: "SIZE-40" }, color), "SIZE-40");
  assert.equal(resolveEffectiveArticleCode({ article_code: "SIZE-41" }, color), "SIZE-41");
});

test("search values contain both Article Code levels", () => {
  assert.deepEqual(articleCodeSearchValues({ article_code: "SIZE-40" }, { color_article_code: "COLOR-12" }), ["SIZE-40", "COLOR-12"]);
});

