import express from "express";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

import {
  addVariant,
} from "../controllers/variantController.js";

const router = express.Router();

/* ======================================================
   CREATE PRODUCT VARIANT
====================================================== */

router.post(
  "/",
  protect,
  permit("products", "create"),
  addVariant
);

export default router;