import { getCollectedPaymentAllocations, normalizePaymentMethodKey, parsePaymentBreakdown } from "../../shared/paymentMethods.js";

// The rails a cashier can move an invoice's collected money between from the till.
// Credit, store credit and personal settlements are not money that arrived anywhere,
// so there is nothing to move.
export const CHANGEABLE_PAYMENT_METHODS = new Set(["cash", "card", "instapay", "vodafone_cash"]);

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * An edit that only changes HOW the invoice was paid ("it was InstaPay, not Vodafone
 * Cash"). Before this the receipt printed the new method while the order kept its
 * payment_breakdown — and with it payment_method, the shift split and the money
 * accounts — on the old one, because an edit only ever appended the money it collected.
 *
 * Returns null unless the invoice was collected on exactly one changeable method and the
 * cashier picked a different one. The breakdown keeps every amount; only the rows on the
 * old method are relabelled, so a deferred remainder (credit_sale) stays untouched.
 */
export const planEditPaymentMethodChange = ({ paymentBreakdown, requestedMethod } = {}) => {
  const toMethod = normalizePaymentMethodKey(requestedMethod);
  if (!CHANGEABLE_PAYMENT_METHODS.has(toMethod)) return null;
  const allocations = getCollectedPaymentAllocations(paymentBreakdown);
  if (allocations.length !== 1) return null;
  const fromMethod = allocations[0].method;
  const amount = roundMoney(allocations[0].amount);
  if (fromMethod === toMethod || !CHANGEABLE_PAYMENT_METHODS.has(fromMethod) || !(amount > 0)) return null;

  const nextBreakdown = parsePaymentBreakdown(paymentBreakdown).map((row) => {
    if (!row || typeof row !== "object") return row;
    if (normalizePaymentMethodKey(row.method || row.payment_method) !== fromMethod) return row;
    return {
      ...row,
      method: toMethod,
      ...(row.payment_method ? { payment_method: toMethod } : {}),
      changed_from_method: fromMethod,
    };
  });
  return { fromMethod, toMethod, amount, paymentBreakdown: nextBreakdown };
};

// Which of the order's per-rail amount columns a method is counted in. cash_amount is
// left alone on purpose: every drawer reader (expected_cash, the shift report, the
// manager portal) takes the invoice's original cash from it and every later cash move on
// an edit from a cash_in / cash_out event. Moving it as well would count the change twice.
const AMOUNT_COLUMN_BY_METHOD = { card: "card", instapay: "wallet", vodafone_cash: "wallet" };

export const editPaymentMethodChangeColumnDeltas = ({ fromMethod, toMethod, amount } = {}) => {
  const deltas = { card: 0, wallet: 0 };
  const from = AMOUNT_COLUMN_BY_METHOD[fromMethod];
  const to = AMOUNT_COLUMN_BY_METHOD[toMethod];
  if (from) deltas[from] = roundMoney(deltas[from] - amount);
  if (to) deltas[to] = roundMoney(deltas[to] + amount);
  return deltas;
};
