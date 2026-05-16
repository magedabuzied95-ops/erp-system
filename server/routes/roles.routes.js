import express from "express";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

import {

  getRoles,
  getRolePermissionsByRole,

  createRole,

  updateRolePermissions,

  deleteRole

} from "../controllers/rolesController.js";

const router =
  express.Router();

router.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, route: "/api/roles" });
});

/* ======================================================
   GET ALL ROLES
====================================================== */

router.get(
  "/",

  protect,
  permit("roles", "view"),

  getRoles
);

router.get(
  "/:roleId/permissions",

  protect,
  permit("roles", "view"),

  getRolePermissionsByRole
);

/* ======================================================
   CREATE ROLE
====================================================== */

router.post(
  "/",

  protect,
  permit("roles", "create"),

  createRole
);

/* ======================================================
   UPDATE ROLE PERMISSIONS
====================================================== */

router.put(
  "/:roleId/permissions",

  protect,
  permit("roles", "edit"),

  updateRolePermissions
);

/* ======================================================
   DELETE ROLE
====================================================== */

router.delete(
  "/:id",

  protect,
  permit("roles", "delete"),

  deleteRole
);

export default router;
