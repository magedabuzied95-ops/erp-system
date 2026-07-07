import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import {
  createUser,
  deleteUser,
  getUsers,
  updateUserRole,
  updateUserStatus,
} from "../controllers/usersController.js";

const router = express.Router();

const normalizeRoleValue = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

const requireAdminOnly = (req, res, next) => {
  const normalizedRole = normalizeRoleValue(req.user?.role || req.user?.role_name || "");
  const allowed =
    normalizedRole === "admin" ||
    normalizedRole === "super admin" ||
    normalizedRole === "superadmin" ||
    req.user?.is_super_admin === true;

  if (!allowed) {
    console.warn("[users] access denied", {
      route: `${req.method} ${req.originalUrl}`,
      userId: req.user?.id ?? null,
      role: req.user?.role || req.user?.role_name || null,
      tenantId: req.user?.tenant_id ?? null,
    });
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }

  return next();
};

router.use((req, _res, next) => {
  console.log("[users] route hit", {
    method: req.method,
    url: req.originalUrl,
  });
  next();
});

router.get("/", protect, requireAdminOnly, getUsers);
router.post("/", protect, requireAdminOnly, createUser);
router.put("/:id/role", protect, requireAdminOnly, updateUserRole);
router.patch("/:id/role", protect, requireAdminOnly, updateUserRole);
router.patch("/:id/status", protect, requireAdminOnly, updateUserStatus);
router.delete("/:id", protect, requireAdminOnly, deleteUser);

export default router;
