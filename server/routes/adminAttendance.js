import express from "express";
import net from "node:net";

import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { ensureStaffTasksSchema } from "../services/staffTasksService.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { calculateAttendanceMetrics } from "../utils/attendanceCalculator.js";
import { isSuperAdminUser } from "../utils/requestScope.js";

const router = express.Router();

const ATTENDANCE_TIMEZONE = String(process.env.ATTENDANCE_TIMEZONE || process.env.APP_TIMEZONE || process.env.TZ || "Africa/Cairo").trim() || "Africa/Cairo";

const getAttendanceDate = (date = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: ATTENDANCE_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date(date).toISOString().slice(0, 10);
  }
};

const dateKey = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const normalizeRole = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
const isAdminRole = (value = "") => ["admin", "super admin", "superadmin", "platform admin"].includes(normalizeRole(value));

const resolveTenantId = (req) => {
  const tenantId = Number(req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 0);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

const getRequestIp = (req) => {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const candidate = forwarded || req.ip || req.socket?.remoteAddress || "";
  const normalized = String(candidate).replace(/^::ffff:/, "").trim();
  return net.isIP(normalized) ? normalized : null;
};

const adminOnly = (req, res, next) => {
  if (isSuperAdminUser(req.user) || isAdminRole(req.user?.role) || isAdminRole(req.user?.role_name)) {
    return next();
  }
  return res.status(403).json({ success: false, message: "Admin access is required" });
};

const ensureAuditLogTable = async (client, query = null) => {
  const runQuery = query || ((step, sql, values = []) => client.query(sql, values));
  await runQuery("ensure_audit_logs_table", `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NULL,
      user_id BIGINT NULL,
      action VARCHAR(120) NOT NULL,
      entity_type VARCHAR(120),
      entity_id BIGINT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await runQuery("ensure_audit_logs_ip_address", "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address INET");
  await runQuery("ensure_audit_logs_user_agent", "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT");
};

const auditCleanup = async (client, req, { action, entityId = null, details = {}, query = null }) => {
  try {
    const runQuery = query || ((step, sql, values) => client.query(sql, values));
    await ensureAuditLogTable(client, runQuery);
    const auditSql = `
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details, ip_address, user_agent)
      VALUES ($1,$2,$3,'attendance_device_binding',$4,$5::jsonb,$6::inet,$7)
      `;
    const auditValues = [
      resolveTenantId(req),
      req.user?.id || null,
      action,
      entityId,
      JSON.stringify(details),
      getRequestIp(req),
      req.headers?.["user-agent"] || null,
    ];
    await runQuery("insert_audit_log", auditSql, auditValues);
  } catch (error) {
    console.warn("[admin-attendance] audit log skipped", error.message);
  }
};

const withTenant = (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) {
    res.status(400).json({ success: false, message: "Tenant context is required" });
    return null;
  }
  return tenantId;
};

const resolveEmployeeIdentifier = async (client, tenantId, rawIdentifier) => {
  const identifier = String(rawIdentifier || "").trim();
  const numericId = Number(identifier);
  const result = await client.query(
    `
    SELECT id, employee_code, full_name
    FROM employees
    WHERE tenant_id = $1
      AND COALESCE(is_deleted, FALSE) = FALSE
      AND (
        employee_code = $2
        OR ($3::bigint IS NOT NULL AND id = $3::bigint)
      )
    ORDER BY CASE WHEN employee_code = $2 THEN 0 ELSE 1 END, id DESC
    LIMIT 1
    `,
    [tenantId, identifier, Number.isFinite(numericId) && numericId > 0 ? numericId : null]
  );
  return result.rows[0] || null;
};

const getTimeZoneOffsetMs = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour) === 24 ? 0 : Number(values.hour);
  const zonedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    hour,
    Number(values.minute),
    Number(values.second)
  );
  return zonedAsUtc - date.getTime();
};

const getBusinessDateUtcRange = (businessDate) => {
  const [year, month, day] = String(businessDate || getAttendanceDate()).slice(0, 10).split("-").map(Number);
  const utcStartGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const utcEndGuess = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  const start = new Date(utcStartGuess.getTime() - getTimeZoneOffsetMs(utcStartGuess, ATTENDANCE_TIMEZONE));
  const end = new Date(utcEndGuess.getTime() - getTimeZoneOffsetMs(utcEndGuess, ATTENDANCE_TIMEZONE));
  return { start, end };
};

const parseManualAttendanceTimestamp = (businessDate, timeValue, addDay = false) => {
  const match = String(timeValue || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const { start } = getBusinessDateUtcRange(businessDate);
  const minutes = (Number(match[1]) * 60) + Number(match[2]) + (addDay ? 24 * 60 : 0);
  return new Date(start.getTime() + (minutes * 60 * 1000));
};

const todayAttendancePredicate = `
  tenant_id = $1
  AND employee_id = $2
  AND (
    attendance_date = $3::date
    OR (check_in_at >= $4::timestamp AND check_in_at < $5::timestamp)
    OR (check_in >= $4::timestamp AND check_in < $5::timestamp)
    OR (check_out_at >= $4::timestamp AND check_out_at < $5::timestamp)
    OR (check_out >= $4::timestamp AND check_out < $5::timestamp)
    OR (created_at >= $4::timestamp AND created_at < $5::timestamp)
  )
`;

const logAttendanceResetQuery = (sql, values) => {
  console.log("[attendance-reset]", {
    sql,
    values,
    valuesLength: values.length,
  });
};

const logAttendanceBulkResetQuery = (sql, values) => {
  const requiredParams = [...String(sql || "").matchAll(/\$(\d+)/g)]
    .reduce((max, match) => Math.max(max, Number(match[1]) || 0), 0);
  console.log("[attendance-bulk-reset]", {
    sql,
    values,
    valuesLength: values?.length ?? 0,
  });
  if ((values?.length ?? 0) !== requiredParams) {
    console.warn("[attendance-bulk-reset:mismatch]", {
      requiredParams,
      valuesLength: values?.length ?? 0,
      sql,
      values,
    });
  }
};

const logAttendanceSingleResetQuery = (step, sql, values) => {
  console.log("[attendance-single-reset]", {
    step,
    sql,
    values,
    valuesLength: values?.length ?? 0,
    expectedParams: [...String(sql || "").matchAll(/\$(\d+)/g)].map((match) => Number(match[1])),
  });
};

const queryAttendanceReset = async (client, sql, values, { bulk = false, single = false, step = "reset-query" } = {}) => {
  logAttendanceResetQuery(sql, values);
  if (bulk) logAttendanceBulkResetQuery(sql, values);
  if (single) logAttendanceSingleResetQuery(step, sql, values);
  try {
    return await client.query(sql, values);
  } catch (error) {
    error.resetStep = error.resetStep || step;
    throw error;
  }
};

const resetAttendanceState = async (client, { tenantId, employeeIds = [], businessDate = null, deviceKey = null, bindingId = null, resetSessions = true, bulk = false, bulkQuery = null, single = false, singleQuery = null }) => {
  const ids = [...new Set(employeeIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];
  if (!tenantId || ids.length === 0) {
    return {
      attendance_logs: 0,
      attendance_device_bindings: 0,
      employee_portal_sessions: 0,
      total: 0,
    };
  }

  if (bulkQuery || singleQuery) {
    const schemaQuery = bulkQuery || singleQuery;
    const schemaClient = Object.create(client);
    schemaClient.query = (sql, values = []) => schemaQuery("ensure_staff_tasks_schema", sql, values);
    await ensureStaffTasksSchema(schemaClient);
  } else {
    await ensureStaffTasksSchema(client);
  }
  const sessionsSql = `
    DELETE FROM employee_portal_sessions
    WHERE tenant_id = $1
      AND employee_id = ANY($2::bigint[])
    RETURNING id
    `;
  const sessionsValues = [tenantId, ids];

  const bindingValues = [tenantId, ids];
  const bindingPredicates = [];
  if (businessDate) {
    bindingValues.push(businessDate);
    bindingPredicates.push(`AND business_date = $${bindingValues.length}::date`);
  }
  if (deviceKey) {
    bindingValues.push(deviceKey);
    bindingPredicates.push(`AND device_key = $${bindingValues.length}`);
  }
  if (bindingId) {
    bindingValues.push(bindingId);
    bindingPredicates.push(`AND id = $${bindingValues.length}`);
  }
  const bindingsSql = `
    DELETE FROM attendance_device_bindings
    WHERE tenant_id = $1
      AND employee_id = ANY($2::bigint[])
      ${bindingPredicates.join("\n      ")}
    RETURNING id
    `;

  const sessionsDeleted = resetSessions
    ? await queryAttendanceReset(client, sessionsSql, sessionsValues, { bulk, single, step: "delete_employee_portal_sessions" })
    : { rowCount: 0 };
  const bindingsDeleted = await queryAttendanceReset(client, bindingsSql, bindingValues, { bulk, single, step: "delete_attendance_device_bindings" });

  return {
    attendance_logs: 0,
    attendance_device_bindings: bindingsDeleted.rowCount,
    employee_portal_sessions: sessionsDeleted.rowCount,
    total: bindingsDeleted.rowCount + sessionsDeleted.rowCount,
  };
};

const logResetDebug = (label, details = {}) => {
  console.info(`[admin-attendance:${label}]`, {
    employee_code: details.employeeCode || null,
    employee_id: details.employeeId || null,
    employee_ids: details.employeeIds || null,
    business_date: details.businessDate || null,
    binding_id: details.bindingId || null,
    device_key: details.deviceKey || null,
    deleted_rows: details.deletedRows || {},
    deleted_count: details.deletedCount || 0,
  });
};

const resetErrorResponse = (res, fallbackMessage, error, step = "reset") => {
  console.error("[attendance-reset:error]", {
    message: error?.message || fallbackMessage,
    code: error?.code || null,
    step: error?.resetStep || step,
  });
  return res.status(500).json({
    success: false,
    code: "ATTENDANCE_RESET_FAILED",
    step: error?.resetStep || step,
    message: fallbackMessage,
    error: {
      code: "ATTENDANCE_RESET_FAILED",
    },
  });
};

router.use(protect, adminOnly);

router.post("/manual-entry", permit("attendance", "edit"), async (req, res) => {
  const client = await db.connect();
  try {
    await ensureAttendanceSchema();
    res.set("Cache-Control", "no-store");
    const tenantId = withTenant(req, res);
    if (!tenantId) return;

    const employeeId = Number(req.body?.employee_id || req.body?.employeeId || 0);
    const attendanceDate = dateKey(req.body?.attendance_date || req.body?.attendanceDate);
    const checkInTime = String(req.body?.check_in_time || req.body?.checkInTime || "").trim();
    const checkOutTime = String(req.body?.check_out_time || req.body?.checkOutTime || "").trim();
    const checkOutDate = dateKey(req.body?.check_out_date || req.body?.checkOutDate || attendanceDate);
    const reason = String(req.body?.reason || "").trim();

    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) || !checkInTime || !reason) {
      return res.status(400).json({
        success: false,
        code: "INVALID_MANUAL_ATTENDANCE",
        message: "Employee, attendance date, check-in time and correction reason are required",
      });
    }

    const checkInAt = parseManualAttendanceTimestamp(attendanceDate, checkInTime);
    if (!checkInAt) {
      return res.status(400).json({ success: false, code: "INVALID_CHECK_IN_TIME", message: "Invalid check-in time" });
    }

    let checkOutAt = null;
    if (checkOutTime) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) {
        return res.status(400).json({ success: false, code: "INVALID_CHECK_OUT_DATE", message: "Invalid checkout date" });
      }
      checkOutAt = parseManualAttendanceTimestamp(checkOutDate, checkOutTime);
      if (!checkOutAt) {
        return res.status(400).json({ success: false, code: "INVALID_CHECK_OUT_TIME", message: "Invalid check-out time" });
      }
      if (checkOutAt < checkInAt) {
        return res.status(400).json({
          success: false,
          code: "CHECK_OUT_BEFORE_CHECK_IN",
          message: "Checkout date and time cannot be before check-in",
        });
      }
    }

    const employeeResult = await client.query(
      `
      SELECT id, employee_code, full_name, branch_id
      FROM employees
      WHERE tenant_id = $1
        AND id = $2
        AND COALESCE(is_deleted, FALSE) = FALSE
      LIMIT 1
      `,
      [tenantId, employeeId]
    );
    const employee = employeeResult.rows[0];
    if (!employee) {
      return res.status(404).json({ success: false, code: "EMPLOYEE_NOT_FOUND", message: "Employee not found" });
    }

    const requestedBranchId = Number(req.body?.branch_id || req.body?.branchId || 0);
    const branchId = requestedBranchId > 0 ? requestedBranchId : (employee.branch_id || null);
    const shiftResult = await client.query(
      `
      SELECT * FROM (
        SELECT
          NULL::bigint AS shift_id,
          ess.id AS schedule_id,
          ess.shift_name,
          ess.start_time,
          ess.end_time,
          ess.expected_hours,
          COALESCE(es.allowed_late_minutes, 0) AS allowed_late_minutes,
          COALESCE(es.overtime_after_minutes, ROUND(ess.expected_hours * 60)::int) AS overtime_after_minutes,
          0 AS priority
        FROM employee_shift_schedules ess
        LEFT JOIN LATERAL (
          SELECT allowed_late_minutes, overtime_after_minutes
          FROM employee_shifts
          WHERE tenant_id = ess.tenant_id AND employee_id = ess.employee_id
          ORDER BY updated_at DESC, id DESC
          LIMIT 1
        ) es ON TRUE
        WHERE ess.tenant_id = $1 AND ess.employee_id = $2 AND ess.work_date = $3::date
          AND LOWER(COALESCE(ess.status, 'scheduled')) <> 'cancelled'
        UNION ALL
        SELECT
          es.id AS shift_id,
          NULL::bigint AS schedule_id,
          es.shift_name,
          es.start_time,
          es.end_time,
          es.expected_hours,
          es.allowed_late_minutes,
          CASE
            WHEN COALESCE(es.overtime_after_minutes, 0) > 0 THEN es.overtime_after_minutes
            ELSE ROUND(COALESCE(es.expected_hours, 0) * 60)::int
          END AS overtime_after_minutes,
          1 AS priority
        FROM employee_shifts es
        WHERE es.tenant_id = $1 AND es.employee_id = $2
      ) resolved
      ORDER BY priority, schedule_id DESC NULLS LAST, shift_id DESC NULLS LAST
      LIMIT 1
      `,
      [tenantId, employeeId, attendanceDate]
    );
    const resolvedShift = shiftResult.rows[0] || null;
    const resolvedShiftStartAt = resolvedShift?.start_time
      ? parseManualAttendanceTimestamp(attendanceDate, String(resolvedShift.start_time).slice(0, 5))
      : null;
    let resolvedShiftEndAt = resolvedShift?.end_time
      ? parseManualAttendanceTimestamp(attendanceDate, String(resolvedShift.end_time).slice(0, 5))
      : null;
    if (resolvedShiftStartAt && resolvedShiftEndAt && resolvedShiftEndAt <= resolvedShiftStartAt) {
      resolvedShiftEndAt = new Date(resolvedShiftEndAt.getTime() + 24 * 60 * 60000);
    }
    const metrics = calculateAttendanceMetrics({
      attendanceDate,
      checkIn: checkInAt,
      checkOut: checkOutAt,
      shift: resolvedShift || {},
    });
    const workMinutes = metrics.work_minutes;
    const status = checkOutAt ? "checked_out" : "checked_in";
    const auditNote = `Admin attendance correction: ${reason}`;

    await client.query("BEGIN");
    const existingResult = await client.query(
      `
      SELECT *
      FROM attendance_logs
      WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date = $3::date
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [tenantId, employeeId, attendanceDate]
    );
    const before = existingResult.rows[0] || null;
    let saved;

    if (before) {
      const updated = await client.query(
        `
        UPDATE attendance_logs
        SET branch_id = COALESCE($4, branch_id),
            check_in = $5,
            check_in_at = $5,
            check_out = $6,
            check_out_at = $6,
            attendance_source = 'admin_manual',
            status = $7,
            worked_hours = $8,
            work_minutes = $9,
            late_minutes = $11,
            early_leave_minutes = $12,
            overtime_minutes = $13,
            shift_id = COALESCE($14, shift_id),
            selected_shift_id = COALESCE($14, selected_shift_id),
            resolved_shift_start_time = $15,
            resolved_shift_end_time = $16,
            shift_resolution_status = $17,
            notes = CASE WHEN COALESCE(notes, '') = '' THEN $10 ELSE notes || E'\n' || $10 END,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date = $3::date
        RETURNING *
        `,
        [tenantId, employeeId, attendanceDate, branchId, checkInAt, checkOutAt, status, Number((workMinutes / 60).toFixed(2)), workMinutes, auditNote,
          metrics.late_minutes, metrics.early_leave_minutes, metrics.overtime_minutes, resolvedShift?.shift_id || null,
          resolvedShiftStartAt, resolvedShiftEndAt, resolvedShift ? "matched" : "unresolved"]
      );
      saved = updated.rows[0];
    } else {
      const inserted = await client.query(
        `
        INSERT INTO attendance_logs (
          tenant_id, employee_id, branch_id, attendance_date,
          check_in, check_in_at, check_out, check_out_at,
          attendance_source, status, worked_hours, work_minutes, notes, user_agent, ip_address
          , late_minutes, early_leave_minutes, overtime_minutes, shift_id, selected_shift_id,
          resolved_shift_start_time, resolved_shift_end_time, shift_resolution_status
        )
        VALUES ($1,$2,$3,$4::date,$5,$5,$6,$6,'admin_manual',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17,$18,$19)
        RETURNING *
        `,
        [tenantId, employeeId, branchId, attendanceDate, checkInAt, checkOutAt, status, Number((workMinutes / 60).toFixed(2)), workMinutes, auditNote, req.headers?.["user-agent"] || null, getRequestIp(req),
          metrics.late_minutes, metrics.early_leave_minutes, metrics.overtime_minutes, resolvedShift?.shift_id || null,
          resolvedShiftStartAt, resolvedShiftEndAt, resolvedShift ? "matched" : "unresolved"]
      );
      saved = inserted.rows[0];
    }

    if (checkOutAt && metrics.overtime_minutes > 0) {
      await client.query(
        `
        INSERT INTO attendance_overtime_approvals (
          tenant_id, employee_id, branch_id, attendance_log_id, attendance_date,
          overtime_minutes, status, requested_by_user_id, notes
        )
        VALUES ($1,$2,$3,$4,$5::date,$6,'pending',$7,$8)
        ON CONFLICT (attendance_log_id) WHERE attendance_log_id IS NOT NULL DO UPDATE
        SET overtime_minutes = EXCLUDED.overtime_minutes,
            status = CASE WHEN attendance_overtime_approvals.status = 'approved' THEN 'approved' ELSE 'pending' END,
            requested_by_user_id = EXCLUDED.requested_by_user_id,
            notes = EXCLUDED.notes,
            updated_at = NOW()
        `,
        [tenantId, employeeId, branchId, saved.id, attendanceDate, metrics.overtime_minutes, req.user?.id || null, "Recalculated from admin attendance correction"]
      );
    } else {
      await client.query(
        `DELETE FROM attendance_overtime_approvals
         WHERE tenant_id = $1 AND attendance_log_id = $2 AND status <> 'approved'`,
        [tenantId, saved.id]
      );
    }

    await ensureAuditLogTable(client);
    await client.query(
      `
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details, ip_address, user_agent)
      VALUES ($1,$2,'attendance_manual_upsert','attendance_log',$3,$4::jsonb,$5::inet,$6)
      `,
      [
        tenantId,
        req.user?.id || null,
        saved.id,
        JSON.stringify({
          employee_id: employeeId,
          employee_name: employee.full_name || null,
          attendance_date: attendanceDate,
          check_out_date: checkOutTime ? checkOutDate : null,
          previous_check_in: before?.check_in_at || before?.check_in || null,
          previous_check_out: before?.check_out_at || before?.check_out || null,
          check_in: checkInAt.toISOString(),
          check_out: checkOutAt?.toISOString() || null,
          reason,
        }),
        getRequestIp(req),
        req.headers?.["user-agent"] || null,
      ]
    );
    await client.query("COMMIT");

    return res.status(before ? 200 : 201).json({ success: true, data: saved, attendance: saved });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[admin-attendance:manual-entry]", { message: error?.message, code: error?.code || null });
    return res.status(500).json({ success: false, code: "MANUAL_ATTENDANCE_FAILED", message: "Failed to save attendance correction" });
  } finally {
    client.release();
  }
});

router.delete("/employees/:employeeId/today-attendance", permit("attendance", "delete"), async (req, res) => {
  const client = await db.connect();
  try {
    await ensureAttendanceSchema();
    res.set("Cache-Control", "no-store");
    const tenantId = withTenant(req, res);
    if (!tenantId) return;
    const receivedEmployeeId = String(req.params.employeeId || "").trim();
    const employee = await resolveEmployeeIdentifier(client, tenantId, req.params.employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, code: "EMPLOYEE_NOT_FOUND", message: "Employee not found" });
    }

    const businessDate = getAttendanceDate();
    const { start: businessDayStart, end: businessDayEnd } = getBusinessDateUtcRange(businessDate);
    const clearDeviceLocks = req.body?.clear_device_locks === true || req.body?.clearDeviceLocks === true;
    const employeeId = Number(employee.id);
    console.info("[admin-attendance:today-attendance-reset:incoming]", {
      tenant_id: tenantId,
      received_employee_id_param: receivedEmployeeId,
      resolved_employee_id: employeeId,
      resolved_employee_code: employee.employee_code || null,
      resolved_employee_name: employee.full_name || null,
      business_date: businessDate,
      business_day_start: businessDayStart.toISOString(),
      business_day_end: businessDayEnd.toISOString(),
      clear_device_locks: clearDeviceLocks,
    });

    await client.query("BEGIN");
    const logsDeleted = await queryAttendanceReset(
      client,
      `
      DELETE FROM attendance_logs
      WHERE ${todayAttendancePredicate}
      RETURNING id
      `,
      [tenantId, employeeId, businessDate, businessDayStart, businessDayEnd],
      { single: true, step: "delete_today_attendance_logs" }
    );

    let deletedRows = {
      attendance_logs: logsDeleted.rowCount,
      attendance_device_bindings: 0,
      employee_portal_sessions: 0,
      total: logsDeleted.rowCount,
    };

    if (clearDeviceLocks) {
      const resetRows = await resetAttendanceState(client, {
        tenantId,
        employeeIds: [employeeId],
        businessDate,
        resetSessions: true,
        single: true,
      });
      deletedRows = {
        attendance_logs: logsDeleted.rowCount,
        attendance_device_bindings: resetRows.attendance_device_bindings,
        employee_portal_sessions: resetRows.employee_portal_sessions,
        total: logsDeleted.rowCount + resetRows.attendance_device_bindings + resetRows.employee_portal_sessions,
      };
    }

    const remainingResult = await queryAttendanceReset(
      client,
      `
      SELECT COUNT(*)::int AS remaining_today_rows
      FROM attendance_logs
      WHERE ${todayAttendancePredicate}
      `,
      [tenantId, employeeId, businessDate, businessDayStart, businessDayEnd],
      { single: true, step: "count_remaining_today_attendance_logs" }
    );
    const remainingTodayRows = Number(remainingResult.rows[0]?.remaining_today_rows || 0);

    logResetDebug("employee-today-attendance-reset", {
      employeeCode: employee.employee_code,
      employeeId,
      businessDate,
      deletedRows,
      deletedCount: deletedRows.total,
    });
    console.info("[admin-attendance:today-attendance-reset:deleted]", {
      tenant_id: tenantId,
      received_employee_id_param: receivedEmployeeId,
      resolved_employee_id: employeeId,
      resolved_employee_code: employee.employee_code || null,
      resolved_employee_name: employee.full_name || null,
      business_date: businessDate,
      deleted_attendance_rows: deletedRows.attendance_logs,
      deleted_device_rows: deletedRows.attendance_device_bindings,
      deleted_session_rows: deletedRows.employee_portal_sessions,
      remaining_today_rows: remainingTodayRows,
    });

    if (logsDeleted.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        code: "NO_TODAY_ATTENDANCE_ROWS",
        message: "No today's attendance rows were found for this employee",
        deletedCount: 0,
        deleted_count: 0,
        deleted_rows: deletedRows,
        deleted_attendance_rows: 0,
        deleted_device_rows: deletedRows.attendance_device_bindings,
        deleted_session_rows: deletedRows.employee_portal_sessions,
        remaining_today_rows: remainingTodayRows,
        business_date: businessDate,
        employee_id: employeeId,
        employee_code: employee.employee_code,
      });
    }

    if (remainingTodayRows > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        code: "TODAY_ATTENDANCE_ROWS_REMAIN",
        message: "Today's attendance rows still exist after reset",
        deletedCount: 0,
        deleted_count: 0,
        deleted_rows: { attendance_logs: 0, attendance_device_bindings: 0, employee_portal_sessions: 0, total: 0 },
        deleted_attendance_rows: 0,
        deleted_device_rows: 0,
        deleted_session_rows: 0,
        remaining_today_rows: remainingTodayRows,
        business_date: businessDate,
        employee_id: employeeId,
        employee_code: employee.employee_code,
      });
    }

    await auditCleanup(client, req, {
      action: "attendance_logs.employee_today_deleted",
      entityId: employeeId,
      details: {
        employee_code: employee.employee_code,
        employee_id: employeeId,
        business_date: businessDate,
        clear_device_locks: clearDeviceLocks,
        deleted_count: deletedRows.total,
        deleted_rows: deletedRows,
      },
    });
    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      deletedCount: deletedRows.total,
      deleted_count: deletedRows.total,
      deleted_rows: deletedRows,
      deleted_attendance_rows: deletedRows.attendance_logs,
      deleted_device_rows: deletedRows.attendance_device_bindings,
      deleted_session_rows: deletedRows.employee_portal_sessions,
      remaining_today_rows: remainingTodayRows,
      business_date: businessDate,
      employee_id: employeeId,
      employee_code: employee.employee_code,
      allowed_action_after_reset: "check_in",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return resetErrorResponse(res, "Failed to reset today's employee attendance", error);
  } finally {
    client.release();
  }
});

router.delete("/device-bindings/today", permit("attendance", "delete"), async (req, res) => {
  const client = await db.connect();
  try {
    await ensureAttendanceSchema();
    const tenantId = withTenant(req, res);
    if (!tenantId) return;
    const businessDate = getAttendanceDate();

    await client.query("BEGIN");
    const targets = await client.query(
      `
      SELECT DISTINCT employee_id
      FROM attendance_device_bindings
      WHERE tenant_id = $1
        AND business_date = $2::date
      `,
      [tenantId, businessDate]
    );
    const employeeIds = targets.rows.map((row) => row.employee_id);
    const deletedRows = await resetAttendanceState(client, { tenantId, employeeIds, businessDate });
    logResetDebug("today-reset", {
      employeeIds,
      businessDate,
      deletedRows,
      deletedCount: deletedRows.total,
    });
    if (deletedRows.total === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "No attendance rows were found to reset", deletedCount: 0, deleted_count: 0 });
    }
    await auditCleanup(client, req, {
      action: "attendance_device_bindings.today_deleted",
      details: { business_date: businessDate, employee_ids: employeeIds, deleted_count: deletedRows.total, deleted_rows: deletedRows },
    });
    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      deletedCount: deletedRows.total,
      deleted_count: deletedRows.total,
      deleted_rows: deletedRows,
      business_date: businessDate,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return resetErrorResponse(res, "Failed to reset today's device locks", error);
  } finally {
    client.release();
  }
});

router.delete("/device-bindings/reset-device", permit("attendance", "delete"), async (req, res) => {
  const client = await db.connect();
  let step = "start";
  const singleQuery = async (nextStep, sql, values = []) => {
    step = nextStep;
    logAttendanceSingleResetQuery(nextStep, sql, values);
    try {
      return await client.query(sql, values);
    } catch (error) {
      error.resetStep = error.resetStep || nextStep;
      throw error;
    }
  };
  try {
    await ensureAttendanceSchema();
    const tenantId = withTenant(req, res);
    if (!tenantId) return;
    const deviceKey = String(req.body?.device_key || req.body?.deviceKey || "").trim();
    const bindingId = Number(req.body?.binding_id || req.body?.bindingId || req.body?.id || 0);
    const hasBindingId = Number.isFinite(bindingId) && bindingId > 0;
    const employeeIdentifier = String(req.body?.employee_id || req.body?.employeeId || req.body?.employee_code || req.body?.employeeCode || "").trim();
    const businessDate = dateKey(req.body?.business_date || req.body?.businessDate) || getAttendanceDate();
    if (!deviceKey && !hasBindingId && !employeeIdentifier) {
      return res.status(400).json({ success: false, message: "device_key, binding_id, employee_id, or employee_code is required" });
    }

    console.info("[admin-attendance:device-reset:incoming]", {
      payload: req.body || {},
      tenant_id: tenantId,
      binding_id: hasBindingId ? bindingId : null,
      device_key: deviceKey || null,
      employee_identifier: employeeIdentifier || null,
      business_date: businessDate,
    });

    await singleQuery("begin_transaction", "BEGIN");
    let resolvedEmployee = null;
    if (employeeIdentifier) {
      resolvedEmployee = await resolveEmployeeIdentifier(client, tenantId, employeeIdentifier);
      console.info("[admin-attendance:device-reset:resolved-employee]", {
        employee_identifier: employeeIdentifier,
        employee_id: resolvedEmployee?.id || null,
        employee_code: resolvedEmployee?.employee_code || null,
      });
      if (!resolvedEmployee && !hasBindingId && !deviceKey) {
        await singleQuery("rollback_missing_employee_single_reset", "ROLLBACK");
        return res.status(404).json({ success: false, code: "EMPLOYEE_NOT_FOUND", message: "Employee not found" });
      }
    }

    const matchPredicates = [];
    const matchValues = [tenantId];
    if (hasBindingId) {
      matchValues.push(bindingId);
      matchPredicates.push(`id = $${matchValues.length}`);
    } else if (deviceKey) {
      matchValues.push(deviceKey);
      matchPredicates.push(`device_key = $${matchValues.length}`);
    } else if (resolvedEmployee?.id) {
      matchValues.push(Number(resolvedEmployee.id));
      const employeeParam = matchValues.length;
      matchValues.push(businessDate);
      matchPredicates.push(`(employee_id = $${employeeParam}::bigint AND business_date = $${matchValues.length}::date)`);
    }

    let matchedBindings = { rows: [] };
    if (matchPredicates.length) {
      matchedBindings = await singleQuery(
        "select_device_binding_matches",
        `
        SELECT id, employee_id, business_date, device_key
        FROM attendance_device_bindings
        WHERE tenant_id = $1
          AND (${matchPredicates.join(" OR ")})
        ORDER BY id DESC
        `,
        matchValues
      );
    }

    if (!matchedBindings.rows.length && resolvedEmployee?.id && !hasBindingId && !deviceKey) {
      matchedBindings = await singleQuery(
        "select_employee_device_binding_fallback_matches",
        `
        SELECT id, employee_id, business_date, device_key
        FROM attendance_device_bindings
        WHERE tenant_id = $1
          AND employee_id = $2
        ORDER BY business_date DESC, id DESC
        `,
        [tenantId, Number(resolvedEmployee.id)]
      );
    }

    const matchedBindingIds = matchedBindings.rows.map((row) => Number(row.id)).filter((value) => Number.isFinite(value) && value > 0);
    const employeeIds = [
      ...new Set(
        [
          ...matchedBindings.rows.map((row) => Number(row.employee_id)),
          resolvedEmployee?.id ? Number(resolvedEmployee.id) : null,
        ].filter((value) => Number.isFinite(value) && value > 0)
      ),
    ];
    const businessDates = [...new Set(matchedBindings.rows.map((row) => dateKey(row.business_date)).filter(Boolean))];
    console.info("[admin-attendance:device-reset:matched-bindings]", {
      matched_binding_ids: matchedBindingIds,
      resolved_employee_id: resolvedEmployee?.id || null,
      employee_ids: employeeIds,
      business_dates: businessDates,
    });

    let deletedRows = { attendance_logs: 0, attendance_device_bindings: 0, employee_portal_sessions: 0, employee_attendance_devices: 0, total: 0 };
    if (matchedBindingIds.length) {
      const bindingsDeleted = await singleQuery(
        "delete_matched_attendance_device_bindings",
        `
        DELETE FROM attendance_device_bindings
        WHERE tenant_id = $1
          AND id = ANY($2::bigint[])
        RETURNING id
        `,
        [tenantId, matchedBindingIds]
      );
      deletedRows.attendance_device_bindings = bindingsDeleted.rowCount;
      deletedRows.total += bindingsDeleted.rowCount;
    }

    if (employeeIds.length) {
      await ensureStaffTasksSchema(client);
      const sessionsDeleted = await singleQuery(
        "delete_employee_portal_sessions_for_device_reset",
        `
        DELETE FROM employee_portal_sessions
        WHERE tenant_id = $1
          AND employee_id = ANY($2::bigint[])
        RETURNING id
        `,
        [tenantId, employeeIds]
      );
      deletedRows.employee_portal_sessions = sessionsDeleted.rowCount;
      deletedRows.total += sessionsDeleted.rowCount;

      const devicesReset = await singleQuery(
        "reset_employee_attendance_devices",
        `
        UPDATE employee_attendance_devices
        SET status = 'reset',
            reset_at = NOW(),
            reset_by_user_id = $3,
            updated_at = NOW()
        WHERE tenant_id = $1
          AND employee_id = ANY($2::bigint[])
          AND status IN ('approved', 'pending')
        RETURNING id
        `,
        [tenantId, employeeIds, req.user?.id || null]
      );
      deletedRows.employee_attendance_devices = devicesReset.rowCount;
      deletedRows.total += devicesReset.rowCount;
    }

    if (!employeeIds.length && employeeIdentifier && !hasBindingId && !deviceKey) {
      const employee = await resolveEmployeeIdentifier(client, tenantId, employeeIdentifier);
      if (!employee) {
        await singleQuery("rollback_missing_employee_single_reset", "ROLLBACK");
        return res.status(404).json({ success: false, code: "EMPLOYEE_NOT_FOUND", message: "Employee not found" });
      }
    }
    logResetDebug("device-reset", {
      employeeIds,
      bindingId: hasBindingId ? bindingId : null,
      deviceKey,
      businessDate: businessDates[0] || businessDate,
      deletedRows,
      deletedCount: deletedRows.total,
    });
    console.info("[admin-attendance:device-reset:deleted]", {
      matched_binding_ids: matchedBindingIds,
      deleted_rows: deletedRows,
      deleted_count: deletedRows.total,
    });
    const deviceLockRows = Number(deletedRows.attendance_device_bindings || 0) + Number(deletedRows.employee_attendance_devices || 0);
    if (deviceLockRows === 0) {
      await singleQuery("rollback_empty_single_reset", "ROLLBACK");
      return res.status(404).json({
        success: false,
        code: "NO_DEVICE_LOCK_ROWS",
        message: "No device lock rows were found for this employee",
        deletedCount: 0,
        deleted_count: 0,
      });
    }
    await auditCleanup(client, req, {
      action: "attendance_device_bindings.device_deleted",
      details: {
        binding_id: hasBindingId ? bindingId : null,
        device_key: deviceKey,
        employee_ids: employeeIds,
        business_date: businessDates[0] || businessDate,
        matched_binding_ids: matchedBindingIds,
        deleted_count: deletedRows.total,
        deleted_rows: deletedRows,
      },
      query: singleQuery,
    });
    await singleQuery("commit_single_reset", "COMMIT");

    return res.status(200).json({
      success: true,
      deletedCount: deletedRows.total,
      deleted_count: deletedRows.total,
      deleted_rows: deletedRows,
      business_date: businessDates[0] || businessDate,
      employee_id: employeeIds[0] || null,
    });
  } catch (error) {
    try {
      await singleQuery("rollback_single_reset_error", "ROLLBACK");
    } catch (rollbackError) {
      console.error("[attendance-single-reset:rollback-error]", rollbackError);
    }
    return resetErrorResponse(res, "Failed to reset device lock", error, step);
  } finally {
    client.release();
  }
});

router.delete("/device-bindings/all", permit("attendance", "delete"), async (req, res) => {
  const client = await db.connect();
  let step = "start";
  const bulkQuery = async (nextStep, sql, values = []) => {
    step = nextStep;
    logAttendanceBulkResetQuery(sql, values);
    try {
      return await client.query(sql, values);
    } catch (error) {
      error.resetStep = error.resetStep || nextStep;
      throw error;
    }
  };
  try {
    await ensureAttendanceSchema();
    const tenantId = withTenant(req, res);
    if (!tenantId) return;

    await bulkQuery("begin_transaction", "BEGIN");
    const targetsSql = `
      SELECT DISTINCT employee_id
      FROM attendance_device_bindings
      WHERE tenant_id = $1
      `;
    const targets = await bulkQuery("select_bulk_reset_targets", targetsSql, [tenantId]);
    const employeeIds = targets.rows.map((row) => row.employee_id);
    const deletedRows = await resetAttendanceState(client, { tenantId, employeeIds, bulk: true, bulkQuery });
    logResetDebug("all-reset", {
      employeeIds,
      deletedRows,
      deletedCount: deletedRows.total,
    });
    if (deletedRows.total === 0) {
      await bulkQuery("rollback_empty_bulk_reset", "ROLLBACK");
      return res.status(404).json({ success: false, message: "No attendance rows were found to reset", deletedCount: 0, deleted_count: 0 });
    }
    step = "audit_bulk_reset";
    await auditCleanup(client, req, {
      action: "attendance_device_bindings.all_deleted",
      details: { employee_ids: employeeIds, deleted_count: deletedRows.total, deleted_rows: deletedRows },
      query: bulkQuery,
    });
    await bulkQuery("commit_bulk_reset", "COMMIT");

    return res.status(200).json({
      success: true,
      deletedCount: deletedRows.total,
      deleted_count: deletedRows.total,
      deleted_rows: deletedRows,
    });
  } catch (error) {
    try {
      await bulkQuery("rollback_bulk_reset_error", "ROLLBACK");
    } catch (rollbackError) {
      console.error("[attendance-bulk-reset:rollback-error]", rollbackError);
    }
    return resetErrorResponse(res, "Failed to reset attendance device locks", error, step);
  } finally {
    client.release();
  }
});

router.delete("/device-bindings/:employeeId", permit("attendance", "delete"), async (req, res) => {
  const client = await db.connect();
  try {
    await ensureAttendanceSchema();
    const tenantId = withTenant(req, res);
    if (!tenantId) return;
    const employee = await resolveEmployeeIdentifier(client, tenantId, req.params.employeeId);
    if (!employee) {
      return res.status(400).json({ success: false, message: "Employee is required" });
    }
    const employeeId = Number(employee.id);
    const businessDate = getAttendanceDate();

    await client.query("BEGIN");
    const deletedRows = await resetAttendanceState(client, { tenantId, employeeIds: [employeeId], businessDate });
    logResetDebug("employee-today-reset", {
      employeeCode: employee.employee_code,
      employeeId,
      businessDate,
      deletedRows,
      deletedCount: deletedRows.total,
    });
    if (deletedRows.total === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "No attendance rows were found to reset", deletedCount: 0, deleted_count: 0 });
    }
    await auditCleanup(client, req, {
      action: "attendance_device_bindings.employee_today_deleted",
      entityId: employeeId,
      details: { employee_code: employee.employee_code, employee_id: employeeId, business_date: businessDate, deleted_count: deletedRows.total, deleted_rows: deletedRows },
    });
    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      deletedCount: deletedRows.total,
      deleted_count: deletedRows.total,
      deleted_rows: deletedRows,
      employee_id: employeeId,
      employee_code: employee.employee_code,
      business_date: businessDate,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return resetErrorResponse(res, "Failed to reset employee device lock", error);
  } finally {
    client.release();
  }
});

export default router;
