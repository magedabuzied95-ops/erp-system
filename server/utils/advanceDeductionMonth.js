// Which payroll month does a NEW employee advance belong to?
//
// An advance used to take the calendar month it was created in. That is right until the
// month's salary has been approved: once payroll for 2026-09 is finalized, an advance taken
// on the 20th of September must not sit under September (that salary is already closed and its
// advances settled) — it belongs to the next open month, so the next payroll run picks it up.
//
// The rule: find the latest approved payroll run for this employee at or after the requested
// month; if one exists, the advance goes to the month after it. Otherwise the requested month
// stands. The payroll preview reads advances with `deduction_month <= month`, so rolling
// forward never hides an advance from a later run.

const MONTH_RE = /^\d{4}-\d{2}$/;

export const currentShopMonth = (timeZone = "Africa/Cairo") =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date())
    .slice(0, 7);

export const nextMonth = (month = "") => {
  const match = MONTH_RE.exec(String(month || "").trim());
  if (!match) return "";
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const rolled = monthIndex >= 12 ? { year: year + 1, month: 1 } : { year, month: monthIndex + 1 };
  return `${rolled.year}-${String(rolled.month).padStart(2, "0")}`;
};

export const normalizeMonth = (value, fallback = "") => {
  const text = String(value || "").trim().slice(0, 7);
  return MONTH_RE.test(text) ? text : fallback;
};

export const resolveAdvanceDeductionMonth = async ({ clientOrPool, tenantId = null, employeeId, month = "" } = {}) => {
  const base = normalizeMonth(month, currentShopMonth());
  if (!clientOrPool || employeeId === undefined || employeeId === null || employeeId === "") return base;
  try {
    const table = await clientOrPool.query("SELECT to_regclass('public.employee_payroll_runs') AS regclass");
    if (!table.rows?.[0]?.regclass) return base;
    const result = await clientOrPool.query(
      `
      SELECT MAX(payroll_period) AS last_period
      FROM employee_payroll_runs
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND payroll_period >= $3
        AND LOWER(COALESCE(status, 'approved')) <> 'cancelled'
      `,
      [employeeId, tenantId ?? null, base]
    );
    const lastPeriod = normalizeMonth(result.rows?.[0]?.last_period, "");
    if (!lastPeriod) return base;
    const rolled = nextMonth(lastPeriod);
    if (rolled && rolled !== base) {
      console.log("[employee-advance] deduction month rolled past an approved payroll", {
        employee_id: employeeId,
        requested_month: base,
        last_approved_period: lastPeriod,
        deduction_month: rolled,
      });
    }
    return rolled || base;
  } catch (error) {
    console.warn("[employee-advance] deduction month lookup skipped", error?.message || error);
    return base;
  }
};

export default resolveAdvanceDeductionMonth;
