import db from "../../database/db.js";
import { bookQuickPosExpense } from "../../controllers/posController.js";

// The POS "مصروف" button, from the manager portal. The money still leaves a real
// drawer, so the expense is booked on an OPEN shift of a branch the manager
// covers -- the same expenses row, drawer event and shift report the till writes.

const numberOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const scopeBranchId = (manager = {}) => (manager.branch_scope === "all" ? null : numberOrNull(manager.branch_id));

export const getManagerPortalExpenseContext = async ({ manager = {} } = {}) => {
  const tenantId = numberOrNull(manager.tenant_id);
  const branchId = scopeBranchId(manager);
  const shifts = await db.query(
    `
    SELECT s.id, s.branch_id, s.opened_at, s.expected_cash,
           b.name AS branch_name,
           COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), 'User #' || s.opened_by) AS cashier_name
    FROM cash_drawer_shifts s
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN users u ON u.id = s.opened_by
    WHERE s.status = 'open'
      AND ($1::bigint IS NULL OR s.tenant_id = $1::bigint)
      AND ($2::bigint IS NULL OR s.branch_id = $2::bigint)
    ORDER BY s.opened_at DESC
    `,
    [tenantId, branchId]
  );
  const employees = await db.query(
    `
    SELECT id, branch_id, COALESCE(NULLIF(full_name, ''), NULLIF(employee_code, ''), 'Employee #' || id) AS name
    FROM employees
    WHERE is_deleted IS DISTINCT FROM TRUE
      AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'terminated', 'deleted')
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND ($2::bigint IS NULL OR branch_id IS NULL OR branch_id = $2::bigint)
    ORDER BY name ASC
    `,
    [tenantId, branchId]
  );
  return { shifts: shifts.rows, employees: employees.rows };
};

export const createManagerPortalExpense = async ({ manager = {}, body = {}, idempotencyKey = "" } = {}) =>
  bookQuickPosExpense({
    tenantId: numberOrNull(manager.tenant_id),
    // users(id) columns get the manager's linked user or nothing -- never the employees id.
    actorUserId: numberOrNull(manager.user_id),
    body,
    idempotencyKey,
    manager: { branchId: scopeBranchId(manager), name: manager.full_name || manager.employee_code || "" },
  });
