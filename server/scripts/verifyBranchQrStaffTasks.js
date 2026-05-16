import process from "node:process";
import { randomBytes } from "node:crypto";
import db from "../database/db.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { ensureStaffTasksSchema } from "../services/staffTasksService.js";

const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000/api";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const postJson = async (path, body) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "branch-qr-staff-task-verifier" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
};

const unique = Date.now();
const tenantSlug = `qr-staff-verify-${unique}`;
const attendanceQrToken = randomBytes(32).toString("hex");
let cleanupTenantId = null;
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const setup = async () => {
  await ensureAttendanceSchema();
  await ensureStaffTasksSchema();

  const tenant = await db.query(
    `
    INSERT INTO tenants (name, slug, status, plan)
    VALUES ($1,$2,'active','verification')
    RETURNING id
    `,
    [`QR Staff Verify ${unique}`, tenantSlug]
  );
  const tenantId = tenant.rows[0].id;
  cleanupTenantId = tenantId;

  const manager = await db.query(
    `
    INSERT INTO users (tenant_id, name, email, password)
    VALUES ($1,'Task Manager',$2,'verify')
    RETURNING id
    `,
    [tenantId, `manager-${unique}@example.test`]
  );

  const users = await db.query(
    `
    INSERT INTO users (tenant_id, name, email, password)
    VALUES
      ($1,'Employee One',$2,'verify'),
      ($1,'Employee Two',$3,'verify'),
      ($1,'Employee Three',$4,'verify')
    RETURNING id, email
    `,
    [tenantId, `emp1-${unique}@example.test`, `emp2-${unique}@example.test`, `emp3-${unique}@example.test`]
  );

  const branch = await db.query(
    `
    INSERT INTO branches (tenant_id, name, code, manager, attendance_qr_token, is_active)
    VALUES ($1,$2,$3,'Task Manager',$4,TRUE)
    RETURNING id, attendance_qr_token
    `,
    [tenantId, `QR Staff Branch ${unique}`, `QR-ST-${unique}`, attendanceQrToken]
  );
  const branchId = branch.rows[0].id;
  const token = branch.rows[0].attendance_qr_token;

  const employees = await db.query(
    `
    INSERT INTO employees (tenant_id, branch_id, employee_code, full_name, phone, email, user_id, status)
    VALUES
      ($1,$2,$3,'Employee One',$4,$5,$8,'active'),
      ($1,$2,$6,'Employee Two',$7,$9,$10,'active'),
      ($1,$2,$11,'Employee Three',$12,$13,$14,'active')
    RETURNING id, employee_code
    `,
    [
      tenantId,
      branchId,
      `EMP1-${unique}`,
      `010${unique}`.slice(0, 11),
      users.rows[0].email,
      `EMP2-${unique}`,
      `011${unique}`.slice(0, 11),
      users.rows[0].id,
      users.rows[1].email,
      users.rows[1].id,
      `EMP3-${unique}`,
      `012${unique}`.slice(0, 11),
      users.rows[2].email,
      users.rows[2].id,
    ]
  );

  const product = await db.query(
    `
    INSERT INTO products (tenant_id, name, sku, price, cost_price, status)
    VALUES ($1,'Hot Product', $2, 100, 60, 'active')
    RETURNING id
    `,
    [tenantId, `HOT-${unique}`]
  );
  const variant = await db.query(
    `
    INSERT INTO product_variants (tenant_id, product_id, sku, stock)
    VALUES ($1,$2,$3,20)
    RETURNING id
    `,
    [tenantId, product.rows[0].id, `HOT-V-${unique}`]
  );
  const order = await db.query(
    `
    INSERT INTO orders (tenant_id, branch_id, customer_name, channel, status, payment_status, total_amount)
    VALUES ($1,$2,'Verification','pos','completed','paid',100)
    RETURNING id
    `,
    [tenantId, branchId]
  );
  await db.query(
    `
    INSERT INTO order_items (tenant_id, order_id, product_id, variant_id, product_name, quantity, sale_price, total_amount)
    VALUES ($1,$2,$3,$4,'Hot Product',15,100,1500)
    `,
    [tenantId, order.rows[0].id, product.rows[0].id, variant.rows[0].id]
  );

  await db.query(
    `
    INSERT INTO staff_task_assignments (
      tenant_id, title, description, task_type, source_module, source_ref_type, source_ref_id,
      branch_id, assigned_employee_id, current_assignee_id, assigned_date, priority, auto_assigned, metadata
    )
    VALUES ($1,'Pre-existing absent task','Should move to present staff','opening',$2,'daily_branch_slot',$3,$4,$5,$5,CURRENT_DATE,'medium',TRUE,$6::jsonb)
    `,
    [
      tenantId,
      "branch_qr_attendance",
      `${branchId}:${today()}:slot:absent:verification`,
      branchId,
      employees.rows[2].id,
      JSON.stringify({ verification: true }),
    ]
  );

  return {
    tenantId,
    branchId,
    token,
    managerUserId: manager.rows[0].id,
    employees: employees.rows,
  };
};

const countTasks = async ({ tenantId, branchId }) => {
  const result = await db.query(
    `
    SELECT task_type, title, current_assignee_id, source_ref_type, source_ref_id
    FROM staff_task_assignments
    WHERE tenant_id = $1
      AND branch_id = $2
      AND assigned_date = CURRENT_DATE
      AND status <> 'cancelled'
    ORDER BY id ASC
    `,
    [tenantId, branchId]
  );
  return result.rows;
};

const run = async () => {
  const ctx = await setup();
  const [employeeOne, employeeTwo] = ctx.employees;

  const first = await postJson(`/attendance/public/branch/${ctx.token}/actions`, {
    employee_id: employeeOne.id,
    action_type: "check_in",
  });
  assert(first.response.status === 201, `employee #1 check-in failed: ${first.response.status} ${first.data.message || ""}`);
  let tasks = await countTasks(ctx);
  assert(tasks.some((task) => task.current_assignee_id === employeeOne.id && task.task_type === "opening"), "employee #1 did not receive opening tasks");
  assert(tasks.some((task) => task.current_assignee_id === employeeOne.id && task.title === "Pre-existing absent task"), "missing employee task was not redistributed");

  const firstDuplicate = await postJson(`/attendance/public/branch/${ctx.token}/actions`, {
    employee_id: employeeOne.id,
    action_type: "check_in",
  });
  assert(firstDuplicate.response.status === 409, "duplicate check-in was not blocked");
  const duplicateTaskCount = (await countTasks(ctx)).length;
  assert(duplicateTaskCount === tasks.length, "duplicate check-in created extra tasks");

  const second = await postJson(`/attendance/public/branch/${ctx.token}/actions`, {
    employee_id: employeeTwo.id,
    action_type: "check_in",
  });
  assert(second.response.status === 201, `employee #2 check-in failed: ${second.response.status} ${second.data.message || ""}`);
  tasks = await countTasks(ctx);
  assert(tasks.some((task) => task.current_assignee_id === employeeTwo.id && /mirror/i.test(task.title)), "employee #2 did not receive mirror task");
  assert(tasks.some((task) => task.current_assignee_id === employeeTwo.id && /glass/i.test(task.title)), "employee #2 did not receive glass task");
  assert(tasks.some((task) => task.source_ref_type === "branch_hot_product_count"), "hot product stock count task was not created");

  const notifications = await db.query(
    `
    SELECT type
    FROM notifications
    WHERE tenant_id = $1
      AND category = 'staff_tasks'
      AND created_at >= NOW() - INTERVAL '10 minutes'
    `,
    [ctx.tenantId]
  );
  assert(notifications.rows.some((row) => row.type === "staff_tasks_available"), "neutral employee task notification was not created");
  assert(notifications.rows.some((row) => row.type === "staff_tasks_redistributed"), "manager redistribution notification was not created");
  assert(notifications.rows.some((row) => row.type === "staffing_low"), "manager low staffing notification was not created");

  const emailQueue = await db.query(
    `
    SELECT id
    FROM staff_task_notification_queue
    WHERE tenant_id = $1
      AND notification_type = 'qr_check_in_digest'
    `,
    [ctx.tenantId]
  );
  assert(emailQueue.rows.length > 0, "QR check-in email digest was not queued");

  const attendance = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM attendance_logs
    WHERE tenant_id = $1
      AND branch_id = $2
      AND attendance_date = CURRENT_DATE
      AND status = 'checked_in'
    `,
    [ctx.tenantId, ctx.branchId]
  );
  assert(Number(attendance.rows[0]?.count || 0) === 2, "attendance_logs did not record both QR check-ins");

  console.log("Branch QR staff task verification passed", {
    tenantId: ctx.tenantId,
    branchId: ctx.branchId,
    tasks: tasks.length,
    notifications: notifications.rows.length,
    emailQueue: emailQueue.rows.length,
  });
};

run()
  .catch((error) => {
    console.error("Branch QR staff task verification failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (cleanupTenantId && String(process.env.KEEP_BRANCH_QR_VERIFY_DATA || "").toLowerCase() !== "true") {
      await db.query("DELETE FROM tenants WHERE id = $1", [cleanupTenantId]).catch((error) => {
        console.warn("Failed to clean verification tenant:", error.message);
      });
    }
    await db.end();
  });
