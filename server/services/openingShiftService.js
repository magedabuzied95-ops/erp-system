import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { createEmployeePortalNotification } from "./employeePayrollPortalService.js";
import { createNotification } from "./notificationsService.js";

const DEFAULT_TIMEZONE = String(process.env.APP_TIMEZONE || process.env.TZ || "Africa/Cairo").trim() || "Africa/Cairo";

const toPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const notifyOpeningAssignmentChange = async ({
  clientOrPool,
  tenantId,
  branchId,
  workDate,
  assignmentId,
  branchName = "",
  previousEmployeeId = null,
  previousEmployeeName = "",
  newEmployeeId,
  newEmployeeName = "",
  source = "",
} = {}) => {
  const metadata = {
    tab: "notifications",
    event: "opening_shift_assignment",
    assignment_id: assignmentId || null,
    branch_id: branchId || null,
    branch_name: branchName || "",
    work_date: workDate || "",
    source: source || "",
    previous_employee_id: previousEmployeeId || null,
    new_employee_id: newEmployeeId || null,
  };
  const dateLabel = String(workDate || "").slice(0, 10);
  const newTitle = "تم تعيينك فاتح الفرع";
  const newBody = `تم تعيينك مسؤول فتح ${branchName || "الفرع"} يوم ${dateLabel}.`;
  const previousTitle = "تم تغيير فاتح الفرع";
  const previousBody = `تم تغيير مسؤول فتح ${branchName || "الفرع"} يوم ${dateLabel} إلى ${newEmployeeName || "موظف آخر"}.`;

  const jobs = [];
  if (newEmployeeId) {
    jobs.push(createEmployeePortalNotification({
      clientOrPool,
      tenantId,
      employeeId: newEmployeeId,
      type: "opening_shift_assignment",
      title: newTitle,
      body: newBody,
      metadata: { ...metadata, tag: "opening_shift_assignment" },
      dedupeKey: `opening:${tenantId || "global"}:${branchId || "branch"}:${dateLabel}:${newEmployeeId}`,
    }));
  }
  if (previousEmployeeId && String(previousEmployeeId) !== String(newEmployeeId)) {
    jobs.push(createEmployeePortalNotification({
      clientOrPool,
      tenantId,
      employeeId: previousEmployeeId,
      type: "opening_shift_assignment_changed",
      title: previousTitle,
      body: previousBody,
      metadata: { ...metadata, tag: "opening_shift_assignment_changed" },
      dedupeKey: `opening-changed:${tenantId || "global"}:${branchId || "branch"}:${dateLabel}:${previousEmployeeId}`,
    }));
  }

  jobs.push(createNotification({
    clientOrPool,
    tenantId,
    branchId,
    type: previousEmployeeId && String(previousEmployeeId) !== String(newEmployeeId) ? "opening_assignment_changed" : "opening_assignment_created",
    category: "attendance",
    priority: "high",
    title: previousEmployeeId && String(previousEmployeeId) !== String(newEmployeeId) ? "تم تغيير فاتح الفرع" : "تم تعيين فاتح الفرع",
    message: `${newEmployeeName || "موظف"} مسؤول فتح ${branchName || "الفرع"} يوم ${dateLabel}.`,
    actionUrl: "/attendance",
    actionLabel: "فتح الحضور",
    entityType: "shift_opening_assignment",
    entityId: assignmentId ? String(assignmentId) : `${branchId || "branch"}:${dateLabel}`,
    metadata,
  }));

  await Promise.allSettled(jobs);
};

const datePartsInZone = (date = new Date(), timeZone = DEFAULT_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
  return { year: part("year"), month: part("month"), day: part("day") };
};

const formatDate = ({ year, month, day }) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const addDaysToParts = ({ year, month, day }, days = 0) => {
  const value = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
};

export const getDefaultOpeningWorkDate = (date = new Date(), timeZone = DEFAULT_TIMEZONE) =>
  formatDate(addDaysToParts(datePartsInZone(date, timeZone), 1));

export const getHrAttendanceSettings = async (clientOrPool, tenantId) => {
  await ensureAttendanceSchema(clientOrPool);
  if (!tenantId) {
    return {
      require_next_opening_on_pos_close: true,
      grace_minutes: 10,
      monthly_paid_leave_days: 3,
      forbidden_leave_weekdays: [4, 5, 6],
    };
  }

  const result = await clientOrPool.query(
    `
    INSERT INTO hr_attendance_settings (tenant_id)
    VALUES ($1)
    ON CONFLICT (tenant_id) DO UPDATE
    SET updated_at = hr_attendance_settings.updated_at
    RETURNING *
    `,
    [tenantId]
  );
  return result.rows[0] || {};
};

const employeeHasApprovedLeaveOnDate = async (clientOrPool, { tenantId, employeeId, workDate }) => {
  const result = await clientOrPool.query(
    `
    SELECT 1
    FROM (
      SELECT employee_id, status, COALESCE(leave_date, start_date) AS start_date, COALESCE(leave_date, end_date, start_date) AS end_date
      FROM employee_leaves
      WHERE employee_id = $2
        AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      UNION ALL
      SELECT employee_id, status, COALESCE(vacation_date, start_date) AS start_date, COALESCE(vacation_date, end_date, start_date) AS end_date
      FROM employee_vacations
      WHERE employee_id = $2
        AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
    ) leaves
    WHERE LOWER(COALESCE(status, 'pending')) IN ('approved', 'accepted', 'مقبول')
      AND $3::date BETWEEN start_date AND end_date
    LIMIT 1
    `,
    [tenantId, employeeId, workDate]
  );
  return result.rowCount > 0;
};

const employeeHasConflictingSchedule = async (clientOrPool, { tenantId, employeeId, branchId, workDate, startTime = "12:00", endTime = "22:00" }) => {
  const result = await clientOrPool.query(
    `
    WITH existing AS (
      SELECT
        id,
        shift_type,
        shift_name,
        branch_id,
        start_time,
        end_time,
        (EXTRACT(HOUR FROM start_time)::int * 60 + EXTRACT(MINUTE FROM start_time)::int) AS start_minutes,
        (EXTRACT(HOUR FROM end_time)::int * 60 + EXTRACT(MINUTE FROM end_time)::int) AS raw_end_minutes
      FROM employee_shift_schedules
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND employee_id = $2
        AND work_date = $3::date
        AND LOWER(COALESCE(status, 'scheduled')) NOT IN ('cancelled', 'canceled')
        AND NOT (branch_id = $4 AND shift_type = 'opening')
    ),
    normalized AS (
      SELECT
        *,
        CASE WHEN raw_end_minutes <= start_minutes THEN raw_end_minutes + 1440 ELSE raw_end_minutes END AS end_minutes
      FROM existing
    ),
    requested AS (
      SELECT
        (split_part($5::text, ':', 1)::int * 60 + split_part($5::text, ':', 2)::int) AS start_minutes,
        CASE
          WHEN (split_part($6::text, ':', 1)::int * 60 + split_part($6::text, ':', 2)::int) <= (split_part($5::text, ':', 1)::int * 60 + split_part($5::text, ':', 2)::int)
            THEN (split_part($6::text, ':', 1)::int * 60 + split_part($6::text, ':', 2)::int) + 1440
          ELSE (split_part($6::text, ':', 1)::int * 60 + split_part($6::text, ':', 2)::int)
        END AS end_minutes
    )
    SELECT normalized.*
    FROM normalized, requested
    WHERE normalized.start_minutes < requested.end_minutes
      AND normalized.end_minutes > requested.start_minutes
    LIMIT 1
    `,
    [tenantId, employeeId, workDate, branchId, startTime, endTime]
  );
  return result.rows[0] || null;
};

export const listEligibleOpeningEmployees = async (clientOrPool, {
  tenantId,
  branchId,
  workDate = getDefaultOpeningWorkDate(),
  includeAllBranches = false,
  includeIneligible = false,
} = {}) => {
  await ensureAttendanceSchema(clientOrPool);
  const normalizedBranchId = toPositiveNumber(branchId);
  const result = await clientOrPool.query(
    `
    WITH opening_stats AS (
      SELECT
        employee_id,
        MAX(work_date) AS last_opening_date,
        COUNT(*)::int AS total_openings,
        COUNT(*) FILTER (WHERE work_date >= date_trunc('month', $3::date)::date)::int AS openings_this_month
      FROM shift_opening_assignments
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      GROUP BY employee_id
    ),
    leave_blocks AS (
      SELECT employee_id
      FROM (
        SELECT employee_id, status, COALESCE(leave_date, start_date) AS start_date, COALESCE(leave_date, end_date, start_date) AS end_date
        FROM employee_leaves
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        UNION ALL
        SELECT employee_id, status, COALESCE(vacation_date, start_date) AS start_date, COALESCE(vacation_date, end_date, start_date) AS end_date
        FROM employee_vacations
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      ) leaves
      WHERE LOWER(COALESCE(status, 'pending')) IN ('approved', 'accepted', 'مقبول')
        AND $3::date BETWEEN start_date AND end_date
      GROUP BY employee_id
    )
    SELECT
      e.id,
      e.tenant_id,
      e.branch_id,
      b.name AS branch_name,
      e.employee_code,
      e.full_name,
      e.phone,
      e.email,
      e.role,
      e.job_title,
      e.position,
      e.status,
      COALESCE(e.can_open_branch, TRUE) AS can_open_branch,
      COALESCE(oe.is_eligible, CASE
        WHEN $2::bigint IS NULL THEN TRUE
        WHEN e.branch_id IS NULL THEN TRUE
        WHEN e.branch_id = $2::bigint THEN TRUE
        WHEN $4::boolean = TRUE THEN TRUE
        ELSE FALSE
      END) AS is_branch_eligible,
      lb.employee_id IS NOT NULL AS has_leave,
      os.last_opening_date,
      COALESCE(os.total_openings, 0) AS total_openings,
      COALESCE(os.openings_this_month, 0) AS openings_this_month
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN employee_opening_eligibility oe
      ON oe.employee_id = e.id
     AND oe.branch_id = $2::bigint
     AND ($1::bigint IS NULL OR oe.tenant_id = $1::bigint)
    LEFT JOIN leave_blocks lb ON lb.employee_id = e.id
    LEFT JOIN opening_stats os ON os.employee_id = e.id
    WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      AND COALESCE(e.is_deleted, FALSE) = FALSE
      AND (
        $5::boolean = TRUE
        OR (
          LOWER(COALESCE(e.status, 'active')) = 'active'
          AND COALESCE(e.can_open_branch, TRUE) = TRUE
          AND COALESCE(oe.is_eligible, CASE
            WHEN $2::bigint IS NULL THEN TRUE
            WHEN e.branch_id IS NULL THEN TRUE
            WHEN e.branch_id = $2::bigint THEN TRUE
            WHEN $4::boolean = TRUE THEN TRUE
            ELSE FALSE
          END) = TRUE
          AND lb.employee_id IS NULL
        )
      )
      AND (
        $4::boolean = TRUE
        OR $2::bigint IS NULL
        OR e.branch_id IS NULL
        OR e.branch_id = $2::bigint
        OR COALESCE(oe.is_eligible, FALSE) = TRUE
      )
    ORDER BY
      CASE
        WHEN LOWER(COALESCE(e.status, 'active')) = 'active'
         AND COALESCE(e.can_open_branch, TRUE) = TRUE
         AND COALESCE(oe.is_eligible, CASE
           WHEN $2::bigint IS NULL THEN TRUE
           WHEN e.branch_id IS NULL THEN TRUE
           WHEN e.branch_id = $2::bigint THEN TRUE
           WHEN $4::boolean = TRUE THEN TRUE
           ELSE FALSE
         END) = TRUE
         AND lb.employee_id IS NULL
        THEN 0 ELSE 1
      END,
      os.last_opening_date ASC NULLS FIRST,
      COALESCE(os.total_openings, 0) ASC,
      e.full_name ASC,
      e.id ASC
    `,
    [tenantId || null, normalizedBranchId, workDate, Boolean(includeAllBranches), Boolean(includeIneligible)]
  );

  const rows = result.rows || [];
  const normalizedRows = rows.map((row) => {
    const reasons = [];
    const active = String(row.status || "active").toLowerCase() === "active";
    const canOpenBranch = row.can_open_branch !== false;
    const branchEligible = row.is_branch_eligible !== false;
    const hasLeave = row.has_leave === true;
    if (!active) reasons.push("inactive");
    if (!canOpenBranch) reasons.push("can_open_branch_disabled");
    if (!branchEligible) reasons.push("branch_not_allowed");
    if (hasLeave) reasons.push("approved_leave_on_date");
    const eligible = reasons.length === 0;
    return {
      ...row,
      employee_id: row.id,
      eligible,
      ineligible_reasons: reasons,
    };
  });
  const recommendedId = normalizedRows.find((row) => row.eligible !== false)?.id || null;
  return normalizedRows.map((row) => ({
    ...row,
    is_recommended: String(row.id) === String(recommendedId),
  }));
};

export const assignNextOpeningEmployee = async (clientOrPool, {
  tenantId,
  branchId,
  employeeId,
  workDate = getDefaultOpeningWorkDate(),
  assignedByUserId = null,
  attendanceLogId = null,
  cashDrawerShiftId = null,
  source = "pos_shift_close",
  note = "",
  overrideReason = "",
} = {}) => {
  await ensureAttendanceSchema(clientOrPool);
  const normalizedBranchId = toPositiveNumber(branchId);
  const normalizedEmployeeId = toPositiveNumber(employeeId);
  if (!normalizedBranchId) {
    const error = new Error("Branch is required before assigning tomorrow opener");
    error.status = 400;
    throw error;
  }
  if (!normalizedEmployeeId) {
    const error = new Error("Tomorrow opening employee is required before closing the shift");
    error.status = 400;
    throw error;
  }

  const previousAssignmentResult = await clientOrPool.query(
    `
    SELECT *
    FROM shift_opening_assignments
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND branch_id = $2
      AND work_date = $3::date
    LIMIT 1
    `,
    [tenantId, normalizedBranchId, workDate]
  ).catch(() => ({ rows: [] }));
  const previousAssignment = previousAssignmentResult.rows?.[0] || null;

  const candidates = await listEligibleOpeningEmployees(clientOrPool, {
    tenantId,
    branchId: normalizedBranchId,
    workDate,
  });
  const employee = candidates.find((candidate) => String(candidate.id) === String(normalizedEmployeeId));
  if (!employee) {
    const hasLeave = await employeeHasApprovedLeaveOnDate(clientOrPool, { tenantId, employeeId: normalizedEmployeeId, workDate });
    const error = new Error(hasLeave ? "Selected employee has approved leave on the opening date" : "Selected employee is not eligible to open this branch");
    error.status = 400;
    error.code = hasLeave ? "OPENING_EMPLOYEE_ON_LEAVE" : "OPENING_EMPLOYEE_NOT_ELIGIBLE";
    throw error;
  }

  const conflictingSchedule = await employeeHasConflictingSchedule(clientOrPool, {
    tenantId,
    employeeId: normalizedEmployeeId,
    branchId: normalizedBranchId,
    workDate,
    startTime: "12:00",
    endTime: "22:00",
  });
  if (conflictingSchedule) {
    const error = new Error(`Selected employee already has a conflicting shift on ${workDate}`);
    error.status = 409;
    error.code = "OPENING_EMPLOYEE_SHIFT_CONFLICT";
    error.details = {
      schedule_id: conflictingSchedule.id,
      shift_type: conflictingSchedule.shift_type,
      shift_name: conflictingSchedule.shift_name,
      start_time: conflictingSchedule.start_time,
      end_time: conflictingSchedule.end_time,
    };
    throw error;
  }

  const assignment = await clientOrPool.query(
    `
    INSERT INTO shift_opening_assignments (
      tenant_id,
      shift_id,
      branch_id,
      work_date,
      attendance_log_id,
      cash_drawer_shift_id,
      employee_id,
      assigned_by_user_id,
      assigned_at,
      source,
      override_reason,
      note
    )
    VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,NOW(),$9,$10,$11)
    ON CONFLICT (tenant_id, branch_id, work_date)
    WHERE branch_id IS NOT NULL AND work_date IS NOT NULL
    DO UPDATE SET
      employee_id = EXCLUDED.employee_id,
      assigned_by_user_id = EXCLUDED.assigned_by_user_id,
      assigned_at = EXCLUDED.assigned_at,
      attendance_log_id = COALESCE(EXCLUDED.attendance_log_id, shift_opening_assignments.attendance_log_id),
      cash_drawer_shift_id = COALESCE(EXCLUDED.cash_drawer_shift_id, shift_opening_assignments.cash_drawer_shift_id),
      source = EXCLUDED.source,
      override_reason = EXCLUDED.override_reason,
      note = EXCLUDED.note
    RETURNING *
    `,
    [
      tenantId,
      null,
      normalizedBranchId,
      workDate,
      attendanceLogId || null,
      cashDrawerShiftId || null,
      normalizedEmployeeId,
      assignedByUserId || null,
      source || "pos_shift_close",
      overrideReason || null,
      note || "",
    ]
  );

  const assignmentRow = assignment.rows[0];
  await clientOrPool.query(`
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
  `).catch(() => null);
  await clientOrPool.query(
    `
    INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details, created_at)
    VALUES ($1,$2,$3,'shift_opening_assignment',$4,$5::jsonb,NOW())
    `,
    [
      tenantId,
      assignedByUserId || null,
      previousAssignment ? "opening_assignment.changed" : "opening_assignment.created",
      assignmentRow.id,
      JSON.stringify({
        branch_id: normalizedBranchId,
        work_date: workDate,
        previous_employee_id: previousAssignment?.employee_id || null,
        new_employee_id: normalizedEmployeeId,
        source: source || "pos_shift_close",
        attendance_log_id: attendanceLogId || null,
        cash_drawer_shift_id: cashDrawerShiftId || null,
        override_reason: overrideReason || "",
        note: note || "",
      }),
    ]
  ).catch(() => null);
  const schedule = await clientOrPool.query(
    `
    INSERT INTO employee_shift_schedules (
      tenant_id,
      employee_id,
      branch_id,
      work_date,
      shift_type,
      shift_name,
      start_time,
      end_time,
      expected_hours,
      source,
      source_assignment_id,
      status,
      created_by_user_id
    )
    VALUES ($1,$2,$3,$4::date,'opening','Opening shift','12:00','22:00',10,'opening_assignment',$5,'scheduled',$6)
    ON CONFLICT (tenant_id, branch_id, work_date, shift_type)
    WHERE branch_id IS NOT NULL AND shift_type = 'opening'
    DO UPDATE SET
      employee_id = EXCLUDED.employee_id,
      source_assignment_id = EXCLUDED.source_assignment_id,
      status = 'scheduled',
      updated_at = NOW()
    RETURNING *
    `,
    [tenantId, normalizedEmployeeId, normalizedBranchId, workDate, assignmentRow.id, assignedByUserId || null]
  );

  let previousEmployeeName = "";
  if (previousAssignment?.employee_id && String(previousAssignment.employee_id) !== String(normalizedEmployeeId)) {
    const previousEmployeeResult = await clientOrPool.query(
      `
      SELECT full_name
      FROM employees
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [previousAssignment.employee_id, tenantId]
    ).catch(() => ({ rows: [] }));
    previousEmployeeName = previousEmployeeResult.rows?.[0]?.full_name || "";
  }

  await notifyOpeningAssignmentChange({
    clientOrPool,
    tenantId,
    branchId: normalizedBranchId,
    workDate,
    assignmentId: assignmentRow.id,
    branchName: employee.branch_name,
    previousEmployeeId: previousAssignment?.employee_id || null,
    previousEmployeeName,
    newEmployeeId: normalizedEmployeeId,
    newEmployeeName: employee.full_name,
    source,
  });

  return {
    assignment: {
      ...assignmentRow,
      employee_name: employee.full_name,
      employee_code: employee.employee_code,
      branch_name: employee.branch_name,
    },
    schedule: schedule.rows[0] || null,
    employee,
  };
};
