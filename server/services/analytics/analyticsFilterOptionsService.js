/**
 * The values each filter can actually take, derived from the orders in scope.
 *
 * The legacy page asked the reader to type a numeric id into a text box — `warehouseId`,
 * `shiftId`, `salespersonId`. Nobody knows their own shift id, so in practice those
 * controls were unusable by anyone who was not reading the database at the same time.
 * Worse, a typed id that matches nothing returns an empty report that looks exactly like
 * a quiet week.
 *
 * So the Reporting Center offers only values that EXIST in the data the caller can see:
 *
 *   - tenant-scoped, so one shop never sees another's staff or shifts
 *   - date-scoped to the selected window, so a shift list stays a few dozen rows rather
 *     than every shift since the shop opened
 *   - canonical-order-scoped, so a filter cannot offer a value that no recognised sale
 *     carries and then return nothing when you pick it
 *
 * A filter with no values in the window is returned as an empty list, and the client hides
 * the control. An empty dropdown is honest; a dropdown of ids that match nothing is not.
 */

import db from "../../database/db.js";
import { whereSql } from "./accountingCanon.js";
import { canonicalOrderClauses } from "./analyticsMetrics.js";
import { UNSUPPORTED_LEGACY_FILTERS } from "./analyticsOrderFilters.js";

const columnsFor = async (client, table) => {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const tableExists = async (client, table) => {
  const result = await client.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
    [table]
  );
  return result.rows.length > 0;
};

/**
 * @returns {Promise<{ data: object, meta: object }>} option lists plus the filters this
 *          schema cannot honour, so the client can explain rather than silently omit.
 */
export const getFilterOptions = async ({ filters }) => {
  const client = await db.connect();
  try {
    const orderColumns = await columnsFor(client, "orders");
    const params = [];
    const bind = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const clauses = [];
    if (filters.tenantId !== null && orderColumns.has("tenant_id")) {
      clauses.push(`o.tenant_id = ${bind(filters.tenantId)}`);
    }
    clauses.push(...canonicalOrderClauses(orderColumns).clauses);
    clauses.push(
      `o.created_at >= ${bind(filters.from)}::date AND o.created_at < (${bind(filters.to)}::date + INTERVAL '1 day')`
    );
    const orderWhere = whereSql(clauses);

    /**
     * Each option list is one small query over the same scoped set. They run in sequence
     * rather than in parallel: the pool is ten connections wide and these share it with
     * whatever report the reader is already loading.
     */
    const distinct = async (sql) => {
      const result = await client.query(sql, params);
      return result.rows;
    };

    const [branches, salespeople, shifts, paymentMethods, channels] = [
      orderColumns.has("branch_id") && (await tableExists(client, "branches"))
        ? await distinct(`
            SELECT b.id::text AS value, COALESCE(NULLIF(b.name, ''), 'Branch ' || b.id) AS label, COUNT(*)::int AS orders
            FROM orders o JOIN branches b ON b.id = o.branch_id
            ${orderWhere}
            GROUP BY b.id, b.name ORDER BY 3 DESC, 2 ASC`)
        : [],

      /*
       * salesperson_id -> employees.id, a real foreign key. An order with no salesperson
       * is simply absent from this list; it is never attributed to anybody, and the
       * unattributed share is published by R9 rather than hidden here.
       */
      orderColumns.has("salesperson_id") && (await tableExists(client, "employees"))
        ? await distinct(`
            SELECT e.id::text AS value, COALESCE(NULLIF(e.full_name, ''), 'Employee ' || e.id) AS label, COUNT(*)::int AS orders
            FROM orders o JOIN employees e ON e.id = o.salesperson_id
            ${orderWhere}
            GROUP BY e.id, e.full_name ORDER BY 3 DESC, 2 ASC`)
        : [],

      // shift_id -> cash_drawer_shifts.id. Labelled by when the drawer opened, because an
      // id is not something a person can recognise.
      orderColumns.has("shift_id") && (await tableExists(client, "cash_drawer_shifts"))
        ? await distinct(`
            SELECT s.id::text AS value,
                   TO_CHAR(s.opened_at, 'YYYY-MM-DD HH24:MI') AS label,
                   COUNT(*)::int AS orders
            FROM orders o JOIN cash_drawer_shifts s ON s.id = o.shift_id
            ${orderWhere}
            GROUP BY s.id, s.opened_at ORDER BY s.opened_at DESC`)
        : [],

      orderColumns.has("payment_method")
        ? await distinct(`
            SELECT LOWER(TRIM(o.payment_method)) AS value, LOWER(TRIM(o.payment_method)) AS label, COUNT(*)::int AS orders
            FROM orders o ${orderWhere}${orderWhere ? " AND" : " WHERE"} NULLIF(TRIM(COALESCE(o.payment_method, '')), '') IS NOT NULL
            GROUP BY 1, 2 ORDER BY 3 DESC`)
        : [],

      orderColumns.has("channel")
        ? await distinct(`
            SELECT LOWER(TRIM(o.channel)) AS value, LOWER(TRIM(o.channel)) AS label, COUNT(*)::int AS orders
            FROM orders o ${orderWhere}${orderWhere ? " AND" : " WHERE"} NULLIF(TRIM(COALESCE(o.channel, '')), '') IS NOT NULL
            GROUP BY 1, 2 ORDER BY 3 DESC`)
        : [],
    ];

    return {
      data: { branches, salespeople, shifts, paymentMethods, channels },
      meta: {
        period: { from: filters.from, to: filters.to },
        // Named rather than omitted: the reader who used these on the legacy page deserves
        // to know why they are gone, and the parity matrix cites the same source.
        unsupported: UNSUPPORTED_LEGACY_FILTERS,
      },
    };
  } finally {
    client.release();
  }
};
