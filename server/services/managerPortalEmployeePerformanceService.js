import db from "../database/db.js";
import { buildInventoryCountLookupSelects, buildInventoryCountVariantImageSelects, ensureInventoryCountSchema } from "./inventoryCountService.js";
import { loadScopedEmployee } from "./managerPortalService.js";

// The two lists the employee sheet adds after الحضور: what the employee counted
// this month (one row per model, with its picture) and how the employee's sales
// sit against the rest of the branch. Attendance figures for the evaluation come
// from the details payload the sheet already holds — the payroll engine is the
// one place that knows what an absence is, so it is not re-derived here.

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const ITEM_LIMIT = 5000;

const monthWindow = (month = "") => {
  const match = MONTH_RE.exec(String(month || "").trim());
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date());
  const [year, monthNumber] = match ? [Number(match[1]), Number(match[2])] : today.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    month: `${year}-${pad(monthNumber)}`,
    start: `${year}-${pad(monthNumber)}-01`,
    end: `${year}-${pad(monthNumber)}-${pad(lastDay)}`,
  };
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const dayKey = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
};

const loadEmployeeUserId = async (employeeId) => {
  try {
    const result = await db.query("SELECT to_jsonb(e)->>'user_id' AS user_id FROM employees e WHERE e.id = $1::bigint LIMIT 1", [employeeId]);
    const id = Number(result.rows[0]?.user_id);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
};

/**
 * Every size row this employee counted in the month, folded into one row per model.
 *
 * Who counted a row: `counted_by_employee_id` when the phone recorded it; a row
 * without one belongs to the employee who owns the count, or — for a count taken
 * in the ERP — to the user account linked to this employee. The legacy
 * `created_by` arm is left out on purpose: it holds a users id for ERP counts,
 * and matching it against an employee id credits a stranger.
 */
export const loadEmployeeMonthCounts = async ({ tenantId = null, employeeId, start, end }) => {
  await ensureInventoryCountSchema();
  const userId = await loadEmployeeUserId(employeeId);
  const [imageSelects, lookupSelects] = await Promise.all([
    buildInventoryCountVariantImageSelects(db),
    buildInventoryCountLookupSelects(db),
  ]);
  const result = await db.query(
    `
    SELECT
      ci.id,
      COALESCE(ci.product_variant_id, ci.variant_id) AS variant_id,
      COALESCE(ci.product_id, v.product_id) AS product_id,
      COALESCE(p.name, '') AS product_name,
      ${lookupSelects.productCodeExpr} AS product_code,
      COALESCE(v.color, '') AS color,
      COALESCE(v.size::text, '') AS size,
      ci.counted_quantity,
      ci.system_quantity,
      ci.difference_quantity,
      COALESCE(ci.counted_at, ci.created_at) AS counted_at,
      s.id AS session_id,
      LOWER(COALESCE(s.status, '')) AS session_status,
      ${imageSelects.colorImageExpr} AS image_url
    FROM inventory_count_items ci
    JOIN inventory_count_sessions s ON s.id = COALESCE(ci.inventory_count_session_id, ci.inventory_count_id)
    LEFT JOIN product_variants v ON v.id = COALESCE(ci.product_variant_id, ci.variant_id)
    LEFT JOIN products p ON p.id = COALESCE(ci.product_id, v.product_id)
    WHERE ($1::bigint IS NULL OR s.tenant_id = $1::bigint OR s.tenant_id IS NULL)
      AND LOWER(COALESCE(s.status, '')) NOT IN ('cancelled', 'canceled')
      AND (
        ci.counted_by_employee_id = $2::bigint
        OR (ci.counted_by_employee_id IS NULL AND s.created_by_employee_id = $2::bigint)
        OR ($5::bigint IS NOT NULL AND ci.counted_by_employee_id IS NULL AND s.created_by_employee_id IS NULL AND ci.counted_by = $5::bigint)
      )
      AND (COALESCE(ci.counted_at, ci.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN $3::date AND $4::date
    ORDER BY COALESCE(ci.counted_at, ci.created_at) DESC, ci.id DESC
    LIMIT ${ITEM_LIMIT}
    `,
    [tenantId, employeeId, start, end, userId]
  );

  const models = new Map();
  const sessions = new Set();
  const days = new Set();
  let pieces = 0;
  let sizeRows = 0;
  let varianceRows = 0;
  const seenSizes = new Set();
  for (const row of result.rows) {
    sessions.add(String(row.session_id));
    days.add(dayKey(row.counted_at));
    // A size recounted in a later session is one size, read at its latest count
    // (rows arrive newest first) — not one more size per session.
    const sizeKey = row.variant_id ? `v:${row.variant_id}` : `i:${row.id}`;
    if (seenSizes.has(sizeKey)) continue;
    seenSizes.add(sizeKey);
    const key =row.product_id ? `p:${row.product_id}` : `n:${row.product_name}`;
    let model = models.get(key);
    if (!model) {
      model = {
        product_id: row.product_id ? Number(row.product_id) : null,
        name: row.product_name || "",
        code: row.product_code || "",
        image_url: "",
        colors: [],
        size_rows: 0,
        pieces: 0,
        variance_rows: 0,
        variance_total: 0,
        // difference = counted − system: over is stock found beyond the books, short is stock missing.
        over_rows: 0,
        over_total: 0,
        short_rows: 0,
        short_total: 0,
        last_counted_at: row.counted_at,
        sessions: new Set(),
        statuses: new Set(),
      };
      models.set(key, model);
    }
    if (!model.image_url && row.image_url) model.image_url = row.image_url;
    if (row.color && !model.colors.includes(row.color)) model.colors.push(row.color);
    const counted = toNumber(row.counted_quantity);
    const diff = toNumber(row.difference_quantity);
    model.size_rows += 1;
    model.pieces += counted;
    if (diff !== 0) {
      model.variance_rows += 1;
      model.variance_total += Math.abs(diff);
      if (diff > 0) {
        model.over_rows += 1;
        model.over_total += diff;
      } else {
        model.short_rows += 1;
        model.short_total -= diff;
      }
      varianceRows += 1;
    }
    model.sessions.add(String(row.session_id));
    model.statuses.add(row.session_status || "draft");
    pieces += counted;
    sizeRows += 1;
  }

  const rows = [...models.values()].map(({ statuses, ...model }) => ({
    ...model,
    sessions: model.sessions.size,
    // One word for the model: approved once every count holding it was approved.
    status: statuses.has("rejected")
      ? "rejected"
      : [...statuses].every((s) => s === "completed" || s === "approved")
        ? "completed"
        : statuses.has("pending_review") ? "pending_review" : "in_progress",
  }));

  return {
    totals: {
      models: rows.length,
      colors: rows.reduce((acc, row) => acc + row.colors.length, 0),
      size_rows: sizeRows,
      pieces,
      sessions: sessions.size,
      days: days.size,
      variance_rows: varianceRows,
      accuracy: sizeRows ? Number((((sizeRows - varianceRows) / sizeRows) * 100).toFixed(1)) : null,
      truncated: result.rows.length >= ITEM_LIMIT,
    },
    models: rows,
  };
};

// The employee's month of sales against every colleague in the same branch.
const loadBranchSalesStanding = async ({ tenantId, employee, start, end }) => {
  try {
    const result = await db.query(
      `
      SELECT e.id AS employee_id,
             COALESCE(SUM(COALESCE(o.total_amount, o.total, 0)), 0) AS sales_total,
             COUNT(o.id)::int AS invoice_count
      FROM employees e
      LEFT JOIN orders o
        ON COALESCE(o.sales_employee_id, o.cashier_id, o.created_by) = e.id
       AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
       AND o.created_at >= $3::date AND o.created_at < ($4::date + INTERVAL '1 day')
       AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
      WHERE e.is_deleted IS DISTINCT FROM TRUE
        AND LOWER(COALESCE(e.status, 'active')) NOT IN ('inactive', 'terminated', 'archived')
        AND ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
        AND ($2::bigint IS NULL OR e.branch_id = $2::bigint)
      GROUP BY e.id
      `,
      [tenantId, employee.branch_id ?? null, start, end]
    );
    const rows = result.rows.map((row) => ({ id: Number(row.employee_id), total: toNumber(row.sales_total), invoices: toNumber(row.invoice_count) }));
    const sellers = rows.filter((row) => row.total > 0 || row.id === Number(employee.id));
    const sorted = [...sellers].sort((a, b) => b.total - a.total);
    const mine = rows.find((row) => row.id === Number(employee.id)) || { total: 0, invoices: 0 };
    const average = sellers.length ? sellers.reduce((acc, row) => acc + row.total, 0) / sellers.length : 0;
    return {
      total: mine.total,
      invoices: mine.invoices,
      average_invoice: mine.invoices ? Number((mine.total / mine.invoices).toFixed(2)) : 0,
      rank: sorted.findIndex((row) => row.id === Number(employee.id)) + 1 || null,
      team_size: sellers.length,
      team_average: Number(average.toFixed(2)),
      team_best: sorted[0]?.total || 0,
    };
  } catch (error) {
    console.warn("[manager-portal] branch sales standing skipped", error?.message || error);
    return null;
  }
};

export const getManagerPortalEmployeePerformance = async ({ manager = {}, employeeId, month = "" } = {}) => {
  const { employee, tenantId } = await loadScopedEmployee({ manager, employeeId });
  const range = monthWindow(month);
  const [counts, sales] = await Promise.all([
    loadEmployeeMonthCounts({ tenantId, employeeId: employee.id, start: range.start, end: range.end }).catch((error) => {
      console.warn("[manager-portal] employee counts skipped", error?.message || error);
      return { totals: { models: 0, colors: 0, size_rows: 0, pieces: 0, sessions: 0, days: 0, variance_rows: 0, accuracy: null, truncated: false }, models: [], error: true };
    }),
    loadBranchSalesStanding({ tenantId, employee, start: range.start, end: range.end }),
  ]);
  return { month: range.month, period: { start: range.start, end: range.end }, counts, sales };
};
