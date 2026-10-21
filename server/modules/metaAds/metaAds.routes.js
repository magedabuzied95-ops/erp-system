// /api/meta-ads — authenticated Meta Ads API. Every route: protect → permit(meta_ads, view|manage)
// (metaAdsGuards.js). Sub-routers:
//   manager/       Ads Manager screen + create wizard (bootstrap, manager-data, drafts, publish, rules…)
//   records/       list + record pages for every Meta Ads table (accounts, campaigns, leads, competitors…)
//   integrations/  connect (OAuth), webhooks, click attribution, conversions API, competitor scans
// /api/meta-ads-public — unauthenticated: OAuth callback + Meta webhook (signature-checked).

import express from "express";

import { isMetaAdsSchemaReady } from "./metaAdsSchema.js";
import { metaAdsReviewerGuard } from "./metaAdsReviewer.js";
import managerRoutes from "./manager/manager.routes.js";
import recordsRoutes from "./records/records.routes.js";
import integrationsRoutes, { publicIntegrationsRoutes } from "./integrations/integrations.routes.js";

const notReady = (req, res, next) => {
  if (isMetaAdsSchemaReady()) return next();
  return res.status(503).json({ success: false, code: "META_ADS_NOT_READY", message: "Meta Ads is not initialised on this server" });
};

const router = express.Router();
router.use(notReady);
// Meta App Review account: drafts only, paused publish, no personal data (metaAdsReviewer.js).
router.use(metaAdsReviewerGuard);
router.use("/manager", managerRoutes);
router.use("/records", recordsRoutes);
router.use("/integrations", integrationsRoutes);

export const metaAdsPublicRoutes = express.Router();
metaAdsPublicRoutes.use(notReady);
metaAdsPublicRoutes.use(publicIntegrationsRoutes);

export default router;
