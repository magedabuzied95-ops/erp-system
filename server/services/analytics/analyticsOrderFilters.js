/**
 * THE order-scope filters, in one place.
 *
 * Before this module the filters were applied ad hoc, service by service, and had drifted
 * badly: `branchId` was honoured at eleven sites, `channel` at two, `customerId` at one,
 * and `paymentMethod`, `categoryId` and `employeeId` at none at all — while every one of
 * them was parsed, validated and returned in the response envelope as though it had been
 * applied. A control that silently does nothing on four pages out of six is worse than a
 * missing control: the reader believes they filtered.
 *
 * So there is one builder, every order-scoped service calls it, and a test fails if a
 * service builds order clauses without it. A filter is then either live everywhere or
 * absent everywhere, and which one is a fact about this file rather than about which
 * service you happened to open.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 *   warehouseId  `orders.warehouse_id` is populated on 0 of 579 production orders. The
 *                legacy page offers the control anyway, so it silently returns everything.
 *                Reproducing it would be reproducing a lie. It stays on `purchases`,
 *                where the column is real.
 *   employeeId   `orders` has no `employee_id` column at all. Same story.
 *
 * Both are recorded in docs/reports-retirement-readiness.md as legacy controls with no
 * honest equivalent, rather than quietly dropped.
 */

/**
 * Filters that narrow a set of orders. Each entry states the column it needs, so the
 * clause is simply absent on a schema that lacks it rather than throwing.
 *
 * `expr` receives the bound parameter placeholder and the alias, and returns SQL. Values
 * are ALWAYS bound — never interpolated — because several of these arrive as free text.
 */
export const ORDER_FILTERS = Object.freeze([
  {
    key: "branchId",
    column: "branch_id",
    expr: (alias, param) => `${alias}.branch_id = ${param}`,
  },
  {
    key: "customerId",
    column: "customer_id",
    expr: (alias, param) => `${alias}.customer_id = ${param}`,
  },
  {
    key: "channel",
    column: "channel",
    expr: (alias, param) => `LOWER(COALESCE(${alias}.channel, '')) = LOWER(${param})`,
  },
  {
    key: "paymentMethod",
    column: "payment_method",
    expr: (alias, param) => `LOWER(COALESCE(${alias}.payment_method, '')) = LOWER(${param})`,
  },
  {
    /*
     * `orders.shift_id` -> `cash_drawer_shifts.id`, a real foreign key, populated on
     * 576 of 579 production orders. This is a till session, not an attribution guess:
     * the POS writes it when the drawer is open, so "which shift was this sold in" is
     * recorded fact.
     */
    key: "shiftId",
    column: "shift_id",
    expr: (alias, param) => `${alias}.shift_id = ${param}`,
  },
  {
    /*
     * `orders.salesperson_id` -> `employees.id`, a real foreign key, populated on 517 of
     * 579 production orders with ZERO dangling references, resolving to five named
     * people. It also agrees with `sales_employee_id` on all 517 rows and disagrees on
     * none, so the two columns are the same attribution stored twice.
     *
     * This is the one filter that could have been fabricated and is not: it filters on
     * what the POS recorded at the till, and an order with no salesperson simply falls
     * out of the filtered set rather than being attributed to somebody.
     */
    key: "salespersonId",
    column: "salesperson_id",
    expr: (alias, param) => `${alias}.salesperson_id = ${param}`,
  },
]);

/** Just the keys, for the filter contract the client validates against. */
export const ORDER_FILTER_KEYS = Object.freeze(ORDER_FILTERS.map((entry) => entry.key));

/**
 * Legacy controls with no honest equivalent, and why. Exported so the readiness document
 * and the parity matrix can cite one source rather than restating the reasoning.
 */
export const UNSUPPORTED_LEGACY_FILTERS = Object.freeze([
  {
    key: "warehouseId",
    reason: "orders.warehouse_id is populated on 0 of 579 production orders; nothing writes it",
    legacyBehaviour: "the control renders and silently matches every order",
  },
  {
    key: "employeeId",
    reason: "orders has no employee_id column; attribution runs through salesperson_id",
    legacyBehaviour: "the control renders and silently matches every order",
  },
]);

/**
 * Build the WHERE fragments for whichever of these filters the caller supplied.
 *
 * @param {object}   options
 * @param {object}   options.filters      parsed filters, from parseAnalyticsFilters
 * @param {Set}      options.orderColumns column names present on `orders`
 * @param {Function} options.bind         pushes a value and returns its `$n` placeholder
 * @param {string}   [options.alias]      table alias in the query being built
 * @returns {{ clauses: string[], applied: string[], skipped: string[] }}
 *
 * `applied` and `skipped` are returned so a response can state which filters actually
 * narrowed it. A filter the schema could not honour must not be reported as applied.
 */
export const orderFilterClauses = ({ filters = {}, orderColumns, bind, alias = "o" } = {}) => {
  const clauses = [];
  const applied = [];
  const skipped = [];

  for (const entry of ORDER_FILTERS) {
    const value = filters[entry.key];
    if (value === undefined || value === null || value === "") continue;
    /*
     * A numeric zero is not an id. `parseAnalyticsFilters` already rejects it, but the
     * builder must not depend on its caller having done so: `shift_id = 0` matches
     * nothing and returns an empty report, which reads as a quiet week rather than as a
     * mistake. Anything that fails to be a positive number is dropped the same way.
     */
    if (typeof value === "number" && !(Number.isFinite(value) && value > 0)) continue;

    if (!orderColumns?.has?.(entry.column)) {
      skipped.push(entry.key);
      continue;
    }

    clauses.push(entry.expr(alias, bind(value)));
    applied.push(entry.key);
  }

  return { clauses, applied, skipped };
};
