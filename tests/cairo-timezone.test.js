/*
 * The database keeps the Cairo calendar.
 *
 * Every timestamp column is a `timestamptz` — an absolute instant — and the database session runs
 * Africa/Cairo, so `CURRENT_DATE`, `created_at::date` and every range comparison resolve against
 * the day the shop actually had. Before this, they resolved at midnight UTC (02:00/03:00 Cairo),
 * so a sale rung up at 01:30 was counted on the previous day by every report, shift close and
 * "today" KPI in the system.
 *
 * Two halves: source guards that keep the fix from being undone by the next `ensureXSchema()`, and
 * a live database check of the day boundary itself. The live half skips without a database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
// fileURLToPath, not pathname: the repository lives under "Tiger Store" and a raw pathname
// keeps the space percent-encoded, which readdirSync cannot open.
const SERVER_DIR = path.join(fileURLToPath(root), "server");
const read = (relative) => fs.readFileSync(new URL(relative, root), "utf8");

const db = read("server/database/db.js");
const migration = read("server/database/migrations/2026-08-31-timestamptz-cairo.sql");

/* Exactly the pattern the sweep rewrote. If it matches again, a naive column crept back in. */
const NAIVE_DDL = /(?<!CURRENT_)\bTIMESTAMP\b(?!TZ)(?!\s*')(?=\s*(?:NULL|NOT\s+NULL|DEFAULT|,|\)|`|"|'|$))/gm;

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Historical migrations are a record of what was run and are deliberately left alone.
    if (full.includes(path.join("database", "migrations")) || full.includes("node_modules")) continue;
    if (entry.isDirectory()) walk(full, out);
    else if ([".js", ".sql"].includes(path.extname(entry.name))) out.push(full);
  }
  return out;
};

test("no schema code creates a naive timestamp column", () => {
  const offenders = [];
  for (const file of walk(SERVER_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    NAIVE_DDL.lastIndex = 0;
    const matches = source.match(NAIVE_DDL);
    if (matches) offenders.push(`${path.relative(process.cwd(), file)} (${matches.length})`);
  }
  assert.deepEqual(
    offenders,
    [],
    `these files would add columns the day boundary cannot read correctly:\n  ${offenders.join("\n  ")}`
  );
});

test("the pool pins the database session to Cairo", () => {
  assert.match(db, /PGTIMEZONE\s*\|\|\s*"Africa\/Cairo"/, "the zone is a name, not a fixed offset — Egypt moves between +02 and +03");
  assert.match(db, /-c timezone=\$\{DB_SESSION_TIMEZONE\}/, "and it is applied to every connection");
  assert.match(db, /options: pgOptions/, "through the pool's options");
  // Replacing PGOPTIONS instead of appending would silently drop whatever the deployment set.
  assert.match(db, /\[process\.env\.PGOPTIONS \|\| "-c client_encoding=UTF8", `-c timezone=/, "appended, not replaced");
});

test("the process clock follows the session zone, and date columns are protected from it", () => {
  /*
   * node-postgres parses a bare `date` at LOCAL midnight. With the process on Africa/Cairo and
   * the default parser, attendance_date 2026-08-31 would serialise as 2026-08-30T21:00:00Z and
   * every date-only field in the API would read a day early. So the process may only move to
   * Cairo together with the parser that pins `date` to UTC midnight — both live in
   * bootstrapTimezone.js, and db.js imports it before pg.
   */
  assert.match(db.split("\n")[0], /import "\.\.\/utils\/bootstrapTimezone\.js";/, "the bootstrap runs before the pool exists");
  assert.match(db, /processClockMatchesAppTimeZone\(DB_SESSION_TIMEZONE\)/, "a process clock that disagrees with the session is called out at boot");
  const bootstrap = read("server/utils/bootstrapTimezone.js");
  assert.match(bootstrap, /setTypeParser\(DATE_OID, parseDateColumnAtUtcMidnight\)/);
  assert.match(bootstrap, /applyProcessTimeZone\(getAppTimeZone\(\)\)/);
});

test("the migration refuses to run against a database that is not UTC", () => {
  // The conversion declares every stored naive value as UTC. Run against a database that was
  // never in UTC, it would shift every row by the difference — silently, and unrecoverably.
  assert.match(migration, /RAISE EXCEPTION/, "there is an interlock");
  assert.match(migration, /current_setting\('TimeZone'\)/, "which reads the live session zone");
  assert.match(migration, /NOT IN \('UTC', 'ETC\/UTC', 'GMT', 'UCT', 'UNIVERSAL', 'ZULU'\)/);
});

test("the migration preserves the instant rather than the wall clock", () => {
  assert.match(migration, /TYPE timestamptz USING %I AT TIME ZONE ''UTC''/, "the stored clock is declared UTC, not reinterpreted as Cairo");
  // Only real tables; a partition would fail the ALTER and a view would block it.
  assert.match(migration, /c\.relkind IN \('r', 'p'\)/);
  assert.match(migration, /NOT c\.relispartition/);
  assert.match(migration, /DROP VIEW IF EXISTS/, "views are dropped and rebuilt around the conversion");
  assert.match(migration, /CREATE OR REPLACE VIEW/);
  assert.match(migration, /ALTER DATABASE %I SET timezone TO %L/);
});

test("date and time columns are deliberately left alone", () => {
  // A calendar day and a shift's start time have no instant to preserve; converting them would
  // invent a timezone they never had.
  assert.match(migration, /atttypid = 'timestamp without time zone'::regtype/, "only naive timestamps are selected");
  assert.doesNotMatch(migration, /'date'::regtype/);
  assert.doesNotMatch(migration, /'time without time zone'::regtype/);
});

/* ---------------- the live half ---------------- */

const pgConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "erp_db",
  password: process.env.PGPASSWORD || "065342",
  port: Number(process.env.PGPORT) || 5432,
  connectionTimeoutMillis: 3000,
};

const pool = await (async () => {
  try {
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const created = new Pool({ ...pgConfig, options: "-c timezone=Africa/Cairo" });
    await created.query("SELECT 1");
    return created;
  } catch {
    return null;
  }
})();

if (!pool) {
  test("cairo day boundary (skipped: no database)", { skip: true }, () => {});
} else {
  test("a sale at 01:30 Cairo counts on the day the cashier rang it up", async () => {
    // The exact shape of the bug: 01:30 Cairo on the 31st is 22:30 UTC on the 30th.
    const result = await pool.query(`
      SELECT
        (TIMESTAMPTZ '2026-08-31 01:30+03' AT TIME ZONE 'Africa/Cairo')::text AS cashier_saw,
        (TIMESTAMPTZ '2026-08-31 01:30+03')::date::text                       AS counted_on
    `);
    assert.equal(result.rows[0].cashier_saw, "2026-08-31 01:30:00");
    assert.equal(result.rows[0].counted_on, "2026-08-31", "not 2026-08-30, which is what UTC midnight gave");
  });

  test("the day boundary is Cairo midnight, not UTC midnight", async () => {
    const result = await pool.query(`
      SELECT
        (TIMESTAMPTZ '2026-08-31 00:00+03')::date::text AS first_moment_of_the_day,
        (TIMESTAMPTZ '2026-08-31 23:59+03')::date::text AS last_moment_of_the_day
    `);
    assert.equal(result.rows[0].first_moment_of_the_day, "2026-08-31");
    assert.equal(result.rows[0].last_moment_of_the_day, "2026-08-31", "the whole Cairo day falls on one report day");
  });

  test("winter and summer both follow from the zone name", async () => {
    // A fixed +03 would put January an hour out. Egypt keeps +02 in winter, +03 in summer.
    const result = await pool.query(`
      SELECT
        (TIMESTAMP '2026-01-15 12:00' AT TIME ZONE 'Africa/Cairo')::text AS winter,
        (TIMESTAMP '2026-07-15 12:00' AT TIME ZONE 'Africa/Cairo')::text AS summer
    `);
    assert.match(result.rows[0].winter, /\+02$/, "winter is +02");
    assert.match(result.rows[0].summer, /\+03$/, "summer is +03");
  });

  test.after(async () => { await pool.end().catch(() => {}); });
}
