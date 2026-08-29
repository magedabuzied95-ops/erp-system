/**
 * Deep product purge - the engine behind the admin-only "مسح من الداتا بيز" action.
 *
 * Unlike `deleteProduct`, which archives the moment any history row exists, this
 * removes the product from the catalogue, from stock, from the storefront, from
 * the marketing pipeline and from the purchase invoices it appears on. The
 * sales record is deliberately the one thing that survives: `order_items` and
 * everything posted from them keep their rows and only lose the pointer, so
 * revenue and historic profit never move.
 *
 * `purchase_items` rows ARE deleted, so every purchase invoice the product
 * appeared on is recomputed with the app's own formula
 * (subtotal = Σ qty × unit_cost, total = subtotal + tax - discount) and the
 * before/after totals are written into `purchases.metadata.purged_products`.
 *
 * Anything referencing a product or variant that this module cannot classify
 * aborts the run rather than being guessed at - see UNCLASSIFIED below.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const UPLOAD_DIRS = [
  path.resolve(ROOT_DIR, "server/uploads/products"),
  path.resolve(ROOT_DIR, "uploads/products"),
];

/**
 * Rows here outlive the product: the sales record (invoice lines, returns,
 * posted cost overrides, commissions) and content published outside the ERP.
 * They are never deleted; the pointer is nulled after the line has been given a
 * standalone identity snapshot.
 */
export const DETACH_TABLES = new Set([
  "order_items",
  "return_items",
  "supplier_return_items",
  "accounting_order_item_cost_overrides",
  "employee_commissions",
  "sales_commission_lines",
  // Content that was really published to a platform, and the customer
  // conversations and audit trails around it. Deleting our row would not
  // unpublish anything - it would only lose the record that we did.
  "marketing_posts",
  "social_publisher_posts",
  "marketing_attribution_events",
  "marketing_automation_logs",
  "marketing_comment_events",
  "marketing_conversations",
  "ai_reply_corrections",
  "staff_task_assignments",
]);

/**
 * Rows here describe the product itself, its live stock/marketing state, or -
 * in the case of purchase_items - the supplier invoice lines the operator
 * explicitly asked to have removed. They go away with the product.
 */
export const PURGE_TABLES = new Set([
  "purchase_items",
  "product_variants",
  "product_variant_images",
  "product_images",
  "product_gallery_images",
  "product_image_gallery",
  "inventory",
  "warehouse_inventory",
  "inventory_movements",
  "inventory_count_items",
  "inventory_valuation_layers",
  "stock_valuation_layers",
  "stock_transfers",
  "stock_transfer_items",
  "customer_wishlist",
  "wishlist_items",
  "wishlists",
  "cart_items",
  "carts",
  "recently_viewed_products",
  "product_reviews",
  "marketing_post_product_links",
  "master_qr_models",
  "product_search_index",
  "search_index",
  "product_recommendation_cache",
  "recommendation_cache",
  "product_analytics_cache",
  "analytics_recommendation_cache",
  "ai_product_aliases",
  "ai_product_intelligence",
  "product_intelligence",
  "restock_intents",
  "restock_notifications",
  "ai_restock_recoveries",
  "product_audiences",
  "ai_product_image_visual_index",
  "ai_marketing_content_queue",
  "ai_sales_journey_events",
  "marketing_story_trigger_suggestions",
  "barcode_print_queue",
  "employee_product_display_states",
  "product_color_groups",
  "employee_display_refill_alerts",
  "sales_opportunities",
  "ai_marketing_catalog_coverage",
  "ai_marketing_theme_coverage",
  "ai_shoe_cover_jobs",
  "marketing_content_drafts",
  "marketing_story_campaigns",
  "social_comment_post_automation_configs",
  "social_post_product_links_v2",
  "variants",
]);

const PRODUCT_COLUMNS = new Set(["product_id"]);
const VARIANT_COLUMNS = new Set(["variant_id", "product_variant_id"]);

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const asIds = (rows = []) => rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

export const tableExists = async (client, tableName) => {
  const result = await client.query("SELECT to_regclass($1) AS regclass", [tableName]);
  return Boolean(result.rows[0]?.regclass);
};

export const tableColumns = async (client, tableName) => {
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

/**
 * Every column in the database that points at a product or a variant, whether
 * it carries a real foreign key or just follows the naming convention. Anything
 * this finds that is in neither list above is reported instead of guessed at.
 */
export const discoverReferences = async (client) => {
  const result = await client.query(
    `
    WITH fk AS (
      SELECT
        c.conrelid::regclass::text AS table_name,
        a.attname AS column_name,
        c.confrelid::regclass::text AS ref_table
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON TRUE
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND c.confrelid IN ('products'::regclass, 'product_variants'::regclass)
    ),
    named AS (
      SELECT table_name, column_name, NULL::text AS ref_table
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND column_name IN ('product_id', 'variant_id', 'product_variant_id')
        AND data_type IN ('bigint', 'integer', 'numeric')
    ),
    merged AS (
      SELECT * FROM fk
      UNION
      SELECT * FROM named
    )
    SELECT
      m.table_name,
      m.column_name,
      MAX(m.ref_table) AS ref_table,
      BOOL_OR(col.is_nullable = 'NO') AS not_null
    FROM merged m
    JOIN information_schema.columns col
      ON col.table_schema = current_schema()
     AND col.table_name = REGEXP_REPLACE(m.table_name, '^.*\\.', '')
     AND col.column_name = m.column_name
    GROUP BY m.table_name, m.column_name
    ORDER BY m.table_name, m.column_name
    `
  );

  return result.rows
    .map((row) => {
      const table = String(row.table_name).replace(/^.*\./, "").replaceAll('"', "");
      const column = row.column_name;
      const kind = PRODUCT_COLUMNS.has(column)
        ? "product"
        : VARIANT_COLUMNS.has(column)
          ? "variant"
          : String(row.ref_table || "").includes("product_variants")
            ? "variant"
            : "product";
      let action = "unknown";
      if (DETACH_TABLES.has(table)) action = "detach";
      else if (PURGE_TABLES.has(table)) action = "purge";
      return { table, column, kind, notNull: Boolean(row.not_null), action };
    })
    .filter((reference) => reference.table !== "products");
};

/**
 * Locks the product and its variants for the length of the transaction so a
 * concurrent sale cannot slip a new row in behind the plan.
 */
export const loadPurgeTarget = async (client, { productId, tenantId = null }) => {
  const result = await client.query(
    `
    SELECT *
    FROM products
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    FOR UPDATE
    `,
    [productId, tenantId]
  );
  const product = result.rows[0] || null;
  if (!product) return null;

  const variantsResult = await client.query(
    "SELECT * FROM product_variants WHERE product_id = $1 ORDER BY id FOR UPDATE",
    [product.id]
  );
  return {
    product,
    products: [product],
    productIds: [Number(product.id)],
    variants: variantsResult.rows,
    variantIds: asIds(variantsResult.rows),
  };
};

const countRows = async (client, { table, column, kind }, ids) => {
  const idList = ids[kind];
  if (!idList.length) return 0;
  const result = await client.query(
    `SELECT COUNT(*)::int AS count FROM ${q(table)} WHERE ${q(column)} = ANY($1::bigint[])`,
    [idList]
  );
  return Number(result.rows[0]?.count || 0);
};

export const collectLiveReferences = async (client, references, ids) => {
  const live = [];
  for (const reference of references) {
    if (!(await tableExists(client, reference.table))) continue;
    const count = await countRows(client, reference, ids);
    if (count > 0) live.push({ ...reference, count });
  }
  return live;
};

/**
 * order_items carries its own name/sku snapshot, but older rows can have them
 * blank. Fill any gap from the product/variant while it still exists, otherwise
 * the preserved invoice line would read as an empty row.
 */
const snapshotOrderItems = async (client, { productIds, variantIds }) => {
  if (!(await tableExists(client, "order_items"))) return 0;
  const columns = await tableColumns(client, "order_items");
  const fromProduct = (column) => `(SELECT p.${column} FROM products p WHERE p.id = oi.product_id)`;
  const fromVariant = (column) => `(SELECT v.${column} FROM product_variants v WHERE v.id = oi.variant_id)`;
  const sets = [];
  if (columns.has("product_name")) {
    sets.push(`product_name = COALESCE(NULLIF(TRIM(oi.product_name), ''), ${fromProduct("name")}, oi.product_name)`);
  }
  if (columns.has("variant_name")) {
    sets.push(
      `variant_name = COALESCE(NULLIF(TRIM(oi.variant_name), ''), NULLIF(TRIM((SELECT CONCAT_WS(' / ', v.color, v.size) FROM product_variants v WHERE v.id = oi.variant_id)), ''), oi.variant_name)`
    );
  }
  if (columns.has("sku")) sets.push(`sku = COALESCE(NULLIF(TRIM(oi.sku), ''), ${fromVariant("sku")}, ${fromProduct("sku")})`);
  if (columns.has("barcode")) sets.push(`barcode = COALESCE(NULLIF(TRIM(oi.barcode), ''), ${fromVariant("barcode")}, ${fromProduct("barcode")})`);
  if (!sets.length) return 0;

  const result = await client.query(
    `
    UPDATE order_items oi
    SET ${sets.join(", ")}
    WHERE oi.product_id = ANY($1::bigint[])
       OR oi.variant_id = ANY($2::bigint[])
    `,
    [productIds, variantIds]
  );
  return result.rowCount || 0;
};

const purchaseLineCostExpr = (columns) => {
  const unit = columns.has("unit_cost")
    ? columns.has("cost_price")
      ? "COALESCE(NULLIF(pi.unit_cost, 0), pi.cost_price, 0)"
      : "COALESCE(pi.unit_cost, 0)"
    : columns.has("cost_price")
      ? "COALESCE(pi.cost_price, 0)"
      : "0";
  return `COALESCE(pi.quantity, 0) * ${unit}`;
};

/**
 * Every purchase invoice the product appears on, with the totals it will carry
 * once its lines are gone. Recomputed exactly the way `updatePurchaseHeader`
 * does it on a normal edit: the header's own tax and discount are left alone,
 * only the line subtotal moves.
 */
export const buildPurchaseImpact = async (client, { productIds, variantIds }) => {
  if (!(await tableExists(client, "purchase_items")) || !(await tableExists(client, "purchases"))) return [];
  const itemColumns = await tableColumns(client, "purchase_items");
  const headerColumns = await tableColumns(client, "purchases");
  if (!itemColumns.has("purchase_id")) return [];

  const costExpr = purchaseLineCostExpr(itemColumns);
  const matchesTarget = `(COALESCE(pi.product_id = ANY($1::bigint[]), FALSE) OR ${
    itemColumns.has("variant_id") ? "COALESCE(pi.variant_id = ANY($2::bigint[]), FALSE)" : "FALSE"
  })`;
  const header = (column) => (headerColumns.has(column) ? `COALESCE(p.${column}, 0)` : "0");

  const result = await client.query(
    `
    WITH removed AS (
      SELECT pi.purchase_id,
             COUNT(*)::int AS removed_lines,
             COALESCE(SUM(${costExpr}), 0) AS removed_value,
             COALESCE(SUM(COALESCE(pi.quantity, 0)), 0) AS removed_quantity
      FROM purchase_items pi
      WHERE ${matchesTarget}
      GROUP BY pi.purchase_id
    ),
    kept AS (
      SELECT pi.purchase_id,
             COUNT(*)::int AS kept_lines,
             COALESCE(SUM(${costExpr}), 0) AS kept_subtotal
      FROM purchase_items pi
      WHERE pi.purchase_id IN (SELECT purchase_id FROM removed)
        AND NOT ${matchesTarget}
      GROUP BY pi.purchase_id
    )
    SELECT
      p.id,
      ${headerColumns.has("purchase_number") ? "p.purchase_number" : "NULL::text AS purchase_number"},
      ${header("subtotal")} AS subtotal,
      ${header("tax_amount")} AS tax_amount,
      ${header("discount_amount")} AS discount_amount,
      ${header("total")} AS total,
      ${header("paid_amount")} AS paid_amount,
      ${header("remaining_amount")} AS remaining_amount,
      r.removed_lines,
      r.removed_value,
      r.removed_quantity,
      COALESCE(k.kept_lines, 0) AS kept_lines,
      COALESCE(k.kept_subtotal, 0) AS kept_subtotal
    FROM removed r
    JOIN purchases p ON p.id = r.purchase_id
    LEFT JOIN kept k ON k.purchase_id = r.purchase_id
    ORDER BY p.id
    `,
    [productIds, variantIds]
  );

  return result.rows.map((row) => {
    const tax = money(row.tax_amount);
    const discount = money(row.discount_amount);
    const paid = money(row.paid_amount);
    const nextSubtotal = money(row.kept_subtotal);
    const nextTotal = money(Math.max(0, nextSubtotal + tax - discount));
    return {
      purchase_id: Number(row.id),
      purchase_number: row.purchase_number || null,
      removed_lines: Number(row.removed_lines || 0),
      removed_quantity: Number(row.removed_quantity || 0),
      removed_value: money(row.removed_value),
      kept_lines: Number(row.kept_lines || 0),
      becomes_empty: Number(row.kept_lines || 0) === 0,
      before: {
        subtotal: money(row.subtotal),
        tax_amount: tax,
        discount_amount: discount,
        total: money(row.total),
        paid_amount: paid,
        remaining_amount: money(row.remaining_amount),
      },
      after: {
        subtotal: nextSubtotal,
        tax_amount: tax,
        discount_amount: discount,
        total: nextTotal,
        paid_amount: paid,
        remaining_amount: money(Math.max(0, nextTotal - paid)),
      },
    };
  });
};

/**
 * Writes the recomputed header and leaves an audit trail on the invoice, so the
 * supplier account can always be reconciled back to what the line used to be.
 */
const applyPurchaseImpact = async (client, impact, { product, actorId }) => {
  if (!impact.length) return 0;
  const headerColumns = await tableColumns(client, "purchases");
  let updated = 0;

  for (const entry of impact) {
    const sets = [];
    const values = [];
    const push = (column, value) => {
      if (!headerColumns.has(column)) return;
      values.push(value);
      sets.push(`${q(column)} = $${values.length}`);
    };
    push("subtotal", entry.after.subtotal);
    push("total", entry.after.total);
    push("remaining_amount", entry.after.remaining_amount);
    if (headerColumns.has("metadata")) {
      values.push(
        JSON.stringify([
          {
            product_id: Number(product.id),
            product_name: product.name || null,
            product_sku: product.sku || null,
            removed_lines: entry.removed_lines,
            removed_quantity: entry.removed_quantity,
            removed_value: entry.removed_value,
            total_before: entry.before.total,
            total_after: entry.after.total,
            purged_by: actorId ? Number(actorId) : null,
          },
        ])
      );
      sets.push(
        `metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('purged_products', COALESCE(metadata->'purged_products', '[]'::jsonb) || $${values.length}::jsonb)`
      );
    }
    if (headerColumns.has("updated_at")) sets.push("updated_at = CURRENT_TIMESTAMP");
    if (!sets.length) continue;

    values.push(entry.purchase_id);
    const result = await client.query(`UPDATE purchases SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
    updated += result.rowCount || 0;
  }
  return updated;
};

const detachReference = async (client, { table, column, kind }, ids) => {
  const idList = ids[kind];
  if (!idList.length) return 0;
  const result = await client.query(
    `UPDATE ${q(table)} SET ${q(column)} = NULL WHERE ${q(column)} = ANY($1::bigint[])`,
    [idList]
  );
  return result.rowCount || 0;
};

const purgeReference = async (client, { table, column, kind }, ids) => {
  const idList = ids[kind];
  if (!idList.length) return 0;
  const result = await client.query(`DELETE FROM ${q(table)} WHERE ${q(column)} = ANY($1::bigint[])`, [idList]);
  return result.rowCount || 0;
};

/**
 * The product can also be referenced from JSON blobs that carry no foreign key,
 * so no amount of constraint walking finds them.
 */
const cleanJsonReferences = async (client, { productIds, variantIds }) => {
  const cleaned = [];
  if (!(await tableExists(client, "storefront_customer_sessions"))) return cleaned;
  const columns = await tableColumns(client, "storefront_customer_sessions");
  const idStrings = [...productIds, ...variantIds].map(String);
  for (const column of ["cart_items", "wishlist_items"]) {
    if (!columns.has(column)) continue;
    const result = await client.query(
      `
      UPDATE storefront_customer_sessions s
      SET ${q(column)} = COALESCE((
        SELECT jsonb_agg(item)
        FROM jsonb_array_elements(COALESCE(s.${q(column)}, '[]'::jsonb)) item
        WHERE COALESCE(item->>'product_id', item->>'productId', item->>'id', '') <> ALL($1::text[])
          AND COALESCE(item->>'variant_id', item->>'variantId', '') <> ALL($1::text[])
      ), '[]'::jsonb)
      WHERE EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(s.${q(column)}, '[]'::jsonb)) item
        WHERE COALESCE(item->>'product_id', item->>'productId', item->>'id', '') = ANY($1::text[])
           OR COALESCE(item->>'variant_id', item->>'variantId', '') = ANY($1::text[])
      )
      `,
      [idStrings]
    );
    if (result.rowCount) cleaned.push({ table: "storefront_customer_sessions", column, rows: result.rowCount });
  }
  return cleaned;
};

const collectImageBasenames = ({ products, variants }) => {
  const basenames = new Set();
  const add = (value) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    const matches = text.match(/(?:\/?uploads\/products\/|products\/)[^"'\s,)\]}]+/gi) || [];
    for (const match of matches) {
      const clean = match.split(/[?#]/)[0].replaceAll("\\", "/");
      basenames.add(path.basename(clean));
    }
  };
  for (const row of [...products, ...variants]) {
    for (const value of Object.values(row)) add(value);
  }
  return basenames;
};

/**
 * Only unlink a file once the database no longer mentions it anywhere - other
 * products legitimately share images.
 */
const deleteOrphanImageFiles = async (client, basenames) => {
  const deleted = [];
  const kept = [];
  for (const basename of basenames) {
    const stillReferenced = await client.query(
      `
      SELECT 1
      FROM products
      WHERE image_url ILIKE $1 OR gallery_images::text ILIKE $1 OR thermal_image_url ILIKE $1
      UNION ALL
      SELECT 1 FROM product_variants WHERE to_jsonb(product_variants)::text ILIKE $1
      LIMIT 1
      `,
      [`%${basename}%`]
    );
    if (stillReferenced.rowCount) {
      kept.push(basename);
      continue;
    }
    for (const dir of UPLOAD_DIRS) {
      const filePath = path.join(dir, basename);
      try {
        await fs.unlink(filePath);
        deleted.push(filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return { deleted, kept };
};

const captureSalesLineIds = async (client, { productIds, variantIds }) => {
  if (!(await tableExists(client, "order_items"))) return [];
  const result = await client.query(
    "SELECT id FROM order_items WHERE product_id = ANY($1::bigint[]) OR variant_id = ANY($2::bigint[]) ORDER BY id",
    [productIds, variantIds]
  );
  return asIds(result.rows);
};

const verifySalesLinesSurvived = async (client, lineIds) => {
  if (!lineIds.length) return { before: 0, after: 0 };
  const result = await client.query("SELECT COUNT(*)::int AS count FROM order_items WHERE id = ANY($1::bigint[])", [lineIds]);
  const after = Number(result.rows[0]?.count || 0);
  if (after !== lineIds.length) {
    throw new Error(`order_items: ${lineIds.length - after} sales invoice line(s) disappeared. Refusing to commit.`);
  }
  return { before: lineIds.length, after };
};

/**
 * What the purge will touch, without touching anything. Safe to call on its own
 * for the confirmation dialog.
 */
export const planProductPurge = async (client, target) => {
  const ids = { product: target.productIds, variant: target.variantIds };
  const references = await discoverReferences(client);
  const live = await collectLiveReferences(client, references, ids);
  const purchaseImpact = await buildPurchaseImpact(client, target);
  const salesLineIds = await captureSalesLineIds(client, target);

  return {
    references,
    live,
    unknown: live.filter((reference) => reference.action === "unknown"),
    willDelete: live.filter((reference) => reference.action === "purge"),
    willDetach: live.filter((reference) => reference.action === "detach"),
    purchaseImpact,
    salesLineIds,
    summary: {
      variants: target.variantIds.length,
      sales_lines_preserved: salesLineIds.length,
      purchases_affected: purchaseImpact.length,
      purchase_lines_removed: purchaseImpact.reduce((sum, entry) => sum + entry.removed_lines, 0),
      purchase_value_removed: money(purchaseImpact.reduce((sum, entry) => sum + entry.removed_value, 0)),
      purchases_left_empty: purchaseImpact.filter((entry) => entry.becomes_empty).length,
      rows_to_delete: live.filter((r) => r.action === "purge").reduce((sum, r) => sum + r.count, 0),
      rows_to_detach: live.filter((r) => r.action === "detach").reduce((sum, r) => sum + r.count, 0),
    },
  };
};

/**
 * Runs inside a transaction the caller owns. Throws on an unclassified
 * reference so the caller can roll back and report instead of leaving orphans.
 */
export const executeProductPurge = async (client, target, plan, { actorId = null } = {}) => {
  if (plan.unknown.length) {
    const error = new Error("Unclassified tables reference this product. Refusing to purge.");
    error.code = "PRODUCT_PURGE_UNCLASSIFIED";
    error.details = plan.unknown.map(({ table, column, count }) => ({ table, column, rows: count }));
    throw error;
  }

  // Detaching means nulling the pointer, which a NOT NULL column cannot accept.
  // Catch a future mis-classification here rather than half way through the
  // transaction with a constraint violation.
  const undetachable = plan.willDetach.filter((reference) => reference.notNull);
  if (undetachable.length) {
    const error = new Error("A preserved table has a NOT NULL product reference and cannot be detached.");
    error.code = "PRODUCT_PURGE_NOT_NULL_DETACH";
    error.details = undetachable.map(({ table, column, count }) => ({ table, column, rows: count }));
    throw error;
  }

  const ids = { product: target.productIds, variant: target.variantIds };
  const report = { detached: [], deleted: [], json_cleanups: [], purchases_updated: 0, snapshots: {} };

  report.snapshots.order_items = await snapshotOrderItems(client, target);

  for (const reference of plan.willDetach) {
    const rows = await detachReference(client, reference, ids);
    if (rows) report.detached.push({ table: reference.table, column: reference.column, rows });
  }

  // product_variants is the parent of most variant-keyed tables, so it goes
  // last: deleting it first would either cascade rows out from under the report
  // or trip a RESTRICT foreign key.
  const purgeOrder = [...plan.willDelete].sort(
    (a, b) => Number(a.table === "product_variants") - Number(b.table === "product_variants")
  );
  for (const reference of purgeOrder) {
    const rows = await purgeReference(client, reference, ids);
    if (rows) report.deleted.push({ table: reference.table, column: reference.column, rows });
  }

  report.purchases_updated = await applyPurchaseImpact(client, plan.purchaseImpact, {
    product: target.product,
    actorId,
  });

  report.json_cleanups = await cleanJsonReferences(client, target);

  const imageBasenames = collectImageBasenames(target);

  const variantsDeleted = await client.query("DELETE FROM product_variants WHERE product_id = ANY($1::bigint[])", [target.productIds]);
  const productsDeleted = await client.query("DELETE FROM products WHERE id = ANY($1::bigint[])", [target.productIds]);
  if (variantsDeleted.rowCount) report.deleted.push({ table: "product_variants", column: "product_id", rows: variantsDeleted.rowCount });
  report.deleted.push({ table: "products", column: "id", rows: productsDeleted.rowCount || 0 });

  const dangling = await collectLiveReferences(
    client,
    plan.references.filter((reference) => PURGE_TABLES.has(reference.table)),
    ids
  );
  if (dangling.length) {
    const error = new Error("Purge verification failed: rows still point at the deleted product.");
    error.code = "PRODUCT_PURGE_DANGLING";
    error.details = dangling.map(({ table, column, count }) => ({ table, column, rows: count }));
    throw error;
  }

  report.sales_lines = await verifySalesLinesSurvived(client, plan.salesLineIds);
  report.imageBasenames = imageBasenames;
  return report;
};

export const purgeProductImageFiles = async (client, basenames) => deleteOrphanImageFiles(client, basenames);
