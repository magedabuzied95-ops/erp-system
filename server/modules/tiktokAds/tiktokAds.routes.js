// /api/tiktok-ads — authenticated TikTok Ads API. Every route: protect → permit(tiktok_ads, view|manage).
//   view   = read the TikTok Ads screens
//   manage = connect / disconnect / sync
// The OAuth callback is not mounted here: TikTok redirects to the app's one registered
// advertiser redirect URL (/api/tiktok-business/oauth/callback), which hands any state
// starting with "tta_" to tiktokAdsOAuthCallback below.

import express from "express";

import { protect } from "../../middleware/authMiddleware.js";
import permit from "../../middleware/permissionMiddleware.js";
import { adminOriginFor, frontendOrigin } from "../metaAds/integrations/oauth.js";
import { isTikTokAdsSchemaReady } from "./tiktokAdsSchema.js";
import {
  completeOAuth,
  describeTikTokAdsSetup,
  disconnectAccount,
  getAccountContext,
  handle,
  listAccounts,
  peekReturnTo,
  startOAuth,
  syncAll,
  tenantOf,
  text,
} from "./tiktokAdsCore.js";
import { loadBootstrap, loadListData } from "./tiktokAdsRead.js";
import { redactTikTokAds } from "./tiktokAdsApi.js";

const CONNECT_PATH = "/tiktok-ads/connect";
const view = [protect, permit("tiktok_ads", "view")];
const manage = [protect, permit("tiktok_ads", "manage")];

const router = express.Router();

router.use((req, res, next) => {
  if (isTikTokAdsSchemaReady()) return next();
  return res.status(503).json({ success: false, code: "TIKTOK_ADS_NOT_READY", message: "TikTok Ads is not initialised on this server" });
});

router.get("/setup", ...view, handle(async (req) => ({ setup: describeTikTokAdsSetup(), accounts: await listAccounts(tenantOf(req)) })));
router.get("/bootstrap", ...view, handle(async (req) => loadBootstrap(tenantOf(req))));
router.get("/data", ...view, handle(async (req) => loadListData(tenantOf(req), req.query)));

router.post("/oauth/start", ...manage, handle(async (req) => {
  const returnTo = `${adminOriginFor(req) || frontendOrigin(req)}${CONNECT_PATH}`;
  return startOAuth({ tenantId: tenantOf(req), userId: Number(req.user?.id) || null, returnTo });
}));

router.post("/accounts/:id/sync", ...manage, handle(async (req) => {
  const ctx = await getAccountContext(tenantOf(req), req.params.id);
  const days = Math.min(90, Math.max(1, Number(req.body?.days) || 30));
  return { result: await syncAll(ctx, { days }) };
}));

router.post("/accounts/:id/disconnect", ...manage, handle(async (req) => disconnectAccount(tenantOf(req), req.params.id)));

// Browser lands here from TikTok (via the TikTok Business callback). Never throws: every
// outcome is a redirect back to the connect page with a status the page can show.
export const tiktokAdsOAuthCallback = async (req, res) => {
  const state = text(req.query?.state);
  const fallback = await peekReturnTo(state).catch(() => "");
  const back = (returnTo, params) => {
    const target = text(returnTo) || text(fallback) || CONNECT_PATH;
    const join = target.includes("?") ? "&" : "?";
    res.redirect(`${target}${join}${new URLSearchParams(params).toString()}`);
  };
  try {
    if (!isTikTokAdsSchemaReady()) throw Object.assign(new Error("TikTok Ads is not initialised"), { code: "TIKTOK_ADS_NOT_READY" });
    // The doc's example redirect carries both `code` and `auth_code`; auth_code is the advertiser one.
    const { returnTo, accountIds, tenantId } = await completeOAuth({ state, authCode: req.query?.auth_code || req.query?.code });
    console.log("[tiktok-ads] connected", { tenant_id: tenantId, accounts: accountIds.length });
    // First pull right away so the list is not empty on arrival; failures surface on the page.
    for (const accountId of accountIds) {
      void getAccountContext(tenantId, accountId)
        .then((ctx) => syncAll(ctx, { days: 30 }))
        .catch((error) => console.warn("[tiktok-ads] first sync failed", { message: redactTikTokAds(error) }));
    }
    back(returnTo, { tiktok_ads: "connected" });
  } catch (error) {
    console.warn("[tiktok-ads] oauth callback failed", { code: error?.code, message: redactTikTokAds(error) });
    back("", { tiktok_ads: "error", reason: text(error?.code) || "oauth_failed" });
  }
};

export default router;
