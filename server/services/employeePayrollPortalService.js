import { randomBytes } from "node:crypto";

import db from "../database/db.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { calculateAttendanceMetrics, normalizeWorkingDays } from "../utils/attendanceCalculator.js";
import { getAttendanceTimeZone } from "../utils/attendanceTimezone.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import { createNotification } from "./notificationsService.js";
import { listStaffTasks, updateStaffTaskStatus } from "./staffTasksService.js";
import { ensureShiftResolutionSchema, resolveShiftForCheckIn } from "./attendanceShiftResolver.js";
import { sendEmployeePortalPush } from "./employeePortalPushService.js";
import { emitToRooms } from "../utils/socket.js";
import { ensureAccountingSchema, recordCashDrawerEvent } from "./accountingService.js";

const tokenBytes = 32;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const toAttendanceMinutes = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};

const clean = (value = "") => String(value || "").trim();
const normalizeAdvancePaymentMethod = (value = "") => {
  const normalized = clean(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["vodafone", "vodafone_cash", "wallet", "فودافون", "فودافون_كاش"].includes(normalized)) return "vodafone_cash";
  if (["insta", "instapay", "insta_pay", "انستا", "انستاباي"].includes(normalized)) return "instapay";
  return "cash";
};
const firstNonEmpty = (...values) => values.map((value) => clean(value)).find(Boolean) || "";
const employeePortalDebugEnabled = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.DEBUG_EMPLOYEE_PORTAL || "").toLowerCase());

const debugEmployeePortal = (message, payload = {}) => {
  if (!employeePortalDebugEnabled()) return;
  console.info(message, payload);
};

let employeePayrollPortalSchemaReady = false;
let employeePayrollPortalSchemaPromise = null;

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

const recordTiming = (timings, key, startedAt) => {
  if (!timings) return;
  timings[key] = nowMs() - startedAt;
};

const optionalSection = async ({ name, warnings, fallback, timeoutMs = 2500, fn }) => {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${name}_timeout`);
          error.code = `${name}_timeout`;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    warnings?.push?.({
      section: name,
      code: error?.code || `${name}_failed`,
      message: error?.message || `${name} failed`,
    });
    debugEmployeePortal("[employee-portal] optional section skipped", { section: name, error: error?.message || error });
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const safeTimeZone = (value = "") => {
  const timeZone = clean(value) || "Africa/Cairo";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return "Africa/Cairo";
  }
};

const localIsoDate = (value = new Date(), timeZone = "Africa/Cairo") => {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const degreesToRadians = (value) => (Number(value) * Math.PI) / 180;

const distanceMeters = (from = {}, to = {}) => {
  const fromLat = numberOrNull(from.latitude);
  const fromLon = numberOrNull(from.longitude);
  const toLat = numberOrNull(to.latitude);
  const toLon = numberOrNull(to.longitude);
  if (fromLat === null || fromLon === null || toLat === null || toLon === null) return null;
  const earthRadius = 6371000;
  const dLat = degreesToRadians(toLat - fromLat);
  const dLon = degreesToRadians(toLon - fromLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(degreesToRadians(fromLat)) *
      Math.cos(degreesToRadians(toLat)) *
      Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const employeeColumnCache = new Map();

const getEmployeeColumns = async (clientOrPool = db) => {
  if (employeeColumnCache.has("employees")) return employeeColumnCache.get("employees");
  const result = await clientOrPool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'employees'
    `
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  employeeColumnCache.set("employees", columns);
  return columns;
};

export const warmEmployeePayrollPortalMetadataCache = async (clientOrPool = db) => {
  await getEmployeeColumns(clientOrPool);
};

export const refreshEmployeePayrollPortalMetadataCache = async (clientOrPool = db) => {
  employeeColumnCache.delete("employees");
  return getEmployeeColumns(clientOrPool);
};

const optionalEmployeeColumn = (columns, name) =>
  columns.has(name) ? `e.${name}` : `NULL::text`;

const optionalEmployeeTextColumn = (columns, name, alias = name) =>
  columns.has(name) ? `e.${name}::text AS ${alias}` : `NULL::text AS ${alias}`;

const resolveEmployeePhotoValue = (employee = {}) =>
  firstNonEmpty(
    employee.photo_url,
    employee.image_url,
    employee.avatar_url,
    employee.profile_image_url,
    employee.profile_photo_url,
    employee.profile_image,
    employee.image,
    employee.photo,
    employee.employee_image,
    employee.cloudinary_url,
    employee.secure_url
  );

const monthBounds = (month = "", timeZone = "Africa/Cairo") => {
  const normalized = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month).slice(0, 7) : localIsoDate(new Date(), timeZone).slice(0, 7);
  const start = `${normalized}-01`;
  const end = new Date(Date.UTC(Number(normalized.slice(0, 4)), Number(normalized.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { month: normalized, start, end };
};

const weekdayCodes = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const normalizeWorkingDayCodes = (workingDays) =>
  normalizeWorkingDays(workingDays)
    .map((day) => String(day || "").trim().toLowerCase().slice(0, 3))
    .filter(Boolean);

const countExpectedWorkingDays = ({ workingDays, periodStart, periodEnd }) => {
  const days = new Set(normalizeWorkingDayCodes(workingDays));
  if (!days.size) return 0;
  const cursor = new Date(`${periodStart}T12:00:00Z`);
  const end = new Date(`${periodEnd}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return 0;
  let count = 0;
  while (cursor <= end) {
    if (days.has(weekdayCodes[cursor.getUTCDay()])) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
};

const previousIsoDate = (value) => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const attendanceDateKey = (value) => {
  if (!value) return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : raw.slice(0, 10);
};

const expectedWorkingDates = ({ workingDays, periodStart, periodEnd }) => {
  const days = new Set(normalizeWorkingDayCodes(workingDays));
  if (!days.size) return [];
  const cursor = new Date(`${periodStart}T12:00:00Z`);
  const end = new Date(`${periodEnd}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];
  const dates = [];
  while (cursor <= end) {
    if (days.has(weekdayCodes[cursor.getUTCDay()])) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const normalizeShiftForPortal = (row = null) => {
  if (!row) return null;
  const workingDays = normalizeWorkingDayCodes(row.working_days);
  const expectedHours = toNumber(row.expected_hours);
  return {
    id: row.id || null,
    shift_name: row.shift_name || "",
    shiftName: row.shift_name || "",
    start_time: row.start_time || "",
    startTime: row.start_time || "",
    end_time: row.end_time || "",
    endTime: row.end_time || "",
    expected_hours: expectedHours,
    expectedHours,
    working_days: workingDays,
    workingDays,
    allowed_late_minutes: Number(row.allowed_late_minutes || 0),
    overtime_after_minutes: Number(row.overtime_after_minutes || 0),
  };
};

const normalizeScheduledShiftForPortal = (row = null) => {
  if (!row) return null;
  const expectedHours = toNumber(row.expected_hours);
  return {
    id: row.id || null,
    schedule_id: row.id || null,
    work_date: row.work_date || null,
    workDate: row.work_date || null,
    branch_id: row.branch_id || null,
    branchId: row.branch_id || null,
    branch_name: row.branch_name || "",
    branchName: row.branch_name || "",
    shift_type: row.shift_type || "regular",
    shiftType: row.shift_type || "regular",
    shift_name: row.shift_name || "",
    shiftName: row.shift_name || "",
    start_time: row.start_time || "",
    startTime: row.start_time || "",
    end_time: row.end_time || "",
    endTime: row.end_time || "",
    expected_hours: expectedHours,
    expectedHours,
    source: row.source || "",
    status: row.status || "scheduled",
    isOpening: String(row.shift_type || "").toLowerCase() === "opening",
  };
};

export const generateEmployeePortalToken = () => randomBytes(tokenBytes).toString("hex");

export const ensureEmployeePayrollPortalSchema = async (clientOrPool = db) => {
  if (employeePayrollPortalSchemaReady) return;
  if (clientOrPool === db && employeePayrollPortalSchemaPromise) return employeePayrollPortalSchemaPromise;

  const runEnsure = async () => {
  await ensureAttendanceSchema(clientOrPool);
  await ensureShiftResolutionSchema(clientOrPool);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS employee_portal_token TEXT`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employee_portal_token ON employees (employee_portal_token) WHERE employee_portal_token IS NOT NULL AND employee_portal_token <> ''`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_portal_requests (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      request_type VARCHAR(40) NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      request_date DATE NULL,
      end_date DATE NULL,
      message TEXT,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      admin_note TEXT,
      reviewed_by BIGINT NULL,
      reviewed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_requests ADD COLUMN IF NOT EXISTS admin_note TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_requests ADD COLUMN IF NOT EXISTS reviewed_by BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_requests ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_requests ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40) NOT NULL DEFAULT 'cash'`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_portal_requests_employee_status ON employee_portal_requests (tenant_id, employee_id, status, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_portal_requests_employee_created ON employee_portal_requests (tenant_id, employee_id, created_at DESC, id DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_chat_threads (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      branch_id BIGINT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'open',
      last_message_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_threads ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_threads ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_threads ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'open'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_threads ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_threads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_chat_threads_employee ON employee_chat_threads (employee_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_chat_threads_tenant_last ON employee_chat_threads (tenant_id, last_message_at DESC NULLS LAST, updated_at DESC)`);
  /*
   * Branch POS channels ("كاشير فرع X") are threads with no employee: the
   * cashier side is whoever is on the POS at that branch. All three statements
   * are idempotent, so a restart never re-runs a failing migration.
   */
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_threads ALTER COLUMN employee_id DROP NOT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_threads ADD COLUMN IF NOT EXISTS channel_type VARCHAR(40) NOT NULL DEFAULT 'employee'`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_chat_threads_branch_pos ON employee_chat_threads (COALESCE(tenant_id, 0), branch_id) WHERE channel_type = 'branch_pos'`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      thread_id BIGINT NOT NULL REFERENCES employee_chat_threads(id) ON DELETE CASCADE,
      sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('employee', 'admin')),
      sender_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
      sender_user_id BIGINT NULL,
      body TEXT NOT NULL DEFAULT '',
      attachment_url TEXT NULL,
      read_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS sender_employee_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS sender_user_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS attachment_url TEXT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(40) NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS attachment_size BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS attachment_mime TEXT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS attachment_duration_seconds DOUBLE PRECISION NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS reply_to_message_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(160) NULL`);
  // Ring ("نداء"): an attention call that carries no audio; answered state lives on the row.
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS message_kind VARCHAR(20) NOT NULL DEFAULT 'text'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS ring_answered_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS ring_answered_by VARCHAR(160) NULL`);
  // P1: optimistic send + delivery ladder. client_id makes a retried send idempotent;
  // delivered_at is stamped when the other side's device receives the message.
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS chat_last_seen_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS client_id VARCHAR(64) NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_chat_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP NULL`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_chat_messages_client_id ON employee_chat_messages (thread_id, client_id) WHERE client_id IS NOT NULL`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_chat_messages_thread_created ON employee_chat_messages (thread_id, created_at ASC, id ASC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_chat_messages_unread ON employee_chat_messages (thread_id, sender_type, read_at) WHERE read_at IS NULL`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_chat_message_reactions (
      message_id BIGINT NOT NULL REFERENCES employee_chat_messages(id) ON DELETE CASCADE,
      actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('employee', 'admin')),
      actor_id BIGINT NOT NULL,
      emoji VARCHAR(16) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, actor_type, actor_id)
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_chat_reactions_message ON employee_chat_message_reactions (message_id)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_push_subscriptions (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL DEFAULT '',
      auth TEXT NOT NULL DEFAULT '',
      user_agent TEXT,
      portal_url TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_push_subscriptions ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_push_subscriptions ADD COLUMN IF NOT EXISTS portal_url TEXT NOT NULL DEFAULT ''`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_push_subscriptions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_push_subscriptions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_push_subscriptions_employee ON employee_push_subscriptions (employee_id, is_active, last_seen_at DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_push_delivery_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      subscription_id BIGINT NULL REFERENCES employee_push_subscriptions(id) ON DELETE SET NULL,
      tag TEXT NOT NULL DEFAULT '',
      status VARCHAR(40) NOT NULL,
      status_code INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      endpoint_host TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_push_delivery_employee ON employee_push_delivery_logs (employee_id, created_at DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_portal_notifications (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      type VARCHAR(120) NOT NULL,
      order_id BIGINT NULL,
      invoice_number VARCHAR(160) NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      action_url TEXT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      read_at TIMESTAMP NULL,
      dedupe_key TEXT NULL,
      cancelled_at TIMESTAMP NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS order_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(160) NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS action_url TEXT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_portal_notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await clientOrPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_portal_notifications_order_type
    ON employee_portal_notifications (tenant_id, employee_id, order_id, type)
    WHERE order_id IS NOT NULL
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_portal_notifications_employee_created ON employee_portal_notifications (tenant_id, employee_id, created_at DESC)`);
  await clientOrPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_portal_notifications_dedupe_key
    ON employee_portal_notifications (tenant_id, employee_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL
  `);
  await clientOrPool.query(`
    UPDATE employee_portal_notifications n
    SET cancelled_at = COALESCE(n.cancelled_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE n.type = 'commission_earned'
      AND n.order_id IS NOT NULL
      AND n.cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM employee_commissions c
        WHERE c.employee_id = n.employee_id
          AND c.order_id = n.order_id
          AND COALESCE(c.commission_amount, 0) > 0
      )
  `).catch(() => null);
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
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS employee_portal_request_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40) NOT NULL DEFAULT 'cash'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS shift_id BIGINT NULL`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_advances_portal_request ON employee_advances (employee_portal_request_id) WHERE employee_portal_request_id IS NOT NULL`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_advances_employee_status ON employee_advances (tenant_id, employee_id, deduction_status)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_advances_employee_created ON employee_advances (tenant_id, employee_id, created_at DESC, id DESC)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS attendance_logs ADD COLUMN IF NOT EXISTS device_ip TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS attendance_logs ADD COLUMN IF NOT EXISTS user_agent TEXT`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee_date_checkin ON attendance_logs (tenant_id, employee_id, attendance_date DESC, check_in_at DESC, check_in DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_portal_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NULL,
      action VARCHAR(80) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'success',
      ip_address TEXT,
      user_agent TEXT,
      device_id TEXT,
      latitude NUMERIC NULL,
      longitude NUMERIC NULL,
      gps_accuracy_meters NUMERIC NULL,
      gps_distance_meters NUMERIC NULL,
      gps_verification_result VARCHAR(40),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_portal_audit_employee ON employee_portal_audit_logs (tenant_id, employee_id, created_at DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_gamification_settings (
      tenant_id BIGINT PRIMARY KEY,
      attendance_weight NUMERIC(5,2) NOT NULL DEFAULT 30,
      sales_weight NUMERIC(5,2) NOT NULL DEFAULT 30,
      punctuality_weight NUMERIC(5,2) NOT NULL DEFAULT 20,
      customer_service_weight NUMERIC(5,2) NOT NULL DEFAULT 10,
      penalties_weight NUMERIC(5,2) NOT NULL DEFAULT 10,
      monthly_sales_target NUMERIC(12,2) NOT NULL DEFAULT 0,
      attendance_target_days INTEGER NOT NULL DEFAULT 26,
      branch_kpi_target NUMERIC(12,2) NOT NULL DEFAULT 0,
      points_per_attendance_day INTEGER NOT NULL DEFAULT 5,
      points_per_1000_sales INTEGER NOT NULL DEFAULT 2,
      points_per_badge INTEGER NOT NULL DEFAULT 50,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_reward_points (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      source_type VARCHAR(80) NOT NULL,
      source_ref VARCHAR(160) NULL,
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_reward_points_source ON employee_reward_points (tenant_id, employee_id, source_type, source_ref) WHERE source_ref IS NOT NULL`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_reward_points_employee ON employee_reward_points (tenant_id, employee_id, created_at DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_badge_awards (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL,
      badge_code VARCHAR(80) NOT NULL,
      badge_label VARCHAR(160) NOT NULL,
      period VARCHAR(7) NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_badge_awards_unique ON employee_badge_awards (tenant_id, employee_id, badge_code, period)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_admin_rewards (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL,
      reward_title VARCHAR(160) NOT NULL,
      points_cost INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'granted',
      admin_note TEXT,
      created_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_admin_rewards_employee ON employee_admin_rewards (tenant_id, employee_id, created_at DESC)`);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_goals (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL,
      period VARCHAR(7) NOT NULL,
      monthly_sales_target NUMERIC(12,2) NOT NULL DEFAULT 0,
      attendance_target_days INTEGER NOT NULL DEFAULT 26,
      branch_kpi_target NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, employee_id, period)
    )
  `);
  await clientOrPool.query(`
    DO $$
    BEGIN
      IF to_regclass('employee_payroll_runs') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_employee_payroll_runs_employee_period ON employee_payroll_runs (tenant_id, employee_id, payroll_period DESC, finalized_at DESC, id DESC);
      END IF;
      IF to_regclass('employee_tasks') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_tasks' AND column_name = 'tenant_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_tasks' AND column_name = 'employee_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_tasks' AND column_name = 'status')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_tasks' AND column_name = 'due_date')
      THEN
        CREATE INDEX IF NOT EXISTS idx_employee_tasks_employee_status_due ON employee_tasks (tenant_id, employee_id, status, due_date);
      END IF;
      IF to_regclass('staff_task_assignments') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS idx_staff_tasks_employee_status_due ON staff_task_assignments (tenant_id, assigned_employee_id, status, due_at);
      END IF;
    END $$;
  `);
  await getEmployeeColumns(clientOrPool);
  };

  if (clientOrPool !== db) {
    await runEnsure();
    return;
  }
  employeePayrollPortalSchemaPromise = runEnsure()
    .then(() => {
      employeePayrollPortalSchemaReady = true;
    })
    .finally(() => {
      employeePayrollPortalSchemaPromise = null;
    });
  return employeePayrollPortalSchemaPromise;
};

export const regenerateEmployeePortalToken = async ({ employeeId, tenantId = null, clientOrPool = db } = {}) => {
  if (!employeeId) {
    const error = new Error("Employee is required");
    error.status = 400;
    throw error;
  }

  await ensureAttendanceSchema(clientOrPool);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS employee_portal_token TEXT`);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateEmployeePortalToken();
    try {
      const result = await clientOrPool.query(
        `
        UPDATE employees
        SET employee_portal_token = $3,
            updated_at = NOW()
        WHERE id::text = $1::text
          AND COALESCE(is_deleted, FALSE) = FALSE
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        RETURNING id, employee_portal_token
        `,
        [employeeId, tenantId, token]
      );
      if (!result.rows[0]) {
        const error = new Error("Employee not found");
        error.status = 404;
        throw error;
      }
      return result.rows[0].employee_portal_token;
    } catch (error) {
      if (String(error?.code) === "23505" && attempt < 4) continue;
      throw error;
    }
  }

  const error = new Error("Unable to generate employee portal token");
  error.status = 500;
  throw error;
};

export const repairMissingEmployeePortalTokens = async ({ tenantId = null, clientOrPool = db, limit = 500 } = {}) => {
  await ensureEmployeePayrollPortalSchema(clientOrPool);
  const result = await clientOrPool.query(
    `
    SELECT id
    FROM employees
    WHERE COALESCE(is_deleted, FALSE) = FALSE
      AND LOWER(COALESCE(status, 'active')) = 'active'
      AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND (employee_portal_token IS NULL OR employee_portal_token = '')
    ORDER BY id ASC
    LIMIT $2
    `,
    [tenantId, Math.max(1, Math.min(Number(limit) || 500, 5000))]
  );

  const repaired = [];
  for (const row of result.rows) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = generateEmployeePortalToken();
      try {
        const update = await clientOrPool.query(
          `
          UPDATE employees
          SET employee_portal_token = $3,
              updated_at = NOW()
          WHERE id::text = $1::text
            AND COALESCE(is_deleted, FALSE) = FALSE
            AND LOWER(COALESCE(status, 'active')) = 'active'
            AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
            AND (employee_portal_token IS NULL OR employee_portal_token = '')
          RETURNING id, employee_portal_token
          `,
          [row.id, tenantId, token]
        );
        if (update.rows[0]) repaired.push(update.rows[0]);
        break;
      } catch (error) {
        if (String(error?.code) === "23505" && attempt < 4) continue;
        throw error;
      }
    }
  }

  return {
    scanned: result.rows.length,
    repaired_count: repaired.length,
    repaired,
  };
};

export const buildEmployeePortalLink = (token, req = null) => {
  const origin = getPublicAppUrl() || clean(process.env.PUBLIC_APP_URL);
  const normalizedOrigin = clean(origin).replace(/\/+$/, "");
  return normalizedOrigin ? `${normalizedOrigin}/employee-portal/${encodeURIComponent(token)}` : `/employee-portal/${encodeURIComponent(token)}`;
};

const getLatestPayrollRun = async ({ tenantId, employeeId }) => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS employee_payroll_runs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL,
      payroll_period VARCHAR(7) NOT NULL,
      payroll_reference VARCHAR(120) NOT NULL,
      base_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
      commissions NUMERIC(12,2) NOT NULL DEFAULT 0,
      bonuses NUMERIC(12,2) NOT NULL DEFAULT 0,
      manual_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
      advance_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
      penalties_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      attendance_deduction_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      total_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
      net_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'approved',
      payment_status VARCHAR(20) NOT NULL DEFAULT 'pending_payment',
      approved_at TIMESTAMP NULL,
      approved_by BIGINT NULL,
      paid_at TIMESTAMP NULL,
      paid_by BIGINT NULL,
      payment_method VARCHAR(40) NULL,
      payment_account_id BIGINT NULL,
      approval_journal_entry_id BIGINT NULL,
      payment_journal_entry_id BIGINT NULL,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      finalized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved'`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'pending_payment'`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS approved_by BIGINT NULL`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS paid_by BIGINT NULL`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40) NULL`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS payment_account_id BIGINT NULL`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS approval_journal_entry_id BIGINT NULL`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS payment_journal_entry_id BIGINT NULL`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS penalties_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE IF EXISTS employee_payroll_runs ADD COLUMN IF NOT EXISTS attendance_deduction_total NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_employee_payroll_runs_employee_period ON employee_payroll_runs (tenant_id, employee_id, payroll_period DESC, finalized_at DESC, id DESC)`);
  const result = await db.query(
    `
    SELECT *
    FROM employee_payroll_runs
    WHERE employee_id::text = $1::text
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    ORDER BY finalized_at DESC, id DESC
    LIMIT 1
    `,
    [employeeId, tenantId]
  );
  return result.rows[0] || null;
};

const getRecentAdvances = async ({ tenantId, employeeId }) => {
  try {
    const result = await db.query(
      `
      SELECT id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status, created_at
      FROM employee_advances
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY created_at DESC, id DESC
      LIMIT 20
      `,
      [employeeId, tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      amount: toNumber(row.amount),
      deducted_amount: toNumber(row.deducted_amount),
      remaining_amount: toNumber(row.remaining_amount),
      deduction_month: row.deduction_month,
      status: row.status || row.deduction_status || "pending",
      created_at: row.created_at,
    }));
  } catch {
    return [];
  }
};

const getActiveEmployeeShift = async ({ tenantId, employeeId }) => {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        shift_name,
        start_time::text AS start_time,
        end_time::text AS end_time,
        expected_hours,
        allowed_late_minutes,
        overtime_after_minutes,
        working_days
      FROM employee_shifts
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
      LIMIT 1
      `,
      [employeeId, tenantId]
    );
    return normalizeShiftForPortal(result.rows[0] || null);
  } catch (error) {
    debugEmployeePortal("[employee-portal] shift load failed", { employeeId, error: error?.message || error });
    return null;
  }
};

const getEmployeeScheduledShifts = async ({ tenantId, employeeId, timeZone = "Africa/Cairo" }) => {
  try {
    await ensureEmployeePayrollPortalSchema(db);
    const today = localIsoDate(new Date(), timeZone);
    const tomorrowDate = new Date(`${today}T12:00:00Z`);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);
    const result = await db.query(
      `
      SELECT
        s.id,
        s.employee_id,
        s.branch_id,
        b.name AS branch_name,
        s.work_date::text AS work_date,
        s.shift_type,
        s.shift_name,
        s.start_time::text AS start_time,
        s.end_time::text AS end_time,
        s.expected_hours,
        s.source,
        s.status
      FROM employee_shift_schedules s
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE s.employee_id::text = $1::text
        AND ($2::bigint IS NULL OR s.tenant_id = $2::bigint)
        AND s.work_date BETWEEN $3::date AND $4::date
        AND LOWER(COALESCE(s.status, 'scheduled')) <> 'cancelled'
      ORDER BY s.work_date ASC, s.start_time ASC, s.id ASC
      `,
      [employeeId, tenantId, today, tomorrow]
    );
    const shifts = result.rows.map(normalizeScheduledShiftForPortal).filter(Boolean);
    return {
      today: shifts.find((shift) => String(shift.work_date).slice(0, 10) === today) || null,
      tomorrow: shifts.find((shift) => String(shift.work_date).slice(0, 10) === tomorrow) || null,
      upcoming: shifts,
    };
  } catch (error) {
    debugEmployeePortal("[employee-portal] scheduled shifts load failed", { employeeId, error: error?.message || error });
    return { today: null, tomorrow: null, upcoming: [] };
  }
};

const getAttendanceSummary = async ({ tenantId, employeeId, periodStart, periodEnd, currentShift = null, timeZone = "Africa/Cairo" }) => {
  try {
    const [result, exclusionsResult] = await Promise.all([
      db.query(
      `
      SELECT
        COUNT(*)::int AS records_count,
        COUNT(*) FILTER (WHERE COALESCE(check_in_at, check_in) IS NOT NULL)::int AS attended_days,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'absent')::int AS absence_days,
        COALESCE(ARRAY_AGG(attendance_date::text) FILTER (WHERE attendance_date IS NOT NULL), ARRAY[]::text[]) AS recorded_dates,
        COALESCE(ARRAY_AGG(attendance_date::text) FILTER (WHERE LOWER(COALESCE(status, '')) = 'absent'), ARRAY[]::text[]) AS explicit_absence_dates,
        COUNT(*) FILTER (WHERE COALESCE(late_minutes, 0) > 0 OR LOWER(COALESCE(status, '')) = 'late')::int AS late_days,
        COUNT(*) FILTER (WHERE COALESCE(check_out_at, check_out) IS NULL AND COALESCE(check_in_at, check_in) IS NOT NULL)::int AS missing_checkout_days,
        COALESCE(SUM(overtime_minutes), 0) AS overtime_minutes,
        COALESCE(SUM(late_minutes), 0) AS late_minutes
      FROM attendance_logs
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND attendance_date BETWEEN $3::date AND $4::date
      `,
      [employeeId, tenantId, periodStart, periodEnd]
      ),
      db.query(
        `
        SELECT DISTINCT excluded_date::text AS excluded_date
        FROM (
          SELECT GENERATE_SERIES(COALESCE(leave_date, start_date), COALESCE(leave_date, end_date, start_date), INTERVAL '1 day')::date AS excluded_date
          FROM employee_leaves
          WHERE employee_id::text = $1::text
            AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
            AND LOWER(COALESCE(status, '')) = 'approved'
            AND COALESCE(leave_date, start_date) <= $4::date
            AND COALESCE(leave_date, end_date, start_date) >= $3::date
          UNION ALL
          SELECT GENERATE_SERIES(COALESCE(vacation_date, start_date), COALESCE(vacation_date, end_date, start_date), INTERVAL '1 day')::date AS excluded_date
          FROM employee_vacations
          WHERE employee_id::text = $1::text
            AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
            AND LOWER(COALESCE(status, '')) = 'approved'
            AND COALESCE(vacation_date, start_date) <= $4::date
            AND COALESCE(vacation_date, end_date, start_date) >= $3::date
          UNION ALL
          SELECT holiday_date::date AS excluded_date
          FROM holidays
          WHERE ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
            AND holiday_date BETWEEN $3::date AND $4::date
        ) excluded
        `,
        [employeeId, tenantId, periodStart, periodEnd]
      ),
    ]);
    const row = result.rows[0] || {};
    const recordedDates = new Set((row.recorded_dates || []).map((date) => String(date).slice(0, 10)));
    const excludedDates = new Set(exclusionsResult.rows.map((item) => String(item.excluded_date).slice(0, 10)));
    const explicitAbsenceDates = (row.explicit_absence_dates || []).map((date) => String(date).slice(0, 10));
    const yesterday = previousIsoDate(localIsoDate(new Date(), timeZone));
    const elapsedPeriodEnd = periodEnd < yesterday ? periodEnd : yesterday;
    const generatedAbsenceDates = elapsedPeriodEnd < periodStart ? [] : expectedWorkingDates({
      workingDays: currentShift?.working_days || currentShift?.workingDays || [],
      periodStart,
      periodEnd: elapsedPeriodEnd,
    }).filter((date) => !recordedDates.has(date) && !excludedDates.has(date));
    const absenceDates = [...new Set([...explicitAbsenceDates, ...generatedAbsenceDates])].sort();
    const expectedWorkingDays = countExpectedWorkingDays({
      workingDays: currentShift?.working_days || currentShift?.workingDays || [],
      periodStart,
      periodEnd,
    });
    return {
      records_count: Number(row.records_count || 0),
      attended_days: Number(row.attended_days || 0),
      absence_days: absenceDates.length,
      absence_dates: absenceDates,
      late_days: Number(row.late_days || 0),
      missing_checkout_days: Number(row.missing_checkout_days || 0),
      overtime_hours: Number(((Number(row.overtime_minutes || 0)) / 60).toFixed(2)),
      late_minutes: Number(row.late_minutes || 0),
      expected_working_days: expectedWorkingDays,
      period_start: periodStart,
      period_end: periodEnd,
    };
  } catch {
    return {
      records_count: 0,
      attended_days: 0,
      absence_days: 0,
      absence_dates: [],
      late_days: 0,
      missing_checkout_days: 0,
      overtime_hours: 0,
      late_minutes: 0,
      expected_working_days: countExpectedWorkingDays({
        workingDays: currentShift?.working_days || currentShift?.workingDays || [],
        periodStart,
        periodEnd,
      }),
      period_start: periodStart,
      period_end: periodEnd,
    };
  }
};

const getAttendanceTimeline = async ({ tenantId, employeeId, periodStart, periodEnd, currentShift = null }) => {
  try {
    const result = await db.query(
      `
      SELECT
        al.id,
        al.attendance_date,
        COALESCE(check_in_at, check_in) AS check_in,
        COALESCE(check_out_at, check_out) AS check_out,
        COALESCE(status, '') AS status,
        COALESCE(late_minutes, 0) AS late_minutes,
        COALESCE(early_leave_minutes, 0) AS early_leave_minutes,
        COALESCE(overtime_minutes, 0) AS overtime_minutes,
        COALESCE(notes, '') AS notes,
        COALESCE(al.selected_shift_id, al.shift_id) AS selected_shift_id,
        COALESCE(al.resolved_shift_start_time::text, s.start_time::text, '') AS resolved_shift_start_time,
        COALESCE(al.resolved_shift_end_time::text, s.end_time::text, '') AS resolved_shift_end_time,
        COALESCE(s.shift_name, '') AS shift_name
      FROM attendance_logs al
      LEFT JOIN employee_shifts s
        ON s.id = COALESCE(al.selected_shift_id, al.shift_id)
       AND s.employee_id::text = al.employee_id::text
      WHERE al.employee_id::text = $1::text
        AND ($2::bigint IS NULL OR al.tenant_id = $2::bigint)
        AND al.attendance_date BETWEEN $3::date AND $4::date
      ORDER BY al.attendance_date DESC
      LIMIT 31
      `,
      [employeeId, tenantId, periodStart, periodEnd]
    );
    return result.rows.map((row) => ({
      id: row.id,
      date: row.attendance_date,
      check_in: row.check_in,
      check_out: row.check_out,
      status: row.status || (row.check_in ? "present" : "absent"),
      late_minutes: Number(row.late_minutes || 0),
      attendance_status: Number(row.late_minutes || 0) > 0 ? "late" : "on_time",
      early_leave_minutes: Number(row.early_leave_minutes || 0),
      overtime_hours: Number((Number(row.overtime_minutes || 0) / 60).toFixed(2)),
      notes: row.notes || "",
      selected_shift_id: row.selected_shift_id || null,
      shift_id: row.selected_shift_id || null,
      shift_name: row.shift_name || currentShift?.shift_name || currentShift?.shiftName || "",
      resolved_shift_start_time: row.resolved_shift_start_time || currentShift?.start_time || currentShift?.startTime || "",
      resolved_shift_end_time: row.resolved_shift_end_time || currentShift?.end_time || currentShift?.endTime || "",
    }));
  } catch {
    return [];
  }
};

const getPortalRequestsForEmployee = async ({ tenantId, employeeId }) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    SELECT id, request_type, amount, request_date, end_date, message, status, admin_note, reviewed_by, created_at, reviewed_at
    FROM employee_portal_requests
    WHERE employee_id::text = $1::text
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    ORDER BY created_at DESC, id DESC
    LIMIT 10
    `,
    [employeeId, tenantId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    request_type: row.request_type,
    type: row.request_type,
    amount: toNumber(row.amount),
    request_date: row.request_date,
    end_date: row.end_date,
    message: row.message || "",
    status: row.status || "pending",
    admin_note: row.admin_note || "",
    decision_date: row.reviewed_at || null,
    reviewed_by: row.reviewed_by || null,
    decision_by: row.reviewed_by || null,
    approved_rejected_by: row.reviewed_by || null,
    created_at: row.created_at,
    reviewed_at: row.reviewed_at,
  }));
};

export const loadEmployeePortalByToken = async (token) => {
  await ensureEmployeePayrollPortalSchema(db);
  const columns = await getEmployeeColumns(db);
  const result = await db.query(
    `
    SELECT
      e.id,
      e.tenant_id,
      e.employee_code,
      ${optionalEmployeeTextColumn(columns, "employee_code_display")},
      e.full_name,
      ${optionalEmployeeColumn(columns, "phone")} AS phone,
      ${optionalEmployeeColumn(columns, "mobile")} AS mobile,
      ${optionalEmployeeColumn(columns, "phone_number")} AS phone_number,
      ${optionalEmployeeTextColumn(columns, "image_url")},
      ${optionalEmployeeTextColumn(columns, "photo_url")},
      ${optionalEmployeeTextColumn(columns, "avatar_url")},
      ${optionalEmployeeTextColumn(columns, "profile_image_url")},
      ${optionalEmployeeTextColumn(columns, "profile_photo_url")},
      ${optionalEmployeeTextColumn(columns, "profile_image")},
      ${optionalEmployeeTextColumn(columns, "image")},
      ${optionalEmployeeTextColumn(columns, "photo")},
      ${optionalEmployeeTextColumn(columns, "employee_image")},
      ${optionalEmployeeTextColumn(columns, "cloudinary_url")},
      ${optionalEmployeeTextColumn(columns, "secure_url")},
      e.job_title,
      e.position,
      e.salary,
      e.status,
      COALESCE(e.is_deleted, FALSE) AS is_deleted,
      e.employee_portal_token,
      e.branch_id,
      b.name AS branch_name
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE e.employee_portal_token = $1
      AND COALESCE(e.is_deleted, FALSE) = FALSE
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
    LIMIT 1
    `,
    [token]
  );
  return result.rows[0] || null;
};

export const inspectEmployeePortalTokenMatch = async (token) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    SELECT
      id,
      status,
      COALESCE(is_deleted, FALSE) AS is_deleted,
      LOWER(COALESCE(status, 'active')) = 'active' AS is_active
    FROM employees
    WHERE employee_portal_token = $1
    LIMIT 1
    `,
    [token]
  );
  return result.rows[0] || null;
};

export const recordEmployeePortalAudit = async ({ employee = null, action, status = "success", audit = {}, metadata = {} } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const location = audit.location || {};
  await db.query(
    `
    INSERT INTO employee_portal_audit_logs (
      tenant_id, employee_id, action, status, ip_address, user_agent, device_id,
      latitude, longitude, gps_accuracy_meters, gps_distance_meters, gps_verification_result, metadata
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
    `,
    [
      employee?.tenant_id || audit.tenant_id || null,
      employee?.id || audit.employee_id || null,
      clean(action || "unknown").slice(0, 80),
      clean(status || "success").slice(0, 40),
      clean(audit.ip || "").slice(0, 120),
      clean(audit.userAgent || audit.user_agent || "").slice(0, 500),
      clean(audit.deviceId || audit.device_id || "").slice(0, 160),
      numberOrNull(location.latitude ?? audit.latitude),
      numberOrNull(location.longitude ?? audit.longitude),
      numberOrNull(location.accuracy ?? audit.gps_accuracy_meters),
      numberOrNull(audit.gps_distance_meters),
      clean(audit.gps_verification_result || "").slice(0, 40),
      JSON.stringify({ ...metadata, request_id: audit.requestId || audit.request_id || "" }),
    ]
  ).catch((error) => debugEmployeePortal("[employee-portal] audit skipped", { action, error: error?.message || error }));
};

const recordHrAuditLog = async ({ tenantId = null, userId = null, action, entityType = "employee_portal_request", entityId = null, details = {} } = {}) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NULL,
        user_id BIGINT NULL,
        action VARCHAR(120) NOT NULL,
        entity_type VARCHAR(120),
        entity_id BIGINT,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(
      `
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details, created_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
      `,
      [
        tenantId,
        userId,
        clean(action || "hr.action").slice(0, 120),
        clean(entityType || "employee_portal_request").slice(0, 120),
        entityId || null,
        JSON.stringify(details || {}),
      ]
    );
  } catch (error) {
    debugEmployeePortal("[employee-portal] HR audit skipped", { action, entityId, error: error?.message || error });
  }
};

const transaction = ({ id, type, label, amount = 0, direction = "neutral", status = "", date = null, description = "" }) => ({
  id: String(id || `${type}-${date || Date.now()}`),
  type,
  label,
  amount: toNumber(amount),
  direction,
  status,
  date,
  description,
});

const getPendingCommissionsTotal = async ({ tenantId, employeeId }) => {
  try {
    const result = await db.query(
      `
      SELECT COALESCE(SUM(commission_amount), 0) AS total
      FROM employee_commissions
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND LOWER(COALESCE(status, 'pending')) IN ('pending', 'recorded')
      `,
      [employeeId, tenantId]
    );
    return toNumber(result.rows[0]?.total);
  } catch {
    return 0;
  }
};

const getRecentCommissions = async ({ tenantId, employeeId }) => {
  try {
    const result = await db.query(
      `
      SELECT id, commission_amount, sale_amount, status, created_at
      FROM employee_commissions
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY created_at DESC, id DESC
      LIMIT 8
      `,
      [employeeId, tenantId]
    );
    return result.rows.map((row) =>
      transaction({
        id: `commission-${row.id}`,
        type: "commission",
        label: "Commission",
        amount: row.commission_amount,
        direction: "credit",
        status: row.status || "pending",
        date: row.created_at,
        description: toNumber(row.sale_amount) > 0 ? `Sale ${toNumber(row.sale_amount).toFixed(2)}` : "",
      })
    );
  } catch {
    return [];
  }
};

const getRecentPenalties = async ({ tenantId, employeeId }) => {
  try {
    const result = await db.query(
      `
      SELECT id, amount, reason, status, penalty_date, created_at
      FROM employee_penalties
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND COALESCE(deduct_from_payroll, TRUE) = TRUE
      ORDER BY COALESCE(penalty_date, created_at::date) DESC, id DESC
      LIMIT 8
      `,
      [employeeId, tenantId]
    );
    return result.rows.map((row) =>
      transaction({
        id: `penalty-${row.id}`,
        type: "penalty",
        label: "Penalty",
        amount: row.amount,
        direction: "debit",
        status: row.status || "pending",
        date: row.penalty_date || row.created_at,
        description: row.reason || "",
      })
    );
  } catch {
    return [];
  }
};

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));

const getGamificationSettings = async (tenantId) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    INSERT INTO employee_gamification_settings (tenant_id)
    VALUES ($1)
    ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
    RETURNING *
    `,
    [tenantId || 0]
  );
  return result.rows[0] || {};
};

const getEmployeeGoals = async ({ tenantId, employeeId, period, settings }) => {
  const result = await db.query(
    `
    SELECT *
    FROM employee_goals
    WHERE employee_id::text = $1::text
      AND period = $2
      AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
    LIMIT 1
    `,
    [employeeId, period, tenantId]
  );
  const row = result.rows[0] || {};
  return {
    monthly_sales_target: toNumber(row.monthly_sales_target, toNumber(settings.monthly_sales_target)),
    attendance_target_days: Number(row.attendance_target_days || settings.attendance_target_days || 26),
    branch_kpi_target: toNumber(row.branch_kpi_target, toNumber(settings.branch_kpi_target)),
  };
};

const getMonthlySalesStats = async ({ tenantId, employeeId, periodStart, periodEnd }) => {
  try {
    const result = await db.query(
      `
      SELECT
        COALESCE(SUM(sale_amount), 0) AS sales_total,
        COALESCE(SUM(commission_amount), 0) AS commission_total,
        COUNT(*)::int AS commission_count
      FROM employee_commissions
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND created_at >= $3::date
        AND created_at < ($4::date + INTERVAL '1 day')
      `,
      [employeeId, tenantId, periodStart, periodEnd]
    );
    const row = result.rows[0] || {};
    return {
      sales_total: toNumber(row.sales_total),
      commission_total: toNumber(row.commission_total),
      commission_count: Number(row.commission_count || 0),
    };
  } catch {
    return { sales_total: 0, commission_total: 0, commission_count: 0 };
  }
};

const getMonthlyPenaltyTotal = async ({ tenantId, employeeId, periodStart, periodEnd }) => {
  try {
    const result = await db.query(
      `
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
      FROM employee_penalties
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND COALESCE(penalty_date, created_at::date) BETWEEN $3::date AND $4::date
        AND LOWER(COALESCE(status, 'approved')) <> 'cancelled'
      `,
      [employeeId, tenantId, periodStart, periodEnd]
    );
    return { total: toNumber(result.rows[0]?.total), count: Number(result.rows[0]?.count || 0) };
  } catch {
    return { total: 0, count: 0 };
  }
};

const getCustomerServiceScore = async ({ tenantId, employeeId, periodStart, periodEnd }) => {
  const result = await db.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count,
      COUNT(*)::int AS total_count
    FROM employee_portal_requests
    WHERE employee_id::text = $1::text
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      AND created_at >= $3::date
      AND created_at < ($4::date + INTERVAL '1 day')
    `,
    [employeeId, tenantId, periodStart, periodEnd]
  ).catch(() => ({ rows: [{}] }));
  const row = result.rows[0] || {};
  const rejected = Number(row.rejected_count || 0);
  const approved = Number(row.approved_count || 0);
  return clamp(85 + approved * 3 - rejected * 10);
};

const awardMonthlyPoints = async ({ tenantId, employeeId, period, points, sourceType, description }) => {
  if (!points) return null;
  const result = await db.query(
    `
    INSERT INTO employee_reward_points (tenant_id, employee_id, points, source_type, source_ref, description)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (tenant_id, employee_id, source_type, source_ref) WHERE source_ref IS NOT NULL
    DO UPDATE SET description = EXCLUDED.description
    RETURNING *
    `,
    [tenantId, employeeId, Math.round(points), sourceType, period, description]
  );
  return result.rows[0] || null;
};

const awardBadge = async ({ tenantId, employeeId, period, badgeCode, badgeLabel, points }) => {
  const result = await db.query(
    `
    INSERT INTO employee_badge_awards (tenant_id, employee_id, badge_code, badge_label, period, points)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (tenant_id, employee_id, badge_code, period) DO NOTHING
    RETURNING *
    `,
    [tenantId, employeeId, badgeCode, badgeLabel, period, points]
  );
  const badge = result.rows[0] || null;
  if (badge) {
    await awardMonthlyPoints({ tenantId, employeeId, period: `${period}:${badgeCode}`, points, sourceType: "badge", description: badgeLabel });
    await createNotification({
      tenant_id: tenantId,
      role_key: "manager",
      type: "employee_badge_earned",
      category: "employees",
      priority: "medium",
      title: "Employee badge earned",
      message: badgeLabel,
      action_url: "/employees/employees",
      action_label: "Open employees",
      entity_type: "employee_badge_award",
      entity_id: String(badge.id),
      metadata: { employee_id: employeeId, badge_code: badgeCode, period, points },
    }).catch(() => null);
  }
  return badge;
};

const getRewardWallet = async ({ tenantId, employeeId }) => {
  const [points, rewards, badges] = await Promise.all([
    db.query(
      `
      SELECT COALESCE(SUM(points), 0)::int AS balance
      FROM employee_reward_points
      WHERE employee_id::text = $1::text AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      `,
      [employeeId, tenantId]
    ),
    db.query(
      `
      SELECT id, reward_title, points_cost, status, admin_note, created_at
      FROM employee_admin_rewards
      WHERE employee_id::text = $1::text AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY created_at DESC, id DESC
      LIMIT 10
      `,
      [employeeId, tenantId]
    ),
    db.query(
      `
      SELECT id, badge_code, badge_label, period, points, created_at
      FROM employee_badge_awards
      WHERE employee_id::text = $1::text AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      ORDER BY created_at DESC, id DESC
      LIMIT 12
      `,
      [employeeId, tenantId]
    ),
  ]);
  const spent = rewards.rows.reduce((sum, row) => sum + Number(row.points_cost || 0), 0);
  return {
    points_balance: Math.max(0, Number(points.rows[0]?.balance || 0) - spent),
    rewards: rewards.rows,
    badges: badges.rows,
  };
};

const buildPerformanceSystem = async ({ employee, period, bounds, attendanceSummary, persist = true, includeRewardHistory = true }) => {
  const settings = await getGamificationSettings(employee.tenant_id);
  const [goals, sales, penalties, customerServiceScore] = await Promise.all([
    getEmployeeGoals({ tenantId: employee.tenant_id, employeeId: employee.id, period, settings }),
    getMonthlySalesStats({ tenantId: employee.tenant_id, employeeId: employee.id, periodStart: bounds.start, periodEnd: bounds.end }),
    getMonthlyPenaltyTotal({ tenantId: employee.tenant_id, employeeId: employee.id, periodStart: bounds.start, periodEnd: bounds.end }),
    getCustomerServiceScore({ tenantId: employee.tenant_id, employeeId: employee.id, periodStart: bounds.start, periodEnd: bounds.end }),
  ]);
  const attendanceScore = clamp((Number(attendanceSummary.attended_days || 0) / Math.max(1, goals.attendance_target_days)) * 100);
  const punctualityScore = clamp(100 - Number(attendanceSummary.late_days || 0) * 8 - Number(attendanceSummary.late_minutes || 0) / 5);
  const salesScore = goals.monthly_sales_target > 0 ? clamp((sales.sales_total / goals.monthly_sales_target) * 100) : clamp(sales.commission_count * 10);
  const penaltiesImpact = clamp(100 - penalties.count * 15 - penalties.total / 100);
  const totalWeight = ["attendance_weight", "sales_weight", "punctuality_weight", "customer_service_weight", "penalties_weight"].reduce((sum, key) => sum + toNumber(settings[key]), 0) || 100;
  const overallScore = Math.round((
    attendanceScore * toNumber(settings.attendance_weight) +
    salesScore * toNumber(settings.sales_weight) +
    punctualityScore * toNumber(settings.punctuality_weight) +
    customerServiceScore * toNumber(settings.customer_service_weight) +
    penaltiesImpact * toNumber(settings.penalties_weight)
  ) / totalWeight);
  const pointsEarned = Math.round(Number(attendanceSummary.attended_days || 0) * Number(settings.points_per_attendance_day || 0) + Math.floor(sales.sales_total / 1000) * Number(settings.points_per_1000_sales || 0));
  if (persist) await awardMonthlyPoints({ tenantId: employee.tenant_id, employeeId: employee.id, period, points: pointsEarned, sourceType: "monthly_performance", description: "Monthly attendance and sales points" });
  const badgePoints = Number(settings.points_per_badge || 50);
  const badgesToAward = [];
  if (salesScore >= 100 || sales.sales_total > 0) badgesToAward.push(["top_seller", "Top seller"]);
  if (attendanceScore >= 100 && Number(attendanceSummary.absence_days || 0) === 0) badgesToAward.push(["perfect_attendance", "Perfect attendance"]);
  if (customerServiceScore >= 90) badgesToAward.push(["fast_responder", "Fast responder"]);
  if (Number(attendanceSummary.late_days || 0) === 0 && Number(attendanceSummary.late_minutes || 0) === 0) badgesToAward.push(["no_lateness", "No lateness"]);
  if (overallScore >= 90) badgesToAward.push(["employee_of_month", "Employee of the month"]);
  if (persist) await Promise.all(badgesToAward.map(([badgeCode, badgeLabel]) => awardBadge({ tenantId: employee.tenant_id, employeeId: employee.id, period, badgeCode, badgeLabel, points: badgePoints })));
  const rewardWallet = includeRewardHistory
    ? await getRewardWallet({ tenantId: employee.tenant_id, employeeId: employee.id })
    : { points_balance: 0, rewards: [], badges: [], lazy: true };
  return {
    period,
    score: {
      overall: overallScore,
      attendance: Math.round(attendanceScore),
      sales: Math.round(salesScore),
      punctuality: Math.round(punctualityScore),
      customer_service: Math.round(customerServiceScore),
      penalties_impact: Math.round(penaltiesImpact),
    },
    goals: {
      monthly_sales_target: goals.monthly_sales_target,
      attendance_target_days: goals.attendance_target_days,
      branch_kpi_target: goals.branch_kpi_target,
      sales_total: sales.sales_total,
      attendance_days: Number(attendanceSummary.attended_days || 0),
      sales_progress: goals.monthly_sales_target > 0 ? clamp((sales.sales_total / goals.monthly_sales_target) * 100) : 0,
      attendance_progress: clamp((Number(attendanceSummary.attended_days || 0) / Math.max(1, goals.attendance_target_days)) * 100),
      branch_kpi_progress: goals.branch_kpi_target > 0 ? clamp((sales.sales_total / goals.branch_kpi_target) * 100) : 0,
    },
    reward_points: {
      ...rewardWallet,
      points_earned_this_month: pointsEarned,
    },
    achievements: rewardWallet.badges,
  };
};

const buildLeaderboard = async ({ tenantId, period, bounds, limit = 10 }) => {
  const result = await db.query(
    `
    WITH employee_scope AS (
      SELECT id, full_name, employee_code
      FROM employees
      WHERE COALESCE(is_deleted, FALSE) = FALSE
        AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
    ),
    attendance AS (
      SELECT
        employee_id,
        COUNT(*) FILTER (WHERE COALESCE(check_in_at, check_in) IS NOT NULL)::int AS attended_days,
        COUNT(*) FILTER (WHERE COALESCE(late_minutes, 0) > 0 OR LOWER(COALESCE(status, '')) = 'late')::int AS late_days
      FROM attendance_logs
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND attendance_date BETWEEN $2::date AND $3::date
      GROUP BY employee_id
    ),
    sales AS (
      SELECT employee_id, COALESCE(SUM(sale_amount), 0) AS sales_total
      FROM employee_commissions
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND created_at >= $2::date
        AND created_at < ($3::date + INTERVAL '1 day')
      GROUP BY employee_id
    )
    SELECT
      e.id AS employee_id,
      e.full_name AS employee_name,
      e.employee_code,
      COALESCE(s.sales_total, 0) AS sales_total,
      COALESCE(a.attended_days, 0) AS attendance_days,
      GREATEST(0, LEAST(100, COALESCE(a.attended_days, 0) * 4 - COALESCE(a.late_days, 0) * 3 + FLOOR(COALESCE(s.sales_total, 0) / 1000)))::int AS score
    FROM employee_scope e
    LEFT JOIN attendance a ON a.employee_id = e.id
    LEFT JOIN sales s ON s.employee_id = e.id
    ORDER BY score DESC, sales_total DESC, attendance_days DESC, employee_name ASC
    LIMIT $4
    `,
    [tenantId, bounds.start, bounds.end, limit]
  ).catch(() => ({ rows: [] }));
  return result.rows.map((row, index) => ({
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    employee_code: row.employee_code,
    score: Number(row.score || 0),
    sales_total: toNumber(row.sales_total),
    attendance_days: Number(row.attendance_days || 0),
    rank: index + 1,
    period,
  }));
};

const getWalletTransactions = async ({ tenantId, employeeId, payrollRun, recentAdvances, attendanceDeductionTotal, bonuses }) => {
  const advanceTransactions = recentAdvances.map((row) =>
    transaction({
      id: `advance-${row.id}`,
      type: "advance",
      label: "Advance",
      amount: row.remaining_amount || row.amount,
      direction: "debit",
      status: row.status || "pending",
      date: row.created_at,
      description: row.deduction_month || "",
    })
  );
  const [commissionTransactions, penaltyTransactions] = await Promise.all([
    getRecentCommissions({ tenantId, employeeId }),
    getRecentPenalties({ tenantId, employeeId }),
  ]);
  const generated = [];
  if (toNumber(bonuses) > 0) {
    generated.push(transaction({
      id: `bonus-${payrollRun?.id || "current"}`,
      type: "bonus",
      label: "Bonus",
      amount: bonuses,
      direction: "credit",
      status: "approved",
      date: payrollRun?.finalized_at || null,
    }));
  }
  if (toNumber(attendanceDeductionTotal) > 0) {
    generated.push(transaction({
      id: `attendance-deduction-${payrollRun?.id || "current"}`,
      type: "attendance_deduction",
      label: "Attendance deduction",
      amount: attendanceDeductionTotal,
      direction: "debit",
      status: "applied",
      date: payrollRun?.finalized_at || null,
    }));
  }
  if (payrollRun) {
    generated.push(transaction({
      id: `salary-approval-${payrollRun.id}`,
      type: "salary_approval",
      label: "Salary approval",
      amount: payrollRun.net_pay,
      direction: "credit",
      status: "generated",
      date: payrollRun.finalized_at,
      description: payrollRun.payroll_reference || "",
    }));
  }
  return [...generated, ...advanceTransactions, ...penaltyTransactions, ...commissionTransactions]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 20);
};

const normalizeEmployeePortalNotification = (row = {}) => ({
  id: row.id,
  type: row.type,
  employee_id: row.employee_id,
  order_id: row.order_id,
  invoice_number: row.invoice_number || "",
  amount: toNumber(row.amount),
  title: row.title || "",
  body: row.body || "",
  action_url: row.action_url || "",
  metadata: row.metadata || {},
  created_at: row.created_at,
  read_at: row.read_at || null,
});

const getEmployeePortalNotifications = async ({ tenantId, employeeId, limit = 20 } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    SELECT id, type, employee_id, order_id, invoice_number, amount, title, body, action_url, metadata, created_at, read_at
    FROM employee_portal_notifications
    WHERE tenant_id = $1
      AND employee_id = $2
      AND cancelled_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT $3
    `,
    [tenantId, employeeId, Math.max(1, Math.min(50, Number(limit || 20)))]
  );
  return result.rows.map(normalizeEmployeePortalNotification);
};

const getEmployeePortalUnreadNotificationCount = async ({ tenantId, employeeId } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM employee_portal_notifications
    WHERE tenant_id = $1
      AND employee_id = $2
      AND read_at IS NULL
      AND cancelled_at IS NULL
    `,
    [tenantId, employeeId]
  );
  return Number(result.rows[0]?.count || 0);
};

export const markEmployeePortalNotificationRead = async ({ tenantId, employeeId, notificationId } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    UPDATE employee_portal_notifications
    SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND tenant_id = $2
      AND employee_id = $3
      AND cancelled_at IS NULL
    RETURNING id, read_at
    `,
    [notificationId, tenantId, employeeId]
  );
  return result.rows[0] || null;
};

export const markAllEmployeePortalNotificationsRead = async ({ tenantId, employeeId } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    UPDATE employee_portal_notifications
    SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = $1
      AND employee_id = $2
      AND read_at IS NULL
      AND cancelled_at IS NULL
    `,
    [tenantId, employeeId]
  );
  return { updated: Number(result.rowCount || 0) };
};

const resolveEmployeePortalNotificationUrl = async (clientOrPool, { tenantId, employeeId, actionUrl = "", tab = "salary" } = {}) => {
  const fallback = `/employee-app/?tab=${encodeURIComponent(tab || "salary")}`;
  const requested = clean(actionUrl);
  if (requested && !requested.startsWith("/employee-app/?") && !requested.endsWith("/employee-app/")) return requested;
  const result = await clientOrPool.query(
    `
    SELECT employee_portal_token
    FROM employees
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    LIMIT 1
    `,
    [employeeId, tenantId || null]
  );
  const token = clean(result.rows[0]?.employee_portal_token);
  if (!token) return requested || fallback;
  return `/employee-app/${encodeURIComponent(token)}?tab=${encodeURIComponent(tab || "salary")}`;
};

export const createEmployeePortalNotification = async ({
  clientOrPool = db,
  tenantId,
  employeeId,
  type,
  orderId = null,
  invoiceNumber = "",
  amount = 0,
  title,
  body,
  actionUrl = "",
  metadata = {},
  dedupeKey = "",
  push = true,
} = {}) => {
  if (!tenantId || !employeeId || !type || !title) return null;
  await ensureEmployeePayrollPortalSchema(clientOrPool);
  const resolvedActionUrl = await resolveEmployeePortalNotificationUrl(clientOrPool, {
    tenantId,
    employeeId,
    actionUrl,
    tab: metadata?.tab || "salary",
  });
  const normalizedDedupeKey = clean(dedupeKey) || null;
  const conflictClause = normalizedDedupeKey
    ? `ON CONFLICT (tenant_id, employee_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE`
    : `ON CONFLICT (tenant_id, employee_id, order_id, type) WHERE order_id IS NOT NULL DO UPDATE`;
  const result = await clientOrPool.query(
    `
    INSERT INTO employee_portal_notifications (
      tenant_id, employee_id, type, order_id, invoice_number, amount, title, body, action_url, metadata, dedupe_key
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
    ${conflictClause}
    SET invoice_number = EXCLUDED.invoice_number,
        amount = EXCLUDED.amount,
        title = EXCLUDED.title,
        body = EXCLUDED.body,
        action_url = EXCLUDED.action_url,
        metadata = EXCLUDED.metadata,
        dedupe_key = COALESCE(EXCLUDED.dedupe_key, employee_portal_notifications.dedupe_key),
        read_at = NULL,
        cancelled_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    RETURNING id, type, employee_id, order_id, invoice_number, amount, title, body, action_url, metadata, created_at, read_at
    `,
    [
      tenantId,
      employeeId,
      type,
      orderId || null,
      clean(invoiceNumber),
      toNumber(amount),
      clean(title),
      clean(body),
      resolvedActionUrl,
      JSON.stringify(metadata || {}),
      normalizedDedupeKey,
    ]
  );
  const notification = result.rows[0] ? normalizeEmployeePortalNotification(result.rows[0]) : null;
  if (!notification) return null;

  emitToRooms([`employee:${employeeId}`], "employee_portal:notification", {
    notification,
    badge: { tag: type, tab: metadata?.tab || "salary" },
    at: new Date().toISOString(),
  });

  if (push) {
    await sendEmployeePortalPush({
      tenantId,
      employeeId,
      title: notification.title,
      body: notification.body,
      url: notification.action_url || "/employee-app/?tab=salary",
      tag: metadata?.tag || type,
      data: {
        event: type,
        tab: metadata?.tab || "salary",
        order_id: orderId || null,
        invoice_number: invoiceNumber || "",
        amount: toNumber(amount),
      },
      persist: false,
    }).catch((error) => debugEmployeePortal("[employee-portal-notification] push skipped", { employeeId, type, error: error?.message || error }));
  }

  return notification;
};

const getEmployeeWalletTasks = async ({ employee }) => {
  try {
    const commonFilters = {
      tenantId: employee.tenant_id,
      employee_id: employee.id,
      branch_id: employee.branch_id || null,
      include_branch_unassigned: true,
      limit: 50,
    };
    const [activeTasks, completedToday] = await Promise.all([
      listStaffTasks({
        ...commonFilters,
        status: "pending,in_progress,manager_review,overdue,reassigned",
      }, {}),
      listStaffTasks({
        ...commonFilters,
        status: "completed",
        assigned_date: "today",
        limit: 20,
      }, {}),
    ]);
    const seen = new Set();
    return [...activeTasks, ...completedToday].filter((task) => {
      const key = String(task?.id || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 50);
  } catch (error) {
    debugEmployeePortal("[employee-portal] wallet tasks load failed", { employeeId: employee?.id, error: error?.message || error });
    return [];
  }
};

export const buildEmployeePayrollPortalPayload = async ({ employee, includeOptional = false, timings = null, timeZone = "Africa/Cairo" } = {}) => {
  const warnings = [];
  let startedAt = nowMs();
  const payrollRun = await getLatestPayrollRun({ tenantId: employee.tenant_id, employeeId: employee.id });
  recordTiming(timings, "payroll_summary_ms", startedAt);
  const period = payrollRun?.payroll_period || localIsoDate(new Date(), timeZone).slice(0, 7);
  const bounds = monthBounds(period, timeZone);
  const snapshot = payrollRun?.snapshot && typeof payrollRun.snapshot === "object" ? payrollRun.snapshot : {};
  const attendanceSnapshot = snapshot.attendance_deductions || {};
  startedAt = nowMs();
  const [recentAdvances, pendingCommissions, currentShift, scheduledShifts] = await Promise.all([
    getRecentAdvances({ tenantId: employee.tenant_id, employeeId: employee.id }),
    getPendingCommissionsTotal({ tenantId: employee.tenant_id, employeeId: employee.id }),
    getActiveEmployeeShift({ tenantId: employee.tenant_id, employeeId: employee.id }),
    getEmployeeScheduledShifts({ tenantId: employee.tenant_id, employeeId: employee.id, timeZone }),
  ]);
  const effectiveCurrentShift = scheduledShifts.today || currentShift;
  const attendanceCalendarShift = currentShift || effectiveCurrentShift;
  recordTiming(timings, "payroll_related_ms", startedAt);

  startedAt = nowMs();
  const attendanceSummary = await getAttendanceSummary({
    tenantId: employee.tenant_id,
    employeeId: employee.id,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    currentShift: attendanceCalendarShift,
    timeZone,
  });
  // The payroll period is the last run's month, which is usually behind today.
  // Ending the timeline there hid the day the employee is actually working: the
  // portal kept showing "لم يتم تسجيل الحضور" after a real check-in, and the
  // check-in button stayed live over a day that already had a record. The
  // deduction summary stays on the payroll period; only what the employee sees
  // of their own days reaches today.
  const todayIsoDate = localIsoDate(new Date(), timeZone);
  const recordedAttendanceTimeline = await getAttendanceTimeline({
    tenantId: employee.tenant_id,
    employeeId: employee.id,
    periodStart: bounds.start,
    periodEnd: bounds.end > todayIsoDate ? bounds.end : todayIsoDate,
    currentShift: effectiveCurrentShift,
  });
  const generatedAbsenceTimeline = (attendanceSummary.absence_dates || [])
    .filter((date) => !recordedAttendanceTimeline.some((row) => attendanceDateKey(row.date || row.attendance_date) === date))
    .map((date) => ({
      id: `absence-${date}`,
      date,
      attendance_date: date,
      check_in: null,
      check_out: null,
      status: "absent",
      attendance_status: "absent",
      late_minutes: 0,
      early_leave_minutes: 0,
      overtime_hours: 0,
      notes: "",
      selected_shift_id: effectiveCurrentShift?.id || null,
      shift_id: effectiveCurrentShift?.id || null,
      shift_name: effectiveCurrentShift?.shift_name || effectiveCurrentShift?.shiftName || "",
      resolved_shift_start_time: effectiveCurrentShift?.start_time || effectiveCurrentShift?.startTime || "",
      resolved_shift_end_time: effectiveCurrentShift?.end_time || effectiveCurrentShift?.endTime || "",
    }));
  const attendanceTimeline = [...recordedAttendanceTimeline, ...generatedAbsenceTimeline]
    .sort((left, right) => attendanceDateKey(right.date || right.attendance_date).localeCompare(attendanceDateKey(left.date || left.attendance_date)))
    .slice(0, 31);
  const { absence_dates: _absenceDates, ...attendanceSummaryPublic } = attendanceSummary;
  recordTiming(timings, "attendance_summary_ms", startedAt);

  startedAt = nowMs();
  const [employeeRequests, employeeNotifications, unreadNotificationCount] = await Promise.all([
    getPortalRequestsForEmployee({ tenantId: employee.tenant_id, employeeId: employee.id }),
    getEmployeePortalNotifications({ tenantId: employee.tenant_id, employeeId: employee.id, limit: 50 }),
    getEmployeePortalUnreadNotificationCount({ tenantId: employee.tenant_id, employeeId: employee.id }),
  ]);
  recordTiming(timings, "requests_ms", startedAt);

  startedAt = nowMs();
  const tasks = await optionalSection({
    name: "tasks",
    warnings,
    fallback: [],
    fn: () => getEmployeeWalletTasks({ employee }),
  });
  recordTiming(timings, "tasks_ms", startedAt);

  startedAt = nowMs();
  const performanceSystem = await optionalSection({
    name: "gamification",
    warnings,
    fallback: {
      period,
      score: {},
      goals: {},
      reward_points: { points_balance: 0, rewards: [], badges: [], lazy: true },
      achievements: [],
      lazy: true,
    },
    fn: () => buildPerformanceSystem({ employee, period, bounds, attendanceSummary: attendanceSummaryPublic, persist: false, includeRewardHistory: includeOptional }),
  });
  recordTiming(timings, "gamification_ms", startedAt);

  startedAt = nowMs();
  const leaderboard = includeOptional
    ? await optionalSection({
        name: "leaderboard",
        warnings,
        fallback: [],
        fn: () => buildLeaderboard({ tenantId: employee.tenant_id, period, bounds, limit: 10 }),
      })
    : [];
  if (!includeOptional) warnings.push({ section: "leaderboard", code: "lazy", message: "Leaderboard is loaded lazily." });
  recordTiming(timings, "leaderboard_ms", startedAt);

  const baseSalary = toNumber(payrollRun?.base_salary, toNumber(employee.salary));
  const commissions = toNumber(payrollRun?.commissions);
  const bonuses = toNumber(payrollRun?.bonuses);
  const advanceDeductions = toNumber(payrollRun?.advance_deductions);
  const penalties = toNumber(payrollRun?.penalties_total);
  const absenceDeduction = toNumber(payrollRun?.attendance_deduction_total, toNumber(attendanceSnapshot.attendance_deduction_total));
  const otherDeductions = toNumber(payrollRun?.manual_deductions);
  const totalDeductions = toNumber(payrollRun?.total_deductions, advanceDeductions + penalties + absenceDeduction + otherDeductions);
  const payrollStatus = payrollRun
    ? String(payrollRun.status || (payrollRun.paid_at ? "paid" : payrollRun.approved_at ? "approved" : "calculated")).toLowerCase()
    : "draft";
  const paymentStatus = payrollRun
    ? String(payrollRun.payment_status || (payrollStatus === "paid" ? "paid" : payrollStatus === "approved" ? "pending_payment" : "not_generated")).toLowerCase()
    : "not_generated";
  const walletSummary = {
    current_net_salary: payrollRun ? toNumber(payrollRun.net_pay) : null,
    total_advances: recentAdvances.reduce((sum, row) => sum + toNumber(row.remaining_amount || row.amount), 0),
    pending_commissions: pendingCommissions,
    total_deductions: totalDeductions,
    payroll_status: payrollStatus,
  };
  const recentWalletTransactions = await getWalletTransactions({
    tenantId: employee.tenant_id,
    employeeId: employee.id,
    payrollRun,
    recentAdvances,
    attendanceDeductionTotal: absenceDeduction,
    bonuses,
  });
  const payslip = {
    employee_name: employee.full_name,
    employee_code: employee.employee_code,
    job_title: employee.job_title || employee.position || "",
    branch: employee.branch_name || "",
    payroll_period: period,
    period_start: bounds.start,
    period_end: bounds.end,
    base_salary: baseSalary,
    commissions,
    bonuses,
    advances: advanceDeductions,
    penalties,
    absence_deduction: absenceDeduction,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    net_salary: payrollRun ? toNumber(payrollRun.net_pay) : null,
    payroll_status: payrollStatus,
    finalized_at: payrollRun?.finalized_at || null,
    payroll_reference: payrollRun?.payroll_reference || "",
  };
  const employeePhotoUrl = resolveEmployeePhotoValue(employee);
  const employeeImageFields = {
    photo_url: clean(employee.photo_url),
    avatar_url: clean(employee.avatar_url),
    image_url: clean(employee.image_url),
    profile_image: clean(employee.profile_image),
    image: clean(employee.image),
    photo: clean(employee.photo),
    employee_image: clean(employee.employee_image),
  };

  if (employeePortalDebugEnabled()) {
    debugEmployeePortal("[employee-portal] employee image candidates", {
      employeeId: employee.id || null,
      employeeCode: employee.employee_code || "",
      ...employeeImageFields,
      resolved_photo_url: employeePhotoUrl,
    });
  }

  return {
    employee_profile: {
      id: employee.id,
      tenant_id: employee.tenant_id || null,
      tenantId: employee.tenant_id || null,
      name: employee.full_name,
      code: employee.employee_code,
      job_title: employee.job_title || employee.position || "",
      branch_id: employee.branch_id || null,
      branchId: employee.branch_id || null,
      branch: employee.branch_name || "",
      mobile: firstNonEmpty(employee.mobile, employee.phone, employee.phone_number),
      photo_url: employeePhotoUrl,
      avatar_url: employeeImageFields.avatar_url,
      image_url: employeeImageFields.image_url,
      profile_image: employeeImageFields.profile_image,
      image: employeeImageFields.image,
      photo: employeeImageFields.photo,
      employee_image: employeeImageFields.employee_image,
      avatar_initials: clean(employee.full_name).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
      currentShift: effectiveCurrentShift,
      scheduledShifts,
      todayShift: scheduledShifts.today,
      tomorrowShift: scheduledShifts.tomorrow,
      shiftName: effectiveCurrentShift?.shiftName || "",
      startTime: effectiveCurrentShift?.startTime || "",
      endTime: effectiveCurrentShift?.endTime || "",
      expectedHours: effectiveCurrentShift?.expectedHours || 0,
      workingDays: effectiveCurrentShift?.workingDays || [],
    },
    employee: {
      id: employee.id,
      tenant_id: employee.tenant_id || null,
      tenantId: employee.tenant_id || null,
      name: employee.full_name,
      code: employee.employee_code,
      branch_id: employee.branch_id || null,
      branchId: employee.branch_id || null,
      branch: employee.branch_name || "",
      mobile: firstNonEmpty(employee.mobile, employee.phone, employee.phone_number),
      job_title: employee.job_title || employee.position || "",
      photo_url: employeePhotoUrl,
      avatar_url: employeeImageFields.avatar_url,
      image_url: employeeImageFields.image_url,
      profile_image: employeeImageFields.profile_image,
      image: employeeImageFields.image,
      photo: employeeImageFields.photo,
      employee_image: employeeImageFields.employee_image,
      currentShift: effectiveCurrentShift,
      scheduledShifts,
      todayShift: scheduledShifts.today,
      tomorrowShift: scheduledShifts.tomorrow,
      shiftName: effectiveCurrentShift?.shiftName || "",
      startTime: effectiveCurrentShift?.startTime || "",
      endTime: effectiveCurrentShift?.endTime || "",
      expectedHours: effectiveCurrentShift?.expectedHours || 0,
      workingDays: effectiveCurrentShift?.workingDays || [],
    },
    currentShift: effectiveCurrentShift,
    scheduledShifts,
    todayShift: scheduledShifts.today,
    tomorrowShift: scheduledShifts.tomorrow,
    shiftName: effectiveCurrentShift?.shiftName || "",
    startTime: effectiveCurrentShift?.startTime || "",
    endTime: effectiveCurrentShift?.endTime || "",
    expectedHours: effectiveCurrentShift?.expectedHours || 0,
    workingDays: effectiveCurrentShift?.workingDays || [],
    wallet_summary: walletSummary,
    recent_wallet_transactions: recentWalletTransactions,
    payslip,
    attendance: {
      summary: {
        ...attendanceSummaryPublic,
        deducted_absence_amount: absenceDeduction,
      },
      timeline: attendanceTimeline,
    },
    employee_requests: employeeRequests,
    notifications: employeeNotifications,
    unread_notifications_count: unreadNotificationCount,
    tasks,
    task_summary: {
      today: tasks.length,
      pending: tasks.filter((task) => ["pending", "in_progress", "manager_review", "overdue", "reassigned"].includes(task.status)).length,
      completed: tasks.filter((task) => task.status === "completed").length,
      critical: tasks.filter((task) => task.priority === "critical").length,
    },
    qr_attendance: {
      enabled: true,
      branch_id: employee.branch_id || null,
      branch: employee.branch_name || "",
    },
    performance: performanceSystem,
    leaderboard,
    warnings,
    current_payroll_period: period,
    payroll_generated: Boolean(payrollRun),
    payroll_status: payrollStatus,
    payment_status: paymentStatus,
    base_salary: baseSalary,
    sales_commission: commissions,
    commissions,
    bonuses,
    advances: advanceDeductions,
    penalties,
    absence_deduction: absenceDeduction,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    net_salary: payrollRun ? toNumber(payrollRun.net_pay) : null,
    finalized_at: payrollRun?.finalized_at || null,
    recent_advances: recentAdvances,
    recent_attendance_summary: {
      ...attendanceSummaryPublic,
      deducted_absence_amount: absenceDeduction,
      attended_days: toNumber(snapshot.attended_days, toNumber(attendanceSnapshot.attended_days, attendanceSummaryPublic.attended_days)),
      absence_days: toNumber(snapshot.absence_days, toNumber(attendanceSnapshot.absence_days, attendanceSummaryPublic.absence_days)),
      missing_hours: toNumber(snapshot.missing_hours, toNumber(attendanceSnapshot.missing_hours)),
      late_hours: toNumber(snapshot.late_hours, toNumber(attendanceSnapshot.late_hours)),
      expected_working_days: toNumber(attendanceSummaryPublic.expected_working_days, toNumber(snapshot.expected_working_days, toNumber(attendanceSnapshot.expected_working_days))),
    },
  };
};

export const createEmployeePortalRequest = async ({ employee, data = {}, audit = {} }) => {
  await ensureEmployeePayrollPortalSchema(db);
  const requestType = clean(data.request_type || data.type).toLowerCase();
  if (!["vacation", "advance", "hr_note", "late_permission"].includes(requestType)) {
    const error = new Error("Invalid request type");
    error.status = 400;
    throw error;
  }
  const amount = requestType === "advance" ? Math.max(0, toNumber(data.amount)) : 0;
  const requestDate = clean(data.request_date || data.date) || null;
  const endDate = clean(data.end_date || data.endDate) || null;
  const message = clean(data.message || data.note || data.notes);
  if (requestType === "vacation") {
    if (!requestDate) {
      const error = new Error("Vacation date is required");
      error.status = 400;
      throw error;
    }
    await assertLeaveRequestAllowed({
      tenantId: employee.tenant_id,
      startDate: requestDate,
      endDate: endDate || requestDate,
      override: false,
      overrideReason: "",
    });
  }
  if (requestType === "advance" && amount <= 0) {
    const error = new Error("Advance amount is required");
    error.status = 400;
    throw error;
  }
  if (requestType === "late_permission" && !requestDate) {
    const error = new Error("Late permission date is required");
    error.status = 400;
    throw error;
  }
  if (requestType !== "advance" && !message && !requestDate) {
    const error = new Error("Request details are required");
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `
    INSERT INTO employee_portal_requests (
      tenant_id, employee_id, request_type, amount, payment_method, request_date, end_date, message, status, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,NULLIF($6, '')::date,NULLIF($7, '')::date,$8,'pending',NOW(),NOW())
    RETURNING id, request_type, amount, payment_method, request_date, end_date, message, status, created_at
    `,
    [employee.tenant_id, employee.id, requestType, amount, requestType === "advance" ? normalizeAdvancePaymentMethod(data.payment_method || data.paymentMethod) : "cash", requestDate, endDate, message]
  );
  const request = result.rows[0];
  await recordEmployeePortalAudit({
    employee,
    action: "request_created",
    audit,
    metadata: { request_id: request.id, request_type: requestType, amount, request_date: requestDate, end_date: endDate },
  });
  await createNotification({
    tenant_id: employee.tenant_id,
    role_key: "manager",
    branch_id: employee.branch_id || null,
    type: "employee_portal_request",
    category: "employees",
    priority: requestType === "advance" ? "high" : "medium",
    title: "Employee wallet request",
    message: `${employee.full_name || employee.name || "Employee"} submitted ${requestType.replace("_", " ")} request`,
    action_url: "/employees/employees",
    action_label: "Open requests",
    entity_type: "employee_portal_request",
    entity_id: String(request.id),
    metadata: {
      request_id: request.id,
      employee_id: employee.id,
      employee_name: employee.full_name || employee.name || "",
      employee_code: employee.employee_code || employee.code || "",
      branch_id: employee.branch_id || null,
      request_type: requestType,
      amount,
      request_date: requestDate,
      end_date: endDate,
    },
  }).catch((error) => debugEmployeePortal("[employee-payroll-portal] admin notification skipped", { error: error?.message || error }));
  return request;
};

export const getEmployeePortalPushPublicKey = async () => ({
  publicKey: clean(process.env.WEB_PUSH_PUBLIC_KEY),
  enabled: Boolean(clean(process.env.WEB_PUSH_PUBLIC_KEY) && clean(process.env.WEB_PUSH_PRIVATE_KEY)),
});

const pushEndpointHost = (endpoint = "") => {
  try {
    return new URL(clean(endpoint)).host;
  } catch {
    return "";
  }
};

export const subscribeEmployeePortalPush = async ({ employee, subscription = {}, userAgent = "", portalUrl = "" } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  if (!employee?.id) {
    const error = new Error("Employee is required");
    error.status = 400;
    throw error;
  }
  const endpoint = clean(subscription.endpoint);
  const keys = subscription.keys && typeof subscription.keys === "object" ? subscription.keys : {};
  const p256dh = clean(keys.p256dh);
  const auth = clean(keys.auth);
  console.info("[employee-push:subscribe-payload]", {
    employee_id: employee.id,
    endpoint_exists: Boolean(endpoint),
    endpointHost: pushEndpointHost(endpoint),
    p256dh_exists: Boolean(p256dh),
    auth_exists: Boolean(auth),
    p256dhLength: p256dh.length,
    authLength: auth.length,
    applicationServerKeyLength: Number(subscription.application_server_key_length || subscription.applicationServerKeyLength || subscription.applicationServerKey || 0) || 0,
  });
  if (!endpoint || !p256dh || !auth) {
    const error = new Error("Valid push subscription is required");
    error.status = 400;
    throw error;
  }

  const result = await db.query(
    `
    INSERT INTO employee_push_subscriptions (
      tenant_id, employee_id, endpoint, p256dh, auth, user_agent, portal_url, is_active, last_seen_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,NOW())
    ON CONFLICT (endpoint) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id,
        employee_id = EXCLUDED.employee_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        portal_url = EXCLUDED.portal_url,
        is_active = TRUE,
        last_seen_at = NOW()
    RETURNING id, employee_id, endpoint, created_at, last_seen_at
    `,
    [
      employee.tenant_id || null,
      employee.id,
      endpoint,
      p256dh,
      auth,
      clean(userAgent).slice(0, 500),
      clean(portalUrl || subscription.portal_url || subscription.portalUrl),
    ]
  );

  console.info("[employee-push:subscribe-db-save]", {
    employee_id: employee.id,
    subscription_id: result.rows[0]?.id || null,
    endpointHost: pushEndpointHost(result.rows[0]?.endpoint),
    p256dhLength: p256dh.length,
    authLength: auth.length,
    portal_url: clean(portalUrl || subscription.portal_url || subscription.portalUrl),
  });

  const countResult = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM employee_push_subscriptions
    WHERE employee_id = $1
      AND is_active = TRUE
    `,
    [employee.id]
  );
  console.info("[employee-push:subscription-count]", {
    employee_id: employee.id,
    count: Number(countResult.rows[0]?.count || 0),
  });

  return {
    subscription: result.rows[0],
    vapid_configured: Boolean(clean(process.env.WEB_PUSH_PUBLIC_KEY) && clean(process.env.WEB_PUSH_PRIVATE_KEY)),
  };
};

export const getEmployeePortalPushSubscriptionDebug = async ({ employeeId } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    SELECT
      id,
      endpoint,
      p256dh,
      auth,
      created_at,
      last_seen_at,
      is_active
    FROM employee_push_subscriptions
    WHERE employee_id = $1
    ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
    `,
    [employeeId]
  );
  const subscriptions = result.rows.map((row) => ({
    id: row.id,
    endpoint_host: pushEndpointHost(row.endpoint),
    p256dh_length: clean(row.p256dh).length,
    auth_length: clean(row.auth).length,
    created_at: row.created_at || null,
    last_seen_at: row.last_seen_at || null,
    is_active: row.is_active === true,
  }));
  const deliveryResult = await db.query(
    `
    SELECT tag, status, status_code, error_message, endpoint_host, created_at
    FROM employee_push_delivery_logs
    WHERE employee_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT 20
    `,
    [employeeId]
  );
  return {
    employee_id: Number(employeeId),
    count: subscriptions.length,
    endpoint_count: subscriptions.filter((item) => item.endpoint_host).length,
    subscriptions,
    deliveries: deliveryResult.rows,
  };
};

export const unsubscribeEmployeePortalPush = async ({ employee, endpoint = "" } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const safeEndpoint = clean(endpoint);
  if (!employee?.id || !safeEndpoint) {
    const error = new Error("Push subscription endpoint is required");
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `
    UPDATE employee_push_subscriptions
    SET is_active = FALSE,
        last_seen_at = NOW()
    WHERE employee_id = $1
      AND endpoint = $2
    RETURNING id, employee_id, endpoint, is_active, last_seen_at
    `,
    [employee.id, safeEndpoint]
  );
  return result.rows[0] || null;
};

const employeePortalError = (code, messageAr, status = 400, extra = {}) => {
  const error = new Error(messageAr);
  error.status = status;
  error.code = code;
  error.message_ar = messageAr;
  Object.assign(error, extra);
  return error;
};

const getEmployeeBranchForPortalAttendance = async ({ employee }) => {
  if (!employee.branch_id) {
    throw employeePortalError("employee_branch_missing", "لم يتم تعيين فرع لهذا الموظف", 400);
  }
  const result = await db.query(
    `
    SELECT id, tenant_id, name, latitude, longitude, attendance_radius_meters, allowed_radius_meters
    FROM branches
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    LIMIT 1
    `,
    [employee.branch_id, employee.tenant_id]
  );
  const branch = result.rows[0] || null;
  if (!branch) {
    throw employeePortalError("employee_branch_missing", "لم يتم تعيين فرع لهذا الموظف", 400);
  }
  return branch;
};

const getMissingBranchGpsFields = (branch = {}) => {
  const missing = [];
  if (numberOrNull(branch.latitude) === null) missing.push("latitude");
  if (numberOrNull(branch.longitude) === null) missing.push("longitude");
  return missing;
};

const validatePortalAttendanceGps = ({ branch, employee, data = {} }) => {
  const branchLat = numberOrNull(branch.latitude);
  const branchLon = numberOrNull(branch.longitude);
  if (branchLat === null || branchLon === null) {
    const missingFields = getMissingBranchGpsFields(branch);
    console.error("[employee-portal-attendance] branch GPS coordinates missing", {
      code: "branch_location_missing",
      employeeId: employee?.id || null,
      employeeCode: employee?.employee_code || employee?.code || null,
      tenantId: employee?.tenant_id || branch?.tenant_id || null,
      branchId: branch?.id || null,
      branchName: branch?.name || "",
      missingFields,
    });
    throw employeePortalError("branch_location_missing", "لم يتم تحديد موقع الفرع", 400, {
      branch: {
        id: branch?.id || null,
        name: branch?.name || "",
        missing_fields: missingFields,
      },
      gps: {
        verification_result: "branch_location_missing",
        branch_id: branch?.id || null,
        branch_name: branch?.name || "",
        missing_fields: missingFields,
      },
    });
  }
  const location = data.location || {};
  const point = {
    latitude: data.gps_lat ?? data.latitude ?? data.lat ?? location.latitude,
    longitude: data.gps_lng ?? data.longitude ?? data.lng ?? data.lon ?? location.longitude,
  };
  const latitude = numberOrNull(point.latitude);
  const longitude = numberOrNull(point.longitude);
  const allowedRadius = Number(branch.attendance_radius_meters || branch.allowed_radius_meters || 100);
  const distance = distanceMeters({ latitude, longitude }, { latitude: branchLat, longitude: branchLon });
  if (latitude === null || longitude === null || distance === null) {
    throw employeePortalError("location_required", "يجب السماح بالموقع", 400, {
      gps: { verification_result: "missing", allowed_radius_meters: allowedRadius },
    });
  }
  const inside = distance <= allowedRadius;
  if (!inside) {
    throw employeePortalError("outside_branch_radius", "أنت خارج نطاق الفرع", 403, {
      gps: { verification_result: "outside_range", distance_meters: Math.round(distance), allowed_radius_meters: allowedRadius },
    });
  }
  return { verification_result: "inside_range", distance_meters: Math.round(distance), allowed_radius_meters: allowedRadius, latitude, longitude, accuracy: numberOrNull(data.gps_accuracy ?? data.accuracy ?? data.location?.accuracy) };
};

const logEmployeePortalCheckoutQuery = (queryName, params = []) => {
  console.info("[employee-portal-attendance] checkout query", {
    query_name: queryName,
    params,
    param_types: params.map((param) => typeof param),
  });
};

const runEmployeePortalCheckoutQuery = async (queryName, sql, params = [], context = {}) => {
  logEmployeePortalCheckoutQuery(queryName, params);
  try {
    const result = await db.query(sql, params);
    if (!result) {
      console.warn("[employee-portal-attendance] checkout query returned no result", {
        query_name: queryName,
        employee_id: context.employee_id ?? null,
        branch_id: context.branch_id ?? null,
      });
    }
    return result;
  } catch (error) {
    console.error("[employee-portal-attendance] checkout query failed", {
      query_name: queryName,
      params,
      param_types: params.map((param) => typeof param),
      employee_id: context.employee_id ?? null,
      branch_id: context.branch_id ?? null,
      message: error?.message || "",
      code: error?.code || "",
      detail: error?.detail || "",
      hint: error?.hint || "",
    });
    throw employeePortalError(
      "attendance_checkout_failed",
      "تعذر تسجيل الانصراف حاليًا. حاول مرة أخرى أو تواصل مع الإدارة.",
      500
    );
  }
};

export const recordEmployeePortalAttendance = async ({ employee, data = {}, audit = {} }) => {
  await ensureEmployeePayrollPortalSchema(db);
  const action = clean(data.action_type || data.action).toLowerCase();
  if (!["check_in", "check_out"].includes(action)) {
    const error = new Error("Action must be check_in or check_out");
    error.status = 400;
    throw error;
  }
  const branch = await getEmployeeBranchForPortalAttendance({ employee });
  debugEmployeePortal("[employee-portal-attendance] resolved branch", {
    employeeId: employee?.id || null,
    employeeCode: employee?.employee_code || employee?.code || null,
    branchId: branch?.id || null,
    branchName: branch?.name || "",
    hasLatitude: numberOrNull(branch?.latitude) !== null,
    hasLongitude: numberOrNull(branch?.longitude) !== null,
  });
  const gps = validatePortalAttendanceGps({ branch, employee, data });
  const attendanceDate = clean(data.attendance_date) || localIsoDate(new Date(), data.timezone || data.time_zone || data.tz || "Africa/Cairo");
  const notes = clean(data.notes);
  const auditWithGps = {
    ...audit,
    location: { latitude: gps.latitude, longitude: gps.longitude, accuracy: gps.accuracy },
    gps_distance_meters: gps.distance_meters,
    gps_verification_result: gps.verification_result,
  };
  if (action === "check_in") {
    const checkInAt = new Date();
    const shiftResolution = await resolveShiftForCheckIn({
      clientOrPool: db,
      tenantId: employee.tenant_id,
      employeeId: employee.id,
      checkInAt,
      timeZone: data.timezone || data.time_zone || data.tz || "Africa/Cairo",
    });
    const selectedShift = shiftResolution.shift;
    const existing = await db.query(
      `
      SELECT *
      FROM attendance_logs
      WHERE tenant_id = $1
        AND employee_id = $2
        AND attendance_date = $3::date
        AND branch_id = $4
      LIMIT 1
      `,
      [employee.tenant_id, employee.id, attendanceDate, branch.id]
    );
    const existingRow = existing.rows[0] || null;
    if (existingRow) {
      const existingHasCheckout = Boolean(existingRow.check_out || existingRow.check_out_at || String(existingRow.status || "").toLowerCase() === "checked_out");
      if ((existingRow.check_in || existingRow.check_in_at) && !existingHasCheckout) {
        throw employeePortalError("already_checked_in", "تم تسجيل الحضور بالفعل", 409);
      }
      // A finished day used to be reopened here: the new check-in overwrote the
      // old one and cleared the checkout, so the hours already worked that day
      // disappeared from payroll. A second check-in over a stored day is now
      // refused, and only the admin can reopen it from the attendance center.
      if (existingHasCheckout) {
        console.warn("[employee-portal-attendance] second check-in refused", {
          employee_id: employee.id,
          branch_id: branch.id,
          attendance_record_id: existingRow.id || null,
          attendance_date: attendanceDate,
          check_in_at: existingRow.check_in_at || existingRow.check_in || null,
          check_out_at: existingRow.check_out_at || existingRow.check_out || null,
        });
        throw employeePortalError(
          "already_checked_out_today",
          "لقد سجّلت حضورك وانصرافك اليوم بالفعل، ولا يمكن تسجيل حضور جديد على نفس اليوم. لو محتاج تعديل تواصل مع الإدارة.",
          409,
          {
            attendance: {
              id: existingRow.id || null,
              attendance_date: attendanceDate,
              check_in_at: existingRow.check_in_at || existingRow.check_in || null,
              check_out_at: existingRow.check_out_at || existingRow.check_out || null,
            },
          }
        );
      }
      // What is left is a stored day that was never checked in (an admin shell
      // row), so filling it in adds a check-in instead of replacing one.
      const result = await db.query(
        `
        UPDATE attendance_logs
        SET check_in = $12::timestamp,
            check_in_at = $12::timestamp,
            check_in_latitude = $6::numeric,
            check_in_longitude = $7::numeric,
            check_in_gps_distance_meters = $8::numeric,
            check_in_gps_verification_result = $9::varchar,
            shift_id = $13::bigint,
            selected_shift_id = $13::bigint,
            resolved_shift_start_time = $14::timestamp,
            resolved_shift_end_time = $15::timestamp,
            shift_resolution_status = $16,
            late_minutes = $17,
            device_ip = COALESCE(device_ip, NULLIF($10, '')),
            user_agent = COALESCE(user_agent, NULLIF($11, '')),
            attendance_source = 'employee_portal',
            check_out = NULL,
            check_out_at = NULL,
            check_out_latitude = NULL,
            check_out_longitude = NULL,
            check_out_gps_distance_meters = NULL,
            check_out_gps_verification_result = NULL,
            work_minutes = 0,
            early_leave_minutes = 0,
            overtime_minutes = 0,
            status = 'checked_in',
            notes = TRIM(CONCAT_WS(E'\n', NULLIF(notes, ''), NULLIF($5, ''))),
            updated_at = NOW()
        WHERE id = $1
          AND tenant_id = $2
          AND employee_id = $3
          AND attendance_date = $4::date
        RETURNING *
        `,
        [
          existingRow.id,
          employee.tenant_id,
          employee.id,
          attendanceDate,
          notes,
          gps.latitude,
          gps.longitude,
          gps.distance_meters,
          gps.verification_result,
          audit.ip || "",
          audit.userAgent || audit.user_agent || "",
          checkInAt,
          selectedShift?.id || null,
          shiftResolution.resolvedStartTime,
          shiftResolution.resolvedEndTime,
          shiftResolution.status,
          toAttendanceMinutes(shiftResolution.lateMinutes),
        ]
      );
      await recordEmployeePortalAudit({ employee, action: "attendance_check_in", audit: auditWithGps, metadata: { branch_id: branch.id, attendance_id: result.rows[0]?.id, duplicate: true } });
      await createNotification({
        tenant_id: employee.tenant_id,
        role_key: "manager",
        branch_id: branch.id,
        type: "employee_attendance_check_in",
        category: "attendance",
        priority: shiftResolution.lateMinutes > 0 ? "high" : "medium",
        title: shiftResolution.lateMinutes > 0 ? "موظف متأخر" : "تسجيل حضور جديد",
        message: `${employee.full_name || employee.name || employee.employee_code || "Employee"} ${shiftResolution.lateMinutes > 0 ? `تأخر ${shiftResolution.lateMinutes} دقيقة` : "سجل الحضور"}`,
        action_url: "/attendance/today",
        action_label: "فتح الحضور",
        entity_type: "attendance_log",
        entity_id: String(result.rows[0]?.id || ""),
        metadata: {
          employee_id: employee.id,
          attendance_id: result.rows[0]?.id || null,
          branch_id: branch.id,
          action: "check_in",
          late_minutes: toAttendanceMinutes(shiftResolution.lateMinutes),
        },
      }).catch(() => null);
      return { action, attendance: result.rows[0], branch: { id: branch.id, name: branch.name } };
    }
    const result = await db.query(
      `
      INSERT INTO attendance_logs (
        tenant_id, employee_id, branch_id, shift_id, selected_shift_id, attendance_date, check_in, check_in_at,
        check_in_latitude, check_in_longitude, check_in_gps_distance_meters, check_in_gps_verification_result,
        resolved_shift_start_time, resolved_shift_end_time, shift_resolution_status,
        attendance_source, status, notes, device_ip, user_agent, late_minutes, created_at, updated_at
      )
      VALUES ($1,$2,$3,$12,$12,$4::date,$13,$13,$6::numeric,$7::numeric,$8::numeric,$9::varchar,$14::timestamp,$15::timestamp,$16,'employee_portal','checked_in',$5,$10,$11,$17,NOW(),NOW())
      RETURNING *
      `,
      [
        employee.tenant_id,
        employee.id,
        branch.id,
        attendanceDate,
        notes,
        gps.latitude,
        gps.longitude,
        gps.distance_meters,
        gps.verification_result,
        audit.ip || "",
        audit.userAgent || audit.user_agent || "",
        selectedShift?.id || null,
        checkInAt,
        shiftResolution.resolvedStartTime,
        shiftResolution.resolvedEndTime,
        shiftResolution.status,
        toAttendanceMinutes(shiftResolution.lateMinutes),
      ]
    );
    await recordEmployeePortalAudit({ employee, action: "attendance_check_in", audit: auditWithGps, metadata: { branch_id: branch.id, attendance_id: result.rows[0]?.id } });
    await createNotification({
      tenant_id: employee.tenant_id,
      role_key: "manager",
      branch_id: branch.id,
      type: "employee_attendance_check_in",
      category: "attendance",
      priority: shiftResolution.lateMinutes > 0 ? "high" : "medium",
      title: shiftResolution.lateMinutes > 0 ? "موظف متأخر" : "تسجيل حضور جديد",
      message: `${employee.full_name || employee.name || employee.employee_code || "Employee"} ${shiftResolution.lateMinutes > 0 ? `تأخر ${shiftResolution.lateMinutes} دقيقة` : "سجل الحضور"}`,
      action_url: "/attendance/today",
      action_label: "فتح الحضور",
      entity_type: "attendance_log",
      entity_id: String(result.rows[0]?.id || ""),
      metadata: {
        employee_id: employee.id,
        attendance_id: result.rows[0]?.id || null,
        branch_id: branch.id,
        action: "check_in",
        late_minutes: toAttendanceMinutes(shiftResolution.lateMinutes),
      },
    }).catch(() => null);
    return { action, attendance: result.rows[0], branch: { id: branch.id, name: branch.name } };
  }
  const existing = await runEmployeePortalCheckoutQuery(
    "attendance_existing_open_record",
    `
    SELECT *
    FROM attendance_logs
    WHERE tenant_id = $1::bigint AND employee_id = $2::bigint AND attendance_date = $3::date
    LIMIT 1
    `,
    [employee.tenant_id, employee.id, attendanceDate],
    { employee_id: employee.id, branch_id: branch.id }
  );
  const attendanceLogIdRaw = data.attendance_log_id || data.attendanceLogId || null;
  const attendanceLogId = attendanceLogIdRaw === null || attendanceLogIdRaw === undefined || attendanceLogIdRaw === ""
    ? null
    : Number.parseInt(String(attendanceLogIdRaw), 10);
  const hasAttendanceLogId = Number.isFinite(attendanceLogId) && attendanceLogId > 0;
  const attendanceLookupResult = hasAttendanceLogId
    ? runEmployeePortalCheckoutQuery(
        "attendance_lookup_by_id",
        `
        SELECT *
        FROM attendance_logs
        WHERE tenant_id = $1::bigint
          AND employee_id = $2::bigint
          AND id = $3::bigint
          AND COALESCE(check_out_at, check_out) IS NULL
        LIMIT 1
        `,
        [employee.tenant_id, employee.id, attendanceLogId],
        { employee_id: employee.id, branch_id: branch.id }
      )
    : runEmployeePortalCheckoutQuery(
        "attendance_lookup_by_date",
        `
        SELECT *
        FROM attendance_logs
        WHERE tenant_id = $1::bigint
          AND employee_id = $2::bigint
          AND COALESCE(check_out_at, check_out) IS NULL
          AND COALESCE(check_in_at, check_in) IS NOT NULL
          AND (
            attendance_date = $3::date
            OR COALESCE(check_in_at, check_in) >= NOW() - INTERVAL '36 hours'
          )
        ORDER BY
          CASE WHEN attendance_date = $3::date THEN 0 ELSE 1 END,
          COALESCE(check_in_at, check_in) DESC
        LIMIT 1
        `,
        [employee.tenant_id, employee.id, attendanceDate],
        { employee_id: employee.id, branch_id: branch.id }
      );
  const attendanceLookup = await attendanceLookupResult;
  if (!attendanceLookup) {
    console.warn("[employee-portal-attendance] checkout step returned no result", {
      step: hasAttendanceLogId ? "attendance_lookup_by_id" : "attendance_lookup_by_date",
      employee_id: employee.id,
      branch_id: branch.id,
    });
  }
  const existingRow = existing?.rows?.[0] || null;
  const attendanceLookupRow = attendanceLookup?.rows?.[0] || null;
  const attendanceRow = attendanceLookupRow || existingRow || null;
  console.info("[employee-portal-attendance] checkout lookup", {
    employee_id: employee.id,
    branch_id: branch.id,
    attendance_record_id: attendanceRow?.id || null,
    check_in_at: attendanceRow?.check_in_at || attendanceRow?.check_in || null,
    check_out_at: attendanceRow?.check_out_at || attendanceRow?.check_out || null,
    attendance_date: attendanceRow?.attendance_date || attendanceDate,
  });
  if (!attendanceRow) {
    console.warn("[employee-portal-attendance] checkout rejected", {
      employee_id: employee.id,
      branch_id: branch.id,
      reason: "missing_open_attendance",
      attendance_date: attendanceDate,
      attendance_record_id: attendanceLogId || null,
    });
    const error = new Error("Check-in is required before check-out");
    error.status = 409;
    throw error;
  }
  const attendanceRecordId = attendanceRow.id || attendanceLogId || null;
  const checkOutAt = new Date();
  const shiftResult = attendanceRow.selected_shift_id || attendanceRow.shift_id
    ? await runEmployeePortalCheckoutQuery(
        "shift_lookup_for_checkout",
        `
        SELECT *
        FROM employee_shifts
        WHERE id = $1::bigint
          AND employee_id::text = $2::text
          AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
        LIMIT 1
        `,
        [attendanceRow.selected_shift_id || attendanceRow.shift_id, employee.id, employee.tenant_id],
        { employee_id: employee.id, branch_id: branch.id }
      )
    : await getActiveEmployeeShift({ tenantId: employee.tenant_id, employeeId: employee.id });
  if ((attendanceRow.selected_shift_id || attendanceRow.shift_id) && !shiftResult) {
    console.warn("[employee-portal-attendance] checkout step returned no result", {
      step: "shift_lookup_for_checkout",
      employee_id: employee.id,
      branch_id: branch.id,
    });
  }
  const shift = shiftResult?.rows?.[0] || null;
  const metrics = calculateAttendanceMetrics({
    attendanceDate,
    checkIn: attendanceRow.check_in_at || attendanceRow.check_in,
    checkOut: checkOutAt,
    shift: {
      ...(shift || {}),
      start_time: attendanceRow.resolved_shift_start_time || shift?.start_time || shift?.startTime,
      end_time: attendanceRow.resolved_shift_end_time || shift?.end_time || shift?.endTime,
    },
    timeZone: getAttendanceTimeZone(),
  });
  if (attendanceRow.check_out || attendanceRow.check_out_at || String(attendanceRow.status || "").toLowerCase() === "checked_out") {
    console.warn("[employee-portal-attendance] checkout rejected", {
      employee_id: employee.id,
      branch_id: branch.id,
      reason: "already_checked_out",
      attendance_record_id: attendanceRecordId,
      attendance_date: attendanceRow.attendance_date || attendanceDate,
      check_in_at: attendanceRow.check_in_at || attendanceRow.check_in || null,
      check_out_at: attendanceRow.check_out_at || attendanceRow.check_out || null,
    });
    throw employeePortalError("already_checked_out", "تم تسجيل الانصراف بالفعل", 409);
  }
  const updateParams = [
    employee.tenant_id,
    employee.id,
    attendanceRow.attendance_date || attendanceDate,
    notes,
    gps.latitude,
    gps.longitude,
    gps.distance_meters,
    gps.verification_result,
    audit.ip || "",
    audit.userAgent || audit.user_agent || "",
    checkOutAt,
    toAttendanceMinutes(metrics.work_minutes),
    toAttendanceMinutes(metrics.late_minutes),
    toAttendanceMinutes(metrics.early_leave_minutes),
    toAttendanceMinutes(metrics.overtime_minutes),
  ];
  const result = attendanceRecordId
    ? await runEmployeePortalCheckoutQuery(
        "checkout_update_by_id",
        `
        UPDATE attendance_logs
        SET check_out = COALESCE(check_out, $11::timestamp),
            check_out_at = COALESCE(check_out_at, $11::timestamp),
            check_out_latitude = COALESCE(check_out_latitude, $5::numeric),
            check_out_longitude = COALESCE(check_out_longitude, $6::numeric),
            check_out_gps_distance_meters = COALESCE(check_out_gps_distance_meters, $7::numeric),
            check_out_gps_verification_result = COALESCE(check_out_gps_verification_result, $8::varchar),
            device_ip = COALESCE(device_ip, NULLIF($9::text, '')),
            user_agent = COALESCE(user_agent, NULLIF($10::text, '')),
            attendance_source = 'employee_portal',
            status = 'checked_out',
            work_minutes = $12::integer,
            late_minutes = $13::integer,
            early_leave_minutes = $14::integer,
            overtime_minutes = $15::integer,
            notes = TRIM(CONCAT_WS(E'\n', NULLIF(notes, ''), NULLIF($4::text, ''))),
            updated_at = NOW()
        WHERE id = $16::bigint
          AND tenant_id = $1::bigint
          AND employee_id = $2::bigint
          AND attendance_date = $3::date
          AND COALESCE(check_out_at, check_out) IS NULL
        RETURNING *
        `,
        [...updateParams, attendanceRecordId],
        { employee_id: employee.id, branch_id: branch.id }
      )
    : await runEmployeePortalCheckoutQuery(
        "checkout_update_by_date",
        `
        UPDATE attendance_logs
        SET check_out = COALESCE(check_out, $11::timestamp),
            check_out_at = COALESCE(check_out_at, $11::timestamp),
            check_out_latitude = COALESCE(check_out_latitude, $5::numeric),
            check_out_longitude = COALESCE(check_out_longitude, $6::numeric),
            check_out_gps_distance_meters = COALESCE(check_out_gps_distance_meters, $7::numeric),
            check_out_gps_verification_result = COALESCE(check_out_gps_verification_result, $8::varchar),
            device_ip = COALESCE(device_ip, NULLIF($9::text, '')),
            user_agent = COALESCE(user_agent, NULLIF($10::text, '')),
            attendance_source = 'employee_portal',
            status = 'checked_out',
            work_minutes = $12::integer,
            late_minutes = $13::integer,
            early_leave_minutes = $14::integer,
            overtime_minutes = $15::integer,
            notes = TRIM(CONCAT_WS(E'\n', NULLIF(notes, ''), NULLIF($4::text, ''))),
            updated_at = NOW()
        WHERE tenant_id = $1::bigint
          AND employee_id = $2::bigint
          AND attendance_date = $3::date
        RETURNING *
        `,
        updateParams,
        { employee_id: employee.id, branch_id: branch.id }
      );
  const updatedAttendanceRow = result?.rows?.[0] || null;
  if (!updatedAttendanceRow) {
    console.warn("[employee-portal-attendance] checkout step returned no result", {
      step: attendanceRecordId ? "checkout_update_by_id" : "checkout_update_by_date",
      employee_id: employee.id,
      branch_id: branch.id,
    });
    throw employeePortalError(
      "attendance_checkout_failed",
      "تعذر تسجيل الانصراف حاليًا. حاول مرة أخرى أو تواصل مع الإدارة.",
      500
    );
  }
  if (updatedAttendanceRow && toAttendanceMinutes(metrics.overtime_minutes) > 0) {
    await db.query(
      `
      INSERT INTO attendance_overtime_approvals (
        tenant_id,
        employee_id,
        branch_id,
        attendance_log_id,
        attendance_date,
        overtime_minutes,
        status,
        requested_by_user_id,
        notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,'pending',NULL,$7)
      ON CONFLICT (attendance_log_id) WHERE attendance_log_id IS NOT NULL DO UPDATE
      SET
        overtime_minutes = EXCLUDED.overtime_minutes,
        status = CASE
          WHEN attendance_overtime_approvals.status = 'approved' THEN attendance_overtime_approvals.status
          ELSE 'pending'
        END,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      `,
      [
        employee.tenant_id,
        employee.id,
        branch.id,
        updatedAttendanceRow.id,
        updatedAttendanceRow.attendance_date || attendanceDate,
        toAttendanceMinutes(metrics.overtime_minutes),
        "Auto-created from employee portal checkout overtime",
      ]
    ).catch(() => null);
  }
  await recordEmployeePortalAudit({ employee, action: "attendance_check_out", audit: auditWithGps, metadata: { branch_id: branch.id, attendance_id: updatedAttendanceRow?.id } });
  await createNotification({
    tenant_id: employee.tenant_id,
    role_key: "manager",
    branch_id: branch.id,
    type: "employee_attendance_check_out",
    category: "attendance",
    priority: "medium",
    title: "انصراف موظف",
    message: `${employee.full_name || employee.name || employee.employee_code || "Employee"} سجل الانصراف`,
    action_url: "/attendance/today",
    action_label: "فتح الحضور",
    entity_type: "attendance_log",
    entity_id: String(updatedAttendanceRow?.id || ""),
    metadata: {
      employee_id: employee.id,
      attendance_id: updatedAttendanceRow?.id || null,
      branch_id: branch.id,
      action: "check_out",
    },
  }).catch(() => null);
  return { action, attendance: updatedAttendanceRow, branch: { id: branch.id, name: branch.name } };
};

export const updateEmployeeWalletTaskStatus = async ({ employee, taskId, data = {}, audit = {} } = {}) => {
  const status = clean(data.status || "").toLowerCase();
  if (!["in_progress", "completed"].includes(status)) {
    const error = new Error("Unsupported task action");
    error.status = 400;
    error.code = "unsupported_task_action";
    throw error;
  }
  const task = await updateStaffTaskStatus(taskId, { ...data, status }, {
    id: null,
    tenant_id: employee.tenant_id,
    employee_id: employee.id,
    name: employee.full_name,
    source: "employee_portal",
  });
  if (!task) {
    const error = new Error("Task not found");
    error.status = 404;
    error.code = "task_not_found";
    throw error;
  }
  await recordEmployeePortalAudit({
    employee,
    action: status === "completed" ? "task_completed" : "task_started",
    audit,
    metadata: { task_id: taskId, status },
  });
  return task;
};

export const listEmployeePortalRequests = async ({ tenantId = null, status = "", limit = 200 } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const params = [tenantId];
  const clauses = ["($1::bigint IS NULL OR r.tenant_id = $1::bigint)"];
  if (status) {
    params.push(status);
    clauses.push(`r.status = $${params.length}`);
  }
  const safeLimit = Math.min(Math.max(Number(limit || 200), 1), 200);
  params.push(safeLimit);
  const result = await db.query(
    `
    SELECT
      r.*,
      e.full_name AS employee_name,
      e.employee_code,
      b.name AS branch_name
    FROM employee_portal_requests r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT $${params.length}
    `,
    params
  );
  return result.rows;
};

export const getEmployeeGamificationAdmin = async ({ tenantId = null } = {}) => {
  const settings = await getGamificationSettings(tenantId);
  return { settings };
};

export const updateEmployeeGamificationSettings = async ({ tenantId = null, data = {} } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    INSERT INTO employee_gamification_settings (
      tenant_id, attendance_weight, sales_weight, punctuality_weight, customer_service_weight, penalties_weight,
      monthly_sales_target, attendance_target_days, branch_kpi_target, points_per_attendance_day, points_per_1000_sales, points_per_badge, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET
      attendance_weight = EXCLUDED.attendance_weight,
      sales_weight = EXCLUDED.sales_weight,
      punctuality_weight = EXCLUDED.punctuality_weight,
      customer_service_weight = EXCLUDED.customer_service_weight,
      penalties_weight = EXCLUDED.penalties_weight,
      monthly_sales_target = EXCLUDED.monthly_sales_target,
      attendance_target_days = EXCLUDED.attendance_target_days,
      branch_kpi_target = EXCLUDED.branch_kpi_target,
      points_per_attendance_day = EXCLUDED.points_per_attendance_day,
      points_per_1000_sales = EXCLUDED.points_per_1000_sales,
      points_per_badge = EXCLUDED.points_per_badge,
      updated_at = NOW()
    RETURNING *
    `,
    [
      tenantId || 0,
      toNumber(data.attendance_weight, 30),
      toNumber(data.sales_weight, 30),
      toNumber(data.punctuality_weight, 20),
      toNumber(data.customer_service_weight, 10),
      toNumber(data.penalties_weight, 10),
      toNumber(data.monthly_sales_target),
      Math.max(1, Math.round(toNumber(data.attendance_target_days, 26))),
      toNumber(data.branch_kpi_target),
      Math.round(toNumber(data.points_per_attendance_day, 5)),
      Math.round(toNumber(data.points_per_1000_sales, 2)),
      Math.round(toNumber(data.points_per_badge, 50)),
    ]
  );
  return result.rows[0];
};

export const grantEmployeeAdminReward = async ({ tenantId = null, employeeId, title, pointsCost = 0, adminNote = "", createdBy = null } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  if (!employeeId) {
    const error = new Error("Employee is required");
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `
    INSERT INTO employee_admin_rewards (tenant_id, employee_id, reward_title, points_cost, status, admin_note, created_by, created_at)
    VALUES ($1,$2,$3,$4,'granted',$5,$6,NOW())
    RETURNING *
    `,
    [tenantId, employeeId, clean(title) || "Admin reward", Math.max(0, Math.round(toNumber(pointsCost))), clean(adminNote), createdBy]
  );
  const reward = result.rows[0];
  await createNotification({
    tenant_id: tenantId,
    role_key: "manager",
    type: "employee_reward_granted",
    category: "employees",
    priority: "medium",
    title: "Employee reward granted",
    message: reward.reward_title,
    action_url: "/employees/employees",
    action_label: "Open employees",
    entity_type: "employee_admin_reward",
    entity_id: String(reward.id),
    metadata: { employee_id: employeeId, points_cost: reward.points_cost },
  }).catch(() => null);
  return reward;
};

const createAdvanceFromPortalRequest = async ({ request, reviewedBy = null, clientOrPool = db } = {}) => {
  if (!request || request.request_type !== "advance" || clean(request.status) !== "approved" || toNumber(request.amount) <= 0) return null;
  await ensureAccountingSchema();
  const queryClient = clientOrPool;
  await queryClient.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS source VARCHAR(80) NULL`);
  await queryClient.query(`ALTER TABLE IF EXISTS expenses ADD COLUMN IF NOT EXISTS shift_id BIGINT NULL`);
  await queryClient.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40) NOT NULL DEFAULT 'cash'`);
  await queryClient.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS shift_id BIGINT NULL`);

  const existing = await queryClient.query(
    `SELECT * FROM employee_advances WHERE employee_portal_request_id = $1 LIMIT 1`,
    [request.id]
  );
  if (existing.rows[0]) return existing.rows[0];

  const employeeResult = await queryClient.query(
    `SELECT id, full_name, employee_code, branch_id FROM employees WHERE id = $1 AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL) LIMIT 1`,
    [request.employee_id, request.tenant_id]
  );
  const employee = employeeResult.rows[0];
  if (!employee) {
    const error = new Error("Employee not found");
    error.status = 404;
    throw error;
  }

  const paymentMethod = normalizeAdvancePaymentMethod(request.payment_method);
  let shift = null;
  if (paymentMethod === "cash") {
    const shiftResult = await queryClient.query(
      `
      SELECT *
      FROM cash_drawer_shifts
      WHERE tenant_id = $1
        AND branch_id = $2
        AND status = 'open'
      ORDER BY opened_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [request.tenant_id, employee.branch_id]
    );
    shift = shiftResult.rows[0] || null;
    if (!shift) {
      const error = new Error("لا توجد وردية كاش مفتوحة في فرع الموظف");
      error.status = 409;
      throw error;
    }
  }

  const notes = clean(request.admin_note || request.message || `Approved wallet advance request #${request.id}`);
  const expenseResult = await queryClient.query(
    `
    INSERT INTO expenses (
      tenant_id, title, amount, expense_type, category, payment_method,
      branch_id, employee_id, expense_date, notes, status, approved_by,
      approved_at, paid_at, paid_by, source, shift_id, created_by, created_at, updated_at
    )
    VALUES ($1,$2,$3,'employee_advance','employee_advance',$4,$5,$6,CURRENT_DATE,$7,'paid',$8,NOW(),NOW(),$8,'employee_portal',$9,$8,NOW(),NOW())
    RETURNING *
    `,
    [request.tenant_id, `Employee advance - ${employee.full_name || employee.employee_code || employee.id}`, toNumber(request.amount), paymentMethod, employee.branch_id, employee.id, notes, reviewedBy, shift?.id || null]
  );
  const expense = expenseResult.rows[0];

  const result = await queryClient.query(
    `
    INSERT INTO employee_advances (
      tenant_id, employee_id, amount, deducted_amount, remaining_amount,
      deduction_month, deduction_status, status, notes, expense_id, employee_portal_request_id,
      payment_method, shift_id, created_by, created_at, updated_at
    )
    VALUES ($1,$2,$3,0,$3,to_char(CURRENT_DATE, 'YYYY-MM'),'pending','active',$4,$5,$6,$7,$8,$9,NOW(),NOW())
    ON CONFLICT (employee_portal_request_id) WHERE employee_portal_request_id IS NOT NULL
    DO UPDATE SET updated_at = NOW()
    RETURNING *
    `,
    [
      request.tenant_id,
      request.employee_id,
      toNumber(request.amount),
      notes,
      expense.id,
      request.id,
      paymentMethod,
      shift?.id || null,
      reviewedBy,
    ]
  );
  if (paymentMethod === "cash") {
    await recordCashDrawerEvent(queryClient, {
      tenantId: request.tenant_id,
      branchId: employee.branch_id,
      shiftId: shift.id,
      createdBy: reviewedBy || shift.opened_by_user_id || shift.opened_by,
      eventType: "expense_cash",
      sourceType: "employee_advance",
      sourceId: expense.id,
      amount: toNumber(request.amount),
      requireOpenShift: true,
    });
  }
  return result.rows[0] || null;
};

const parseDateOnly = (value) => {
  const raw = clean(value);
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
};

const enumerateDateRange = (startValue, endValue = startValue) => {
  const start = new Date(`${parseDateOnly(startValue)}T00:00:00Z`);
  const end = new Date(`${parseDateOnly(endValue) || parseDateOnly(startValue)}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  const rows = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    rows.push(cursor.toISOString().slice(0, 10));
  }
  return rows;
};

const getHrAttendanceSettingsForTenant = async (tenantId) => {
  await ensureAttendanceSchema();
  const result = await db.query(
    `
    SELECT
      COALESCE(monthly_paid_leave_days, 3)::int AS monthly_paid_leave_days,
      COALESCE(forbidden_leave_weekdays, '[4,5,6]'::jsonb) AS forbidden_leave_weekdays
    FROM hr_attendance_settings
    WHERE ($1::bigint IS NOT NULL AND tenant_id = $1::bigint)
    LIMIT 1
    `,
    [tenantId]
  );
  const row = result.rows[0] || {};
  const forbidden = Array.isArray(row.forbidden_leave_weekdays)
    ? row.forbidden_leave_weekdays
    : [4, 5, 6];
  return {
    monthlyPaidLeaveDays: Math.max(0, toNumber(row.monthly_paid_leave_days, 3)),
    forbiddenLeaveWeekdays: forbidden.map((item) => Number(item)).filter((item) => Number.isFinite(item)),
  };
};

const blockedLeaveDatesForRequest = async ({ tenantId, startDate, endDate }) => {
  const settings = await getHrAttendanceSettingsForTenant(tenantId);
  const forbidden = new Set(settings.forbiddenLeaveWeekdays);
  return enumerateDateRange(startDate, endDate).filter((dateValue) => {
    const date = new Date(`${dateValue}T00:00:00Z`);
    return forbidden.has(date.getUTCDay());
  });
};

const assertLeaveRequestAllowed = async ({ tenantId, startDate, endDate, override = false, overrideReason = "" }) => {
  const blockedDates = await blockedLeaveDatesForRequest({ tenantId, startDate, endDate });
  if (blockedDates.length && (!override || !clean(overrideReason))) {
    const error = new Error(`Leave is blocked on configured weekdays: ${blockedDates.join(", ")}. Manager override reason is required.`);
    error.status = 400;
    error.code = "forbidden_leave_weekday";
    error.blocked_dates = blockedDates;
    throw error;
  }
  return blockedDates;
};

const createVacationFromPortalRequest = async ({ request, reviewedBy = null, override = false, overrideReason = "" } = {}) => {
  if (!request || !["vacation", "leave"].includes(clean(request.request_type)) || clean(request.status) !== "approved") return null;
  const startDate = parseDateOnly(request.request_date || request.created_at);
  const endDate = parseDateOnly(request.end_date || request.request_date || request.created_at);
  if (!startDate) return null;
  const blockedDates = await assertLeaveRequestAllowed({
    tenantId: request.tenant_id,
    startDate,
    endDate,
    override,
    overrideReason,
  });
  const result = await db.query(
    `
    INSERT INTO employee_vacations (
      tenant_id, employee_id, vacation_type, vacation_date, start_date, end_date, status, notes, created_at, updated_at
    )
    SELECT $1,$2,'annual',$3::date,$3::date,$4::date,'approved',$5,NOW(),NOW()
    WHERE NOT EXISTS (
      SELECT 1
      FROM employee_vacations
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND employee_id = $2::bigint
        AND COALESCE(vacation_date, start_date) = $3::date
        AND COALESCE(end_date, vacation_date, start_date) = $4::date
        AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
    )
    RETURNING *
    `,
    [
      request.tenant_id,
      request.employee_id,
      startDate,
      endDate,
      [clean(request.message), clean(request.admin_note), blockedDates.length ? `Manager override: ${clean(overrideReason)}` : ""].filter(Boolean).join("\n"),
    ]
  );
  return result.rows[0] || { synced: true, start_date: startDate, end_date: endDate, blocked_dates: blockedDates };
};

export const reviewEmployeePortalRequest = async ({ tenantId = null, requestId, status, adminNote = "", reviewedBy = null, createAdvance = false, leaveOverride = false, leaveOverrideReason = "" } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const nextStatus = clean(status).toLowerCase();
  if (!["approved", "rejected"].includes(nextStatus)) {
    const error = new Error("Status must be approved or rejected");
    error.status = 400;
    throw error;
  }
  const reviewClient = createAdvance && nextStatus === "approved" ? await db.connect() : null;
  let result;
  try {
    if (reviewClient) await reviewClient.query("BEGIN");
    const queryClient = reviewClient || db;
    result = await queryClient.query(
      `
      UPDATE employee_portal_requests
      SET status = $3,
          admin_note = $4,
          reviewed_by = $5,
          reviewed_at = NOW(),
          updated_at = NOW()
      WHERE id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      RETURNING *
      `,
      [requestId, tenantId, nextStatus, clean(adminNote), reviewedBy]
    );
    if (!result.rows[0]) {
      const error = new Error("Request not found");
      error.status = 404;
      throw error;
    }
    if (reviewClient && result.rows[0].request_type === "advance") {
      result.rows[0].created_advance = await createAdvanceFromPortalRequest({ request: result.rows[0], reviewedBy, clientOrPool: reviewClient });
    }
    if (reviewClient) await reviewClient.query("COMMIT");
  } catch (error) {
    if (reviewClient) await reviewClient.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    reviewClient?.release();
  }
  if (!result.rows[0]) {
    const error = new Error("Request not found");
    error.status = 404;
    throw error;
  }
  const request = result.rows[0];
  const employeeTokenResult = await db.query(
    `
    SELECT employee_portal_token
    FROM employees
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
    LIMIT 1
    `,
    [request.employee_id, request.tenant_id]
  );
  const employeePortalToken = clean(employeeTokenResult.rows[0]?.employee_portal_token);
  let advance = null;
  let vacation = null;
  if (createAdvance && request.request_type === "advance" && request.status === "approved") {
    advance = request.created_advance || await createAdvanceFromPortalRequest({ request, reviewedBy });
  }
  if (["vacation", "leave"].includes(request.request_type) && request.status === "approved") {
    vacation = await createVacationFromPortalRequest({
      request,
      reviewedBy,
      override: leaveOverride,
      overrideReason: leaveOverrideReason || adminNote,
    });
  }
  if (request.request_type === "advance" && nextStatus === "approved") {
    console.info("[employee-push:advance-approved-trigger]", {
      employee_id: request.employee_id,
      request_id: request.id,
      amount: toNumber(request.amount),
    });
  }
  const isAdvanceRequest = request.request_type === "advance";
  const isLeaveRequest = request.request_type === "vacation" || request.request_type === "leave";
  const advanceAmount = toNumber(request.amount);
  const requestPushTitle = isAdvanceRequest
    ? nextStatus === "approved"
      ? "تمت الموافقة على السلفة"
      : "❌ تم رفض السلفة"
    : isLeaveRequest
      ? nextStatus === "approved"
        ? "تمت الموافقة على الإجازة"
        : "❌ تم رفض الإجازة"
      : "تحديث طلب الموارد البشرية";
  const requestPushBody = isAdvanceRequest
    ? nextStatus === "approved"
      ? `تمت الموافقة على طلب السلفة بقيمة ${advanceAmount} جنيه.`
      : "تم رفض طلب السلفة. راجع الإدارة لمعرفة التفاصيل."
    : isLeaveRequest
      ? nextStatus === "approved"
        ? "تم اعتماد طلب الإجازة الخاص بك."
        : "تم رفض طلب الإجازة."
      : "تم تحديث طلبك من الإدارة.";
  const requestPushEvent = isAdvanceRequest
    ? `advance_${nextStatus}`
    : isLeaveRequest
      ? `leave_${nextStatus}`
      : `request_${nextStatus}`;
  const requestPushTag = isAdvanceRequest
    ? `advance-${nextStatus}`
    : isLeaveRequest
      ? `leave-${nextStatus}`
      : `employee-request-${request.id}-${nextStatus}`;
  await sendEmployeePortalPush({
    tenantId: request.tenant_id,
    employeeId: request.employee_id,
    title: requestPushTitle,
    body: requestPushBody,
    url: employeePortalToken ? `/employee-app/${encodeURIComponent(employeePortalToken)}?tab=requests` : "",
    tag: requestPushTag,
    data: {
      event: requestPushEvent,
      request_id: request.id,
      request_type: request.request_type,
      tab: "requests",
    },
  }).catch((error) => debugEmployeePortal("[employee-portal-push] request review skipped", { error: error?.message || error }));
  const requestUpdatePayload = {
    employee_id: request.employee_id,
    request_id: request.id,
    request_type: request.request_type,
    status: request.status,
    message: requestPushBody,
  };
  emitToRooms([`employee:${request.employee_id}`], "employee_portal:request_updated", requestUpdatePayload);
  await recordHrAuditLog({
    tenantId: request.tenant_id || tenantId,
    userId: reviewedBy || null,
    action: `employee_request.${nextStatus}`,
    entityType: "employee_portal_request",
    entityId: request.id,
    details: {
      employee_id: request.employee_id,
      request_type: request.request_type,
      previous_status: "pending",
      new_status: nextStatus,
      admin_note: adminNote,
      created_advance_id: advance?.id || null,
      created_vacation_id: vacation?.id || null,
      leave_override: leaveOverride === true,
      leave_override_reason: leaveOverrideReason || "",
    },
  });
  return { ...request, created_advance: advance, created_vacation: vacation };
};
