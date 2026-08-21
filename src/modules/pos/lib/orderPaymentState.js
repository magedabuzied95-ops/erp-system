// A POS invoice carries two different "statuses". `status` is the fulfilment
// lifecycle, and every completed sale normalizes to `confirmed` (a deferred one to
// `pending`), so it says nothing about the money. What the cashier needs on a recent
// operations card is the payment state, and the trustworthy source for that is the
// amounts on the row, not either status string.

const MONEY_EPSILON = 0.009;

const toAmount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
};

const normalizeKey = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

// POS writes `payment_status` straight from the checkout summary, so the column holds
// a mix of spellings and casings ("Paid", "partially_paid", "Pending", "unpaid").
const PAID_STATUSES = new Set(["paid", "fully_paid", "completed", "complete", "settled"]);
const PARTIAL_STATUSES = new Set(["partial", "partially_paid", "partly_paid"]);
const UNPAID_STATUSES = new Set(["unpaid", "not_paid", "pending", "due", "credit", "deferred"]);

const getOrderTotalAmount = (order = {}) =>
  toAmount(order.total_amount) ?? toAmount(order.total) ?? toAmount(order.total_price) ?? 0;

const getOrderPaidAmount = (order = {}) =>
  Math.max(0, toAmount(order.paid_amount) ?? toAmount(order.paidAmount) ?? 0);

// `remaining_amount` is denormalized on the order row and is what every other reader
// trusts, so prefer it over total - paid and only compute when the row omits it.
export const getOrderRemainingAmount = (order = {}) => {
  const stored = toAmount(order.remaining_amount) ?? toAmount(order.remainingAmount);
  if (stored !== null) return Math.max(0, stored);
  return Math.max(0, getOrderTotalAmount(order) - getOrderPaidAmount(order));
};

const hasMoneySignal = (order = {}) =>
  toAmount(order.remaining_amount) !== null ||
  toAmount(order.remainingAmount) !== null ||
  toAmount(order.paid_amount) !== null ||
  toAmount(order.paidAmount) !== null;

/**
 * The balance still owed, or null when the row carries no amounts at all - so a
 * caller never renders `total - 0` as if nothing had been collected.
 */
export const getOrderOutstandingAmount = (order = {}) =>
  (hasMoneySignal(order) ? getOrderRemainingAmount(order) : null);

/**
 * "paid" | "partial" | "unpaid", or "" when the row carries neither amounts nor a
 * recognizable payment_status (a stale in-memory page from before the list projection
 * returned the amounts). Never guesses from the lifecycle `status`.
 */
export const resolveOrderPaymentState = (order = {}) => {
  if (hasMoneySignal(order)) {
    if (getOrderRemainingAmount(order) <= MONEY_EPSILON) return "paid";
    return getOrderPaidAmount(order) <= MONEY_EPSILON ? "unpaid" : "partial";
  }
  const key = normalizeKey(order.payment_status);
  if (PAID_STATUSES.has(key)) return "paid";
  if (PARTIAL_STATUSES.has(key)) return "partial";
  if (UNPAID_STATUSES.has(key)) return "unpaid";
  return "";
};
