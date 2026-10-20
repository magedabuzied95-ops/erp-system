import express from "express";

import {
  RATE_LIMIT_PER_MINUTE,
  extractApiKey,
  sendApiTemplate,
  sendApiText,
  takeRateLimit,
  verifyApiKey,
} from "../services/whatsappApiAccessService.js";

/*
 * Public WhatsApp API — mounted at /api/public/whatsapp.
 *
 * An external system sends messages through the shop's official WhatsApp number with an API key
 * created in the inbox (WhatsApp → API Keys):
 *
 *   POST /messages           { to, text }                                   → free-form text
 *   POST /messages/template  { to, template_name, language, variables[] }   → approved template
 *
 * Auth: `X-API-Key: m1wa_…` or `Authorization: Bearer m1wa_…`. The key carries the tenant and,
 * optionally, which official number it sends from. 60 requests per minute per key.
 *
 * Free-form text only reaches a customer inside Meta's 24-hour service window; outside it Meta
 * rejects with code 131047 and the caller must use a template instead — that error is passed
 * through with its meaning.
 */

const router = express.Router();

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[whatsapp-public-api:error]", { code: error?.code, message: error?.message });
  return res.status(status >= 400 && status < 600 ? status : 502).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "WHATSAPP_PUBLIC_API_ERROR",
    meaning: error?.details?.meaning || "",
  });
};

const authenticate = async (req, res, next) => {
  try {
    const raw = extractApiKey(req.headers || {});
    if (!raw) return res.status(401).json({ success: false, message: "Missing API key", code: "WHATSAPP_API_KEY_MISSING" });
    const key = await verifyApiKey(raw);
    if (!key) return res.status(401).json({ success: false, message: "Invalid or inactive API key", code: "WHATSAPP_API_KEY_INVALID" });
    const limit = takeRateLimit(key.id);
    res.set("X-RateLimit-Limit", String(RATE_LIMIT_PER_MINUTE));
    res.set("X-RateLimit-Remaining", String(limit.remaining));
    if (!limit.allowed) {
      res.set("Retry-After", String(Math.ceil(limit.resetMs / 1000) || 1));
      return res.status(429).json({ success: false, message: "Rate limit exceeded", code: "WHATSAPP_API_RATE_LIMITED" });
    }
    req.whatsappApiKey = key;
    return next();
  } catch (error) {
    return fail(res, error, "Authentication failed");
  }
};

router.use(authenticate);

router.post("/messages", async (req, res) => {
  try {
    const key = req.whatsappApiKey;
    const result = await sendApiText({
      tenantId: key.tenant_id,
      phoneNumberId: key.phone_number_id || "",
      to: req.body?.to,
      text: req.body?.text,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to send the message");
  }
});

router.post("/messages/template", async (req, res) => {
  try {
    const key = req.whatsappApiKey;
    const result = await sendApiTemplate({
      tenantId: key.tenant_id,
      phoneNumberId: key.phone_number_id || "",
      to: req.body?.to,
      templateName: req.body?.template_name,
      language: req.body?.language,
      variables: req.body?.variables,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to send the template");
  }
});

export default router;
