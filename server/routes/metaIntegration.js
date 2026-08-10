import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { getMetaWebhookUrl } from "../utils/publicUrl.js";
import {
  completeMetaOAuthCallback,
  getMetaCapabilities,
  getMetaHealth,
  getMetaIntegrationDebugConfigs,
  getMetaIntegrationRawDebugConfigs,
  getMetaIntegrationStatus,
  getMetaOAuthPages,
  getPublicWebhookVerificationConfig,
  getMetaSetupCheck,
  getMetaWebhookHealth,
  processMetaWebhook,
  saveMetaIntegrationConfig,
  saveInstagramBusinessAccessToken,
  removeInstagramBusinessAccessToken,
  saveInstagramAppSecret,
  removeInstagramAppSecret,
  selectMetaOAuthPage,
  startMetaOAuth,
  testMetaMessageCapability,
  testMetaIntegrationConfig,
  testMetaPublishCapability,
  verifyMetaWebhookEnablement,
} from "../services/metaIntegrationService.js";

const integrationRouter = express.Router();
const webhookRouter = express.Router();

const envText = (value = "") => String(value ?? "").trim();

const maskTokenForLog = (token = "") => {
  const text = envText(token);
  if (!text) return "";
  if (process.env.NODE_ENV !== "production") return text;
  if (text.length <= 6) return "***";
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
};

const getExpectedWebhookVerifyTokens = () =>
  [process.env.META_VERIFY_TOKEN, process.env.META_WEBHOOK_VERIFY_TOKEN]
    .map(envText)
    .filter(Boolean);

export const handleMetaWebhookVerification = async (req, res) => {
  const mode = envText(req.query?.["hub.mode"]);
  const verifyToken = envText(req.query?.["hub.verify_token"]);
  const challenge = envText(req.query?.["hub.challenge"]);
  const expectedTokens = getExpectedWebhookVerifyTokens();
  const envTokenMatched = expectedTokens.includes(verifyToken);
  const storedConfig = !envTokenMatched && verifyToken
    ? await getPublicWebhookVerificationConfig({ verifyToken }).catch(() => null)
    : null;
  const tokenMatched = mode === "subscribe" && Boolean(envTokenMatched || storedConfig);
  const challengePresent = challenge.length > 0;

  console.log("[meta-webhook] verification request", {
    method: req.method,
    path: req.originalUrl || req.url,
    mode,
    verify_token: maskTokenForLog(verifyToken),
    token_matched: tokenMatched,
    challenge_present: challengePresent,
    expected_token_configured: expectedTokens.length > 0,
  });

  res.type("text/plain");
  if (tokenMatched && challengePresent) {
    return res.status(200).send(challenge);
  }
  console.warn("[meta-webhook] verification failure", {
    mode,
    verify_token: maskTokenForLog(verifyToken),
    token_matched: tokenMatched,
    challenge_present: challengePresent,
    expected_token_configured: expectedTokens.length > 0,
  });
  return res.status(403).send("Invalid webhook verification request");
};

export const handleMetaWebhookSelfTest = async (req, res) => {
  const expectedTokens = getExpectedWebhookVerifyTokens();
  const verifyToken = expectedTokens[0] || "";
  const challenge = `selftest_${Date.now()}`;
  const localPort = Number(process.env.PORT || req.socket?.localPort || 8000) || 8000;
  const localUrl = new URL(`http://127.0.0.1:${localPort}/api/meta/webhook`);
  localUrl.searchParams.set("hub.mode", "subscribe");
  localUrl.searchParams.set("hub.verify_token", verifyToken);
  localUrl.searchParams.set("hub.challenge", challenge);

  const diagnostics = {
    checked_at: new Date().toISOString(),
    expected_public_url: getMetaWebhookUrl(),
    local_url: localUrl.toString(),
    reachable: false,
    challenge_ok: false,
    token_ok: false,
    response_format_ok: false,
    status: null,
    content_type: "",
    content_length: null,
    body_preview: "",
    error: "",
  };

  if (!verifyToken) {
    diagnostics.error = "META_VERIFY_TOKEN or META_WEBHOOK_VERIFY_TOKEN is not configured";
    return res.status(200).json({ success: false, ...diagnostics });
  }

  try {
    const response = await fetch(localUrl, { method: "GET" });
    const body = await response.text();
    diagnostics.status = response.status;
    diagnostics.content_type = response.headers.get("content-type") || "";
    diagnostics.content_length = body.length;
    diagnostics.body_preview = body.slice(0, 80);
    diagnostics.reachable = response.status === 200;
    diagnostics.challenge_ok = body === challenge;
    diagnostics.token_ok = response.status === 200 && body === challenge;
    diagnostics.response_format_ok = diagnostics.challenge_ok && body.trim() === body && !body.includes("\n") && !body.includes("\r");
    return res.status(200).json({
      success: diagnostics.reachable && diagnostics.challenge_ok && diagnostics.token_ok && diagnostics.response_format_ok,
      ...diagnostics,
    });
  } catch (error) {
    diagnostics.error = error?.message || "Self-test request failed";
    console.warn("[meta-webhook] self-test failed", diagnostics);
    return res.status(200).json({ success: false, ...diagnostics });
  }
};

const getMetaWebhookDiagnosticsState = () => {
  if (!globalThis.__META_WEBHOOK_DIAGNOSTICS__ || typeof globalThis.__META_WEBHOOK_DIAGNOSTICS__ !== "object") {
    globalThis.__META_WEBHOOK_DIAGNOSTICS__ = {
      raw_ingress: null,
      parsed_summary: null,
      ping_last: null,
    };
  }
  return globalThis.__META_WEBHOOK_DIAGNOSTICS__;
};

const toTenantId = (req) => {
  if (req.user) {
    return isSuperAdminUser(req.user)
      ? Number(req.query?.tenant_id || req.body?.tenant_id || req.user?.tenant_id || 1)
      : getTenantId(req, req.user?.tenant_id);
  }
  const parsed = Number(req.body?.tenant_id || req.query?.tenant_id || req.headers?.["x-tenant-id"]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

const sendError = (res, error, fallback = "Meta integration request failed") =>
  res.status(error?.status || 500).json({
    success: false,
    message: error?.message || fallback,
  });

integrationRouter.get("/status", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const status = await getMetaIntegrationStatus({ tenantId, req });
    res.json({ success: true, ...status });
  } catch (error) {
    sendError(res, error, "Unable to load Meta integration status");
  }
});

integrationRouter.post("/save-config", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    await saveMetaIntegrationConfig({ tenantId, data: req.body || {} });
    const status = await getMetaIntegrationStatus({ tenantId, req });
    res.json({ success: true, ...status });
  } catch (error) {
    sendError(res, error, "Unable to save Meta integration config");
  }
});

integrationRouter.post("/instagram/access-token", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await saveInstagramBusinessAccessToken({
      tenantId,
      accessToken: req.body?.access_token,
      expectedAccountId: req.body?.instagram_business_account_id,
      expiresAt: req.body?.expires_at || null,
    });
    res.json({
      success: true,
      data: result.config,
      webhook_subscribed: result.webhook_subscribed,
      warning: result.warning || "",
    });
  } catch (error) {
    sendError(res, error, "Unable to save Instagram access token");
  }
});

integrationRouter.delete("/instagram/access-token", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await removeInstagramBusinessAccessToken({ tenantId });
    res.json({ success: true, data: result.config });
  } catch (error) {
    sendError(res, error, "Unable to remove Instagram access token");
  }
});

integrationRouter.post("/instagram/app-secret", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await saveInstagramAppSecret({
      tenantId,
      appSecret: req.body?.app_secret,
    });
    res.json({ success: true, data: result.config });
  } catch (error) {
    sendError(res, error, "Unable to save Instagram App Secret");
  }
});

integrationRouter.delete("/instagram/app-secret", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await removeInstagramAppSecret({ tenantId });
    res.json({ success: true, data: result.config });
  } catch (error) {
    sendError(res, error, "Unable to remove Instagram App Secret");
  }
});

integrationRouter.post("/test", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await testMetaIntegrationConfig({ tenantId });
    const status = await getMetaIntegrationStatus({ tenantId, req });
    res.json({ success: true, test: result.meta, ...status });
  } catch (error) {
    sendError(res, error, "Meta connection test failed");
  }
});

webhookRouter.get("/health", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const health = await getMetaHealth({ tenantId, req });
    res.json({ success: true, data: health, ...health });
  } catch (error) {
    sendError(res, error, "Unable to load Meta health");
  }
});

webhookRouter.get("/capabilities", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const capabilities = await getMetaCapabilities({ tenantId, req, live: true });
    res.json({ success: true, data: capabilities, ...capabilities });
  } catch (error) {
    sendError(res, error, "Unable to load Meta capabilities");
  }
});

webhookRouter.get("/webhook-health", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const health = await getMetaWebhookHealth({ tenantId, req });
    res.json({ success: true, data: health, ...health });
  } catch (error) {
    sendError(res, error, "Unable to load Meta webhook health");
  }
});

webhookRouter.get("/webhook-subscribed-apps", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const status = await getMetaIntegrationStatus({ tenantId, req });
    const subscription = status?.subscription || {};
    console.log("[meta-webhook] subscribed_apps_debug", {
      tenant_id: tenantId,
      page_id: status?.page_id || "",
      subscribed_fields: Array.isArray(subscription?.subscribed_fields) ? subscription.subscribed_fields : [],
      app_installed: Boolean(subscription?.app_installed),
      page_subscription_present: Boolean(subscription?.page_subscription_present),
    });
    res.json({
      success: true,
      data: {
        tenant_id: tenantId,
        page_id: status?.page_id || "",
        callback_url: status?.callback_url || "",
        subscription,
        subscribed_fields: Array.isArray(subscription?.subscribed_fields) ? subscription.subscribed_fields : [],
        app_installed: Boolean(subscription?.app_installed),
        page_subscription_present: Boolean(subscription?.page_subscription_present),
        errors: Array.isArray(status?.errors) ? status.errors : [],
      },
    });
  } catch (error) {
    sendError(res, error, "Unable to load Meta subscribed apps");
  }
});

webhookRouter.post("/webhook-enable", protect, permit("settings", "edit"), async (req, res) => {
  console.log("[meta-webhook] webhook_enable_route_entered", {
    tenant_id: toTenantId(req),
    function: "webhookRouter.post('/webhook-enable')",
  });
  try {
    const tenantId = toTenantId(req);
    const subscription = await verifyMetaWebhookEnablement({ tenantId });
    const status = await getMetaIntegrationStatus({ tenantId, req });
    const success = Boolean(subscription.webhook_enabled && subscription.webhook_verified && subscription.subscribed_apps_verified);
    const message = subscription.error || (success ? "Webhook subscription verified" : "Unable to enable Meta webhook subscription");
    res.status(success ? 200 : 400).json({ success, message, data: { subscription, status }, subscription, status });
  } catch (error) {
    console.error("[meta-webhook] webhook_enable_route_failed", {
      tenant_id: toTenantId(req),
      function: "webhookRouter.post('/webhook-enable')",
      message: error?.message || "unknown",
      stack: error?.stack || "",
    });
    sendError(res, error, "Unable to enable Meta webhook subscription");
  }
});

webhookRouter.post("/test-message", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await testMetaMessageCapability({
      tenantId,
      channel: req.body?.channel || req.body?.platform || "facebook",
      recipientId: req.body?.recipient_id || req.body?.recipientId || "",
      message: req.body?.message || "",
    });
    res.json({ success: true, data: result, ...result });
  } catch (error) {
    sendError(res, error, "Meta message test failed");
  }
});

webhookRouter.post("/test-publish", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await testMetaPublishCapability({
      tenantId,
      platform: req.body?.platform || "facebook",
    });
    res.json({ success: true, data: result, ...result });
  } catch (error) {
    sendError(res, error, "Meta publish test failed");
  }
});

webhookRouter.get("/setup-check", protect, permit("settings", "view"), async (req, res) => {
  try {
    const setup = await getMetaSetupCheck({ req });
    res.json({ success: true, data: setup, ...setup });
  } catch (error) {
    sendError(res, error, "Unable to load Meta setup check");
  }
});

webhookRouter.get("/debug/configs", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await getMetaIntegrationDebugConfigs({ tenantId });
    res.json({ success: true, data: result, ...result });
  } catch (error) {
    sendError(res, error, "Unable to load Meta integration debug configs");
  }
});

webhookRouter.get("/debug/raw-configs", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await getMetaIntegrationRawDebugConfigs({ tenantId });
    res.json({ success: true, data: result, ...result });
  } catch (error) {
    sendError(res, error, "Unable to load raw Meta integration debug configs");
  }
});

webhookRouter.get("/oauth/start", protect, permit("marketing", "settings"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await startMetaOAuth({ tenantId, userId: req.user?.id || req.user?.user_id || null, req });
    if (req.query?.mode === "json" || req.get("accept")?.includes("application/json")) {
      return res.json({ success: true, data: result, ...result });
    }
    return res.redirect(302, result.auth_url);
  } catch (error) {
    sendError(res, error, "Unable to start Meta OAuth");
  }
});

webhookRouter.get("/oauth/callback", async (req, res) => {
  try {
    const html = await completeMetaOAuthCallback({
      code: req.query?.code,
      state: req.query?.state,
      error: req.query?.error,
      errorDescription: req.query?.error_description,
      req,
    });
    res.set("Content-Type", "text/html; charset=utf-8").status(200).send(html);
  } catch (error) {
    console.error("[meta-oauth] callback failed", { message: error?.message || "unknown" });
    res.status(500).send("Meta OAuth callback failed");
  }
});

webhookRouter.get("/oauth/pages", protect, permit("marketing", "settings"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await getMetaOAuthPages({ tenantId, userId: req.user?.id || req.user?.user_id || null });
    res.json({ success: true, data: result, ...result });
  } catch (error) {
    sendError(res, error, "Unable to load Meta OAuth pages");
  }
});

webhookRouter.post("/oauth/select-page", protect, permit("marketing", "settings"), async (req, res) => {
  try {
    const tenantId = toTenantId(req);
    const result = await selectMetaOAuthPage({
      tenantId,
      userId: req.user?.id || req.user?.user_id || null,
      pageId: req.body?.page_id || req.body?.pageId,
    });
    const status = await getMetaIntegrationStatus({ tenantId, req });
    res.json({ success: true, data: result, ...result, status });
  } catch (error) {
    sendError(res, error, "Unable to save selected Meta Page");
  }
});

webhookRouter.get("/webhook", handleMetaWebhookVerification);
webhookRouter.get("/webhook-self-test", handleMetaWebhookSelfTest);
webhookRouter.get("/webhook/ping", (req, res) => {
  return res.json({ success: true, route: "/api/meta/webhook", method: "GET" });
});

webhookRouter.post("/webhook", async (req, res) => {
  try {
    const entry = Array.isArray(req.body?.entry) ? req.body.entry : [];
    const firstEntry = entry[0] || {};
    const changeFields = [...new Set(
      entry.flatMap((item) =>
        Array.isArray(item?.changes)
          ? item.changes.map((change) => envText(change?.field || ""))
          : []
      ).filter(Boolean)
    )];
    const messagingCount = entry.reduce((count, item) => count + (Array.isArray(item?.messaging) ? item.messaging.length : 0), 0);
    const parsedSummary = {
      at: new Date().toISOString(),
      object: envText(req.body?.object || ""),
      entry_count: entry.length,
      first_entry_id: envText(firstEntry?.id || ""),
      change_fields: changeFields,
      messaging_count: messagingCount,
    };
    getMetaWebhookDiagnosticsState().parsed_summary = parsedSummary;
    console.log("[META_WEBHOOK_PARSED_SUMMARY]", parsedSummary);
    console.log("[META_WEBHOOK_ENTRY]", {
      method: req.method,
      url: req.url || "",
      originalUrl: req.originalUrl || req.url || "",
      has_signature_256: Boolean(req.headers?.["x-hub-signature-256"]),
      body_keys: req.body && typeof req.body === "object" ? Object.keys(req.body) : [],
    });
    console.log("[meta-webhook] event received", {
      content_type: req.get("content-type") || "",
      has_signature: Boolean(req.headers?.["x-hub-signature-256"]),
      entry_count: Array.isArray(req.body?.entry) ? req.body.entry.length : 0,
      object: req.body?.object || "",
    });
    const result = await processMetaWebhook({ req });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[meta-webhook] receive failed", {
      status: error?.status || 500,
      message: error?.message || "unknown",
    });
    res.status(error?.status || 500).json({ success: false, message: error?.message || "Meta webhook failed" });
  }
});

export { webhookRouter as metaWebhookRoutes };
export default integrationRouter;
