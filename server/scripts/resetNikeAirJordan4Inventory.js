import db from "../database/db.js";
import { getVariantStockReconciliation } from "../services/stockReconciliationService.js";

const DEFAULT_PRODUCT_NAME = "Nike Air Jordan 4";

const apply = process.argv.includes("--apply");
const productNameArg = process.argv.find((arg) => arg.startsWith("--product-name="));
const targetProductName = productNameArg
  ? productNameArg.slice("--product-name=".length).trim()
  : DEFAULT_PRODUCT_NAME;
const productIdArg = process.argv.find((arg) => arg.startsWith("--product-id="));
const requestedProductId = productIdArg ? Number(productIdArg.slice("--product-id=".length)) : null;
const purchaseIdsArg = process.argv.find((arg) => arg.startsWith("--purchase-ids="));
const requestedPurchaseIds = purchaseIdsArg
  ? purchaseIdsArg
      .slice("--purchase-ids=".length)
      .split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isFinite(id) && id > 0)
  : [];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const main = async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const productResult = await client.query(
      `
      SELECT id, name
      FROM products
      WHERE name = $1
        AND ($2::bigint IS NULL OR id = $2::bigint)
      ORDER BY id ASC
      `,
      [targetProductName, requestedProductId]
    );

    if (productResult.rows.length !== 1) {
      throw new Error(`Expected exactly one product named "${targetProductName}", found ${productResult.rows.length}`);
    }

    const product = productResult.rows[0];
    const variantsResult = await client.query(
      `
      SELECT id, product_id, color, size, sku, COALESCE(stock, 0)::int AS stock
      FROM product_variants
      WHERE product_id = $1
      ORDER BY id ASC
      FOR UPDATE
      `,
      [product.id]
    );
    const variants = variantsResult.rows;
    const variantIds = variants.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

    const before = await getVariantStockReconciliation(client, { productId: product.id, variantIds });

    const relatedPurchasesResult = variantIds.length
      ? await client.query(
          `
          SELECT DISTINCT p.id, p.purchase_number, p.client_request_id, p.purchase_save_id, p.stock_applied, p.created_at
          FROM purchases p
          JOIN purchase_items pi ON pi.purchase_id = p.id
          WHERE pi.variant_id = ANY($1::bigint[])
          ORDER BY p.id ASC
          `,
          [variantIds]
        )
      : { rows: [] };
    const purchaseIds = relatedPurchasesResult.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
    const allPurchaseIds = [...new Set([...purchaseIds, ...requestedPurchaseIds])];

    const warehouseStockBeforeResult = variantIds.length
      ? await client.query(
          `
          SELECT
            variant_id,
            COUNT(*)::int AS row_count,
            COALESCE(SUM(stock), 0)::int AS stock
          FROM warehouse_inventory
          WHERE variant_id = ANY($1::bigint[])
          GROUP BY variant_id
          ORDER BY variant_id ASC
          `,
          [variantIds]
        )
      : { rows: [] };

    const journalPreviewResult = allPurchaseIds.length
      ? await client.query(
          `
          SELECT id, entry_number, reference_type, reference_id
          FROM journal_entries
          WHERE reference_type = 'purchase'
            AND reference_id = ANY($1::bigint[])
          ORDER BY id ASC
          `,
          [allPurchaseIds]
        )
      : { rows: [] };
    const journalEntryIds = journalPreviewResult.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);

    const movementPreviewResult = variantIds.length
      ? await client.query(
          `
          SELECT
            COUNT(*)::int AS movement_count,
            COALESCE(SUM(quantity_change), 0)::int AS movement_quantity_sum
          FROM inventory_movements
          WHERE variant_id = ANY($1::bigint[])
            AND (
              reference_type = 'purchase'
              OR movement_type IN ('purchase', 'purchase_receive', 'purchase_receiving')
              OR reference_id = ANY($2::bigint[])
            )
          `,
          [variantIds, allPurchaseIds]
        )
      : { rows: [{ movement_count: 0, movement_quantity_sum: 0 }] };

    const purchaseItemsPreviewResult = allPurchaseIds.length
      ? await client.query(
          "SELECT COUNT(*)::int AS count FROM purchase_items WHERE purchase_id = ANY($1::bigint[])",
          [allPurchaseIds]
        )
      : { rows: [{ count: 0 }] };

    const logPayload = {
      mode: apply ? "apply" : "dry-run",
      product,
      variant_ids: variantIds,
      stock_before: variants.map((variant) => ({
        variant_id: variant.id,
        color: variant.color,
        size: variant.size,
        stock: toNumber(variant.stock),
      })),
      reconciliation_before: before.summary,
      affected_purchase_ids: allPurchaseIds,
      affected_purchases: relatedPurchasesResult.rows,
      affected_journal_entry_ids: journalEntryIds,
      warehouse_stock_before: warehouseStockBeforeResult.rows,
      purchase_items_to_delete: toNumber(purchaseItemsPreviewResult.rows[0]?.count),
      purchase_movements_to_delete: toNumber(movementPreviewResult.rows[0]?.movement_count),
      purchase_movement_quantity_sum: toNumber(movementPreviewResult.rows[0]?.movement_quantity_sum),
    };

    if (!apply) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify(logPayload, null, 2));
      return;
    }

    const deletedMovements = variantIds.length
      ? await client.query(
          `
          DELETE FROM inventory_movements
          WHERE variant_id = ANY($1::bigint[])
            AND (
              reference_type = 'purchase'
              OR movement_type IN ('purchase', 'purchase_receive', 'purchase_receiving')
              OR reference_id = ANY($2::bigint[])
            )
          RETURNING id, variant_id, quantity_change, reference_type, reference_id, movement_type
          `,
          [variantIds, allPurchaseIds]
        )
      : { rows: [] };

    const deletedJournalLines = journalEntryIds.length
      ? await client.query(
          "DELETE FROM journal_entry_lines WHERE journal_entry_id = ANY($1::bigint[]) RETURNING id, journal_entry_id",
          [journalEntryIds]
        )
      : { rows: [] };

    const deletedJournalEntries = journalEntryIds.length
      ? await client.query(
          "DELETE FROM journal_entries WHERE id = ANY($1::bigint[]) RETURNING id, entry_number, reference_type, reference_id",
          [journalEntryIds]
        )
      : { rows: [] };

    const deletedPurchaseItems = allPurchaseIds.length
      ? await client.query(
          "DELETE FROM purchase_items WHERE purchase_id = ANY($1::bigint[]) RETURNING id, purchase_id, variant_id, quantity",
          [allPurchaseIds]
        )
      : { rows: [] };

    const deletedPurchases = allPurchaseIds.length
      ? await client.query(
          "DELETE FROM purchases WHERE id = ANY($1::bigint[]) RETURNING id, purchase_number, client_request_id, purchase_save_id",
          [allPurchaseIds]
        )
      : { rows: [] };

    const updatedWarehouseInventory = variantIds.length
      ? await client.query(
          `
          UPDATE warehouse_inventory
          SET stock = 0
          WHERE variant_id = ANY($1::bigint[])
          RETURNING id, warehouse_id, variant_id, stock
          `,
          [variantIds]
        )
      : { rows: [] };

    await client.query(
      `
      UPDATE product_variants
      SET stock = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY($1::bigint[])
      `,
      [variantIds]
    );

    await client.query(
      `
      UPDATE products
      SET stock = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [product.id]
    );

    const after = await getVariantStockReconciliation(client, { productId: product.id, variantIds });
    const warehouseStockAfterResult = variantIds.length
      ? await client.query(
          `
          SELECT
            variant_id,
            COUNT(*)::int AS row_count,
            COALESCE(SUM(stock), 0)::int AS stock
          FROM warehouse_inventory
          WHERE variant_id = ANY($1::bigint[])
          GROUP BY variant_id
          HAVING COALESCE(SUM(stock), 0) <> 0
          ORDER BY variant_id ASC
          `,
          [variantIds]
        )
      : { rows: [] };

    if (after.summary.stored_stock_total !== 0 || after.summary.movement_stock_total !== 0 || after.summary.mismatch_count !== 0) {
      throw new Error(`Reset verification failed: ${JSON.stringify(after.summary)}`);
    }
    if (warehouseStockAfterResult.rows.length) {
      throw new Error(`Warehouse reset verification failed: ${JSON.stringify(warehouseStockAfterResult.rows)}`);
    }

    await client.query("COMMIT");

    console.log(JSON.stringify({
      ...logPayload,
      deleted_movement_count: deletedMovements.rows.length,
      deleted_purchase_item_count: deletedPurchaseItems.rows.length,
      deleted_purchase_ids: deletedPurchases.rows.map((row) => row.id),
      deleted_journal_entry_count: deletedJournalEntries.rows.length,
      deleted_journal_line_count: deletedJournalLines.rows.length,
      warehouse_rows_updated: updatedWarehouseInventory.rows.length,
      warehouse_stock_after: warehouseStockAfterResult.rows,
      stock_after: after.rows.map((row) => ({
        variant_id: row.variant_id,
        color: row.color,
        size: row.size,
        stored_stock: row.stored_stock,
        movement_stock: row.movement_stock,
      })),
      reconciliation_after: after.summary,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[reset-nike-air-jordan-4] failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
};

main();
