import express from "express";

import { loadPublicAddressRequest, submitPublicAddressRequest } from "../services/conversationAddressRequestService.js";

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
