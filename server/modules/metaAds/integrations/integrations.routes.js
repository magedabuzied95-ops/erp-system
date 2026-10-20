// /api/meta-ads/integrations — connect (OAuth) + connected accounts.
// /api/meta-ads-public       — (no auth) OAuth callback + Ad Account webhook.

import express from "express";

import { handle, tenantOf } from "../metaAdsCore.js";
import { metaAdsManage, metaAdsView } from "../metaAdsGuards.js";
import {
  completeOAuth,
  connectSetupStatus,
  disconnectAccount,
  getPending,
  handleOAuthCallback,
  listConnectedAccounts,
  startOAuth,
} from "./oauth.js";
import { handleWebhookPost, handleWebhookVerify } from "./webhooks.js";

const router = express.Router();

router.get("/status", ...metaAdsView, handle(async (req) => ({ setup: connectSetupStatus(req) })));

router.get("/oauth/start", ...metaAdsManage, handle(async (req) => startOAuth(req, tenantOf(req))));

router.get("/oauth/pending", ...metaAdsManage, handle(async (req) => getPending(tenantOf(req), req.query?.state)));

router.post("/oauth/complete", ...metaAdsManage, handle(async (req) => completeOAuth(req, tenantOf(req), req.body || {})));

router.get("/accounts", ...metaAdsView, handle(async (req) => ({ accounts: await listConnectedAccounts(tenantOf(req)) })));

router.post("/accounts/:id/disconnect", ...metaAdsManage, handle(async (req) => disconnectAccount(tenantOf(req), req.params.id)));

// Mounted at /api/meta-ads-public with no auth (OAuth callback, webhook).
export const publicIntegrationsRoutes = express.Router();

publicIntegrationsRoutes.get("/oauth/callback", (req, res) => {
  handleOAuthCallback(req, res).catch(() => {
    if (!res.headersSent) res.status(500).send("Facebook connection failed");
  });
});

publicIntegrationsRoutes.get("/webhook", (req, res) => {
  handleWebhookVerify(req, res).catch(() => {
    if (!res.headersSent) res.status(403).send("Invalid verification request");
  });
});

publicIntegrationsRoutes.post("/webhook", (req, res) => {
  handleWebhookPost(req, res).catch(() => {
    if (!res.headersSent) res.status(200).json({ success: true });
  });
});

export default router;
