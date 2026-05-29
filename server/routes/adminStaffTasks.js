import express from "express";
import { testEmployeePortalPush } from "../controllers/staffTasksController.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();

router.post("/push/test", protect, permit("staff_tasks", "manage"), testEmployeePortalPush);

export default router;
