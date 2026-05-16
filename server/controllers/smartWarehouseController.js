import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  completeInventoryCount,
  ensureSmartWarehouseSchema,
  getMasterQrProduct,
  getOrCreateMasterQr,
} from "../services/smartWarehouseService.js";

const scopedTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));
const limitValue = (value, fallback = 50, max = 500) => Math.min(Math.max(Number(value || fallback), 1), max);

export const listSections = async (req, res) => {
  try {
    await ensureSmartWarehouseSchema();
    const tenantId = scopedTenantId(req);
    const search = String(req.query.search || "").trim();
    const limit = limitValue(req.query.limit, 100, 500);
    const page = Math.max(Number(req.query.page || 1), 1);
    const params = [tenantId];
    const clauses = ["($1::bigint IS NULL OR s.tenant_id = $1::bigint OR s.tenant_id IS NULL)"];

    if (req.query.branch_id) {
      params.push(req.query.branch_id);
      clauses.push(`s.branch_id = $${params.length}`);
    }
    if (req.query.warehouse_id) {
      params.push(req.query.warehouse_id);
      clauses.push(`s.warehouse_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(s.code ILIKE $${params.length} OR s.name ILIKE $${params.length} OR COALESCE(s.barcode, '') ILIKE $${params.length})`);
    }

    const result = await db.query(
      `
      SELECT
        s.*,
        w.name AS warehouse_name,
        b.name AS branch_name,
        COUNT(DISTINCT wi.variant_id)::int AS variant_count,
        COALESCE(SUM(wi.stock), 0)::int AS stock_qty,
        COALESCE(SUM(ABS(ci.difference_qty)) FILTER (WHERE c.created_at >= NOW() - INTERVAL '30 days'), 0)::int AS recent_discrepancy_qty
      FROM warehouse_sections s
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN warehouse_inventory wi ON wi.section_id = s.id
      LEFT JOIN inventory_counts c ON c.section_id = s.id
      LEFT JOIN inventory_count_items ci ON ci.inventory_count_id = c.id
      WHERE ${clauses.join(" AND ")}
      GROUP BY s.id, w.name, b.name
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      `,
      [...params, limit, (page - 1) * limit]
    );

    return res.json({ success: true, sections: result.rows, pagination: { page, limit } });
  } catch (error) {
    console.error("[smart-warehouse] list sections", error);
    return res.status(500).json({ success: false, message: "Failed to load sections", error: error.message });
  }
};

export const createSection = async (req, res) => {
  try {
    await ensureSmartWarehouseSchema();
    const tenantId = scopedTenantId(req);
    const { branch_id, warehouse_id, code, name, color, notes } = req.body || {};
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (!normalizedCode || !warehouse_id) {
      return res.status(400).json({ success: false, message: "warehouse_id and code are required" });
    }
    const qrCode = req.body.qr_code || `SECTION-${normalizedCode}`;
    const barcode = req.body.barcode || normalizedCode;

    const existing = await db.query(
      `
      SELECT id
      FROM warehouse_sections
      WHERE COALESCE(tenant_id, 0) = COALESCE($1::bigint, 0)
        AND COALESCE(warehouse_id, 0) = COALESCE($2::bigint, 0)
        AND code = $3
      LIMIT 1
      `,
      [tenantId, warehouse_id, normalizedCode]
    );

    const result = existing.rows[0]
      ? await db.query(
        `
        UPDATE warehouse_sections
        SET branch_id = $2, warehouse_id = $3, name = $4, qr_code = $5, barcode = $6, color = $7, notes = $8
        WHERE id = $1
        RETURNING *
        `,
        [existing.rows[0].id, branch_id || null, warehouse_id, name || normalizedCode, qrCode, barcode, color || "#2563eb", notes || ""]
      )
      : await db.query(
      `
      INSERT INTO warehouse_sections (tenant_id, branch_id, warehouse_id, code, name, qr_code, barcode, color, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [tenantId, branch_id || null, warehouse_id, normalizedCode, name || normalizedCode, qrCode, barcode, color || "#2563eb", notes || ""]
    );

    return res.status(201).json({ success: true, section: result.rows[0] });
  } catch (error) {
    console.error("[smart-warehouse] create section", error);
    return res.status(500).json({ success: false, message: "Failed to save section", error: error.message });
  }
};

export const getSectionByCode = async (req, res) => {
  try {
    await ensureSmartWarehouseSchema();
    const tenantId = scopedTenantId(req);
    const code = String(req.params.code || "").trim();
    const result = await db.query(
      `
      SELECT *
      FROM warehouse_sections
      WHERE (code = $1 OR qr_code = $1 OR barcode = $1)
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      LIMIT 1
      `,
      [code, tenantId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Section not found" });
    return res.json({ success: true, section: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load section", error: error.message });
  }
};

export const generateMasterQr = async (req, res) => {
  try {
    await ensureSmartWarehouseSchema();
    const tenantId = scopedTenantId(req);
    const qr = await getOrCreateMasterQr(db, { tenantId, productId: req.params.productId });
    return res.status(201).json({ success: true, qr });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to generate master QR", error: error.message });
  }
};

export const getMasterQr = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const data = await getMasterQrProduct(db, { tenantId, qrValue: req.params.qrValue });
    if (!data) return res.status(404).json({ success: false, message: "Master QR not found" });
    return res.json({ success: true, ...data });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load master QR", error: error.message });
  }
};

export const saveQuickCount = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureSmartWarehouseSchema();
    await client.query("BEGIN");
    const tenantId = scopedTenantId(req);
    const { branch_id, warehouse_id, section_id, count_type, items, notes } = req.body || {};
    if (!warehouse_id || !Array.isArray(items) || !items.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "warehouse_id and items are required" });
    }
    const result = await completeInventoryCount(client, {
      tenantId,
      branchId: branch_id || null,
      warehouseId: warehouse_id,
      sectionId: section_id || null,
      countType: count_type || "quick_scan",
      items,
      notes,
      createdBy: req.user?.id || null,
    });
    await client.query("COMMIT");
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[smart-warehouse] quick count", error);
    return res.status(500).json({ success: false, message: "Failed to save count", error: error.message });
  } finally {
    client.release();
  }
};

export const listCounts = async (req, res) => {
  try {
    await ensureSmartWarehouseSchema();
    const tenantId = scopedTenantId(req);
    const result = await db.query(
      `
      SELECT c.*, ws.code AS section_code, w.name AS warehouse_name, u.name AS created_by_name,
        COUNT(ci.id)::int AS item_count,
        COALESCE(SUM(ABS(ci.difference_qty)), 0)::int AS discrepancy_qty
      FROM inventory_counts c
      LEFT JOIN inventory_count_items ci ON ci.inventory_count_id = c.id
      LEFT JOIN warehouse_sections ws ON ws.id = c.section_id
      LEFT JOIN warehouses w ON w.id = c.warehouse_id
      LEFT JOIN users u ON u.id = c.created_by
      WHERE ($1::bigint IS NULL OR c.tenant_id = $1::bigint OR c.tenant_id IS NULL)
      GROUP BY c.id, ws.code, w.name, u.name
      ORDER BY c.created_at DESC
      LIMIT $2
      `,
      [tenantId, limitValue(req.query.limit, 50, 200)]
    );
    return res.json({ success: true, counts: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load counts", error: error.message });
  }
};

export const getCycleTasks = async (req, res) => {
  try {
    await ensureSmartWarehouseSchema();
    const tenantId = scopedTenantId(req);
    const result = await db.query(
      `
      WITH sold AS (
        SELECT oi.variant_id, SUM(oi.quantity)::int AS sold_qty, MAX(o.created_at) AS last_sold_at
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY oi.variant_id
      ),
      discrepancies AS (
        SELECT variant_id, SUM(ABS(difference_qty))::int AS discrepancy_qty
        FROM inventory_count_items
        GROUP BY variant_id
      )
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        v.id AS variant_id,
        v.color,
        v.size,
        v.sku,
        v.stock,
        COALESCE(v.cost_price, p.cost_price, 0) AS cost_price,
        COALESCE(s.sold_qty, 0) AS sold_30d,
        COALESCE(d.discrepancy_qty, 0) AS discrepancy_qty,
        CASE
          WHEN COALESCE(d.discrepancy_qty, 0) > 0 THEN 'high_discrepancy'
          WHEN COALESCE(s.sold_qty, 0) >= 10 THEN 'fast_moving'
          WHEN COALESCE(v.cost_price, p.cost_price, 0) >= 1000 THEN 'expensive'
          WHEN COALESCE(v.stock, 0) <= COALESCE(v.low_stock_alert, p.low_stock_alert, 3) THEN 'low_stock'
          ELSE 'routine'
        END AS reason
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN sold s ON s.variant_id = v.id
      LEFT JOIN discrepancies d ON d.variant_id = v.id
      WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
      ORDER BY COALESCE(d.discrepancy_qty, 0) DESC, COALESCE(s.sold_qty, 0) DESC, COALESCE(v.cost_price, p.cost_price, 0) DESC
      LIMIT $2
      `,
      [tenantId, limitValue(req.query.limit, 30, 100)]
    );
    return res.json({ success: true, tasks: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load cycle tasks", error: error.message });
  }
};

export const getSmartReports = async (req, res) => {
  try {
    await ensureSmartWarehouseSchema();
    const tenantId = scopedTenantId(req);
    const [discrepancies, deadStock, alerts, heatmap, transfers] = await Promise.all([
      db.query(
        `
        SELECT p.name AS product_name, v.color, v.size, v.sku, SUM(ci.difference_qty)::int AS difference_qty
        FROM inventory_count_items ci
        JOIN product_variants v ON v.id = ci.variant_id
        JOIN products p ON p.id = ci.product_id
        WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
        GROUP BY p.name, v.color, v.size, v.sku
        HAVING SUM(ABS(ci.difference_qty)) > 0
        ORDER BY ABS(SUM(ci.difference_qty)) DESC
        LIMIT 20
        `,
        [tenantId]
      ),
      db.query(
        `
        SELECT p.id AS product_id, p.name AS product_name, v.id AS variant_id, v.color, v.size, v.sku, v.stock,
          MAX(o.created_at) AS last_sold_at
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN order_items oi ON oi.variant_id = v.id
        LEFT JOIN orders o ON o.id = oi.order_id
        WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
        GROUP BY p.id, p.name, v.id
        HAVING COALESCE(MAX(o.created_at), NOW() - INTERVAL '999 days') < NOW() - INTERVAL '90 days'
        ORDER BY v.stock DESC
        LIMIT 20
        `,
        [tenantId]
      ),
      db.query(
        `
        SELECT p.name AS product_name, v.id AS variant_id, v.color, v.size, v.sku, v.stock,
          CASE WHEN COALESCE(v.stock, 0) <= 0 THEN 'out_of_stock' ELSE 'low_stock' END AS alert_type
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        WHERE COALESCE(v.stock, 0) <= COALESCE(NULLIF(v.low_stock_alert, 0), NULLIF(p.low_stock_alert, 0), 3)
          AND ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
        ORDER BY v.stock ASC
        LIMIT 30
        `,
        [tenantId]
      ),
      db.query(
        `
        SELECT ws.id, ws.code, ws.name, ws.color, COUNT(DISTINCT wi.variant_id)::int AS variants,
          COALESCE(SUM(wi.stock), 0)::int AS stock_qty,
          COALESCE(SUM(ABS(ci.difference_qty)), 0)::int AS discrepancy_qty
        FROM warehouse_sections ws
        LEFT JOIN warehouse_inventory wi ON wi.section_id = ws.id
        LEFT JOIN inventory_counts c ON c.section_id = ws.id
        LEFT JOIN inventory_count_items ci ON ci.inventory_count_id = c.id
        WHERE ($1::bigint IS NULL OR ws.tenant_id = $1::bigint OR ws.tenant_id IS NULL)
        GROUP BY ws.id
        ORDER BY discrepancy_qty DESC, stock_qty DESC
        LIMIT 40
        `,
        [tenantId]
      ),
      db.query(
        `
        SELECT p.name AS product_name, v.id AS variant_id, v.color, v.size, v.sku,
          MAX(wi.stock) AS source_stock,
          MIN(wi.stock) AS target_stock,
          'rebalance_between_branches' AS recommendation_type
        FROM warehouse_inventory wi
        JOIN product_variants v ON v.id = wi.variant_id
        JOIN products p ON p.id = v.product_id
        WHERE ($1::bigint IS NULL OR wi.tenant_id = $1::bigint OR wi.tenant_id IS NULL)
        GROUP BY p.name, v.id
        HAVING MAX(wi.stock) >= 8 AND MIN(wi.stock) <= 2
        ORDER BY (MAX(wi.stock) - MIN(wi.stock)) DESC
        LIMIT 20
        `,
        [tenantId]
      ),
    ]);

    return res.json({
      success: true,
      reports: {
        discrepancies: discrepancies.rows,
        deadStock: deadStock.rows,
        alerts: alerts.rows,
        heatmap: heatmap.rows,
        transfers: transfers.rows,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load smart reports", error: error.message });
  }
};
