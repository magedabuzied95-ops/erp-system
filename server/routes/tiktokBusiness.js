// TikTok API for Business routes — status only, deliberately.
//
// This router is mounted at /api/tiktok-business and is NOT the same integration
// as /api/tiktok, which serves the TikTok for Developers app (Login Kit +
// Content Posting) and is live in production. Nothing here reads that app's
// credentials, tokens, or tables.
//
// WHY THERE IS NO OAUTH ROUTE HERE
// --------------------------------
// The Business authorization flow needs TIKTOK_BUSINESS_APP_ID, which TikTok
// issues only on approval. The "M1 Store ERP" app is PENDING, so an OAuth start
// route could not build a valid authorize URL — it could only build a plausible
// one that fails at TikTok's end with an opaque error. Writing that now would
// also mean guessing the Business authorization contract, which differs from the
// Login Kit contract and has not been read (the portal renders client-side).
//
// So this router exposes exactly what is true today: a status endpoint that
// reports the pending state and the precise blockers. The OAuth handlers land in
// the same file once the App ID exists and the authorization docs are read.
//
// RBAC mirrors /api/tiktok/status: permit("marketing", "settings").

import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  describeTikTokBusinessConfig,
  TIKTOK_BUSINESS_REQUESTED_PERMISSIONS,
} from "../services/tiktokBusinessConfigService.js";
import { describeTikTokBusinessMessagingCapability } from "../services/tiktokBusinessMessagingProvider.js";
import { describeTikTokBusinessCommentsCapability } from "../services/tiktokBusinessCommentsProvider.js";

const router = express.Router();

const tenantOf = (req) => getTenantId(req, req.user?.tenant_id) || 1;
const settingsGuard = [protect, permit("marketing", "settings")];

// The developer-app review state, as submitted to TikTok. Hardcoded because it
// is a fact about our portal application, not runtime state — there is no API
// that reports it back to us. Update it when TikTok's decision arrives.
export const TIKTOK_BUSINESS_APP_REVIEW = Object.freeze({
  app_name: "M1 Store ERP",
  portal: "business-api.tiktok.com",
  status: "PENDING",
  requested_permissions: [...TIKTOK_BUSINESS_REQUESTED_PERMISSIONS],
});

router.get("/status", ...settingsGuard, async (req, res) => {
  try {
    const config = describeTikTokBusinessConfig();
    res.json({
      success: true,
      data: {
        tenant_id: tenantOf(req),
        // No connection can exist before the app is approved. Stated as an
        // explicit false rather than omitted, so the client renders "awaiting
        // permission" instead of falling through to a generic empty state.
        connected: false,
        app_review: TIKTOK_BUSINESS_APP_REVIEW,
        config,
        messaging: describeTikTokBusinessMessagingCapability(),
        comments: describeTikTokBusinessCommentsCapability(),
        // Restated at the top level so a client does not have to infer the
        // distinction from two separate integrations' payloads.
        publishing_is_a_separate_integration: {
          endpoint: "/api/tiktok/status",
          note: "TikTok Content Posting uses a different app and different credentials. A connected publishing account does NOT grant messaging or comments.",
        },
      },
    });
  } catch (error) {
    // Config description is pure and should not throw; if it does, report a
    // generic failure rather than echoing a message that may name env vars.
    console.error("[tiktok-business] status failed", { code: error?.code || "" });
    res.status(500).json({
      success: false,
      code: error?.code || "",
      message: "Failed to load TikTok Business status",
    });
  }
});

export default router;
