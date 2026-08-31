// Shared manual attendance correction. The admin attendance route and the
// manager portal both record a check-in / check-out fix through here so that
// shift resolution, late/overtime recalculation, the overtime approval row and
// the audit trail stay identical regardless of which surface made the edit.
import db from "../database/db.js";
import { ensureAttendanceSchema } from "./attendanceSchema.js";
import { calculateAttendanceMetrics } from "./attendanceCalculator.js";
import { getAttendanceTimeZone } from "./attendanceTimezone.js";

const getAttendanceDate = (date = new Date()) => {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: getAttendanceTimeZone(),
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

export const getBusinessDateUtcRange = (businessDate) => {
  const [year, month, day] = String(businessDate || getAttendanceDate()).slice(0, 10).split("-").map(Number);
  const utcStartGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const utcEndGuess = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
  const timeZone = getAttendanceTimeZone();
  const start = new Date(utcStartGuess.getTime() - getTimeZoneOffsetMs(utcStartGuess, timeZone));
  const end = new Date(utcEndGuess.getTime() - getTimeZoneOffsetMs(utcEndGuess, timeZone));
  return { start, end };
};

export const parseManualAttendanceTimestamp = (businessDate, timeValue, addDay = false) => {
  const match = String(timeValue || "").trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  const { start } = getBusinessDateUtcRange(businessDate);
  const minutes = (Number(match[1]) * 60) + Number(match[2]) + (addDay ? 24 * 60 : 0);
  return new Date(start.getTime() + (minutes * 60 * 1000));
};

export const ensureAuditLogTable = async (client, query = null) => {
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await runQuery("ensure_audit_logs_ip_address", "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address INET");
  await runQuery("ensure_audit_logs_user_agent", "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT");
};

const dateKey = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const fail = (status, code, message) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

/**
 * Insert or correct one attendance day for an employee.
 * Throws an Error carrying `.status` and `.code` on validation failures.
 *
 * @returns {{ saved: object, created: boolean }}
 */
export const upsertManualAttendance = async ({
  tenantId,
  employeeId,
  attendanceDate: rawAttendanceDate,
  checkInTime: rawCheckInTime,
  checkOutTime: rawCheckOutTime,
  checkOutDate: rawCheckOutDate,
  correctionScope: requestedScope,
  reason: rawReason,
  branchId: requestedBranchId = null,
  scopeBranchId = null,
  actor = {},
  auditPrefix = "Admin attendance correction",
  auditAction = "attendance_manual_upsert",
} = {}) => {
  const client = await db.connect();
  let inTransaction = false;
  try {
    await ensureAttendanceSchema();
    const employeeIdNumber = Number(employeeId || 0);
    const attendanceDate = dateKey(rawAttendanceDate);
    const checkInTime = String(rawCheckInTime || "").trim();
    const checkOutTime = String(rawCheckOutTime || "").trim();
    const checkOutDate = dateKey(rawCheckOutDate || attendanceDate);
    const scope = String(requestedScope || "").trim().toLowerCase();
    const legacyScope = checkOutTime ? "both" : "check_in";
    const correctionScope = ["check_in", "check_out", "both"].includes(scope) ? scope : legacyScope;
    const editsCheckIn = correctionScope !== "check_out";
    const editsCheckOut = correctionScope !== "check_in";
    const reason = String(rawReason || "").trim();

    if (!tenantId) throw fail(400, "TENANT_REQUIRED", "Tenant context is required");
    if (!employeeIdNumber || !/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) || !reason || (editsCheckIn && !checkInTime) || (editsCheckOut && !checkOutTime)) {
      throw fail(400, "INVALID_MANUAL_ATTENDANCE", "Employee, attendance date, selected correction time and correction reason are required");
    }

    const requestedCheckInAt = editsCheckIn ? parseManualAttendanceTimestamp(attendanceDate, checkInTime) : null;
    if (editsCheckIn && !requestedCheckInAt) throw fail(400, "INVALID_CHECK_IN_TIME", "Invalid check-in time");

    let requestedCheckOutAt = null;
    if (editsCheckOut) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(checkOutDate)) throw fail(400, "INVALID_CHECK_OUT_DATE", "Invalid checkout date");
      requestedCheckOutAt = parseManualAttendanceTimestamp(checkOutDate, checkOutTime);
      if (!requestedCheckOutAt) throw fail(400, "INVALID_CHECK_OUT_TIME", "Invalid check-out time");
    }

    const employeeResult = await client.query(
      `
      SELECT id, employee_code, full_name, branch_id
      FROM employees
      WHERE tenant_id = $1
        AND id = $2
        AND COALESCE(is_deleted, FALSE) = FALSE
        AND ($3::bigint IS NULL OR branch_id = $3::bigint)
      LIMIT 1
      `,
      [tenantId, employeeIdNumber, scopeBranchId || null]
    );
    const employee = employeeResult.rows[0];
    if (!employee) throw fail(404, "EMPLOYEE_NOT_FOUND", "Employee not found");

    const branchId = Number(requestedBranchId) > 0 ? Number(requestedBranchId) : (employee.branch_id || null);

    await client.query("BEGIN");
    inTransaction = true;
    // A day can hold one row per branch, so pick the row for the branch this
    // correction is aimed at before falling back to the most recent one.
    const existingResult = await client.query(
      `
      SELECT *
      FROM attendance_logs
      WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date = $3::date
      ORDER BY (branch_id IS NOT DISTINCT FROM $4::bigint) DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [tenantId, employeeIdNumber, attendanceDate, branchId]
    );
    const before = existingResult.rows[0] || null;
    if (!before && correctionScope === "check_out") {
      throw fail(409, "CHECK_IN_REQUIRED_FOR_CHECK_OUT_CORRECTION", "A check-in record is required before correcting checkout only");
    }

    const previousCheckInAt = before?.check_in_at || before?.check_in ? new Date(before.check_in_at || before.check_in) : null;
    const previousCheckOutAt = before?.check_out_at || before?.check_out ? new Date(before.check_out_at || before.check_out) : null;
    const checkInAt = editsCheckIn ? requestedCheckInAt : previousCheckInAt;
    const checkOutAt = editsCheckOut ? requestedCheckOutAt : previousCheckOutAt;
    if (!checkInAt || !Number.isFinite(checkInAt.getTime())) {
      throw fail(409, "CHECK_IN_REQUIRED", "A valid check-in is required for this correction");
    }
    if (checkOutAt && (!Number.isFinite(checkOutAt.getTime()) || checkOutAt < checkInAt)) {
      throw fail(400, "CHECK_OUT_BEFORE_CHECK_IN", "Checkout date and time cannot be before check-in");
    }

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
      [tenantId, employeeIdNumber, attendanceDate]
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
      timeZone: getAttendanceTimeZone(),
    });
    const workMinutes = metrics.work_minutes;
    const status = checkOutAt ? "checked_out" : "checked_in";
    const auditNote = `${auditPrefix}: ${reason}`;
    // Every correction used to append another line, so a record edited a few
    // times ended up with an unreadable pile of notes in the attendance table.
    // Keep whatever the shift itself recorded and carry only the latest reason;
    // the full history already lives in audit_logs.
    const mergedNotes = [
      ...String(before?.notes || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !/^(Admin|Manager) attendance correction:/.test(line)),
      auditNote,
    ].join("\n");

    let saved;
    if (before) {
      const updated = await client.query(
        `
        UPDATE attendance_logs
        SET branch_id = COALESCE($3, branch_id),
            check_in = $4,
            check_in_at = $4,
            check_out = $5,
            check_out_at = $5,
            attendance_source = 'admin_manual',
            status = $6,
            worked_hours = $7,
            work_minutes = $8,
            late_minutes = $9,
            early_leave_minutes = $10,
            overtime_minutes = $11,
            shift_id = COALESCE($12, shift_id),
            selected_shift_id = COALESCE($12, selected_shift_id),
            resolved_shift_start_time = $13,
            resolved_shift_end_time = $14,
            shift_resolution_status = $15,
            notes = $16,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND id = $2
        RETURNING *
        `,
        [tenantId, before.id, branchId, checkInAt, checkOutAt, status, Number((workMinutes / 60).toFixed(2)), workMinutes,
          metrics.late_minutes, metrics.early_leave_minutes, metrics.overtime_minutes, resolvedShift?.shift_id || null,
          resolvedShiftStartAt, resolvedShiftEndAt, resolvedShift ? "matched" : "unresolved", mergedNotes]
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
        [tenantId, employeeIdNumber, branchId, attendanceDate, checkInAt, checkOutAt, status, Number((workMinutes / 60).toFixed(2)), workMinutes, auditNote, actor.userAgent || null, actor.ip || null,
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
        [tenantId, employeeIdNumber, branchId, saved.id, attendanceDate, metrics.overtime_minutes, actor.userId || null, `Recalculated from ${auditPrefix.toLowerCase()}`]
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
      VALUES ($1,$2,$3,'attendance_log',$4,$5::jsonb,$6::inet,$7)
      `,
      [
        tenantId,
        actor.userId || null,
        auditAction,
        saved.id,
        JSON.stringify({
          employee_id: employeeIdNumber,
          employee_name: employee.full_name || null,
          attendance_date: attendanceDate,
          correction_scope: correctionScope,
          check_out_date: editsCheckOut ? checkOutDate : null,
          previous_check_in: before?.check_in_at || before?.check_in || null,
          previous_check_out: before?.check_out_at || before?.check_out || null,
          check_in: checkInAt.toISOString(),
          check_out: checkOutAt?.toISOString() || null,
          reason,
          ...(actor.source ? { source: actor.source, manager_employee_id: actor.managerEmployeeId || null } : {}),
        }),
        actor.ip || null,
        actor.userAgent || null,
      ]
    );
    await client.query("COMMIT");
    inTransaction = false;
    return { saved, created: !before };
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
