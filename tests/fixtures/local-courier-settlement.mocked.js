import test, { mock } from "node:test";
import assert from "node:assert/strict";

/*
 * The courier's hand-in end to end against a fake database (run with
 * --experimental-test-module-mocks): cash lands in the drawer shift, InstaPay and card on
 * their mapped accounts, his fee in expenses, and the orders are marked settled.
 */

const calls = { drawer: [], accounts: [], expenses: [], queries: [] };
const orders = [
  { id: 2214, public_order_number: "INV-2214", shipping_provider: "local_courier", courier_collected_at: "2026-10-21T17:09:00Z", courier_collected_amount: 1145, courier_settlement_id: null },
  { id: 2215, public_order_number: "INV-2215", shipping_provider: "local_courier", courier_collected_at: "2026-10-21T17:20:00Z", courier_collected_amount: 600, courier_settlement_id: null },
];

const fakeClient = {
  query: async (sql, params = []) => {
    calls.queries.push(sql);
    if (/FROM cash_drawer_shifts/.test(sql)) return { rows: params[0] === 31 ? [{ id: 31, branch_id: 1 }] : [] };
    if (/SELECT \* FROM orders WHERE id = ANY/.test(sql)) return { rows: orders.filter((row) => params[0].includes(row.id)) };
    if (/INSERT INTO courier_settlements/.test(sql)) return { rows: [{ id: 77, gross_amount: params[4], fees_amount: params[5], net_amount: params[6], payment_breakdown: JSON.parse(params[11]) }] };
    return { rows: [], rowCount: 1 };
  },
  release: () => {},
};
const fakeDb = { query: async (sql) => (/FROM local_courier_settings/.test(sql) ? { rows: [{ courier_name: "Ahmed", courier_phone: "", fee_per_order: 20 }] } : { rows: [] }), connect: async () => fakeClient };

// Real modules first, so each mock keeps every export the import graph needs.
const realAccounting = await import("../../server/services/accountingService.js");
const realCosts = await import("../../server/modules/shipping/shipping.costs.service.js");
const realSettlements = await import("../../server/modules/shipping/shipping.settlements.service.js");

mock.module("../../server/database/db.js", { defaultExport: fakeDb });
mock.module("../../server/modules/shipping/shipping.settlements.service.js", { namedExports: { ...realSettlements, ensureCourierSettlementSchema: async () => {} } });
mock.module("../../server/services/accountingService.js", {
  namedExports: {
    ...realAccounting,
    ensureAccountingSchema: async () => {},
    recordCashDrawerEvent: async (_client, input) => { calls.drawer.push(input); return { id: 1 }; },
    recordFinancialAccountActivity: async (_client, input) => { calls.accounts.push(input); return { id: 2 }; },
  },
});
mock.module("../../server/modules/shipping/shipping.costs.service.js", {
  namedExports: {
    ...realCosts,
    ensureCourierCostSchema: async () => {},
    expenseCategoryId: async () => 9,
    upsertCourierExpense: async (_client, input) => { calls.expenses.push(input); return 55; },
  },
});

const { createLocalCourierSettlement } = await import("../../server/modules/shipping/localCourier.js");

const reset = () => { calls.drawer = []; calls.accounts = []; calls.expenses = []; calls.queries = []; };

test("a mixed hand-in: cash to the shift, InstaPay and Visa to their accounts, fee to expenses", async () => {
  reset();
  // 1,745 collected - 2 x 20 fee = 1,705 net = 905 cash + 600 InstaPay + 200 Visa
  const result = await createLocalCourierSettlement({ tenantId: 1, orderIds: [2214, 2215], shiftId: 31, payments: { cash: 905, instapay: 600, card: 200 }, createdBy: 4 });
  assert.equal(result.net_amount, 1705);
  assert.deepEqual(result.payments, { cash: 905, instapay: 600, card: 200 });
  assert.equal(calls.drawer.length, 1);
  assert.equal(calls.drawer[0].amount, 905);
  assert.equal(calls.drawer[0].shiftId, 31);
  assert.deepEqual(calls.accounts.map((row) => [row.paymentMethod, row.amount]), [["instapay", 600], ["card", 200]]);
  assert.equal(calls.expenses[0].amount, 40);
  assert.ok(calls.queries.some((sql) => /UPDATE orders SET courier_settlement_id/.test(sql)));
  assert.ok(calls.queries.includes("COMMIT"));
});

test("all InstaPay needs no shift; nothing touches the drawer", async () => {
  reset();
  await createLocalCourierSettlement({ tenantId: 1, orderIds: [2214], payments: { cash: 0, instapay: 1125, card: 0 }, createdBy: 4 });
  assert.equal(calls.drawer.length, 0);
  assert.deepEqual(calls.accounts.map((row) => [row.paymentMethod, row.amount]), [["instapay", 1125]]);
});

test("cash with no open shift, or a split that does not add up, is refused and rolled back", async () => {
  reset();
  await assert.rejects(createLocalCourierSettlement({ tenantId: 1, orderIds: [2214], createdBy: 4 }), (error) => error.code === "SHIFT_REQUIRED");
  assert.ok(calls.queries.includes("ROLLBACK"));
  reset();
  await assert.rejects(createLocalCourierSettlement({ tenantId: 1, orderIds: [2214], shiftId: 99, createdBy: 4 }), (error) => error.code === "SHIFT_CLOSED");
  reset();
  await assert.rejects(createLocalCourierSettlement({ tenantId: 1, orderIds: [2214], shiftId: 31, payments: { cash: 100, instapay: 0, card: 0 }, createdBy: 4 }), (error) => error.code === "PAYMENTS_MISMATCH");
  assert.equal(calls.drawer.length, 0);
});

test("New Damietta: his fee is the customer's shipping passed through, so it never becomes an expense", async () => {
  reset();
  orders.push(
    { id: 2301, public_order_number: "INV-2301", shipping_provider: "local_courier", city_area: "دمياط الجديده", courier_collected_at: "2026-10-23T10:00:00Z", courier_collected_amount: 1145, courier_settlement_id: null },
    { id: 2302, public_order_number: "INV-2302", shipping_provider: "local_courier", shipping_address: "New Damietta, 3rd district", courier_collected_at: "2026-10-23T10:05:00Z", courier_collected_amount: 845, courier_settlement_id: null },
    { id: 2303, public_order_number: "INV-2303", shipping_provider: "local_courier", city_area: "دمياط", shipping_address: "شارع الجلاء", courier_collected_at: "2026-10-23T10:10:00Z", courier_collected_amount: 545, courier_settlement_id: null },
  );
  const onlyNew = await createLocalCourierSettlement({ tenantId: 1, orderIds: [2301, 2302], shiftId: 31, feesAmount: 90, createdBy: 4 });
  assert.equal(onlyNew.net_amount, 1900, "the drawer still gets the cash net of his fee");
  assert.equal(onlyNew.fees_expensed, 0);
  assert.equal(calls.expenses.length, 0, "no shipping expense for New Damietta");
  reset();
  const mixed = await createLocalCourierSettlement({ tenantId: 1, orderIds: [2301, 2303], shiftId: 31, feesAmount: 90, createdBy: 4 });
  assert.equal(mixed.fees_expensed, 45, "only the old-Damietta order's share is an expense");
  assert.equal(calls.expenses[0].amount, 45);
});
