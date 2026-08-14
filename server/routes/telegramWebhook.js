import express from "express";

import { persistTelegramWebhookUpdate, wakeTelegramIntakeWorker } from "../services/telegramIntakeService.js";
import { telegramTenantId, telegramWebhookSecret, validateTelegramWebhookSecret } from "../services/telegramBotService.js";

const router = express.Router();
const MAX_UPDATE_BYTES = 512 * 1024;

export const receiveTelegramWebhook = async (req, res) => {
  const expectedSecret = telegramWebhookSecret();
  const suppliedSecret = req.get("X-Telegram-Bot-Api-Secret-Token") || "";
  if (!validateTelegramWebhookSecret({ provided: suppliedSecret, expected: expectedSecret })) {
    return res.status(401).json({ success: false, message: "Invalid Telegram webhook secret" });
  }
  const tenantId = telegramTenantId();
  if (!tenantId) return res.status(503).json({ success: false, message: "Telegram tenant is not configured" });
  const update = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
  if (!update) return res.status(400).json({ success: false, message: "Malformed Telegram update" });
  const payloadSize = Buffer.byteLength(JSON.stringify(update));
  if (payloadSize > MAX_UPDATE_BYTES) return res.status(413).json({ success: false, message: "Telegram update is too large" });
  try {
    const result = await persistTelegramWebhookUpdate({ tenantId, update });
    res.status(200).json({ success: true, accepted: true, duplicate: result.duplicate });
    wakeTelegramIntakeWorker();
    return undefined;
  } catch (error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({ success: false, message: status >= 500 ? "Telegram update could not be queued" : error.message });
  }
};

router.post("/", receiveTelegramWebhook);

export default router;
