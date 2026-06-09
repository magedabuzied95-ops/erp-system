import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  approveSession,
  cancelSession,
  createSession,
  getSession,
  listSessions,
  lookupVariants,
  openSession,
  rejectSession,
  reopenSession,
  submitSession,
  updateSession,
  upsertItem,
} from "../controllers/inventoryCountController.js";

const router = express.Router();

router.get("/sessions", protect, permit("inventory", "view"), listSessions);
router.post("/sessions", protect, permit("inventory", "edit"), createSession);
router.get("/sessions/:id", protect, permit("inventory", "view"), getSession);
router.patch("/sessions/:id", protect, permit("inventory", "edit"), updateSession);
router.post("/sessions/:id/open", protect, permit("inventory", "edit"), openSession);
router.post("/sessions/:id/submit", protect, permit("inventory", "edit"), submitSession);
router.post("/sessions/:id/reject", protect, rejectSession);
router.post("/sessions/:id/reopen", protect, reopenSession);
router.get("/sessions/:id/lookup", protect, permit("inventory", "view"), lookupVariants);
router.put("/sessions/:id/items", protect, permit("inventory", "edit"), upsertItem);
router.post("/sessions/:id/approve", protect, approveSession);
router.post("/sessions/:id/cancel", protect, permit("inventory", "edit"), cancelSession);

export default router;
