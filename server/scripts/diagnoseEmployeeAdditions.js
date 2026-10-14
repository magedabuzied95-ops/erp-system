// READ-ONLY. Why does an employee's الإضافات card show what it shows?
// Prints the employee's sales profile (the commission switch), and this month's payroll preview
// exactly as the employee portal builds it: commission, bonuses, overtime pay.
//
//   node server/scripts/diagnoseEmployeeAdditions.js "Adham"
//
// Writes nothing (getPayrollPreview without finalize only reads).
import db from "../database/db.js";
import { getPayrollPreview } from "../services/salesCommissionService.js";

const search = process.argv.slice(2).join(" ").trim();
if (!search) {
  console.error('usage: node server/scripts/diagnoseEmployeeAdditions.js "<name or code>"');
  process.exit(1);
}

const cairo = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

const main = async () => {
  const { rows: employees } = await db.query(
    `
    SELECT e.id, e.tenant_id, e.full_name, e.employee_code, e.branch_id
    FROM employees e
    WHERE e.is_deleted IS DISTINCT FROM TRUE
      AND (e.full_name ILIKE $1 OR e.employee_code::text ILIKE $1)
    ORDER BY e.id
    LIMIT 5
    `,
    [`%${search}%`]
  );
  if (!employees.length) {
    console.log(`no employee matches "${search}"`);
    return;
  }
  const today = cairo(new Date());
  const month = today.slice(0, 7);
  for (const employee of employees) {
    console.log("==================================================");
    console.log(`#${employee.id}  ${employee.full_name}  (code ${employee.employee_code || "-"})`);
    const { rows: profiles } = await db.query(
      `SELECT id, commission_type, commission_value, fixed_commission_mode, is_sales_active, updated_at
       FROM employee_sales_profiles WHERE employee_id = $1 ORDER BY id`,
      [employee.id]
    );
    console.log("sales profile rows:", profiles.length ? "" : "NONE");
    profiles.forEach((row) => console.log("  ", JSON.stringify(row)));
    const { rows: orderTypes } = await db.query(
      `SELECT COALESCE(salesperson_commission_type, '(null)') AS type, COUNT(*)::int AS orders
       FROM orders
       WHERE sales_employee_id = $1 AND created_at >= $2::date
       GROUP BY 1 ORDER BY 1`,
      [employee.id, `${month}-01`]
    ).catch(() => ({ rows: [] }));
    console.log(`this month's orders by the commission type they were sold under:`, JSON.stringify(orderTypes));
    try {
      const preview = await getPayrollPreview({
        tenantId: employee.tenant_id,
        employeeId: employee.id,
        filters: { month, startDate: `${month}-01`, endDate: today },
      });
      const p = preview.payroll || {};
      console.log("payroll preview (what the portal shows):");
      console.log("   commission_switched_off:", p.commission_switched_off);
      console.log("   commissions:", p.commissions);
      console.log("   bonuses:", p.bonuses, " rows:", JSON.stringify(p.bonus_rows || []));
      console.log("   approved_overtime_pay:", p.approved_overtime_pay, " hours:", p.approved_overtime_hours);
      console.log("   additions total:", Number(p.commissions || 0) + Number(p.bonuses || 0) + Number(p.approved_overtime_pay || 0));
    } catch (error) {
      console.log("payroll preview failed:", error.message);
    }
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.end?.());
