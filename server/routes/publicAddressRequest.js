import express from "express";

import {
  loadPublicAddressRequest,
  lookupReturningCustomerAddress,
  submitPublicAddressRequest,
} from "../services/conversationAddressRequestService.js";

// Public, unauthenticated: the customer opens these from a chat link on their
// phone. Everything sensitive stays inside the service — this file only shapes
// HTTP.
const router = express.Router();

const sendAddressRequestError = (res, error) =>
  res.status(Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500).json({
    success: false,
    code: error?.code || "ADDRESS_REQUEST_ERROR",
    message: error?.message || "تعذر تحميل رابط العنوان.",
  });

router.get("/:code", async (req, res) => {
  try {
    const request = await loadPublicAddressRequest(req.params.code);
    return res.json({ success: true, request });
  } catch (error) {
    return sendAddressRequestError(res, error);
  }
});

// The returning-customer lookup is scoped to the link's own conversation (see the service), and on
// top of that capped per IP, so a link cannot be used to try number after number.
const LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const LOOKUP_MAX_PER_WINDOW = 12;
const lookupHits = new Map();
const allowLookup = (key = "") => {
  const now = Date.now();
  if (lookupHits.size > 5000) {
    for (const [hitKey, hit] of lookupHits) if (now - hit.start > LOOKUP_WINDOW_MS) lookupHits.delete(hitKey);
  }
  const hit = lookupHits.get(key);
  if (!hit || now - hit.start > LOOKUP_WINDOW_MS) {
    lookupHits.set(key, { start: now, count: 1 });
    return true;
  }
  hit.count += 1;
  return hit.count <= LOOKUP_MAX_PER_WINDOW;
};

router.get("/:code/returning", async (req, res) => {
  try {
    const ipKey = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || req.socket?.remoteAddress || "unknown";
    if (!allowLookup(ipKey)) return res.json({ success: true, found: false, reason: "rate_limited" });
    const result = await lookupReturningCustomerAddress({ code: req.params.code, phone: req.query?.phone || "" });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendAddressRequestError(res, error);
  }
});

router.post("/:code/submit", async (req, res) => {
  try {
    const result = await submitPublicAddressRequest({
      code: req.params.code,
      payload: req.body || {},
      ipAddress: req.ip || req.socket?.remoteAddress || "",
      userAgent: req.headers?.["user-agent"] || "",
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendAddressRequestError(res, error);
  }
});

export default router;
