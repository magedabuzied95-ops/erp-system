// The attendance rules the owner published in the employee portal. Payroll, the
// request endpoint and the portal's rules panel all read them from here so the
// page an employee reads is the rule the salary is cut by.
//
// - Late up to `late_threshold_minutes` after the shift start costs nothing.
// - Later than that costs `late_penalty_days` (half a day) for that day.
// - An approved late permission covers up to `late_permission_max_minutes`, and
//   only the first `monthly_late_permissions` approved ones in a month count.
// - A working day with no check-in and no approved leave costs
//   `absence_penalty_days` (two days).
// - Days before `effective_from` keep the old pricing (lateness per hour after
//   any permission, absence one day); permissions granted on those days still
//   use up the month's quota.

export const DEFAULT_ATTENDANCE_POLICY = Object.freeze({
  late_threshold_minutes: 30,
  late_penalty_days: 0.5,
  monthly_late_permissions: 2,
  late_permission_max_minutes: 120,
  absence_penalty_days: 2,
  monthly_paid_leave_days: 3,
  forbidden_leave_weekdays: [4, 5, 6],
  effective_from: "2026-09-18",
});

const toDateKey = (value) => {
  if (!value) return "";
  // pg reads DATE at UTC midnight (see bootstrapTimezone.js).
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};

const numberIn = (value, fallback, { min = 0, max = Infinity } = {}) => {
  const parsed = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

export const normalizeAttendancePolicy = (row = {}) => {
  const base = DEFAULT_ATTENDANCE_POLICY;
  let weekdays = row?.forbidden_leave_weekdays;
  if (typeof weekdays === "string") {
    try {
      weekdays = JSON.parse(weekdays);
    } catch {
      weekdays = null;
    }
  }
  return {
    late_threshold_minutes: Math.round(numberIn(row?.late_threshold_minutes, base.late_threshold_minutes, { max: 600 })),
    late_penalty_days: numberIn(row?.late_penalty_days, base.late_penalty_days, { max: 5 }),
    monthly_late_permissions: Math.round(numberIn(row?.monthly_late_permissions, base.monthly_late_permissions, { max: 31 })),
    late_permission_max_minutes: Math.round(numberIn(row?.late_permission_max_minutes, base.late_permission_max_minutes, { max: 600 })),
    absence_penalty_days: numberIn(row?.absence_penalty_days, base.absence_penalty_days, { max: 10 }),
    monthly_paid_leave_days: Math.round(numberIn(row?.monthly_paid_leave_days, base.monthly_paid_leave_days, { max: 31 })),
    forbidden_leave_weekdays: Array.isArray(weekdays) && weekdays.length
      ? weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      : [...base.forbidden_leave_weekdays],
    effective_from: row && Object.prototype.hasOwnProperty.call(row, "policy_effective_from")
      ? toDateKey(row.policy_effective_from)
      : base.effective_from,
  };
};

export const loadAttendancePolicy = async (clientOrPool, tenantId = null) => {
  if (!clientOrPool || tenantId === null || tenantId === undefined || tenantId === "") {
    return normalizeAttendancePolicy();
  }
  try {
    const result = await clientOrPool.query(
      `SELECT * FROM hr_attendance_settings WHERE tenant_id = $1::bigint LIMIT 1`,
      [tenantId]
    );
    return normalizeAttendancePolicy(result.rows[0] || {});
  } catch (error) {
    console.warn("[attendance-policy] defaults used", error?.message || error);
    return normalizeAttendancePolicy();
  }
};

// How much of the lateness an approved permission forgives. A stored 0 means
// "the whole lateness", which the policy caps at late_permission_max_minutes.
export const latePermissionCoverMinutes = (requestedMinutes, policy = DEFAULT_ATTENDANCE_POLICY) => {
  const cap = Math.max(0, Number(policy.late_permission_max_minutes) || 0);
  const requested = Math.max(0, Number(requestedMinutes) || 0);
  return requested > 0 ? Math.min(requested, cap) : cap;
};

// `permissions` is every approved permission of the month in request order
// ({ date, minutes }); only the first monthly_late_permissions count. Returns
// a Map date -> covered minutes for the ones that count.
export const countedLatePermissions = (permissions = [], policy = DEFAULT_ATTENDANCE_POLICY) => {
  const quota = Math.max(0, Number(policy.monthly_late_permissions) || 0);
  const counted = new Map();
  for (const permission of permissions) {
    if (!permission?.date || counted.has(permission.date)) continue;
    if (counted.size >= quota) break;
    counted.set(permission.date, latePermissionCoverMinutes(permission.minutes, policy));
  }
  return counted;
};

// One day's lateness under the policy.
export const resolveLateDay = ({ lateMinutes = 0, permissionMinutes = null, policy = DEFAULT_ATTENDANCE_POLICY } = {}) => {
  const raw = Math.max(0, Number(lateMinutes) || 0);
  const covered = permissionMinutes === null || permissionMinutes === undefined
    ? 0
    : Math.min(raw, Math.max(0, Number(permissionMinutes) || 0));
  const remaining = raw - covered;
  const penalized = remaining > Math.max(0, Number(policy.late_threshold_minutes) || 0);
  return {
    late_minutes: raw,
    covered_minutes: covered,
    penalized,
    penalty_days: penalized ? Math.max(0, Number(policy.late_penalty_days) || 0) : 0,
  };
};

export const policyAppliesOn = (dateKey, policy = DEFAULT_ATTENDANCE_POLICY) =>
  !policy?.effective_from || String(dateKey || "") >= policy.effective_from;

// Approved late permissions from `from` to `to`, oldest first ({ date, minutes }), exactly as
// payroll reads them: the branch opener's day never counts. Shared by payroll and both portals so
// the late time they show is the late time the salary charges.
export const loadApprovedLatePermissionRows = async (clientOrPool, { tenantId = null, employeeId, from, to } = {}) => {
  if (!clientOrPool || !employeeId || !from || !to) return [];
  const result = await clientOrPool.query(
    `
    SELECT request_date, COALESCE(amount, 0)::numeric AS allowed_minutes
    FROM employee_portal_requests
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND employee_id::text = $2::text
      AND LOWER(COALESCE(request_type, '')) IN ('late_permission', 'late', 'lateness_permission')
      AND LOWER(COALESCE(status, 'pending')) = 'approved'
      AND request_date BETWEEN $3::date AND $4::date
      -- The branch opener may never be excused for lateness.
      AND NOT EXISTS (
        SELECT 1
        FROM employee_shift_schedules ss
        WHERE ss.employee_id::text = employee_portal_requests.employee_id::text
          AND ss.work_date = employee_portal_requests.request_date
          AND ss.shift_type = 'opening'
          AND LOWER(COALESCE(ss.status, 'scheduled')) <> 'cancelled'
      )
    ORDER BY request_date ASC, id ASC
    `,
    [tenantId, employeeId, from, to]
  );
  return result.rows
    .map((row) => ({ date: toDateKey(row.request_date), minutes: Number(row.allowed_minutes) || 0 }))
    .filter((row) => row.date);
};

// date -> minutes a counted permission forgives, for one calendar month (the quota is monthly).
export const loadLatePermissionCoverForMonth = async (clientOrPool, { tenantId = null, employeeId, month, policy = null } = {}) => {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return new Map();
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const [rows, resolvedPolicy] = await Promise.all([
    loadApprovedLatePermissionRows(clientOrPool, { tenantId, employeeId, from: `${month}-01`, to: lastDay }),
    policy ? Promise.resolve(policy) : loadAttendancePolicy(clientOrPool, tenantId),
  ]);
  return countedLatePermissions(rows, resolvedPolicy);
};

// A manager's edits to single days' deductions, `${date}|${type}` -> { penalty_days, note, ... }.
// type is "absence" or "late"; penalty_days replaces the rule's for that day (0 = waived).
export const DAY_DEDUCTION_TYPES = Object.freeze(["absence", "late"]);
export const dayDeductionOverrideKey = (date, type) => `${toDateKey(date)}|${type}`;
export const loadDayDeductionOverrides = async (clientOrPool, { tenantId = null, employeeId, from, to } = {}) => {
  const overrides = new Map();
  if (!clientOrPool || !employeeId || !from || !to) return overrides;
  try {
    const result = await clientOrPool.query(
      `
      SELECT id, deduction_date, deduction_type, penalty_days, rule_penalty_days, note, updated_by_name, updated_at
      FROM attendance_day_deduction_overrides
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND employee_id::text = $2::text
        AND deduction_date BETWEEN $3::date AND $4::date
      `,
      [tenantId, employeeId, from, to]
    );
    result.rows.forEach((row) => {
      overrides.set(dayDeductionOverrideKey(row.deduction_date, row.deduction_type), {
        id: row.id,
        penalty_days: Math.max(0, Number(row.penalty_days) || 0),
        note: row.note || "",
        updated_by_name: row.updated_by_name || "",
        updated_at: row.updated_at || null,
      });
    });
  } catch (error) {
    // Before the attendance schema has created the table there is nothing to apply.
    if (error?.code !== "42P01") throw error;
  }
  return overrides;
};

// One attendance day's lateness after its permission: what the salary actually counts.
export const lateAfterPermission = (lateMinutes, coverMinutes) => {
  const raw = Math.max(0, Math.round(Number(lateMinutes) || 0));
  const allowed = coverMinutes === null || coverMinutes === undefined ? null : Math.max(0, Math.round(Number(coverMinutes) || 0));
  const covered = allowed === null ? 0 : Math.min(raw, allowed);
  return { late_minutes: raw - covered, late_minutes_raw: raw, late_permission_minutes: allowed, late_covered_minutes: covered };
};
