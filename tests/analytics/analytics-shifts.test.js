// The shift report — "when did each till session run, and what paid for it".
//
// A shift here is a drawer session (`cash_drawer_shifts`), the only shift the system has
// actually recorded. The report is driven with a scripted database client so the whole
// contract — scope, the money split, what is refused — is testable without a database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { getShiftsReport, MAX_SHIFTS, __clearShiftColumnCache } from "../../server/services/analytics/analyticsShiftsService.js";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const SHIFT_COLUMNS = [
  "id", "tenant_id", "branch_id", "opened_by", "opened_at", "closed_at",
  "opening_cash", "expected_cash", "actual_cash", "closing_cash", "cash_difference", "difference", "status",
];
const ORDER_COLUMNS = [
  "id", "tenant_id", "shift_id", "created_at", "status", "deleted_at",
  "total_amount", "subtotal", "discount_amount", "payment_method", "payment_breakdown", "is_personal_transaction",
];

const filters = {
  tenantId: 1,
  branchId: null,
  windowStart: "2026-09-01 00:00:00",
  windowEnd: "2026-10-01 00:00:00",
};

/**
 * A client that answers the two information_schema probes and then the two real queries,
 * recording every SQL string and parameter list it was handed.
 */
const fakeClient = ({ shiftRows = [], paymentRows = [], shiftColumns = SHIFT_COLUMNS, orderColumns = ORDER_COLUMNS } = {}) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/information_schema\.columns/.test(sql)) {
        const table = params[0];
        const columns = table === "orders" ? orderColumns : table === "cash_drawer_shifts" ? shiftColumns : [];
        return { rows: columns.map((column_name) => ({ column_name })) };
      }
      if (/FROM cash_drawer_shifts/.test(sql)) return { rows: shiftRows };
      return { rows: paymentRows };
    },
  };
};

const shiftRow = (overrides = {}) => ({
  id: 7,
  opened_at: "2026-09-30T20:00:00.000Z",
  closed_at: "2026-10-01T00:30:00.000Z",
  status: "closed",
  opening_cash: "500",
  expected_cash: "3500",
  closing_cash: "3450",
  cash_difference: "-50",
  branch_id: 2,
  branch_name: "البشبيشي",
  cashier_name: "Sara",
  ...overrides,
});

const run = (options) => {
  __clearShiftColumnCache();
  const client = fakeClient(options);
  return getShiftsReport({ filters: options.filters || filters, permissions: { view: true }, client }).then((result) => ({
    result,
    client,
  }));
};

/* -------------------------------------------------------------------- the window */

test("the window is bound as instants, so a night that crosses midnight is one window", async () => {
  const { client } = await run({ shiftRows: [] });
  const shiftQuery = client.calls.find((call) => /FROM cash_drawer_shifts/.test(call.sql));

  assert.match(shiftQuery.sql, /s\.opened_at >= \$2::timestamptz/);
  assert.match(shiftQuery.sql, /s\.opened_at <\s+\$3::timestamptz/);
  assert.deepEqual(shiftQuery.params, [1, "2026-09-01 00:00:00", "2026-10-01 00:00:00"]);
});

test("a shift is placed by when it opened, and keeps its whole figures", async () => {
  // The drawer opened at 23:00 Cairo on the 30th and closed after the window ended. It
  // belongs to September, with all of its money — splitting it at midnight would invent
  // two halves no cashier ever counted.
  const { result } = await run({
    shiftRows: [shiftRow()],
    paymentRows: [
      { shift_id: 7, method: "cash", amount: "2000", orders: 4, unusable: 0, shift_orders: 6, shift_net_sales: "3000" },
      { shift_id: 7, method: "visa", amount: "1000", orders: 2, unusable: 0, shift_orders: 6, shift_net_sales: "3000" },
    ],
  });

  const [shift] = result.data.shifts;
  assert.equal(shift.id, 7);
  assert.equal(shift.orders, 6);
  assert.equal(shift.payments.totals.all, 3000);
  assert.equal(shift.closedAt, "2026-10-01T00:30:00.000Z", "a close after the window is still this shift's close");
});

test("the branch scope reaches the query rather than being filtered afterwards", async () => {
  const { client } = await run({ filters: { ...filters, branchId: 2 }, shiftRows: [] });
  const shiftQuery = client.calls.find((call) => /FROM cash_drawer_shifts/.test(call.sql));

  assert.match(shiftQuery.sql, /AND s\.branch_id = \$4/);
  assert.deepEqual(shiftQuery.params, [1, "2026-09-01 00:00:00", "2026-10-01 00:00:00", 2]);
});

/* -------------------------------------------------------------- the money split */

test("one method spelled two ways is one line, through the shared assembler", async () => {
  const { result } = await run({
    shiftRows: [shiftRow()],
    paymentRows: [
      { shift_id: 7, method: "visa", amount: "1000", orders: 2, unusable: 0, shift_orders: 5, shift_net_sales: "2500" },
      { shift_id: 7, method: "card", amount: "500", orders: 1, unusable: 0, shift_orders: 5, shift_net_sales: "2500" },
      { shift_id: 7, method: "insta_pay", amount: "1000", orders: 2, unusable: 0, shift_orders: 5, shift_net_sales: "2500" },
    ],
  });

  const rows = result.data.shifts[0].payments.rows;
  const byMethod = (method) => rows.find((row) => row.method === method);
  assert.equal(rows.length, 2, "visa and card are one rail; two lines would read as two");
  assert.equal(byMethod("card").amount, 1500);
  assert.equal(byMethod("instapay").amount, 1000);
});

test("an invoice that recorded no method is reported, not spread across the real ones", async () => {
  const { result } = await run({
    shiftRows: [shiftRow()],
    paymentRows: [
      { shift_id: 7, method: "cash", amount: "900", orders: 3, unusable: 0, shift_orders: 4, shift_net_sales: "1000" },
      { shift_id: 7, method: "mixed", amount: "100", orders: 1, unusable: 0, shift_orders: 4, shift_net_sales: "1000" },
    ],
  });

  const { payments } = result.data.shifts[0];
  assert.equal(payments.rows.find((row) => row.method === "cash").amount, 900, "the real method keeps exactly its own money");
  assert.equal(payments.totals.unattributed, 100);
  assert.ok(result.warnings.some((warning) => warning.code === "PAYMENT_MIX_UNATTRIBUTED"));
});

test("money on its way is never counted as money in the drawer", async () => {
  const { result } = await run({
    shiftRows: [shiftRow()],
    paymentRows: [
      { shift_id: 7, method: "cash", amount: "1000", orders: 2, unusable: 0, shift_orders: 3, shift_net_sales: "1400" },
      { shift_id: 7, method: "cod", amount: "400", orders: 1, unusable: 0, shift_orders: 3, shift_net_sales: "1400" },
    ],
  });

  const { payments } = result.data.shifts[0];
  assert.equal(payments.totals.collected, 1000);
  assert.equal(payments.totals.pending, 400);
  assert.equal(payments.totals.all, 1400);
});

test("each shift's share of the window is the server's, and a window of nothing has none", async () => {
  const two = await run({
    shiftRows: [shiftRow(), shiftRow({ id: 8 })],
    paymentRows: [
      { shift_id: 7, method: "cash", amount: "3000", orders: 3, unusable: 0, shift_orders: 3, shift_net_sales: "3000" },
      { shift_id: 8, method: "cash", amount: "1000", orders: 1, unusable: 0, shift_orders: 1, shift_net_sales: "1000" },
    ],
  });
  assert.equal(two.result.data.shifts[0].share, 0.75);
  assert.equal(two.result.data.shifts[1].share, 0.25);

  const empty = await run({
    shiftRows: [shiftRow()],
    paymentRows: [{ shift_id: 7, method: null, amount: null, orders: 0, unusable: 0, shift_orders: 0, shift_net_sales: "0" }],
  });
  assert.equal(empty.result.data.shifts[0].share, null, "a share of nothing is not 0%, it is unknown");
});

/* --------------------------------------------------------------- what is refused */

test("an open drawer has no counted cash and no difference, rather than a zero", async () => {
  const { result } = await run({
    shiftRows: [shiftRow({ id: 9, status: "open", closed_at: null, closing_cash: null, cash_difference: "0" })],
    paymentRows: [],
  });

  const [shift] = result.data.shifts;
  assert.equal(shift.status, "open");
  assert.equal(shift.closedAt, null);
  assert.equal(shift.closingCash, null, "nobody has counted it; 0 would read as 'counted, and empty'");
  assert.equal(shift.cashDifference, null);
});

test("a caller who may not view reports receives no shift at all", async () => {
  __clearShiftColumnCache();
  const client = fakeClient({ shiftRows: [shiftRow()] });
  const result = await getShiftsReport({ filters, permissions: { view: false }, client });

  assert.deepEqual(result.data.shifts, []);
  assert.equal(result.meta.restricted, true);
  assert.equal(client.calls.length, 0, "a refused caller must not cost a query");
});

test("a schema with no shift table says so instead of answering with an empty period", async () => {
  __clearShiftColumnCache();
  const client = fakeClient({ shiftColumns: [] });
  const result = await getShiftsReport({ filters, permissions: { view: true }, client });

  assert.deepEqual(result.data.shifts, []);
  assert.equal(result.meta.available, false);
  assert.ok(result.warnings.some((warning) => warning.code === "SHIFTS_UNAVAILABLE"));
});

test("invoices that do not record their shift produce a warning, never a silent zero", async () => {
  __clearShiftColumnCache();
  const client = fakeClient({
    shiftRows: [shiftRow()],
    orderColumns: ORDER_COLUMNS.filter((column) => column !== "shift_id"),
  });
  const result = await getShiftsReport({ filters, permissions: { view: true }, client });

  assert.equal(result.data.shifts.length, 1);
  assert.equal(result.data.shifts[0].payments.totals.all, 0);
  assert.ok(result.warnings.some((warning) => warning.code === "SHIFT_ATTRIBUTION_UNAVAILABLE"));
});

test("a window with more shifts than the cap says the tail is missing", async () => {
  const { result } = await run({
    shiftRows: Array.from({ length: MAX_SHIFTS }, (_, index) => shiftRow({ id: index + 1 })),
    paymentRows: [],
  });
  assert.equal(result.meta.truncated, true);
  assert.equal(result.meta.limit, MAX_SHIFTS);
});

/* ------------------------------------------------------------------- the sources */

test("the split comes from the allocations, never from orders.payment_method alone", async () => {
  const source = await read("../../server/services/analytics/analyticsShiftsService.js");

  // The stored column holds the word `mixed` for a split sale. Grouping on it would put
  // a half-cash half-card invoice under a label that is not a payment method.
  assert.match(source, /paymentAllocationSql\(orderColumns\)/, "the shared allocation rule is the one used");
  assert.match(source, /assemblePaymentMix/, "the shared merger is the one used");
  assert.ok(
    !/GROUP BY[^)]*payment_method/i.test(source),
    "grouping on the stored method would hide every split sale behind one label"
  );
});

test("a staff purchase is not counted as takings", async () => {
  const source = await read("../../server/services/analytics/analyticsShiftsService.js");
  assert.match(source, /is_personal_transaction, FALSE\) = FALSE/);
  assert.match(source, /canonicalOrderClauses\(orderColumns\)/, "cancelled and draft invoices are excluded by the shared predicate");
});
