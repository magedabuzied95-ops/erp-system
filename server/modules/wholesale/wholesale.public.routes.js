import express from "express";
import {
  createRequestRateLimit,
  createSlidingWindowCounter,
  createSuccessRateLimit,
  rateLimitClientKey,
} from "../../utils/requestRateLimit.js";
import { requireWholesaleMode } from "./wholesaleMode.js";
import { loadPublicStatement } from "./wholesale.payments.js";

// The credit customer's side: /s/:token shows their statement -- invoices, payments, returns,
// what they owe -- and nothing else. No login: the token is the credential, and it can only
// READ the account. Payments are recorded by staff (payments page / manager portal), never
// from this link. Wholesale copy only.
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

router.get("/statement/:token", tokenRateLimit, unknownTokenRateLimit, async (req, res) => {
  try {
    return res.json({ success: true, data: await loadPublicStatement({ token: req.params.token }) });
  } catch (error) {
    return sendError(res, error, "تعذر تحميل كشف الحساب، حاول مرة أخرى.");
  }
});

export default router;
