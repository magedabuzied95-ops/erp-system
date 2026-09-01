/*
 * The manager portal home reads the shop's day, and the ERP dashboard still reads the calendar's.
 *
 * The day card was moved to a 04:00 → 04:00 window first and the home feed was deliberately left
 * on the calendar day. That was the wrong call, and the difference is not academic: the two
 * boundaries diverge over exactly one slice, 00:00–03:59, and that slice is last night's shift.
 * A manager looking at "فواتير اليوم" at nine in the evening saw sales he had already counted and
 * closed the night on — reported as "لسه موجود فواتير امبارح".
 *
 * So the window is shared now. But it is OPT-IN: `getDashboardOverview` and `getRecentInvoices`
 * are also the ERP's own /dashboard, which means the calendar day and must keep meaning it, or
 * day-over-day reporting silently shifts under everyone. These tests pin both halves — that the
 * manager portal passes a window, and that a caller which passes none is untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { clearSettingsCache } from "../../server/services/settingsService.js";
import { getDashboardOverview, getRecentInvoices } from "../../server/services/dashboardAnalyticsService.js";
import { getManagerPortalDashboard } from "../../server/services/managerPortalService.js";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 1, 18, 0);            // 21:00 Cairo
const DAY_START = new Date(Date.UTC(2026, 8, 1, 1, 0));  // 04:00 Cairo
const DAY_END = new Date(Date.UTC(2026, 8, 2, 1, 0));    // 04:00 Cairo next day

const captureSql = () => {
  const seen = [];
  const original = db.query;
  clearSettingsCache();
  db.query = async (sql, params = []) => {
    const text = String(sql);
    seen.push({ text, params });
    if (/to_regclass/.test(text)) return { rows: [{ regclass: "public.exists" }] };
    if (/information_schema\.columns/.test(text)) return { rows: [{ exists: 1 }] };
    if (/AS window_start/.test(text)) {
      return { rows: [{ window_start: DAY_START.toISOString(), window_end: DAY_END.toISOString() }] };
    }
    return { rows: [] };
  };
  return { seen, restore: () => { db.query = original; clearSettingsCache(); } };
};

const invoiceListSql = (seen) =>
  seen.find((q) => /FROM orders o/.test(q.text) && /o\.invoice_number, o\.customer_name/.test(q.text));

test("the ERP dashboard is untouched — no window means the calendar day, exactly as before", async () => {
  const { seen, restore } = captureSql();
  try {
    await getRecentInvoices({ tenantId: 1, limit: 500, todayOnly: true });
    const q = invoiceListSql(seen);
    assert.ok(q, "the invoice list query must have run");
    assert.match(q.text, /o\.created_at >= date_trunc\('day', NOW\(\)\)/, "calendar day preserved for existing callers");
  } finally {
    restore();
  }
});

test("an explicit window replaces the calendar day and is BOUND, not interpolated", async () => {
  const { seen, restore } = captureSql();
  try {
    await getRecentInvoices({
      tenantId: 1,
      limit: 500,
      todayOnly: true,
      windowStart: DAY_START,
      windowEnd: DAY_END,
    });
    const q = invoiceListSql(seen);
    assert.ok(q, "the invoice list query must have run");
    assert.doesNotMatch(q.text, /date_trunc\('day', NOW\(\)\)/, "the calendar boundary must be gone");
    assert.match(q.text, /o\.created_at >= \$\d+ AND o\.created_at < \$\d+/, "bounds are parameters");
    const bound = q.params.map((p) => (p instanceof Date ? p.toISOString() : p));
    assert.ok(bound.includes(DAY_START.toISOString()), "window start is bound");
    assert.ok(bound.includes(DAY_END.toISOString()), "window end is bound");
  } finally {
    restore();
  }
});

/*
 * The dangerous direction is the opposite one: not that the portal fails to opt in, but that
 * the opt-in leaks and every OTHER caller silently moves off the calendar day. getDashboardOverview
 * is the ERP's own /dashboard; if its aggregates start reading 04:00 → 04:00, every day-over-day
 * comparison in the product shifts by four hours and nothing announces it.
 */
test("getDashboardOverview without a window keeps CURRENT_DATE for its aggregates", async () => {
  const { seen, restore } = captureSql();
  try {
    await getDashboardOverview({ tenantId: 1, filters: { range: "today" } });
    const todayAggregate = seen.find((q) => /COALESCE\(AVG\(NULLIF/.test(q.text) && /FROM orders o/.test(q.text));
    assert.ok(todayAggregate, "the today aggregate must have run");
    assert.match(
      todayAggregate.text,
      /o\.created_at >= CURRENT_DATE/,
      "the ERP dashboard must still mean the calendar day"
    );
  } finally {
    restore();
  }
});

test("the window is off by default — a bare call cannot silently inherit one", async () => {
  const { seen, restore } = captureSql();
  try {
    await getRecentInvoices({ tenantId: 1, limit: 6, todayOnly: false });
    const q = invoiceListSql(seen);
    assert.doesNotMatch(q.text, /o\.created_at >= \$\d+ AND o\.created_at </, "no day bound at all when todayOnly is false");
  } finally {
    restore();
  }
});

/*
 * A registry entry proves a setting is storable, never that it is wired — and the same is true
 * of an opt-in parameter. This is the wiring half: the portal must actually pass the window.
 */
test("the manager portal home passes the shop's day to every money query on it", async () => {
  const { seen, restore } = captureSql();
  try {
    await getManagerPortalDashboard({ manager: { id: 1, tenant_id: 1, branch_scope: "all", permissions: [] }, filters: {} });

    const resolved = seen.find((q) => /AS window_start/.test(q.text));
    assert.ok(resolved, "the home must resolve the business day at all");
    assert.deepEqual(resolved.params, [4], "and resolve it with the configured start hour");

    const invoices = invoiceListSql(seen);
    assert.ok(invoices, "the invoice feed query must have run");
    assert.doesNotMatch(invoices.text, /date_trunc\('day', NOW\(\)\)/, "the feed must not be on the calendar day");

    const tenders = seen.find((q) => /payment_breakdown/.test(q.text) && /FROM orders o/.test(q.text));
    assert.ok(tenders, "the tender split query must have run");
    assert.doesNotMatch(tenders.text, /date_trunc\('day', NOW\(\)\)/, "the split sits under the same total, so same day");

    // Every money query that ran must carry the window instants, so the list, the total and the
    // tender split cannot disagree with each other.
    for (const q of [invoices, tenders]) {
      const bound = q.params.map((p) => (p instanceof Date ? p.toISOString() : p));
      assert.ok(bound.includes(DAY_START.toISOString()), `window start bound in: ${q.text.slice(0, 60)}`);
      assert.ok(bound.includes(DAY_END.toISOString()), `window end bound in: ${q.text.slice(0, 60)}`);
    }
  } finally {
    restore();
  }
});

test("the 00:00-03:59 slice is the whole difference between the two boundaries", () => {
  // Guards the reasoning above rather than the SQL: if the business day ever stops starting
  // after midnight, this test is where the assumption is written down.
  const cairoMidnight = new Date(Date.UTC(2026, 7, 31, 21, 0)); // 00:00 Cairo on Sep 1 (Cairo is +03)
  assert.ok(DAY_START.getTime() > cairoMidnight.getTime(), "the shop's day starts AFTER midnight");
  const sliceHours = (DAY_START.getTime() - cairoMidnight.getTime()) / HOUR;
  assert.equal(sliceHours, 4, "and the slice the manager was seeing is exactly those four hours");
});
