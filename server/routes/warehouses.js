import express from "express";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

import {

  getWarehouses,

  createWarehouse,

  updateWarehouse,

  deleteWarehouse,

  prepareWarehouseMerge,

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
   UPDATE WAREHOUSE
====================================================== */

router.patch(
  "/:id",

  protect,
  permit("warehouses", "update"),

  updateWarehouse
);

/* ======================================================
   PREPARE WAREHOUSE MERGE
====================================================== */

router.post(
  "/merge/prepare",

  protect,
  permit("warehouses", "delete"),

  prepareWarehouseMerge
);

/* ======================================================
   DELETE WAREHOUSE
====================================================== */

router.delete(
  "/:id",

  protect,
  permit("warehouses", "delete"),

  deleteWarehouse
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
