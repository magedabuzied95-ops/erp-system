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
