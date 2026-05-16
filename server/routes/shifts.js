import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getNextOpeningAssignment,
  getOpeningCandidates,
  getOpeningRotationReport,
} from "../controllers/attendanceController.js";

const router = express.Router();

router.get("/opening-candidates", protect, permit("attendance", "view"), getOpeningCandidates);
router.get("/next-opening", protect, permit("attendance", "view"), getNextOpeningAssignment);
router.get("/opening-rotation-report", protect, permit("attendance", "view"), getOpeningRotationReport);

export default router;
