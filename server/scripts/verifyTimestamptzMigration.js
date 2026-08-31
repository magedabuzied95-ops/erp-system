#!/usr/bin/env node
/*
 * Proof that the Cairo timestamptz migration moved no row in time.
 *
 * The migration's whole claim is that it changes how the database *reads* a value, never the
 * moment the value denotes. This checks that claim over every timestamp column in the database
 * rather than a sample: for each one it sums the epoch seconds of every non-null value and counts
 * the nulls, giving a fingerprint that any three-hour shift would break immediately.
 *
 *   BEFORE the migration:  node server/scripts/verifyTimestamptzMigration.js --before
 *   (run the migration)
 *   AFTER  the migration:  node server/scripts/verifyTimestamptzMigration.js --after
 *
 * Before-fingerprints read naive columns as UTC — the same declaration the migration makes — so
 * an unchanged fingerprint means every instant survived. A changed one means stop and restore.
 *
 * The snapshot is written next to this script as timestamptz-fingerprint.json.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(HERE, "timestamptz-fingerprint.json");

const mode = process.argv.includes("--after") ? "after" : "before";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "erp_db",
  password: process.env.PGPASSWORD || "065342",
  port: Number(process.env.PGPORT) || 5432,
  // No statement timeout: a fingerprint scans every row of every table.
  statement_timeout: 0,
});

const listTimestampColumns = async () => {
  const result = await pool.query(`
    SELECT c.relname AS table_name,
           a.attname AS column_name,
           format_type(a.atttypid, NULL) AS data_type
    FROM pg_attribute a
    JOIN pg_class c     ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.atttypid IN ('timestamp without time zone'::regtype, 'timestamptz'::regtype)
    ORDER BY c.relname, a.attname
  `);
  return result.rows;
};

const fingerprint = async ({ table_name, column_name, data_type }) => {
  /*
   * A naive column is declared UTC here, exactly as the migration declares it. After the
   * migration the column is already an instant and needs no declaration. If the two agree, the
   * conversion preserved the moment.
   */
  const expression = data_type.startsWith("timestamp without")
    ? `("${column_name}" AT TIME ZONE 'UTC')`
    : `"${column_name}"`;
  const result = await pool.query(`
    SELECT
      COUNT(*)::bigint                                          AS rows,
      COUNT("${column_name}")::bigint                           AS non_null,
      COALESCE(SUM(FLOOR(EXTRACT(EPOCH FROM ${expression})))::numeric, 0)::text AS epoch_sum,
      COALESCE(MIN(EXTRACT(EPOCH FROM ${expression}))::bigint, 0)::text         AS epoch_min,
      COALESCE(MAX(EXTRACT(EPOCH FROM ${expression}))::bigint, 0)::text         AS epoch_max
    FROM public."${table_name}"
  `);
  const row = result.rows[0];
  return {
    rows: Number(row.rows),
    non_null: Number(row.non_null),
    epoch_sum: row.epoch_sum,
    epoch_min: row.epoch_min,
    epoch_max: row.epoch_max,
    type: data_type,
  };
};

const run = async () => {
  const tz = await pool.query("SHOW timezone");
  const columns = await listTimestampColumns();
  const naive = columns.filter((column) => column.data_type.startsWith("timestamp without")).length;

  console.log(`[tz-verify] mode=${mode} timezone=${tz.rows[0].TimeZone} columns=${columns.length} (naive: ${naive}, instant: ${columns.length - naive})`);

  const marks = {};
  let scanned = 0;
  for (const column of columns) {
    const key = `${column.table_name}.${column.column_name}`;
    try {
      marks[key] = await fingerprint(column);
    } catch (error) {
      marks[key] = { error: String(error?.message || error) };
    }
    scanned += 1;
    if (scanned % 100 === 0) console.log(`[tz-verify]   ${scanned}/${columns.length}`);
  }

  if (mode === "before") {
    await fs.writeFile(SNAPSHOT, JSON.stringify({ takenAt: new Date().toISOString(), timezone: tz.rows[0].TimeZone, marks }, null, 2), "utf8");
    console.log(`[tz-verify] fingerprint of ${Object.keys(marks).length} columns written to ${SNAPSHOT}`);
    console.log("[tz-verify] run the migration, then re-run with --after");
    return 0;
  }

  const previous = JSON.parse(await fs.readFile(SNAPSHOT, "utf8"));
  const drifted = [];
  const missing = [];
  const stillNaive = [];

  for (const [key, before] of Object.entries(previous.marks)) {
    const after = marks[key];
    if (!after) { missing.push(key); continue; }
    if (before.error || after.error) continue;
    if (before.epoch_sum !== after.epoch_sum || before.non_null !== after.non_null || before.rows !== after.rows) {
      drifted.push({ key, before, after });
    }
  }
  for (const [key, after] of Object.entries(marks)) {
    if (after.type?.startsWith("timestamp without")) stillNaive.push(key);
  }

  console.log("");
  console.log(`[tz-verify] columns compared : ${Object.keys(previous.marks).length}`);
  console.log(`[tz-verify] moved in time    : ${drifted.length}`);
  console.log(`[tz-verify] missing after    : ${missing.length}`);
  console.log(`[tz-verify] still naive      : ${stillNaive.length}`);

  if (drifted.length) {
    console.log("\n[tz-verify] THESE COLUMNS MOVED — restore the backup:");
    for (const entry of drifted.slice(0, 20)) {
      const shift = (Number(entry.after.epoch_sum) - Number(entry.before.epoch_sum)) / Math.max(1, entry.after.non_null);
      console.log(`  ${entry.key}: ${entry.before.epoch_sum} -> ${entry.after.epoch_sum} (~${Math.round(shift / 3600)}h per row)`);
    }
  }
  if (missing.length) console.log("\n[tz-verify] disappeared:", missing.slice(0, 20).join(", "));
  if (stillNaive.length) console.log("\n[tz-verify] not converted:", stillNaive.slice(0, 20).join(", "));

  const ok = drifted.length === 0 && missing.length === 0 && stillNaive.length === 0;
  console.log(`\n[tz-verify] ${ok ? "PASS — every instant survived and every column is an instant" : "FAIL"}`);
  return ok ? 0 : 1;
};

run()
  .then(async (code) => { await pool.end(); process.exit(code); })
  .catch(async (error) => { console.error("[tz-verify] failed", error); await pool.end(); process.exit(1); });
