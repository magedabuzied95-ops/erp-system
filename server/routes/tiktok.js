// TikTok integration routes.
//
// RBAC mirrors the Meta integration exactly:
//   connect / disconnect / status  -> permit("marketing", "settings")
//   publish / posting options      -> permit("marketing", "publish")
// The OAuth callback is necessarily unauthenticated (TikTok calls it, not a
// logged-in browser); its authorisation is the single-use signed state token.

import express from "express";
import crypto from "node:crypto";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  TIKTOK_CHANNEL_SETTINGS_PATH,
  TIKTOK_CHANNEL_SETTINGS_QUERY,
  describeTikTokConfig,
  tiktokAppOrigin,
  tiktokEnabled,
} from "../services/tiktokConfigService.js";
import { redactTikTokError } from "../services/tiktokApiClient.js";
import {
  createTikTokOAuthState,
  disconnectTikTok,
  getTikTokConnectionStatus,
  handleTikTokOAuthCallback,
  refreshTikTokTokenIfNeeded,
} from "../services/tiktokOAuthService.js";
import {
  TIKTOK_POST_MODES,
  getTikTokPostingOptions,
  listTikTokPublishJobs,
  publishToTikTok,
  syncTikTokPublishStatus,
} from "../services/tiktokPublisherService.js";
import { describeTikTokCommentsCapability } from "../services/tiktokCommentsProvider.js";

const router = express.Router();

const text = (value = "") => String(value ?? "").trim();
const tenantOf = (req) => getTenantId(req, req.user?.tenant_id) || 1;

const settingsGuard = [protect, permit("marketing", "settings")];
const publishGuard = [protect, permit("marketing", "publish")];

const fail = (res, error, fallbackMessage) => {
  const status = Number(error?.status) || 500;
  // Never surface a raw upstream message on a 5xx: it can carry log ids and
  // request echoes. 4xx messages are ours and are safe to show.
  const message = status >= 500 ? fallbackMessage : redactTikTokError(error) || fallbackMessage;
  return res.status(status).json({ success: false, code: error?.code || "", message });
};

const enabledGuard = (req, res, next) => {
  if (!tiktokEnabled()) {
    return res.status(503).json({ success: false, code: "TIKTOK_DISABLED", message: "TikTok integration is disabled" });
  }
  return next();
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

router.get("/status", ...settingsGuard, async (req, res) => {
  try {
    const connection = await getTikTokConnectionStatus({ tenantId: tenantOf(req) });
    res.json({
      success: true,
      data: {
        ...connection,
        config: describeTikTokConfig(),
        comments: describeTikTokCommentsCapability(),
      },
    });
  } catch (error) {
    console.error("[tiktok] status failed", { message: redactTikTokError(error) });
    fail(res, error, "Failed to load TikTok status");
  }
});

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

router.post("/oauth/start", enabledGuard, ...settingsGuard, async (req, res) => {
  try {
    const { authorize_url: authorizeUrl, expires_in_ms: expiresInMs } = await createTikTokOAuthState({
      tenantId: tenantOf(req),
      userId: req.user?.id || null,
    });
    // Returned as JSON rather than a 302 so the SPA controls the navigation and
    // can show its "Connecting…" state before leaving.
    res.json({ success: true, data: { authorize_url: authorizeUrl, expires_in_ms: expiresInMs } });
  } catch (error) {
    console.error("[tiktok] oauth start failed", { code: error?.code || "", message: redactTikTokError(error) });
    fail(res, error, "Failed to start TikTok authorization");
  }
});

// Public: TikTok redirects the user's browser here. Authorisation is the
// single-use state token, not a session.
router.get("/oauth/callback", async (req, res) => {
  // The ERP app origin, never the storefront — see tiktokAppOrigin().
  const appOrigin = tiktokAppOrigin() || "/";
  const backTo = (params) => {
    // Must match the SPA route registered in src/App.jsx ("admin/ai-inbox"),
    // otherwise the user lands on a 404 after approving on TikTok. The extra
    // query opens the integrations center straight on the TikTok tab.
    const url = new URL(TIKTOK_CHANNEL_SETTINGS_PATH, appOrigin);
    Object.entries({ ...TIKTOK_CHANNEL_SETTINGS_QUERY, ...params }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return url.toString();
  };

  try {
    const result = await handleTikTokOAuthCallback({
      code: req.query?.code,
      state: req.query?.state,
      error: req.query?.error,
      errorDescription: req.query?.error_description,
    });
    if (result.denied) {
      return res.redirect(backTo({ tiktok: "denied", reason: result.code || "declined" }));
    }
    return res.redirect(backTo({ tiktok: "connected" }));
  } catch (error) {
    console.error("[tiktok] oauth callback failed", { code: error?.code || "", message: redactTikTokError(error) });
    // The error code is safe (it is one of ours); the message is not echoed.
    return res.redirect(backTo({ tiktok: "error", reason: error?.code || "callback_failed" }));
  }
});

router.post("/oauth/refresh", enabledGuard, ...settingsGuard, async (req, res) => {
  try {
    const result = await refreshTikTokTokenIfNeeded({ tenantId: tenantOf(req), force: true });
    res.json({ success: true, data: { refreshed: Boolean(result.refreshed), reason: result.reason || "" } });
  } catch (error) {
    fail(res, error, "Failed to refresh TikTok token");
  }
});

router.post("/disconnect", ...settingsGuard, async (req, res) => {
  try {
    const result = await disconnectTikTok({ tenantId: tenantOf(req) });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[tiktok] disconnect failed", { message: redactTikTokError(error) });
    fail(res, error, "Failed to disconnect TikTok");
  }
});

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

// Dynamic options straight from TikTok. The UI must call this immediately
// before rendering the publish form — TikTok requires the displayed options to
// be the creator's current ones, and they are never cached or hardcoded.
router.get("/posting-options", enabledGuard, ...publishGuard, async (req, res) => {
  try {
    const options = await getTikTokPostingOptions({ tenantId: tenantOf(req) });
    res.json({ success: true, data: options });
  } catch (error) {
    fail(res, error, "Failed to load TikTok posting options");
  }
});

router.post("/publish", enabledGuard, ...publishGuard, async (req, res) => {
  try {
    const body = req.body || {};
    const postMode = text(body.post_mode).toUpperCase() === TIKTOK_POST_MODES.INBOX_UPLOAD
      ? TIKTOK_POST_MODES.INBOX_UPLOAD
      : TIKTOK_POST_MODES.DIRECT_POST;

    // A client-supplied key lets a retried request collapse onto the same job.
    // Falling back to a random one keeps a missing key from silently disabling
    // idempotency for every caller.
    const idempotencyKey = text(body.idempotency_key) || crypto.randomUUID();

    const result = await publishToTikTok({
      tenantId: tenantOf(req),
      userId: req.user?.id || null,
      socialPublisherPostId: body.social_publisher_post_id || null,
      idempotencyKey,
      mediaUrl: body.media_url,
      postMode,
      options: body.options || {},
    });

    res.status(result.duplicate ? 200 : 202).json({
      success: true,
      duplicate: Boolean(result.duplicate),
      message: result.duplicate
        ? "This TikTok publish was already submitted"
        : postMode === TIKTOK_POST_MODES.INBOX_UPLOAD
          ? "Video sent to your TikTok drafts"
          : "TikTok post submitted",
      data: result,
    });
  } catch (error) {
    console.error("[tiktok] publish failed", { code: error?.code || "", message: redactTikTokError(error) });
    fail(res, error, "Failed to publish to TikTok");
  }
});

router.get("/publish/:jobId/status", enabledGuard, ...publishGuard, async (req, res) => {
  try {
    const result = await syncTikTokPublishStatus({ tenantId: tenantOf(req), jobId: req.params.jobId });
    res.json({ success: true, data: result });
  } catch (error) {
    fail(res, error, "Failed to load TikTok publish status");
  }
});

router.get("/publish", enabledGuard, ...publishGuard, async (req, res) => {
  try {
    const jobs = await listTikTokPublishJobs({ tenantId: tenantOf(req), limit: req.query?.limit });
    res.json({ success: true, data: jobs });
  } catch (error) {
    fail(res, error, "Failed to list TikTok publish jobs");
  }
});

export default router;
