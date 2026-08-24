/**
 * Filter parity with the legacy page — B-1 and B-2 of the retirement assessment.
 *
 * Two things had to be true before a filter control could be offered at all:
 *
 *   1. the filter must actually narrow the data, on EVERY page, not on whichever service
 *      happened to implement it. Before this, `branchId` was honoured at eleven sites,
 *      `channel` at two, `customerId` at one and `paymentMethod` at none — while all of
 *      them came back in the response envelope as though they had been applied.
 *   2. the column must be real. The legacy page offers `warehouseId` and `employeeId`
 *      controls that match every order, because `orders.warehouse_id` is populated on 0
 *      of 579 production rows and `orders.employee_id` does not exist. Reproducing those
 *      would be reproducing a lie.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import {
  ORDER_FILTERS,
  ORDER_FILTER_KEYS,
  UNSUPPORTED_LEGACY_FILTERS,
  orderFilterClauses,
} from "../../server/services/analytics/analyticsOrderFilters.js";
import { parseAnalyticsFilters } from "../../server/services/analytics/analyticsFilters.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const ALL_COLUMNS = new Set([
  "tenant_id", "branch_id", "customer_id", "channel", "payment_method",
  "shift_id", "salesperson_id", "created_at", "status", "payment_status",
]);

const bindFactory = () => {
  const params = [];
  return { params, bind: (value) => { params.push(value); return `$${params.length}`; } };
};

/* ------------------------------------------------------- the contract itself */

test("the filter set is exactly the legacy controls the data model supports", () => {
  assert.deepEqual([...ORDER_FILTER_KEYS].sort(), [
    "branchId", "channel", "customerId", "paymentMethod", "salespersonId", "shiftId",
  ]);
});

test("a legacy control with no honest equivalent is named, not silently dropped", () => {
  const keys = UNSUPPORTED_LEGACY_FILTERS.map((entry) => entry.key).sort();
  assert.deepEqual(keys, ["employeeId", "warehouseId"]);

  for (const entry of UNSUPPORTED_LEGACY_FILTERS) {
    assert.ok(entry.reason?.length > 30, `${entry.key} needs a reason somebody can check`);
    assert.ok(entry.legacyBehaviour?.length > 20, `${entry.key} must record what legacy actually did`);
    // The reason has to be a fact about the schema or the data, not an opinion.
    assert.match(entry.reason, /column|populated|writes|no employee_id/i);
  }

  // And neither may sneak into the supported set.
  for (const key of keys) assert.ok(!ORDER_FILTER_KEYS.includes(key), `${key} must not be offered`);
});

/* ------------------------------------------------------------ clause building */

test("every value is bound, never interpolated", () => {
  const { params, bind } = bindFactory();
  const { clauses, applied } = orderFilterClauses({
    filters: {
      branchId: 1, customerId: 42, channel: "pos",
      paymentMethod: "cash", shiftId: 25, salespersonId: 9,
    },
    orderColumns: ALL_COLUMNS,
    bind,
  });

  assert.equal(clauses.length, 6);
  assert.deepEqual(applied.sort(), ORDER_FILTER_KEYS.slice().sort());
  assert.deepEqual(params, [1, 42, "pos", "cash", 25, 9]);

  // No literal from the filters may appear in the SQL itself.
  const sql = clauses.join(" AND ");
  for (const literal of ["'cash'", "'pos'", "= 42", "= 25", "= 9"]) {
    assert.ok(!sql.includes(literal), `a value leaked into the SQL: ${literal}`);
  }
  assert.match(sql, /\$1[\s\S]*\$6/);
});

test("free-text filters compare case-insensitively, ids compare exactly", () => {
  const { bind } = bindFactory();
  const { clauses } = orderFilterClauses({
    filters: { paymentMethod: "CASH", channel: "POS", shiftId: 25 },
    orderColumns: ALL_COLUMNS,
    bind,
  });
  // Clause order follows ORDER_FILTERS, not the order the caller happened to write them.
  const sql = clauses.join("\n");
  assert.match(sql, /LOWER\(COALESCE\(o\.channel, ''\)\) = LOWER\(\$1\)/);
  assert.match(sql, /LOWER\(COALESCE\(o\.payment_method, ''\)\) = LOWER\(\$2\)/);
  // An id is a foreign key. Lower-casing it would be nonsense and would defeat the index.
  assert.match(sql, /o\.shift_id = \$3/);
});

test("a filter the schema cannot honour is skipped and REPORTED, never silently applied", () => {
  const { bind } = bindFactory();
  const { clauses, applied, skipped } = orderFilterClauses({
    filters: { shiftId: 25, salespersonId: 9 },
    orderColumns: new Set(["tenant_id", "created_at"]),
    bind,
  });
  assert.deepEqual(clauses, []);
  assert.deepEqual(applied, []);
  assert.deepEqual(skipped.sort(), ["salespersonId", "shiftId"]);
});

test("an absent filter contributes nothing at all", () => {
  const { params, bind } = bindFactory();
  const { clauses } = orderFilterClauses({
    filters: { branchId: undefined, channel: null, paymentMethod: "", shiftId: 0 },
    orderColumns: ALL_COLUMNS,
    bind,
  });
  // 0 is not a valid id and must not become `shift_id = 0`, which would match nothing and
  // read as a quiet week rather than as a mistake.
  assert.deepEqual(clauses, []);
  assert.deepEqual(params, []);
});

test("the alias travels, so a subquery can use the same builder", () => {
  const { bind } = bindFactory();
  const { clauses } = orderFilterClauses({
    filters: { branchId: 1 }, orderColumns: ALL_COLUMNS, bind, alias: "orders",
  });
  assert.deepEqual(clauses, ["orders.branch_id = $1"]);
});

/* -------------------------------------------------------------- parse contract */

test("the two new filters parse, and reject anything that is not a positive id", () => {
  const base = { from: "2026-08-01", to: "2026-08-24" };
  const user = { tenant_id: 1 };

  const good = parseAnalyticsFilters({ query: { ...base, shiftId: "25", salespersonId: "9" }, user });
  assert.equal(good.shiftId, 25);
  assert.equal(good.salespersonId, 9);

  // snake_case too, because the legacy page's own links used it.
  const snake = parseAnalyticsFilters({ query: { ...base, shift_id: "25", salesperson_id: "9" }, user });
  assert.equal(snake.shiftId, 25);
  assert.equal(snake.salespersonId, 9);

  for (const bad of ["0", "-3", "abc", "1; DROP TABLE orders", ""]) {
    const parsed = parseAnalyticsFilters({ query: { ...base, shiftId: bad, salespersonId: bad }, user });
    assert.ok(!parsed.shiftId, `shiftId must reject ${JSON.stringify(bad)}`);
    assert.ok(!parsed.salespersonId, `salespersonId must reject ${JSON.stringify(bad)}`);
  }
});

/* ------------------------------------------- one implementation, used everywhere */

test("every order-scoped service filters through the shared builder", async () => {
  const dir = new URL("../../server/services/analytics/", import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith("Service.js"));

  const orderScoped = [];
  for (const file of files) {
    const source = await read(`../../server/services/analytics/${file}`);
    // A service that builds order clauses of its own is one that must use the builder.
    if (!/const orderClauses = \[\]/.test(source)) continue;
    orderScoped.push(file);
    assert.match(
      source,
      /orderFilterClauses\(\{ filters, orderColumns, bind \}\)/,
      `${file} builds its own order clauses without the shared filter builder`
    );
  }
  assert.ok(orderScoped.length >= 5, `expected the order-scoped services, found ${orderScoped.join(", ")}`);

  // And none may keep a hand-rolled copy, or the drift starts again.
  for (const file of orderScoped) {
    const source = await read(`../../server/services/analytics/${file}`);
    assert.ok(
      !/filters\.branchId && orderColumns\.has\("branch_id"\)/.test(source),
      `${file} still applies branchId by hand`
    );
    assert.ok(
      !/filters\.channel && orderColumns\.has\("channel"\)\) orderClauses/.test(source),
      `${file} still applies channel by hand`
    );
  }
});

/* -------------------------------------------------------------- filter options */

test("the options endpoint offers only values that exist in the caller's own data", async () => {
  const source = await read("../../server/services/analytics/analyticsFilterOptionsService.js");

  // Tenant, canonical predicate and the date window — so a value can never be offered
  // that would return an empty report when picked.
  assert.match(source, /o\.tenant_id = \$\{bind\(filters\.tenantId\)\}/);
  assert.match(source, /canonicalOrderClauses\(orderColumns\)\.clauses/);
  assert.match(source, /o\.created_at >= \$\{bind\(filters\.from\)\}/);

  // Every list joins to the table its id points at, so a label is a real name rather
  // than an id painted to look like one.
  assert.match(source, /JOIN branches b ON b\.id = o\.branch_id/);
  assert.match(source, /JOIN employees e ON e\.id = o\.salesperson_id/);
  assert.match(source, /JOIN cash_drawer_shifts s ON s\.id = o\.shift_id/);

  // The unsupported legacy filters travel with the response rather than being dropped.
  assert.match(source, /unsupported: UNSUPPORTED_LEGACY_FILTERS/);

  const routes = await read("../../server/routes/analyticsV2.js");
  assert.match(routes, /router\.get\("\/filter-options", protect, viewReports, getFilterOptionsController\)/);
});
