import db from "../database/db.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { isSuperAdminUser } from "../utils/requestScope.js";
import { calculateAttendanceMetrics, formatMinutes, buildShiftSummaryNotification, buildAttendanceAlertNotification } from "../utils/attendanceCalculator.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { haversineDistanceMeters } from "../utils/geoDistance.js";
import { handleBranchQrCheckInStaffTasks } from "../services/staffTasksService.js";

const safeQuery = async (client, text, params = []) => {
  try {
    return await client.query(text, params);
  } catch (error) {
    console.warn("Attendance query failed:", error.message);
    return { rows: [] };
  }
};

const resolveAuthenticatedTenantId = (req) => {
  const rawTenant = req.user?.tenant_id || req.user?.tenantId || req.tenant?.id;
  const tenantId = Number(rawTenant);

  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

const getTenantScope = (req) => (isSuperAdminUser(req.user) ? null : resolveAuthenticatedTenantId(req));

const GPS_VERIFICATION_MODE = String(process.env.ATTENDANCE_GPS_VERIFICATION_MODE || "strict").toLowerCase() === "warning" ? "warning" : "strict";
const ATTENDANCE_TIMEZONE = String(process.env.ATTENDANCE_TIMEZONE || process.env.APP_TIMEZONE || process.env.TZ || "Africa/Cairo").trim() || "Africa/Cairo";

const normalizeLookupValue = (value = "") => String(value || "").trim();
const normalizePhoneDigits = (value = "") => String(value || "").replace(/\D/g, "");

const getRequestIp = (req) => {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "";
};

const buildPublicOrigin = (req) => {
  const envOrigin = String(
    process.env.PUBLIC_FRONTEND_URL ||
      process.env.VITE_PUBLIC_FRONTEND_URL ||
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      process.env.APP_URL ||
      ""
  ).trim().replace(/\/$/, "");
  if (envOrigin) return envOrigin;
  const requestOrigin = String(req.get?.("origin") || "").trim().replace(/\/$/, "");
  if (requestOrigin) return requestOrigin;
  const forwardedProto = String(req.get?.("x-forwarded-proto") || "").split(",")[0].trim();
  const forwardedHost = String(req.get?.("x-forwarded-host") || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get?.("host") || "";
  return host ? `${protocol}://${host}` : "";
};

const buildAttendancePublicUrl = (req, token) => `${buildPublicOrigin(req)}/attendance/branch/${encodeURIComponent(token)}`;

const buildQrSvg = (value) => {
  const rawMarkup = renderToStaticMarkup(
    React.createElement(QRCodeSVG, {
      value,
      size: 512,
      level: "M",
      marginSize: 4,
      bgColor: "#ffffff",
      fgColor: "#0f172a",
      title: "Branch attendance QR",
    })
  );
  return rawMarkup.includes("xmlns=") ? rawMarkup : rawMarkup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
};

const buildQrDataUrl = (value) => {
  const markup = buildQrSvg(value);
  if (!markup || !markup.includes("<svg") || !markup.includes("</svg>")) {
    throw new Error("QR SVG generation returned invalid markup");
  }
  return {
    qrSvg: markup,
    qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(markup, "utf8").toString("base64")}`,
  };
};

const parseOptionalCoordinate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

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
  } catch (error) {
    console.warn("[attendance] timezone date fallback used", {
      timezone: ATTENDANCE_TIMEZONE,
      error: error.message,
    });
    return new Date(date).toISOString().slice(0, 10);
  }
};

const normalizeAttendanceDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return getAttendanceDate(value);
  const text = String(value);
  return text.includes("T") ? getAttendanceDate(new Date(text)) : text.slice(0, 10);
};

const attendanceHasCheckout = (row = {}) => Boolean(row.check_out || row.check_out_at || String(row.status || "").toLowerCase() === "checked_out");

const summarizeAttendanceRow = (row = {}) => ({
  id: row.id || null,
  tenant_id: row.tenant_id || null,
  employee_id: row.employee_id || null,
  branch_id: row.branch_id || null,
  attendance_date: normalizeAttendanceDate(row.attendance_date),
  check_in: row.check_in_at || row.check_in || null,
  check_out: row.check_out_at || row.check_out || null,
  status: row.status || "",
  attendance_source: row.attendance_source || "",
  created_at: row.created_at || null,
});

const buildAttendanceEligibility = ({ rows = [], branchId, attendanceDate }) => {
  const openRows = rows.filter((row) => !attendanceHasCheckout(row));
  const selectedOpen = openRows[0] || null;
  const latest = rows[0] || null;
  const branchRows = rows.filter((row) => String(row.branch_id || "") === String(branchId || ""));

  if (!rows.length) {
    return {
      status: "not_started",
      decision: "can_check_in",
      can_check_in: true,
      can_check_out: false,
      completed: false,
      attendance_date: attendanceDate,
      attendance: null,
      branch_attendance_count: 0,
      total_attendance_count: 0,
      active_session_count: 0,
    };
  }

  if (selectedOpen) {
    return {
      status: "checked_in",
      decision: "can_check_out",
      can_check_in: false,
      can_check_out: true,
      completed: false,
      attendance_date: attendanceDate,
      attendance: summarizeAttendanceRow(selectedOpen),
      branch_attendance_count: branchRows.length,
      total_attendance_count: rows.length,
      active_session_count: openRows.length,
    };
  }

  return {
    status: "completed",
    decision: "completed",
    can_check_in: false,
    can_check_out: false,
    completed: true,
    attendance_date: attendanceDate,
    attendance: summarizeAttendanceRow(latest),
    branch_attendance_count: branchRows.length,
    total_attendance_count: rows.length,
    active_session_count: 0,
  };
};

const logAttendanceEligibility = (label, context = {}, rows = [], eligibility = {}) => {
  console.info(`[attendance:${label}] eligibility`, {
    timezone: ATTENDANCE_TIMEZONE,
    attendance_date: context.attendanceDate,
    tenant_id: context.tenantId,
    employee_id: context.employeeId,
    branch_id: context.branchId,
    lookup_count: rows.length,
    lookup_result: rows.map(summarizeAttendanceRow),
    check_in: eligibility.attendance?.check_in || null,
    check_out: eligibility.attendance?.check_out || null,
    decision: eligibility.decision,
    status: eligibility.status,
    can_check_in: Boolean(eligibility.can_check_in),
    can_check_out: Boolean(eligibility.can_check_out),
    completed: Boolean(eligibility.completed),
  });
};

const resolveAttendanceEligibility = async (client, { tenantId, employeeId, branchId, attendanceDate, lock = false, label = "lookup" }) => {
  const result = await client.query(
    `
    SELECT *
    FROM attendance_logs
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND employee_id = $2
      AND attendance_date = $3::date
    ORDER BY
      CASE WHEN check_out IS NULL AND check_out_at IS NULL AND COALESCE(status, 'checked_in') <> 'checked_out' THEN 0 ELSE 1 END,
      CASE WHEN branch_id = $4 THEN 0 ELSE 1 END,
      created_at DESC,
      id DESC
    ${lock ? "FOR UPDATE" : ""}
    `,
    [tenantId, employeeId, attendanceDate, branchId]
  );
  const eligibility = buildAttendanceEligibility({ rows: result.rows, branchId, attendanceDate });
  logAttendanceEligibility(label, { tenantId, employeeId, branchId, attendanceDate }, result.rows, eligibility);
  return {
    rows: result.rows,
    eligibility,
  };
};

const lockEmployeeAttendanceDay = async (client, tenantId, employeeId) => {
  await client.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [Number(tenantId), Number(employeeId)]);
};

const hasBranchCoordinates = (branch = {}) => branch.latitude !== null && branch.latitude !== undefined && branch.longitude !== null && branch.longitude !== undefined;

const buildGpsVerification = ({ latitude, longitude, branch }) => {
  const radiusMeters = Number(branch.attendance_radius_meters || branch.allowed_radius_meters || 100);
  const allowedRadiusMeters = Number.isFinite(radiusMeters) && radiusMeters > 0 ? radiusMeters : 100;

  if (!hasBranchCoordinates(branch)) {
    return {
      result: "not_configured",
      distanceMeters: null,
      allowedRadiusMeters,
      mode: GPS_VERIFICATION_MODE,
      withinRange: null,
    };
  }

  if (latitude === null || longitude === null) {
    return {
      result: "missing",
      distanceMeters: null,
      allowedRadiusMeters,
      mode: GPS_VERIFICATION_MODE,
      withinRange: false,
    };
  }

  const distanceMeters = haversineDistanceMeters(latitude, longitude, branch.latitude, branch.longitude);
  if (!Number.isFinite(distanceMeters)) {
    return {
      result: "invalid",
      distanceMeters: null,
      allowedRadiusMeters,
      mode: GPS_VERIFICATION_MODE,
      withinRange: false,
    };
  }

  const withinRange = distanceMeters <= allowedRadiusMeters;
  return {
    result: withinRange ? "within_range" : "outside_range",
    distanceMeters,
    allowedRadiusMeters,
    mode: GPS_VERIFICATION_MODE,
    withinRange,
  };
};

const enforceGpsVerification = (verification) => {
  if (GPS_VERIFICATION_MODE !== "strict") return;
  if (verification.result === "not_configured" || verification.withinRange === true) return;

  const error = new Error(
    verification.result === "outside_range"
      ? "You are outside the allowed branch radius"
      : "Location permission is required to record attendance for this branch"
  );
  error.statusCode = verification.result === "outside_range" ? 403 : 400;
  error.gps = verification;
  throw error;
};

const parseJson = (value, fallback = []) => {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return fallback;
};

const normalizeEmployee = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  branch_id: row.branch_id || null,
  branch_name: row.branch_name || "",
  employee_code: row.employee_code || "",
  full_name: row.full_name || "",
  phone: row.phone || "",
  email: row.email || "",
  national_id: row.national_id || "",
  role: row.role || "",
  salary: Number(row.salary || 0),
  hire_date: row.hire_date || null,
  status: row.status || "active",
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  current_shift: row.shift_id
    ? {
        id: row.shift_id,
        shift_name: row.shift_name || "",
        start_time: row.start_time || "",
        end_time: row.end_time || "",
        allowed_late_minutes: Number(row.allowed_late_minutes || 0),
        overtime_after_minutes: Number(row.overtime_after_minutes || 0),
        working_days: parseJson(row.working_days, []),
      }
    : null,
  today_attendance: row.attendance_log_id
    ? {
        id: row.attendance_log_id,
        attendance_date: row.attendance_date || null,
        check_in: row.check_in || row.check_in_at || null,
        check_out: row.check_out || row.check_out_at || null,
        check_in_at: row.check_in_at || row.check_in || null,
        check_out_at: row.check_out_at || row.check_out || null,
        check_in_latitude: row.check_in_latitude ?? null,
        check_in_longitude: row.check_in_longitude ?? null,
        check_out_latitude: row.check_out_latitude ?? null,
        check_out_longitude: row.check_out_longitude ?? null,
        attendance_source: row.attendance_source || "",
        status: row.status || "checked_in",
        work_minutes: Number(row.work_minutes || 0),
        late_minutes: Number(row.late_minutes || 0),
        early_leave_minutes: Number(row.early_leave_minutes || 0),
        overtime_minutes: Number(row.overtime_minutes || 0),
        notes: row.notes || "",
      }
    : null,
});

const normalizeAttendance = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  employee_id: row.employee_id,
  branch_id: row.branch_id || null,
  shift_id: row.shift_id || null,
  employee_name: row.full_name || row.employee_name || "",
  employee_code: row.employee_code || "",
  branch_name: row.branch_name || "",
  shift_name: row.shift_name || "",
  attendance_date: row.attendance_date || null,
  check_in: row.check_in || row.check_in_at || null,
  check_out: row.check_out || row.check_out_at || null,
  check_in_at: row.check_in_at || row.check_in || null,
  check_out_at: row.check_out_at || row.check_out || null,
  check_in_latitude: row.check_in_latitude ?? null,
  check_in_longitude: row.check_in_longitude ?? null,
  check_in_gps_distance_meters: row.check_in_gps_distance_meters === null || row.check_in_gps_distance_meters === undefined ? null : Number(row.check_in_gps_distance_meters),
  check_in_gps_verification_result: row.check_in_gps_verification_result || "",
  check_out_latitude: row.check_out_latitude ?? null,
  check_out_longitude: row.check_out_longitude ?? null,
  check_out_gps_distance_meters: row.check_out_gps_distance_meters === null || row.check_out_gps_distance_meters === undefined ? null : Number(row.check_out_gps_distance_meters),
  check_out_gps_verification_result: row.check_out_gps_verification_result || "",
  attendance_source: row.attendance_source || "manual",
  status: row.status || (row.check_out || row.check_out_at ? "checked_out" : "checked_in"),
  work_minutes: Number(row.work_minutes || 0),
  late_minutes: Number(row.late_minutes || 0),
  early_leave_minutes: Number(row.early_leave_minutes || 0),
  overtime_minutes: Number(row.overtime_minutes || 0),
  notes: row.notes || "",
  created_at: row.created_at || null,
});

const findLatestShift = async (client, employeeId, tenantId, shiftId = null) => {
  if (shiftId) {
    const row = await safeQuery(
      client,
      `
      SELECT *
      FROM employee_shifts
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND employee_id = $3
      LIMIT 1
      `,
      [shiftId, tenantId, employeeId]
    );
    return row.rows[0] || null;
  }

  const result = await safeQuery(
    client,
    `
    SELECT *
    FROM employee_shifts
    WHERE employee_id = $1
      AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [employeeId, tenantId]
  );
  return result.rows[0] || null;
};

const normalizeBranch = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id,
  name: row.name || row.branch_name || "",
  latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
  longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
  attendance_radius_meters: Number(row.attendance_radius_meters || row.allowed_radius_meters || 100),
  allowed_radius_meters: Number(row.allowed_radius_meters || row.attendance_radius_meters || 100),
  qr_token: row.qr_token || "",
  status: row.status || "active",
});

const resolveEmployeeForUser = async (tenantId, user = {}) => {
  if (!user?.id) {
    return null;
  }

  const result = await db.query(
    `
    SELECT
      e.*,
      b.name AS branch_name
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      AND (
        e.id = $2
        OR LOWER(COALESCE(e.email, '')) = LOWER(COALESCE($3, ''))
        OR LOWER(COALESCE(e.full_name, '')) = LOWER(COALESCE($4, ''))
      )
    ORDER BY CASE WHEN e.id = $2 THEN 0 ELSE 1 END, e.id DESC
    LIMIT 1
    `,
    [tenantId, user.employee_id || 0, user.email || "", user.name || ""]
  );

  return result.rows[0] || null;
};

const SHIFT_DEFAULTS = {
  expectedHours: 10,
  opening: {
    label: "Opening shift",
    start_time: "12:00",
    end_time: "22:00",
  },
  regular: {
    label: "Regular shift",
    start_time: "15:00",
    end_time: "01:00",
  },
};

const getUserId = (req) => {
  const userId = Number(req.user?.id || req.user?.user_id || 0);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
};

const normalizeOpeningCandidate = (row = {}, recommendedEmployeeId = null) => ({
  id: row.id,
  employee_id: row.id,
  tenant_id: row.tenant_id,
  branch_id: row.branch_id || null,
  branch_name: row.branch_name || "",
  employee_code: row.employee_code || "",
  full_name: row.full_name || "",
  phone: row.phone || "",
  email: row.email || "",
  role: row.role || "",
  status: row.employee_status || row.status || "active",
  last_opening_at: row.last_opening_at || null,
  total_openings: Number(row.total_openings || 0),
  openings_this_week: Number(row.openings_this_week || 0),
  openings_this_month: Number(row.openings_this_month || 0),
  average_worked_hours: Number(row.average_worked_hours || 0),
  attendance_status: row.attendance_status || "not_checked_in",
  today_attendance_id: row.today_attendance_id || null,
  is_recommended: String(row.id) === String(recommendedEmployeeId),
});

const normalizeOpeningAssignment = (row = {}) => {
  if (!row?.id) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    shift_id: row.shift_id || null,
    attendance_log_id: row.attendance_log_id || null,
    employee_id: row.employee_id,
    employee_name: row.employee_name || row.full_name || "",
    employee_code: row.employee_code || "",
    assigned_by_user_id: row.assigned_by_user_id || null,
    assigned_by_name: row.assigned_by_name || "",
    assigned_at: row.assigned_at || null,
    note: row.note || "",
    created_at: row.created_at || null,
  };
};

const isTestLikeEmployee = (row = {}) => {
  const haystack = [
    row.full_name,
    row.employee_code,
    row.email,
    row.phone,
    row.role,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(test|demo|sample|dummy|codex|temp)\b/.test(haystack) || haystack.includes("اختبار") || haystack.includes("تجربة");
};

const fetchLatestOpeningAssignment = async (client, tenantId) => {
  const result = await safeQuery(
    client,
    `
    SELECT
      soa.*,
      e.full_name AS employee_name,
      e.employee_code,
      COALESCE(u.name, u.email, '') AS assigned_by_name
    FROM shift_opening_assignments soa
    LEFT JOIN employees e ON e.id = soa.employee_id
    LEFT JOIN users u ON u.id = soa.assigned_by_user_id
    WHERE ($1::bigint IS NULL OR soa.tenant_id = $1::bigint)
    ORDER BY soa.assigned_at DESC, soa.id DESC
    LIMIT 1
    `,
    [tenantId]
  );

  return normalizeOpeningAssignment(result.rows[0] || {});
};

const fetchOpeningCandidates = async (client, tenantId, options = {}) => {
  const attendanceDate = getAttendanceDate();
  const result = await safeQuery(
    client,
    `
    WITH opening_stats AS (
      SELECT
        employee_id,
        MAX(assigned_at) AS last_opening_at,
        COUNT(*)::int AS total_openings,
        COUNT(*) FILTER (
          WHERE assigned_at >= date_trunc('week', $2::date)::timestamp
        )::int AS openings_this_week,
        COUNT(*) FILTER (
          WHERE assigned_at >= date_trunc('month', $2::date)::timestamp
        )::int AS openings_this_month
      FROM shift_opening_assignments
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      GROUP BY employee_id
    ),
    attendance_stats AS (
      SELECT
        employee_id,
        AVG(
          CASE
            WHEN COALESCE(work_minutes, 0) > 0 THEN work_minutes
            WHEN check_in_at IS NOT NULL AND check_out_at IS NOT NULL THEN EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60
            WHEN check_in IS NOT NULL AND check_out IS NOT NULL THEN EXTRACT(EPOCH FROM (check_out - check_in)) / 60
            ELSE NULL
          END
        ) / 60.0 AS average_worked_hours
      FROM attendance_logs
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND (check_out_at IS NOT NULL OR check_out IS NOT NULL OR COALESCE(work_minutes, 0) > 0)
      GROUP BY employee_id
    ),
    today_attendance AS (
      SELECT DISTINCT ON (employee_id)
        employee_id,
        id AS today_attendance_id,
        CASE
          WHEN check_out_at IS NOT NULL OR check_out IS NOT NULL OR status = 'checked_out' THEN 'checked_out'
          WHEN check_in_at IS NOT NULL OR check_in IS NOT NULL THEN 'checked_in'
          ELSE COALESCE(status, 'not_checked_in')
        END AS attendance_status
      FROM attendance_logs
      WHERE attendance_date = $2::date
        AND ($1::bigint IS NULL OR tenant_id = $1::bigint)
      ORDER BY employee_id, created_at DESC
    )
    SELECT
      e.*,
      b.name AS branch_name,
      COALESCE(os.last_opening_at, NULL) AS last_opening_at,
      COALESCE(os.total_openings, 0) AS total_openings,
      COALESCE(os.openings_this_week, 0) AS openings_this_week,
      COALESCE(os.openings_this_month, 0) AS openings_this_month,
      COALESCE(ast.average_worked_hours, 0) AS average_worked_hours,
      COALESCE(ta.attendance_status, 'not_checked_in') AS attendance_status,
      ta.today_attendance_id,
      e.status AS employee_status
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN opening_stats os ON os.employee_id = e.id
    LEFT JOIN attendance_stats ast ON ast.employee_id = e.id
    LEFT JOIN today_attendance ta ON ta.employee_id = e.id
    WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
    ORDER BY
      CASE WHEN os.last_opening_at IS NULL THEN 0 ELSE 1 END,
      os.last_opening_at ASC NULLS FIRST,
      COALESCE(os.total_openings, 0) ASC,
      e.full_name ASC,
      e.id ASC
    `,
    [tenantId, attendanceDate]
  );

  const rows = result.rows || [];
  const nonTestRows = rows.filter((row) => !isTestLikeEmployee(row));
  const candidateRows = options.includeTestEmployees || nonTestRows.length === 0 ? rows : nonTestRows;
  const candidateRowsWithHistory = candidateRows.filter((row) => row.last_opening_at);
  const recommendedPool = candidateRowsWithHistory.length > 0 ? candidateRowsWithHistory : candidateRows;
  const recommended = recommendedPool.slice().sort((a, b) => {
    if (candidateRowsWithHistory.length > 0) {
      return new Date(a.last_opening_at).getTime() - new Date(b.last_opening_at).getTime();
    }
    const totalDiff = Number(a.total_openings || 0) - Number(b.total_openings || 0);
    if (totalDiff !== 0) return totalDiff;
    return String(a.full_name || "").localeCompare(String(b.full_name || ""));
  })[0];

  const recommendedEmployeeId = recommended?.id || null;
  return candidateRows.map((row) => ({
    ...normalizeOpeningCandidate(row, recommendedEmployeeId),
    is_test_like: isTestLikeEmployee(row),
  }));
};

const validateOpeningEmployee = async (client, tenantId, employeeId) => {
  if (!employeeId) return null;

  const result = await safeQuery(
    client,
    `
    SELECT e.*, b.name AS branch_name
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    WHERE e.id = $1
      AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint)
      AND LOWER(COALESCE(e.status, 'active')) = 'active'
    LIMIT 1
    `,
    [employeeId, tenantId]
  );

  return result.rows[0] || null;
};

export const getEmployees = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const attendanceDate = getAttendanceDate();
    const search = String(req.query.search || "").trim().toLowerCase();
    const params = [tenantId, attendanceDate];
    const tenantPredicate = "($1::bigint IS NULL OR e.tenant_id = $1::bigint)";
    const searchPredicate = search
      ? ` AND (
          LOWER(COALESCE(e.full_name, '')) LIKE $${params.length + 1}
          OR LOWER(COALESCE(e.employee_code, '')) LIKE $${params.length + 1}
          OR LOWER(COALESCE(e.phone, '')) LIKE $${params.length + 1}
          OR LOWER(COALESCE(e.email, '')) LIKE $${params.length + 1}
          OR LOWER(COALESCE(e.role, '')) LIKE $${params.length + 1}
        )`
      : "";

    if (search) {
      params.push(`%${search}%`);
    }

    const result = await db.query(
      `
      SELECT
        e.*,
        w.name AS branch_name,
        s.id AS shift_id,
        s.shift_name,
        s.start_time,
        s.end_time,
        s.allowed_late_minutes,
        s.overtime_after_minutes,
        s.working_days,
        al.id AS attendance_log_id,
        al.attendance_date,
        al.check_in,
        al.check_out,
        al.attendance_source,
        al.work_minutes,
        al.late_minutes,
        al.early_leave_minutes,
        al.overtime_minutes,
        al.notes
      FROM employees e
    LEFT JOIN branches w ON w.id = e.branch_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM employee_shifts s
        WHERE s.employee_id = e.id
          AND ($1::bigint IS NULL OR s.tenant_id = $1::bigint)
        ORDER BY s.created_at DESC
        LIMIT 1
      ) s ON TRUE
      LEFT JOIN LATERAL (
        SELECT *
        FROM attendance_logs al
        WHERE al.employee_id = e.id
          AND al.attendance_date = $2::date
          AND ($1::bigint IS NULL OR al.tenant_id = $1::bigint)
        ORDER BY al.created_at DESC
        LIMIT 1
      ) al ON TRUE
      WHERE ${tenantPredicate}
      ${searchPredicate}
      ORDER BY e.id DESC
      `,
      params
    );

    return res.status(200).json({
      success: true,
      data: result.rows.map(normalizeEmployee),
      employees: result.rows.map(normalizeEmployee),
    });
  } catch (error) {
    console.log("GET EMPLOYEES ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch employees",
      error: error.message,
    });
  }
};

export const createEmployee = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req) ?? 1;
    const {
      branch_id = null,
      employee_code,
      full_name,
      phone,
      email,
      national_id,
      role,
      salary,
      hire_date,
      status,
    } = req.body || {};

    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Employee full name is required",
      });
    }

    const code = String(employee_code || `EMP-${Date.now()}`).trim();
    const created = await db.query(
      `
      INSERT INTO employees (
        tenant_id,
        branch_id,
        employee_code,
        full_name,
        phone,
        email,
        national_id,
        role,
        salary,
        hire_date,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
      `,
      [
        tenantId,
        branch_id || null,
        code,
        String(full_name).trim(),
        phone || "",
        email || "",
        national_id || "",
        role || "",
        Number(salary || 0),
        hire_date || new Date().toISOString().slice(0, 10),
        status || "active",
      ]
    );

    return res.status(201).json({
      success: true,
      data: normalizeEmployee(created.rows[0]),
      employee: normalizeEmployee(created.rows[0]),
    });
  } catch (error) {
    console.log("CREATE EMPLOYEE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create employee",
      error: error.message,
    });
  }
};

export const updateEmployee = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const { id } = req.params;
    const {
      branch_id = null,
      employee_code,
      full_name,
      phone,
      email,
      national_id,
      role,
      salary,
      hire_date,
      status,
    } = req.body || {};

    const updated = await db.query(
      `
      UPDATE employees
      SET
        branch_id = $1,
        employee_code = $2,
        full_name = $3,
        phone = $4,
        email = $5,
        national_id = $6,
        role = $7,
        salary = $8,
        hire_date = $9,
        status = $10,
        updated_at = NOW()
      WHERE id = $11
        AND ($12::bigint IS NULL OR tenant_id = $12::bigint)
      RETURNING *
      `,
      [
        branch_id || null,
        employee_code || `EMP-${id}`,
        String(full_name || "").trim(),
        phone || "",
        email || "",
        national_id || "",
        role || "",
        Number(salary || 0),
        hire_date || new Date().toISOString().slice(0, 10),
        status || "active",
        id,
        tenantId,
      ]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: normalizeEmployee(updated.rows[0]),
      employee: normalizeEmployee(updated.rows[0]),
    });
  } catch (error) {
    console.log("UPDATE EMPLOYEE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update employee",
      error: error.message,
    });
  }
};

export const getEmployeeShifts = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const { id } = req.params;

    const result = await safeQuery(
      db,
      `
      SELECT
        s.*,
        e.full_name AS employee_name,
        e.employee_code
      FROM employee_shifts s
      LEFT JOIN employees e ON e.id = s.employee_id
      WHERE s.employee_id = $2
        AND ($1::bigint IS NULL OR s.tenant_id = $1::bigint)
      ORDER BY s.created_at DESC
      `,
      [tenantId, id]
    );

    return res.status(200).json({
      success: true,
      data: result.rows || [],
      shifts: result.rows || [],
    });
  } catch (error) {
    console.log("GET EMPLOYEE SHIFTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch employee shifts",
      error: error.message,
    });
  }
};

export const createEmployeeShift = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const { id } = req.params;
    const {
      shift_name,
      start_time,
      end_time,
      allowed_late_minutes = 0,
      overtime_after_minutes = 0,
      working_days = [],
    } = req.body || {};

    if (!shift_name || !start_time || !end_time) {
      return res.status(400).json({
        success: false,
        message: "Shift name, start time and end time are required",
      });
    }

    const created = await db.query(
      `
      INSERT INTO employee_shifts (
        tenant_id,
        employee_id,
        shift_name,
        start_time,
        end_time,
        allowed_late_minutes,
        overtime_after_minutes,
        working_days
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      RETURNING *
      `,
      [
        tenantId,
        id,
        String(shift_name).trim(),
        start_time,
        end_time,
        Number(allowed_late_minutes || 0),
        Number(overtime_after_minutes || 0),
        JSON.stringify(parseJson(working_days, [])),
      ]
    );

    return res.status(201).json({
      success: true,
      data: created.rows[0],
      shift: created.rows[0],
    });
  } catch (error) {
    console.log("CREATE SHIFT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create shift",
      error: error.message,
    });
  }
};

export const updateEmployeeShift = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const { id } = req.params;
    const {
      shift_name,
      start_time,
      end_time,
      allowed_late_minutes = 0,
      overtime_after_minutes = 0,
      working_days = [],
    } = req.body || {};

    const updated = await db.query(
      `
      UPDATE employee_shifts
      SET
        shift_name = $1,
        start_time = $2,
        end_time = $3,
        allowed_late_minutes = $4,
        overtime_after_minutes = $5,
        working_days = $6::jsonb,
        updated_at = NOW()
      WHERE id = $7
        AND ($8::bigint IS NULL OR tenant_id = $8::bigint)
      RETURNING *
      `,
      [
        shift_name || "",
        start_time || "09:00",
        end_time || "17:00",
        Number(allowed_late_minutes || 0),
        Number(overtime_after_minutes || 0),
        JSON.stringify(parseJson(working_days, [])),
        id,
        tenantId,
      ]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shift not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: updated.rows[0],
      shift: updated.rows[0],
    });
  } catch (error) {
    console.log("UPDATE SHIFT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update shift",
      error: error.message,
    });
  }
};

export const checkIn = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureAttendanceSchema();
    await client.query("BEGIN");

    const tenantId = resolveAuthenticatedTenantId(req);
    console.log("[attendance] check-in tenant", tenantId);
    const employeeId = Number(req.body?.employee_id || req.body?.employeeId || 0);
    const attendanceSource = String(req.body?.attendance_source || req.body?.source || "manual").toLowerCase();
    const notes = req.body?.notes || "";
    const shiftId = req.body?.shift_id || req.body?.shiftId || null;
    const attendanceDate = getAttendanceDate();

    if (!tenantId) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Tenant context is required for attendance check-in",
      });
    }

    if (!employeeId) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Employee is required",
      });
    }

    const employeeResult = await safeQuery(
      client,
      `
      SELECT e.*, b.name AS branch_name
      FROM employees e
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE e.id = $1
        AND e.tenant_id = $2::bigint
      LIMIT 1
      `,
      [employeeId, tenantId]
    );

    if (employeeResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    await lockEmployeeAttendanceDay(client, tenantId, employeeId);
    const attendanceBranchId = employeeResult.rows[0].branch_id || null;
    const { eligibility } = await resolveAttendanceEligibility(client, {
      tenantId,
      employeeId,
      branchId: attendanceBranchId,
      attendanceDate,
      lock: true,
      label: "manual-check-in",
    });

    if (!eligibility.can_check_in) {
      await client.query("ROLLBACK");
      if (eligibility.can_check_out) {
        return res.status(200).json({
          success: true,
          alreadyOpen: true,
          attendance_state: eligibility,
          data: eligibility.attendance,
          attendance: eligibility.attendance,
        });
      }

      return res.status(409).json({
        success: false,
        message: "Attendance completed for today",
        attendance_state: eligibility,
      });
    }

    const shift = await findLatestShift(client, employeeId, tenantId, shiftId);

    if (attendanceSource === "pos" && !attendanceBranchId) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Selected employee has no branch assigned",
      });
    }

    const created = await client.query(
      `
      INSERT INTO attendance_logs (
        tenant_id,
        employee_id,
        shift_id,
        branch_id,
        attendance_date,
        check_in,
        attendance_source,
        work_minutes,
        late_minutes,
        early_leave_minutes,
        overtime_minutes,
        notes
      )
      VALUES (
        $1,$2,$3,$4,$5::date,NOW(),$6,0,0,0,0,$7
      )
      RETURNING *
      `,
      [
        tenantId,
        employeeId,
        shift?.id || null,
        attendanceBranchId,
        attendanceDate,
        attendanceSource || "manual",
        notes || "",
      ]
    );

    const responseRow = {
      ...created.rows[0],
      employee_name: employeeResult.rows[0].full_name,
      employee_code: employeeResult.rows[0].employee_code,
      branch_name: employeeResult.rows[0].branch_name || "",
      shift_name: shift?.shift_name || "",
    };

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      data: normalizeAttendance(responseRow),
      attendance: normalizeAttendance(responseRow),
      notificationPreview: buildAttendanceAlertNotification({
        employeeName: employeeResult.rows[0].full_name,
        attendanceDate: created.rows[0].attendance_date,
        alertType: "check_in",
        branchName: employeeResult.rows[0].branch_name || "",
      }),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("CHECK IN ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to check in",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const checkOut = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureAttendanceSchema();
    await client.query("BEGIN");

    const tenantId = resolveAuthenticatedTenantId(req);
    console.log("[attendance] check-out tenant", tenantId);
    const employeeId = Number(req.body?.employee_id || req.body?.employeeId || 0);
    const attendanceLogId = Number(req.body?.attendance_log_id || req.body?.attendanceLogId || 0);
    const notes = req.body?.notes || "";
    const nextOpeningEmployeeIdRaw = req.body?.next_opening_employee_id || req.body?.nextOpeningEmployeeId || null;
    const nextOpeningEmployeeId = nextOpeningEmployeeIdRaw ? Number(nextOpeningEmployeeIdRaw) : null;
    const attendanceDate = getAttendanceDate();

    if (!tenantId) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Tenant context is required for attendance check-out",
      });
    }

    let attendanceRow = null;
    if (attendanceLogId) {
      const result = await safeQuery(
        client,
        `
        SELECT *
        FROM attendance_logs
        WHERE id = $1
          AND tenant_id = $2::bigint
        LIMIT 1
        `,
        [attendanceLogId, tenantId]
      );
      attendanceRow = result.rows[0] || null;
    }

    const lookupEmployeeId = attendanceRow?.employee_id || employeeId;
    if (lookupEmployeeId) {
      await lockEmployeeAttendanceDay(client, tenantId, lookupEmployeeId);
      const { eligibility } = await resolveAttendanceEligibility(client, {
        tenantId,
        employeeId: lookupEmployeeId,
        branchId: attendanceRow?.branch_id || null,
        attendanceDate,
        lock: true,
        label: "manual-check-out",
      });
      if (eligibility.can_check_out) {
        attendanceRow = {
          ...attendanceRow,
          ...eligibility.attendance,
          check_in: eligibility.attendance.check_in,
          check_in_at: eligibility.attendance.check_in,
          check_out: null,
          check_out_at: null,
        };
      } else if (eligibility.completed) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "Shift already closed for this employee today",
          attendance_state: eligibility,
        });
      } else {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Open attendance not found",
          attendance_state: eligibility,
        });
      }
    }

    if (!attendanceRow && !employeeId) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Employee is required to close shift",
      });
    }

    if (!attendanceRow) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Open attendance not found",
      });
    }

    if (attendanceRow.check_out || attendanceRow.check_out_at) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Shift already closed for this employee today",
      });
    }

    const employeeResult = await safeQuery(
      client,
      `
      SELECT e.*, w.name AS branch_name
      FROM employees e
      LEFT JOIN branches w ON w.id = e.branch_id
      WHERE e.id = $1
        AND e.tenant_id = $2::bigint
      LIMIT 1
      `,
      [attendanceRow.employee_id, tenantId]
    );
    const employee = employeeResult.rows[0];
    let nextOpeningEmployee = null;
    if (nextOpeningEmployeeId) {
      nextOpeningEmployee = await validateOpeningEmployee(client, tenantId, nextOpeningEmployeeId);
      if (!nextOpeningEmployee) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Next opening employee must exist and be active",
        });
      }
    }

    const shift = await findLatestShift(client, attendanceRow.employee_id, tenantId, attendanceRow.shift_id);
    const attendanceLog = attendanceRow;
    const shiftStartTime = shift?.start_time || attendanceLog?.check_in_time || attendanceLog?.check_in;
    const metrics = calculateAttendanceMetrics({
      attendanceDate: attendanceRow.attendance_date,
      checkIn: attendanceRow.check_in_time || attendanceRow.check_in,
      checkOut: new Date(),
      shift: shift ? { ...shift, start_time: shiftStartTime } : { start_time: shiftStartTime },
    });

    const updated = await client.query(
      `
      UPDATE attendance_logs
      SET
        check_out = NOW(),
        check_out_at = NOW(),
        status = 'checked_out',
        work_minutes = $1,
        late_minutes = $2,
        early_leave_minutes = $3,
        overtime_minutes = $4,
        next_opening_employee_id = $8,
        closed_by_user_id = $9,
        closed_at = NOW(),
        notes = CASE
          WHEN COALESCE(notes, '') = '' THEN $5
          WHEN $5 = '' THEN notes
          ELSE notes || E'\n' || $5
        END,
        updated_at = NOW()
      WHERE id = $6
        AND tenant_id = $7::bigint
      RETURNING *
      `,
      [
        metrics.work_minutes,
        metrics.late_minutes,
        metrics.early_leave_minutes,
        metrics.overtime_minutes,
        notes || "",
        attendanceRow.id,
        tenantId,
        nextOpeningEmployeeId,
        getUserId(req),
      ]
    );

    if (updated.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Open attendance not found for tenant",
      });
    }

    const responseRow = {
      ...updated.rows[0],
      employee_name: employee?.full_name || "",
      employee_code: employee?.employee_code || "",
      branch_name: employee?.branch_name || "",
      shift_name: shift?.shift_name || "",
    };

    let openingAssignment = null;
    if (nextOpeningEmployeeId) {
      const assignment = await client.query(
        `
        INSERT INTO shift_opening_assignments (
          tenant_id,
          shift_id,
          attendance_log_id,
          employee_id,
          assigned_by_user_id,
          assigned_at,
          note
        )
        VALUES ($1,$2,$3,$4,$5,NOW(),$6)
        ON CONFLICT (attendance_log_id) WHERE attendance_log_id IS NOT NULL
        DO UPDATE SET
          employee_id = EXCLUDED.employee_id,
          assigned_by_user_id = EXCLUDED.assigned_by_user_id,
          assigned_at = EXCLUDED.assigned_at,
          note = EXCLUDED.note
        RETURNING *
        `,
        [
          tenantId,
          attendanceRow.shift_id || null,
          updated.rows[0].id,
          nextOpeningEmployeeId,
          getUserId(req),
          req.body?.next_opening_note || req.body?.note || "Assigned during POS shift close",
        ]
      );

      openingAssignment = normalizeOpeningAssignment({
        ...assignment.rows[0],
        employee_name: nextOpeningEmployee.full_name,
        employee_code: nextOpeningEmployee.employee_code,
        assigned_by_name: req.user?.name || req.user?.email || "",
      });
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      data: normalizeAttendance(responseRow),
      attendance: normalizeAttendance(responseRow),
      nextOpeningEmployee: nextOpeningEmployee
        ? normalizeOpeningCandidate(
            {
              ...nextOpeningEmployee,
              branch_name: nextOpeningEmployee.branch_name || "",
              employee_status: nextOpeningEmployee.status || "active",
            },
            nextOpeningEmployee.id
          )
        : null,
      openingAssignment,
      notificationPreview: buildShiftSummaryNotification({
        employeeName: employee?.full_name || "",
        date: attendanceRow.attendance_date,
        workedMinutes: metrics.work_minutes,
        lateMinutes: metrics.late_minutes,
        overtimeMinutes: metrics.overtime_minutes,
        branchName: employee?.branch_name || "",
      }),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("CHECK OUT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to check out",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const getDailyReport = async (req, res) => {
  const buildEmptyDailyReport = () => ({
    presentToday: 0,
    absentToday: 0,
    lateEmployees: 0,
    overtimeEmployees: 0,
    totalWorkedMinutes: 0,
    employees: [],
  });

  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const branchId = req.query.branchId || req.query.branch_id || null;
    const params = [tenantId, date];
    const branchClause = branchId ? ` AND COALESCE(al.branch_id, e.branch_id) = $3` : "";
    if (branchId) params.push(branchId);

    const logsResult = await safeQuery(
      db,
      `
      SELECT
        al.*,
        e.full_name,
        e.employee_code,
        e.role,
        COALESCE(b.name, '') AS branch_name,
        COALESCE(s.shift_name, '') AS shift_name,
        s.start_time,
        s.end_time,
        s.allowed_late_minutes,
        s.overtime_after_minutes,
        s.working_days
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      LEFT JOIN branches b ON b.id = COALESCE(al.branch_id, e.branch_id)
      LEFT JOIN employee_shifts s ON s.id = al.shift_id
      WHERE ($1::bigint IS NULL OR al.tenant_id = $1::bigint)
        AND al.attendance_date = $2::date
        ${branchClause}
      ORDER BY al.created_at DESC
      `,
      params
    );

    const employeesResult = await safeQuery(
      db,
      `
      SELECT COUNT(*) AS total_employees
      FROM employees e
      WHERE ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
        ${branchId ? "AND e.branch_id = $3" : ""}
      `,
      params
    );

    const summaryRow = await safeQuery(
      db,
      `
      SELECT
        COUNT(*) AS present_count,
        COUNT(*) FILTER (WHERE late_minutes > 0) AS late_count,
        COUNT(*) FILTER (WHERE overtime_minutes > 0) AS overtime_count,
        COALESCE(SUM(work_minutes), 0) AS total_work_minutes
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      LEFT JOIN branches b ON b.id = COALESCE(al.branch_id, e.branch_id)
      WHERE ($1::bigint IS NULL OR al.tenant_id = $1::bigint)
        AND al.attendance_date = $2::date
        ${branchClause}
      `,
      params
    );

    const normalizedLogs = (logsResult.rows || []).map((row) => normalizeAttendance(row));
    const totalEmployees = Number(employeesResult.rows?.[0]?.total_employees || 0);
    const present = Number(summaryRow.rows?.[0]?.present_count || 0);
    const late = Number(summaryRow.rows?.[0]?.late_count || 0);
    const overtime = Number(summaryRow.rows?.[0]?.overtime_count || 0);
    const totalWorkedMinutes = Number(summaryRow.rows?.[0]?.total_work_minutes || 0);

    if (normalizedLogs.length === 0 && totalEmployees === 0) {
      return res.status(200).json({
        success: true,
        data: buildEmptyDailyReport(),
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        date,
        presentToday: present,
        absentToday: Math.max(0, totalEmployees - present),
        lateEmployees: late,
        overtimeEmployees: overtime,
        totalWorkedMinutes,
        employees: normalizedLogs,
        summary: {
          totalEmployees,
          present,
          absent: Math.max(0, totalEmployees - present),
          late,
          overtime,
          totalWorkedMinutes,
          totalWorkedHours: formatMinutes(totalWorkedMinutes),
        },
        logs: normalizedLogs,
      },
    });
  } catch (error) {
    console.error("[attendance] daily report failed", error);
    return res.status(200).json({
      success: true,
      data: buildEmptyDailyReport(),
    });
  }
};

export const getEmployeeReport = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const { id } = req.params;
    const startDate = req.query.startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const endDate = req.query.endDate || new Date().toISOString().slice(0, 10);

    const employeeResult = await db.query(
      `
      SELECT e.*, w.name AS branch_name
      FROM employees e
      LEFT JOIN branches w ON w.id = e.branch_id
      WHERE e.id = $1
        AND ($2::bigint IS NULL OR e.tenant_id = $2::bigint)
      LIMIT 1
      `,
      [id, tenantId]
    );

    if (employeeResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const logsResult = await db.query(
      `
      SELECT
        al.*,
        e.full_name,
        e.employee_code,
        COALESCE(w.name, '') AS branch_name,
        COALESCE(s.shift_name, '') AS shift_name
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      LEFT JOIN branches w ON w.id = COALESCE(al.branch_id, e.branch_id)
      LEFT JOIN employee_shifts s ON s.id = al.shift_id
      WHERE al.employee_id = $1
        AND al.attendance_date BETWEEN $2::date AND $3::date
        AND ($4::bigint IS NULL OR al.tenant_id = $4::bigint)
      ORDER BY al.attendance_date DESC, al.created_at DESC
      `,
      [id, startDate, endDate, tenantId]
    );

    const summary = logsResult.rows.reduce(
      (acc, row) => {
        acc.daysPresent += 1;
        acc.totalWorkedMinutes += Number(row.work_minutes || 0);
        acc.lateDays += Number(row.late_minutes || 0) > 0 ? 1 : 0;
        acc.overtimeDays += Number(row.overtime_minutes || 0) > 0 ? 1 : 0;
        return acc;
      },
      {
        daysPresent: 0,
        totalWorkedMinutes: 0,
        lateDays: 0,
        overtimeDays: 0,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        employee: normalizeEmployee(employeeResult.rows[0]),
        summary: {
          ...summary,
          totalWorkedHours: formatMinutes(summary.totalWorkedMinutes),
          averageWorkedMinutes: logsResult.rows.length
            ? Math.round(summary.totalWorkedMinutes / logsResult.rows.length)
            : 0,
        },
        logs: logsResult.rows.map((row) => normalizeAttendance(row)),
        startDate,
        endDate,
      },
    });
  } catch (error) {
    console.log("EMPLOYEE REPORT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch employee report",
      error: error.message,
    });
  }
};

export const getBranchReport = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const startDate = req.query.startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const endDate = req.query.endDate || new Date().toISOString().slice(0, 10);
    const branchId = req.query.branchId || req.query.branch_id || null;

    const params = [tenantId, startDate, endDate];
    const branchClause = branchId ? ` AND COALESCE(al.branch_id, e.branch_id) = $4` : "";
    if (branchId) params.push(branchId);

    const result = await db.query(
      `
      SELECT
        COALESCE(al.branch_id, e.branch_id) AS branch_id,
        COALESCE(w.name, 'Unassigned') AS branch_name,
        COUNT(*) AS present_count,
        COUNT(*) FILTER (WHERE al.late_minutes > 0) AS late_count,
        COUNT(*) FILTER (WHERE al.overtime_minutes > 0) AS overtime_count,
        COALESCE(SUM(al.work_minutes), 0) AS total_work_minutes
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      LEFT JOIN branches w ON w.id = COALESCE(al.branch_id, e.branch_id)
      WHERE ($1::bigint IS NULL OR al.tenant_id = $1::bigint)
        AND al.attendance_date BETWEEN $2::date AND $3::date
        ${branchClause}
      GROUP BY 1, 2
      ORDER BY total_work_minutes DESC, branch_name ASC
      `,
      params
    );

    const totals = result.rows.reduce(
      (acc, row) => {
        acc.present += Number(row.present_count || 0);
        acc.late += Number(row.late_count || 0);
        acc.overtime += Number(row.overtime_count || 0);
        acc.totalWorkedMinutes += Number(row.total_work_minutes || 0);
        return acc;
      },
      {
        present: 0,
        late: 0,
        overtime: 0,
        totalWorkedMinutes: 0,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        startDate,
        endDate,
        summary: {
          ...totals,
          totalWorkedHours: formatMinutes(totals.totalWorkedMinutes),
        },
        branches: result.rows.map((row) => ({
          branch_id: row.branch_id,
          branch_name: row.branch_name,
          present_count: Number(row.present_count || 0),
          late_count: Number(row.late_count || 0),
          overtime_count: Number(row.overtime_count || 0),
          total_work_minutes: Number(row.total_work_minutes || 0),
          total_work_hours: formatMinutes(Number(row.total_work_minutes || 0)),
        })),
      },
    });
  } catch (error) {
    console.log("BRANCH REPORT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch branch attendance report",
      error: error.message,
    });
  }
};

export const getAttendanceKioskSnapshot = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const { employeeId } = req.query;
    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "employeeId is required",
      });
    }

    const result = await db.query(
      `
      SELECT
        e.*,
        w.name AS branch_name,
        al.id AS attendance_log_id,
        al.attendance_date,
        al.check_in,
        al.check_out,
        al.attendance_source,
        al.work_minutes,
        al.late_minutes,
        al.early_leave_minutes,
        al.overtime_minutes,
        al.notes,
        s.id AS shift_id,
        s.shift_name,
        s.start_time,
        s.end_time,
        s.allowed_late_minutes,
        s.overtime_after_minutes,
        s.working_days
      FROM employees e
      LEFT JOIN branches w ON w.id = e.branch_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM attendance_logs al
        WHERE al.employee_id = e.id
          AND al.attendance_date = CURRENT_DATE
        AND ($1::bigint IS NULL OR al.tenant_id = $1::bigint)
        ORDER BY al.created_at DESC
        LIMIT 1
      ) al ON TRUE
      LEFT JOIN LATERAL (
        SELECT *
        FROM employee_shifts s
        WHERE s.employee_id = e.id
          AND ($1::bigint IS NULL OR s.tenant_id = $1::bigint)
        ORDER BY s.created_at DESC
        LIMIT 1
      ) s ON TRUE
      WHERE e.id = $2
        AND ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      LIMIT 1
      `,
      [tenantId, employeeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: normalizeEmployee(result.rows[0]),
      employee: normalizeEmployee(result.rows[0]),
    });
  } catch (error) {
    console.log("KIOSK SNAPSHOT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch kiosk snapshot",
      error: error.message,
    });
  }
};

const buildAttendanceTodaySummary = (rows = [], employeesCount = 0) => {
  const logs = rows.filter(Boolean);
  const checkedOut = logs.filter((row) => row.check_out_at || row.check_out || row.status === "checked_out");
  const openLogs = logs.filter((row) => !(row.check_out_at || row.check_out));
  const lateLogs = logs.filter((row) => Number(row.late_minutes || 0) > 0);
  const totalWorkedMinutes = logs.reduce((sum, row) => sum + Number(row.work_minutes || 0), 0);

  return {
    totalEmployees: Number(employeesCount || 0),
    presentNow: logs.length,
    checkedOut: checkedOut.length,
    missingCheckout: openLogs.length,
    lateEmployees: lateLogs.length,
    absent: Math.max(0, Number(employeesCount || 0) - logs.length),
    totalWorkedMinutes,
    totalWorkedHours: formatMinutes(totalWorkedMinutes),
  };
};

export const getAttendanceToday = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const branchId = req.query.branchId || req.query.branch_id || null;
    const employeeId = req.query.employeeId || req.query.employee_id || null;

    const params = [tenantId, date];
    const filters = ["($1::bigint IS NULL OR al.tenant_id = $1::bigint)", "al.attendance_date = $2::date"];
    if (branchId) {
      params.push(branchId);
      filters.push(`COALESCE(al.branch_id, e.branch_id) = $${params.length}`);
    }
    if (employeeId) {
      params.push(employeeId);
      filters.push(`al.employee_id = $${params.length}`);
    }

    const logsResult = await db.query(
      `
      SELECT
        al.*,
        e.full_name,
        e.employee_code,
        e.role,
        COALESCE(w.name, '') AS branch_name
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      LEFT JOIN branches w ON w.id = COALESCE(al.branch_id, e.branch_id)
      WHERE ${filters.join(" AND ")}
      ORDER BY al.created_at DESC
      `,
      params
    );

    const employeesParams = [tenantId];
    const employeesFilters = ["($1::bigint IS NULL OR e.tenant_id = $1::bigint)"];
    if (branchId) {
      employeesParams.push(branchId);
      employeesFilters.push(`e.branch_id = $${employeesParams.length}`);
    }
    if (employeeId) {
      employeesParams.push(employeeId);
      employeesFilters.push(`e.id = $${employeesParams.length}`);
    }

    const employeesResult = await db.query(
      `
      SELECT COUNT(*) AS total_employees
      FROM employees e
      WHERE ${employeesFilters.join(" AND ")}
      `,
      employeesParams
    );

    return res.status(200).json({
      success: true,
      data: {
        date,
        summary: buildAttendanceTodaySummary(logsResult.rows, Number(employeesResult.rows[0]?.total_employees || 0)),
        logs: logsResult.rows.map(normalizeAttendance),
      },
    });
  } catch (error) {
    console.log("ATTENDANCE TODAY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch attendance today overview",
      error: error.message,
    });
  }
};

const buildMonthlyTotals = (rows = []) => {
  const bucket = new Map();

  rows.forEach((row) => {
    const key = String(row.attendance_date || "").slice(0, 7) || "unknown";
    if (!bucket.has(key)) {
      bucket.set(key, {
        month: key,
        present: 0,
        checkedOut: 0,
        missingCheckout: 0,
        late: 0,
        totalWorkedMinutes: 0,
      });
    }

    const current = bucket.get(key);
    current.present += 1;
    current.checkedOut += row.check_out_at || row.check_out ? 1 : 0;
    current.missingCheckout += row.check_out_at || row.check_out ? 0 : 1;
    current.late += Number(row.late_minutes || 0) > 0 ? 1 : 0;
    current.totalWorkedMinutes += Number(row.work_minutes || 0);
  });

  return Array.from(bucket.values()).map((item) => ({
    ...item,
    totalWorkedHours: formatMinutes(item.totalWorkedMinutes),
  }));
};

export const getAttendanceReports = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const from = req.query.from || req.query.startDate || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const to = req.query.to || req.query.endDate || new Date().toISOString().slice(0, 10);
    const branchId = req.query.branchId || req.query.branch_id || null;
    const employeeId = req.query.employeeId || req.query.employee_id || null;

    const params = [tenantId, from, to];
    const clauses = ["($1::bigint IS NULL OR al.tenant_id = $1::bigint)", "al.attendance_date BETWEEN $2::date AND $3::date"];
    if (branchId) {
      params.push(branchId);
      clauses.push(`COALESCE(al.branch_id, e.branch_id) = $${params.length}`);
    }
    if (employeeId) {
      params.push(employeeId);
      clauses.push(`al.employee_id = $${params.length}`);
    }

    const result = await db.query(
      `
      SELECT
        al.*,
        e.full_name AS employee_name,
        e.employee_code,
        e.role,
        COALESCE(w.name, '') AS branch_name
      FROM attendance_logs al
      LEFT JOIN employees e ON e.id = al.employee_id
      LEFT JOIN branches w ON w.id = COALESCE(al.branch_id, e.branch_id)
      WHERE ${clauses.join(" AND ")}
      ORDER BY al.attendance_date DESC, al.created_at DESC
      `,
      params
    );

    const summary = result.rows.reduce(
      (acc, row) => {
        acc.present += 1;
        acc.checkedOut += row.check_out_at || row.check_out ? 1 : 0;
        acc.missingCheckout += row.check_out_at || row.check_out ? 0 : 1;
        acc.late += Number(row.late_minutes || 0) > 0 ? 1 : 0;
        acc.totalWorkedMinutes += Number(row.work_minutes || 0);
        return acc;
      },
      {
        present: 0,
        checkedOut: 0,
        missingCheckout: 0,
        late: 0,
        totalWorkedMinutes: 0,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        from,
        to,
        filters: {
          employeeId: employeeId || null,
          branchId: branchId || null,
        },
        summary: {
          ...summary,
          totalWorkedHours: formatMinutes(summary.totalWorkedMinutes),
        },
        monthlyTotals: buildMonthlyTotals(result.rows),
        logs: result.rows.map(normalizeAttendance),
      },
    });
  } catch (error) {
    console.log("ATTENDANCE REPORTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch attendance reports",
      error: error.message,
    });
  }
};

export const getOpeningCandidates = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const includeTestEmployees = ["1", "true", "yes"].includes(String(req.query.include_test || req.query.includeTest || "").toLowerCase());
    const candidates = await fetchOpeningCandidates(db, tenantId, { includeTestEmployees });
    const recommended = candidates.find((candidate) => candidate.is_recommended) || null;
    const latestAssignment = await fetchLatestOpeningAssignment(db, tenantId);

    return res.status(200).json({
      success: true,
      data: {
        candidates,
        recommended,
        latest_assignment: latestAssignment,
        expected_hours: SHIFT_DEFAULTS.expectedHours,
        include_test_employees: includeTestEmployees,
        shift_templates: {
          opening: {
            ...SHIFT_DEFAULTS.opening,
            expected_hours: SHIFT_DEFAULTS.expectedHours,
          },
          regular: {
            ...SHIFT_DEFAULTS.regular,
            expected_hours: SHIFT_DEFAULTS.expectedHours,
          },
        },
      },
      candidates,
      recommended,
      latest_assignment: latestAssignment,
    });
  } catch (error) {
    console.log("OPENING CANDIDATES ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch opening candidates",
      error: error.message,
    });
  }
};

export const getNextOpeningAssignment = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const latestAssignment = await fetchLatestOpeningAssignment(db, tenantId);

    return res.status(200).json({
      success: true,
      data: latestAssignment,
      assignment: latestAssignment,
    });
  } catch (error) {
    console.log("NEXT OPENING ASSIGNMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch next opening assignment",
      error: error.message,
    });
  }
};

export const getOpeningRotationReport = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const includeTestEmployees = ["1", "true", "yes"].includes(String(req.query.include_test || req.query.includeTest || "").toLowerCase());
    const candidates = await fetchOpeningCandidates(db, tenantId, { includeTestEmployees });
    const rows = candidates.map((candidate) => ({
      employee_id: candidate.employee_id,
      employee_name: candidate.full_name,
      employee_code: candidate.employee_code,
      total_openings: candidate.total_openings,
      last_opening_date: candidate.last_opening_at,
      average_worked_hours: candidate.average_worked_hours,
    }));

    return res.status(200).json({
      success: true,
      data: {
        expected_hours: SHIFT_DEFAULTS.expectedHours,
        rows,
      },
      rows,
    });
  } catch (error) {
    console.log("OPENING ROTATION REPORT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch opening rotation report",
      error: error.message,
    });
  }
};

export const getBranchAttendanceQr = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const branchId = Number(req.params.branchId || 0);

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: "Branch is required",
      });
    }

    const result = await db.query(
      `
      SELECT
        id,
        tenant_id,
        name,
        code,
        attendance_qr_token
      FROM branches
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [branchId, tenantId]
    );

    const branch = result.rows[0];
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    const publicAttendanceUrl = buildAttendancePublicUrl(req, branch.attendance_qr_token);
    const { qrSvg, qrDataUrl } = buildQrDataUrl(publicAttendanceUrl);
    if (!qrDataUrl || !qrDataUrl.startsWith("data:image/svg+xml;base64,")) {
      throw new Error("QR data URL generation failed");
    }
    const generatedAt = new Date().toISOString();
    let company = {};
    const companyProfilesTable = await db.query("SELECT to_regclass('public.company_profiles') AS table_name");
    if (companyProfilesTable.rows[0]?.table_name) {
      const companyResult = await db.query(
        `
        SELECT company_name, logo_url
        FROM company_profiles
        WHERE tenant_id = $1
        LIMIT 1
        `,
        [branch.tenant_id]
      );
      company = companyResult.rows[0] || {};
    }

    const branchPayload = {
      id: branch.id,
      name: branch.name || "",
      code: branch.code || "",
      tenant_id: branch.tenant_id,
    };
    const payload = {
      success: true,
      data: {
        branch_id: branch.id,
        branch_name: branch.name || "",
        branch_code: branch.code || "",
        branch: branchPayload,
        company_name: company.company_name || "",
        company_logo_url: company.logo_url || "",
        generated_at: generatedAt,
        generatedAt,
        public_attendance_url: publicAttendanceUrl,
        publicAttendanceUrl,
        publicUrl: publicAttendanceUrl,
        qrSvg,
        qrDataUrl,
        qrImage: qrDataUrl,
        qr_code_data_url: qrDataUrl,
        qrCodeDataUrl: qrDataUrl,
      },
    };
    console.log("[attendance] branch QR payload", {
      branchId: branch.id,
      publicUrl: publicAttendanceUrl,
      hasQrSvg: Boolean(qrSvg),
      qrDataUrlPrefix: qrDataUrl.slice(0, 32),
      qrDataUrlLength: qrDataUrl.length,
    });
    return res.status(200).json(payload);
  } catch (error) {
    console.log("BRANCH ATTENDANCE QR ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate branch attendance QR",
      error: error.message,
    });
  }
};

export const getPublicBranchAttendance = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const token = normalizeLookupValue(req.params.token);

    const result = await db.query(
      `
      SELECT
        id,
        tenant_id,
        name,
        is_active,
        latitude,
        longitude,
        COALESCE(attendance_radius_meters, allowed_radius_meters, 100) AS attendance_radius_meters
      FROM branches
      WHERE attendance_qr_token = $1
      LIMIT 1
      `,
      [token]
    );

    const branch = result.rows[0];
    if (!branch || branch.is_active === false) {
      return res.status(404).json({
        success: false,
        message: "Attendance QR code is invalid or expired",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        branch_name: branch.name || "",
        latitude: branch.latitude === null || branch.latitude === undefined ? null : Number(branch.latitude),
        longitude: branch.longitude === null || branch.longitude === undefined ? null : Number(branch.longitude),
        attendance_radius_meters: Number(branch.attendance_radius_meters || 100),
      },
    });
  } catch (error) {
    console.log("PUBLIC BRANCH ATTENDANCE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load attendance QR",
      error: error.message,
    });
  }
};

export const identifyPublicBranchEmployee = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const token = normalizeLookupValue(req.params.token);
    const identifier = normalizeLookupValue(req.body?.identifier || req.body?.phone || req.body?.employee_code || req.body?.employeeCode);
    const identifierDigits = normalizePhoneDigits(identifier);

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: "Phone number or employee code is required",
      });
    }

    const result = await db.query(
      `
      SELECT
        e.id,
        e.full_name,
        e.employee_code,
        e.phone,
        e.branch_id,
        b.id AS qr_branch_id,
        b.tenant_id,
        b.name AS branch_name
      FROM branches b
      JOIN employees e ON e.tenant_id = b.tenant_id
      WHERE b.attendance_qr_token = $1
        AND b.is_active = TRUE
        AND LOWER(COALESCE(e.status, 'active')) = 'active'
        AND (
          LOWER(COALESCE(e.employee_code, '')) = LOWER($2)
          OR regexp_replace(COALESCE(e.phone, ''), '\\D', '', 'g') = $3
        )
      ORDER BY CASE WHEN e.branch_id = b.id THEN 0 ELSE 1 END, e.id DESC
      LIMIT 1
      `,
      [token, identifier, identifierDigits || "__no_phone_match__"]
    );

    const employee = result.rows[0];
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found for this attendance QR",
      });
    }

    const attendanceDate = getAttendanceDate();
    const { eligibility } = await resolveAttendanceEligibility(db, {
      tenantId: employee.tenant_id,
      employeeId: employee.id,
      branchId: employee.qr_branch_id,
      attendanceDate,
      label: "public-identify",
    });

    return res.status(200).json({
      success: true,
      data: {
        employee_id: employee.id,
        employee_name: employee.full_name || "",
        employee_code: employee.employee_code || "",
        branch_name: employee.branch_name || "",
        attendance_state: eligibility,
      },
    });
  } catch (error) {
    console.log("PUBLIC BRANCH EMPLOYEE IDENTIFY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to identify employee",
      error: error.message,
    });
  }
};

const createPublicAttendanceEvent = async ({ client, req, branch, employee, actionType, latitude, longitude, gpsVerification, attendanceDate, attendanceState }) => {
  let attendanceLog;
  if (actionType === "check_in") {
    if (!attendanceState?.can_check_in) {
      const error = new Error("Employee is already checked in today");
      if (attendanceState?.completed) {
        error.message = "Attendance completed for today";
      }
      error.statusCode = 409;
      error.attendanceState = attendanceState;
      throw error;
    }

    const created = await client.query(
      `
      INSERT INTO attendance_logs (
        tenant_id,
        employee_id,
        branch_id,
        attendance_date,
        check_in,
        check_in_at,
        check_in_latitude,
        check_in_longitude,
        check_in_gps_distance_meters,
        check_in_gps_verification_result,
        attendance_source,
        status,
        work_minutes,
        late_minutes,
        early_leave_minutes,
        overtime_minutes
      )
      VALUES ($1,$2,$3,$4::date,NOW(),NOW(),$5,$6,$7,$8,'branch_qr','checked_in',0,0,0,0)
      RETURNING *
      `,
      [branch.tenant_id, employee.id, branch.id, attendanceDate, latitude, longitude, gpsVerification.distanceMeters, gpsVerification.result]
    );
    attendanceLog = created.rows[0];
  } else {
    if (!attendanceState?.can_check_out || !attendanceState?.attendance?.id) {
      const error = new Error(attendanceState?.completed ? "Attendance completed for today" : "No open check-in found for today");
      error.statusCode = 409;
      error.attendanceState = attendanceState;
      throw error;
    }

    const metrics = calculateAttendanceMetrics({
      attendanceDate,
      checkIn: attendanceState.attendance.check_in,
      checkOut: new Date(),
      shift: {},
    });

    const updated = await client.query(
      `
      UPDATE attendance_logs
      SET
        branch_id = COALESCE(branch_id, $1),
        check_out = NOW(),
        check_out_at = NOW(),
        check_out_latitude = $2,
        check_out_longitude = $3,
        check_out_gps_distance_meters = $4,
        check_out_gps_verification_result = $5,
        attendance_source = 'branch_qr',
        status = 'checked_out',
        work_minutes = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
      `,
      [branch.id, latitude, longitude, gpsVerification.distanceMeters, gpsVerification.result, metrics.work_minutes, attendanceState.attendance.id]
    );
    attendanceLog = updated.rows[0];
  }

  const eventResult = await client.query(
    `
    INSERT INTO attendance_events (
      tenant_id,
      employee_id,
      branch_id,
      attendance_log_id,
      action_type,
      user_agent,
      ip_address,
      latitude,
      longitude,
      gps_distance_meters,
      gps_verification_result,
      source
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'branch_qr')
    RETURNING *
    `,
    [
      branch.tenant_id,
      employee.id,
      branch.id,
      attendanceLog?.id || null,
      actionType,
      String(req.get?.("user-agent") || ""),
      getRequestIp(req),
      latitude,
      longitude,
      gpsVerification.distanceMeters,
      gpsVerification.result,
    ]
  );

  return {
    event: eventResult.rows[0],
    attendanceLog,
  };
};

export const recordPublicBranchAttendance = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureAttendanceSchema();
    await client.query("BEGIN");

    const token = normalizeLookupValue(req.params.token);
    const employeeId = Number(req.body?.employee_id || req.body?.employeeId || 0);
    const actionType = normalizeLookupValue(req.body?.action_type || req.body?.actionType || req.body?.action).toLowerCase();
    const latitude = parseOptionalCoordinate(req.body?.latitude);
    const longitude = parseOptionalCoordinate(req.body?.longitude);

    if (!employeeId) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Employee is required",
      });
    }

    if (!["check_in", "check_out"].includes(actionType)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Action must be check_in or check_out",
      });
    }

    const result = await client.query(
      `
      SELECT
        b.id,
        b.tenant_id,
        b.name,
        b.is_active,
        b.latitude,
        b.longitude,
        COALESCE(b.attendance_radius_meters, b.allowed_radius_meters, 100) AS attendance_radius_meters,
        e.id AS employee_id,
        e.full_name,
        e.employee_code,
        e.status AS employee_status
      FROM branches b
      JOIN employees e ON e.tenant_id = b.tenant_id
      WHERE b.attendance_qr_token = $1
        AND e.id = $2
      LIMIT 1
      `,
      [token, employeeId]
    );

    const row = result.rows[0];
    if (!row || row.is_active === false) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Attendance QR code is invalid or expired",
      });
    }

    if (String(row.employee_status || "active").toLowerCase() !== "active") {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "Employee is not active",
      });
    }

    const attendanceDate = getAttendanceDate();
    await lockEmployeeAttendanceDay(client, row.tenant_id, row.employee_id);
    const { eligibility } = await resolveAttendanceEligibility(client, {
      tenantId: row.tenant_id,
      employeeId: row.employee_id,
      branchId: row.id,
      attendanceDate,
      lock: true,
      label: "public-action-before",
    });

    const gpsVerification = buildGpsVerification({
      latitude,
      longitude,
      branch: row,
    });
    enforceGpsVerification(gpsVerification);

    const { event, attendanceLog } = await createPublicAttendanceEvent({
      client,
      req,
      branch: {
        id: row.id,
        tenant_id: row.tenant_id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        attendance_radius_meters: row.attendance_radius_meters,
      },
      employee: {
        id: row.employee_id,
        full_name: row.full_name,
        employee_code: row.employee_code,
      },
      actionType,
      latitude,
      longitude,
      gpsVerification,
      attendanceDate,
      attendanceState: eligibility,
    });

    const { eligibility: nextEligibility } = await resolveAttendanceEligibility(client, {
      tenantId: row.tenant_id,
      employeeId: row.employee_id,
      branchId: row.id,
      attendanceDate,
      label: "public-action-after",
    });

    await client.query("COMMIT");

    let staffTasks = null;
    if (actionType === "check_in") {
      try {
        staffTasks = await handleBranchQrCheckInStaffTasks({
          tenantId: row.tenant_id,
          branchId: row.id,
          employeeId: row.employee_id,
          actionType,
          attendanceDate: attendanceLog?.attendance_date || new Date(),
        });
      } catch (taskError) {
        console.warn("[attendance] branch QR staff task integration skipped", taskError.message);
        staffTasks = {
          skipped: true,
          error: taskError.message,
        };
      }
    }

    return res.status(201).json({
      success: true,
      action: actionType,
      message: actionType === "check_in" ? "Check in recorded" : "Check out recorded",
      staff_tasks: staffTasks,
      data: {
        event_id: event.id,
        action_type: event.action_type,
        timestamp: event.action_timestamp,
        employee_id: row.employee_id,
        employee_name: row.full_name || "",
        employee_code: row.employee_code || "",
        branch_name: row.name || "",
        attendance_state: nextEligibility,
        gps: {
          verification_result: gpsVerification.result,
          verification_mode: gpsVerification.mode,
          distance_meters: gpsVerification.distanceMeters === null ? null : Math.round(gpsVerification.distanceMeters),
          allowed_radius_meters: gpsVerification.allowedRadiusMeters,
          within_range: gpsVerification.withinRange,
        },
        attendance: normalizeAttendance({
          ...attendanceLog,
          employee_name: row.full_name,
          employee_code: row.employee_code,
          branch_name: row.name,
        }),
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("PUBLIC BRANCH ATTENDANCE RECORD ERROR:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to record attendance",
      error: error.message,
      attendance_state: error.attendanceState,
      gps: error.gps
        ? {
            verification_result: error.gps.result,
            verification_mode: error.gps.mode,
            distance_meters: error.gps.distanceMeters === null ? null : Math.round(error.gps.distanceMeters),
            allowed_radius_meters: error.gps.allowedRadiusMeters,
            within_range: error.gps.withinRange,
          }
        : undefined,
    });
  } finally {
    client.release();
  }
};

export const scanQrAttendance = async (req, res) => {
  const client = await db.connect();

  try {
    await ensureAttendanceSchema();
    await client.query("BEGIN");

    const tenantId = getTenantScope(req);
    const employee = await resolveEmployeeForUser(tenantId, req.user || {});
    if (!employee) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "No employee profile is linked to this account",
      });
    }

    const qrToken = String(req.body?.qrToken || req.body?.qr_token || "").trim();
    const latitude = parseOptionalCoordinate(req.body?.latitude);
    const longitude = parseOptionalCoordinate(req.body?.longitude);

    if (!qrToken) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "QR token is required",
      });
    }

    if (latitude === null || longitude === null) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Valid GPS coordinates are required",
      });
    }

    const branchResult = await client.query(
      `
      SELECT
        id,
        tenant_id,
        name,
        latitude,
        longitude,
        COALESCE(attendance_radius_meters, allowed_radius_meters, 100) AS attendance_radius_meters,
        allowed_radius_meters,
        qr_token,
        status
      FROM branches
      WHERE qr_token = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [qrToken, tenantId]
    );

    const branch = branchResult.rows[0] ? normalizeBranch(branchResult.rows[0]) : null;
    if (!branch) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Branch QR code is invalid or expired",
      });
    }

    if (branch.latitude === null || branch.longitude === null) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "This branch does not have GPS coordinates configured",
      });
    }

    const gpsVerification = buildGpsVerification({ latitude, longitude, branch });
    if (gpsVerification.result === "invalid") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Unable to calculate GPS distance",
      });
    }

    if (GPS_VERIFICATION_MODE === "strict" && gpsVerification.result === "outside_range") {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "You are outside the allowed branch radius",
        distanceMeters: Math.round(gpsVerification.distanceMeters),
        allowedRadiusMeters: gpsVerification.allowedRadiusMeters,
      });
    }

    const effectiveTenantId = branch.tenant_id || employee.tenant_id || tenantId;
    const attendanceDate = getAttendanceDate();
    await lockEmployeeAttendanceDay(client, effectiveTenantId, employee.id);
    const { eligibility } = await resolveAttendanceEligibility(client, {
      tenantId: effectiveTenantId,
      employeeId: employee.id,
      branchId: branch.id,
      attendanceDate,
      lock: true,
      label: "qr-scan-before",
    });
    const nowPayload = {
      tenant_id: effectiveTenantId,
      employee_id: employee.id,
      branch_id: branch.id,
      attendance_date: attendanceDate,
      attendance_source: "qr",
      check_in: new Date(),
      check_in_at: new Date(),
      check_in_latitude: latitude,
      check_in_longitude: longitude,
      check_in_gps_distance_meters: gpsVerification.distanceMeters,
      check_in_gps_verification_result: gpsVerification.result,
      check_out: null,
      check_out_at: null,
      check_out_latitude: null,
      check_out_longitude: null,
      status: "checked_in",
    };

    if (eligibility.can_check_in) {
      const created = await client.query(
        `
        INSERT INTO attendance_logs (
          tenant_id,
          employee_id,
          branch_id,
          attendance_date,
          check_in,
          check_out,
          check_in_at,
          check_out_at,
          check_in_latitude,
          check_in_longitude,
          check_in_gps_distance_meters,
          check_in_gps_verification_result,
          check_out_latitude,
          check_out_longitude,
          attendance_source,
          status,
          work_minutes,
          late_minutes,
          early_leave_minutes,
          overtime_minutes
        )
        VALUES (
          $1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,0,0,0
        )
        RETURNING *
        `,
        [
          nowPayload.tenant_id,
          nowPayload.employee_id,
          nowPayload.branch_id,
          nowPayload.attendance_date,
          nowPayload.check_in,
          nowPayload.check_out,
          nowPayload.check_in_at,
          nowPayload.check_out_at,
          nowPayload.check_in_latitude,
          nowPayload.check_in_longitude,
          nowPayload.check_in_gps_distance_meters,
          nowPayload.check_in_gps_verification_result,
          nowPayload.check_out_latitude,
          nowPayload.check_out_longitude,
          nowPayload.attendance_source,
          nowPayload.status,
        ]
      );

      await client.query("COMMIT");
      return res.status(201).json({
        success: true,
        action: "check_in",
        message: "Check in recorded",
        distanceMeters: Math.round(gpsVerification.distanceMeters),
        allowedRadiusMeters: gpsVerification.allowedRadiusMeters,
        data: normalizeAttendance({
          ...created.rows[0],
          full_name: employee.full_name,
          employee_code: employee.employee_code,
          branch_name: branch.name,
          check_in_at: created.rows[0].check_in_at || created.rows[0].check_in,
          status: "checked_in",
        }),
      });
    }

    if (eligibility.completed) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Attendance already completed for today. Additional scans are rejected after checkout.",
        attendance_state: eligibility,
      });
    }

    if (!eligibility.can_check_out || !eligibility.attendance?.id) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "No open check-in found for today",
        attendance_state: eligibility,
      });
    }

    const todayLog = eligibility.attendance;

    const metrics = calculateAttendanceMetrics({
      attendanceDate: todayLog.attendance_date,
      checkIn: todayLog.check_in_at || todayLog.check_in,
      checkOut: new Date(),
      shift: {},
    });

    const updated = await client.query(
      `
      UPDATE attendance_logs
      SET
        check_out = NOW(),
        check_out_at = NOW(),
        check_out_latitude = $1,
        check_out_longitude = $2,
        check_out_gps_distance_meters = $3,
        check_out_gps_verification_result = $4,
        status = 'checked_out',
        work_minutes = $5,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
      `,
      [latitude, longitude, gpsVerification.distanceMeters, gpsVerification.result, metrics.work_minutes, todayLog.id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      action: "check_out",
      message: "Check out recorded",
      distanceMeters: Math.round(gpsVerification.distanceMeters),
      allowedRadiusMeters: gpsVerification.allowedRadiusMeters,
      data: normalizeAttendance({
        ...updated.rows[0],
        full_name: employee.full_name,
        employee_code: employee.employee_code,
        branch_name: branch.name,
      }),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("[attendance] QR scan error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to record QR attendance",
      error: error.message,
    });
  } finally {
    client.release();
  }
};
