/*
 * The numbers a shopper reads, and the rules the form applies before anything is uploaded.
 * Pure functions, so this runs everywhere — no database, no browser.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_RATING_SUMMARY,
  REVIEW_PHOTOS_MAX,
  REVIEW_PHOTO_MAX_BYTES,
  canSubmitReview,
  formatRatingAverage,
  normalizeRatingSummary,
  ratingBars,
  rejectPhotoReason,
  starFill,
} from "../src/storefront/lib/productReviews.js";
import { publicReviewerName } from "../server/services/productReviewsService.js";

test("the bars are the shape of the rating, newest star first", () => {
  const bars = ratingBars({ 5: 40, 4: 5, 3: 2, 2: 1, 1: 2 }, 50);
  assert.deepEqual(bars.map((bar) => bar.stars), [5, 4, 3, 2, 1]);
  assert.deepEqual(bars.map((bar) => bar.percent), [80, 10, 4, 2, 4]);
  // Two products can share an average and look nothing alike; that is what the bars are for.
  const polarised = ratingBars({ 5: 25, 1: 25 }, 50);
  assert.equal(polarised[0].percent, 50);
  assert.equal(polarised[4].percent, 50);
});

test("a total the caller did not pass is counted from the distribution", () => {
  assert.deepEqual(ratingBars({ 5: 3, 4: 1 }).map((bar) => bar.percent), [75, 25, 0, 0, 0]);
});

test("no reviews draws empty bars instead of dividing by zero", () => {
  const bars = ratingBars({}, 0);
  assert.equal(bars.length, 5);
  assert.deepEqual([...new Set(bars.map((bar) => bar.percent))], [0]);
  assert.equal(bars.every((bar) => Number.isFinite(bar.percent)), true);
});

test("the average is written the way a rating is read", () => {
  assert.equal(formatRatingAverage(4.75), "4.8");
  assert.equal(formatRatingAverage(5), "5", "not 5.0");
  assert.equal(formatRatingAverage(4), "4");
  // Nothing to average is an empty state, never a zero — a zero reads as a terrible product.
  assert.equal(formatRatingAverage(0), "");
  assert.equal(formatRatingAverage(null), "");
  assert.equal(formatRatingAverage("abc"), "");
});

test("a half star is drawn half full", () => {
  assert.equal(starFill(4.5, 4), 1);
  assert.equal(starFill(4.5, 5), 0.5);
  assert.equal(starFill(4.5, 6), 0, "never below zero");
  assert.equal(starFill(5, 5), 1, "never above one");
  assert.equal(starFill(0, 1), 0);
});

test("a rating is required; words and photos are not", () => {
  assert.equal(canSubmitReview({ rating: 5 }), true);
  assert.equal(canSubmitReview({ rating: 1 }), true);
  assert.equal(canSubmitReview({ rating: 0 }), false);
  assert.equal(canSubmitReview({ rating: 6 }), false);
  assert.equal(canSubmitReview({ rating: 4.5 }), false);
  assert.equal(canSubmitReview({}), false);
});

test("a photo is refused with a reason the page can say out loud", () => {
  const good = { type: "image/jpeg", size: 1024 };
  assert.equal(rejectPhotoReason(good), "");
  assert.equal(rejectPhotoReason(good, { alreadyChosen: REVIEW_PHOTOS_MAX }), "too_many");
  assert.equal(rejectPhotoReason({ type: "application/pdf", size: 10 }), "type");
  assert.equal(rejectPhotoReason({ type: "image/heic", size: 10 }), "type");
  assert.equal(rejectPhotoReason({ type: "image/png", size: REVIEW_PHOTO_MAX_BYTES + 1 }), "size");
  assert.equal(rejectPhotoReason({ type: "image/png", size: REVIEW_PHOTO_MAX_BYTES }), "", "exactly the limit passes");
  assert.equal(rejectPhotoReason(null), "missing");
});

test("an unrated product and a loading one render the same shape", () => {
  assert.equal(normalizeRatingSummary(undefined), EMPTY_RATING_SUMMARY);
  assert.equal(normalizeRatingSummary({ review_count: 0, rating_average: 0 }), EMPTY_RATING_SUMMARY);
  const real = normalizeRatingSummary({ review_count: 3, rating_average: 4.67, distribution: { 5: 2, 4: 1 } });
  assert.equal(real.review_count, 3);
  assert.equal(formatRatingAverage(real.rating_average), "4.7");
});

test("a published review shows a first name and an initial, never the full name", () => {
  assert.equal(publicReviewerName("Maged Abu Zied"), "Maged A.");
  assert.equal(publicReviewerName("محمد عبد الله"), "محمد ع.");
  assert.equal(publicReviewerName("Maged"), "Maged", "one name is already no surname");
  assert.equal(publicReviewerName(""), "عميل");
  assert.equal(publicReviewerName("   "), "عميل");
});

test("the product page hands its loaded reviews to the schema it rewrites", async () => {
  // The server-rendered page carries the stars; the page's own schema rewrite must carry them too,
  // or hydration strips them from what Google renders.
  const { readFile } = await import("node:fs/promises");
  const pdp = await readFile(new URL("../src/storefront/pages/StorefrontProductDetailPage.jsx", import.meta.url), "utf8");
  assert.match(pdp, /<ProductReviews productId=\{product\.id\} onLoaded=\{setReviewSeo\} \/>/);
  assert.match(pdp, /applyProductSeo\(product, \{ reviews: pageReviewSeo \}\)/);
  // ...and only for the product they belong to.
  assert.match(pdp, /String\(reviewSeo\.productId\) === String\(product\.id\)/);
  const section = await readFile(new URL("../src/storefront/components/ProductReviews.jsx", import.meta.url), "utf8");
  assert.match(section, /if \(!offset\) onLoadedRef\.current\?\.\(\{ productId, summary: data\?\.summary \|\| null, reviews: page \}\)/);
});
