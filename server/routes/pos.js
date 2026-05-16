import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import { getRecentPosOrders } from "../controllers/ordersController.js";

const router = express.Router();

router.get(
  "/recent-orders",
  protect,
  getRecentPosOrders
);

export default router;
