import express from "express";
import pool from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const router = express.Router();

router.get("/", protect, permit("products", "view"), async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const search = req.query.search || "";
    const offset = (page - 1) * limit;

    const params = [`%${search}%`];
    const tenantClause = tenantId === null ? "" : ` AND pv.tenant_id = $2`;
    if (tenantId !== null) params.push(tenantId);

    const variants = await pool.query(
      `
      SELECT
        pv.id,
        pv.color,
        pv.size,
        pv.sku,
        pv.stock,
        pv.price,
        pv.image_url,
        p.name AS product_name
      FROM product_variants pv
      JOIN products p ON pv.product_id = p.id
      WHERE (p.name ILIKE $1 OR pv.sku ILIKE $1)
      ${tenantClause}
      ORDER BY pv.id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, offset]
    );

    const total = await pool.query(
      `
      SELECT COUNT(*)
      FROM product_variants pv
      JOIN products p ON pv.product_id = p.id
      WHERE (p.name ILIKE $1 OR pv.sku ILIKE $1)
      ${tenantClause}
      `,
      params
    );

    res.status(200).json({
      success: true,
      variants: variants.rows,
      pagination: {
        total: Number(total.rows[0].count),
        page,
        limit,
        totalPages: Math.ceil(Number(total.rows[0].count) / limit),
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Failed To Fetch Variants",
      error: error.message,
    });
  }
});

export default router;
