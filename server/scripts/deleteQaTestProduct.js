import "dotenv/config";

import db from "../database/db.js";

const TARGET_NAME = "QA Test Product";
const TARGET_SKU = "QA-TEST-001-BLACK-40";
const DRY_RUN = String(process.env.DRY_RUN ?? "true").trim().toLowerCase() !== "false";

const asIds = (rows = []) => rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
const unique = (values = []) => [...new Set(values.filter((value) => value !== null && value !== undefined))];

const tableExists = async (client, tableName) => {
  const result = await client.query("SELECT to_regclass($1) AS regclass", [tableName]);
  return Boolean(result.rows[0]?.regclass);
};

const tableColumns = async (client, tableName) => {
  if (!(await tableExists(client, tableName))) return new Set();
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

const selectByIds = async (client, tableName, idColumn, ids) => {
  if (!ids.length || !(await tableExists(client, tableName))) return [];
  const columns = await tableColumns(client, tableName);
  if (!columns.has(idColumn)) return [];
  const result = await client.query(
    `SELECT * FROM ${tableName} WHERE ${idColumn} = ANY($1::bigint[]) ORDER BY id`,
    [ids]
  );
  return result.rows;
};

const deleteByIds = async (client, tableName, idColumn, ids) => {
  if (!ids.length || !(await tableExists(client, tableName))) return 0;
  const columns = await tableColumns(client, tableName);
  if (!columns.has(idColumn)) return 0;
  const result = await client.query(`DELETE FROM ${tableName} WHERE ${idColumn} = ANY($1::bigint[])`, [ids]);
  return result.rowCount || 0;
};

const scopedProductVariantWhere = ({ productIds, variantIds, productColumn = "product_id", variantColumn = "variant_id", params }) => {
  const clauses = [];
  if (productIds.length) {
    params.push(productIds);
    clauses.push(`${productColumn} = ANY($${params.length}::bigint[])`);
  }
  if (variantIds.length) {
    params.push(variantIds);
    clauses.push(`${variantColumn} = ANY($${params.length}::bigint[])`);
  }
  return clauses;
};

const deleteRows = async (client, label, sql, params, deletions) => {
  if (DRY_RUN) {
    deletions.push({ label, deleted: 0, dry_run: true });
    return 0;
  }
  const result = await client.query(sql, params);
  const deleted = result.rowCount || 0;
  deletions.push({ label, deleted });
  return deleted;
};

const findMatches = async (client) => {
  const productsResult = await client.query(
    `
    WITH matched_products AS (
      SELECT DISTINCT p.*
      FROM products p
      LEFT JOIN product_variants pv ON pv.product_id = p.id
      WHERE p.name = $1
         OR p.sku = $2
         OR pv.sku = $2
    )
    SELECT *
    FROM matched_products
    ORDER BY id
    `,
    [TARGET_NAME, TARGET_SKU]
  );
  const products = productsResult.rows;
  const productIds = asIds(products);

  const variantsResult = productIds.length
    ? await client.query(
        `
        SELECT *
        FROM product_variants
        WHERE product_id = ANY($1::bigint[])
           OR sku = $2
        ORDER BY id
        `,
        [productIds, TARGET_SKU]
      )
    : await client.query(
        `
        SELECT *
        FROM product_variants
        WHERE sku = $1
        ORDER BY id
        `,
        [TARGET_SKU]
      );
  const variants = variantsResult.rows;
  const variantIds = asIds(variants);
  const allProductIds = unique([...productIds, ...variants.map((row) => Number(row.product_id)).filter(Boolean)]);

  return { products, variants, productIds: allProductIds, variantIds };
};

const collectRows = async (client, { productIds, variantIds }) => {
  const collections = {
    inventoryRows: [],
    warehouseInventoryRows: [],
    stockTransferRows: [],
    stockMovementRows: [],
    purchaseInvoiceItems: [],
    orderItems: [],
    returnItems: [],
    productImageMappings: [],
    productUploads: [],
    cartItemRows: [],
    wishlistItemRows: [],
    storefrontSessions: [],
    qaReports: [],
  };

  if (variantIds.length && await tableExists(client, "inventory")) {
    collections.inventoryRows = await selectByIds(client, "inventory", "variant_id", variantIds);
  }
  if (variantIds.length && await tableExists(client, "warehouse_inventory")) {
    collections.warehouseInventoryRows = await selectByIds(client, "warehouse_inventory", "variant_id", variantIds);
  }
  if (variantIds.length && await tableExists(client, "stock_transfers")) {
    collections.stockTransferRows = await selectByIds(client, "stock_transfers", "variant_id", variantIds);
  }
  if ((productIds.length || variantIds.length) && await tableExists(client, "inventory_movements")) {
    const params = [];
    const clauses = scopedProductVariantWhere({ productIds, variantIds, params });
    const result = await client.query(
      `
      SELECT *
      FROM inventory_movements
      WHERE ${clauses.join(" OR ")}
      ORDER BY id
      `,
      params
    );
    collections.stockMovementRows = result.rows;
  }
  if ((productIds.length || variantIds.length) && await tableExists(client, "purchase_items")) {
    const params = [];
    const clauses = scopedProductVariantWhere({ productIds, variantIds, params });
    const result = await client.query(
      `
      SELECT *
      FROM purchase_items
      WHERE ${clauses.join(" OR ")}
      ORDER BY id
      `,
      params
    );
    collections.purchaseInvoiceItems = result.rows;
  }
  if ((productIds.length || variantIds.length) && await tableExists(client, "order_items")) {
    const params = [];
    const clauses = scopedProductVariantWhere({ productIds, variantIds, params });
    params.push(TARGET_SKU);
    clauses.push(`sku = $${params.length}`);
    params.push(TARGET_NAME);
    clauses.push(`product_name = $${params.length}`);
    const result = await client.query(
      `
      SELECT *
      FROM order_items
      WHERE ${clauses.join(" OR ")}
      ORDER BY id
      `,
      params
    );
    collections.orderItems = result.rows;
  }
  const orderItemIds = asIds(collections.orderItems);
  if ((orderItemIds.length || variantIds.length) && await tableExists(client, "return_items")) {
    const params = [];
    const clauses = [];
    if (orderItemIds.length) {
      params.push(orderItemIds);
      clauses.push(`order_item_id = ANY($${params.length}::bigint[])`);
    }
    if (variantIds.length) {
      params.push(variantIds);
      clauses.push(`variant_id = ANY($${params.length}::bigint[])`);
    }
    const result = await client.query(
      `
      SELECT *
      FROM return_items
      WHERE ${clauses.join(" OR ")}
      ORDER BY id
      `,
      params
    );
    collections.returnItems = result.rows;
  }
  if ((productIds.length || variantIds.length) && await tableExists(client, "product_variant_images")) {
    const params = [];
    const clauses = scopedProductVariantWhere({ productIds, variantIds, params });
    const result = await client.query(
      `
      SELECT *
      FROM product_variant_images
      WHERE ${clauses.join(" OR ")}
      ORDER BY id
      `,
      params
    );
    collections.productImageMappings = result.rows;
  }
  if (productIds.length) {
    const result = await client.query(
      `
      SELECT id, image_url, gallery_images
      FROM products
      WHERE id = ANY($1::bigint[])
      ORDER BY id
      `,
      [productIds]
    );
    collections.productUploads = result.rows.flatMap((row) => [
      ...(row.image_url ? [{ product_id: row.id, source: "products.image_url", value: row.image_url }] : []),
      ...((Array.isArray(row.gallery_images) ? row.gallery_images : []).map((value) => ({
        product_id: row.id,
        source: "products.gallery_images",
        value,
      }))),
    ]);
  }

  for (const tableName of ["cart_items", "carts"]) {
    if (!(await tableExists(client, tableName))) continue;
    const columns = await tableColumns(client, tableName);
    const clauses = [];
    const params = [];
    if (columns.has("product_id") && productIds.length) {
      params.push(productIds);
      clauses.push(`product_id = ANY($${params.length}::bigint[])`);
    }
    if (columns.has("variant_id") && variantIds.length) {
      params.push(variantIds);
      clauses.push(`variant_id = ANY($${params.length}::bigint[])`);
    }
    if (columns.has("sku")) {
      params.push(TARGET_SKU);
      clauses.push(`sku = $${params.length}`);
    }
    if (!clauses.length) continue;
    const result = await client.query(`SELECT *, '${tableName}' AS source_table FROM ${tableName} WHERE ${clauses.join(" OR ")} ORDER BY id`, params);
    collections.cartItemRows.push(...result.rows);
  }

  for (const tableName of ["wishlist_items", "wishlists"]) {
    if (!(await tableExists(client, tableName))) continue;
    const columns = await tableColumns(client, tableName);
    const clauses = [];
    const params = [];
    if (columns.has("product_id") && productIds.length) {
      params.push(productIds);
      clauses.push(`product_id = ANY($${params.length}::bigint[])`);
    }
    if (columns.has("variant_id") && variantIds.length) {
      params.push(variantIds);
      clauses.push(`variant_id = ANY($${params.length}::bigint[])`);
    }
    if (columns.has("sku")) {
      params.push(TARGET_SKU);
      clauses.push(`sku = $${params.length}`);
    }
    if (!clauses.length) continue;
    const result = await client.query(`SELECT *, '${tableName}' AS source_table FROM ${tableName} WHERE ${clauses.join(" OR ")} ORDER BY id`, params);
    collections.wishlistItemRows.push(...result.rows);
  }

  if (await tableExists(client, "storefront_customer_sessions")) {
    const result = await client.query(
      `
      SELECT id, customer_id, cart_items, wishlist_items
      FROM storefront_customer_sessions
      WHERE cart_items::text ILIKE $1
         OR wishlist_items::text ILIKE $1
         OR cart_items::text ILIKE $2
         OR wishlist_items::text ILIKE $2
      ORDER BY id
      `,
      [`%${TARGET_SKU}%`, `%${TARGET_NAME}%`]
    );
    collections.storefrontSessions = result.rows;
  }

  if (await tableExists(client, "qa_accounting_inventory_reports")) {
    const result = await client.query(
      `
      SELECT *
      FROM qa_accounting_inventory_reports
      WHERE report::text ILIKE $1
         OR report::text ILIKE $2
      ORDER BY id
      `,
      [`%${TARGET_SKU}%`, `%${TARGET_NAME}%`]
    );
    collections.qaReports = result.rows;
  }

  return collections;
};

const printMatchedIds = ({ products, variants }, rows) => {
  console.log("\nMatched QA Test Product cleanup targets");
  console.log("DRY_RUN:", DRY_RUN);
  console.table({
    product_ids: products.map((row) => row.id).join(", ") || "(none)",
    variant_ids: variants.map((row) => row.id).join(", ") || "(none)",
    inventory_rows: rows.inventoryRows.map((row) => row.id).join(", ") || "(none)",
    warehouse_inventory_rows: rows.warehouseInventoryRows.map((row) => row.id).join(", ") || "(none)",
    stock_transfer_rows: rows.stockTransferRows.map((row) => row.id).join(", ") || "(none)",
    stock_movement_rows: rows.stockMovementRows.map((row) => row.id).join(", ") || "(none)",
    purchase_invoice_items: rows.purchaseInvoiceItems.map((row) => row.id).join(", ") || "(none)",
    order_items: rows.orderItems.map((row) => row.id).join(", ") || "(none)",
    return_items: rows.returnItems.map((row) => row.id).join(", ") || "(none)",
    product_image_mappings: rows.productImageMappings.map((row) => row.id).join(", ") || "(none)",
    cart_items: rows.cartItemRows.map((row) => `${row.source_table}:${row.id}`).join(", ") || "(none)",
    wishlist_items: rows.wishlistItemRows.map((row) => `${row.source_table}:${row.id}`).join(", ") || "(none)",
    storefront_sessions: rows.storefrontSessions.map((row) => row.id).join(", ") || "(none)",
    qa_reports: rows.qaReports.map((row) => row.id).join(", ") || "(none)",
  });
  console.log("Product uploads/images found:");
  console.table(rows.productUploads.length ? rows.productUploads : [{ value: "(none)" }]);
};

const cleanupJsonSessions = async (client, rows, deletions) => {
  if (!rows.storefrontSessions.length || !(await tableExists(client, "storefront_customer_sessions"))) return;
  if (DRY_RUN) {
    deletions.push({ label: "storefront_customer_sessions JSON cart/wishlist items", deleted: 0, dry_run: true });
    return;
  }
  for (const session of rows.storefrontSessions) {
    const filterItems = (items) =>
      (Array.isArray(items) ? items : []).filter((item) => {
        const itemText = JSON.stringify(item);
        return !itemText.includes(TARGET_SKU) && !itemText.includes(TARGET_NAME);
      });
    await client.query(
      `
      UPDATE storefront_customer_sessions
      SET cart_items = $1::jsonb,
          wishlist_items = $2::jsonb,
          updated_at = NOW()
      WHERE id = $3
      `,
      [JSON.stringify(filterItems(session.cart_items)), JSON.stringify(filterItems(session.wishlist_items)), session.id]
    );
  }
  deletions.push({ label: "storefront_customer_sessions JSON cart/wishlist items", deleted: rows.storefrontSessions.length });
};

const performCleanup = async (client, targets, rows) => {
  const { productIds, variantIds } = targets;
  const orderItemIds = asIds(rows.orderItems);
  const purchaseItemIds = asIds(rows.purchaseInvoiceItems);
  const imageMappingIds = asIds(rows.productImageMappings);
  const returnItemIds = asIds(rows.returnItems);
  const deletions = [];

  await cleanupJsonSessions(client, rows, deletions);

  for (const row of rows.cartItemRows) {
    await deleteRows(client, `${row.source_table} #${row.id}`, `DELETE FROM ${row.source_table} WHERE id = $1`, [row.id], deletions);
  }
  for (const row of rows.wishlistItemRows) {
    await deleteRows(client, `${row.source_table} #${row.id}`, `DELETE FROM ${row.source_table} WHERE id = $1`, [row.id], deletions);
  }

  await deleteRows(client, "return_items for QA order items/variants", "DELETE FROM return_items WHERE id = ANY($1::bigint[])", [returnItemIds], deletions);
  await deleteRows(client, "order_items for QA product only", "DELETE FROM order_items WHERE id = ANY($1::bigint[])", [orderItemIds], deletions);
  await deleteRows(client, "purchase_items for QA product only", "DELETE FROM purchase_items WHERE id = ANY($1::bigint[])", [purchaseItemIds], deletions);

  if (await tableExists(client, "inventory")) {
    await deleteRows(client, "inventory rows", "DELETE FROM inventory WHERE variant_id = ANY($1::bigint[])", [variantIds], deletions);
  }
  if (await tableExists(client, "warehouse_inventory")) {
    await deleteRows(client, "warehouse_inventory rows", "DELETE FROM warehouse_inventory WHERE variant_id = ANY($1::bigint[])", [variantIds], deletions);
  }
  if (await tableExists(client, "stock_transfers")) {
    await deleteRows(client, "stock_transfers rows", "DELETE FROM stock_transfers WHERE variant_id = ANY($1::bigint[])", [variantIds], deletions);
  }
  if (await tableExists(client, "inventory_movements")) {
    await deleteRows(
      client,
      "inventory_movements rows",
      "DELETE FROM inventory_movements WHERE product_id = ANY($1::bigint[]) OR variant_id = ANY($2::bigint[])",
      [productIds, variantIds],
      deletions
    );
  }
  if (await tableExists(client, "qa_accounting_inventory_reports")) {
    await deleteRows(client, "QA report rows", "DELETE FROM qa_accounting_inventory_reports WHERE id = ANY($1::bigint[])", [asIds(rows.qaReports)], deletions);
  }
  await deleteRows(client, "product_variant_images mappings", "DELETE FROM product_variant_images WHERE id = ANY($1::bigint[])", [imageMappingIds], deletions);
  await deleteRows(client, "product_variants", "DELETE FROM product_variants WHERE id = ANY($1::bigint[])", [variantIds], deletions);
  await deleteRows(client, "products", "DELETE FROM products WHERE id = ANY($1::bigint[])", [productIds], deletions);

  return deletions;
};

const validateNoRowsRemain = async (client) => {
  const result = await client.query(
    `
    SELECT 'products' AS table_name, COUNT(*)::int AS count
    FROM products
    WHERE name = $1 OR sku = $2
    UNION ALL
    SELECT 'product_variants' AS table_name, COUNT(*)::int AS count
    FROM product_variants
    WHERE sku = $2
    UNION ALL
    SELECT 'order_items' AS table_name, COUNT(*)::int AS count
    FROM order_items
    WHERE product_name = $1 OR sku = $2
    UNION ALL
    SELECT 'purchase_items' AS table_name, COUNT(*)::int AS count
    FROM purchase_items pi
    LEFT JOIN products p ON p.id = pi.product_id
    LEFT JOIN product_variants pv ON pv.id = pi.variant_id
    WHERE p.name = $1 OR p.sku = $2 OR pv.sku = $2
    `,
    [TARGET_NAME, TARGET_SKU]
  );
  return result.rows;
};

const main = async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const targets = await findMatches(client);
    const rows = await collectRows(client, targets);
    printMatchedIds(targets, rows);

    if (!targets.productIds.length && !targets.variantIds.length) {
      console.log("\nNo matching QA product or variant found. Nothing to delete.");
      await client.query("ROLLBACK");
      return;
    }

    const deletions = await performCleanup(client, targets, rows);
    console.log("\nCleanup actions:");
    console.table(deletions);

    if (DRY_RUN) {
      console.log("\nDRY_RUN=true, no rows were deleted. Re-run with DRY_RUN=false to permanently delete.");
      await client.query("ROLLBACK");
      return;
    }

    const validation = await validateNoRowsRemain(client);
    console.log("\nPost-delete validation:");
    console.table(validation);
    const remaining = validation.reduce((sum, row) => sum + Number(row.count || 0), 0);
    if (remaining > 0) {
      throw new Error(`Cleanup validation failed: ${remaining} matched rows remain`);
    }

    await client.query("COMMIT");
    console.log("\nPermanent cleanup completed. No rows remain for QA Test Product / QA-TEST-001-BLACK-40.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\nCleanup failed. Transaction rolled back.", {
      message: error.message,
      stack: error.stack,
    });
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
};

main();
