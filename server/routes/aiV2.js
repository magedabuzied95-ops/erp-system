import express from "express";

import db from "../database/db.js";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();

/* ======================================================
   AI V2 - SMART ANALYTICS ENGINE
====================================================== */

router.get(
  "/insights",

  protect,
  permit("dashboard", "view"),

  async (req, res) => {

    try {

      /* =========================
         DATA
      ========================= */

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

      /* =========================
         SALES PREDICTION 📈
      ========================= */

      const totalRevenue =
        orders.rows.reduce(
          (acc, o) =>
            acc + Number(o.total || 0),
          0
        );

      const avgRevenue =
        totalRevenue /
        (orders.rows.length || 1);

      const predictedNextMonth =
        avgRevenue * 1.15;

      /* =========================
         LOW STOCK ALERT 📦
      ========================= */

      const lowStock =
        variants.rows.filter(
          (v) => v.stock <= 5
        );

      const reorderSuggestions =
        lowStock.map((v) => ({
          product: v.product_id,
          variant: v.id,
          suggested_qty:
            20 - v.stock
        }));

      /* =========================
         DEAD PRODUCTS 💀
      ========================= */

      const deadProducts =
        products.rows.filter(
          (p) => {

            const productOrders =
              orders.rows.filter(
                (o) =>
                  o.product_id === p.id
              );

            return (
              productOrders.length === 0
            );
          }
        );

      /* =========================
         BEST CUSTOMERS 👑
      ========================= */

      const customerMap = {};

      orders.rows.forEach((o) => {

        const name =
          o.customer_name || "Walk In";

        customerMap[name] =
          (customerMap[name] || 0) +
          Number(o.total || 0);
      });

      const bestCustomers =
        Object.entries(customerMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, total]) => ({
            name,
            total
          }));

      /* =========================
         RESPONSE
      ========================= */

      res.json({

        prediction: {

          next_month_revenue:
            predictedNextMonth,

          trend:
            predictedNextMonth >
            avgRevenue
              ? "UP"
              : "DOWN"
        },

        stock: {

          low_stock:
            lowStock.length,

          reorder:
            reorderSuggestions
        },

        dead_products:
          deadProducts.length,

        best_customers:
          bestCustomers,

        insight:

          predictedNextMonth >
          avgRevenue

            ? "🔥 Business is growing steadily"

            : "⚠️ Revenue needs optimization"
      });

    } catch (error) {

      console.log(error);

      res.status(500).json({
        message: "AI v2 Error"
      });
    }
  }
);

export default router;