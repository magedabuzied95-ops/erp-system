/**
 * Manager Portal — payment distribution helpers.
 *
 * A "split payment" (دفع مقسم) is NOT a payment method. It is a sale whose paid
 * amount is distributed across multiple real payment methods, stored on the
 * authoritative `orders.payment_breakdown` jsonb column as an array of
 * `{ method, account_id, amount }` allocations.
 *
 * These helpers aggregate the real allocations so the Today report reflects the
 * actual per-method totals and usage counts, and never surfaces `split` as a
 * payment method. Pure functions only (no DB) so they are unit-testable.
 */

// Mirrors server/controllers/ordersController.js -> normalizeMoneyPaymentMethod,
// but returns "" for an empty/unknown method so the caller can bucket it as
// "unknown" (matching the previous SQL COALESCE(..., 'unknown') behaviour).
export const normalizeManagerPaymentMethod = (value) => {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "";
  if (key === "visa") return "card";
  if (key === "vodafone") return "vodafone_cash";
  if (key === "insta_pay") return "instapay";
  if (["credit_sale", "deferred_sale", "deferred", "due_sale", "due"].includes(key)) return "credit_sale";
  if (["store_credit", "customer_credit", "credit_balance"].includes(key)) return "customer_wallet";
  return key;
};

// `orders.payment_breakdown` is jsonb — the pg driver returns it already parsed
// as an array, but tolerate a stringified value defensively.
export const parseOrderPaymentBreakdown = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Aggregate today's included sales into a per-payment-method distribution.
 *
 * @param {Array<{payment_method?:string, total_amount?:number|string, payment_breakdown?:any}>} orderRows
 *   Already filtered to the included sales (the caller applies the same
 *   today/status/tenant/branch WHERE clause as before — cancelled/canceled/void
 *   excluded). Each row carries its stored allocations.
 * @returns {Array<{method:string, count:number, total:number}>} sorted desc by total.
 */
export const aggregatePaymentDistribution = (orderRows = []) => {
  const totals = new Map(); // method -> { method, total, count }

  const bump = (method, amount, countKey, seen) => {
    const bucket = totals.get(method) || { method, total: 0, count: 0 };
    bucket.total += Number(amount) || 0;
    // Count one usage per method per order (a split Cash+InstaPay order adds one
    // usage to Cash and one to InstaPay, never a "split" usage).
    if (countKey && !seen.has(countKey)) {
      bucket.count += 1;
      seen.add(countKey);
    }
    totals.set(method, bucket);
  };

  for (const row of Array.isArray(orderRows) ? orderRows : []) {
    if (!row || typeof row !== "object") continue;

    const allocations = parseOrderPaymentBreakdown(row.payment_breakdown)
      .map((payment) => {
        if (!payment || typeof payment !== "object") return null;
        // Skip edit-time additional payments to avoid double counting, matching
        // the collected-amount semantics used elsewhere in the ERP.
        if (payment.edit_additional_payment) return null;
        const method = normalizeManagerPaymentMethod(payment.method || payment.payment_method);
        const amount = Number(payment.amount ?? payment.paid_amount ?? payment.value ?? 0);
        if (!method || !Number.isFinite(amount) || amount <= 0) return null;
        return { method, amount };
      })
      .filter(Boolean);

    if (allocations.length) {
      const seen = new Set();
      for (const alloc of allocations) {
        bump(alloc.method, alloc.amount, alloc.method, seen);
      }
    } else {
      // No stored allocations (e.g. deferred/آجل or legacy orders): preserve the
      // previous behaviour — the full order amount under its single method.
      const method = normalizeManagerPaymentMethod(row.payment_method) || "unknown";
      const amount = Number(row.total_amount || 0);
      const seen = new Set();
      bump(method, amount, method, seen);
    }
  }

  return Array.from(totals.values())
    .map((bucket) => ({ method: bucket.method, count: bucket.count, total: round2(bucket.total) }))
    .sort((a, b) => b.total - a.total || b.count - a.count || a.method.localeCompare(b.method));
};

export default aggregatePaymentDistribution;
