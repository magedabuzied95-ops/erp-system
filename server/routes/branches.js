import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { createBranch, deleteBranch, getBranches, updateBranch } from "../controllers/branchesController.js";

const router = express.Router();

router.get("/health", (req, res) => {
  res.status(200).json({ success: true, route: "branches" });
});

router.get("/", protect, getBranches);
router.post("/", protect, permit("branches", "create"), createBranch);
router.put("/:id", protect, permit("branches", "update"), updateBranch);
router.delete("/:id", protect, permit("branches", "delete"), deleteBranch);

export default router;
