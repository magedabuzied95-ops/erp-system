// /api/meta-ads/manager — the Ads Manager screen.
//   list/    bootstrap, manager-data (3 levels + insights), status, duplicate, delete draft,
//            insights series/breakdown/sync, sync, automated rules
//   wizard/  drafts tree, validate, publish, preview, media upload, search, reach estimate,
//            saved audiences
import express from "express";

import listRoutes from "./list/list.routes.js";
import wizardRoutes from "./wizard/wizard.routes.js";

const router = express.Router();
router.use(listRoutes);
router.use("/wizard", wizardRoutes);

export default router;
