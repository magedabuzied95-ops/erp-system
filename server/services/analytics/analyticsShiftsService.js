/**
 * Shift report — "what happened on each till session, and what paid for it".
 *
 * A shift here is a DRAWER SESSION: one cashier opening the till and closing it again,
 * the row the POS writes to `cash_drawer_shifts`. That is the only shift this system has
 * actually recorded — opened_at, closed_at, who opened it, which branch — so every figure
 * below is read back rather than inferred from a roster or guessed from order timestamps.
 *
 * WHICH SHIFTS THE WINDOW HOLDS. A shift belongs to the report when it OPENED inside the
 * window, and the figures are then the whole session's, not the part of it that fell
 * inside. A shift is one unit of accountability: a drawer opened at 23:00 on the 30th and
 * closed at 02:00 on the 1st is one cashier answering for one count of cash, and slicing
 * it at midnight would produce two halves that neither of them ever counted. The screen
 * says so rather than leaving the reader to assume.
 *
 * WHERE THE MONEY SPLIT COMES FROM. `orders.payment_breakdown`, through the same
 * `paymentAllocationSql` rule the period's payment mix uses, and merged by the same
 * `assemblePaymentMix`. `orders.payment_method` is NOT the source: it stores the word
 * `mixed` for a split sale, so a shift grouped on that column reports the half-cash
 * half-card invoice under a label that is not a payment method. Sharing the rule is also
 * what keeps the shifts in a period adding up to that period's payment mix.
 *
 * WHAT THIS DOES NOT DO. No cost, no profit, no margin — a shift report is about money
 * taken at a till, and nothing here is gated on `reports:cost` because nothing here is a
 * cost figure.
 */

import db from "../../database/db.js";
import { WARNING_CODES, WarningCollector, safeRatio, toFiniteNumber, toMoney } from "./analyticsComparison.js";
import { canonicalOrderClauses, nanSafe, orderRevenueExpr, paymentAllocationSql } from "./analyticsMetrics.js";
import { assemblePaymentMix } from "./analyticsOverviewService.js";

/** A phone and a desktop both read this; a window with hundreds of shifts is a mistake. */
export const MAX_SHIFTS = 200;

const TABLE_COLUMN_CACHE = new Map();

const getTableColumns = async (client, table) => {
  if (TABLE_COLUMN_CACHE.has(table)) return TABLE_COLUMN_CACHE.get(table);
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  TABLE_COLUMN_CACHE.set(table, columns);
  return columns;
};

export const __clearShiftColumnCache = () => TABLE_COLUMN_CACHE.clear();

/** Only for adding up figures the shift rows already carry; an unreadable one adds nothing. */
const addable = (value) => toFiniteNumber(value) ?? 0;

/** A payment split with nothing in it — the shape, so the screen never branches on null. */
const EMPTY_MIX = () => ({
  rows: [],
  totals: { collected: 0, pending: 0, credit: 0, unattributed: 0, all: 0 },
  netSales: null,
});

/**
 * The shift rows themselves. `closing_cash` and `actual_cash` are the same figure stored
 * twice (the second is the older column), so the newer one wins and the older one fills
 * in for rows written before the rename.
 */
const buildShiftsQuery = ({ shiftColumns, tenantScoped, branchScoped }) => {
  const closingCash = shiftColumns.has("closing_cash")
    ? "COALESCE(s.closing_cash, s.actual_cash)"
    : "s.actual_cash";
  const difference = shiftColumns.has("cash_difference")
    ? "COALESCE(s.cash_difference, s.difference, 0)"
    : "COALESCE(s.difference, 0)";

  return `
    SELECT
      s.id,
      s.opened_at,
      s.closed_at,
      LOWER(COALESCE(s.status, 'open'))                AS status,
      COALESCE(s.opening_cash, 0)                      AS opening_cash,
      COALESCE(s.expected_cash, 0)                     AS expected_cash,
      ${closingCash}                                   AS closing_cash,
      ${difference}                                    AS cash_difference,
      s.branch_id,
      COALESCE(NULLIF(b.name, ''), '')                 AS branch_name,
      COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'User #' || s.opened_by) AS cashier_name
    FROM cash_drawer_shifts s
    LEFT JOIN users u    ON u.id = s.opened_by
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE ${tenantScoped ? "s.tenant_id = $1 AND " : ""}
          s.opened_at >= $${tenantScoped ? 2 : 1}::timestamptz
      AND s.opened_at <  $${tenantScoped ? 3 : 2}::timestamptz
      ${branchScoped ? `AND s.branch_id = $${tenantScoped ? 4 : 3}` : ""}
    ORDER BY s.opened_at DESC
    LIMIT ${MAX_SHIFTS}
  `;
};

/**
 * Every allocation on every invoice that belongs to one of those shifts, per shift.
 *
 * The invoices are NOT re-filtered by date: an invoice belongs to the shift its drawer
 * recorded it in, which is what `orders.shift_id` is, and a late invoice on a shift that
 * opened inside the window is still that shift's money.
 */
const buildShiftPaymentsQuery = ({ orderColumns, tenantScoped, shiftIdsParam }) => {
  const revenue = nanSafe(orderRevenueExpr(orderColumns));
  const { allocations, storedMethod, allocationAmount, allocationMethod } = paymentAllocationSql(orderColumns);
  const canonical = canonicalOrderClauses(orderColumns).clauses;
  const clauses = [
    `o.shift_id = ANY(${shiftIdsParam}::bigint[])`,
    ...(tenantScoped && orderColumns.has("tenant_id") ? ["o.tenant_id = $1"] : []),
    // A personal transaction is a staff purchase settled off the sales ledger; counting
    // it as takings would overstate every shift it appears on.
    ...(orderColumns.has("is_personal_transaction") ? ["COALESCE(o.is_personal_transaction, FALSE) = FALSE"] : []),
    ...canonical,
  ];

  return `
    WITH scoped AS (
      SELECT
        o.shift_id                 AS shift_id,
        o.id                       AS order_id,
        ${storedMethod}            AS stored_method,
        ${allocations}             AS allocations,
        ${revenue}                 AS revenue
      FROM orders o
      WHERE ${clauses.join(" AND ")}
    ),
    allocated AS (
      SELECT s.shift_id, s.order_id, ${allocationMethod} AS method, ${allocationAmount} AS amount
      FROM scoped s
      CROSS JOIN LATERAL jsonb_array_elements(s.allocations) AS alloc
      UNION ALL
      SELECT s.shift_id, s.order_id, s.stored_method, s.revenue
      FROM scoped s
      WHERE jsonb_array_length(s.allocations) = 0
    ),
    sales AS (
      SELECT shift_id, COUNT(*)::int AS orders, COALESCE(SUM(revenue), 0) AS net_sales
      FROM scoped
      GROUP BY shift_id
    ),
    mix AS (
      SELECT
        shift_id,
        method,
        COALESCE(SUM(amount), 0)                    AS amount,
        COUNT(DISTINCT order_id)::int               AS orders,
        COUNT(*) FILTER (WHERE amount IS NULL)::int AS unusable
      FROM allocated
      WHERE amount IS NULL OR amount <> 0
      GROUP BY shift_id, method
    )
    SELECT
      COALESCE(mix.shift_id, sales.shift_id)                       AS shift_id,
      mix.method,
      mix.amount,
      mix.orders,
      mix.unusable,
      sales.orders                                                 AS shift_orders,
      sales.net_sales                                              AS shift_net_sales
    FROM sales
    FULL OUTER JOIN mix ON mix.shift_id = sales.shift_id
    ORDER BY 1, 3 DESC
  `;
};

/**
 * What left the drawer during a shift, line by line.
 *
 * `expenses.shift_id` is the key, exactly as the POS close screen reads it
 * (`buildPosShiftReport` in posController.js), so the two reports cannot disagree about
 * which expense belonged to which session. The expense routes set that column from the
 * drawer event they just wrote, so it is recorded fact rather than a time-range guess.
 *
 * A rejected or cancelled expense is not money that left: those statuses drop out, the
 * same four the POS report drops.
 *
 * EMPLOYEE ADVANCES ARE EXPENSES HERE. A سلفة paid in cash left the till like any other
 * payment, and a manager counting the drawer needs it in the figure; the POS report keeps
 * them in a column of their own because payroll later deducts them, which is a different
 * question from "what went out tonight". Each line carries its own type, so an advance
 * still reads as an advance with the employee's name beside it.
 *
 * No type normalisation happens here. The expense routes normalise on write, so the
 * stored `expense_type` is already the enum the Arabic dictionary is keyed on; a second
 * normaliser at read time would be a second rule to keep in step.
 */
const EXPENSE_EXCLUDED_STATUSES = Object.freeze(["rejected", "cancelled", "canceled", "void"]);

const buildShiftExpensesQuery = ({ expenseColumns, employeeColumns, tenantScoped, shiftIdsParam }) => {
  const has = (column) => expenseColumns.has(column);
  const joinEmployees = has("employee_id") && employeeColumns.size > 0;
  const employeeName = joinEmployees
    ? `COALESCE(NULLIF(emp.full_name, ''), ${employeeColumns.has("employee_code") ? "NULLIF(emp.employee_code, '')," : ""} '')`
    : "''";

  const clauses = [
    `ex.shift_id = ANY(${shiftIdsParam}::bigint[])`,
    ...(tenantScoped && has("tenant_id") ? ["ex.tenant_id = $1"] : []),
    ...(has("status")
      ? [`LOWER(COALESCE(ex.status, '')) NOT IN (${EXPENSE_EXCLUDED_STATUSES.map((status) => `'${status}'`).join(", ")})`]
      : []),
  ];

  return `
    SELECT
      ex.id,
      ex.shift_id,
      ${has("title") ? "COALESCE(ex.title, '')" : "''"}                                  AS title,
      COALESCE(ex.amount, 0)                                                             AS amount,
      ${has("expense_type") ? "LOWER(TRIM(COALESCE(ex.expense_type, '')))" : "''"}        AS expense_type,
      ${has("category") ? "LOWER(TRIM(COALESCE(ex.category, '')))" : "''"}                AS category,
      ${has("payment_method") ? "LOWER(TRIM(COALESCE(ex.payment_method, 'cash')))" : "'cash'"} AS payment_method,
      ${has("created_at") ? "ex.created_at" : "NULL::timestamptz"}                        AS created_at,
      ${employeeName}                                                                     AS employee_name
    FROM expenses ex
    ${joinEmployees ? "LEFT JOIN employees emp ON emp.id = ex.employee_id" : ""}
    WHERE ${clauses.join(" AND ")}
    ORDER BY ex.shift_id, ${has("created_at") ? "ex.created_at ASC," : ""} ex.id ASC
  `;
};

/** A shift with nothing paid out — the shape, so the screen never branches on null. */
const EMPTY_EXPENSES = () => ({ total: 0, cash: 0, count: 0, rows: [] });

/**
 * @returns {Promise<{ data: object, meta: object, warnings: Array }>}
 */
export const getShiftsReport = async ({ filters, permissions = {}, client = db } = {}) => {
  const collector = new WarningCollector();

  if (!permissions.view) {
    return { data: { kpis: {}, shifts: [] }, meta: { restricted: true }, warnings: collector.list() };
  }

  const shiftColumns = await getTableColumns(client, "cash_drawer_shifts");
  if (!shiftColumns.size) {
    collector.add(
      WARNING_CODES.SHIFTS_UNAVAILABLE,
      "This installation does not record till shifts, so there is nothing to report.",
      {}
    );
    return { data: { kpis: {}, shifts: [] }, meta: { available: false }, warnings: collector.list() };
  }

  const tenantScoped = filters.tenantId !== null && filters.tenantId !== undefined;
  const branchScoped = Boolean(filters.branchId);
  const params = [
    ...(tenantScoped ? [filters.tenantId] : []),
    filters.windowStart,
    filters.windowEnd,
    ...(branchScoped ? [filters.branchId] : []),
  ];

  const shiftRows = (
    await client.query(buildShiftsQuery({ shiftColumns, tenantScoped, branchScoped }), params)
  ).rows;

  const shifts = shiftRows.map((row) => ({
    id: Number(row.id),
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    status: row.status === "closed" ? "closed" : "open",
    cashier: row.cashier_name || "",
    branchId: row.branch_id === null || row.branch_id === undefined ? null : Number(row.branch_id),
    branchName: row.branch_name || "",
    openingCash: toMoney(row.opening_cash),
    expectedCash: toMoney(row.expected_cash),
    // Null rather than zero while the drawer is still open: nobody has counted it yet,
    // and a zero would read as "counted, and empty".
    closingCash: row.closing_cash === null || row.closing_cash === undefined ? null : toMoney(row.closing_cash),
    cashDifference: row.status === "closed" ? toMoney(row.cash_difference) : null,
    orders: 0,
    netSales: 0,
    share: null,
    payments: EMPTY_MIX(),
    expenses: EMPTY_EXPENSES(),
  }));

  // The window's split across payment methods, in the same shape the overview's payment
  // mix card renders, so the screen draws it with the same component.
  let totals = EMPTY_MIX();

  if (!shifts.length) {
    return {
      data: { kpis: buildKpis([]), shifts: [], totals, summary: buildSummary([]) },
      meta: { window: { from: filters.windowStart, to: filters.windowEnd }, truncated: false },
      warnings: collector.list(),
    };
  }

  const orderColumns = await getTableColumns(client, "orders");
  if (orderColumns.has("shift_id")) {
    const shiftIds = shifts.map((shift) => shift.id);
    const paymentParams = [...(tenantScoped && orderColumns.has("tenant_id") ? [filters.tenantId] : []), shiftIds];
    const paymentRows = (
      await client.query(
        buildShiftPaymentsQuery({
          orderColumns,
          tenantScoped,
          shiftIdsParam: `$${paymentParams.length}`,
        }),
        paymentParams
      )
    ).rows;

    const byShift = new Map();
    for (const row of paymentRows) {
      const id = Number(row.shift_id);
      const entry = byShift.get(id) || { mix: [], orders: 0, netSales: 0 };
      if (row.method !== null && row.method !== undefined) {
        entry.mix.push({ method: row.method, amount: row.amount, orders: row.orders, unusable: row.unusable });
      }
      entry.orders = Number(row.shift_orders || 0);
      entry.netSales = row.shift_net_sales;
      byShift.set(id, entry);
    }

    for (const shift of shifts) {
      const entry = byShift.get(shift.id);
      if (!entry) continue;
      shift.orders = entry.orders;
      shift.netSales = toMoney(entry.netSales);
      // The same assembler the period's card uses, so one shift's rows merge spellings
      // and class settlements exactly as the period's do.
      shift.payments = assemblePaymentMix({ rows: entry.mix, netSales: shift.netSales, collector });
    }

    /*
     * The window's own payment split, across every shift in it.
     *
     * Built by handing the SAME assembler the SAME raw rows, concatenated — not by adding
     * up the per-shift results. Re-adding rounded shift totals would drift from the
     * period's own payment-mix card by a piastre here and there, and a manager comparing
     * the two screens would be right to distrust both.
     */
    const allRows = [...byShift.values()].flatMap((entry) => entry.mix);
    totals = assemblePaymentMix({ rows: allRows, netSales: null, collector });

    // What share of the window each session took. Computed here rather than on the
    // screen, so the percentage and the amount beside it come from one place — and null
    // rather than 0% when the whole window took nothing, because a share of nothing is
    // not a share.
    for (const shift of shifts) {
      shift.share = safeRatio(toFiniteNumber(shift.payments?.totals?.all), totals.totals.all);
    }
  } else {
    collector.add(
      WARNING_CODES.SHIFT_ATTRIBUTION_UNAVAILABLE,
      "Invoices do not record which till shift sold them, so the per-shift payment split cannot be produced.",
      {}
    );
  }

  const expenseColumns = await getTableColumns(client, "expenses");
  if (expenseColumns.has("shift_id")) {
    const employeeColumns = await getTableColumns(client, "employees");
    const expenseParams = [
      ...(tenantScoped && expenseColumns.has("tenant_id") ? [filters.tenantId] : []),
      shifts.map((shift) => shift.id),
    ];
    const expenseRows = (
      await client.query(
        buildShiftExpensesQuery({
          expenseColumns,
          employeeColumns,
          tenantScoped,
          shiftIdsParam: `$${expenseParams.length}`,
        }),
        expenseParams
      )
    ).rows;

    const byShift = new Map();
    for (const row of expenseRows) {
      const id = Number(row.shift_id);
      const entry = byShift.get(id) || EMPTY_EXPENSES();
      const amount = addable(row.amount);
      entry.total += amount;
      // The cash part is the only part the drawer ever held, so it is the one that has to
      // reconcile against expected_cash; an expense paid on a card never touched the till.
      if (row.payment_method === "cash") entry.cash += amount;
      entry.count += 1;
      entry.rows.push({
        id: Number(row.id),
        type: row.expense_type || row.category || "",
        category: row.category || "",
        // Kept as written: it is what the till printed, and it is the only label left for
        // an expense whose type the dictionary does not know.
        title: row.title || "",
        employee: row.employee_name || "",
        paymentMethod: row.payment_method || "cash",
        amount: toMoney(row.amount),
        at: row.created_at,
      });
      byShift.set(id, entry);
    }

    for (const shift of shifts) {
      const entry = byShift.get(shift.id);
      if (!entry) continue;
      shift.expenses = { ...entry, total: toMoney(entry.total), cash: toMoney(entry.cash) };
    }
  } else {
    collector.add(
      WARNING_CODES.SHIFT_EXPENSES_UNAVAILABLE,
      "Expenses do not record which till shift paid them, so the per-shift expense figure cannot be produced.",
      {}
    );
  }

  return {
    data: { kpis: buildKpis(shifts), shifts, totals, summary: buildSummary(shifts) },
    meta: {
      window: { from: filters.windowStart, to: filters.windowEnd },
      // Named rather than silently cut: a reader whose window held more shifts than this
      // must know the tail is missing instead of reading a short list as the whole truth.
      truncated: shiftRows.length >= MAX_SHIFTS,
      limit: MAX_SHIFTS,
    },
    warnings: collector.list(),
  };
};

/**
 * The drawer figures of every shift in the window, added up — the grand-total card at the
 * foot of the list.
 *
 * Added here rather than on the phone for the reason every other figure is: one adder,
 * one rounding, and a card that cannot drift from the sessions printed above it. The
 * money split is NOT recomputed here — `totals` already carries it, assembled from the
 * raw allocation rows.
 *
 * COUNTED CASH AND THE DIFFERENCE COUNT CLOSED DRAWERS ONLY. Nobody has counted an open
 * drawer, so folding its null in as a zero would report a shortage that is really a shift
 * still running. `countedShifts` says how many were counted, so the screen can say so
 * instead of leaving the reader to wonder which sessions the line covers.
 */
const buildSummary = (shifts = []) => {
  const counted = shifts.filter((shift) => shift.closingCash !== null && shift.closingCash !== undefined);
  const sum = (rows, pick) => rows.reduce((total, shift) => total + addable(pick(shift)), 0);

  return {
    shiftCount: shifts.length,
    countedShifts: counted.length,
    orders: sum(shifts, (shift) => shift.orders),
    openingCash: toMoney(sum(shifts, (shift) => shift.openingCash)),
    expectedCash: toMoney(sum(shifts, (shift) => shift.expectedCash)),
    countedCash: counted.length ? toMoney(sum(counted, (shift) => shift.closingCash)) : null,
    cashDifference: counted.length ? toMoney(sum(counted, (shift) => shift.cashDifference)) : null,
    // Every shift is counted here, open or closed: an expense is paid the moment it is
    // recorded, so unlike the counted cash there is nothing still to come.
    expenses: toMoney(sum(shifts, (shift) => shift.expenses?.total)),
    expensesCash: toMoney(sum(shifts, (shift) => shift.expenses?.cash)),
    expenseCount: sum(shifts, (shift) => shift.expenses?.count),
  };
};

/**
 * The window's totals, in the `{ current }` shape the KPI tiles already render.
 * Summed from the shift rows rather than queried again, so a tile can never disagree with
 * the list underneath it.
 */
const buildKpis = (shifts = []) => {
  const total = shifts.reduce((sum, shift) => sum + addable(shift.payments?.totals?.all), 0);
  const collected = shifts.reduce((sum, shift) => sum + addable(shift.payments?.totals?.collected), 0);
  const orders = shifts.reduce((sum, shift) => sum + addable(shift.orders), 0);
  const expenses = shifts.reduce((sum, shift) => sum + addable(shift.expenses?.total), 0);

  return {
    shiftCount: { current: shifts.length, previous: null, delta: null },
    shiftCollected: { current: toMoney(collected), previous: null, delta: null },
    shiftPaid: { current: toMoney(total), previous: null, delta: null },
    orders: { current: orders, previous: null, delta: null },
    shiftExpenses: { current: toMoney(expenses), previous: null, delta: null },
  };
};
