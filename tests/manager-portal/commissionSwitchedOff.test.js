/*
 * Owner's rule (2026-10-14): switching an employee's commission off ("none") means no commission for
 * the month still being priced — including sales made before the switch, whose orders snapshot the
 * type they were sold under and so still "earned" in the sales report.
 */
import test from "node:test";
import assert from "node:assert/strict";
import db from "../../server/database/db.js";
import { getPayrollPreview } from "../../server/services/salesCommissionService.js";

const runPreview = async (salesCommissionType, salesCommissionValue = 10) => {
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (/FROM employees e/.test(text) && /sales_commission_type/.test(text)) {
      return { rows: [{ id: 7, tenant_id: 1, full_name: "T", salary: 6000, working_days_per_month: 26, sales_commission_type: salesCommissionType, sales_commission_value: salesCommissionValue }] };
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

test("a commission set to 0 is switched off too (Adham: fixed per item, value 0)", async () => {
  const preview = await runPreview("fixed", "0.00");
  assert.equal(preview.payroll.commissions, 0);
  assert.equal(preview.payroll.commission_switched_off, true);
});

test("commission on: the month's earned commission is paid as before", async () => {
  const preview = await runPreview("percent");
  assert.equal(preview.payroll.commissions, 300);
  assert.equal(preview.payroll.commission_switched_off, false);
});

test("today is not an absence while it is still going (no attendance yet before an afternoon shift)", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const original = db.query;
  db.query = async (sql) => {
    const text = String(sql);
    if (/FROM employees e/.test(text) && /sales_commission_type/.test(text)) {
      return { rows: [{ id: 7, tenant_id: 1, full_name: "T", salary: 6000, working_days_per_month: 26, working_days_per_week: 7, sales_commission_type: "none" }] };
    }
    return { rows: [] };
  };
  let preview;
  try {
    preview = await getPayrollPreview({ tenantId: 1, employeeId: 7, filters: { month: today.slice(0, 7), startDate: today, endDate: today } });
  } finally {
    db.query = original;
  }
  assert.deepEqual(preview.payroll.missing_attendance_dates, []);
  assert.equal(preview.payroll.absence_days, 0);
  assert.ok(!(preview.payroll.day_deductions || []).some((row) => row.date === today));
});
