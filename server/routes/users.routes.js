import express from "express";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

import {

  getUsers,
  createUser,
  updateUserRole,
  deleteUser

} from "../controllers/usersController.js";

const router = express.Router();

/* ======================================================
   GET USERS
====================================================== */

router.get(
  "/",

  protect,
  permit("users", "view"),

  getUsers
);

/* ======================================================
   CREATE USER
====================================================== */

router.post(
  "/",

  protect,
  permit("users", "create"),

  createUser
);

/* ======================================================
   UPDATE USER ROLE
====================================================== */

router.put(
  "/:id/role",

  protect,
  permit("users", "edit"),

  updateUserRole
);

/* ======================================================
   DELETE USER
====================================================== */

router.delete(
  "/:id",

  protect,
  permit("users", "delete"),

  deleteUser
);

export default router;