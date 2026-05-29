import assert from "node:assert/strict";
import db from "../database/db.js";
import { listActiveEmployeeAdvancesForPayroll } from "../services/salesCommissionService.js";

const run = async () => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE employee_advances (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NULL,
        employee_id BIGINT NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        deducted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        deduction_month VARCHAR(7) NOT NULL,
        deduction_status VARCHAR(40) NOT NULL DEFAULT 'pending',
        status VARCHAR(40) NOT NULL DEFAULT 'pending',
        notes TEXT,
        expense_id BIGINT NULL,
        payroll_reference VARCHAR(120),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ON COMMIT DROP
    `);

    const employeeAId = 900001;
    const employeeBId = 900002;
    await client.query(
      `
      INSERT INTO employee_advances (
        tenant_id, employee_id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status, notes
      ) VALUES
        (NULL, $1, 1000, 0, 1000, '2026-05', 'pending', 'pending', 'Employee A scope test'),
        (NULL, $1, 300, 0, 300, '2026-05', 'included_in_payroll', 'included_in_payroll', 'Employee A included preview test'),
        (NULL, $1, 500, 500, 0, '2026-05', 'settled', 'settled', 'Employee A settled test')
      `,
      [employeeAId]
    );

    const employeeAAdvances = await listActiveEmployeeAdvancesForPayroll({ clientOrPool: client, employeeId: employeeAId });
    const employeeBAdvances = await listActiveEmployeeAdvancesForPayroll({ clientOrPool: client, employeeId: employeeBId });
    const employeeATotal = employeeAAdvances.reduce((sum, row) => sum + Number(row.outstanding_amount || 0), 0);
    const employeeBTotal = employeeBAdvances.reduce((sum, row) => sum + Number(row.outstanding_amount || 0), 0);

    assert.equal(employeeAAdvances.length, 2, "Employee A should have pending and included-in-payroll deductions only");
    assert.equal(employeeATotal, 1300, "Employee A deduction total should include pending and included-in-payroll advances");
    assert.equal(employeeBAdvances.length, 0, "Employee B should not inherit Employee A deductions");
    assert.equal(employeeBTotal, 0, "Employee B deduction total should be 0");

    await client.query("ROLLBACK");
    console.log("Payroll deduction scope validation passed");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
};

run().catch((error) => {
  console.error("Payroll deduction scope validation failed:", error);
  process.exitCode = 1;
});
