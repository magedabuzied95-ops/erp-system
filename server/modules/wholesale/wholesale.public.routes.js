import fs from "node:fs";
import express from "express";
import paymentProofUpload from "../../config/paymentProofUpload.js";
import {
  createRequestRateLimit,
  createSlidingWindowCounter,
  createSuccessRateLimit,
  rateLimitClientKey,
} from "../../utils/requestRateLimit.js";
import { requireWholesaleMode } from "./wholesaleMode.js";
import { createSubmission, loadPublicStatement, resolveStatementToken } from "./wholesale.payments.js";

// The credit customer's side: /s/:token shows their statement and lets them send a payment
// with its screenshot. No login -- the token is the credential, and it can only ever READ the
// account and SUBMIT a payment for staff to approve. Wholesale copy only.
const router = express.Router();
router.use(requireWholesaleMode);

const sendError = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[wholesale-public] failed", { message: error?.message || String(error) });
  return res.status(status).json({ success: false, code: error?.code || "WHOLESALE_PUBLIC_ERROR", message: status >= 500 ? fallback : error.message });
};

const tokenRateLimit = createRequestRateLimit({ windowMs: 10 * 60_000, max: 60 });
const unknownTokenRateLimit = createSuccessRateLimit({
  counter: createSlidingWindowCounter({ windowMs: 60 * 60_000, max: 10 }),
  keysOf: (req) => [rateLimitClientKey(req)],
  countWhen: (statusCode) => statusCode === 404,
});
const submitRateLimit = createRequestRateLimit({ windowMs: 60 * 60_000, max: 10 });

router.get("/statement/:token", tokenRateLimit, unknownTokenRateLimit, async (req, res) => {
  try {
    return res.json({ success: true, data: await loadPublicStatement({ token: req.params.token }) });
  } catch (error) {
    return sendError(res, error, "تعذر تحميل كشف الحساب، حاول مرة أخرى.");
  }
});

router.post(
  "/statement/:token/payments",
  tokenRateLimit,
  unknownTokenRateLimit,
  submitRateLimit,
  (req, res, next) => paymentProofUpload.single("screenshot")(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.code === "LIMIT_FILE_SIZE";
    return res.status(400).json({
      success: false,
      message: tooLarge ? "الصورة كبيرة، اختار صورة أصغر من 10 ميجا." : "صورة التحويل لازم تكون PNG أو JPG أو WEBP.",
    });
  }),
  async (req, res) => {
    const imageUrl = req.file ? `/uploads/payment-proofs/${req.file.filename}` : "";
    try {
      const { tenantId, customerId } = await resolveStatementToken(req.params.token);
      const submission = await createSubmission({
        tenantId,
        customerId,
        amount: req.body?.amount,
        method: String(req.body?.method || ""),
        reference: req.body?.reference,
        note: req.body?.note,
        imageUrl,
        source: "customer",
      });
      return res.json({ success: true, data: { id: Number(submission.id), status: submission.status } });
    } catch (error) {
      if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
      return sendError(res, error, "تعذر إرسال الدفعة، حاول مرة أخرى.");
    }
  }
);

export default router;
