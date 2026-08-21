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

// Same precedence as `dueAmountOf` in the orders dashboard: a fully collected
// invoice is never due whatever the denormalized column says, a stored
// `remaining_amount` above zero wins next, and total - paid is the last resort -
// which is what rescues the old credit rows that were left at remaining_amount = 0.
export const getOrderRemainingAmount = (order = {}) => {
  const total = getOrderTotalAmount(order);
  const paid = getOrderPaidAmount(order);
  if (total > 0 && paid >= total - MONEY_EPSILON) return 0;
  const stored = toAmount(order.remaining_amount) ?? toAmount(order.remainingAmount);
  if (stored !== null && stored > 0) return stored;
  if (total > 0 && paid < total) return Number((total - paid).toFixed(2));
  return 0;
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
