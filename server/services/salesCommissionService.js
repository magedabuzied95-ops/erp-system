import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { ensureForeignKeyConstraint } from "../utils/schemaConstraints.js";

const DEFAULT_SETTINGS = {
  allow_sale_without_salesperson: true,
  fixed_commission_mode: "fixed_per_item",
};

const ACTIVE_ADVANCE_STATUSES = ["pending", "partial", "partially_deducted", "included_in_payroll"];
const PENALTY_STATUSES = ["pending", "approved", "cancelled"];
const QR_ATTENDANCE_SOURCES = ["qr", "qr_branch", "branch_qr"];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const normalizeFixedMode = (value = "") =>
  String(value || "").trim() === "fixed_per_item" ? "fixed_per_item" : "fixed_per_invoice";

const normalizeCommissionType = (value = "") => {
  const normalized = String(value || "").trim();
  if (normalized === "none") return "none";
  return normalized === "fixed" ? "fixed" : "percent";
};

const normalizeCommissionMode = (value = "") => {
  const normalized = String(value || "").trim();
  if (normalized === "none") return "none";
  if (normalized === "fixed_per_item" || normalized === "fixed_per_invoice") return normalized;
  return normalizeCommissionType(normalized) === "fixed" ? "fixed_per_item" : "percent";
};

const commissionTypeFromMode = (mode = "") => {
  const normalized = normalizeCommissionMode(mode);
  if (normalized === "none") return "none";
  return normalized === "percent" ? "percent" : "fixed";
};

const resolveCommissionModeInput = (data = {}) => {
  const explicitMode = data.commission_mode || data.commissionMode;
  if (explicitMode) return normalizeCommissionMode(explicitMode);
  const explicitType = data.commission_type || data.commissionType;
  if (normalizeCommissionType(explicitType) === "fixed") {
    return normalizeCommissionMode(data.fixed_commission_mode || data.fixedCommissionMode || "fixed_per_item");
  }
  return "percent";
};

const normalizeIds = (value = []) => {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))];
};

const normalizeOptionalId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeOptionalLookupId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  return text ? text : null;
};

const normalizePgTextArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return String(value)
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((item) => item.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
};

const normalizePenaltyStatus = (value = "pending") => {
  const normalized = String(value || "pending").trim().toLowerCase();
  return PENALTY_STATUSES.includes(normalized) ? normalized : "pending";
};

const normalizeDateInput = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value).slice(0, 10);
};

const monthBounds = (month = "") => {
  const normalized = String(month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const start = `${normalized}-01`;
  const end = new Date(Date.UTC(Number(normalized.slice(0, 4)), Number(normalized.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { start, end };
};

const dateKey = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
};

const eachDateKey = (start, end) => {
  const startDate = new Date(`${dateKey(start)}T00:00:00Z`);
  const endDate = new Date(`${dateKey(end)}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return [];
  const dates = [];
  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
};

const isExpectedWorkingDay = (dateValue, workingDaysPerWeek = 6) => {
  const date = new Date(`${dateKey(dateValue)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getUTCDay();
  const count = Math.max(1, Math.min(7, Math.round(Number(workingDaysPerWeek || 6))));
  if (count >= 7) return true;
  if (count === 6) return day !== 5; // Egypt-friendly default: Friday off.
  const defaultFiveDayWeek = new Set([0, 1, 2, 3, 4]); // Sunday-Thursday.
  if (count === 5) return defaultFiveDayWeek.has(day);
  const orderedDays = [0, 1, 2, 3, 4, 6, 5];
  return new Set(orderedDays.slice(0, count)).has(day);
};

const combineDateTime = (dateValue, timeValue) => {
  const date = dateKey(dateValue);
  const time = String(timeValue || "").slice(0, 8);
  if (!date || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) return null;
  const result = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}`);
  return Number.isNaN(result.getTime()) ? null : result;
};

const hoursBetween = (start, end) => {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(0, (endDate.getTime() - startDate.getTime()) / 3600000);
};

const tableExists = async (clientOrPool, tableName) => {
  const result = await clientOrPool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return result.rows.length > 0;
};

const safeDateSetFromTable = async ({ clientOrPool = db, tableName, dateColumn, startColumn = "", endColumn = "", tenantId = null, employeeId = null, periodStart, periodEnd, statusValues = [] } = {}) => {
  try {
    if (!(await tableExists(clientOrPool, tableName))) return new Set();
    const params = [tenantId];
    const clauses = ["($1::bigint IS NULL OR tenant_id = $1::bigint)"];
    if (employeeId) {
      params.push(employeeId);
      clauses.push(`employee_id::text = $${params.length}::text`);
    }
    if (statusValues.length) {
      params.push(statusValues);
      clauses.push(`LOWER(COALESCE(status, '')) = ANY($${params.length}::text[])`);
    }
    params.push(periodStart);
    const startParam = params.length;
    params.push(periodEnd);
    const endParam = params.length;
    const dateExpr = startColumn && endColumn
      ? `${startColumn} <= $${endParam}::date AND COALESCE(${endColumn}, ${startColumn}) >= $${startParam}::date`
      : `${dateColumn} BETWEEN $${startParam}::date AND $${endParam}::date`;
    clauses.push(dateExpr);
    const result = await clientOrPool.query(
      `
      SELECT ${dateColumn || startColumn} AS date_value, ${startColumn || dateColumn} AS start_value, ${endColumn || dateColumn} AS end_value
      FROM ${tableName}
      WHERE ${clauses.join(" AND ")}
      `,
      params
    );
    const values = new Set();
    result.rows.forEach((row) => {
      const rangeStart = dateKey(row.start_value || row.date_value);
      const rangeEnd = dateKey(row.end_value || row.date_value);
      eachDateKey(rangeStart, rangeEnd).forEach((item) => values.add(item));
    });
    return values;
  } catch (error) {
    console.warn(`[payroll] skipped ${tableName} exclusion`, error.message);
    return new Set();
  }
};

export const resolveTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));

export const ensureEmployeePenaltiesSchema = async (clientOrPool = db) => {
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_penalties (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      employee_id BIGINT NOT NULL,
      penalty_date DATE NOT NULL DEFAULT CURRENT_DATE,
      payroll_period_start DATE NULL,
      payroll_period_end DATE NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      notes TEXT,
      deduct_from_payroll BOOLEAN NOT NULL DEFAULT TRUE,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      created_by BIGINT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_penalties ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_penalties ADD COLUMN IF NOT EXISTS payroll_period_start DATE NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_penalties ADD COLUMN IF NOT EXISTS payroll_period_end DATE NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_penalties ADD COLUMN IF NOT EXISTS deduct_from_payroll BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_penalties ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'pending'`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_penalties_employee_period ON employee_penalties (employee_id, penalty_date, payroll_period_start, payroll_period_end)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_penalties_tenant_status ON employee_penalties (tenant_id, status, deduct_from_payroll)`);
};

export const listEmployeePenalties = async ({ tenantId = null, employeeId, status = "", includeCancelled = false } = {}) => {
  if (employeeId === undefined || employeeId === null || employeeId === "") return [];
  await ensureEmployeePenaltiesSchema(db);
  const params = [employeeId, tenantId];
  const clauses = [
    "ep.employee_id::text = $1::text",
    "($2::bigint IS NULL OR ep.tenant_id = $2::bigint)",
  ];
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus) {
    params.push(normalizePenaltyStatus(normalizedStatus));
    clauses.push(`ep.status = $${params.length}`);
  } else if (!includeCancelled) {
    clauses.push("ep.status <> 'cancelled'");
  }
  const result = await db.query(
    `
    SELECT ep.*, e.full_name AS employee_name, e.employee_code
    FROM employee_penalties ep
    LEFT JOIN employees e ON e.id = ep.employee_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY ep.penalty_date DESC, ep.id DESC
    `,
    params
  );
  return result.rows.map((row) => ({
    ...row,
    amount: toNumber(row.amount),
  }));
};

export const createEmployeePenalty = async ({ tenantId = null, employeeId, userId = null, data = {}, defaultStatus = "pending" } = {}) => {
  const normalizedEmployeeId = normalizeOptionalLookupId(employeeId || data.employee_id || data.employeeId);
  if (!normalizedEmployeeId) {
    const error = new Error("Employee is required");
    error.status = 400;
    throw error;
  }
  const amount = toNumber(data.amount);
  if (amount <= 0) {
    const error = new Error("Penalty amount must be greater than zero");
    error.status = 400;
    throw error;
  }
  const reason = String(data.reason || "").trim();
  if (!reason) {
    const error = new Error("Reason is required");
    error.status = 400;
    throw error;
  }
  await ensureEmployeePenaltiesSchema(db);
  const employeeResult = await db.query(
    `
    SELECT id, tenant_id
    FROM employees
    WHERE id::text = $1::text
      AND is_deleted IS DISTINCT FROM TRUE
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    LIMIT 1
    `,
    [normalizedEmployeeId, tenantId]
  );
  const employee = employeeResult.rows[0];
  if (!employee) {
    const error = new Error("Employee not found");
    error.status = 404;
    throw error;
  }
  const statusInput = data.status === undefined || data.status === null || data.status === "" ? defaultStatus : data.status;
  const result = await db.query(
    `
    INSERT INTO employee_penalties (
      tenant_id, employee_id, penalty_date, payroll_period_start, payroll_period_end,
      amount, reason, notes, deduct_from_payroll, status, created_by, created_at, updated_at
    )
    VALUES ($1,$2,$3::date,$4::date,$5::date,$6,$7,$8,$9,$10,$11,NOW(),NOW())
    RETURNING *
    `,
    [
      tenantId ?? employee.tenant_id ?? null,
      normalizedEmployeeId,
      normalizeDateInput(data.penalty_date || data.penaltyDate || data.date) || new Date().toISOString().slice(0, 10),
      normalizeDateInput(data.payroll_period_start || data.payrollPeriodStart),
      normalizeDateInput(data.payroll_period_end || data.payrollPeriodEnd),
      amount,
      reason,
      String(data.notes || "").trim(),
      toBool(data.deduct_from_payroll ?? data.deductFromPayroll, true),
      normalizePenaltyStatus(statusInput),
      userId,
    ]
  );
  return { ...result.rows[0], amount: toNumber(result.rows[0]?.amount) };
};

export const updateEmployeePenalty = async ({ tenantId = null, id, data = {} } = {}) => {
  const penaltyId = normalizeOptionalId(id);
  if (!penaltyId) {
    const error = new Error("Penalty id is required");
    error.status = 400;
    throw error;
  }
  if (data.amount !== undefined && toNumber(data.amount) <= 0) {
    const error = new Error("Penalty amount must be greater than zero");
    error.status = 400;
    throw error;
  }
  if (data.reason !== undefined && !String(data.reason || "").trim()) {
    const error = new Error("Reason is required");
    error.status = 400;
    throw error;
  }
  await ensureEmployeePenaltiesSchema(db);
  const result = await db.query(
    `
    UPDATE employee_penalties
    SET penalty_date = COALESCE($3::date, penalty_date),
        payroll_period_start = COALESCE($4::date, payroll_period_start),
        payroll_period_end = COALESCE($5::date, payroll_period_end),
        amount = COALESCE($6::numeric, amount),
        reason = COALESCE(NULLIF($7, ''), reason),
        notes = COALESCE($8, notes),
        deduct_from_payroll = COALESCE($9::boolean, deduct_from_payroll),
        status = COALESCE($10, status),
        updated_at = NOW()
    WHERE id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    RETURNING *
    `,
    [
      penaltyId,
      tenantId,
      normalizeDateInput(data.penalty_date || data.penaltyDate || data.date),
      normalizeDateInput(data.payroll_period_start || data.payrollPeriodStart),
      normalizeDateInput(data.payroll_period_end || data.payrollPeriodEnd),
      data.amount === undefined ? null : toNumber(data.amount),
      data.reason === undefined ? null : String(data.reason || "").trim(),
      data.notes === undefined ? null : String(data.notes || "").trim(),
      data.deduct_from_payroll === undefined && data.deductFromPayroll === undefined ? null : toBool(data.deduct_from_payroll ?? data.deductFromPayroll, true),
      data.status === undefined ? null : normalizePenaltyStatus(data.status),
    ]
  );
  if (!result.rows[0]) {
    const error = new Error("Penalty not found");
    error.status = 404;
    throw error;
  }
  return { ...result.rows[0], amount: toNumber(result.rows[0]?.amount) };
};

export const cancelEmployeePenalty = async ({ tenantId = null, id } = {}) =>
  updateEmployeePenalty({ tenantId, id, data: { status: "cancelled" } });

export const listApprovedEmployeePenaltiesForPayroll = async ({ tenantId = null, employeeId, periodStart, periodEnd } = {}) => {
  if (employeeId === undefined || employeeId === null || employeeId === "") return [];
  await ensureEmployeePenaltiesSchema(db);
  const result = await db.query(
    `
    SELECT ep.*, e.full_name AS employee_name, e.employee_code
    FROM employee_penalties ep
    LEFT JOIN employees e ON e.id = ep.employee_id
    WHERE ep.employee_id::text = $1::text
      AND ($2::bigint IS NULL OR ep.tenant_id = $2::bigint)
      AND ep.deduct_from_payroll = TRUE
      AND ep.status = 'approved'
      AND COALESCE(ep.amount, 0) > 0
      AND (
        (ep.penalty_date IS NOT NULL AND ep.penalty_date BETWEEN $3::date AND $4::date)
        OR (
          ep.payroll_period_start IS NOT NULL
          AND COALESCE(ep.payroll_period_end, ep.payroll_period_start) >= $3::date
          AND ep.payroll_period_start <= $4::date
        )
      )
    ORDER BY ep.penalty_date ASC, ep.id ASC
    `,
    [employeeId, tenantId, periodStart, periodEnd]
  );
  return result.rows.map((row) => ({
    ...row,
    amount: toNumber(row.amount),
    payroll_deduction_amount: toNumber(row.amount),
  }));
};

export const calculateAttendancePayrollDeductions = async ({ tenantId = null, employee = {}, baseSalary = 0, periodStart, periodEnd, branchId = null } = {}) => {
  await ensureAttendanceSchema(db);
  const employeeId = employee?.id;
  const attendanceBranchId = normalizeOptionalLookupId(branchId ?? employee?.branch_id);
  if (!employeeId || !periodStart || !periodEnd) {
    return {
      absence_days: 0,
      missing_hours: 0,
      late_hours: 0,
      early_leave_hours: 0,
      daily_rate: 0,
      hourly_rate: 0,
      absence_deduction: 0,
      missing_hours_deduction: 0,
      late_deduction: 0,
      early_leave_deduction: 0,
      attendance_deduction_total: 0,
      expected_working_days: 0,
      attended_days: 0,
      absent_working_days: 0,
      qr_records_count: 0,
      excluded_days_off: 0,
      monthly_days_off_excluded: 0,
      excluded_leave_days: 0,
      excluded_holiday_days: 0,
    };
  }

  const dailyWorkHours = Math.max(0.1, toNumber(employee.daily_work_hours, 8));
  const workingDaysPerMonth = Math.max(1, Math.round(toNumber(employee.working_days_per_month, 26)));
  const workingDaysPerWeek = Math.max(1, Math.min(7, Math.round(toNumber(employee.working_days_per_week, 6))));
  const dailyRate = toNumber(baseSalary) / workingDaysPerMonth;
  const hourlyRate = dailyRate / dailyWorkHours;
  const absenceEnabled = employee.absence_deduction_enabled !== false;
  const missingEnabled = employee.missing_hours_deduction_enabled !== false;
  const lateEnabled = employee.late_deduction_enabled !== false;
  const earlyEnabled = employee.early_leave_deduction_enabled !== false;

  const [holidayDates, leaveDates, vacationDates] = await Promise.all([
    safeDateSetFromTable({ tableName: "holidays", dateColumn: "holiday_date", tenantId, periodStart, periodEnd }),
    safeDateSetFromTable({ tableName: "employee_leaves", dateColumn: "leave_date", startColumn: "start_date", endColumn: "end_date", tenantId, employeeId, periodStart, periodEnd, statusValues: ["approved"] }),
    safeDateSetFromTable({ tableName: "employee_vacations", dateColumn: "vacation_date", startColumn: "start_date", endColumn: "end_date", tenantId, employeeId, periodStart, periodEnd, statusValues: ["approved"] }),
  ]);

  const periodDates = eachDateKey(periodStart, periodEnd);
  const approvedExcludedDates = new Set([...holidayDates, ...leaveDates, ...vacationDates].filter((item) => periodDates.includes(item)));
  const approvedExcludedWorkingDates = new Set(
    [...approvedExcludedDates].filter((item) => isExpectedWorkingDay(item, workingDaysPerWeek))
  );
  const candidateWorkingDates = periodDates.filter((item) =>
    isExpectedWorkingDay(item, workingDaysPerWeek) &&
    !approvedExcludedDates.has(item)
  );
  const expectedDates = candidateWorkingDates.slice(0, Math.min(workingDaysPerMonth, candidateWorkingDates.length));
  const excludedDaysOff = Math.max(0, periodDates.length - expectedDates.length - approvedExcludedWorkingDates.size);

  console.info("[payroll-attendance] employee_id, branch_id, period", {
    employee_id: employeeId,
    branch_id: attendanceBranchId,
    period_start: periodStart,
    period_end: periodEnd,
  });

  const attendanceResult = await db.query(
    `
    SELECT
      attendance_date,
      COUNT(*)::int AS qr_records_count,
      MAX(GREATEST(
        COALESCE(work_minutes, 0),
        COALESCE(worked_hours, 0) * 60,
        CASE
          WHEN COALESCE(check_in_at, check_in) IS NOT NULL AND COALESCE(check_out_at, check_out) IS NOT NULL
            THEN EXTRACT(EPOCH FROM (COALESCE(check_out_at, check_out) - COALESCE(check_in_at, check_in))) / 60
          ELSE 0
        END
      ))::numeric AS work_minutes,
      MAX(COALESCE(late_minutes, 0))::numeric AS late_minutes,
      MAX(COALESCE(early_leave_minutes, 0))::numeric AS early_leave_minutes,
      MIN(COALESCE(check_in_at, check_in)) AS first_check_in,
      MAX(COALESCE(check_out_at, check_out)) AS last_check_out
    FROM attendance_logs
    WHERE employee_id::text = $1::text
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      AND attendance_date BETWEEN $3::date AND $4::date
      AND ($5::text IS NULL OR branch_id::text = $5::text)
      AND LOWER(COALESCE(attendance_source, '')) = ANY($6::text[])
    GROUP BY attendance_date
    `,
    [employeeId, tenantId, periodStart, periodEnd, attendanceBranchId, QR_ATTENDANCE_SOURCES]
  );
  const attendanceByDate = new Map(attendanceResult.rows.map((row) => [dateKey(row.attendance_date), row]));
  const qrRecordsCount = attendanceResult.rows.reduce((sum, row) => sum + Number(row.qr_records_count || 0), 0);
  let absenceDays = 0;
  let missingHours = 0;
  let lateHours = 0;
  let earlyLeaveHours = 0;
  let attendedDays = 0;

  expectedDates.forEach((item) => {
    const row = attendanceByDate.get(item);
    if (!row) {
      if (absenceEnabled) absenceDays += 1;
      return;
    }
    attendedDays += 1;
    const workedHours = Math.max(0, toNumber(row.work_minutes) / 60);
    const scheduledStart = combineDateTime(item, employee.work_start_time);
    const scheduledEnd = combineDateTime(item, employee.work_end_time);
    const fallbackLate = scheduledStart && row.first_check_in ? hoursBetween(scheduledStart, row.first_check_in) : 0;
    const fallbackEarly = scheduledEnd && row.last_check_out ? hoursBetween(row.last_check_out, scheduledEnd) : 0;
    const late = lateEnabled ? Math.max(toNumber(row.late_minutes) / 60, fallbackLate, 0) : 0;
    const early = earlyEnabled ? Math.max(toNumber(row.early_leave_minutes) / 60, fallbackEarly, 0) : 0;
    const shortfall = Math.max(0, dailyWorkHours - workedHours);
    const explicitShortfall = late + early;
    if (missingEnabled) missingHours += Math.max(0, shortfall - explicitShortfall);
    lateHours += late;
    earlyLeaveHours += early;
  });

  console.info("[payroll-attendance] qr_records_count", {
    employee_id: employeeId,
    branch_id: attendanceBranchId,
    qr_records_count: qrRecordsCount,
  });
  console.info("[payroll-attendance] present_days", {
    employee_id: employeeId,
    branch_id: attendanceBranchId,
    present_days: attendedDays,
  });
  console.info("[payroll-attendance] absent_working_days", {
    employee_id: employeeId,
    branch_id: attendanceBranchId,
    absent_working_days: Number(absenceDays.toFixed(2)),
  });
  console.info("[payroll-attendance] missing_hours", {
    employee_id: employeeId,
    branch_id: attendanceBranchId,
    missing_hours: Number(missingHours.toFixed(2)),
  });

  const absenceDeduction = absenceDays * dailyRate;
  const missingHoursDeduction = missingHours * hourlyRate;
  const lateDeduction = lateHours * hourlyRate;
  const earlyLeaveDeduction = earlyLeaveHours * hourlyRate;
  const attendanceDeductionTotal = absenceDeduction + missingHoursDeduction + lateDeduction + earlyLeaveDeduction;

  return {
    absence_days: Number(absenceDays.toFixed(2)),
    missing_hours: Number(missingHours.toFixed(2)),
    late_hours: Number(lateHours.toFixed(2)),
    early_leave_hours: Number(earlyLeaveHours.toFixed(2)),
    daily_rate: Number(dailyRate.toFixed(2)),
    hourly_rate: Number(hourlyRate.toFixed(2)),
    absence_deduction: Number(absenceDeduction.toFixed(2)),
    missing_hours_deduction: Number(missingHoursDeduction.toFixed(2)),
    late_deduction: Number(lateDeduction.toFixed(2)),
    early_leave_deduction: Number(earlyLeaveDeduction.toFixed(2)),
    attendance_deduction_total: Number(attendanceDeductionTotal.toFixed(2)),
    expected_working_days: expectedDates.length,
    attended_days: attendedDays,
    absent_working_days: Number(absenceDays.toFixed(2)),
    qr_records_count: qrRecordsCount,
    excluded_days_off: excludedDaysOff,
    monthly_days_off_excluded: excludedDaysOff,
    excluded_leave_days: leaveDates.size + vacationDates.size,
    excluded_holiday_days: holidayDates.size,
  };
};

export const listActiveEmployeeAdvancesForPayroll = async ({ clientOrPool = db, tenantId = null, employeeId, deductionMonth = null } = {}) => {
  if (employeeId === undefined || employeeId === null || employeeId === "") return [];
  const advanceResult = await clientOrPool.query(
    `
    SELECT id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status, notes, expense_id, payroll_reference, created_at, updated_at,
           GREATEST(COALESCE(remaining_amount, amount - COALESCE(deducted_amount, 0)), 0)::numeric AS outstanding_amount
    FROM employee_advances
    WHERE employee_id::text = $1::text
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      AND deduction_status = ANY($3::text[])
      AND COALESCE(status, 'pending') NOT IN ('settled', 'deducted', 'cancelled')
      AND ($4::text IS NULL OR deduction_month <= $4::text)
      AND GREATEST(COALESCE(remaining_amount, amount - COALESCE(deducted_amount, 0)), 0) > 0
    ORDER BY COALESCE(created_at, NOW()) ASC, deduction_month ASC, id ASC
    `,
    [employeeId, tenantId, ACTIVE_ADVANCE_STATUSES, deductionMonth]
  );
  return advanceResult.rows.map((row) => ({
    ...row,
    amount: toNumber(row.amount),
    deducted_amount: toNumber(row.deducted_amount),
    remaining_amount: toNumber(row.remaining_amount),
    outstanding_amount: toNumber(row.outstanding_amount),
    status: row.status || row.deduction_status || "pending",
    advance_status: row.status || row.deduction_status || "pending",
    settlement_status: row.status || row.deduction_status || "pending",
  }));
};

const addSalesEmployeeForeignKeys = async (clientOrPool = db) => {
  const orphanBranches = await clientOrPool.query(`
    SELECT 1
    FROM sales_employees se
    LEFT JOIN branches b ON b.id = se.branch_id
    WHERE se.branch_id IS NOT NULL
      AND b.id IS NULL
    LIMIT 1
  `);
  if (orphanBranches.rows.length === 0) {
    await ensureForeignKeyConstraint(
      clientOrPool,
      "sales_employees",
      "sales_employees_branch_id_fkey",
      `
      ALTER TABLE sales_employees
      ADD CONSTRAINT sales_employees_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
      `
    );
  } else {
    console.warn("[schema] skipped sales_employees_branch_id_fkey because orphan branch_id values exist");
  }

  const orphanEmployees = await clientOrPool.query(`
    SELECT 1
    FROM sales_employees se
    LEFT JOIN employees e ON e.id = se.employee_id
    WHERE se.employee_id IS NOT NULL
      AND e.id IS NULL
    LIMIT 1
  `);
  if (orphanEmployees.rows.length === 0) {
    await ensureForeignKeyConstraint(
      clientOrPool,
      "sales_employees",
      "sales_employees_employee_id_fkey",
      `
      ALTER TABLE sales_employees
      ADD CONSTRAINT sales_employees_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
      `
    );
  } else {
    console.warn("[schema] skipped sales_employees_employee_id_fkey because orphan employee_id values exist");
  }
};

const addEmployeeSalesProfileForeignKeys = async (clientOrPool = db) => {
  const orphanEmployees = await clientOrPool.query(`
    SELECT 1
    FROM employee_sales_profiles esp
    LEFT JOIN employees e ON e.id = esp.employee_id
    WHERE e.id IS NULL
    LIMIT 1
  `);
  if (orphanEmployees.rows.length === 0) {
    await ensureForeignKeyConstraint(
      clientOrPool,
      "employee_sales_profiles",
      "employee_sales_profiles_employee_id_fkey",
      `
      ALTER TABLE employee_sales_profiles
      ADD CONSTRAINT employee_sales_profiles_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      `
    );
  } else {
    console.warn("[schema] skipped employee_sales_profiles_employee_id_fkey because orphan employee_id values exist");
  }
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const readOrdersSalesEmployeeFkTarget = async (clientOrPool = db) => {
  const result = await clientOrPool.query(
    `
    SELECT
      tc.constraint_name,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_name = 'orders_sales_employee_id_fkey'
    `
  );
  return result.rows || [];
};

const readOrdersSalesEmployeeFkDefinition = async (clientOrPool = db) => {
  const result = await clientOrPool.query(
    `
    SELECT
      conname,
      pg_get_constraintdef(oid) AS constraint_definition
    FROM pg_constraint
    WHERE conname = 'orders_sales_employee_id_fkey'
    `
  );
  return result.rows || [];
};

export const logOrdersSalesEmployeeFkDefinition = async (clientOrPool = db, label = "[seller-fk-check:definition]", context = {}) => {
  const rows = await readOrdersSalesEmployeeFkDefinition(clientOrPool);
  console.log(label, { ...context, rows });
  return rows;
};

export const logOrdersSalesEmployeeFkTarget = async (clientOrPool = db, context = {}) => {
  try {
    const rows = await readOrdersSalesEmployeeFkTarget(clientOrPool);
    console.info("[seller-fk-check:found]", {
      ...context,
      constraint_name: "orders_sales_employee_id_fkey",
      rows,
      referenced_table: rows[0]?.referenced_table || null,
      referenced_column: rows[0]?.referenced_column || null,
    });
    return rows;
  } catch (error) {
    console.error("[seller-fk-check:error]", {
      ...context,
      step: "read_current_fk_target",
      constraint_name: "orders_sales_employee_id_fkey",
      message: error?.message || String(error),
      code: error?.code || null,
    });
    return [];
  }
};

const getForeignKeysForColumns = async (clientOrPool, tableName, columns = []) => {
  const result = await clientOrPool.query(
    `
    SELECT
      c.conname,
      c.confrelid::regclass::text AS referenced_table,
      ARRAY_AGG(a.attname ORDER BY keys.ordinality) AS columns
    FROM pg_constraint c
    JOIN UNNEST(c.conkey) WITH ORDINALITY AS keys(attnum, ordinality) ON TRUE
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass($1)
    GROUP BY c.oid, c.conname, c.confrelid
    `,
    [tableName]
  );
  const wanted = new Set(columns);
  return result.rows
    .map((row) => ({ ...row, columns: normalizePgTextArray(row.columns) }))
    .filter((row) => row.columns.some((column) => wanted.has(column)));
};

const isReferencedTable = (value, tableName) => {
  const normalized = String(value || "");
  return normalized === tableName || normalized.endsWith(`.${tableName}`);
};

const dropForeignKeysReferencing = async (clientOrPool, tableName, columns = [], referencedTable) => {
  if (!(await tableExists(clientOrPool, tableName))) return;
  const foreignKeys = await getForeignKeysForColumns(clientOrPool, tableName, columns);
  for (const foreignKey of foreignKeys) {
    if (!isReferencedTable(foreignKey.referenced_table, referencedTable)) continue;
    await clientOrPool.query(`ALTER TABLE ${quoteIdentifier(tableName)} DROP CONSTRAINT IF EXISTS ${quoteIdentifier(foreignKey.conname)}`);
    console.warn("[seller-fk-check:dropped]", {
      table: tableName,
      constraint: foreignKey.conname,
      columns: foreignKey.columns,
      referenced_table: foreignKey.referenced_table,
      reason: `referenced_${referencedTable}`,
    });
    console.warn("[schema] dropped legacy seller foreign key", {
      table: tableName,
      constraint: foreignKey.conname,
      columns: foreignKey.columns,
      referencedTable: foreignKey.referenced_table,
    });
  }
};

const hasOrphanEmployeeReference = async (clientOrPool, tableName, columnName) => {
  if (!(await tableExists(clientOrPool, tableName))) return false;
  const result = await clientOrPool.query(`
    SELECT 1
    FROM ${quoteIdentifier(tableName)} record
    LEFT JOIN employees e ON e.id = record.${quoteIdentifier(columnName)}
    WHERE record.${quoteIdentifier(columnName)} IS NOT NULL
      AND e.id IS NULL
    LIMIT 1
  `);
  return result.rows.length > 0;
};

const addEmployeeReferenceForeignKey = async (clientOrPool, tableName, columnName, constraintName) => {
  if (!(await tableExists(clientOrPool, tableName))) return;
  if (await hasOrphanEmployeeReference(clientOrPool, tableName, columnName)) {
    console.warn(`[schema] skipped ${constraintName} because orphan ${columnName} values exist`);
    return;
  }
  await ensureForeignKeyConstraint(
    clientOrPool,
    tableName,
    constraintName,
    `
    ALTER TABLE ${quoteIdentifier(tableName)}
    ADD CONSTRAINT ${quoteIdentifier(constraintName)}
    FOREIGN KEY (${quoteIdentifier(columnName)}) REFERENCES employees(id) ON DELETE SET NULL
    `
  );
};

export const repairOrdersSalesEmployeeForeignKey = async (clientOrPool = db, context = {}) => {
  console.log("[seller-fk-check:start]");
  console.info("[seller-fk-check:start]", {
    ...context,
    table: "orders",
    column: "sales_employee_id",
    expected_referenced_table: "employees",
    expected_referenced_column: "id",
  });
  try {
    if (!(await tableExists(clientOrPool, "orders"))) {
      console.warn("[seller-fk-check:found]", { ...context, table: "orders", exists: false });
      return { skipped: true, reason: "orders_table_missing" };
    }
    const current = await logOrdersSalesEmployeeFkTarget(clientOrPool, context);
    const beforeDefinition = await logOrdersSalesEmployeeFkDefinition(clientOrPool, "[seller-fk-check:before]", context);
    const referencesEmployees = current.some((row) => isReferencedTable(row.referenced_table, "employees") && row.referenced_column === "id");
    if (referencesEmployees) {
      console.log("[seller-fk-check:after]", { ...context, rows: beforeDefinition, alreadyCorrect: true });
      return { skipped: false, alreadyCorrect: true };
    }

    await clientOrPool.query(`ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_sales_employee_id_fkey`);
    console.warn("[seller-fk-check:dropped]", {
      ...context,
      table: "orders",
      constraint: "orders_sales_employee_id_fkey",
      previous_target: current,
    });

    if (await hasOrphanEmployeeReference(clientOrPool, "orders", "sales_employee_id")) {
      console.warn("[seller-fk-check:error]", {
        ...context,
        table: "orders",
        column: "sales_employee_id",
        constraint: "orders_sales_employee_id_fkey",
        reason: "orphan_employee_references_exist",
      });
      await logOrdersSalesEmployeeFkDefinition(clientOrPool, "[seller-fk-check:after]", { ...context, skipped: true, reason: "orphan_employee_references_exist" });
      return { skipped: true, reason: "orphan_employee_references_exist" };
    }

    const created = await ensureForeignKeyConstraint(
      clientOrPool,
      "orders",
      "orders_sales_employee_id_fkey",
      `
      ALTER TABLE orders
      ADD CONSTRAINT orders_sales_employee_id_fkey
      FOREIGN KEY (sales_employee_id) REFERENCES employees(id) ON DELETE SET NULL
      `
    );
    if (created) {
      console.info("[seller-fk-check:created]", {
        ...context,
        table: "orders",
        column: "sales_employee_id",
        constraint: "orders_sales_employee_id_fkey",
        referenced_table: "employees",
        referenced_column: "id",
      });
    } else {
      console.info("[seller-fk-check:created]", {
        ...context,
        table: "orders",
        column: "sales_employee_id",
        constraint: "orders_sales_employee_id_fkey",
        created: false,
        reason: "constraint_already_exists",
      });
    }
    await logOrdersSalesEmployeeFkTarget(clientOrPool, { ...context, after: "repair" });
    await logOrdersSalesEmployeeFkDefinition(clientOrPool, "[seller-fk-check:after]", { ...context, after: "repair" });
    return { skipped: false, created };
  } catch (error) {
    console.error("[seller-fk-check:error]", {
      ...context,
      table: "orders",
      column: "sales_employee_id",
      constraint: "orders_sales_employee_id_fkey",
      message: error?.message || String(error),
      code: error?.code || null,
    });
    error.sellerFkRepair = true;
    throw error;
  }
};

const migrateSellerEmployeeReferences = async (clientOrPool = db) => {
  const hasOrders = await tableExists(clientOrPool, "orders");
  const hasOrderItems = await tableExists(clientOrPool, "order_items");
  const hasEmployeeSales = await tableExists(clientOrPool, "employee_sales");

  await dropForeignKeysReferencing(clientOrPool, "orders", ["sales_employee_id", "salesperson_id"], "users");
  await dropForeignKeysReferencing(clientOrPool, "order_items", ["sales_employee_id"], "users");
  await dropForeignKeysReferencing(clientOrPool, "employee_sales", ["sales_employee_id"], "users");

  if (hasOrders) {
    await clientOrPool.query(`
      UPDATE orders o
      SET
        seller_user_id = COALESCE(o.seller_user_id, o.sales_employee_id),
        sales_employee_id = e.id,
        salesperson_id = CASE
          WHEN o.salesperson_id IS NULL OR o.salesperson_id = o.sales_employee_id THEN e.id
          ELSE o.salesperson_id
        END
      FROM employees e
      WHERE o.sales_employee_id IS NOT NULL
        AND e.user_id = o.sales_employee_id
        AND NOT EXISTS (SELECT 1 FROM employees direct_employee WHERE direct_employee.id = o.sales_employee_id)
        AND (o.tenant_id IS NULL OR e.tenant_id IS NULL OR e.tenant_id = o.tenant_id)
    `);

    await clientOrPool.query(`
      UPDATE orders o
      SET
        seller_user_id = COALESCE(o.seller_user_id, o.salesperson_id),
        salesperson_id = e.id,
        sales_employee_id = COALESCE(o.sales_employee_id, e.id)
      FROM employees e
      WHERE o.salesperson_id IS NOT NULL
        AND e.user_id = o.salesperson_id
        AND NOT EXISTS (SELECT 1 FROM employees direct_employee WHERE direct_employee.id = o.salesperson_id)
        AND (o.tenant_id IS NULL OR e.tenant_id IS NULL OR e.tenant_id = o.tenant_id)
    `);
  }

  if (hasOrderItems) {
    await clientOrPool.query(`
      UPDATE order_items oi
      SET sales_employee_id = e.id
      FROM employees e
      WHERE oi.sales_employee_id IS NOT NULL
        AND e.user_id = oi.sales_employee_id
        AND NOT EXISTS (SELECT 1 FROM employees direct_employee WHERE direct_employee.id = oi.sales_employee_id)
        AND (oi.tenant_id IS NULL OR e.tenant_id IS NULL OR e.tenant_id = oi.tenant_id)
    `);
  }

  if (hasEmployeeSales) {
    await clientOrPool.query(`
      UPDATE employee_sales es
      SET sales_employee_id = e.id
      FROM employees e
      WHERE es.sales_employee_id IS NOT NULL
        AND e.user_id = es.sales_employee_id
        AND NOT EXISTS (SELECT 1 FROM employees direct_employee WHERE direct_employee.id = es.sales_employee_id)
        AND (es.tenant_id IS NULL OR e.tenant_id IS NULL OR e.tenant_id = es.tenant_id)
    `);
  }

  if (hasOrders && hasOrderItems) {
    await clientOrPool.query(`
      UPDATE order_items oi
      SET sales_employee_id = COALESCE(o.sales_employee_id, o.salesperson_id)
      FROM orders o
      WHERE oi.order_id = o.id
        AND oi.sales_employee_id IS NULL
        AND COALESCE(o.sales_employee_id, o.salesperson_id) IS NOT NULL
    `);
  }

  if (hasOrders) {
    await clientOrPool.query(`
      UPDATE orders o
      SET sales_employee_id = NULL
      WHERE o.sales_employee_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = o.sales_employee_id)
    `);

    await clientOrPool.query(`
      UPDATE orders o
      SET salesperson_id = NULL
      WHERE o.salesperson_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = o.salesperson_id)
    `);
  }

  if (hasOrderItems) {
    await clientOrPool.query(`
      UPDATE order_items oi
      SET sales_employee_id = NULL
      WHERE oi.sales_employee_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = oi.sales_employee_id)
    `);
  }

  if (hasEmployeeSales) {
    await clientOrPool.query(`
      UPDATE employee_sales es
      SET sales_employee_id = NULL
      WHERE es.sales_employee_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = es.sales_employee_id)
    `);
  }

  await repairOrdersSalesEmployeeForeignKey(clientOrPool, { source: "migrateSellerEmployeeReferences" });
  await addEmployeeReferenceForeignKey(clientOrPool, "orders", "salesperson_id", "orders_salesperson_id_employee_fkey");
  await addEmployeeReferenceForeignKey(clientOrPool, "order_items", "sales_employee_id", "order_items_sales_employee_id_employee_fkey");
  await addEmployeeReferenceForeignKey(clientOrPool, "employee_sales", "sales_employee_id", "employee_sales_sales_employee_id_employee_fkey");
};

export const ensureSalesCommissionSchema = async (clientOrPool = db) => {
  console.info("[seller-fk-check:start]", { source: "ensureSalesCommissionSchema", step: "ensure_invoked" });
  await ensureAttendanceSchema(clientOrPool);
  await ensureEmployeePenaltiesSchema(clientOrPool);
  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS sales_employees (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      name VARCHAR(255) NOT NULL,
      code VARCHAR(80),
      pos_alias VARCHAR(20),
      phone VARCHAR(80),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      commission_type VARCHAR(20) NOT NULL DEFAULT 'percent',
      commission_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS code VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS pos_alias VARCHAR(20)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS phone VARCHAR(80)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS commission_type VARCHAR(20) NOT NULL DEFAULT 'percent'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS commission_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS fixed_commission_mode VARCHAR(30) NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ALTER COLUMN fixed_commission_mode DROP NOT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS excluded_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS employee_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await addSalesEmployeeForeignKeys(clientOrPool);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_sales_employees_tenant_active ON sales_employees (tenant_id, is_active, name)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_sales_employees_branch_id ON sales_employees (branch_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_sales_employees_employee_id ON sales_employees (employee_id)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_sales_employees_tenant_branch_active ON sales_employees (tenant_id, branch_id, is_active, name)`);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS employee_sales_profiles (
      employee_id BIGINT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
      tenant_id BIGINT NULL,
      pos_alias VARCHAR(20),
      is_sales_active BOOLEAN NOT NULL DEFAULT TRUE,
      commission_type VARCHAR(20) NOT NULL DEFAULT 'percent',
      commission_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      fixed_commission_mode VARCHAR(30) NULL,
      excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      excluded_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      migrated_sales_employee_id BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS tenant_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS pos_alias VARCHAR(20)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS is_sales_active BOOLEAN NOT NULL DEFAULT TRUE`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS commission_type VARCHAR(20) NOT NULL DEFAULT 'percent'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS commission_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS fixed_commission_mode VARCHAR(30) NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS excluded_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_sales_profiles ADD COLUMN IF NOT EXISTS migrated_sales_employee_id BIGINT NULL`);
  await addEmployeeSalesProfileForeignKeys(clientOrPool);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_employee_sales_profiles_tenant_active ON employee_sales_profiles (tenant_id, is_sales_active)`);

  await clientOrPool.query(`
    UPDATE sales_employees se
    SET employee_id = e.id
    FROM employees e
    WHERE se.employee_id IS NULL
      AND (se.tenant_id IS NULL OR e.tenant_id = se.tenant_id)
      AND (se.branch_id IS NULL OR e.branch_id = se.branch_id)
      AND (
        LOWER(COALESCE(e.employee_code, '')) = LOWER(COALESCE(se.code, ''))
        OR LOWER(COALESCE(e.full_name, '')) = LOWER(COALESCE(se.name, ''))
        OR (COALESCE(e.phone, '') <> '' AND COALESCE(e.phone, '') = COALESCE(se.phone, ''))
      )
  `);

  await clientOrPool.query(`
    INSERT INTO employees (tenant_id, branch_id, full_name, employee_code, phone, salary, status)
    SELECT
      COALESCE(se.tenant_id, b.tenant_id, 1),
      se.branch_id,
      se.name,
      NULLIF(se.code, ''),
      NULLIF(se.phone, ''),
      0,
      CASE WHEN COALESCE(se.is_active, TRUE) THEN 'active' ELSE 'inactive' END
    FROM sales_employees se
    LEFT JOIN branches b ON b.id = se.branch_id
    WHERE se.employee_id IS NULL
      AND COALESCE(se.name, '') <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM employees e
        WHERE (se.tenant_id IS NULL OR e.tenant_id = se.tenant_id)
          AND (se.branch_id IS NULL OR e.branch_id = se.branch_id)
          AND COALESCE(e.is_deleted, FALSE) = FALSE
          AND (
            LOWER(COALESCE(e.employee_code, '')) = LOWER(COALESCE(se.code, ''))
            OR LOWER(COALESCE(e.full_name, '')) = LOWER(COALESCE(se.name, ''))
            OR (COALESCE(e.phone, '') <> '' AND COALESCE(e.phone, '') = COALESCE(se.phone, ''))
          )
      )
  `);

  await clientOrPool.query(`
    UPDATE sales_employees se
    SET employee_id = e.id
    FROM employees e
    WHERE se.employee_id IS NULL
      AND (se.tenant_id IS NULL OR e.tenant_id = se.tenant_id)
      AND (se.branch_id IS NULL OR e.branch_id = se.branch_id)
      AND LOWER(COALESCE(e.full_name, '')) = LOWER(COALESCE(se.name, ''))
  `);

  await clientOrPool.query(`
    INSERT INTO employee_sales_profiles (
      employee_id, tenant_id, pos_alias, is_sales_active, commission_type, commission_value,
      fixed_commission_mode, excluded_product_ids, excluded_category_ids, migrated_sales_employee_id
    )
    SELECT DISTINCT ON (e.id)
      e.id,
      COALESCE(e.tenant_id, se.tenant_id),
      se.pos_alias,
      COALESCE(se.is_active, TRUE),
      COALESCE(se.commission_type, 'percent'),
      COALESCE(se.commission_value, 0),
      se.fixed_commission_mode,
      COALESCE(se.excluded_product_ids, '[]'::jsonb),
      COALESCE(se.excluded_category_ids, '[]'::jsonb),
      se.id
    FROM sales_employees se
    JOIN employees e ON e.id = se.employee_id
    WHERE NOT EXISTS (
      SELECT 1 FROM employee_sales_profiles existing WHERE existing.employee_id = e.id
    )
    ORDER BY e.id, se.updated_at DESC, se.id DESC
  `);

  await clientOrPool.query(`
    CREATE TABLE IF NOT EXISTS sales_commission_settings (
      tenant_id BIGINT PRIMARY KEY,
      allow_sale_without_salesperson BOOLEAN NOT NULL DEFAULT TRUE,
      fixed_commission_mode VARCHAR(30) NOT NULL DEFAULT 'fixed_per_item',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await clientOrPool.query(`ALTER TABLE IF EXISTS sales_commission_settings ALTER COLUMN fixed_commission_mode SET DEFAULT 'fixed_per_item'`);

  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS sales_employee_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS seller_user_id BIGINT NULL`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS seller_name VARCHAR(255)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_name VARCHAR(255)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_commission_type VARCHAR(20)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_commission_value NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_fixed_mode VARCHAR(30)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_excluded_product_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS salesperson_excluded_category_ids JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_salesperson_created ON orders (tenant_id, salesperson_id, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_sales_employee_created ON orders (tenant_id, sales_employee_id, created_at DESC)`);
  await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_orders_seller_user_created ON orders (tenant_id, seller_user_id, created_at DESC)`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS sales_employee_id BIGINT NULL`);
  await migrateSellerEmployeeReferences(clientOrPool);
  console.info("[seller-fk-check:found]", { source: "ensureSalesCommissionSchema", step: "ensure_completed" });

  await clientOrPool.query(`ALTER TABLE IF EXISTS order_items ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0`);

  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_commissions ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'legacy'`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_commissions ADD COLUMN IF NOT EXISTS returned_quantity INTEGER NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_commissions ADD COLUMN IF NOT EXISTS net_sale_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employee_commissions ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`);
};

export const getSalesSettings = async (clientOrPool = db, tenantId = null) => {
  const settingsTenantId = tenantId ?? 0;
  const result = await clientOrPool.query(
    `SELECT * FROM sales_commission_settings WHERE tenant_id = $1 LIMIT 1`,
    [settingsTenantId]
  );
  const row = result.rows[0] || {};
  return {
    allow_sale_without_salesperson: row.allow_sale_without_salesperson ?? DEFAULT_SETTINGS.allow_sale_without_salesperson,
    fixed_commission_mode: normalizeFixedMode(row.fixed_commission_mode || DEFAULT_SETTINGS.fixed_commission_mode),
  };
};

export const upsertSalesSettings = async (clientOrPool = db, tenantId = null, settings = {}) => {
  const settingsTenantId = tenantId ?? 0;
  const next = {
    allow_sale_without_salesperson: toBool(settings.allow_sale_without_salesperson, DEFAULT_SETTINGS.allow_sale_without_salesperson),
    fixed_commission_mode: normalizeFixedMode(settings.fixed_commission_mode || DEFAULT_SETTINGS.fixed_commission_mode),
  };
  const result = await clientOrPool.query(
    `
    INSERT INTO sales_commission_settings (tenant_id, allow_sale_without_salesperson, fixed_commission_mode)
    VALUES ($1,$2,$3)
    ON CONFLICT (tenant_id) DO UPDATE
    SET allow_sale_without_salesperson = EXCLUDED.allow_sale_without_salesperson,
        fixed_commission_mode = EXCLUDED.fixed_commission_mode,
        updated_at = NOW()
    RETURNING *
    `,
    [settingsTenantId, next.allow_sale_without_salesperson, next.fixed_commission_mode]
  );
  return {
    allow_sale_without_salesperson: result.rows[0].allow_sale_without_salesperson,
    fixed_commission_mode: result.rows[0].fixed_commission_mode,
  };
};

export const listSalesEmployees = async ({ tenantId = null, includeInactive = false, branchId = null } = {}) => {
  const normalizedBranchId = normalizeOptionalLookupId(branchId);
  const result = await db.query(
    `
    SELECT
      e.id,
      e.tenant_id,
      e.branch_id,
      b.name AS branch_name,
      e.user_id,
      e.full_name AS name,
      e.employee_code AS code,
      e.phone,
      e.email,
      e.employee_portal_token,
      e.role,
      e.salary AS base_salary,
      e.status AS employee_status,
      COALESCE(esp.pos_alias, '') AS pos_alias,
      (esp.employee_id IS NOT NULL) AS profile_configured,
      COALESCE(esp.is_sales_active, FALSE) AS active_for_pos,
      COALESCE(esp.is_sales_active, FALSE) AS is_sales_active,
      (e.status = 'active' AND e.is_deleted IS DISTINCT FROM TRUE) AS is_active,
      COALESCE(esp.commission_type, 'percent') AS commission_type,
      COALESCE(esp.commission_value, 0) AS commission_value,
      esp.fixed_commission_mode,
      COALESCE(esp.excluded_product_ids, '[]'::jsonb) AS excluded_product_ids,
      COALESCE(esp.excluded_category_ids, '[]'::jsonb) AS excluded_category_ids,
      esp.updated_at
    FROM employees e
    LEFT JOIN employee_sales_profiles esp ON esp.employee_id = e.id
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      AND e.is_deleted IS DISTINCT FROM TRUE
      AND ($2::boolean = TRUE OR e.status = 'active')
      AND ($3::text IS NULL OR e.branch_id::text = $3::text)
    ORDER BY is_active DESC, e.full_name ASC, e.id ASC
    `,
    [tenantId, includeInactive, normalizedBranchId]
  );
  return result.rows.map((row) => ({
    ...row,
    commission_value: toNumber(row.commission_value),
    fixed_commission_mode: normalizeFixedMode(row.fixed_commission_mode || DEFAULT_SETTINGS.fixed_commission_mode),
    commission_mode: normalizeCommissionMode(row.commission_type === "fixed" ? row.fixed_commission_mode || DEFAULT_SETTINGS.fixed_commission_mode : row.commission_type),
    profile_configured: Boolean(row.profile_configured),
    configured: Boolean(row.profile_configured),
    active_for_pos: Boolean(row.active_for_pos),
    excluded_product_ids: normalizeIds(row.excluded_product_ids),
    excluded_category_ids: normalizeIds(row.excluded_category_ids),
  }));
};

export const saveSalesEmployee = async ({ tenantId = null, id = null, data = {} } = {}) => {
  const employeeId = normalizeOptionalId(id || data.employee_id || data.employeeId || data.id);
  const payload = {
    pos_alias: String(data.pos_alias || data.posAlias || "").trim().slice(0, 20) || null,
    is_active: toBool(data.is_sales_active ?? data.is_active, true),
    commission_mode: resolveCommissionModeInput(data),
    commission_value: Math.max(0, toNumber(data.commission_value)),
    excluded_product_ids: normalizeIds(data.excluded_product_ids),
    excluded_category_ids: normalizeIds(data.excluded_category_ids),
    branch_id: normalizeOptionalLookupId(data.branch_id ?? data.branchId),
  };
  if (data.active_for_pos !== undefined || data.activeForPos !== undefined) {
    payload.is_active = toBool(data.active_for_pos ?? data.activeForPos, payload.is_active);
  }
  payload.commission_type = commissionTypeFromMode(payload.commission_mode);
  payload.fixed_commission_mode = normalizeFixedMode(payload.commission_mode);

  if (!employeeId) {
    const error = new Error("Select an existing employee before saving sales settings");
    error.status = 400;
    throw error;
  }

  const employeeResult = await db.query(
    `
    SELECT *
    FROM employees
    WHERE id = $1
      AND is_deleted IS DISTINCT FROM TRUE
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      AND ($3::text IS NULL OR branch_id::text = $3::text)
    LIMIT 1
    `,
    [employeeId, tenantId, payload.branch_id]
  );
  const employee = employeeResult.rows[0];
  if (!employee) {
    const error = new Error("Employee not found in selected branch");
    error.status = 404;
    throw error;
  }

  const result = await db.query(
    `
    INSERT INTO employee_sales_profiles (
      employee_id, tenant_id, pos_alias, is_sales_active, commission_type, commission_value,
      excluded_product_ids, excluded_category_ids, fixed_commission_mode
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
    ON CONFLICT (employee_id) DO UPDATE
    SET pos_alias = EXCLUDED.pos_alias,
        is_sales_active = EXCLUDED.is_sales_active,
        commission_type = EXCLUDED.commission_type,
        commission_value = EXCLUDED.commission_value,
        excluded_product_ids = EXCLUDED.excluded_product_ids,
        excluded_category_ids = EXCLUDED.excluded_category_ids,
        fixed_commission_mode = EXCLUDED.fixed_commission_mode,
        updated_at = NOW()
    RETURNING *
    `,
    [employee.id, employee.tenant_id ?? tenantId, payload.pos_alias, payload.is_active, payload.commission_type, payload.commission_value, JSON.stringify(payload.excluded_product_ids), JSON.stringify(payload.excluded_category_ids), payload.fixed_commission_mode]
  );
  return {
    ...employee,
    ...result.rows[0],
    id: employee.id,
    name: employee.full_name,
    code: employee.employee_code,
    branch_id: employee.branch_id,
    is_active: employee.status === "active" && result.rows[0].is_sales_active !== false,
    is_sales_active: result.rows[0].is_sales_active !== false,
    active_for_pos: result.rows[0].is_sales_active !== false,
    profile_configured: true,
    configured: true,
  };
};

export const getSalespersonSnapshot = async (clientOrPool, { tenantId = null, salespersonId = null, branchId = null } = {}) => {
  if (!salespersonId) return null;
  const normalizedBranchId = normalizeOptionalLookupId(branchId);
  const result = await clientOrPool.query(
    `
    SELECT
      e.id,
      e.full_name AS name,
      e.employee_code AS code,
      e.branch_id,
      e.user_id,
      COALESCE(esp.pos_alias, '') AS pos_alias,
      esp.is_sales_active AS is_sales_active,
      COALESCE(esp.commission_type, 'percent') AS commission_type,
      COALESCE(esp.commission_value, 0) AS commission_value,
      esp.fixed_commission_mode,
      COALESCE(esp.excluded_product_ids, '[]'::jsonb) AS excluded_product_ids,
      COALESCE(esp.excluded_category_ids, '[]'::jsonb) AS excluded_category_ids
    FROM employees e
    LEFT JOIN employee_sales_profiles esp ON esp.employee_id = e.id
      AND ($2::bigint IS NULL OR esp.tenant_id = $2::bigint OR esp.tenant_id IS NULL)
    WHERE (e.id = $1 OR e.user_id = $1)
      AND e.status = 'active'
      AND e.is_deleted IS DISTINCT FROM TRUE
      AND COALESCE(esp.is_sales_active, TRUE) = TRUE
      AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint)
      AND ($3::text IS NULL OR e.branch_id::text = $3::text)
    LIMIT 1
    `,
    [salespersonId, tenantId, normalizedBranchId]
  );
  const employee = result.rows[0];
  if (!employee) return null;
  const settings = await getSalesSettings(clientOrPool, tenantId);
  return {
    salesperson_id: employee.id,
    salesperson_name: employee.name,
    commission_type: normalizeCommissionType(employee.commission_type),
    commission_value: toNumber(employee.commission_value),
    fixed_mode: employee.commission_type === "fixed" ? normalizeFixedMode(employee.fixed_commission_mode || settings.fixed_commission_mode) : settings.fixed_commission_mode,
    excluded_product_ids: normalizeIds(employee.excluded_product_ids),
    excluded_category_ids: normalizeIds(employee.excluded_category_ids),
    branch_id: employee.branch_id || null,
  };
};

const calculateLineCommission = ({ lineAmount = 0, quantity = 0, commissionType = "percent", commissionValue = 0, fixedMode = "fixed_per_invoice", invoiceFixedAlreadyApplied = false }) => {
  if (lineAmount <= 0 || quantity <= 0 || commissionValue <= 0) return { amount: 0, fixedApplied: false };
  if (commissionType === "percent") return { amount: lineAmount * (commissionValue / 100), fixedApplied: false };
  if (fixedMode === "fixed_per_item") return { amount: quantity * commissionValue, fixedApplied: false };
  if (invoiceFixedAlreadyApplied) return { amount: 0, fixedApplied: false };
  return { amount: commissionValue, fixedApplied: true };
};

export const recordSalesCommissionForOrder = async (client, { tenantId = null, order = {}, items = [], createdBy = null } = {}) => {
  const salespersonId = order.sales_employee_id || order.salesperson_id || null;
  if (!salespersonId || ["cancelled", "canceled", "void"].includes(String(order.status || "").toLowerCase())) {
    return { recorded: false, totalCommission: 0, rows: [] };
  }

  const excludedProducts = new Set(normalizeIds(order.salesperson_excluded_product_ids));
  const excludedCategories = new Set(normalizeIds(order.salesperson_excluded_category_ids));
  const commissionType = normalizeCommissionType(order.salesperson_commission_type);
  const commissionValue = toNumber(order.salesperson_commission_value);
  const fixedMode = normalizeFixedMode(order.salesperson_fixed_mode);
  let invoiceFixedApplied = false;
  let totalCommission = 0;
  const rows = [];

  for (const item of items) {
    const productId = Number(item.product_id || 0);
    const categoryId = Number(item.category_id || 0);
    if ((productId && excludedProducts.has(productId)) || (categoryId && excludedCategories.has(categoryId))) continue;
    const quantity = Math.max(0, toNumber(item.quantity));
    const returnedQuantity = Math.max(0, toNumber(item.returned_quantity));
    const netQuantity = Math.max(0, quantity - returnedQuantity);
    const grossLine = toNumber(item.total_amount, toNumber(item.sale_price) * quantity);
    const lineAmount = quantity > 0 ? grossLine * (netQuantity / quantity) : 0;
    const result = calculateLineCommission({
      lineAmount,
      quantity: netQuantity,
      commissionType,
      commissionValue,
      fixedMode,
      invoiceFixedAlreadyApplied: invoiceFixedApplied,
    });
    invoiceFixedApplied = invoiceFixedApplied || result.fixedApplied;
    if (result.amount <= 0) continue;
    totalCommission += result.amount;
    const insert = await client.query(
      `
      INSERT INTO employee_commissions (
        tenant_id, employee_id, order_id, order_item_id, product_id, category_id,
        commission_rule_id, rule_type, scope_type, sale_amount, net_sale_amount,
        commission_amount, status, branch_id, shift_id, created_by, source, snapshot
      )
      VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,'salesperson',$8,$9,$10,$11,$12,$13,$14,'salesperson',$15::jsonb)
      RETURNING *
      `,
      [
        tenantId,
        salespersonId,
        order.id,
        item.id || item.order_item_id || null,
        item.product_id || null,
        item.category_id || null,
        commissionType,
        grossLine,
        lineAmount,
        result.amount,
        ["paid", "completed", "partial", "partially_paid"].includes(String(order.payment_status || "").toLowerCase()) ? "earned" : "pending",
        order.branch_id || null,
        order.shift_id || null,
        createdBy,
        JSON.stringify({
          salesperson_name: order.seller_name || order.salesperson_name,
          commission_type: commissionType,
          commission_value: commissionValue,
          fixed_mode: fixedMode,
          excluded_product_ids: [...excludedProducts],
          excluded_category_ids: [...excludedCategories],
        }),
      ]
    );
    rows.push(insert.rows[0]);
  }

  return { recorded: rows.length > 0, totalCommission, rows };
};

const dateWhere = (alias, params, { startDate, endDate }) => {
  const clauses = [];
  if (startDate) {
    params.push(startDate);
    clauses.push(`${alias}.created_at >= $${params.length}`);
  }
  if (endDate) {
    params.push(endDate);
    clauses.push(`${alias}.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }
  return clauses;
};

export const getSalesCommissionReport = async ({ tenantId = null, filters = {} } = {}) => {
  const rawSalespersonExpr = "COALESCE(oi.sales_employee_id, o.sales_employee_id, o.salesperson_id)";
  const salespersonExpr = "COALESCE(employee_direct.id, employee_sales_user.id, employee_user.id)";
  const params = [tenantId];
  const clauses = [
    "($1::bigint IS NULL OR o.tenant_id IS NULL OR o.tenant_id = $1::bigint)",
    `${salespersonExpr} IS NOT NULL`,
    "LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'canceled', 'void')",
    `(
      LOWER(COALESCE(o.status, '')) IN ('paid', 'completed', 'complete', 'closed', 'delivered')
      OR LOWER(COALESCE(o.payment_status, '')) IN ('paid', 'completed', 'success', 'succeeded')
    )`,
  ];
  clauses.push(...dateWhere("o", params, filters));
  if (filters.branchId) {
    params.push(filters.branchId);
    clauses.push(`o.branch_id = $${params.length}`);
  }
  if (filters.employeeId) {
    params.push(filters.employeeId);
    clauses.push(`${salespersonExpr} = $${params.length}`);
  }

  const result = await db.query(
    `
    WITH line_base AS (
      SELECT
        o.id AS order_id,
        ${salespersonExpr} AS salesperson_id,
        COALESCE(o.salesperson_name, employee_direct.full_name, employee_sales_user.full_name, employee_user.full_name, o.seller_name, u.name, 'Unlinked employee') AS salesperson_name,
        (esp.employee_id IS NOT NULL) AS has_commission_profile,
        COALESCE(o.salesperson_commission_type, esp.commission_type, 'percent') AS salesperson_commission_type,
        CASE
          WHEN o.salesperson_commission_type IS NOT NULL THEN COALESCE(o.salesperson_commission_value, 0)
          ELSE COALESCE(esp.commission_value, 0)
        END AS salesperson_commission_value,
        COALESCE(o.salesperson_fixed_mode, esp.fixed_commission_mode, 'fixed_per_invoice') AS fixed_mode,
        COALESCE(o.branch_id, 0) AS branch_id,
        oi.id AS order_item_id,
        COALESCE(oi.product_id, 0) AS product_id,
        COALESCE(p.category_id, 0) AS category_id,
        COALESCE(oi.quantity, 0)::numeric AS quantity,
        COALESCE(oi.returned_quantity, 0)::numeric AS returned_quantity,
        COALESCE(oi.total_amount, COALESCE(oi.sale_price, 0) * COALESCE(oi.quantity, 0))::numeric AS gross_line,
        CASE
          WHEN COALESCE(oi.quantity, 0) > 0
          THEN COALESCE(oi.total_amount, COALESCE(oi.sale_price, 0) * COALESCE(oi.quantity, 0))::numeric
               * GREATEST(COALESCE(oi.quantity, 0) - COALESCE(oi.returned_quantity, 0), 0)::numeric
               / COALESCE(oi.quantity, 1)::numeric
          ELSE 0
        END AS net_line,
        CASE
          WHEN o.salesperson_commission_type IS NOT NULL THEN COALESCE(o.salesperson_excluded_product_ids, '[]'::jsonb)
          ELSE COALESCE(esp.excluded_product_ids, '[]'::jsonb)
        END AS excluded_products,
        CASE
          WHEN o.salesperson_commission_type IS NOT NULL THEN COALESCE(o.salesperson_excluded_category_ids, '[]'::jsonb)
          ELSE COALESCE(esp.excluded_category_ids, '[]'::jsonb)
        END AS excluded_categories
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN users u ON u.id = o.seller_user_id
      LEFT JOIN employees employee_direct
        ON employee_direct.id = ${rawSalespersonExpr}
       AND employee_direct.is_deleted IS DISTINCT FROM TRUE
       AND ($1::bigint IS NULL OR employee_direct.tenant_id = $1::bigint)
      LEFT JOIN employees employee_sales_user
        ON employee_sales_user.user_id = o.sales_employee_id
       AND employee_sales_user.is_deleted IS DISTINCT FROM TRUE
       AND ($1::bigint IS NULL OR employee_sales_user.tenant_id = $1::bigint)
       AND (o.branch_id IS NULL OR employee_sales_user.branch_id = o.branch_id)
      LEFT JOIN employees employee_user
        ON employee_user.user_id = o.seller_user_id
       AND employee_user.is_deleted IS DISTINCT FROM TRUE
       AND ($1::bigint IS NULL OR employee_user.tenant_id = $1::bigint)
       AND (o.branch_id IS NULL OR employee_user.branch_id = o.branch_id)
      LEFT JOIN employee_sales_profiles esp
        ON esp.employee_id = ${salespersonExpr}
       AND ($1::bigint IS NULL OR esp.tenant_id = $1::bigint)
      WHERE ${clauses.join(" AND ")}
    ),
    eligible AS (
      SELECT *,
        NOT (
          product_id::text IN (SELECT jsonb_array_elements_text(excluded_products))
          OR category_id::text IN (SELECT jsonb_array_elements_text(excluded_categories))
        ) AS commission_eligible
      FROM line_base
    ),
    order_summary AS (
      SELECT
        order_id,
        salesperson_id,
        MAX(salesperson_name) AS salesperson_name,
        BOOL_OR(has_commission_profile) AS has_commission_profile,
        MAX(
          CASE
            WHEN salesperson_commission_type = 'none' THEN 'none'
            WHEN salesperson_commission_type = 'fixed' THEN fixed_mode
            ELSE 'percent'
          END
        ) AS commission_mode,
        MAX(COALESCE(salesperson_commission_value, 0))::numeric AS commission_value,
        SUM(quantity)::numeric AS total_items_sold,
        SUM(returned_quantity)::numeric AS returns_refunds,
        SUM(gross_line)::numeric AS total_sales,
        SUM(net_line)::numeric AS net_sales,
        SUM(CASE WHEN commission_eligible THEN net_line ELSE 0 END)::numeric AS eligible_net_sales,
        SUM(CASE WHEN commission_eligible THEN GREATEST(quantity - returned_quantity, 0) ELSE 0 END)::numeric AS eligible_items,
        SUM(CASE
          WHEN commission_eligible AND salesperson_commission_type = 'percent' AND COALESCE(salesperson_commission_value, 0) > 0
            THEN net_line * COALESCE(salesperson_commission_value, 0) / 100
          WHEN commission_eligible AND salesperson_commission_type = 'fixed' AND fixed_mode = 'fixed_per_item' AND COALESCE(salesperson_commission_value, 0) > 0
            THEN GREATEST(quantity - returned_quantity, 0) * COALESCE(salesperson_commission_value, 0)
          ELSE 0
        END)::numeric AS line_commissions,
        MAX(CASE
          WHEN salesperson_commission_type = 'fixed' AND fixed_mode = 'fixed_per_invoice' AND COALESCE(salesperson_commission_value, 0) > 0
          THEN COALESCE(salesperson_commission_value, 0)
          ELSE 0
        END)::numeric AS invoice_fixed_commission
      FROM eligible
      GROUP BY order_id, salesperson_id
    )
    SELECT
      salesperson_id,
      MAX(salesperson_name) AS salesperson_name,
      BOOL_OR(has_commission_profile) AS has_commission_profile,
      MAX(commission_mode) AS commission_mode,
      MAX(commission_value)::numeric AS commission_value,
      COUNT(*)::int AS total_invoices,
      SUM(total_items_sold)::numeric AS total_items_sold,
      SUM(returns_refunds)::numeric AS returns_refunds,
      SUM(total_sales)::numeric AS total_sales,
      SUM(net_sales)::numeric AS net_sales,
      SUM(eligible_net_sales)::numeric AS eligible_net_sales,
      SUM(eligible_items)::numeric AS eligible_items,
      SUM(
        line_commissions
        + CASE WHEN eligible_net_sales > 0 THEN invoice_fixed_commission ELSE 0 END
      )::numeric AS earned_commissions
    FROM order_summary
    GROUP BY salesperson_id
    ORDER BY net_sales DESC, earned_commissions DESC
    `,
    params
  );

  const rows = result.rows.map((row) => {
    const totalSales = toNumber(row.total_sales);
    const netSales = toNumber(row.net_sales);
    const eligibleSales = toNumber(row.eligible_net_sales);
    const eligibleItems = toNumber(row.eligible_items);
    const commissionValue = toNumber(row.commission_value);
    const earnedCommissions = toNumber(row.earned_commissions);
    const commissionMode = normalizeCommissionMode(row.commission_mode);
    let zeroReason = "";
    if (earnedCommissions <= 0 && netSales > 0) {
      if (!row.has_commission_profile) zeroReason = "No commission profile";
      else if (commissionMode === "none") zeroReason = "Commission disabled";
      else if (commissionValue <= 0) zeroReason = "Commission value zero";
      else if (eligibleSales <= 0 || eligibleItems <= 0) zeroReason = "Excluded items";
      else zeroReason = "No eligible sales";
    }
    const normalized = {
      ...row,
      has_commission_profile: Boolean(row.has_commission_profile),
      commission_mode: commissionMode,
      commission_value: commissionValue,
      total_invoices: toNumber(row.total_invoices),
      total_items_sold: toNumber(row.total_items_sold),
      returns_refunds: toNumber(row.returns_refunds),
      total_sales: totalSales,
      net_sales: netSales,
      eligible_net_sales: eligibleSales,
      eligible_items: eligibleItems,
      earned_commissions: earnedCommissions,
      zero_reason: zeroReason,
    };
    console.log("[commission-calc-debug]", {
      employee_id: normalized.salesperson_id,
      employee_name: normalized.salesperson_name,
      sales: normalized.total_sales,
      eligible_sales: normalized.eligible_net_sales,
      eligible_items: normalized.eligible_items,
      commission_mode: normalized.commission_mode,
      commission_value: normalized.commission_value,
      calculated_commission: normalized.earned_commissions,
      zero_reason: normalized.zero_reason || null,
    });
    return normalized;
  });
  const summary = rows.reduce(
    (acc, row) => ({
      total_sales: acc.total_sales + row.total_sales,
      total_invoices: acc.total_invoices + row.total_invoices,
      total_items_sold: acc.total_items_sold + row.total_items_sold,
      returns_refunds: acc.returns_refunds + row.returns_refunds,
      net_sales: acc.net_sales + row.net_sales,
      earned_commissions: acc.earned_commissions + row.earned_commissions,
    }),
    { total_sales: 0, total_invoices: 0, total_items_sold: 0, returns_refunds: 0, net_sales: 0, earned_commissions: 0 }
  );
  if (["1", "true", "yes", "on"].includes(String(process.env.ERP_ANALYTICS_DEBUG || "").toLowerCase())) {
    console.info("[commission-report]", {
      filters,
      rows: rows.length,
      totals: summary,
      source_tables: ["orders", "order_items", "employees", "employee_sales_profiles"],
    });
  }
  return {
    rows,
    summary,
  };
};

export const getPayrollPreview = async ({ tenantId = null, employeeId, filters = {} } = {}) => {
  await ensureAttendanceSchema(db);
  const branchId = normalizeOptionalLookupId(filters.branchId || filters.branch_id);
  const employeeResult = await db.query(
    `
    SELECT
      e.*,
      COALESCE(esp.pos_alias, '') AS pos_alias,
      COALESCE(esp.is_sales_active, TRUE) AS is_sales_active
    FROM employees e
    LEFT JOIN employee_sales_profiles esp ON esp.employee_id = e.id
    WHERE e.id = $1
      AND e.is_deleted IS DISTINCT FROM TRUE
      AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint)
      AND ($3::text IS NULL OR e.branch_id::text = $3::text)
    LIMIT 1
    `,
    [employeeId, tenantId, branchId]
  );
  const employee = employeeResult.rows[0];
  if (!employee) {
    const error = new Error("Employee not found in selected branch");
    error.status = 404;
    throw error;
  }
  const report = await getSalesCommissionReport({ tenantId, filters: { ...filters, employeeId, branchId } });
  const earnedSalesAmount = toNumber(report.summary.net_sales);
  const eligibleItemsCount = toNumber(report.summary.total_items_sold) - toNumber(report.summary.returns_refunds);
  const salesEarnings = toNumber(report.summary.earned_commissions);
  const providedBaseSalary = filters.base_salary ?? filters.baseSalary;
  const baseSalary = providedBaseSalary === undefined || providedBaseSalary === null || providedBaseSalary === "" ? toNumber(employee.salary) : toNumber(providedBaseSalary);
  const bonuses = toNumber(filters.bonuses);
  const manualDeductions = toNumber(filters.deductions);
  let advanceDeductions = 0;
  let advanceRows = [];
  const deductionMonth = String(filters.deduction_month || filters.deductionMonth || filters.month || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const periodBounds = monthBounds(deductionMonth);
  const payrollPeriodStart = normalizeDateInput(filters.startDate || filters.start_date || filters.start) || periodBounds.start;
  const payrollPeriodEnd = normalizeDateInput(filters.endDate || filters.end_date || filters.end) || periodBounds.end;
  let penaltyDeductions = 0;
  let penaltyRows = [];
  let attendanceDeductions = {
    absence_days: 0,
    missing_hours: 0,
    late_hours: 0,
    early_leave_hours: 0,
    daily_rate: 0,
    hourly_rate: 0,
    absence_deduction: 0,
    missing_hours_deduction: 0,
    late_deduction: 0,
    early_leave_deduction: 0,
    attendance_deduction_total: 0,
    expected_working_days: 0,
    attended_days: 0,
    absent_working_days: 0,
    qr_records_count: 0,
    excluded_days_off: 0,
    monthly_days_off_excluded: 0,
    excluded_leave_days: 0,
    excluded_holiday_days: 0,
  };
  const shouldFinalize = String(filters.mark_advances_deducted || filters.markAdvancesDeducted || "").toLowerCase() === "true";
  const payrollReference = `payroll-${employeeId}-${deductionMonth}`;
  let payrollRun = null;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS employee_advances (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NULL,
        employee_id BIGINT NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        deducted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        deduction_month VARCHAR(7) NOT NULL,
        deduction_status VARCHAR(40) NOT NULL DEFAULT 'pending',
        status VARCHAR(40) NOT NULL DEFAULT 'pending',
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
    await db.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
    await db.query(`ALTER TABLE IF EXISTS employee_advances ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'pending'`);
    await db.query(`
      UPDATE expenses
      SET expense_type = 'employee_advance',
          category = COALESCE(NULLIF(category, ''), 'employee_advance'),
          updated_at = NOW()
      WHERE (
          LOWER(COALESCE(expense_type, '')) IN ('employee advance', 'employee_advance', 'advance', 'staff advance')
          OR LOWER(COALESCE(category, '')) IN ('employee advance', 'employee_advance', 'advance', 'staff advance')
        )
        AND COALESCE(expense_type, '') <> 'employee_advance'
    `).catch(() => null);
    await db.query(`
      INSERT INTO employee_advances (
        tenant_id, employee_id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status, notes, expense_id, created_by, created_at, updated_at
      )
      SELECT
        e.tenant_id,
        e.employee_id,
        COALESCE(e.amount, 0),
        0,
        COALESCE(e.amount, 0),
        to_char(COALESCE(e.expense_date, e.created_at::date, CURRENT_DATE), 'YYYY-MM'),
        'pending',
        'pending',
        COALESCE(NULLIF(e.notes, ''), NULLIF(e.note, '')),
        e.id,
        NULL,
        COALESCE(e.created_at, NOW()),
        NOW()
      FROM expenses e
      WHERE e.employee_id IS NOT NULL
        AND COALESCE(e.amount, 0) > 0
        AND (
          LOWER(COALESCE(e.expense_type, '')) = 'employee_advance'
          OR LOWER(COALESCE(e.category, '')) IN ('employee advance', 'employee_advance', 'advance', 'staff advance')
        )
        AND NOT EXISTS (
          SELECT 1 FROM employee_advances ea WHERE ea.expense_id = e.id
        )
    `).catch(() => null);
    await db.query(`
      UPDATE employee_advances
      SET remaining_amount = GREATEST(COALESCE(amount, 0) - COALESCE(deducted_amount, 0), 0),
          deduction_status = CASE
            WHEN deduction_status IN ('settled', 'deducted') THEN 'settled'
            WHEN deduction_status = 'included_in_payroll' THEN 'included_in_payroll'
            WHEN COALESCE(deducted_amount, 0) >= COALESCE(amount, 0) AND COALESCE(amount, 0) > 0 THEN 'settled'
            WHEN COALESCE(deducted_amount, 0) > 0 AND deduction_status IN ('pending', 'partial', 'partially_deducted') THEN 'partial'
            ELSE deduction_status
          END,
          status = CASE
            WHEN deduction_status = 'cancelled' THEN 'cancelled'
            WHEN deduction_status IN ('settled', 'deducted') OR (COALESCE(deducted_amount, 0) >= COALESCE(amount, 0) AND COALESCE(amount, 0) > 0) THEN 'settled'
            WHEN deduction_status = 'included_in_payroll' THEN 'included_in_payroll'
            ELSE 'pending'
          END,
          updated_at = NOW()
      WHERE remaining_amount IS DISTINCT FROM GREATEST(COALESCE(amount, 0) - COALESCE(deducted_amount, 0), 0)
         OR deduction_status IN ('partially_deducted', 'deducted')
         OR status IS NULL
    `);
    await db.query(`
      INSERT INTO employee_advances (
        tenant_id, employee_id, amount, deducted_amount, remaining_amount, deduction_month, deduction_status, status,
        notes, expense_id, created_by, created_at, updated_at
      )
      SELECT
        e.tenant_id,
        e.employee_id,
        COALESCE(e.amount, 0),
        0,
        COALESCE(e.amount, 0),
        to_char(COALESCE(e.expense_date, e.created_at::date, CURRENT_DATE), 'YYYY-MM'),
        'pending',
        'pending',
        COALESCE(NULLIF(e.notes, ''), NULLIF(e.note, '')),
        e.id,
        NULL,
        COALESCE(e.created_at, NOW()),
        NOW()
      FROM expenses e
      WHERE e.employee_id = $1
        AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint)
        AND COALESCE(e.amount, 0) > 0
        AND (
          LOWER(COALESCE(e.expense_type, '')) IN ('employee_advance', 'employee advance', 'advance', 'staff advance')
          OR LOWER(COALESCE(e.category, '')) IN ('employee_advance', 'employee advance', 'advance', 'staff advance')
        )
        AND NOT EXISTS (
          SELECT 1 FROM employee_advances ea WHERE ea.expense_id = e.id
        )
    `, [employeeId, tenantId]);
    advanceRows = await listActiveEmployeeAdvancesForPayroll({ tenantId, employeeId, deductionMonth });
    advanceDeductions = advanceRows.reduce((sum, row) => sum + toNumber(row.outstanding_amount), 0);
    for (const row of advanceRows) {
      console.log("[payroll-advance-settlement]", {
        employee_id: employeeId,
        advance_id: row.id,
        payroll_period: deductionMonth,
        advance_amount: toNumber(row.outstanding_amount),
        included_in_preview: true,
        finalized: shouldFinalize,
        settlement_status: shouldFinalize ? "settled" : row.settlement_status || row.deduction_status || "pending",
      });
    }
    console.log("[payroll] advance query", {
      employee_id: employeeId,
      tenant_id: tenantId,
      deduction_month: deductionMonth,
      active_statuses: ACTIVE_ADVANCE_STATUSES,
      count: advanceRows.length,
      advance_deductions: advanceDeductions,
      advance_ids: advanceRows.map((row) => row.id),
    });
    if (shouldFinalize && advanceRows.length) {
      const advanceIds = advanceRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id));
      const deductionByAdvanceId = new Map(advanceRows.map((row) => [String(row.id), toNumber(row.outstanding_amount)]));
      const settlement = await db.query(
        `
        UPDATE employee_advances
        SET deduction_status = 'settled',
            deducted_amount = amount,
            remaining_amount = 0,
            status = 'settled',
            deducted_at = NOW(),
            payroll_reference = $3,
            updated_at = NOW()
        WHERE id = ANY($1::bigint[])
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
          AND deduction_status = ANY($4::text[])
          AND employee_id::text = $5::text
          AND GREATEST(COALESCE(remaining_amount, amount - COALESCE(deducted_amount, 0)), 0) > 0
        RETURNING id, employee_id, amount, deducted_amount, remaining_amount, deduction_status, status, payroll_reference, created_at, updated_at
        `,
        [advanceIds, tenantId, payrollReference, ACTIVE_ADVANCE_STATUSES, employeeId]
      );
      console.log("[payroll] advance settlement update", {
        employee_id: employeeId,
        payroll_reference: payrollReference,
        settled_count: settlement.rowCount,
        advances: settlement.rows,
      });
      advanceRows = settlement.rows.map((row) => ({
        ...row,
        amount: toNumber(row.amount),
        deducted_amount: toNumber(row.deducted_amount),
        remaining_amount: toNumber(row.remaining_amount),
        outstanding_amount: toNumber(row.remaining_amount),
        payroll_deduction_amount: deductionByAdvanceId.get(String(row.id)) || toNumber(row.amount),
        status: "settled",
        advance_status: "settled",
        settlement_status: "settled",
      }));
    }
  } catch (error) {
    console.warn("[payroll] employee advances deduction skipped", error.message);
  }
  try {
    penaltyRows = await listApprovedEmployeePenaltiesForPayroll({
      tenantId,
      employeeId,
      periodStart: payrollPeriodStart,
      periodEnd: payrollPeriodEnd,
    });
    penaltyDeductions = penaltyRows.reduce((sum, row) => sum + toNumber(row.payroll_deduction_amount ?? row.amount), 0);
    console.log("[payroll] penalties query", {
      employee_id: employeeId,
      tenant_id: tenantId,
      period_start: payrollPeriodStart,
      period_end: payrollPeriodEnd,
      count: penaltyRows.length,
      penalties_total: penaltyDeductions,
      penalty_ids: penaltyRows.map((row) => row.id),
    });
  } catch (error) {
    console.warn("[payroll] employee penalties deduction skipped", error.message);
  }
  try {
    attendanceDeductions = await calculateAttendancePayrollDeductions({
      tenantId,
      employee,
      baseSalary,
      periodStart: payrollPeriodStart,
      periodEnd: payrollPeriodEnd,
      branchId,
    });
    console.log("[payroll] attendance deductions", {
      employee_id: employeeId,
      tenant_id: tenantId,
      period_start: payrollPeriodStart,
      period_end: payrollPeriodEnd,
      ...attendanceDeductions,
    });
  } catch (error) {
    console.warn("[payroll] attendance deduction skipped", error.message);
  }
  const attendanceDeductionTotal = toNumber(attendanceDeductions.attendance_deduction_total);
  const deductions = manualDeductions + advanceDeductions + penaltyDeductions + attendanceDeductionTotal;
  console.log("[payroll] deduction scope", {
    selected_employee_id: employeeId,
    tenant_id: tenantId,
    manual_deductions: manualDeductions,
    advance_deductions: advanceDeductions,
    penalties_total: penaltyDeductions,
    attendance_deduction_total: attendanceDeductionTotal,
    matched_deductions_count: (manualDeductions > 0 ? 1 : 0) + advanceRows.length + penaltyRows.length,
    matched_deductions_total: deductions,
    matched_advance_ids: advanceRows.map((row) => row.id),
    matched_penalty_ids: penaltyRows.map((row) => row.id),
  });
  const netPay = baseSalary + salesEarnings + bonuses - deductions;
  const payrollSnapshot = {
    payroll_period: deductionMonth,
    employee_id: employee.id,
    base_salary: baseSalary,
    commissions: salesEarnings,
    bonuses,
    manual_deductions: manualDeductions,
    advance_deductions: advanceDeductions,
    penalties_total: penaltyDeductions,
    attendance_deductions: attendanceDeductions,
    deductions,
    net_pay: netPay,
    advances: advanceRows.map((row) => ({
      id: row.id,
      amount: toNumber(row.amount),
      payroll_deduction_amount: toNumber(row.payroll_deduction_amount ?? row.outstanding_amount ?? row.remaining_amount),
      remaining_amount: toNumber(row.remaining_amount),
      deduction_status: row.deduction_status,
      settlement_status: row.settlement_status || row.status || row.deduction_status,
      payroll_reference: row.payroll_reference || payrollReference,
    })),
    penalties: penaltyRows.map((row) => ({
      id: row.id,
      amount: toNumber(row.amount),
      payroll_deduction_amount: toNumber(row.payroll_deduction_amount ?? row.amount),
      penalty_date: row.penalty_date,
      payroll_period_start: row.payroll_period_start,
      payroll_period_end: row.payroll_period_end,
      reason: row.reason,
      status: row.status,
    })),
  };
  if (shouldFinalize) {
    try {
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
      const payrollRunResult = await db.query(
        `
        INSERT INTO employee_payroll_runs (
          tenant_id, employee_id, payroll_period, payroll_reference, base_salary, commissions, bonuses,
          manual_deductions, advance_deductions, penalties_total, attendance_deduction_total, total_deductions, net_pay, snapshot, finalized_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW())
        RETURNING id, employee_id, payroll_period, payroll_reference, net_pay, snapshot, finalized_at
        `,
        [
          tenantId,
          employee.id,
          deductionMonth,
          payrollReference,
          baseSalary,
          salesEarnings,
          bonuses,
          manualDeductions,
          advanceDeductions,
          penaltyDeductions,
          attendanceDeductionTotal,
          deductions,
          netPay,
          JSON.stringify(payrollSnapshot),
        ]
      );
      payrollRun = payrollRunResult.rows[0] || null;
    } catch (error) {
      console.warn("[payroll] payroll snapshot skipped", error.message);
    }
  }
  return {
    employee: {
      id: employee.id,
      name: employee.full_name,
      code: employee.employee_code,
      pos_alias: employee.pos_alias || "",
      branch_id: employee.branch_id || null,
      user_id: employee.user_id || null,
    },
    payroll: {
      base_salary: baseSalary,
      earned_sales_amount: earnedSalesAmount,
      eligible_items_count: Math.max(0, eligibleItemsCount),
      sales_earnings: salesEarnings,
      commissions: salesEarnings,
      bonuses,
      manual_deductions: manualDeductions,
      advance_deductions: advanceDeductions,
      penalty_deductions: penaltyDeductions,
      penalties_total: penaltyDeductions,
      absence_days: attendanceDeductions.absence_days,
      missing_hours: attendanceDeductions.missing_hours,
      late_hours: attendanceDeductions.late_hours,
      early_leave_hours: attendanceDeductions.early_leave_hours,
      daily_rate: attendanceDeductions.daily_rate,
      hourly_rate: attendanceDeductions.hourly_rate,
      absence_deduction: attendanceDeductions.absence_deduction,
      missing_hours_deduction: attendanceDeductions.missing_hours_deduction,
      late_deduction: attendanceDeductions.late_deduction,
      early_leave_deduction: attendanceDeductions.early_leave_deduction,
      attendance_deduction_total: attendanceDeductionTotal,
      absence_deductions: attendanceDeductionTotal,
      expected_working_days: attendanceDeductions.expected_working_days,
      attended_days: attendanceDeductions.attended_days,
      absent_working_days: attendanceDeductions.absent_working_days,
      qr_records_count: attendanceDeductions.qr_records_count,
      excluded_days_off: attendanceDeductions.excluded_days_off,
      monthly_days_off_excluded: attendanceDeductions.monthly_days_off_excluded,
      excluded_leave_days: attendanceDeductions.excluded_leave_days,
      excluded_holiday_days: attendanceDeductions.excluded_holiday_days,
      deductions,
      net_pay: netPay,
      final_salary: netPay,
    },
    employee_advances: advanceRows,
    employee_penalties: penaltyRows,
    payroll_run: payrollRun,
    payroll_snapshot: shouldFinalize ? payrollSnapshot : null,
    breakdown: report.rows,
    commission_report: report,
  };
};
