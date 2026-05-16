import express from "express";

import db from "../database/db.js";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();

/* =========================
   AI DASHBOARD SUMMARY
========================= */

router.get(
  "/summary",

  protect,
  permit("dashboard", "view"),

  async (req, res) => {

    try {

      const orders =
        await db.query(
          "SELECT * FROM orders"
        );

      const products =
        await db.query(
          "SELECT * FROM products"
        );

      const variants =
        await db.query(
          "SELECT * FROM product_variants"
        );

      const totalRevenue =
        orders.rows.reduce(
          (acc, o) =>
            acc + Number(o.total_price || 0),
          0
        );

      const lowStock =
        variants.rows.filter(
          (v) => v.stock <= 5
        ).length;

      const summary = {

        message:

          totalRevenue > 10000

          ? "🔥 Your business is performing strongly with high revenue growth"

          : "⚠️ Your business needs attention to increase sales",

        insights: [

          `Total Orders: ${orders.rows.length}`,

          `Total Products: ${products.rows.length}`,

          `Revenue: $${totalRevenue}`,

          `Low Stock Items: ${lowStock}`

        ]
      };

      res.json(summary);

    } catch (error) {

      console.log(error);

      res.status(500).json({
        message: "AI Error"
      });

    }

  }
);

export default router;