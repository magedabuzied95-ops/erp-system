const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parsePaymentBreakdown = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizePaymentMethod = (value = "") =>
  String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

export const normalizeInvoicePaymentBreakdown = (value) => {
  const totalsByMethod = new Map();
  parsePaymentBreakdown(value).forEach((payment) => {
    const method = normalizePaymentMethod(payment?.method || payment?.payment_method);
    const amount = toNumber(payment?.amount ?? payment?.paid_amount ?? payment?.value, 0);
    if (!method || amount <= 0 || ["credit_sale", "exchange_credit", "return_credit"].includes(method)) return;
    totalsByMethod.set(method, toNumber(totalsByMethod.get(method), 0) + amount);
  });
  return Array.from(totalsByMethod, ([method, amount]) => ({ method, amount }));
};

export default normalizeInvoicePaymentBreakdown;
