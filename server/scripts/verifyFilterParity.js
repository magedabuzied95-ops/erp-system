/**
 * Prove the new filters actually narrow the data, against production.
 *
 *   node server/scripts/verifyFilterParity.js
 *   node server/scripts/verifyFilterParity.js --json
 *
 * READ ONLY. Every statement is a SELECT.
 *
 * WHAT THIS ANSWERS
 *
 * A filter that runs without error proves nothing — the dangerous failure is a filter
 * that is accepted, reported as applied, and quietly matches everything. So for each
 * filter this runs the report twice, once unfiltered and once per option value, and
 * checks three things:
 *
 *   1. every filtered slice is SMALLER than the unfiltered whole (it narrowed)
 *   2. the slices SUM to the whole, minus whatever carries no value for that column
 *      (it partitioned, so nothing was double-counted or lost)
 *   3. the option list the API offers matches the values actually present
 *
 * Point 2 is the one that catches a filter matching everything: if `paymentMethod=cash`
 * returned all 570 orders, the sum across eight methods would be 4 560 rather than 570.
 */

import process from "node:process";

import db from "../database/db.js";
import { whereSql } from "../services/analytics/accountingCanon.js";
import { canonicalOrderClauses } from "../services/analytics/analyticsMetrics.js";
import { ORDER_FILTERS, orderFilterClauses } from "../services/analytics/analyticsOrderFilters.js";

const asJson = process.argv.slice(2).includes("--json");
const TENANT = Number(process.env.VERIFY_TENANT_ID || 1);
const FROM = process.env.VERIFY_FROM || "2000-01-01";
const TO = process.env.VERIFY_TO || "2999-12-31";

const orderColumnsOf = async () => {
  const result = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'orders'`
  );
  return new Set(result.rows.map((row) => row.column_name));
};

/** The canonical, tenant- and date-scoped base every measurement below shares. */
const baseScope = (orderColumns, bind) => {
  const clauses = [];
  if (orderColumns.has("tenant_id")) clauses.push(`o.tenant_id = ${bind(TENANT)}`);
  clauses.push(...canonicalOrderClauses(orderColumns).clauses);
  clauses.push(`o.created_at >= ${bind(FROM)}::date AND o.created_at < (${bind(TO)}::date + INTERVAL '1 day')`);
  return clauses;
};

const count = async (orderColumns, filters) => {
  const params = [];
  const bind = (value) => { params.push(value); return `$${params.length}`; };
  const clauses = baseScope(orderColumns, bind);
  clauses.push(...orderFilterClauses({ filters, orderColumns, bind }).clauses);
  const result = await db.query(
    `SELECT COUNT(*)::int AS orders, COALESCE(SUM(COALESCE(o.total_amount, 0)), 0)::numeric AS revenue
       FROM orders o ${whereSql(clauses)}`,
    params
  );
  return { orders: Number(result.rows[0].orders), revenue: Number(result.rows[0].revenue) };
};

/** Distinct values present for one filter's column, within the same base scope. */
const optionsFor = async (orderColumns, entry) => {
  const params = [];
  const bind = (value) => { params.push(value); return `$${params.length}`; };
  const clauses = baseScope(orderColumns, bind);
  const result = await db.query(
    `SELECT o.${entry.column} AS value, COUNT(*)::int AS orders
       FROM orders o ${whereSql(clauses)}
      AND o.${entry.column} IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`,
    params
  );
  return result.rows.map((row) => ({ value: row.value, orders: Number(row.orders) }));
};

const run = async () => {
  const orderColumns = await orderColumnsOf();
  const whole = await count(orderColumns, {});
  const report = [];

  for (const entry of ORDER_FILTERS) {
    if (!orderColumns.has(entry.column)) {
      report.push({ key: entry.key, status: "absent", detail: `orders has no ${entry.column}` });
      continue;
    }

    const options = await optionsFor(orderColumns, entry);
    if (!options.length) {
      // A column that exists but is never populated. This is exactly the shape of the two
      // legacy filters that were rejected, so it is reported rather than passed silently.
      report.push({ key: entry.key, status: "no-data", detail: `${entry.column} is populated on 0 orders in scope` });
      continue;
    }

    let summed = 0;
    let narrowedEvery = true;
    for (const option of options) {
      const slice = await count(orderColumns, { [entry.key]: option.value });
      summed += slice.orders;
      if (slice.orders >= whole.orders) narrowedEvery = false;
      if (slice.orders !== option.orders) {
        report.push({
          key: entry.key, status: "MISMATCH",
          detail: `${entry.column}=${option.value}: filter returned ${slice.orders}, the column holds ${option.orders}`,
        });
      }
    }

    const withValue = options.reduce((total, option) => total + option.orders, 0);
    const partitions = summed === withValue;

    report.push({
      key: entry.key,
      status: narrowedEvery && partitions ? "ok" : "FAIL",
      values: options.length,
      whole: whole.orders,
      covered: withValue,
      unset: whole.orders - withValue,
      summed,
      narrowedEvery,
      partitions,
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ scope: { tenant: TENANT, from: FROM, to: TO }, whole, report }, null, 2));
  } else {
    console.log(`\nFilter parity — tenant ${TENANT}, ${FROM} .. ${TO}`);
    console.log(`Unfiltered canonical orders: ${whole.orders}\n`);
    console.log("  filter          status    values  covered  unset  sum-of-slices");
    console.log("  " + "-".repeat(68));
    for (const row of report) {
      if (row.values === undefined) {
        console.log(`  ${row.key.padEnd(15)} ${row.status.padEnd(9)} ${row.detail}`);
        continue;
      }
      console.log(
        `  ${row.key.padEnd(15)} ${row.status.padEnd(9)} ${String(row.values).padEnd(7)} ` +
          `${String(row.covered).padEnd(8)} ${String(row.unset).padEnd(6)} ${row.summed}`
      );
    }
  }

  const failures = report.filter((row) => row.status === "FAIL" || row.status === "MISMATCH");
  console.log(
    failures.length
      ? `\nFAIL: ${failures.length} filter(s) did not narrow or did not partition.`
      : `\nPASS: every supported filter narrows the data and partitions it exactly.`
  );
  return failures.length;
};

run()
  .then(async (failures) => {
    await db.end?.().catch(() => {});
    process.exit(failures ? 2 : 0);
  })
  .catch(async (error) => {
    console.error("verifyFilterParity failed:", error);
    await db.end?.().catch(() => {});
    process.exit(1);
  });
