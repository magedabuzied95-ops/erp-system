/**
 * Permanently remove one product from the catalogue and every operational table,
 * while preserving the accounting record: sales invoice lines, purchase invoice
 * lines, returns and posted cost overrides stay exactly where they are and only
 * lose their pointer to the deleted product.
 *
 * Because purchase_items has no product-name column of its own (it joins
 * products at read time), the product identity is snapshotted into the columns
 * and metadata the purchase reader already falls back to before detaching.
 *
 * Usage:
 *   node server/scripts/purgeProductKeepInvoices.js --sku=ADS-IMP-15
 *   DRY_RUN=false node server/scripts/purgeProductKeepInvoices.js --sku=ADS-IMP-15
 *
 * Dry run is the default and rolls the whole transaction back.
 */
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db from "../database/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const UPLOAD_DIRS = [
  path.resolve(ROOT_DIR, "server/uploads/products"),
  path.resolve(ROOT_DIR, "uploads/products"),
];

const argValue = (name) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : "";
};

const TARGET_SKU = argValue("sku") || process.env.TARGET_SKU || "";
const TARGET_ID = Number(argValue("id") || process.env.TARGET_ID || 0);
const TARGET_NAME = argValue("name") || process.env.TARGET_NAME || "";
const TENANT_ID = Number(argValue("tenant") || process.env.TARGET_TENANT_ID || 0) || null;
const DRY_RUN = String(process.env.DRY_RUN ?? "true").trim().toLowerCase() !== "false";
const KEEP_FILES = process.argv.includes("--keep-files");

/**
 * Rows here outlive the product: the financial record (invoice lines, returns,
 * posted cost overrides, commissions) and content that exists outside the ERP
 * such as a published marketing post. They are never deleted; the
 * product/variant pointer is nulled after the line has been given a standalone
 * identity snapshot.
 */
const PRESERVE_TABLES = new Set([
  "order_items",
  "purchase_items",
  "return_items",
  "accounting_order_item_cost_overrides",
  "employee_commissions",
  "sales_commission_lines",
  "marketing_posts",
]);

/**
 * Rows here describe the product itself or live stock/marketing state. They go
 * away with the product.
 */
const PURGE_TABLES = new Set([
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
]);

const PRODUCT_COLUMNS = new Set(["product_id"]);
const VARIANT_COLUMNS = new Set(["variant_id", "product_variant_id"]);

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const asIds = (rows = []) => rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);

const tableExists = async (client, tableName) => {
  const result = await client.query("SELECT to_regclass($1) AS regclass", [tableName]);
  return Boolean(result.rows[0]?.regclass);
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

/**
 * Every column in the database that points at a product or a variant, whether
 * it carries a real foreign key or just follows the naming convention. Anything
 * this finds that is not in either list above is reported instead of guessed at.
 */
const discoverReferences = async (client) => {
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

  return result.rows.map((row) => {
    const table = String(row.table_name).replace(/^.*\./, "").replaceAll('"', "");
    const column = row.column_name;
    const kind = PRODUCT_COLUMNS.has(column) ? "product" : VARIANT_COLUMNS.has(column) ? "variant" : String(row.ref_table || "").includes("product_variants") ? "variant" : "product";
    let action = "unknown";
    if (PRESERVE_TABLES.has(table)) action = "detach";
    else if (PURGE_TABLES.has(table)) action = "purge";
    return { table, column, kind, notNull: Boolean(row.not_null), action };
  });
};

const resolveTarget = async (client) => {
  const clauses = [];
  const params = [];
  if (Number.isInteger(TARGET_ID) && TARGET_ID > 0) {
    params.push(TARGET_ID);
    clauses.push(`p.id = $${params.length}`);
  }
  if (TARGET_SKU) {
    params.push(TARGET_SKU);
    clauses.push(`LOWER(TRIM(p.sku)) = LOWER(TRIM($${params.length}))`);
    clauses.push(`LOWER(TRIM(COALESCE(p.product_code, ''))) = LOWER(TRIM($${params.length}))`);
    clauses.push(`LOWER(TRIM(COALESCE(p.barcode, ''))) = LOWER(TRIM($${params.length}))`);
    clauses.push(`EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND LOWER(TRIM(COALESCE(v.sku, ''))) = LOWER(TRIM($${params.length})))`);
  }
  if (TARGET_NAME) {
    params.push(TARGET_NAME);
    clauses.push(`LOWER(TRIM(p.name)) = LOWER(TRIM($${params.length}))`);
  }
  if (!clauses.length) throw new Error("No target given. Pass --sku=, --id= or --name=.");

  const tenantClause = TENANT_ID ? `AND p.tenant_id = ${Number(TENANT_ID)}` : "";
  const result = await client.query(
    `
    SELECT p.*
    FROM products p
    WHERE (${clauses.join(" OR ")})
      ${tenantClause}
    ORDER BY p.id
    FOR UPDATE
    `,
    params
  );
  const products = result.rows;
  const productIds = asIds(products);
  if (!productIds.length) return { products, productIds, variants: [], variantIds: [] };

  const variantsResult = await client.query(
    "SELECT * FROM product_variants WHERE product_id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
    [productIds]
  );
  return { products, productIds, variants: variantsResult.rows, variantIds: asIds(variantsResult.rows) };
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

/**
 * order_items already carries a name/sku snapshot, but older rows can have them
 * blank. Fill any gap from the product/variant while it still exists.
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
    sets.push(`variant_name = COALESCE(NULLIF(TRIM(oi.variant_name), ''), NULLIF(TRIM((SELECT CONCAT_WS(' / ', v.color, v.size) FROM product_variants v WHERE v.id = oi.variant_id)), ''), oi.variant_name)`);
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

/**
 * purchase_items has no name column at all - the reader falls back to
 * metadata->>'product_name'. Write that fallback (plus sku/color/size when the
 * columns exist) so the purchase invoice still reads correctly once the product
 * row is gone.
 */
const snapshotPurchaseItems = async (client, { productIds, variantIds }) => {
  if (!(await tableExists(client, "purchase_items"))) return 0;
  const columns = await tableColumns(client, "purchase_items");
  const fromProduct = (column) => `(SELECT p.${column} FROM products p WHERE p.id = pi.product_id)`;
  const fromVariant = (column) => `(SELECT v.${column} FROM product_variants v WHERE v.id = pi.variant_id)`;
  const sets = [];
  if (columns.has("metadata")) {
    sets.push(`metadata = COALESCE(pi.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'product_name', COALESCE(NULLIF(pi.metadata->>'product_name', ''), ${fromProduct("name")}),
      'product_sku', COALESCE(NULLIF(pi.metadata->>'product_sku', ''), ${fromVariant("sku")}, ${fromProduct("sku")}),
      'variant_color', COALESCE(NULLIF(pi.metadata->>'variant_color', ''), ${fromVariant("color")}),
      'variant_size', COALESCE(NULLIF(pi.metadata->>'variant_size', ''), ${fromVariant("size")}),
      'purged_product_id', pi.product_id::text,
      'purged_at', NOW()::text
    ))`);
  }
  if (columns.has("sku")) sets.push(`sku = COALESCE(NULLIF(TRIM(pi.sku), ''), ${fromVariant("sku")}, ${fromProduct("sku")})`);
  if (columns.has("color")) sets.push(`color = COALESCE(NULLIF(TRIM(pi.color), ''), ${fromVariant("color")})`);
  if (columns.has("size")) sets.push(`size = COALESCE(NULLIF(TRIM(pi.size), ''), ${fromVariant("size")})`);
  if (!sets.length) return 0;

  const result = await client.query(
    `
    UPDATE purchase_items pi
    SET ${sets.join(", ")}
    WHERE pi.product_id = ANY($1::bigint[])
       OR pi.variant_id = ANY($2::bigint[])
    `,
    [productIds, variantIds]
  );
  return result.rowCount || 0;
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
  const result = await client.query(
    `DELETE FROM ${q(table)} WHERE ${q(column)} = ANY($1::bigint[])`,
    [idList]
  );
  return result.rowCount || 0;
};

/**
 * The product can also be referenced from JSON blobs that carry no foreign key.
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
    cleaned.push({ table: "storefront_customer_sessions", column, rows: result.rowCount || 0 });
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

/**
 * Remember which invoice lines belong to the product so the run can prove, after
 * the product row is gone, that they are all still there and still readable.
 */
const captureInvoiceLineIds = async (client, { productIds, variantIds }) => {
  const captured = {};
  for (const table of ["order_items", "purchase_items"]) {
    if (!(await tableExists(client, table))) continue;
    const result = await client.query(
      `SELECT id FROM ${q(table)} WHERE product_id = ANY($1::bigint[]) OR variant_id = ANY($2::bigint[]) ORDER BY id`,
      [productIds, variantIds]
    );
    captured[table] = asIds(result.rows);
  }
  return captured;
};

const verifyInvoiceLinesSurvived = async (client, invoiceLineIds) => {
  const summary = [];
  for (const [table, lineIds] of Object.entries(invoiceLineIds)) {
    if (!lineIds.length) continue;
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${q(table)} WHERE id = ANY($1::bigint[])`, [lineIds]);
    const survived = Number(result.rows[0]?.count || 0);
    if (survived !== lineIds.length) {
      throw new Error(`${table}: ${lineIds.length - survived} invoice line(s) disappeared. Refusing to commit.`);
    }
    summary.push({ table, invoice_lines_before: lineIds.length, invoice_lines_after: survived });
  }
  return summary;
};

const sampleInvoiceLines = async (client, invoiceLineIds) => {
  const samples = [];
  const orderIds = invoiceLineIds.order_items || [];
  if (orderIds.length) {
    const result = await client.query(
      "SELECT id, order_id, product_id, variant_id, product_name, sku, quantity, total_amount FROM order_items WHERE id = ANY($1::bigint[]) ORDER BY id LIMIT 3",
      [orderIds]
    );
    samples.push(...result.rows.map((row) => ({ table: "order_items", ...row })));
  }
  const purchaseIds = invoiceLineIds.purchase_items || [];
  if (purchaseIds.length) {
    const columns = await tableColumns(client, "purchase_items");
    const nameExpr = columns.has("metadata") ? "metadata->>'product_name'" : "NULL";
    const skuExpr = columns.has("sku") ? "sku" : columns.has("metadata") ? "metadata->>'product_sku'" : "NULL";
    const result = await client.query(
      `SELECT id, purchase_id, product_id, variant_id, ${nameExpr} AS product_name, ${skuExpr} AS sku, quantity FROM purchase_items WHERE id = ANY($1::bigint[]) ORDER BY id LIMIT 3`,
      [purchaseIds]
    );
    samples.push(...result.rows.map((row) => ({ table: "purchase_items", ...row })));
  }
  return samples;
};

const verifyNoDanglingReferences = async (client, references, ids) => {
  const remaining = [];
  for (const reference of references) {
    if (!(await tableExists(client, reference.table))) continue;
    const count = await countRows(client, reference, ids);
    if (count > 0) remaining.push({ ...reference, count });
  }
  return remaining;
};

const main = async () => {
  const client = await db.connect();
  const report = {
    dry_run: DRY_RUN,
    target: { sku: TARGET_SKU || null, id: TARGET_ID || null, name: TARGET_NAME || null, tenant_id: TENANT_ID },
    preserved: [],
    purged: [],
    unknown: [],
    json_cleanups: [],
    snapshots: {},
  };

  try {
    await client.query("BEGIN");

    const target = await resolveTarget(client);
    if (!target.productIds.length) {
      console.log("No product matched the target. Nothing to do.");
      await client.query("ROLLBACK");
      return;
    }
    if (target.productIds.length > 1) {
      throw new Error(`Target matched ${target.productIds.length} products (${target.productIds.join(", ")}). Narrow it with --id=.`);
    }

    const ids = { product: target.productIds, variant: target.variantIds };
    console.log("\nTarget");
    console.table(
      target.products.map((row) => ({
        id: row.id,
        tenant_id: row.tenant_id,
        name: row.name,
        sku: row.sku,
        status: row.status,
        variants: target.variantIds.length,
      }))
    );

    const references = (await discoverReferences(client)).filter((reference) => reference.table !== "products");
    const live = [];
    for (const reference of references) {
      if (!(await tableExists(client, reference.table))) continue;
      const count = await countRows(client, reference, ids);
      if (count > 0) live.push({ ...reference, count });
    }

    console.log("\nRows referencing this product");
    console.table(live.map(({ table, column, action, count, notNull }) => ({ table, column, action, rows: count, not_null: notNull })));

    const unknown = live.filter((reference) => reference.action === "unknown");
    if (unknown.length) {
      report.unknown = unknown;
      console.log("\nUNCLASSIFIED tables carry rows for this product. They are left attached; add them to PRESERVE_TABLES or PURGE_TABLES and re-run:");
      console.table(unknown.map(({ table, column, count }) => ({ table, column, rows: count })));
      if (!DRY_RUN) {
        throw new Error("Refusing to purge while unclassified references exist. Classify them first.");
      }
    }

    const invoiceLineIds = await captureInvoiceLineIds(client, target);
    report.snapshots.order_items = await snapshotOrderItems(client, target);
    report.snapshots.purchase_items = await snapshotPurchaseItems(client, target);

    for (const reference of live) {
      if (reference.action !== "detach") continue;
      const rows = await detachReference(client, reference, ids);
      report.preserved.push({ table: reference.table, column: reference.column, detached_rows: rows });
    }

    // product_variants is the parent of most variant-keyed tables, so it goes
    // last: deleting it first would either cascade rows out from under the
    // report or trip a RESTRICT foreign key.
    const purgeOrder = live
      .filter((reference) => reference.action === "purge")
      .sort((a, b) => Number(a.table === "product_variants") - Number(b.table === "product_variants"));
    for (const reference of purgeOrder) {
      const rows = await purgeReference(client, reference, ids);
      report.purged.push({ table: reference.table, column: reference.column, deleted_rows: rows });
    }

    report.json_cleanups = await cleanJsonReferences(client, target);

    const imageBasenames = collectImageBasenames(target);

    const variantsDeleted = await client.query("DELETE FROM product_variants WHERE product_id = ANY($1::bigint[])", [target.productIds]);
    const productsDeleted = await client.query("DELETE FROM products WHERE id = ANY($1::bigint[])", [target.productIds]);
    report.purged.push({ table: "product_variants", column: "product_id", deleted_rows: variantsDeleted.rowCount || 0 });
    report.purged.push({ table: "products", column: "id", deleted_rows: productsDeleted.rowCount || 0 });

    const dangling = await verifyNoDanglingReferences(
      client,
      references.filter((reference) => PURGE_TABLES.has(reference.table)),
      ids
    );
    if (dangling.length) {
      console.table(dangling);
      throw new Error("Purge verification failed: rows still point at the deleted product.");
    }

    const survival = await verifyInvoiceLinesSurvived(client, invoiceLineIds);
    const samples = await sampleInvoiceLines(client, invoiceLineIds);

    console.log("\nPreserved (accounting record kept, pointer detached)");
    console.table(report.preserved.length ? report.preserved : [{ table: "(none)" }]);
    console.log("\nPurged");
    console.table(report.purged);
    if (report.json_cleanups.length) {
      console.log("\nJSON cleanups");
      console.table(report.json_cleanups);
    }
    console.log("\nIdentity snapshots written before detaching:", report.snapshots);
    console.log("\nInvoice lines still present after the product row was deleted");
    console.table(survival.length ? survival : [{ table: "(no invoice lines for this product)" }]);
    if (samples.length) {
      console.log("\nSample invoice lines as they now read");
      console.table(samples);
    }

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\nDRY_RUN=true - transaction rolled back, nothing changed.");
      console.log("Re-run with DRY_RUN=false to apply.");
      return;
    }

    let fileResult = { deleted: [], kept: [] };
    if (!KEEP_FILES && imageBasenames.size) {
      fileResult = await deleteOrphanImageFiles(client, imageBasenames);
    }

    await client.query("COMMIT");

    console.log("\nCommitted. Product removed; invoice and cost rows kept.");
    if (fileResult.deleted.length) console.log("Deleted orphan image files:", fileResult.deleted.length);
    if (fileResult.kept.length) console.log("Kept image files still referenced elsewhere:", fileResult.kept.length);
    console.log("Restart the backend (or wait for cache TTL) so in-process caches drop the product.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\nFailed - transaction rolled back.", { message: error.message, detail: error.detail, constraint: error.constraint });
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
};

main();
