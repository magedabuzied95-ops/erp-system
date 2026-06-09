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
import { recordInventoryMovement } from "../services/inventoryMovementService.js";
import { createJournalEntry, ensureAccountingSchema, postInventoryAdjustment, postMoneyTransaction, postPurchaseEntry, recordFinancialAccountActivity, reverseMoneyTransactionsForReference } from "../services/accountingService.js";
import { ensureSmartReorderSchema, getSmartReorderSuggestions } from "../services/smartReorderService.js";
import { createSystemNotification } from "../services/notificationsService.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyPurchasePriceSyncWrite(payload = {}) {
  try {
    console.log("[purchase-price-sync-verify]", payload);
  } catch (error) {
    console.warn("[purchase-price-sync-verify-warning]", error?.message || error);
  }
}

const previewSql = (sql = "") =>
  String(sql || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

const purchaseErrorPayload = (error = {}) => ({
  error: error.message,
  detail: error.detail,
  code: error.code,
  step: error.purchaseStep || error.checkoutDbContext?.step,
  query: error.purchaseQuery || error.checkoutDbContext?.operation,
  stack: process.env.NODE_ENV !== "production" ? error.stack : undefined,
});

const withPurchaseQueryLogging = (client, context = {}) => {
  if (client.__purchaseQueryLoggingWrapped) return;
  client.__purchaseQueryLoggingWrapped = true;
  const originalQuery = client.query.bind(client);
  client.query = async (...args) => {
    const sql = typeof args[0] === "string" ? args[0] : args[0]?.text || "";
    const params = typeof args[0] === "string" ? (Array.isArray(args[1]) ? args[1] : []) : (Array.isArray(args[0]?.values) ? args[0].values : []);
    const queryName = context.currentStep || "purchase.query";
    const startedAt = Date.now();
    console.log("[purchase:create] db query start", {
      requestId: context.requestId,
      purchase_save_id: context.purchaseSaveId || null,
      step: queryName,
      params: params.length,
      sql: previewSql(sql),
    });
    try {
      const result = await originalQuery(...args);
      console.log("[purchase:create] db query end", {
        requestId: context.requestId,
        purchase_save_id: context.purchaseSaveId || null,
        step: queryName,
        durationMs: Date.now() - startedAt,
        rows: result?.rowCount,
      });
      return result;
    } catch (error) {
      error.purchaseStep = error.purchaseStep || queryName;
      error.purchaseQuery = error.purchaseQuery || previewSql(sql);
      console.error("[purchase:create] db query error", {
        requestId: context.requestId,
        purchase_save_id: context.purchaseSaveId || null,
        step: queryName,
        durationMs: Date.now() - startedAt,
        message: error.message,
        code: error.code,
        sql: previewSql(sql),
        stack: error.stack,
      });
      throw error;
    }
  };
};

const withPurchaseDeleteQueryLogging = (client, context = {}) => {
  if (client.__purchaseDeleteQueryLoggingWrapped) return;
  client.__purchaseDeleteQueryLoggingWrapped = true;
  const originalQuery = client.query.bind(client);
  client.query = async (...args) => {
    const sql = typeof args[0] === "string" ? args[0] : args[0]?.text || "";
    const params = typeof args[0] === "string" ? (Array.isArray(args[1]) ? args[1] : []) : (Array.isArray(args[0]?.values) ? args[0].values : []);
    const step = context.currentStep || "purchase.delete.query";
    const label = `[purchase-delete:${context.purchaseId || "unknown"}] db ${step}`;
    console.time(label);
    try {
      const result = await originalQuery(...args);
      console.timeEnd(label);
      console.log("[purchase:delete] db query end", {
        requestId: context.requestId,
        purchaseId: context.purchaseId,
        step,
        rows: result?.rowCount,
        params: params.length,
        sql: previewSql(sql),
      });
      return result;
    } catch (error) {
      console.timeEnd(label);
      error.purchaseStep = error.purchaseStep || step;
      error.purchaseQuery = error.purchaseQuery || previewSql(sql);
      console.error("[purchase:delete] db query error", {
        requestId: context.requestId,
        purchaseId: context.purchaseId,
        step,
        message: error.message,
        code: error.code,
        sql: previewSql(sql),
        stack: error.stack,
      });
      throw error;
    }
  };
};

const timedPurchaseDeleteStep = async (context, step, fn) => {
  if (context) context.currentStep = step;
  const label = `[purchase-delete:${context?.purchaseId || "unknown"}] ${step}`;
  console.time(label);
  try {
    return await fn();
  } finally {
    console.timeEnd(label);
  }
};

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

const coalesceColumns = (alias, columns, columnNames, fallback = "NULL") => {
  const expressions = columnNames.filter((columnName) => columns.has(columnName)).map((columnName) => `${alias}.${columnName}`);
  return expressions.length ? `COALESCE(${expressions.join(", ")}, ${fallback})` : fallback;
};

const coalesceNumericColumns = (alias, columns, columnNames, fallback = "NULL") => {
  const expressions = columnNames
    .filter((columnName) => columns.has(columnName))
    .map((columnName) => `NULLIF(${alias}.${columnName}, 0)`);
  return expressions.length ? `COALESCE(${expressions.join(", ")}, ${fallback})` : fallback;
};

const nullIfBlankColumn = (alias, columns, columnName) =>
  columns.has(columnName) ? `NULLIF(TRIM(${alias}.${columnName}::text), '')` : "NULL";

const firstTextColumn = (alias, columns, columnNames, fallback = "NULL") => {
  const expressions = columnNames.map((columnName) => nullIfBlankColumn(alias, columns, columnName));
  return `COALESCE(${expressions.join(", ")}, ${fallback})`;
};

const normalizedTextSql = (expression) => `LOWER(TRIM(regexp_replace(COALESCE(${expression}, ''), '[[:space:]]+', ' ', 'g')))`;

const formatPurchaseCode = (sequence) => `PO-${String(sequence).padStart(3, "0")}`;

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
      ADD COLUMN IF NOT EXISTS purchase_number VARCHAR(100) NOT NULL DEFAULT 'PO-PENDING',
      ADD COLUMN IF NOT EXISTS legacy_purchase_number VARCHAR(100),
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS deleted_by BIGINT NULL,
      ADD COLUMN IF NOT EXISTS delete_reason TEXT,
      ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS reversed_by BIGINT NULL,
      ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
      ADD COLUMN IF NOT EXISTS supplier_payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
      ADD COLUMN IF NOT EXISTS client_request_id VARCHAR(120),
      ADD COLUMN IF NOT EXISTS purchase_save_id VARCHAR(120),
      ADD COLUMN IF NOT EXISTS stock_applied BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS stock_applied_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS supplier_paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS created_by BIGINT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await client.query("ALTER TABLE IF EXISTS purchases ALTER COLUMN purchase_number SET DEFAULT 'PO-PENDING'");
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS purchases_tenant_purchase_number_uidx
      ON purchases (tenant_id, purchase_number)
      WHERE purchase_number IS NOT NULL AND purchase_number <> '' AND purchase_number <> 'PO-PENDING'
  `);
  await client.query(`
    ALTER TABLE IF EXISTS purchase_items
      ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
      ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS regular_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS article_code TEXT,
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
      ADD COLUMN IF NOT EXISTS last_purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS average_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS regular_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sale_price_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_purchase_pricing_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS article_code TEXT,
      ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS default_purchase_qty INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_product_variants_article_code_lower
      ON product_variants (LOWER(TRIM(article_code)))
      WHERE article_code IS NOT NULL AND TRIM(article_code) <> ''
  `);
  await client.query(`
    ALTER TABLE IF EXISTS products
      ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS average_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS regular_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sale_price_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS wholesale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_purchase_pricing_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  `);
  await ensurePurchaseItemCostSchema(client);
  await client.query("ALTER TABLE IF EXISTS purchase_items DROP CONSTRAINT IF EXISTS purchase_items_variant_id_fkey");
  await ensurePurchaseDraftMetadataSchema(client);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS purchases_tenant_client_request_uidx
      ON purchases (tenant_id, client_request_id)
      WHERE client_request_id IS NOT NULL AND client_request_id <> ''
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS purchases_tenant_purchase_save_uidx
      ON purchases (tenant_id, purchase_save_id)
      WHERE purchase_save_id IS NOT NULL AND purchase_save_id <> ''
  `);
};

const safeCreateIndex = async (client, sql, label) => {
  const timerLabel = `[purchase-delete:index] ${label}`;
  console.time(timerLabel);
  let savepoint = false;
  try {
    try {
      await client.query("SAVEPOINT purchase_index_check");
      savepoint = true;
    } catch {
      savepoint = false;
    }
    await client.query(sql);
    if (savepoint) await client.query("RELEASE SAVEPOINT purchase_index_check");
    console.timeEnd(timerLabel);
  } catch (error) {
    if (savepoint) await client.query("ROLLBACK TO SAVEPOINT purchase_index_check").catch(() => {});
    console.timeEnd(timerLabel);
    console.warn("[purchase-delete:index] skipped", { label, message: error.message, code: error.code });
  }
};

const ensurePurchaseDeleteIndexes = async (client) => {
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_purchase_items_tenant_purchase_id ON purchase_items (tenant_id, purchase_id)", "purchase_items tenant purchase_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items (purchase_id)", "purchase_items purchase_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items (product_id)", "purchase_items product_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_purchase_items_variant_id ON purchase_items (variant_id)", "purchase_items variant_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_purchase_items_tenant_variant_id ON purchase_items (tenant_id, variant_id)", "purchase_items tenant variant_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_ref ON inventory_movements (tenant_id, reference_type, reference_id)", "inventory_movements tenant reference");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_movements_ref ON inventory_movements (reference_type, reference_id)", "inventory_movements reference");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_variant_created ON inventory_movements (tenant_id, variant_id, created_at DESC)", "inventory_movements tenant variant created");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_movements_tenant_product_created ON inventory_movements (tenant_id, product_id, created_at DESC)", "inventory_movements tenant product created");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse_id ON inventory_movements (warehouse_id)", "inventory_movements warehouse_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_tenant_warehouse_variant ON warehouse_inventory (tenant_id, warehouse_id, variant_id)", "warehouse_inventory tenant warehouse variant");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_warehouse_id ON warehouse_inventory (warehouse_id)", "warehouse_inventory warehouse_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_warehouse_inventory_variant_id ON warehouse_inventory (variant_id)", "warehouse_inventory variant_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_product_variants_tenant_id_id ON product_variants (tenant_id, id)", "product_variants tenant id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_products_tenant_id_id ON products (tenant_id, id)", "products tenant id");
};

const ensurePurchaseCreateIndexes = async (client) => {
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_products_id ON products (id)", "products id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_product_variants_id ON product_variants (id)", "product_variants id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_product_variants_product_color_size ON product_variants (product_id, color, size)", "product_variants product color size");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_purchases_id ON purchases (id)", "purchases id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items (purchase_id)", "purchase_items purchase_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements (reference_type, reference_id)", "stock_movements reference");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference ON inventory_movements (reference_type, reference_id)", "inventory_movements reference");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_supplier_transactions_reference_id ON supplier_transactions (reference_id)", "supplier_transactions reference_id");
  await safeCreateIndex(client, "CREATE INDEX IF NOT EXISTS idx_financial_account_entries_source ON financial_account_entries (source_type, source_id)", "financial account entries source");
};

const roundPurchaseMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const createPurchaseAccountingUnavailableError = (message) => {
  const error = new Error(message);
  error.code = "ACCOUNTING_FAST_PATH_UNAVAILABLE";
  return error;
};

const postPurchaseEntryFast = async (client, data = {}) => {
  const tenantId = getTenantId({ user: { tenant_id: data.tenantId } }, data.tenantId);
  const amount = roundPurchaseMoney(data.amount || data.total || 0);
  if (!amount) return null;

  const payableCode = data.paymentType === "cash" ? "1000" : "2000";
  const accountResult = await client.query(
    `
    SELECT id, code
    FROM accounts
    WHERE tenant_id = $1
      AND code = ANY($2::text[])
    `,
    [tenantId, ["1200", payableCode]]
  );
  const accountByCode = new Map(accountResult.rows.map((row) => [String(row.code), Number(row.id)]));
  const inventoryAccountId = accountByCode.get("1200");
  const payableAccountId = accountByCode.get(payableCode);
  if (!inventoryAccountId || !payableAccountId) {
    throw createPurchaseAccountingUnavailableError(`Missing accounting account(s) for purchase save: 1200/${payableCode}`);
  }

  const entryResult = await client.query(
    `
    INSERT INTO journal_entries (
      tenant_id,
      entry_number,
      status,
      reference_type,
      reference_id,
      description,
      notes,
      entry_date,
      created_by,
      is_generated,
      entry_type,
      source_key,
      created_at,
      updated_at
    )
    VALUES ($1,$2,'posted',$3,$4,$5,$6,CURRENT_DATE,$7,FALSE,NULL,NULL,NOW(),NOW())
    RETURNING *
    `,
    [
      tenantId,
      data.entryNumber || data.entry_number || `JE-${Date.now()}-${data.referenceId || data.reference_id || "purchase"}`,
      data.referenceType || data.reference_type || "purchase",
      data.referenceId || data.reference_id || null,
      data.description || "Purchase receipt",
      data.notes || "",
      data.createdBy ?? data.created_by ?? null,
    ]
  );
  const journalEntry = entryResult.rows[0];
  const lineValues = [
    tenantId, journalEntry.id, inventoryAccountId, amount, 0, data.branchId ?? data.branch_id ?? null, data.notes || "",
    tenantId, journalEntry.id, payableAccountId, 0, amount, data.branchId ?? data.branch_id ?? null, data.notes || "",
  ];
  await client.query(
    `
    INSERT INTO journal_entry_lines (
      tenant_id,
      journal_entry_id,
      account_id,
      debit,
      credit,
      branch_id,
      notes,
      created_at
    )
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,NOW()),
      ($8,$9,$10,$11,$12,$13,$14,NOW())
    `,
    lineValues
  );

  return journalEntry;
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

const isReceivedPurchaseStatus = (value) => ["received", "posted", "receive", "post", "saved_received", "save_received"].includes(normalizePurchaseStatus(value));

const normalizeCreatePurchaseStatus = (value) => {
  const normalized = normalizePurchaseStatus(value || "received");
  return normalized === "draft" ? "received" : normalized;
};

const normalizePaymentStatus = (value) => {
  const normalized = normalizePurchaseStatus(value || "unpaid");
  if (["partial", "partially_paid"].includes(normalized)) return "partially_paid";
  if (normalized === "pending") return "unpaid";
  return normalized;
};

const normalizeSupplierPaymentStatus = (value) => {
  const normalized = normalizePurchaseStatus(value || "unpaid");
  if (["partial", "partially_paid"].includes(normalized)) return "partial";
  if (normalized === "pending") return "unpaid";
  if (normalized === "paid") return "paid";
  return "unpaid";
};

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const toNullableNonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const hasOwn = (source = {}, key) => Object.prototype.hasOwnProperty.call(source || {}, key);

const hasUsableNumericInput = (source = {}, keys = []) =>
  keys.some((key) => hasOwn(source, key) && toNullableNonNegativeNumber(source[key]) !== null);

const purchaseSyncNumber = (value) => toNullableNonNegativeNumber(value);

const priceSyncFlag = (item = {}, flag) => item.metadata?.__pricing_input?.[flag] === true;

const pricesDifferForSync = (nextValue, previousValue) => {
  const next = purchaseSyncNumber(nextValue);
  if (next === null) return false;
  const previous = purchaseSyncNumber(previousValue);
  if (previous === null) return true;
  return Math.abs(next - previous) > 0.0001;
};

const assertPurchaseItemPricingPayload = (items = []) => {
  items.forEach((item = {}, index) => {
    const row = index + 1;
    const cost = item.unit_cost ?? item.unitCost ?? item.cost_price ?? item.costPrice ?? item.purchase_price ?? item.purchasePrice ?? item.purchase_cost ?? item.purchaseCost;
    const salePrice = item.selling_price ?? item.sell_price ?? item.sellPrice ?? item.variant_sale_price ?? item.variantSalePrice ?? item.regular_price ?? item.price;
    const discountPrice = item.sale_price ?? item.salePrice ?? item.discount_price ?? item.discountPrice ?? item.sale_price_override ?? item.salePriceOverride ?? item.variant_discount_price ?? item.variantDiscountPrice ?? item.offer_price ?? item.offerPrice;
    const checks = [
      ["purchase cost", cost],
      ["sale price", salePrice],
      ["discount price", discountPrice],
    ];
    for (const [label, value] of checks) {
      if (value === null || value === undefined || value === "") continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        const error = new Error(`Row ${row}: ${label} must be 0 or greater.`);
        error.status = 400;
        throw error;
      }
    }
  });
};

const normalizePurchaseItem = (item = {}) => {
  const quantity = toPositiveNumber(item.quantity ?? item.qty ?? 1, 1);
  const rawCost = item.unit_cost ?? item.unitCost ?? item.cost_price ?? item.costPrice ?? item.purchase_price ?? item.purchasePrice ?? item.purchase_cost ?? item.purchaseCost ?? 0;
  const unitCost = Number(rawCost);
  const costIsValid = Number.isFinite(unitCost) && unitCost > 0;
  const safeUnitCost = Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : 0;
  const sellingPrice = toNonNegativeNumber(item.selling_price ?? item.sell_price ?? item.sellPrice ?? item.variant_sale_price ?? item.variantSalePrice ?? item.regular_price ?? item.price ?? 0, 0);
  const salePrice = toNullableNonNegativeNumber(item.sale_price ?? item.salePrice ?? item.discount_price ?? item.discountPrice ?? item.sale_price_override ?? item.salePriceOverride ?? item.variant_discount_price ?? item.variantDiscountPrice ?? item.offer_price ?? item.offerPrice);
  const wholesalePrice = Math.max(0, Number(item.wholesale_price ?? item.wholesalePrice ?? 0) || 0);
  const lineTotal = quantity * safeUnitCost;
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  return {
    id: item.id ?? item.purchase_item_id ?? item.purchaseItemId ?? null,
    purchase_item_id: item.id ?? item.purchase_item_id ?? item.purchaseItemId ?? null,
    product_id: item.product_id ?? item.productId ?? null,
    variant_id: item.variant_id ?? item.variantId ?? null,
    sku: item.sku || "",
    article_code: String(
      item.article_code ??
        item.articleCode ??
        item.model_code ??
        item.modelCode ??
        item.factory_model ??
        item.factoryModel ??
        item.factory_code ??
        item.factoryCode ??
        item.metadata?.article_code ??
        item.metadata?.articleCode ??
        item.metadata?.model_code ??
        item.metadata?.factory_model ??
        item.metadata?.factory_code ??
        ""
    ).trim(),
    color: item.color || "",
    size: item.size || "",
    quantity,
    unit_cost: safeUnitCost,
    cost_price: safeUnitCost,
    selling_price: sellingPrice,
    regular_price: sellingPrice,
    sale_price: salePrice ?? 0,
    variant_sale_price: sellingPrice,
    variant_discount_price: salePrice,
    wholesale_price: wholesalePrice,
    cost_is_valid: costIsValid,
    total: lineTotal,
    metadata: {
      ...metadata,
      __pricing_input: {
        ...(metadata.__pricing_input && typeof metadata.__pricing_input === "object" ? metadata.__pricing_input : {}),
        purchaseCost: hasUsableNumericInput(item, ["unit_cost", "unitCost", "cost_price", "costPrice", "purchase_price", "purchasePrice", "purchase_cost", "purchaseCost"]),
        sellingPrice: hasUsableNumericInput(item, ["selling_price", "sell_price", "sellPrice", "variant_sale_price", "variantSalePrice", "regular_price", "price"]),
        salePrice: hasUsableNumericInput(item, ["sale_price", "salePrice", "discount_price", "discountPrice", "sale_price_override", "salePriceOverride", "variant_discount_price", "variantDiscountPrice", "offer_price", "offerPrice"]),
      },
    },
  };
};

const normalizeIdempotencyKey = (req = {}) => {
  const body = req.body || {};
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const raw =
    req.get?.("Idempotency-Key") ||
    req.get?.("X-Idempotency-Key") ||
    body.client_request_id ||
    body.clientRequestId ||
    body.purchase_save_id ||
    body.purchaseSaveId ||
    metadata.client_request_id ||
    metadata.clientRequestId ||
    metadata.purchase_save_id ||
    metadata.purchaseSaveId ||
    "";
  return String(raw || "").trim().slice(0, 120);
};

const purchaseItemMergeKey = (item = {}) => {
  if (item.variant_id) return `variant:${item.variant_id}`;
  return [
    "product",
    item.product_id || "",
    String(item.sku || "").trim().toLowerCase(),
    String(item.color || "").trim().toLowerCase(),
    String(item.size || "").trim().toLowerCase(),
  ].join(":");
};

const mergePurchaseItems = (items = []) => {
  const groups = new Map();
  items.forEach((item) => {
    const key = purchaseItemMergeKey(item);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...item, metadata: { ...(item.metadata || {}) }, merged_line_count: 1 });
      return;
    }

    const quantity = Number(current.quantity || 0) + Number(item.quantity || 0);
    const nextUnitCost = Number(item.unit_cost ?? item.cost_price ?? 0);
    const currentUnitCost = Number(current.unit_cost ?? current.cost_price ?? 0);
    const unitCost = Number.isFinite(nextUnitCost) && nextUnitCost >= 0 ? nextUnitCost : currentUnitCost;
    const nextSellingPrice = Number(item.selling_price ?? item.regular_price ?? item.price ?? 0);
    const nextSalePrice = Number(item.sale_price ?? 0);
    const nextVariantSalePrice = Number(item.variant_sale_price ?? item.selling_price ?? item.regular_price ?? item.price ?? 0);
    const nextVariantDiscountPrice = Number(item.variant_discount_price ?? item.sale_price ?? 0);
    const nextWholesalePrice = Number(item.wholesale_price ?? 0);
    current.quantity = quantity;
    current.unit_cost = unitCost;
    current.cost_price = unitCost;
    current.total = quantity * unitCost;
    current.cost_is_valid = current.cost_is_valid || item.cost_is_valid;
    current.sku = current.sku || item.sku || "";
    current.article_code = current.article_code || item.article_code || "";
    current.color = current.color || item.color || "";
    current.size = current.size || item.size || "";
    current.selling_price = Number.isFinite(nextSellingPrice) && nextSellingPrice >= 0 ? nextSellingPrice : Number(current.selling_price || 0);
    current.regular_price = current.selling_price;
    current.sale_price = item.variant_discount_price === null ? 0 : Number.isFinite(nextSalePrice) && nextSalePrice >= 0 ? nextSalePrice : Number(current.sale_price || 0);
    current.variant_sale_price = Number.isFinite(nextVariantSalePrice) && nextVariantSalePrice >= 0 ? nextVariantSalePrice : Number(current.variant_sale_price || 0);
    current.variant_discount_price = item.variant_discount_price === null ? null : Number.isFinite(nextVariantDiscountPrice) && nextVariantDiscountPrice >= 0 ? nextVariantDiscountPrice : current.variant_discount_price;
    current.wholesale_price = Number.isFinite(nextWholesalePrice) && nextWholesalePrice >= 0 ? nextWholesalePrice : Number(current.wholesale_price || 0);
    current.metadata = {
      ...(current.metadata || {}),
      ...(item.metadata || {}),
      merged_duplicate_variant_lines: true,
    };
    current.merged_line_count = Number(current.merged_line_count || 1) + 1;
  });
  return Array.from(groups.values()).map((item) => ({
    ...item,
    total: Number(item.quantity || 0) * Number(item.unit_cost || 0),
    metadata: {
      ...(item.metadata || {}),
      merged_line_count: item.merged_line_count,
    },
  }));
};

const findExistingPurchaseByIdempotencyKey = async (client, { tenantId, idempotencyKey }) => {
  if (!idempotencyKey) return null;
  const result = await client.query(
    `
    SELECT *
    FROM purchases
    WHERE (tenant_id = $1 OR tenant_id IS NULL)
      AND (
        client_request_id = $2
        OR purchase_save_id = $2
        OR metadata->>'client_request_id' = $2
        OR metadata->>'purchase_save_id' = $2
      )
    ORDER BY id ASC
    LIMIT 1
    FOR UPDATE
    `,
    [tenantId, idempotencyKey]
  );
  return result.rows[0] || null;
};

const markPurchaseStockApplied = async (client, purchaseId) => {
  const columns = await getTableColumns(client, "purchases");
  if (!columns.has("stock_applied")) return null;
  const setAppliedAt = columns.has("stock_applied_at") ? ", stock_applied_at = CURRENT_TIMESTAMP" : "";
  const result = await client.query(
    `UPDATE purchases SET stock_applied = TRUE${setAppliedAt}, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
    [purchaseId]
  );
  return result.rows[0] || null;
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
  const sellingPrice = Number(item.selling_price ?? item.regular_price ?? item.price ?? 0) || 0;
  const salePrice = Number(item.sale_price ?? 0) || 0;
  const wholesalePrice = Number(item.wholesale_price ?? 0) || 0;
  if (columns.has("selling_price")) {
    insertColumns.push("selling_price");
    values.push(sellingPrice);
  }
  if (columns.has("regular_price")) {
    insertColumns.push("regular_price");
    values.push(sellingPrice);
  }
  if (columns.has("sale_price")) {
    insertColumns.push("sale_price");
    values.push(salePrice);
  }
  if (columns.has("wholesale_price")) {
    insertColumns.push("wholesale_price");
    values.push(wholesalePrice);
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
  addInsertValue(insertColumns, values, columns, "article_code", item.article_code || "");
  addInsertValue(insertColumns, values, columns, "color", item.color || "");
  addInsertValue(insertColumns, values, columns, "size", item.size || "");
  if (columns.has("metadata")) {
    insertColumns.push("metadata");
    values.push(JSON.stringify({
      ...metadata,
      ...(item.metadata || {}),
      unit_cost: unitCost,
      cost_price: unitCost,
      selling_price: sellingPrice,
      regular_price: sellingPrice,
      sale_price: salePrice,
      wholesale_price: wholesalePrice,
      article_code: item.article_code || "",
    }));
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
  const inserted = await client.query(
    `
    INSERT INTO purchase_items (${insertColumns.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING *
    `,
    values
  );
  return inserted.rows[0] || null;
};

const buildPurchaseItemInsertRow = ({ columns, tenantId, purchaseId, item, metadata = {} }) => {
  const unitCost = Number(item.unit_cost || item.cost_price || item.price || 0);
  const sellingPrice = Number(item.selling_price ?? item.regular_price ?? item.price ?? 0) || 0;
  const salePrice = Number(item.sale_price ?? 0) || 0;
  const wholesalePrice = Number(item.wholesale_price ?? 0) || 0;
  const quantityColumn = firstColumn(columns, ["quantity", "qty"]);
  const byColumn = {
    tenant_id: tenantId,
    purchase_id: purchaseId,
    product_id: item.product_id ?? null,
    variant_id: item.variant_id || null,
    [quantityColumn]: item.quantity,
    cost_price: unitCost,
    unit_cost: unitCost,
    total: Number(item.total || item.quantity * unitCost),
    total_amount: Number(item.total || item.quantity * unitCost),
    selling_price: sellingPrice,
    regular_price: sellingPrice,
    sale_price: salePrice,
    wholesale_price: wholesalePrice,
    tax_amount: Number(item.tax_amount ?? item.tax ?? 0) || 0,
    discount_amount: Number(item.discount_amount ?? item.discount ?? 0) || 0,
    sku: item.sku || "",
    article_code: item.article_code || "",
    color: item.color || "",
    size: item.size || "",
    metadata: JSON.stringify({
      ...metadata,
      ...(item.metadata || {}),
      sku: item.sku || metadata.sku || "",
      color: item.color || metadata.color || "",
      size: item.size || metadata.size || "",
      unit_cost: unitCost,
      cost_price: unitCost,
      selling_price: sellingPrice,
      regular_price: sellingPrice,
      sale_price: salePrice,
      wholesale_price: wholesalePrice,
      article_code: item.article_code || "",
    }),
  };
  return byColumn;
};

const insertPurchaseItemsBulk = async (client, { tenantId, purchaseId, items = [] }) => {
  const rows = items.map((item) => ({
    ...item,
    total: Number(item.total || item.quantity * item.unit_cost),
    cost_price: item.unit_cost,
  }));
  if (!rows.length) return [];
  const columnInfo = await getTableColumnInfo(client, "purchase_items");
  const columns = new Set(columnInfo.keys());
  const insertColumns = [
    "tenant_id", "purchase_id", "product_id", "variant_id", firstColumn(columns, ["quantity", "qty"]),
    "cost_price", "unit_cost", "total", "total_amount", "selling_price", "regular_price", "sale_price",
    "wholesale_price", "tax_amount", "discount_amount", "sku", "article_code", "color", "size", "metadata",
  ].filter((column, index, array) => column && columns.has(column) && array.indexOf(column) === index);
  const missingRequired = requiredNoDefaultColumns(columnInfo, new Set(["id"])).filter((columnName) => !insertColumns.includes(columnName));
  if (missingRequired.length) {
    const error = new Error(`purchase_items missing required columns: ${missingRequired.join(", ")}`);
    error.status = 500;
    error.code = "PURCHASE_ITEMS_SCHEMA_MISMATCH";
    throw error;
  }
  const values = [];
  const tuples = rows.map((item) => {
    const byColumn = buildPurchaseItemInsertRow({
      columns,
      tenantId,
      purchaseId,
      item,
      metadata: { sku: item.sku, article_code: item.article_code || "", color: item.color, size: item.size },
    });
    const placeholders = insertColumns.map((column) => {
      values.push(byColumn[column]);
      return `$${values.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  console.log("[purchase:create] bulk item insert columns:", insertColumns);
  const inserted = await client.query(
    `
    INSERT INTO purchase_items (${insertColumns.join(", ")})
    VALUES ${tuples.join(", ")}
    RETURNING *
    `,
    values
  );
  return inserted.rows || [];
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

const bulkAdjustWarehouseVariantStock = async (client, { tenantId, warehouseId, adjustments = [] }) => {
  const rows = adjustments
    .map((row) => ({ variantId: Number(row.variantId || row.variant_id || 0), quantity: Number(row.quantity || 0) }))
    .filter((row) => row.variantId > 0 && row.quantity !== 0);
  const tableName = (await tableExists(client, "warehouse_inventory"))
    ? "warehouse_inventory"
    : (await tableExists(client, "warehouse_variant_stock"))
      ? "warehouse_variant_stock"
      : (await tableExists(client, "warehouse_stock"))
        ? "warehouse_stock"
        : null;
  if (!warehouseId || !rows.length || !tableName) return;
  const columns = await getTableColumns(client, tableName);
  const stockColumn = firstColumn(columns, ["stock", "quantity", "qty", "available_quantity"]) || "stock";
  const values = [];
  const tuples = rows.map((row) => {
    values.push(row.variantId, row.quantity);
    return `($${values.length - 1}::bigint, $${values.length}::numeric)`;
  });
  values.push(warehouseId);
  const warehouseParam = values.length;
  let tenantFilter = "";
  if (columns.has("tenant_id")) {
    values.push(tenantId);
    const tenantParam = values.length;
    tenantFilter = `AND ($${tenantParam}::bigint IS NULL OR wi.tenant_id = $${tenantParam} OR wi.tenant_id IS NULL)`;
  }

  console.time("[purchase] warehouse_inventory batch update");
  const updated = await client.query(
    `
    WITH incoming(variant_id, quantity) AS (VALUES ${tuples.join(", ")})
    UPDATE ${tableName} wi
    SET ${stockColumn} = COALESCE(wi.${stockColumn}, 0) + incoming.quantity
    FROM incoming
    WHERE wi.warehouse_id = $${warehouseParam}
      AND wi.variant_id = incoming.variant_id
      ${tenantFilter}
    RETURNING wi.variant_id
    `,
    values
  );
  console.timeEnd("[purchase] warehouse_inventory batch update");

  const updatedIds = new Set(updated.rows.map((row) => Number(row.variant_id)));
  const missing = rows.filter((row) => !updatedIds.has(row.variantId));
  if (!missing.length) return;

  const insertColumns = [];
  const insertValues = [];
  const addColumnValue = (column, value) => {
    if (!columns.has(column)) return false;
    insertColumns.push(column);
    insertValues.push(value);
    return true;
  };
  addColumnValue("tenant_id", tenantId);
  addColumnValue("warehouse_id", warehouseId);
  addColumnValue("variant_id", null);
  addColumnValue(stockColumn, null);
  const variantIndex = insertColumns.indexOf("variant_id");
  const stockIndex = insertColumns.indexOf(stockColumn);
  if (variantIndex < 0 || stockIndex < 0) return;
  const insertParams = [];
  const insertTuples = missing.map((row) => {
    const tuple = insertColumns.map((column, index) => {
      const value = index === variantIndex ? row.variantId : index === stockIndex ? row.quantity : insertValues[index];
      insertParams.push(value);
      return `$${insertParams.length}`;
    });
    return `(${tuple.join(", ")})`;
  });
  console.time("[purchase] warehouse_inventory batch insert missing");
  await client.query(`INSERT INTO ${tableName} (${insertColumns.join(", ")}) VALUES ${insertTuples.join(", ")}`, insertParams);
  console.timeEnd("[purchase] warehouse_inventory batch insert missing");
};

const batchApplyVariantPurchaseStock = async (client, { tenantId, warehouseId, purchaseId, items = [], userId = null }) => {
  const variantItems = items
    .map((item) => ({ ...item, variant_id: Number(item.variant_id || 0), quantity: Number(item.quantity || 0), unit_cost: Number(item.unit_cost || item.cost_price || 0) }))
    .filter((item) => item.variant_id > 0 && item.quantity > 0);
  if (!variantItems.length) return { movementCount: 0, stockRows: [] };
  const variantIds = [...new Set(variantItems.map((item) => item.variant_id))];
  const deltaByVariant = new Map();
  for (const item of variantItems) {
    const current = deltaByVariant.get(item.variant_id) || { quantity: 0, items: [], product_id: item.product_id || null, unit_cost: item.unit_cost };
    current.quantity += item.quantity;
    current.items.push(item);
    current.product_id = current.product_id || item.product_id || null;
    current.unit_cost = item.unit_cost || current.unit_cost;
    deltaByVariant.set(item.variant_id, current);
  }
  const movementRows = [];
  for (const [variantId, delta] of deltaByVariant.entries()) {
    const quantity = Number(delta.quantity || 0);
    const movement = await adjustVariantStock(client, {
      tenantId,
      variantId,
      productId: delta.product_id || null,
      quantityChange: quantity,
      movementType: "PURCHASE_IN",
      referenceType: "purchase",
      referenceId: purchaseId,
      unitCost: delta.unit_cost || null,
      totalCost: delta.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0), 0),
      reason: "Purchase receiving",
      notes: `Purchase received variant ${variantId}`,
      createdBy: userId || null,
      warehouseId,
    });
    movementRows.push(movement?.movement || movement);
  }
  console.time("[purchase:create] warehouse_inventory updates");
  await bulkAdjustWarehouseVariantStock(client, {
    tenantId,
    warehouseId,
    adjustments: [...deltaByVariant.entries()].map(([variantId, delta]) => ({ variantId, quantity: Number(delta.quantity || 0) })),
  });
  console.timeEnd("[purchase:create] warehouse_inventory updates");
  return { movementCount: movementRows.length, stockRows: movementRows };
};

const batchUpdateVariantPricingAfterPurchase = async (client, { tenantId, supplierId, items = [], shouldApplyStock = false }) => {
  const variantItems = items
    .map((item) => ({ ...item, variant_id: Number(item.variant_id || 0) }))
    .filter((item) => item.variant_id > 0);
  if (!variantItems.length) return 0;
  const columns = await getTableColumns(client, "product_variants");
  const updateColumns = [];
  if (columns.has("last_purchase_cost")) updateColumns.push("last_purchase_cost");
  if (columns.has("last_purchase_price")) updateColumns.push("last_purchase_price");
  if (columns.has("purchase_price")) updateColumns.push("purchase_price");
  if (columns.has("cost_price")) updateColumns.push("cost_price");
  if (columns.has("selling_price")) updateColumns.push("selling_price");
  if (columns.has("price")) updateColumns.push("price");
  if (columns.has("sale_price")) updateColumns.push("sale_price");
  if (columns.has("discount_price")) updateColumns.push("discount_price");
  if (columns.has("offer_price")) updateColumns.push("offer_price");
  if (columns.has("sale_price_enabled")) updateColumns.push("sale_price_enabled");
  if (columns.has("supplier_id")) updateColumns.push("supplier_id");
  if (columns.has("article_code")) updateColumns.push("article_code");
  if (columns.has("last_purchase_pricing_at")) updateColumns.push("last_purchase_pricing_at");
  if (columns.has("updated_at")) updateColumns.push("updated_at");
  if (!updateColumns.length) return 0;

  const values = [];
  const tuples = variantItems.map((item) => {
    values.push(
      item.variant_id,
      purchaseSyncNumber(item.unit_cost ?? item.cost_price),
      Math.max(0, Number(item.quantity || 0)),
      purchaseSyncNumber(item.selling_price ?? item.regular_price ?? item.price),
      purchaseSyncNumber(item.sale_price),
      String(item.article_code || "").trim(),
      supplierId || null
    );
    const start = values.length - 6;
    return `($${start}::bigint, $${start + 1}::numeric, $${start + 2}::numeric, $${start + 3}::numeric, $${start + 4}::numeric, $${start + 5}::text, $${start + 6}::bigint)`;
  });
  values.push(tenantId);
  const tenantParam = values.length;
  const sets = [];
  if (columns.has("last_purchase_cost")) sets.push("last_purchase_cost = COALESCE(incoming.unit_cost, pv.last_purchase_cost)");
  if (columns.has("last_purchase_price")) sets.push("last_purchase_price = COALESCE(incoming.unit_cost, pv.last_purchase_price)");
  if (columns.has("purchase_price")) sets.push("purchase_price = CASE WHEN COALESCE(incoming.unit_cost, 0) > 0 THEN incoming.unit_cost ELSE pv.purchase_price END");
  if (columns.has("cost_price")) sets.push("cost_price = CASE WHEN COALESCE(incoming.unit_cost, 0) > 0 THEN incoming.unit_cost ELSE pv.cost_price END");
  if (columns.has("selling_price")) sets.push("selling_price = COALESCE(incoming.selling_price, pv.selling_price)");
  if (columns.has("price")) sets.push("price = COALESCE(incoming.selling_price, pv.price)");
  if (columns.has("sale_price")) sets.push("sale_price = COALESCE(incoming.sale_price, pv.sale_price)");
  if (columns.has("discount_price")) sets.push("discount_price = COALESCE(incoming.sale_price, pv.discount_price)");
  if (columns.has("offer_price")) sets.push("offer_price = COALESCE(incoming.sale_price, pv.offer_price)");
  if (columns.has("sale_price_enabled")) sets.push("sale_price_enabled = COALESCE(incoming.sale_price, 0) > 0");
  if (columns.has("supplier_id")) sets.push("supplier_id = COALESCE(pv.supplier_id, incoming.supplier_id)");
  if (columns.has("article_code")) sets.push("article_code = CASE WHEN incoming.article_code <> '' THEN incoming.article_code ELSE pv.article_code END");
  if (columns.has("average_cost")) {
    const previousStockExpr = shouldApplyStock && columns.has("stock") ? "GREATEST(COALESCE(pv.stock, 0) - incoming.quantity, 0)" : "GREATEST(COALESCE(pv.stock, 0), 0)";
    const denominatorExpr = columns.has("stock") ? "GREATEST(COALESCE(pv.stock, 0), incoming.quantity)" : "incoming.quantity";
    sets.push(`
      average_cost = CASE
        WHEN COALESCE(incoming.unit_cost, 0) > 0 AND ${denominatorExpr} > 0
        THEN ROUND(((COALESCE(NULLIF(pv.average_cost, 0), NULLIF(pv.cost_price, 0), 0) * ${previousStockExpr}) + (incoming.unit_cost * incoming.quantity)) / ${denominatorExpr}, 2)
        ELSE pv.average_cost
      END
    `);
  }
  if (columns.has("last_purchase_pricing_at")) sets.push("last_purchase_pricing_at = CURRENT_TIMESTAMP");
  if (columns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
  const result = await client.query(
    `
    WITH incoming(variant_id, unit_cost, quantity, selling_price, sale_price, article_code, supplier_id) AS (VALUES ${tuples.join(", ")})
    UPDATE product_variants pv
    SET ${sets.join(", ")}
    FROM incoming
    WHERE pv.id = incoming.variant_id
      AND ($${tenantParam}::bigint IS NULL OR pv.tenant_id = $${tenantParam} OR pv.tenant_id IS NULL)
    `,
    values
  );
  return result.rowCount || 0;
};

const insertPurchaseHeader = async (client, data = {}) => {
  const columnInfo = await getTableColumnInfo(client, "purchases");
  const columns = new Set(columnInfo.keys());
  const insertColumns = [];
  const values = [];

  addInsertValue(insertColumns, values, columns, "tenant_id", data.tenantId);
  addInsertValue(insertColumns, values, columns, "supplier_id", data.supplierId);
  addInsertValue(insertColumns, values, columns, "warehouse_id", data.warehouseId);
  addInsertValue(insertColumns, values, columns, "purchase_number", data.purchaseNumber || "PO-PENDING");
  addInsertValue(insertColumns, values, columns, "status", data.status);
  addInsertValue(insertColumns, values, columns, "payment_status", data.paymentStatus);
  addInsertValue(insertColumns, values, columns, "supplier_payment_status", data.supplierPaymentStatus ?? data.paymentStatus);
  addInsertValue(insertColumns, values, columns, "client_request_id", data.clientRequestId || null);
  addInsertValue(insertColumns, values, columns, "purchase_save_id", data.purchaseSaveId || data.clientRequestId || null);
  addInsertValue(insertColumns, values, columns, "stock_applied", data.stockApplied === true);
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
  addInsertValue(insertColumns, values, columns, "supplier_paid_amount", data.supplierPaidAmount ?? data.paidAmount ?? 0);
  addInsertValue(insertColumns, values, columns, "remaining_amount", data.remainingAmount ?? Math.max(0, Number(data.total || 0) - Number(data.paidAmount ?? data.supplierPaidAmount ?? 0)));
  addInsertValue(insertColumns, values, columns, "payment_account_id", data.paymentAccountId || null);
  addInsertValue(insertColumns, values, columns, "payment_method", data.paymentMethod || null);
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

const assignGeneratedPurchaseCode = async (client, purchase = {}) => {
  if (!purchase?.id) return purchase;
  const purchaseNumber = formatPurchaseCode(purchase.id);
  const result = await client.query(
    `
    UPDATE purchases
    SET purchase_number = $2,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
    `,
    [purchase.id, purchaseNumber]
  );
  return result.rows[0] || { ...purchase, purchase_number: purchaseNumber };
};

const logPurchasePriceSync = (payload = {}) => {
  console.log("[purchase-price-sync]", {
    invoice_id: payload.invoice_id ?? payload.purchase_id ?? null,
    line_id: payload.line_id ?? payload.purchase_item_id ?? null,
    update_source: payload.update_source || null,
    product_id: payload.product_id ?? null,
    variant_id: payload.variant_id ?? null,
    product_type: payload.product_type || null,
    affected_table: payload.affected_table || payload.sync_target || null,
    old_purchase_cost: payload.old_purchase_cost ?? null,
    new_purchase_cost: payload.new_purchase_cost ?? null,
    old_selling_price: payload.old_selling_price ?? null,
    new_selling_price: payload.new_selling_price ?? null,
    parsed_values: payload.parsed_values || null,
    sync_target: payload.sync_target || null,
    skipped_reason: payload.skipped_reason || null,
  });
};

const logPurchaseSalePriceSync = (payload = {}) => {
  console.log("[purchase-sale-price-sync]", {
    invoice_id: payload.invoice_id ?? payload.purchase_id ?? null,
    product_id: payload.product_id ?? null,
    variant_id: payload.variant_id ?? null,
    purchase_price: payload.purchase_price ?? payload.purchase_cost ?? payload.new_purchase_cost ?? null,
    selling_price: payload.selling_price ?? payload.new_selling_price ?? null,
    sale_price: payload.sale_price ?? null,
    sync_target: payload.sync_target || null,
    affected_rows: payload.affected_rows ?? 0,
  });
};

const loadProductPriceSyncSnapshot = async (client, { tenantId, productId, columns }) => {
  const numericProductId = Number(productId || 0);
  if (!Number.isFinite(numericProductId) || numericProductId <= 0) return null;
  const values = [numericProductId];
  const where = ["id = $1"];
  if (columns.has("tenant_id")) {
    values.push(tenantId);
    where.push(`($${values.length}::bigint IS NULL OR tenant_id = $${values.length}::bigint OR tenant_id IS NULL)`);
  }
  const result = await client.query(
    `
    SELECT
      id,
      ${coalesceColumns("p", columns, ["product_type", "type", "product_kind"], "'product'")} AS product_type,
      ${coalesceNumericColumns("p", columns, ["last_purchase_cost", "cost_price", "purchase_price"], "0")} AS old_purchase_cost,
      ${coalesceNumericColumns("p", columns, ["selling_price", "regular_price", "price"], "0")} AS old_selling_price
    FROM products p
    WHERE ${where.join(" AND ")}
    LIMIT 1
    `,
    values
  );
  return result.rows[0] || null;
};

const updateProductVariantAfterPurchase = async (client, { tenantId, productId = null, variantId, supplierId, unitCost, quantity = 0, sellingPrice = null, salePrice = null, articleCode = "", invoiceId = null, lineId = null, updateSource = "create_purchase" }) => {
  const columns = await getTableColumns(client, "product_variants");
  const productColumns = await getTableColumns(client, "products");
  const numericVariantId = Number(variantId || 0);
  if (!Number.isFinite(numericVariantId) || numericVariantId <= 0) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: productId,
      variant_id: variantId || null,
      affected_table: "product_variants",
      sync_target: "variant",
      skipped_reason: "missing_variant_id",
    });
    return;
  }
  const snapshotValues = [numericVariantId];
  const snapshotWhere = ["pv.id = $1"];
  if (columns.has("tenant_id")) {
    snapshotValues.push(tenantId);
    snapshotWhere.push(`($${snapshotValues.length}::bigint IS NULL OR pv.tenant_id = $${snapshotValues.length} OR pv.tenant_id IS NULL)`);
  }
  const snapshotResult = await client.query(
    `
    SELECT
      pv.product_id,
      ${coalesceColumns("p", productColumns, ["product_type", "type", "product_kind"], "'variant'")} AS product_type,
      ${coalesceNumericColumns("pv", columns, ["last_purchase_cost", "cost_price", "purchase_price"], "0")} AS old_purchase_cost,
      ${coalesceNumericColumns("pv", columns, ["selling_price", "regular_price", "price"], "0")} AS old_selling_price
    FROM product_variants pv
    LEFT JOIN products p ON p.id = pv.product_id
    WHERE ${snapshotWhere.join(" AND ")}
    LIMIT 1
    `,
    snapshotValues
  );
  const snapshot = snapshotResult.rows[0];
  if (!snapshot) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: productId,
      variant_id: numericVariantId,
      affected_table: "product_variants",
      sync_target: "variant",
      skipped_reason: "variant_not_found",
    });
    return;
  }
  const sets = [];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  const purchaseCost = purchaseSyncNumber(unitCost);
  const regularPrice = purchaseSyncNumber(sellingPrice);
  const discountPrice = purchaseSyncNumber(salePrice);
  const hasPricingUpdate = purchaseCost !== null || regularPrice !== null || discountPrice !== null;
  if (purchaseCost !== null) {
    if (columns.has("last_purchase_cost")) sets.push(`last_purchase_cost = ${push(purchaseCost)}`);
    if (columns.has("last_purchase_price")) sets.push(`last_purchase_price = ${push(purchaseCost)}`);
    if (columns.has("purchase_price")) sets.push(`purchase_price = CASE WHEN ${push(purchaseCost)} > 0 THEN ${push(purchaseCost)} ELSE purchase_price END`);
    if (columns.has("cost_price")) sets.push(`cost_price = CASE WHEN ${push(purchaseCost)} > 0 THEN ${push(purchaseCost)} ELSE cost_price END`);
  }
  if (regularPrice !== null) {
    if (columns.has("selling_price")) sets.push(`selling_price = ${push(regularPrice)}`);
    if (columns.has("price")) sets.push(`price = ${push(regularPrice)}`);
  }
  if (discountPrice !== null) {
    if (columns.has("sale_price")) sets.push(`sale_price = ${push(discountPrice)}`);
    if (columns.has("discount_price")) sets.push(`discount_price = ${push(discountPrice)}`);
    if (columns.has("offer_price")) sets.push(`offer_price = ${push(discountPrice)}`);
    if (columns.has("sale_price_enabled")) sets.push(`sale_price_enabled = ${push(discountPrice > 0)}`);
  }
  if (columns.has("average_cost") && purchaseCost !== null) {
    const costParam = push(purchaseCost);
    const quantityParam = push(Math.max(0, Number(quantity || 0)));
    const previousStockExpr = columns.has("stock") ? `GREATEST(COALESCE(stock, 0) - ${quantityParam}, 0)` : "0";
    const denominatorExpr = columns.has("stock") ? "GREATEST(COALESCE(stock, 0), 0)" : quantityParam;
    sets.push(`
      average_cost = CASE
        WHEN ${costParam} > 0 AND ${denominatorExpr} > 0
        THEN ROUND(((COALESCE(NULLIF(average_cost, 0), NULLIF(cost_price, 0), 0) * ${previousStockExpr}) + (${costParam} * ${quantityParam})) / ${denominatorExpr}, 2)
        ELSE average_cost
      END
    `);
  }
  const hasArticleUpdate = columns.has("article_code") && String(articleCode || "").trim();
  if (hasArticleUpdate) sets.push(`article_code = ${push(String(articleCode || "").trim())}`);
  if ((hasPricingUpdate || hasArticleUpdate) && columns.has("last_purchase_pricing_at")) sets.push("last_purchase_pricing_at = CURRENT_TIMESTAMP");
  if ((hasPricingUpdate || hasArticleUpdate) && columns.has("supplier_id")) sets.push(`supplier_id = COALESCE(supplier_id, ${push(supplierId)})`);
  if ((hasPricingUpdate || hasArticleUpdate) && columns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
  if (!sets.length) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: snapshot.product_id || productId,
      variant_id: numericVariantId,
      product_type: snapshot.product_type,
      old_purchase_cost: Number(snapshot.old_purchase_cost || 0),
      new_purchase_cost: purchaseCost,
      old_selling_price: Number(snapshot.old_selling_price || 0),
      new_selling_price: regularPrice,
      parsed_values: { purchase_cost: purchaseCost, selling_price: regularPrice, sale_price: discountPrice },
      affected_table: "product_variants",
      sync_target: "variant",
      skipped_reason: "no_variant_price_columns",
    });
    return;
  }

  const where = [`id = ${push(numericVariantId)}`];
  if (columns.has("tenant_id")) {
    const tenantParam = push(tenantId);
    where.push(`(${tenantParam}::bigint IS NULL OR tenant_id = ${tenantParam}::bigint OR tenant_id IS NULL)`);
  }
  const result = await client.query(
    `
    UPDATE product_variants
    SET ${sets.join(", ")}
    WHERE ${where.join(" AND ")}
    `,
    values
  );
  logPurchaseSalePriceSync({
    invoice_id: invoiceId,
    product_id: snapshot.product_id || productId,
    variant_id: numericVariantId,
    purchase_price: purchaseCost,
    selling_price: regularPrice,
    sale_price: discountPrice,
    sync_target: "variant",
    affected_rows: result.rowCount || 0,
  });
  await verifyPurchasePriceSyncWrite(client, {
    productId: snapshot.product_id || productId,
    variantId: numericVariantId,
    syncTarget: "variant",
    updateSource,
    invoiceId,
    lineId,
  });
  logPurchasePriceSync({
    invoice_id: invoiceId,
    line_id: lineId,
    update_source: updateSource,
    product_id: snapshot.product_id || productId,
    variant_id: numericVariantId,
    product_type: snapshot.product_type,
    old_purchase_cost: Number(snapshot.old_purchase_cost || 0),
    new_purchase_cost: purchaseCost,
    old_selling_price: Number(snapshot.old_selling_price || 0),
    new_selling_price: regularPrice,
    parsed_values: { purchase_cost: purchaseCost, selling_price: regularPrice, sale_price: discountPrice },
    affected_table: "product_variants",
    sync_target: "variant",
    skipped_reason: result.rowCount ? null : "variant_update_matched_zero_rows",
  });
};

const updateSimpleProductPricingAfterPurchase = async (client, { tenantId, productId, unitCost, sellingPrice, salePrice, articleCode = "", invoiceId = null, lineId = null, updateSource = "create_purchase" }) => {
  const columns = await getTableColumns(client, "products");
  const numericProductId = Number(productId || 0);
  const safePurchaseCost = purchaseSyncNumber(unitCost);
  const safeRegularPrice = purchaseSyncNumber(sellingPrice);
  const safeDiscountPrice = purchaseSyncNumber(salePrice);
  const hasPricingUpdate = safePurchaseCost !== null || safeRegularPrice !== null || safeDiscountPrice !== null;

  if (!Number.isFinite(numericProductId) || numericProductId <= 0) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: productId || null,
      variant_id: null,
      affected_table: "products",
      new_purchase_cost: safePurchaseCost,
      new_selling_price: safeRegularPrice,
      sync_target: "product",
      skipped_reason: "missing_product_id",
    });
    return;
  }
  const snapshot = await loadProductPriceSyncSnapshot(client, { tenantId, productId: numericProductId, columns });
  if (!snapshot) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: numericProductId,
      variant_id: null,
      affected_table: "products",
      new_purchase_cost: safePurchaseCost,
      new_selling_price: safeRegularPrice,
      sync_target: "product",
      skipped_reason: "product_not_found",
    });
    return;
  }

  const sets = [];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (safePurchaseCost !== null) {
    if (columns.has("last_purchase_cost")) sets.push(`last_purchase_cost = ${push(safePurchaseCost)}`);
    if (columns.has("last_purchase_price")) sets.push(`last_purchase_price = ${push(safePurchaseCost)}`);
    if (columns.has("purchase_price")) sets.push(`purchase_price = CASE WHEN ${push(safePurchaseCost)} > 0 THEN ${push(safePurchaseCost)} ELSE purchase_price END`);
    if (columns.has("cost_price")) sets.push(`cost_price = CASE WHEN ${push(safePurchaseCost)} > 0 THEN ${push(safePurchaseCost)} ELSE cost_price END`);
  }
  if (safeRegularPrice !== null) {
    if (columns.has("selling_price")) sets.push(`selling_price = ${push(safeRegularPrice)}`);
    if (columns.has("price")) sets.push(`price = ${push(safeRegularPrice)}`);
  }
  if (safeDiscountPrice !== null) {
    if (columns.has("sale_price")) sets.push(`sale_price = ${push(safeDiscountPrice)}`);
    if (columns.has("discount_price")) sets.push(`discount_price = ${push(safeDiscountPrice)}`);
    if (columns.has("offer_price")) sets.push(`offer_price = ${push(safeDiscountPrice)}`);
    if (columns.has("sale_price_enabled")) sets.push(`sale_price_enabled = ${push(safeDiscountPrice > 0)}`);
  }
  const hasArticleUpdate = columns.has("article_code") && String(articleCode || "").trim();
  if (hasArticleUpdate) sets.push(`article_code = ${push(String(articleCode || "").trim())}`);
  if ((hasPricingUpdate || hasArticleUpdate) && columns.has("last_purchase_pricing_at")) sets.push("last_purchase_pricing_at = CURRENT_TIMESTAMP");
  if ((hasPricingUpdate || hasArticleUpdate) && columns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
  if (!sets.length) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: numericProductId,
      variant_id: null,
      product_type: snapshot.product_type,
      old_purchase_cost: Number(snapshot.old_purchase_cost || 0),
      new_purchase_cost: safePurchaseCost,
      old_selling_price: Number(snapshot.old_selling_price || 0),
      new_selling_price: safeRegularPrice,
      parsed_values: { purchase_cost: safePurchaseCost, selling_price: safeRegularPrice, sale_price: safeDiscountPrice },
      affected_table: "products",
      sync_target: "product",
      skipped_reason: "no_product_price_columns",
    });
    return;
  }

  const where = [`id = ${push(numericProductId)}`];
  if (columns.has("tenant_id")) {
    const tenantParam = push(tenantId);
    where.push(`(${tenantParam}::bigint IS NULL OR tenant_id = ${tenantParam}::bigint OR tenant_id IS NULL)`);
  }
  console.log("[purchase:create] simple product pricing update columns:", sets);
  const result = await client.query(
    `
    UPDATE products
    SET ${sets.join(", ")}
    WHERE ${where.join(" AND ")}
    `,
    values
  );
  logPurchaseSalePriceSync({
    invoice_id: invoiceId,
    product_id: numericProductId,
    variant_id: null,
    purchase_price: safePurchaseCost,
    selling_price: safeRegularPrice,
    sale_price: safeDiscountPrice,
    sync_target: "product",
    affected_rows: result.rowCount || 0,
  });
  await verifyPurchasePriceSyncWrite(client, {
    productId: numericProductId,
    syncTarget: "product",
    updateSource,
    invoiceId,
    lineId,
  });
  logPurchasePriceSync({
    invoice_id: invoiceId,
    line_id: lineId,
    update_source: updateSource,
    product_id: numericProductId,
    variant_id: null,
    product_type: snapshot.product_type,
    old_purchase_cost: Number(snapshot.old_purchase_cost || 0),
    new_purchase_cost: safePurchaseCost,
    old_selling_price: Number(snapshot.old_selling_price || 0),
    new_selling_price: safeRegularPrice,
    parsed_values: { purchase_cost: safePurchaseCost, selling_price: safeRegularPrice, sale_price: safeDiscountPrice },
    affected_table: "products",
    sync_target: "product",
    skipped_reason: result.rowCount ? null : "product_update_matched_zero_rows",
  });
};

const updateProductFallbackStock = async (client, { tenantId, productId, quantity, unitCost, sellingPrice, salePrice, articleCode = "", invoiceId = null, lineId = null, updateSource = "received_adjustment" }) => {
  const columns = await getTableColumns(client, "products");
  const stockColumn = firstColumn(columns, ["stock", "quantity", "qty"]);
  const numericProductId = Number(productId || 0);
  const safePurchaseCost = purchaseSyncNumber(unitCost);
  const safeRegularPrice = purchaseSyncNumber(sellingPrice);
  const safeDiscountPrice = purchaseSyncNumber(salePrice);

  if (!Number.isFinite(numericProductId) || numericProductId <= 0) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: productId || null,
      variant_id: null,
      affected_table: "products",
      new_purchase_cost: safePurchaseCost,
      new_selling_price: safeRegularPrice,
      sync_target: "product",
      skipped_reason: "missing_product_id",
    });
    return;
  }
  const snapshot = await loadProductPriceSyncSnapshot(client, { tenantId, productId: numericProductId, columns });
  if (!snapshot) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: numericProductId,
      variant_id: null,
      affected_table: "products",
      new_purchase_cost: safePurchaseCost,
      new_selling_price: safeRegularPrice,
      sync_target: "product",
      skipped_reason: "product_not_found",
    });
    return;
  }

  const sets = [];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (stockColumn) sets.push(`${stockColumn} = COALESCE(${stockColumn}, 0) + ${push(Number(quantity || 0))}`);
  if (safePurchaseCost !== null) {
    if (columns.has("last_purchase_cost")) sets.push(`last_purchase_cost = ${push(safePurchaseCost)}`);
    if (columns.has("last_purchase_price")) sets.push(`last_purchase_price = ${push(safePurchaseCost)}`);
    if (columns.has("purchase_price")) sets.push(`purchase_price = CASE WHEN ${push(safePurchaseCost)} > 0 THEN ${push(safePurchaseCost)} ELSE purchase_price END`);
    if (columns.has("cost_price")) sets.push(`cost_price = CASE WHEN ${push(safePurchaseCost)} > 0 THEN ${push(safePurchaseCost)} ELSE cost_price END`);
  }
  if (safeRegularPrice !== null) {
    if (columns.has("selling_price")) sets.push(`selling_price = ${push(safeRegularPrice)}`);
    if (columns.has("price")) sets.push(`price = ${push(safeRegularPrice)}`);
  }
  if (safeDiscountPrice !== null) {
    if (columns.has("sale_price")) sets.push(`sale_price = ${push(safeDiscountPrice)}`);
    if (columns.has("discount_price")) sets.push(`discount_price = ${push(safeDiscountPrice)}`);
    if (columns.has("offer_price")) sets.push(`offer_price = ${push(safeDiscountPrice)}`);
    if (columns.has("sale_price_enabled")) sets.push(`sale_price_enabled = ${push(safeDiscountPrice > 0)}`);
  }
  if (columns.has("average_cost") && safePurchaseCost !== null) {
    const costParam = push(safePurchaseCost);
    const quantityParam = push(Math.max(0, Number(quantity || 0)));
    const currentStockExpr = stockColumn ? "GREATEST(COALESCE(" + stockColumn + ", 0), 0)" : "0";
    const denominatorExpr = stockColumn ? `GREATEST(COALESCE(${stockColumn}, 0) + ${quantityParam}, 0)` : quantityParam;
    sets.push(`
      average_cost = CASE
        WHEN ${costParam} > 0 AND ${denominatorExpr} > 0
        THEN ROUND(((COALESCE(NULLIF(average_cost, 0), NULLIF(cost_price, 0), 0) * ${currentStockExpr}) + (${costParam} * ${quantityParam})) / ${denominatorExpr}, 2)
        ELSE average_cost
      END
    `);
  }
  if (columns.has("article_code") && String(articleCode || "").trim()) sets.push(`article_code = ${push(String(articleCode || "").trim())}`);
  if (columns.has("last_purchase_pricing_at")) sets.push("last_purchase_pricing_at = CURRENT_TIMESTAMP");
  if (columns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
  if (!sets.length) {
    logPurchasePriceSync({
      invoice_id: invoiceId,
      line_id: lineId,
      update_source: updateSource,
      product_id: numericProductId,
      variant_id: null,
      product_type: snapshot.product_type,
      old_purchase_cost: Number(snapshot.old_purchase_cost || 0),
      new_purchase_cost: safePurchaseCost,
      old_selling_price: Number(snapshot.old_selling_price || 0),
      new_selling_price: safeRegularPrice,
      parsed_values: { purchase_cost: safePurchaseCost, selling_price: safeRegularPrice, sale_price: safeDiscountPrice },
      affected_table: "products",
      sync_target: "product",
      skipped_reason: "no_product_price_columns",
    });
    return;
  }

  const where = [`id = ${push(numericProductId)}`];
  if (columns.has("tenant_id")) {
    const tenantParam = push(tenantId);
    where.push(`(${tenantParam}::bigint IS NULL OR tenant_id = ${tenantParam}::bigint OR tenant_id IS NULL)`);
  }
  const stockBeforeResult = stockColumn
    ? await client.query(
        `
        SELECT ${stockColumn} AS stock
        FROM products p
        WHERE ${where.join(" AND ")}
        FOR UPDATE
        `,
        values
      )
    : null;
  const stockBefore = Number(stockBeforeResult?.rows[0]?.stock || 0);
  console.log("[purchase:create] product fallback update columns:", sets);
  const result = await client.query(
    `
    UPDATE products
    SET ${sets.join(", ")}
    WHERE ${where.join(" AND ")}
    `,
    values
  );
  if (stockColumn && Number(quantity || 0) !== 0) {
    await recordInventoryMovement(client, {
      tenantId,
      productId: numericProductId,
      quantityBefore: stockBefore,
      quantityChange: Number(quantity || 0),
      quantityAfter: stockBefore + Number(quantity || 0),
      movementType: "PURCHASE_IN",
      referenceType: "purchase",
      referenceId: invoiceId,
      reason: "Purchase receiving",
      notes: `Purchase received product ${numericProductId}`,
      createdBy: null,
    });
  }
  logPurchaseSalePriceSync({
    invoice_id: invoiceId,
    product_id: numericProductId,
    variant_id: null,
    purchase_price: safePurchaseCost,
    selling_price: safeRegularPrice,
    sale_price: safeDiscountPrice,
    sync_target: "product",
    affected_rows: result.rowCount || 0,
  });
  await verifyPurchasePriceSyncWrite(client, {
    productId: numericProductId,
    syncTarget: "product",
    updateSource,
    invoiceId,
    lineId,
  });
  logPurchasePriceSync({
    invoice_id: invoiceId,
    line_id: lineId,
    update_source: updateSource,
    product_id: numericProductId,
    variant_id: null,
    product_type: snapshot.product_type,
    old_purchase_cost: Number(snapshot.old_purchase_cost || 0),
    new_purchase_cost: safePurchaseCost,
    old_selling_price: Number(snapshot.old_selling_price || 0),
    new_selling_price: safeRegularPrice,
    parsed_values: { purchase_cost: safePurchaseCost, selling_price: safeRegularPrice, sale_price: safeDiscountPrice },
    affected_table: "products",
    sync_target: "product",
    skipped_reason: result.rowCount ? null : "product_update_matched_zero_rows",
  });
};

const tenantClause = (alias, columns, tenantId, values) => {
  if (!columns.has("tenant_id") || tenantId === null || tenantId === undefined) return "";
  values.push(tenantId);
  const param = `$${values.length}`;
  return `AND (${alias}.tenant_id = ${param} OR ${alias}.tenant_id IS NULL)`;
};

const normalizePurchaseRow = (purchase = {}, items = [], safety = {}) => {
  const total = Number(purchase.total ?? purchase.total_amount ?? purchase.net_total ?? purchase.grand_total ?? 0) || 0;
  const paidAmount = Number(purchase.paid_amount ?? purchase.supplier_paid_amount ?? 0) || 0;
  const hasSafety =
    Object.prototype.hasOwnProperty.call(safety || {}, "canDelete") ||
    Object.prototype.hasOwnProperty.call(safety || {}, "canDeleteWithStockReversal");
  return {
    ...purchase,
    id: purchase.id,
    invoice_number: purchase.purchase_number || purchase.invoice_number || formatPurchaseCode(purchase.id),
    purchase_number: purchase.purchase_number || purchase.invoice_number || formatPurchaseCode(purchase.id),
    supplier_name: purchase.supplier_name || "Unknown supplier",
    warehouse_name: purchase.warehouse_name || "Main Warehouse",
    subtotal: Number(purchase.subtotal ?? total) || 0,
    tax: Number(purchase.tax ?? purchase.tax_amount ?? 0) || 0,
    tax_amount: Number(purchase.tax_amount ?? purchase.tax ?? 0) || 0,
    discount: Number(purchase.discount ?? purchase.discount_amount ?? 0) || 0,
    discount_amount: Number(purchase.discount_amount ?? purchase.discount ?? 0) || 0,
    total,
    paid_amount: paidAmount,
    supplier_paid_amount: Number(purchase.supplier_paid_amount ?? paidAmount) || 0,
    remaining_amount: Math.max(0, total - paidAmount),
    legacy_purchase_number: purchase.legacy_purchase_number || "",
    items,
    safety,
    can_delete: hasSafety ? safety.canDelete === true : purchase.can_delete,
    can_delete_with_stock_reversal: hasSafety ? safety.canDeleteWithStockReversal === true : purchase.can_delete_with_stock_reversal,
    stock_reversal_block_message: safety.stockReversalBlockMessage || purchase.stock_reversal_block_message || null,
    can_edit_destructively: hasSafety ? safety.canEditDestructively === true : purchase.can_edit_destructively,
  };
};

const getPurchaseSafety = async (client, { tenantId, purchase }) => {
  const purchaseId = purchase?.id;
  const stockApplied = purchase?.stock_applied === true || Boolean(purchase?.stock_applied_at);
  let stockMovementCount = stockApplied ? 1 : 0;
  let accountingEntryCount = 0;
  let financialEntryCount = 0;
  let returnCount = 0;

  if (await tableExists(client, "inventory_movements")) {
    const columns = await getTableColumns(client, "inventory_movements");
    const values = [purchaseId];
    const tenant = tenantClause("inventory_movements", columns, tenantId, values);
    const referenceTypeExpr = columns.has("reference_type") ? "COALESCE(reference_type, '')" : "''";
    const referenceIdExpr = columns.has("reference_id") ? "reference_id" : "NULL";
    const result = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM inventory_movements
      WHERE ${referenceIdExpr} = $1
        AND ${referenceTypeExpr} = 'purchase'
        ${tenant}
      `,
      values
    );
    stockMovementCount = Math.max(stockMovementCount, Number(result.rows[0]?.count || 0));
  }

  if (await tableExists(client, "journal_entries")) {
    const columns = await getTableColumns(client, "journal_entries");
    const values = [purchaseId];
    const tenant = tenantClause("journal_entries", columns, tenantId, values);
    const result = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM journal_entries
      WHERE reference_id = $1
        AND COALESCE(reference_type, '') = 'purchase'
        ${tenant}
      `,
      values
    );
    accountingEntryCount = Number(result.rows[0]?.count || 0);
  }

  if (await tableExists(client, "financial_account_entries")) {
    const columns = await getTableColumns(client, "financial_account_entries");
    const values = [purchaseId];
    const tenant = tenantClause("financial_account_entries", columns, tenantId, values);
    const sourceTypeExpr = columns.has("source_type") ? "COALESCE(source_type, '')" : "''";
    const sourceIdExpr = columns.has("source_id") ? "source_id" : "NULL";
    const result = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM financial_account_entries
      WHERE ${sourceIdExpr} = $1
        AND ${sourceTypeExpr} = 'purchase'
        ${tenant}
      `,
      values
    );
    financialEntryCount = Number(result.rows[0]?.count || 0);
  }

  if (await tableExists(client, "returns")) {
    const columns = await getTableColumns(client, "returns");
    const referenceColumn = firstColumn(columns, ["purchase_id", "source_id", "reference_id"]);
    if (referenceColumn) {
      const values = [purchaseId];
      const tenant = tenantClause("returns", columns, tenantId, values);
      const sourceTypeCondition = columns.has("source_type")
        ? "AND COALESCE(source_type, '') IN ('purchase', 'purchase_return')"
        : columns.has("reference_type")
          ? "AND COALESCE(reference_type, '') IN ('purchase', 'purchase_return')"
          : "";
      const result = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM returns
        WHERE ${referenceColumn} = $1
          ${sourceTypeCondition}
          ${tenant}
        `,
        values
      );
      returnCount = Number(result.rows[0]?.count || 0);
    }
  }

  const paidAmount = Number(purchase?.paid_amount ?? purchase?.supplier_paid_amount ?? 0) || 0;
  const supplierBalanceEffect = paidAmount > 0 || ["paid", "partial", "partially_paid"].includes(String(purchase?.payment_status || purchase?.supplier_payment_status || "").toLowerCase());
  const hasStockMovements = stockMovementCount > 0;
  const hasAccountingPostings = accountingEntryCount > 0;
  const hasPayments = financialEntryCount > 0 || paidAmount > 0;
  const hasReturns = returnCount > 0;

  return {
    stockMovementCount,
    accountingEntryCount,
    financialEntryCount,
    returnCount,
    supplierBalanceEffect,
    hasStockMovements,
    hasAccountingPostings,
    hasPayments,
    hasReturns,
    canDelete: !hasStockMovements && !hasAccountingPostings && !hasPayments && !hasReturns && !supplierBalanceEffect,
    canEditDestructively: !hasStockMovements,
  };
};

const emptyPurchaseSafety = () => ({
  stockMovementCount: 0,
  accountingEntryCount: 0,
  financialEntryCount: 0,
  returnCount: 0,
  supplierBalanceEffect: false,
  hasStockMovements: false,
  hasAccountingPostings: false,
  hasPayments: false,
  hasReturns: false,
  canDelete: false,
  canEditDestructively: false,
});

const purchaseSafetyBlockReasons = (safety = {}) => {
  const reasons = [];
  if (safety.hasStockMovements || Number(safety.stockMovementCount || 0) > 0) {
    reasons.push("received stock exists");
    reasons.push("inventory movements exist");
  }
  if (safety.hasAccountingPostings || Number(safety.accountingEntryCount || 0) > 0) reasons.push("accounting entries exist");
  if (safety.hasPayments || Number(safety.financialEntryCount || 0) > 0 || safety.supplierBalanceEffect) reasons.push("supplier payments/balance links exist");
  if (safety.hasReturns || Number(safety.returnCount || 0) > 0) reasons.push("purchase returns exist");
  return [...new Set(reasons)];
};

const purchaseBlockedMessage = (action, safety = {}) => {
  const reasons = purchaseSafetyBlockReasons(safety);
  if (!reasons.length) return `Cannot ${action} this purchase because it has linked history.`;
  return `Cannot ${action} this purchase because ${reasons.join(", ")}. Use Cancel / Reverse Purchase instead.`;
};

const getBranchIdFromRequest = (req = {}) => {
  const raw = req.user?.branch_id ?? req.user?.branchId ?? req.headers?.["x-branch-id"] ?? req.query?.branch_id ?? null;
  const branchId = Number(raw);
  return Number.isFinite(branchId) && branchId > 0 ? branchId : null;
};

const getPurchaseAccessState = async (client, { tenantId, branchId, purchaseId }) => {
  const purchaseColumns = await getTableColumns(client, "purchases");
  const branchColumn = firstColumn(purchaseColumns, ["branch_id", "location_branch_id"]);
  const branchSelect = branchColumn ? `${branchColumn} AS branch_id` : "NULL::bigint AS branch_id";
  const result = await client.query(
    `
    SELECT id, tenant_id, ${branchSelect}
    FROM purchases
    WHERE id = $1
    LIMIT 1
    `,
    [purchaseId]
  );
  const purchase = result.rows[0];
  if (!purchase) return "not_found";
  if (tenantId !== null && tenantId !== undefined && purchase.tenant_id !== null && Number(purchase.tenant_id) !== Number(tenantId)) {
    return "denied";
  }
  if (branchId && purchase.branch_id && Number(purchase.branch_id) !== Number(branchId)) {
    return "denied";
  }
  return "allowed";
};

const loadPurchaseById = async (client, { tenantId, purchaseId, branchId = null, lock = false, ensureSchema = false, includeSafety = true }) => {
  if (ensureSchema || lock) await ensurePurchaseCreateSchema(client);
  const purchaseColumns = await getTableColumns(client, "purchases");
  const itemColumns = await getTableColumns(client, "purchase_items");
  const productColumns = await getTableColumns(client, "products");
  const variantColumns = await getTableColumns(client, "product_variants");
  const hasVariantImageTable = await tableExists(client, "product_variant_images");
  const variantImageColumns = hasVariantImageTable ? await getTableColumns(client, "product_variant_images") : new Set();

  const values = [purchaseId];
  const purchaseTenant = tenantClause("p", purchaseColumns, tenantId, values);
  const branchColumn = firstColumn(purchaseColumns, ["branch_id", "location_branch_id"]);
  let branchFilter = "";
  if (branchId && branchColumn) {
    values.push(branchId);
    branchFilter = `AND (p.${branchColumn} = $${values.length} OR p.${branchColumn} IS NULL)`;
  }
  const supplierNameExpr = "COALESCE(s.name, '') AS supplier_name";
  const warehouseNameExpr = "COALESCE(w.name, w.code, '') AS warehouse_name";
  const purchaseResult = await client.query(
    `
    SELECT p.*, ${supplierNameExpr}, ${warehouseNameExpr}
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    WHERE p.id = $1
      ${purchaseTenant}
      ${branchFilter}
    ${lock ? "FOR UPDATE OF p" : ""}
    `,
    values
  );
  const purchase = purchaseResult.rows[0];
  if (!purchase) return null;

  const itemTenantValues = [purchase.id];
  const itemTenant = tenantClause("pi", itemColumns, tenantId, itemTenantValues);
  const itemTenantParam = itemTenantValues.length > 1 ? `$${itemTenantValues.length}` : null;
  const productTenantJoin = productColumns.has("tenant_id") && itemTenantParam ? `AND (${itemTenantParam}::bigint IS NULL OR p.tenant_id = ${itemTenantParam} OR p.tenant_id IS NULL)` : "";
  const variantTenantJoin = variantColumns.has("tenant_id") && itemTenantParam ? `AND (${itemTenantParam}::bigint IS NULL OR pv_match.tenant_id = ${itemTenantParam} OR pv_match.tenant_id IS NULL)` : "";
  const variantImageTenantJoin = variantImageColumns.has("tenant_id") && itemTenantParam ? `AND (${itemTenantParam}::bigint IS NULL OR tenant_id = ${itemTenantParam} OR tenant_id IS NULL)` : "";
  const productImageExpr = firstTextColumn("p", productColumns, ["image_url", "product_image_url", "image", "thumbnail_url", "photo_url"], "NULL");
  const matchedVariantImageExpr = firstTextColumn("pv_match", variantColumns, ["variant_image_url", "color_image_url", "image_url", "image", "thumbnail_url", "photo_url"], "NULL");
  const lineVariantImageExpr = firstTextColumn("pi", itemColumns, ["variant_image_url", "color_image_url", "product_variant_image"], "NULL");
  const lineProductImageExpr = firstTextColumn("pi", itemColumns, ["product_image_url", "image_url"], "NULL");
  const itemSkuRawExpr = itemColumns.has("sku") ? "NULLIF(TRIM(pi.sku::text), '')" : "NULL";
  const itemColorRawExpr = itemColumns.has("color") ? "NULLIF(TRIM(pi.color::text), '')" : "NULL";
  const itemSizeRawExpr = itemColumns.has("size") ? "NULLIF(TRIM(pi.size::text), '')" : "NULL";
  const matchedSkuExpr = nullIfBlankColumn("pv_match", variantColumns, "sku");
  const matchedColorExpr = firstTextColumn("pv_match", variantColumns, ["color", "color_name", "color_value"], "NULL");
  const matchedSizeExpr = firstTextColumn("pv_match", variantColumns, ["size", "size_name", "size_value"], "NULL");
  const itemSkuExpr = `COALESCE(${itemSkuRawExpr}, ${matchedSkuExpr}, '')`;
  const itemColorExpr = `COALESCE(${itemColorRawExpr}, ${matchedColorExpr}, '')`;
  const itemSizeExpr = `COALESCE(${itemSizeRawExpr}, ${matchedSizeExpr}, '')`;
  const normalizedItemSkuExpr = normalizedTextSql(itemSkuRawExpr);
  const normalizedItemColorExpr = normalizedTextSql(itemColorRawExpr);
  const normalizedItemSizeExpr = normalizedTextSql(itemSizeRawExpr);
  const normalizedVariantSkuExpr = normalizedTextSql(nullIfBlankColumn("pv_match", variantColumns, "sku"));
  const normalizedVariantColorExpr = normalizedTextSql(matchedColorExpr);
  const normalizedVariantSizeExpr = normalizedTextSql(matchedSizeExpr);
  const itemUnitCostExpr = itemColumns.has("unit_cost") ? "pi.unit_cost" : itemColumns.has("cost_price") ? "pi.cost_price" : "0";
  const itemTotalExpr = itemColumns.has("total") ? "pi.total" : itemColumns.has("total_amount") ? "pi.total_amount" : `COALESCE(pi.quantity, 0) * COALESCE(${itemUnitCostExpr}, 0)`;
  const itemSalePriceExpr = itemColumns.has("sale_price") ? "NULLIF(pi.sale_price, 0)" : "NULL";
  const variantSalePriceExpr = coalesceNumericColumns("pv_match", variantColumns, ["price", "regular_price"], coalesceNumericColumns("pi", itemColumns, ["selling_price", "regular_price"], "0"));
  const variantDiscountPriceExpr = coalesceNumericColumns("pv_match", variantColumns, ["discount_price", "offer_price", "sale_price"], itemSalePriceExpr);
  const metadataProductNameExpr = itemColumns.has("metadata") ? "pi.metadata->>'product_name'" : "NULL";
  const purchaseStockAppliedExpr = purchaseColumns.has("stock_applied") ? "COALESCE(pu.stock_applied, FALSE)" : "FALSE";
  const receivedExpr = itemColumns.has("received_quantity")
    ? "pi.received_quantity"
    : itemColumns.has("received_qty")
      ? "pi.received_qty"
      : `CASE WHEN ${purchaseStockAppliedExpr} THEN COALESCE(pi.quantity, 0) ELSE 0 END`;
  const variantMatchJoin = `
    LEFT JOIN LATERAL (
      SELECT pv_match.*
      FROM product_variants pv_match
      WHERE pv_match.product_id = pi.product_id
        ${variantTenantJoin}
        AND (
          (pi.variant_id IS NOT NULL AND pv_match.id = pi.variant_id)
          OR (${normalizedItemSkuExpr} <> '' AND ${normalizedVariantSkuExpr} = ${normalizedItemSkuExpr})
          OR (
            ${normalizedItemColorExpr} <> ''
            AND ${normalizedItemSizeExpr} <> ''
            AND ${normalizedVariantColorExpr} = ${normalizedItemColorExpr}
            AND ${normalizedVariantSizeExpr} = ${normalizedItemSizeExpr}
          )
        )
      ORDER BY
        CASE
          WHEN pi.variant_id IS NOT NULL AND pv_match.id = pi.variant_id THEN 1
          WHEN ${normalizedItemSkuExpr} <> '' AND ${normalizedVariantSkuExpr} = ${normalizedItemSkuExpr} THEN 2
          WHEN ${normalizedItemColorExpr} <> '' AND ${normalizedItemSizeExpr} <> '' AND ${normalizedVariantColorExpr} = ${normalizedItemColorExpr} AND ${normalizedVariantSizeExpr} = ${normalizedItemSizeExpr} THEN 3
          ELSE 9
        END,
        pv_match.id ASC
      LIMIT 1
    ) pv_match ON TRUE`;
  const variantImageJoin = hasVariantImageTable
    ? `
    LEFT JOIN LATERAL (
      SELECT image_url
      FROM product_variant_images
      WHERE product_id = pi.product_id
        ${variantImageTenantJoin}
        AND pv_match.id IS NOT NULL
        AND variant_id = pv_match.id
        AND COALESCE(TRIM(image_url), '') <> ''
      ORDER BY is_primary DESC, sort_order ASC, id ASC
      LIMIT 1
    ) pvi_variant ON TRUE`
    : "";
  const colorImageJoin = hasVariantImageTable
    ? `
    LEFT JOIN LATERAL (
      SELECT image_url
      FROM product_variant_images
      WHERE product_id = pi.product_id
        ${variantImageTenantJoin}
        AND COALESCE(TRIM(image_url), '') <> ''
        AND ${normalizedTextSql(itemColorExpr)} <> ''
        AND ${normalizedTextSql("COALESCE(NULLIF(color_name, ''), NULLIF(color_value, ''))")} = ${normalizedTextSql(itemColorExpr)}
      ORDER BY is_primary DESC, sort_order ASC, id ASC
      LIMIT 1
    ) pvi_color ON TRUE`
    : "";
  const variantImageExpr = hasVariantImageTable
    ? `COALESCE(NULLIF(TRIM(pvi_variant.image_url), ''), ${matchedVariantImageExpr}, ${lineVariantImageExpr})`
    : `COALESCE(${matchedVariantImageExpr}, ${lineVariantImageExpr})`;
  const colorImageExpr = hasVariantImageTable
    ? `COALESCE(NULLIF(TRIM(pvi_color.image_url), ''), ${variantImageExpr})`
    : variantImageExpr;
  const finalImageExpr = `COALESCE(${variantImageExpr}, ${colorImageExpr}, ${lineVariantImageExpr}, ${lineProductImageExpr}, ${productImageExpr})`;
  const matchedByExpr = `
    CASE
      WHEN pi.variant_id IS NOT NULL AND pv_match.id = pi.variant_id THEN 'variant_id'
      WHEN ${normalizedItemSkuExpr} <> '' AND ${normalizedVariantSkuExpr} = ${normalizedItemSkuExpr} THEN 'sku'
      WHEN ${normalizedItemColorExpr} <> '' AND ${normalizedItemSizeExpr} <> '' AND ${normalizedVariantColorExpr} = ${normalizedItemColorExpr} AND ${normalizedVariantSizeExpr} = ${normalizedItemSizeExpr} THEN 'product_color_size'
      ELSE NULL
    END`;
  const itemsResult = await client.query(
    `
    SELECT
      pi.*,
      COALESCE(pi.quantity, 0) AS quantity,
      ${itemUnitCostExpr} AS unit_cost,
      ${itemUnitCostExpr} AS cost_price,
      ${itemTotalExpr} AS subtotal,
      ${variantSalePriceExpr} AS variant_sale_price,
      ${variantDiscountPriceExpr} AS variant_discount_price,
      ${receivedExpr} AS received_quantity,
      COALESCE(p.name, ${metadataProductNameExpr}, '') AS product_name,
      ${productImageExpr} AS product_image_url,
      ${variantImageExpr} AS variant_image_url,
      ${colorImageExpr} AS color_image_url,
      ${variantImageExpr} AS product_variant_image,
      ${finalImageExpr} AS image_url,
      pv_match.id AS matched_variant_id,
      ${matchedByExpr} AS image_matched_by,
      ${itemSkuExpr} AS sku,
      ${itemColorExpr} AS color,
      ${itemSizeExpr} AS size
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    LEFT JOIN products p ON p.id = pi.product_id ${productTenantJoin}
    ${variantMatchJoin}
    ${variantImageJoin}
    ${colorImageJoin}
    WHERE pi.purchase_id = $1
      ${itemTenant}
    ORDER BY pi.id ASC
    `,
    itemTenantValues
  );
  itemsResult.rows.forEach((row) => {
    console.log("[purchase-edit-pricing-load]", {
      purchase_id: purchase.id,
      item_id: row.id || row.purchase_item_id || null,
      variant_id: row.variant_id || row.matched_variant_id || null,
      purchase_cost: row.unit_cost ?? row.cost_price ?? null,
      sale_price: row.variant_sale_price ?? null,
      discount_price: row.variant_discount_price ?? null,
    });
    console.log("[purchase-image-resolve-backend]", {
      purchaseItemId: row.id || row.purchase_item_id || null,
      productId: row.product_id || null,
      purchaseVariantId: row.variant_id || null,
      sku: row.sku || "",
      color: row.color || "",
      size: row.size || "",
      matchedVariantId: row.matched_variant_id || null,
      matchedBy: row.image_matched_by || null,
      variantImage: row.variant_image_url || "",
      colorImage: row.color_image_url || "",
      productCoverImage: row.product_image_url || "",
      finalImage: row.image_url || "",
    });
  });
  let safety = emptyPurchaseSafety();
  if (includeSafety) {
    try {
      safety = await getPurchaseSafety(client, { tenantId, purchase });
      const stockReversal = await getPurchaseStockReversalState(client, {
        tenantId,
        purchase: { ...purchase, items: itemsResult.rows, safety },
        items: itemsResult.rows,
      });
      safety = {
        ...safety,
        ...stockReversal,
        canDeleteWithStockReversal: !safety.hasReturns && stockReversal.canReverseStock,
        stockReversalBlockMessage: stockReversal.canReverseStock ? null : STOCK_REVERSAL_BLOCK_MESSAGE,
      };
    } catch (error) {
      console.warn("[purchase-details] safety read skipped", {
        purchaseId,
        tenantId,
        error: error.message,
      });
    }
  }
  return normalizePurchaseRow(purchase, itemsResult.rows, safety);
};

const loadPurchases = async (client, { tenantId }) => {
  await ensurePurchaseCreateSchema(client);
  const purchaseColumns = await getTableColumns(client, "purchases");
  const values = [];
  const purchaseTenant = tenantClause("p", purchaseColumns, tenantId, values);
  const activePurchaseFilter = purchaseColumns.has("deleted_at") ? "AND p.deleted_at IS NULL" : "";
  const result = await client.query(
    `
    SELECT
      p.*,
      COALESCE(s.name, '') AS supplier_name,
      COALESCE(w.name, w.code, '') AS warehouse_name,
      COALESCE(item_counts.item_count, 0)::int AS item_count
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN (
      SELECT purchase_id, COUNT(*) AS item_count
      FROM purchase_items
      GROUP BY purchase_id
    ) item_counts ON item_counts.purchase_id = p.id
    WHERE 1 = 1
      ${purchaseTenant}
      ${activePurchaseFilter}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 500
    `,
    values
  );
  const rows = result.rows;
  const purchaseIds = rows.map((row) => row.id).filter(Boolean);
  const itemsByPurchase = new Map();
  if (purchaseIds.length) {
    const itemColumns = await getTableColumns(client, "purchase_items");
    const receivedExpr = itemColumns.has("received_quantity")
      ? "received_quantity"
      : itemColumns.has("received_qty")
        ? "received_qty"
        : "quantity";
    const itemTenantFilter = itemColumns.has("tenant_id") ? "AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)" : "";
    const itemParams = itemColumns.has("tenant_id") ? [purchaseIds, tenantId] : [purchaseIds];
    const itemsResult = await client.query(
      `
      SELECT *, ${receivedExpr} AS received_quantity
      FROM purchase_items
      WHERE purchase_id = ANY($1::bigint[])
        ${itemTenantFilter}
      ORDER BY id ASC
      `,
      itemParams
    );
    itemsResult.rows.forEach((item) => {
      const key = String(item.purchase_id);
      itemsByPurchase.set(key, [...(itemsByPurchase.get(key) || []), item]);
    });
  }
  const normalized = [];
  for (const row of rows) {
    const items = itemsByPurchase.get(String(row.id)) || [];
    let safety = {};
    try {
      const stockReversal = await getPurchaseStockReversalState(client, { tenantId, purchase: { ...row, items }, items });
      safety = {
        canDeleteWithStockReversal: stockReversal.canReverseStock,
        stockReversalBlockMessage: stockReversal.canReverseStock ? null : STOCK_REVERSAL_BLOCK_MESSAGE,
        ...stockReversal,
      };
    } catch (error) {
      console.warn("[purchases:list] stock reversal safety skipped", { purchaseId: row.id, error: error.message });
    }
    normalized.push(normalizePurchaseRow(row, [], safety));
  }
  return normalized;
};

const resolveSupplierForPurchaseUpdate = async (client, tenantId, body = {}, fallbackSupplierId = null) => {
  const explicitSupplierId = body.supplier_id ?? body.supplierId;
  if (explicitSupplierId) return ensureDefaultSupplierForPurchase(client, tenantId, explicitSupplierId);
  const supplierName = String(body.supplier_name ?? body.supplierName ?? "").trim();
  if (!supplierName) return ensureDefaultSupplierForPurchase(client, tenantId, fallbackSupplierId);

  const existing = await client.query(
    `
    SELECT id
    FROM suppliers
    WHERE (tenant_id = $1 OR tenant_id IS NULL)
      AND LOWER(name) = LOWER($2)
    ORDER BY id ASC
    LIMIT 1
    `,
    [tenantId, supplierName]
  );
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const created = await client.query(
    `
    INSERT INTO suppliers (tenant_id, name, phone, email, address, status)
    VALUES ($1, $2, '', '', '', 'active')
    RETURNING id
    `,
    [tenantId, supplierName]
  );
  return created.rows[0].id;
};

const updatePurchaseHeader = async (client, { tenantId, purchase, body }) => {
  const normalizedItems = Array.isArray(body.items) ? mergePurchaseItems(body.items.map(normalizePurchaseItem)) : null;
  const subtotal = normalizedItems
    ? normalizedItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0), 0)
    : Number(body.subtotal ?? purchase.subtotal ?? 0) || 0;
  const tax = Number(body.tax ?? body.tax_amount ?? purchase.tax_amount ?? 0) || 0;
  const discount = Number(body.discount ?? body.discount_amount ?? purchase.discount_amount ?? 0) || 0;
  const total = Number(body.total ?? Math.max(0, subtotal + tax - discount)) || 0;
  const supplierId = await resolveSupplierForPurchaseUpdate(client, tenantId, body, purchase.supplier_id);
  const warehouseId = await ensureDefaultWarehouseForPurchase(client, tenantId, body.warehouse_id ?? body.warehouseId ?? purchase.warehouse_id);
  const paymentStatus = normalizePaymentStatus(body.payment_status ?? body.paymentStatus ?? purchase.payment_status);
  const supplierPaymentStatus = normalizeSupplierPaymentStatus(body.supplier_payment_status ?? body.supplierPaymentStatus ?? paymentStatus);
  const paidAmount = Number(body.paid_amount ?? body.paidAmount ?? body.supplier_paid_amount ?? body.supplierPaidAmount ?? purchase.paid_amount ?? 0) || 0;
  const remainingAmount = Math.max(0, total - paidAmount);
  const paymentAccountId = body.payment_account_id ?? body.paymentAccountId ?? body.money_account_id ?? body.moneyAccountId ?? purchase.payment_account_id ?? null;
  const purchasePaymentMethod = body.payment_method ?? body.paymentMethod ?? purchase.payment_method ?? "";
  const purchaseColumns = await getTableColumns(client, "purchases");
  const currentMetadata = purchase.metadata && typeof purchase.metadata === "object" ? purchase.metadata : {};
  const nextMetadata = {
    ...currentMetadata,
    ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
    supplier_invoice_number: body.supplier_invoice_number ?? body.supplierInvoiceNumber ?? currentMetadata.supplier_invoice_number ?? "",
    supplier_reference: body.supplier_reference ?? body.supplierReference ?? currentMetadata.supplier_reference ?? "",
    payment_reference: body.payment_reference ?? body.paymentReference ?? currentMetadata.payment_reference ?? "",
    attachments: Array.isArray(body.attachments) ? body.attachments : Array.isArray(currentMetadata.attachments) ? currentMetadata.attachments : [],
  };

  await client.query(
    `
    UPDATE purchases
    SET supplier_id = $1,
        warehouse_id = $2,
        payment_status = $3,
        supplier_payment_status = $4,
        subtotal = $5,
        tax_amount = $6,
        discount_amount = $7,
        total = $8,
        paid_amount = $9,
        supplier_paid_amount = $9,
        notes = $10,
        metadata = CASE WHEN $13::boolean THEN $14::jsonb ELSE metadata END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $11
      AND (tenant_id = $12 OR tenant_id IS NULL)
    `,
    [
      supplierId,
      warehouseId,
      paymentStatus,
      supplierPaymentStatus,
      subtotal,
      tax,
      discount,
      total,
      paidAmount,
      body.notes ?? purchase.notes ?? "",
      purchase.id,
      tenantId,
      purchaseColumns.has("metadata"),
      JSON.stringify(nextMetadata),
    ]
  );

  const extraSets = [];
  const extraValues = [purchase.id, tenantId];
  if (purchaseColumns.has("remaining_amount")) {
    extraValues.push(remainingAmount);
    extraSets.push(`remaining_amount = $${extraValues.length}`);
  }
  if (purchaseColumns.has("payment_account_id")) {
    extraValues.push(paymentAccountId || null);
    extraSets.push(`payment_account_id = $${extraValues.length}`);
  }
  if (purchaseColumns.has("payment_method")) {
    extraValues.push(purchasePaymentMethod || null);
    extraSets.push(`payment_method = $${extraValues.length}`);
  }
  if (extraSets.length) {
    await client.query(
      `
      UPDATE purchases
      SET ${extraSets.join(", ")},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND (tenant_id = $2 OR tenant_id IS NULL)
      `,
      extraValues
    );
  }

  if (normalizedItems) {
    await bulkRewritePurchaseItems(client, { tenantId, purchaseId: purchase.id, items: normalizedItems });
    await updatePurchaseEditVariantPricing(client, { tenantId, purchaseId: purchase.id, items: normalizedItems, previousItems: purchase.items || [] });
    await updatePurchaseEditSimpleProductPricing(client, { tenantId, purchaseId: purchase.id, items: normalizedItems, previousItems: purchase.items || [] });
  }
};

const updateSupplierBalanceForPurchase = async (client, { tenantId, supplierId, amount }) => {
  const numericAmount = Number(amount || 0);
  if (!supplierId || !Number.isFinite(numericAmount) || numericAmount === 0) return;
  const columns = await getTableColumns(client, "suppliers");
  const sets = [];
  if (columns.has("current_balance")) sets.push("current_balance = COALESCE(current_balance, 0) + $1");
  if (columns.has("debt_balance")) sets.push("debt_balance = COALESCE(debt_balance, 0) + $1");
  if (columns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
  if (!sets.length) return;
  await client.query(
    `
    UPDATE suppliers
    SET ${sets.join(", ")}
    WHERE id = $2
      AND (tenant_id = $3 OR tenant_id IS NULL)
    `,
    [numericAmount, supplierId, tenantId]
  );
};

const appendPurchaseAdjustmentMetadata = async (client, { purchaseId, tenantId, adjustment }) => {
  const columns = await getTableColumns(client, "purchases");
  if (!columns.has("metadata")) return;
  await client.query(
    `
    UPDATE purchases
    SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{adjustments}',
          COALESCE(metadata->'adjustments', '[]'::jsonb) || $1::jsonb,
          true
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
      AND (tenant_id = $3 OR tenant_id IS NULL)
    `,
    [JSON.stringify([adjustment]), purchaseId, tenantId]
  );
};

const appendPurchaseTimelineEvents = async (client, { purchaseId, tenantId, events = [] }) => {
  const rows = Array.isArray(events) ? events.filter(Boolean) : [];
  if (!rows.length) return;
  const columns = await getTableColumns(client, "purchases");
  if (!columns.has("metadata")) return;
  await client.query(
    `
    UPDATE purchases
    SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{timeline}',
          COALESCE(metadata->'timeline', '[]'::jsonb) || $1::jsonb,
          true
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
      AND (tenant_id = $3 OR tenant_id IS NULL)
    `,
    [JSON.stringify(rows), purchaseId, tenantId]
  );
};

const purchaseLineKey = (item = {}) => {
  if (item.id || item.purchase_item_id) return `id:${item.id || item.purchase_item_id}`;
  if (item.variant_id) return `variant:${item.variant_id}`;
  return `product:${item.product_id || ""}:${String(item.sku || "").trim().toLowerCase()}:${String(item.color || "").trim().toLowerCase()}:${String(item.size || "").trim().toLowerCase()}`;
};

const purchaseReceivedItemQuantity = (purchase = {}) =>
  (Array.isArray(purchase.items) ? purchase.items : []).reduce(
    (sum, item) => sum + Number(item.received_quantity ?? item.received_qty ?? (purchase.stock_applied ? item.quantity : 0) ?? 0),
    0
  );

const purchaseHasReceivedStock = (purchase = {}) => {
  const status = String(purchase.status || "").trim().toLowerCase();
  const safety = purchase.safety || {};
  return Boolean(
    purchase.stock_applied ||
    purchase.stock_applied_at ||
    purchaseReceivedItemQuantity(purchase) > 0 ||
    safety.hasStockMovements ||
    ["received", "posted", "saved_received", "save_received"].includes(status)
  );
};

const STOCK_REVERSAL_BLOCK_MESSAGE = "Cannot delete this purchase because some received stock has already been sold or moved. Use return/adjustment flow.";

const receivedQuantityForItem = (purchase = {}, item = {}) =>
  Number(item.received_quantity ?? item.received_qty ?? (purchase.stock_applied ? item.quantity : 0) ?? 0) || 0;

const getPurchaseStockReversalState = async (client, { tenantId, purchase, items = null }) => {
  const purchaseItems = Array.isArray(items)
    ? items
    : Array.isArray(purchase?.items)
      ? purchase.items
      : [];
  const receivedItems = purchaseItems
    .map((item) => ({ ...item, received_quantity: receivedQuantityForItem(purchase, item) }))
    .filter((item) => Number(item.received_quantity || 0) > 0 && (item.variant_id || item.product_id));

  if (!purchaseHasReceivedStock({ ...purchase, items: purchaseItems }) || !receivedItems.length) {
    return { canReverseStock: true, hasMovedReceivedStock: false, blockedItems: [] };
  }

  const blockedItems = [];
  const variantIds = [...new Set(receivedItems.map((item) => Number(item.variant_id)).filter((value) => Number.isFinite(value) && value > 0))];
  const productOnlyIds = [...new Set(receivedItems.filter((item) => !item.variant_id).map((item) => Number(item.product_id)).filter((value) => Number.isFinite(value) && value > 0))];

  const variantStock = new Map();
  if (variantIds.length) {
    console.time("[purchase-delete] stock recalculation variant lookup");
    const result = await client.query(
      `
      SELECT id, stock
      FROM product_variants
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      `,
      [variantIds, tenantId]
    );
    console.timeEnd("[purchase-delete] stock recalculation variant lookup");
    result.rows.forEach((row) => variantStock.set(Number(row.id), Number(row.stock || 0)));
  }

  const productStock = new Map();
  if (productOnlyIds.length) {
    console.time("[purchase-delete] stock recalculation product lookup");
    const result = await client.query(
      `
      SELECT id, stock
      FROM products
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      `,
      [productOnlyIds, tenantId]
    );
    console.timeEnd("[purchase-delete] stock recalculation product lookup");
    result.rows.forEach((row) => productStock.set(Number(row.id), Number(row.stock || 0)));
  }

  let movedKeys = new Set();
  if (await tableExists(client, "inventory_movements")) {
    console.time("[purchase-delete] inventory_movements reversal safety");
    const movementColumns = await getTableColumns(client, "inventory_movements");
    const createdAtExpr = movementColumns.has("created_at") ? "created_at" : "CURRENT_TIMESTAMP";
    const movementCreatedAtExpr = movementColumns.has("created_at") ? "im.created_at" : "CURRENT_TIMESTAMP";
    const referenceTypeExpr = movementColumns.has("reference_type") ? "COALESCE(reference_type, '')" : "''";
    const movementReferenceTypeExpr = movementColumns.has("reference_type") ? "COALESCE(im.reference_type, '')" : "''";
    const referenceIdExpr = movementColumns.has("reference_id") ? "reference_id" : "NULL";
    const quantityChangeExpr = movementColumns.has("quantity_change") ? "quantity_change" : movementColumns.has("quantity") ? "quantity" : "0";
    const movementQuantityChangeExpr = movementColumns.has("quantity_change") ? "im.quantity_change" : movementColumns.has("quantity") ? "im.quantity" : "0";
    const tenantFilter = movementColumns.has("tenant_id") ? "AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)" : "";
    const movementParams = movementColumns.has("tenant_id") ? [purchase.id, tenantId] : [purchase.id];
    const result = await client.query(
      `
      WITH purchase_receipts AS (
        SELECT
          variant_id,
          product_id,
          MIN(${createdAtExpr}) AS received_at
        FROM inventory_movements
        WHERE ${referenceIdExpr} = $1
          AND ${referenceTypeExpr} = 'purchase'
          ${tenantFilter}
        GROUP BY variant_id, product_id
      )
      SELECT DISTINCT
        COALESCE(im.variant_id, 0)::bigint AS variant_id,
        COALESCE(im.product_id, 0)::bigint AS product_id
      FROM inventory_movements im
      JOIN purchase_receipts pr
        ON (
          (pr.variant_id IS NOT NULL AND im.variant_id = pr.variant_id)
          OR (pr.variant_id IS NULL AND pr.product_id IS NOT NULL AND im.product_id = pr.product_id)
        )
      WHERE ${movementCreatedAtExpr} > pr.received_at
        AND COALESCE(${movementQuantityChangeExpr}, 0) < 0
        AND ${movementReferenceTypeExpr} <> 'purchase_reversal'
        ${movementColumns.has("tenant_id") ? "AND ($2::bigint IS NULL OR im.tenant_id = $2 OR im.tenant_id IS NULL)" : ""}
      `,
      movementParams
    );
    console.timeEnd("[purchase-delete] inventory_movements reversal safety");
    movedKeys = new Set(
      result.rows.map((row) => {
        const variantId = Number(row.variant_id || 0);
        const productId = Number(row.product_id || 0);
        return variantId > 0 ? `variant:${variantId}` : `product:${productId}`;
      })
    );
  }

  for (const item of receivedItems) {
    const received = Number(item.received_quantity || 0);
    const key = item.variant_id ? `variant:${Number(item.variant_id)}` : `product:${Number(item.product_id)}`;
    const available = item.variant_id ? variantStock.get(Number(item.variant_id)) : productStock.get(Number(item.product_id));
    if (available === undefined || Number(available || 0) < received) {
      blockedItems.push({
        product_id: item.product_id || null,
        variant_id: item.variant_id || null,
        sku: item.sku || "",
        received,
        available: Number(available || 0),
        moved_after_receipt: movedKeys.has(key),
      });
    }
  }

  return {
    canReverseStock: blockedItems.length === 0,
    hasMovedReceivedStock: blockedItems.some((item) => item.moved_after_receipt || item.available < item.received),
    blockedItems,
  };
};

const markPurchaseCancelledOrDeleted = async (client, { tenantId, purchaseId, userId, reason = "", status = "cancelled", deleted = false, reversed = false }) => {
  const columns = await getTableColumns(client, "purchases");
  const sets = [];
  const values = [purchaseId, tenantId];
  const push = (sql, value) => {
    values.push(value);
    sets.push(sql.replace("?", `$${values.length}`));
  };
  if (columns.has("status")) push("status = ?", status);
  if (columns.has("deleted_at") && deleted) sets.push("deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)");
  if (columns.has("deleted_by") && deleted) push("deleted_by = COALESCE(deleted_by, ?)", userId || null);
  if (columns.has("delete_reason") && deleted) push("delete_reason = COALESCE(delete_reason, ?)", reason || "Purchase deleted with stock reversal");
  if (columns.has("reversed_at") && reversed) sets.push("reversed_at = COALESCE(reversed_at, CURRENT_TIMESTAMP)");
  if (columns.has("reversed_by") && reversed) push("reversed_by = COALESCE(reversed_by, ?)", userId || null);
  if (columns.has("stock_applied") && reversed) sets.push("stock_applied = FALSE");
  if (columns.has("notes")) push("notes = COALESCE(notes, '') || E'\\n' || ?::text", reason || (deleted ? "Purchase deleted/reversed" : "Purchase cancelled/reversed"));
  if (columns.has("metadata")) {
    push("metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb", JSON.stringify({
      ...(deleted ? { deleted_at: new Date().toISOString(), deleted_by: userId || null } : {}),
      ...(reversed ? { reversed_at: new Date().toISOString(), reversed_by: userId || null } : {}),
      cancel_delete_reason: reason || "",
    }));
  }
  if (columns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
  if (!sets.length) return;
  await client.query(
    `
    UPDATE purchases
    SET ${sets.join(", ")}
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
    `,
    values
  );
};

const setPurchaseDeleteStep = (stepRef, step) => {
  if (stepRef) stepRef.step = step;
  return step;
};

const logPurchaseDeleteReverseFailed = ({ purchaseId, step, err }) => {
  console.error("[purchase-delete-reverse-failed]", {
    purchaseId,
    step,
    message: err.message,
    detail: err.detail,
    code: err.code,
    constraint: err.constraint,
    stack: err.stack,
  });
};

const reversePurchasePaymentMovements = async (client, { tenantId, purchase, userId = null, reason = "" }) => {
  const paidAmount = Number(purchase?.paid_amount ?? purchase?.supplier_paid_amount ?? 0) || 0;
  if (!purchase?.id || paidAmount <= 0) return [];
  const reversals = await reverseMoneyTransactionsForReference(client, {
    tenantId,
    referenceType: "purchase",
    referenceId: purchase.id,
    transactionType: "purchase_payment",
    reversalReferenceType: "purchase_reversal",
    reversalReferenceId: purchase.id,
    notes: reason || `Reverse supplier payment for purchase ${purchase.purchase_number || purchase.id}`,
    createdBy: userId,
  });
  if (reversals.length) return reversals;

  await recordFinancialAccountActivity(client, {
    tenantId,
    moneyAccountId: purchase.payment_account_id || purchase.metadata?.payment_account_id || null,
    financialAccountId: purchase.financial_account_id || purchase.metadata?.financial_account_id || null,
    paymentMethod: purchase.payment_method || purchase.metadata?.payment_method || "bank",
    entryType: "purchase_reversal",
    direction: 1,
    sourceType: "purchase_reversal",
    sourceId: purchase.id,
    amount: paidAmount,
    notes: reason || `Reverse supplier payment for purchase ${purchase.purchase_number || purchase.id}`,
    createdBy: userId,
  });
  return [];
};

const purchasePaymentFieldsTouched = (body = {}) =>
  [
    "paid_amount",
    "paidAmount",
    "supplier_paid_amount",
    "supplierPaidAmount",
    "payment_account_id",
    "paymentAccountId",
    "money_account_id",
    "moneyAccountId",
    "financial_account_id",
    "financialAccountId",
    "payment_method",
    "paymentMethod",
  ].some((key) => Object.prototype.hasOwnProperty.call(body, key));

const replacePurchasePaymentMovement = async (client, { tenantId, beforePurchase, afterPurchase, body = {}, userId = null }) => {
  if (!purchasePaymentFieldsTouched(body)) return;
  const previousPaid = Number(beforePurchase?.paid_amount ?? beforePurchase?.supplier_paid_amount ?? 0) || 0;
  const nextPaid = Number(afterPurchase?.paid_amount ?? afterPurchase?.supplier_paid_amount ?? 0) || 0;
  const previousAccount = beforePurchase?.payment_account_id || beforePurchase?.metadata?.payment_account_id || null;
  const nextAccount = afterPurchase?.payment_account_id || body.payment_account_id || body.paymentAccountId || body.money_account_id || body.moneyAccountId || null;
  const previousMethod = beforePurchase?.payment_method || beforePurchase?.metadata?.payment_method || "";
  const nextMethod = afterPurchase?.payment_method || body.payment_method || body.paymentMethod || "";
  const changed = Math.abs(previousPaid - nextPaid) >= 0.01 || String(previousAccount || "") !== String(nextAccount || "") || String(previousMethod || "") !== String(nextMethod || "");
  if (!changed && nextPaid > 0) return;

  if (previousPaid > 0) {
    await reversePurchasePaymentMovements(client, {
      tenantId,
      purchase: beforePurchase,
      userId,
      reason: `Replace supplier payment for purchase ${beforePurchase.purchase_number || beforePurchase.id}`,
    });
  }

  if (nextPaid > 0) {
    await postMoneyTransaction(client, {
      tenantId,
      moneyAccountId: nextAccount,
      financialAccountId: body.financial_account_id || body.financialAccountId || afterPurchase?.financial_account_id || null,
      paymentMethod: nextMethod || "bank",
      transactionType: "purchase_payment",
      direction: "out",
      referenceType: "purchase",
      referenceId: afterPurchase.id,
      amount: nextPaid,
      notes: `Purchase #${afterPurchase.purchase_number || afterPurchase.id}`,
      createdBy: userId,
    });
  }
};

const reversePurchaseAndArchive = async (client, { tenantId, purchase, userId = null, reason = "delete_requested", stepRef = null }) => {
  setPurchaseDeleteStep(stepRef, "validate current stock");
  console.time(`[purchase-delete:${purchase?.id || "unknown"}] stock reversal validation`);
  const safety = purchase.safety || {};
  if (safety.hasReturns) {
    console.timeEnd(`[purchase-delete:${purchase?.id || "unknown"}] stock reversal validation`);
    const error = new Error("Cannot delete this purchase because return records already exist. Reverse or settle those returns first.");
    error.status = 409;
    error.reason = "PURCHASE_HAS_RETURNS";
    error.safety = safety;
    throw error;
  }

  if (purchaseHasReceivedStock(purchase)) {
    const stockReversal = await getPurchaseStockReversalState(client, { tenantId, purchase, items: purchase.items || [] });
    if (!stockReversal.canReverseStock) {
      console.timeEnd(`[purchase-delete:${purchase?.id || "unknown"}] stock reversal validation`);
      const error = new Error(STOCK_REVERSAL_BLOCK_MESSAGE);
      error.status = 409;
      error.reason = "PURCHASE_STOCK_UNAVAILABLE";
      error.safety = { ...safety, ...stockReversal, canDeleteWithStockReversal: false };
      throw error;
    }
  }
  console.timeEnd(`[purchase-delete:${purchase?.id || "unknown"}] stock reversal validation`);

  const purchaseStatus = String(purchase.status || "").toLowerCase();
  const alreadyReversed = ["cancelled", "canceled", "reversed"].includes(purchaseStatus) || purchase.metadata?.reversed_at || purchase.reversed_at;
  console.time(`[purchase-delete:${purchase.id}] reverse received purchase`);
  const reversal = !alreadyReversed && purchaseHasReceivedStock(purchase)
    ? await reverseReceivedPurchase(client, {
        tenantId,
        purchase,
        userId,
        reason,
        stepRef,
      })
    : { movementCount: 0 };
  console.timeEnd(`[purchase-delete:${purchase.id}] reverse received purchase`);

  setPurchaseDeleteStep(stepRef, "mark purchase archived");
  setPurchaseDeleteStep(stepRef, "reverse payment/cash movement");
  console.time(`[purchase-delete:${purchase.id}] reverse payment/cash movement`);
  await reversePurchasePaymentMovements(client, { tenantId, purchase, userId, reason });
  console.timeEnd(`[purchase-delete:${purchase.id}] reverse payment/cash movement`);
  setPurchaseDeleteStep(stepRef, "mark purchase archived");
  console.time(`[purchase-delete:${purchase.id}] mark purchase archived`);
  await markPurchaseCancelledOrDeleted(client, {
    tenantId,
    purchaseId: purchase.id,
    userId,
    reason,
    status: "deleted",
    deleted: true,
    reversed: !alreadyReversed && purchaseHasReceivedStock(purchase),
  });
  console.timeEnd(`[purchase-delete:${purchase.id}] mark purchase archived`);
  setPurchaseDeleteStep(stepRef, "mark purchase archived");
  console.time(`[purchase-delete:${purchase.id}] append delete timeline`);
  await appendPurchaseTimelineEvents(client, {
    purchaseId: purchase.id,
    tenantId,
    events: [{
      type: "purchase_deleted",
      label: reversal.movementCount > 0 ? "Purchase deleted and stock reversed" : "Purchase deleted",
      reason,
      movement_count: reversal.movementCount,
      created_by: userId,
      created_at: new Date().toISOString(),
    }],
  });
  console.timeEnd(`[purchase-delete:${purchase.id}] append delete timeline`);

  return reversal;
};

const logPurchaseEdit409 = ({ purchaseId, reason, status, hasReceivedStock, attemptedLineChanges = true }) => {
  console.error("[purchase-edit-409]", {
    purchaseId,
    reason,
    status,
    hasReceivedStock,
    attemptedLineChanges,
  });
};

const purchaseEditTimers = new Set();
const startTimer = (label) => {
  if (purchaseEditTimers.has(label)) return;
  purchaseEditTimers.add(label);
  console.time(label);
};

const endTimer = (label) => {
  if (!purchaseEditTimers.has(label)) return;
  purchaseEditTimers.delete(label);
  try {
    console.timeEnd(label);
  } catch {
    // Timer may not exist if an earlier setup step failed.
  }
};

const purchaseEditTimeoutLog = ({ purchaseId, incomingItems = [], deltas = [], step, err }) => {
  console.error("[purchase-edit-timeout]", {
    purchaseId,
    itemCount: incomingItems.length,
    deltaCount: deltas.length,
    step,
    error: err?.message || String(err || ""),
  });
};

const loadPurchaseForEdit = async (client, { tenantId, purchaseId }) => {
  const itemColumns = await getTableColumns(client, "purchase_items");
  const variantColumns = await getTableColumns(client, "product_variants");
  const itemSalePriceExpr = itemColumns.has("sale_price") ? "NULLIF(pi.sale_price, 0)" : "NULL";
  const variantSalePriceExpr = coalesceNumericColumns("pv", variantColumns, ["price", "regular_price"], coalesceNumericColumns("pi", itemColumns, ["selling_price", "regular_price"], "0"));
  const variantDiscountPriceExpr = coalesceNumericColumns("pv", variantColumns, ["discount_price", "offer_price", "sale_price"], itemSalePriceExpr);
  const result = await client.query(
    `
    SELECT
      p.*,
      COALESCE(s.name, '') AS supplier_name,
      COALESCE(w.name, w.code, '') AS warehouse_name,
      COALESCE(items.rows, '[]'::jsonb) AS items
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.id) AS rows
      FROM (
        SELECT
          pi.*,
          ${variantSalePriceExpr} AS variant_sale_price,
          ${variantDiscountPriceExpr} AS variant_discount_price
        FROM purchase_items pi
        LEFT JOIN product_variants pv ON pv.id = pi.variant_id
        WHERE pi.purchase_id = p.id
          AND (pi.tenant_id = $2 OR pi.tenant_id IS NULL)
        FOR UPDATE OF pi
      ) pi
    ) items ON TRUE
    WHERE p.id = $1
      AND (p.tenant_id = $2 OR p.tenant_id IS NULL)
    FOR UPDATE OF p
    `,
    [purchaseId, tenantId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const items = Array.isArray(row.items) ? row.items : [];
  items.forEach((item) => {
    console.log("[purchase-edit-pricing-load]", {
      purchase_id: row.id,
      item_id: item.id || item.purchase_item_id || null,
      variant_id: item.variant_id || null,
      purchase_cost: item.unit_cost ?? item.cost_price ?? null,
      sale_price: item.variant_sale_price ?? null,
      discount_price: item.variant_discount_price ?? null,
    });
  });
  return normalizePurchaseRow(row, items, emptyPurchaseSafety());
};

const validatePurchaseEditProducts = async (client, { tenantId, items }) => {
  const productIds = [...new Set(items.map((item) => Number(item.product_id)).filter((value) => Number.isInteger(value) && value > 0))];
  const variantIds = [...new Set(items.map((item) => Number(item.variant_id)).filter((value) => Number.isInteger(value) && value > 0))];
  if (productIds.length) {
    const result = await client.query(
      `
      SELECT id
      FROM products
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      `,
      [productIds, tenantId]
    );
    const found = new Set(result.rows.map((row) => Number(row.id)));
    const missing = productIds.filter((id) => !found.has(id));
    if (missing.length) {
      const error = new Error(`Invalid product id(s): ${missing.join(", ")}`);
      error.status = 409;
      error.purchaseEdit409Reason = "invalid_product";
      throw error;
    }
  }
  if (variantIds.length) {
    const result = await client.query(
      `
      SELECT id, product_id
      FROM product_variants
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      `,
      [variantIds, tenantId]
    );
    const found = new Map(result.rows.map((row) => [Number(row.id), Number(row.product_id)]));
    const missing = variantIds.filter((id) => !found.has(id));
    if (missing.length) {
      const error = new Error(`Invalid variant id(s): ${missing.join(", ")}`);
      error.status = 409;
      error.purchaseEdit409Reason = "invalid_variant";
      throw error;
    }
  }
};

const buildReceivedPurchaseEditDeltas = ({ purchase, nextItems }) => {
  const oldItems = Array.isArray(purchase.items) ? purchase.items.map(normalizePurchaseItem) : [];
  const newItems = Array.isArray(nextItems) ? nextItems.map(normalizePurchaseItem) : [];
  const oldByKey = new Map(oldItems.map((item) => [purchaseLineKey(item), item]));
  const newByKey = new Map(newItems.map((item) => [purchaseLineKey(item), item]));
  const deltas = [];
  const events = [{ label: "Purchase edited", type: "purchase_edited", created_at: new Date().toISOString() }];

  for (const [key, next] of newByKey.entries()) {
    const previous = oldByKey.get(key);
    const nextQty = Number(next.quantity || 0);
    const nextCost = Number(next.unit_cost || next.cost_price || 0);
    if (!previous) {
      deltas.push({ type: "line_added", item: next, quantityDelta: nextQty, valueDelta: nextQty * nextCost, unitCost: nextCost });
      events.push({ label: "Line added", type: "line_added", variant_id: next.variant_id || null, product_id: next.product_id || null, quantity: nextQty, unit_cost: nextCost, created_at: new Date().toISOString() });
      continue;
    }
    const oldQty = Number(previous.quantity || 0);
    const oldCost = Number(previous.unit_cost || previous.cost_price || 0);
    const quantityDelta = nextQty - oldQty;
    const valueDelta = nextQty * nextCost - oldQty * oldCost;
    if (quantityDelta !== 0 || valueDelta !== 0 || nextCost !== oldCost) {
      deltas.push({ type: "line_changed", item: next, previous, quantityDelta, valueDelta, unitCost: nextCost || oldCost });
      if (quantityDelta !== 0) events.push({ label: `Qty adjusted ${quantityDelta > 0 ? "+" : ""}${quantityDelta}`, type: "qty_adjusted", variant_id: next.variant_id || null, product_id: next.product_id || null, old_quantity: oldQty, new_quantity: nextQty, delta_quantity: quantityDelta, created_at: new Date().toISOString() });
      if (nextCost !== oldCost) events.push({ label: "Cost adjusted", type: "cost_adjusted", variant_id: next.variant_id || null, product_id: next.product_id || null, old_cost: oldCost, new_cost: nextCost, value_delta: oldQty * nextCost - oldQty * oldCost, created_at: new Date().toISOString() });
    }
  }

  for (const [key, previous] of oldByKey.entries()) {
    if (newByKey.has(key)) continue;
    const oldQty = Number(previous.quantity || 0);
    const oldCost = Number(previous.unit_cost || previous.cost_price || 0);
    deltas.push({ type: "line_removed", item: previous, quantityDelta: -oldQty, valueDelta: -(oldQty * oldCost), unitCost: oldCost });
    events.push({ label: "Line removed", type: "line_removed", variant_id: previous.variant_id || null, product_id: previous.product_id || null, quantity: oldQty, unit_cost: oldCost, created_at: new Date().toISOString() });
  }

  return { deltas, events };
};

const bulkInsertInventoryMovements = async (client, rows = []) => {
  const movements = rows.filter((row) => Number(row.quantity_change || 0) !== 0);
  if (!movements.length) return;
  const availableColumns = await getTableColumns(client, "inventory_movements");
  if (availableColumns.has("tenant_id") && movements.some((row) => !row.tenant_id)) {
    throw Object.assign(new Error("Tenant context missing"), { status: 400, code: "TENANT_CONTEXT_MISSING" });
  }
  const candidateColumns = [
    "tenant_id", "product_id", "variant_id", "warehouse_id", "movement_type", "quantity",
    "before_qty", "after_qty", "quantity_before", "quantity_change", "quantity_after",
    "unit_cost", "total_cost", "reference_type", "reference_id", "reason", "notes", "note", "created_by",
  ];
  const columns = candidateColumns.filter((column) => availableColumns.has(column));
  const values = [];
  const tuples = movements.map((row) => {
    const tuple = columns.map((column) => {
      values.push(row[column] ?? null);
      return `$${values.length}`;
    });
    return `(${tuple.join(", ")}, NOW())`;
  });
  await client.query(
    `INSERT INTO inventory_movements (${columns.join(", ")}, created_at) VALUES ${tuples.join(", ")}`,
    values
  );
};

const bulkRewritePurchaseItems = async (client, { tenantId, purchaseId, items }) => {
  await client.query("DELETE FROM purchase_items WHERE purchase_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)", [purchaseId, tenantId]);
  const rows = items.map(normalizePurchaseItem);
  if (!rows.length) return;
  const columns = await getTableColumns(client, "purchase_items");
  const insertColumns = [
    "tenant_id", "purchase_id", "product_id", "variant_id", "quantity", "cost_price", "unit_cost", "total",
    "selling_price", "regular_price", "sale_price", "wholesale_price", "article_code", "metadata",
  ].filter((column) => columns.has(column));
  const values = [];
  const tuples = rows.map((item) => {
    const unitCost = Number(item.unit_cost || item.cost_price || 0);
    const metadata = JSON.stringify({
      ...(item.metadata || {}),
      product_name: item.product_name || item.name || item.metadata?.product_name || "",
      sku: item.sku || "",
      article_code: item.article_code || "",
      color: item.color || "",
      size: item.size || "",
      unit_cost: unitCost,
      cost_price: unitCost,
      selling_price: Number(item.selling_price ?? item.price ?? 0) || 0,
      sale_price: Number(item.sale_price ?? 0) || 0,
      variant_sale_price: Number(item.variant_sale_price ?? item.selling_price ?? item.price ?? 0) || 0,
      variant_discount_price: item.variant_discount_price ?? null,
      wholesale_price: Number(item.wholesale_price ?? 0) || 0,
    });
    const byColumn = {
      tenant_id: tenantId,
      purchase_id: purchaseId,
      product_id: item.product_id ?? null,
      variant_id: item.variant_id || null,
      quantity: Number(item.quantity || 0),
      cost_price: unitCost,
      unit_cost: unitCost,
      total: Number(item.total || item.subtotal || Number(item.quantity || 0) * unitCost),
      selling_price: Number(item.selling_price ?? item.price ?? 0) || 0,
      regular_price: Number(item.selling_price ?? item.price ?? 0) || 0,
      sale_price: Number(item.sale_price ?? 0) || 0,
      wholesale_price: Number(item.wholesale_price ?? 0) || 0,
      article_code: item.article_code || "",
      metadata,
    };
    const tuple = insertColumns.map((column) => {
      values.push(byColumn[column]);
      return `$${values.length}`;
    });
    return `(${tuple.join(", ")})`;
  });
  await client.query(`INSERT INTO purchase_items (${insertColumns.join(", ")}) VALUES ${tuples.join(", ")}`, values);
};

const updatePurchaseEditVariantPricing = async (client, { tenantId, purchaseId, items, previousItems = [] }) => {
  const previousByKey = new Map((previousItems || []).map((item) => [purchaseLineKey(item), item]));
  for (const item of items.map(normalizePurchaseItem)) {
    const variantId = Number(item.variant_id || 0);
    if (!Number.isFinite(variantId) || variantId <= 0) continue;

    const previous = previousByKey.get(purchaseLineKey(item)) || null;
    const purchaseCost = priceSyncFlag(item, "purchaseCost") && pricesDifferForSync(item.unit_cost ?? item.cost_price, previous?.unit_cost ?? previous?.cost_price ?? previous?.purchase_price)
      ? item.unit_cost ?? item.cost_price
      : null;
    const sellingPrice = priceSyncFlag(item, "sellingPrice") && pricesDifferForSync(item.selling_price ?? item.regular_price ?? item.price, previous?.selling_price ?? previous?.regular_price ?? previous?.price)
      ? item.selling_price ?? item.regular_price ?? item.price
      : null;
    const salePrice = priceSyncFlag(item, "salePrice") && pricesDifferForSync(item.sale_price ?? item.discount_price ?? item.variant_discount_price, previous?.sale_price ?? previous?.discount_price ?? previous?.variant_discount_price)
      ? item.sale_price ?? item.discount_price ?? item.variant_discount_price
      : null;
    await updateProductVariantAfterPurchase(client, {
      tenantId,
      productId: item.product_id || null,
      variantId,
      supplierId: item.supplier_id || null,
      unitCost: purchaseCost,
      quantity: item.quantity,
      sellingPrice,
      salePrice,
      articleCode: item.article_code,
      invoiceId: purchaseId,
      lineId: item.id || item.purchase_item_id || null,
      updateSource: "edit_purchase",
    });
    console.log("[purchase-edit-pricing-save]", {
      purchase_id: purchaseId,
      item_id: item.id || item.purchase_item_id || null,
      variant_id: variantId,
      purchase_cost: purchaseSyncNumber(purchaseCost),
      selling_price: purchaseSyncNumber(sellingPrice),
      sale_price: purchaseSyncNumber(salePrice),
    });
  }
};

const updatePurchaseEditSimpleProductPricing = async (client, { tenantId, purchaseId, items, previousItems = [] }) => {
  const previousByKey = new Map((previousItems || []).map((item) => [purchaseLineKey(item), item]));
  for (const item of items.map(normalizePurchaseItem)) {
    const productId = Number(item.product_id || 0);
    const variantId = Number(item.variant_id || 0);
    if (!Number.isFinite(productId) || productId <= 0 || (Number.isFinite(variantId) && variantId > 0)) continue;

    const previous = previousByKey.get(purchaseLineKey(item)) || null;
    const purchaseCost = priceSyncFlag(item, "purchaseCost") && pricesDifferForSync(item.unit_cost ?? item.cost_price, previous?.unit_cost ?? previous?.cost_price ?? previous?.purchase_price)
      ? item.unit_cost ?? item.cost_price
      : null;
    const sellingPrice = priceSyncFlag(item, "sellingPrice") && pricesDifferForSync(item.selling_price ?? item.regular_price ?? item.price, previous?.selling_price ?? previous?.regular_price ?? previous?.price)
      ? item.selling_price ?? item.regular_price ?? item.price
      : null;
    const salePrice = priceSyncFlag(item, "salePrice") && pricesDifferForSync(item.sale_price, previous?.sale_price ?? previous?.discount_price ?? previous?.variant_discount_price)
      ? item.sale_price
      : null;
    await updateSimpleProductPricingAfterPurchase(client, {
      tenantId,
      productId,
      unitCost: purchaseCost,
      sellingPrice,
      salePrice,
      articleCode: item.article_code,
      invoiceId: purchaseId,
      lineId: item.id || item.purchase_item_id || null,
      updateSource: "edit_purchase",
    });
    console.log("[purchase-edit-pricing-save]", {
      purchase_id: purchaseId,
      item_id: item.id || item.purchase_item_id || null,
      product_id: productId,
      purchase_cost: purchaseSyncNumber(purchaseCost),
      selling_price: purchaseSyncNumber(sellingPrice),
      sale_price: purchaseSyncNumber(salePrice),
    });
  }
};

const assertVariantCanDecrease = async (client, { tenantId, variantId, quantity }) => {
  const amount = Number(quantity || 0);
  if (!variantId || amount <= 0) return;
  const result = await client.query(
    `
    SELECT stock
    FROM product_variants
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
    FOR UPDATE
    `,
    [variantId, tenantId]
  );
  const stock = Number(result.rows[0]?.stock || 0);
  if (!result.rows[0] || stock < amount) {
    const error = new Error(`Cannot reverse ${amount} units for variant ${variantId}; available stock is ${stock}.`);
    error.status = 409;
    error.purchaseEdit409Reason = "variant_stock_delta_exceeds_available";
    throw error;
  }
};

const assertProductCanDecrease = async (client, { tenantId, productId, quantity }) => {
  const amount = Number(quantity || 0);
  if (!productId || amount <= 0) return;
  const result = await client.query(
    `
    SELECT stock
    FROM products
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
    FOR UPDATE
    `,
    [productId, tenantId]
  );
  const stock = Number(result.rows[0]?.stock || 0);
  if (!result.rows[0] || stock < amount) {
    const error = new Error(`Cannot reverse ${amount} units for product ${productId}; available stock is ${stock}.`);
    error.status = 409;
    error.purchaseEdit409Reason = "product_stock_delta_exceeds_available";
    throw error;
  }
};

const applyReceivedPurchaseLineDeltas = async (client, { tenantId, purchase, nextItems, userId }) => {
  const warehouseId = await ensureDefaultWarehouseForPurchase(client, tenantId, purchase.warehouse_id);
  const { deltas, events } = buildReceivedPurchaseEditDeltas({ purchase, nextItems });
  const stockDeltas = deltas.filter((delta) => Number(delta.quantityDelta || 0) !== 0);
  const variantDeltaMap = new Map();
  const productDeltaMap = new Map();
  stockDeltas.forEach((delta) => {
    const item = delta.item || {};
    const qty = Number(delta.quantityDelta || 0);
    if (item.variant_id) {
      const key = Number(item.variant_id);
      const current = variantDeltaMap.get(key) || { item, quantityDelta: 0, unitCost: delta.unitCost };
      current.quantityDelta += qty;
      current.unitCost = delta.unitCost || current.unitCost;
      variantDeltaMap.set(key, current);
    } else if (item.product_id) {
      const key = Number(item.product_id);
      const current = productDeltaMap.get(key) || { item, quantityDelta: 0, unitCost: delta.unitCost };
      current.quantityDelta += qty;
      current.unitCost = delta.unitCost || current.unitCost;
      productDeltaMap.set(key, current);
    }
  });

  const variantIds = [...variantDeltaMap.keys()];
  const productIds = [...productDeltaMap.keys()];
  const movementRows = [];

  if (variantIds.length) {
    startTimer("[purchase-edit] stock-availability");
    const stockResult = await client.query(
      `
      SELECT id, product_id, stock
      FROM product_variants
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [variantIds, tenantId]
    );
    endTimer("[purchase-edit] stock-availability");
    const stockById = new Map(stockResult.rows.map((row) => [Number(row.id), row]));
    for (const [variantId, delta] of variantDeltaMap.entries()) {
      const row = stockById.get(variantId);
      const before = Number(row?.stock || 0);
      const change = Number(delta.quantityDelta || 0);
      if (!row || before + change < 0) {
        const error = new Error(`Cannot reverse ${Math.abs(change)} units for variant ${variantId}; available stock is ${before}.`);
        error.status = 409;
        error.purchaseEdit409Reason = "variant_stock_delta_exceeds_available";
        throw error;
      }
      movementRows.push({
        tenant_id: tenantId,
        product_id: row.product_id || delta.item.product_id || null,
        variant_id: variantId,
        warehouse_id: warehouseId,
        movement_type: change > 0 ? "PURCHASE_EDIT_STOCK_IN" : "PURCHASE_EDIT_STOCK_OUT",
        quantity: change,
        before_qty: before,
        after_qty: before + change,
        quantity_before: before,
        quantity_change: change,
        quantity_after: before + change,
        unit_cost: delta.unitCost || null,
        total_cost: Math.abs(change) * Number(delta.unitCost || 0),
        reference_type: "purchase_edit",
        reference_id: purchase.id,
        reason: "Received purchase edit",
        notes: `Qty adjusted ${change > 0 ? "+" : ""}${change}`,
        note: `Qty adjusted ${change > 0 ? "+" : ""}${change}`,
        created_by: userId || null,
      });
    }
    const updateValues = [];
    const cases = [];
    variantDeltaMap.forEach((delta, variantId) => {
      updateValues.push(variantId, Number(delta.quantityDelta || 0));
      cases.push(`WHEN id = $${updateValues.length - 1} THEN stock + $${updateValues.length}`);
    });
    updateValues.push(variantIds, tenantId);
    await client.query(
      `
      UPDATE product_variants
      SET stock = CASE ${cases.join(" ")} ELSE stock END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($${updateValues.length - 1}::bigint[])
        AND ($${updateValues.length}::bigint IS NULL OR tenant_id = $${updateValues.length} OR tenant_id IS NULL)
      `,
      updateValues
    );
  }

  if (productIds.length) {
    startTimer("[purchase-edit] stock-availability");
    const stockResult = await client.query(
      `
      SELECT id, stock
      FROM products
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [productIds, tenantId]
    );
    endTimer("[purchase-edit] stock-availability");
    const stockById = new Map(stockResult.rows.map((row) => [Number(row.id), row]));
    const updateValues = [];
    const cases = [];
    for (const [productId, delta] of productDeltaMap.entries()) {
      const row = stockById.get(productId);
      const before = Number(row?.stock || 0);
      const change = Number(delta.quantityDelta || 0);
      if (!row || before + change < 0) {
        const error = new Error(`Cannot reverse ${Math.abs(change)} units for product ${productId}; available stock is ${before}.`);
        error.status = 409;
        error.purchaseEdit409Reason = "product_stock_delta_exceeds_available";
        throw error;
      }
      updateValues.push(productId, change);
      cases.push(`WHEN id = $${updateValues.length - 1} THEN stock + $${updateValues.length}`);
    }
    updateValues.push(productIds, tenantId);
    await client.query(
      `
      UPDATE products
      SET stock = CASE ${cases.join(" ")} ELSE stock END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($${updateValues.length - 1}::bigint[])
        AND ($${updateValues.length}::bigint IS NULL OR tenant_id = $${updateValues.length} OR tenant_id IS NULL)
      `,
      updateValues
    );
  }

  await bulkInsertInventoryMovements(client, movementRows);

  const valueIncrease = deltas.reduce((sum, delta) => sum + Math.max(0, Number(delta.valueDelta || 0)), 0);
  const valueDecrease = deltas.reduce((sum, delta) => sum + Math.max(0, -Number(delta.valueDelta || 0)), 0);
  try {
    startTimer("[purchase-edit] accounting");
    if (valueIncrease > 0) {
      await postInventoryAdjustment(client, { tenantId, amount: valueIncrease, quantityChange: 1, referenceType: "purchase_edit", referenceId: purchase.id, createdBy: userId || null, notes: "Received purchase edit value increase" });
    }
    if (valueDecrease > 0) {
      await postInventoryAdjustment(client, { tenantId, amount: valueDecrease, quantityChange: -1, referenceType: "purchase_edit", referenceId: purchase.id, createdBy: userId || null, notes: "Received purchase edit value decrease" });
    }
    endTimer("[purchase-edit] accounting");
  } catch (error) {
    endTimer("[purchase-edit] accounting");
    error.status = 409;
    error.purchaseEdit409Reason = "accounting_adjustment_failed";
    throw error;
  }

  return events;
};

const reverseReceivedPurchase = async (client, { tenantId, purchase, userId, reason = "", stepRef = null }) => {
  const items = (Array.isArray(purchase.items) ? purchase.items : []).map(normalizePurchaseItem);
  const warehouseId = await ensureDefaultWarehouseForPurchase(client, tenantId, purchase.warehouse_id);
  const movementRows = [];
  const variantReversals = new Map();
  const productReversals = new Map();

  for (const item of items) {
    const quantity = Number(item.quantity || 0);
    if (quantity <= 0) continue;
    const unitCost = Number(item.unit_cost || item.cost_price || 0) || 0;
    if (item.variant_id) {
      const key = Number(item.variant_id);
      const current = variantReversals.get(key) || { quantity: 0, unitCost, item };
      current.quantity += quantity;
      current.unitCost = unitCost || current.unitCost;
      current.item = item;
      variantReversals.set(key, current);
    } else if (item.product_id) {
      const key = Number(item.product_id);
      const current = productReversals.get(key) || { quantity: 0, unitCost, item };
      current.quantity += quantity;
      current.unitCost = unitCost || current.unitCost;
      current.item = item;
      productReversals.set(key, current);
    }
  }

  const variantIds = [...variantReversals.keys()];
  const productIds = [...productReversals.keys()];

  if (variantIds.length) {
    setPurchaseDeleteStep(stepRef, "validate current stock");
    console.time("[purchase-delete] stock recalculation variant lock");
    const result = await client.query(
      `
      SELECT id, product_id, stock
      FROM product_variants
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [variantIds, tenantId]
    );
    console.timeEnd("[purchase-delete] stock recalculation variant lock");
    const stockById = new Map(result.rows.map((row) => [Number(row.id), row]));
    for (const [variantId, reversal] of variantReversals.entries()) {
      const row = stockById.get(variantId);
      const before = Number(row?.stock || 0);
      const quantity = Number(reversal.quantity || 0);
      if (!row || before < quantity) {
        const error = new Error(`Cannot reverse ${quantity} units for ${reversal.item?.sku || `variant ${variantId}`}; available stock is ${before}.`);
        error.status = 409;
        throw error;
      }
      movementRows.push({
        tenant_id: tenantId,
        product_id: row.product_id || reversal.item?.product_id || null,
        variant_id: variantId,
        warehouse_id: warehouseId,
        movement_type: "PURCHASE_REVERSE_STOCK_OUT",
        quantity: -quantity,
        before_qty: before,
        after_qty: before - quantity,
        quantity_before: before,
        quantity_change: -quantity,
        quantity_after: before - quantity,
        unit_cost: reversal.unitCost,
        total_cost: quantity * Number(reversal.unitCost || 0),
        reference_type: "purchase_reversal",
        reference_id: purchase.id,
        reason: "Purchase reversed",
        notes: reason || `Reversal for purchase ${purchase.purchase_number || purchase.id}`,
        note: reason || `Reversal for purchase ${purchase.purchase_number || purchase.id}`,
        created_by: userId || null,
      });
    }
    setPurchaseDeleteStep(stepRef, "stock recalculation variant update");
    const updateValues = [];
    const tuples = [];
    variantReversals.forEach((reversal, variantId) => {
      updateValues.push(variantId, Number(reversal.quantity || 0));
      tuples.push(`($${updateValues.length - 1}::bigint, $${updateValues.length}::numeric)`);
    });
    updateValues.push(tenantId);
    console.time("[purchase-delete] stock recalculation variant update");
    await client.query(
      `
      WITH incoming(id, quantity) AS (VALUES ${tuples.join(", ")})
      UPDATE product_variants pv
      SET stock = pv.stock - incoming.quantity,
          updated_at = CURRENT_TIMESTAMP
      FROM incoming
      WHERE pv.id = incoming.id
        AND ($${updateValues.length}::bigint IS NULL OR pv.tenant_id = $${updateValues.length} OR pv.tenant_id IS NULL)
      `,
      updateValues
    );
    console.timeEnd("[purchase-delete] stock recalculation variant update");
    setPurchaseDeleteStep(stepRef, "warehouse_inventory updates");
    await bulkAdjustWarehouseVariantStock(client, {
      tenantId,
      warehouseId,
      adjustments: [...variantReversals.entries()].map(([variantId, reversal]) => ({
        variantId,
        quantity: -Number(reversal.quantity || 0),
      })),
    });
  }

  if (productIds.length) {
    setPurchaseDeleteStep(stepRef, "validate current stock");
    console.time("[purchase-delete] stock recalculation product lock");
    const result = await client.query(
      `
      SELECT id, stock
      FROM products
      WHERE id = ANY($1::bigint[])
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      FOR UPDATE
      `,
      [productIds, tenantId]
    );
    console.timeEnd("[purchase-delete] stock recalculation product lock");
    const stockById = new Map(result.rows.map((row) => [Number(row.id), row]));
    for (const [productId, reversal] of productReversals.entries()) {
      const row = stockById.get(productId);
      const before = Number(row?.stock || 0);
      const quantity = Number(reversal.quantity || 0);
      if (!row || before < quantity) {
        const error = new Error(`Cannot reverse ${quantity} units for product ${productId}; available stock is ${before}.`);
        error.status = 409;
        throw error;
      }
      movementRows.push({
        tenant_id: tenantId,
        product_id: productId,
        variant_id: null,
        warehouse_id: warehouseId,
        movement_type: "PURCHASE_REVERSE_STOCK_OUT",
        quantity: -quantity,
        before_qty: before,
        after_qty: before - quantity,
        quantity_before: before,
        quantity_change: -quantity,
        quantity_after: before - quantity,
        unit_cost: reversal.unitCost,
        total_cost: quantity * Number(reversal.unitCost || 0),
        reference_type: "purchase_reversal",
        reference_id: purchase.id,
        reason: "Purchase reversed",
        notes: reason || `Reversal for purchase ${purchase.purchase_number || purchase.id}`,
        note: reason || `Reversal for purchase ${purchase.purchase_number || purchase.id}`,
        created_by: userId || null,
      });
    }
    const updateValues = [];
    const tuples = [];
    productReversals.forEach((reversal, productId) => {
      updateValues.push(productId, Number(reversal.quantity || 0));
      tuples.push(`($${updateValues.length - 1}::bigint, $${updateValues.length}::numeric)`);
    });
    updateValues.push(tenantId);
    console.time("[purchase-delete] stock recalculation product update");
    await client.query(
      `
      WITH incoming(id, quantity) AS (VALUES ${tuples.join(", ")})
      UPDATE products p
      SET stock = p.stock - incoming.quantity,
          updated_at = CURRENT_TIMESTAMP
      FROM incoming
      WHERE p.id = incoming.id
        AND ($${updateValues.length}::bigint IS NULL OR p.tenant_id = $${updateValues.length} OR p.tenant_id IS NULL)
      `,
      updateValues
    );
    console.timeEnd("[purchase-delete] stock recalculation product update");
  }

  setPurchaseDeleteStep(stepRef, "create reversal stock movements");
  console.time("[purchase-delete] inventory_movements reversal insert");
  await bulkInsertInventoryMovements(client, movementRows);
  console.timeEnd("[purchase-delete] inventory_movements reversal insert");

  const amount = Math.max(0, Number(purchase.total || 0) || items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || item.cost_price || 0), 0));
  if (amount > 0 && tenantId !== null && tenantId !== undefined) {
    setPurchaseDeleteStep(stepRef, "reverse accounting");
    await createJournalEntry(client, {
      tenantId,
      referenceType: "purchase_reversal",
      referenceId: purchase.id,
      description: `Purchase reversal #${purchase.purchase_number || purchase.id}`,
      notes: reason || "Purchase reversed",
      createdBy: userId || null,
      isGenerated: true,
      entryType: "purchase_reversal",
      sourceKey: `purchase_reversal:${purchase.id}`,
      lines: [
        { account_code: "2000", credit: 0, debit: amount, notes: "Reverse supplier payable" },
        { account_code: "1200", debit: 0, credit: amount, notes: "Reverse inventory received" },
      ],
    });
  }

  const purchaseColumns = await getTableColumns(client, "purchases");
  const updateSets = [];
  const updateValues = [purchase.id, tenantId];
  const pushUpdate = (sql, value) => {
    updateValues.push(value);
    updateSets.push(sql.replace("?", `$${updateValues.length}`));
  };
  if (purchaseColumns.has("status")) updateSets.push("status = 'reversed'");
  if (purchaseColumns.has("stock_applied")) updateSets.push("stock_applied = FALSE");
  if (purchaseColumns.has("reversed_at")) updateSets.push("reversed_at = COALESCE(reversed_at, CURRENT_TIMESTAMP)");
  if (purchaseColumns.has("reversed_by")) pushUpdate("reversed_by = COALESCE(reversed_by, ?)", userId || null);
  if (purchaseColumns.has("notes")) pushUpdate("notes = COALESCE(notes, '') || E'\\nReversed: ' || ?::text", reason || "Purchase reversed");
  if (purchaseColumns.has("metadata")) {
    pushUpdate("metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb", JSON.stringify({
      reversed_at: new Date().toISOString(),
      reversed_by: userId || null,
      reversal_reason: reason || "",
      reversal_movement_count: movementRows.length,
    }));
  }
  if (purchaseColumns.has("updated_at")) updateSets.push("updated_at = CURRENT_TIMESTAMP");
  if (updateSets.length) {
    await client.query(
      `
      UPDATE purchases
      SET ${updateSets.join(", ")}
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2 OR tenant_id IS NULL)
      `,
      updateValues
    );
  }

  return { movementCount: movementRows.length };
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

router.get(
  "/",
  protect,
  permit("purchases", "view"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
      const purchases = await loadPurchases(client, { tenantId });
      res.json({ success: true, data: purchases, purchases });
    } catch (error) {
      console.error("[purchases:list] error", error, error?.stack);
      res.status(500).json({ success: false, message: "Failed to load purchases", ...purchaseErrorPayload(error) });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/:id/reverse",
  protect,
  permit("purchases", "edit"),
  async (req, res) => {
    console.log("[purchase-reverse] route hit", { purchaseId: req.params.id });
    const client = await pool.connect();
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id);
      await ensurePurchaseCreateSchema(client);
      await client.query("BEGIN");
      const purchase = await loadPurchaseById(client, { tenantId, purchaseId: req.params.id, lock: true });
      if (!purchase) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Purchase not found" });
      }
      const status = String(purchase.status || "").toLowerCase();
      if (["cancelled", "canceled", "reversed"].includes(status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Purchase is already cancelled/reversed.", purchase });
      }
      const safety = purchase.safety || {};
      if (safety.hasReturns) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Cannot reverse this purchase because return records already exist. Reverse or settle those returns first.", safety, reasons: purchaseSafetyBlockReasons(safety) });
      }
      if (purchaseHasReceivedStock(purchase)) {
        const stockReversal = await getPurchaseStockReversalState(client, { tenantId, purchase, items: purchase.items || [] });
        if (!stockReversal.canReverseStock) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            success: false,
            message: STOCK_REVERSAL_BLOCK_MESSAGE,
            reason: "PURCHASE_STOCK_ALREADY_MOVED",
            safety: { ...safety, ...stockReversal, canDeleteWithStockReversal: false },
          });
        }
      }
      const reason = req.body?.reason || "Cancel / Reverse Purchase";
      const reversal = purchaseHasReceivedStock(purchase)
        ? await reverseReceivedPurchase(client, {
            tenantId,
            purchase,
            userId: req.user?.id || null,
            reason,
          })
        : { movementCount: 0 };
      await reversePurchasePaymentMovements(client, {
        tenantId,
        purchase,
        userId: req.user?.id || null,
        reason,
      });
      if (!purchaseHasReceivedStock(purchase)) {
        await markPurchaseCancelledOrDeleted(client, {
          tenantId,
          purchaseId: purchase.id,
          userId: req.user?.id || null,
          reason,
          status: "reversed",
          reversed: true,
        });
      }
      await appendPurchaseTimelineEvents(client, {
        purchaseId: purchase.id,
        tenantId,
        events: [{
          type: "purchase_reversed",
          label: "Purchase reversed",
          reason,
          movement_count: reversal.movementCount,
          created_by: req.user?.id || null,
          created_at: new Date().toISOString(),
        }],
      });
      const updated = await loadPurchaseById(client, { tenantId, purchaseId: purchase.id });
      await client.query("COMMIT");
      res.json({ success: true, message: "Purchase reversed. Stock/accounting history was preserved with reversal entries.", data: updated, purchase: updated, reversal });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[purchases:reverse] error", error, error?.stack);
      res.status(error.status || 500).json({ success: false, message: error.message || "Failed to reverse purchase", ...purchaseErrorPayload(error) });
    } finally {
      client.release();
    }
  }
);

router.get(
  "/:id",
  protect,
  permit("purchases", "view"),
  async (req, res) => {
    const client = await pool.connect();
    const purchaseId = req.params.id;
    const tenantId = isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id);
    const branchId = getBranchIdFromRequest(req);
    try {
      const purchase = await loadPurchaseById(client, { tenantId, branchId, purchaseId });
      if (!purchase) {
        const accessState = await getPurchaseAccessState(client, { tenantId, branchId, purchaseId });
        if (accessState === "denied") {
          return res.status(403).json({ success: false, message: "Access denied for this purchase" });
        }
        return res.status(404).json({ success: false, message: "Purchase not found" });
      }
      res.json({ success: true, data: purchase, purchase, items: purchase.items });
    } catch (err) {
      console.error("[purchase-details] failed", {
        purchaseId,
        tenantId,
        branchId,
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({ success: false, message: "Failed to load purchase details", ...purchaseErrorPayload(err) });
    } finally {
      client.release();
    }
  }
);

router.patch(
  "/:id",
  protect,
  permit("purchases", "edit"),
  async (req, res) => {
    const client = await pool.connect();
    const purchaseId = req.params.id;
    const rawIncomingItems = Array.isArray(req.body?.items) ? req.body.items : [];
    let incomingItems = [];
    let deltas = [];
    let step = "start";
    let transactionStarted = false;
    startTimer("[purchase-edit] total");
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id);
      const editsItems = Array.isArray(req.body?.items);
      assertPurchaseItemPricingPayload(rawIncomingItems);
      incomingItems = rawIncomingItems.map(normalizePurchaseItem);

      startTimer("[purchase-edit] validate-products");
      step = "validate-products";
      if (editsItems) {
        await validatePurchaseEditProducts(client, { tenantId, items: incomingItems });
      }
      endTimer("[purchase-edit] validate-products");

      await client.query("BEGIN");
      transactionStarted = true;
      await client.query("SET LOCAL statement_timeout = '30000ms'");

      startTimer("[purchase-edit] load-old-lines");
      step = "load-old-lines";
      const purchase = await loadPurchaseForEdit(client, { tenantId, purchaseId });
      endTimer("[purchase-edit] load-old-lines");
      if (!purchase) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ success: false, message: "Purchase not found" });
      }

      let receivedEditEvents = [];
      if (editsItems && (purchase.stock_applied || isReceivedPurchaseStatus(purchase.status) || purchaseReceivedItemQuantity(purchase) > 0)) {
        const deltaPlan = buildReceivedPurchaseEditDeltas({ purchase, nextItems: incomingItems });
        deltas = deltaPlan.deltas;
        step = "stock-availability";
        startTimer("[purchase-edit] apply-deltas");
        step = "apply-deltas";
        receivedEditEvents = await applyReceivedPurchaseLineDeltas(client, {
          tenantId,
          purchase,
          nextItems: incomingItems,
          userId: req.user?.id || null,
        });
        endTimer("[purchase-edit] apply-deltas");
      }

      startTimer("[purchase-edit] rewrite-items");
      step = "rewrite-items";
      await updatePurchaseHeader(client, { tenantId, purchase, body: req.body || {} });
      const afterHeaderPurchase = await loadPurchaseForEdit(client, { tenantId, purchaseId });
      await replacePurchasePaymentMovement(client, {
        tenantId,
        beforePurchase: purchase,
        afterPurchase: afterHeaderPurchase,
        body: req.body || {},
        userId: req.user?.id || null,
      });
      if (receivedEditEvents.length) {
        await appendPurchaseTimelineEvents(client, { purchaseId: purchase.id, tenantId, events: receivedEditEvents });
      }
      endTimer("[purchase-edit] rewrite-items");

      if (!receivedEditEvents.length) {
        startTimer("[purchase-edit] accounting");
        step = "accounting";
        endTimer("[purchase-edit] accounting");
      }

      const updated = await loadPurchaseForEdit(client, { tenantId, purchaseId });
      startTimer("[purchase-edit] commit");
      step = "commit";
      await client.query("COMMIT");
      transactionStarted = false;
      endTimer("[purchase-edit] commit");
      endTimer("[purchase-edit] total");
      res.json({ success: true, message: "Purchase updated", data: updated, purchase: updated, items: updated.items });
    } catch (error) {
      if (/timeout|canceling statement|read timeout/i.test(String(error.message || ""))) {
        purchaseEditTimeoutLog({ purchaseId, incomingItems, deltas, step, err: error });
      }
      if (transactionStarted) await client.query("ROLLBACK").catch(() => {});
      ["[purchase-edit] validate-products", "[purchase-edit] load-old-lines", "[purchase-edit] stock-availability", "[purchase-edit] apply-deltas", "[purchase-edit] rewrite-items", "[purchase-edit] accounting", "[purchase-edit] commit", "[purchase-edit] total"].forEach(endTimer);
      console.error("[purchases:update] error", error, error?.stack);
      const attemptedLineChanges = Array.isArray(req.body?.items);
      const invalidProductOrVariant = /variant not found|product not found/i.test(String(error.message || ""));
      const status = error.status || (attemptedLineChanges && invalidProductOrVariant ? 409 : 500);
      if (status === 409) {
        logPurchaseEdit409({
          purchaseId,
          reason: error.purchaseEdit409Reason || (invalidProductOrVariant ? "invalid_product_or_variant" : "purchase_edit_conflict"),
          status,
          hasReceivedStock: true,
          attemptedLineChanges,
        });
      }
      res.status(status).json({ success: false, message: status === 409 ? error.message : "Failed to update purchase", ...purchaseErrorPayload(error) });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/:id/receive",
  protect,
  permit("purchases", "edit"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id);
      await ensurePurchaseCreateSchema(client);
      await client.query("BEGIN");
      await ensurePurchaseCreateSchema(client);
      const purchase = await loadPurchaseById(client, { tenantId, purchaseId: req.params.id, lock: true });
      if (!purchase) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Purchase not found" });
      }
      const safety = purchase.safety || {};
      if (safety.hasStockMovements || purchase.stock_applied) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Stock has already been received for this purchase.", safety });
      }

      const warehouseId = await ensureDefaultWarehouseForPurchase(client, tenantId, purchase.warehouse_id);
      for (const item of purchase.items || []) {
        const quantity = Number(item.quantity || item.qty || 0);
        if (quantity <= 0) continue;
        const unitCost = Number(item.unit_cost ?? item.cost_price ?? 0) || 0;
        const itemTotal = Number(item.subtotal ?? item.total ?? quantity * unitCost) || 0;
        if (item.variant_id) {
          await adjustVariantStock(client, {
            tenantId,
            variantId: item.variant_id,
            quantityChange: quantity,
            movementType: "PURCHASE_IN",
            referenceType: "purchase",
            referenceId: purchase.id,
            warehouseId,
            unitCost,
            totalCost: itemTotal,
            reason: "Purchase receiving",
            notes: `Purchase received SKU ${item.sku || item.variant_id}`,
            createdBy: req.user?.id || null,
          });
          await upsertWarehouseVariantStock(client, { tenantId, warehouseId, variantId: item.variant_id, quantity });
          await updateProductVariantAfterPurchase(client, {
            tenantId,
            productId: item.product_id,
            variantId: item.variant_id,
            supplierId: purchase.supplier_id,
            unitCost,
            quantity,
            sellingPrice: item.selling_price,
            salePrice: item.sale_price,
            articleCode: item.article_code,
            invoiceId: purchase.id,
            lineId: item.id || item.purchase_item_id || null,
            updateSource: "received_adjustment",
          });
        } else if (item.product_id) {
          await updateProductFallbackStock(client, {
            tenantId,
            productId: item.product_id,
            quantity,
            unitCost,
            sellingPrice: item.selling_price,
            salePrice: item.sale_price,
            articleCode: item.article_code,
            invoiceId: purchase.id,
            lineId: item.id || item.purchase_item_id || null,
            updateSource: "received_adjustment",
          });
        }
      }

      await markPurchaseStockApplied(client, purchase.id);
      await client.query(
        `
        UPDATE purchases
        SET status = 'fully_received',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND (tenant_id = $2 OR tenant_id IS NULL)
        `,
        [purchase.id, tenantId]
      );
      const updated = await loadPurchaseById(client, { tenantId, purchaseId: purchase.id });
      await client.query("COMMIT");
      res.json({ success: true, message: "Stock received", data: updated, purchase: updated, items: updated.items });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[purchases:receive] error", error, error?.stack);
      res.status(500).json({ success: false, message: "Failed to receive stock", ...purchaseErrorPayload(error) });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/:id/duplicate",
  protect,
  permit("purchases", "create"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id);
      await ensurePurchaseCreateSchema(client);
      await client.query("BEGIN");
      const purchase = await loadPurchaseById(client, { tenantId, purchaseId: req.params.id, lock: true });
      if (!purchase) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Purchase not found" });
      }
      const draft = await insertPurchaseHeader(client, {
        tenantId,
        supplierId: purchase.supplier_id,
        warehouseId: purchase.warehouse_id,
        status: "draft",
        paymentStatus: "unpaid",
        supplierPaymentStatus: "unpaid",
        stockApplied: false,
        subtotal: purchase.subtotal,
        tax: purchase.tax_amount ?? purchase.tax ?? 0,
        discount: purchase.discount_amount ?? purchase.discount ?? 0,
        total: purchase.total,
        paidAmount: 0,
        supplierPaidAmount: 0,
        notes: `Duplicated from ${purchase.purchase_number || purchase.invoice_number || purchase.id}${purchase.notes ? `\n${purchase.notes}` : ""}`,
        createdBy: req.user?.id || null,
        metadata: { source: "duplicate_purchase", duplicated_from: purchase.id },
      });
      const numberedDraft = await assignGeneratedPurchaseCode(client, draft);
      Object.assign(draft, numberedDraft);
      for (const item of purchase.items || []) {
        await insertPurchaseItem(client, {
          tenantId,
          purchaseId: draft.id,
          item: {
            ...item,
            quantity: Number(item.quantity || 0),
            unit_cost: Number(item.unit_cost ?? item.cost_price ?? 0) || 0,
            cost_price: Number(item.unit_cost ?? item.cost_price ?? 0) || 0,
            total: Number(item.quantity || 0) * (Number(item.unit_cost ?? item.cost_price ?? 0) || 0),
          },
          metadata: { ...(item.metadata || {}), duplicated_from_item_id: item.id },
        });
      }
      const created = await loadPurchaseById(client, { tenantId, purchaseId: draft.id });
      await client.query("COMMIT");
      res.status(201).json({ success: true, message: "Purchase duplicated", data: created, purchase: created, items: created.items });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[purchases:duplicate] error", error, error?.stack);
      res.status(500).json({ success: false, message: "Failed to duplicate purchase", ...purchaseErrorPayload(error) });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/:id/adjustments",
  protect,
  permit("purchases", "edit"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id);
      const adjustmentKey = String(req.get?.("Idempotency-Key") || req.body?.adjustment_key || req.body?.adjustmentKey || `adj-${Date.now()}`).slice(0, 120);
      const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
      await client.query("BEGIN");
      const purchase = await loadPurchaseById(client, { tenantId, purchaseId: req.params.id, lock: true });
      if (!purchase) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Purchase not found" });
      }

      const previousAdjustments = Array.isArray(purchase.metadata?.adjustments) ? purchase.metadata.adjustments : [];
      if (previousAdjustments.some((entry) => String(entry.adjustment_key || "") === adjustmentKey)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Adjustment has already been received for this purchase.", adjustment_key: adjustmentKey });
      }

      const items = mergePurchaseItems(requestedItems.map(normalizePurchaseItem));
      if (!items.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: "Adjustment items are required" });
      }
      const invalidItem = items.find((item) => !item.product_id || Number(item.quantity || 0) <= 0 || Number(item.unit_cost || 0) <= 0);
      if (invalidItem) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: "Each adjustment line must include product, quantity, and cost." });
      }

      const warehouseId = await ensureDefaultWarehouseForPurchase(client, tenantId, req.body?.warehouse_id ?? req.body?.warehouseId ?? purchase.warehouse_id);
      const insertedItems = [];
      const adjustmentTotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_cost || 0), 0);
      const adjustment = {
        adjustment_key: adjustmentKey,
        created_at: new Date().toISOString(),
        created_by: req.user?.id || null,
        warehouse_id: warehouseId,
        total: adjustmentTotal,
        notes: req.body?.notes || "",
        lines: items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          total: Number(item.quantity || 0) * Number(item.unit_cost || 0),
        })),
      };

      for (const item of items) {
        const quantity = Number(item.quantity || 0);
        const unitCost = Number(item.unit_cost || 0);
        const itemTotal = quantity * unitCost;
        const insertedItem = await insertPurchaseItem(client, {
          tenantId,
          purchaseId: purchase.id,
          item: {
            ...item,
            total: itemTotal,
            cost_price: unitCost,
            metadata: {
              ...(item.metadata || {}),
              source: "purchase_adjustment",
              adjustment_key: adjustmentKey,
              received_quantity: quantity,
            },
          },
          metadata: {
            source: "purchase_adjustment",
            adjustment_key: adjustmentKey,
            received_quantity: quantity,
          },
        });
        insertedItems.push(insertedItem);

        if (item.variant_id) {
          await adjustVariantStock(client, {
            tenantId,
            variantId: item.variant_id,
            quantityChange: quantity,
            movementType: "PURCHASE_IN",
            referenceType: "purchase_adjustment",
            referenceId: purchase.id,
            warehouseId,
            unitCost,
            totalCost: itemTotal,
            reason: "Purchase adjustment receiving",
            notes: `Purchase adjustment ${adjustmentKey}`,
            createdBy: req.user?.id || null,
          });
          await upsertWarehouseVariantStock(client, { tenantId, warehouseId, variantId: item.variant_id, quantity });
          await updateProductVariantAfterPurchase(client, {
            tenantId,
            productId: item.product_id,
            variantId: item.variant_id,
            supplierId: purchase.supplier_id,
            unitCost,
            quantity,
            sellingPrice: item.selling_price,
            salePrice: item.sale_price,
            invoiceId: purchase.id,
            lineId: insertedItem?.id || item.id || item.purchase_item_id || null,
            updateSource: "received_adjustment",
          });
        } else {
          await updateProductFallbackStock(client, {
            tenantId,
            productId: item.product_id,
            quantity,
            unitCost,
            sellingPrice: item.selling_price,
            salePrice: item.sale_price,
            invoiceId: purchase.id,
            lineId: insertedItem?.id || item.id || item.purchase_item_id || null,
            updateSource: "received_adjustment",
          });
        }
      }

      await client.query(
        `
        UPDATE purchases
        SET subtotal = COALESCE(subtotal, 0) + $1,
            total = COALESCE(total, 0) + $1,
            status = CASE WHEN COALESCE(status, '') IN ('draft', 'ordered') THEN 'partially_received' ELSE status END,
            stock_applied = TRUE,
            stock_applied_at = COALESCE(stock_applied_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
          AND (tenant_id = $3 OR tenant_id IS NULL)
        `,
        [adjustmentTotal, purchase.id, tenantId]
      );
      await appendPurchaseAdjustmentMetadata(client, { purchaseId: purchase.id, tenantId, adjustment });
      await updateSupplierBalanceForPurchase(client, { tenantId, supplierId: purchase.supplier_id, amount: adjustmentTotal });

      await client.query("SAVEPOINT purchase_adjustment_accounting");
      try {
        await postPurchaseEntry(client, {
          tenantId,
          referenceType: "purchase_adjustment",
          referenceId: purchase.id,
          description: `Purchase adjustment ${adjustmentKey}`,
          amount: adjustmentTotal,
          paymentType: req.body.payment_method || req.body.paymentMethod || "ap",
          createdBy: req.user?.id || null,
        });
        await client.query("RELEASE SAVEPOINT purchase_adjustment_accounting");
      } catch (accountingError) {
        await client.query("ROLLBACK TO SAVEPOINT purchase_adjustment_accounting").catch(() => {});
        console.error("[purchases:adjustment] accounting warning", accountingError, accountingError?.stack);
      }

      const updated = await loadPurchaseById(client, { tenantId, purchaseId: purchase.id });
      await client.query("COMMIT");
      res.status(201).json({
        success: true,
        message: "Purchase adjustment received",
        adjustment,
        data: updated,
        purchase: updated,
        items: updated.items,
        inserted_items: insertedItems,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[purchases:adjustment] error", error, error?.stack);
      res.status(500).json({ success: false, message: "Failed to create purchase adjustment", ...purchaseErrorPayload(error) });
    } finally {
      client.release();
    }
  }
);

router.post(
  "/:id/cancel",
  protect,
  permit("purchases", "edit"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id);
      await client.query("BEGIN");
      const purchase = await loadPurchaseById(client, { tenantId, purchaseId: req.params.id, lock: true });
      if (!purchase) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Purchase not found" });
      }
      const status = String(purchase.status || "").toLowerCase();
      if (["cancelled", "canceled", "reversed"].includes(status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Purchase is already cancelled/reversed.", purchase });
      }
      const safety = purchase.safety || {};
      if (safety.hasReturns) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Cannot cancel this purchase because return records already exist. Reverse or settle those returns first.", safety, reasons: purchaseSafetyBlockReasons(safety) });
      }
      const reason = req.body?.reason || "Purchase cancelled";
      const reversal = purchaseHasReceivedStock(purchase)
        ? await reverseReceivedPurchase(client, {
            tenantId,
            purchase,
            userId: req.user?.id || null,
            reason,
          })
        : { movementCount: 0 };
      await reversePurchasePaymentMovements(client, {
        tenantId,
        purchase,
        userId: req.user?.id || null,
        reason,
      });
      await markPurchaseCancelledOrDeleted(client, {
        tenantId,
        purchaseId: purchase.id,
        userId: req.user?.id || null,
        reason,
        status: "cancelled",
        reversed: purchaseHasReceivedStock(purchase),
      });
      await appendPurchaseTimelineEvents(client, {
        purchaseId: purchase.id,
        tenantId,
        events: [{
          type: "purchase_cancelled",
          label: purchaseHasReceivedStock(purchase) ? "Purchase cancelled and stock reversed" : "Purchase cancelled",
          reason,
          movement_count: reversal.movementCount,
          created_by: req.user?.id || null,
          created_at: new Date().toISOString(),
        }],
      });
      const updated = await loadPurchaseById(client, { tenantId, purchaseId: purchase.id });
      await client.query("COMMIT");
      res.json({ success: true, message: purchaseHasReceivedStock(purchase) ? "Purchase cancelled and received stock reversed." : "Purchase cancelled", data: updated, purchase: updated, reversal });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[purchases:cancel] error", error, error?.stack);
      res.status(500).json({ success: false, message: "Failed to cancel purchase", ...purchaseErrorPayload(error) });
    } finally {
      client.release();
    }
  }
);

router.delete(
  "/:id",
  protect,
  permit("purchases", "delete"),
  async (req, res) => {
    const client = await pool.connect();
    const purchaseId = req.params.id;
    const stepRef = { step: "start" };
    const deleteLogContext = {
      requestId: req.id,
      purchaseId,
      currentStep: "start",
    };
    withPurchaseDeleteQueryLogging(client, deleteLogContext);
    try {
      const tenantId = getTenantId(req, req.user?.tenant_id);
      console.log("[purchase:delete] start", {
        requestId: req.id,
        purchaseId,
        tenantId,
        userId: req.user?.id || null,
      });
      setPurchaseDeleteStep(stepRef, "schema and index verification");
      await timedPurchaseDeleteStep(deleteLogContext, "schema.purchaseCreate", () => ensurePurchaseCreateSchema(client));
      await timedPurchaseDeleteStep(deleteLogContext, "schema.accounting", () => ensureAccountingSchema());
      await timedPurchaseDeleteStep(deleteLogContext, "index verification", () => ensurePurchaseDeleteIndexes(client));
      setPurchaseDeleteStep(stepRef, "begin transaction");
      await timedPurchaseDeleteStep(deleteLogContext, "begin transaction", () => client.query("BEGIN"));
      setPurchaseDeleteStep(stepRef, "purchase_items lookup");
      const purchase = await timedPurchaseDeleteStep(deleteLogContext, "purchase_items lookup", () => loadPurchaseById(client, { tenantId, purchaseId, lock: true }));
      if (!purchase) {
        setPurchaseDeleteStep(stepRef, "transaction rollback");
        await timedPurchaseDeleteStep(deleteLogContext, "transaction rollback not found", () => client.query("ROLLBACK"));
        return res.status(404).json({ success: false, message: "Purchase not found" });
      }
      console.log("[purchase:delete] purchase loaded", {
        requestId: req.id,
        purchaseId,
        status: purchase.status,
        itemCount: Array.isArray(purchase.items) ? purchase.items.length : 0,
        safety: purchase.safety,
      });
      setPurchaseDeleteStep(stepRef, "load purchase items");
      const purchaseStatus = String(purchase.status || "").toLowerCase();
      const isDraftDeleteAllowed = ["draft", "pending", ""].includes(purchaseStatus);
      if (isDraftDeleteAllowed && purchase.safety?.canDelete) {
        setPurchaseDeleteStep(stepRef, "mark purchase archived");
        await timedPurchaseDeleteStep(deleteLogContext, "purchase_items delete", () => client.query("DELETE FROM purchase_items WHERE purchase_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)", [purchase.id, tenantId]));
        await timedPurchaseDeleteStep(deleteLogContext, "purchase delete", () => client.query("DELETE FROM purchases WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)", [purchase.id, tenantId]));
        setPurchaseDeleteStep(stepRef, "commit");
        await timedPurchaseDeleteStep(deleteLogContext, "commit", () => client.query("COMMIT"));
        return res.json({ success: true, message: "Purchase deleted" });
      }
      const reversal = await timedPurchaseDeleteStep(deleteLogContext, "reverse purchase and archive", () => reversePurchaseAndArchive(client, {
        tenantId,
        purchase,
        userId: req.user?.id || null,
        reason: req.body?.reason || "delete_requested",
        stepRef,
      }));
      setPurchaseDeleteStep(stepRef, "commit");
      await timedPurchaseDeleteStep(deleteLogContext, "commit", () => client.query("COMMIT"));
      res.json({ success: true, message: reversal.movementCount > 0 ? "Purchase deleted and received stock reversed." : "Purchase deleted", reversal, archived: true });
    } catch (err) {
      setPurchaseDeleteStep(stepRef, "transaction rollback");
      await timedPurchaseDeleteStep(deleteLogContext, "transaction rollback error path", () => client.query("ROLLBACK")).catch(() => {});
      logPurchaseDeleteReverseFailed({ purchaseId, step: stepRef.step, err });
      res.status(err.status || 500).json({
        success: false,
        message: err.status && err.status < 500 ? err.message : "Failed to delete and reverse purchase.",
        detail: err.message,
        step: stepRef.step,
        reason: err.reason,
        safety: err.safety,
        ...purchaseErrorPayload(err),
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
    const routeStartedAt = Date.now();
    const requestId = req.id;
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const requestedSupplierId = req.body?.supplier_id ?? req.body?.supplierId ?? null;
    const requestedWarehouseId = req.body?.warehouse_id ?? req.body?.warehouseId ?? null;
    const idempotencyKey = normalizeIdempotencyKey(req);
    const purchaseSaveIdForLogs = idempotencyKey || req.body?.purchase_save_id || req.body?.purchaseSaveId || req.body?.client_request_id || req.body?.clientRequestId || null;
    const logContext = { requestId, currentStep: "purchase.create", purchaseSaveId: purchaseSaveIdForLogs };
    let client;
    let transactionStarted = false;

    console.log("[purchase:create] start", {
      requestId,
      userId: req.user?.id || null,
      tenantId: req.user?.tenant_id || null,
      supplier_id: requestedSupplierId,
      warehouse_id: requestedWarehouseId,
      idempotencyKey: idempotencyKey || null,
      purchase_save_id: purchaseSaveIdForLogs,
      itemCount: rawItems.length,
      durationMs: Date.now() - routeStartedAt,
    });
    console.log("[purchase:create] payload summary", {
      requestId,
      purchase_number: req.body?.purchase_number || req.body?.purchaseNumber || null,
      status: req.body?.status || null,
      payment_status: req.body?.payment_status || req.body?.paymentStatus || null,
      supplier_payment_status: req.body?.supplier_payment_status || req.body?.supplierPaymentStatus || null,
      paid_amount: req.body?.paid_amount ?? req.body?.paidAmount ?? null,
      supplier_paid_amount: req.body?.supplier_paid_amount ?? req.body?.supplierPaidAmount ?? null,
      itemCount: rawItems.length,
      firstItems: rawItems.slice(0, 5).map((item) => ({
        product_id: item.product_id ?? item.productId ?? null,
        variant_id: item.variant_id ?? item.variantId ?? null,
        quantity: item.quantity ?? item.qty ?? null,
        unit_cost: item.unit_cost ?? item.unitCost ?? item.cost_price ?? item.purchase_price ?? item.purchase_cost ?? null,
        selling_price: item.selling_price ?? item.price ?? null,
        sale_price: item.sale_price ?? null,
        wholesale_price: item.wholesale_price ?? item.wholesalePrice ?? null,
      })),
    });

    try {
      logContext.currentStep = "connect";
      client = await pool.connect();
      withPurchaseQueryLogging(client, logContext);

      const runStep = async (step, action) => {
        const previousStep = logContext.currentStep;
        logContext.currentStep = step;
        const startedAt = Date.now();
        console.log("[purchase:create] step start", { requestId, purchase_save_id: purchaseSaveIdForLogs, step, durationMs: Date.now() - routeStartedAt });
        try {
          const result = await action();
          console.log("[purchase:create] step end", { requestId, purchase_save_id: purchaseSaveIdForLogs, step, durationMs: Date.now() - startedAt, totalDurationMs: Date.now() - routeStartedAt });
          return result;
        } catch (error) {
          error.purchaseStep = error.purchaseStep || step;
          console.error("[purchase:create] step error", {
            requestId,
            purchase_save_id: purchaseSaveIdForLogs,
            step,
            durationMs: Date.now() - startedAt,
            totalDurationMs: Date.now() - routeStartedAt,
            message: error.message,
            code: error.code,
            stack: error.stack,
          });
          throw error;
        } finally {
          logContext.currentStep = previousStep;
        }
      };

      await runStep("transaction.begin", async () => {
        await client.query("BEGIN");
        transactionStarted = true;
      });
      await runStep("schema.purchaseCreate", () => ensurePurchaseCreateSchema(client));
      await runStep("schema.smartReorder", () => ensureSmartReorderSchema(client));
      await runStep("schema.indexVerification", () => ensurePurchaseCreateIndexes(client));

      const tenantId = getTenantId(req, req.user?.tenant_id);
      if (idempotencyKey) {
        await runStep("idempotency.lock", () => client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`purchase:${tenantId}:${idempotencyKey}`]));
        const existingPurchase = await runStep("idempotency.lookup", () => findExistingPurchaseByIdempotencyKey(client, { tenantId, idempotencyKey }));
        if (existingPurchase) {
          await runStep("transaction.commit.idempotent", () => client.query("COMMIT"));
          transactionStarted = false;
          console.warn("[purchase:create] duplicate idempotency key reused", {
            requestId,
            idempotencyKey,
            purchaseId: existingPurchase.id,
            stockApplied: existingPurchase.stock_applied,
          });
          return res.status(200).json({
            success: true,
            duplicate: true,
            idempotent: true,
            message: "Purchase request already processed",
            purchase: existingPurchase,
            items: [],
          });
        }
      }

      const { normalizedItems, items } = await runStep("validation", async () => {
        const normalized = rawItems.map(normalizePurchaseItem);
        return { normalizedItems: normalized, items: mergePurchaseItems(normalized) };
      });
      console.log("[purchase:create] normalized item summary", {
        requestId,
        itemCount: items.length,
        rawItemCount: normalizedItems.length,
        mergedDuplicateCount: Math.max(0, normalizedItems.length - items.length),
        receivedOnCreate: isReceivedPurchaseStatus(normalizeCreatePurchaseStatus(req.body?.status)),
        firstItems: items.slice(0, 5).map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          selling_price: item.selling_price,
          sale_price: item.sale_price,
        })),
      });

      if (!items.length) {
        await runStep("transaction.rollback.validation.noItems", () => client.query("ROLLBACK"));
        transactionStarted = false;
        return res.status(400).json({
          success: false,
          message: "Purchase items are required",
          error: "VALIDATION_ERROR",
          details: "Send at least one item in items[].",
        });
      }

      const invalidItem = items.find((item) => !item.product_id || item.quantity <= 0);
      if (invalidItem) {
        await runStep("transaction.rollback.validation.invalidItem", () => client.query("ROLLBACK"));
        transactionStarted = false;
        return res.status(400).json({
          success: false,
          message: "Invalid purchase item",
          error: "VALIDATION_ERROR",
          details: "Each item must include product_id and quantity greater than zero.",
        });
      }

      const invalidCostItem = items.find((item) => !item.cost_is_valid);
      if (invalidCostItem) {
        await runStep("transaction.rollback.validation.invalidCost", () => client.query("ROLLBACK"));
        transactionStarted = false;
        return res.status(400).json({
          success: false,
          message: "Purchase item cost is required",
          error: "VALIDATION_ERROR",
          details: "Each item must include unit_cost, cost_price, purchase_price, purchase_cost, or price greater than zero.",
        });
      }

      const supplierId = await runStep("resolve.supplier", () => ensureDefaultSupplierForPurchase(client, tenantId, requestedSupplierId));
      const warehouseId = await runStep("resolve.warehouse", () => ensureDefaultWarehouseForPurchase(client, tenantId, requestedWarehouseId));
      const status = normalizeCreatePurchaseStatus(req.body?.status);
      const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);
      const discount = Number(req.body?.discount ?? req.body?.discount_amount ?? 0) || 0;
      const tax = Number(req.body?.tax ?? req.body?.tax_amount ?? 0) || 0;
      const total = Number(req.body?.total ?? req.body?.net_total ?? req.body?.grand_total ?? req.body?.total_amount ?? Math.max(0, subtotal + tax - discount)) || 0;
      const paidAmount = Math.min(
        total,
        Math.max(0, Number(req.body?.paid_amount ?? req.body?.paidAmount ?? req.body?.supplier_paid_amount ?? req.body?.supplierPaidAmount ?? 0) || 0)
      );
      const remainingAmount = Math.max(0, total - paidAmount);
      const requestedPaymentStatus = req.body?.payment_status ?? req.body?.paymentStatus;
      const paymentStatus = normalizePaymentStatus(
        requestedPaymentStatus || (paidAmount <= 0 ? "unpaid" : remainingAmount > 0 ? "partially_paid" : "paid")
      );
      const supplierPaymentStatus = normalizeSupplierPaymentStatus(req.body?.supplier_payment_status ?? req.body?.supplierPaymentStatus ?? paymentStatus);
      const paymentMethod = req.body?.payment_method || req.body?.paymentMethod || (paidAmount > 0 ? "bank" : "ap");
      const paymentAccountId = req.body?.payment_account_id || req.body?.paymentAccountId || req.body?.money_account_id || req.body?.moneyAccountId || null;
      console.log("[purchase:create] resolved refs", {
        requestId,
        tenantId,
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        status,
        paymentStatus,
        supplierPaymentStatus,
        subtotal,
        tax,
        discount,
        total,
      });
      const purchase = await runStep("insert.purchaseHeader", () => insertPurchaseHeader(client, {
        tenantId,
        supplierId,
        warehouseId,
        status,
        paymentStatus,
        supplierPaymentStatus,
        clientRequestId: idempotencyKey || req.body?.client_request_id || req.body?.clientRequestId || null,
        purchaseSaveId: idempotencyKey || req.body?.purchase_save_id || req.body?.purchaseSaveId || null,
        stockApplied: false,
        subtotal,
        tax,
        discount,
        total,
        paidAmount,
        supplierPaidAmount: paidAmount,
        remainingAmount,
        paymentAccountId,
        paymentMethod,
        notes: req.body?.notes || "",
        createdBy: req.user?.id || null,
        metadata: {
          ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
          source: "purchase_order",
          client_request_id: idempotencyKey || null,
          purchase_save_id: idempotencyKey || null,
          received_on_create: isReceivedPurchaseStatus(status),
          stock_applied: false,
          supplier_payment_status: supplierPaymentStatus,
          supplier_paid_amount: paidAmount,
          remaining_amount: remainingAmount,
          payment_account_id: paymentAccountId,
          payment_method: paymentMethod,
        },
      }));
      const numberedPurchase = await runStep("purchase.assignCode", () => assignGeneratedPurchaseCode(client, purchase));
      Object.assign(purchase, numberedPurchase);

      const shouldApplyStock = isReceivedPurchaseStatus(status) && purchase.stock_applied !== true;
      console.log("[purchase:create] stock apply guard", {
        requestId,
        purchaseId: purchase.id,
        status,
        shouldApplyStock,
        stockApplied: purchase.stock_applied === true,
        itemCount: items.length,
      });

      const insertedItems = await runStep("insert.purchase_items", () => insertPurchaseItemsBulk(client, { tenantId, purchaseId: purchase.id, items }));
      const itemsWithInsertedIds = items.map((item, index) => {
        const insertedItem = insertedItems[index] || null;
        return insertedItem?.id ? { ...item, id: insertedItem.id, purchase_item_id: insertedItem.id } : item;
      });

      if (shouldApplyStock) {
        await runStep("stock update", () => batchApplyVariantPurchaseStock(client, {
          tenantId,
          warehouseId,
          purchaseId: purchase.id,
          items: itemsWithInsertedIds,
          userId: req.user?.id || null,
        }));
      }

      await runStep("variant lookup/create/update", () => batchUpdateVariantPricingAfterPurchase(client, {
        tenantId,
        supplierId,
        items: itemsWithInsertedIds,
        shouldApplyStock,
      }));

      const simpleItems = itemsWithInsertedIds.filter((item) => !item.variant_id && item.product_id);
      if (simpleItems.length) {
        await runStep("simple product fallback update", async () => {
          for (const item of simpleItems) {
            await updateProductFallbackStock(client, {
              tenantId,
              productId: item.product_id,
              quantity: shouldApplyStock ? item.quantity : 0,
              unitCost: item.unit_cost,
              sellingPrice: item.selling_price,
              salePrice: item.sale_price,
              articleCode: item.article_code,
              invoiceId: purchase.id,
              lineId: item.id || item.purchase_item_id || null,
              updateSource: "create_purchase",
            });
          }
        });
      }

      if (shouldApplyStock) {
        const updatedPurchase = await runStep("purchase.markStockApplied", () => markPurchaseStockApplied(client, purchase.id));
        if (updatedPurchase) Object.assign(purchase, updatedPurchase);
        console.log("[purchase:create] stock applied flag set", {
          requestId,
          purchaseId: purchase.id,
          stockApplied: purchase.stock_applied,
          stockAppliedAt: purchase.stock_applied_at,
        });
      }

      await runStep("accounting.purchaseEntry", async () => {
        await client.query("SAVEPOINT purchase_accounting_entry");
        try {
          try {
            await postPurchaseEntryFast(client, {
              tenantId,
              referenceType: "purchase",
              referenceId: purchase.id,
              description: `Purchase receipt #${purchase.id}`,
              amount: total,
              paymentType: paidAmount >= total && paymentMethod === "cash" ? "cash" : "ap",
              createdBy: req.user?.id || null,
            });
          } catch (fastAccountingError) {
            if (fastAccountingError?.code !== "ACCOUNTING_FAST_PATH_UNAVAILABLE") throw fastAccountingError;
            await client.query("ROLLBACK TO SAVEPOINT purchase_accounting_entry");
            await client.query("SAVEPOINT purchase_accounting_entry");
            console.warn("[purchase:create] accounting fast path unavailable, falling back", {
              requestId,
              purchase_save_id: purchaseSaveIdForLogs,
              purchaseId: purchase.id,
              message: fastAccountingError.message,
            });
            await postPurchaseEntry(client, {
              tenantId,
              referenceType: "purchase",
              referenceId: purchase.id,
              description: `Purchase receipt #${purchase.id}`,
              amount: total,
              paymentType: paidAmount >= total && paymentMethod === "cash" ? "cash" : "ap",
              createdBy: req.user?.id || null,
            });
          }
          await client.query("RELEASE SAVEPOINT purchase_accounting_entry");
        } catch (accountingError) {
          await client.query("ROLLBACK TO SAVEPOINT purchase_accounting_entry").catch(() => {});
          console.error("[purchase:create] accounting warning:", accountingError, accountingError.stack);
        }
      });

      await runStep("supplier balance/accounting update", async () => {
        console.log("[purchase:create] supplier balance/accounting update summary", {
          requestId,
          purchase_save_id: purchaseSaveIdForLogs,
          purchaseId: purchase.id,
          supplierId,
          total,
          paidAmount,
          remainingAmount,
        });
      });

      await runStep("financialAccount.purchasePayment", async () => {
        if (paidAmount <= 0) return;
        await recordFinancialAccountActivity(client, {
          tenantId,
          financialAccountId: req.body.financial_account_id || req.body.financialAccountId || null,
          moneyAccountId: paymentAccountId,
          paymentMethod,
          entryType: "purchase",
          direction: -1,
          sourceType: "purchase",
          sourceId: purchase.id,
          amount: paidAmount,
          notes: `Purchase #${purchase.purchase_number || purchase.id}`,
          createdBy: req.user?.id || null,
        });
      });

      await runStep("transaction.commit", () => client.query("COMMIT"));
      transactionStarted = false;
      console.log("[purchase:create] end", {
        requestId,
        purchase_save_id: purchaseSaveIdForLogs,
        durationMs: Date.now() - routeStartedAt,
        purchaseId: purchase.id,
        itemCount: items.length,
      });

      res.status(201).json({
        success: true,
        message: "Purchase Created Successfully",
        purchase,
        items,
      });
      console.log("[purchase:create] response sent", {
        requestId,
        purchase_save_id: purchaseSaveIdForLogs,
        purchaseId: purchase.id,
        durationMs: Date.now() - routeStartedAt,
      });
    } catch (error) {
      if (client && transactionStarted) {
        logContext.currentStep = "transaction.rollback.error";
        console.log("[purchase:create] rollback start", { requestId, failedStep: error.purchaseStep });
        await client.query("ROLLBACK").catch((rollbackError) => {
          console.error("[purchase:create] rollback error", {
            requestId,
            message: rollbackError.message,
            code: rollbackError.code,
            stack: rollbackError.stack,
          });
        });
        transactionStarted = false;
        console.log("[purchase:create] rollback end", { requestId });
      }
      console.error("[purchase-create-failed]", {
        message: error.message,
        detail: error.detail,
        code: error.code,
        payloadSample: req.body?.items?.slice?.(0, 2),
      });
      console.error("[purchase:create] error:", error, error?.stack);
      res.status(500).json({
        success: false,
        message: "Failed To Create Purchase",
        ...purchaseErrorPayload(error),
      });
    } finally {
      if (client) {
        console.log("[purchase:create] client release", { requestId, durationMs: Date.now() - routeStartedAt });
        client.release();
      }
    }
  }
);

export default router;
