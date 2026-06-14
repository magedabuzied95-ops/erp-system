import test from "node:test";
import assert from "node:assert/strict";

import { classifySocialCommentIntent } from "../server/services/socialCommentAutomationService.js";

const classify = (text) => classifySocialCommentIntent(text).label;

test("social comment classifier maps clear lead intents", () => {
  assert.equal(classify("السعر كام؟"), "lead_price");
  assert.equal(classify("بكام"), "lead_price");
  assert.equal(classify("مقاس 43 موجود؟"), "lead_size");
  assert.equal(classify("في توصيل؟"), "lead_shipping");
  assert.equal(classify("ابعتلي التفاصيل"), "lead_details");
  assert.equal(classify("inbox"), "lead_inbox");
});

test("social comment classifier maps low-value and empty comments", () => {
  const empty = classifySocialCommentIntent("").label;
  const heart = classifySocialCommentIntent("❤️").label;
  assert.ok(["ignore", "engagement_only"].includes(empty));
  assert.ok(["ignore", "engagement_only"].includes(heart));
  assert.equal(classify("حلو"), "engagement_only");
  assert.equal(classify("nice"), "engagement_only");
  assert.equal(classify("wow"), "engagement_only");
  assert.equal(classify("جامد"), "engagement_only");
});

test("social comment classifier sends ambiguous comments to human review", () => {
  assert.equal(classify("مقاسه كام والسعر؟"), "human_review");
  assert.equal(classify("موجود ولا لا؟"), "lead_availability");
  assert.equal(classify("تفاصيل"), "lead_details");
});
