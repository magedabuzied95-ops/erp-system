import db from "../database/db.js";
import crypto from "node:crypto";
import { emitStaffTaskEvent } from "../utils/socket.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { getAttendanceTimeZone } from "../utils/attendanceTimezone.js";
import { repairCorruptedArabicValue } from "../utils/arabicTextRepair.js";
import { repairArabicMojibakeText } from "../utils/textEncoding.js";
import { createNotification } from "./notificationsService.js";
import { sendOverdueEmployeePortalTaskPushes, sendTaskAssignedPush, sendTaskOverduePush, sendTaskUpdatedPush } from "./employeePortalPushService.js";
import { enqueueStaffTaskEmail, processStaffTaskEmailQueue } from "./staffTaskEmailNotificationService.js";

const TASK_STATUSES = new Set(["pending", "in_progress", "completed", "overdue", "cancelled", "rejected", "manager_review", "reassigned"]);
const STRICT_TASK_STATUSES = new Set(["pending", "in_progress", "completed", "overdue", "cancelled", "rejected"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const TASK_FREQUENCIES = new Set(["one_time", "daily", "weekly", "monthly"]);
const TEMPLATE_KINDS = new Set(["manual", "daily", "weekly"]);
const ASSIGNMENT_STRATEGIES = new Set(["attendance_first_checkin", "first_checked_in", "round_robin", "least_tasks_today", "fixed_employee"]);
const OPEN_STATUSES = ["pending", "in_progress", "overdue"];
// What still counts as "on my plate" in the employee portal — wider than
// OPEN_STATUSES because a task waiting on the manager, or just handed over,
// is still the employee's to watch.
const OPEN_PORTAL_STATUSES = ["pending", "in_progress", "manager_review", "overdue", "reassigned"];
const ATTENDANCE_TASK_SOURCE = "branch_qr_attendance";
const HOT_PRODUCT_COUNTS_ENABLED = String(process.env.STAFF_TASK_HOT_PRODUCT_COUNTS_ENABLED ?? "false").toLowerCase() === "true";
const STATIC_ATTENDANCE_TASKS_ENABLED = String(process.env.STAFF_TASK_STATIC_ATTENDANCE_PLAN_ENABLED ?? "false").toLowerCase() === "true";
const STAFFING_LOW_THRESHOLD = Math.max(Number(process.env.STAFF_TASK_LOW_STAFF_THRESHOLD || 2), 1);
const EMPLOYEE_PORTAL_SESSION_MINUTES = Math.max(Number(process.env.EMPLOYEE_PORTAL_SESSION_MINUTES || 720), 60);
const EMPLOYEE_PORTAL_CHECKOUT_ACTION_MODE = String(process.env.EMPLOYEE_PORTAL_CHECKOUT_ACTION_MODE || "read_only").toLowerCase() === "allow" ? "allow" : "read_only";


const text = (value = "") => String(value ?? "").trim();
const firstText = (...values) => values.map(text).find(Boolean) || "";
const nullableText = (value) => {
  const next = text(value);
  return next || null;
};
const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const booleanValue = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
};
const normalizeFrequency = (value = "one_time") => {
  const frequency = text(value || "one_time").toLowerCase();
  return TASK_FREQUENCIES.has(frequency) ? frequency : "one_time";
};
const normalizeAssignmentStrategy = (value = "least_tasks_today") => {
  const strategy = text(value || "least_tasks_today").toLowerCase();
  return ASSIGNMENT_STRATEGIES.has(strategy) ? strategy : "least_tasks_today";
};
const normalizeAutoAssignMode = (value = "") => {
  const mode = text(value).toLowerCase();
  if (mode === "attendance_first_checkin" || mode === "first_checked_in") return "attendance_first_checkin";
  return mode || null;
};
const normalizeTemplateKind = (value = "manual") => {
  const kind = text(value || "manual").toLowerCase();
  return TEMPLATE_KINDS.has(kind) ? kind : "manual";
};
const normalizeWeekdays = (value = []) => {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  return Array.from(new Set(raw.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 6))).sort((a, b) => a - b);
};
const normalizeDayOfMonth = (value) => {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
};
// "HH:MM" in the attendance timezone, or null. A template's fixed due time of
// day; the generator turns it into due_at for each generated instance.
const normalizeDueTime = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};
// Resolve "YYYY-MM-DD" + "HH:MM" in the attendance timezone to a UTC Date.
// Two-pass offset correction handles DST edges without a tz library.
const zonedDateTimeToUtc = (dateKeyValue, dueTime) => {
  const [year, month, day] = String(dateKeyValue).split("-").map(Number);
  const [hours, minutes] = String(dueTime).split(":").map(Number);
  if (![year, month, day, hours, minutes].every(Number.isFinite)) return null;
  const timeZone = getAttendanceTimeZone();
  const asUtc = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
  const offsetAt = (utcMillis) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(utcMillis));
    const values = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    const local = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    return local - utcMillis;
  };
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return new Date(guess);
};
const jsonObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const jsonArray = (value) => (Array.isArray(value) ? value : []);
const priorityWeight = (priority = "medium") => ({ low: 1, medium: 2, high: 3, critical: 4 }[priority] || 2);
const sanitizedPayloadKeys = (payload = {}) =>
  Object.keys(jsonObject(payload))
    .filter((key) => !/(password|token|secret|authorization|cookie|key)/i.test(key))
    .sort();
const hasMeaningfulStaffTaskWork = (payload = {}, actor = {}) => {
  const tenantId = payload.tenantId ?? payload.tenant_id ?? resolveTaskTenantId(actor);
  const templateId = payload.template_id ?? payload.templateId ?? null;
  const actorId = actor?.id || null;
  const workSignals = [
    payload.title,
    payload.description,
    payload.task_type,
    payload.taskType,
    payload.source_module,
    payload.sourceModule,
    payload.source_ref_type,
    payload.sourceRefType,
    payload.source_ref_id,
    payload.sourceRefId,
    payload.employee_id,
    payload.employeeId,
    payload.current_assignee_id,
    payload.currentAssigneeId,
    payload.product_id,
    payload.productId,
    payload.variant_id,
    payload.variantId,
    payload.branch_id,
    payload.branchId,
  ].some((value) => Boolean(text(value)));
  return Boolean(tenantId || templateId || actorId || workSignals);
};
const logStaffTaskCreateFailure = ({ step = "unknown", payload = {}, error } = {}) => {
  console.warn("[staff-task-create-failure]", {
    step,
    payload_keys: sanitizedPayloadKeys(payload),
    message: error?.message || String(error || ""),
    code: error?.code || null,
  });
};
const dateKey = (value = null) => {
  const pad = (number) => String(number).padStart(2, "0");
  if (!value) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: getAttendanceTimeZone(),
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    } catch {
      const now = new Date();
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
  }
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
};
const weekStartKey = (value = null) => {
  const source = value instanceof Date ? value : new Date(`${dateKey(value)}T12:00:00`);
  if (Number.isNaN(source.getTime())) return dateKey(value);
  const day = source.getDay();
  const offset = (day + 6) % 7;
  source.setDate(source.getDate() - offset);
  return dateKey(source);
};

export const resolveTaskTenantId = (reqOrUser = {}) => {
  const user = reqOrUser.user || reqOrUser;
  const raw = user?.tenant_id || user?.tenantId || reqOrUser?.tenant?.id;
  const tenantId = Number(raw);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

const runStaffTasksSchemaDDL = async (clientOrPool = db) => {
  if (clientOrPool === db) {
    await ensureAttendanceSchema();
  }
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS department VARCHAR(120)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS job_title VARCHAR(120)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS position VARCHAR(120)`);
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      template_kind VARCHAR(20) NOT NULL DEFAULT 'manual',
      is_opening_day_task BOOLEAN NOT NULL DEFAULT FALSE,
      source_module VARCHAR(80) NOT NULL DEFAULT 'operations',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      assigned_at TIMESTAMPTZ NULL,
      assignment_source VARCHAR(80) NULL,
      assignment_event_id BIGINT NULL REFERENCES attendance_events(id) ON DELETE SET NULL,
      auto_assign_mode VARCHAR(80) NULL,
      due_at TIMESTAMPTZ NULL,
      started_at TIMESTAMPTZ NULL,
      completed_at TIMESTAMPTZ NULL,
      completed_by BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      auto_assigned BOOLEAN NOT NULL DEFAULT FALSE,
      reassignment_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT staff_task_assignments_status_check CHECK (status IN ('pending','in_progress','completed','cancelled','overdue','rejected','manager_review','reassigned')),
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_notification_queue ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS title_ar TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS description_ar TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS notes_ar TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS title_ar TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS description_ar TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS notes_ar TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ALTER COLUMN assigned_at DROP NOT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS assignment_source VARCHAR(80) NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS assignment_event_id BIGINT NULL REFERENCES attendance_events(id) ON DELETE SET NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_assignments ADD COLUMN IF NOT EXISTS auto_assign_mode VARCHAR(80) NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS auto_assign_mode VARCHAR(80) NULL`);
  await clientOrPool.query(`
    DO $$
    BEGIN
      ALTER TABLE IF EXISTS staff_task_assignments DROP CONSTRAINT IF EXISTS staff_task_assignments_status_check;
      ALTER TABLE IF EXISTS staff_task_assignments ADD CONSTRAINT staff_task_assignments_status_check CHECK (status IN ('pending','in_progress','completed','cancelled','overdue','rejected','manager_review','reassigned'));
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS photo_required BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS qr_required BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS gps_required BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS recurring_rule JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS frequency VARCHAR(30) NOT NULL DEFAULT 'one_time'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS template_kind VARCHAR(20) NOT NULL DEFAULT 'manual'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS is_opening_day_task BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS weekdays JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS day_of_month INTEGER NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS requires_checkin BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS requires_photo BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS requires_qr BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS requires_gps BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS auto_assign_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS assignment_strategy VARCHAR(40) NOT NULL DEFAULT 'least_tasks_today'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS staff_task_templates ADD COLUMN IF NOT EXISTS fixed_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS task_templates (
      id BIGINT PRIMARY KEY REFERENCES staff_task_templates(id) ON DELETE CASCADE
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS task_assignments (
      id BIGINT PRIMARY KEY REFERENCES staff_task_assignments(id) ON DELETE CASCADE
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS task_activity_logs (
      id BIGINT PRIMARY KEY REFERENCES staff_task_history(id) ON DELETE CASCADE
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS recurring_task_rules (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      template_id BIGINT NULL REFERENCES staff_task_templates(id) ON DELETE CASCADE,
      frequency VARCHAR(30) NOT NULL DEFAULT 'daily',
      rule JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      task_id BIGINT NOT NULL REFERENCES staff_task_assignments(id) ON DELETE CASCADE,
      employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      attachment_type VARCHAR(40) NOT NULL DEFAULT 'photo',
      url TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
  // One instance per template per day *per branch*. The original index omitted
  // the branch, so a tenant-wide routine fanning out across branches had every
  // instance after the first swallowed by ON CONFLICT DO NOTHING — the fan-out
  // silently produced exactly one task.
  //
  // Create the wider index before dropping the narrower one: adding a column to
  // a unique key can only ever relax it, so this cannot collide on data the old
  // index was already holding, and a failure here would brick boot.
  await clientOrPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_tasks_template_due_branch_dedupe
    ON staff_task_assignments (template_id, source_ref_date, COALESCE(branch_id, 0))
    WHERE template_id IS NOT NULL AND source_ref_date IS NOT NULL AND status <> 'cancelled'
  `);
  await clientOrPool.query(`DROP INDEX IF EXISTS idx_staff_tasks_template_due_dedupe`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS attendance_device_settings ADD COLUMN IF NOT EXISTS require_checkin_to_view_tasks BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS attendance_device_settings ADD COLUMN IF NOT EXISTS auto_redirect_after_checkin BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_portal_sessions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
      attendance_log_id BIGINT NULL REFERENCES attendance_logs(id) ON DELETE SET NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NULL
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_portal_sessions_lookup ON employee_portal_sessions (tenant_id, employee_id, expires_at DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT NULL,
      portal_url TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_portal_push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      session_id BIGINT NULL REFERENCES employee_portal_sessions(id) ON DELETE SET NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL DEFAULT '',
      auth TEXT NOT NULL DEFAULT '',
      portal_url TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, employee_id, endpoint)
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_push_subscriptions ADD COLUMN IF NOT EXISTS portal_url TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_portal_push_employee ON employee_portal_push_subscriptions (tenant_id, employee_id, is_active)`);
  await clientOrPool.query(`
    UPDATE staff_task_assignments
    SET status = 'cancelled',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'auto_cancelled_reason', 'stale_unassigned_overdue',
          'auto_cancelled_at', CURRENT_TIMESTAMP
        ),
        updated_at = CURRENT_TIMESTAMP
    WHERE current_assignee_id IS NULL
      AND assigned_employee_id IS NULL
      AND status = 'overdue'
      AND due_at < CURRENT_TIMESTAMP - INTERVAL '7 days'
  `);
  await clientOrPool.query(`
    UPDATE staff_task_assignments
    SET source_ref_date = assigned_date
    WHERE source_ref_date IS NULL
  `);
  await clientOrPool.query(`
    UPDATE staff_task_templates
    SET title_ar = CASE title
        WHEN 'Opening display walkthrough' THEN 'مراجعة عرض واجهة المحل'
        WHEN 'Opening readiness checklist' THEN 'قائمة تجهيز افتتاح الفرع'
        WHEN 'Mirror cleaning' THEN 'تنظيف مرايات العملاء'
        WHEN 'Glass cleaning' THEN 'تنظيف الزجاج والكاونتر'
        ELSE title_ar
      END,
      description_ar = CASE description
        WHEN 'Review entrance displays and make sure top-selling items are visible and correctly arranged.' THEN 'راجع واجهة المحل وتأكد إن المنتجات الأكثر مبيعًا ظاهرة ومتنسقة بشكل صحيح.'
        WHEN 'Confirm branch opening readiness, cash area, lights, and customer area before active sales.' THEN 'تأكد من جاهزية الفرع والكاونتر والإضاءة ومنطقة العملاء قبل بدء البيع.'
        WHEN 'Clean customer mirrors and fitting area mirrors, then report any damaged fixtures.' THEN 'نضف مرايات العملاء ومنطقة القياس، وبلغ عن أي تلف في التجهيزات.'
        WHEN 'Clean front glass, display glass, and counters without blocking customer movement.' THEN 'نضف زجاج الواجهة وفاترينات العرض والكاونتر من غير ما تعطل حركة العملاء.'
        ELSE description_ar
      END
    WHERE title_ar IS NULL OR title_ar = '' OR description_ar IS NULL OR description_ar = ''
  `);
  await clientOrPool.query(`
    UPDATE staff_task_assignments
    SET title_ar = CASE title
        WHEN 'Opening display walkthrough' THEN 'مراجعة عرض واجهة المحل'
        WHEN 'Opening readiness checklist' THEN 'قائمة تجهيز افتتاح الفرع'
        WHEN 'Mirror cleaning' THEN 'تنظيف مرايات العملاء'
        WHEN 'Glass cleaning' THEN 'تنظيف الزجاج والكاونتر'
        ELSE title_ar
      END,
      description_ar = CASE description
        WHEN 'Review entrance displays and make sure top-selling items are visible and correctly arranged.' THEN 'راجع واجهة المحل وتأكد إن المنتجات الأكثر مبيعًا ظاهرة ومتنسقة بشكل صحيح.'
        WHEN 'Confirm branch opening readiness, cash area, lights, and customer area before active sales.' THEN 'تأكد من جاهزية الفرع والكاونتر والإضاءة ومنطقة العملاء قبل بدء البيع.'
        WHEN 'Clean customer mirrors and fitting area mirrors, then report any damaged fixtures.' THEN 'نضف مرايات العملاء ومنطقة القياس، وبلغ عن أي تلف في التجهيزات.'
        WHEN 'Clean front glass, display glass, and counters without blocking customer movement.' THEN 'نضف زجاج الواجهة وفاترينات العرض والكاونتر من غير ما تعطل حركة العملاء.'
        ELSE description_ar
      END
    WHERE title_ar IS NULL OR title_ar = '' OR description_ar IS NULL OR description_ar = ''
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_staff_tasks_branch_date_source ON staff_task_assignments (tenant_id, branch_id, assigned_date, source_module, task_type)`);
};

// The staff-tasks DDL above is idempotent but ~70 sequential round-trips. When it
// runs against the shared pool (the read hot-path: dashboard/staff/tasks), memoize
// it for the process so every request no longer pays the full ensure cost. Explicit
// clients (transactions/migrations) always run it. On failure the promise is cleared
// so a later request can retry.
let staffTasksSchemaReadyPromise = null;
export const ensureStaffTasksSchema = async (clientOrPool = db) => {
  if (clientOrPool !== db) {
    await runStaffTasksSchemaDDL(clientOrPool);
    return;
  }
  if (!staffTasksSchemaReadyPromise) {
    staffTasksSchemaReadyPromise = runStaffTasksSchemaDDL(db).catch((error) => {
      staffTasksSchemaReadyPromise = null;
      throw error;
    });
  }
  await staffTasksSchemaReadyPromise;
};

const hashPortalToken = (token = "") => crypto.createHash("sha256").update(String(token)).digest("hex");

export const getEmployeePortalSettings = async (tenantId, clientOrPool = db) => {
  await ensureStaffTasksSchema(clientOrPool);
  const settingsTenantId = numberOrNull(tenantId);
  if (!settingsTenantId) {
    return {
      require_checkin_to_view_tasks: true,
      auto_redirect_after_checkin: true,
      checkout_action_mode: EMPLOYEE_PORTAL_CHECKOUT_ACTION_MODE,
    };
  }
  const result = await clientOrPool.query(
    `
    INSERT INTO attendance_device_settings (tenant_id)
    VALUES ($1)
    ON CONFLICT (tenant_id) DO UPDATE
    SET updated_at = attendance_device_settings.updated_at
    RETURNING require_checkin_to_view_tasks, auto_redirect_after_checkin
    `,
    [settingsTenantId]
  );
  return {
    require_checkin_to_view_tasks: result.rows[0]?.require_checkin_to_view_tasks !== false,
    auto_redirect_after_checkin: result.rows[0]?.auto_redirect_after_checkin !== false,
    checkout_action_mode: EMPLOYEE_PORTAL_CHECKOUT_ACTION_MODE,
  };
};

export const updateEmployeePortalSettings = async (tenantId, payload = {}, clientOrPool = db) => {
  await ensureStaffTasksSchema(clientOrPool);
  const settingsTenantId = numberOrNull(tenantId);
  if (!settingsTenantId) throw new Error("Tenant is required");
  const requireCheckin = payload.require_checkin_to_view_tasks ?? payload.requireCheckinToViewTasks;
  const autoRedirect = payload.auto_redirect_after_checkin ?? payload.autoRedirectAfterCheckin;
  const result = await clientOrPool.query(
    `
    INSERT INTO attendance_device_settings (
      tenant_id,
      require_checkin_to_view_tasks,
      auto_redirect_after_checkin
    )
    VALUES ($1,$2,$3)
    ON CONFLICT (tenant_id) DO UPDATE
    SET require_checkin_to_view_tasks = EXCLUDED.require_checkin_to_view_tasks,
        auto_redirect_after_checkin = EXCLUDED.auto_redirect_after_checkin,
        updated_at = NOW()
    RETURNING require_checkin_to_view_tasks, auto_redirect_after_checkin
    `,
    [settingsTenantId, requireCheckin !== false, autoRedirect !== false]
  );
  return {
    require_checkin_to_view_tasks: result.rows[0]?.require_checkin_to_view_tasks !== false,
    auto_redirect_after_checkin: result.rows[0]?.auto_redirect_after_checkin !== false,
    checkout_action_mode: EMPLOYEE_PORTAL_CHECKOUT_ACTION_MODE,
  };
};

export const createEmployeePortalSession = async ({ tenantId, employeeId, branchId = null, attendanceLogId = null } = {}, clientOrPool = db) => {
  await ensureStaffTasksSchema(clientOrPool);
  const safeTenantId = numberOrNull(tenantId);
  const safeEmployeeId = numberOrNull(employeeId);
  if (!safeTenantId || !safeEmployeeId) return null;

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + EMPLOYEE_PORTAL_SESSION_MINUTES * 60 * 1000);
  const result = await clientOrPool.query(
    `
    INSERT INTO employee_portal_sessions (
      tenant_id,
      employee_id,
      branch_id,
      attendance_log_id,
      token_hash,
      expires_at
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id, expires_at
    `,
    [safeTenantId, safeEmployeeId, numberOrNull(branchId), numberOrNull(attendanceLogId), hashPortalToken(token), expiresAt]
  );

  return {
    token,
    expires_at: result.rows[0]?.expires_at || expiresAt,
    expires_in_minutes: EMPLOYEE_PORTAL_SESSION_MINUTES,
  };
};

const resolvePortalSession = async (token = "") => {
  await ensureStaffTasksSchema();
  const portalToken = text(token);
  if (!portalToken) {
    const error = new Error("Employee portal token is required");
    error.statusCode = 400;
    throw error;
  }

  const result = await db.query(
    `
    SELECT
      s.*,
      e.full_name AS employee_name,
      e.employee_code,
      e.email AS employee_email,
      e.role AS employee_role,
      b.name AS branch_name
    FROM employee_portal_sessions s
    JOIN employees e ON e.id = s.employee_id AND e.tenant_id = s.tenant_id
    LEFT JOIN branches b ON b.id = COALESCE(s.branch_id, e.branch_id)
    WHERE s.token_hash = $1
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
    LIMIT 1
    `,
    [hashPortalToken(portalToken)]
  );

  const session = result.rows[0];
  if (!session) {
    const error = new Error("Employee portal session is invalid or expired");
    error.statusCode = 403;
    throw error;
  }

  await db.query(`UPDATE employee_portal_sessions SET last_seen_at = NOW() WHERE id = $1`, [session.id]);
  return session;
};

const getTodayAttendanceForEmployee = async ({ tenantId, employeeId }) => {
  const today = dateKey();
  const result = await db.query(
    `
    SELECT *
    FROM attendance_logs
    WHERE tenant_id = $1
      AND employee_id = $2
      AND attendance_date = $3::date
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [tenantId, employeeId, today]
  );
  const row = result.rows[0] || null;
  if (!row) {
    return {
      status: "not_checked_in",
      checked_in: false,
      checked_out: false,
      attendance: null,
    };
  }
  const checkedOut = Boolean(row.check_out_at || row.check_out || String(row.status || "").toLowerCase() === "checked_out");
  return {
    status: checkedOut ? "checked_out" : "checked_in",
    checked_in: Boolean(row.check_in_at || row.check_in),
    checked_out: checkedOut,
    attendance: row,
  };
};

const enforcePortalAttendanceAccess = async ({ tenantId, employeeId, action = "view" }) => {
  const [settings, attendanceState] = await Promise.all([
    getEmployeePortalSettings(tenantId),
    getTodayAttendanceForEmployee({ tenantId, employeeId }),
  ]);

  if (settings.require_checkin_to_view_tasks && !attendanceState.checked_in) {
    const error = new Error("Please check in first to view today's tasks.");
    error.statusCode = 403;
    error.code = "CHECK_IN_REQUIRED";
    error.attendance_state = attendanceState;
    error.settings = settings;
    throw error;
  }

  if (action !== "view" && attendanceState.checked_out && settings.checkout_action_mode !== "allow") {
    const error = new Error("Task actions are read-only after checkout.");
    error.statusCode = 403;
    error.code = "CHECKED_OUT_READ_ONLY";
    error.attendance_state = attendanceState;
    error.settings = settings;
    throw error;
  }

  return { settings, attendanceState };
};

const buildEmployeePortalTaskSummary = (tasks = []) => ({
  today: tasks.length,
  pending: tasks.filter((task) => OPEN_PORTAL_STATUSES.includes(task.status)).length,
  completed: tasks.filter((task) => task.status === "completed").length,
  critical: tasks.filter((task) => task.priority === "critical").length,
});

export const getEmployeePortal = async (token = "") => {
  const session = await resolvePortalSession(token);
  const { settings, attendanceState } = await enforcePortalAttendanceAccess({
    tenantId: session.tenant_id,
    employeeId: session.employee_id,
    action: "view",
  });
  // Strictly this employee's own tasks. Unassigned branch tasks used to be
  // folded in here, so every employee in the branch saw a task none of them
  // could act on — updateEmployeePortalTaskStatus requires ownership, so the
  // buttons answered 404. An unassigned task is a manager problem now, not a
  // row in four people's task lists.
  const [openTasks, completedToday] = await Promise.all([
    listStaffTasks(
      {
        tenantId: session.tenant_id,
        employee_id: session.employee_id,
        status: OPEN_PORTAL_STATUSES.join(","),
        limit: 200,
      },
      {}
    ),
    listStaffTasks(
      {
        tenantId: session.tenant_id,
        employee_id: session.employee_id,
        status: "completed",
        assigned_date: "today",
        limit: 50,
      },
      {}
    ),
  ]);
  const seenTaskIds = new Set();
  const tasks = [...openTasks, ...completedToday].filter((task) => {
    const key = String(task?.id || "");
    if (!key || seenTaskIds.has(key)) return false;
    seenTaskIds.add(key);
    return true;
  });

  return {
    employee: {
      id: session.employee_id,
      name: session.employee_name || "",
      employee_code: session.employee_code || "",
      role: session.employee_role || "",
      branch_name: session.branch_name || "",
    },
    attendance_state: attendanceState,
    settings,
    read_only: attendanceState.checked_out && settings.checkout_action_mode !== "allow",
    summary: buildEmployeePortalTaskSummary(tasks),
    tasks,
  };
};

export const updateEmployeePortalTaskStatus = async ({ token = "", taskId, payload = {} } = {}) => {
  const session = await resolvePortalSession(token);
  const { settings, attendanceState } = await enforcePortalAttendanceAccess({
    tenantId: session.tenant_id,
    employeeId: session.employee_id,
    action: "update",
  });

  const current = await db.query(
    `
    SELECT id
    FROM staff_task_assignments
    WHERE id = $1
      AND tenant_id = $2
      AND current_assignee_id = $3
    LIMIT 1
    `,
    [taskId, session.tenant_id, session.employee_id]
  );
  if (!current.rows[0]) return null;

  const task = await updateStaffTaskStatus(taskId, payload, {
    id: null,
    tenant_id: session.tenant_id,
    employee_id: session.employee_id,
    name: session.employee_name,
    email: session.employee_email,
    source: "employee_portal",
  });
  return {
    task,
    attendance_state: attendanceState,
    settings,
    read_only: attendanceState.checked_out && settings.checkout_action_mode !== "allow",
  };
};

export const getEmployeePortalPushPublicKey = async (token = "") => {
  await resolvePortalSession(token);
  return {
    publicKey: text(process.env.WEB_PUSH_PUBLIC_KEY),
    enabled: Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY) && text(process.env.WEB_PUSH_PRIVATE_KEY)),
  };
};

export const subscribeEmployeePortalPush = async ({ token = "", subscription = {}, userAgent = "" } = {}) => {
  const session = await resolvePortalSession(token);
  const endpoint = text(subscription.endpoint);
  const keys = jsonObject(subscription.keys);
  const p256dh = text(keys.p256dh);
  const auth = text(keys.auth);
  const portalUrl = text(subscription.portal_url || subscription.portalUrl);
  if (!endpoint) {
    const error = new Error("Push subscription endpoint is required");
    error.statusCode = 400;
    throw error;
  }

  const result = await db.query(
    `
    INSERT INTO employee_push_subscriptions (
      tenant_id,
      employee_id,
      endpoint,
      p256dh,
      auth,
      portal_url,
      user_agent,
      is_active,
      last_seen_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW())
    ON CONFLICT (endpoint) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        employee_id = EXCLUDED.employee_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        portal_url = EXCLUDED.portal_url,
        user_agent = EXCLUDED.user_agent,
        is_active = TRUE,
        last_seen_at = NOW()
    RETURNING id, tenant_id, employee_id, endpoint, is_active, created_at, last_seen_at
    `,
    [
      session.tenant_id,
      session.employee_id,
      endpoint,
      p256dh,
      auth,
      portalUrl,
      text(userAgent).slice(0, 500),
    ]
  );

  return {
    subscription: result.rows[0],
    vapid_configured: Boolean(text(process.env.WEB_PUSH_PUBLIC_KEY) && text(process.env.WEB_PUSH_PRIVATE_KEY)),
  };
};

export const unsubscribeEmployeePortalPush = async ({ token = "", endpoint = "" } = {}) => {
  const session = await resolvePortalSession(token);
  const safeEndpoint = text(endpoint);
  if (!safeEndpoint) {
    const error = new Error("Push subscription endpoint is required");
    error.statusCode = 400;
    throw error;
  }

  const result = await db.query(
    `
    UPDATE employee_push_subscriptions
    SET is_active = FALSE,
        last_seen_at = NOW()
    WHERE tenant_id = $1
      AND employee_id = $2
      AND endpoint = $3
    RETURNING id, tenant_id, employee_id, endpoint, is_active, last_seen_at
    `,
    [session.tenant_id, session.employee_id, safeEndpoint]
  );

  return result.rows[0] || null;
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
      repairCorruptedArabicValue(payload.note || ""),
      JSON.stringify(jsonObject(payload.metadata)),
    ]
  );
};

export const resolveEmployeeForUser = async (user = {}, tenantId = null, clientOrPool = db) => {
  const directEmployeeId = numberOrNull(user?.employee_id || user?.employeeId);
  if (directEmployeeId) {
    const direct = await clientOrPool.query(
      `
      SELECT e.*, u.id AS linked_user_id, u.email AS user_email
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      WHERE e.id = $2
        AND ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      LIMIT 1
      `,
      [tenantId, directEmployeeId]
    );
    if (direct.rows[0]) return direct.rows[0];
  }
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

const TASK_STATUS_LABELS_AR = {
  pending: "قيد التنفيذ",
  in_progress: "قيد التنفيذ",
  manager_review: "معلقة",
  overdue: "متأخرة",
  reassigned: "أعيد تعيينها",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

const TASK_PRIORITY_LABELS_AR = {
  low: "منخفضة",
  medium: "متوسطة",
  high: "عالية",
  critical: "عالية جدًا",
};

// Older task records can contain either known corrupted fragments or full
// Windows-1256/UTF-8 mojibake. Repair both formats only in the API payload.
const repairTaskText = (value = "") => repairArabicMojibakeText(repairCorruptedArabicValue(value || ""));

const normalizeTaskRow = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  title: repairTaskText(row.title),
  description: repairTaskText(row.description),
  notes: repairTaskText(row.notes || row.metadata?.notes || row.metadata?.note),
  task_title_ar: repairTaskText(row.task_title_ar || row.title_ar),
  task_description_ar: repairTaskText(row.task_description_ar || row.description_ar),
  task_notes_ar: repairTaskText(row.task_notes_ar || row.notes_ar || row.metadata?.notes_ar || row.metadata?.note_ar),
  title_ar: repairTaskText(row.title_ar || row.task_title_ar),
  description_ar: repairTaskText(row.description_ar || row.task_description_ar),
  notes_ar: repairTaskText(row.notes_ar || row.task_notes_ar || row.metadata?.notes_ar || row.metadata?.note_ar),
  task_type: row.task_type || "general",
  source_module: row.source_module || "operations",
  source_ref_type: row.source_ref_type || null,
  source_ref_id: row.source_ref_id || null,
  department: repairTaskText(row.department),
  role_key: repairTaskText(row.role_key),
  branch_id: row.branch_id || null,
  branch_name: repairTaskText(row.branch_name),
  warehouse_id: row.warehouse_id || null,
  warehouse_name: repairTaskText(row.warehouse_name),
  product_id: row.product_id || null,
  product_name: repairTaskText(row.product_name),
  variant_id: row.variant_id || null,
  product_image_url: row.product_image_url || row.metadata?.product_image_url || "",
  variant_image_url: row.variant_image_url || row.product_image_url || row.metadata?.variant_image_url || "",
  variant_sku: row.variant_sku || row.metadata?.variant_sku || "",
  variant_article_code: row.variant_article_code || row.metadata?.variant_article_code || "",
  variant_color: repairTaskText(row.variant_color || row.metadata?.variant_color || ""),
  variant_size: repairTaskText(row.variant_size || row.metadata?.variant_size || ""),
  product_grade: repairTaskText(row.product_grade || row.metadata?.product_grade || ""),
  assigned_employee_id: row.assigned_employee_id || null,
  current_assignee_id: row.current_assignee_id || null,
  assignee_name: repairTaskText(row.assignee_name),
  assignee_email: row.assignee_email || "",
  assigned_user_id: row.assigned_user_id || null,
  status: row.status || "pending",
  status_label_ar: TASK_STATUS_LABELS_AR[row.status || "pending"] || TASK_STATUS_LABELS_AR.pending,
  priority: row.priority || "medium",
  priority_label_ar: TASK_PRIORITY_LABELS_AR[row.priority || "medium"] || TASK_PRIORITY_LABELS_AR.medium,
  assigned_date: row.assigned_date || null,
  assigned_at: row.assigned_at || null,
  assignment_source: row.assignment_source || row.metadata?.assignment_source || "",
  assignment_event_id: row.assignment_event_id || row.metadata?.assignment_event_id || null,
  auto_assign_mode: row.auto_assign_mode || row.metadata?.auto_assign_mode || row.metadata?.assignment_strategy || "",
  due_at: row.due_at || null,
  started_at: row.started_at || null,
  completed_at: row.completed_at || null,
  completed_by: row.completed_by || null,
  auto_assigned: Boolean(row.auto_assigned),
  reassignment_count: Number(row.reassignment_count || 0),
  metadata: row.metadata || {},
  checklist_items: jsonArray(row.metadata?.checklist_items),
  photo_required: Boolean(row.metadata?.photo_required),
  qr_required: Boolean(row.metadata?.qr_required),
  gps_required: Boolean(row.metadata?.gps_required),
  recurring_rule: row.metadata?.recurring_rule || null,
  timeline: row.timeline || [],
  attachments_count: Number(row.attachments_count || 0),
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
  p.grade AS product_grade,
  v.sku AS variant_sku,
  v.article_code AS variant_article_code,
  v.color AS variant_color,
  v.size AS variant_size,
  COALESCE(
    NULLIF(v.image_url, ''),
    NULLIF(p.image_url, ''),
    NULLIF(p.image, ''),
    (
      SELECT NULLIF(pvi.image_url, '')
      FROM product_variant_images pvi
      WHERE pvi.variant_id = v.id OR (pvi.product_id = p.id AND LOWER(TRIM(COALESCE(pvi.color_name, ''))) = LOWER(TRIM(COALESCE(v.color, ''))))
      ORDER BY CASE WHEN pvi.variant_id = v.id THEN 0 ELSE 1 END, pvi.is_primary DESC, pvi.sort_order ASC, pvi.id ASC
      LIMIT 1
    ),
    ''
  ) AS product_image_url,
  COALESCE(attachments.attachments_count, 0) AS attachments_count,
  attachments.latest_attachment_url AS latest_attachment_url,
  attachments.latest_attachment_type AS latest_attachment_type,
  attachments.latest_attachment_name AS latest_attachment_name,
  COALESCE(history.timeline, '[]'::json) AS timeline,
  (sta.due_at IS NOT NULL AND sta.due_at < NOW() AND sta.status IN ('pending','in_progress')) AS is_overdue
`;

const taskJoins = `
  LEFT JOIN employees e ON e.id = sta.current_assignee_id
  LEFT JOIN branches b ON b.id = sta.branch_id
  LEFT JOIN warehouses w ON w.id = sta.warehouse_id
  LEFT JOIN products p ON p.id = sta.product_id
  LEFT JOIN product_variants v ON v.id = sta.variant_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS attachments_count,
      MAX(ta.created_at) AS latest_attachment_created_at,
      (
        SELECT ta2.url
        FROM task_attachments ta2
        WHERE ta2.task_id = sta.id
        ORDER BY ta2.created_at DESC, ta2.id DESC
        LIMIT 1
      ) AS latest_attachment_url,
      (
        SELECT ta2.attachment_type
        FROM task_attachments ta2
        WHERE ta2.task_id = sta.id
        ORDER BY ta2.created_at DESC, ta2.id DESC
        LIMIT 1
      ) AS latest_attachment_type,
      (
        SELECT ta2.metadata->>'name'
        FROM task_attachments ta2
        WHERE ta2.task_id = sta.id
        ORDER BY ta2.created_at DESC, ta2.id DESC
        LIMIT 1
      ) AS latest_attachment_name
    FROM task_attachments ta
    WHERE ta.task_id = sta.id
  ) attachments ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(json_agg(json_build_object(
      'id', h.id,
      'action', h.action,
      'from_status', h.from_status,
      'to_status', h.to_status,
      'note', h.note,
      'created_at', h.created_at
    ) ORDER BY h.created_at DESC), '[]'::json) AS timeline
    FROM (
      SELECT *
      FROM staff_task_history
      WHERE task_id = sta.id
      ORDER BY created_at DESC
      LIMIT 8
    ) h
  ) history ON TRUE
`;

const taskTitleAr = (task = {}) => firstText(task.task_title_ar, task.title_ar, task.title);
const taskDescriptionAr = (task = {}) => firstText(task.task_description_ar, task.description_ar, task.description);

const operationalMetadataFromPayload = (payload = {}, currentMetadata = {}) => ({
  ...jsonObject(currentMetadata),
  ...jsonObject(payload.metadata),
  checklist_items: jsonArray(payload.checklist_items ?? payload.checklistItems ?? currentMetadata?.checklist_items),
  photo_required: Boolean(payload.photo_required ?? payload.photoRequired ?? currentMetadata?.photo_required),
  qr_required: Boolean(payload.qr_required ?? payload.qrRequired ?? currentMetadata?.qr_required),
  gps_required: Boolean(payload.gps_required ?? payload.gpsRequired ?? currentMetadata?.gps_required),
  recurring_rule: jsonObject(payload.recurring_rule ?? payload.recurringRule ?? currentMetadata?.recurring_rule),
});

const validateTaskTransition = (fromStatus, toStatus, { source = "" } = {}) => {
  if (fromStatus === toStatus) return;
  const terminal = new Set(["completed", "cancelled", "rejected"]);
  if (terminal.has(fromStatus)) {
    const error = new Error("Task is already closed");
    error.statusCode = 409;
    error.code = "TASK_CLOSED";
    throw error;
  }
  const allowed = {
    pending: new Set(["in_progress", "overdue", "cancelled", "rejected"]),
    in_progress: new Set(["completed", "pending", "overdue", "cancelled", "rejected"]),
    overdue: new Set(["in_progress", "cancelled", "rejected"]),
    manager_review: new Set(["in_progress", "completed", "cancelled", "rejected"]),
    reassigned: new Set(["in_progress", "overdue", "cancelled", "rejected"]),
  };
  if (toStatus === "completed" && fromStatus !== "in_progress" && source === "employee_portal") {
    const error = new Error("Task must be started before completion");
    error.statusCode = 409;
    error.code = "TASK_MUST_START_FIRST";
    throw error;
  }
  if (!allowed[fromStatus]?.has(toStatus)) {
    const error = new Error(`Invalid task transition: ${fromStatus} -> ${toStatus}`);
    error.statusCode = 409;
    error.code = "INVALID_TASK_TRANSITION";
    throw error;
  }
};

export const markDueTasksOverdue = async ({ tenantId = null } = {}) => {
  await ensureStaffTasksSchema();
  const result = await db.query(
    `
    UPDATE staff_task_assignments
    SET status = 'overdue',
        escalated_at = COALESCE(escalated_at, NOW()),
        updated_at = NOW()
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND due_at IS NOT NULL
      AND due_at < NOW()
      AND status IN ('pending','in_progress')
    RETURNING *
    `,
    [tenantId]
  );
  for (const task of result.rows) {
    await logTaskHistory(db, {
      tenantId: task.tenant_id,
      taskId: task.id,
      action: "overdue_escalated",
      fromStatus: "pending",
      toStatus: "overdue",
      metadata: { due_at: task.due_at },
    }).catch(() => {});
    await sendTaskOverduePush(task);
    await emitTaskRealtime("task_overdue", task, {
      title: "مهمة متأخرة",
      message: taskTitleAr(task),
      metadata: { due_at: task.due_at, escalated: true },
    });
    await createNotification({
      tenant_id: task.tenant_id,
      role_key: "manager",
      branch_id: task.branch_id || null,
      type: "staff_task_overdue_escalation",
      category: "staff_tasks",
      priority: task.priority || "high",
      title: "تصعيد مهمة متأخرة",
      message: taskTitleAr(task),
      action_url: "/staff/tasks",
      action_label: "مراجعة المهمة",
      entity_type: "staff_task",
      entity_id: String(task.id),
      metadata: { task_id: task.id, due_at: task.due_at, employee_id: task.current_assignee_id },
    });
  }
  return result.rows.map(normalizeTaskRow);
};

// presentOnly is the default on purpose. This used to merely *sort* checked-in
// employees first and then hand callers row 0, so on a quiet branch — or at
// night, when everyone has checked out — the "best" candidate was somebody who
// was not at work. They got the task, the email and the push notification.
export const findEligibleEmployees = async (client, { tenantId, branchId = null, department = null, roleKey = null, presentOnly = true } = {}) => {
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
      AND ($6::boolean IS FALSE OR COALESCE(ta.attendance_status, 'absent') = 'checked_in')
    ORDER BY
      CASE WHEN COALESCE(ta.attendance_status, 'absent') = 'checked_in' THEN 0 ELSE 1 END,
      COALESCE(ot.open_count, 0) ASC,
      e.id ASC
    `,
    [...params, OPEN_STATUSES, Boolean(presentOnly)]
  );
  return result.rows || [];
};

const notifyTaskAssignment = async (client, task, assignee, eventType = "task_assigned") => {
  if (!task?.id || !assignee?.id) return;
  await createNotification({
    tenant_id: task.tenant_id,
    user_id: assignee.user_id || null,
    branch_id: task.branch_id,
    role_key: "manager",
    type: eventType,
    category: "staff_tasks",
    priority: task.priority,
    title: eventType === "task_reassigned" ? "تم إعادة تعيين مهمة" : "تم تعيين مهمة جديدة",
    message: taskTitleAr(task),
    action_url: "/staff/tasks",
    action_label: "فتح المهام",
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
      title_ar: taskTitleAr(task),
      description_ar: taskDescriptionAr(task),
      priority: task.priority,
      due_at: task.due_at,
      assignee_name: assignee.full_name,
    },
  });
  await sendTaskAssignedPush(task, assignee, eventType);
};

const emitTaskRealtime = async (eventType, task = {}, options = {}) => {
  if (!task?.id) return;
  emitStaffTaskEvent(eventType, task, options);
  if (options.persist === false) return;
  await createNotification({
    tenant_id: task.tenant_id,
    user_id: task.assigned_user_id || null,
    branch_id: task.branch_id || null,
    role_key: "manager",
    type: `staff_task_${eventType}`,
    category: "staff_tasks",
    priority: task.priority || "medium",
    title: options.title || "تحديث مهمة",
    message: options.message || taskTitleAr(task) || "تم تحديث مهمة",
    action_url: "/staff/tasks",
    action_label: "فتح المهام",
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

const templatePayloadFromTaskPayload = (payload = {}, actor = {}) => {
  const frequency = normalizeFrequency(payload.frequency ?? payload.recurring_rule?.frequency ?? payload.recurringRule?.frequency ?? payload.metadata?.recurring_rule?.frequency ?? "one_time");
  const priority = TASK_PRIORITIES.has(text(payload.priority).toLowerCase()) ? text(payload.priority).toLowerCase() : "medium";
  const weekdays = normalizeWeekdays(payload.weekdays ?? payload.recurring_rule?.weekdays ?? payload.recurringRule?.weekdays ?? []);
  const dayOfMonth = normalizeDayOfMonth(payload.day_of_month ?? payload.dayOfMonth ?? payload.recurring_rule?.day_of_month ?? payload.recurringRule?.dayOfMonth);
  const assignmentStrategy = normalizeAssignmentStrategy(payload.assignment_strategy ?? payload.assignmentStrategy);
  const autoAssignMode = normalizeAutoAssignMode(payload.auto_assign_mode ?? payload.autoAssignMode ?? payload.metadata?.auto_assign_mode ?? assignmentStrategy);
  const templateKind = normalizeTemplateKind(payload.template_kind ?? payload.templateKind ?? payload.metadata?.template_kind ?? "manual");
  return {
    tenantId: payload.tenantId ?? payload.tenant_id ?? resolveTaskTenantId(actor),
    title: text(payload.title),
    description: text(payload.description),
    titleAr: text(payload.task_title_ar ?? payload.title_ar ?? payload.titleAr ?? payload.title),
    descriptionAr: text(payload.task_description_ar ?? payload.description_ar ?? payload.descriptionAr ?? payload.description),
    taskType: text(payload.task_type ?? payload.taskType ?? "general"),
    priority,
    deadlineMinutes: Math.max(Number(payload.default_deadline_minutes ?? payload.deadlineMinutes ?? 480), 15),
    branchId: numberOrNull(payload.branch_id ?? payload.branchId),
    frequency,
    templateKind,
    isOpeningDayTask: booleanValue(payload.is_opening_day_task ?? payload.isOpeningDayTask ?? payload.metadata?.is_opening_day_task, false),
    weekdays,
    dayOfMonth,
    requiresCheckin: booleanValue(payload.requires_checkin ?? payload.requiresCheckin, false),
    requiresPhoto: booleanValue(payload.requires_photo ?? payload.requiresPhoto ?? payload.photo_required ?? payload.photoRequired, false),
    requiresQr: booleanValue(payload.requires_qr ?? payload.requiresQr ?? payload.qr_required ?? payload.qrRequired, false),
    requiresGps: booleanValue(payload.requires_gps ?? payload.requiresGps ?? payload.gps_required ?? payload.gpsRequired, false),
    autoAssignEnabled: booleanValue(payload.auto_assign_enabled ?? payload.autoAssignEnabled, false),
    assignmentStrategy,
    autoAssignMode,
    fixedEmployeeId: numberOrNull(payload.fixed_employee_id ?? payload.fixedEmployeeId ?? payload.employee_id ?? payload.employeeId),
    checklistItems: jsonArray(payload.checklist_items ?? payload.checklistItems),
    dueTime: normalizeDueTime(payload.due_time ?? payload.dueTime ?? payload.recurring_rule?.due_time ?? payload.recurringRule?.dueTime),
    createdBy: actor?.id || payload.created_by || null,
  };
};

export const saveStaffTaskTemplate = async (payload = {}, actor = {}) => {
  await ensureStaffTasksSchema();
  const data = templatePayloadFromTaskPayload(payload, actor);
  if (!data.title) throw new Error("Task template title is required");
  const recurringRule = {
    frequency: data.frequency,
    weekdays: data.weekdays,
    day_of_month: data.dayOfMonth,
    auto_assign_enabled: data.autoAssignEnabled,
    assignment_strategy: data.assignmentStrategy,
    auto_assign_mode: data.autoAssignMode,
    fixed_employee_id: data.fixedEmployeeId,
    // Only touch due_time when the caller sent it; the rule is merged with
    // ||, so a null here would erase a stored time.
    ...(payload.due_time !== undefined || payload.dueTime !== undefined ? { due_time: data.dueTime } : {}),
    // Opt-in for the background scheduler. Templates saved before the
    // scheduler existed stay manual (button-driven) until they are re-saved.
    auto_generate: true,
  };
  const id = numberOrNull(payload.template_id ?? payload.templateId);
  const result = id
    ? await db.query(
        `
        UPDATE staff_task_templates
        SET title = $1::text,
            description = $2::text,
            title_ar = $3::text,
            description_ar = $4::text,
            task_type = $5::text,
            priority = $6::text,
            default_deadline_minutes = $7::integer,
            branch_id = $8::bigint,
            recurrence = $9::text,
            frequency = $9::text,
            template_kind = $10::text,
            is_opening_day_task = $11::boolean,
            weekdays = $12::jsonb,
            day_of_month = $13::integer,
            requires_checkin = $14::boolean,
            requires_photo = $15::boolean,
            requires_qr = $16::boolean,
            requires_gps = $17::boolean,
            photo_required = $15::boolean,
            qr_required = $16::boolean,
            gps_required = $17::boolean,
            auto_assign_enabled = $18::boolean,
            assignment_strategy = $19::text,
            auto_assign_mode = $20::text,
            fixed_employee_id = $21::bigint,
            checklist_items = $22::jsonb,
            recurring_rule = recurring_rule || $23::jsonb,
            updated_at = NOW()
        WHERE id = $24::bigint
          AND ($25::bigint IS NULL OR tenant_id = $25::bigint)
        RETURNING *
        `,
        (() => {
          const values = [
            data.title,
            data.description,
            data.titleAr,
            data.descriptionAr,
            data.taskType,
            data.priority,
            data.deadlineMinutes,
            data.branchId,
            data.frequency,
            data.templateKind,
            data.isOpeningDayTask,
            JSON.stringify(data.weekdays),
            data.dayOfMonth,
            data.requiresCheckin,
            data.requiresPhoto,
            data.requiresQr,
            data.requiresGps,
            data.autoAssignEnabled,
            data.assignmentStrategy,
            data.autoAssignMode,
            data.fixedEmployeeId,
            JSON.stringify(data.checklistItems),
            JSON.stringify(recurringRule),
            id,
            data.tenantId,
          ];
          console.log("SQL PARAMS", { step: "saveStaffTaskTemplate:update", values });
          return values;
        })()
      )
    : await db.query(
        `
        INSERT INTO staff_task_templates (
          tenant_id, title, description, title_ar, description_ar, task_type, priority,
          default_deadline_minutes, recurrence, source_module, branch_id, frequency, template_kind, is_opening_day_task, weekdays,
          day_of_month, requires_checkin, requires_photo, requires_qr, requires_gps,
          photo_required, qr_required, gps_required, auto_assign_enabled, assignment_strategy,
          auto_assign_mode, fixed_employee_id, checklist_items, recurring_rule, created_by
        )
        VALUES ($1::bigint,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::integer,$9::text,'operations',$10::bigint,$9::text,$11::text,$12::boolean,$13::jsonb,$14::integer,$15::boolean,$16::boolean,$17::boolean,$18::boolean,$16::boolean,$17::boolean,$18::boolean,$19::boolean,$20::text,$21::text,$22::bigint,$23::jsonb,$24::jsonb,$25::bigint)
        RETURNING *
        `,
        (() => {
          const values = [
          data.tenantId,
          data.title,
          data.description,
          data.titleAr,
          data.descriptionAr,
          data.taskType,
          data.priority,
          data.deadlineMinutes,
          data.frequency,
          data.branchId,
          data.templateKind,
          data.isOpeningDayTask,
          JSON.stringify(data.weekdays),
          data.dayOfMonth,
          data.requiresCheckin,
          data.requiresPhoto,
          data.requiresQr,
          data.requiresGps,
          data.autoAssignEnabled,
          data.assignmentStrategy,
          data.autoAssignMode,
          data.fixedEmployeeId,
          JSON.stringify(data.checklistItems),
          JSON.stringify(recurringRule),
          data.createdBy,
          ];
          console.log("SQL PARAMS", { step: "saveStaffTaskTemplate:insert", values });
          return values;
        })()
      );
  const template = result.rows[0];
  console.log("[task-template-save]", {
    template_id: template?.id,
    tenant_id: template?.tenant_id,
    branch_id: template?.branch_id,
    frequency: template?.frequency,
    auto_assign_enabled: template?.auto_assign_enabled,
    assignment_strategy: template?.assignment_strategy,
  });
  return template;
};

export const deleteStaffTaskTemplate = async (templateId, actor = {}) => {
  await ensureStaffTasksSchema();
  const tenantId = resolveTaskTenantId(actor);
  const result = await db.query(
    `
    DELETE FROM staff_task_templates
    WHERE id = $1::bigint
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    RETURNING *
    `,
    [templateId, tenantId]
  );
  const template = result.rows[0] || null;
  if (!template) return null;
  await db.query(
    `
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details)
    VALUES ($1::bigint,$2::bigint,'staff_task_template.deleted','staff_task_template',$3::bigint,$4::jsonb)
    `,
    [
      template.tenant_id || null,
      actor?.id || null,
      template.id,
      JSON.stringify({
        title: template.title || "",
        title_ar: template.title_ar || "",
        template_kind: template.template_kind || "",
        task_type: template.task_type || "",
      }),
    ]
  );
  return template;
};

export const setStaffTaskTemplateActive = async (templateId, isActive, actor = {}) => {
  await ensureStaffTasksSchema();
  const tenantId = resolveTaskTenantId(actor);
  const result = await db.query(
    `
    UPDATE staff_task_templates
    SET is_active = $3::boolean, updated_at = NOW()
    WHERE id = $1::bigint
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    RETURNING *
    `,
    [numberOrNull(templateId), tenantId, Boolean(isActive)]
  );
  return result.rows[0] || null;
};

// Per-template adherence over the trailing window: how many instances were
// generated, how many of those closed as completed, and how many are still
// open past their due time. Drives the "fixed tasks" panel in the portal.
export const getStaffTaskTemplateCompliance = async ({ tenantId = null, branchId = null, days = 7 } = {}) => {
  await ensureStaffTasksSchema();
  const window = Math.min(Math.max(Number(days) || 7, 1), 90);
  const result = await db.query(
    `
    SELECT
      t.template_id,
      COUNT(*)::int AS generated,
      COUNT(*) FILTER (WHERE t.status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE t.status IN ('overdue') OR (t.status IN ('pending','in_progress','reassigned') AND t.due_at IS NOT NULL AND t.due_at < NOW()))::int AS late,
      MAX(t.completed_at) AS last_completed_at
    FROM staff_task_assignments t
    WHERE t.template_id IS NOT NULL
      AND ($1::bigint IS NULL OR t.tenant_id = $1::bigint)
      AND ($2::bigint IS NULL OR t.branch_id = $2::bigint OR t.branch_id IS NULL)
      AND COALESCE(t.assigned_date, t.created_at::date) >= (CURRENT_DATE - ($3::int - 1))
    GROUP BY t.template_id
    `,
    [numberOrNull(tenantId), numberOrNull(branchId), window]
  );
  return Object.fromEntries(result.rows.map((row) => [String(row.template_id), row]));
};

// Timer entry point: materialise today's instances for every tenant. Cheap
// when nothing is due — the generator skips existing instances before the
// create path — so it is safe to call every few minutes and survives
// restarts without missing a day.
let recurringGenerationInFlight = false;
export const generateRecurringTasksForToday = async () => {
  if (recurringGenerationInFlight) return { skipped: true, reason: "in_flight" };
  recurringGenerationInFlight = true;
  try {
    const today = dateKey();
    const result = await generateDueTaskInstancesFromTemplates({ tenantId: null, dueDate: today, actor: { source: "scheduler" }, onlyAutoGenerate: true });
    if (result.created.length) {
      console.info("[recurring-tasks] generated", { date: today, created: result.created.length });
    }
    return result;
  } finally {
    recurringGenerationInFlight = false;
  }
};

const isTemplateDueOnDate = (template = {}, dueDate = dateKey()) => {
  const templateKind = normalizeTemplateKind(template.template_kind || template.metadata?.template_kind);
  const frequency = normalizeFrequency(template.frequency || template.recurrence);
  const date = new Date(`${dueDate}T12:00:00`);
  const pinnedWeekdays = normalizeWeekdays(template.weekdays || template.recurring_rule?.weekdays);
  // A template with explicit weekdays only fires on those days, whatever its
  // kind. Without weekdays the legacy behaviour stands: daily every day,
  // weekly once per week (keyed on the week start).
  if (pinnedWeekdays.length) return pinnedWeekdays.includes(date.getDay());
  if (templateKind === "daily") return true;
  if (templateKind === "weekly") return true;
  if (frequency === "one_time") return false;
  if (frequency === "daily") return true;
  if (frequency === "weekly") {
    const weekdays = normalizeWeekdays(template.weekdays || template.recurring_rule?.weekdays);
    return weekdays.includes(date.getDay());
  }
  if (frequency === "monthly") {
    const day = normalizeDayOfMonth(template.day_of_month || template.recurring_rule?.day_of_month);
    return day === date.getDate();
  }
  return false;
};

// Which branches a template materialises into. A template pinned to a branch
// makes one instance there; a branch-less one is a tenant-wide routine and
// makes one per active branch. It used to make a single branch-less task that
// no check-in assigner could ever reach — they all filter on branch_id.
const resolveTemplateBranches = async (template = {}, fixedEmployeeId = null) => {
  const templateBranchId = numberOrNull(template.branch_id);
  if (templateBranchId) return [templateBranchId];
  const tenantId = numberOrNull(template.tenant_id);
  // A named employee pins the routine to wherever that employee works. Fanning
  // it out would hand one person the same task once per branch.
  if (fixedEmployeeId) {
    const result = await db.query(
      `SELECT branch_id FROM employees WHERE id = $1::bigint AND ($2::bigint IS NULL OR tenant_id = $2::bigint) LIMIT 1`,
      [fixedEmployeeId, tenantId]
    );
    const branchId = numberOrNull(result.rows[0]?.branch_id);
    return branchId ? [branchId] : [];
  }
  const result = await db.query(
    `
    SELECT id
    FROM branches
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND is_active IS DISTINCT FROM FALSE
    ORDER BY id ASC
    `,
    [tenantId]
  );
  return result.rows.map((row) => numberOrNull(row.id)).filter(Boolean);
};

export const generateDueTaskInstancesFromTemplates = async ({ tenantId = null, dueDate = dateKey(), templateId = null, actor = null, onlyAutoGenerate = false } = {}) => {
  await ensureStaffTasksSchema();
  const params = [tenantId, dueDate, numberOrNull(templateId), Boolean(onlyAutoGenerate)];
  const templatesResult = await db.query(
    `
    SELECT *, $2::date AS generation_due_date
    FROM staff_task_templates
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND ($3::bigint IS NULL OR id = $3::bigint)
      AND is_active IS DISTINCT FROM FALSE
      AND COALESCE(frequency, recurrence, 'one_time') <> 'one_time'
      AND ($4::boolean IS FALSE OR COALESCE(recurring_rule->>'auto_generate', 'false') = 'true')
    ORDER BY id ASC
    `,
    params
    );
  const created = [];
  const skipped = [];
  for (const template of templatesResult.rows) {
    if (!isTemplateDueOnDate(template, dueDate)) {
      skipped.push({ template_id: template.id, reason: "not_due" });
      continue;
    }
    const templateKind = normalizeTemplateKind(template.template_kind || template.metadata?.template_kind);
    const isOpeningDayTask = Boolean(template.is_opening_day_task || template.metadata?.is_opening_day_task);
    const pinnedWeekdays = normalizeWeekdays(template.weekdays || template.recurring_rule?.weekdays);
    // The instance always lands on the day it is generated for. It used to be
    // stamped with the week start for legacy weekly templates, which made it
    // born days overdue and left the check-in assigner (which searches by the
    // day) unable to find weekday-pinned weekly work at all.
    const scheduleDate = dateKey(dueDate);
    const weekKey = templateKind === "weekly" ? weekStartKey(dueDate) : null;
    // Dedupe only. A weekly template without pinned weekdays still yields one
    // instance per week; with pinned weekdays, one per pinned day.
    const dedupeKey = templateKind === "weekly" && !pinnedWeekdays.length ? weekKey : scheduleDate;
    const sourceRefType = templateKind === "daily" ? "daily_task_template" : templateKind === "weekly" ? "weekly_task_template" : "task_template";
    const taskType = templateKind === "daily" ? (isOpeningDayTask ? "opening_day" : "daily") : templateKind === "weekly" ? "weekly" : template.task_type;
    const fixedEmployeeId = numberOrNull(template.fixed_employee_id ?? template.recurring_rule?.fixed_employee_id);
    // A fixed assignee wins over attendance-driven auto-assign: the manager
    // named the person, so the instance is theirs from the moment it exists.
    const autoAssignEnabled = Boolean(template.auto_assign_enabled) && !fixedEmployeeId;
    const dueTime = normalizeDueTime(template.recurring_rule?.due_time);
    const dueAt = dueTime ? zonedDateTimeToUtc(scheduleDate, dueTime)?.toISOString() || null : null;
    const templateBranchId = numberOrNull(template.branch_id);
    const targetBranches = await resolveTemplateBranches(template, fixedEmployeeId);
    if (!targetBranches.length) {
      skipped.push({ template_id: template.id, reason: "no_target_branch" });
      continue;
    }
    const metadata = {
      recurring_template: true,
      template_kind: templateKind,
      is_opening_day_task: isOpeningDayTask,
      week_key: weekKey,
      recurring_rule: {
        frequency: template.frequency || template.recurrence,
        weekdays: normalizeWeekdays(template.weekdays || template.recurring_rule?.weekdays),
        day_of_month: normalizeDayOfMonth(template.day_of_month || template.recurring_rule?.day_of_month),
      },
      requires_checkin: Boolean(template.requires_checkin),
      photo_required: Boolean(template.requires_photo || template.photo_required),
      qr_required: Boolean(template.requires_qr || template.qr_required),
      gps_required: Boolean(template.requires_gps || template.gps_required),
      checklist_items: jsonArray(template.checklist_items),
      assignment_strategy: template.assignment_strategy,
      auto_assign_mode: normalizeAutoAssignMode(template.auto_assign_mode || template.assignment_strategy),
      assignment_state: fixedEmployeeId ? "assigned" : autoAssignEnabled ? "waiting_for_eligible_employee" : "unassigned",
      waiting_reason: autoAssignEnabled ? "waiting_for_attendance_qr" : null,
      assignment_source: fixedEmployeeId ? "template_fixed_employee" : null,
      due_time: dueTime,
      tenant_wide_template: !templateBranchId,
    };
    for (const branchId of targetBranches) {
      // A branch-pinned template keeps its historical key, so an instance already
      // generated today is still recognised. A fan-out needs the branch in the
      // key or the first branch would consume the whole day for the rest.
      const sourceRefId = templateBranchId ? `${template.id}:${dedupeKey}` : `${template.id}:${dedupeKey}:b${branchId}`;
      // The generator runs on a timer; skip cheaply before going through the
      // full create path (and its logging) for an instance that already exists.
      const existing = await db.query(
        `SELECT 1 FROM staff_task_assignments WHERE template_id = $1::bigint AND source_ref_id = $2::text LIMIT 1`,
        [template.id, sourceRefId]
      );
      if (existing.rows[0]) {
        skipped.push({ template_id: template.id, branch_id: branchId, reason: "exists" });
        continue;
      }
      const result = await createStaffTask({
        tenantId: template.tenant_id,
        template_id: template.id,
        branch_id: branchId,
        current_assignee_id: fixedEmployeeId,
        due_at: dueAt,
        allow_unassigned: true,
        // This IS the instance. Without it createStaffTask reads the
        // recurring_rule in metadata, re-saves the template (clobbering its
        // rule) and calls back into this generator — an infinite loop.
        force_instance: true,
        save_as_template: false,
        title: template.title,
        description: template.description,
        title_ar: template.title_ar,
        description_ar: template.description_ar,
        task_type: taskType,
        source_module: templateKind === "daily" || templateKind === "weekly" ? ATTENDANCE_TASK_SOURCE : "recurring_task_template",
        source_ref_type: sourceRefType,
        source_ref_id: sourceRefId,
        assigned_date: scheduleDate,
        priority: template.priority,
        default_deadline_minutes: template.default_deadline_minutes,
        auto_assigned: false,
        auto_assign_mode: normalizeAutoAssignMode(template.auto_assign_mode || template.assignment_strategy),
        metadata,
      }, actor || {});
      if (result.duplicate || !result.task) {
        skipped.push({ template_id: template.id, branch_id: branchId, reason: "duplicate" });
        continue;
      }
      console.log("[task-instance-generate]", {
        template_id: template.id,
        task_id: result.task.id,
        due_date: scheduleDate,
        branch_id: branchId,
        tenant_wide_template: !templateBranchId,
        assigned_employee_id: result.task.current_assignee_id || null,
        assignment_state: metadata.assignment_state,
      });
      created.push(result.task);
    }
  }
  return { created, skipped };
};

const logAttendanceTaskAutoAssign = (details = {}) => {
  console.info("[attendance-task-auto-assign]", {
    employee_id: details.employeeId ?? null,
    branch_id: details.branchId ?? null,
    attendance_event_id: details.attendanceEventId ?? null,
    task_id: details.taskId ?? null,
    assigned: Boolean(details.assigned),
    skip_reason: details.skipReason || null,
  });
};

export const assignWaitingRecurringTasksForCheckIn = async ({ tenantId, branchId, employeeId, attendanceDate = dateKey(), attendanceEventId = null, clientOrPool = db } = {}) => {
  await ensureStaffTasksSchema(clientOrPool);
  const dbClient = clientOrPool || db;
  const safeTenantId = numberOrNull(tenantId);
  const safeBranchId = numberOrNull(branchId);
  const safeEmployeeId = numberOrNull(employeeId);
  const safeAttendanceEventId = numberOrNull(attendanceEventId);
  const safeDate = dateKey(attendanceDate);
  if (!safeTenantId || !safeBranchId || !safeEmployeeId) {
    logAttendanceTaskAutoAssign({
      employeeId: safeEmployeeId,
      branchId: safeBranchId,
      attendanceEventId: safeAttendanceEventId,
      assigned: false,
      skipReason: "missing_required_ids",
    });
    return [];
  }
  const employeeResult = await dbClient.query(
    `
    SELECT e.*, u.email AS user_email
    FROM employees e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.id = $1
      AND e.tenant_id = $2
      AND e.branch_id = $3
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
    LIMIT 1
    `,
    [safeEmployeeId, safeTenantId, safeBranchId]
  );
  const employee = employeeResult.rows[0];
  if (!employee) {
    logAttendanceTaskAutoAssign({
      employeeId: safeEmployeeId,
      branchId: safeBranchId,
      attendanceEventId: safeAttendanceEventId,
      assigned: false,
      skipReason: "employee_not_eligible_for_branch",
    });
    return [];
  }

  const tasks = await dbClient.query(
    `
    SELECT sta.*, st.assignment_strategy, st.auto_assign_mode AS template_auto_assign_mode, st.requires_checkin, st.auto_assign_enabled
    FROM staff_task_assignments sta
    LEFT JOIN staff_task_templates st ON st.id = sta.template_id
    WHERE sta.tenant_id = $1
      AND sta.branch_id = $2
      AND sta.assigned_date = $3::date
      AND sta.current_assignee_id IS NULL
      AND sta.assigned_employee_id IS NULL
      AND sta.status = 'pending'
      AND (
        COALESCE(st.auto_assign_enabled, FALSE) IS TRUE
        OR COALESCE(sta.metadata->>'assignment_state', '') = 'waiting_for_eligible_employee'
      )
      AND (
        COALESCE(sta.auto_assign_mode, st.auto_assign_mode, sta.metadata->>'auto_assign_mode', sta.metadata->>'assignment_strategy', st.assignment_strategy, '') IN ('attendance_first_checkin','first_checked_in')
      )
    ORDER BY sta.due_at NULLS FIRST, sta.id ASC
    FOR UPDATE SKIP LOCKED
    `,
    [safeTenantId, safeBranchId, safeDate]
  );
  if (!tasks.rows.length) {
    logAttendanceTaskAutoAssign({
      employeeId: safeEmployeeId,
      branchId: safeBranchId,
      attendanceEventId: safeAttendanceEventId,
      assigned: false,
      skipReason: "no_pending_attendance_first_checkin_tasks",
    });
    return [];
  }

  const assigned = [];
  for (const task of tasks.rows) {
    const taskRole = nullableText(task.role_key);
    const taskDepartment = nullableText(task.department);
    const employeeRoleValues = [
      employee.role,
      employee.role_key,
      employee.job_title,
      employee.position,
      employee.department,
    ].map((value) => text(value).toLowerCase()).filter(Boolean);
    const employeeDepartment = text(employee.department).toLowerCase();
    if (taskDepartment && taskDepartment.toLowerCase() !== employeeDepartment && !employeeRoleValues.includes(taskDepartment.toLowerCase())) {
      logAttendanceTaskAutoAssign({
        employeeId: safeEmployeeId,
        branchId: safeBranchId,
        attendanceEventId: safeAttendanceEventId,
        taskId: task.id,
        assigned: false,
        skipReason: "department_not_eligible",
      });
      continue;
    }
    if (taskRole && !employeeRoleValues.includes(taskRole.toLowerCase())) {
      logAttendanceTaskAutoAssign({
        employeeId: safeEmployeeId,
        branchId: safeBranchId,
        attendanceEventId: safeAttendanceEventId,
        taskId: task.id,
        assigned: false,
        skipReason: "role_not_eligible",
      });
      continue;
    }

    const updated = await dbClient.query(
      `
      UPDATE staff_task_assignments
      SET current_assignee_id = $1::bigint,
          assigned_employee_id = $1::bigint,
          assigned_user_id = $2::bigint,
          auto_assigned = TRUE,
          assigned_at = NOW(),
          assignment_source = 'attendance_checkin_auto',
          assignment_event_id = $3::bigint,
          auto_assign_mode = 'attendance_first_checkin',
          metadata = metadata || $4::jsonb,
          updated_at = NOW()
      WHERE id = $5::bigint
        AND current_assignee_id IS NULL
        AND assigned_employee_id IS NULL
        AND status = 'pending'
      RETURNING *
      `,
      [
        safeEmployeeId,
        employee.user_id || null,
        safeAttendanceEventId,
        JSON.stringify({
          assignment_state: "assigned",
          assignment_reason: "attendance_checkin_auto",
          assignment_source: "attendance_checkin_auto",
          assignment_event_id: safeAttendanceEventId,
          auto_assign_mode: "attendance_first_checkin",
          auto_assignment: true,
          waiting_reason: null,
        }),
        task.id,
      ]
    );
    if (!updated.rows[0]) {
      logAttendanceTaskAutoAssign({
        employeeId: safeEmployeeId,
        branchId: safeBranchId,
        attendanceEventId: safeAttendanceEventId,
        taskId: task.id,
        assigned: false,
        skipReason: "already_claimed",
      });
      continue;
    }
    await logTaskHistory(dbClient, {
      tenantId: safeTenantId,
      taskId: task.id,
      action: "auto_assigned",
      fromStatus: task.status,
      toStatus: task.status,
      toEmployeeId: safeEmployeeId,
      note: "Assigned after employee check-in",
      metadata: {
        source: "attendance_checkin_auto",
        auto: true,
        strategy: task.assignment_strategy || task.template_auto_assign_mode || task.auto_assign_mode,
        attendance_event_id: safeAttendanceEventId,
      },
    });
    await notifyTaskAssignment(dbClient, updated.rows[0], employee, "task_assigned");
    await emitTaskRealtime("task_updated", updated.rows[0], {
      persist: false,
      title: "Task assigned after check-in",
      message: taskTitleAr(updated.rows[0]),
      metadata: {
        assignee_id: safeEmployeeId,
        source: "attendance_checkin_auto",
        auto: true,
        attendance_event_id: safeAttendanceEventId,
      },
    });
    await emitTaskRealtime("dashboard_refresh", updated.rows[0], {
      persist: false,
      metadata: {
        assignee_id: safeEmployeeId,
        source: "attendance_checkin_auto",
        attendance_event_id: safeAttendanceEventId,
      },
    });
    logAttendanceTaskAutoAssign({
      employeeId: safeEmployeeId,
      branchId: safeBranchId,
      attendanceEventId: safeAttendanceEventId,
      taskId: task.id,
      assigned: true,
    });
    assigned.push(normalizeTaskRow({ ...updated.rows[0], assignee_name: employee.full_name, assignee_email: employee.email || employee.user_email || "" }));
    break;
  }
  return assigned;
};

export const createStaffTask = async (payload = {}, actor = {}) => {
  await ensureStaffTasksSchema();
  if (!hasMeaningfulStaffTaskWork(payload, actor)) {
    console.log("STAFF_TASK_SCHEDULER_IDLE", {
      tenantId: payload.tenantId ?? payload.tenant_id ?? resolveTaskTenantId(actor) ?? null,
      templateId: payload.template_id ?? payload.templateId ?? null,
      actorId: actor?.id || null,
      reason: "no_work",
    });
    return { idle: true, duplicate: false, task: null };
  }
  console.time("staff-tasks-service:create");
  console.log("[staff-tasks-service] create:start", {
    actorId: actor?.id || null,
    tenantId: payload.tenantId ?? payload.tenant_id ?? resolveTaskTenantId(actor),
    templateId: payload.template_id ?? payload.templateId ?? null,
    frequency: payload.frequency ?? payload.recurring_rule?.frequency ?? payload.recurringRule?.frequency ?? payload.metadata?.recurring_rule?.frequency ?? null,
    templateKind: payload.template_kind ?? payload.templateKind ?? payload.metadata?.template_kind ?? null,
  });
  const frequency = normalizeFrequency(payload.frequency ?? payload.recurring_rule?.frequency ?? payload.recurringRule?.frequency ?? payload.metadata?.recurring_rule?.frequency);
  const saveAsTemplate = booleanValue(payload.save_as_template ?? payload.saveAsTemplate, frequency !== "one_time");
  if (saveAsTemplate && frequency !== "one_time" && !payload.force_instance) {
    try {
      console.log("[staff-tasks-service] create:step save_template");
      const template = await saveStaffTaskTemplate({ ...payload, frequency }, actor);
      console.log("[staff-tasks-service] create:step generate_instance", {
        templateId: template?.id || null,
        tenantId: template?.tenant_id || null,
      });
      const generated = await generateDueTaskInstancesFromTemplates({ tenantId: template.tenant_id, templateId: template.id, actor });
      console.log("[staff-tasks-service] create:done recurring", {
        templateId: template?.id || null,
        generatedCount: Array.isArray(generated?.created) ? generated.created.length : 0,
      });
      return { duplicate: false, template, task: generated.created[0] || null, generated };
    } catch (error) {
      logStaffTaskCreateFailure({ step: "save_recurring_template_or_generate_instance", payload, error });
      console.error("[staff-tasks-service] create:recurring:error", error);
      console.error(error);
      throw error;
    }
  }
  const client = await db.connect();
  let sqlStep = "begin";
  try {
    console.log("[staff-tasks-service] create:step begin");
    await client.query("BEGIN");
    sqlStep = "resolve_payload";
    console.log("[staff-tasks-service] create:step resolve_payload");
    const tenantId = payload.tenantId ?? payload.tenant_id ?? resolveTaskTenantId(actor);
    const priority = TASK_PRIORITIES.has(text(payload.priority).toLowerCase()) ? text(payload.priority).toLowerCase() : "medium";
    let assignee = null;
    const allowUnassigned = booleanValue(payload.allow_unassigned ?? payload.allowUnassigned, true);
    const requestedEmployeeId = numberOrNull(payload.current_assignee_id ?? payload.currentAssigneeId ?? payload.employee_id ?? payload.employeeId);
    if (requestedEmployeeId) {
      console.log("[staff-tasks-service] create:step resolve_assignee");
      const employeeResult = await client.query(
        `SELECT e.*, u.email AS user_email FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint) LIMIT 1`,
        [requestedEmployeeId, tenantId]
      );
      assignee = employeeResult.rows[0] || null;
    }
    if (!assignee && !allowUnassigned) {
      throw new Error("No eligible employee available for this task");
    }

    const deadlineMinutes = Math.max(Number(payload.default_deadline_minutes ?? payload.deadlineMinutes ?? 480), 15);
    const sourceRefType = nullableText(payload.source_ref_type ?? payload.sourceRefType);
    const sourceRefId = nullableText(payload.source_ref_id ?? payload.sourceRefId);
    const dueAt = payload.due_at || payload.dueAt || new Date(Date.now() + deadlineMinutes * 60 * 1000).toISOString();
    const assignedDate = dateKey(payload.assigned_date ?? payload.assignedDate);
    const title = text(payload.title || "مهمة تشغيلية");
    const description = text(payload.description);
    const titleAr = text(payload.task_title_ar ?? payload.title_ar ?? payload.titleAr ?? title);
    const descriptionAr = text(payload.task_description_ar ?? payload.description_ar ?? payload.descriptionAr ?? description);
    const notesAr = text(payload.task_notes_ar ?? payload.notes_ar ?? payload.notesAr ?? payload.metadata?.notes_ar ?? payload.metadata?.note_ar);
    const metadata = operationalMetadataFromPayload(payload, {
      created_from: payload.template_id || payload.templateId ? "template" : "manual",
    });
    const assignmentSource = nullableText(payload.assignment_source ?? payload.assignmentSource);
    const assignmentEventId = numberOrNull(payload.assignment_event_id ?? payload.assignmentEventId);
    const autoAssignMode = normalizeAutoAssignMode(payload.auto_assign_mode ?? payload.autoAssignMode ?? metadata.auto_assign_mode ?? metadata.assignment_strategy);
    sqlStep = "insert_staff_task_assignment";
    console.log("[staff-tasks-service] create:step insert", {
      tenantId,
      templateId: numberOrNull(payload.template_id ?? payload.templateId),
      assigneeId: assignee?.id || null,
      priority,
    });
    const result = await client.query(
      `
      INSERT INTO staff_task_assignments (
        tenant_id, template_id, title, description, title_ar, description_ar, notes_ar, task_type, source_module, source_ref_type, source_ref_id,
        department, role_key, branch_id, warehouse_id, product_id, variant_id, assigned_employee_id,
        current_assignee_id, assigned_user_id, status, priority, assigned_date, assigned_at, assignment_source, assignment_event_id, auto_assign_mode, due_at,
        auto_assigned, metadata, created_by, source_ref_date
      )
      VALUES ($1::bigint,$2::bigint,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::text,$13::text,$14::bigint,$15::bigint,$16::bigint,$17::bigint,$18::bigint,$18::bigint,$19::bigint,'pending',$20::text,$21::date,CASE WHEN $18::bigint IS NULL THEN NULL ELSE NOW() END,$22::text,$23::bigint,$24::text,$25::timestamp,$26::boolean,$27::jsonb,$28::bigint,$21::date)
      ON CONFLICT DO NOTHING
      RETURNING *
      `,
      [
        tenantId,
        numberOrNull(payload.template_id ?? payload.templateId),
        title,
        description,
        titleAr,
        descriptionAr,
        notesAr,
        text(payload.task_type ?? payload.taskType ?? "general"),
        text(payload.source_module ?? payload.sourceModule ?? "operations"),
        sourceRefType,
        sourceRefId,
        nullableText(payload.department),
        nullableText(payload.role_key ?? payload.roleKey ?? assignee?.role),
        numberOrNull(payload.branch_id ?? payload.branchId ?? assignee?.branch_id),
        numberOrNull(payload.warehouse_id ?? payload.warehouseId),
        numberOrNull(payload.product_id ?? payload.productId),
        numberOrNull(payload.variant_id ?? payload.variantId),
        assignee?.id || null,
        assignee?.user_id || null,
        priority,
        assignedDate,
        assignmentSource,
        assignmentEventId,
        autoAssignMode,
        dueAt,
        Boolean(payload.auto_assigned ?? payload.autoAssigned ?? assignee),
        JSON.stringify(metadata),
        actor?.id || payload.created_by || null,
      ]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return { duplicate: true, task: null };
    }
    const task = result.rows[0];
    sqlStep = "log_task_history";
    console.log("[staff-tasks-service] create:step history");
    await logTaskHistory(client, {
      tenantId,
      taskId: task.id,
      actorUserId: actor?.id,
      action: "created",
      toStatus: "pending",
      toEmployeeId: assignee?.id || null,
      metadata: { auto_assigned: Boolean(payload.auto_assigned ?? payload.autoAssigned) },
    });
    sqlStep = "insert_audit_log";
    await client.query(
      `
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details)
      VALUES ($1::bigint,$2::bigint,'staff_task.created','staff_task',$3::bigint,$4::jsonb)
      `,
      [tenantId, actor?.id || null, task.id, JSON.stringify({ title: task.title, title_ar: taskTitleAr(task), assignee_id: assignee?.id || null })]
    );
    sqlStep = "commit";
    console.log("[staff-tasks-service] create:step commit");
    await client.query("COMMIT");
    const postCommitSideEffects = async () => {
      console.log("[staff-tasks-service] create:step post_commit_side_effects");
      if (assignee) {
        console.log("[staff-tasks-service] create:step notify_assignment");
        await notifyTaskAssignment(db, task, assignee);
      }
      console.log("[staff-tasks-service] create:step emit_realtime");
      await emitTaskRealtime("task_created", task, {
        persist: false,
        title: "تم تعيين مهمة جديدة",
        message: taskTitleAr(task),
        metadata: { assignee_id: assignee?.id || null },
      });
      console.log("[staff-tasks-service] create:step post_commit_done");
    };
    void postCommitSideEffects().catch((sideEffectError) => {
      console.error("[staff-tasks-service] create:post_commit:error", sideEffectError);
      console.error(sideEffectError);
    });
    console.log("[staff-tasks-service] create:returning");
    return { duplicate: false, task: normalizeTaskRow({ ...task, assignee_name: assignee?.full_name || "", assignee_email: assignee?.email || assignee?.user_email || "" }) };
  } catch (error) {
    await client.query("ROLLBACK");
    logStaffTaskCreateFailure({ step: sqlStep, payload, error });
    console.error("[staff-tasks-service] create:error", error);
    console.error(error);
    throw error;
  } finally {
    client.release();
    console.timeEnd("staff-tasks-service:create");
  }
};

export const listStaffTasks = async (filters = {}, user = {}) => {
  await ensureStaffTasksSchema();
  const tenantId = filters.tenantId ?? resolveTaskTenantId(user);
  console.time("staff-tasks-service:list");
  console.log("[staff-tasks-service] list:start", {
    tenantId,
    branchId: filters.branch_id || filters.branchId || null,
    status: filters.status || null,
    today: filters.today || filters.view || null,
    employeeId: filters.employee_id || filters.employeeId || null,
  });
  const params = [tenantId];
  const clauses = ["($1::bigint IS NULL OR sta.tenant_id = $1::bigint)"];
  if (filters.status) {
    console.log("[staff-tasks-service] list:step status");
    params.push(String(filters.status).split(",").map((item) => item.trim()).filter(Boolean));
    clauses.push(`sta.status = ANY($${params.length}::text[])`);
  }
  if (filters.today === "true" || filters.view === "today") {
    console.log("[staff-tasks-service] list:step today");
    params.push(dateKey());
    clauses.push(`sta.assigned_date = $${params.length}::date`);
  }
  if (filters.priority) {
    console.log("[staff-tasks-service] list:step priority");
    params.push(String(filters.priority).split(",").map((item) => item.trim()).filter(Boolean));
    clauses.push(`sta.priority = ANY($${params.length}::text[])`);
  }
  if (filters.assignee === "me") {
    console.log("[staff-tasks-service] list:step assignee=me");
    const employee = await resolveEmployeeForUser(user, tenantId);
    params.push(employee?.id || 0);
    clauses.push(`sta.current_assignee_id = $${params.length}`);
  } else if (filters.employee_id || filters.employeeId) {
    console.log("[staff-tasks-service] list:step employee filter");
    params.push(filters.employee_id || filters.employeeId);
    // Deliberately no "…OR unassigned in my branch" escape hatch: it leaked one
    // task into every colleague's list and none of them could act on it.
    clauses.push(`sta.current_assignee_id = $${params.length}`);
  }
  if (filters.branch_id || filters.branchId) {
    console.log("[staff-tasks-service] list:step branch");
    params.push(filters.branch_id || filters.branchId);
    clauses.push(`sta.branch_id = $${params.length}`);
  }
  if (filters.assigned_date || filters.assignedDate) {
    console.log("[staff-tasks-service] list:step assigned_date");
    const assignedDate = String(filters.assigned_date || filters.assignedDate).toLowerCase();
    if (assignedDate === "today") {
      params.push(dateKey());
      clauses.push(`sta.assigned_date = $${params.length}::date`);
    } else {
      params.push(assignedDate);
      clauses.push(`sta.assigned_date = $${params.length}::date`);
    }
  }
  if (filters.search) {
    console.log("[staff-tasks-service] list:step search");
    params.push(`%${text(filters.search).toLowerCase()}%`);
    clauses.push(`LOWER(CONCAT_WS(' ', sta.title, sta.description, sta.task_type, e.full_name, p.name)) LIKE $${params.length}`);
  }
  const limit = Math.min(Math.max(Number(filters.limit || 80), 1), 200);
  console.log("[staff-tasks-service] list:before-query", {
    tenantId,
    limit,
    clauseCount: clauses.length,
    paramsPreview: params.map((value) => (Array.isArray(value) ? `[array:${value.length}]` : value)),
  });
  params.push(limit);
  try {
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
    console.log("[staff-tasks-service] list:query-result", {
      rowCount: result.rowCount,
      firstIds: result.rows.slice(0, 5).map((row) => row.id),
    });
    return result.rows.map(normalizeTaskRow);
  } finally {
    console.timeEnd("staff-tasks-service:list");
  }
};

export const listStaffTaskTemplates = async (filters = {}, user = {}) => {
  await ensureStaffTasksSchema();
  const tenantId = filters.tenantId ?? resolveTaskTenantId(user);
  const params = [tenantId];
  const clauses = ["($1::bigint IS NULL OR tenant_id = $1::bigint)"];
  if (filters.template_kind || filters.templateKind) {
    const templateKinds = String(filters.template_kind || filters.templateKind)
      .split(",")
      .map((item) => normalizeTemplateKind(item))
      .filter(Boolean);
    if (templateKinds.length) {
      params.push(templateKinds);
      clauses.push(`template_kind = ANY($${params.length}::text[])`);
    }
  } else {
    clauses.push(`template_kind IN ('daily','weekly')`);
  }
  if (filters.branch_id || filters.branchId) {
    params.push(filters.branch_id || filters.branchId);
    clauses.push(`(branch_id = $${params.length}::bigint OR branch_id IS NULL)`);
  }
  if (filters.search) {
    params.push(`%${text(filters.search).toLowerCase()}%`);
    clauses.push(`LOWER(CONCAT_WS(' ', title, description, task_type, template_kind)) LIKE $${params.length}`);
  }
  const limit = Math.min(Math.max(Number(filters.limit || 200), 1), 500);
  params.push(limit);
  const result = await db.query(
    `
    SELECT *
    FROM staff_task_templates
    WHERE ${clauses.join(" AND ")}
    ORDER BY
      CASE template_kind WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END,
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      id DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows.map((row) => ({
    ...row,
    template_kind: normalizeTemplateKind(row.template_kind),
    is_opening_day_task: Boolean(row.is_opening_day_task),
  }));
};

export const updateStaffTaskDetails = async (taskId, payload = {}, actor = {}) => {
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
    const nextFrequency = normalizeFrequency(payload.frequency ?? payload.recurring_rule?.frequency ?? payload.recurringRule?.frequency ?? payload.metadata?.recurring_rule?.frequency);
    if (booleanValue(payload.save_as_template ?? payload.saveAsTemplate, nextFrequency !== "one_time") && nextFrequency !== "one_time" && task.template_id) {
      await client.query("ROLLBACK");
      const template = await saveStaffTaskTemplate({ ...payload, frequency: nextFrequency, template_id: task.template_id }, actor);
      await generateDueTaskInstancesFromTemplates({ tenantId: template.tenant_id, templateId: template.id, actor });
      return normalizeTaskRow(task);
    }
    const assigneeId = numberOrNull(payload.current_assignee_id ?? payload.currentAssigneeId ?? payload.employee_id ?? payload.employeeId) || task.current_assignee_id;
    const assignee = assigneeId
      ? await client.query(
          `SELECT e.*, u.email AS user_email FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint) LIMIT 1`,
          [assigneeId, tenantId]
        )
      : { rows: [] };
    const nextAssignee = assignee.rows[0] || null;
    const priority = TASK_PRIORITIES.has(text(payload.priority).toLowerCase()) ? text(payload.priority).toLowerCase() : task.priority;
    const metadata = operationalMetadataFromPayload(payload, task.metadata);
    const result = await client.query(
      `
      UPDATE staff_task_assignments
      SET title = COALESCE(NULLIF($1::text, ''), title),
          description = COALESCE($2::text, description),
          title_ar = COALESCE($3::text, title_ar),
          description_ar = COALESCE($4::text, description_ar),
          notes_ar = COALESCE($5::text, notes_ar),
          task_type = COALESCE(NULLIF($6::text, ''), task_type),
          branch_id = COALESCE($7::bigint, branch_id),
          current_assignee_id = COALESCE($8::bigint, current_assignee_id),
          assigned_employee_id = CASE WHEN $8::bigint IS NULL THEN assigned_employee_id ELSE $8 END,
          assigned_user_id = COALESCE($9::bigint, assigned_user_id),
          assigned_at = CASE WHEN $8::bigint IS NOT NULL AND current_assignee_id IS DISTINCT FROM $8::bigint THEN NOW() ELSE assigned_at END,
          priority = $10::text,
          due_at = COALESCE($11::timestamp, due_at),
          metadata = $12::jsonb,
          updated_at = NOW()
      WHERE id = $13::bigint
      RETURNING *
      `,
      [
        text(payload.title),
        payload.description === undefined ? null : text(payload.description),
        payload.title_ar === undefined && payload.titleAr === undefined ? null : text(payload.title_ar ?? payload.titleAr),
        payload.description_ar === undefined && payload.descriptionAr === undefined ? null : text(payload.description_ar ?? payload.descriptionAr),
        payload.notes_ar === undefined && payload.notesAr === undefined ? null : text(payload.notes_ar ?? payload.notesAr),
        text(payload.task_type ?? payload.taskType),
        numberOrNull(payload.branch_id ?? payload.branchId),
        nextAssignee?.id || null,
        nextAssignee?.user_id || null,
        priority,
        payload.due_at || payload.dueAt || null,
        JSON.stringify(metadata),
        taskId,
      ]
    );
    const updated = result.rows[0];
    await logTaskHistory(client, {
      tenantId: task.tenant_id,
      taskId: task.id,
      actorUserId: actor?.id,
      action: "updated",
      fromStatus: task.status,
      toStatus: updated.status,
      fromEmployeeId: task.current_assignee_id,
      toEmployeeId: updated.current_assignee_id,
      metadata: { priority_from: task.priority, priority_to: updated.priority },
    });
    await client.query("COMMIT");
    const normalized = normalizeTaskRow({ ...updated, assignee_name: nextAssignee?.full_name || "" });
    await emitTaskRealtime("task_updated", normalized, {
      title: "تم تحديث المهمة",
      message: taskTitleAr(normalized),
      metadata: { details_updated: true },
    });
    if (String(task.current_assignee_id || "") !== String(updated.current_assignee_id || "") && nextAssignee) {
      await notifyTaskAssignment(db, updated, nextAssignee, "task_assigned");
    } else if (String(task.priority || "") !== String(updated.priority || "") || String(task.due_at || "") !== String(updated.due_at || "")) {
      await sendTaskUpdatedPush(normalized, { event: String(task.priority || "") !== String(updated.priority || "") ? "priority_changed" : "due_changed" });
    }
    return normalized;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
    if (!STRICT_TASK_STATUSES.has(nextStatus) && actor?.source === "employee_portal") {
      const error = new Error("Unsupported employee task status");
      error.statusCode = 400;
      error.code = "UNSUPPORTED_TASK_STATUS";
      throw error;
    }
    validateTaskTransition(task.status, nextStatus, { source: actor?.source || "" });
    const employee = await resolveEmployeeForUser(actor, tenantId, client);
    const nextPriority = TASK_PRIORITIES.has(text(payload.priority).toLowerCase()) ? text(payload.priority).toLowerCase() : task.priority;
    const dueAt = payload.due_at || payload.dueAt || task.due_at;
    const metadata = operationalMetadataFromPayload(payload, task.metadata);
    // Completion proof. The employee portal sends what it collected; the
    // template flags decide what is mandatory. Checked items persist as a
    // list of indexes so the manager sees exactly what was ticked.
    if (Array.isArray(payload.checklist_done ?? payload.checklistDone)) {
      metadata.checklist_done = (payload.checklist_done ?? payload.checklistDone)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0);
    }
    const completionPhotoUrl = nullableText(payload.completion_photo_url ?? payload.completionPhotoUrl);
    if (completionPhotoUrl) {
      metadata.completion_photo_url = completionPhotoUrl;
      metadata.completion_photo_at = new Date().toISOString();
    }
    if (nextStatus === "completed" && actor?.source === "employee_portal") {
      const checklist = jsonArray(metadata.checklist_items);
      const done = new Set(jsonArray(metadata.checklist_done));
      if (checklist.length && checklist.some((_, index) => !done.has(index))) {
        const error = new Error("Checklist incomplete");
        error.statusCode = 409;
        error.code = "TASK_CHECKLIST_INCOMPLETE";
        throw error;
      }
      if (metadata.photo_required && !metadata.completion_photo_url) {
        const error = new Error("Completion photo required");
        error.statusCode = 409;
        error.code = "TASK_PHOTO_REQUIRED";
        throw error;
      }
    }
    const result = await client.query(
      `
      UPDATE staff_task_assignments
      SET status = $1::varchar,
          priority = $5::varchar,
          started_at = CASE WHEN $1::varchar = 'in_progress' AND started_at IS NULL THEN NOW() ELSE started_at END,
          completed_at = CASE WHEN $1::varchar = 'completed' THEN NOW() ELSE completed_at END,
          cancelled_at = CASE WHEN $1::varchar = 'cancelled' THEN NOW() ELSE cancelled_at END,
          rejected_at = CASE WHEN $1::varchar = 'rejected' THEN NOW() ELSE rejected_at END,
          completed_by = CASE WHEN $1::varchar = 'completed' THEN $2::bigint ELSE completed_by END,
          due_at = $6::timestamp,
          metadata = $3::jsonb,
          updated_at = NOW()
      WHERE id = $4::bigint
      RETURNING *
      `,
      [nextStatus, employee?.id || null, JSON.stringify(metadata), taskId, nextPriority, dueAt]
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
      `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details) VALUES ($1::bigint,$2::bigint,$3::text,'staff_task',$4::bigint,$5::jsonb)`,
      [tenantId, actor?.id || null, `staff_task.${nextStatus}`, taskId, JSON.stringify({ from_status: task.status, to_status: nextStatus })]
    );
    await client.query("COMMIT");
    const updatedTask = normalizeTaskRow(result.rows[0]);
    await emitTaskRealtime("task_updated", updatedTask, {
      title: "تم تحديث المهمة",
      message: taskTitleAr(updatedTask),
      metadata: { from_status: task.status, to_status: nextStatus, from_priority: task.priority, to_priority: nextPriority },
    });
    if (task.status !== nextStatus) {
      await emitTaskRealtime(nextStatus === "completed" ? "task_completed" : "task_status_changed", updatedTask, {
        persist: nextStatus !== "completed",
        title: nextStatus === "completed" ? "تم إكمال المهمة" : "تم تغيير حالة المهمة",
        message: `${taskTitleAr(updatedTask)} - الحالة الآن ${nextStatus}`,
        metadata: { from_status: task.status, to_status: nextStatus },
      });
    }
    if (task.priority !== nextPriority) {
      await emitTaskRealtime("task_priority_changed", updatedTask, {
        title: "تم تغيير أولوية المهمة",
        message: `${taskTitleAr(updatedTask)} - الأولوية الآن ${nextPriority}`,
        metadata: { from_priority: task.priority, to_priority: nextPriority },
      });
    }
    if (
      task.status !== nextStatus ||
      task.priority !== nextPriority ||
      String(task.due_at || "") !== String(updatedTask.due_at || "")
    ) {
      await sendTaskUpdatedPush(updatedTask, {
        actorEmployeeId: actor?.source === "employee_portal" ? employee?.id : null,
        event: task.status !== nextStatus ? "status_changed" : task.priority !== nextPriority ? "priority_changed" : "due_changed",
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
      // Redistribution moves work *away from* an absent owner. Without this an
      // unassigned task matched the NOT EXISTS below (nothing joins to NULL),
      // so every five minutes the timer quietly flipped never-assigned tasks to
      // 'reassigned' and pushed them at whoever sorted first.
      clauses.push("sta.current_assignee_id IS NOT NULL");
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
        title: "تم إعادة تعيين المهمة",
        message: taskTitleAr(item.task),
        metadata: { assignee_id: item.assignee.id, reason },
      });
      await emitTaskRealtime("task_status_changed", item.task, {
        persist: false,
        title: "تم إعادة تعيين المهمة",
        message: `${taskTitleAr(item.task)} - تم إعادة تعيينها`,
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
      title: "تمت إضافة تعليق على المهمة",
      message: taskTitleAr(task),
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
      [task.tenant_id, actor?.id || null, task.id, JSON.stringify({ title: task.title, title_ar: taskTitleAr(task) })]
    );
    await client.query(`DELETE FROM staff_task_assignments WHERE id = $1`, [task.id]);
    await client.query("COMMIT");
    const postCommitSideEffects = async () => {
      await emitTaskRealtime("task_deleted", task, {
        title: "تم حذف المهمة",
        message: taskTitleAr(task),
        metadata: { deleted: true },
      });
    };
    void postCommitSideEffects().catch((sideEffectError) => {
      console.error("[staff-tasks-service] delete:post_commit:error", sideEffectError);
      console.error(sideEffectError);
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
  const eligibleEmployees = await findEligibleEmployees(db, { tenantId });
  // This runs on boot. Restarting at night used to mint twenty inventory tasks
  // and hand them to people who were not at work — or, with nobody eligible,
  // leave twenty orphans behind. No one on shift, no counting today.
  if (!eligibleEmployees.length) {
    console.info("[daily-inventory-count] skipped — no checked-in employee available", { tenant_id: tenantId });
    return [];
  }
  const employeeLoad = new Map(eligibleEmployees.map((employee) => [String(employee.id), Number(employee.open_task_count || 0)]));
  const pickNextEmployee = () => {
    const selected = eligibleEmployees
      .slice()
      .sort((a, b) => (employeeLoad.get(String(a.id)) || 0) - (employeeLoad.get(String(b.id)) || 0) || Number(a.id) - Number(b.id))[0] || null;
    if (selected) employeeLoad.set(String(selected.id), (employeeLoad.get(String(selected.id)) || 0) + 1);
    return selected;
  };

  // Older automatic inventory tasks were left unassigned, which made every employee see them.
  // Claim each one for exactly one employee before creating today's tasks.
  if (eligibleEmployees.length) {
    const unassigned = await db.query(
      `SELECT id FROM staff_task_assignments
       WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
         AND task_type = 'daily_inventory_count'
         AND current_assignee_id IS NULL
         AND status = ANY($2::text[])
       ORDER BY id ASC`,
      [tenantId, OPEN_STATUSES]
    );
    for (const task of unassigned.rows) {
      const employee = pickNextEmployee();
      if (!employee) break;
      await db.query(
        `UPDATE staff_task_assignments
         SET current_assignee_id = $1, assigned_employee_id = $1, assigned_user_id = $2,
             assigned_at = COALESCE(assigned_at, NOW()), assignment_source = 'balanced_inventory_distribution',
             metadata = metadata || $3::jsonb, updated_at = NOW()
         WHERE id = $4 AND current_assignee_id IS NULL`,
        [employee.id, employee.user_id || null, JSON.stringify({ assignment_strategy: "balanced_inventory_distribution" }), task.id]
      );
    }
  }
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
      v.article_code,
      v.color,
      v.size,
      p.grade,
      COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), '') AS image_url,
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
    const assignee = pickNextEmployee();
    const variantLabel = row.sku || row.variant_id;
    const result = await createStaffTask({
      tenantId,
      title: `جرد يومي للمخزون: ${row.product_name}`,
      description: `راجع المخزون الفعلي للمنتج ${variantLabel}. المخزون الحالي: ${row.stock}. المبيعات خلال 30 يوم: ${row.sold_30d}.`,
      title_ar: `جرد يومي للمخزون: ${row.product_name}`,
      description_ar: `راجع المخزون الفعلي للمنتج ${variantLabel}. المخزون الحالي: ${row.stock}. المبيعات خلال 30 يوم: ${row.sold_30d}.`,
      task_type: "daily_inventory_count",
      source_module: "warehouse",
      source_ref_type: "product_variant",
      source_ref_id: String(row.variant_id),
      department: "warehouse",
      priority: row.priority,
      product_id: row.product_id,
      variant_id: row.variant_id,
      current_assignee_id: assignee?.id || null,
      default_deadline_minutes: priorityWeight(row.priority) >= 4 ? 180 : 360,
      auto_assigned: true,
      metadata: {
        sold_30d: row.sold_30d,
        discrepancy_qty: row.discrepancy_qty,
        assignment_strategy: "balanced_inventory_distribution",
        product_image_url: row.image_url || "",
        variant_image_url: row.image_url || "",
        variant_sku: row.sku || "",
        variant_article_code: row.article_code || "",
        variant_color: row.color || "",
        variant_size: row.size || "",
        product_grade: row.grade || "",
      },
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
        title: "قائمة تجهيز افتتاح الفرع",
        description: "تأكد من جاهزية الفرع والكاونتر والإضاءة ومنطقة العملاء قبل بدء البيع.",
        title_ar: "قائمة تجهيز افتتاح الفرع",
        description_ar: "تأكد من جاهزية الفرع والكاونتر والإضاءة ومنطقة العملاء قبل بدء البيع.",
        task_type: "opening",
        priority: "high",
        deadlineMinutes: 90,
      },
      {
        key: "opening_display_walkthrough",
        title: "مراجعة عرض واجهة المحل",
        description: "راجع واجهة المحل وتأكد إن المنتجات الأكثر مبيعًا ظاهرة ومتنسقة بشكل صحيح.",
        title_ar: "مراجعة عرض واجهة المحل",
        description_ar: "راجع واجهة المحل وتأكد إن المنتجات الأكثر مبيعًا ظاهرة ومتنسقة بشكل صحيح.",
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
        title: "تنظيف مرايات العملاء",
        description: "نضف مرايات العملاء ومنطقة القياس، وبلغ عن أي تلف في التجهيزات.",
        title_ar: "تنظيف مرايات العملاء",
        description_ar: "نضف مرايات العملاء ومنطقة القياس، وبلغ عن أي تلف في التجهيزات.",
        task_type: "branch_cleaning",
        priority: "medium",
        deadlineMinutes: 180,
      },
      {
        key: "glass_cleaning",
        title: "تنظيف الزجاج والكاونتر",
        description: "نضف زجاج الواجهة وفاترينات العرض والكاونتر من غير ما تعطل حركة العملاء.",
        title_ar: "تنظيف الزجاج والكاونتر",
        description_ar: "نضف زجاج الواجهة وفاترينات العرض والكاونتر من غير ما تعطل حركة العملاء.",
        task_type: "branch_cleaning",
        priority: "medium",
        deadlineMinutes: 180,
      },
    ],
  },
];

const createDailyAttendanceTasksForPresentEmployees = async ({ tenantId, branchId, attendanceDate, presentEmployees }) => {
  if (!STATIC_ATTENDANCE_TASKS_ENABLED) return [];
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
        title_ar: task.title_ar,
        description_ar: task.description_ar,
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

const claimAttendanceTaskForEmployee = async (client, task, assignee, metadata = {}) => {
  const updated = await client.query(
    `
    UPDATE staff_task_assignments
    SET current_assignee_id = $1::bigint,
        assigned_employee_id = $1::bigint,
        assigned_user_id = $2::bigint,
        auto_assigned = TRUE,
        assigned_at = NOW(),
        assignment_source = 'attendance_checkin_auto',
        assignment_event_id = $3::bigint,
        auto_assign_mode = COALESCE($4::text, auto_assign_mode, 'attendance_first_checkin'),
        metadata = metadata || $5::jsonb,
        updated_at = NOW()
    WHERE id = $6::bigint
      AND current_assignee_id IS NULL
      AND assigned_employee_id IS NULL
      AND status = 'pending'
    RETURNING *
    `,
    [
      assignee.id,
      assignee.user_id || null,
      metadata.assignment_event_id || null,
      metadata.auto_assign_mode || "attendance_first_checkin",
      JSON.stringify(metadata),
      task.id,
    ]
  );
  if (!updated.rows[0]) return null;
  await logTaskHistory(client, {
    tenantId: task.tenant_id,
    taskId: task.id,
    action: "auto_assigned",
    fromStatus: task.status,
    toStatus: "pending",
    fromEmployeeId: task.current_assignee_id,
    toEmployeeId: assignee.id,
    note: metadata.note || "Assigned automatically after attendance check-in",
    metadata,
  });
  return updated.rows[0];
};

const assignDailyAttendanceTasksForCheckIn = async ({ tenantId, branchId, attendanceDate, presentEmployees, attendanceEventId = null }) => {
  if (!presentEmployees.length) return [];
  const client = await db.connect();
  const created = [];
  try {
    await client.query("BEGIN");
    await generateDueTaskInstancesFromTemplates({ tenantId, dueDate: attendanceDate });
    const taskResult = await client.query(
      `
      SELECT sta.*, COALESCE(st.is_opening_day_task, FALSE) AS is_opening_day_task
      FROM staff_task_assignments sta
      LEFT JOIN staff_task_templates st ON st.id = sta.template_id
      WHERE sta.tenant_id = $1
        AND sta.branch_id = $2
        AND sta.assigned_date = $3::date
        AND sta.source_module = $4
        AND sta.source_ref_type = 'daily_task_template'
        AND sta.current_assignee_id IS NULL
        AND sta.assigned_employee_id IS NULL
        AND sta.status = 'pending'
      ORDER BY COALESCE(st.is_opening_day_task, FALSE) DESC, CASE sta.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, sta.id ASC
      FOR UPDATE SKIP LOCKED
      `,
      [tenantId, branchId, attendanceDate, ATTENDANCE_TASK_SOURCE]
    );

    const openingEmployee = presentEmployees[0] || null;
    const normalEmployees = presentEmployees.length > 1 ? presentEmployees.slice(1) : presentEmployees.slice();
    const countsResult = await client.query(
      `
      SELECT current_assignee_id AS employee_id, COUNT(*)::int AS task_count
      FROM staff_task_assignments
      WHERE tenant_id = $1
        AND branch_id = $2
        AND assigned_date = $3::date
        AND source_module = $4
        AND source_ref_type = 'daily_task_template'
        AND task_type = 'daily'
        AND current_assignee_id IS NOT NULL
        AND status <> 'cancelled'
      GROUP BY current_assignee_id
      `,
      [tenantId, branchId, attendanceDate, ATTENDANCE_TASK_SOURCE]
    );
    const dailyCounts = new Map(countsResult.rows.map((row) => [String(row.employee_id), Number(row.task_count || 0)]));

    for (const task of taskResult.rows.filter((row) => Boolean(row.is_opening_day_task || row.task_type === "opening_day"))) {
      if (!openingEmployee) break;
      const updated = await claimAttendanceTaskForEmployee(client, task, openingEmployee, {
        assignment_reason: "opening_day",
        attendance_date: attendanceDate,
        branch_id: branchId,
        template_kind: "daily",
        is_opening_day_task: true,
        task_kind: "opening_day",
        assignment_event_id: attendanceEventId,
        source: "attendance_qr",
      });
      if (updated) {
        created.push(updated);
        dailyCounts.set(String(openingEmployee.id), Number(dailyCounts.get(String(openingEmployee.id)) || 0) + 1);
      }
    }

    const normalTasks = taskResult.rows.filter((row) => !(row.is_opening_day_task || row.task_type === "opening_day"));
    for (const task of normalTasks) {
      const candidatePool = normalEmployees.length ? normalEmployees : presentEmployees;
      if (!candidatePool.length) break;
      const assignee = candidatePool.slice().sort((a, b) => {
        const aCount = Number(dailyCounts.get(String(a.id)) || 0);
        const bCount = Number(dailyCounts.get(String(b.id)) || 0);
        if (aCount !== bCount) return aCount - bCount;
        const aTime = new Date(a.check_in_at || a.check_in || 0).getTime();
        const bTime = new Date(b.check_in_at || b.check_in || 0).getTime();
        if (aTime !== bTime) return aTime - bTime;
        return Number(a.id || 0) - Number(b.id || 0);
      })[0];
      const updated = await claimAttendanceTaskForEmployee(client, task, assignee, {
        assignment_reason: "daily_distribution",
        attendance_date: attendanceDate,
        branch_id: branchId,
        template_kind: "daily",
        is_opening_day_task: false,
        task_kind: "daily",
        assignment_event_id: attendanceEventId,
        source: "attendance_qr",
      });
      if (updated) {
        created.push(updated);
        dailyCounts.set(String(assignee.id), Number(dailyCounts.get(String(assignee.id)) || 0) + 1);
      }
    }

    await client.query("COMMIT");
    for (const task of created) {
      const assignee = presentEmployees.find((employee) => String(employee.id) === String(task.current_assignee_id));
      if (assignee) {
        await notifyTaskAssignment(db, task, assignee, "task_assigned");
      }
    }
    return created.map((task) => normalizeTaskRow(task));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const assignWeeklyAttendanceTasksForCheckIn = async ({ tenantId, branchId, attendanceDate, presentEmployees, attendanceEventId = null }) => {
  const client = await db.connect();
  const created = [];
  const weekStart = weekStartKey(attendanceDate);
  try {
    await client.query("BEGIN");
    await generateDueTaskInstancesFromTemplates({ tenantId, dueDate: attendanceDate });
    const taskResult = await client.query(
      `
      SELECT sta.*
      FROM staff_task_assignments sta
      WHERE sta.tenant_id = $1
        AND sta.branch_id = $2
        AND sta.assigned_date = ANY($3::date[])
        AND sta.source_module = $4
        AND sta.source_ref_type = 'weekly_task_template'
        AND sta.current_assignee_id IS NULL
        AND sta.assigned_employee_id IS NULL
        AND sta.status = 'pending'
      ORDER BY CASE sta.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, sta.id ASC
      FOR UPDATE SKIP LOCKED
      `,
      // Search by the day, not just the week start. Weekly instances are now
      // stamped with the day they are due; searching only the Monday of the
      // week meant every weekly routine that was not a Monday routine went
      // unassigned. weekStart stays in the list so rows generated under the
      // old stamping are still picked up.
      [tenantId, branchId, [...new Set([attendanceDate, weekStart])], ATTENDANCE_TASK_SOURCE]
    );
    const candidateEmployees = presentEmployees.length
      ? presentEmployees
      : await getPresentBranchEmployees(db, { tenantId, branchId, attendanceDate });

    for (const task of taskResult.rows) {
      if (!candidateEmployees.length) break;
      const history = await client.query(
        `
        SELECT current_assignee_id, source_ref_date
        FROM staff_task_assignments
        WHERE tenant_id = $1
          AND template_id = $2
          AND source_ref_type = 'weekly_task_template'
          AND current_assignee_id IS NOT NULL
          AND status <> 'cancelled'
        ORDER BY source_ref_date DESC NULLS LAST, id DESC
        LIMIT 20
        `,
        [tenantId, task.template_id]
      );
      const counts = await client.query(
        `
        SELECT current_assignee_id AS employee_id, COUNT(*)::int AS task_count
        FROM staff_task_assignments
        WHERE tenant_id = $1
          AND template_id = $2
          AND source_ref_type = 'weekly_task_template'
          AND current_assignee_id IS NOT NULL
          AND status <> 'cancelled'
        GROUP BY current_assignee_id
        `,
        [tenantId, task.template_id]
      );
      const countMap = new Map(counts.rows.map((row) => [String(row.employee_id), Number(row.task_count || 0)]));
      const lastAssigneeId = history.rows[0]?.current_assignee_id || null;
      let pool = candidateEmployees.slice();
      if (lastAssigneeId && pool.length > 1) {
        const withoutLast = pool.filter((employee) => String(employee.id) !== String(lastAssigneeId));
        if (withoutLast.length) pool = withoutLast;
      }
      const assignee = pool.sort((a, b) => {
        const aCount = Number(countMap.get(String(a.id)) || 0);
        const bCount = Number(countMap.get(String(b.id)) || 0);
        if (aCount !== bCount) return aCount - bCount;
        const aTime = new Date(a.check_in_at || a.check_in || 0).getTime();
        const bTime = new Date(b.check_in_at || b.check_in || 0).getTime();
        if (aTime !== bTime) return aTime - bTime;
        return Number(a.id || 0) - Number(b.id || 0);
      })[0];
      const updated = await claimAttendanceTaskForEmployee(client, task, assignee, {
        assignment_reason: "weekly_rotation",
        attendance_date: attendanceDate,
        branch_id: branchId,
        template_kind: "weekly",
        week_start: weekStart,
        week_key: weekStart,
        task_kind: "weekly",
        assignment_event_id: attendanceEventId,
        source: "attendance_qr",
      });
      if (updated) created.push(updated);
    }

    await client.query("COMMIT");
    for (const task of created) {
      const assignee = candidateEmployees.find((employee) => String(employee.id) === String(task.current_assignee_id));
      if (assignee) {
        await notifyTaskAssignment(db, task, assignee, "task_assigned");
      }
    }
    return created.map((task) => normalizeTaskRow(task));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
    const variantLabel = row.sku || row.variant_id;
    const result = await createStaffTask({
      tenantId,
      branch_id: branchId,
      employee_id: assignee.id,
      title: `جرد منتج سريع البيع: ${row.product_name}`,
      description: `عد مخزون الفرع للمنتج ${variantLabel}. المبيعات خلال 30 يوم: ${row.sold_qty}.`,
      title_ar: `جرد منتج سريع البيع: ${row.product_name}`,
      description_ar: `عد مخزون الفرع للمنتج ${variantLabel}. المبيعات خلال 30 يوم: ${row.sold_qty}.`,
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
        AND current_assignee_id IS NULL
        AND assigned_employee_id IS NULL
      ORDER BY due_at NULLS FIRST, id ASC
      FOR UPDATE
      `,
      [tenantId, branchId, attendanceDate, ATTENDANCE_TASK_SOURCE, OPEN_STATUSES]
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
            assigned_employee_id = $1,
            assigned_user_id = $2,
            status = 'pending',
            reassignment_count = reassignment_count + 1,
            assigned_at = NOW(),
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
        WHERE id = $4
          AND current_assignee_id IS NULL
          AND assigned_employee_id IS NULL
        RETURNING *
        `,
        [
          nextAssignee.id,
          nextAssignee.user_id || null,
          JSON.stringify({ assignment_source: "attendance_qr", auto_assignment: true, assignment_reason: "attendance_qr", attendance_date: attendanceDate }),
          task.id,
        ]
      );
      if (!updated.rows[0]) continue;
      await logTaskHistory(client, {
        tenantId,
        taskId: task.id,
        action: "auto_assigned",
        fromStatus: task.status,
        toStatus: "pending",
        fromEmployeeId: task.current_assignee_id,
        toEmployeeId: nextAssignee.id,
        note: "إعادة توزيع بعد تسجيل الحضور بالـ QR",
      });
      reassigned.push({ task: updated.rows[0], assignee: nextAssignee });
    }
    await client.query("COMMIT");
    for (const item of reassigned) {
      await notifyTaskAssignment(db, item.task, item.assignee, "task_assigned");
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
      AND sta.status = ANY($4::text[])
    ORDER BY sta.due_at NULLS LAST, sta.id ASC
    `,
    [tenantId, employeeId, branchId, OPEN_STATUSES]
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
    role_key: "manager",
    type: "staff_tasks_available",
    category: "staff_tasks",
    priority: "medium",
    title: "قائمة مهامك جاهزة",
    message: `لديك ${tasks.length} مهمة مخصصة لك اليوم.`,
    action_url: "/staff/tasks",
    action_label: "فتح المهام",
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
        subject: "مهام الفرع جاهزة",
        assignee_name: employee.full_name,
        subject_ar: "مهام الفرع جاهزة",
        message: "تم تحديث قائمة مهامك بعد تسجيل الحضور بالـ QR.",
        tasks: tasks.slice(0, 20).map((task) => ({
          id: task.id,
          title: task.title,
          title_ar: taskTitleAr(task),
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

// Tasks that exist for today but that nobody owns. Employees no longer see
// these, so the branch manager has to.
const countUnassignedBranchTasks = async ({ tenantId, branchId, attendanceDate }) => {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS unassigned_count
    FROM staff_task_assignments
    WHERE tenant_id = $1
      AND branch_id = $2
      AND assigned_date = $3::date
      AND current_assignee_id IS NULL
      AND assigned_employee_id IS NULL
      AND status = ANY($4::text[])
    `,
    [tenantId, branchId, attendanceDate, OPEN_STATUSES]
  );
  return Number(result.rows[0]?.unassigned_count || 0);
};

const notifyManagerAttendanceTaskState = async ({ tenantId, branchId, attendanceDate, redistributedCount, presentCount, unassignedCount = 0 }) => {
  if (unassignedCount > 0) {
    await createNotification({
      tenant_id: tenantId,
      role_key: "manager",
      branch_id: branchId,
      type: "staff_tasks_unassigned",
      category: "staff_tasks",
      priority: "high",
      title: "مهام بدون موظف",
      message: `${unassignedCount} مهمة اليوم لم يتم إسنادها لأي موظف.`,
      action_url: "/staff/tasks",
      action_label: "إسناد المهام",
      entity_type: "staff_task_unassigned",
      entity_id: `${branchId}:${attendanceDate}`,
      metadata: { branch_id: branchId, attendance_date: attendanceDate, unassigned_count: unassignedCount },
    });
  }

  if (redistributedCount > 0) {
    await createNotification({
      tenant_id: tenantId,
      role_key: "manager",
      branch_id: branchId,
      type: "staff_tasks_redistributed",
      category: "staff_tasks",
      priority: "medium",
      title: "تم إعادة توزيع مهام الفرع",
      message: `تم إعادة توزيع ${redistributedCount} مهمة بعد تسجيل الحضور بالـ QR.`,
      action_url: "/staff/tasks",
      action_label: "مراجعة المهام",
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
      title: "عدد الموظفين في الفرع منخفض",
      message: `تم تسجيل حضور ${presentCount} موظف فقط في هذا الفرع.`,
      action_url: "/attendance/today",
      action_label: "مراجعة الحضور",
      entity_type: "staffing_low",
      entity_id: `${branchId}:${attendanceDate}`,
      metadata: { branch_id: branchId, attendance_date: attendanceDate, present_count: presentCount, threshold: STAFFING_LOW_THRESHOLD },
    });
  }
};

export const handleBranchQrCheckInStaffTasks = async ({ tenantId, branchId, employeeId, actionType, attendanceDate = null, attendanceEventId = null } = {}) => {
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

  const generatedRecurring = await generateDueTaskInstancesFromTemplates({
    tenantId: safeTenantId,
    dueDate: safeDate,
  });

  const checkInAssigned = await assignWaitingRecurringTasksForCheckIn({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    employeeId: safeEmployeeId,
    attendanceDate: safeDate,
    attendanceEventId,
  });

  const dailyTasks = await assignDailyAttendanceTasksForCheckIn({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
    presentEmployees,
  });

  const weeklyTasks = await assignWeeklyAttendanceTasksForCheckIn({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
    presentEmployees,
    attendanceEventId,
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
  const unassignedCount = await countUnassignedBranchTasks({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
  });
  await notifyManagerAttendanceTaskState({
    tenantId: safeTenantId,
    branchId: safeBranchId,
    attendanceDate: safeDate,
    redistributedCount: redistributed.length,
    presentCount: presentEmployees.length,
    unassignedCount,
  });

  return {
    skipped: false,
    attendance_date: safeDate,
    present_count: presentEmployees.length,
    unassigned_task_count: unassignedCount,
    generated_recurring_tasks: generatedRecurring.created.length,
    checkin_assigned_tasks: checkInAssigned.length,
    created_daily_tasks: dailyTasks.length,
    created_weekly_tasks: weeklyTasks.length,
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
      AND status IN ('pending','in_progress')
    RETURNING *
    `,
    [tenantId]
  );
  for (const task of overdue.rows) {
    await sendTaskOverduePush(task);
    await emitTaskRealtime("task_overdue", task, {
      title: "مهمة متأخرة",
      message: taskTitleAr(task),
      metadata: { due_at: task.due_at },
    });
    await emitTaskRealtime("task_status_changed", task, {
      persist: false,
      title: "تم تحديث حالة المهمة",
      message: `${taskTitleAr(task)} أصبحت متأخرة`,
      metadata: { to_status: "overdue" },
    });
  }
  return redistributeTasks({ tenantId, reason: "deadline_overdue", actor });
};

export const sendOverdueTaskPushReminders = async ({ tenantId = null, limit = 100 } = {}) =>
  sendOverdueEmployeePortalTaskPushes({ tenantId, limit });

export const sendUpcomingTaskDueReminders = async ({ tenantId = null, minutesBefore = 30, limit = 100 } = {}) => {
  await ensureStaffTasksSchema();
  const result = await db.query(
    `
    UPDATE staff_task_assignments
    SET reminder_sent_at = NOW(),
        updated_at = NOW()
    WHERE id IN (
      SELECT id
      FROM staff_task_assignments
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND status IN ('pending','in_progress')
        AND due_at IS NOT NULL
        AND due_at > NOW()
        AND due_at <= NOW() + ($2::int * INTERVAL '1 minute')
        AND reminder_sent_at IS NULL
      ORDER BY due_at ASC
      LIMIT $3
    )
    RETURNING *
    `,
    [tenantId, Math.max(Number(minutesBefore || 30), 5), Math.min(Math.max(Number(limit || 100), 1), 500)]
  );
  for (const task of result.rows) {
    await sendTaskUpdatedPush(normalizeTaskRow(task), { event: "due_reminder" }).catch(() => {});
    await emitTaskRealtime("task_due_reminder", task, {
      title: "تذكير بمهمة قريبة",
      message: taskTitleAr(task),
      metadata: { due_at: task.due_at },
    });
  }
  return result.rows.map(normalizeTaskRow);
};

export const getStaffTaskDashboard = async ({ tenantId = null, branchId = null } = {}) => {
  await ensureStaffTasksSchema();
  const safeBranchId = numberOrNull(branchId);
  const attendanceDate = dateKey();
  console.time("staff-tasks-service:dashboard");
  console.log("[staff-tasks-service] dashboard:start", {
    tenantId,
    branchId: safeBranchId,
    attendanceDate,
  });
  try {
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
      WITH open_tasks AS (
        SELECT current_assignee_id AS employee_id, COUNT(*)::int AS open_count
        FROM staff_task_assignments
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND ($3::bigint IS NULL OR branch_id = $3::bigint)
          AND status = ANY($2::text[])
        GROUP BY current_assignee_id
      ),
      today_attendance AS (
        SELECT DISTINCT ON (employee_id)
          employee_id,
          check_in_at,
          check_in,
          check_out_at,
          check_out,
          status
        FROM attendance_logs
        WHERE attendance_date = $4::date
          AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND ($3::bigint IS NULL OR branch_id = $3::bigint)
        ORDER BY employee_id, created_at DESC, id DESC
      ),
      online_sessions AS (
        SELECT
          employee_id,
          MAX(last_seen_at) AS last_seen_at,
          BOOL_OR(last_seen_at >= NOW() - INTERVAL '5 minutes' AND expires_at > NOW()) AS is_online
        FROM employee_portal_sessions
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND ($3::bigint IS NULL OR branch_id = $3::bigint OR branch_id IS NULL)
        GROUP BY employee_id
      )
      SELECT
        e.id AS employee_id,
        e.full_name AS employee_name,
        COALESCE(e.photo_url, '') AS photo_url,
        e.job_title,
        e.position,
        e.role,
        e.department,
        COUNT(sta.id)::int AS total_tasks,
        COALESCE(ot.open_count, 0)::int AS open_tasks,
        COUNT(sta.id) FILTER (WHERE sta.status = 'completed')::int AS completed_tasks,
        COUNT(sta.id) FILTER (WHERE sta.due_at < NOW() AND sta.status = ANY($2::text[]))::int AS overdue_tasks,
        CASE
          WHEN COALESCE(os.is_online, FALSE) THEN 'online'
          WHEN ta.check_in_at IS NOT NULL OR ta.check_in IS NOT NULL THEN 'checked_in'
          ELSE 'absent'
        END AS attendance_status,
        (ta.check_in_at IS NOT NULL OR ta.check_in IS NOT NULL) AS checked_in_today,
        COALESCE(ta.check_in_at, ta.check_in) AS check_in_time,
        COALESCE(os.is_online, FALSE) AS is_online,
        os.last_seen_at AS online_last_seen_at,
        ROUND(
          CASE WHEN COUNT(sta.id) = 0 THEN 0
          ELSE COUNT(sta.id) FILTER (WHERE sta.status = 'completed')::numeric * 100 / COUNT(sta.id)::numeric END,
          2
        ) AS completion_rate
      FROM employees e
      LEFT JOIN staff_task_assignments sta ON sta.current_assignee_id = e.id
        AND ($1::bigint IS NULL OR sta.tenant_id = $1::bigint)
        AND ($3::bigint IS NULL OR sta.branch_id = $3::bigint)
      LEFT JOIN open_tasks ot ON ot.employee_id = e.id
      LEFT JOIN today_attendance ta ON ta.employee_id = e.id
      LEFT JOIN online_sessions os ON os.employee_id = e.id
      WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
        AND ($3::bigint IS NULL OR e.branch_id = $3::bigint)
        AND COALESCE(e.is_deleted, FALSE) = FALSE
        AND LOWER(COALESCE(e.status, 'active')) = 'active'
      GROUP BY e.id, e.full_name, e.photo_url, e.job_title, e.position, e.role, e.department, ot.open_count, ta.check_in_at, ta.check_in, os.is_online, os.last_seen_at
      ORDER BY
        CASE
          WHEN COALESCE(os.is_online, FALSE) THEN 0
          WHEN ta.check_in_at IS NOT NULL OR ta.check_in IS NOT NULL THEN 1
          ELSE 2
        END,
        open_tasks DESC,
        completion_rate DESC,
        e.full_name ASC
      LIMIT 30
      `,
      [tenantId, OPEN_STATUSES, safeBranchId, attendanceDate]
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
    console.log("[staff-tasks-service] dashboard:done", {
      tenantId,
      branchId: safeBranchId,
      summary: summary.rows[0] || null,
      recentCount: recent.rowCount,
      historyCount: history.rowCount,
    });
    return {
      summary: summary.rows[0] || { total: 0, open: 0, completed: 0, overdue: 0, urgent: 0 },
      byEmployee: byEmployee.rows,
      recentTasks: recent.rows.map(normalizeTaskRow),
      history: history.rows,
    };
  } finally {
    console.timeEnd("staff-tasks-service:dashboard");
  }
};


