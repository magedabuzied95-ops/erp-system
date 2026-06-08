import db from "../database/db.js";
import { io } from "../utils/socket.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  closeCashDrawerShift,
  ensureAccountingSchema,
  getCashDrawerShiftEvents,
  getCurrentCashDrawerShift,
  getPaymentAccountStatus,
  openCashDrawerShift,
  recordCashDrawerEvent,
} from "../services/accountingService.js";
import {
  createTerminalOrder,
  ensurePaymentTransactionsSchema,
  getOrderStatus,
  normalizePaymobPaymentPayload,
  normalizePaymobError,
  verifyPaymobHmac,
} from "../services/paymobPosService.js";
import {
  ensureSalesCommissionSchema,
  getSalesSettings,
} from "../services/salesCommissionService.js";
import { getSetting } from "../services/settingsService.js";

const numberOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const money = (value) => Number(Number(value || 0).toFixed(2));
const clean = (value = "") => String(value || "").trim();
const quickExpenseTypes = new Set(["shipping", "maintenance", "groceries_supplies", "marketing", "electricity", "water", "rent", "other", "employee_advance"]);
const quickExpensePayments = new Set(["cash", "card", "wallet"]);

const normalizeQuickExpenseType = (value = "") => {
  const normalized = clean(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (["employee_advance", "employee_advances", "staff_advance", "advance"].includes(normalized)) return "employee_advance";
  if (["delivery", "courier"].includes(normalized)) return "shipping";
  if (["cleaning", "snacks", "small_purchases", "supplies", "groceries"].includes(normalized)) return "groceries_supplies";
  if (["internet", "utilities", "utility"].includes(normalized)) return "other";
  return quickExpenseTypes.has(normalized) ? normalized : "other";
};

const ensurePosExpenseSchema = async (clientOrPool = db) => {
  await ensureAccountingSchema();
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      title VARCHAR(255) NOT NULL DEFAULT 'Expense',
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      expense_type VARCHAR(80) NOT NULL DEFAULT 'other',
      category VARCHAR(120),
      payment_method VARCHAR(80) DEFAULT 'cash',
      branch_id BIGINT NULL,
      expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'draft',
      source VARCHAR(50) NOT NULL DEFAULT 'expenses',
      shift_id BIGINT NULL,
      created_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT 'Expense'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS expense_type VARCHAR(80) NOT NULL DEFAULT 'other'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS category VARCHAR(120)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(80) DEFAULT 'cash'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS expense_date DATE NOT NULL DEFAULT CURRENT_DATE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS notes TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'draft'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS paid_by BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'expenses'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS shift_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS employee_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS created_by BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_expenses_pos_shift ON expenses (tenant_id, source, shift_id)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_advances (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      deducted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      deduction_month VARCHAR(7) NOT NULL,
      deduction_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      status VARCHAR(40) NOT NULL DEFAULT 'active',
      notes TEXT,
      expense_id BIGINT NULL,
      payroll_reference VARCHAR(120),
      created_by BIGINT,
      deducted_by BIGINT,
      deducted_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'active'`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_advances_pos_expense ON employee_advances (expense_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_advances_employee_status ON employee_advances (tenant_id, employee_id, deduction_status)`);
};

const paymobMerchantOrderLocalId = (value = "") => {
  const match = String(value || "").match(/^erp-[^-]+-(\d+)-/i);
  return match ? Number(match[1]) : null;
};

const terminalFinalStatuses = new Set(["success", "success_manual_confirmed"]);

const canManuallyConfirmTerminalPayment = (user = {}) => {
  if (isAdminLike(user) || isSuperAdminUser(user)) return true;
  const role = normalizeRole(user.role_name || user.role || user.employee_role || "");
  return ["cashier", "pos", "pos cashier", "pos_cashier", "sales", "seller"].includes(role);
};

const emitPaymobPaymentRealtime = ({ transaction = {}, order = {} } = {}) => {
  try {
    const payload = {
      transaction,
      order,
      order_id: order?.id || transaction?.order_id || null,
      invoice_number: order?.invoice_number || "",
      payment_status: order?.payment_status || "",
      status: transaction?.status || "",
      amount_cents: transaction?.confirmed_amount_cents || transaction?.amount_cents || 0,
      transaction_reference: transaction?.transaction_reference || "",
      updated_at: new Date().toISOString(),
    };
    io.emit("pos:payment_updated", payload);
    io.emit("order:payment_updated", payload);
    io.emit("refresh_dashboard");
  } catch (socketError) {
    console.error("[paymob-pos] realtime emit failed", socketError?.message || socketError);
  }
};

const recordPaymobEvent = async (client, transactionId, normalized, payload) => {
  const eventId = normalized.transactionReference
    ? `paymob:${normalized.transactionReference}:${normalized.status}`
    : normalized.providerOrderId
      ? `paymob-order:${normalized.providerOrderId}:${normalized.status}`
      : null;
  if (!eventId) return { replay: false };
  const result = await client.query(
    `
    INSERT INTO payment_transaction_events (transaction_id, provider, provider_event_id, event_type, status, payload)
    VALUES ($1, 'paymob', $2, 'payment_status', $3, $4::jsonb)
    ON CONFLICT (provider, provider_event_id) WHERE provider_event_id IS NOT NULL AND provider_event_id <> ''
    DO NOTHING
    RETURNING id
    `,
    [transactionId || null, eventId, normalized.status, JSON.stringify(payload || {})]
  );
  return { replay: result.rowCount === 0, eventId };
};

const findPaymobTransaction = async (client, normalized, explicitTransactionId = null, tenantId = null) => {
  const localOrderId = numberOrNull(normalized.invoiceOrOrderId) || paymobMerchantOrderLocalId(normalized.merchantOrderId);
  const params = [];
  const where = ["provider = 'paymob'"];
  if (explicitTransactionId) {
    params.push(explicitTransactionId);
    where.push(`id = $${params.length}`);
  } else {
    const clauses = [];
    if (normalized.transactionReference) {
      params.push(normalized.transactionReference);
      clauses.push(`transaction_reference = $${params.length}`);
    }
    if (normalized.providerOrderId) {
      params.push(normalized.providerOrderId);
      clauses.push(`provider_order_id = $${params.length}`);
    }
    if (localOrderId) {
      params.push(localOrderId);
      clauses.push(`order_id = $${params.length}`);
    }
    if (!clauses.length) return null;
    where.push(`(${clauses.join(" OR ")})`);
  }
  if (tenantId) {
    params.push(tenantId);
    where.push(`tenant_id = $${params.length}`);
  }
  const result = await client.query(
    `
    SELECT *
    FROM payment_transactions
    WHERE ${where.join(" AND ")}
    ORDER BY
      CASE WHEN status IN ('pending', 'sent') THEN 0 ELSE 1 END,
      updated_at DESC,
      id DESC
    LIMIT 1
    `,
    params
  );
  return result.rows[0] || null;
};

const applyPaymobConfirmation = async (client, normalized, options = {}) => {
  await ensurePaymentTransactionsSchema(client);
  const transaction = await findPaymobTransaction(client, normalized, options.transactionId, options.tenantId);
  if (!transaction) {
    const error = new Error("Matching Paymob payment transaction was not found");
    error.status = 404;
    throw error;
  }

  const event = await recordPaymobEvent(client, transaction.id, normalized, normalized.payload);
  const nextStatus = normalized.status === "success" ? "success" : normalized.status === "cancelled" ? "cancelled" : normalized.status === "failed" ? "failed" : "sent";
  const confirmedCents = nextStatus === "success"
    ? Math.max(0, Number(normalized.amountCents || transaction.amount_cents || 0))
    : 0;

  if (terminalFinalStatuses.has(String(transaction.status || "").toLowerCase())) {
    const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [transaction.order_id]);
    console.log("[paymob-pos-confirm]", {
      transaction_id: transaction.id,
      order_id: transaction.order_id,
      status: transaction.status,
      duplicate: true,
      source: transaction.confirmation_source || "paymob",
    });
    return {
      replay: true,
      transaction,
      order: orderResult.rows[0] || null,
      status: transaction.status,
      message: "Paymob payment was already confirmed",
    };
  }

  await client.query(
    `
    UPDATE payment_transactions
    SET status = $2::text,
        provider_order_id = COALESCE(NULLIF($3::text, ''), provider_order_id),
        terminal_id = COALESCE(NULLIF($4::text, ''), terminal_id),
        transaction_reference = COALESCE(NULLIF($5::text, ''), transaction_reference),
        confirmed_amount_cents = CASE WHEN $2::text = 'success' THEN $6::bigint ELSE confirmed_amount_cents END,
        confirmed_at = CASE WHEN $2::text = 'success' THEN COALESCE(confirmed_at, CURRENT_TIMESTAMP) ELSE confirmed_at END,
        confirmation_source = CASE WHEN $2::text = 'success' THEN COALESCE(confirmation_source, 'paymob'::text) ELSE confirmation_source END,
        response_payload = COALESCE(response_payload, '{}'::jsonb) || $7::jsonb,
        error_message = CASE WHEN $2::text IN ('failed', 'cancelled') THEN COALESCE(NULLIF($8::text, ''), error_message) ELSE NULL END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [
      transaction.id,
      nextStatus,
      normalized.providerOrderId || "",
      normalized.terminalId || "",
      normalized.transactionReference || "",
      confirmedCents,
      JSON.stringify(normalized.payload || {}),
      normalized.rawStatus || nextStatus,
    ]
  );

  let order = null;
  if (nextStatus === "success") {
    const confirmedAmount = money(confirmedCents / 100);
    const orderResult = await client.query(
      `
      UPDATE orders
      SET paid_amount = COALESCE(paid_amount, 0) + $2::numeric,
          card_amount = COALESCE(card_amount, 0) + $2::numeric,
          payment_status = CASE
            WHEN COALESCE(paid_amount, 0) + $2::numeric >= COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) THEN 'paid'
            WHEN COALESCE(paid_amount, 0) + $2::numeric > 0 THEN 'partially_paid'
            ELSE COALESCE(payment_status, 'unpaid')
          END,
          status = CASE
            WHEN COALESCE(paid_amount, 0) + $2::numeric >= COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) THEN 'Paid'
            WHEN COALESCE(paid_amount, 0) + $2::numeric > 0 THEN 'Partial'
            ELSE status
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [transaction.order_id, confirmedAmount]
    );
    order = orderResult.rows[0] || null;
  } else {
    const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [transaction.order_id]);
    order = orderResult.rows[0] || null;
  }

  const updatedTransaction = await client.query("SELECT * FROM payment_transactions WHERE id = $1", [transaction.id]);
  const result = {
    replay: event.replay,
    transaction: updatedTransaction.rows[0] || transaction,
    order,
    status: nextStatus,
    message: nextStatus === "success"
      ? "Payment completed successfully."
      : nextStatus === "failed"
        ? "Paymob terminal payment failed."
        : nextStatus === "cancelled"
          ? "Paymob terminal payment was cancelled."
          : "Waiting for terminal payment confirmation...",
  };
  console.log("[paymob-pos-confirm]", {
    transaction_id: result.transaction?.id || transaction.id,
    order_id: result.order?.id || transaction.order_id,
    status: result.status,
    amount_cents: confirmedCents,
    source: result.transaction?.confirmation_source || (result.status === "success" ? "paymob" : "status_check"),
    replay: result.replay,
  });
  emitPaymobPaymentRealtime(result);
  return result;
};

const manualConfirmPaymobTransaction = async (client, { transactionId, tenantId, userId, note = "" } = {}) => {
  await ensurePaymentTransactionsSchema(client);
  const transactionResult = await client.query(
    `
    SELECT *
    FROM payment_transactions
    WHERE id = $1
      AND provider = 'paymob'
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    FOR UPDATE
    `,
    [transactionId, tenantId]
  );
  const transaction = transactionResult.rows[0];
  if (!transaction) {
    const error = new Error("Paymob payment transaction not found");
    error.status = 404;
    throw error;
  }

  if (terminalFinalStatuses.has(String(transaction.status || "").toLowerCase())) {
    const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [transaction.order_id]);
    console.log("[paymob-pos-confirm]", {
      transaction_id: transaction.id,
      order_id: transaction.order_id,
      status: transaction.status,
      duplicate: true,
      source: transaction.confirmation_source || "manual_terminal_approval",
    });
    return {
      replay: true,
      status: transaction.status,
      transaction,
      order: orderResult.rows[0] || null,
      message: "Terminal payment was already confirmed.",
    };
  }

  const confirmedCents = Math.max(0, Number(transaction.amount_cents || 0));
  const confirmedAmount = money(confirmedCents / 100);
  const updatedTransaction = await client.query(
    `
    UPDATE payment_transactions
    SET status = 'success_manual_confirmed',
        confirmed_amount_cents = $2,
        confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP),
        confirmation_source = 'manual_terminal_approval',
        confirmed_by = $3,
        response_payload = COALESCE(response_payload, '{}'::jsonb) || $4::jsonb,
        error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
    `,
    [
      transaction.id,
      confirmedCents,
      userId || null,
      JSON.stringify({
        manual_terminal_approval: true,
        confirmed_by: userId || null,
        note,
        confirmed_at: new Date().toISOString(),
      }),
    ]
  );

  const orderResult = await client.query(
    `
    UPDATE orders
    SET paid_amount = COALESCE(paid_amount, 0) + $2::numeric,
        card_amount = COALESCE(card_amount, 0) + $2::numeric,
        payment_status = CASE
          WHEN COALESCE(paid_amount, 0) + $2::numeric >= COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) THEN 'paid'
          WHEN COALESCE(paid_amount, 0) + $2::numeric > 0 THEN 'partially_paid'
          ELSE COALESCE(payment_status, 'unpaid')
        END,
        status = CASE
          WHEN COALESCE(paid_amount, 0) + $2::numeric >= COALESCE(NULLIF(total_amount, 0), NULLIF(total, 0), total_price, 0) THEN 'Paid'
          WHEN COALESCE(paid_amount, 0) + $2::numeric > 0 THEN 'Partial'
          ELSE status
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
    `,
    [transaction.order_id, confirmedAmount]
  );

  await recordPaymobEvent(client, transaction.id, {
    status: "success_manual_confirmed",
    transactionReference: transaction.transaction_reference || "",
    providerOrderId: transaction.provider_order_id || "",
  }, {
    manual_terminal_approval: true,
    note,
    user_id: userId || null,
  });

  const result = {
    replay: false,
    status: "success_manual_confirmed",
    transaction: updatedTransaction.rows[0] || transaction,
    order: orderResult.rows[0] || null,
    message: "Payment completed successfully.",
  };
  console.log("[paymob-pos-confirm]", {
    transaction_id: result.transaction?.id || transaction.id,
    order_id: result.order?.id || transaction.order_id,
    status: result.status,
    amount_cents: confirmedCents,
    source: "manual_terminal_approval",
    user_id: userId || null,
  });
  emitPaymobPaymentRealtime(result);
  return result;
};

const normalizeRole = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");

const isAdminLike = (user = {}) =>
  Boolean(user?.is_super_admin) ||
  ["admin", "super admin", "superadmin", "owner", "manager"].includes(normalizeRole(user.role_name || user.role));

const resolveTenantId = (req) =>
  getTenantId(req, req.body?.tenant_id || req.body?.tenantId || req.query?.tenant_id || req.query?.tenantId || req.user?.tenant_id || req.user?.tenantId);

const unavailablePaymentAccountStatus = ({ paymentMethod, branchId, amount, direction, reason }) => ({
  unavailable: true,
  reason,
  payment_method: paymentMethod || null,
  branch_id: branchId || null,
  amount: Number(amount || 0),
  direction: direction || "in",
  requires_balance: false,
  account: null,
  sufficient: null,
});

export const ensurePosUserShiftSchema = async (clientOrPool = db) => {
  await ensureAccountingSchema();
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS seller_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cashier_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS seller_name VARCHAR(255)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cashier_name VARCHAR(255)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS returns ADD COLUMN IF NOT EXISTS shift_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS returns ADD COLUMN IF NOT EXISTS cashier_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_shift_id ON orders (shift_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_seller_user_id ON orders (seller_user_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_cashier_user_id ON orders (cashier_user_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_pos_shifts_user_branch_status ON cash_drawer_shifts (opened_by_user_id, branch_id, status)`);
};

const getSingleTenantBranch = async (client, tenantId) => {
  const result = await client.query(
    `
    SELECT id, name
    FROM branches
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
    ORDER BY id ASC
    LIMIT 2
    `,
    [tenantId]
  );
  return result.rowCount === 1 ? result.rows[0] : null;
};

const getUserEmployeeBranch = async (client, { tenantId, user }) => {
  const result = await client.query(
    `
    SELECT e.branch_id, b.name AS branch_name
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      AND e.status = 'active'
      AND (
        e.user_id = $2::bigint
        OR (LOWER(COALESCE(e.email, '')) = LOWER($3) AND $3 <> '')
      )
    ORDER BY e.updated_at DESC, e.id DESC
    LIMIT 1
    `,
    [tenantId, user?.id || null, user?.email || ""]
  ).catch(async () => {
    const fallback = await client.query(
      `
      SELECT e.branch_id, b.name AS branch_name
      FROM employees e
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
        AND e.status = 'active'
        AND LOWER(COALESCE(e.email, '')) = LOWER($2)
      ORDER BY e.updated_at DESC, e.id DESC
      LIMIT 1
      `,
      [tenantId, user?.email || ""]
    );
    return fallback;
  });
  return result.rows[0] || null;
};

export const resolvePosBranch = async (client, req) => {
  const tenantId = resolveTenantId(req);
  const requestedBranchId = numberOrNull(req.body?.branch_id || req.body?.branchId || req.query?.branch_id || req.query?.branchId || req.headers?.["x-branch-id"]);
  if (requestedBranchId) {
    const branch = await client.query(
      `
      SELECT id, name
      FROM branches
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [requestedBranchId, tenantId]
    );
    if (!branch.rowCount) {
      const error = new Error("Invalid branch for this user");
      error.status = 400;
      throw error;
    }
    return branch.rows[0];
  }

  const userBranchId = numberOrNull(req.user?.branch_id || req.user?.branchId || req.user?.default_branch_id);
  if (userBranchId) return { id: userBranchId, name: req.user?.branch_name || "" };

  const employeeBranch = await getUserEmployeeBranch(client, { tenantId, user: req.user });
  if (employeeBranch?.branch_id) return { id: employeeBranch.branch_id, name: employeeBranch.branch_name || "" };

  const defaultBranchId = numberOrNull(
    await getSetting("pos.default_branch_id", "") ||
    await getSetting("general.default_branch_id", "")
  );
  if (defaultBranchId) {
    const branch = await client.query(
      `
      SELECT id, name
      FROM branches
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      LIMIT 1
      `,
      [defaultBranchId, tenantId]
    );
    if (branch.rows[0]) return branch.rows[0];
  }

  const singleBranch = await getSingleTenantBranch(client, tenantId);
  if (singleBranch?.id) return singleBranch;

  const error = new Error("branch_id is required to use POS shifts");
  error.status = 400;
  throw error;
};

const userHasPermission = async (client, userId, aliases = []) => {
  const result = await client.query(
    `
    SELECT p.module, p.action, r.name AS role_name, u.role AS user_role, u.is_super_admin
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE u.id = $1
    `,
    [userId]
  );
  const first = result.rows[0] || {};
  if (first.is_super_admin || isAdminLike({ role: first.role_name || first.user_role })) return true;
  return result.rows.some((row) => aliases.includes(`${row.module}:${row.action}`) || aliases.includes(`${row.module}.${row.action}`));
};

export const canOverridePosSeller = (client, userId) =>
  userHasPermission(client, userId, ["pos:override_seller", "pos.override_seller", "orders:edit", "orders.edit"]);

const listPosSellerCandidates = async ({ tenantId = null, branchId = null } = {}) => {
  const result = await db.query(
    `
    SELECT
      e.id,
      e.tenant_id,
      e.branch_id,
      b.name AS branch_name,
      e.user_id,
      e.full_name AS name,
      e.full_name,
      e.employee_code AS code,
      e.employee_code,
      e.phone,
      e.email,
      e.role,
      e.status AS employee_status,
      COALESCE(esp.pos_alias, '') AS pos_alias,
      esp.tenant_id AS profile_tenant_id,
      esp.employee_id IS NOT NULL AS profile_configured,
      esp.is_sales_active AS active_for_pos_raw,
      COALESCE(esp.is_sales_active, TRUE) AS active_for_pos,
      COALESCE(esp.is_sales_active, TRUE) AS is_sales_active,
      (e.status = 'active' AND e.is_deleted IS DISTINCT FROM TRUE) AS is_active,
      COALESCE(esp.commission_type, 'none') AS commission_type,
      COALESCE(esp.commission_type, 'none') AS commission_mode,
      COALESCE(esp.commission_value, 0) AS commission_value,
      esp.fixed_commission_mode,
      COALESCE(esp.excluded_product_ids, '[]'::jsonb) AS excluded_product_ids,
      COALESCE(esp.excluded_category_ids, '[]'::jsonb) AS excluded_category_ids,
      esp.updated_at,
      ($2::bigint IS NULL OR e.branch_id = $2::bigint) AS branch_matches,
      ($1::bigint IS NOT NULL AND e.tenant_id IS DISTINCT FROM $1::bigint) AS employee_tenant_mismatch,
      (esp.tenant_id IS NOT NULL AND $1::bigint IS NOT NULL AND esp.tenant_id IS DISTINCT FROM $1::bigint) AS profile_tenant_mismatch
    FROM employees e
    LEFT JOIN LATERAL (
      SELECT profile.*
      FROM employee_sales_profiles profile
      WHERE profile.employee_id = e.id
        AND ($1::bigint IS NULL OR profile.tenant_id = $1::bigint OR profile.tenant_id IS NULL)
      ORDER BY
        CASE WHEN $1::bigint IS NULL OR profile.tenant_id = $1::bigint THEN 0 ELSE 1 END,
        profile.updated_at DESC NULLS LAST,
        profile.employee_id DESC
      LIMIT 1
    ) esp ON TRUE
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      AND e.is_deleted IS DISTINCT FROM TRUE
      AND e.status = 'active'
      AND ($2::bigint IS NULL OR e.branch_id = $2::bigint)
    ORDER BY COALESCE(esp.is_sales_active, TRUE) DESC, e.full_name ASC, e.id ASC
    `,
    [tenantId, branchId]
  );
  return result.rows.map((row) => ({
    ...row,
    profile_configured: row.profile_configured === true,
    active_for_pos: row.active_for_pos === true,
    is_sales_active: row.is_sales_active === true,
    is_active: row.is_active !== false,
    branch_matches: row.branch_matches !== false,
    profile_tenant_mismatch: row.profile_tenant_mismatch === true,
    employee_tenant_mismatch: row.employee_tenant_mismatch === true,
  }));
};

export const getActivePosShift = async (req, res) => {
  try {
    await ensurePosUserShiftSchema(db);
    const tenantId = resolveTenantId(req);
    const branch = await resolvePosBranch(db, req);
    const shift = await getCurrentCashDrawerShift(db, {
      tenantId,
      userId: req.user?.id,
      branchId: branch.id,
    });
    const events = shift ? await getCashDrawerShiftEvents(db, { tenantId, shiftId: shift.id }) : [];
    return res.status(200).json({ success: true, shift, events, branch, user: { id: req.user?.id, name: req.user?.name || req.user?.email || "" } });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to fetch active POS shift" });
  }
};

export const buildPosShiftReport = async (client, { tenantId, shiftId }) => {
  await ensurePosUserShiftSchema(client);
  const shiftResult = await client.query(
    `
    SELECT
      s.*,
      COALESCE(NULLIF(opener.name, ''), NULLIF(opener.email, ''), 'User #' || s.opened_by) AS cashier_name,
      COALESCE(NULLIF(closer.name, ''), NULLIF(closer.email, ''), '') AS closed_by_name,
      b.name AS branch_name
    FROM cash_drawer_shifts s
    LEFT JOIN users opener ON opener.id = s.opened_by
    LEFT JOIN users closer ON closer.id = s.closed_by
    LEFT JOIN branches b ON b.id = s.branch_id
    WHERE s.id = $1
      AND ($2::bigint IS NULL OR s.tenant_id = $2::bigint)
    LIMIT 1
    `,
    [shiftId, tenantId]
  );
  const shift = shiftResult.rows[0] || null;
  if (!shift) {
    const error = new Error("POS shift not found");
    error.status = 404;
    throw error;
  }

  const salesResult = await client.query(
      `
      SELECT
        COUNT(*)::int AS invoice_count,
        COALESCE(SUM(total), 0)::numeric AS total_sales,
        COALESCE(SUM(discount_amount), 0)::numeric AS discounts,
        COALESCE(SUM(coupon_discount_amount), 0)::numeric AS coupon_discounts,
        COALESCE(SUM(cash_amount), 0)::numeric AS cash,
        COALESCE(SUM(card_amount), 0)::numeric AS card,
        COALESCE(SUM(wallet_payment_amount), 0)::numeric AS wallet
      FROM orders
      WHERE shift_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'void')
      `,
      [shiftId, tenantId]
    );
  const paymentResult = await client.query(
      `
      SELECT COALESCE(NULLIF(payment_method, ''), 'unknown') AS payment_method,
             COUNT(*)::int AS count,
             COALESCE(SUM(total), 0)::numeric AS total
      FROM orders
      WHERE shift_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'void')
      GROUP BY COALESCE(NULLIF(payment_method, ''), 'unknown')
      ORDER BY total DESC
      `,
      [shiftId, tenantId]
    );
  const topProductsResult = await client.query(
      `
      SELECT
        COALESCE(NULLIF(oi.product_name, ''), p.name, 'Item') AS product_name,
        COALESCE(SUM(oi.quantity), 0)::numeric AS quantity,
        COALESCE(SUM(oi.total_amount), 0)::numeric AS total
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.shift_id = $1
        AND ($2::bigint IS NULL OR o.tenant_id = $2::bigint)
        AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')
      GROUP BY COALESCE(NULLIF(oi.product_name, ''), p.name, 'Item')
      ORDER BY quantity DESC, total DESC
      LIMIT 10
      `,
      [shiftId, tenantId]
    );
  const returnsResult = await client.query(
      `
      SELECT COUNT(*)::int AS return_count,
             COALESCE(SUM(refund_amount), 0)::numeric AS return_total,
             COALESCE(SUM(refund_amount) FILTER (WHERE LOWER(COALESCE(NULLIF(refund_method, ''), 'cash')) = 'cash'), 0)::numeric AS cash_return_total
      FROM returns
      WHERE shift_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      `,
      [shiftId, tenantId]
    ).catch(() => ({ rows: [{ return_count: 0, return_total: 0 }] }));
  await ensurePosExpenseSchema(client);
  const expensesResult = await client.query(
    `
    WITH scoped AS (
      SELECT
        amount,
        payment_method,
        (
          LOWER(COALESCE(expense_type, '')) IN ('employee_advance', 'employee advance', 'advance', 'staff advance')
          OR LOWER(COALESCE(category, '')) IN ('employee_advance', 'employee advance', 'advance', 'staff advance')
        ) AS is_employee_advance
      FROM expenses
      WHERE source = 'pos'
        AND shift_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND LOWER(COALESCE(status, '')) NOT IN ('rejected', 'cancelled', 'canceled', 'void')
    )
    SELECT
      COUNT(*) FILTER (WHERE NOT is_employee_advance)::int AS expense_count,
      COALESCE(SUM(amount) FILTER (WHERE NOT is_employee_advance), 0)::numeric AS pos_expenses,
      COALESCE(SUM(amount) FILTER (WHERE NOT is_employee_advance AND LOWER(COALESCE(payment_method, 'cash')) = 'cash'), 0)::numeric AS pos_expenses_cash,
      COUNT(*) FILTER (WHERE is_employee_advance)::int AS employee_advance_count,
      COALESCE(SUM(amount) FILTER (WHERE is_employee_advance), 0)::numeric AS employee_advances,
      COALESCE(SUM(amount) FILTER (WHERE is_employee_advance AND LOWER(COALESCE(payment_method, 'cash')) = 'cash'), 0)::numeric AS employee_advances_cash
    FROM scoped
    `,
    [shiftId, tenantId]
  ).catch(() => ({ rows: [{ expense_count: 0, pos_expenses: 0, pos_expenses_cash: 0, employee_advance_count: 0, employee_advances: 0, employee_advances_cash: 0 }] }));
  const events = await getCashDrawerShiftEvents(client, { tenantId, shiftId });

  const saleTimeline = await client.query(
    `
    SELECT id, invoice_number, total, discount_amount, coupon_discount_amount, payment_method, created_at,
           COALESCE(NULLIF(cashier_name, ''), NULLIF(seller_name, ''), 'POS') AS actor_name
    FROM orders
    WHERE shift_id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    ORDER BY created_at ASC, id ASC
    `,
    [shiftId, tenantId]
  );
  const returnTimeline = await client.query(
    `
    SELECT id, return_number, refund_amount, created_at
    FROM returns
    WHERE shift_id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    ORDER BY created_at ASC, id ASC
    `,
    [shiftId, tenantId]
  ).catch(() => ({ rows: [] }));
  const expenseTimeline = await client.query(
    `
    SELECT
      ex.id,
      ex.title,
      ex.amount,
      ex.payment_method,
      ex.category,
      ex.expense_type,
      ex.employee_id,
      ex.created_at,
      COALESCE(NULLIF(emp.full_name, ''), NULLIF(emp.employee_code, '')) AS employee_name
    FROM expenses ex
    LEFT JOIN employees emp ON emp.id = ex.employee_id
    WHERE ex.source = 'pos'
      AND ex.shift_id = $1
      AND ($2::bigint IS NULL OR ex.tenant_id = $2::bigint)
      AND LOWER(COALESCE(ex.status, '')) NOT IN ('rejected', 'cancelled', 'canceled', 'void')
    ORDER BY ex.created_at ASC, ex.id ASC
    `,
    [shiftId, tenantId]
  ).catch(() => ({ rows: [] }));

  const drawerTimeline = events.map((event) => ({
    type: event.event_type === "opening" ? "shift_opened" : event.event_type === "closing" ? "shift_closed" : event.event_type,
    label: event.event_type,
    amount: event.amount,
    at: event.created_at,
    actor: event.created_by_name,
    source_type: event.source_type,
    source_id: event.source_id,
  }));
  const salesTimeline = saleTimeline.rows.flatMap((order) => {
    const discount = money(Number(order.discount_amount || 0) + Number(order.coupon_discount_amount || 0));
    return [
      {
        type: "sale",
        label: order.invoice_number || `Order #${order.id}`,
        amount: money(order.total),
        at: order.created_at,
        actor: order.actor_name,
        source_type: "order",
        source_id: order.id,
        payment_method: order.payment_method || "",
      },
      ...(discount > 0
        ? [{
            type: "discount",
            label: order.invoice_number || `Order #${order.id}`,
            amount: discount,
            at: order.created_at,
            actor: order.actor_name,
            source_type: "order",
            source_id: order.id,
          }]
        : []),
    ];
  });
  const returnsTimeline = returnTimeline.rows.map((row) => ({
    type: "return",
    label: row.return_number || `Return #${row.id}`,
    amount: money(row.refund_amount),
    at: row.created_at,
    actor: shift.cashier_name || "",
    source_type: "return",
    source_id: row.id,
  }));
  const expensesTimeline = expenseTimeline.rows.map((row) => ({
    type: row.expense_type === "employee_advance" || row.category === "employee_advance" ? "employee_advance" : "pos_expense",
    label: row.expense_type === "employee_advance" || row.category === "employee_advance"
      ? row.employee_name || row.title || `Employee advance #${row.id}`
      : row.title || row.category || `Expense #${row.id}`,
    amount: money(row.amount),
    at: row.created_at,
    actor: shift.cashier_name || "",
    source_type: row.expense_type === "employee_advance" || row.category === "employee_advance" ? "employee_advance" : "expense",
    source_id: row.id,
    payment_method: row.payment_method || "",
    employee_id: row.employee_id || null,
    employee_name: row.employee_name || "",
  }));
  const auditTimeline = [...drawerTimeline, ...salesTimeline, ...returnsTimeline, ...expensesTimeline]
    .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());

  const sales = salesResult.rows[0] || {};
  const returns = returnsResult.rows[0] || {};
  const posExpenses = expensesResult.rows[0] || {};
  const cashReturnTableTotal = money(returns.cash_return_total);
  const cashRefundEventTotal = money(
    events.reduce((sum, event) => sum + (String(event.event_type || "").toLowerCase() === "refund_cash" ? Number(event.amount || 0) : 0), 0)
  );
  const editCashInEventTotal = money(
    events.reduce((sum, event) => {
      const isEditCashIn =
        String(event.event_type || "").toLowerCase() === "cash_in" &&
        String(event.source_type || "").toLowerCase() === "order_edit";
      return sum + (isEditCashIn ? Number(event.amount || 0) : 0);
    }, 0)
  );
  const cashReturnTotal = money(Math.max(cashReturnTableTotal, cashRefundEventTotal));
  const cashOutEventTotal = money(
    events.reduce((sum, event) => sum + (String(event.event_type || "").toLowerCase() === "cash_out" ? Number(event.amount || 0) : 0), 0)
  );
  const cashInEventTotal = money(
    events.reduce((sum, event) => sum + (String(event.event_type || "").toLowerCase() === "cash_in" ? Number(event.amount || 0) : 0), 0)
  );
  const netCashExpected = money(
    Number(shift.opening_cash || 0) +
    Number(sales.cash || 0) +
    cashInEventTotal -
    Number(posExpenses.pos_expenses_cash || 0) -
    Number(posExpenses.employee_advances_cash || 0) -
    cashReturnTotal -
    cashOutEventTotal
  );
  return {
    shift: {
      id: Number(shift.id),
      status: shift.status,
      opened_by_user_id: shift.opened_by_user_id || shift.opened_by || null,
      cashier_name: shift.cashier_name || "",
      branch_name: shift.branch_name || "",
      branch_id: shift.branch_id || null,
      opened_at: shift.opened_at,
      closed_at: shift.closed_at,
      opening_cash: money(shift.opening_cash),
      expected_cash: money(shift.expected_cash),
      closing_cash: shift.closing_cash === null || shift.closing_cash === undefined ? null : money(shift.closing_cash),
      actual_cash: shift.actual_cash === null || shift.actual_cash === undefined ? null : money(shift.actual_cash),
      cash_difference: money(shift.cash_difference ?? shift.difference),
    },
    totals: {
      total_sales: money(sales.total_sales),
      invoice_count: Number(sales.invoice_count || 0),
      discounts: money(Number(sales.discounts || 0) + Number(sales.coupon_discounts || 0)),
      returns: money(returns.return_total),
      cash_returns: cashReturnTotal,
      cash_return_table_total: cashReturnTableTotal,
      cash_refund_events: cashRefundEventTotal,
      edit_cash_in_events: editCashInEventTotal,
      return_count: Number(returns.return_count || 0),
      cash: money(Number(sales.cash || 0) + editCashInEventTotal),
      card: money(sales.card),
      wallet: money(sales.wallet),
      pos_expenses: money(posExpenses.pos_expenses),
      pos_expenses_cash: money(posExpenses.pos_expenses_cash),
      pos_expense_count: Number(posExpenses.expense_count || 0),
      employee_advances: money(posExpenses.employee_advances),
      employee_advances_cash: money(posExpenses.employee_advances_cash),
      employee_advance_count: Number(posExpenses.employee_advance_count || 0),
      total_cash_out: money(Number(posExpenses.pos_expenses_cash || 0) + Number(posExpenses.employee_advances_cash || 0) + cashReturnTotal + cashOutEventTotal),
      cash_in_events: cashInEventTotal,
      cash_out_events: cashOutEventTotal,
      net_cash_expected: netCashExpected,
      expected_cash: netCashExpected,
      opening_cash: money(shift.opening_cash),
      closing_cash: shift.closing_cash === null || shift.closing_cash === undefined ? null : money(shift.closing_cash),
      cash_difference: money(shift.cash_difference ?? shift.difference),
    },
    payment_breakdown: paymentResult.rows.map((row) => ({
      payment_method: row.payment_method,
      count: Number(row.count || 0),
      total: money(row.total),
    })),
    top_products: topProductsResult.rows.map((row) => ({
      product_name: row.product_name,
      quantity: Number(row.quantity || 0),
      total: money(row.total),
    })),
    audit_timeline: auditTimeline,
  };
};

export const getPosPaymentAccountStatus = async (req, res) => {
  const paymentMethod = req.query.payment_method || req.query.paymentMethod;
  const branchId = req.query.branch_id || req.query.branchId || req.user?.branch_id || null;
  const requestedDirection = req.query.direction || req.query.transaction_direction || req.query.transactionDirection;
  const purpose = String(req.query.purpose || req.query.transaction_type || req.query.transactionType || "").toLowerCase();
  const direction = requestedDirection || (purpose.includes("refund") || purpose.includes("return") ? "out" : "in");
  const amount = req.query.amount || 0;

  try {
    const tenantId = resolveTenantId(req);

    if (!tenantId) {
      console.error("[pos:payment-account-status] missing tenant context", {
        userId: req.user?.id || null,
        branchId,
        paymentMethod,
      });
      return res.status(200).json({
        success: true,
        status: unavailablePaymentAccountStatus({
          paymentMethod,
          branchId,
          amount,
          direction,
          reason: "tenant_context_missing",
        }),
      });
    }

    const status = await getPaymentAccountStatus(db, {
      tenantId,
      paymentMethod,
      branchId,
      amount,
      direction,
    });
    return res.status(200).json({ success: true, status });
  } catch (error) {
    console.error("[pos:payment-account-status] unavailable", {
      userId: req.user?.id || null,
      branchId,
      paymentMethod,
      error: error?.message || error,
    });
    return res.status(200).json({
      success: true,
      status: unavailablePaymentAccountStatus({
        paymentMethod,
        branchId,
        amount,
        direction,
        reason: error?.message || "payment_account_status_unavailable",
      }),
    });
  }
};

export const getPosShiftReport = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const shiftId = numberOrNull(req.params.id);
    const report = await buildPosShiftReport(db, { tenantId, shiftId });
    const ownsShift = String(report.shift?.opened_by_user_id || "") === String(req.user?.id || "");
    const canManage = ownsShift || await userHasPermission(db, req.user?.id, ["pos:manage_shifts", "pos.manage_shifts", "accounting:view", "accounting.view"]);
    if (!canManage) return res.status(403).json({ success: false, message: "You cannot view another user's POS shift report" });
    return res.status(200).json({ success: true, report });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to build POS shift report" });
  }
};

export const openPosShift = async (req, res) => {
  const client = await db.connect();
  try {
    await ensurePosUserShiftSchema(client);
    const tenantId = resolveTenantId(req);
    const branch = await resolvePosBranch(client, req);
    await client.query("BEGIN");
    const shift = await openCashDrawerShift(client, {
      tenantId,
      branchId: branch.id,
      openingCash: req.body?.opening_cash ?? req.body?.openingCash ?? 0,
      notes: req.body?.notes || "POS shift",
      openedBy: req.user?.id || null,
    });
    const events = await getCashDrawerShiftEvents(client, { tenantId, shiftId: shift.id });
    await client.query("COMMIT");
    return res.status(201).json({ success: true, shift, events, branch });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to open POS shift" });
  } finally {
    client.release();
  }
};

export const closePosShift = async (req, res) => {
  const client = await db.connect();
  try {
    await ensurePosUserShiftSchema(client);
    const tenantId = resolveTenantId(req);
    const shiftId = numberOrNull(req.params.id);
    const current = await client.query(
      `
      SELECT *
      FROM cash_drawer_shifts
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND status = 'open'
      LIMIT 1
      `,
      [shiftId, tenantId]
    );
    const shiftRow = current.rows[0];
    if (!shiftRow) return res.status(404).json({ success: false, message: "Open POS shift not found" });
    const ownsShift = String(shiftRow.opened_by) === String(req.user?.id);
    if (!ownsShift) return res.status(403).json({ success: false, message: "You cannot close another user's POS shift" });

    await client.query("BEGIN");
    const shift = await closeCashDrawerShift(client, {
      tenantId,
      shiftId,
      actualCash: req.body?.closing_cash ?? req.body?.closingCash ?? req.body?.actual_cash ?? req.body?.actualCash ?? 0,
      notes: req.body?.notes || "",
      closedBy: req.user?.id || null,
    });
    const events = await getCashDrawerShiftEvents(client, { tenantId, shiftId: shift.id });
    const report = await buildPosShiftReport(client, { tenantId, shiftId: shift.id });
    await client.query("COMMIT");
    return res.status(200).json({ success: true, shift, events, report });
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to close POS shift" });
  } finally {
    client.release();
  }
};

export const createQuickPosExpense = async (req, res) => {
  const client = await db.connect();
  try {
    await ensurePosUserShiftSchema(client);
    await ensurePosExpenseSchema(client);
    const tenantId = resolveTenantId(req);
    const shiftId = numberOrNull(req.body?.shift_id || req.body?.shiftId);
    const amount = money(req.body?.amount);
    const paymentMethod = clean(req.body?.payment_method || req.body?.paymentMethod || "cash").toLowerCase();
    const expenseType = normalizeQuickExpenseType(req.body?.expense_type || req.body?.expenseType || req.body?.category);
    const isEmployeeAdvance = expenseType === "employee_advance";
    const category = isEmployeeAdvance ? "employee_advance" : clean(req.body?.category || req.body?.expense_type || req.body?.expenseType || "other") || expenseType;
    const employeeId = numberOrNull(req.body?.employee_id || req.body?.employeeId);
    const notes = clean(req.body?.notes || req.body?.note);

    if (!shiftId) return res.status(400).json({ success: false, message: "Open POS shift is required" });
    if (amount <= 0) return res.status(400).json({ success: false, message: "Expense amount must be greater than zero" });
    if (!quickExpensePayments.has(paymentMethod)) return res.status(400).json({ success: false, message: "Payment method must be cash, card, or wallet" });
    if (isEmployeeAdvance && !employeeId) return res.status(400).json({ success: false, message: "Employee is required for employee advance" });
    const rawExpenseType = isEmployeeAdvance ? "" : clean(req.body?.expense_type || req.body?.expenseType || req.body?.category).toLowerCase();
    if (rawExpenseType.includes("advance") || rawExpenseType.includes("سلفة")) {
      return res.status(400).json({ success: false, message: "Employee advances cannot be created from POS" });
    }

    await client.query("BEGIN");
    const shiftResult = await client.query(
      `
      SELECT *
      FROM cash_drawer_shifts
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND status = 'open'
      LIMIT 1
      FOR UPDATE
      `,
      [shiftId, tenantId]
    );
    const shift = shiftResult.rows[0];
    if (!shift) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Open POS shift not found" });
    }
    if (String(shift.opened_by) !== String(req.user?.id || "")) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, message: "You cannot create expenses for another cashier's shift" });
    }

    let employee = null;
    if (isEmployeeAdvance) {
      const employeeResult = await client.query(
        `
        SELECT id, full_name, employee_code, branch_id
        FROM employees
        WHERE id = $1
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
          AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'terminated', 'deleted')
          AND ($3::bigint IS NULL OR branch_id IS NULL OR branch_id = $3::bigint)
        LIMIT 1
        `,
        [employeeId, tenantId, shift.branch_id || null]
      );
      employee = employeeResult.rows[0] || null;
      if (!employee) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: "Selected employee is not available for this shift branch" });
      }
    }

    const employeeName = employee?.full_name || employee?.employee_code || "";
    const title = clean(req.body?.title) || (isEmployeeAdvance ? `POS employee advance${employeeName ? ` - ${employeeName}` : ""}` : `POS expense - ${category}`);
    const expenseResult = await client.query(
      `
      INSERT INTO expenses (
        tenant_id, title, amount, expense_type, category, payment_method,
        branch_id, employee_id, expense_date, notes, status, paid_at, paid_by,
        source, shift_id, created_by, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE,$9,'paid',NOW(),$10,'pos',$11,$10,NOW(),NOW())
      RETURNING *
      `,
      [
        tenantId,
        title,
        amount,
        expenseType,
        category,
        paymentMethod,
        shift.branch_id,
        isEmployeeAdvance ? employeeId : null,
        notes,
        req.user?.id || null,
        shift.id,
      ]
    );
    const expense = expenseResult.rows[0];
    let advance = null;

    if (isEmployeeAdvance) {
      const advanceResult = await client.query(
        `
        INSERT INTO employee_advances (
          tenant_id, employee_id, amount, deducted_amount, remaining_amount,
          deduction_month, deduction_status, status, notes, expense_id,
          created_by, created_at, updated_at
        )
        VALUES ($1,$2,$3,0,$3,to_char(CURRENT_DATE, 'YYYY-MM'),'pending','active',$4,$5,$6,NOW(),NOW())
        RETURNING *
        `,
        [tenantId, employeeId, amount, notes, expense.id, req.user?.id || null]
      );
      advance = advanceResult.rows[0] || null;
    }

    if (paymentMethod === "cash") {
      await recordCashDrawerEvent(client, {
        tenantId,
        branchId: shift.branch_id,
        shiftId: shift.id,
        createdBy: req.user?.id || null,
        eventType: "expense_cash",
        sourceType: isEmployeeAdvance ? "employee_advance" : "expense",
        sourceId: expense.id,
        amount,
        requireOpenShift: true,
      });
    }

    const report = await buildPosShiftReport(client, { tenantId, shiftId: shift.id });
    await client.query("COMMIT");
    console.log("[pos-expense] created", {
      expense_id: expense.id,
      shift_id: shift.id,
      branch_id: shift.branch_id,
      created_by: req.user?.id || null,
      payment_method: paymentMethod,
      amount,
      employee_id: isEmployeeAdvance ? employeeId : null,
      advance_id: advance?.id || null,
    });
    return res.status(201).json({ success: true, expense, advance, report });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    console.error("[pos-expense] create failed", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create POS expense" });
  } finally {
    client.release();
  }
};

export const getPosSellerUsers = async (req, res) => {
  try {
    await ensurePosUserShiftSchema(db);
    await ensureSalesCommissionSchema(db);
    const tenantId = resolveTenantId(req);
    const selectedBranchId = numberOrNull(req.query?.branch_id || req.query?.branchId || req.body?.branch_id || req.body?.branchId || req.headers?.["x-branch-id"]);
    const activeShift = await getCurrentCashDrawerShift(db, {
      tenantId,
      userId: req.user?.id,
    }).catch(() => null);
    const branch = activeShift?.branch_id
      ? { id: activeShift.branch_id, name: activeShift.branch_name || "" }
      : await resolvePosBranch(db, req);
    const branchSource = activeShift?.branch_id ? "active_shift" : "selected_branch";
    const [employees, settings] = await Promise.all([
      listPosSellerCandidates({ tenantId, branchId: branch.id }),
      getSalesSettings(db, tenantId),
    ]);
    const excludedReasons = {};
    const addExcludedReason = (reason) => {
      excludedReasons[reason] = Number(excludedReasons[reason] || 0) + 1;
    };
    employees.forEach((employee) => {
      if (employee.branch_matches === false) addExcludedReason("branch_mismatch");
      if (employee.is_active === false) addExcludedReason("employee_inactive");
      if (employee.active_for_pos_raw === false) addExcludedReason("profile_explicitly_inactive_for_pos");
      if (employee.profile_tenant_mismatch) addExcludedReason("profile_tenant_mismatch");
      if (employee.employee_tenant_mismatch) addExcludedReason("employee_tenant_mismatch");
    });
    const profilesCount = employees.filter((employee) => employee.profile_configured).length;
    const sellers = employees
      .filter((employee) => employee.is_active !== false && employee.branch_matches !== false && employee.active_for_pos !== false)
      .map((employee) => ({
        ...employee,
        id: employee.id,
        employee_id: employee.id,
        name: employee.name || employee.full_name || employee.email || `Employee #${employee.id}`,
        full_name: employee.full_name || employee.name || "",
        employee_code: employee.employee_code || employee.code || "",
        pos_alias: employee.pos_alias || employee.name || employee.full_name || `Employee #${employee.id}`,
        active_for_pos: true,
        is_sales_active: true,
        is_active: true,
        commission_mode: employee.commission_mode || employee.commission_type || "none",
        commission_type: employee.commission_type || employee.commission_mode || "none",
        commission_value: Number(employee.commission_value || 0),
      }));

    const sellerDebugPayload = {
      tenant_id: tenantId,
      user_id: req.user?.id || null,
      selected_branch_id: selectedBranchId || null,
      open_shift_id: activeShift?.id || null,
      used_branch_id: branch.id,
      branch_source: branchSource,
      employees_count: employees.length,
      profiles_count: profilesCount,
      returned_sellers_count: sellers.length,
      excluded_reasons: excludedReasons,
      allow_sale_without_salesperson: settings?.allow_sale_without_salesperson !== false,
      sellers: sellers.map((employee) => ({
          employee_id: employee.employee_id || employee.id,
          name: employee.name || "",
          pos_alias: employee.pos_alias || "",
          active_for_pos: employee.active_for_pos === true,
          branch_id: employee.branch_id || null,
          employee_tenant_id: employee.tenant_id || null,
          profile_tenant_id: employee.profile_tenant_id || null,
        })),
      branch_employees: employees.map((employee) => ({
        employee_id: employee.id,
        name: employee.name || employee.full_name || "",
        pos_alias: employee.pos_alias || "",
        active_for_pos: employee.active_for_pos === true,
        active_for_pos_raw: employee.active_for_pos_raw,
        profile_configured: employee.profile_configured,
        is_active: employee.is_active !== false,
        branch_id: employee.branch_id || null,
        employee_tenant_id: employee.tenant_id || null,
        profile_tenant_id: employee.profile_tenant_id || null,
      })),
    };
    console.log("[pos-sellers-load-final]", sellerDebugPayload);
    const maged = employees.find((employee) => String(employee.name || employee.full_name || "").toLowerCase().includes("maged abuzied"));
    if (maged) {
      console.log("[pos-sellers-load:maged-abuzied]", {
        employee_id: maged.id,
        name: maged.name || maged.full_name || "",
        branch_id: maged.branch_id || null,
        branch_id_used: branch.id,
        branch_matches: String(maged.branch_id || "") === String(branch.id || ""),
        profile_configured: maged.profile_configured === true,
        active_for_pos_raw: maged.active_for_pos_raw,
        active_for_pos: maged.active_for_pos === true,
        is_active: maged.is_active !== false,
        tenant_id: maged.tenant_id || null,
        profile_tenant_id: maged.profile_tenant_id || null,
        included: sellers.some((seller) => String(seller.employee_id || seller.id) === String(maged.id)),
      });
    } else {
      console.log("[pos-sellers-load:maged-abuzied]", {
        branch_id_used: branch.id,
        found_in_branch_employee_rows: false,
      });
    }

    return res.status(200).json({
      success: true,
      users: sellers,
      employees: sellers,
      branch,
      settings,
      can_override_seller: await canOverridePosSeller(db, req.user?.id),
      ...(process.env.NODE_ENV !== "production"
        ? {
            debug: {
              usedBranchId: branch.id,
              branchSource,
              activeShiftBranchId: activeShift?.branch_id || null,
              selectedBranchId: selectedBranchId || null,
              allBranchEmployeesCount: employees.length,
              profilesCount,
              includedSellersCount: sellers.length,
              excludedReasons,
            },
          }
        : {}),
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load POS sellers" });
  }
};

const centsFromAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 100);
};

export const sendPaymobTerminalPayment = async (req, res) => {
  const client = await db.connect();
  let transactionId = null;
  try {
    await ensurePosUserShiftSchema(client);
    await ensurePaymentTransactionsSchema(client);
    const tenantId = resolveTenantId(req);
    const orderId = numberOrNull(req.body?.order_id || req.body?.orderId);
    if (!orderId) return res.status(400).json({ success: false, message: "order_id is required" });

    const orderResult = await client.query(
      `
      SELECT id, tenant_id, branch_id, shift_id, invoice_number, total, total_amount, status, payment_status
      FROM orders
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [orderId, tenantId]
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ success: false, message: "POS order not found" });

    const branchId = numberOrNull(order.branch_id || req.body?.branch_id || req.body?.branchId);
    if (!branchId) return res.status(400).json({ success: false, message: "Order branch is required for Paymob terminal payment" });

    const shift = await getCurrentCashDrawerShift(client, {
      tenantId,
      userId: req.user?.id,
      branchId,
    });
    if (!shift) return res.status(409).json({ success: false, message: "An active POS shift is required before sending Paymob terminal payment" });

    if (String(shift.branch_id || "") !== String(branchId || "")) {
      return res.status(409).json({ success: false, message: "Active POS shift branch does not match this order" });
    }

    const requestedAmount = req.body?.amount ?? order.total ?? order.total_amount;
    const amountCents = centsFromAmount(requestedAmount);
    if (!amountCents) return res.status(400).json({ success: false, message: "amount must be greater than zero" });

    const currency = String(req.body?.currency || await getSetting("general.default_currency", "EGP")).trim().toUpperCase();
    const terminalId = req.body?.terminal_id || req.body?.terminalId || undefined;
    const preferredPaymentMethod = req.body?.preferred_payment_method || req.body?.preferredPaymentMethod || undefined;
    console.log("[paymob-pos-send]", {
      stage: "received",
      tenant_id: tenantId,
      order_id: orderId,
      invoice_number: order.invoice_number || "",
      amount_cents: amountCents,
      currency,
      terminal_id: terminalId || process.env.PAYMOB_TERMINAL_ID || "",
    });
    const itemsResult = await client.query(
      `
      SELECT product_name, variant_name, sku, barcode, quantity, sale_price AS price, total_amount
      FROM order_items
      WHERE order_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY id ASC
      `,
      [orderId, tenantId]
    );

    await client.query("BEGIN");
    const transactionResult = await client.query(
      `
      INSERT INTO payment_transactions (
        tenant_id, branch_id, order_id, provider, terminal_id, amount_cents, currency, status,
        request_payload, created_by
      )
      VALUES ($1, $2, $3, 'paymob', $4, $5, $6, 'pending', $7::jsonb, $8)
      RETURNING *
      `,
      [
        tenantId,
        branchId,
        orderId,
        terminalId || process.env.PAYMOB_TERMINAL_ID || "",
        amountCents,
        currency,
        JSON.stringify({
          order_id: orderId,
          invoice_number: order.invoice_number || "",
          amount_cents: amountCents,
          currency,
          terminal_id: terminalId || process.env.PAYMOB_TERMINAL_ID || "",
          preferred_payment_method: preferredPaymentMethod || process.env.PAYMOB_PREFERRED_METHOD || "card",
        }),
        req.user?.id || null,
      ]
    );
    transactionId = transactionResult.rows[0]?.id || null;
    await client.query("COMMIT");

    try {
      const paymobResult = await createTerminalOrder({
        tenantId,
        branchId,
        localOrderId: orderId,
        amountCents,
        currency,
        items: itemsResult.rows,
        terminalId,
        preferredPaymentMethod,
      });
      const nextStatus = paymobResult.status === "success" ? "success" : "sent";
      const updated = await client.query(
        `
        UPDATE payment_transactions
        SET provider_order_id = $2::text,
            terminal_id = $3::text,
            status = $4::text,
            transaction_reference = COALESCE(NULLIF($5::text, ''), transaction_reference),
            request_payload = $6::jsonb,
            response_payload = $7::jsonb,
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
        `,
        [
          transactionId,
          paymobResult.providerOrderId ? String(paymobResult.providerOrderId) : null,
          paymobResult.terminalId || terminalId || process.env.PAYMOB_TERMINAL_ID || "",
          nextStatus,
          paymobResult.transactionReference || "",
          JSON.stringify(paymobResult.requestPayload || {}),
          JSON.stringify(paymobResult.responsePayload || {}),
        ]
      );
      console.log("[paymob-pos-send]", {
        stage: "sent",
        transaction_id: transactionId,
        order_id: orderId,
        provider_order_id: paymobResult.providerOrderId || null,
        transaction_reference: paymobResult.transactionReference || "",
        terminal_id: paymobResult.terminalId || terminalId || process.env.PAYMOB_TERMINAL_ID || "",
        status: nextStatus,
      });
      return res.status(200).json({
        success: true,
        status: nextStatus,
        message: nextStatus === "success"
          ? "Paymob reported a successful terminal order response."
          : "Payment request sent to Paymob terminal. Complete payment on the machine.",
        transaction: updated.rows[0],
        provider_order_id: paymobResult.providerOrderId,
        transaction_reference: paymobResult.transactionReference || "",
        terminal_id: paymobResult.terminalId,
        amount_cents: amountCents,
        currency,
      });
    } catch (paymobError) {
      const normalized = normalizePaymobError(paymobError);
      console.error("[paymob-pos-error]", {
        status: normalized.status,
        message: normalized.message,
        order_id: orderId,
        transaction_id: transactionId,
      });
      const updated = transactionId
        ? await client.query(
            `
            UPDATE payment_transactions
            SET status = 'failed',
                request_payload = COALESCE($2::jsonb, request_payload),
                response_payload = COALESCE($3::jsonb, response_payload),
                error_message = $4,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
            `,
            [
              transactionId,
              paymobError?.requestPayload ? JSON.stringify(paymobError.requestPayload) : null,
              normalized.payload ? JSON.stringify(normalized.payload) : null,
              normalized.message,
            ]
          )
        : { rows: [] };
      return res.status(normalized.status || 500).json({
        success: false,
        message: normalized.message,
        transaction: updated.rows[0] || null,
      });
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors when no transaction is open.
    }
    console.error("[paymob-pos-error]", { message: error?.message || "Paymob POS payment failed", transaction_id: transactionId });
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to send Paymob terminal payment" });
  } finally {
    client.release();
  }
};

export const receivePaymobWebhook = async (req, res) => {
  const client = await db.connect();
  try {
    console.log("[paymob-pos-webhook]", {
      received: true,
      query_keys: Object.keys(req.query || {}),
      body_keys: Object.keys(req.body || {}),
      has_hmac: Boolean(req.query?.hmac || req.body?.hmac || req.body?.obj?.hmac),
    });
    const signature = verifyPaymobHmac({ body: req.body || {}, query: req.query || {} });
    if (signature.checked && !signature.valid) {
      console.warn("[paymob-pos-webhook]", { received: true, signature: signature.reason, rejected: true });
      return res.status(401).json({ success: false, message: "Invalid Paymob webhook signature" });
    }

    const normalized = normalizePaymobPaymentPayload(req.body || {});
    console.log("[paymob-pos-webhook]", {
      provider_order_id: normalized.providerOrderId || "",
      transaction_reference: normalized.transactionReference || "",
      status: normalized.status,
      amount_cents: normalized.amountCents,
      signature: signature.reason,
    });
    await client.query("BEGIN");
    const result = await applyPaymobConfirmation(client, normalized);
    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      replay: result.replay,
      status: result.status,
      message: result.message,
      transaction: result.transaction,
      order: result.order,
      signature,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors when no transaction is open.
    }
    console.error("[paymob-webhook-error]", { message: error?.message, stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined });
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to process Paymob webhook" });
  } finally {
    client.release();
  }
};

export const getPaymobTerminalPaymentStatus = async (req, res) => {
  const client = await db.connect();
  try {
    await ensurePaymentTransactionsSchema(client);
    const tenantId = resolveTenantId(req);
    const transactionId = numberOrNull(req.params?.transactionId);
    if (!transactionId) return res.status(400).json({ success: false, message: "transactionId is required" });
    console.log("[paymob-pos-status-check]", {
      transaction_id: transactionId,
      tenant_id: tenantId,
      stage: "received",
    });

    const transactionResult = await client.query(
      `
      SELECT *
      FROM payment_transactions
      WHERE id = $1
        AND provider = 'paymob'
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [transactionId, tenantId]
    );
    const transaction = transactionResult.rows[0];
    if (!transaction) {
      console.warn("[paymob-pos-status-check]", {
        transaction_id: transactionId,
        tenant_id: tenantId,
        stage: "not_found",
      });
      return res.status(404).json({ success: false, message: "Paymob payment transaction not found" });
    }

    const localStatus = String(transaction.status || "pending").toLowerCase();
    console.log("[paymob-pos-status-check]", {
      transaction_id: transaction.id,
      order_id: transaction.order_id,
      provider_order_id: transaction.provider_order_id || "",
      transaction_reference: transaction.transaction_reference || "",
      local_status: localStatus,
      amount_cents: transaction.amount_cents,
    });

    if ([...terminalFinalStatuses, "failed", "cancelled"].includes(localStatus)) {
      const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [transaction.order_id]);
      return res.json({
        success: true,
        status: transaction.status,
        local_status: transaction.status,
        message: terminalFinalStatuses.has(localStatus) ? "Payment completed successfully." : `Paymob payment ${transaction.status}.`,
        transaction,
        order: orderResult.rows[0] || null,
      });
    }

    const merchantOrderId = transaction.request_payload?.merchant_order_id || transaction.response_payload?.merchant_order_id || "";
    let statusResult = null;
    try {
      statusResult = await getOrderStatus({
        providerOrderId: transaction.provider_order_id,
        merchantOrderId,
        transactionReference: transaction.transaction_reference,
      });
    } catch (lookupError) {
      const normalizedError = normalizePaymobError(lookupError);
      console.warn("[paymob-pos-no-confirmation]", {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        reason: "status_lookup_unavailable",
        status: normalizedError.status,
        message: normalizedError.message,
      });
      const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [transaction.order_id]);
      return res.json({
        success: true,
        status: "pending",
        local_status: transaction.status,
        confirmation_available: false,
        message: "Waiting for terminal payment confirmation. Paymob status lookup is unavailable or inconclusive.",
        transaction,
        order: orderResult.rows[0] || null,
        lookup_error: normalizedError.message,
      });
    }
    const normalized = {
      ...statusResult.normalized,
      invoiceOrOrderId: statusResult.normalized.invoiceOrOrderId || transaction.order_id,
      amountCents: statusResult.normalized.amountCents || Number(transaction.amount_cents || 0),
      providerOrderId: statusResult.normalized.providerOrderId || transaction.provider_order_id || "",
      terminalId: statusResult.normalized.terminalId || transaction.terminal_id || "",
      payload: statusResult.payload || {},
    };

    console.log("[paymob-pos-status-check]", {
      transaction_id: transaction.id,
      order_id: transaction.order_id,
      provider_status: normalized.status,
      provider_order_id: normalized.providerOrderId || "",
      transaction_reference: normalized.transactionReference || "",
      amount_cents: normalized.amountCents,
    });
    console.log("[paymob-pos-transaction-status]", {
      transaction_id: transaction.id,
      order_id: transaction.order_id,
      transaction_reference: normalized.transactionReference || transaction.transaction_reference || "",
      provider_status: normalized.status,
      success: normalized.success,
      pending: normalized.pending,
      response_code: normalized.responseCode || "",
    });

    if (normalized.status === "pending") {
      console.log("[paymob-pos-no-confirmation]", {
        transaction_id: transaction.id,
        order_id: transaction.order_id,
        reason: "provider_status_pending_or_inconclusive",
      });
      const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [transaction.order_id]);
      return res.json({
        success: true,
        status: "pending",
        local_status: transaction.status,
        confirmation_available: false,
        message: "Waiting for terminal payment confirmation...",
        transaction,
        order: orderResult.rows[0] || null,
        provider_payload: statusResult.payload,
      });
    }

    await client.query("BEGIN");
    const result = await applyPaymobConfirmation(client, normalized, { transactionId, tenantId });
    await client.query("COMMIT");
    return res.json({
      success: true,
      status: result.status,
      message: result.message,
      transaction: result.transaction,
      order: result.order,
      provider_payload: statusResult.payload,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors when no transaction is open.
    }
    const normalized = normalizePaymobError(error);
    console.error("[paymob-status-error]", { status: normalized.status, message: normalized.message, transaction_id: req.params?.transactionId });
    return res.status(normalized.status || 500).json({ success: false, message: normalized.message || "Failed to check Paymob payment status" });
  } finally {
    client.release();
  }
};

export const manuallyConfirmPaymobTerminalPayment = async (req, res) => {
  const client = await db.connect();
  try {
    const tenantId = resolveTenantId(req);
    const transactionId = numberOrNull(req.params?.transactionId);
    if (!transactionId) return res.status(400).json({ success: false, message: "transactionId is required" });
    if (!canManuallyConfirmTerminalPayment(req.user || {})) {
      return res.status(403).json({ success: false, message: "You do not have permission to confirm terminal payments" });
    }

    console.log("[paymob-pos-confirm]", {
      stage: "manual_requested",
      transaction_id: transactionId,
      tenant_id: tenantId,
      user_id: req.user?.id || null,
    });

    await client.query("BEGIN");
    const result = await manualConfirmPaymobTransaction(client, {
      transactionId,
      tenantId,
      userId: req.user?.id || null,
      note: req.body?.note || "",
    });
    await client.query("COMMIT");

    return res.json({
      success: true,
      replay: result.replay,
      status: result.status,
      message: result.message,
      transaction: result.transaction,
      order: result.order,
      audit: {
        action: "manual_terminal_approval",
        user_id: req.user?.id || null,
        transaction_id: transactionId,
        at: new Date().toISOString(),
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors when no transaction is open.
    }
    console.error("[paymob-pos-confirm]", {
      stage: "manual_failed",
      transaction_id: req.params?.transactionId,
      message: error?.message,
    });
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to manually confirm terminal payment" });
  } finally {
    client.release();
  }
};
