// Manager Portal — the Reporting Center on a manager's phone.
//
// Two things are this module's own and are tested here: the period presets, and the two
// rules that make the screen safe to hand to a branch manager (their branch, and no
// profit without the password). The figures themselves are the analytics service's and
// are covered by tests/analytics/*.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { REPORT_SECTIONS, resolveReportRange } from "../../server/services/managerPortalReportsService.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");
const NOW = new Date("2026-10-09T12:00:00Z");

/* ------------------------------------------------------------------ presets */

test("every preset resolves to an ordered, inclusive window", () => {
  for (const preset of ["last7", "last30", "thisMonth", "lastMonth"]) {
    const range = resolveReportRange(preset, { now: NOW });
    assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/, `${preset} from`);
    assert.match(range.to, /^\d{4}-\d{2}-\d{2}$/, `${preset} to`);
    assert.ok(range.from <= range.to, `${preset} is inverted`);
    assert.equal(range.preset, preset);
  }
});

test("the day counts are what the labels promise", () => {
  const days = (range) => (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
  assert.equal(days(resolveReportRange("last7", { now: NOW })), 7);
  assert.equal(days(resolveReportRange("last30", { now: NOW })), 30);
});

test("this month starts on the first and ends today, never in the future", () => {
  const range = resolveReportRange("thisMonth", { now: NOW });
  assert.equal(range.from, "2026-10-01");
  assert.equal(range.to, "2026-10-09");
});

test("last month is the whole previous calendar month", () => {
  const range = resolveReportRange("lastMonth", { now: NOW });
  assert.equal(range.from, "2026-09-01");
  assert.equal(range.to, "2026-09-30");
});

test("an unknown preset falls back to a real window rather than failing", () => {
  const range = resolveReportRange("whatever", { now: NOW });
  assert.equal(range.preset, "last30");
  assert.equal(range.from, "2026-09-10");
});

test("a custom window is honoured, and an incomplete one is not", () => {
  assert.deepEqual(resolveReportRange("custom", { from: "2026-01-01", to: "2026-01-31", now: NOW }), {
    preset: "custom", from: "2026-01-01", to: "2026-01-31",
  });
  // Half a custom range is not a range; silently reporting a different period than the
  // one asked for is the failure mode this guards.
  assert.equal(resolveReportRange("custom", { from: "2026-01-01", now: NOW }).preset, "last30");
});

test("today and yesterday are deliberately not offered", () => {
  // The portal's اليوم tab counts the shop's night, these count calendar days. One word,
  // two numbers, same phone.
  for (const preset of ["today", "yesterday"]) {
    assert.equal(resolveReportRange(preset, { now: NOW }).preset, "last30");
  }
});

/* -------------------------------------------------------------------- scope */

test("the branch comes from the manager row and the request cannot widen it", async () => {
  const source = await read("../../server/services/managerPortalReportsService.js");

  // The caller's branchId is never read: a hand-edited query string must not turn a
  // branch manager into an all-branches manager.
  assert.ok(!/query\.branchId|query\.branch_id/.test(source), "the request's branchId must not reach the filters");
  assert.match(source, /manager\.branch_scope === "all" \? null : manager\.branch_id/);
  assert.match(source, /user: \{ tenant_id: manager\.tenant_id \}/, "the tenant comes from the manager too");
});

test("the period, the comparison and which report are the only things the caller controls", async () => {
  const source = await read("../../server/services/managerPortalReportsService.js");
  const passed = [...source.matchAll(/query\.(\w+)/g)].map((match) => match[1]);
  // `section` picks which report to run, never what it is allowed to see.
  assert.deepEqual([...new Set(passed)].sort(), ["compare", "from", "preset", "section", "to"]);
});

test("an unknown section falls back to the overview instead of failing", async () => {
  const source = await read("../../server/services/managerPortalReportsService.js");
  assert.match(source, /SECTIONS\[query\.section\] \? query\.section : "overview"/);
});

test("every section is served by the matching Reporting Center service", async () => {
  const source = await read("../../server/services/managerPortalReportsService.js");
  const expected = {
    overview: "getExecutiveOverview",
    sales: "getSalesSummary",
    inventory: "getInventorySummary",
    purchasing: "getPurchasingSummary",
    customers: "getCustomersSummary",
    employees: "getEmployeesSummary",
  };

  assert.deepEqual(REPORT_SECTIONS, Object.keys(expected));
  for (const [section, service] of Object.entries(expected)) {
    const body = source.slice(source.indexOf(`  ${section}: async (`));
    assert.match(body.slice(0, 400), new RegExp(service), `${section} must read ${service}`);
  }
});

test("a cost figure is never the ranking when cost is masked", async () => {
  const source = await read("../../server/services/managerPortalReportsService.js");
  // Supplier spend and stock value are null without the profit unlock. Ranking by them
  // would print a list of dashes; these two switch to units and say so.
  assert.match(source, /valueKind: byValue \? "money" : "count"/);
  assert.equal((source.match(/const byValue = Boolean\(permissions\.cost\)/g) || []).length, 2);
});

/* ------------------------------------------------------------------- profit */

test("profit rides on the shared unlock, not on a permission check of its own", async () => {
  const source = await read("../../server/services/managerPortalReportsService.js");

  // resolveManagerProfitAccess is "holds the permission AND unlocked with the password".
  // A local re-derivation from permissions alone would show profit to a manager who
  // never typed it.
  assert.match(source, /resolveManagerProfitAccess\(manager, profitToken\)/);
  assert.match(source, /permissions: \{ view: true, cost: profitOk, profit: profitOk \}/);
  assert.ok(!/canViewProfitForManager/.test(source), "the permission alone must not grant profit");
});

test("the portal screen computes no figure of its own", async () => {
  const service = await read("../../server/services/managerPortalReportsService.js");
  const screen = await read("../../src/modules/managerPortal/components/PortalReports.jsx");

  // One question, one implementation: the portal must read the same service the desktop
  // report reads, and must not reach for SQL or a second aggregation.
  assert.match(service, /getExecutiveOverview/);
  assert.ok(!/SELECT |FROM orders/i.test(service), "no SQL belongs in the portal layer");
  assert.ok(!/reduce\(\(sum/.test(screen), "totals come from the server, never re-added on the phone");
});

test("the screen masks nothing itself — it renders what the server sent", async () => {
  const screen = await read("../../src/modules/managerPortal/components/PortalReports.jsx");
  // The gate is `payload.profit_unlocked`, which only the server sets. A screen that
  // decided this locally would be hiding numbers it had already received.
  assert.match(screen, /profitShown = Boolean\(payload\?\.profit_unlocked\)/);
});
