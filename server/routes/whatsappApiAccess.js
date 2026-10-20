import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  WEBHOOK_EVENTS,
  createApiKey,
  createWebhook,
  deleteApiKey,
  deleteWebhook,
  listApiKeys,
  listWebhooks,
  listWhatsappAccounts,
  testWebhook,
  updateApiKey,
  updateWebhook,
} from "../services/whatsappApiAccessService.js";

/*
 * WhatsApp developer access (inbox top bar → WhatsApp → API Keys / API Webhooks).
 * Mounted at /api/whatsapp/developer. Read is settings:view; creating, changing or deleting a key
 * or webhook is settings:edit — a key can send messages as the shop.
 *
 * A key's plaintext and a webhook's signing secret are returned exactly once, by the POST that
 * creates them. No other route ever returns either.
 */

const router = express.Router();

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;
const userOf = (req) => req.user?.id || req.user?.userId || null;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[whatsapp-developer:error]", { code: error?.code, message: error?.message });
  return res.status(status).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "WHATSAPP_DEVELOPER_ERROR",
  });
};

router.get("/accounts", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, accounts: await listWhatsappAccounts({ tenantId: tenantOf(req) }), events: WEBHOOK_EVENTS });
  } catch (error) {
    return fail(res, error, "Failed to load WhatsApp accounts");
  }
});

/* ------------------------------------------------------------------ keys */

router.get("/keys", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, keys: await listApiKeys({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to load API keys");
  }
});

router.post("/keys", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const { key, plaintext } = await createApiKey({ tenantId: tenantOf(req), userId: userOf(req), input: req.body || {} });
    res.set("Cache-Control", "no-store");
    return res.status(201).json({ success: true, key, plaintext });
  } catch (error) {
    return fail(res, error, "Failed to create the API key");
  }
});

router.patch("/keys/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json({ success: true, key: await updateApiKey({ tenantId: tenantOf(req), id: req.params.id, input: req.body || {} }) });
  } catch (error) {
    return fail(res, error, "Failed to update the API key");
  }
});

router.delete("/keys/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json({ success: true, ...(await deleteApiKey({ tenantId: tenantOf(req), id: req.params.id })) });
  } catch (error) {
    return fail(res, error, "Failed to delete the API key");
  }
});

/* ------------------------------------------------------------------ webhooks */

router.get("/webhooks", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, webhooks: await listWebhooks({ tenantId: tenantOf(req) }), events: WEBHOOK_EVENTS });
  } catch (error) {
    return fail(res, error, "Failed to load webhooks");
  }
});

router.post("/webhooks", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const { webhook, secret } = await createWebhook({ tenantId: tenantOf(req), input: req.body || {} });
    res.set("Cache-Control", "no-store");
    return res.status(201).json({ success: true, webhook, secret });
  } catch (error) {
    return fail(res, error, "Failed to create the webhook");
  }
});

router.patch("/webhooks/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json({ success: true, webhook: await updateWebhook({ tenantId: tenantOf(req), id: req.params.id, input: req.body || {} }) });
  } catch (error) {
    return fail(res, error, "Failed to update the webhook");
  }
});

router.delete("/webhooks/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json({ success: true, ...(await deleteWebhook({ tenantId: tenantOf(req), id: req.params.id })) });
  } catch (error) {
    return fail(res, error, "Failed to delete the webhook");
  }
});

router.post("/webhooks/:id/test", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await testWebhook({ tenantId: tenantOf(req), id: req.params.id });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to test the webhook");
  }
});

export default router;
