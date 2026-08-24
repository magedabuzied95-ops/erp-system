/**
 * Saved presets and the column chooser — B-3 and B-4 of the retirement assessment.
 *
 * Both replace something the legacy page kept in `localStorage`, and both had explicit
 * safety conditions attached: a preset must not expose another user's saved views or
 * carry financial data, and a column preference must never override a permission.
 *
 * These are the tests for those conditions specifically, not for the features working.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MAX_PRESETS_PER_USER,
  PRESET_FILTER_KEYS,
  PRESET_PAGES,
  sanitiseFilters,
  translateLegacyFilters,
} from "../../server/services/analytics/analyticsPresetsService.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

/* ------------------------------------------------------ B-3: what a preset may hold */

test("a preset stores the question, never the answer", () => {
  // Anything that looks like a figure, a row or an identity must not survive a save.
  const hostile = {
    from: "2026-08-01", to: "2026-08-24", shiftId: "25",
    netSales: "684250", grossProfit: "216987", cogs: "467263", total: "999",
    customerName: "Someone", phone: "01000000000", rows: "[]", permissions: "reports.cost",
  };
  const clean = sanitiseFilters(hostile);

  for (const key of ["netSales", "grossProfit", "cogs", "total", "customerName", "phone", "rows", "permissions"]) {
    assert.equal(clean[key], undefined, `${key} must not be storable in a preset`);
  }
  assert.equal(clean.shiftId, "25");
  assert.equal(clean.from, "2026-08-01");
});

test("the allowlist is filters and view settings only", () => {
  // If a money-shaped key ever enters this list the test above stops meaning anything,
  // so the list itself is pinned. Matched on the WHOLE key, not a substring: an earlier
  // cut rejected `salespersonId` because it contains "sales", which would have blocked a
  // legitimate filter for looking slightly like a metric.
  const FORBIDDEN = [
    "netSales", "grossSales", "sales", "profit", "grossProfit", "cogs", "revenue",
    "total", "amount", "cost", "price", "margin", "discount", "returns",
    "customerName", "phone", "email", "rows", "data", "permissions",
  ];
  for (const key of PRESET_FILTER_KEYS) {
    assert.ok(
      !FORBIDDEN.includes(key),
      `${key} looks like data, not a filter`
    );
  }
  assert.ok(PRESET_FILTER_KEYS.includes("shiftId"));
  assert.ok(PRESET_FILTER_KEYS.includes("salespersonId"));
  // The two legacy filters with no honest equivalent must not be storable either.
  assert.ok(!PRESET_FILTER_KEYS.includes("warehouseId"));
  assert.ok(!PRESET_FILTER_KEYS.includes("employeeId"));
});

test("nested structures cannot be smuggled in as a filter value", () => {
  const clean = sanitiseFilters({ from: "2026-08-01", to: "2026-08-24", shiftId: { $ne: null }, sort: ["a", "b"] });
  assert.equal(clean.shiftId, undefined);
  assert.equal(clean.sort, undefined);
});

test("an id that is not a positive integer is dropped, not stored as text", () => {
  const clean = sanitiseFilters({
    from: "2026-08-01", to: "2026-08-24",
    shiftId: "0", salespersonId: "-1", branchId: "abc", customerId: "1; DROP TABLE orders",
  });
  for (const key of ["shiftId", "salespersonId", "branchId", "customerId"]) {
    assert.equal(clean[key], undefined, `${key} must not survive as an unusable value`);
  }
});

test("every preset page is a real reporting page", () => {
  assert.deepEqual([...PRESET_PAGES].sort(), [
    "coupons", "customers", "employees", "inventory",
    "overview", "purchasing", "reconciliation", "sales",
  ]);
});

/* --------------------------------------------------- B-3: ownership, not tenancy alone */

test("every preset query is scoped to the CALLER's user id, in the WHERE clause", async () => {
  const source = await read("../../server/services/analytics/analyticsPresetsService.js");

  // Tenant alone is not enough: two people in the same shop must not see each other's
  // saved views. Every statement that touches the table carries both.
  //
  // Each db.query template is taken whole rather than pattern-matched across the file —
  // a span that runs from one statement into the next would report the neighbour's
  // user_id as this one's and pass while the real query was unscoped.
  const statements = [...source.matchAll(/db\s*\n?\s*\.?query\(\s*`([\s\S]*?)`/g)]
    .map((match) => match[1])
    .filter((statement) => /report_presets/.test(statement))
    .filter((statement) => !/CREATE TABLE|CREATE INDEX/.test(statement));

  assert.ok(statements.length >= 4, `expected the preset statements, found ${statements.length}`);

  /**
   * A statement may carry the ownership columns literally, or interpolate a clause list
   * that carries them. Following the variable is the difference between a guard and a
   * keyword search: the list query builds `WHERE ${clauses.join(" AND ")}`, and the
   * clauses are pushed a few lines above.
   */
  const carriesOwnership = (statement, column) => {
    if (new RegExp(column).test(statement)) return true;
    const interpolated = /\$\{(\w+)\.join\(/.exec(statement);
    if (!interpolated) return false;
    const declaration = new RegExp(`const ${interpolated[1]} = \\[[\\s\\S]{0,300}?${column}`);
    return declaration.test(source);
  };

  for (const statement of statements) {
    assert.ok(carriesOwnership(statement, "user_id"), `no user_id reaches:\n${statement.slice(0, 200)}`);
    assert.ok(carriesOwnership(statement, "tenant_id"), `no tenant_id reaches:\n${statement.slice(0, 200)}`);
  }

  // The ownership check must live IN the write, not before it: a check-then-write leaves
  // a window in which the row could change hands.
  assert.match(source, /UPDATE report_presets SET \$\{sets\.join\(", "\)\}, updated_at = NOW\(\)\s*\n\s*WHERE tenant_id = \$1 AND user_id = \$2 AND id = \$3/);
  assert.match(source, /DELETE FROM report_presets WHERE tenant_id = \$1 AND user_id = \$2 AND id = \$3/);
});

test("a preset without an owner is refused rather than shared", async () => {
  const source = await read("../../server/services/analytics/analyticsPresetsService.js");
  assert.match(source, /if \(!userId\) throw Object\.assign\(new Error\("A preset needs an owner"\), \{ status: 401 \}\)/);
});

test("the schema DDL runs once per process, not per request", async () => {
  const source = await read("../../server/services/analytics/analyticsPresetsService.js");
  // ensureAccountingSchema runs its DDL on every request and that produced the 40P01
  // deadlock against the analytics reads. A cached promise means one attempt.
  assert.match(source, /let schemaPromise = null/);
  assert.match(source, /if \(!schemaPromise\)/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS report_presets/);
  assert.match(source, /CREATE INDEX IF NOT EXISTS idx_report_presets_owner/);
  // A failure must not be cached forever, or one blip disables presets until a restart.
  assert.match(source, /schemaPromise = null;\s*\n\s*throw error/);
});

/* ------------------------------------------------------------- B-3: legacy migration */

test("the legacy localStorage shape imports without losing the reader's window", () => {
  // The legacy filter object names the range differently. Translating it is the
  // difference between importing a preset and importing its name.
  const legacy = {
    preset: "month", startDate: "2026-08-01", endDate: "2026-08-24",
    warehouseId: "7", employeeId: "3", shiftId: "25", salespersonId: "9", paymentMethod: "cash",
  };
  const translated = translateLegacyFilters(legacy);
  assert.equal(translated.from, "2026-08-01");
  assert.equal(translated.to, "2026-08-24");
  assert.equal(translated.preset, "thisMonth", "legacy 'month' meant the current calendar month");
  assert.equal(translated.startDate, undefined);
  assert.equal(translated.endDate, undefined);

  const stored = sanitiseFilters(translated);
  assert.deepEqual(Object.keys(stored).sort(), ["from", "paymentMethod", "preset", "salespersonId", "shiftId", "to"]);
  // The two fake filters are gone, and the importer reports them rather than hiding it.
  assert.equal(stored.warehouseId, undefined);
  assert.equal(stored.employeeId, undefined);
});

test("legacy range names map to their real meaning, and an unknown one is dropped", () => {
  assert.equal(translateLegacyFilters({ preset: "today" }).preset, "today");
  assert.equal(translateLegacyFilters({ preset: "week" }).preset, "thisWeek");
  assert.equal(translateLegacyFilters({ preset: "month" }).preset, "thisMonth");
  assert.equal(translateLegacyFilters({ preset: "custom" }).preset, "custom");
  // Guessing would silently move somebody's saved window, which looks right and is not.
  assert.equal(translateLegacyFilters({ preset: "fortnight" }).preset, undefined);
});

test("the import is idempotent and says what it dropped", async () => {
  const source = await read("../../server/services/analytics/analyticsPresetsService.js");
  assert.match(source, /WHERE NOT EXISTS \(\s*\n\s*SELECT 1 FROM report_presets/);
  assert.match(source, /droppedFilterKeys: \[\.\.\.droppedKeys\]/);
  assert.ok(MAX_PRESETS_PER_USER > 0 && MAX_PRESETS_PER_USER <= 50);
});

/* ------------------------------------------ B-4: permission outranks preference */

test("the column chooser can only ever hide, never reveal", async () => {
  const hook = await read("../../src/modules/reports/hooks/useColumnPreferences.js");

  // The preference is applied to the columns the SERVER sent. A restricted column was
  // omitted from the payload entirely, so it is not in the candidate list and there is
  // nothing for a hand-edited storage entry to turn on.
  assert.match(hook, /\{ \.\.\.column, visible: false \}/);
  assert.ok(
    !/visible: true/.test(hook),
    "the hook must never set visible:true — that would be a preference overriding a permission"
  );

  // Comments stripped first. The chooser's own doc block explains that permissions are
  // resolved elsewhere, and a keyword search finds that prose and calls it code — the
  // same way an earlier tenant sweep passed by matching a comment about tenants.
  const chooser = (await read("../../src/modules/reports/components/ColumnChooser.jsx"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  assert.ok(!/visible: true|reports\.cost|reports\.profit|hasPermission/.test(chooser),
    "the chooser must not reason about permissions at all");
});

test("a column preference holds keys, never data", async () => {
  const hook = await read("../../src/modules/reports/hooks/useColumnPreferences.js");
  assert.match(hook, /typeof key === "string"/, "only column keys may be stored");
  assert.match(hook, /JSON\.stringify\(next\.slice\(0, 60\)\)/, "and the stored array is capped");
  // What is written must be the hidden KEYS and nothing else. There is exactly one write
  // in the file, and it writes `next` — the array of keys — and nothing derived from a row.
  const writes = [...hook.matchAll(/localStorage\.setItem\([\s\S]*?\);/g)].map((match) => match[0]);
  assert.equal(writes.length, 1, "there must be exactly one place that writes a preference");
  assert.match(writes[0], /storageKey\(page, userId\)/);
  assert.match(writes[0], /JSON\.stringify\(next\.slice\(0, 60\)\)/);
  assert.ok(!/rows|data|value|total/i.test(writes[0]), "nothing but the key list may be written");
});

test("preferences are per user, so a shared terminal does not leak a layout", async () => {
  const hook = await read("../../src/modules/reports/hooks/useColumnPreferences.js");
  assert.match(hook, /const storageKey = \(page, userId\) =>/);
  assert.match(hook, /\$\{STORAGE_PREFIX\}:\$\{page\}:\$\{userId \?\? "anon"\}/);
  // No user id means nothing is written down at all.
  assert.match(hook, /if \(typeof window === "undefined" \|\| !userId\) return \[\]/);
  assert.match(hook, /useEffect\(\(\) => \{ setHidden\(readHidden\(page, userId\)\); \}, \[page, userId\]\)/);
});

test("a column the permissions already withheld is not even offered", async () => {
  const hook = await read("../../src/modules/reports/hooks/useColumnPreferences.js");

  /*
   * Some pages keep a restricted column in the spec and mark it invisible rather than
   * omitting it — PurchasingIntelligence writes `visible: showCost`. Offering it in the
   * menu would list a column the reader may not see, show it as ticked, and do nothing
   * when unticked. The listing alone tells them a cost column exists.
   */
  assert.match(hook, /!column\.required && column\.visible !== false/);

  const purchasing = await read("../../src/modules/reports/pages/PurchasingIntelligence.jsx");
  assert.match(purchasing, /visible: showCost/, "this is the page the exclusion exists for");
  assert.match(purchasing, /const showCost = summary\.meta\?\.permissions\?\.cost !== false/,
    "and the flag must come from the server's own answer, not a client guess");
});

test("a required column cannot be hidden, and the last column cannot either", async () => {
  const hook = await read("../../src/modules/reports/hooks/useColumnPreferences.js");
  assert.match(hook, /!column\.required/);
  // An empty table is a bug report waiting to be filed against a feature working as asked.
  assert.match(hook, /if \(next\.length >= choosable\.length\) return;/);
});

test("exports already honour the same visibility rule", async () => {
  const engine = await read("../../src/modules/reports/lib/reportExport.js");
  // Four formats, one rule — so a hidden column is absent from the file rather than
  // blank in it, which is the same rule restricted money already follows.
  const sites = [...engine.matchAll(/columns\.filter\(\(column\) => column\.visible !== false\)/g)];
  assert.ok(sites.length >= 4, `expected every format to filter on visibility, found ${sites.length}`);
});
