import test, { after } from "node:test";
import assert from "node:assert/strict";

import db from "../server/database/db.js";
import { getPayrollPreview, markPayrollAsPaid } from "../server/services/salesCommissionService.js";
import { getLedgersReport, getProfitLossReport } from "../server/services/accountingService.js";
import { buildEmployeePayrollPortalPayload } from "../server/services/employeePayrollPortalService.js";

const employeeId = Number(process.env.PAYROLL_QA_EMPLOYEE_ID || 44);
const payrollPeriod = process.env.PAYROLL_QA_PERIOD || "2026-06";
const payrollAdvanceNote = `Payroll QA Advance ${payrollPeriod}`;

after(async () => {
  await db.end().catch(() => null);
});

const cleanupPayrollArtifacts = async ({ tenantId, employeeId, payrollPeriod }) => {
  const payrollRuns = await db.query(
    `
    SELECT id
    FROM employee_payroll_runs
    WHERE employee_id::text = $1::text
      AND payroll_period = $2
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
    `,
    [employeeId, payrollPeriod, tenantId]
  );

  if (payrollRuns.rowCount) {
    const runIds = payrollRuns.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id));
    if (runIds.length) {
      await db.query(
        `
        DELETE FROM journal_entry_lines
        WHERE journal_entry_id IN (
          SELECT id
          FROM journal_entries
          WHERE (reference_type IN ('employee_payroll', 'employee_payroll_payment') OR entry_type IN ('payroll_approval', 'payroll_payment'))
            AND reference_id::text = ANY($1::text[])
        )
        `,
        [runIds.map((id) => String(id))]
      );
      await db.query(
        `
        DELETE FROM journal_entries
        WHERE (reference_type IN ('employee_payroll', 'employee_payroll_payment') OR entry_type IN ('payroll_approval', 'payroll_payment'))
          AND reference_id::text = ANY($1::text[])
        `,
        [runIds.map((id) => String(id))]
      );
    }
    await db.query(
      `
      DELETE FROM employee_payroll_runs
      WHERE employee_id::text = $1::text
        AND payroll_period = $2
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
      `,
      [employeeId, payrollPeriod, tenantId]
    );
  }

  await db.query(
    `
    DELETE FROM employee_advances
    WHERE employee_id::text = $1::text
      AND deduction_month = $2
      AND notes = $4
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
    `,
    [employeeId, payrollPeriod, tenantId, payrollAdvanceNote]
  );
};

const ensurePayrollAdvance = async ({ tenantId, employeeId, payrollPeriod }) => {
  const existing = await db.query(
    `
    SELECT id
    FROM employee_advances
    WHERE employee_id::text = $1::text
      AND deduction_month = $2
      AND notes = $4
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
    LIMIT 1
    `,
    [employeeId, payrollPeriod, tenantId, payrollAdvanceNote]
  );
  if (existing.rowCount) return existing.rows[0];

  const created = await db.query(
    `
    INSERT INTO employee_advances (
      tenant_id, employee_id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status,
      notes, expense_id, created_by, created_at, updated_at
    )
    VALUES ($1, $2, 500, 0, 500, $3, 'pending', 'pending', $4, NULL, NULL, NOW(), NOW())
    RETURNING id
    `,
    [tenantId, employeeId, payrollPeriod, payrollAdvanceNote]
  );

  return created.rows[0];
};

test("payroll accounting workflow posts approval, payment, and reports", async () => {
  const employeeResult = await db.query(
    `
    SELECT e.id, e.tenant_id, e.branch_id, e.full_name, e.salary, b.name AS branch_name
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE e.id = $1
    LIMIT 1
    `,
    [employeeId]
  );
  assert.ok(employeeResult.rows[0], "Test employee must exist");
  const employee = employeeResult.rows[0];
  await cleanupPayrollArtifacts({ tenantId: employee.tenant_id, employeeId, payrollPeriod });
  await ensurePayrollAdvance({ tenantId: employee.tenant_id, employeeId, payrollPeriod });

  const preview = await getPayrollPreview({
    tenantId: employee.tenant_id,
    employeeId,
    filters: {
      startDate: `${payrollPeriod}-01`,
      endDate: `${payrollPeriod}-30`,
      branchId: employee.branch_id,
      deduction_month: payrollPeriod,
      markAdvancesDeducted: "true",
    },
  });

  assert.equal(Number(preview.payroll.base_salary), 3000);
  assert.equal(Number(preview.payroll.advance_deductions), 500);
  assert.equal(Number(preview.payroll.penalty_deductions), 150);
  assert.equal(Number(preview.payroll.attendance_deduction_total), 1125);
  assert.equal(Number(preview.payroll.net_pay), 1225);
  assert.ok(preview.payroll_run?.id, "Approval should persist a payroll run");

  const approvedRunResult = await db.query(
    `
    SELECT *
    FROM employee_payroll_runs
    WHERE id = $1
    LIMIT 1
    `,
    [preview.payroll_run.id]
  );
  const approvedRun = approvedRunResult.rows[0];
  assert.ok(approvedRun, "Payroll run must exist after approval");
  assert.equal(String(approvedRun.status).toLowerCase(), "approved");
  assert.equal(String(approvedRun.payment_status).toLowerCase(), "pending_payment");
  assert.ok(Number(approvedRun.approval_journal_entry_id || 0) > 0, "Approval journal should be posted");

  const profitLoss = await getProfitLossReport(db, {
    tenantId: employee.tenant_id,
    fromDate: `${payrollPeriod}-01`,
    toDate: `${payrollPeriod}-30`,
    branchId: employee.branch_id,
  });
  const payrollExpense = (profitLoss.expenses || []).find((row) => String(row.category || "").includes("Salaries Expense"));
  assert.ok(payrollExpense, "Payroll expense should appear in P&L");
  assert.ok(Number(payrollExpense.amount || 0) > 0, "Payroll expense amount should be positive");

  const ledgersBeforePayment = await getLedgersReport(db, {
    tenantId: employee.tenant_id,
    fromDate: `${payrollPeriod}-01`,
    toDate: `${payrollPeriod}-30`,
  });
  const approvalRows = (ledgersBeforePayment.rows || []).filter((row) => String(row.source_type || "") === "payroll_approval");
  assert.ok(approvalRows.length >= 2, "General ledger should include both payroll approval lines");
  assert.ok(approvalRows.some((row) => Number(row.debit || 0) > 0 && String(row.account_type || "") === "expense"), "General ledger should include the payroll expense debit");
  assert.ok(approvalRows.some((row) => Number(row.credit || 0) > 0 && String(row.account_type || "") === "liability"), "General ledger should include the payroll payable credit");

  const paidRun = await markPayrollAsPaid({
    tenantId: employee.tenant_id,
    employeeId,
    filters: {
      payroll_period: payrollPeriod,
      paymentMethod: "cash",
    },
  });

  assert.ok(paidRun?.id, "Paid payroll should return a payroll run");
  assert.equal(String(paidRun.status).toLowerCase(), "paid");
  assert.equal(String(paidRun.payment_status).toLowerCase(), "paid");
  assert.ok(Number(paidRun.payment_journal_entry_id || 0) > 0, "Payment journal should be posted");

  const paidRunResult = await db.query(
    `
    SELECT *
    FROM employee_payroll_runs
    WHERE id = $1
    LIMIT 1
    `,
    [paidRun.id]
  );
  const paidRunRow = paidRunResult.rows[0];
  assert.equal(String(paidRunRow.status).toLowerCase(), "paid");
  assert.equal(String(paidRunRow.payment_status).toLowerCase(), "paid");

  const portal = await buildEmployeePayrollPortalPayload({
    employee,
    timeZone: "Africa/Cairo",
  });
  assert.equal(String(portal.payroll_status).toLowerCase(), "paid");
  assert.equal(String(portal.payment_status).toLowerCase(), "paid");
  assert.equal(Number(portal.payslip.net_salary), 1225);

  const ledgersAfterPayment = await getLedgersReport(db, {
    tenantId: employee.tenant_id,
    fromDate: `${payrollPeriod}-01`,
    toDate: `${payrollPeriod}-30`,
  });
  const paymentRows = (ledgersAfterPayment.rows || []).filter((row) => String(row.source_type || "") === "payroll_payment");
  assert.ok(paymentRows.length >= 2, "General ledger should include payroll payment lines");
  assert.ok(paymentRows.some((row) => Number(row.debit || 0) > 0 && String(row.account_type || "") === "liability"), "General ledger should include the payroll payable debit when paid");
  assert.ok(paymentRows.some((row) => Number(row.credit || 0) > 0 && String(row.account_type || "") === "asset"), "General ledger should include the cash or bank credit when paid");
});
