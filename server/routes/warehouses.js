import express from "express";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

import {

  getWarehouses,

  createWarehouse,

  transferStock

} from "../controllers/warehousesController.js";

const router = express.Router();

/* ======================================================
   GET ALL WAREHOUSES
====================================================== */

router.get(
  "/",

  protect,
  permit("warehouses", "view"),

  getWarehouses
);

/* ======================================================
   CREATE WAREHOUSE
====================================================== */

router.post(
  "/",

  protect,
  permit("warehouses", "create"),

  createWarehouse
);

/* ======================================================
   TRANSFER STOCK
====================================================== */

router.post(
  "/transfer",

  protect,
  permit("warehouses", "transfer"),

  transferStock
);

export default router;