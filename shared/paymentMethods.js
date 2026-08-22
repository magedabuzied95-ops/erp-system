// `employee_advance` settles a deferred invoice against an employee's salary
// advance. Like `credit_sale`, it moves no money at the till — the invoice reads
// as paid, but nothing entered the drawer, so it must never be counted as
// collected or it inflates the shift's expected cash.
const NON_COLLECTED_METHODS = new Set(["credit_sale", "exchange_credit", "return_credit", "employee_advance"]);

export const normalizePaymentMethodKey = (value = "") => {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (key === "visa") return "card";
  // Wallet rails ride on a card token but stay distinct so reporting can show
  // how much of the card volume actually came through Apple Pay.
  if (["applepay", "apple"].includes(key)) return "apple_pay";
  if (["googlepay", "google"].includes(key)) return "google_pay";
  if (key === "vodafone") return "vodafone_cash";
  if (key === "insta_pay") return "instapay";
  if (["deferred_sale", "deferred", "due_sale", "due"].includes(key)) return "credit_sale";
  if (["employee_advances", "staff_advance", "salary_advance"].includes(key)) return "employee_advance";
  if (["store_credit", "customer_credit", "credit_balance"].includes(key)) return "customer_wallet";
  if (["split", "multiple"].includes(key)) return "mixed";
  return key;
};

export const parsePaymentBreakdown = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getCollectedPaymentAllocations = (value) => {
  const totals = new Map();
  for (const payment of parsePaymentBreakdown(value)) {
    if (!payment || typeof payment !== "object") continue;
    const method = normalizePaymentMethodKey(payment.method || payment.payment_method);
    const amount = Number(payment.amount ?? payment.paid_amount ?? payment.value ?? 0);
    if (!method || NON_COLLECTED_METHODS.has(method) || !Number.isFinite(amount) || amount <= 0) continue;
    totals.set(method, Number(totals.get(method) || 0) + amount);
  }
  return Array.from(totals, ([method, amount]) => ({ method, amount }));
};

// `split` is a POS input mode, never an accounting payment method. Persist the
// real method for one allocation and an internal `mixed` marker for 2+ methods.
export const deriveStoredPaymentMethod = ({ requestedMethod = "", paymentBreakdown = [], fallback = "cash" } = {}) => {
  const requested = normalizePaymentMethodKey(requestedMethod);
  if (["credit_sale", "personal", "employee_advance", "cod", "cash_on_delivery"].includes(requested)) return requested;
  const methods = getCollectedPaymentAllocations(paymentBreakdown).map((payment) => payment.method);
  if (methods.length === 1) return methods[0];
  if (methods.length > 1) return "mixed";
  return requested === "mixed" ? "mixed" : requested || fallback;
};

const AR_LABELS = {
  cash: "نقدي",
  card: "فيزا",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  instapay: "InstaPay",
  vodafone_cash: "Vodafone Cash",
  wallet: "محفظة",
  customer_wallet: "رصيد العميل",
  credit_sale: "آجل",
  employee_advance: "سلفة موظف",
  cod: "الدفع عند الاستلام",
  cash_on_delivery: "الدفع عند الاستلام",
};
const EN_LABELS = {
  cash: "Cash",
  card: "Card",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  instapay: "InstaPay",
  vodafone_cash: "Vodafone Cash",
  wallet: "Wallet",
  customer_wallet: "Customer credit",
  credit_sale: "Deferred",
  employee_advance: "Employee advance",
  cod: "Cash on delivery",
  cash_on_delivery: "Cash on delivery",
};

export const formatOrderPaymentMethods = (order = {}, language = "ar") => {
  const isArabic = String(language || "").toLowerCase().startsWith("ar");
  const labels = isArabic ? AR_LABELS : EN_LABELS;
  const allocations = getCollectedPaymentAllocations(order.payment_breakdown ?? order.paymentBreakdown ?? order.payments);
  if (allocations.length) return allocations.map(({ method }) => labels[method] || method).join(" + ");
  const method = normalizePaymentMethodKey(order.payment_method || order.paymentMethod || order.payment_type || order.paymentType);
  if (method === "mixed") return isArabic ? "طرق دفع متعددة" : "Multiple payment methods";
  return labels[method] || method || (isArabic ? "غير محدد" : "Unspecified");
};
