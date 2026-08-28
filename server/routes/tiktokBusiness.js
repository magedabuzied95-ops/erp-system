// TikTok API for Business routes — OAuth, status, and comment actions.
//
// Mounted at /api/tiktok-business. NOT the same integration as /api/tiktok,
// which serves the TikTok for Developers app (Login Kit + Content Posting) and
// is live in production. Nothing here reads that app's credentials, tokens, or
// tables.
//
// ROUTE MAP
//   GET  /status                    auth'd   real connection + capability state
//   POST /oauth/start               auth'd   mint CSRF state, return authorize URL
//   GET  /oauth/callback(/)         PUBLIC   TikTok redirects the browser here
//   POST /disconnect                auth'd   revoke + clear tokens
//   POST /refresh                   auth'd   force token refresh + re-detect
//   POST /comments/sync             auth'd   manual comment sync pass
//
// The callback is public by necessity (it is the OAuth redirect target) and is
// safe because it acts only on a single-use, expiring state token minted by an
// authenticated /oauth/start call — the tenant comes from the state row, never
// from the request.

import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  describeTikTokBusinessConfig,
  TIKTOK_BUSINESS_REQUESTED_PERMISSIONS,
  tiktokBusinessCommentsEnabled,
  tiktokBusinessEnabled,
} from "../services/tiktokBusinessConfigService.js";
import { describeTikTokBusinessMessagingCapability } from "../services/tiktokBusinessMessagingProvider.js";
import { describeTikTokBusinessCommentsCapability } from "../services/tiktokBusinessCommentsProvider.js";
import { describeTikTokBusinessFailure, redactTikTokBusinessError } from "../services/tiktokBusinessApiClient.js";
import {
  createTikTokBusinessOAuthState,
  disconnectTikTokBusiness,
  ensureTikTokBusinessSchema,
  getTikTokBusinessConnectionStatus,
  handleTikTokBusinessOAuthCallback,
  refreshTikTokBusinessTokenIfNeeded,
} from "../services/tiktokBusinessOAuthService.js";
import { invalidateTikTokBusinessCapabilityCache } from "../services/tiktokBusinessCapabilityService.js";
import { syncTikTokCommentsForTenant } from "../services/tiktokBusinessCommentsSyncService.js";
import { tiktokAppOrigin, TIKTOK_CHANNEL_SETTINGS_PATH } from "../services/tiktokConfigService.js";

const router = express.Router();
const text = (value = "") => String(value ?? "").trim();

const tenantOf = (req) => getTenantId(req, req.user?.tenant_id) || 1;
const settingsGuard = [protect, permit("marketing", "settings")];

// Schema is created lazily on the first Business request, never at import time:
// a disabled deployment must not run DDL at boot (a stuck ALTER at startup has
// browned out production before).
let schemaReadyPromise = null;
const ensureSchemaReady = () => {
  if (!tiktokBusinessEnabled()) return Promise.resolve(false);
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureTikTokBusinessSchema().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

// The developer-app review state. APPROVED was verified manually in the portal
// on 2026-08-28 (TikTok Accounts > Account Comment: Get + Manage). Hardcoded
// because it is a fact about our portal application — there is no API that
// reports it — but it is presentation metadata only: every capability decision
// comes from the live token, never from this object.
export const TIKTOK_BUSINESS_APP_REVIEW = Object.freeze({
  app_name: "M1 Store ERP",
  portal: "business-api.tiktok.com",
  status: "APPROVED",
  approved_at: "2026-08-28",
  requested_permissions: [...TIKTOK_BUSINESS_REQUESTED_PERMISSIONS],
});

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  const message = status >= 500 ? fallback : redactTikTokBusinessError(error) || fallback;
  console.error("[tiktok-business] request failed", describeTikTokBusinessFailure(error));
  res.status(status).json({ success: false, code: text(error?.code), message });
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

router.get("/status", ...settingsGuard, async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const config = describeTikTokBusinessConfig();

    let connection = { connected: false, status: "not_connected", account: null };
    let comments = null;
    let messaging = null;
    if (tiktokBusinessEnabled()) {
      await ensureSchemaReady();
      const { row: _row, ...safeConnection } = await getTikTokBusinessConnectionStatus({ tenantId });
      connection = safeConnection;
      // probe=true only when the caller asks for a live check — the default
      // status render must stay cheap.
      const probe = ["1", "true"].includes(text(req.query?.probe).toLowerCase());
      comments = await describeTikTokBusinessCommentsCapability({ tenantId, probe });
      messaging = await describeTikTokBusinessMessagingCapability({ tenantId });
    } else {
      comments = { status: "DISABLED", available: false, reason: "TIKTOK_BUSINESS_ENABLED is not set" };
      messaging = await describeTikTokBusinessMessagingCapability({ tenantId: null });
    }

    res.json({
      success: true,
      data: {
        tenant_id: tenantId,
        connected: Boolean(connection.connected),
        connection,
        app_review: TIKTOK_BUSINESS_APP_REVIEW,
        config,
        messaging,
        comments,
        publishing_is_a_separate_integration: {
          endpoint: "/api/tiktok/status",
          note: "TikTok Content Posting uses a different app and different credentials. A connected publishing account does NOT grant messaging or comments.",
        },
      },
    });
  } catch (error) {
    fail(res, error, "Failed to load TikTok Business status");
  }
});

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

router.post("/oauth/start", ...settingsGuard, async (req, res) => {
  try {
    await ensureSchemaReady();
    const { authorize_url, state, expires_in_ms } = await createTikTokBusinessOAuthState({
      tenantId: tenantOf(req),
      userId: req.user?.id || null,
    });
    res.json({ success: true, data: { authorize_url, state, expires_in_ms } });
  } catch (error) {
    fail(res, error, "Failed to start TikTok Business authorization");
  }
});

// Where the browser lands after the callback: the AI Inbox integrations center,
// TikTok tab — the same destination the publishing OAuth uses.
const settingsRedirect = (params = {}) => {
  const origin = tiktokAppOrigin();
  const query = new URLSearchParams({ integrations: "tiktok", ...params });
  return `${origin}${TIKTOK_CHANNEL_SETTINGS_PATH}?${query.toString()}`;
};

const oauthCallbackHandler = async (req, res) => {
  try {
    await ensureSchemaReady();
    const { tenantId, scopes } = await handleTikTokBusinessOAuthCallback({
      code: req.query?.code || req.query?.auth_code,
      state: req.query?.state,
      error: req.query?.error,
      errorDescription: req.query?.error_description,
    });
    invalidateTikTokBusinessCapabilityCache(tenantId);
    console.log("[tiktok-business] connected", { tenant_id: tenantId, scope_count: scopes.length });
    res.redirect(settingsRedirect({ tiktok_business: "connected" }));
  } catch (error) {
    console.error("[tiktok-business] oauth callback failed", describeTikTokBusinessFailure(error));
    res.redirect(settingsRedirect({ tiktok_business: "error", reason: text(error?.code) || "oauth_failed" }));
  }
};

// Registered with and without the trailing slash: TikTok requires the
// registered redirect URL to end with "/", while the historical registration
// may not — the handler accepts both so a portal-side migration cannot break
// the flow mid-way.
router.get("/oauth/callback", oauthCallbackHandler);
router.get("/oauth/callback/", oauthCallbackHandler);

router.post("/disconnect", ...settingsGuard, async (req, res) => {
  try {
    await ensureSchemaReady();
    const tenantId = tenantOf(req);
    const result = await disconnectTikTokBusiness({ tenantId });
    invalidateTikTokBusinessCapabilityCache(tenantId);
    res.json({ success: true, data: result });
  } catch (error) {
    fail(res, error, "Failed to disconnect TikTok Business");
  }
});

router.post("/refresh", ...settingsGuard, async (req, res) => {
  try {
    await ensureSchemaReady();
    const tenantId = tenantOf(req);
    const { refreshed, reason } = await refreshTikTokBusinessTokenIfNeeded({ tenantId, force: true });
    invalidateTikTokBusinessCapabilityCache(tenantId);
    const comments = await describeTikTokBusinessCommentsCapability({ tenantId, probe: true });
    res.json({ success: true, data: { refreshed, reason: reason || "", comments } });
  } catch (error) {
    fail(res, error, "Failed to refresh the TikTok Business token");
  }
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

router.post("/comments/sync", ...settingsGuard, async (req, res) => {
  try {
    if (!tiktokBusinessCommentsEnabled()) {
      return res.status(503).json({
        success: false,
        code: "TIKTOK_BUSINESS_COMMENTS_DISABLED",
        message: "TikTok Business comments are disabled (TIKTOK_BUSINESS_COMMENTS_ENABLED is not set)",
      });
    }
    await ensureSchemaReady();
    const result = await syncTikTokCommentsForTenant({ tenantId: tenantOf(req) });
    res.status(result.success ? 200 : 409).json({ success: result.success, data: result });
  } catch (error) {
    fail(res, error, "Failed to sync TikTok comments");
  }
});

export default router;
