import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getSubscription, updateSubscription } from "../controllers/tenantsController.js";

const router = express.Router();

router.get("/current", protect, permit("settings", "view"), getSubscription);
router.put("/current", protect, permit("settings", "edit"), updateSubscription);

export default router;
