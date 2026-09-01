/*
 * The manager portal's day card, and the window it reads the shop's day through.
 *
 * The card used to be bounded by CURRENT_DATE. Once the database session moved to Africa/Cairo
 * that boundary landed at exactly 00:00, so an open drawer's evening left the tape the moment
 * the calendar turned while the drawer figure beside it — computed by shift_id, with no date
 * bound — went on reporting the whole night. The fix is not a smarter patch on midnight: the
 * day now runs from one business-day start to the next (04:00 → 04:00 by default), which puts a
 * whole trading night inside one window, and the manager can name any window outright.
 *
 * A third defect is pinned here too: `/day-summary` threw `ReferenceError: personalOrderClause
 * is not defined` on every call, and the portal's `.catch` rendered that 500 as an empty shop.
 *
 * The fake below does not execute SQL. It reads the bounds each query actually asks for and
 * applies them, and throws on a query shape it does not recognise — so reverting any part of
 * this fails rather than passing silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { clearSettingsCache } from "../../server/services/settingsService.js";
import { getManagerPortalDaySummary } from "../../server/services/managerPortalService.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// A fixed clock, so "the business day containing now" is a fact the test can assert rather
// than something it has to rediscover. 01:00 — after midnight, inside the previous 4am day.
const NOW = Date.UTC(2026, 8, 1, 1, 0, 0);
const iso = (y, m, d, h, min = 0) => new Date(Date.UTC(y, m, d, h, min)).toISOString();

/* The default window for a start hour, the way the SQL computes it:
 * date_trunc('day', NOW() - h) + h. At NOW = Sep 1 01:00 with h = 4 that is Aug 31 04:00. */
const businessDayStart = (startHour) => {
  const shifted = NOW - startHour * HOUR;
  const truncated = Date.UTC(
    new Date(shifted).getUTCFullYear(),
    new Date(shifted).getUTCMonth(),
    new Date(shifted).getUTCDate()
  );
  return truncated + startHour * HOUR;
};

const BRANCH = { id: 7, name: "الفرع الرئيسي" };

const SHIFTS = [
  // Opened at 20:00 and still running — the drawer whose night used to vanish at 00:00.
  { id: 100, status: "open", opened_at: iso(2026, 7, 31, 20), closed_at: null },
  // A day shift, wholly inside the 4am-to-4am window.
  { id: 200, status: "closed", opened_at: iso(2026, 7, 31, 10), closed_at: iso(2026, 7, 31, 18) },
  // Closed at 02:00 on the 31st — that is the PREVIOUS business day, before 04:00.
  { id: 300, status: "closed", opened_at: iso(2026, 7, 30, 20), closed_at: iso(2026, 7, 31, 2) },
].map((row) => ({
  ...row,
  branch_id: 7,
  opened_by: 3,
  opening_cash: 500,
  stored_expected_cash: 0,
  actual_cash: 1000,
  branch_name: BRANCH.name,
  cashier_name: `كاشير ${row.id}`,
}));

const ORDERS = [
  { id: 1, shift_id: 100, created_at: iso(2026, 7, 31, 23), total_amount: 1000 },   // before midnight
  { id: 2, shift_id: 100, created_at: iso(2026, 8, 1, 1, 30), total_amount: 500 },  // AFTER midnight, same night
  { id: 3, shift_id: 200, created_at: iso(2026, 7, 31, 12), total_amount: 300 },    // the day shift
  { id: 4, shift_id: 300, created_at: iso(2026, 7, 31, 3), total_amount: 900 },     // previous business day
  { id: 5, shift_id: 100, created_at: iso(2026, 8, 1, 5), total_amount: 250 },      // past the 04:00 close
].map((row) => ({
  ...row,
  branch_id: 7,
  invoice_number: `INV-${row.id}`,
  customer_name: "عميل",
  seller_name: "بائع",
  payment_method: "cash",
  payment_breakdown: [{ method: "cash", amount: row.total_amount }],
  cash_amount: row.total_amount,
  card_amount: 0,
  wallet_payment_amount: 0,
}));

const EXPENSES = [
  { id: 11, shift_id: 100, created_at: iso(2026, 7, 31, 22), amount: 120 }, // before midnight
  { id: 12, shift_id: 100, created_at: iso(2026, 8, 1, 2), amount: 80 },    // after midnight
  { id: 13, shift_id: 300, created_at: iso(2026, 7, 31, 3), amount: 60 },   // previous business day
].map((row) => ({
  ...row,
  branch_id: 7,
  title: "مصروف",
  payment_method: "cash",
  category: "",
  expense_type: "",
  notes: "",
  branch_name: BRANCH.name,
  created_by_name: "مدير",
  is_employee_advance: false,
}));

/* ---- bound readers: what the SQL actually asks for, not what we hope it asks for ---- */

const param = (params, index) => params[Number(index) - 1];
const ms = (value) => new Date(value).getTime();

const readRowBounds = (sql, params, alias, windowPattern) => {
  const win = windowPattern.exec(sql);
  const shiftScope = new RegExp(`AND ${alias}\\.shift_id = \\$(\\d+)`).exec(sql);
  const branchScope = new RegExp(`AND ${alias}\\.branch_id = \\$(\\d+)`).exec(sql);
  if (!win && !shiftScope) {
    throw new Error(`unbounded ${alias} query — neither a window nor a drawer scopes it: ${sql}`);
  }
  return {
    from: win ? ms(param(params, win[1])) : null,
    to: win ? ms(param(params, win[2])) : null,
    shiftId: shiftScope ? Number(param(params, shiftScope[1])) : null,
    branchId: branchScope ? Number(param(params, branchScope[1])) : null,
  };
};

const applyBounds = (rows, bounds) => rows.filter((row) => {
  if (bounds.shiftId != null && row.shift_id !== bounds.shiftId) return false;
  if (bounds.branchId != null && row.branch_id !== bounds.branchId) return false;
  if (bounds.from != null) {
    const at = ms(row.created_at);
    if (at < bounds.from || at >= bounds.to) return false;
  }
  return true;
});

const installFakeDb = ({ startHourSetting } = {}) => {
  const original = db.query;
  clearSettingsCache();
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/to_regclass/.test(text)) return { rows: [{ regclass: "public.exists" }] };
    if (/information_schema\.columns/.test(text)) return { rows: [{ exists: 1 }] };

    if (/FROM system_settings WHERE key = \$1/.test(text)) {
      if (params[0] !== "pos.business_day_start_hour" || startHourSetting === undefined) return { rows: [] };
      return { rows: [{ value: JSON.stringify(startHourSetting) }] };
    }

    // The default window. Its shape is asserted so a rewrite cannot slip past this fake, and
    // the boundary is then computed against the fixed clock above.
    if (/AS window_start/.test(text)) {
      assert.match(
        text,
        /date_trunc\('day', NOW\(\) - make_interval\(hours => \$1::int\)\) \+ make_interval\(hours => \$1::int\)/,
        "the business day must be resolved by the database, on its Cairo session"
      );
      assert.match(text, /\+ INTERVAL '1 day'/, "a calendar day, so the window survives a DST change");
      const start = businessDayStart(Number(params[0]));
      return { rows: [{ window_start: new Date(start).toISOString(), window_end: new Date(start + DAY).toISOString() }] };
    }

    if (/FROM cash_drawer_shifts s/.test(text) && /LEFT JOIN LATERAL/.test(text)) {
      return { rows: (params[0] || []).map((id) => ({ id, expected_cash: 1234 })) };
    }

    // A drawer belongs to the window if it OVERLAPS it, never if it merely opened inside it.
    if (/FROM cash_drawer_shifts s/.test(text)) {
      const overlap = /AND s\.opened_at < \$(\d+)\s+AND \(s\.closed_at IS NULL OR s\.closed_at >= \$(\d+)\)/.exec(text);
      if (!overlap) throw new Error(`unrecognised drawer-list window: ${text}`);
      const to = ms(param(params, overlap[1]));
      const from = ms(param(params, overlap[2]));
      return {
        rows: SHIFTS.filter((row) => ms(row.opened_at) < to && (!row.closed_at || ms(row.closed_at) >= from)),
      };
    }

    if (/FROM branches b/.test(text)) return { rows: [BRANCH] };

    if (/FROM orders o/.test(text)) {
      const bounds = readRowBounds(text, params, "o", /AND o\.created_at >= \$(\d+) AND o\.created_at < \$(\d+)/);
      return { rows: applyBounds(ORDERS, bounds) };
    }

    if (/FROM expenses e/.test(text)) {
      const bounds = readRowBounds(
        text,
        params,
        "e",
        /AND COALESCE\(e\.created_at, e\.expense_date::timestamptz\) >= \$(\d+) AND COALESCE\(e\.created_at, e\.expense_date::timestamptz\) < \$(\d+)/
      );
      return { rows: applyBounds(EXPENSES, bounds) };
    }

    return { rows: [] };
  };
  return () => { db.query = original; clearSettingsCache(); };
};

const daySummary = async (query = {}) =>
  getManagerPortalDaySummary({ manager: { tenant_id: 1, branch_scope: "all" }, query });

const invoiceIds = (summary) => summary.invoices.map((row) => row.id).sort((a, b) => a - b);
const shiftIds = (summary) => (summary.branches[0]?.shifts || []).map((row) => row.id).sort((a, b) => a - b);

test("the day card answers at all — it used to throw ReferenceError on every call", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary();
    assert.ok(summary, "the endpoint must return a payload, not throw");
    assert.ok(Array.isArray(summary.invoices));
    assert.ok(summary.window, "the card must state the window it used");
  } finally {
    restore();
  }
});

test("the shop's day runs 04:00 to 04:00, so a night that trades past midnight stays whole", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary();
    assert.deepEqual(
      invoiceIds(summary),
      [1, 2, 3],
      "23:00 and 01:30 are the SAME night; 03:00 belongs to the previous day and 05:00 to the next"
    );
    assert.equal(summary.sales.total, 1800);
    assert.equal(summary.window.from, new Date(businessDayStart(4)).toISOString());
    assert.equal(summary.window.to, new Date(businessDayStart(4) + DAY).toISOString());
    assert.equal(summary.window.business_day_start_hour, 4);
    assert.equal(summary.window.is_custom, false);
  } finally {
    restore();
  }
});

test("start hour 0 puts the boundary back on midnight — the original bug, reproduced through the setting", async () => {
  const restore = installFakeDb({ startHourSetting: 0 });
  try {
    const summary = await daySummary();
    assert.deepEqual(
      invoiceIds(summary),
      [2, 5],
      "at midnight the 23:00 sale falls out of today — which is exactly what the manager saw"
    );
    assert.equal(summary.window.business_day_start_hour, 0);
  } finally {
    restore();
  }
});

test("a named window overrides the business day", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary({ from: iso(2026, 7, 31, 0), to: iso(2026, 7, 31, 6) });
    assert.deepEqual(invoiceIds(summary), [4], "only the 03:00 sale is inside 00:00–06:00");
    assert.equal(summary.window.is_custom, true);
    assert.equal(summary.window.from, iso(2026, 7, 31, 0));
    assert.equal(summary.window.to, iso(2026, 7, 31, 6));
  } finally {
    restore();
  }
});

test("a `from` with no `to` runs one day forward, and a `to` with no `from` one day back", async () => {
  const restore = installFakeDb();
  try {
    const forward = await daySummary({ from: iso(2026, 7, 31, 0) });
    assert.equal(forward.window.to, iso(2026, 8, 1, 0), "one day forward from the given start");

    const backward = await daySummary({ to: iso(2026, 7, 31, 6) });
    assert.equal(backward.window.from, iso(2026, 7, 30, 6), "one day back from the given end");
  } finally {
    restore();
  }
});

test("an absurd range is clamped rather than handed to the database", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary({ from: iso(2020, 0, 1, 0), to: iso(2030, 0, 1, 0) });
    const span = ms(summary.window.to) - ms(summary.window.from);
    assert.equal(span, 92 * DAY, "clamped to the 92-day ceiling");
    assert.equal(summary.window.from, iso(2020, 0, 1, 0), "the start the manager asked for is kept");
  } finally {
    restore();
  }
});

test("a picked drawer is its own window — its tape must reconcile with its cash figure", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary({ branch_id: "7", shift_id: "100" });
    assert.deepEqual(
      invoiceIds(summary),
      [1, 2, 5],
      "the whole shift, including the 05:00 sale that falls outside the business day"
    );
    assert.equal(summary.window.scoped_to_shift, true);
  } finally {
    restore();
  }
});

test("the drawer list holds every shift that OVERLAPS the window, not just those opened inside it", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary();
    assert.deepEqual(
      shiftIds(summary),
      [100, 200],
      "the still-open drawer opened at 20:00 overlaps; the one closed at 02:00 is the previous day"
    );
  } finally {
    restore();
  }
});

test("expenses follow the same window as the sales they are netted against", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary();
    assert.deepEqual(summary.expenses.items.map((row) => row.id).sort((a, b) => a - b), [11, 12]);
    assert.equal(summary.expenses.total, 200, "both sides of midnight, and not the previous day's");
  } finally {
    restore();
  }
});
