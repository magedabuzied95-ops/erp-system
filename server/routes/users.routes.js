import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createUser,
  deleteUser,
  getUsers,
  updateUser,
  updateUserPassword,
  updateUserRole,
  updateUserStatus,
} from "../controllers/usersController.js";

const router = express.Router();

router.use((req, _res, next) => {
  console.log("[users] route hit", {
    method: req.method,
    url: req.originalUrl,
  });
  next();
});

router.get("/", protect, permit("users", "view"), getUsers);
router.post("/", protect, permit("users", "create"), createUser);
router.put("/:id", protect, permit("users", "edit"), updateUser);
router.put("/:id/password", protect, permit("users", "edit"), updateUserPassword);
router.put("/:id/role", protect, permit("users", "edit"), updateUserRole);
router.patch("/:id/role", protect, permit("users", "edit"), updateUserRole);
router.patch("/:id/status", protect, permit("users", "edit"), updateUserStatus);
router.delete("/:id", protect, permit("users", "delete"), deleteUser);

export default router;
