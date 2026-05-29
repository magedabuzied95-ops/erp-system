import db from "../database/db.js";
import {
  getVariantStockReconciliation,
  repairVariantStockFromMovements,
} from "../services/stockReconciliationService.js";

const readArg = (name) => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};

const toOptionalNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const repair = process.argv.includes("--repair");
const productId = toOptionalNumber(readArg("product-id") || readArg("productId"));
const tenantId = toOptionalNumber(readArg("tenant-id") || readArg("tenantId"));

const main = async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = repair
      ? await repairVariantStockFromMovements(client, { tenantId, productId })
      : await getVariantStockReconciliation(client, { tenantId, productId });

    await client.query("COMMIT");

    const mismatches = result.rows.filter((row) => row.mismatched);
    const duplicatePurchaseRows = result.rows.filter((row) => row.duplicate_purchase_movement_count > 0);

    console.log(JSON.stringify({
      mode: repair ? "repair" : "report",
      tenant_id: tenantId,
      product_id: productId,
      summary: result.summary,
      repaired_count: result.repaired_count || 0,
      mismatches: mismatches.map((row) => ({
        product_id: row.product_id,
        variant_id: row.variant_id,
        color: row.color,
        size: row.size,
        stored_stock: row.stored_stock,
        movement_stock: row.movement_stock,
        mismatch_delta: row.mismatch_delta,
      })),
      duplicate_purchase_movements: duplicatePurchaseRows.map((row) => ({
        product_id: row.product_id,
        variant_id: row.variant_id,
        color: row.color,
        size: row.size,
        duplicate_purchase_group_count: row.duplicate_purchase_group_count,
        duplicate_purchase_movement_count: row.duplicate_purchase_movement_count,
      })),
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[stock-reconcile] failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
};

main();
