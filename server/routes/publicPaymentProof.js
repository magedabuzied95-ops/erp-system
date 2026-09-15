import fs from "node:fs";
import express from "express";

import paymentProofUpload from "../config/paymentProofUpload.js";
import { loadPaymentProofPage, submitPaymentProof } from "../modules/shipping/paymentProofLink.js";
import {
  createRequestRateLimit,
  createSlidingWindowCounter,
  createSuccessRateLimit,
  rateLimitClientKey,
} from "../utils/requestRateLimit.js";

// The customer's side of the shipping-fee payment card: /pay/:code loads the order's amount and
// the wallet details, and uploads the transfer screenshot. No login — the code is the credential,
// and it can only ever attach a screenshot, never confirm or cancel anything.
const router = express.Router();

const sendError = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[public-payment-proof] failed", { message: error?.message || String(error) });
  return res.status(status).json({
    success: false,
    code: error?.code || "PAYMENT_PROOF_ERROR",
    message: status >= 500 ? fallback : error?.message || fallback,
  });
};

// A few loads and one upload per customer; a guesser is capped hard on codes that do not exist.
const codeRequestRateLimit = createRequestRateLimit({ windowMs: 10 * 60_000, max: 30 });
const unknownCodeRateLimit = createSuccessRateLimit({
  counter: createSlidingWindowCounter({ windowMs: 60 * 60_000, max: 10 }),
  keysOf: (req) => [rateLimitClientKey(req)],
  countWhen: (statusCode) => statusCode === 404 || statusCode === 400,
});

router.get("/:code", codeRequestRateLimit, unknownCodeRateLimit, async (req, res) => {
  try {
    return res.json({ success: true, ...(await loadPaymentProofPage({ code: req.params.code })) });
  } catch (error) {
    return sendError(res, error, "تعذر تحميل الصفحة، حاول مرة أخرى.");
  }
});

router.post(
  "/:code",
  codeRequestRateLimit,
  unknownCodeRateLimit,
  (req, res, next) => paymentProofUpload.single("shipping_payment_screenshot")(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.code === "LIMIT_FILE_SIZE";
    return res.status(400).json({
      success: false,
      code: tooLarge ? "PAYMENT_PROOF_TOO_LARGE" : "INVALID_PAYMENT_PROOF",
      message: tooLarge ? "الصورة كبيرة، اختار صورة أصغر من 10 ميجا." : "صورة التحويل لازم تكون PNG أو JPG أو WEBP.",
    });
  }),
  async (req, res) => {
    const proofPath = req.file ? `/uploads/payment-proofs/${req.file.filename}` : "";
    try {
      const view = await submitPaymentProof({ code: req.params.code, method: req.body?.method, proofPath });
      return res.json({ success: true, ...view });
    } catch (error) {
      // A refused upload leaves nothing behind on disk.
      if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
      return sendError(res, error, "تعذر رفع صورة التحويل، حاول مرة أخرى.");
    }
  }
);

export default router;
