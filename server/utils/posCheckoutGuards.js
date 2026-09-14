// Pure checkout guards shared by createOrder / editOrder. No database access here,
// so every rule is testable on its own.
import { isOrderLifecycleStatus, normalizeOrderLifecycleStatus, ORDER_STATUS_ALIASES } from "../../shared/orderStatus.js";

// orders.status is fulfilment. The POS edit sends its payment words there
// ("Paid" / "Partial" / "Pending"), and they used to land raw in the column. A
// payment word — or anything unrecognised — returns null so the stored status is
// kept; a real lifecycle value is normalised the way createOrder normalises it.
// "pending" is only a payment word on the POS line edit; the field-only edit form
// uses it as the fulfilment status it is.
const EDIT_PAYMENT_STATUS_WORDS = new Set(["paid", "partial", "partially_paid", "unpaid", "payment_pending", "pending_payment"]);
export const resolveEditedOrderStatus = (requested, { treatPendingAsPayment = false } = {}) => {
  const key = String(requested ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return null;
  if (EDIT_PAYMENT_STATUS_WORDS.has(key) || (treatPendingAsPayment && key === "pending")) return null;
  if (!isOrderLifecycleStatus(key) && !ORDER_STATUS_ALIASES[key]) return null;
  return normalizeOrderLifecycleStatus(key);
};

// The success vocabulary posController writes for a Paymob terminal payment.
export const PAYMOB_TERMINAL_SUCCESS_STATUSES = new Set(["success", "success_manual_confirmed"]);

// Amounts are compared in piastres; one piastre absorbs float rounding only.
const TERMINAL_AMOUNT_TOLERANCE_CENTS = 1;

/**
 * Why a Paymob terminal transaction may NOT be attached to the sale being created,
 * or null when it may. `transaction` is the locked payment_transactions row.
 */
export const describeTerminalTransactionLinkRejection = (transaction, { tenantId, saleCardAmount, orderId = null } = {}) => {
  if (!transaction) return "not_found";
  if (tenantId == null || transaction.tenant_id == null || String(transaction.tenant_id) !== String(tenantId)) return "tenant_mismatch";
  if (!PAYMOB_TERMINAL_SUCCESS_STATUSES.has(String(transaction.status || "").trim().toLowerCase())) return "not_successful";
  if (transaction.order_id != null && String(transaction.order_id) !== String(orderId ?? "")) return "already_linked";
  const transactionCents = Number(transaction.confirmed_amount_cents || 0) > 0
    ? Number(transaction.confirmed_amount_cents)
    : Number(transaction.amount_cents || 0);
  const saleCents = Math.round(Math.max(0, Number(saleCardAmount || 0)) * 100);
  if (!(transactionCents > 0) || !(saleCents > 0) || Math.abs(transactionCents - saleCents) > TERMINAL_AMOUNT_TOLERANCE_CENTS) {
    return "amount_mismatch";
  }
  return null;
};

const toBooleanSetting = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return Boolean(value);
};

const toPercentSetting = (value, fallback) => {
  const number = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, number));
};

/**
 * Reads the POS discount settings through the given getter (settingsService.getSetting).
 * `pos.manager_approval_discount_percent` is deliberately not read: it needs an
 * approval flow at the till, which does not exist yet.
 */
export const readPosDiscountLimitSettings = async (getSetting) => ({
  allowDiscount: toBooleanSetting(await getSetting("pos.allow_discount", true), true),
  maxDiscountPercent: toPercentSetting(await getSetting("pos.max_discount_percent", 20), 20),
});

const MONEY_EPSILON = 0.009;

/**
 * The manual discount (item discounts + invoice discount — never coupon, loyalty or
 * an offer price, which is already the line's unit price) as a percent of the gross
 * subtotal, against the store's limits. `previousPercent` lets an invoice edit keep
 * a discount it already carried (granted when the sale was rung up).
 */
export const evaluatePosDiscountLimit = ({
  grossSubtotal = 0,
  manualDiscount = 0,
  allowDiscount = true,
  maxDiscountPercent = 20,
  previousPercent = null,
} = {}) => {
  const gross = Math.max(0, Number(grossSubtotal || 0));
  const discount = Math.max(0, Number(manualDiscount || 0));
  const percent = gross > 0 ? (discount / gross) * 100 : (discount > MONEY_EPSILON ? 100 : 0);
  const roundedPercent = Math.round(percent * 100) / 100;
  const base = { exceeded: false, reason: null, percent: roundedPercent, maxPercent: maxDiscountPercent };
  if (discount <= MONEY_EPSILON) return base;
  if (previousPercent != null && Number.isFinite(Number(previousPercent)) && percent <= Number(previousPercent) + 0.01) return base;
  if (!allowDiscount) return { ...base, exceeded: true, reason: "discount_disabled" };
  if (percent > Number(maxDiscountPercent) + 0.01) return { ...base, exceeded: true, reason: "max_percent" };
  return base;
};

export const buildPosDiscountLimitMessage = (evaluation = {}) =>
  evaluation.reason === "discount_disabled"
    ? "الخصم اليدوي غير مسموح في نقطة البيع. اطلب من المدير تطبيق الخصم"
    : `الخصم ${Number(evaluation.percent || 0)}% أكبر من الحد المسموح ${Number(evaluation.maxPercent || 0)}%. اطلب من المدير تطبيق الخصم`;
