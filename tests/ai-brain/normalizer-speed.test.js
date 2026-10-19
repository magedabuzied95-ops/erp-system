import test from "node:test";
import assert from "node:assert/strict";

import {
  buildArabicCanonicalSignals,
  normalizeArabicForIntent,
  normalizeArabicIntentPayload,
} from "../../server/utils/arabicTextNormalizer.js";
import { rankProductCandidates } from "../../server/utils/productMatchConfidence.js";

/**
 * Production log, 2026-10-19 16:16:22 → 16:16:54: 32 seconds between brain V2's catalog query
 * (80 rows for "متاح ايرفورس ؟") and the next line — all of it ranking those rows. Every canonical
 * signal check re-normalized the whole text and compiled a new regex (150 aliases × 3 texts),
 * and the ranker ran that for each candidate's name + description blob, many times over.
 * Same 80 rows locally: 27.7s before, under 1s after, with byte-identical normalizer output.
 */

const description = "حذاء نايك اير فورس 1 الأصلي مريح جدا للمشي اليومي Nike Air Force 1 Low white leather sneaker. ".repeat(15);
const catalogRows = Array.from({ length: 80 }, (_, index) => ({
  id: index + 1,
  name: index % 3 ? `Nike Air Max ${index}` : `Nike Air Force 1 ${index}`,
  sku: `SKU-${index}`,
  brand_name: "Nike",
  description,
  variants: Array.from({ length: 30 }, (_, variant) => ({ id: index * 100 + variant, size: String(36 + (variant % 10)), color: ["black", "white", "red"][variant % 3], stock: variant % 4 })),
}));

test("ranking a full 80-row catalog answer takes seconds at most, not half a minute", () => {
  rankProductCandidates({ candidates: catalogRows.slice(0, 2), text: "warm up" });
  const started = performance.now();
  rankProductCandidates({ candidates: catalogRows, text: "متاح ايرفورس ؟" });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5_000, `ranking took ${Math.round(elapsed)}ms`);
});

test("normalizing a product description does not pay for the canonical-signal pass", () => {
  normalizeArabicForIntent("warm up");
  const started = performance.now();
  for (let round = 0; round < 50; round += 1) normalizeArabicForIntent(description);
  const perCall = (performance.now() - started) / 50;
  assert.ok(perCall < 20, `${perCall.toFixed(1)}ms per call`);
});

test("the faster normalizer gives the same answers", () => {
  // normalizeArabicForIntent is exactly the payload's normalizedForIntent.
  for (const sample of ["متاح ايرفورس ؟", "جوردن فور مقاس ٤٢", "Looking for more photos", "شوكسات نايك", description]) {
    assert.equal(normalizeArabicForIntent(sample), normalizeArabicIntentPayload(sample).normalizedForIntent);
  }
  // The signals still come out of the compiled-once patterns.
  assert.ok(buildArabicCanonicalSignals("بكام الاير فورس").includes("price"));
  assert.ok(buildArabicCanonicalSignals("فيه مقاس 42 من الايرفورس").includes("size"));
  assert.ok(buildArabicCanonicalSignals("السلام عليكم").includes("greeting"));
  assert.deepEqual(buildArabicCanonicalSignals("متاح ايرفورس ؟"), []);
});
