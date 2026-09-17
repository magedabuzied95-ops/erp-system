/*
 * Editing or deleting an advance from the manager portal.
 *
 * The advance is salary debt and — when paid in cash — money that left a drawer. The drawer has
 * two readers that must keep agreeing: cash_drawer_shifts.expected_cash (what the close books
 * against) and the POS shift report (which takes advances from the expenses table and manual
 * cash from cash_in/cash_out events). So this runs against a REAL database inside its own
 * schema, shadowing the tables it touches, and skips itself when no database is reachable.
 */
import test from "node:test";
import assert from "node:assert/strict";

const SCHEMA = "employee_advance_edit_test";

const pgConfig = {
  connectionString: process.env.DATABASE_URL || undefined,
  user: process.env.PGUSER || "postgres",
  host: process.env.PGHOST || "localhost",
  database: process.env.PGDATABASE || "erp_db",
  password: process.env.PGPASSWORD || "065342",
  port: Number(process.env.PGPORT) || 5432,
  connectionTimeoutMillis: 3000,
};

const reachable = async () => {
  try {
    const pg = await import("pg");
    const Pool = pg.default?.Pool || pg.Pool;
    const pool = new Pool(pgConfig);
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.end();
    return true;
  } catch {
    return false;
  }
};

const ready = await reachable();

if (!ready) {
  test("employee advance edit (skipped: no database)", { skip: true }, () => {});
} else {
  process.env.PGOPTIONS = `-c client_encoding=UTF8 -c search_path=${SCHEMA},public`;
  const { default: db } = await import("../server/database/db.js");
  const { changeEmployeeAdvance } = await import("../server/modules/payroll/employeeAdvanceEdit.js");

  await db.query(`
    CREATE TABLE employee_advances (
      id BIGSERIAL PRIMARY KEY, tenant_id BIGINT, employee_id BIGINT, amount NUMERIC(12,2),
      deducted_amount NUMERIC(12,2) DEFAULT 0, remaining_amount NUMERIC(12,2), deduction_month TEXT,
      deduction_status TEXT DEFAULT 'pending', status TEXT DEFAULT 'active', notes TEXT,
      expense_id BIGINT, order_id BIGINT, updated_at TIMESTAMPTZ
    )`);
  await db.query(`
    CREATE TABLE expenses (
      id BIGSERIAL PRIMARY KEY, tenant_id BIGINT, amount NUMERIC(12,2), status TEXT, payment_method TEXT,
      branch_id BIGINT, shift_id BIGINT, notes TEXT, updated_at TIMESTAMPTZ
    )`);
  await db.query(`
    CREATE TABLE cash_drawer_shifts (
      id BIGSERIAL PRIMARY KEY, tenant_id BIGINT, branch_id BIGINT, status TEXT, opened_at TIMESTAMPTZ DEFAULT NOW(),
      opened_by BIGINT, opened_by_user_id BIGINT, expected_cash NUMERIC(12,2), actual_cash NUMERIC(12,2),
      difference NUMERIC(12,2), cash_difference NUMERIC(12,2)
    )`);
  await db.query(`
    CREATE TABLE cash_drawer_shift_events (
      id BIGSERIAL PRIMARY KEY, tenant_id BIGINT, shift_id BIGINT, event_type TEXT, source_type TEXT,
      source_id BIGINT, amount NUMERIC(12,2), created_at TIMESTAMPTZ, created_by BIGINT
    )`);
  await db.query(`CREATE TABLE employee_payroll_runs (id BIGSERIAL PRIMARY KEY, tenant_id BIGINT, employee_id BIGINT, payroll_period TEXT, status TEXT)`);

  const employee = { id: 7, tenant_id: 1, branch_id: 3 };
  const reset = async () => {
    await db.query(`TRUNCATE employee_advances, expenses, cash_drawer_shifts, cash_drawer_shift_events, employee_payroll_runs RESTART IDENTITY`);
    await db.query(`DO $$ BEGIN IF to_regclass('employee_advance_changes') IS NOT NULL THEN TRUNCATE employee_advance_changes RESTART IDENTITY; END IF; END $$`);
  };
  const shift = async (status, expected = 1000) => (await db.query(
    `INSERT INTO cash_drawer_shifts (tenant_id, branch_id, status, opened_by, opened_by_user_id, expected_cash, difference, cash_difference) VALUES (1,3,$1,5,5,$2,0,0) RETURNING *`,
    [status, expected]
  )).rows[0];
  const cashAdvance = async ({ amount = 100, shiftId, status = "paid", method = "cash", extra = {} }) => {
    const expense = (await db.query(
      `INSERT INTO expenses (tenant_id, amount, status, payment_method, branch_id, shift_id) VALUES (1,$1,$2,$3,3,$4) RETURNING *`,
      [amount, status, method, shiftId || null]
    )).rows[0];
    return (await db.query(
      `INSERT INTO employee_advances (tenant_id, employee_id, amount, remaining_amount, deduction_month, expense_id, order_id, deduction_status, deducted_amount)
       VALUES (1,7,$1,$1,'2026-09',$2,$3,$4,$5) RETURNING *`,
      [amount, expense.id, extra.order_id || null, extra.deduction_status || "pending", extra.deducted_amount || 0]
    )).rows[0];
  };
  const row = async (table, id) => (await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0];
  const events = async () => (await db.query(`SELECT * FROM cash_drawer_shift_events ORDER BY id`)).rows;

  test("same open shift: the expense is corrected and only expected_cash moves", async () => {
    await reset();
    const open = await shift("open", 900);
    const adv = await cashAdvance({ amount: 100, shiftId: open.id });
    const res = await changeEmployeeAdvance({ action: "update", employee, tenantId: 1, advanceId: adv.id, amount: 60, notes: "fixed", actorId: 9 });
    assert.deepEqual(res.drawer, { shift_id: Number(open.id), cash_back: 40 });
    assert.equal(Number((await row("employee_advances", adv.id)).remaining_amount), 60);
    assert.equal(Number((await row("expenses", adv.expense_id)).amount), 60);
    assert.equal(Number((await row("cash_drawer_shifts", open.id)).expected_cash), 940);
    assert.equal((await events()).length, 0, "the report already sees the smaller expense; a cash_in line would count it twice");

    await changeEmployeeAdvance({ action: "delete", employee, tenantId: 1, advanceId: adv.id, actorId: 9 });
    const cancelled = await row("employee_advances", adv.id);
    assert.equal(cancelled.deduction_status, "cancelled");
    assert.equal(Number(cancelled.remaining_amount), 0);
    assert.equal((await row("expenses", adv.expense_id)).status, "cancelled");
    assert.equal(Number((await row("cash_drawer_shifts", open.id)).expected_cash), 1000);
  });

  test("closed shift: its expense stays, the difference is a cash line on the branch's open shift", async () => {
    await reset();
    const closed = await shift("closed", 500);
    const open = await shift("open", 200);
    const adv = await cashAdvance({ amount: 50, shiftId: closed.id });

    await changeEmployeeAdvance({ action: "update", employee, tenantId: 1, advanceId: adv.id, amount: 80, actorId: 9 });
    assert.equal(Number((await row("expenses", adv.expense_id)).amount), 50, "a counted shift keeps its figures");
    assert.match((await row("expenses", adv.expense_id)).notes, /من 50 إلى 80/);
    assert.equal(Number((await row("cash_drawer_shifts", open.id)).expected_cash), 170);
    assert.equal(Number((await row("cash_drawer_shifts", closed.id)).expected_cash), 500);

    await changeEmployeeAdvance({ action: "delete", employee, tenantId: 1, advanceId: adv.id, actorId: 9 });
    assert.equal(Number((await row("cash_drawer_shifts", open.id)).expected_cash), 250);
    assert.equal((await row("expenses", adv.expense_id)).status, "paid");
    const lines = await events();
    assert.deepEqual(lines.map((e) => [e.event_type, Number(e.amount), Number(e.shift_id)]), [["cash_out", 30, Number(open.id)], ["cash_in", 80, Number(open.id)]]);
    assert.notEqual(lines[0].source_id, lines[1].source_id, "two changes are two events");
  });

  test("closed shift and no open one: refused, nothing written", async () => {
    await reset();
    const closed = await shift("closed");
    const adv = await cashAdvance({ amount: 50, shiftId: closed.id });
    await assert.rejects(
      changeEmployeeAdvance({ action: "delete", employee, tenantId: 1, advanceId: adv.id, actorId: 9 }),
      (error) => error.code === "ADVANCE_NO_OPEN_SHIFT" && error.status === 409
    );
    assert.equal((await row("employee_advances", adv.id)).deduction_status, "pending");
    assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM employee_advance_changes`)).rows[0].n, 0);
  });

  test("notes-only edit on a closed shift needs no open shift", async () => {
    await reset();
    const closed = await shift("closed");
    const adv = await cashAdvance({ amount: 50, shiftId: closed.id });
    await changeEmployeeAdvance({ action: "update", employee, tenantId: 1, advanceId: adv.id, amount: 50, notes: "غاز", actorId: 9 });
    assert.equal((await row("employee_advances", adv.id)).notes, "غاز");
  });

  test("an unpaid expense follows the advance without touching any drawer", async () => {
    await reset();
    const adv = await cashAdvance({ amount: 70, status: "approved" });
    const res = await changeEmployeeAdvance({ action: "update", employee, tenantId: 1, advanceId: adv.id, amount: 20, actorId: 9 });
    assert.equal(res.drawer, null);
    assert.equal(Number((await row("expenses", adv.expense_id)).amount), 20);
  });

  test("refusals: invoice advance, deducted, approved month, paid from an account, other employee", async () => {
    await reset();
    const open = await shift("open");
    const fromInvoice = await cashAdvance({ amount: 1600, status: "approved", method: "employee_advance", extra: { order_id: 1162 } });
    const partly = await cashAdvance({ amount: 40, shiftId: open.id, extra: { deduction_status: "partial", deducted_amount: 10 } });
    const wallet = await cashAdvance({ amount: 40, method: "vodafone_cash" });
    const inApprovedMonth = await cashAdvance({ amount: 40, shiftId: open.id });
    await db.query(`INSERT INTO employee_payroll_runs (tenant_id, employee_id, payroll_period, status) VALUES (1,7,'2026-09','approved')`);
    const expect = async (advanceId, code, extra = {}) => assert.rejects(
      changeEmployeeAdvance({ action: "delete", employee, tenantId: 1, advanceId, actorId: 9, ...extra }),
      (error) => error.code === code
    );
    await expect(fromInvoice.id, "ADVANCE_FROM_INVOICE");
    await expect(partly.id, "ADVANCE_DEDUCTED");
    await expect(inApprovedMonth.id, "ADVANCE_PAYROLL_APPROVED");
    await db.query(`TRUNCATE employee_payroll_runs`);
    await expect(wallet.id, "ADVANCE_PAID_FROM_ACCOUNT");
    await assert.rejects(
      changeEmployeeAdvance({ action: "delete", employee: { ...employee, id: 8 }, tenantId: 1, advanceId: inApprovedMonth.id }),
      (error) => error.status === 404
    );
    await assert.rejects(
      changeEmployeeAdvance({ action: "update", employee, tenantId: 1, advanceId: inApprovedMonth.id, amount: 0 }),
      (error) => error.status === 400
    );
    assert.equal(Number((await row("cash_drawer_shifts", open.id)).expected_cash), 1000);
  });

  test.after(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await db.end?.();
  });
}
