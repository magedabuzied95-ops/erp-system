/**
 * Canonical metric SQL for Analytics v2.
 *
 * Builds on server/services/analytics/accountingCanon.js — the expressions shared with
 * accountingService — and applies the corrections frozen in
 * docs/analytics/metric-contract.md. Every intentional divergence from legacy accounting
 * is listed in DIVERGENCES below and surfaced as a reconciliation warning, never applied
 * silently.
 *
 * This module builds SQL and pure JS. It does not execute queries and does not catch
 * errors: a failing query must reach the caller as a 500, never become a zero (D-11).
 */

import {
  coalesceColumnExpr,
  columnExpr,
  itemUnitCostExpr,
  netQuantityExpr,
  paidOrderClauses,
  positiveCoalesceColumnExpr,
  purchaseCostLookup,
} from "./accountingCanon.js";
import { WARNING_CODES } from "./analyticsComparison.js";

export const CONTRACT_VERSION = "1.0.0";

/**
 * Every place v2 knowingly differs from legacy accounting. The reconciliation service
 * quantifies each of these so a v2-vs-legacy gap is always explained, never mysterious.
 */
export const DIVERGENCES = Object.freeze([
  { id: "D-02", metric: "discountAmount", warning: WARNING_CODES.DISCOUNT_DEFINITION_DELTA, summary: "discount_amount is all-inclusive; legacy adds coupon (and reports-v2 adds invoice) on top" },
  { id: "D-04", metric: "orders", warning: WARNING_CODES.SOFT_DELETED_EXCLUDED, summary: "v2 excludes deleted_at IS NOT NULL" },
  { id: "D-05", metric: "orders", warning: WARNING_CODES.DRAFT_STATUS_EXCLUDED, summary: "v2 excludes any status matching %draft%, not just the literal 'draft'" },
  { id: "D-07", metric: "operatingExpenses", warning: WARNING_CODES.DRAFT_EXPENSES_EXCLUDED, summary: "v2 excludes draft expenses" },
  { id: "D-03", metric: "netSales", warning: WARNING_CODES.EXCHANGE_COGS_UNREVERSED, summary: "v2 recognises amount_due_now for exchange orders; original COGS still unreversed" },
  { id: "D-08", metric: "inventoryValue", warning: WARNING_CODES.STOCK_SOURCE_DIVERGENCE, summary: "v2 values stock from product_variants.stock, not the dead products.stock" },
]);

/**
 * NUMERIC columns can hold IEEE NaN, and NaN propagates through SUM, turning a whole
 * aggregate into NaN (D-01: purchases.total). Neutralise per row.
 */
export const nanSafe = (expr) => `(CASE WHEN (${expr})::text = 'NaN' THEN 0 ELSE COALESCE(${expr}, 0) END)`;

export const nanCount = (expr) => `COUNT(*) FILTER (WHERE (${expr})::text = 'NaN')`;

/**
 * THE v2 order predicate. Canonical accounting clauses plus the two exclusions approved
 * in decision #1. Assumes alias `o`.
 *
 * Returns { clauses, divergenceClauses } so the reconciliation service can run the same
 * query with and without the v2-only clauses and quantify the difference exactly.
 */
export const canonicalOrderClauses = (orderColumns, { alias = "o" } = {}) => {
  const base = paidOrderClauses(orderColumns);

  const divergenceClauses = [];
  if (orderColumns.has("deleted_at")) {
    divergenceClauses.push({ id: "D-04", sql: `${alias}.deleted_at IS NULL` });
  }
  if (orderColumns.has("status")) {
    divergenceClauses.push({ id: "D-05", sql: `LOWER(COALESCE(${alias}.status, '')) NOT LIKE '%draft%'` });
  }

  return {
    base,
    divergenceClauses,
    clauses: [...base, ...divergenceClauses.map((entry) => entry.sql)],
  };
};

/* --------------------------------------------------------------------- revenue */

/**
 * Gross sales. Prefers the stored subtotal; falls back to total + discounts for the rows
 * where subtotal was never populated (4 of 96 canonical orders on the dev dataset).
 * Matches accountingService's grossExpr.
 */
export const grossSalesExpr = (orderColumns, { alias = "o" } = {}) => {
  const total = coalesceColumnExpr(alias, orderColumns, ["total_amount", "total", "total_price", "grand_total", "net_total"], "0");
  const discount = discountAmountExpr(orderColumns, { alias });
  const candidates = ["subtotal", "gross_total", "items_subtotal", "sub_total"]
    .filter((column) => orderColumns.has(column))
    .map((column) => `NULLIF(${alias}.${column}, 0)`);
  return `COALESCE(${[...candidates, `(${total}) + (${discount})`].join(", ")})`;
};

/**
 * Total discount — `discount_amount` ALONE.
 *
 * orders.discount_amount is bound from ordersController's `totalDiscount`, which already
 * sums item + invoice + loyalty + coupon discount. Adding invoice_discount_amount or
 * coupon_discount_amount on top double-counts them (D-02). Proven by the identity
 *   subtotal - discount_amount + service_fee + tax_amount = total_amount
 * holding for 144/144 dev orders with a subtotal.
 */
export const discountAmountExpr = (orderColumns, { alias = "o" } = {}) =>
  orderColumns.has("discount_amount") ? `COALESCE(${alias}.discount_amount, 0)` : "0";

/** Breakdown components, for display only. These must never be summed into the total. */
export const discountBreakdownExprs = (orderColumns, { alias = "o" } = {}) => ({
  total: discountAmountExpr(orderColumns, { alias }),
  invoice: orderColumns.has("invoice_discount_amount") ? `COALESCE(${alias}.invoice_discount_amount, 0)` : "0",
  coupon: orderColumns.has("coupon_discount_amount") ? `COALESCE(${alias}.coupon_discount_amount, 0)` : "0",
});

/**
 * Revenue contribution of a single order.
 *
 * Exchange orders recognise `amount_due_now` (the incremental consideration) rather than
 * total_amount, because the exchange flow never reverses the original order — no returns
 * row, returned_quantity stays 0, stock is not restored (D-03). Counting both sides in
 * full double-counts the credited portion.
 */
export const orderRevenueExpr = (orderColumns, { alias = "o" } = {}) => {
  const gross = grossSalesExpr(orderColumns, { alias });
  const discount = discountAmountExpr(orderColumns, { alias });
  const net = `((${gross}) - (${discount}))`;
  if (!orderColumns.has("exchange_mode") || !orderColumns.has("amount_due_now")) return net;
  return `(CASE WHEN COALESCE(${alias}.exchange_mode, FALSE) THEN COALESCE(${alias}.amount_due_now, 0) ELSE ${net} END)`;
};

/** Exchange credit the customer did not consume — the residual v2 overstatement. §6 */
export const exchangeCreditRetainedExpr = (orderColumns, { alias = "o" } = {}) => {
  if (!orderColumns.has("exchange_mode") || !orderColumns.has("exchange_difference")) return "0";
  return `(CASE WHEN COALESCE(${alias}.exchange_mode, FALSE) THEN GREATEST(-COALESCE(${alias}.exchange_difference, 0), 0) ELSE 0 END)`;
};

/* ------------------------------------------------------------------------ cost */

/**
 * Sold-line unit cost and net quantity, plus the joins they need.
 * Identical ladder to accountingService: override -> variant -> product -> purchase
 * history LATERAL -> 0.
 */
export const buildCostContext = ({ orderColumns, itemColumns, productColumns, variantColumns, overrideColumns, purchaseColumns, purchaseItemColumns, tenantId }) => {
  const variantTableExists = variantColumns.size > 0;
  const productTableExists = productColumns.size > 0;

  const productIdExpr = itemColumns.has("product_id")
    ? `COALESCE(oi.product_id, ${variantTableExists && itemColumns.has("variant_id") ? "pv.product_id" : "NULL::bigint"})`
    : variantTableExists && itemColumns.has("variant_id")
      ? "pv.product_id"
      : "NULL::bigint";
  const variantIdExpr = itemColumns.has("variant_id") ? "oi.variant_id" : "NULL::bigint";

  const purchaseLookup = purchaseCostLookup({
    purchaseColumns,
    purchaseItemColumns,
    variantColumns,
    productIdExpr,
    variantIdExpr,
    tenantParam: tenantId !== null && tenantId !== undefined ? "$1" : "o.tenant_id",
  });

  const unitCost = itemUnitCostExpr({
    overrideColumns,
    variantColumns,
    productColumns,
    purchaseLookupExpr: purchaseLookup.expr,
  });

  const joins = [
    variantTableExists && itemColumns.has("variant_id") ? "LEFT JOIN product_variants pv ON pv.id = oi.variant_id" : "",
    productTableExists ? `LEFT JOIN products p ON p.id = ${productIdExpr}` : "",
    overrideColumns.size ? "LEFT JOIN accounting_order_item_cost_overrides aoc ON aoc.order_item_id = oi.id AND aoc.tenant_id = o.tenant_id" : "",
    purchaseLookup.join,
  ].filter(Boolean).join("\n");

  const netQuantity = netQuantityExpr(itemColumns);

  return {
    productIdExpr,
    variantIdExpr,
    unitCostExpr: unitCost,
    netQuantityExpr: netQuantity,
    joins,
    cogsExpr: `SUM((${netQuantity}) * GREATEST(${unitCost}, 0))`,
    // COGS coverage: share of sold units whose cost resolved to something non-zero.
    costedUnitsExpr: `SUM((${netQuantity}) * (CASE WHEN GREATEST(${unitCost}, 0) > 0 THEN 1 ELSE 0 END))`,
    totalUnitsExpr: `SUM(${netQuantity})`,
  };
};

/** Line-level net sales, used for every per-dimension breakdown. §4 dimension allocation */
export const lineNetSalesExpr = (itemColumns, { alias = "oi" } = {}) => {
  const lineTotal = coalesceColumnExpr(alias, itemColumns, ["total_amount", "line_total", "subtotal"], "0");
  const quantity = coalesceColumnExpr(alias, itemColumns, ["quantity", "qty"], "0");
  const net = netQuantityExpr(itemColumns, alias);
  return `(CASE WHEN (${quantity}) > 0 THEN (${lineTotal}) * (${net}) / (${quantity}) ELSE 0 END)`;
};

/* -------------------------------------------------------------------- expenses */

/**
 * Expenses v2 recognises. Adds 'draft' to the legacy exclusion list (D-07) — draft
 * expenses were 1 850 of 6 000 on the dev dataset.
 */
export const recognisedExpenseClausesV2 = (expenseColumns, { alias = "e" } = {}) => {
  if (!expenseColumns.has("status")) return { clauses: [], divergenceClauses: [] };
  return {
    clauses: [`LOWER(COALESCE(${alias}.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted', 'draft')`],
    divergenceClauses: [{ id: "D-07", sql: `LOWER(COALESCE(${alias}.status, '')) <> 'draft'` }],
  };
};

/** Purchases v2 counts. Excludes drafts, soft-deletes and reversals, and guards NaN (D-01). */
export const recognisedPurchaseClauses = (purchaseColumns, { alias = "pu" } = {}) => {
  const clauses = [];
  if (purchaseColumns.has("status")) {
    clauses.push(`LOWER(COALESCE(${alias}.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')`);
  }
  if (purchaseColumns.has("deleted_at")) clauses.push(`${alias}.deleted_at IS NULL`);
  if (purchaseColumns.has("reversed_at")) clauses.push(`${alias}.reversed_at IS NULL`);
  return clauses;
};

export const purchaseTotalExpr = (purchaseColumns, { alias = "pu" } = {}) =>
  `SUM(${nanSafe(coalesceColumnExpr(alias, purchaseColumns, ["total", "total_amount", "grand_total"], "0"))})`;

/* ------------------------------------------------------------------- inventory */

/**
 * On-hand stock. product_variants.stock is the only live source — nothing in server/
 * writes products.stock, and on the dev dataset the two disagree 777 vs 236 (D-08).
 */
export const variantStockClauses = ({ variantColumns, alias = "pv" }) => {
  const clauses = [];
  if (variantColumns.has("deleted_at")) clauses.push(`${alias}.deleted_at IS NULL`);
  if (variantColumns.has("is_active")) clauses.push(`COALESCE(${alias}.is_active, TRUE) = TRUE`);
  return clauses;
};

export const variantStockExpr = ({ variantColumns, alias = "pv" }) =>
  variantColumns.has("stock") ? `COALESCE(${alias}.stock, 0)` : "0";

/** On-hand unit cost. Same ladder as COGS, minus the order-item override rung. */
export const onHandUnitCostExpr = ({ variantColumns, productColumns, purchaseLookupExpr = "0" }) =>
  positiveCoalesceColumnExpr(
    "pv",
    variantColumns,
    ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"],
    positiveCoalesceColumnExpr("p", productColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], purchaseLookupExpr)
  );

/**
 * Movement-type vocabulary, discovered from data rather than assumed.
 * Anything outside these buckets is counted nowhere and raises UNKNOWN_MOVEMENT_TYPE.
 * See docs/analytics/metric-contract.md §5.
 */
export const MOVEMENT_TYPES = Object.freeze({
  purchaseIn: ["purchase", "purchase_in", "purchase_edit_stock_in"],
  saleOut: ["sale", "website_order", "sale_out"],
  returnIn: ["return", "order_cancel", "order_edit_restore", "order_hard_delete_restore"],
  adjustment: ["product_stock_edit", "edit_variant_stock"],
  reversalOut: ["purchase_reverse_stock_out", "order_edit_deduct"],
  ownerUse: ["owner_use_out"],
});

export const KNOWN_MOVEMENT_TYPES = Object.freeze(Object.values(MOVEMENT_TYPES).flat());

export const classifyMovementType = (movementType) => {
  const value = String(movementType || "").toLowerCase();
  for (const [bucket, types] of Object.entries(MOVEMENT_TYPES)) {
    if (types.includes(value)) return bucket;
  }
  return null;
};

/* ----------------------------------------------------------------- dimensions */

/**
 * Dimension -> SQL. The key is validated against BREAKDOWN_DIMENSIONS by
 * analyticsFilters before it reaches here; nothing from the request is interpolated.
 */
export const DIMENSION_SQL = Object.freeze({
  category: { expr: "COALESCE(NULLIF(cat.name, ''), 'غير مصنف')", join: "LEFT JOIN categories cat ON cat.id = p.category_id", key: "cat.id" },
  brand: { expr: "COALESCE(NULLIF(br.name, ''), 'بدون علامة')", join: "LEFT JOIN brands br ON br.id = p.brand_id", key: "br.id" },
  product: { expr: "COALESCE(NULLIF(p.name, ''), oi.product_name, 'غير معروف')", join: "", key: "p.id" },
  variant: { expr: "COALESCE(NULLIF(pv.sku, ''), oi.sku, oi.variant_name, 'افتراضي')", join: "", key: "pv.id" },
  size: { expr: "COALESCE(NULLIF(oi.size, ''), NULLIF(pv.size, ''), 'مقاس واحد')", join: "", key: "COALESCE(NULLIF(oi.size, ''), NULLIF(pv.size, ''))" },
  color: { expr: "COALESCE(NULLIF(oi.color, ''), NULLIF(pv.color, ''), 'بدون لون')", join: "", key: "COALESCE(NULLIF(oi.color, ''), NULLIF(pv.color, ''))" },
  channel: { expr: "COALESCE(NULLIF(o.channel, ''), 'pos')", join: "", key: "COALESCE(NULLIF(o.channel, ''), 'pos')" },
  payment_method: { expr: "COALESCE(NULLIF(o.payment_method, ''), 'غير محدد')", join: "", key: "COALESCE(NULLIF(o.payment_method, ''), 'غير محدد')" },
  branch: { expr: "COALESCE(NULLIF(b.name, ''), 'بدون فرع')", join: "LEFT JOIN branches b ON b.id = o.branch_id", key: "b.id" },
  supplier: { expr: "COALESCE(NULLIF(s.name, ''), 'بدون مورد')", join: "LEFT JOIN suppliers s ON s.id = p.supplier_id", key: "s.id" },
  employee: { expr: "COALESCE(NULLIF(o.seller_name, ''), NULLIF(se.name, ''), NULLIF(o.salesperson_name, ''), 'غير منسوب')", join: "LEFT JOIN sales_employees se ON se.id = o.sales_employee_id", key: "COALESCE(o.seller_user_id, o.sales_employee_id, o.salesperson_id)" },
});

/**
 * Seller attribution precedence, surfaced to the UI so a comparison is never ambiguous.
 * orders has no employee_id column — reportsService assumes one and therefore always
 * reports zero employee revenue.
 */
export const SELLER_ATTRIBUTION_PRECEDENCE = Object.freeze(["seller_user_id", "sales_employee_id", "salesperson_id"]);

export const resolveSellerAttributionField = (orderColumns) =>
  SELLER_ATTRIBUTION_PRECEDENCE.find((column) => orderColumns.has(column)) || null;

/* ------------------------------------------------------------------- time axis */

export const TIME_BUCKET_SQL = Object.freeze({
  hour: "date_trunc('hour', o.created_at)",
  day: "date_trunc('day', o.created_at)",
  week: "date_trunc('week', o.created_at)",
  month: "date_trunc('month', o.created_at)",
});

export const timeBucketExpr = (granularity) => TIME_BUCKET_SQL[granularity] || TIME_BUCKET_SQL.day;
