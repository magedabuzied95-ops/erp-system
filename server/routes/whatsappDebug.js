import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { normalizeEgyptPhone, sendWhatsAppButtonsDebugTest } from "../services/whatsappGatewayService.js";

const router = express.Router();

const sendError = (res, error, fallback = "WhatsApp gateway error") =>
  res.status(error?.status || 500).json({
    success: false,
    code: error?.code || "WHATSAPP_GATEWAY_ERROR",
    message: error?.message || fallback,
  });

router.post("/send-buttons-test", protect, permit("settings", "edit"), async (req, res) => {
  try {
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
