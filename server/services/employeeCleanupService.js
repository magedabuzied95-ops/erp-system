import db from "../database/db.js";

const TEST_EMPLOYEE_PATTERNS = [
  "%Test%",
  "%Shift Close Test%",
  "%Legacy Test%",
  "%Legacy Close Test%",
  "%Codex%",
  "%Demo%",
];

const FAKE_EMPLOYEE_WHERE = `
  (
    COALESCE(full_name, '') ILIKE ANY($2::text[])
    OR LOWER(TRIM(COALESCE(full_name, ''))) = 'gbwgbw'
  )
`;

const LEGACY_SELLER_WHERE = `
  (
    COALESCE(name, '') ILIKE ANY($3::text[])
    OR LOWER(TRIM(COALESCE(name, ''))) = 'gbwgbw'
  )
`;

const tableExists = async (client, table) => {
  const result = await client.query(
    `SELECT to_regclass($1) AS exists`,
    [`public.${table}`]
  );
  return Boolean(result.rows[0]?.exists);
};

const columnExists = async (client, table, column) => {
  const result = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [table, column]
  );
  return Boolean(result.rows[0]);
};

const countWhere = async (client, table, whereSql, params = []) => {
  if (!(await tableExists(client, table))) return 0;
  const simpleColumnMatch = String(whereSql).match(/^([a-zA-Z0-9_]+)\s*=\s*ANY/);
  if (simpleColumnMatch && !(await columnExists(client, table, simpleColumnMatch[1]))) return 0;
  try {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${whereSql}`, params);
    return Number(result.rows[0]?.count || 0);
  } catch (error) {
    if (["42703", "42P01"].includes(error.code)) return 0;
    throw error;
  }
};

const updateWhere = async (client, table, setSql, whereSql, params = [], dryRun) => {
  if (!(await tableExists(client, table))) return 0;
  const simpleWhereColumnMatch = String(whereSql).match(/^([a-zA-Z0-9_]+)\s*=\s*ANY/);
  const simpleSetColumnMatch = String(setSql).match(/^([a-zA-Z0-9_]+)\s*=/);
  if (simpleWhereColumnMatch && !(await columnExists(client, table, simpleWhereColumnMatch[1]))) return 0;
  if (simpleSetColumnMatch && !(await columnExists(client, table, simpleSetColumnMatch[1]))) return 0;
  if (dryRun) return countWhere(client, table, whereSql, params);
  try {
    const result = await client.query(`UPDATE ${table} SET ${setSql} WHERE ${whereSql}`, params);
    return result.rowCount || 0;
  } catch (error) {
    if (["42703", "42P01"].includes(error.code)) return 0;
    throw error;
  }
};

const deleteWhere = async (client, table, whereSql, params = [], dryRun) => {
  if (!(await tableExists(client, table))) return 0;
  const simpleColumnMatch = String(whereSql).match(/^([a-zA-Z0-9_]+)\s*=\s*ANY/);
  if (simpleColumnMatch && !(await columnExists(client, table, simpleColumnMatch[1]))) return 0;
  if (dryRun) return countWhere(client, table, whereSql, params);
  try {
    const result = await client.query(`DELETE FROM ${table} WHERE ${whereSql}`, params);
    return result.rowCount || 0;
  } catch (error) {
    if (["42703", "42P01"].includes(error.code)) return 0;
    throw error;
  }
};

const idArrayWhere = (column) => `${column} = ANY($1::bigint[])`;
const logCounts = (target, key, count) => {
  if (count > 0) target[key] = count;
};

const sumCounts = (counts = {}) =>
  Object.values(counts).reduce((total, count) => total + Number(count || 0), 0);

const countRelatedRecordsForEmployee = async (client, employee, userIds = []) => {
  const employeeId = Number(employee.id);
  const userId = Number(employee.user_id);
  const scopedUserIds = [...new Set([userId, ...userIds].filter(Boolean))];
  const checks = [
    ["employee_sales_profiles", "employee_id", [employeeId]],
    ["attendance_logs", "employee_id", [employeeId]],
    ["attendance_events", "employee_id", [employeeId]],
    ["employee_shifts", "employee_id", [employeeId]],
    ["shift_opening_assignments", "employee_id", [employeeId]],
    ["staff_task_assignments", "assigned_employee_id", [employeeId]],
    ["staff_task_assignments", "current_assignee_id", [employeeId]],
    ["staff_task_assignments", "completed_by", [employeeId]],
    ["staff_task_history", "actor_employee_id", [employeeId]],
    ["staff_task_history", "from_employee_id", [employeeId]],
    ["staff_task_history", "to_employee_id", [employeeId]],
    ["staff_task_comments", "actor_employee_id", [employeeId]],
    ["staff_task_email_logs", "employee_id", [employeeId]],
    ["staff_task_notification_queue", "employee_id", [employeeId]],
    ["employee_portal_push_subscriptions", "employee_id", [employeeId]],
    ["employee_portal_sessions", "employee_id", [employeeId]],
    ["employee_commissions", "employee_id", [employeeId]],
    ["employee_sales", "sales_employee_id", [employeeId]],
    ["employee_sales", "cashier_id", [employeeId]],
    ["sales_employees", "employee_id", [employeeId]],
    ["orders", "sales_employee_id", [employeeId]],
    ["orders", "salesperson_id", [employeeId]],
    ["order_items", "sales_employee_id", [employeeId]],
  ];

  if (scopedUserIds.length) {
    checks.push(
      ["orders", "seller_user_id", scopedUserIds],
      ["orders", "cashier_user_id", scopedUserIds],
      ["orders", "created_by", scopedUserIds],
      ["cash_drawer_shifts", "opened_by", scopedUserIds],
      ["cash_drawer_shifts", "opened_by_user_id", scopedUserIds],
      ["cash_drawer_shifts", "closed_by", scopedUserIds],
      ["cash_drawer_shifts", "closed_by_user_id", scopedUserIds],
      ["cash_drawer_shift_events", "created_by", scopedUserIds],
      ["notifications", "user_id", scopedUserIds],
      ["staff_task_assignments", "assigned_user_id", scopedUserIds],
      ["staff_task_assignments", "created_by", scopedUserIds],
      ["staff_task_history", "actor_user_id", scopedUserIds],
      ["staff_task_comments", "actor_user_id", scopedUserIds],
      ["staff_task_email_logs", "user_id", scopedUserIds],
      ["staff_task_notification_queue", "user_id", scopedUserIds],
      ["audit_logs", "user_id", scopedUserIds]
    );
  }

  let total = 0;
  for (const [table, column, ids] of checks) {
    total += await countWhere(client, table, idArrayWhere(column), [ids.length ? ids : [0]]);
  }
  return total;
};

export const cleanupFakeLegacyEmployees = async ({ tenantId = null, confirm = false, actorUserId = null } = {}) => {
  const client = await db.connect();
  const dryRun = confirm !== true;
  try {
    await client.query("BEGIN");
    const employeeParams = [tenantId, TEST_EMPLOYEE_PATTERNS];
    const matched = await client.query(
      `
      SELECT id, tenant_id, branch_id, user_id, full_name, employee_code, email
      FROM employees
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND ${FAKE_EMPLOYEE_WHERE}
      ORDER BY id ASC
      FOR UPDATE
      `,
      employeeParams
    );
    const employees = matched.rows || [];
    const employeeIds = employees.map((employee) => Number(employee.id)).filter(Boolean);
    const userIds = employees.map((employee) => Number(employee.user_id)).filter(Boolean);

    const legacySalesEmployees = (await tableExists(client, "sales_employees"))
      ? (await client.query(
          `
          SELECT id, employee_id, tenant_id, name
          FROM sales_employees
          WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
            AND (${LEGACY_SELLER_WHERE} OR employee_id = ANY($2::bigint[]))
          ORDER BY id ASC
          `,
          [tenantId, employeeIds.length ? employeeIds : [0], TEST_EMPLOYEE_PATTERNS]
        )).rows
      : [];
    const legacySalesEmployeeIds = legacySalesEmployees.map((row) => Number(row.id)).filter(Boolean);
    const legacyUserRows = (await tableExists(client, "users"))
      ? (await client.query(
          `
          SELECT id, tenant_id, name, email
          FROM users
          WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
            AND (
              id = ANY($2::bigint[])
              OR COALESCE(name, '') ILIKE ANY($3::text[])
            )
          ORDER BY id ASC
          `,
          [tenantId, userIds.length ? userIds : [0], TEST_EMPLOYEE_PATTERNS]
        )).rows
      : [];
    const matchedUserIds = [...new Set(legacyUserRows.map((row) => Number(row.id)).filter(Boolean))];

    const dryRunRows = [];
    for (const employee of employees) {
      const relatedRecordsCount = await countRelatedRecordsForEmployee(client, employee, matchedUserIds);
      const row = {
        employee_id: Number(employee.id),
        employee_name: employee.full_name,
        related_records_count: relatedRecordsCount,
      };
      dryRunRows.push(row);
      console.log(
        `[cleanup-test-employees] employee_id=${row.employee_id}, employee_name=${row.employee_name}, related_records_count=${row.related_records_count}`
      );
    }

    const deleted = {};
    const nulled = {};

    if (employeeIds.length) {
      let attendanceLogIds = [];
      if (await tableExists(client, "attendance_logs")) {
        const attendanceResult = await client.query(
          `SELECT id FROM attendance_logs WHERE employee_id = ANY($1::bigint[]) FOR UPDATE`,
          [employeeIds]
        );
        attendanceLogIds = attendanceResult.rows.map((row) => Number(row.id)).filter(Boolean);
      }

      if (attendanceLogIds.length) {
        logCounts(nulled, "orders.attendance_log_id", await updateWhere(client, "orders", "attendance_log_id = NULL", idArrayWhere("attendance_log_id"), [attendanceLogIds], dryRun));
        if (await columnExists(client, "attendance_events", "attendance_log_id")) {
          logCounts(deleted, "attendance_events.by_attendance_log", await deleteWhere(client, "attendance_events", idArrayWhere("attendance_log_id"), [attendanceLogIds], dryRun));
        }
      }

      logCounts(deleted, "attendance_events", await deleteWhere(client, "attendance_events", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(deleted, "attendance_device_bindings", await deleteWhere(client, "attendance_device_bindings", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(deleted, "employee_attendance_devices", await deleteWhere(client, "employee_attendance_devices", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "attendance_suspicious_activity_logs.employee_id", await updateWhere(client, "attendance_suspicious_activity_logs", "employee_id = NULL", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(deleted, "shift_opening_assignments", await deleteWhere(client, "shift_opening_assignments", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "cashbox.next_opening_employee_id", await updateWhere(client, "cashbox", "next_opening_employee_id = NULL", idArrayWhere("next_opening_employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "attendance_logs.next_opening_employee_id", await updateWhere(client, "attendance_logs", "next_opening_employee_id = NULL", idArrayWhere("next_opening_employee_id"), [employeeIds], dryRun));

      logCounts(deleted, "attendance_logs", await deleteWhere(client, "attendance_logs", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(deleted, "employee_shifts", await deleteWhere(client, "employee_shifts", idArrayWhere("employee_id"), [employeeIds], dryRun));

      logCounts(deleted, "employee_sales_profiles", await deleteWhere(client, "employee_sales_profiles", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(deleted, "employee_sales", await deleteWhere(client, "employee_sales", idArrayWhere("sales_employee_id"), [employeeIds], dryRun));
      logCounts(deleted, "employee_sales.by_cashier", await deleteWhere(client, "employee_sales", idArrayWhere("cashier_id"), [employeeIds], dryRun));
      logCounts(deleted, "employee_commissions", await deleteWhere(client, "employee_commissions", idArrayWhere("employee_id"), [employeeIds], dryRun));

      logCounts(nulled, "order_items.sales_employee_id", await updateWhere(client, "order_items", "sales_employee_id = NULL", idArrayWhere("sales_employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "orders.sales_employee_id", await updateWhere(client, "orders", "sales_employee_id = NULL", idArrayWhere("sales_employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "orders.salesperson_id", await updateWhere(client, "orders", "salesperson_id = NULL", idArrayWhere("salesperson_id"), [employeeIds], dryRun));
      if (userIds.length) {
        logCounts(nulled, "orders.seller_user_id", await updateWhere(client, "orders", "seller_user_id = NULL", idArrayWhere("seller_user_id"), [userIds], dryRun));
      }

      logCounts(nulled, "staff_task_assignments.assigned_user_id", await updateWhere(client, "staff_task_assignments", "assigned_user_id = NULL", idArrayWhere("assigned_user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "staff_task_assignments.created_by", await updateWhere(client, "staff_task_assignments", "created_by = NULL", idArrayWhere("created_by"), [matchedUserIds], dryRun));
      logCounts(nulled, "staff_task_assignments.assigned_employee_id", await updateWhere(client, "staff_task_assignments", "assigned_employee_id = NULL", idArrayWhere("assigned_employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_assignments.current_assignee_id", await updateWhere(client, "staff_task_assignments", "current_assignee_id = NULL", idArrayWhere("current_assignee_id"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_assignments.completed_by", await updateWhere(client, "staff_task_assignments", "completed_by = NULL", idArrayWhere("completed_by"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_history.actor_user_id", await updateWhere(client, "staff_task_history", "actor_user_id = NULL", idArrayWhere("actor_user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "staff_task_history.actor_employee_id", await updateWhere(client, "staff_task_history", "actor_employee_id = NULL", idArrayWhere("actor_employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_history.from_employee_id", await updateWhere(client, "staff_task_history", "from_employee_id = NULL", idArrayWhere("from_employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_history.to_employee_id", await updateWhere(client, "staff_task_history", "to_employee_id = NULL", idArrayWhere("to_employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_comments.actor_user_id", await updateWhere(client, "staff_task_comments", "actor_user_id = NULL", idArrayWhere("actor_user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "staff_task_comments.actor_employee_id", await updateWhere(client, "staff_task_comments", "actor_employee_id = NULL", idArrayWhere("actor_employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_email_logs.employee_id", await updateWhere(client, "staff_task_email_logs", "employee_id = NULL", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_email_logs.user_id", await updateWhere(client, "staff_task_email_logs", "user_id = NULL", idArrayWhere("user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "staff_task_notification_queue.employee_id", await updateWhere(client, "staff_task_notification_queue", "employee_id = NULL", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(nulled, "staff_task_notification_queue.user_id", await updateWhere(client, "staff_task_notification_queue", "user_id = NULL", idArrayWhere("user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "staff_task_templates.fixed_employee_id", await updateWhere(client, "staff_task_templates", "fixed_employee_id = NULL", idArrayWhere("fixed_employee_id"), [employeeIds], dryRun));
      logCounts(deleted, "employee_portal_push_subscriptions", await deleteWhere(client, "employee_portal_push_subscriptions", idArrayWhere("employee_id"), [employeeIds], dryRun));
      logCounts(deleted, "employee_portal_sessions", await deleteWhere(client, "employee_portal_sessions", idArrayWhere("employee_id"), [employeeIds], dryRun));
    }

    if (matchedUserIds.length) {
      let shiftIds = [];
      if (await tableExists(client, "cash_drawer_shifts")) {
        const shiftResult = await client.query(
          `
          SELECT id
          FROM cash_drawer_shifts
          WHERE opened_by = ANY($1::bigint[])
             OR opened_by_user_id = ANY($1::bigint[])
             OR closed_by = ANY($1::bigint[])
             OR closed_by_user_id = ANY($1::bigint[])
          FOR UPDATE
          `,
          [matchedUserIds]
        );
        shiftIds = shiftResult.rows.map((row) => Number(row.id)).filter(Boolean);
      }
      if (shiftIds.length) {
        logCounts(nulled, "orders.shift_id", await updateWhere(client, "orders", "shift_id = NULL", idArrayWhere("shift_id"), [shiftIds], dryRun));
        logCounts(nulled, "returns.shift_id", await updateWhere(client, "returns", "shift_id = NULL", idArrayWhere("shift_id"), [shiftIds], dryRun));
        logCounts(deleted, "cash_drawer_shift_events.by_shift", await deleteWhere(client, "cash_drawer_shift_events", idArrayWhere("shift_id"), [shiftIds], dryRun));
        logCounts(deleted, "cash_drawer_shifts", await deleteWhere(client, "cash_drawer_shifts", idArrayWhere("id"), [shiftIds], dryRun));
      }

      logCounts(nulled, "orders.seller_user_id", await updateWhere(client, "orders", "seller_user_id = NULL", idArrayWhere("seller_user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "orders.cashier_user_id", await updateWhere(client, "orders", "cashier_user_id = NULL", idArrayWhere("cashier_user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "orders.created_by", await updateWhere(client, "orders", "created_by = NULL", idArrayWhere("created_by"), [matchedUserIds], dryRun));
      logCounts(nulled, "returns.cashier_user_id", await updateWhere(client, "returns", "cashier_user_id = NULL", idArrayWhere("cashier_user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "cash_drawer_shift_events.created_by", await updateWhere(client, "cash_drawer_shift_events", "created_by = NULL", idArrayWhere("created_by"), [matchedUserIds], dryRun));
      logCounts(deleted, "notifications", await deleteWhere(client, "notifications", idArrayWhere("user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "audit_logs.user_id", await updateWhere(client, "audit_logs", "user_id = NULL", idArrayWhere("user_id"), [matchedUserIds], dryRun));
      logCounts(nulled, "employees.user_id", await updateWhere(client, "employees", "user_id = NULL", idArrayWhere("user_id"), [matchedUserIds], dryRun));
    }

    if (legacySalesEmployeeIds.length || employeeIds.length) {
      if (legacySalesEmployeeIds.length) {
        logCounts(deleted, "sales_employees.by_legacy_id", await deleteWhere(client, "sales_employees", idArrayWhere("id"), [legacySalesEmployeeIds], dryRun));
      } else {
        logCounts(deleted, "sales_employees.by_employee_id", await deleteWhere(client, "sales_employees", idArrayWhere("employee_id"), [employeeIds], dryRun));
      }
    }

    logCounts(deleted, "employees", await deleteWhere(client, "employees", idArrayWhere("id"), [employeeIds.length ? employeeIds : [0]], dryRun));
    logCounts(deleted, "users", await deleteWhere(client, "users", idArrayWhere("id"), [matchedUserIds.length ? matchedUserIds : [0]], dryRun));

    const result = {
      dryRun,
      confirm,
      matchedEmployees: employees,
      matchedLegacySalesEmployees: legacySalesEmployees,
      matchedUsers: legacyUserRows,
      dryRunRows,
      counts: { deleted, nulled },
      relatedRecordsCount: sumCounts(deleted) + sumCounts(nulled),
      actorUserId,
    };

    console.log("[cleanup-test-employees]", {
      dry_run: dryRun,
      matched_employees: employees.map((employee) => ({ id: employee.id, name: employee.full_name })),
      matched_legacy_sales_employees: legacySalesEmployees.map((row) => ({ id: row.id, employee_id: row.employee_id, name: row.name })),
      matched_users: legacyUserRows.map((row) => ({ id: row.id, name: row.name, email: row.email })),
      deleted,
      nulled,
    });

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
