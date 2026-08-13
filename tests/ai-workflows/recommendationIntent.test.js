// Phase 13.4 — behavioural test for the recommendation-vs-identity classifier. Show-me-options phrasing →
// recommendation (multi-select); a specific named-product question → NOT recommendation (identity disambiguation,
// single-select). Safe default: uncertain ⇒ false ⇒ single-select.
import test from "node:test";
import assert from "node:assert/strict";
import { detectsRecommendationIntent } from "../../server/services/aiInboxGroundingGate.js";

test("show-me-options phrasing is detected as recommendation", () => {
  for (const t of [
    "وريني موديلات جوردن فور مقاس ٤٥",
    "عايز اختيارات في حدود 1500",
    "ابعتلي الموديلات المتاحة",
    "وريني كذا موديل",
    "عندكم ايه كوتشي اسود؟",
  ]) assert.equal(detectsRecommendationIntent(t), true, t);
});

test("a specific named-product question is NOT a recommendation (stays single-select disambiguation)", () => {
  for (const t of [
    "عندكم جوردن فور مقاس ٤٥؟",
    "متاح اديداس اديستار؟",
    "بكام الاير فورس؟",
    "",
  ]) assert.equal(detectsRecommendationIntent(t), false, t);
});
