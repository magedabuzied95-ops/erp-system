import { getCollectedPaymentAllocations, normalizePaymentMethodKey, parsePaymentBreakdown } from "../../shared/paymentMethods.js";

// The rails a cashier can move an invoice's collected money between from the till.
// Credit, store credit and personal settlements are not money that arrived anywhere,
// so there is nothing to move.
export const CHANGEABLE_PAYMENT_METHODS = new Set(["cash", "card", "instapay", "vodafone_cash"]);

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizeChangeMethod = (value) => {
  const key = normalizePaymentMethodKey(value);
  return key === "wallet" ? "instapay" : key;
};

/**
 * An edit that only changes HOW the invoice was paid ("it was InstaPay, not Vodafone
 * Cash", or "600 Vodafone Cash + 400 cash, not 500/500"). Before this the receipt printed
 * the new method while the order kept its payment_breakdown — and with it payment_method,
 * the shift split and the money accounts — on the old one, because an edit only ever
 * appended the money it collected.
 *
 * `requestedSplit` ([{ method, amount }]) re-splits the collected money; without it the
 * whole amount moves to `requestedMethod`. Every collected row has to sit on a changeable
 * method and the new split has to add up to exactly what was collected — a re-split moves
 * money between rails, it never collects or refunds any. A deferred remainder
 * (credit_sale) is not collected money and stays untouched.
 *
 * Returns null when nothing moves, `{ error }` when the split is not a pure re-allocation,
 * else `{ moves: [{ method, delta }], amount, fromMethod, toMethod, paymentBreakdown }`.
 * fromMethod / toMethod are only set when one rail moved wholly onto one other rail.
 */
export const planEditPaymentMethodChange = ({ paymentBreakdown, requestedMethod, requestedSplit } = {}) => {
  const allocations = getCollectedPaymentAllocations(paymentBreakdown);
  if (!allocations.length) return null;
  if (allocations.some((row) => !CHANGEABLE_PAYMENT_METHODS.has(row.method))) return null;
  const collected = roundMoney(allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  if (!(collected > 0)) return null;

  const target = new Map();
  if (Array.isArray(requestedSplit) && requestedSplit.length) {
    for (const row of requestedSplit) {
      const method = normalizeChangeMethod(row?.method || row?.payment_method);
      const amount = roundMoney(Math.max(0, Number(row?.amount || 0) || 0));
      if (!(amount > 0)) continue;
      if (!CHANGEABLE_PAYMENT_METHODS.has(method)) return { error: "UNSUPPORTED_METHOD", method };
      target.set(method, roundMoney((target.get(method) || 0) + amount));
    }
    const targetTotal = roundMoney(Array.from(target.values()).reduce((sum, amount) => sum + amount, 0));
    if (Math.abs(targetTotal - collected) > 0.01) return { error: "SPLIT_TOTAL_MISMATCH", collected, requested: targetTotal };
  } else {
    const toMethod = normalizeChangeMethod(requestedMethod);
    if (!CHANGEABLE_PAYMENT_METHODS.has(toMethod)) return null;
    target.set(toMethod, collected);
  }

  const current = new Map(allocations.map((row) => [row.method, roundMoney(row.amount)]));
  const moves = [];
  for (const method of CHANGEABLE_PAYMENT_METHODS) {
    const delta = roundMoney((target.get(method) || 0) - (current.get(method) || 0));
    if (Math.abs(delta) > 0.009) moves.push({ method, delta });
  }
  if (!moves.length) return null;
  const amount = roundMoney(moves.filter((move) => move.delta > 0).reduce((sum, move) => sum + move.delta, 0));

  const singleFrom = allocations.length === 1 ? allocations[0].method : null;
  const singleTo = target.size === 1 ? Array.from(target.keys())[0] : null;
  const rows = parsePaymentBreakdown(paymentBreakdown);
  let nextBreakdown;
  if (singleFrom && singleTo) {
    // One rail onto another: relabel in place so every other field on the row survives.
    nextBreakdown = rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      if (normalizePaymentMethodKey(row.method || row.payment_method) !== singleFrom) return row;
      return {
        ...row,
        method: singleTo,
        ...(row.payment_method ? { payment_method: singleTo } : {}),
        changed_from_method: singleFrom,
      };
    });
  } else {
    const changedFrom = allocations.map((row) => `${row.method}:${roundMoney(row.amount)}`).join(",");
    nextBreakdown = [
      ...rows.filter((row) => {
        if (!row || typeof row !== "object") return true;
        return !CHANGEABLE_PAYMENT_METHODS.has(normalizePaymentMethodKey(row.method || row.payment_method));
      }),
      ...Array.from(target, ([method, value]) => ({ method, amount: value, changed_from_split: changedFrom })),
    ];
  }
  return {
    moves,
    amount,
    fromMethod: singleFrom && singleTo ? singleFrom : null,
    toMethod: singleFrom && singleTo ? singleTo : null,
    paymentBreakdown: nextBreakdown,
  };
};

// Which of the order's per-rail amount columns a method is counted in. cash_amount is
// left alone on purpose: every drawer reader (expected_cash, the shift report, the
// manager portal) takes the invoice's original cash from it and every later cash move on
// an edit from a cash_in / cash_out event. Moving it as well would count the change twice.
const AMOUNT_COLUMN_BY_METHOD = { card: "card", instapay: "wallet", vodafone_cash: "wallet" };

export const editPaymentMethodChangeColumnDeltas = ({ moves, fromMethod, toMethod, amount } = {}) => {
  const deltas = { card: 0, wallet: 0 };
  const list = Array.isArray(moves)
    ? moves
    : [{ method: fromMethod, delta: -amount }, { method: toMethod, delta: amount }];
  for (const move of list) {
    const column = AMOUNT_COLUMN_BY_METHOD[move.method];
    if (column) deltas[column] = roundMoney(deltas[column] + Number(move.delta || 0));
  }
  return deltas;
};
