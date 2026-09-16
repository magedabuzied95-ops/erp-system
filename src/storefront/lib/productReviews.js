/*
 * The product page's side of reviews.
 *
 * The arithmetic lives here, framework-free, so the numbers a shopper reads can be tested
 * without mounting a page: the bar chart's percentages, the average as it is written, and the
 * one question the form has to answer before it lets someone submit. Every string the component
 * shows goes through sfText, so this file holds no copy.
 */

// Extension spelled out: Vite resolves either way, but the node:test suite that exercises these
// helpers has no bundler to guess for it.
import { resolveProductImageUrl } from "../../shared/lib/imageUrls.js";

export const REVIEW_STARS = Object.freeze([5, 4, 3, 2, 1]);
export const REVIEW_BODY_MAX = 2000;
export const REVIEW_PHOTOS_MAX = 5;
/* Matches the server's multer limit; the page refuses a too-large photo before uploading it. */
export const REVIEW_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const REVIEW_PHOTO_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

const count = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

/*
 * The 5→1 bars. A shopper reads the SHAPE of a rating faster than its average: forty fives and
 * two ones is a different product from twenty-one threes, and both average out near four.
 * Percentages are of the total, so an empty product draws empty bars rather than dividing by
 * zero.
 */
export const ratingBars = (distribution = {}, total = 0) => {
  const reviewCount = count(total) || REVIEW_STARS.reduce((sum, star) => sum + count(distribution?.[star]), 0);
  return REVIEW_STARS.map((stars) => {
    const barCount = count(distribution?.[stars] ?? distribution?.[String(stars)]);
    return {
      stars,
      count: barCount,
      percent: reviewCount > 0 ? Math.round((barCount / reviewCount) * 100) : 0,
    };
  });
};

/*
 * "4.8", not "4.80" and not "5". One decimal is what a rating means; a product rated exactly
 * five reads better as 5 than as 5.0, and a product with nothing to average has no number at
 * all — the caller shows the empty state instead of a zero, which would read as a bad rating.
 */
export const formatRatingAverage = (value) => {
  const average = Number(value);
  if (!Number.isFinite(average) || average <= 0) return "";
  return Number.isInteger(average) ? String(average) : average.toFixed(1);
};

/* How full each of the five stars is drawn, 0 → 1. A 4.5 fills four and half of the fifth. */
export const starFill = (average, position) => {
  const value = Number(average);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, Math.max(0, value - (position - 1)));
};

/* A review is a rating. Words and photos are welcome and never required. */
export const canSubmitReview = ({ rating = 0 } = {}) => {
  const stars = Number(rating);
  return Number.isInteger(stars) && stars >= 1 && stars <= 5;
};

/*
 * Why a photo was refused, before it is uploaded. Returning the reason rather than a boolean is
 * what lets the page say "الصورة أكبر من 8 ميجا" instead of a silent nothing.
 */
export const rejectPhotoReason = (file, { alreadyChosen = 0 } = {}) => {
  if (!file) return "missing";
  if (alreadyChosen >= REVIEW_PHOTOS_MAX) return "too_many";
  if (!REVIEW_PHOTO_TYPES.includes(String(file.type || ""))) return "type";
  if (Number(file.size || 0) > REVIEW_PHOTO_MAX_BYTES) return "size";
  return "";
};

/*
 * Review photos are stored as relative /uploads paths. On the shop's own origin that path
 * answers the app's HTML rather than an image, so every one goes through the resolver that
 * makes it absolute against the API origin.
 */
export const reviewPhotoUrls = (review = {}) =>
  (Array.isArray(review?.images) ? review.images : [])
    .map((image) => resolveProductImageUrl(typeof image === "string" ? image : image?.url))
    .filter(Boolean);

/* An empty summary, so a page that has not loaded yet renders the same shape as one that has. */
export const EMPTY_RATING_SUMMARY = Object.freeze({
  review_count: 0,
  rating_average: null,
  distribution: Object.freeze({}),
});

export const normalizeRatingSummary = (summary) => {
  const reviewCount = count(summary?.review_count);
  if (!reviewCount) return EMPTY_RATING_SUMMARY;
  return {
    review_count: reviewCount,
    rating_average: Number(summary?.rating_average) || null,
    distribution: summary?.distribution || {},
  };
};
