import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import db from "../database/db.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const PRODUCT_UPLOAD_DIRS = [
  path.resolve(ROOT_DIR, "server/uploads/products"),
  path.resolve(ROOT_DIR, "uploads/products"),
];
const PRODUCT_OG_UPLOAD_DIR = path.resolve(ROOT_DIR, "server/uploads/og/products");
const DRY_RUN = process.argv.includes("--dry-run");
const ALLOW_DELETE = process.env.ALLOW_FULL_PRODUCT_DELETE === "true";

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

const rowCount = (result) => Number(result?.rowCount || 0);

const tableExists = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = $1
    LIMIT 1
    `,
    [tableName]
  );
  return Boolean(result.rowCount);
};

const getColumns = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  return new Map(result.rows.map((row) => [row.column_name, row.data_type]));
};

const deleteFromTable = async (client, stats, tableName, whereSql = "", params = []) => {
  if (!(await tableExists(client, tableName))) return 0;
  const result = await client.query(`DELETE FROM ${q(tableName)} ${whereSql}`, params);
  stats.deleted[tableName] = (stats.deleted[tableName] || 0) + rowCount(result);
  return rowCount(result);
};

const updateTable = async (client, stats, tableName, setSql, whereSql = "", params = []) => {
  if (!(await tableExists(client, tableName))) return 0;
  const result = await client.query(`UPDATE ${q(tableName)} SET ${setSql} ${whereSql}`, params);
  stats.updated[tableName] = (stats.updated[tableName] || 0) + rowCount(result);
  return rowCount(result);
};

const resetSequence = async (client, stats, tableName, columnName = "id") => {
  if (!(await tableExists(client, tableName))) return;
  const result = await client.query("SELECT pg_get_serial_sequence($1, $2) AS sequence_name", [tableName, columnName]);
  const sequenceName = result.rows[0]?.sequence_name;
  if (!sequenceName) return;
  await client.query(`ALTER SEQUENCE ${sequenceName} RESTART WITH 1`);
  stats.reset_sequences.push(sequenceName);
};

const normalizeUploadBasename = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "";
  const withoutQuery = text.split(/[?#]/)[0].replaceAll("\\", "/");
  if (!/\/?uploads\/products\/|^products\//i.test(withoutQuery)) return "";
  return path.basename(withoutQuery);
};

const addUploadBasenamesFromValue = (target, value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const matches = text.match(/(?:\/?uploads\/products\/|products\/)[^"'\s,)\]}]+/gi) || [];
  for (const match of matches) {
    const basename = normalizeUploadBasename(match);
    if (basename) target.add(basename);
  }
};

const collectProductUploadBasenames = async (client) => {
  const refs = new Set();
  for (const tableName of ["products", "product_variants", "product_variant_images"]) {
    if (!(await tableExists(client, tableName))) continue;
    const columns = await getColumns(client, tableName);
    const selectColumns = [...columns.entries()]
      .filter(([, type]) => ["text", "character varying", "json", "jsonb"].includes(type))
      .map(([name]) => q(name));
    if (!selectColumns.length) continue;
    const result = await client.query(`SELECT ${selectColumns.join(", ")} FROM ${q(tableName)}`);
    for (const row of result.rows) {
      for (const value of Object.values(row)) addUploadBasenamesFromValue(refs, value);
    }
  }
  return refs;
};

const collectReferencedUploadBasenames = async (client) => {
  const refs = new Set();
  const tables = await client.query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
    `
  );

  for (const { table_name: tableName } of tables.rows) {
    const columns = await getColumns(client, tableName);
    const searchable = [...columns.entries()]
      .filter(([, type]) => ["text", "character varying", "json", "jsonb"].includes(type))
      .map(([name]) => name);
    for (const columnName of searchable) {
      const result = await client.query(
        `
        SELECT ${q(columnName)}::text AS value
        FROM ${q(tableName)}
        WHERE ${q(columnName)}::text ILIKE '%uploads/products/%'
           OR ${q(columnName)}::text ILIKE '%products/%'
        `
      );
      for (const row of result.rows) addUploadBasenamesFromValue(refs, row.value);
    }
  }
  return refs;
};

const listFiles = async (dir) => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};

const deleteUnusedUploadFiles = async ({ candidateBasenames, referencedBasenames }) => {
  const deleted = [];
  const skippedReferenced = [];
  for (const dir of PRODUCT_UPLOAD_DIRS) {
    const entries = await listFiles(dir);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!candidateBasenames.has(entry.name)) continue;
      if (referencedBasenames.has(entry.name)) {
        skippedReferenced.push(path.join(dir, entry.name));
        continue;
      }
      const filePath = path.join(dir, entry.name);
      await fs.unlink(filePath);
      deleted.push(filePath);
    }
  }
  return { deleted, skippedReferenced };
};

const deleteProductOgFiles = async () => {
  const deleted = [];
  const entries = await listFiles(PRODUCT_OG_UPLOAD_DIR);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(PRODUCT_OG_UPLOAD_DIR, entry.name);
    await fs.unlink(filePath);
    deleted.push(filePath);
  }
  return deleted;
};

const deleteTableByProductId = async (client, stats, tableName, columnName = "product_id") => {
  if (!(await tableExists(client, tableName))) return 0;
  const columns = await getColumns(client, tableName);
  if (!columns.has(columnName)) return 0;
  return deleteFromTable(client, stats, tableName, `WHERE ${q(columnName)} = ANY($1::bigint[])`, [stats.product_ids]);
};

const deleteTableByVariantId = async (client, stats, tableName, columnName = "variant_id") => {
  if (!(await tableExists(client, tableName))) return 0;
  const columns = await getColumns(client, tableName);
  if (!columns.has(columnName)) return 0;
  return deleteFromTable(client, stats, tableName, `WHERE ${q(columnName)} = ANY($1::bigint[])`, [stats.variant_ids]);
};

const nullProductReferences = async (client, stats, tableName) => {
  if (!(await tableExists(client, tableName))) return;
  const columns = await getColumns(client, tableName);
  const sets = [];
  const wheres = [];
  const params = [];
  if (columns.has("product_id")) {
    sets.push("product_id = NULL");
    params.push(stats.product_ids);
    wheres.push(`product_id = ANY($${params.length}::bigint[])`);
  }
  if (columns.has("variant_id")) {
    sets.push("variant_id = NULL");
    params.push(stats.variant_ids);
    wheres.push(`variant_id = ANY($${params.length}::bigint[])`);
  }
  if (!sets.length) return;
  await updateTable(client, stats, tableName, sets.join(", "), `WHERE ${wheres.join(" OR ")}`, params);
};

const clearStorefrontSessionProductJson = async (client, stats) => {
  if (!(await tableExists(client, "storefront_customer_sessions"))) return;
  const columns = await getColumns(client, "storefront_customer_sessions");
  const sets = [];
  if (columns.has("cart_items")) sets.push("cart_items = '[]'::jsonb");
  if (columns.has("wishlist_items")) sets.push("wishlist_items = '[]'::jsonb");
  if (!sets.length) return;
  await updateTable(client, stats, "storefront_customer_sessions", sets.join(", "), "WHERE cart_items <> '[]'::jsonb OR wishlist_items <> '[]'::jsonb");
};

const main = async () => {
  if (!DRY_RUN && !ALLOW_DELETE) {
    console.error("Refusing to delete products. Set ALLOW_FULL_PRODUCT_DELETE=true to run the destructive cleanup.");
    process.exitCode = 1;
    return;
  }

  const client = await db.connect();
  const stats = {
    dry_run: DRY_RUN,
    product_ids: [],
    variant_ids: [],
    deleted: {},
    updated: {},
    reset_sequences: [],
    uploads: {
      candidates: 0,
      deleted: 0,
      skipped_referenced: 0,
    },
  };

  let productUploadCandidates = new Set();
  try {
    await client.query("BEGIN");

    const productResult = await client.query("SELECT id FROM products ORDER BY id");
    const variantResult = await client.query("SELECT id FROM product_variants ORDER BY id");
    stats.product_ids = productResult.rows.map((row) => Number(row.id)).filter(Number.isFinite);
    stats.variant_ids = variantResult.rows.map((row) => Number(row.id)).filter(Number.isFinite);
    productUploadCandidates = await collectProductUploadBasenames(client);

    if (DRY_RUN) {
      stats.product_upload_candidates = productUploadCandidates.size;
      await client.query("ROLLBACK");
      console.log("[delete-all-products] dry run", {
        product_count: stats.product_ids.length,
        variant_count: stats.variant_ids.length,
        product_upload_candidates: productUploadCandidates.size,
      });
      return;
    }

    await deleteTableByProductId(client, stats, "product_variant_images");
    await deleteTableByProductId(client, stats, "product_images");
    await deleteTableByProductId(client, stats, "product_gallery_images");
    await deleteTableByProductId(client, stats, "product_image_gallery");
    await deleteTableByProductId(client, stats, "customer_wishlist");
    await deleteTableByProductId(client, stats, "recently_viewed_products");
    await deleteTableByProductId(client, stats, "marketing_post_product_links");
    await deleteTableByProductId(client, stats, "master_qr_models");
    await deleteTableByProductId(client, stats, "product_search_index");
    await deleteTableByProductId(client, stats, "search_index");
    await deleteTableByProductId(client, stats, "product_recommendation_cache");
    await deleteTableByProductId(client, stats, "recommendation_cache");
    await deleteTableByProductId(client, stats, "product_analytics_cache");
    await deleteTableByProductId(client, stats, "analytics_recommendation_cache");
    await deleteTableByProductId(client, stats, "ai_product_aliases");
    await deleteTableByProductId(client, stats, "ai_product_intelligence");
    await deleteTableByProductId(client, stats, "product_intelligence");

    await deleteTableByVariantId(client, stats, "warehouse_inventory");
    await deleteTableByVariantId(client, stats, "stock_transfers");
    await deleteTableByVariantId(client, stats, "inventory_count_items");
    await deleteTableByVariantId(client, stats, "inventory");

    await clearStorefrontSessionProductJson(client, stats);

    for (const tableName of [
      "inventory_movements",
      "order_items",
      "purchase_items",
      "return_items",
      "employee_commissions",
      "staff_task_assignments",
      "marketing_posts",
      "marketing_attribution_events",
      "marketing_comment_events",
      "marketing_conversations",
    ]) {
      await nullProductReferences(client, stats, tableName);
    }

    await deleteFromTable(client, stats, "product_variants");
    await deleteFromTable(client, stats, "products");

    for (const tableName of [
      "product_variant_images",
      "product_images",
      "product_gallery_images",
      "product_variants",
      "products",
      "warehouse_inventory",
      "stock_transfers",
      "inventory_count_items",
      "inventory",
      "customer_wishlist",
      "recently_viewed_products",
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
    ]) {
      await resetSequence(client, stats, tableName);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[delete-all-products] rolled back", {
      message: error?.message,
      detail: error?.detail,
      constraint: error?.constraint,
    });
    throw error;
  } finally {
    client.release();
  }

  const postClient = await db.connect();
  try {
    const referencedBasenames = await collectReferencedUploadBasenames(postClient);
    const uploadResult = await deleteUnusedUploadFiles({
      candidateBasenames: productUploadCandidates,
      referencedBasenames,
    });
    const ogDeleted = await deleteProductOgFiles();
    stats.uploads.candidates = productUploadCandidates.size;
    stats.uploads.deleted = uploadResult.deleted.length + ogDeleted.length;
    stats.uploads.skipped_referenced = uploadResult.skippedReferenced.length;
  } finally {
    postClient.release();
    await db.end();
  }

  console.log("[delete-all-products] completed", {
    deleted_product_count: stats.deleted.products || 0,
    deleted_variant_count: stats.deleted.product_variants || 0,
    deleted_image_count: (stats.deleted.product_variant_images || 0) + (stats.deleted.product_images || 0) + (stats.deleted.product_gallery_images || 0),
    deleted_inventory_rows:
      (stats.deleted.warehouse_inventory || 0) +
      (stats.deleted.stock_transfers || 0) +
      (stats.deleted.inventory_count_items || 0) +
      (stats.deleted.inventory || 0),
    deleted: stats.deleted,
    updated_preserved_history_rows: stats.updated,
    removed_upload_files: stats.uploads.deleted,
    skipped_referenced_upload_files: stats.uploads.skipped_referenced,
    reset_sequences: stats.reset_sequences,
  });
};

main().catch(async (error) => {
  await db.end().catch(() => {});
  console.error("[delete-all-products] failed", error);
  process.exitCode = 1;
});
