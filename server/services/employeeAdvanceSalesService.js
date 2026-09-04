// Employee credit sales -> employee advances (سلف الموظفين).
// ---------------------------------------------------------------------------
// Rule, in one sentence: when a customer that is linked to an employee takes a
// DEFERRED invoice (آجل), the outstanding amount does not stay as customer debt —
// it becomes an advance on that employee's salary, immediately, and the invoice is
// stored as PAID with the marker `settled_via_employee_advance`.
//
// Consequences that shaped this file:
//  - A fully PAID invoice creates nothing. Only the OUTSTANDING part becomes an
//    advance, so a partially-paid deferred invoice books only its remainder.
//  - No cash moves. The backing expense is written with
//    payment_method = 'employee_advance', which is NOT a cash method, so the POS
//    drawer, the shift's expected_cash, and every "real money in/out" aggregate
//    stay untouched. This is the same treatment `credit_sale` already gets.
//  - Editing the invoice price re-syncs the advance to the new outstanding amount.
//    One invoice owns at most ONE advance (unique index on employee_advances.order_id),
//    so the edit updates in place instead of stacking a second سلفة.
//  - Payroll is the floor: an advance already (partly) deducted from a salary can
//    never be reduced below what was deducted. It clamps and reports `clamped`.
//
// Existing invoices are NOT backfilled — the rule applies from the moment a
// customer is linked to an employee onwards.

import db from "../database/db.js";
import { resolveAdvanceDeductionMonth } from "../utils/advanceDeductionMonth.js";

// The payment method stored on both the settled order and the backing expense.
// Deliberately NOT a cash method: nothing was collected and nothing was paid out.
export const EMPLOYEE_ADVANCE_PAYMENT_METHOD = "employee_advance";

const ACTIVE_EMPLOYEE_STATUSES = ["active", "working", "on_duty", ""];

// Statuses where the advance is still ours to change. Once it is settled or
// cancelled the invoice edit must not silently resurrect it.
const MUTABLE_DEDUCTION_STATUSES = ["pending", "partial", "partially_deducted", "included_in_payroll"];

const money = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
};

const clean = (value) => String(value ?? "").trim();

const currentDeductionMonth = () => new Date().toISOString().slice(0, 7);

let schemaPromise = null;

// DDL at request time serializes POS checkouts behind an ACCESS EXCLUSIVE lock,
// so this runs once per process against the pool — never inside the sale txn.
export const ensureEmployeeAdvanceSalesSchema = async () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS linked_employee_id BIGINT NULL`);
      await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS linked_employee_linked_at TIMESTAMPTZ NULL`);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_customers_linked_employee
        ON customers (tenant_id, linked_employee_id)
        WHERE linked_employee_id IS NOT NULL
      `);

      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS settled_via_employee_advance BOOLEAN NOT NULL DEFAULT FALSE`);
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS employee_advance_id BIGINT NULL`);
      await db.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS employee_advance_employee_id BIGINT NULL`);

      await db.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS order_id BIGINT NULL`);
      await db.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'manual'`);
      await db.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_advances_order
        ON employee_advances (order_id)
        WHERE order_id IS NOT NULL
      `);

      await db.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS order_id BIGINT NULL`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_expenses_order ON expenses (order_id) WHERE order_id IS NOT NULL`);
    })().catch((error) => {
      // A failed ensure must not be cached as "done", or the columns stay missing
      // for the whole process lifetime.
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};

// The employee behind a customer row, or null. Explicit link only — a phone match
// is a *suggestion* surfaced in the UI, never an automatic settlement trigger.
export const resolveLinkedEmployee = async (clientOrPool, { tenantId, customerId } = {}) => {
  if (!customerId) return null;
  const result = await clientOrPool.query(
    `
    SELECT
      e.id,
      e.tenant_id,
      e.employee_code,
      e.full_name,
      e.phone,
      e.branch_id,
      COALESCE(e.status, '') AS status
    FROM customers c
    JOIN employees e ON e.id = c.linked_employee_id
    WHERE c.id = $1
      AND ($2::bigint IS NULL OR c.tenant_id = $2::bigint OR c.tenant_id IS NULL)
      AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint)
    LIMIT 1
    `,
    [customerId, tenantId ?? null]
  );
  const employee = result.rows[0] || null;
  if (!employee) return null;
  if (!ACTIVE_EMPLOYEE_STATUSES.includes(clean(employee.status).toLowerCase())) return null;
  return employee;
};

// An employee whose phone matches this one, for the "is this عمر ايوب the employee?"
// suggestion in the customer form. Read-only: it never links anything by itself.
export const findEmployeeByPhone = async (clientOrPool, { tenantId, phone } = {}) => {
  const digits = clean(phone).replace(/\D/g, "");
  if (digits.length < 7) return null;
  // Compare on the last 9 digits so +20 / 0020 / 0-prefixed spellings of the same
  // Egyptian number match each other.
  const tail = digits.slice(-9);
  const result = await clientOrPool.query(
    `
    SELECT id, employee_code, full_name, phone, COALESCE(status, '') AS status
    FROM employees
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND phone IS NOT NULL
      AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 9) = $2
    ORDER BY (LOWER(COALESCE(status, '')) = 'active') DESC, id ASC
    LIMIT 1
    `,
    [tenantId ?? null, tail]
  );
  return result.rows[0] || null;
};

const findAdvanceForOrder = async (client, { orderId }) => {
  const result = await client.query(
    `SELECT * FROM employee_advances WHERE order_id = $1 LIMIT 1`,
    [orderId]
  );
  return result.rows[0] || null;
};

const advanceStatusFor = ({ amount, deductedAmount, previousStatus = "" }) => {
  if (deductedAmount >= amount - 0.009) return "settled";
  if (clean(previousStatus) === "included_in_payroll") return "included_in_payroll";
  if (deductedAmount > 0) return "partial";
  return "pending";
};

const buildAdvanceTitle = ({ order, employee }) => {
  const invoice = clean(order?.invoice_number || order?.order_number || order?.id);
  const name = clean(employee?.full_name || employee?.employee_code || employee?.id);
  return `سلفة موظف - فاتورة ${invoice || "#"} - ${name}`.slice(0, 250);
};

const buildAdvanceNotes = ({ order, employee }) => {
  const invoice = clean(order?.invoice_number || order?.order_number || `#${order?.id}`);
  const name = clean(employee?.full_name || employee?.employee_code || "");
  return `مشتريات الموظف ${name} على فاتورة آجل ${invoice} (تمت إضافتها تلقائياً لسلف الموظف)`;
};

const insertBackingExpense = async (client, { tenantId, order, employee, amount }) => {
  const result = await client.query(
    `
    INSERT INTO expenses (
      tenant_id, title, amount, expense_type, category, payment_method, employee_id,
      branch_id, order_id, expense_date, notes, status, created_at, updated_at
    )
    VALUES ($1,$2,$3,'employee_advance','employee_advance',$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9,'approved',NOW(),NOW())
    RETURNING *
    `,
    [
      tenantId,
      buildAdvanceTitle({ order, employee }),
      amount,
      EMPLOYEE_ADVANCE_PAYMENT_METHOD,
      employee.id,
      order.branch_id || employee.branch_id || null,
      order.id,
      order.created_at ? new Date(order.created_at).toISOString().slice(0, 10) : null,
      buildAdvanceNotes({ order, employee }),
    ]
  );
  return result.rows[0];
};

/**
 * Bring the employee advance for one order in line with its outstanding amount.
 *
 * Creates the advance on the first deferred save, updates it in place when the
 * invoice is re-priced, and winds it down when the outstanding amount reaches
 * zero (edit to fully paid, cancellation, full return).
 *
 * Always runs on the caller's transaction client so the advance and the invoice
 * commit together — an invoice marked paid without its سلفة is the one outcome
 * this feature cannot produce.
 */
export const syncOrderEmployeeAdvance = async (client, {
  tenantId,
  order,
  employee,
  outstandingAmount,
  actorId = null,
  reason = "",
} = {}) => {
  if (!order?.id || !employee?.id) return null;

  const amount = Math.max(0, money(outstandingAmount));
  const existing = await findAdvanceForOrder(client, { orderId: order.id });
  const deductedAmount = Math.max(0, money(existing?.deducted_amount));

  // Nothing outstanding and nothing recorded: no سلفة to write. This is the
  // "لو الفاتورة مدفوعة لا يتم تسجيلها" branch.
  if (amount <= 0 && !existing) return null;

  if (existing && !MUTABLE_DEDUCTION_STATUSES.includes(clean(existing.deduction_status).toLowerCase())) {
    // Already settled or cancelled at payroll — the invoice edit must not reopen it.
    console.warn("[employee-advance-sale] advance is frozen, skipping re-sync", {
      order_id: order.id,
      advance_id: existing.id,
      deduction_status: existing.deduction_status,
      requested_amount: amount,
    });
    return { advance: existing, changed: false, frozen: true };
  }

  // Payroll already took some of it — that part cannot be un-taken by re-pricing.
  const effectiveAmount = Math.max(amount, deductedAmount);
  const clamped = effectiveAmount > amount + 0.009;

  if (existing) {
    const expenseId = existing.expense_id || null;
    if (expenseId) {
      await client.query(
        `
        UPDATE expenses
        SET amount = $2,
            title = $3,
            notes = $4,
            updated_at = NOW()
        WHERE id = $1
        `,
        [expenseId, effectiveAmount, buildAdvanceTitle({ order, employee }), buildAdvanceNotes({ order, employee })]
      );
    }

    const nextStatus = effectiveAmount <= 0
      ? "cancelled"
      : advanceStatusFor({ amount: effectiveAmount, deductedAmount, previousStatus: existing.deduction_status });

    const updated = await client.query(
      `
      UPDATE employee_advances
      SET employee_id = $2,
          amount = $3,
          remaining_amount = GREATEST($3::numeric - COALESCE(deducted_amount, 0), 0),
          deduction_status = $4,
          status = $4,
          notes = $5,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [existing.id, employee.id, effectiveAmount, nextStatus, buildAdvanceNotes({ order, employee })]
    );

    console.info("[employee-advance-sale] advance re-synced", {
      order_id: order.id,
      advance_id: existing.id,
      employee_id: employee.id,
      previous_amount: money(existing.amount),
      amount: effectiveAmount,
      deducted_amount: deductedAmount,
      clamped,
      reason: reason || "order-edit",
    });

    return { advance: updated.rows[0], expense_id: expenseId, changed: true, clamped, created: false };
  }

  if (effectiveAmount <= 0) return null;

  // A month whose salary is already approved is closed: the advance lands on the next one.
  const deductionMonth = await resolveAdvanceDeductionMonth({ clientOrPool: client, tenantId, employeeId: employee.id, month: currentDeductionMonth() });
  const expense = await insertBackingExpense(client, {
    tenantId,
    order,
    employee,
    amount: effectiveAmount,
  });

  const inserted = await client.query(
    `
    INSERT INTO employee_advances (
      tenant_id, employee_id, amount, deducted_amount, remaining_amount, deduction_month,
      deduction_status, status, notes, expense_id, order_id, source, created_by, created_at, updated_at
    )
    VALUES ($1,$2,$3,0,$3,$4,'pending','pending',$5,$6,$7,'order_credit_sale',$8,NOW(),NOW())
    RETURNING *
    `,
    [
      tenantId,
      employee.id,
      effectiveAmount,
      deductionMonth,
      buildAdvanceNotes({ order, employee }),
      expense.id,
      order.id,
      actorId,
    ]
  );

  console.info("[employee-advance-sale] advance created from deferred invoice", {
    order_id: order.id,
    invoice_number: order.invoice_number || null,
    advance_id: inserted.rows[0]?.id,
    expense_id: expense.id,
    employee_id: employee.id,
    employee_code: employee.employee_code || null,
    amount: effectiveAmount,
    deduction_month: deductionMonth,
    reason: reason || "order-create",
  });

  return { advance: inserted.rows[0], expense_id: expense.id, changed: true, clamped: false, created: true };
};

/**
 * Settle a deferred invoice against the employee's advances and stamp the invoice
 * as paid. Returns null when the customer is not an employee or nothing is
 * outstanding, in which case the caller leaves the invoice exactly as it was.
 */
export const settleOrderAsEmployeeAdvance = async (client, {
  tenantId,
  order,
  outstandingAmount,
  actorId = null,
  reason = "order-create",
} = {}) => {
  const customerId = order?.customer_id || null;
  if (!customerId) return null;

  const employee = await resolveLinkedEmployee(client, { tenantId, customerId });
  if (!employee) return null;

  const amount = Math.max(0, money(outstandingAmount));
  if (amount <= 0) return null;

  const result = await syncOrderEmployeeAdvance(client, {
    tenantId,
    order,
    employee,
    outstandingAmount: amount,
    actorId,
    reason,
  });
  if (!result?.advance) return null;

  const paidAmount = money(order.paid_amount);
  const totalAmount = money(order.total_amount ?? order.total ?? order.total_price);
  const settledPaidAmount = money(paidAmount + amount);

  const breakdown = Array.isArray(order.payment_breakdown) ? [...order.payment_breakdown] : [];
  breakdown.push({
    method: EMPLOYEE_ADVANCE_PAYMENT_METHOD,
    account_id: null,
    amount,
    employee_id: employee.id,
    employee_advance_id: result.advance.id,
  });

  const updated = await client.query(
    `
    UPDATE orders
    SET paid_amount = $2,
        remaining_amount = GREATEST($3::numeric - $2::numeric, 0),
        payment_status = 'paid',
        payment_method = $4,
        payment_breakdown = $5::jsonb,
        settled_via_employee_advance = TRUE,
        employee_advance_id = $6,
        employee_advance_employee_id = $7,
        updated_at = NOW()
    WHERE id = $1
    RETURNING paid_amount, remaining_amount, payment_status, payment_method, payment_breakdown,
              settled_via_employee_advance, employee_advance_id, employee_advance_employee_id
    `,
    [
      order.id,
      settledPaidAmount,
      totalAmount,
      EMPLOYEE_ADVANCE_PAYMENT_METHOD,
      JSON.stringify(breakdown),
      result.advance.id,
      employee.id,
    ]
  );

  console.info("[employee-advance-sale] deferred invoice settled to employee advances", {
    order_id: order.id,
    employee_id: employee.id,
    amount,
    paid_amount: settledPaidAmount,
    total_amount: totalAmount,
  });

  return {
    employee,
    advance: result.advance,
    expense_id: result.expense_id || null,
    amount,
    order: updated.rows[0] || null,
  };
};

/**
 * Re-sync an already-settled invoice after its price changed. The employee owes
 * the new total, immediately — that is the "وفى حالة تعديل السعر يتم تعديل سلف
 * الموظف فوراً" half of the rule.
 */
export const resyncSettledOrderEmployeeAdvance = async (client, {
  tenantId,
  order,
  newTotalAmount,
  collectedAmount = 0,
  actorId = null,
  reason = "order-edit",
} = {}) => {
  if (!order?.id) return null;
  const employeeId = order.employee_advance_employee_id || null;

  const employeeResult = employeeId
    ? await client.query(
        `SELECT id, tenant_id, employee_code, full_name, phone, branch_id, COALESCE(status, '') AS status
         FROM employees WHERE id = $1 LIMIT 1`,
        [employeeId]
      )
    : { rows: [] };
  const employee = employeeResult.rows[0]
    || await resolveLinkedEmployee(client, { tenantId, customerId: order.customer_id });
  if (!employee) return null;

  // Whatever real money was collected on this invoice reduces what the employee
  // owes; the rest is the advance.
  const outstanding = Math.max(0, money(money(newTotalAmount) - money(collectedAmount)));

  const result = await syncOrderEmployeeAdvance(client, {
    tenantId,
    order,
    employee,
    outstandingAmount: outstanding,
    actorId,
    reason,
  });

  const advanceAmount = money(result?.advance?.amount ?? (result === null ? 0 : outstanding));
  const paidAmount = money(money(collectedAmount) + advanceAmount);

  await client.query(
    `
    UPDATE orders
    SET paid_amount = $2,
        remaining_amount = GREATEST($3::numeric - $2::numeric, 0),
        payment_status = CASE WHEN $3::numeric - $2::numeric > 0.009 THEN 'partial' ELSE 'paid' END,
        settled_via_employee_advance = $4,
        employee_advance_id = $5,
        employee_advance_employee_id = $6,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      order.id,
      paidAmount,
      money(newTotalAmount),
      advanceAmount > 0,
      advanceAmount > 0 ? (result?.advance?.id || order.employee_advance_id || null) : null,
      advanceAmount > 0 ? employee.id : null,
    ]
  );

  return { employee, advance: result?.advance || null, amount: advanceAmount, clamped: Boolean(result?.clamped) };
};

export default {
  EMPLOYEE_ADVANCE_PAYMENT_METHOD,
  ensureEmployeeAdvanceSalesSchema,
  resolveLinkedEmployee,
  findEmployeeByPhone,
  syncOrderEmployeeAdvance,
  settleOrderAsEmployeeAdvance,
  resyncSettledOrderEmployeeAdvance,
};
