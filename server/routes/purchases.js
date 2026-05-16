import express from "express";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pool from "../database/db.js";

import { protect } from "../middleware/authMiddleware.js";

import permit from "../middleware/permissionMiddleware.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { adjustVariantStock } from "../services/inventoryService.js";
import { postPurchaseEntry } from "../services/accountingService.js";
import { ensureSmartReorderSchema, getSmartReorderSuggestions } from "../services/smartReorderService.js";
import { createSystemNotification } from "../services/notificationsService.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ensurePurchaseDraftMetadataSchema = async (client) => {
  await client.query("ALTER TABLE IF EXISTS purchases ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE IF EXISTS purchase_items ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
};

const ensurePurchaseItemCostSchema = async (client) => {
  const sqlPath = path.join(__dirname, "../database/purchases_items_cost_fix.sql");
  console.log("[migration] loading:", sqlPath);
  if (!fs.existsSync(sqlPath)) {
    console.warn("[migration] missing:", sqlPath);
    return;
  }
  const sql = await readFile(sqlPath, "utf8");
  await client.query(sql);
};

const getTableColumns = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const getTableColumnInfo = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  return new Map(result.rows.map((row) => [row.column_name, row]));
};

const addInsertValue = (insertColumns, values, columns, columnName, value) => {
  if (!columns.has(columnName)) return false;
  insertColumns.push(columnName);
  values.push(value);
  return true;
};

const firstColumn = (columns, columnNames) => columnNames.find((columnName) => columns.has(columnName));

const requiredNoDefaultColumns = (columnInfo, ignored = new Set()) =>
  [...columnInfo.entries()]
    .filter(([, info]) => info.is_nullable === "NO" && info.column_default === null)
    .map(([columnName]) => columnName)
    .filter((columnName) => !ignored.has(columnName));

const ensurePurchaseCreateSchema = async (client) => {
  await client.query(`
    ALTER TABLE IF EXISTS suppliers
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS debt_balance NUMERIC(12,2) NOT NULL DEFAULT 0
  `);
  await client.query(`
    ALTER TABLE IF EXISTS warehouses
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS code VARCHAR(50),
      ADD COLUMN IF NOT EXISTS branch_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS location TEXT,
      ADD COLUMN IF NOT EXISTS qr_token TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'active'
  `);
  await client.query(`
    ALTER TABLE IF EXISTS purchases
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS warehouse_id BIGINT,
      ADD COLUMN IF NOT EXISTS purchase_number VARCHAR(100) NOT NULL DEFAULT ('PUR-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || FLOOR(RANDOM() * 1000)::INT),
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
      ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS created_by BIGINT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await client.query(`
    ALTER TABLE IF EXISTS purchase_items
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0
  `);
  await client.query(`
    DO $$
    DECLARE
      nullable_table_name text;
      nullable_column_name text;
    BEGIN
      FOREACH nullable_table_name IN ARRAY ARRAY['purchases', 'purchase_items']
      LOOP
        FOREACH nullable_column_name IN ARRAY ARRAY['manufacturer_id', 'manufacturer', 'manufacturer_name']
        LOOP
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND columns.table_name = nullable_table_name
              AND columns.column_name = nullable_column_name
          ) THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', nullable_table_name, nullable_column_name);
          END IF;
        END LOOP;
      END LOOP;
    END $$;
  `);
  await client.query(`
    ALTER TABLE IF EXISTS product_variants
      ADD COLUMN IF NOT EXISTS supplier_id BIGINT NULL,
      ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS default_purchase_qty INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await client.query(`
    ALTER TABLE IF EXISTS products
      ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await ensurePurchaseItemCostSchema(client);
  await client.query("ALTER TABLE IF EXISTS purchase_items DROP CONSTRAINT IF EXISTS purchase_items_variant_id_fkey");
  await ensurePurchaseDraftMetadataSchema(client);
};

const ensureDraftSupplier = async (client, tenantId, supplierId = null) => {
  if (supplierId) {
    const existing = await client.query(
      "SELECT id FROM suppliers WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) LIMIT 1",
      [supplierId, tenantId]
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;
  }

  const name = "Smart Reorder Draft Supplier";
  const found = await client.query(
    "SELECT id FROM suppliers WHERE (tenant_id = $1 OR tenant_id IS NULL) AND LOWER(name) = LOWER($2) ORDER BY id ASC LIMIT 1",
    [tenantId, name]
  );
  if (found.rows[0]?.id) return found.rows[0].id;

  const created = await client.query(
    `
    INSERT INTO suppliers (tenant_id, name, phone, email, address, status)
    VALUES ($1, $2, '', '', '', 'active')
    RETURNING id
    `,
    [tenantId, name]
  );
  return created.rows[0].id;
};

const loadVariantDraftLines = async (client, { tenantId, variantIds }) => {
  if (!variantIds.length) return [];
  const result = await client.query(
    `
    SELECT
      pv.id AS variant_id,
      pv.product_id,
      pv.supplier_id,
      COALESCE(pv.last_purchase_cost, pv.cost_price, p.cost_price, 0) AS cost_price,
      GREATEST(COALESCE(NULLIF(pv.default_purchase_qty, 0), pv.purchase_pack_qty, 1), 1) AS suggested_qty,
      COALESCE(p.name, '') AS product_name,
      COALESCE(pv.color, '') AS color,
      COALESCE(pv.size, '') AS size
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = ANY($1::bigint[])
      AND pv.tenant_id = $2
    ORDER BY p.name ASC, pv.color ASC, pv.size ASC
    `,
    [variantIds, tenantId]
  );
  return result.rows.map((row) => ({
    product_id: row.product_id,
    variant_id: row.variant_id,
    supplier_id: row.supplier_id,
    quantity: Number(row.suggested_qty || 1),
    cost_price: Number(row.cost_price || 0),
    metadata: {
      source: "variant_ids",
      product_name: row.product_name,
      color: row.color,
      size: row.size,
    },
  }));
};

const normalizeReorderDraftInput = (body = {}) => ({
  suggestionIds: Array.isArray(body.suggestion_ids) ? body.suggestion_ids.map(String).filter(Boolean) : [],
  variantIds: Array.isArray(body.variant_ids)
    ? body.variant_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    : [],
});

const tableExists = async (client, tableName) => {
  const result = await client.query("SELECT to_regclass($1) AS regclass", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.regclass);
};

const normalizePurchaseStatus = (value) => String(value || "draft").trim().toLowerCase().replace(/\s+/g, "_");

const isReceivedPurchaseStatus = (value) => ["received", "posted", "receive", "post"].includes(normalizePurchaseStatus(value));

const normalizeCreatePurchaseStatus = (value) => {
  const normalized = normalizePurchaseStatus(value || "received");
  return normalized === "draft" ? "received" : normalized;
};

const normalizePaymentStatus = (value) => {
  const normalized = normalizePurchaseStatus(value || "pending");
  return normalized === "unpaid" ? "pending" : normalized;
};

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizePurchaseItem = (item = {}) => {
  const quantity = toPositiveNumber(item.quantity || item.qty || 1, 1);
  const rawCost = item.unit_cost || item.unitCost || item.cost_price || item.costPrice || item.price || 0;
  const unitCost = Number(rawCost);
  const costIsValid = Number.isFinite(unitCost) && unitCost > 0;
  const safeUnitCost = costIsValid ? unitCost : 0;
  const lineTotal = quantity * safeUnitCost;
  return {
    product_id: item.product_id ?? item.productId ?? null,
    variant_id: item.variant_id ?? item.variantId ?? null,
    sku: item.sku || "",
    color: item.color || "",
    size: item.size || "",
    quantity,
    unit_cost: safeUnitCost,
    cost_price: safeUnitCost,
    cost_is_valid: costIsValid,
    total: lineTotal,
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
  };
};

const insertPurchaseItem = async (client, { tenantId, purchaseId, item, metadata = {} }) => {
  const columnInfo = await getTableColumnInfo(client, "purchase_items");
  const columns = new Set(columnInfo.keys());
  const insertColumns = [];
  const values = [];

  addInsertValue(insertColumns, values, columns, "tenant_id", tenantId);
  addInsertValue(insertColumns, values, columns, "purchase_id", purchaseId);
  addInsertValue(insertColumns, values, columns, "product_id", item.product_id ?? null);
  addInsertValue(insertColumns, values, columns, "variant_id", item.variant_id || null);
  addInsertValue(insertColumns, values, columns, firstColumn(columns, ["quantity", "qty"]), item.quantity);

  const unitCost = Number(item.unit_cost || item.cost_price || item.price || 0);
  if (columns.has("cost_price")) {
    insertColumns.push("cost_price");
    values.push(unitCost);
  }
  if (columns.has("unit_cost")) {
    insertColumns.push("unit_cost");
    values.push(unitCost);
  }
  if (columns.has("total")) {
    insertColumns.push("total");
    values.push(Number(item.total || item.quantity * unitCost));
  }
  if (columns.has("total_amount")) {
    insertColumns.push("total_amount");
    values.push(Number(item.total || item.quantity * unitCost));
  }
  if (columns.has("tax_amount")) {
    insertColumns.push("tax_amount");
    values.push(Number(item.tax_amount ?? item.tax ?? 0) || 0);
  }
  if (columns.has("discount_amount")) {
    insertColumns.push("discount_amount");
    values.push(Number(item.discount_amount ?? item.discount ?? 0) || 0);
  }
  addInsertValue(insertColumns, values, columns, "sku", item.sku || "");
  addInsertValue(insertColumns, values, columns, "color", item.color || "");
  addInsertValue(insertColumns, values, columns, "size", item.size || "");
  if (columns.has("metadata")) {
    insertColumns.push("metadata");
    values.push(JSON.stringify({ ...metadata, ...(item.metadata || {}), unit_cost: unitCost, cost_price: unitCost }));
  }

  const missingRequired = requiredNoDefaultColumns(columnInfo, new Set(["id"])).filter((columnName) => !insertColumns.includes(columnName));
  if (missingRequired.length) {
    const error = new Error(`purchase_items missing required columns: ${missingRequired.join(", ")}`);
    error.status = 500;
    error.code = "PURCHASE_ITEMS_SCHEMA_MISMATCH";
    throw error;
  }

  const placeholders = values.map((_, index) => `$${index + 1}`);
  console.log("[purchase:create] item insert columns:", insertColumns);
  await client.query(
    `
    INSERT INTO purchase_items (${insertColumns.join(", ")})
    VALUES (${placeholders.join(", ")})
    `,
    values
  );
};

const ensureDefaultSupplierForPurchase = async (client, tenantId, supplierId = null) => {
  const numericSupplierId = Number(supplierId);
  if (Number.isInteger(numericSupplierId) && numericSupplierId > 0) {
    const existing = await client.query(
      "SELECT id FROM suppliers WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) LIMIT 1",
      [numericSupplierId, tenantId]
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;
  }

  const name = "Default Supplier";
  const existingDefault = await client.query(
    "SELECT id FROM suppliers WHERE (tenant_id = $1 OR tenant_id IS NULL) AND LOWER(name) = LOWER($2) ORDER BY id ASC LIMIT 1",
    [tenantId, name]
  );
  if (existingDefault.rows[0]?.id) return existingDefault.rows[0].id;

  const created = await client.query(
    `
    INSERT INTO suppliers (tenant_id, name, phone, email, address, status)
    VALUES ($1, $2, '', '', '', 'active')
    RETURNING id
    `,
    [tenantId, name]
  );
  return created.rows[0].id;
};

const ensureDefaultWarehouseForPurchase = async (client, tenantId, warehouseId = null) => {
  const numericWarehouseId = Number(warehouseId);
  if (Number.isInteger(numericWarehouseId) && numericWarehouseId > 0) {
    const existing = await client.query(
      "SELECT id FROM warehouses WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL) LIMIT 1",
      [numericWarehouseId, tenantId]
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;
  }

  const existingDefault = await client.query(
    "SELECT id FROM warehouses WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY id ASC LIMIT 1",
    [tenantId]
  );
  if (existingDefault.rows[0]?.id) return existingDefault.rows[0].id;

  const created = await client.query(
    `
    INSERT INTO warehouses (tenant_id, name, code, branch_name, location, qr_token, status)
    VALUES ($1, 'Main Warehouse', 'MAIN', 'Main', '', $2, 'active')
    RETURNING id
    `,
    [tenantId, `main-warehouse-${tenantId}-${Date.now()}`]
  );
  return created.rows[0].id;
};

const upsertWarehouseVariantStock = async (client, { tenantId, warehouseId, variantId, quantity }) => {
  const tableName = (await tableExists(client, "warehouse_inventory"))
    ? "warehouse_inventory"
    : (await tableExists(client, "warehouse_variant_stock"))
      ? "warehouse_variant_stock"
      : (await tableExists(client, "warehouse_stock"))
        ? "warehouse_stock"
        : null;
  if (!warehouseId || !variantId || !tableName) return;
  try {
    await client.query("SAVEPOINT purchase_warehouse_stock");
    const columns = await getTableColumns(client, tableName);
    const stockColumn = firstColumn(columns, ["stock", "quantity", "qty", "available_quantity"]) || "stock";
    const tenantFilter = columns.has("tenant_id") ? "AND (tenant_id = $4 OR tenant_id IS NULL)" : "";
    const updateParams = columns.has("tenant_id") ? [quantity, warehouseId, variantId, tenantId] : [quantity, warehouseId, variantId];
    console.log("[purchase:create] warehouse stock update:", { tableName, stockColumn, columns: [...columns] });
    const updated = await client.query(
      `
      UPDATE ${tableName}
      SET ${stockColumn} = COALESCE(${stockColumn}, 0) + $1
      WHERE warehouse_id = $2
        AND variant_id = $3
        ${tenantFilter}
      `,
      updateParams
    );

    if (updated.rowCount === 0) {
      const insertColumns = [];
      const values = [];
      addInsertValue(insertColumns, values, columns, "tenant_id", tenantId);
      addInsertValue(insertColumns, values, columns, "warehouse_id", warehouseId);
      addInsertValue(insertColumns, values, columns, "variant_id", variantId);
      addInsertValue(insertColumns, values, columns, stockColumn, quantity);
      const placeholders = values.map((_, index) => `$${index + 1}`);
      await client.query(
        `INSERT INTO ${tableName} (${insertColumns.join(", ")}) VALUES (${placeholders.join(", ")})`,
        values
      );
    }
    await client.query("RELEASE SAVEPOINT purchase_warehouse_stock");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT purchase_warehouse_stock").catch(() => {});
    console.error("[purchase:create] warehouse stock warning:", error, error.stack);
  }
};

const insertPurchaseHeader = async (client, data = {}) => {
  const columnInfo = await getTableColumnInfo(client, "purchases");
  const columns = new Set(columnInfo.keys());
  const insertColumns = [];
  const values = [];

  addInsertValue(insertColumns, values, columns, "tenant_id", data.tenantId);
  addInsertValue(insertColumns, values, columns, "supplier_id", data.supplierId);
  addInsertValue(insertColumns, values, columns, "warehouse_id", data.warehouseId);
  addInsertValue(insertColumns, values, columns, "purchase_number", data.purchaseNumber);
  addInsertValue(insertColumns, values, columns, "status", data.status);
  addInsertValue(insertColumns, values, columns, "payment_status", data.paymentStatus);
  addInsertValue(insertColumns, values, columns, "subtotal", data.subtotal);
  addInsertValue(insertColumns, values, columns, "tax", data.tax);
  addInsertValue(insertColumns, values, columns, "tax_amount", data.tax);
  addInsertValue(insertColumns, values, columns, "discount", data.discount);
  addInsertValue(insertColumns, values, columns, "discount_amount", data.discount);

  const totalColumns = ["total", "total_amount", "net_total", "grand_total"];
  for (const columnName of totalColumns) {
    addInsertValue(insertColumns, values, columns, columnName, data.total);
  }

  addInsertValue(insertColumns, values, columns, "paid_amount", data.paidAmount ?? 0);
  addInsertValue(insertColumns, values, columns, "notes", data.notes || "");
  addInsertValue(insertColumns, values, columns, "created_by", data.createdBy);
  if (columns.has("metadata")) {
    addInsertValue(insertColumns, values, columns, "metadata", JSON.stringify(data.metadata || {}));
  }

  const missingRequired = requiredNoDefaultColumns(columnInfo, new Set(["id", "created_at", "updated_at"])).filter((columnName) => !insertColumns.includes(columnName));
  if (missingRequired.length) {
    const error = new Error(`purchases missing required columns: ${missingRequired.join(", ")}`);
    error.status = 500;
    error.code = "PURCHASES_SCHEMA_MISMATCH";
    throw error;
  }

  const placeholders = values.map((_, index) => {
    const columnName = insertColumns[index];
    return columnName === "metadata" ? `$${index + 1}::jsonb` : `$${index + 1}`;
  });
  console.log("[purchase:create] purchase insert columns:", insertColumns);
  const result = await client.query(
    `
    INSERT INTO purchases (${insertColumns.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING *
    `,
    values
  );
  return result.rows[0];
};

const updateProductVariantAfterPurchase = async (client, { tenantId, variantId, supplierId, unitCost }) => {
  const columns = await getTableColumns(client, "product_variants");
  const sets = [];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (columns.has("last_purchase_cost")) sets.push(`last_purchase_cost = ${push(unitCost)}`);
  if (columns.has("cost_price")) sets.push(`cost_price = CASE WHEN ${push(unitCost)} > 0 THEN ${push(unitCost)} ELSE cost_price END`);
  if (columns.has("supplier_id")) sets.push(`supplier_id = COALESCE(supplier_id, ${push(supplierId)})`);
  if (columns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
  if (!sets.length) return;

  const where = [`id = ${push(variantId)}`];
  if (columns.has("tenant_id")) {
    const tenantParam = push(tenantId);
    where.push(`(${tenantParam}::bigint IS NULL OR tenant_id = ${tenantParam}::bigint OR tenant_id IS NULL)`);
  }
  console.log("[purchase:create] product variant update columns:", sets);
  await client.query(
    `
    UPDATE product_variants
    SET ${sets.join(", ")}
    WHERE ${where.join(" AND ")}
    `,
    values
  );
};

const updateProductFallbackStock = async (client, { tenantId, productId, quantity, unitCost }) => {
  const columns = await getTableColumns(client, "products");
  const stockColumn = firstColumn(columns, ["stock", "quantity", "qty"]);
  const sets = [];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (stockColumn) sets.push(`${stockColumn} = COALESCE(${stockColumn}, 0) + ${push(quantity)}`);
  if (columns.has("cost_price")) sets.push(`cost_price = CASE WHEN ${push(unitCost)} > 0 THEN ${push(unitCost)} ELSE cost_price END`);
  if (columns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
  if (!sets.length) return;

  const where = [`id = ${push(productId)}`];
  if (columns.has("tenant_id")) {
    const tenantParam = push(tenantId);
    where.push(`(${tenantParam}::bigint IS NULL OR tenant_id = ${tenantParam}::bigint OR tenant_id IS NULL)`);
  }
  console.log("[purchase:create] product fallback update columns:", sets);
  await client.query(
    `
    UPDATE products
    SET ${sets.join(", ")}
    WHERE ${where.join(" AND ")}
    `,
    values
  );
};

router.get(
  "/reorder-suggestions",
  protect,
  permit("purchases", "view"),
  async (req, res) => {
    try {
      const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
      const result = await getSmartReorderSuggestions({ tenantId });
      const data = Array.isArray(result?.data) ? result.data : [];
      res.json({
        success: true,
        data,
        suggestions: data,
        diagnostics: result?.diagnostics || {},
      });
    } catch (error) {
      console.error("[purchases] reorder suggestions", error, error?.stack);
      res.json({
        success: true,
        data: [],
        suggestions: [],
        diagnostics: error?.diagnostics || {
          queryErrors: [{ step: "route_reorder_suggestions", error: error?.message || String(error) }],
          detectedTables: {},
          detectedColumns: {},
          variantsProcessed: 0,
          suggestionsGenerated: 0,
        },
        message: "تعذر تحميل اقتراحات الشراء",
        error: process.env.NODE_ENV === "production" ? undefined : error.message,
      });
    }
  }
);

router.post(
  "/reorder-draft",
  protect,
  permit("purchases", "create"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const tenantId = getTenantId(req, req.user?.tenant_id);
      const { suggestionIds, variantIds } = normalizeReorderDraftInput(req.body);

      if (!suggestionIds.length && !variantIds.length) {
        return res.status(400).json({
          success: false,
          message: "suggestion_ids or variant_ids required",
        });
      }

      await client.query("BEGIN");
      await ensurePurchaseCreateSchema(client);
      await ensureSmartReorderSchema(client);

      const lines = [];
      const reorderMetadata = [];

      if (suggestionIds.length) {
        const result = await getSmartReorderSuggestions({ tenantId });
        const suggestions = Array.isArray(result?.data) ? result.data : [];
        const selected = suggestions.filter((item) => suggestionIds.includes(String(item.suggestion_id)));

        selected.forEach((suggestion) => {
          const suggestionLines = Array.isArray(suggestion.suggested_lines) && suggestion.suggested_lines.length
            ? suggestion.suggested_lines
            : (Array.isArray(suggestion.variant_ids) ? suggestion.variant_ids : []).map((variantId) => ({
                product_id: suggestion.product_id,
                variant_id: variantId,
                suggested_qty: Math.max(1, Number(suggestion.suggested_qty || suggestion.purchase_pack_qty || 1)),
                last_purchase_cost: suggestion.last_purchase_cost,
              })).slice(0, 1);

          suggestionLines.forEach((line) => {
            lines.push({
              product_id: line.product_id || suggestion.product_id,
              variant_id: line.variant_id,
              supplier_id: suggestion.supplier_id,
              quantity: Math.max(1, Number(line.suggested_qty || suggestion.suggested_qty || suggestion.purchase_pack_qty || 1)),
              cost_price: Number(line.last_purchase_cost ?? suggestion.last_purchase_cost ?? 0),
              metadata: {
                source: "smart_reorder",
                suggestion_id: suggestion.suggestion_id,
                status: suggestion.status,
                risk_level: suggestion.risk_level,
                sell_through_percent: suggestion.sell_through_percent,
                current_stock: suggestion.current_stock,
                reorder_trigger_percent: suggestion.reorder_trigger_percent,
                product_name: suggestion.product_name,
                color: suggestion.color,
                size: line.size || null,
                reason: suggestion.reason,
              },
            });
          });

          reorderMetadata.push({
            suggestion_id: suggestion.suggestion_id,
            product_id: suggestion.product_id,
            variant_ids: suggestion.variant_ids || [],
            status: suggestion.status,
            risk_level: suggestion.risk_level,
            suggested_qty: suggestion.suggested_qty,
            supplier_id: suggestion.supplier_id,
          });
        });
      }

      if (variantIds.length) {
        lines.push(...await loadVariantDraftLines(client, { tenantId, variantIds }));
      }

      const validLines = lines.filter((line) => line.product_id && line.variant_id && Number(line.quantity) > 0);
      if (!validLines.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "No reorder draft lines could be created from the selected items",
        });
      }

      const knownSupplierIds = [...new Set(validLines.map((line) => Number(line.supplier_id)).filter((value) => Number.isInteger(value) && value > 0))];
      const supplierId = await ensureDraftSupplier(client, tenantId, knownSupplierIds.length === 1 ? knownSupplierIds[0] : null);
      const subtotal = validLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.cost_price || 0), 0);
      const metadata = {
        source: "smart_reorder",
        created_from: {
          suggestion_ids: suggestionIds,
          variant_ids: variantIds,
        },
        supplier_prefill: knownSupplierIds.length === 1 ? "known" : "fallback",
        reorder: reorderMetadata,
      };

      const purchaseResult = await client.query(
        `
        INSERT INTO purchases (
          tenant_id,
          supplier_id,
          status,
          payment_status,
          subtotal,
          total,
          notes,
          created_by,
          metadata
        )
        VALUES ($1, $2, 'draft', 'unpaid', $3, $3, $4, $5, $6::jsonb)
        RETURNING *
        `,
        [
          tenantId,
          supplierId,
          subtotal,
          "Smart Reorder purchase draft",
          req.user?.id || null,
          JSON.stringify(metadata),
        ]
      );
      const purchase = purchaseResult.rows[0];
      const purchaseTotal = Number(purchase.total ?? subtotal);

      for (const line of validLines) {
        const itemTotal = Number(line.quantity || 0) * Number(line.cost_price || 0);
        await insertPurchaseItem(client, {
          tenantId,
          purchaseId: purchase.id,
          item: {
            product_id: line.product_id,
            variant_id: line.variant_id,
            quantity: line.quantity,
            unit_cost: line.cost_price,
            cost_price: line.cost_price,
            total: itemTotal,
          },
          metadata: line.metadata || {},
        });
      }

      await client.query("COMMIT");

      if (isReceivedPurchaseStatus(purchase.status)) {
        createSystemNotification("purchase_confirmed", {
          tenant_id: tenantId,
          message: `فاتورة شراء ${purchase.purchase_number || purchase.id} تم تأكيدها`,
          action_url: `/purchases/${purchase.id}`,
          entity_type: "purchase",
          entity_id: purchase.id,
          metadata: { purchase_id: purchase.id, purchase_number: purchase.purchase_number || null, total: purchaseTotal },
        }).catch((error) => console.warn("[notifications] purchase skipped", error?.message || error));
      }

      res.status(201).json({
        success: true,
        message: "Purchase draft created",
        purchase,
        items: validLines,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[purchases] reorder draft", error, error?.stack);
      res.status(500).json({
        success: false,
        message: "Failed To Create Reorder Draft",
        error: error.message,
      });
    } finally {
      client.release();
    }
  }
);

/* ======================================================
   CREATE PURCHASE
====================================================== */

router.post(
  "/",
  protect,
  permit("purchases", "create"),
  async (req, res) => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[purchase:create] payload:", JSON.stringify(req.body, null, 2));
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensurePurchaseCreateSchema(client);
      await ensureSmartReorderSchema(client);

      const tenantId = getTenantId(req, req.user?.tenant_id);
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      const items = rawItems.map(normalizePurchaseItem);
      console.log("[purchase:create] normalized items:", items);

      if (!items.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Purchase items are required",
          error: "VALIDATION_ERROR",
          details: "Send at least one item in items[].",
        });
      }

      const invalidItem = items.find((item) => !item.product_id || item.quantity <= 0);
      if (invalidItem) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Invalid purchase item",
          error: "VALIDATION_ERROR",
          details: "Each item must include product_id and quantity greater than zero.",
        });
      }

      const invalidCostItem = items.find((item) => !item.cost_is_valid);
      if (invalidCostItem) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Purchase item cost is required",
          error: "VALIDATION_ERROR",
          details: "Each item must include unit_cost, cost_price, or price greater than zero.",
        });
      }

      const supplierId = await ensureDefaultSupplierForPurchase(client, tenantId, req.body?.supplier_id ?? req.body?.supplierId);
      const warehouseId = await ensureDefaultWarehouseForPurchase(client, tenantId, req.body?.warehouse_id ?? req.body?.warehouseId);
      const status = normalizeCreatePurchaseStatus(req.body?.status);
      const paymentStatus = normalizePaymentStatus(req.body?.payment_status ?? req.body?.paymentStatus);
      const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
      const discount = Number(req.body?.discount ?? req.body?.discount_amount ?? 0) || 0;
      const tax = Number(req.body?.tax ?? req.body?.tax_amount ?? 0) || 0;
      const total = Number(req.body?.total ?? req.body?.net_total ?? req.body?.grand_total ?? req.body?.total_amount ?? Math.max(0, subtotal + tax - discount)) || 0;
      const purchaseNumber = req.body?.purchase_number || req.body?.purchaseNumber || `PUR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const purchase = await insertPurchaseHeader(client, {
        tenantId,
        supplierId,
        warehouseId,
        purchaseNumber,
        status,
        paymentStatus,
        subtotal,
        tax,
        discount,
        total,
        paidAmount: Number(req.body?.paid_amount ?? req.body?.paidAmount ?? 0) || 0,
        notes: req.body?.notes || "",
        createdBy: req.user?.id || null,
        metadata: {
          ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
          source: "purchase_order",
          received_on_create: isReceivedPurchaseStatus(status),
        },
      });

      for (const item of items) {
        const itemTotal = Number(item.total || item.quantity * item.unit_cost);
        await insertPurchaseItem(client, {
          tenantId,
          purchaseId: purchase.id,
          item: {
            ...item,
            total: itemTotal,
            cost_price: item.unit_cost,
          },
          metadata: { sku: item.sku, color: item.color, size: item.size },
        });

        if (isReceivedPurchaseStatus(status)) {
          if (item.variant_id) {
            await adjustVariantStock(client, {
              tenantId,
              variantId: item.variant_id,
              quantityChange: item.quantity,
              movementType: "purchase",
              referenceType: "purchase",
              referenceId: purchase.id,
              warehouseId,
              unitCost: item.unit_cost,
              totalCost: itemTotal,
              reason: "Purchase receiving",
              notes: `Purchase received SKU ${item.sku || item.variant_id}`,
              createdBy: req.user?.id || null,
            });

            await upsertWarehouseVariantStock(client, {
              tenantId,
              warehouseId,
              variantId: item.variant_id,
              quantity: item.quantity,
            });

            await updateProductVariantAfterPurchase(client, {
              tenantId,
              variantId: item.variant_id,
              supplierId,
              unitCost: item.unit_cost,
            });
          } else {
            await updateProductFallbackStock(client, {
              tenantId,
              productId: item.product_id,
              quantity: item.quantity,
              unitCost: item.unit_cost,
            });
          }
        }
      }

      try {
        await client.query("SAVEPOINT purchase_accounting_entry");
        await postPurchaseEntry(client, {
          tenantId,
          referenceType: "purchase",
          referenceId: purchase.id,
          description: `Purchase receipt #${purchase.id}`,
          amount: total,
          paymentType: req.body.payment_method || req.body.paymentMethod || "ap",
          createdBy: req.user?.id || null,
        });
        await client.query("RELEASE SAVEPOINT purchase_accounting_entry");
      } catch (accountingError) {
        await client.query("ROLLBACK TO SAVEPOINT purchase_accounting_entry").catch(() => {});
        console.error("[purchase:create] accounting warning:", accountingError, accountingError.stack);
      }

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: "Purchase Created Successfully",
        purchase,
        items,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[purchase:create] error:", error, error?.stack);
      res.status(500).json({
        success: false,
        message: "Failed To Create Purchase",
        error: error.message,
        detail: error.detail,
        code: error.code,
        stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
      });
    } finally {
      client.release();
    }
  }
);

export default router;
