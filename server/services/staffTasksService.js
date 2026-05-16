import db from "../database/db.js";
import { emitStaffTaskEvent } from "../utils/socket.js";
import { createNotification } from "./notificationsService.js";
import { enqueueStaffTaskEmail, processStaffTaskEmailQueue } from "./staffTaskEmailNotificationService.js";

const TASK_STATUSES = new Set(["pending", "in_progress", "manager_review", "completed", "cancelled", "overdue", "reassigned"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const OPEN_STATUSES = ["pending", "in_progress", "manager_review", "overdue", "reassigned"];
const ATTENDANCE_TASK_SOURCE = "branch_qr_attendance";
const HOT_PRODUCT_COUNTS_ENABLED = String(process.env.STAFF_TASK_HOT_PRODUCT_COUNTS_ENABLED ?? "true").toLowerCase() !== "false";
const STAFFING_LOW_THRESHOLD = Math.max(Number(process.env.STAFF_TASK_LOW_STAFF_THRESHOLD || 2), 1);

const text = (value = "") => String(value ?? "").trim();
const nullableText = (value) => {
  const next = text(value);
  return next || null;
};
const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const jsonObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const priorityWeight = (priority = "medium") => ({ low: 1, medium: 2, high: 3, critical: 4 }[priority] || 2);
const dateKey = (value = null) => {
  const pad = (number) => String(number).padStart(2, "0");
  if (!value) {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
};

export const resolveTaskTenantId = (reqOrUser = {}) => {
  const user = reqOrUser.user || reqOrUser;
  const raw = user?.tenant_id || user?.tenantId || reqOrUser?.tenant?.id;
  const tenantId = Number(raw);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

export const ensureStaffTasksSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS department VARCHAR(120)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT REFERENCES tenants(id) ON DELETE SET NULL,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(120) NOT NULL,
      entity_type VARCHAR(120),
      entity_id BIGINT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip_address INET,
      user_agent TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS staff_task_templates (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      task_type VARCHAR(80) NOT NULL DEFAULT 'general',
      department VARCHAR(120) NULL,
      role_key VARCHAR(120) NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      default_deadline_minutes INTEGER NOT NULL DEFAULT 480,
      recurrence VARCHAR(30) NOT NULL DEFAULT 'manual',
      source_module VARCHAR(80) NOT NULL DEFAULT 'operations',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT staff_task_templates_priority_check CHECK (priority IN ('low','medium','high','critical'))
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS staff_task_assignments (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      template_id BIGINT NULL REFERENCES staff_task_templates(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      task_type VARCHAR(80) NOT NULL DEFAULT 'general',
      source_module VARCHAR(80) NOT NULL DEFAULT 'operations',
      source_ref_type VARCHAR(120) NULL,
      source_ref_id VARCHAR(160) NULL,
      department VARCHAR(120) NULL,
      role_key VARCHAR(120) NULL,
      branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
      warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
      product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
      variant_id BIGINT NULL REFERENCES product_variants(id) ON DELETE SET NULL,
      assigned_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      current_assignee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      assigned_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
      assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      due_at TIMESTAMP NULL,
      started_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      completed_by BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      auto_assigned BOOLEAN NOT NULL DEFAULT FALSE,
      reassignment_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT staff_task_assignments_status_check CHECK (status IN ('pending','in_progress','manager_review','completed','cancelled','overdue','reassigned')),
      CONSTRAINT staff_task_assignments_priority_check CHECK (priority IN ('low','medium','high','critical'))
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS staff_task_history (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      task_id BIGINT NOT NULL REFERENCES staff_task_assignments(id) ON DELETE CASCADE,
      actor_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      actor_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      action VARCHAR(80) NOT NULL,
      from_status VARCHAR(40) NULL,
      to_status VARCHAR(40) NULL,
      from_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      to_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      note TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS staff_task_comments (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      task_id BIGINT NOT NULL REFERENCES staff_task_assignments(id) ON DELETE CASCADE,
      actor_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      actor_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      comment TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS staff_task_email_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      task_id BIGINT NULL REFERENCES staff_task_assignments(id) ON DELETE SET NULL,
      email_type VARCHAR(80) NOT NULL,
      sent_to TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      dedupe_key TEXT NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      error_message TEXT NULL,
      UNIQUE (dedupe_key)
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS staff_task_notification_queue (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      task_id BIGINT NULL REFERENCES staff_task_assignments(id) ON DELETE CASCADE,
      employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      notification_type VARCHAR(80) NOT NULL DEFAULT 'task_assigned',
      channel VARCHAR(30) NOT NULL DEFAULT 'email',
      recipient TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_notification_queue ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_tasks_tenant_status_due ON staff_task_assignments (tenant_id, status, due_at)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_tasks_assignee_status ON staff_task_assignments (current_assignee_id, status, due_at)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_tasks_branch_status ON staff_task_assignments (branch_id, status, due_at)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_tasks_source ON staff_task_assignments (source_ref_type, source_ref_id)`);
  await clientOrPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tasks_daily_dedupe
    ON staff_task_assignments (
      COALESCE(tenant_id, 0),
      assigned_date,
      task_type,
      COALESCE(current_assignee_id, 0),
      COALESCE(source_ref_type, ''),
      COALESCE(source_ref_id, '')
    )
    WHERE status <> 'cancelled'
  `);
  await clientOrPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tasks_daily_source_dedupe
    ON staff_task_assignments (
      COALESCE(tenant_id, 0),
      assigned_date,
      task_type,
      COALESCE(source_ref_type, ''),
      COALESCE(source_ref_id, '')
    )
    WHERE status <> 'cancelled' AND source_ref_type IS NOT NULL AND source_ref_id IS NOT NULL
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_task_history_task ON staff_task_history (task_id, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_task_comments_task ON staff_task_comments (task_id, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_task_queue_status ON staff_task_notification_queue (status, next_attempt_at)`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_task_queue_dedupe ON staff_task_notification_queue (dedupe_key) WHERE dedupe_key IS NOT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS source_ref_date DATE NULL`);
  await clientOrPool.query(`
    UPDATE staff_task_assignments
    SET source_ref_date = assigned_date
    WHERE source_ref_date IS NULL
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_tasks_branch_date_source ON staff_task_assignments (tenant_id, branch_id, assigned_date, source_module, task_type)`);
};

const logTaskHistory = async (client, payload) => {
  await client.query(
    `
    INSERT INTO staff_task_history (
      tenant_id, task_id, actor_user_id, actor_employee_id, action, from_status, to_status,
      from_employee_id, to_employee_id, note, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
    `,
    [
      payload.tenantId,
      payload.taskId,
      payload.actorUserId || null,
      payload.actorEmployeeId || null,
      payload.action,
      payload.fromStatus || null,
      payload.toStatus || null,
      payload.fromEmployeeId || null,
      payload.toEmployeeId || null,
      payload.note || "",
      JSON.stringify(jsonObject(payload.metadata)),
    ]
  );
};

export const resolveEmployeeForUser = async (user = {}, tenantId = null, clientOrPool = db) => {
  if (!user?.id) return null;
  const result = await clientOrPool.query(
    `
    SELECT e.*, u.id AS linked_user_id, u.email AS user_email
    FROM employees e
    LEFT JOIN users u ON u.id = COALESCE(e.user_id, $2::bigint)
    WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      AND (
        e.user_id = $2
        OR LOWER(COALESCE(e.email, '')) = LOWER(COALESCE($3, ''))
        OR LOWER(COALESCE(e.full_name, '')) = LOWER(COALESCE($4, ''))
      )
    ORDER BY CASE WHEN e.user_id = $2 THEN 0 WHEN LOWER(COALESCE(e.email, '')) = LOWER(COALESCE($3, '')) THEN 1 ELSE 2 END, e.id DESC
    LIMIT 1
    `,
    [tenantId, user.id, user.email || "", user.name || ""]
  );
  return result.rows[0] || null;
};

const normalizeTaskRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  title: row.title || "",
  description: row.description || "",
  task_type: row.task_type || "general",
  source_module: row.source_module || "operations",
  source_ref_type: row.source_ref_type || null,
  source_ref_id: row.source_ref_id || null,
  department: row.department || "",
  role_key: row.role_key || "",
  branch_id: row.branch_id || null,
  branch_name: row.branch_name || "",
  warehouse_id: row.warehouse_id || null,
  warehouse_name: row.warehouse_name || "",
  product_id: row.product_id || null,
  product_name: row.product_name || "",
  variant_id: row.variant_id || null,
  assigned_employee_id: row.assigned_employee_id || null,
  current_assignee_id: row.current_assignee_id || null,
  assignee_name: row.assignee_name || "",
  assignee_email: row.assignee_email || "",
  assigned_user_id: row.assigned_user_id || null,
  status: row.status || "pending",
  priority: row.priority || "medium",
  assigned_date: row.assigned_date || null,
  assigned_at: row.assigned_at || null,
  due_at: row.due_at || null,
  started_at: row.started_at || null,
  completed_at: row.completed_at || null,
  completed_by: row.completed_by || null,
  auto_assigned: Boolean(row.auto_assigned),
  reassignment_count: Number(row.reassignment_count || 0),
  metadata: row.metadata || {},
  is_overdue: Boolean(row.is_overdue),
  created_by: row.created_by || null,
  updated_at: row.updated_at || null,
});

const taskSelect = `
  sta.*,
  e.full_name AS assignee_name,
  e.email AS assignee_email,
  b.name AS branch_name,
  w.name AS warehouse_name,
  p.name AS product_name,
  (sta.due_at IS NOT NULL AND sta.due_at < NOW() AND sta.status IN ('pending','in_progress','reassigned')) AS is_overdue
`;

const taskJoins = `
  LEFT JOIN employees e ON e.id = sta.current_assignee_id
  LEFT JOIN branches b ON b.id = sta.branch_id
  LEFT JOIN warehouses w ON w.id = sta.warehouse_id
  LEFT JOIN products p ON p.id = sta.product_id
`;

export const findEligibleEmployees = async (client, { tenantId, branchId = null, department = null, roleKey = null } = {}) => {
  const params = [tenantId, branchId, nullableText(department), nullableText(roleKey)];
  const result = await client.query(
    `
    WITH open_tasks AS (
      SELECT current_assignee_id AS employee_id, COUNT(*)::int AS open_count
      FROM staff_task_assignments
      WHERE status = ANY($5::text[])
      GROUP BY current_assignee_id
    ),
    today_attendance AS (
      SELECT DISTINCT ON (employee_id)
        employee_id,
        CASE
          WHEN check_out_at IS NOT NULL OR check_out IS NOT NULL OR status = 'checked_out' THEN 'checked_out'
          WHEN check_in_at IS NOT NULL OR check_in IS NOT NULL THEN 'checked_in'
          ELSE COALESCE(status, 'absent')
        END AS attendance_status
      FROM attendance_logs
      WHERE attendance_date = CURRENT_DATE
        AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      ORDER BY employee_id, created_at DESC
    )
    SELECT
      e.*,
      COALESCE(ot.open_count, 0) AS open_task_count,
      COALESCE(ta.attendance_status, 'absent') AS attendance_status
    FROM employees e
    LEFT JOIN open_tasks ot ON ot.employee_id = e.id
    LEFT JOIN today_attendance ta ON ta.employee_id = e.id
    WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
      AND ($2::bigint IS NULL OR e.branch_id = $2::bigint OR e.branch_id IS NULL)
      AND ($3::text IS NULL OR LOWER(COALESCE(e.department, '')) = LOWER($3) OR LOWER(COALESCE(e.role, '')) = LOWER($3))
      AND ($4::text IS NULL OR LOWER(COALESCE(e.role, '')) = LOWER($4))
    ORDER BY
      CASE WHEN COALESCE(ta.attendance_status, 'absent') = 'checked_in' THEN 0 ELSE 1 END,
      COALESCE(ot.open_count, 0) ASC,
      e.id ASC
    `,
    [...params, OPEN_STATUSES]
  );
  return result.rows || [];
};

const notifyTaskAssignment = async (client, task, assignee, eventType = "task_assigned") => {
  if (!task?.id || !assignee?.id) return;
  await createNotification({
    tenant_id: task.tenant_id,
    user_id: assignee.user_id || null,
    branch_id: task.branch_id,
    role_key: assignee.user_id || task.branch_id || assignee.role ? assignee.role || null : "admin",
    type: eventType,
    category: "staff_tasks",
    priority: task.priority,
    title: eventType === "task_reassigned" ? "Task reassigned" : "New task assigned",
    message: task.title,
    action_url: "/staff/tasks",
    action_label: "Open tasks",
    entity_type: "staff_task",
    entity_id: String(task.id),
    metadata: {
      task_id: task.id,
      employee_id: assignee.id,
      task_type: task.task_type,
      due_at: task.due_at,
    },
  });
  await enqueueStaffTaskEmail(client, {
    tenantId: task.tenant_id,
    taskId: task.id,
    employeeId: assignee.id,
    userId: assignee.user_id || null,
    recipient: assignee.email || assignee.user_email || "",
    type: eventType,
    payload: {
      title: task.title,
      description: task.description,
      priority: task.priority,
      due_at: task.due_at,
      assignee_name: assignee.full_name,
    },
  });
};

const emitTaskRealtime = async (eventType, task = {}, options = {}) => {
  if (!task?.id) return;
  emitStaffTaskEvent(eventType, task, options);
  if (options.persist === false) return;
  await createNotification({
    tenant_id: task.tenant_id,
    user_id: task.assigned_user_id || null,
    branch_id: task.branch_id || null,
    role_key: task.assigned_user_id || task.branch_id || task.role_key ? task.role_key || null : "admin",
    type: `staff_task_${eventType}`,
    category: "staff_tasks",
    priority: task.priority || "medium",
    title: options.title || "Staff task update",
    message: options.message || task.title || "A staff task changed",
    action_url: "/staff/tasks",
    action_label: "Open tasks",
    entity_type: "staff_task",
    entity_id: String(task.id),
    metadata: {
      task_id: task.id,
      status: task.status,
      priority: task.priority,
      event: eventType,
      ...(options.metadata || {}),
    },
  });
};

export const createStaffTask = async (payload = {}, actor = {}) => {
  await ensureStaffTasksSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = payload.tenantId ?? payload.tenant_id ?? resolveTaskTenantId(actor);
    const priority = TASK_PRIORITIES.has(text(payload.priority).toLowerCase()) ? text(payload.priority).toLowerCase() : "medium";
    let assignee = null;
    const requestedEmployeeId = numberOrNull(payload.current_assignee_id ?? payload.currentAssigneeId ?? payload.employee_id ?? payload.employeeId);
    if (requestedEmployeeId) {
      const employeeResult = await client.query(
        `SELECT e.*, u.email AS user_email FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint) LIMIT 1`,
        [requestedEmployeeId, tenantId]
      );
      assignee = employeeResult.rows[0] || null;
    }
    if (!assignee) {
      const eligible = await findEligibleEmployees(client, {
        tenantId,
        branchId: payload.branch_id ?? payload.branchId ?? null,
        department: payload.department,
        roleKey: payload.role_key ?? payload.roleKey ?? null,
      });
      assignee = eligible[0] || null;
    }
    if (!assignee) {
      throw new Error("No eligible employee available for this task");
    }

    const deadlineMinutes = Math.max(Number(payload.default_deadline_minutes ?? payload.deadlineMinutes ?? 480), 15);
    const sourceRefType = nullableText(payload.source_ref_type ?? payload.sourceRefType);
    const sourceRefId = nullableText(payload.source_ref_id ?? payload.sourceRefId);
    const dueAt = payload.due_at || payload.dueAt || new Date(Date.now() + deadlineMinutes * 60 * 1000).toISOString();
    const assignedDate = dateKey(payload.assigned_date ?? payload.assignedDate);
    const result = await client.query(
      `
      INSERT INTO staff_task_assignments (
        tenant_id, template_id, title, description, task_type, source_module, source_ref_type, source_ref_id,
        department, role_key, branch_id, warehouse_id, product_id, variant_id, assigned_employee_id,
        current_assignee_id, assigned_user_id, status, priority, assigned_date, assigned_at, due_at,
        auto_assigned, metadata, created_by, source_ref_date
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15,$16,'pending',$17,$18::date,NOW(),$19,$20,$21::jsonb,$22,$18::date)
      ON CONFLICT DO NOTHING
      RETURNING *
      `,
      [
        tenantId,
        numberOrNull(payload.template_id ?? payload.templateId),
        text(payload.title || "Operational task"),
        text(payload.description),
        text(payload.task_type ?? payload.taskType ?? "general"),
        text(payload.source_module ?? payload.sourceModule ?? "operations"),
        sourceRefType,
        sourceRefId,
        nullableText(payload.department),
        nullableText(payload.role_key ?? payload.roleKey ?? assignee.role),
        numberOrNull(payload.branch_id ?? payload.branchId ?? assignee.branch_id),
        numberOrNull(payload.warehouse_id ?? payload.warehouseId),
        numberOrNull(payload.product_id ?? payload.productId),
        numberOrNull(payload.variant_id ?? payload.variantId),
        assignee.id,
        assignee.user_id || null,
        priority,
        assignedDate,
        dueAt,
        Boolean(payload.auto_assigned ?? payload.autoAssigned),
        JSON.stringify(jsonObject(payload.metadata)),
        actor?.id || payload.created_by || null,
      ]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return { duplicate: true, task: null };
    }
    const task = result.rows[0];
    await logTaskHistory(client, {
      tenantId,
      taskId: task.id,
      actorUserId: actor?.id,
      action: "created",
      toStatus: "pending",
      toEmployeeId: assignee.id,
      metadata: { auto_assigned: Boolean(payload.auto_assigned ?? payload.autoAssigned) },
    });
    await client.query(
      `
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details)
      VALUES ($1,$2,'staff_task.created','staff_task',$3,$4::jsonb)
      `,
      [tenantId, actor?.id || null, task.id, JSON.stringify({ title: task.title, assignee_id: assignee.id })]
    );
    await client.query("COMMIT");
    await notifyTaskAssignment(db, task, assignee);
    await emitTaskRealtime("task_created", task, {
      persist: false,
      title: "New task assigned",
      message: task.title,
      metadata: { assignee_id: assignee.id },
    });
    return { duplicate: false, task: normalizeTaskRow({ ...task, assignee_name: assignee.full_name, assignee_email: assignee.email }) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const listStaffTasks = async (filters = {}, user = {}) => {
  await ensureStaffTasksSchema();
  const tenantId = filters.tenantId ?? resolveTaskTenantId(user);
  const params = [tenantId];
  const clauses = ["($1::bigint IS NULL OR sta.tenant_id = $1::bigint)"];
  if (filters.status) {
    params.push(String(filters.status).split(",").map((item) => item.trim()).filter(Boolean));
    clauses.push(`sta.status = ANY($${params.length}::text[])`);
  }
  if (filters.assignee === "me") {
    const employee = await resolveEmployeeForUser(user, tenantId);
    params.push(employee?.id || 0);
    clauses.push(`sta.current_assignee_id = $${params.length}`);
  } else if (filters.employee_id || filters.employeeId) {
    params.push(filters.employee_id || filters.employeeId);
    clauses.push(`sta.current_assignee_id = $${params.length}`);
  }
  if (filters.branch_id || filters.branchId) {
    params.push(filters.branch_id || filters.branchId);
    clauses.push(`sta.branch_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${text(filters.search).toLowerCase()}%`);
    clauses.push(`LOWER(CONCAT_WS(' ', sta.title, sta.description, sta.task_type, e.full_name, p.name)) LIKE $${params.length}`);
  }
  const limit = Math.min(Math.max(Number(filters.limit || 80), 1), 200);
  params.push(limit);
  const result = await db.query(
    `
    SELECT ${taskSelect}
    FROM staff_task_assignments sta
    ${taskJoins}
    WHERE ${clauses.join(" AND ")}
    ORDER BY
      CASE sta.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      sta.due_at NULLS LAST,
      sta.id DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows.map(normalizeTaskRow);
};

export const updateStaffTaskStatus = async (taskId, payload = {}, actor = {}) => {
  await ensureStaffTasksSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = resolveTaskTenantId(actor);
    const current = await client.query(
      `SELECT * FROM staff_task_assignments WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint) FOR UPDATE`,
      [taskId, tenantId]
    );
    const task = current.rows[0];
    if (!task) {
      await client.query("ROLLBACK");
      return null;
    }
    const nextStatus = TASK_STATUSES.has(text(payload.status).toLowerCase()) ? text(payload.status).toLowerCase() : task.status;
    const employee = await resolveEmployeeForUser(actor, tenantId, client);
    const nextPriority = TASK_PRIORITIES.has(text(payload.priority).toLowerCase()) ? text(payload.priority).toLowerCase() : task.priority;
    const result = await client.query(
      `
      UPDATE staff_task_assignments
      SET status = $1::varchar,
          priority = $5::varchar,
          started_at = CASE WHEN $1::varchar = 'in_progress' AND started_at IS NULL THEN NOW() ELSE started_at END,
          completed_at = CASE WHEN $1::varchar = 'completed' THEN NOW() ELSE completed_at END,
          completed_by = CASE WHEN $1::varchar = 'completed' THEN $2 ELSE completed_by END,
          metadata = metadata || $3::jsonb,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
      `,
      [nextStatus, employee?.id || null, JSON.stringify(jsonObject(payload.metadata)), taskId, nextPriority]
    );
    await logTaskHistory(client, {
      tenantId,
      taskId,
      actorUserId: actor?.id,
      actorEmployeeId: employee?.id,
      action: nextStatus === "completed" ? "completed" : "status_changed",
      fromStatus: task.status,
      toStatus: nextStatus,
      fromEmployeeId: task.current_assignee_id,
      toEmployeeId: task.current_assignee_id,
      note: payload.note || "",
    });
    await client.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,'staff_task',$4,$5::jsonb)`,
      [tenantId, actor?.id || null, `staff_task.${nextStatus}`, taskId, JSON.stringify({ from_status: task.status, to_status: nextStatus })]
    );
    await client.query("COMMIT");
    const updatedTask = normalizeTaskRow(result.rows[0]);
    await emitTaskRealtime("task_updated", updatedTask, {
      title: "Task updated",
      message: updatedTask.title,
      metadata: { from_status: task.status, to_status: nextStatus, from_priority: task.priority, to_priority: nextPriority },
    });
    if (task.status !== nextStatus) {
      await emitTaskRealtime(nextStatus === "completed" ? "task_completed" : "task_status_changed", updatedTask, {
        persist: nextStatus !== "completed",
        title: nextStatus === "completed" ? "Task completed" : "Task status changed",
        message: `${updatedTask.title} is now ${nextStatus}`,
        metadata: { from_status: task.status, to_status: nextStatus },
      });
    }
    if (task.priority !== nextPriority) {
      await emitTaskRealtime("task_priority_changed", updatedTask, {
        title: "Task priority changed",
        message: `${updatedTask.title} priority is now ${nextPriority}`,
        metadata: { from_priority: task.priority, to_priority: nextPriority },
      });
    }
    return updatedTask;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const redistributeTasks = async ({ tenantId = null, employeeId = null, reason = "attendance_absence", actor = null } = {}) => {
  await ensureStaffTasksSchema();
  const client = await db.connect();
  const reassigned = [];
  try {
    await client.query("BEGIN");
    const params = [tenantId, OPEN_STATUSES];
    const clauses = ["($1::bigint IS NULL OR sta.tenant_id = $1::bigint)", "sta.status = ANY($2::text[])"];
    if (employeeId) {
      params.push(employeeId);
      clauses.push(`sta.current_assignee_id = $${params.length}`);
    } else {
      clauses.push(`
        NOT EXISTS (
          SELECT 1
          FROM attendance_logs al
          WHERE al.employee_id = sta.current_assignee_id
            AND al.attendance_date = CURRENT_DATE
            AND (al.check_in IS NOT NULL OR al.check_in_at IS NOT NULL)
            AND al.check_out IS NULL
            AND al.check_out_at IS NULL
            AND COALESCE(al.status, 'checked_in') <> 'checked_out'
        )
      `);
    }
    const tasks = await client.query(
      `
      SELECT sta.*
      FROM staff_task_assignments sta
      WHERE ${clauses.join(" AND ")}
      ORDER BY sta.due_at NULLS FIRST, sta.id ASC
      FOR UPDATE
      `,
      params
    );
    for (const task of tasks.rows) {
      const eligible = (await findEligibleEmployees(client, {
        tenantId: task.tenant_id,
        branchId: task.branch_id,
        department: task.department,
        roleKey: task.role_key,
      })).filter((employee) => String(employee.id) !== String(task.current_assignee_id));
      const nextAssignee = eligible[0];
      if (!nextAssignee) continue;
      const updated = await client.query(
        `
        UPDATE staff_task_assignments
        SET current_assignee_id = $1,
            assigned_user_id = $2,
            status = 'reassigned',
            reassignment_count = reassignment_count + 1,
            assigned_at = NOW(),
            updated_at = NOW(),
            metadata = metadata || $3::jsonb
        WHERE id = $4
        RETURNING *
        `,
        [nextAssignee.id, nextAssignee.user_id || null, JSON.stringify({ last_reassign_reason: reason }), task.id]
      );
      await logTaskHistory(client, {
        tenantId: task.tenant_id,
        taskId: task.id,
        actorUserId: actor?.id || null,
        action: "reassigned",
        fromStatus: task.status,
        toStatus: "reassigned",
        fromEmployeeId: task.current_assignee_id,
        toEmployeeId: nextAssignee.id,
        note: reason,
      });
      reassigned.push({ task: updated.rows[0], assignee: nextAssignee });
    }
    await client.query("COMMIT");
    for (const item of reassigned) {
      await notifyTaskAssignment(db, item.task, item.assignee, "task_reassigned");
      await emitTaskRealtime("task_updated", item.task, {
        persist: false,
        title: "Task reassigned",
        message: item.task.title,
        metadata: { assignee_id: item.assignee.id, reason },
      });
      await emitTaskRealtime("task_status_changed", item.task, {
        persist: false,
        title: "Task reassigned",
        message: `${item.task.title} was reassigned`,
        metadata: { to_status: "reassigned", reason },
      });
    }
    return reassigned.map((item) => normalizeTaskRow({ ...item.task, assignee_name: item.assignee.full_name, assignee_email: item.assignee.email }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const addStaffTaskComment = async (taskId, payload = {}, actor = {}) => {
  await ensureStaffTasksSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = resolveTaskTenantId(actor);
    const current = await client.query(
      `SELECT * FROM staff_task_assignments WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint) FOR UPDATE`,
      [taskId, tenantId]
    );
    const task = current.rows[0];
    if (!task) {
      await client.query("ROLLBACK");
      return null;
    }
    const commentText = text(payload.comment || payload.note || payload.message);
    if (!commentText) throw new Error("Comment is required");
    const employee = await resolveEmployeeForUser(actor, tenantId, client);
    const result = await client.query(
      `
      INSERT INTO staff_task_comments (tenant_id, task_id, actor_user_id, actor_employee_id, comment, metadata)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)
      RETURNING *
      `,
      [task.tenant_id, task.id, actor?.id || null, employee?.id || null, commentText, JSON.stringify(jsonObject(payload.metadata))]
    );
    await logTaskHistory(client, {
      tenantId: task.tenant_id,
      taskId: task.id,
      actorUserId: actor?.id,
      actorEmployeeId: employee?.id,
      action: "comment_added",
      fromStatus: task.status,
      toStatus: task.status,
      note: commentText,
    });
    await client.query("COMMIT");
    const comment = result.rows[0];
    await emitTaskRealtime("task_comment_added", task, {
      title: "Task comment added",
      message: task.title,
      metadata: { comment_id: comment.id },
    });
    return comment;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const deleteStaffTask = async (taskId, actor = {}) => {
  await ensureStaffTasksSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const tenantId = resolveTaskTenantId(actor);
    const current = await client.query(
      `SELECT * FROM staff_task_assignments WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint) FOR UPDATE`,
      [taskId, tenantId]
    );
    const task = current.rows[0];
    if (!task) {
      await client.query("ROLLBACK");
      return null;
    }
    await logTaskHistory(client, {
      tenantId: task.tenant_id,
      taskId: task.id,
      actorUserId: actor?.id,
      action: "deleted",
      fromStatus: task.status,
      toStatus: "cancelled",
    });
    await client.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'staff_task.deleted','staff_task',$3,$4::jsonb)`,
      [task.tenant_id, actor?.id || null, task.id, JSON.stringify({ title: task.title })]
    );
    await client.query(`DELETE FROM staff_task_assignments WHERE id = $1`, [task.id]);
    await client.query("COMMIT");
    await emitTaskRealtime("task_deleted", task, {
      title: "Task deleted",
      message: task.title,
      metadata: { deleted: true },
    });
    return normalizeTaskRow(task);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const assignDailyInventoryCountTasks = async ({ tenantId = null, actor = null, limit = 20 } = {}) => {
  await ensureStaffTasksSchema();
  const candidates = await db.query(
    `
    WITH sold AS (
      SELECT oi.variant_id, SUM(oi.quantity)::int AS sold_qty
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= NOW() - INTERVAL '30 days'
        AND ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
      GROUP BY oi.variant_id
    ),
    discrepancies AS (
      SELECT variant_id, SUM(ABS(difference_qty))::int AS discrepancy_qty
      FROM inventory_count_items
      GROUP BY variant_id
    )
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      v.id AS variant_id,
      v.sku,
      v.stock,
      COALESCE(s.sold_qty, 0) AS sold_30d,
      COALESCE(d.discrepancy_qty, 0) AS discrepancy_qty,
      CASE
        WHEN COALESCE(d.discrepancy_qty, 0) > 0 THEN 'critical'
        WHEN COALESCE(s.sold_qty, 0) >= 20 THEN 'high'
        ELSE 'medium'
      END AS priority
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN sold s ON s.variant_id = v.id
    LEFT JOIN discrepancies d ON d.variant_id = v.id
    WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
      AND (COALESCE(s.sold_qty, 0) >= 10 OR COALESCE(d.discrepancy_qty, 0) > 0)
    ORDER BY COALESCE(d.discrepancy_qty, 0) DESC, COALESCE(s.sold_qty, 0) DESC
    LIMIT $2
    `,
    [tenantId, Math.min(Math.max(Number(limit || 20), 1), 100)]
  );
  const created = [];
  for (const row of candidates.rows) {
    const result = await createStaffTask({
      tenantId,
      title: `Daily inventory count: ${row.product_name}`,
      description: `Verify physical stock for SKU ${row.sku || row.variant_id}. Current stock: ${row.stock}. Sold in 30 days: ${row.sold_30d}.`,
      task_type: "daily_inventory_count",
      source_module: "warehouse",
      source_ref_type: "product_variant",
      source_ref_id: String(row.variant_id),
      department: "warehouse",
      priority: row.priority,
      product_id: row.product_id,
      variant_id: row.variant_id,
      default_deadline_minutes: priorityWeight(row.priority) >= 4 ? 180 : 360,
      auto_assigned: true,
      metadata: { sold_30d: row.sold_30d, discrepancy_qty: row.discrepancy_qty },
    }, actor || {});
    if (!result.duplicate && result.task) created.push(result.task);
  }
  return created;
};

const getPresentBranchEmployees = async (client, { tenantId, branchId, attendanceDate }) => {
  const result = await client.query(
    `
    SELECT DISTINCT ON (e.id)
      e.*,
      u.email AS user_email,
      al.check_in_at,
      al.check_in,
      COALESCE(ot.open_count, 0) AS open_task_count
    FROM employees e
    JOIN attendance_logs al ON al.employee_id = e.id
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN (
      SELECT current_assignee_id AS employee_id, COUNT(*)::int AS open_count
      FROM staff_task_assignments
      WHERE status = ANY($4::text[])
      GROUP BY current_assignee_id
    ) ot ON ot.employee_id = e.id
    WHERE e.tenant_id = $1
      AND COALESCE(al.branch_id, e.branch_id) = $2
      AND al.attendance_date = $3::date
      AND (al.check_in IS NOT NULL OR al.check_in_at IS NOT NULL)
      AND al.check_out IS NULL
      AND al.check_out_at IS NULL
      AND COALESCE(al.status, 'checked_in') <> 'checked_out'
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
    ORDER BY e.id, COALESCE(al.check_in_at, al.check_in) ASC, al.id ASC
    `,
    [tenantId, branchId, attendanceDate, OPEN_STATUSES]
  );

  return (result.rows || []).sort((a, b) => {
    const aTime = new Date(a.check_in_at || a.check_in || 0).getTime();
    const bTime = new Date(b.check_in_at || b.check_in || 0).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return Number(a.id || 0) - Number(b.id || 0);
  });
};

const dailyAttendanceTaskPlan = [
  {
    slot: 1,
    tasks: [
      {
        key: "opening_readiness",
        title: "Opening readiness checklist",
        description: "Confirm branch opening readiness, cash area, lights, and customer area before active sales.",
        task_type: "opening",
        priority: "high",
        deadlineMinutes: 90,
      },
      {
        key: "opening_display_walkthrough",
        title: "Opening display walkthrough",
        description: "Review entrance displays and make sure top-selling items are visible and correctly arranged.",
        task_type: "opening",
        priority: "medium",
        deadlineMinutes: 120,
      },
    ],
  },
  {
    slot: 2,
    tasks: [
      {
        key: "mirror_cleaning",
        title: "Mirror cleaning",
        description: "Clean customer mirrors and fitting area mirrors, then report any damaged fixtures.",
        task_type: "branch_cleaning",
        priority: "medium",
        deadlineMinutes: 180,
      },
      {
        key: "glass_cleaning",
        title: "Glass cleaning",
        description: "Clean front glass, display glass, and counters without blocking customer movement.",
        task_type: "branch_cleaning",
        priority: "medium",
        deadlineMinutes: 180,
      },
    ],
  },
];

const createDailyAttendanceTasksForPresentEmployees = async ({ tenantId, branchId, attendanceDate, presentEmployees }) => {
  const created = [];
  for (let index = 0; index < presentEmployees.length && index < dailyAttendanceTaskPlan.length; index += 1) {
    const assignee = presentEmployees[index];
    const slotPlan = dailyAttendanceTaskPlan[index];
    for (const task of slotPlan.tasks) {
      const result = await createStaffTask({
        tenantId,
        branch_id: branchId,
        employee_id: assignee.id,
        title: task.title,
        description: task.description,
        task_type: task.task_type,
        source_module: ATTENDANCE_TASK_SOURCE,
        source_ref_type: "daily_branch_slot",
        source_ref_id: `${branchId}:${attendanceDate}:slot:${slotPlan.slot}:${task.key}`,
        assigned_date: attendanceDate,
        priority: task.priority,
        default_deadline_minutes: task.deadlineMinutes,
        auto_assigned: true,
        metadata: {
          attendance_date: attendanceDate,
          branch_id: branchId,
          slot: slotPlan.slot,
          slot_task_key: task.key,
          assignment_reason: "qr_check_in",
        },
      }, {});
      if (!result.duplicate && result.task) created.push(result.task);
    }
  }
  return created;
};

const assignBranchHotProductStockCounts = async ({ tenantId, branchId, attendanceDate, presentEmployees, limit = 5 }) => {
  if (!HOT_PRODUCT_COUNTS_ENABLED || !presentEmployees.length) return [];

  const candidates = await db.query(
    `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      v.id AS variant_id,
      v.sku,
      v.stock,
      SUM(oi.quantity)::int AS sold_qty
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN product_variants v ON v.id = oi.variant_id
    JOIN products p ON p.id = v.product_id
    WHERE o.tenant_id = $1
      AND o.branch_id = $2
      AND o.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY p.id, p.name, v.id, v.sku, v.stock
    ORDER BY SUM(oi.quantity) DESC, p.name ASC
    LIMIT $3
    `,
    [tenantId, branchId, Math.min(Math.max(Number(limit || 5), 1), 20)]
  );

  const created = [];
  let index = 0;
  for (const row of candidates.rows) {
    const assignee = presentEmployees[index % presentEmployees.length];
    index += 1;
    const result = await createStaffTask({
      tenantId,
      branch_id: branchId,
      employee_id: assignee.id,
      title: `Hot product stock count: ${row.product_name}`,
      description: `Count branch stock for SKU ${row.sku || row.variant_id}. Sold in 30 days: ${row.sold_qty}.`,
      task_type: "daily_inventory_count",
      source_module: ATTENDANCE_TASK_SOURCE,
      source_ref_type: "branch_hot_product_count",
      source_ref_id: `${branchId}:${attendanceDate}:hot_product:${row.variant_id}`,
      assigned_date: attendanceDate,
      department: "warehouse",
      priority: Number(row.sold_qty || 0) >= 20 ? "high" : "medium",
      product_id: row.product_id,
      variant_id: row.variant_id,
      default_deadline_minutes: 360,
      auto_assigned: true,
      metadata: {
        attendance_date: attendanceDate,
        branch_id: branchId,
        sold_30d: row.sold_qty,
        source: "qr_check_in_hot_products",
      },
    }, {});
    if (!result.duplicate && result.task) created.push(result.task);
  }
  return created;
};

const rebalanceBranchAttendanceTasks = async ({ tenantId, branchId, attendanceDate, presentEmployees }) => {
  if (!presentEmployees.length) return [];
  const presentIds = presentEmployees.map((employee) => Number(employee.id)).filter(Boolean);
  const client = await db.connect();
  const reassigned = [];
  try {
    await client.query("BEGIN");
    const tasks = await client.query(
      `
      SELECT *
      FROM staff_task_assignments
      WHERE tenant_id = $1
        AND branch_id = $2
        AND assigned_date = $3::date
        AND source_module = $4
        AND status = ANY($5::text[])
        AND (
          current_assignee_id IS NULL
          OR NOT (current_assignee_id = ANY($6::bigint[]))
        )
      ORDER BY due_at NULLS FIRST, id ASC
      FOR UPDATE
      `,
      [tenantId, branchId, attendanceDate, ATTENDANCE_TASK_SOURCE, OPEN_STATUSES, presentIds]
    );

    for (const task of tasks.rows) {
      const nextAssignee = presentEmployees
        .slice()
        .sort((a, b) => Number(a.open_task_count || 0) - Number(b.open_task_count || 0) || Number(a.id) - Number(b.id))[0];
      if (!nextAssignee) continue;
      nextAssignee.open_task_count = Number(nextAssignee.open_task_count || 0) + 1;
      const updated = await client.query(
        `
        UPDATE staff_task_assignments
        SET current_assignee_id = $1,
            assigned_employee_id = COALESCE(assigned_employee_id, $1),
            assigned_user_id = $2,
            status = 'reassigned',
            reassignment_count = reassignment_count + 1,
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
        WHERE id = $4
        RETURNING *
        `,
        [
          nextAssignee.id,
          nextAssignee.user_id || null,
          JSON.stringify({ last_reassign_reason: "qr_check_in_rebalance", attendance_date: attendanceDate }),
          task.id,
        ]
      );
      await logTaskHistory(client, {
        tenantId,
        taskId: task.id,
        action: "reassigned",
        fromStatus: task.status,
        toStatus: "reassigned",
        fromEmployeeId: task.current_assignee_id,
        toEmployeeId: nextAssignee.id,
        note: "qr_check_in_rebalance",
      });
      reassigned.push({ task: updated.rows[0], assignee: nextAssignee });
    }
    await client.query("COMMIT");
    for (const item of reassigned) {
      await notifyTaskAssignment(db, item.task, item.assignee, "task_reassigned");
    }
    return reassigned.map((item) => normalizeTaskRow({ ...item.task, assignee_name: item.assignee.full_name, assignee_email: item.assignee.email }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const getEmployeeOpenTasksForDate = async ({ tenantId, employeeId, branchId, attendanceDate }) => {
  const result = await db.query(
    `
    SELECT ${taskSelect}
    FROM staff_task_assignments sta
    ${taskJoins}
    WHERE sta.tenant_id = $1
      AND sta.current_assignee_id = $2
      AND sta.branch_id = $3
      AND sta.assigned_date = $4::date
      AND sta.status = ANY($5::text[])
    ORDER BY sta.due_at NULLS LAST, sta.id ASC
    `,
    [tenantId, employeeId, branchId, attendanceDate, OPEN_STATUSES]
  );
  return result.rows.map(normalizeTaskRow);
};

const notifyEmployeeTaskDigest = async ({ tenantId, branchId, employeeId, attendanceDate, tasks }) => {
  if (!tasks.length) return { skipped: true, reason: "no_tasks" };
  const employeeResult = await db.query(
    `
    SELECT e.*, u.email AS user_email
    FROM employees e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.id = $1
      AND e.tenant_id = $2
    LIMIT 1
    `,
    [employeeId, tenantId]
  );
  const employee = employeeResult.rows[0];
  if (!employee) return { skipped: true, reason: "employee_missing" };

  await createNotification({
    tenant_id: tenantId,
    user_id: employee.user_id || null,
    branch_id: branchId,
    type: "staff_tasks_available",
    category: "staff_tasks",
    priority: "medium",
    title: "Your task list is ready",
    message: `You have ${tasks.length} task${tasks.length === 1 ? "" : "s"} assigned for today.`,
    action_url: "/staff/tasks",
    action_label: "Open tasks",
    entity_type: "staff_task_digest",
    entity_id: `${employeeId}:${attendanceDate}`,
    metadata: {
      employee_id: employeeId,
      branch_id: branchId,
      attendance_date: attendanceDate,
      task_ids: tasks.map((task) => task.id),
    },
  });

  const emailEnabled = String(process.env.STAFF_TASK_EMAIL_NOTIFICATIONS_ENABLED ?? "true").toLowerCase() !== "false";
  const recipient = text(employee.email || employee.user_email);
  if (!emailEnabled || !recipient) return { notification: true, email: "skipped" };

  const dedupeKey = `staff_task_qr_digest:${tenantId}:${branchId}:${employeeId}:${attendanceDate}`;
  await db.query(
    `
    INSERT INTO staff_task_notification_queue (
      tenant_id, task_id, employee_id, user_id, notification_type, channel, recipient, dedupe_key, payload, status, next_attempt_at
    )
    VALUES ($1,NULL,$2,$3,'qr_check_in_digest','email',$4,$5,$6::jsonb,'pending',NOW())
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    `,
    [
      tenantId,
      employeeId,
      employee.user_id || null,
      recipient,
      dedupeKey,
      JSON.stringify({
        dedupe_key: dedupeKey,
        subject: "Your branch tasks are ready",
        assignee_name: employee.full_name,
        message: "Your task list was updated after branch QR check-in.",
        tasks: tasks.slice(0, 20).map((task) => ({
          id: task.id,
          title: task.title,
          due_at: task.due_at,
        })),
      }),
    ]
  );

  if (String(process.env.STAFF_TASK_EMAIL_SEND_IMMEDIATELY_ON_QR ?? "true").toLowerCase() !== "false") {
    await processStaffTaskEmailQueue({ limit: 10 }).catch((error) => {
      console.warn("[staff-tasks] QR digest email queue processing skipped", error.message);
    });
  }

  return { notification: true, email: "queued" };
};

const notifyManagerAttendanceTaskState = async ({ tenantId, branchId, attendanceDate, redistributedCount, presentCount }) => {
  if (redistributedCount > 0) {
    await createNotification({
      tenant_id: tenantId,
      role_key: "manager",
      branch_id: branchId,
      type: "staff_tasks_redistributed",
      category: "staff_tasks",
      priority: "medium",
      title: "Branch tasks redistributed",
      message: `${redistributedCount} task${redistributedCount === 1 ? "" : "s"} were redistributed after QR check-in.`,
      action_url: "/staff/tasks",
      action_label: "Review tasks",
      entity_type: "staff_task_rebalance",
      entity_id: `${branchId}:${attendanceDate}`,
      metadata: { branch_id: branchId, attendance_date: attendanceDate, redistributed_count: redistributedCount },
    });
  }

  if (presentCount < STAFFING_LOW_THRESHOLD) {
    await createNotification({
      tenant_id: tenantId,
      role_key: "manager",
      branch_id: branchId,
      type: "staffing_low",
      category: "staff_tasks",
      priority: "high",
      title: "Branch staffing is low",
      message: `Only ${presentCount} employee${presentCount === 1 ? "" : "s"} checked in for this branch.`,
      action_url: "/attendance/today",
      action_label: "Review attendance",
      entity_type: "staffing_low",
      entity_id: `${branchId}:${attendanceDate}`,
      metadata: { branch_id: branchId, attendance_date: attendanceDate, present_count: presentCount, threshold: STAFFING_LOW_THRESHOLD },
    });
  }
};

export const handleBranchQrCheckInStaffTasks = async ({ tenantId, branchId, employeeId, actionType, attendanceDate = null } = {}) => {
  await ensureStaffTasksSchema();
  const safeTenantId = numberOrNull(tenantId);
  const safeBranchId = numberOrNull(branchId);
  const safeEmployeeId = numberOrNull(employeeId);
  const safeDate = dateKey(attendanceDate);

  if (!safeTenantId || !safeBranchId || !safeEmployeeId || actionType !== "check_in") {
    return { skipped: true };
  }

  const presentEmployees = await getPresentBranchEmployees(db, {
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
  });

  const dailyTasks = await createDailyAttendanceTasksForPresentEmployees({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
    presentEmployees,
  });

  const stockTasks = await assignBranchHotProductStockCounts({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
    presentEmployees,
    limit: Number(process.env.STAFF_TASK_HOT_PRODUCT_COUNT_LIMIT || 5),
  });

  const redistributed = await rebalanceBranchAttendanceTasks({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
    presentEmployees,
  });

  const employeeTasks = await getEmployeeOpenTasksForDate({
    tenantId: safeTenantId,
    employeeId: safeEmployeeId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
  });
  await notifyEmployeeTaskDigest({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    employeeId: safeEmployeeId,
    attendanceDate: safeDate,
    tasks: employeeTasks,
  });
  await notifyManagerAttendanceTaskState({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
    redistributedCount: redistributed.length,
    presentCount: presentEmployees.length,
  });

  return {
    skipped: false,
    attendance_date: safeDate,
    present_count: presentEmployees.length,
    created_daily_tasks: dailyTasks.length,
    created_stock_count_tasks: stockTasks.length,
    redistributed_tasks: redistributed.length,
    employee_task_count: employeeTasks.length,
  };
};

export const reassignOverdueTasks = async ({ tenantId = null, actor = null } = {}) => {
  await ensureStaffTasksSchema();
  const overdue = await db.query(
    `
    UPDATE staff_task_assignments
    SET status = 'overdue', updated_at = NOW()
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND due_at < NOW()
      AND status IN ('pending','in_progress','reassigned')
    RETURNING *
    `,
    [tenantId]
  );
  for (const task of overdue.rows) {
    await emitTaskRealtime("task_overdue", task, {
      title: "Task overdue",
      message: task.title,
      metadata: { due_at: task.due_at },
    });
    await emitTaskRealtime("task_status_changed", task, {
      persist: false,
      title: "Task status changed",
      message: `${task.title} is now overdue`,
      metadata: { to_status: "overdue" },
    });
  }
  return redistributeTasks({ tenantId, reason: "deadline_overdue", actor });
};

export const getStaffTaskDashboard = async ({ tenantId = null } = {}) => {
  await ensureStaffTasksSchema();
  const [summary, byEmployee, recent, history] = await Promise.all([
    db.query(
      `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = ANY($2::text[]))::int AS open,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE due_at < NOW() AND status = ANY($2::text[]))::int AS overdue,
        COUNT(*) FILTER (WHERE priority IN ('high','critical') AND status = ANY($2::text[]))::int AS urgent
      FROM staff_task_assignments
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      `,
      [tenantId, OPEN_STATUSES]
    ),
    db.query(
      `
      SELECT
        e.id AS employee_id,
        e.full_name AS employee_name,
        e.role,
        e.department,
        COUNT(sta.id)::int AS total_tasks,
        COUNT(sta.id) FILTER (WHERE sta.status = ANY($2::text[]))::int AS open_tasks,
        COUNT(sta.id) FILTER (WHERE sta.status = 'completed')::int AS completed_tasks,
        COUNT(sta.id) FILTER (WHERE sta.due_at < NOW() AND sta.status = ANY($2::text[]))::int AS overdue_tasks,
        ROUND(
          CASE WHEN COUNT(sta.id) = 0 THEN 0
          ELSE COUNT(sta.id) FILTER (WHERE sta.status = 'completed')::numeric * 100 / COUNT(sta.id)::numeric END,
          2
        ) AS completion_rate
      FROM employees e
      LEFT JOIN staff_task_assignments sta ON sta.current_assignee_id = e.id AND ($1::bigint IS NULL OR sta.tenant_id = $1::bigint)
      WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      GROUP BY e.id
      ORDER BY open_tasks DESC, completion_rate DESC, e.full_name ASC
      LIMIT 30
      `,
      [tenantId, OPEN_STATUSES]
    ),
    db.query(
      `
      SELECT ${taskSelect}
      FROM staff_task_assignments sta
      ${taskJoins}
      WHERE ($1::bigint IS NULL OR sta.tenant_id = $1::bigint)
      ORDER BY sta.updated_at DESC, sta.id DESC
      LIMIT 20
      `,
      [tenantId]
    ),
    db.query(
      `
      SELECT h.*, COALESCE(u.name, '') AS actor_name, COALESCE(e.full_name, '') AS employee_name
      FROM staff_task_history h
      LEFT JOIN users u ON u.id = h.actor_user_id
      LEFT JOIN employees e ON e.id = h.to_employee_id
      WHERE ($1::bigint IS NULL OR h.tenant_id = $1::bigint)
      ORDER BY h.created_at DESC
      LIMIT 30
      `,
      [tenantId]
    ),
  ]);
  return {
    summary: summary.rows[0] || { total: 0, open: 0, completed: 0, overdue: 0, urgent: 0 },
    byEmployee: byEmployee.rows,
    recentTasks: recent.rows.map(normalizeTaskRow),
    history: history.rows,
  };
};
