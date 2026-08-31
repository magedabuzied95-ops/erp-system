import express from "express";
import pool from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";

const router = express.Router();
let variantsInventorySchemaPromise = null;
let variantsInventorySchemaEnsured = false;

export const ensureVariantsInventorySchema = async (clientOrPool = pool) => {
  if (variantsInventorySchemaEnsured) return;
  if (!variantsInventorySchemaPromise) {
    variantsInventorySchemaPromise = (async () => {
      await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS product_variants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_product_variants_active_deleted ON product_variants (tenant_id, is_active, deleted_at, id DESC)`);
    })()
      .then(() => {
        variantsInventorySchemaEnsured = true;
      })
      .catch((error) => {
        variantsInventorySchemaPromise = null;
        throw error;
      });
  }
  await variantsInventorySchemaPromise;
};

const perfDebug = () => ["1", "true", "yes", "on"].includes(String(process.env.ERP_PERF_DEBUG || "").toLowerCase());
const clampLimit = (value, fallback = 20, max = 100) => Math.min(Math.max(Number(value) || fallback, 1), max);

router.get("/", protect, permit("products", "view"), async (req, res) => {
  const startedAt = Date.now();
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const page = Number(req.query.page) || 1;
    const limit = clampLimit(req.query.limit);
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
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
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
        AND pv.is_active IS DISTINCT FROM FALSE
        AND pv.deleted_at IS NULL
      ${tenantClause}
      `,
      params
    );

    const payload = {
      success: true,
      variants: variants.rows,
      pagination: {
        total: Number(total.rows[0].count),
        page,
        limit,
        totalPages: Math.ceil(Number(total.rows[0].count) / limit),
      },
    };
    if (perfDebug()) console.log("[erp-perf] variants-inventory.list", { total_ms: Date.now() - startedAt, rows: variants.rowCount, limit });
    res.status(200).json(payload);
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

