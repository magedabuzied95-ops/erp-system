import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SUCCESS_PURCHASE_STATUSES = new Set([
  "approved",
  "completed",
  "confirmed",
  "fully_received",
  "partially_received",
  "posted",
  "received",
  "saved_received",
  "success",
]);

const EXCLUDED_PURCHASE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "deleted",
  "draft",
  "reversed",
  "void",
  "voided",
]);

const TENANT_ID = 1;
const MAX_PREVIEW_ROWS = 50;

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();
const isPresent = (value) => value !== null && value !== undefined && value !== "";
const toNumber = (value) => {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isEligiblePurchase = (purchase = {}) => {
  const status = normalizeStatus(purchase.status);
  if (!SUCCESS_PURCHASE_STATUSES.has(status) || EXCLUDED_PURCHASE_STATUSES.has(status)) return false;
  if (isPresent(purchase.deleted_at) || isPresent(purchase.reversed_at)) return false;
  const metadata = purchase.metadata && typeof purchase.metadata === "object" ? purchase.metadata : {};
  if (metadata.reversed === true || metadata.cancelled === true || metadata.canceled === true) return false;
  if (isPresent(metadata.reversed_at) || isPresent(metadata.deleted_at) || isPresent(metadata.cancelled_at) || isPresent(metadata.canceled_at)) return false;
  return true;
};

export const createBackfillPlan = ({ tenantId = TENANT_ID, purchases = [], items = [], products = [], variants = [] } = {}) => {
  const eligiblePurchaseIds = new Set(
    purchases
      .filter((purchase) => Number(purchase.tenant_id) === Number(tenantId))
      .filter(isEligiblePurchase)
      .map((purchase) => String(purchase.id))
  );
  const productById = new Map(products.filter((product) => Number(product.tenant_id) === Number(tenantId)).map((product) => [String(product.id), product]));
  const variantById = new Map(variants.filter((variant) => Number(variant.tenant_id) === Number(tenantId)).map((variant) => [String(variant.id), variant]));
  const productIds = new Set();
  const variantIds = new Set();
  const missingProducts = new Set();
  const missingVariants = new Set();
  let skippedItems = 0;

  const eligibleItems = items.filter((item) => Number(item.tenant_id) === Number(tenantId) && eligiblePurchaseIds.has(String(item.purchase_id)));

  for (const item of eligibleItems) {
    if (item.variant_id) {
      const variantId = String(item.variant_id);
      if (variantById.has(variantId)) variantIds.add(variantId);
      else missingVariants.add(variantId);
      continue;
    }
    if (item.product_id) {
      const productId = String(item.product_id);
      if (productById.has(productId)) productIds.add(productId);
      else missingProducts.add(productId);
      continue;
    }
    skippedItems += 1;
  }

  const targetProducts = [...productIds].map((id) => productById.get(id));
  const targetVariants = [...variantIds].map((id) => variantById.get(id));
  const alreadyZero =
    targetProducts.filter((product) => toNumber(product.default_purchase_qty) === 0).length +
    targetVariants.filter((variant) => toNumber(variant.default_purchase_qty) === 0).length;

  return {
    matching_purchase_count: eligiblePurchaseIds.size,
    purchase_item_count: eligibleItems.length,
    product_count: targetProducts.length,
    variant_count: targetVariants.length,
    targetProducts,
    targetVariants,
    already_zero: alreadyZero,
    skipped_items: skippedItems,
    missing_products: missingProducts.size,
    missing_variants: missingVariants.size,
    values_to_change: [
      ...targetProducts
        .filter((product) => toNumber(product.default_purchase_qty) !== 0)
        .map((product) => ({ target_type: "product", id: product.id, current_default_purchase_qty: toNumber(product.default_purchase_qty) })),
      ...targetVariants
        .filter((variant) => toNumber(variant.default_purchase_qty) !== 0)
        .map((variant) => ({ target_type: "variant", id: variant.id, current_default_purchase_qty: toNumber(variant.default_purchase_qty) })),
    ],
  };
};

export const applyBackfillPlanToMemory = (plan = {}) => {
  let updatedProducts = 0;
  let updatedVariants = 0;
  for (const product of plan.targetProducts || []) {
    if (toNumber(product.default_purchase_qty) === 0) continue;
    product.default_purchase_qty = 0;
    updatedProducts += 1;
  }
  for (const variant of plan.targetVariants || []) {
    if (toNumber(variant.default_purchase_qty) === 0) continue;
    variant.default_purchase_qty = 0;
    updatedVariants += 1;
  }
  return { updated_products: updatedProducts, updated_variants: updatedVariants };
};

const tableColumns = async (client, tableName) => {
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

const requireColumn = (columns, table, column) => {
  if (!columns.has(column)) throw new Error(`${table}.${column} is required for this backfill`);
};

const statusSqlList = () => [...SUCCESS_PURCHASE_STATUSES].map((status) => `'${status.replace(/'/g, "''")}'`).join(", ");

const eligiblePurchaseWhere = (purchaseColumns) => {
  const clauses = [`p.tenant_id = $1`, `LOWER(TRIM(COALESCE(p.status, ''))) IN (${statusSqlList()})`];
  if (purchaseColumns.has("deleted_at")) clauses.push("p.deleted_at IS NULL");
  if (purchaseColumns.has("reversed_at")) clauses.push("p.reversed_at IS NULL");
  if (purchaseColumns.has("metadata")) {
    clauses.push("COALESCE(p.metadata->>'reversed', 'false') NOT IN ('true', '1', 'yes')");
    clauses.push("COALESCE(p.metadata->>'cancelled', 'false') NOT IN ('true', '1', 'yes')");
    clauses.push("COALESCE(p.metadata->>'canceled', 'false') NOT IN ('true', '1', 'yes')");
    clauses.push("COALESCE(p.metadata->>'reversed_at', '') = ''");
    clauses.push("COALESCE(p.metadata->>'deleted_at', '') = ''");
    clauses.push("COALESCE(p.metadata->>'cancelled_at', '') = ''");
    clauses.push("COALESCE(p.metadata->>'canceled_at', '') = ''");
  }
  return clauses.join("\n      AND ");
};

const eligibleItemsCte = ({ purchaseColumns, itemColumns }) => {
  const itemClauses = [];
  if (itemColumns.has("tenant_id")) itemClauses.push("pi.tenant_id = $1");
  if (itemColumns.has("deleted_at")) itemClauses.push("pi.deleted_at IS NULL");
  const itemWhere = itemClauses.length ? `WHERE ${itemClauses.join(" AND ")}` : "";
  return `
    WITH eligible_purchases AS (
      SELECT p.id
      FROM purchases p
      WHERE ${eligiblePurchaseWhere(purchaseColumns)}
    ),
    eligible_items AS (
      SELECT pi.id, pi.product_id, pi.variant_id
      FROM purchase_items pi
      INNER JOIN eligible_purchases ep ON ep.id = pi.purchase_id
      ${itemWhere}
    )
  `;
};

const loadDatabaseReport = async (client, tenantId = TENANT_ID) => {
  const purchaseColumns = await tableColumns(client, "purchases");
  const itemColumns = await tableColumns(client, "purchase_items");
  const productColumns = await tableColumns(client, "products");
  const variantColumns = await tableColumns(client, "product_variants");
  requireColumn(purchaseColumns, "purchases", "tenant_id");
  requireColumn(purchaseColumns, "purchases", "status");
  requireColumn(itemColumns, "purchase_items", "purchase_id");
  requireColumn(itemColumns, "purchase_items", "product_id");
  requireColumn(itemColumns, "purchase_items", "variant_id");
  requireColumn(variantColumns, "product_variants", "default_purchase_qty");
  const productsHaveDefaultQty = productColumns.has("default_purchase_qty");
  const cte = eligibleItemsCte({ purchaseColumns, itemColumns });
  const productTenantClause = productColumns.has("tenant_id") ? "AND p.tenant_id = $1" : "";
  const variantTenantClause = variantColumns.has("tenant_id") ? "AND pv.tenant_id = $1" : "";

  const summaryResult = await client.query(`${cte} SELECT (SELECT COUNT(*)::int FROM eligible_purchases) AS matching_purchase_count, (SELECT COUNT(*)::int FROM eligible_items) AS purchase_item_count`, [tenantId]);
  const variantResult = await client.query(
    `
      ${cte}
      SELECT pv.id, pv.default_purchase_qty::numeric AS default_purchase_qty
      FROM product_variants pv
      INNER JOIN (SELECT DISTINCT variant_id FROM eligible_items WHERE variant_id IS NOT NULL) targets ON targets.variant_id = pv.id
      WHERE 1=1 ${variantTenantClause}
      ORDER BY pv.id
      `,
    [tenantId]
  );
  const productResult = productsHaveDefaultQty
    ? await client.query(
        `
          ${cte}
          SELECT p.id, p.default_purchase_qty::numeric AS default_purchase_qty
          FROM products p
          INNER JOIN (SELECT DISTINCT product_id FROM eligible_items WHERE variant_id IS NULL AND product_id IS NOT NULL) targets ON targets.product_id = p.id
          WHERE 1=1 ${productTenantClause}
          ORDER BY p.id
          `,
        [tenantId]
      )
    : { rows: [] };
  const missingVariantResult = await client.query(
    `
      ${cte}
      SELECT COUNT(DISTINCT ei.variant_id)::int AS count
      FROM eligible_items ei
      LEFT JOIN product_variants pv ON pv.id = ei.variant_id ${variantColumns.has("tenant_id") ? "AND pv.tenant_id = $1" : ""}
      WHERE ei.variant_id IS NOT NULL AND pv.id IS NULL
      `,
    [tenantId]
  );
  const missingProductResult = await client.query(
    `
      ${cte}
      SELECT COUNT(DISTINCT ei.product_id)::int AS count
      FROM eligible_items ei
      LEFT JOIN products p ON p.id = ei.product_id ${productColumns.has("tenant_id") ? "AND p.tenant_id = $1" : ""}
      WHERE ei.variant_id IS NULL AND ei.product_id IS NOT NULL AND p.id IS NULL
      `,
    [tenantId]
  );
  const skippedResult = await client.query(`${cte} SELECT COUNT(*)::int AS count FROM eligible_items WHERE variant_id IS NULL AND product_id IS NULL`, [tenantId]);

  const targetProducts = productResult.rows.map((row) => ({ target_type: "product", id: Number(row.id), current_default_purchase_qty: toNumber(row.default_purchase_qty) }));
  const targetVariants = variantResult.rows.map((row) => ({ target_type: "variant", id: Number(row.id), current_default_purchase_qty: toNumber(row.default_purchase_qty) }));
  const valuesToChange = [...targetProducts, ...targetVariants].filter((row) => row.current_default_purchase_qty !== 0);
  return {
    tenant_id: tenantId,
    matching_purchase_count: summaryResult.rows[0]?.matching_purchase_count || 0,
    purchase_item_count: summaryResult.rows[0]?.purchase_item_count || 0,
    product_count: targetProducts.length,
    variant_count: targetVariants.length,
    already_zero: targetProducts.length + targetVariants.length - valuesToChange.length,
    skipped_items: skippedResult.rows[0]?.count || 0,
    missing_products: missingProductResult.rows[0]?.count || 0,
    missing_variants: missingVariantResult.rows[0]?.count || 0,
    values_to_change: valuesToChange.slice(0, MAX_PREVIEW_ROWS),
    all_values_to_change: valuesToChange,
    products_have_default_purchase_qty: productsHaveDefaultQty,
  };
};

const ensureAuditTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS default_purchase_qty_backfill_audit (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL,
      tenant_id BIGINT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('product', 'variant')),
      target_id BIGINT NOT NULL,
      old_default_purchase_qty NUMERIC NOT NULL,
      new_default_purchase_qty NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_default_purchase_qty_backfill_audit_run
      ON default_purchase_qty_backfill_audit (run_id, target_type, target_id)
  `);
};

const rollbackSqlForRows = ({ runId, rows }) => {
  const lines = [
    `-- Rollback for default purchase quantity backfill run ${runId}`,
    "-- Execute with: node server/scripts/backfillConsumedDefaultPurchaseQty.js --rollback=<this-file>",
  ];
  for (const row of rows) {
    const table = row.target_type === "variant" ? "product_variants" : "products";
    lines.push(`UPDATE ${table} SET default_purchase_qty = ${Number(row.current_default_purchase_qty)} WHERE tenant_id = ${TENANT_ID} AND id = ${Number(row.id)};`);
  }
  return `${lines.join("\n")}\n`;
};

const saveRollbackFile = ({ runId, rows }) => {
  const backupDir = path.resolve(process.cwd(), "server", "backups", "default-purchase-qty");
  fs.mkdirSync(backupDir, { recursive: true });
  const rollbackPath = path.join(backupDir, `${runId}.rollback.sql`);
  fs.writeFileSync(rollbackPath, rollbackSqlForRows({ runId, rows }), "utf8");
  return rollbackPath;
};

const insertAuditRows = async (client, { runId, tenantId, rows }) => {
  if (!rows.length) return;
  const values = [];
  const tuples = rows.map((row) => {
    values.push(runId, tenantId, row.target_type, row.id, row.current_default_purchase_qty, 0);
    const base = values.length - 5;
    return `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });
  await client.query(
    `
    INSERT INTO default_purchase_qty_backfill_audit
      (run_id, tenant_id, target_type, target_id, old_default_purchase_qty, new_default_purchase_qty)
    VALUES ${tuples.join(", ")}
    `,
    values
  );
};

const applyBackfill = async (client, { tenantId = TENANT_ID }) => {
  await ensureAuditTable(client);
  const report = await loadDatabaseReport(client, tenantId);
  const runId = `default-purchase-qty-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const rollbackFile = saveRollbackFile({ runId, rows: report.all_values_to_change });
  await insertAuditRows(client, { runId, tenantId, rows: report.all_values_to_change });
  const variantIds = report.all_values_to_change.filter((row) => row.target_type === "variant").map((row) => row.id);
  const productIds = report.all_values_to_change.filter((row) => row.target_type === "product").map((row) => row.id);
  const updatedVariants = variantIds.length
    ? await client.query("UPDATE product_variants SET default_purchase_qty = 0, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = ANY($2::bigint[])", [tenantId, variantIds])
    : { rowCount: 0 };
  const updatedProducts = productIds.length
    ? await client.query("UPDATE products SET default_purchase_qty = 0, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = ANY($2::bigint[])", [tenantId, productIds])
    : { rowCount: 0 };
  return {
    ...report,
    mode: "apply",
    run_id: runId,
    rollback_file: rollbackFile,
    updated_products: updatedProducts.rowCount || 0,
    updated_variants: updatedVariants.rowCount || 0,
  };
};

const runRollbackFile = async (client, rollbackPath) => {
  const resolved = path.resolve(process.cwd(), rollbackPath);
  const sql = fs.readFileSync(resolved, "utf8");
  await client.query(sql);
  return { mode: "rollback", rollback_file: resolved };
};

const main = async () => {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run");
  const rollbackArg = process.argv.find((arg) => arg.startsWith("--rollback="));
  if ([apply, dryRun, Boolean(rollbackArg)].filter(Boolean).length !== 1) {
    throw new Error("Use exactly one mode: --dry-run, --apply, or --rollback=<file>");
  }
  const { default: db } = await import("../database/db.js");
  const client = await db.connect();
  try {
    if (dryRun) {
      const report = await loadDatabaseReport(client, TENANT_ID);
      const { all_values_to_change, ...publicReport } = report;
      console.log(JSON.stringify({ ...publicReport, mode: "dry-run", updated_products: 0, updated_variants: 0 }, null, 2));
      return;
    }
    await client.query("BEGIN");
    const result = rollbackArg
      ? await runRollbackFile(client, rollbackArg.slice("--rollback=".length))
      : await applyBackfill(client, { tenantId: TENANT_ID });
    await client.query("COMMIT");
    const { all_values_to_change, ...publicResult } = result;
    console.log(JSON.stringify(publicResult, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[default-purchase-qty-backfill] failed", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
