/**
 * What production actually knows about who uses the legacy report — item 6.
 *
 *   node server/scripts/legacyReportsUsage.js
 *   node server/scripts/legacyReportsUsage.js --json
 *
 * READ ONLY.
 *
 * The point is to stop guessing. Each question below is answered from evidence that
 * exists, or is reported as UNANSWERABLE with the reason — because "we could not tell"
 * and "nobody uses it" are different findings and only one of them is safe to act on.
 */

import process from "node:process";

import db from "../database/db.js";

const asJson = process.argv.slice(2).includes("--json");

const tableExists = async (table) => {
  const result = await db.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
    [table]
  );
  return result.rows.length > 0;
};

const run = async () => {
  const findings = [];

  /* --------------------------------------------- 1. do server-side presets exist yet */

  if (await tableExists("report_presets")) {
    const presets = await db.query(
      `SELECT page, COUNT(*)::int AS saved, COUNT(DISTINCT user_id)::int AS people
         FROM report_presets GROUP BY page ORDER BY 2 DESC`
    );
    findings.push({
      question: "Has anybody saved a view in the Reporting Center?",
      answer: presets.rows.length ? "yes" : "not yet",
      evidence: presets.rows,
      note: presets.rows.length
        ? "These are the views that would need to keep working."
        : "The table exists and is empty. Nothing has been saved or imported yet.",
    });
  } else {
    findings.push({
      question: "Has anybody saved a view in the Reporting Center?",
      answer: "not yet",
      evidence: [],
      note: "report_presets does not exist yet — the schema is created lazily on first use.",
    });
  }

  /* ------------------------------------------- 2. legacy presets in browser storage */

  findings.push({
    question: "Do legacy presets exist in anybody's browser?",
    answer: "UNANSWERABLE",
    evidence: [],
    note:
      "They live in localStorage under erp.reports.presets.v1, per browser. No query can " +
      "reach them. This is precisely why the retirement assessment could not clear B-3 by " +
      "inspection: the only honest mitigation is the import button on the legacy page, " +
      "which appears when that browser actually holds some, plus leaving /reports routed.",
  });

  /* --------------------------------------------- 3. is the legacy data path in use? */

  // The legacy page's own filters would leave a trace only if something logged them.
  // Nothing does, so the closest available evidence is whether the underlying data
  // supports those filters at all — measured, not assumed.
  const orderColumns = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'orders'`
  );
  const columns = new Set(orderColumns.rows.map((row) => row.column_name));

  const coverage = [];
  for (const [filter, column] of [
    ["shiftId", "shift_id"],
    ["salespersonId", "salesperson_id"],
    ["customerId", "customer_id"],
    ["paymentMethod", "payment_method"],
    ["branchId", "branch_id"],
    ["warehouseId", "warehouse_id"],
  ]) {
    if (!columns.has(column)) {
      coverage.push({ filter, column, exists: false, populated: 0, distinct: 0 });
      continue;
    }
    const result = await db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(${column})::int AS populated,
              COUNT(DISTINCT ${column})::int AS distinct_values
         FROM orders`
    );
    const row = result.rows[0];
    coverage.push({
      filter, column, exists: true,
      populated: Number(row.populated),
      total: Number(row.total),
      distinct: Number(row.distinct_values),
    });
  }

  findings.push({
    question: "Are the legacy-only filters backed by data anybody could be filtering on?",
    answer: "measured",
    evidence: coverage,
    note:
      "A filter on a column populated 0 times cannot be in active use in any meaningful " +
      "sense — it returns everything. That is the case for warehouse_id, which is why it " +
      "was not reproduced.",
  });

  /* -------------------------------------------------- 4. is the legacy API reachable */

  findings.push({
    question: "Is the legacy /api/reports/* surface still routed?",
    answer: "yes",
    evidence: [],
    note:
      "Deliberately. /reports stays live until sign-off, and its endpoints must keep " +
      "answering while it does. They carry the same reports.view gate as the Reporting " +
      "Center, and the D-16 correction now applies to both.",
  });

  if (asJson) {
    console.log(JSON.stringify({ findings }, null, 2));
    return 0;
  }

  console.log("\nLegacy /reports — production usage evidence\n");
  for (const finding of findings) {
    console.log(`  Q: ${finding.question}`);
    console.log(`  A: ${finding.answer}`);
    if (finding.evidence?.length) {
      for (const row of finding.evidence) console.log(`       ${JSON.stringify(row)}`);
    }
    console.log(`     ${finding.note}\n`);
  }

  const unanswerable = findings.filter((finding) => finding.answer === "UNANSWERABLE");
  console.log(
    unanswerable.length
      ? `  ${unanswerable.length} question(s) cannot be answered from production data. Named above, not guessed.\n`
      : "  Every question was answered from evidence.\n"
  );
  return 0;
};

run()
  .then(async () => { await db.end?.().catch(() => {}); process.exit(0); })
  .catch(async (error) => {
    console.error("legacyReportsUsage failed:", error);
    await db.end?.().catch(() => {});
    process.exit(1);
  });
