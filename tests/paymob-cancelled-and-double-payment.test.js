import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Two payment holes: a Paymob payment on a cancelled website order revived it as confirmed (its
// stock and coupon already given back), and a second live checkout session let one order be paid
// and credited twice. Paymob has taken the money in both cases, so the transaction stays a success
// and staff are told; the order is simply never revived or over-credited.

const { isOrderClosedForPayment } = await import("../shared/orderStatus.js");
const { planConfirmedPaymobOrderPayment } = await import("../server/services/paymobPosService.js");
const { paymobConfirmationInternals } = await import("../server/controllers/posController.js");
const { applyPaymobConfirmation } = paymobConfirmationInternals;

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to > from ? to : undefined);
};

// A scripted database: one order, its payment_transactions rows, and just enough SQL behaviour for
// the confirmation path. The orders UPDATE mirrors the real CASE expressions.
const createFakeDb = ({ order, transactions }) => {
  const state = {
    order: { ...order },
    transactions: transactions.map((row) => ({ ...row })),
    events: new Set(),
    notifications: [],
    orderUpdates: 0,
    queries: [],
  };
  const orderTotal = () => Number(state.order.total_amount) || Number(state.order.total) || Number(state.order.total_price) || 0;
  const client = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      state.queries.push(text);
      if (/^(CREATE|ALTER|SAVEPOINT|RELEASE|ROLLBACK)/i.test(text)) return { rows: [], rowCount: 0 };
      if (text.startsWith("SELECT * FROM payment_transactions WHERE provider = 'paymob'")) {
        const [reference, providerOrderId] = params;
        const matches = state.transactions.filter((row) => row.transaction_reference === reference || row.provider_order_id === providerOrderId);
        return { rows: matches.slice(0, 1), rowCount: matches.length ? 1 : 0 };
      }
      if (text.startsWith("INSERT INTO payment_transaction_events")) {
        const eventId = params[1];
        if (state.events.has(eventId)) return { rows: [], rowCount: 0 };
        state.events.add(eventId);
        return { rows: [{ id: state.events.size }], rowCount: 1 };
      }
      if (text.startsWith("UPDATE payment_transactions SET status = $2::text")) {
        const row = state.transactions.find((item) => item.id === params[0]);
        row.status = params[1];
        if (params[4]) row.transaction_reference = params[4];
        if (params[1] === "success") row.confirmed_amount_cents = params[5];
        row.error_message = null;
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith("UPDATE payment_transactions SET error_message = $2::text")) {
        const row = state.transactions.find((item) => item.id === params[0]);
        row.error_message = params[1];
        row.staff_review = JSON.parse(params[2]);
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith("SELECT * FROM payment_transactions WHERE id = $1")) {
        return { rows: state.transactions.filter((row) => row.id === params[0]), rowCount: 1 };
      }
      if (text.startsWith("SELECT * FROM orders WHERE id = $1")) {
        return { rows: [{ ...state.order }], rowCount: 1 };
      }
      if (text.startsWith("UPDATE orders SET paid_amount")) {
        state.orderUpdates += 1;
        const amount = Number(params[1]);
        const nextPaid = Number(state.order.paid_amount || 0) + amount;
        const total = orderTotal();
        const storefront = text.includes("THEN 'confirmed'");
        state.order.paid_amount = nextPaid;
        state.order.card_amount = Number(state.order.card_amount || 0) + amount;
        state.order.remaining_amount = Math.max(total - nextPaid, 0);
        state.order.payment_status = nextPaid >= total ? "paid" : nextPaid > 0 ? "partially_paid" : state.order.payment_status;
        if (storefront) {
          if (nextPaid >= total) state.order.status = "confirmed";
        } else {
          state.order.status = nextPaid >= total ? "Paid" : nextPaid > 0 ? "Partial" : state.order.status;
        }
        return { rows: [{ ...state.order }], rowCount: 1 };
      }
      if (text.startsWith("SELECT * FROM notifications")) return { rows: [], rowCount: 0 };
      if (text.startsWith("INSERT INTO notifications")) {
        const row = { id: state.notifications.length + 1, type: params[4], priority: params[6], role_key: params[2], message: params[8], entity_id: params[12], metadata: JSON.parse(params[13]) };
        state.notifications.push(row);
        return { rows: [row], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${text.slice(0, 120)}`);
    },
  };
  return { client, state };
};

const websiteOrder = (overrides = {}) => ({
  id: 501,
  tenant_id: 1,
  channel: "storefront",
  source: "storefront",
  invoice_number: "INV-501",
  status: "pending_payment",
  payment_status: "unpaid",
  payment_method: "card",
  total_amount: 1500,
  paid_amount: 0,
  card_amount: 0,
  ...overrides,
});

const session = (id, overrides = {}) => ({
  id,
  order_id: 501,
  tenant_id: 1,
  provider: "paymob",
  provider_order_id: `po-${id}`,
  transaction_reference: null,
  amount_cents: 150000,
  status: "sent",
  ...overrides,
});

const signedSuccess = (providerOrderId, reference) => ({
  status: "success",
  signedWebhook: true,
  providerOrderId,
  transactionReference: reference,
  amountCents: 150000,
  payload: { obj: { id: reference, order: { id: providerOrderId }, success: true } },
});

const silenceLogs = async (callback) => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const warnings = [];
  console.log = () => {};
  console.warn = (...args) => warnings.push(args);
  console.error = () => {};
  try {
    return { result: await callback(), warnings };
  } finally {
    Object.assign(console, saved);
  }
};

test("cancelled, voided and returned orders are closed for payment; live ones are not", () => {
  for (const status of ["cancelled", "Canceled", "cancelled_by_customer", "customer_cancelled", "payment_rejected", "returned", "refunded", "void", "VOIDED"]) {
    assert.equal(isOrderClosedForPayment(status), true, status);
  }
  for (const status of ["pending", "pending_payment", "confirmed", "Paid", "Partial", "completed", "ready_to_ship", "", null, undefined]) {
    assert.equal(isOrderClosedForPayment(status), false, String(status));
  }
});

test("the payment plan never books onto a closed order and never past a website order's total", () => {
  assert.deepEqual(
    planConfirmedPaymobOrderPayment({ orderStatus: "cancelled", paidAmount: 0, orderTotal: 1500, confirmedAmount: 1500, capAtTotal: true }),
    { applyAmount: 0, excessAmount: 1500, reason: "order_closed" }
  );
  assert.deepEqual(
    planConfirmedPaymobOrderPayment({ orderStatus: "void", paidAmount: 0, orderTotal: 1500, confirmedAmount: 1500, capAtTotal: false }),
    { applyAmount: 0, excessAmount: 1500, reason: "order_closed" }
  );
  assert.deepEqual(
    planConfirmedPaymobOrderPayment({ orderStatus: "confirmed", paidAmount: 1500, orderTotal: 1500, confirmedAmount: 1500, capAtTotal: true }),
    { applyAmount: 0, excessAmount: 1500, reason: "order_already_paid" }
  );
  assert.deepEqual(
    planConfirmedPaymobOrderPayment({ orderStatus: "pending", paidAmount: 500.5, orderTotal: 1500, confirmedAmount: 1500, capAtTotal: true }),
    { applyAmount: 999.5, excessAmount: 500.5, reason: "overpayment" }
  );
  assert.deepEqual(
    planConfirmedPaymobOrderPayment({ orderStatus: "pending_payment", paidAmount: 0, orderTotal: 1500, confirmedAmount: 1500, capAtTotal: true }),
    { applyAmount: 1500, excessAmount: 0, reason: null }
  );
  // A till sale keeps adding what the terminal confirmed.
  assert.deepEqual(
    planConfirmedPaymobOrderPayment({ orderStatus: "Paid", paidAmount: 1500, orderTotal: 1500, confirmedAmount: 200, capAtTotal: false }),
    { applyAmount: 200, excessAmount: 0, reason: null }
  );
});

test("a Paymob payment on a cancelled website order does not revive it, and staff are told", async () => {
  const { client, state } = createFakeDb({
    order: websiteOrder({ status: "cancelled", payment_status: "cancelled" }),
    transactions: [session(11)],
  });
  const { result, warnings } = await silenceLogs(() => applyPaymobConfirmation(client, signedSuccess("po-11", "tx-11")));

  assert.equal(result.status, "success", "the money was taken, so the transaction is still a success");
  assert.equal(state.transactions[0].status, "success");
  assert.equal(state.orderUpdates, 0, "the order row must not be written");
  assert.equal(state.order.status, "cancelled");
  assert.equal(state.order.paid_amount, 0);
  assert.equal(state.order.card_amount, 0);
  assert.equal(result.order.status, "cancelled");

  assert.match(state.transactions[0].error_message, /cancelled\/voided\/returned order/);
  assert.equal(state.transactions[0].staff_review.reason, "order_closed");
  assert.equal(state.transactions[0].staff_review.unbooked_amount, 1500);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].type, "paymob_payment_needs_review");
  assert.equal(state.notifications[0].priority, "critical");
  assert.equal(state.notifications[0].role_key, "manager");
  assert.equal(state.notifications[0].entity_id, "11");
  assert.ok(warnings.some(([tag]) => tag === "[paymob-payment-needs-review]"));
});

test("a second checkout session paid on the same order is not credited twice", async () => {
  const { client, state } = createFakeDb({
    order: websiteOrder(),
    transactions: [session(21), session(22, { status: "superseded" })],
  });

  const first = await silenceLogs(() => applyPaymobConfirmation(client, signedSuccess("po-21", "tx-21")));
  assert.equal(first.result.order.status, "confirmed");
  assert.equal(state.order.paid_amount, 1500);
  assert.equal(state.order.card_amount, 1500);
  assert.equal(state.order.payment_status, "paid");
  assert.equal(state.notifications.length, 0, "a normal payment raises nothing");
  assert.equal(state.transactions[0].error_message, null);

  const second = await silenceLogs(() => applyPaymobConfirmation(client, signedSuccess("po-22", "tx-22")));
  assert.equal(second.result.status, "success");
  assert.equal(state.transactions[1].status, "success");
  assert.equal(state.order.paid_amount, 1500, "paid_amount stays at the total");
  assert.equal(state.order.card_amount, 1500, "card revenue is not inflated");
  assert.equal(state.orderUpdates, 1);
  assert.equal(state.transactions[1].staff_review.reason, "order_already_paid");
  assert.match(state.transactions[1].error_message, /already fully paid/);
  assert.equal(state.notifications.length, 1);
  assert.equal(state.notifications[0].entity_id, "22");
});

test("a payment larger than what a website order still owes books only the remainder", async () => {
  const { client, state } = createFakeDb({
    order: websiteOrder({ paid_amount: 400, payment_status: "partially_paid" }),
    transactions: [session(31)],
  });
  await silenceLogs(() => applyPaymobConfirmation(client, signedSuccess("po-31", "tx-31")));
  assert.equal(state.order.paid_amount, 1500);
  assert.equal(state.order.card_amount, 1100);
  assert.equal(state.order.status, "confirmed");
  assert.equal(state.transactions[0].staff_review.reason, "overpayment");
  assert.equal(state.transactions[0].staff_review.unbooked_amount, 400);
  assert.equal(state.notifications.length, 1);
});

test("a till payment still adds what the terminal confirmed, but never reopens a cancelled invoice", async () => {
  const till = createFakeDb({
    order: { id: 700, tenant_id: 1, channel: "pos", status: "Partial", payment_status: "partially_paid", total_amount: 1000, paid_amount: 600, card_amount: 0 },
    transactions: [session(41, { order_id: 700, amount_cents: 40000, status: "pending" })],
  });
  await silenceLogs(() => applyPaymobConfirmation(till.client, { ...signedSuccess("po-41", "tx-41"), amountCents: 40000 }));
  assert.equal(till.state.order.paid_amount, 1000);
  assert.equal(till.state.order.card_amount, 400);
  assert.equal(till.state.order.status, "Paid");
  assert.equal(till.state.notifications.length, 0);

  const cancelled = createFakeDb({
    order: { id: 701, tenant_id: 1, channel: "pos", status: "cancelled", payment_status: "cancelled", total_amount: 1000, paid_amount: 0, card_amount: 0 },
    transactions: [session(42, { order_id: 701, amount_cents: 100000, status: "pending" })],
  });
  await silenceLogs(() => applyPaymobConfirmation(cancelled.client, { ...signedSuccess("po-42", "tx-42"), amountCents: 100000 }));
  assert.equal(cancelled.state.orderUpdates, 0);
  assert.equal(cancelled.state.order.status, "cancelled");
  assert.equal(cancelled.state.transactions[0].staff_review.reason, "order_closed");
  assert.equal(cancelled.state.notifications.length, 1);
});

test("restarting payment refuses a cancelled order before any Paymob session is created", () => {
  const source = read("../server/controllers/storefrontController.js");
  const handler = between(source, "export const restartStorefrontPaymentSession", "\n};\n");
  const guardAt = handler.search(/if \(isOrderClosedForPayment\(order\.status\) \|\| isOrderClosedForPayment\(order\.payment_status\)\) \{\s*return res\.status\(409\)/);
  const sessionAt = handler.indexOf("startPaymobCheckoutSession(");
  assert.ok(guardAt > 0, "the closed-order guard must return a 409");
  assert.ok(sessionAt > guardAt, "the guard must run before a session is minted");
  assert.match(handler, /code: "ORDER_NOT_PAYABLE"/);
});

test("a new checkout session marks the order's older website sessions superseded", () => {
  const source = read("../server/controllers/storefrontController.js");
  const starter = between(source, "const startPaymobCheckoutSession", "const loadOrderByPublicToken");
  assert.match(starter, /SET status = 'superseded',[\s\S]*?WHERE order_id = \$1\s*AND provider = 'paymob'\s*AND status = 'sent'\s*AND id <> \$2/);
});

test("the webhook finder prefers the row the signed ids name and keeps the signed-id check", () => {
  const source = read("../server/controllers/posController.js");
  const finder = between(source, "const findPaymobTransaction", "const applyPaymobConfirmation");
  assert.match(finder, /ORDER BY\s*\$\{exactMatchOrder\}\s*CASE WHEN status IN \('pending', 'sent'\)/);
  assert.match(finder, /if \(!referenceMatches && rowOrderId && rowOrderId !== signedOrderId\) return null;/);
});
