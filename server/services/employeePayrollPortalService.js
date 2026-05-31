import { randomBytes } from "node:crypto";

import db from "../database/db.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import { createNotification } from "./notificationsService.js";
import { listStaffTasks, updateStaffTaskStatus } from "./staffTasksService.js";
import { ensureShiftResolutionSchema, resolveShiftForCheckIn } from "./attendanceShiftResolver.js";

const tokenBytes = 32;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clean = (value = "") => String(value || "").trim();
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

const normalizePhone = (value = "") => {
  let digits = clean(value).replace(/\D+/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length >= 12) digits = digits.slice(2);
  while (digits.startsWith("0") && digits.length > 10) digits = digits.slice(1);
  if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(-10);
  return digits;
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

const optionalEmployeeColumn = (columns, name) =>
  columns.has(name) ? `e.${name}` : `NULL::text`;

const monthBounds = (month = "", timeZone = "Africa/Cairo") => {
  const normalized = /^\d{4}-\d{2}$/.test(String(month || "")) ? String(month).slice(0, 7) : localIsoDate(new Date(), timeZone).slice(0, 7);
  const start = `${normalized}-01`;
  const end = new Date(Date.UTC(Number(normalized.slice(0, 4)), Number(normalized.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { month: normalized, start, end };
};

export const generateEmployeePortalToken = () => randomBytes(tokenBytes).toString("hex");

export const ensureEmployeePayrollPortalSchema = async (clientOrPool = db) => {
  if (employeePayrollPortalSchemaReady) return;
  if (clientOrPool === db && employeePayrollPortalSchemaPromise) return employeePayrollPortalSchemaPromise;

  const runEnsure = async () => {
  await ensureAttendanceSchema(clientOrPool);
  await ensureShiftResolutionSchema(clientOrPool);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS employee_portal_token TEXT`);
  await clientOrPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employee_portal_token ON employees (employee_portal_token) WHERE employee_portal_token IS NOT NULL`);
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
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_portal_requests_employee_status ON employee_portal_requests (tenant_id, employee_id, status, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_portal_requests_employee_created ON employee_portal_requests (tenant_id, employee_id, created_at DESC, id DESC)`);
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

  const missing = await clientOrPool.query(
    `
    SELECT id
    FROM employees
    WHERE COALESCE(is_deleted, FALSE) = FALSE
      AND (employee_portal_token IS NULL OR LENGTH(TRIM(employee_portal_token)) < 32)
    LIMIT 500
    `
  );

  for (const row of missing.rows) {
    await regenerateEmployeePortalToken({ employeeId: row.id, tenantId: null, clientOrPool });
  }
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
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      finalized_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
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

const getAttendanceSummary = async ({ tenantId, employeeId, periodStart, periodEnd }) => {
  try {
    const result = await db.query(
      `
      SELECT
        COUNT(*)::int AS records_count,
        COUNT(*) FILTER (WHERE COALESCE(check_in_at, check_in) IS NOT NULL)::int AS attended_days,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'absent')::int AS absence_days,
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'late')::int AS late_days,
        COUNT(*) FILTER (WHERE COALESCE(check_out_at, check_out) IS NULL AND COALESCE(check_in_at, check_in) IS NOT NULL)::int AS missing_checkout_days,
        COALESCE(SUM(overtime_minutes), 0) AS overtime_minutes,
        COALESCE(SUM(late_minutes), 0) AS late_minutes
      FROM attendance_logs
      WHERE employee_id::text = $1::text
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND attendance_date BETWEEN $3::date AND $4::date
      `,
      [employeeId, tenantId, periodStart, periodEnd]
    );
    const row = result.rows[0] || {};
    return {
      records_count: Number(row.records_count || 0),
      attended_days: Number(row.attended_days || 0),
      absence_days: Number(row.absence_days || 0),
      late_days: Number(row.late_days || 0),
      missing_checkout_days: Number(row.missing_checkout_days || 0),
      overtime_hours: Number(((Number(row.overtime_minutes || 0)) / 60).toFixed(2)),
      late_minutes: Number(row.late_minutes || 0),
      period_start: periodStart,
      period_end: periodEnd,
    };
  } catch {
    return {
      records_count: 0,
      attended_days: 0,
      absence_days: 0,
      late_days: 0,
      missing_checkout_days: 0,
      overtime_hours: 0,
      late_minutes: 0,
      period_start: periodStart,
      period_end: periodEnd,
    };
  }
};

const getAttendanceTimeline = async ({ tenantId, employeeId, periodStart, periodEnd }) => {
  try {
    const result = await db.query(
      `
      SELECT
        al.attendance_date,
        COALESCE(check_in_at, check_in) AS check_in,
        COALESCE(check_out_at, check_out) AS check_out,
        COALESCE(status, '') AS status,
        COALESCE(late_minutes, 0) AS late_minutes,
        COALESCE(overtime_minutes, 0) AS overtime_minutes,
        COALESCE(notes, '') AS notes,
        COALESCE(al.selected_shift_id, al.shift_id) AS selected_shift_id,
        COALESCE(al.resolved_shift_start_time::text, s.start_time::text, '') AS resolved_shift_start_time,
        COALESCE(al.resolved_shift_end_time::text, s.end_time::text, '') AS resolved_shift_end_time,
        COALESCE(s.shift_name, '') AS shift_name
      FROM attendance_logs al
      LEFT JOIN employee_shifts s ON s.id = COALESCE(al.selected_shift_id, al.shift_id)
      WHERE al.employee_id::text = $1::text
        AND ($2::bigint IS NULL OR al.tenant_id = $2::bigint)
        AND al.attendance_date BETWEEN $3::date AND $4::date
      ORDER BY al.attendance_date DESC
      LIMIT 31
      `,
      [employeeId, tenantId, periodStart, periodEnd]
    );
    return result.rows.map((row) => ({
      date: row.attendance_date,
      check_in: row.check_in,
      check_out: row.check_out,
      status: row.status || (row.check_in ? "present" : "absent"),
      late_minutes: Number(row.late_minutes || 0),
      overtime_hours: Number((Number(row.overtime_minutes || 0) / 60).toFixed(2)),
      notes: row.notes || "",
      selected_shift_id: row.selected_shift_id || null,
      shift_id: row.selected_shift_id || null,
      shift_name: row.shift_name || "",
      resolved_shift_start_time: row.resolved_shift_start_time || "",
      resolved_shift_end_time: row.resolved_shift_end_time || "",
    }));
  } catch {
    return [];
  }
};

const getPortalRequestsForEmployee = async ({ tenantId, employeeId }) => {
  await ensureEmployeePayrollPortalSchema(db);
  const result = await db.query(
    `
    SELECT id, request_type, amount, request_date, end_date, message, status, admin_note, created_at, reviewed_at
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
      e.full_name,
      ${optionalEmployeeColumn(columns, "phone")} AS phone,
      ${optionalEmployeeColumn(columns, "mobile")} AS mobile,
      ${optionalEmployeeColumn(columns, "phone_number")} AS phone_number,
      e.job_title,
      e.position,
      e.salary,
      e.branch_id,
      b.name AS branch_name
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE e.employee_portal_token = $1
      AND COALESCE(e.is_deleted, FALSE) = FALSE
    LIMIT 1
    `,
    [token]
  );
  return result.rows[0] || null;
};

export const getEmployeePortalVerificationResult = (employee, verification) => {
  const input = clean(verification);
  const normalizedInput = input.toLowerCase();
  const inputPhone = normalizePhone(input);
  if (!normalizedInput) {
    return {
      ok: false,
      reason: "verification_failed",
      matchedField: "",
      normalizedInputPhone: inputPhone,
    };
  }

  const code = clean(employee?.employee_code).toLowerCase();
  if (code && normalizedInput === code) {
    return {
      ok: true,
      reason: "",
      matchedField: "employee_code",
      normalizedInputPhone: inputPhone,
    };
  }

  const phoneCandidates = [
    ["phone", employee?.phone],
    ["mobile", employee?.mobile],
    ["phone_number", employee?.phone_number],
  ]
    .map(([field, value]) => [field, normalizePhone(value)])
    .filter(([, value]) => value);

  const matchedPhone = phoneCandidates.find(([, value]) => inputPhone && value === inputPhone);
  if (matchedPhone) {
    return {
      ok: true,
      reason: "",
      matchedField: matchedPhone[0],
      normalizedInputPhone: inputPhone,
    };
  }

  return {
    ok: false,
    reason: "verification_failed",
    matchedField: "",
    normalizedInputPhone: inputPhone,
    candidatePhoneFields: phoneCandidates.map(([field]) => field),
  };
};

export const verifyEmployeePortalSecret = (employee, verification) => {
  return getEmployeePortalVerificationResult(employee, verification).ok;
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
        COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) = 'late')::int AS late_days
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

const getEmployeeWalletTasks = async ({ employee }) => {
  try {
    const tasks = await listStaffTasks(
      {
        tenantId: employee.tenant_id,
        employee_id: employee.id,
        branch_id: employee.branch_id || null,
        include_branch_unassigned: true,
        assigned_date: "today",
        limit: 20,
      },
      {}
    );
    return tasks;
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
  const [recentAdvances, pendingCommissions] = await Promise.all([
    getRecentAdvances({ tenantId: employee.tenant_id, employeeId: employee.id }),
    getPendingCommissionsTotal({ tenantId: employee.tenant_id, employeeId: employee.id }),
  ]);
  recordTiming(timings, "payroll_related_ms", startedAt);

  startedAt = nowMs();
  const attendanceSummary = await getAttendanceSummary({
    tenantId: employee.tenant_id,
    employeeId: employee.id,
    periodStart: bounds.start,
    periodEnd: bounds.end,
  });
  const attendanceTimeline = await getAttendanceTimeline({
    tenantId: employee.tenant_id,
    employeeId: employee.id,
    periodStart: bounds.start,
    periodEnd: bounds.end,
  });
  recordTiming(timings, "attendance_summary_ms", startedAt);

  startedAt = nowMs();
  const employeeRequests = await getPortalRequestsForEmployee({ tenantId: employee.tenant_id, employeeId: employee.id });
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
    fn: () => buildPerformanceSystem({ employee, period, bounds, attendanceSummary, persist: false, includeRewardHistory: includeOptional }),
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
  const walletSummary = {
    current_net_salary: payrollRun ? toNumber(payrollRun.net_pay) : null,
    total_advances: recentAdvances.reduce((sum, row) => sum + toNumber(row.remaining_amount || row.amount), 0),
    pending_commissions: pendingCommissions,
    total_deductions: totalDeductions,
    payroll_status: payrollRun ? "generated" : "not_generated",
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
    payroll_status: payrollRun ? "generated" : "not_generated",
    finalized_at: payrollRun?.finalized_at || null,
    payroll_reference: payrollRun?.payroll_reference || "",
  };

  return {
    employee_profile: {
      id: employee.id,
      name: employee.full_name,
      code: employee.employee_code,
      job_title: employee.job_title || employee.position || "",
      branch: employee.branch_name || "",
      photo_url: "",
      avatar_initials: clean(employee.full_name).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(),
    },
    employee: {
      name: employee.full_name,
      code: employee.employee_code,
      branch: employee.branch_name || "",
      job_title: employee.job_title || employee.position || "",
    },
    wallet_summary: walletSummary,
    recent_wallet_transactions: recentWalletTransactions,
    payslip,
    attendance: {
      summary: {
        ...attendanceSummary,
        deducted_absence_amount: absenceDeduction,
      },
      timeline: attendanceTimeline,
    },
    employee_requests: employeeRequests,
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
    payroll_status: payrollRun ? "generated" : "not_generated",
    payment_status: payrollRun ? "pending_payment" : "not_generated",
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
      ...attendanceSummary,
      deducted_absence_amount: absenceDeduction,
      attended_days: toNumber(snapshot.attended_days, toNumber(attendanceSnapshot.attended_days, attendanceSummary.attended_days)),
      absence_days: toNumber(snapshot.absence_days, toNumber(attendanceSnapshot.absence_days, attendanceSummary.absence_days)),
      missing_hours: toNumber(snapshot.missing_hours, toNumber(attendanceSnapshot.missing_hours)),
      late_hours: toNumber(snapshot.late_hours, toNumber(attendanceSnapshot.late_hours)),
      expected_working_days: toNumber(snapshot.expected_working_days, toNumber(attendanceSnapshot.expected_working_days)),
    },
  };
};

export const createEmployeePortalRequest = async ({ employee, data = {}, audit = {} }) => {
  await ensureEmployeePayrollPortalSchema(db);
  const requestType = clean(data.request_type || data.type).toLowerCase();
  if (!["vacation", "advance", "hr_note"].includes(requestType)) {
    const error = new Error("Invalid request type");
    error.status = 400;
    throw error;
  }
  const amount = requestType === "advance" ? Math.max(0, toNumber(data.amount)) : 0;
  const requestDate = clean(data.request_date || data.date) || null;
  const endDate = clean(data.end_date || data.endDate) || null;
  const message = clean(data.message || data.note || data.notes);
  if (requestType === "advance" && amount <= 0) {
    const error = new Error("Advance amount is required");
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
      tenant_id, employee_id, request_type, amount, request_date, end_date, message, status, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,NULLIF($5, '')::date,NULLIF($6, '')::date,$7,'pending',NOW(),NOW())
    RETURNING id, request_type, amount, request_date, end_date, message, status, created_at
    `,
    [employee.tenant_id, employee.id, requestType, amount, requestDate, endDate, message]
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
    if (existing.rows[0]) {
      if (existing.rows[0].check_in || existing.rows[0].check_in_at) {
        throw employeePortalError("already_checked_in", "تم تسجيل الحضور بالفعل", 409);
      }
      const result = await db.query(
        `
        UPDATE attendance_logs
        SET check_in = COALESCE(check_in, $12),
            check_in_at = COALESCE(check_in_at, $12),
            check_in_latitude = COALESCE(check_in_latitude, $6::numeric),
            check_in_longitude = COALESCE(check_in_longitude, $7::numeric),
            check_in_gps_distance_meters = COALESCE(check_in_gps_distance_meters, $8::numeric),
            check_in_gps_verification_result = COALESCE(check_in_gps_verification_result, $9::varchar),
            shift_id = COALESCE(shift_id, $13::bigint),
            selected_shift_id = COALESCE(selected_shift_id, $13::bigint),
            resolved_shift_start_time = COALESCE(resolved_shift_start_time, $14::timestamp),
            resolved_shift_end_time = COALESCE(resolved_shift_end_time, $15::timestamp),
            shift_resolution_status = $16,
            late_minutes = $17,
            device_ip = COALESCE(device_ip, NULLIF($10, '')),
            user_agent = COALESCE(user_agent, NULLIF($11, '')),
            attendance_source = 'employee_portal',
            status = CASE WHEN check_out IS NULL AND check_out_at IS NULL THEN 'checked_in' ELSE status END,
            notes = TRIM(CONCAT_WS(E'\n', NULLIF(notes, ''), NULLIF($5, ''))),
            updated_at = NOW()
        WHERE id = $1
          AND tenant_id = $2
          AND employee_id = $3
          AND attendance_date = $4::date
        RETURNING *
        `,
        [
          existing.rows[0].id,
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
          shiftResolution.lateMinutes || 0,
        ]
      );
      await recordEmployeePortalAudit({ employee, action: "attendance_check_in", audit: auditWithGps, metadata: { branch_id: branch.id, attendance_id: result.rows[0]?.id, duplicate: true } });
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
        shiftResolution.lateMinutes || 0,
      ]
    );
    await recordEmployeePortalAudit({ employee, action: "attendance_check_in", audit: auditWithGps, metadata: { branch_id: branch.id, attendance_id: result.rows[0]?.id } });
    return { action, attendance: result.rows[0], branch: { id: branch.id, name: branch.name } };
  }
  const existing = await db.query(
    `
    SELECT *
    FROM attendance_logs
    WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date = $3::date
    LIMIT 1
    `,
    [employee.tenant_id, employee.id, attendanceDate]
  );
  if (!existing.rows[0]) {
    const error = new Error("Check-in is required before check-out");
    error.status = 409;
    throw error;
  }
  if (existing.rows[0].check_out || existing.rows[0].check_out_at || String(existing.rows[0].status || "").toLowerCase() === "checked_out") {
    throw employeePortalError("already_checked_out", "تم تسجيل الانصراف بالفعل", 409);
  }
  const result = await db.query(
    `
    UPDATE attendance_logs
    SET check_out = COALESCE(check_out, NOW()),
        check_out_at = COALESCE(check_out_at, NOW()),
        check_out_latitude = COALESCE(check_out_latitude, $5::numeric),
        check_out_longitude = COALESCE(check_out_longitude, $6::numeric),
        check_out_gps_distance_meters = COALESCE(check_out_gps_distance_meters, $7::numeric),
        check_out_gps_verification_result = COALESCE(check_out_gps_verification_result, $8::varchar),
        device_ip = COALESCE(device_ip, NULLIF($9, '')),
        user_agent = COALESCE(user_agent, NULLIF($10, '')),
        attendance_source = 'employee_portal',
        status = 'checked_out',
        work_minutes = CASE
          WHEN COALESCE(check_in_at, check_in) IS NULL THEN COALESCE(work_minutes, 0)
          ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(check_in_at, check_in))) / 60)::int
        END,
        notes = TRIM(CONCAT_WS(E'\n', NULLIF(notes, ''), NULLIF($4, ''))),
        updated_at = NOW()
    WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date = $3::date
    RETURNING *
    `,
    [employee.tenant_id, employee.id, attendanceDate, notes, gps.latitude, gps.longitude, gps.distance_meters, gps.verification_result, audit.ip || "", audit.userAgent || audit.user_agent || ""]
  );
  await recordEmployeePortalAudit({ employee, action: "attendance_check_out", audit: auditWithGps, metadata: { branch_id: branch.id, attendance_id: result.rows[0]?.id } });
  return { action, attendance: result.rows[0], branch: { id: branch.id, name: branch.name } };
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

const createAdvanceFromPortalRequest = async ({ request, reviewedBy = null } = {}) => {
  if (!request || request.request_type !== "advance" || clean(request.status) !== "approved" || toNumber(request.amount) <= 0) return null;
  const result = await db.query(
    `
    INSERT INTO employee_advances (
      tenant_id, employee_id, amount, deducted_amount, remaining_amount,
      deduction_month, deduction_status, status, notes, employee_portal_request_id,
      created_by, created_at, updated_at
    )
    VALUES ($1,$2,$3,0,$3,to_char(CURRENT_DATE, 'YYYY-MM'),'pending','active',$4,$5,$6,NOW(),NOW())
    ON CONFLICT (employee_portal_request_id) WHERE employee_portal_request_id IS NOT NULL
    DO UPDATE SET updated_at = NOW()
    RETURNING *
    `,
    [
      request.tenant_id,
      request.employee_id,
      toNumber(request.amount),
      clean(request.admin_note || request.message || `Approved wallet advance request #${request.id}`),
      request.id,
      reviewedBy,
    ]
  );
  return result.rows[0] || null;
};

export const reviewEmployeePortalRequest = async ({ tenantId = null, requestId, status, adminNote = "", reviewedBy = null, createAdvance = false } = {}) => {
  await ensureEmployeePayrollPortalSchema(db);
  const nextStatus = clean(status).toLowerCase();
  if (!["approved", "rejected"].includes(nextStatus)) {
    const error = new Error("Status must be approved or rejected");
    error.status = 400;
    throw error;
  }
  const result = await db.query(
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
  const request = result.rows[0];
  let advance = null;
  if (createAdvance && request.request_type === "advance" && request.status === "approved") {
    advance = await createAdvanceFromPortalRequest({ request, reviewedBy });
  }
  return { ...request, created_advance: advance };
};
