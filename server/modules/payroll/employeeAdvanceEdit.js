// Editing or deleting an employee advance (سلفة) after it was recorded.
// ---------------------------------------------------------------------------
// An advance is two things at once: a debt the next salary will deduct, and — when it was
// paid in cash — money that left a drawer. Changing only the first half would lose the cash,
// so every change here moves the drawer by the difference too:
//
//  - The advance must still be untouched by payroll: deduction_status 'pending', nothing
//    deducted, and its deduction month not approved. Past that point the salary already used it.
//  - An advance born from a deferred invoice (order_id) belongs to that invoice — the invoice
//    is stored as paid because of it — so it is changed from the invoice, never here.
//  - Cash paid on a shift that is still open: the expense itself is corrected and the drawer
//    event lands on that shift, as if the wrong figure had never been typed.
//  - Cash paid on a shift that is already closed: that shift's count stays as it was (the money
//    did leave that day). The difference goes in or out of the branch's open shift now, and
//    without an open shift the change is refused.
//  - Paid from an account or wallet: its journal lives on the expenses page, so it is refused.
//
// The drawer is moved here, not through recordCashDrawerEvent, because of how the POS shift
// report adds up: it takes advances from the expenses table, so a same-shift fix moves only
// expected_cash and must not add a cash_in line on top. And that helper's cash_in/cash_out also
// book financial-account activity that the original advance never booked.
//
// Every change is written to employee_advance_changes; its id is the drawer event's source id.

import db from "../../database/db.js";

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
};

const clean = (value) => String(value ?? "").trim();

let schemaPromise = null;
// Once per process, outside any transaction.
export const ensureEmployeeAdvanceChangesSchema = () => {
  if (!schemaPromise) {
    schemaPromise = db.query(`
      CREATE TABLE IF NOT EXISTS employee_advance_changes (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NULL,
        advance_id BIGINT NOT NULL,
        employee_id BIGINT NULL,
        action VARCHAR(20) NOT NULL,
        old_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        new_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        old_notes TEXT NULL,
        new_notes TEXT NULL,
        drawer_shift_id BIGINT NULL,
        drawer_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        changed_by BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => db.query(
      `CREATE INDEX IF NOT EXISTS idx_employee_advance_changes_advance ON employee_advance_changes (advance_id, created_at)`
    )).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};

const isPayrollMonthApproved = async (client, { tenantId, employeeId, month }) => {
  if (!month) return false;
  const table = await client.query("SELECT to_regclass('public.employee_payroll_runs') AS regclass");
  if (!table.rows[0]?.regclass) return false;
  const result = await client.query(
    `
    SELECT 1 FROM employee_payroll_runs
    WHERE employee_id = $1::bigint
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      AND payroll_period = $3
      AND LOWER(COALESCE(status, 'approved')) <> 'cancelled'
    LIMIT 1
    `,
    [employeeId, tenantId, month]
  );
  return result.rowCount > 0;
};

const lockOpenShift = async (client, { tenantId, shiftId = null, branchId = null }) => {
  const result = await client.query(
    `
    SELECT * FROM cash_drawer_shifts
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND status = 'open'
      AND ${shiftId ? "id = $2::bigint" : "branch_id = $2::bigint"}
    ORDER BY opened_at DESC, id DESC
    LIMIT 1
    FOR UPDATE
    `,
    [tenantId, shiftId || branchId]
  );
  return result.rows[0] || null;
};

/**
 * @param {object} args
 * @param {"update"|"delete"} args.action
 * @param {object} args.employee   scoped employee row (id, tenant_id, branch_id)
 * @param {number|null} args.tenantId
 * @param {number|null} args.actorId  the manager's user id
 */
export const changeEmployeeAdvance = async ({ action, employee, tenantId = null, advanceId, amount, notes, actorId = null } = {}) => {
  if (!["update", "delete"].includes(action)) throw httpError(400, "Unknown action");
  await ensureEmployeeAdvanceChangesSchema();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const advanceResult = await client.query(
      `
      SELECT * FROM employee_advances
      WHERE id = $1::bigint AND employee_id = $2::bigint
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
      FOR UPDATE
      `,
      [advanceId, employee.id, tenantId]
    );
    const advance = advanceResult.rows[0];
    if (!advance) throw httpError(404, "السلفة مش موجودة");

    if (advance.order_id) {
      throw httpError(409, "السلفة دي جاية من فاتورة آجل — عدّلها أو امسحها من الفاتورة نفسها", "ADVANCE_FROM_INVOICE");
    }
    const deductionStatus = clean(advance.deduction_status).toLowerCase();
    if (["cancelled", "canceled"].includes(deductionStatus) || clean(advance.status).toLowerCase() === "cancelled") {
      throw httpError(409, "السلفة دي ملغية بالفعل", "ADVANCE_CANCELLED");
    }
    if (deductionStatus !== "pending" || money(advance.deducted_amount) > 0) {
      throw httpError(409, "السلفة دي اتخصمت من المرتب (كلها أو جزء منها) — مينفعش تتعدل أو تتمسح", "ADVANCE_DEDUCTED");
    }
    if (await isPayrollMonthApproved(client, { tenantId, employeeId: employee.id, month: clean(advance.deduction_month).slice(0, 7) })) {
      throw httpError(409, "مرتب الشهر اللي السلفة دي عليه اتعتمد — مينفعش تتعدل أو تتمسح", "ADVANCE_PAYROLL_APPROVED");
    }

    const oldAmount = money(advance.amount);
    const newAmount = action === "delete" ? 0 : money(amount);
    if (action === "update" && !(newAmount > 0)) throw httpError(400, "أدخل مبلغًا أكبر من صفر");
    const newNotes = action === "update" && notes !== undefined ? clean(notes) : clean(advance.notes);
    // Positive: money goes back into the drawer. Negative: more money leaves it.
    const cashBack = money(oldAmount - newAmount);

    const expense = advance.expense_id
      ? (await client.query(`SELECT * FROM expenses WHERE id = $1::bigint FOR UPDATE`, [advance.expense_id])).rows[0] || null
      : null;
    const expensePaid = expense && clean(expense.status).toLowerCase() === "paid";
    const paidInCash = expensePaid && clean(expense.payment_method || "cash").toLowerCase() === "cash";

    let drawerShift = null;
    let correctExpense = Boolean(expense) && !expensePaid;
    if (expensePaid && cashBack !== 0) {
      if (!paidInCash || !expense.shift_id) {
        throw httpError(409, "السلفة دي اتصرفت من حساب أو محفظة — عدّلها من صفحة المصروفات عشان القيد يتظبط", "ADVANCE_PAID_FROM_ACCOUNT");
      }
      drawerShift = await lockOpenShift(client, { tenantId, shiftId: expense.shift_id });
      if (drawerShift) {
        correctExpense = true;
      } else {
        const branchId = expense.branch_id || employee.branch_id;
        drawerShift = branchId ? await lockOpenShift(client, { tenantId, branchId }) : null;
        if (!drawerShift) {
          throw httpError(
            409,
            cashBack > 0
              ? "الوردية اللي اتصرفت منها السلفة اتقفلت، ومفيش وردية مفتوحة في الفرع ترجع فيها الفلوس — افتح وردية الأول"
              : "الوردية اللي اتصرفت منها السلفة اتقفلت، ومفيش وردية مفتوحة في الفرع يطلع منها الفرق — افتح وردية الأول",
            "ADVANCE_NO_OPEN_SHIFT"
          );
        }
      }
    } else if (expensePaid) {
      correctExpense = true; // notes-only edit: no money moves
    }

    const change = (await client.query(
      `
      INSERT INTO employee_advance_changes (
        tenant_id, advance_id, employee_id, action, old_amount, new_amount, old_notes, new_notes,
        drawer_shift_id, drawer_amount, changed_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        advance.tenant_id ?? tenantId, advance.id, employee.id, action, oldAmount, newAmount,
        advance.notes || null, newNotes || null, drawerShift?.id || null, drawerShift ? cashBack : 0, actorId,
      ]
    )).rows[0];

    const updated = (await client.query(
      action === "delete"
        ? `
          UPDATE employee_advances
          SET deduction_status = 'cancelled', status = 'cancelled', remaining_amount = 0, updated_at = NOW()
          WHERE id = $1
          RETURNING *
          `
        : `
          UPDATE employee_advances
          SET amount = $2, remaining_amount = $2, notes = $3, updated_at = NOW()
          WHERE id = $1
          RETURNING *
          `,
      action === "delete" ? [advance.id] : [advance.id, newAmount, newNotes || null]
    )).rows[0];

    if (expense && correctExpense) {
      await client.query(
        action === "delete"
          ? `UPDATE expenses SET status = 'cancelled', updated_at = NOW() WHERE id = $1`
          : `UPDATE expenses SET amount = $2, notes = $3, updated_at = NOW() WHERE id = $1`,
        action === "delete" ? [expense.id] : [expense.id, newAmount, newNotes || expense.notes || null]
      );
    } else if (expense && drawerShift) {
      // Closed shift: its expense stays as counted; the note says where the difference went.
      const note = action === "delete"
        ? `اتلغت السلفة ورجع ${oldAmount} لوردية #${drawerShift.id}`
        : `اتعدلت السلفة من ${oldAmount} إلى ${newAmount} — الفرق اتسجل على وردية #${drawerShift.id}`;
      await client.query(
        `UPDATE expenses SET notes = TRIM(BOTH ' ' FROM CONCAT_WS(' — ', NULLIF(notes, ''), $2::text)), updated_at = NOW() WHERE id = $1`,
        [expense.id, note]
      );
    }

    if (drawerShift && cashBack !== 0) {
      const sameShift = Boolean(expense && Number(drawerShift.id) === Number(expense.shift_id));
      if (!sameShift) {
        // Another shift: a visible cash line, which that shift's report counts.
        await client.query(
          `
          INSERT INTO cash_drawer_shift_events (tenant_id, shift_id, event_type, source_type, source_id, amount, created_at, created_by)
          VALUES ($1,$2,$3,'employee_advance_change',$4,$5,NOW(),$6)
          `,
          [
            drawerShift.tenant_id, drawerShift.id, cashBack > 0 ? "cash_in" : "cash_out", change.id, Math.abs(cashBack),
            actorId || drawerShift.opened_by_user_id || drawerShift.opened_by,
          ]
        );
      }
      await client.query(
        `
        UPDATE cash_drawer_shifts
        SET expected_cash = expected_cash + $1,
            difference = COALESCE(actual_cash, expected_cash + $1) - (expected_cash + $1),
            cash_difference = COALESCE(actual_cash, expected_cash + $1) - (expected_cash + $1)
        WHERE id = $2 AND status = 'open'
        `,
        [cashBack, drawerShift.id]
      );
    }

    await client.query("COMMIT");
    console.log("[employee-advance] changed", {
      action,
      advance_id: advance.id,
      employee_id: employee.id,
      old_amount: oldAmount,
      new_amount: newAmount,
      drawer_shift_id: drawerShift?.id || null,
      drawer_cash_back: drawerShift ? cashBack : 0,
      same_shift: Boolean(drawerShift && expense && Number(drawerShift.id) === Number(expense.shift_id)),
      changed_by: actorId,
    });
    return {
      advance: updated,
      change,
      drawer: drawerShift ? { shift_id: Number(drawerShift.id), cash_back: cashBack } : null,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
};
