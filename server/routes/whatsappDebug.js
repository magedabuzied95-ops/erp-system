import express from "express";
import { normalizeEgyptPhone, sendWhatsAppButtonsDebugTest } from "../services/whatsappGatewayService.js";

const router = express.Router();
const debugKey = () =>
  String(
    process.env.WHATSAPP_DEBUG_KEY ||
      process.env.WHATSAPP_DEBUG_BUTTONS_KEY ||
      process.env.DEBUG_KEY ||
      process.env.WHATSAPP_WEBHOOK_SECRET ||
      ""
  ).trim();

const canUseDebugRoute = (req) => {
  if (String(process.env.NODE_ENV || "").toLowerCase() !== "production") return true;
  const provided = String(req.query?.debug_key || req.body?.debug_key || "").trim();
  const expected = debugKey();
  return Boolean(expected) && provided === expected;
};

const sendError = (res, error, fallback = "WhatsApp gateway error") =>
  res.status(error?.status || 500).json({
    success: false,
    code: error?.code || "WHATSAPP_GATEWAY_ERROR",
    message: error?.message || fallback,
  });

router.post("/send-buttons-test", async (req, res) => {
  try {
    if (!canUseDebugRoute(req)) {
      return res.status(401).json({
        success: false,
        code: "WHATSAPP_DEBUG_KEY_REQUIRED",
        message: "debug_key is required for this endpoint in production",
      });
    }
    const phone = normalizeEgyptPhone(req.body?.phone);
    const mode = String(req.body?.mode || "simple").trim().toLowerCase();
    const useSafeIds = Boolean(req.body?.useSafeIds);
    console.info("[whatsapp:buttons-debug-request]", {
      userId: req.user?.id,
      phoneSuffix: phone ? phone.slice(-4) : "",
      mode,
      useSafeIds,
    });
    const result = await sendWhatsAppButtonsDebugTest({
      phone,
      mode,
      useSafeIds,
    });
    return res.json({ success: true, mode, result });
  } catch (error) {
    return sendError(res, error, "Failed to send WhatsApp buttons debug test");
  }
});

export default router;
