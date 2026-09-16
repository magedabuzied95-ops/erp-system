import fs from "node:fs";
import express from "express";

import reviewPhotoUpload from "../config/reviewPhotoUpload.js";
import { loadReviewLinkPage, submitReviewLink } from "../services/productReviewsService.js";
import {
  createRequestRateLimit,
  createSlidingWindowCounter,
  createSuccessRateLimit,
  rateLimitClientKey,
} from "../utils/requestRateLimit.js";

/*
 * The customer's side of the review link (/review/:code). No login — the code is the credential,
 * like /pay/:code next door, and all it can do is write a review for a product in its own order.
 * Mounted at /api/public/product-review.
 */
const router = express.Router();

const sendError = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[public-product-review] failed", { message: error?.message || String(error) });
  return res.status(status).json({
    success: false,
    code: error?.code || "PRODUCT_REVIEW_ERROR",
    message: status >= 500 ? fallback : error?.message || fallback,
  });
};

// An order has a handful of products, so a customer needs a few loads and a few writes; a
// guesser walking codes is capped hard on the ones that do not exist.
const codeRequestRateLimit = createRequestRateLimit({ windowMs: 10 * 60_000, max: 40 });
const unknownCodeRateLimit = createSuccessRateLimit({
  counter: createSlidingWindowCounter({ windowMs: 60 * 60_000, max: 10 }),
  keysOf: (req) => [rateLimitClientKey(req)],
  countWhen: (statusCode) => statusCode === 404 || statusCode === 400,
});

const removeUploads = (req) =>
  (Array.isArray(req.files) ? req.files : []).forEach((file) => {
    if (file?.path) fs.promises.unlink(file.path).catch(() => {});
  });

router.get("/:code", codeRequestRateLimit, unknownCodeRateLimit, async (req, res) => {
  try {
    return res.json({ success: true, ...(await loadReviewLinkPage({ code: req.params.code })) });
  } catch (error) {
    return sendError(res, error, "تعذر تحميل الصفحة، حاول مرة أخرى.");
  }
});

router.post(
  "/:code",
  codeRequestRateLimit,
  unknownCodeRateLimit,
  (req, res, next) => reviewPhotoUpload.array("photos")(req, res, (error) => {
    if (!error) return next();
    removeUploads(req);
    const tooLarge = error?.code === "LIMIT_FILE_SIZE";
    const tooMany = error?.code === "LIMIT_FILE_COUNT" || error?.code === "LIMIT_UNEXPECTED_FILE";
    return res.status(400).json({
      success: false,
      code: tooLarge ? "REVIEW_PHOTO_TOO_LARGE" : tooMany ? "REVIEW_PHOTO_TOO_MANY" : "REVIEW_PHOTO_INVALID",
      message: tooLarge
        ? "الصورة كبيرة، اختار صورة أصغر من 8 ميجا."
        : tooMany
          ? "تقدر ترفع 5 صور بالكتير."
          : "الصور لازم تكون PNG أو JPG أو WEBP.",
    });
  }),
  async (req, res) => {
    // Relative /uploads paths: the storefront resolves them against the API origin.
    const photos = (Array.isArray(req.files) ? req.files : []).map((file) => `/uploads/reviews/${file.filename}`);
    try {
      const review = await submitReviewLink({
        code: req.params.code,
        productId: req.body?.product_id,
        rating: req.body?.rating,
        body: req.body?.body || "",
        images: photos,
      });
      return res.json({ success: true, review });
    } catch (error) {
      // A refused review leaves nothing behind on disk.
      removeUploads(req);
      return sendError(res, error, "تعذر حفظ التقييم، حاول مرة أخرى.");
    }
  }
);

export default router;
