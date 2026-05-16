import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { adjustVariantStock, getVariantStockHistory, undoInventoryMovement } from "../services/inventoryService.js";
import { getInventoryMovements } from "../services/inventoryMovementService.js";
import { postInventoryAdjustment } from "../services/accountingService.js";
import { createSystemNotification } from "../services/notificationsService.js";

const LOW_STOCK_ALERT_MAX = 2;

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
      movementType: "manual_adjustment",
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
    const result = await getInventoryMovements(db, {
      tenantId,
      productId: req.query.product_id || req.query.productId || null,
      variantId: req.query.variant_id || req.query.variantId || null,
      movementType: req.query.movement_type || req.query.movementType || null,
      search: req.query.search || "",
      dateFrom: req.query.date_from || req.query.dateFrom || req.query.from || null,
      dateTo: req.query.date_to || req.query.dateTo || req.query.to || null,
      limit: req.query.limit || 100,
      page: req.query.page || 1,
    });

    return res.status(200).json({
      success: true,
      movements: result.rows,
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

export const getLowStockAlerts = async (req, res) => {
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
