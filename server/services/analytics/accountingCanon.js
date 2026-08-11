/**
 * Canonical accounting SQL expressions — the single source of truth for how this ERP
 * decides which orders are sales, what a sold unit costs, and how revenue is composed.
 *
 * These functions were EXTRACTED VERBATIM from server/services/accountingService.js.
 * They are not a second implementation: accountingService.js imports them from here, so
 * there is physically one copy shared by the accounting layer and Analytics v2.
 *
 * RULES FOR THIS FILE
 *
 * 1. Behaviour-preserving only. Changing an expression here changes published accounting
 *    output. tests/analytics/analytics-pl-parity.test.js guards this.
 * 2. Analytics v2 must NOT edit these to "fix" a defect. Corrections that intentionally
 *    diverge from legacy accounting live in the analytics metric layer and are declared
 *    in docs/analytics/metric-contract.md, then reported as reconciliation deltas.
 * 3. Every expression is schema-defensive: callers pass a Set of column names obtained
 *    from information_schema, and each helper degrades to a literal when a column is
 *    absent. That is why the same code runs against older tenant schemas.
 *
 * See: docs/analytics/metric-contract.md  §1.3 canonical predicate, §1.4 net quantity,
 *      §1.5 unit-cost ladder, §3 revenue.
 */

/** First name in `names` that exists in `columns`, else null. */
export const firstColumn = (columns, names = []) => names.find((name) => columns.has(name)) || null;

/** `alias.<first existing column>`, else `fallback`. */
export const columnExpr = (alias, columns, names = [], fallback = "0") => {
  const column = firstColumn(columns, names);
  return column ? `${alias}.${column}` : fallback;
};

/** COALESCE over every existing column in `names`, else `fallback`. */
export const coalesceColumnExpr = (alias, columns, names = [], fallback = "0") => {
  const expressions = names.filter((name) => columns.has(name)).map((name) => `${alias}.${name}`);
  return expressions.length ? `COALESCE(${[...expressions, fallback].join(", ")})` : fallback;
};

/**
 * COALESCE over existing columns, treating 0 as "not set" (NULLIF(col, 0)).
 * This is what makes the unit-cost ladder pick the first NON-ZERO cost.
 */
export const positiveCoalesceColumnExpr = (alias, columns, names = [], fallback = "0") => {
  const expressions = names.filter((name) => columns.has(name)).map((name) => `NULLIF(${alias}.${name}, 0)`);
  return expressions.length ? `COALESCE(${[...expressions, fallback].join(", ")})` : fallback;
};

/**
 * Tenant + inclusive date range + branch scoping. Dates compare on DATE(col), so both
 * ends are inclusive. Pushes bound parameters onto `params` and appends to `clauses`.
 */
export const addScopedWhere = ({ clauses, params, alias, columns, tenantId, fromDate, toDate, branchId, dateColumns = ["created_at"] }) => {
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (tenantId !== null && columns.has("tenant_id")) clauses.push(`${alias}.tenant_id = ${add(tenantId)}`);
  const dateColumn = firstColumn(columns, dateColumns);
  if (dateColumn && fromDate) clauses.push(`DATE(${alias}.${dateColumn}) >= ${add(fromDate)}`);
  if (dateColumn && toDate) clauses.push(`DATE(${alias}.${dateColumn}) <= ${add(toDate)}`);
  if (branchId && columns.has("branch_id")) clauses.push(`${alias}.branch_id = ${add(branchId)}`);
  return { add };
};

export const whereSql = (clauses) => (clauses.length ? `WHERE ${clauses.join(" AND ")}` : "");

/**
 * THE canonical "this order is a recognised sale" predicate. Assumes alias `o`.
 *
 * Known gaps, deliberately preserved here so accounting output does not shift, and
 * corrected only in the Analytics v2 layer (see docs/analytics/legacy-defects.md):
 *   D-04  does not test `o.deleted_at IS NULL`
 *   D-05  matches 'draft' literally, so `ai_draft` survives this clause
 */
export const paidOrderClauses = (orderColumns) => {
  const statusExpr = orderColumns.has("status") ? "LOWER(COALESCE(o.status, ''))" : "''";
  const paymentStatusExpr = orderColumns.has("payment_status") ? "LOWER(COALESCE(o.payment_status, ''))" : "''";
  const personalExpr = orderColumns.has("is_personal_transaction") ? "COALESCE(o.is_personal_transaction, FALSE)" : "FALSE";
  return [
    `${statusExpr} NOT IN ('cancelled', 'canceled', 'void', 'refunded', 'returned', 'draft', 'deleted')`,
    `${personalExpr} = FALSE`,
    `(
      ${paymentStatusExpr} IN ('paid', 'completed', 'complete', 'partially_paid', 'partial')
      OR ${statusExpr} IN ('paid', 'completed', 'complete', 'delivered')
    )`,
  ];
};

/**
 * Last resort of the unit-cost ladder: a LATERAL that resolves a sold line's cost from
 * purchase history — most recent non-cancelled purchase line for the (product, variant),
 * falling back to the average over those lines, then 0.
 *
 * Performance note: purchase_items has no index on (tenant_id, product_id, variant_id),
 * so this is the most expensive part of any COGS query. See
 * docs/reporting-center-architecture.md §K.3 index #1.
 */
export const purchaseCostLookup = ({
  purchaseColumns,
  purchaseItemColumns,
  variantColumns,
  productIdExpr,
  variantIdExpr,
  tenantParam = "$1",
  alias = "pcost",
  /**
   * SQL for the cost resolved by the EARLIER rungs (override -> variant -> product),
   * NULL when none of them resolved. Optional; omitting it keeps the original
   * always-evaluate behaviour.
   *
   * A LEFT JOIN LATERAL is evaluated for every driving row whether or not the outer
   * COALESCE ever reads it. On production, 100% of sold lines resolve at the variant
   * or product rung, so this subquery ran ~400 times per query and contributed nothing.
   * The guard wraps it in a CASE so it is only evaluated when the earlier rungs are NULL.
   *
   * Behaviour-preserving by construction: when an earlier rung resolved, the outer
   * COALESCE returns that value and never reads this column, so yielding NULL here
   * instead of a computed cost cannot change any result.
   */
  skipWhenResolved = null,
}) => {
  if (!purchaseColumns.size || !purchaseItemColumns.size) {
    return { join: "", expr: "0" };
  }

  const purchaseCostExpr = positiveCoalesceColumnExpr("pi", purchaseItemColumns, ["unit_cost", "cost_price", "purchase_price", "purchase_cost", "price"], "0");
  const purchaseProductIdExpr = purchaseItemColumns.has("product_id")
    ? `COALESCE(pi.product_id, ${variantColumns.size && purchaseItemColumns.has("variant_id") ? "ppv.product_id" : "NULL::bigint"})`
    : variantColumns.size && purchaseItemColumns.has("variant_id")
      ? "ppv.product_id"
      : "NULL::bigint";
  const purchaseVariantIdExpr = purchaseItemColumns.has("variant_id") ? "pi.variant_id" : "NULL::bigint";
  const purchaseDateExpr = columnExpr("pu", purchaseColumns, ["created_at", "purchase_date", "date"], "CURRENT_TIMESTAMP");
  const purchaseVariantJoin = variantColumns.size && purchaseItemColumns.has("variant_id") ? "LEFT JOIN product_variants ppv ON ppv.id = pi.variant_id AND ppv.tenant_id = pu.tenant_id" : "";
  const purchaseTenantClause = purchaseItemColumns.has("tenant_id") ? `AND pi.tenant_id = ${tenantParam}` : "";
  const purchaseStatusClause = purchaseColumns.has("status") ? "AND LOWER(COALESCE(pu.status, '')) NOT IN ('cancelled', 'canceled', 'void', 'deleted', 'draft')" : "";
  const matchClause = `
    ${purchaseProductIdExpr} = (${productIdExpr})
    AND (
      ((${variantIdExpr}) IS NOT NULL AND ${purchaseVariantIdExpr} = (${variantIdExpr}))
      OR ((${variantIdExpr}) IS NULL)
    )
  `;
  const baseFrom = `
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id AND pu.tenant_id = ${tenantParam}
    ${purchaseVariantJoin}
    WHERE (${productIdExpr}) IS NOT NULL
      ${purchaseTenantClause}
      ${purchaseStatusClause}
      AND GREATEST(${purchaseCostExpr}, 0) > 0
      AND ${matchClause}
  `;

  const lookupExpr = `
        COALESCE(
          (
            SELECT GREATEST(${purchaseCostExpr}, 0)::numeric
            ${baseFrom}
            ORDER BY ${purchaseDateExpr} DESC, pi.id DESC
            LIMIT 1
          ),
          (
            SELECT AVG(GREATEST(${purchaseCostExpr}, 0))::numeric
            ${baseFrom}
          ),
          0
        )`;

  // CASE arms are evaluated lazily, so the subqueries are skipped entirely for rows
  // whose cost already resolved at an earlier rung.
  const guardedExpr = skipWhenResolved
    ? `CASE WHEN (${skipWhenResolved}) IS NOT NULL THEN NULL::numeric ELSE ${lookupExpr} END`
    : lookupExpr;

  return {
    join: `
      LEFT JOIN LATERAL (
        SELECT ${guardedExpr} AS unit_cost
      ) ${alias} ON TRUE
    `,
    expr: `${alias}.unit_cost`,
  };
};

/**
 * The unit cost resolvable WITHOUT touching purchase history: override -> variant ->
 * product. NULL when none of those rungs has a non-zero value.
 *
 * Used as the guard for purchaseCostLookup, and as the first rungs of itemUnitCostExpr,
 * so the two can never drift apart.
 */
export const preLookupUnitCostExpr = ({ overrideColumns, variantColumns, productColumns }) =>
  positiveCoalesceColumnExpr(
    "aoc",
    overrideColumns,
    ["unit_cost"],
    positiveCoalesceColumnExpr(
      "pv",
      variantColumns,
      ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"],
      positiveCoalesceColumnExpr("p", productColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], "NULL")
    )
  );

/* ------------------------------------------------------------------------------ */
/* Named fragments below are NEW (no legacy counterpart) but are pure re-expressions
   of expressions already inlined in accountingService, so Analytics v2 can reference
   them by name instead of re-deriving them. They add no behaviour. */

/** Net sold quantity after returns. accountingService.js:5001. */
export const netQuantityExpr = (itemColumns, alias = "oi") => {
  const quantity = coalesceColumnExpr(alias, itemColumns, ["quantity", "qty"], "0");
  const returned = columnExpr(alias, itemColumns, ["returned_quantity"], "0");
  return `GREATEST((${quantity}) - (${returned}), 0)`;
};

/**
 * The unit-cost ladder, first non-zero wins:
 *   override -> variant -> product -> purchase-history LATERAL -> 0
 * accountingService.js:5016-5021.
 */
export const itemUnitCostExpr = ({ overrideColumns, variantColumns, productColumns, purchaseLookupExpr = "0" }) =>
  positiveCoalesceColumnExpr(
    "aoc",
    overrideColumns,
    ["unit_cost"],
    positiveCoalesceColumnExpr(
      "pv",
      variantColumns,
      ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"],
      positiveCoalesceColumnExpr("p", productColumns, ["last_purchase_cost", "purchase_cost", "cost_price", "unit_cost"], purchaseLookupExpr)
    )
  );

/** Expense rows accounting recognises. Note: 'draft' is NOT excluded (D-07). */
export const recognisedExpenseClauses = (expenseColumns, alias = "e") =>
  expenseColumns.has("status")
    ? [`LOWER(COALESCE(${alias}.status, '')) NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'deleted')`]
    : [];
