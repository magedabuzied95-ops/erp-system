import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { adjustVariantStock, getVariantStockHistory, undoInventoryMovement } from "../services/inventoryService.js";
import { getInventoryMovements } from "../services/inventoryMovementService.js";
import { getVariantStockReconciliation } from "../services/stockReconciliationService.js";
import { postInventoryAdjustment } from "../services/accountingService.js";
import { createSystemNotification } from "../services/notificationsService.js";

const LOW_STOCK_ALERT_MAX = 2;

const ensureInventoryAlertProductColumns = async () => {
  await db.query(`
    ALTER TABLE IF EXISTS products
      ADD COLUMN IF NOT EXISTS low_stock_tracking_mode VARCHAR(30) NOT NULL DEFAULT 'variant',
      ADD COLUMN IF NOT EXISTS product_low_stock_threshold INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS minimum_distinct_sizes_required INTEGER NOT NULL DEFAULT 0
  `);
  await db.query(`
    ALTER TABLE IF EXISTS product_variants
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL
  `);
  await db.query(`
    UPDATE products
    SET low_stock_tracking_mode = 'variant'
    WHERE low_stock_tracking_mode IS NULL OR TRIM(low_stock_tracking_mode) NOT IN ('variant', 'product_total')
  `);
};

const getProductLowStockSnapshot = async ({ productId, tenantId }) => {
  if (!productId) return null;
  const result = await db.query(
    `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      CASE
        WHEN COUNT(v.id) > 0 THEN COALESCE(SUM(GREATEST(COALESCE(v.stock, 0), 0)), 0)
        ELSE GREATEST(COALESCE(p.stock, 0), 0)
      END::int AS total_stock,
      COALESCE(
        NULLIF(p.image_url, ''),
        NULLIF(p.image, ''),
        NULLIF(p.photo_url, ''),
        NULLIF(p.thumbnail_url, ''),
        NULLIF((ARRAY_AGG(v.image_url ORDER BY v.id) FILTER (WHERE v.image_url IS NOT NULL AND v.image_url <> ''))[1], ''),
        ''
      ) AS image_url
    FROM products p
    LEFT JOIN product_variants v ON v.product_id = p.id
      AND v.is_active IS DISTINCT FROM FALSE
      AND v.deleted_at IS NULL
    WHERE p.id = $1
      AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
    GROUP BY p.id, p.name, p.stock, p.image_url, p.image, p.photo_url, p.thumbnail_url
    LIMIT 1
    `,
    [productId, tenantId]
  );
  return result.rows[0] || null;
};

const lowStockMessage = (productName, totalStock) =>
  Number(totalStock) === 1
    ? `متبقي قطعة واحدة فقط من ${productName}`
    : `متبقي قطعتين فقط من ${productName}`;

export const updateStock = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const { variantId, quantity, reason, notes } = req.body;
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);

    if (!variantId || quantity === undefined) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "variantId and quantity are required",
      });
    }

    const result = await adjustVariantStock(client, {
      tenantId,
      variantId,
      quantityAfter: Number(quantity || 0),
      movementType: "ADJUSTMENT",
      referenceType: "manual_adjustment",
      referenceId: null,
      reason: reason || "Manual stock adjustment",
      notes: reason || notes || "Edited from Inventory stock adjustment",
      createdBy: req.user?.id || null,
    });

    if (!result) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Variant not found",
      });
    }

    const quantityDelta = Number(result.quantityChange || 0);
    const unitCost = Number(result.variant?.cost_price || 0);
    await postInventoryAdjustment(client, {
      tenantId,
      referenceType: "manual_adjustment",
      referenceId: result?.movement?.id || null,
      description: `Manual stock adjustment for variant ${variantId}`,
      amount: Math.abs(quantityDelta) * unitCost,
      quantityChange: quantityDelta,
      createdBy: req.user?.id || null,
      branchId: req.body.branchId || req.body.branch_id || null,
      notes: reason || notes || "Inventory adjustment",
    });

    await client.query("COMMIT");

    const lowStockSnapshot = await getProductLowStockSnapshot({ productId: result.productId, tenantId });
    const totalStock = Number(lowStockSnapshot?.total_stock || 0);
    if (totalStock >= 1 && totalStock <= LOW_STOCK_ALERT_MAX) {
      createSystemNotification("low_stock", {
        tenant_id: tenantId,
        branch_id: req.body.branchId || req.body.branch_id || null,
        priority: totalStock === 1 ? "critical" : "high",
        title: "آخر قطع متاحة",
        message: lowStockMessage(lowStockSnapshot.product_name || `Product ${result.productId}`, totalStock),
        action_url: `/inventory?productId=${encodeURIComponent(String(result.productId || ""))}`,
        entity_type: "product",
        entity_id: result.productId,
        metadata: {
          product_id: result.productId,
          variant_id: variantId,
          stock: totalStock,
          image_url: lowStockSnapshot.image_url || "",
          badge: "عاجل",
          source: "manual_adjustment",
        },
      }).catch((error) => console.warn("[notifications] low stock skipped", error?.message || error));
    }

    res.status(200).json({
      message: "Stock updated successfully",
      variant: result.variant || result,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);

    if (error?.message === "Variant not found") {
      return res.status(404).json({
        message: "Variant not found",
      });
    }

    res.status(500).json({
      message: "Server Error",
    });
  } finally {
    client.release();
  }
};

export const getInventoryMovementsLedger = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const productId = req.query.product_id || req.query.productId || null;
    const variantId = req.query.variant_id || req.query.variantId || null;
    const branchId = req.query.branch_id || req.query.branchId || null;
    const warehouseId = req.query.warehouse_id || req.query.warehouseId || null;
    const result = await getInventoryMovements(db, {
      tenantId,
      productId,
      variantId,
      branchId,
      warehouseId,
      movementType: req.query.movement_type || req.query.movementType || null,
      search: req.query.search || "",
      dateFrom: req.query.date_from || req.query.dateFrom || req.query.from || null,
      dateTo: req.query.date_to || req.query.dateTo || req.query.to || null,
      limit: req.query.limit || 100,
      page: req.query.page || 1,
    });
    const reconciliation = productId || variantId
      ? await getVariantStockReconciliation(db, { tenantId, productId, variantIds: variantId ? [Number(variantId)] : [] })
      : null;

    return res.status(200).json({
      success: true,
      movements: result.rows,
      reconciliation,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        page: result.page,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch inventory movements",
      error: error.message,
    });
  }
};

export const undoInventoryMovementById = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const result = await undoInventoryMovement(client, {
      tenantId,
      movementId: req.params.id,
      createdBy: req.user?.id || null,
    });

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Stock adjustment undone successfully",
      movement: result.undoMovement,
      variant: result.variant,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to undo inventory movement",
    });
  } finally {
    client.release();
  }
};

const getLowStockAlertsLegacy = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const threshold = LOW_STOCK_ALERT_MAX;

    const result = await db.query(
      `
      WITH product_stock AS (
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          CASE
            WHEN COUNT(v.id) > 0 THEN COALESCE(SUM(GREATEST(COALESCE(v.stock, 0), 0)), 0)
            ELSE GREATEST(COALESCE(p.stock, 0), 0)
          END::int AS total_stock,
          COALESCE(
            NULLIF(p.image_url, ''),
            NULLIF(p.image, ''),
            NULLIF(p.photo_url, ''),
            NULLIF(p.thumbnail_url, ''),
            NULLIF((ARRAY_AGG(v.image_url ORDER BY v.id) FILTER (WHERE v.image_url IS NOT NULL AND v.image_url <> ''))[1], ''),
            ''
          ) AS image_url,
          (ARRAY_AGG(v.id ORDER BY v.id) FILTER (WHERE v.id IS NOT NULL))[1] AS variant_id,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(v.color, '')), NULL) AS colors,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(v.size, '')), NULL) AS sizes,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(v.sku, '')), NULL) AS skus
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id
          AND v.is_active IS DISTINCT FROM FALSE
          AND v.deleted_at IS NULL
        WHERE ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
        GROUP BY p.id, p.name, p.stock, p.image_url, p.image, p.photo_url, p.thumbnail_url
      )
      SELECT
        product_id,
        product_name,
        variant_id,
        COALESCE(colors[1], '') AS color,
        COALESCE(sizes[1], '') AS size,
        COALESCE(skus[1], '') AS sku,
        total_stock AS stock,
        total_stock,
        image_url,
        CASE WHEN total_stock = 1 THEN 'critical' ELSE 'high' END AS alert_level,
        'عاجل' AS badge_text
      FROM product_stock
      WHERE total_stock BETWEEN 1 AND $1
      ORDER BY total_stock ASC, product_name ASC
      `,
      [threshold, tenantId]
    );

    return res.status(200).json({
      success: true,
      threshold,
      alerts: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch low stock alerts",
      error: error.message,
    });
  }
};

export const getLowStockAlerts = async (req, res) => {
  try {
    await ensureInventoryAlertProductColumns();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const threshold = LOW_STOCK_ALERT_MAX;

    const result = await db.query(
      `
      WITH product_metrics AS (
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          COALESCE(NULLIF(p.low_stock_tracking_mode, ''), 'variant') AS low_stock_tracking_mode,
          GREATEST(COALESCE(p.product_low_stock_threshold, 0), 0)::int AS product_low_stock_threshold,
          GREATEST(COALESCE(p.minimum_distinct_sizes_required, 0), 0)::int AS minimum_distinct_sizes_required,
          CASE
            WHEN COUNT(v.id) > 0 THEN COALESCE(SUM(GREATEST(COALESCE(v.stock, 0), 0)), 0)
            ELSE GREATEST(COALESCE(p.stock, 0), 0)
          END::int AS total_stock,
          CASE
            WHEN COUNT(v.id) > 0 THEN COUNT(DISTINCT CASE WHEN COALESCE(v.stock, 0) > 0 THEN COALESCE(NULLIF(TRIM(v.size), ''), 'One Size') END)
            WHEN COALESCE(p.stock, 0) > 0 THEN 1
            ELSE 0
          END::int AS active_sizes_count,
          COALESCE(
            NULLIF(p.image_url, ''),
            NULLIF(p.image, ''),
            NULLIF(p.photo_url, ''),
            NULLIF(p.thumbnail_url, ''),
            NULLIF((ARRAY_AGG(v.image_url ORDER BY v.id) FILTER (WHERE v.image_url IS NOT NULL AND v.image_url <> ''))[1], ''),
            ''
          ) AS image_url,
          (ARRAY_AGG(v.id ORDER BY v.id) FILTER (WHERE v.id IS NOT NULL))[1] AS variant_id,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(v.color, '')), NULL) AS colors,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(v.size, '')), NULL) AS sizes,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(v.sku, '')), NULL) AS skus
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.id
        WHERE ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
        GROUP BY p.id, p.name, p.stock, p.low_stock_tracking_mode, p.product_low_stock_threshold, p.minimum_distinct_sizes_required, p.image_url, p.image, p.photo_url, p.thumbnail_url
      ),
      product_total_alerts AS (
        SELECT
          'product_total' AS alert_scope,
          product_id,
          product_name,
          variant_id,
          COALESCE(colors[1], '') AS color,
          COALESCE(sizes[1], '') AS size,
          COALESCE(skus[1], '') AS sku,
          total_stock AS stock,
          total_stock,
          image_url,
          CASE WHEN total_stock <= 0 OR active_sizes_count = 0 THEN 'critical' ELSE 'high' END AS alert_level,
          'عاجل' AS badge_text,
          low_stock_tracking_mode,
          product_low_stock_threshold,
          minimum_distinct_sizes_required,
          active_sizes_count,
          CASE
            WHEN total_stock <= product_low_stock_threshold AND active_sizes_count < minimum_distinct_sizes_required THEN 'Both'
            WHEN total_stock <= product_low_stock_threshold THEN 'Low total stock'
            ELSE 'Weak size distribution'
          END AS alert_reason,
          ARRAY_REMOVE(ARRAY[
            CASE WHEN total_stock <= product_low_stock_threshold THEN 'Low total stock'::text END,
            CASE WHEN active_sizes_count < minimum_distinct_sizes_required THEN 'Weak size distribution'::text END
          ], NULL::text) AS alert_reasons,
          product_low_stock_threshold AS threshold
        FROM product_metrics
        WHERE low_stock_tracking_mode = 'product_total'
          AND (total_stock <= product_low_stock_threshold OR active_sizes_count < minimum_distinct_sizes_required)
      ),
      variant_alerts AS (
        SELECT
          'variant' AS alert_scope,
          p.id AS product_id,
          p.name AS product_name,
          v.id AS variant_id,
          COALESCE(v.color, '') AS color,
          COALESCE(v.size, '') AS size,
          COALESCE(NULLIF(v.sku, ''), NULLIF(p.sku, ''), '') AS sku,
          GREATEST(COALESCE(v.stock, 0), 0)::int AS stock,
          GREATEST(COALESCE(v.stock, 0), 0)::int AS total_stock,
          COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS image_url,
          CASE WHEN COALESCE(v.stock, 0) <= 0 THEN 'critical' ELSE 'high' END AS alert_level,
          'عاجل' AS badge_text,
          COALESCE(NULLIF(p.low_stock_tracking_mode, ''), 'variant') AS low_stock_tracking_mode,
          GREATEST(COALESCE(p.product_low_stock_threshold, 0), 0)::int AS product_low_stock_threshold,
          GREATEST(COALESCE(p.minimum_distinct_sizes_required, 0), 0)::int AS minimum_distinct_sizes_required,
          NULL::int AS active_sizes_count,
          'Variant low stock' AS alert_reason,
          ARRAY['Variant low stock'] AS alert_reasons,
          COALESCE(NULLIF(v.low_stock_alert, 0), NULLIF(p.low_stock_alert, 0), $1)::int AS threshold
        FROM products p
        JOIN product_variants v ON v.product_id = p.id
          AND v.is_active IS DISTINCT FROM FALSE
          AND v.deleted_at IS NULL
        WHERE COALESCE(NULLIF(p.low_stock_tracking_mode, ''), 'variant') <> 'product_total'
          AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
          AND GREATEST(COALESCE(v.stock, 0), 0) <= COALESCE(NULLIF(v.low_stock_alert, 0), NULLIF(p.low_stock_alert, 0), $1)
      ),
      simple_product_alerts AS (
        SELECT
          'variant' AS alert_scope,
          p.id AS product_id,
          p.name AS product_name,
          NULL::bigint AS variant_id,
          '' AS color,
          '' AS size,
          COALESCE(NULLIF(p.sku, ''), '') AS sku,
          GREATEST(COALESCE(p.stock, 0), 0)::int AS stock,
          GREATEST(COALESCE(p.stock, 0), 0)::int AS total_stock,
          COALESCE(NULLIF(p.image_url, ''), NULLIF(p.image, ''), NULLIF(p.photo_url, ''), NULLIF(p.thumbnail_url, ''), '') AS image_url,
          CASE WHEN COALESCE(p.stock, 0) <= 0 THEN 'critical' ELSE 'high' END AS alert_level,
          'عاجل' AS badge_text,
          COALESCE(NULLIF(p.low_stock_tracking_mode, ''), 'variant') AS low_stock_tracking_mode,
          GREATEST(COALESCE(p.product_low_stock_threshold, 0), 0)::int AS product_low_stock_threshold,
          GREATEST(COALESCE(p.minimum_distinct_sizes_required, 0), 0)::int AS minimum_distinct_sizes_required,
          NULL::int AS active_sizes_count,
          'Variant low stock' AS alert_reason,
          ARRAY['Variant low stock'] AS alert_reasons,
          COALESCE(NULLIF(p.low_stock_alert, 0), $1)::int AS threshold
        FROM products p
        WHERE COALESCE(NULLIF(p.low_stock_tracking_mode, ''), 'variant') <> 'product_total'
          AND ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
          AND NOT EXISTS (
            SELECT 1
            FROM product_variants v
            WHERE v.product_id = p.id
              AND v.is_active IS DISTINCT FROM FALSE
              AND v.deleted_at IS NULL
          )
          AND GREATEST(COALESCE(p.stock, 0), 0) <= COALESCE(NULLIF(p.low_stock_alert, 0), $1)
      )
      SELECT * FROM product_total_alerts
      UNION ALL
      SELECT * FROM variant_alerts
      UNION ALL
      SELECT * FROM simple_product_alerts
      ORDER BY alert_scope DESC, total_stock ASC, product_name ASC, size ASC
      `,
      [threshold, tenantId]
    );

    return res.status(200).json({
      success: true,
      threshold,
      alerts: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch low stock alerts",
      error: error.message,
    });
  }
};

export const getInventoryHistory = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const result = await getVariantStockHistory(db, {
      tenantId,
      productId: req.query.productId || null,
      variantId: req.query.variantId || null,
      movementType: req.query.movementType || null,
      search: req.query.search || "",
      dateFrom: req.query.dateFrom || req.query.from || null,
      dateTo: req.query.dateTo || req.query.to || null,
      limit: req.query.limit || 100,
      offset: req.query.offset || 0,
    });

    return res.status(200).json({
      success: true,
      movements: result.rows,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch inventory history",
    });
  }
};

export const getVariantHistory = async (req, res) => {
  try {
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const result = await getVariantStockHistory(db, {
      tenantId,
      variantId: req.params.id,
      productId: req.query.productId || null,
      movementType: req.query.movementType || null,
      search: req.query.search || "",
      dateFrom: req.query.dateFrom || req.query.from || null,
      dateTo: req.query.dateTo || req.query.to || null,
      limit: req.query.limit || 100,
      offset: req.query.offset || 0,
    });

    return res.status(200).json({
      success: true,
      movements: result.rows,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch variant history",
    });
  }
};

