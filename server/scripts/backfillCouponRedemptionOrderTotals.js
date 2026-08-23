/**
 * Re-base `coupon_redemptions.order_total` onto goods only.
 *
 * Before the phase-0 fix, the coupon base included shipping / the service fee, so redemptions
 * recorded then have an inflated `order_total`. Campaign stats therefore mix inflated historic
 * rows with clean new ones, and "sales generated" reads high by the shipping of every old order.
 *
 * This rewrites `order_total` (and `final_total`, which is derived from it) to
 * `order_total - shipping`, taken from the order the redemption points at. It NEVER touches
 * `discount_amount`: that is the money actually given away and is correct as recorded — changing
 * it would rewrite history rather than correct a reporting basis.
 *
 * Deliberately a manual script, not a startup migration: a backfill that runs on boot can
 * crash-loop the backend, and this one only needs to run once.
 *
 *   node server/scripts/backfillCouponRedemptionOrderTotals.js            # dry run, prints the diff
 *   node server/scripts/backfillCouponRedemptionOrderTotals.js --apply    # writes
 */

import db from "../database/db.js";

const APPLY = process.argv.includes("--apply");

const SELECT_AFFECTED = `
  SELECT r.id,
         r.order_id,
         r.order_total::numeric      AS recorded_total,
         r.discount_amount::numeric  AS discount_amount,
         r.final_total::numeric      AS recorded_final,
         COALESCE(o.shipping_fee, o.delivery_fee, o.service_fee, 0)::numeric AS shipping,
         COALESCE(o.subtotal, 0)::numeric AS subtotal
  FROM coupon_redemptions r
  JOIN orders o ON o.id = r.order_id
  WHERE r.reversed_at IS NULL
    AND COALESCE(o.shipping_fee, o.delivery_fee, o.service_fee, 0) > 0
    -- Only rows still carrying the shipping inside the base. A row already on the new basis
    -- has order_total at or below the goods subtotal, so re-running this is a no-op.
    AND r.order_total > COALESCE(o.subtotal, 0) + 0.009
  ORDER BY r.id ASC
`;

const money = (value) => Number(Number(value || 0).toFixed(2));

const run = async () => {
  const { rows } = await db.query(SELECT_AFFECTED);
  if (!rows.length) {
    console.log("[backfill] nothing to do — no redemption still carries shipping in its base.");
    return { scanned: 0, updated: 0 };
  }

  let updated = 0;
  console.log(`[backfill] ${rows.length} redemption row(s) to re-base${APPLY ? "" : " (dry run)"}`);
  for (const row of rows) {
    const shipping = money(row.shipping);
    const nextTotal = Math.max(0, money(row.recorded_total) - shipping);
    const nextFinal = Math.max(0, nextTotal - money(row.discount_amount));
    console.log(
      `  redemption ${row.id} (order ${row.order_id}): ` +
        `total ${money(row.recorded_total)} → ${nextTotal}, ` +
        `final ${money(row.recorded_final)} → ${nextFinal} (shipping ${shipping})`
    );
    if (!APPLY) continue;
    await db.query(
      "UPDATE coupon_redemptions SET order_total = $2, final_total = $3 WHERE id = $1",
      [row.id, nextTotal, nextFinal]
    );
    updated += 1;
  }

  if (APPLY) console.log(`[backfill] updated ${updated} row(s).`);
  else console.log("[backfill] dry run only — re-run with --apply to write these values.");
  return { scanned: rows.length, updated };
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[backfill] failed:", error);
    process.exit(1);
  });
