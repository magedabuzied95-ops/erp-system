import db from "../database/db.js";
import { ensureInventoryMovementSchema } from "./inventoryMovementService.js";

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const queryable = (clientOrPool = db) => clientOrPool || db;
const isTransactionClient = (clientOrPool) => typeof clientOrPool?.release === "function";

const buildScope = ({ tenantId, productId, variantIds = [] } = {}) => {
  const clauses = [];
  const params = [];
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (tenantId !== null && tenantId !== undefined) {
    const tenantParam = push(tenantId);
    clauses.push(`(${tenantParam}::bigint IS NULL OR v.tenant_id = ${tenantParam}::bigint OR v.tenant_id IS NULL)`);
  }
  if (productId) clauses.push(`v.product_id = ${push(productId)}`);
  if (Array.isArray(variantIds) && variantIds.length) clauses.push(`v.id = ANY(${push(variantIds)}::bigint[])`);

  return {
    params,
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
  };
};

export const getVariantStockReconciliation = async (clientOrPool = db, options = {}) => {
  if (!isTransactionClient(clientOrPool)) {
    await ensureInventoryMovementSchema();
  }

  const client = queryable(clientOrPool);
  const scope = buildScope(options);
  const result = await client.query(
    `
    WITH scoped_variants AS (
      SELECT
        v.id AS variant_id,
        v.product_id,
        v.tenant_id,
        v.color,
        v.size,
        v.sku,
        COALESCE(v.stock, 0)::int AS stored_stock
      FROM product_variants v
      ${scope.where}
    ),
    active_movements AS (
      SELECT
        m.*
      FROM inventory_movements m
      JOIN scoped_variants sv ON sv.variant_id = m.variant_id
      WHERE m.undone_at IS NULL
    ),
    movement_totals AS (
      SELECT
        variant_id,
        COALESCE(SUM(quantity_change), 0)::int AS movement_stock,
        COALESCE(SUM(CASE WHEN movement_type IN ('purchase', 'purchase_receive', 'purchase_receiving') OR reference_type = 'purchase' THEN quantity_change ELSE 0 END), 0)::int AS purchase_receiving_total,
        COALESCE(SUM(CASE WHEN movement_type IN ('transfer_in') THEN quantity_change ELSE 0 END), 0)::int AS transfer_in_total,
        COALESCE(SUM(CASE WHEN movement_type IN ('transfer_out') THEN quantity_change ELSE 0 END), 0)::int AS transfer_out_total,
        COALESCE(SUM(CASE WHEN movement_type IN ('transfer', 'transfer_in', 'transfer_out') THEN quantity_change ELSE 0 END), 0)::int AS transfer_total,
        COALESCE(SUM(CASE WHEN movement_type IN ('sale', 'website_order') OR reference_type IN ('order', 'sale') THEN quantity_change ELSE 0 END), 0)::int AS sale_total,
        COALESCE(SUM(CASE WHEN movement_type IN ('return', 'return_in') OR reference_type = 'return' THEN quantity_change ELSE 0 END), 0)::int AS return_total,
        COALESCE(SUM(CASE WHEN movement_type IN ('manual_adjustment', 'product_stock_edit', 'inventory_count', 'inventory_adjustment', 'undo_adjustment', 'order_edit', 'order_cancel') THEN quantity_change ELSE 0 END), 0)::int AS adjustment_total,
        COUNT(*)::int AS movement_count
      FROM active_movements
      GROUP BY variant_id
    ),
    duplicate_purchase_movements AS (
      SELECT
        variant_id,
        COUNT(*)::int AS duplicate_group_count,
        COALESCE(SUM(extra_rows), 0)::int AS duplicate_extra_movement_count
      FROM (
        SELECT
          variant_id,
          reference_id,
          GREATEST(COUNT(*) - 1, 0)::int AS extra_rows
        FROM active_movements
        WHERE (movement_type IN ('purchase', 'purchase_receive', 'purchase_receiving') OR reference_type = 'purchase')
          AND reference_id IS NOT NULL
        GROUP BY variant_id, reference_id
        HAVING COUNT(*) > 1
      ) duplicates
      GROUP BY variant_id
    ),
    latest AS (
      SELECT DISTINCT ON (variant_id)
        variant_id,
        quantity_after AS latest_quantity_after,
        id AS latest_movement_id,
        created_at AS latest_movement_at
      FROM active_movements
      ORDER BY variant_id, created_at DESC, id DESC
    )
    SELECT
      sv.variant_id,
      sv.product_id,
      sv.color,
      sv.size,
      sv.sku,
      sv.stored_stock,
      COALESCE(mt.movement_stock, 0)::int AS movement_stock,
      COALESCE(l.latest_quantity_after, COALESCE(mt.movement_stock, 0), 0)::int AS latest_quantity_after,
      COALESCE(mt.purchase_receiving_total, 0)::int AS purchase_receiving_total,
      COALESCE(mt.transfer_in_total, 0)::int AS transfer_in_total,
      COALESCE(mt.transfer_out_total, 0)::int AS transfer_out_total,
      COALESCE(mt.transfer_total, 0)::int AS transfer_total,
      COALESCE(mt.sale_total, 0)::int AS sale_total,
      COALESCE(mt.return_total, 0)::int AS return_total,
      COALESCE(mt.adjustment_total, 0)::int AS adjustment_total,
      COALESCE(mt.movement_count, 0)::int AS movement_count,
      COALESCE(dpm.duplicate_group_count, 0)::int AS duplicate_purchase_group_count,
      COALESCE(dpm.duplicate_extra_movement_count, 0)::int AS duplicate_purchase_movement_count,
      l.latest_movement_id,
      l.latest_movement_at,
      (sv.stored_stock - COALESCE(mt.movement_stock, 0))::int AS mismatch_delta,
      (sv.stored_stock <> COALESCE(mt.movement_stock, 0)) AS mismatched
    FROM scoped_variants sv
    LEFT JOIN movement_totals mt ON mt.variant_id = sv.variant_id
    LEFT JOIN duplicate_purchase_movements dpm ON dpm.variant_id = sv.variant_id
    LEFT JOIN latest l ON l.variant_id = sv.variant_id
    ORDER BY sv.product_id ASC, sv.color ASC NULLS LAST, sv.size ASC NULLS LAST, sv.variant_id ASC
    `,
    scope.params
  );

  const rows = result.rows.map((row) => ({
    ...row,
    variant_id: Number(row.variant_id),
    product_id: Number(row.product_id),
    stored_stock: toNumber(row.stored_stock),
    movement_stock: toNumber(row.movement_stock),
    latest_quantity_after: toNumber(row.latest_quantity_after),
    purchase_receiving_total: toNumber(row.purchase_receiving_total),
    transfer_in_total: toNumber(row.transfer_in_total),
    transfer_out_total: toNumber(row.transfer_out_total),
    transfer_total: toNumber(row.transfer_total),
    sale_total: toNumber(row.sale_total),
    return_total: toNumber(row.return_total),
    adjustment_total: toNumber(row.adjustment_total),
    movement_count: toNumber(row.movement_count),
    duplicate_purchase_group_count: toNumber(row.duplicate_purchase_group_count),
    duplicate_purchase_movement_count: toNumber(row.duplicate_purchase_movement_count),
    mismatch_delta: toNumber(row.mismatch_delta),
    mismatched: Boolean(row.mismatched),
  }));

  const summary = rows.reduce(
    (acc, row) => {
      acc.variant_count += 1;
      acc.stored_stock_total += row.stored_stock;
      acc.movement_stock_total += row.movement_stock;
      acc.purchase_receiving_total += row.purchase_receiving_total;
      acc.transfer_in_total += row.transfer_in_total;
      acc.transfer_out_total += row.transfer_out_total;
      acc.transfer_total += row.transfer_total;
      acc.sale_total += row.sale_total;
      acc.return_total += row.return_total;
      acc.adjustment_total += row.adjustment_total;
      acc.movement_count += row.movement_count;
      acc.duplicate_purchase_movement_count += row.duplicate_purchase_movement_count;
      if (row.mismatched) acc.mismatch_count += 1;
      return acc;
    },
    {
      variant_count: 0,
      stored_stock_total: 0,
      movement_stock_total: 0,
      purchase_receiving_total: 0,
      transfer_in_total: 0,
      transfer_out_total: 0,
      transfer_total: 0,
      sale_total: 0,
      return_total: 0,
      adjustment_total: 0,
      movement_count: 0,
      mismatch_count: 0,
      duplicate_purchase_movement_count: 0,
    }
  );
  summary.mismatch_delta_total = summary.stored_stock_total - summary.movement_stock_total;

  return { rows, summary };
};

export const repairVariantStockFromMovements = async (clientOrPool = db, options = {}) => {
  const client = queryable(clientOrPool);
  const reconciliation = await getVariantStockReconciliation(client, options);
  const rows = reconciliation.rows.filter((row) => row.mismatched);

  for (const row of rows) {
    await client.query(
      `
      UPDATE product_variants
      SET stock = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [row.movement_stock, row.variant_id]
    );
  }

  return {
    ...reconciliation,
    repaired_count: rows.length,
  };
};
