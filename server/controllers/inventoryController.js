import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { adjustVariantStock, getVariantStockHistory, undoInventoryMovement } from "../services/inventoryService.js";
import { getInventoryMovements } from "../services/inventoryMovementService.js";
import { getVariantStockReconciliation } from "../services/stockReconciliationService.js";
import { postInventoryAdjustment } from "../services/accountingService.js";
import { createSystemNotification } from "../services/notificationsService.js";
import { groupLowStockAlerts } from "../utils/lowStockAlertGrouping.js";
import { repairArabicMojibakeText } from "../utils/textEncoding.js";

const LOW_STOCK_ALERT_MAX = 2;

const normalizeText = (value = "") => String(value ?? "").trim();
const normalizeDisplayText = (value = "") => repairArabicMojibakeText(normalizeText(value));

const normalizePositiveStock = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const normalizeSizeLabel = (value) => {
  const text = normalizeDisplayText(value);
  return text || "ظ…ظ‚ط§ط³ ظˆط§ط­ط¯";
};

const normalizeColorLabel = (value) => {
  const text = normalizeDisplayText(value);
  return text || "ط¨ط¯ظˆظ† ظ„ظˆظ†";
};

const normalizeIdValue = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : String(value).trim();
};

const firstImageUrl = (...values) => values.map((value) => normalizeText(value)).find(Boolean) || "";

const buildPurchaseAlertImage = ({ product = {}, variants = [] } = {}) => {
  const variantImage = Array.isArray(variants)
    ? variants.map((variant) => variant.variant_image_url || variant.image_url || "").find(Boolean)
    : "";
  return firstImageUrl(
    product.image_url,
    product.image,
    product.photo_url,
    product.thumbnail_url,
    variantImage
  );
};

const buildPurchaseAlertCartonAction = (count) => {
  const nextCount = Math.max(1, Number(count || 1));
  return nextCount === 1 ? "ط·ظ„ط¨ ظƒط±طھظˆظ†ط© ظˆط§ط­ط¯ط©" : `ط·ظ„ط¨ ${nextCount} ظƒط±ط§طھظٹظ†`;
};

const repairPurchaseAlertDisplayValue = (value) => {
  if (typeof value === "string") {
    return normalizeDisplayText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => repairPurchaseAlertDisplayValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, repairPurchaseAlertDisplayValue(entryValue)])
    );
  }

  return value;
};

const repairPurchaseAlertDisplayFields = (alert = {}) => repairPurchaseAlertDisplayValue(alert);

const PURCHASE_ALERT_COPY = {
  missing_sizes: {
    title: "ظ…ظ‚ط§ط³ط§طھ ظ†ط§ظ‚طµط©",
    reason: "ط¨ط¹ط¶ ط§ظ„ظ…ظ‚ط§ط³ط§طھ ط؛ظٹط± ظ…ظƒطھظ…ظ„ط©",
  },
  carton_threshold: {
    title: "ظˆطµظ„ ظ„ط­ط¯ ط§ظ„ظƒط±طھظˆظ†ط©",
    reason: "ط¥ط¬ظ…ط§ظ„ظٹ ط§ظ„ظ…ط®ط²ظˆظ† ظˆطµظ„ ظ„ط­ط¯ ط§ظ„ظƒط±طھظˆظ†ط©",
  },
};

const buildPurchaseAlertAction = (count) => {
  const nextCount = Number(count || 1);
  return nextCount === 1 ? "اطلب كرتونة" : `اطلب ${nextCount} كرتونة`;
};

const createPurchaseAlertScope = ({ product, scopeVariants = [], color = "", purchaseAlertByColor = false }) => {
  const sizeMap = new Map();
  let totalStock = 0;

  for (const variant of scopeVariants) {
    const size = normalizeSizeLabel(variant.size);
    const stock = normalizePositiveStock(variant.stock);
    totalStock += stock;
    const existing = sizeMap.get(size) || { size, stock: 0 };
    existing.stock += stock;
    sizeMap.set(size, existing);
  }

  const sizeEntries = Array.from(sizeMap.values()).filter((entry) => normalizeText(entry.size));
  const meaningfulSizeEntries = sizeEntries.filter((entry) => normalizeText(entry.size).toLowerCase() !== "one size");
  const inspectEntries = meaningfulSizeEntries.length > 0 ? meaningfulSizeEntries : [];
  const missingSizes = inspectEntries.filter((entry) => entry.stock <= 0).map((entry) => entry.size);
  const cartonSize = Number(product.carton_size || 0);
  const suggestedPurchaseCartons = Math.max(1, Number(product.suggested_purchase_cartons || 1));
  const alertType = missingSizes.length > 0 ? "missing_sizes" : cartonSize > 0 && totalStock <= cartonSize ? "carton_threshold" : null;

  if (!alertType) return null;

  return {
    product_id: product.product_id,
    product_name: product.product_name,
    color: purchaseAlertByColor ? normalizeColorLabel(color) : "",
    purchase_alert_by_color: Boolean(purchaseAlertByColor),
    image_url: buildPurchaseAlertImage({ product, variants: scopeVariants }),
    alert_type: alertType,
    alert_title: alertType === "missing_sizes" ? PURCHASE_ALERT_COPY.missing_sizes.title : PURCHASE_ALERT_COPY.carton_threshold.title,
    alert_reason: alertType === "missing_sizes" ? PURCHASE_ALERT_COPY.missing_sizes.reason : PURCHASE_ALERT_COPY.carton_threshold.reason,
    missing_sizes: alertType === "missing_sizes" ? missingSizes : [],
    variant_ids: Array.from(
      new Set(
        scopeVariants
          .map((variant) => normalizeIdValue(variant.variant_id))
          .filter((value) => value !== null && value !== undefined)
      )
    ),
    total_stock: totalStock,
    carton_size: cartonSize > 0 ? cartonSize : null,
    suggested_purchase_cartons: suggestedPurchaseCartons,
    suggested_action: buildPurchaseAlertCartonAction(suggestedPurchaseCartons),
    brand_id: normalizeIdValue(product.brand_id),
    brand_name: product.brand_name || "",
    category_id: normalizeIdValue(product.category_id),
    category_name: product.category_name || "",
    manufacturer_id: normalizeIdValue(product.manufacturer_id || product.scope_manufacturer_id || null),
    manufacturer_name: product.manufacturer_name || "",
    scope_key: purchaseAlertByColor
      ? `${product.product_id}:color:${normalizeColorLabel(color).toLowerCase()}`
      : `${product.product_id}:model`,
    scope_label: purchaseAlertByColor ? normalizeColorLabel(color) : normalizeDisplayText(product.product_name),
  };
};

const sortPurchaseAlerts = (alerts = []) =>
  [...alerts].sort((left, right) => {
    const priority = (value) => (value === "missing_sizes" ? 0 : 1);
    const leftPriority = priority(left.alert_type);
    const rightPriority = priority(right.alert_type);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if (left.total_stock !== right.total_stock) return left.total_stock - right.total_stock;
    return String(left.product_name || "").localeCompare(String(right.product_name || ""), "ar");
  });

const buildPurchaseAlertsFromRows = (rows = []) => {
  const productMap = new Map();

  for (const row of rows) {
    const productId = Number(row.product_id || row.id || 0);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    const current = productMap.get(productId) || {
      product_id: productId,
      product_name: normalizeDisplayText(row.product_name || row.name || ""),
      purchase_alerts_enabled: row.purchase_alerts_enabled === true || String(row.purchase_alerts_enabled || "").toLowerCase() === "true",
      purchase_alert_by_color: row.purchase_alert_by_color === true || String(row.purchase_alert_by_color || "").toLowerCase() === "true",
      carton_size: row.carton_size === null || row.carton_size === undefined || row.carton_size === "" ? null : Number(row.carton_size),
      suggested_purchase_cartons:
        Number.isFinite(Number(row.suggested_purchase_cartons)) && Number(row.suggested_purchase_cartons) >= 1
          ? Math.floor(Number(row.suggested_purchase_cartons))
          : 1,
      image_url: firstImageUrl(row.product_image_url, row.image_url, row.image, row.photo_url, row.thumbnail_url),
      brand_id: row.brand_id ?? null,
      brand_name: row.brand_name || "",
      category_id: row.category_id ?? null,
      category_name: row.category_name || "",
      manufacturer_id: row.manufacturer_id ?? row.scope_manufacturer_id ?? null,
      manufacturer_name: row.manufacturer_name || "",
      variants: [],
      variant_ids: [],
    };
    if (row.variant_id) {
      const normalizedVariantId = normalizeIdValue(row.variant_id);
      if (normalizedVariantId !== null && normalizedVariantId !== undefined) {
        current.variant_ids.push(normalizedVariantId);
      }
      current.variants.push({
        variant_id: row.variant_id,
        color: normalizeDisplayText(row.color || ""),
        size: normalizeDisplayText(row.size || ""),
        stock: normalizePositiveStock(row.stock),
        image_url: firstImageUrl(row.variant_image_url, row.image_url, row.product_image_url),
        manufacturer_id: row.variant_manufacturer_id ?? null,
      });
    }
    if (!current.manufacturer_id && row.variant_manufacturer_id) {
      current.manufacturer_id = row.variant_manufacturer_id;
    }
    if (!current.manufacturer_name && row.variant_manufacturer_name) {
      current.manufacturer_name = row.variant_manufacturer_name;
    }
    productMap.set(productId, current);
  }

  const alerts = [];

  for (const product of productMap.values()) {
    if (!product.purchase_alerts_enabled) continue;

    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (product.purchase_alert_by_color) {
      const colorMap = new Map();
      for (const variant of variants) {
        const key = normalizeColorLabel(variant.color).toLowerCase();
        const current = colorMap.get(key) || { color: normalizeColorLabel(variant.color), variants: [] };
        current.variants.push(variant);
        colorMap.set(key, current);
      }

      if (colorMap.size === 0) {
        const alert = createPurchaseAlertScope({ product, scopeVariants: [], purchaseAlertByColor: true });
        if (alert) alerts.push(alert);
        continue;
      }

      for (const group of colorMap.values()) {
        const alert = createPurchaseAlertScope({
          product,
          scopeVariants: group.variants,
          color: group.color,
          purchaseAlertByColor: true,
        });
        if (alert) alerts.push(alert);
      }
      continue;
    }

    const alert = createPurchaseAlertScope({
      product,
      scopeVariants: variants,
      purchaseAlertByColor: false,
    });
    if (alert) alerts.push(alert);
  }

  const sampleMissingSizesAlert = alerts.find((alert) => alert?.alert_type === "missing_sizes");
  if (sampleMissingSizesAlert) {
    console.log("[purchase-alerts] generated-missing-sizes-sample", {
      product_id: sampleMissingSizesAlert.product_id,
      product_name: sampleMissingSizesAlert.product_name,
      color: sampleMissingSizesAlert.color,
      alert_type: sampleMissingSizesAlert.alert_type,
      alert_title: sampleMissingSizesAlert.alert_title,
      alert_reason: sampleMissingSizesAlert.alert_reason,
      missing_sizes: sampleMissingSizesAlert.missing_sizes,
    });
  }

  return sortPurchaseAlerts(alerts.map(repairPurchaseAlertDisplayFields));
};

const fetchPurchaseAlerts = async ({ tenantId }) => {
  const result = await db.query(
    `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.brand_id,
      p.category_id,
      p.manufacturer_id,
      p.purchase_alerts_enabled,
      p.purchase_alert_by_color,
      p.carton_size,
      p.suggested_purchase_cartons,
      p.image_url AS product_image_url,
      p.image,
      p.photo_url,
      p.thumbnail_url,
      b.name AS brand_name,
      c.name AS category_name,
      m.name AS manufacturer_name,
      v.id AS variant_id,
      v.color,
      v.size,
      GREATEST(COALESCE(v.stock, 0), 0)::int AS stock,
      COALESCE(NULLIF(v.image_url, ''), NULLIF(v.image, ''), NULLIF(v.photo_url, ''), NULLIF(v.thumbnail_url, ''), '') AS variant_image_url,
      v.manufacturer_id AS variant_manufacturer_id,
      vm.name AS variant_manufacturer_name
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN manufacturers m ON m.id = p.manufacturer_id
    LEFT JOIN product_variants v ON v.product_id = p.id
      AND v.is_active IS DISTINCT FROM FALSE
      AND v.deleted_at IS NULL
    LEFT JOIN manufacturers vm ON vm.id = v.manufacturer_id
    WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint OR p.tenant_id IS NULL)
      AND p.purchase_alerts_enabled IS TRUE
      AND p.is_active IS DISTINCT FROM FALSE
      AND COALESCE(NULLIF(LOWER(TRIM(p.status)), ''), 'active') NOT IN ('inactive', 'disabled', 'archived', 'deleted', 'draft')
    ORDER BY p.id DESC, v.color ASC NULLS LAST, v.size ASC NULLS LAST, v.id ASC
    `,
    [tenantId]
  );
  return buildPurchaseAlertsFromRows(result.rows || []);
};

const normalizeAlertSelectionKey = (row = {}) =>
  String(row.scope_key || row.scopeKey || row.key || row.alert_key || `${row.product_id || ""}:${row.purchase_alert_by_color ? `color:${normalizeColorLabel(row.color || "").toLowerCase()}` : "model"}`).trim();

const extractSelectedAlertRows = (body = {}) => {
  const candidates = [body.selected_alerts, body.selectedAlerts, body.alerts, body.items, body.selection];
  return candidates.find((value) => Array.isArray(value)) || [];
};

const normalizeDraftLabel = (value, fallback = "Smart Purchase Alerts") => {
  const text = normalizeDisplayText(value);
  return text || fallback;
};

const ensureDraftPurchaseSchema = async (client) => {
  await client.query("ALTER TABLE IF EXISTS purchases ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS purchase_items ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
};

const ensureDraftSupplier = async (client, tenantId, supplierName = "") => {
  const name = normalizeDraftLabel(supplierName, "Smart Purchase Alerts");
  const existing = await client.query(
    `
    SELECT id
    FROM suppliers
    WHERE (tenant_id = $1 OR tenant_id IS NULL)
      AND LOWER(TRIM(name)) = LOWER(TRIM($2))
    ORDER BY id ASC
    LIMIT 1
    `,
    [tenantId, name]
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const created = await client.query(
    `
    INSERT INTO suppliers (tenant_id, name, status)
    VALUES ($1, $2, 'active')
    RETURNING id
    `,
    [tenantId, name]
  );
  return created.rows[0]?.id || null;
};

const getDefaultDraftWarehouseId = async (client, tenantId) => {
  const result = await client.query(
    `
    SELECT id
    FROM warehouses
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
    ORDER BY id ASC
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0]?.id || null;
};

const buildPurchaseAlertDraftItem = (alert = {}) => {
  const suggestedCartons = Math.max(1, Number(alert.suggested_purchase_cartons || 1));
  const isColorScope = Boolean(alert.purchase_alert_by_color);
  const variantIds = Array.isArray(alert.variant_ids)
    ? alert.variant_ids.map((value) => normalizeIdValue(value)).filter((value) => value !== null && value !== undefined)
    : [];
  const primaryVariantId = isColorScope && variantIds.length === 1 ? variantIds[0] : null;
  return {
    product_id: alert.product_id,
    variant_id: primaryVariantId,
    quantity: suggestedCartons,
    unit_cost: 0,
    cost_price: 0,
    total: 0,
    color: isColorScope ? normalizeColorLabel(alert.color) : "",
    size: "",
    sku: "",
    article_code: "",
    image_url: alert.image_url || "",
    product_name: normalizeDisplayText(alert.product_name || ""),
    supplier_id: alert.manufacturer_id || null,
    supplier_name: alert.manufacturer_name || "",
    metadata: {
      source: "smart_purchase_alerts",
      alert_scope: alert.purchase_alert_by_color ? "product_color" : "product_model",
      scope_key: alert.scope_key,
      scope_label: alert.scope_label,
      alert_type: alert.alert_type,
      alert_title: alert.alert_title,
      alert_reason: alert.alert_reason,
      missing_sizes: Array.isArray(alert.missing_sizes) ? alert.missing_sizes : [],
      total_stock: Number(alert.total_stock || 0),
      carton_size: alert.carton_size ?? null,
      suggested_purchase_cartons: suggestedCartons,
      purchase_alert_by_color: Boolean(alert.purchase_alert_by_color),
      color: isColorScope ? normalizeColorLabel(alert.color) : "",
      product_name: alert.product_name || "",
      product_id: alert.product_id,
      manufacturer_id: alert.manufacturer_id ?? null,
      manufacturer_name: alert.manufacturer_name || "",
      brand_id: alert.brand_id ?? null,
      brand_name: alert.brand_name || "",
      category_id: alert.category_id ?? null,
      category_name: alert.category_name || "",
      variant_ids: variantIds,
    },
  };
};

const buildPurchaseAlertDraftPayload = ({ alerts = [], purchase = null, supplier = null, warehouse = null }) => {
  const items = alerts.map(buildPurchaseAlertDraftItem);
  const totalSuggestedCartons = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const grouped = Array.from(
    alerts.reduce((map, alert) => {
      const groupKey = normalizeText(alert.manufacturer_name || alert.brand_name || "Unassigned");
      const current = map.get(groupKey) || {
        group_key: groupKey,
        manufacturer_id: alert.manufacturer_id ?? null,
        manufacturer_name: alert.manufacturer_name || "",
        brand_id: alert.brand_id ?? null,
        brand_name: alert.brand_name || "",
        scope_keys: [],
      };
      current.scope_keys.push(alert.scope_key);
      map.set(groupKey, current);
      return map;
    }, new Map()).values()
  );

  return {
    source: "smart_purchase_alerts",
    created_at: new Date().toISOString(),
    supplier_id: supplier?.id ?? null,
    supplier_name: supplier?.name || "",
    warehouse_id: warehouse?.id ?? null,
    warehouse_name: warehouse?.name || "",
    status: purchase?.status || "draft",
    payment_status: purchase?.payment_status || "unpaid",
    subtotal: 0,
    tax_amount: 0,
    discount_amount: 0,
    total: 0,
    paid_amount: 0,
    notes: "Smart purchase alerts draft",
    items,
    groups: grouped,
    summary: {
      selected_alerts: alerts.length,
      suggested_cartons: totalSuggestedCartons,
    },
    metadata: {
      source: "smart_purchase_alerts",
      selected_alerts: alerts.map((alert) => ({
        scope_key: alert.scope_key,
        product_id: alert.product_id,
        alert_type: alert.alert_type,
        purchase_alert_by_color: Boolean(alert.purchase_alert_by_color),
        color: alert.purchase_alert_by_color ? normalizeColorLabel(alert.color) : "",
      })),
      groups: grouped,
    },
  };
};

const ensureInventoryAlertProductColumns = async () => {
  await db.query(`
    ALTER TABLE IF EXISTS products
      ADD COLUMN IF NOT EXISTS low_stock_tracking_mode VARCHAR(30) NOT NULL DEFAULT 'variant',
      ADD COLUMN IF NOT EXISTS product_low_stock_threshold INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS minimum_distinct_sizes_required INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS purchase_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS purchase_alert_by_color BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS carton_size INTEGER NULL,
      ADD COLUMN IF NOT EXISTS suggested_purchase_cartons INTEGER NOT NULL DEFAULT 1
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
    ? `ظ…طھط¨ظ‚ظٹ ظ‚ط·ط¹ط© ظˆط§ط­ط¯ط© ظپظ‚ط· ظ…ظ† ${productName}`
    : `ظ…طھط¨ظ‚ظٹ ظ‚ط·ط¹طھظٹظ† ظپظ‚ط· ظ…ظ† ${productName}`;

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
        title: "ط¢ط®ط± ظ‚ط·ط¹ ظ…طھط§ط­ط©",
        message: lowStockMessage(lowStockSnapshot.product_name || `Product ${result.productId}`, totalStock),
        action_url: `/inventory?productId=${encodeURIComponent(String(result.productId || ""))}`,
        entity_type: "product",
        entity_id: result.productId,
        metadata: {
          product_id: result.productId,
          variant_id: variantId,
          stock: totalStock,
          image_url: lowStockSnapshot.image_url || "",
          badge: "ط¹ط§ط¬ظ„",
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
      category: req.query.category || req.query.category_name || req.query.categoryName || "",
      grade: req.query.grade || req.query.product_grade || req.query.productGrade || "",
      manufacturer: req.query.manufacturer || req.query.manufacturer_name || req.query.manufacturerName || "",
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
        'ط¹ط§ط¬ظ„' AS badge_text
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

export const getPurchaseAlerts = async (req, res) => {
  try {
    await ensureInventoryAlertProductColumns();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    let alerts = await fetchPurchaseAlerts({ tenantId });

    const alertTypeFilter = String(req.query.alert_type || req.query.alertType || "").trim().toLowerCase();
    const brandIdFilter = String(req.query.brand_id || req.query.brandId || "").trim();
    const categoryIdFilter = String(req.query.category_id || req.query.categoryId || "").trim();
    const manufacturerIdFilter = String(req.query.manufacturer_id || req.query.manufacturerId || "").trim();
    const searchFilter = String(req.query.search || "").trim().toLowerCase();

    if (alertTypeFilter && alertTypeFilter !== "all") {
      alerts = alerts.filter((alert) => alert.alert_type === alertTypeFilter);
    }
    if (brandIdFilter) {
      alerts = alerts.filter((alert) => String(alert.brand_id ?? "") === brandIdFilter);
    }
    if (categoryIdFilter) {
      alerts = alerts.filter((alert) => String(alert.category_id ?? "") === categoryIdFilter);
    }
    if (manufacturerIdFilter) {
      alerts = alerts.filter((alert) => String(alert.manufacturer_id ?? "") === manufacturerIdFilter);
    }
    if (searchFilter) {
      alerts = alerts.filter((alert) =>
        [alert.product_name, alert.color, alert.alert_title, alert.alert_reason, ...(Array.isArray(alert.missing_sizes) ? alert.missing_sizes : [])]
          .join(" ")
          .toLowerCase()
          .includes(searchFilter)
      );
    }

    return res.status(200).json({
      success: true,
      alerts,
      count: alerts.length,
      groups: {
        missing_sizes: alerts.filter((alert) => alert.alert_type === "missing_sizes").length,
        carton_threshold: alerts.filter((alert) => alert.alert_type === "carton_threshold").length,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch purchase alerts",
      error: error.message,
    });
  }
};

export const createPurchaseAlertsDraft = async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await ensureInventoryAlertProductColumns();
    await ensureDraftPurchaseSchema(client);

    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    if (tenantId === null || tenantId === undefined) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Tenant context is required to create a purchase draft",
      });
    }
    const currentAlerts = await fetchPurchaseAlerts({ tenantId });
    const currentAlertsByKey = new Map(currentAlerts.map((alert) => [normalizeAlertSelectionKey(alert), alert]));
    const selectedRows = extractSelectedAlertRows(req.body);

    if (!selectedRows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "selected alerts are required",
      });
    }

    const selectedAlerts = [];
    for (const row of selectedRows) {
      const key = normalizeAlertSelectionKey(row);
      const alert = currentAlertsByKey.get(key);
      if (!alert) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "One or more selected alerts are no longer available",
          invalid_scope_key: key || null,
        });
      }

      if (row.product_id !== undefined && String(row.product_id) !== String(alert.product_id)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Selected alert product mismatch",
        });
      }

      if (row.purchase_alert_by_color !== undefined && Boolean(row.purchase_alert_by_color) !== Boolean(alert.purchase_alert_by_color)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Selected alert scope mismatch",
        });
      }

      if (alert.purchase_alert_by_color) {
        const requestedColor = normalizeColorLabel(row.color || row.scope_label || "");
        const alertColor = normalizeColorLabel(alert.color || alert.scope_label || "");
        if (requestedColor && requestedColor.toLowerCase() !== alertColor.toLowerCase()) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: "Selected alert color mismatch",
          });
        }
      }

      const requestedVariantIds = Array.isArray(row.variant_ids)
        ? row.variant_ids.map((value) => normalizeIdValue(value)).filter((value) => value !== null && value !== undefined)
        : [];
      if (requestedVariantIds.length && Array.isArray(alert.variant_ids) && alert.variant_ids.length) {
        const alertVariantSet = new Set(alert.variant_ids.map((value) => String(value)));
        const mismatch = requestedVariantIds.some((value) => !alertVariantSet.has(String(value)));
        if (mismatch) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: "Selected alert variant mismatch",
          });
        }
      }

      selectedAlerts.push(alert);
    }

    const supplierLabel = normalizeDraftLabel(
      selectedAlerts.map((alert) => normalizeDisplayText(alert.manufacturer_name || alert.brand_name)).find(Boolean),
      "Smart Purchase Alerts"
    );
    const supplierId = await ensureDraftSupplier(client, tenantId, supplierLabel);
    const warehouseId = await getDefaultDraftWarehouseId(client, tenantId);
    const requestedBranchId = Number(req.body?.branch_id ?? req.body?.branchId ?? req.headers?.["x-branch-id"] ?? req.user?.branch_id);
    const branchResult = await client.query(
      `
      SELECT id
      FROM branches
      WHERE tenant_id = $1
      ORDER BY
        CASE WHEN id = $2 THEN 0 ELSE 1 END,
        CASE WHEN LOWER(TRIM(name)) IN (LOWER('البشبيشي'), LOWER('فرع البشبيشي')) THEN 0 ELSE 1 END,
        CASE WHEN is_active THEN 0 ELSE 1 END,
        id ASC
      LIMIT 1
      `,
      [tenantId, Number.isInteger(requestedBranchId) && requestedBranchId > 0 ? requestedBranchId : null]
    );
    const branchId = branchResult.rows[0]?.id || null;
    const draftLines = selectedAlerts.map(buildPurchaseAlertDraftItem);
    const draftSubtotal = 0;
    const draftPayload = buildPurchaseAlertDraftPayload({
      alerts: selectedAlerts,
      purchase: {
        status: "draft",
        payment_status: "unpaid",
      },
      supplier: { id: supplierId, name: supplierLabel },
      warehouse: warehouseId ? { id: warehouseId, name: "" } : null,
    });

    const purchaseResult = await client.query(
      `
      INSERT INTO purchases (
        tenant_id,
        supplier_id,
        warehouse_id,
        branch_id,
        status,
        payment_status,
        subtotal,
        tax_amount,
        discount_amount,
        total,
        paid_amount,
        notes,
        created_by,
        metadata
      )
      VALUES ($1, $2, $3, $4, 'draft', 'unpaid', $5, 0, 0, $5, 0, $6, $7, $8::jsonb)
      RETURNING *
      `,
      [
        tenantId,
        supplierId,
        warehouseId,
        branchId,
        draftSubtotal,
        "Smart purchase alerts draft",
        req.user?.id || null,
        JSON.stringify({
          ...draftPayload.metadata,
          source: "smart_purchase_alerts",
        }),
      ]
    );
    const purchase = purchaseResult.rows[0] || null;
    if (!purchase?.id) {
      throw new Error("Failed to create purchase draft");
    }

    for (const line of draftLines) {
      await client.query(
        `
        INSERT INTO purchase_items (
          tenant_id,
          purchase_id,
          product_id,
          variant_id,
          quantity,
          cost_price,
          total,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        `,
        [
          tenantId,
          purchase.id,
          line.product_id ?? null,
          line.variant_id ?? null,
          Number(line.quantity || 1),
          Number(line.cost_price || 0),
          Number(line.total || 0),
          JSON.stringify(line.metadata || {}),
        ]
      );
    }

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "Purchase draft created",
      draft_id: purchase.id,
      purchase,
      items: draftLines,
      draft_payload: buildPurchaseAlertDraftPayload({
        alerts: selectedAlerts,
        purchase,
        supplier: { id: supplierId, name: supplierLabel },
        warehouse: warehouseId ? { id: warehouseId, name: "" } : null,
      }),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to create purchase draft",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const getLowStockAlertsGrouped = async (req, res) => {
  try {
    await ensureInventoryAlertProductColumns();
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const threshold = LOW_STOCK_ALERT_MAX;

    const [productTotalResult, groupedRowsResult] = await Promise.all([
      db.query(
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
          WHERE ($1::bigint IS NULL OR p.tenant_id = $1::bigint OR p.tenant_id IS NULL)
          GROUP BY p.id, p.name, p.stock, p.low_stock_tracking_mode, p.product_low_stock_threshold, p.minimum_distinct_sizes_required, p.image_url, p.image, p.photo_url, p.thumbnail_url
        )
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
          'ط¹ط§ط¬ظ„' AS badge_text,
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
        ORDER BY total_stock ASC, product_name ASC
        `,
        [tenantId]
      ),
      db.query(
        `
        WITH candidate_products AS (
          SELECT DISTINCT p.id
          FROM products p
          WHERE ($2::bigint IS NULL OR p.tenant_id = $2::bigint OR p.tenant_id IS NULL)
            AND LOWER(COALESCE(p.status, 'active')) = 'active'
            AND COALESCE(NULLIF(p.low_stock_tracking_mode, ''), 'variant') <> 'product_total'
            AND (
              EXISTS (
                SELECT 1
                FROM product_variants pv
                WHERE pv.product_id = p.id
                  AND pv.is_active IS DISTINCT FROM FALSE
                  AND pv.deleted_at IS NULL
                AND GREATEST(COALESCE(pv.stock, 0), 0) BETWEEN 1 AND COALESCE(NULLIF(pv.low_stock_alert, 0), NULLIF(p.low_stock_alert, 0), $1::int)
              )
              OR (
                NOT EXISTS (
                  SELECT 1
                  FROM product_variants pv
                  WHERE pv.product_id = p.id
                    AND pv.is_active IS DISTINCT FROM FALSE
                    AND pv.deleted_at IS NULL
                )
                AND GREATEST(COALESCE(p.stock, 0), 0) BETWEEN 1 AND COALESCE(NULLIF(p.low_stock_alert, 0), $1::int)
              )
            )
        ),
        variant_rows AS (
          SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.sku AS product_sku,
            COALESCE(NULLIF(TRIM(pv.color), ''), '') AS color,
            COALESCE(NULLIF(TRIM(pv.size), ''), '') AS size,
            GREATEST(COALESCE(pv.stock, 0), 0)::int AS stock,
            COALESCE(NULLIF(pv.low_stock_alert, 0), NULLIF(p.low_stock_alert, 0), $1::int)::int AS threshold,
            COALESCE(
              NULLIF(p.image_url, ''),
              NULLIF(p.image, ''),
              NULLIF(p.photo_url, ''),
              NULLIF(p.thumbnail_url, ''),
              NULLIF(pv.image_url, ''),
              ''
            ) AS image_url,
            pv.id AS variant_id,
            p.image_url AS product_image_url
          FROM candidate_products cp
          JOIN products p ON p.id = cp.id
          JOIN product_variants pv ON pv.product_id = p.id
            AND pv.is_active IS DISTINCT FROM FALSE
            AND pv.deleted_at IS NULL
        ),
        simple_rows AS (
          SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.sku AS product_sku,
            '' AS color,
            '' AS size,
            GREATEST(COALESCE(p.stock, 0), 0)::int AS stock,
            COALESCE(NULLIF(p.low_stock_alert, 0), $1::int)::int AS threshold,
            COALESCE(
              NULLIF(p.image_url, ''),
              NULLIF(p.image, ''),
              NULLIF(p.photo_url, ''),
              NULLIF(p.thumbnail_url, ''),
              ''
            ) AS image_url,
            NULL::bigint AS variant_id,
            p.image_url AS product_image_url
          FROM candidate_products cp
          JOIN products p ON p.id = cp.id
          WHERE NOT EXISTS (
            SELECT 1
            FROM product_variants pv
            WHERE pv.product_id = p.id
              AND pv.is_active IS DISTINCT FROM FALSE
              AND pv.deleted_at IS NULL
          )
        )
        SELECT * FROM variant_rows
        UNION ALL
        SELECT * FROM simple_rows
        ORDER BY product_name ASC, color ASC, size ASC
        `,
        [threshold, tenantId]
      ),
    ]);

    const alerts = [
      ...(productTotalResult.rows || []),
      ...groupLowStockAlerts(groupedRowsResult.rows || [], { fallbackThreshold: threshold }),
    ]
      .map(repairPurchaseAlertDisplayFields)
      .sort((left, right) => {
      const scopeRank = { product_total: 0, product_color: 1, product_model: 2 };
      const leftScope = scopeRank[left.alert_scope] ?? 9;
      const rightScope = scopeRank[right.alert_scope] ?? 9;
      if (leftScope !== rightScope) return leftScope - rightScope;
      if (left.total_stock !== right.total_stock) return left.total_stock - right.total_stock;
      const nameCompare = String(left.product_name || left.name || "").localeCompare(String(right.product_name || right.name || ""), "ar");
      if (nameCompare !== 0) return nameCompare;
      return String(left.color || "").localeCompare(String(right.color || ""), "ar");
      });

    return res.status(200).json({
      success: true,
      threshold,
      alerts,
      count: alerts.length,
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

