/*
 * The manager portal's day card, read across midnight.
 *
 * Two defects are pinned here:
 *
 * 1. `/day-summary` threw `ReferenceError: personalOrderClause is not defined` on every call,
 *    so the whole card 500'd.
 * 2. The invoice tape and the expense list were bounded by `CURRENT_DATE` alone. Once the
 *    database session moved to Africa/Cairo the day turned at Cairo midnight, so at 00:00 an
 *    open drawer's night vanished from the tape while the drawer figure under it — computed by
 *    shift_id, with no date bound — still reported the whole night's cash.
 *
 * The fake below does not execute SQL; it reads the window each query actually asks for and
 * applies it. That is deliberate: revert the fix and the fake applies the date-only window, the
 * pre-midnight rows drop, and these tests fail. A window shape it does not recognise throws
 * rather than passing silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { clearSettingsCache } from "../../server/services/settingsService.js";
import { getManagerPortalDaySummary } from "../../server/services/managerPortalService.js";

const HOUR = 3_600_000;
const NOW = Date.now();
// Pretend Cairo midnight fell two hours ago: it is ~02:00 and last night's drawer is still open.
const CURRENT_DATE = NOW - 2 * HOUR;
const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR);

const BRANCH = { id: 7, name: "الفرع الرئيسي" };

const SHIFTS = [
  // Opened at ~20:00 and never closed — the drawer the owner is asking about.
  { id: 100, branch_id: 7, opened_by: 3, status: "open", opened_at: at(6), closed_at: null },
  // Closed at ~23:30, i.e. BEFORE midnight and inside the three-hour grace. Nothing but the
  // grace holds this one: it neither opened nor closed on the current calendar day.
  { id: 200, branch_id: 7, opened_by: 4, status: "closed", opened_at: at(9), closed_at: at(2.5) },
  // Closed five hours ago, i.e. before midnight and long past the grace: the calendar day wins.
  { id: 300, branch_id: 7, opened_by: 5, status: "closed", opened_at: at(14), closed_at: at(5) },
  // The night before last. Only an unclamped grace could ever reach back this far, which is
  // what makes the clamp testable rather than merely asserted.
  { id: 500, branch_id: 7, opened_by: 6, status: "closed", opened_at: at(36), closed_at: at(30) },
].map((row) => ({
  ...row,
  opening_cash: 500,
  stored_expected_cash: 0,
  actual_cash: 1000,
  branch_name: BRANCH.name,
  cashier_name: `كاشير ${row.opened_by}`,
}));

const ORDERS = [
  { id: 1, shift_id: 100, branch_id: 7, created_at: at(5), total_amount: 1000 }, // before midnight
  { id: 2, shift_id: 100, branch_id: 7, created_at: at(3), total_amount: 500 },  // before midnight
  { id: 3, shift_id: 100, branch_id: 7, created_at: at(1), total_amount: 250 },  // after midnight
  { id: 4, shift_id: 200, branch_id: 7, created_at: at(4), total_amount: 700 },  // drawer closed 1h ago
  { id: 5, shift_id: 300, branch_id: 7, created_at: at(6), total_amount: 900 },  // drawer closed 5h ago
  { id: 6, shift_id: 500, branch_id: 7, created_at: at(32), total_amount: 400 }, // the night before last
].map((row) => ({
  ...row,
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
  { id: 11, shift_id: 100, branch_id: 7, created_at: at(4), amount: 120 }, // before midnight
  { id: 12, shift_id: 100, branch_id: 7, created_at: at(1), amount: 80 },  // after midnight
  { id: 13, shift_id: 300, branch_id: 7, created_at: at(6), amount: 60 },  // drawer past the grace
].map((row) => ({
  ...row,
  title: "مصروف",
  payment_method: "cash",
  category: "",
  expense_type: "",
  notes: "",
  branch_name: BRANCH.name,
  created_by_name: "مدير",
  is_employee_advance: false,
}));

/* ---- window readers: what the SQL actually asks for, not what we hope it asks for ---- */

const readShiftWindow = (sql, params) => {
  const graceMatch = /s\.closed_at >= NOW\(\) - \(\$(\d+)::float8 \* INTERVAL '1 hour'\)/.exec(sql);
  if (!/LOWER\(COALESCE\(s\.status, ''\)\) = 'open'/.test(sql)) {
    throw new Error(`unrecognised drawer-list window: ${sql}`);
  }
  return { graceHours: graceMatch ? Number(params[Number(graceMatch[1]) - 1]) : 0 };
};

const readRowWindow = (sql, params, alias, dateExpr) => {
  const escaped = new RegExp(
    `WHERE \\(${dateExpr} >= CURRENT_DATE OR ${alias}\\.shift_id = ANY\\(\\$(\\d+)::bigint\\[\\]\\)\\)`
  ).exec(sql);
  if (escaped) return { liveShiftIds: params[Number(escaped[1]) - 1] || [] };
  if (new RegExp(`WHERE ${dateExpr} >= CURRENT_DATE\\b`).test(sql)) return { liveShiftIds: [] };
  throw new Error(`unrecognised ${alias} window — update the test to model it: ${sql}`);
};

const readScope = (sql, params, alias) => {
  const shift = new RegExp(`AND ${alias}\\.shift_id = \\$(\\d+)`).exec(sql);
  if (shift) return { shiftId: Number(params[Number(shift[1]) - 1]) };
  const branch = new RegExp(`AND ${alias}\\.branch_id = \\$(\\d+)`).exec(sql);
  if (branch) return { branchId: Number(params[Number(branch[1]) - 1]) };
  return {};
};

const installFakeDb = ({ graceSetting } = {}) => {
  const original = db.query;
  clearSettingsCache();
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/to_regclass/.test(text)) return { rows: [{ regclass: "public.exists" }] };
    if (/information_schema\.columns/.test(text)) return { rows: [{ exists: 1 }] };

    // The stored grace period, as system_settings actually holds it: a JSON scalar.
    if (/FROM system_settings WHERE key = \$1/.test(text)) {
      if (params[0] !== "pos.shift_visibility_grace_hours" || graceSetting === undefined) return { rows: [] };
      return { rows: [{ value: JSON.stringify(graceSetting) }] };
    }

    // The drawer figure: by shift_id alone, never date-bounded. Unchanged by this fix.
    if (/LEFT JOIN LATERAL/.test(text)) {
      return { rows: (params[0] || []).map((id) => ({ id, expected_cash: 1234 })) };
    }

    if (/FROM cash_drawer_shifts s/.test(text)) {
      const { graceHours } = readShiftWindow(text, params);
      const rows = SHIFTS.filter((row) => {
        if (row.status === "open") return true;
        const closed = row.closed_at ? row.closed_at.getTime() : null;
        const opened = row.opened_at.getTime();
        if (opened >= CURRENT_DATE) return true;
        if (closed != null && closed >= CURRENT_DATE) return true;
        return closed != null && NOW - closed <= graceHours * HOUR;
      });
      return { rows };
    }

    if (/FROM branches b/.test(text)) return { rows: [BRANCH] };

    if (/FROM orders o/.test(text)) {
      const { liveShiftIds } = readRowWindow(text, params, "o", "o\\.created_at");
      const scope = readScope(text, params, "o");
      const rows = ORDERS.filter((row) => {
        const inWindow = row.created_at.getTime() >= CURRENT_DATE || liveShiftIds.includes(row.shift_id);
        if (!inWindow) return false;
        if (scope.shiftId != null) return row.shift_id === scope.shiftId;
        if (scope.branchId != null) return row.branch_id === scope.branchId;
        return true;
      });
      return { rows };
    }

    if (/FROM expenses e/.test(text)) {
      const { liveShiftIds } = readRowWindow(
        text,
        params,
        "e",
        "COALESCE\\(e\\.created_at, e\\.expense_date::timestamp\\)"
      );
      const scope = readScope(text, params, "e");
      const rows = EXPENSES.filter((row) => {
        const inWindow = row.created_at.getTime() >= CURRENT_DATE || liveShiftIds.includes(row.shift_id);
        if (!inWindow) return false;
        if (scope.shiftId != null) return row.shift_id === scope.shiftId;
        if (scope.branchId != null) return row.branch_id === scope.branchId;
        return true;
      });
      return { rows };
    }

    return { rows: [] };
  };
  return () => { db.query = original; clearSettingsCache(); };
};

const daySummary = async (query = {}) =>
  getManagerPortalDaySummary({ manager: { tenant_id: 1, branch_scope: "all" }, query });

const invoiceIds = (summary) => summary.invoices.map((row) => row.id).sort((a, b) => a - b);

test("the day card answers at all — it used to throw ReferenceError on every call", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary();
    assert.ok(summary, "the endpoint must return a payload, not throw");
    assert.ok(Array.isArray(summary.invoices));
    assert.ok(Array.isArray(summary.branches));
  } finally {
    restore();
  }
});

test("an open drawer's night survives Cairo midnight", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary();
    assert.deepEqual(
      invoiceIds(summary),
      [1, 2, 3, 4],
      "pre-midnight sales on a live drawer must stay on the card; only the drawer closed past the grace drops"
    );
    assert.equal(summary.sales.total, 2450);
    assert.equal(summary.sales.invoice_count, 4);
  } finally {
    restore();
  }
});

test("picking the open drawer shows its whole life, not the slice after midnight", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary({ branch_id: "7", shift_id: "100" });
    assert.deepEqual(invoiceIds(summary), [1, 2, 3]);
    assert.equal(summary.sales.total, 1750, "the tape must reconcile with the drawer, not with the calendar");
  } finally {
    restore();
  }
});

test("a drawer closed inside the grace keeps its sales; past the grace the calendar day wins", async () => {
  const restore = installFakeDb();
  try {
    const inGrace = await daySummary({ branch_id: "7", shift_id: "200" });
    assert.deepEqual(invoiceIds(inGrace), [4], "closed one hour ago — still on the card");

    const pastGrace = await daySummary({ branch_id: "7", shift_id: "300" });
    assert.deepEqual(invoiceIds(pastGrace), [], "closed five hours ago and rung before midnight — released");
  } finally {
    restore();
  }
});

test("the drawer list holds a shift for three hours after it closes", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary();
    const listed = (summary.branches[0]?.shifts || []).map((row) => row.id).sort((a, b) => a - b);
    assert.deepEqual(
      listed,
      [100, 200],
      "a drawer closed at 23:50 must not disappear from the list ten minutes later"
    );
  } finally {
    restore();
  }
});

/*
 * A registry entry proves a setting is storable, never that it is wired. These two drive the
 * stored value in opposite directions and assert the window moves with it.
 */
test("pos.shift_visibility_grace_hours actually drives the window — 0 hands the card back to the calendar", async () => {
  const restore = installFakeDb({ graceSetting: 0 });
  try {
    const summary = await daySummary();
    assert.deepEqual(
      invoiceIds(summary),
      [1, 2, 3],
      "with no grace, only the still-OPEN drawer keeps its night — a closed one is released at once"
    );
    const listed = (summary.branches[0]?.shifts || []).map((row) => row.id);
    assert.deepEqual(listed, [100], "the closed drawers drop off the list too");
  } finally {
    restore();
  }
});

test("widening the setting to 6 hours pulls a longer-closed drawer back onto the card", async () => {
  const restore = installFakeDb({ graceSetting: 6 });
  try {
    const summary = await daySummary();
    assert.deepEqual(
      invoiceIds(summary),
      [1, 2, 3, 4, 5],
      "the drawer closed five hours ago is inside a six-hour grace"
    );
  } finally {
    restore();
  }
});

test("a nonsense grace value is clamped, not passed through to SQL", async () => {
  const restore = installFakeDb({ graceSetting: 9999 });
  try {
    const summary = await daySummary();
    assert.deepEqual(
      invoiceIds(summary),
      [1, 2, 3, 4, 5],
      "9999 clamps to 24h, so the drawer closed 30 hours ago stays off the card"
    );
    assert.ok(
      !(summary.branches[0]?.shifts || []).some((row) => row.id === 500),
      "an unclamped grace would pin every drawer the shop has ever opened to today's card"
    );
  } finally {
    restore();
  }
});

test("expenses booked on a live drawer survive midnight with its sales", async () => {
  const restore = installFakeDb();
  try {
    const summary = await daySummary({ branch_id: "7", shift_id: "100" });
    assert.deepEqual(summary.expenses.items.map((row) => row.id).sort((a, b) => a - b), [11, 12]);
    assert.equal(summary.expenses.total, 200, "the pre-midnight expense must still be netted off the drawer");
  } finally {
    restore();
  }
});
