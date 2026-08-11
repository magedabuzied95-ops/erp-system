import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getOverview } from "../controllers/analyticsV2Controller.js";

const router = express.Router();

// reports:view is the entry gate. reports:cost and reports:profit are resolved inside
// the service layer (analyticsScope) and control which columns are computed at all,
// so a caller without them never receives a cost or profit value in the response.
router.get("/overview", protect, permit("reports", "view"), getOverview);

export default router;
