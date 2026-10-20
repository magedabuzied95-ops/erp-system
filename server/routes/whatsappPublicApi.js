import express from "express";

import {
  API_MEDIA_TYPES,
  RATE_LIMIT_PER_MINUTE,
  extractApiKey,
  getApiMessage,
  listApiAccounts,
  listApiTemplates,
  rotateWebhookSecret,
  sendApiMedia,
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
 *   GET  /accounts                         numbers this key can send from
 *   GET  /templates?status=approved|all    stored templates with their variables and buttons
 *   POST /messages           { to, text } | { to, type: image|video|audio|document, url, caption?, filename? }
 *   POST /messages/template  { to, template_name | template | template_id, language?, variables[] | {},
 *                              buttons_variables?, header? }                 → approved template
 *   GET  /messages/:wamid                  delivery status of a message
 *   POST /webhooks/:id/rotate-secret       new signing secret (shown once)
 *
 * Every send also accepts `whatsapp_account_id` (a phone_number_id). A key pinned to a number
 * can only use that number.
 *
 * Auth: `X-API-Key: m1wa_…` or `Authorization: Bearer m1wa_…`. The key carries the tenant and,
 * optionally, which official number it sends from. 60 requests per minute per key.
 *
 * Free-form text / media only reaches a customer inside Meta's 24-hour service window; outside it
 * Meta rejects with code 131047 and the caller must use a template instead — that error is passed
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
    ...(Array.isArray(error?.details?.languages) ? { languages: error.details.languages } : {}),
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

// The number a request sends from: the key's pinned number always wins; an unpinned key may pick
// one with `whatsapp_account_id`, else the default (first connected) number.
const accountFor = (req) => {
  const key = req.whatsappApiKey;
  const pinned = String(key.phone_number_id || "").trim();
  const wanted = String(req.body?.whatsapp_account_id ?? req.query?.whatsapp_account_id ?? "").trim();
  if (pinned && wanted && wanted !== pinned) {
    throw Object.assign(new Error("This API key is bound to another WhatsApp account"), { status: 403, code: "WHATSAPP_ACCOUNT_NOT_ALLOWED" });
  }
  return pinned || wanted;
};

router.get("/accounts", async (req, res) => {
  try {
    const key = req.whatsappApiKey;
    return res.json({ success: true, accounts: await listApiAccounts({ tenantId: key.tenant_id, phoneNumberId: key.phone_number_id || "" }) });
  } catch (error) {
    return fail(res, error, "Failed to list accounts");
  }
});

router.get("/templates", async (req, res) => {
  try {
    const key = req.whatsappApiKey;
    const templates = await listApiTemplates({ tenantId: key.tenant_id, phoneNumberId: accountFor(req), status: req.query?.status || "approved" });
    return res.json({ success: true, templates });
  } catch (error) {
    return fail(res, error, "Failed to list templates");
  }
});

router.post("/messages", async (req, res) => {
  try {
    const key = req.whatsappApiKey;
    const type = String(req.body?.type || "text").trim().toLowerCase();
    if (type !== "text" && !API_MEDIA_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: "`type` must be text, image, video, audio or document", code: "WHATSAPP_MESSAGE_TYPE_INVALID" });
    }
    const common = { tenantId: key.tenant_id, phoneNumberId: accountFor(req), to: req.body?.to, apiKeyId: key.id };
    const result =
      type === "text"
        ? await sendApiText({ ...common, text: req.body?.text })
        : await sendApiMedia({ ...common, type, url: req.body?.url, caption: req.body?.caption, filename: req.body?.filename });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to send the message");
  }
});

router.post("/messages/template", async (req, res) => {
  try {
    const key = req.whatsappApiKey;
    const body = req.body || {};
    const template = body.template;
    const result = await sendApiTemplate({
      tenantId: key.tenant_id,
      phoneNumberId: accountFor(req),
      apiKeyId: key.id,
      to: body.to,
      templateName: body.template_name || (typeof template === "string" ? template : template?.name) || "",
      templateId: body.template_id || (template && typeof template === "object" ? template.id : "") || "",
      language: body.language,
      variables: body.variables,
      buttonsVariables: body.buttons_variables || null,
      header: body.header && typeof body.header === "object" ? body.header : null,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to send the template");
  }
});

router.get("/messages/:wamid", async (req, res) => {
  try {
    const key = req.whatsappApiKey;
    return res.json({ success: true, message: await getApiMessage({ tenantId: key.tenant_id, wamid: req.params.wamid }) });
  } catch (error) {
    return fail(res, error, "Failed to load the message");
  }
});

router.post("/webhooks/:id/rotate-secret", async (req, res) => {
  try {
    const key = req.whatsappApiKey;
    const { webhook, secret } = await rotateWebhookSecret({ tenantId: key.tenant_id, id: req.params.id, phoneNumberId: key.phone_number_id || "" });
    return res.json({ success: true, webhook, secret });
  } catch (error) {
    return fail(res, error, "Failed to rotate the webhook secret");
  }
});

export default router;
