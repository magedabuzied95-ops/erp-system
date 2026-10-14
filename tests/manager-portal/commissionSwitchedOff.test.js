/*
 * Owner's rule (2026-10-14): switching an employee's commission off ("none") means no commission for
 * the month still being priced — including sales made before the switch, whose orders snapshot the
 * type they were sold under and so still "earned" in the sales report.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { getPayrollPreview } from "../../server/services/salesCommissionService.js";

const runPreview = async (salesCommissionType) => {
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (/FROM employees e/.test(text) && /sales_commission_type/.test(text)) {
      return { rows: [{ id: 7, tenant_id: 1, full_name: "T", salary: 6000, working_days_per_month: 26, sales_commission_type: salesCommissionType }] };
    }
    if (/AS earned_commissions/.test(text)) {
      return { rows: [{ employee_id: 7, employee_name: "T", total_sales: 10000, total_invoices: 5, total_items_sold: 10, returns_refunds: 0, net_sales: 10000, earned_commissions: 300 }] };
    }
    return { rows: [] };
  };
  try {
    return await getPayrollPreview({ tenantId: 1, employeeId: 7, filters: { month: "2026-10", startDate: "2026-10-01", endDate: "2026-10-14" } });
  } finally {
    db.query = original;
  }
};

test("commission switched off: the open month pays no commission, even for earlier sales", async () => {
  const preview = await runPreview("none");
  assert.equal(preview.payroll.commissions, 0);
  assert.equal(preview.payroll.commission_switched_off, true);
});

test("no sales profile reads as no commission, as the employee settings screen shows it", async () => {
  const preview = await runPreview(null);
  assert.equal(preview.payroll.commissions, 0);
});

test("commission on: the month's earned commission is paid as before", async () => {
  const preview = await runPreview("percent");
  assert.equal(preview.payroll.commissions, 300);
  assert.equal(preview.payroll.commission_switched_off, false);
});
