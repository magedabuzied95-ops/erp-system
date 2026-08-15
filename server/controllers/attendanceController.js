import db from "../database/db.js";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { isSuperAdminUser } from "../utils/requestScope.js";
import { calculateAttendanceMetrics, formatMinutes, buildShiftSummaryNotification, buildAttendanceAlertNotification } from "../utils/attendanceCalculator.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { getAttendanceTimeZone } from "../utils/attendanceTimezone.js";
import { haversineDistanceMeters } from "../utils/geoDistance.js";
import { createEmployeePortalSession, ensureStaffTasksSchema, getEmployeePortalSettings, handleBranchQrCheckInStaffTasks } from "../services/staffTasksService.js";
import { ensureShiftResolutionSchema, resolveShiftForCheckIn } from "../services/attendanceShiftResolver.js";
import { listEligibleOpeningEmployees, assignNextOpeningEmployee, getDefaultOpeningWorkDate } from "../services/openingShiftService.js";
import { generateOpeningShiftSchedule } from "../services/shiftScheduleService.js";
import { ensureSalesCommissionSchema } from "../services/salesCommissionService.js";

const expectedSqlParamCount = (text = "") =>
  [...String(text || "").matchAll(/\$(\d+)/g)].reduce((max, match) => Math.max(max, Number(match[1]) || 0), 0);

const normalizeSqlParams = (text, params = []) => {
  if (!Array.isArray(params)) return [];
  const expected = expectedSqlParamCount(text);
  return params.length > expected ? params.slice(0, expected) : params;
};

const safeQuery = async (client, text, params = []) => {
  try {
    return await client.query(text, normalizeSqlParams(text, params));
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

const analyticsDebugEnabled = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.ERP_ANALYTICS_DEBUG || "").toLowerCase());
const DEFAULT_NEW_DEVICE_POLICY = ["block", "pending"].includes(String(process.env.ATTENDANCE_NEW_DEVICE_POLICY || "").toLowerCase())
  ? String(process.env.ATTENDANCE_NEW_DEVICE_POLICY).toLowerCase()
  : "pending";
const ATTENDANCE_RATE_LIMIT_WINDOW_MS = Math.max(Number(process.env.ATTENDANCE_RATE_LIMIT_WINDOW_MS || 60_000), 10_000);
const ATTENDANCE_RATE_LIMIT_MAX = Math.max(Number(process.env.ATTENDANCE_RATE_LIMIT_MAX || 12), 3);

const attendanceRateLimit = new Map();
const normalizeAttendanceMinutes = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
};

const normalizeLookupValue = (value = "") => String(value || "").trim();
const normalizeBranchEntryKey = (value = "") => {
  const text = normalizeLookupValue(value);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return normalizeLookupValue(parts.at(-1) || text);
  } catch {
    const parts = text.split("/").filter(Boolean);
    return normalizeLookupValue(parts.at(-1) || text);
  }
};
const normalizePhoneDigits = (value = "") => String(value || "").replace(/\D/g, "");
const normalizeDeviceToken = (value = "") => String(value || "").trim();
const isValidDeviceToken = (value = "") => /^[A-Za-z0-9_-]{32,256}$/.test(String(value || ""));
const DEVICE_ALREADY_USED_MESSAGE = "This device is already used by another employee today.";

const getRequestIp = (req) => {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "";
};

const normalizeRequestIp = (value = "") => {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  const withoutPort = text.startsWith("[")
    ? text.replace(/^\[|\](?::\d+)?$/g, "")
    : /^\d+\.\d+\.\d+\.\d+:\d+$/.test(text)
      ? text.replace(/:\d+$/g, "")
      : text;
  const normalized = withoutPort.replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return normalized;
  return normalized.split("%")[0];
};

const getAttendanceDeviceFingerprint = (body = {}) =>
  normalizeDeviceToken(body?.device_fingerprint || body?.deviceFingerprint || body?.device_token || body?.deviceToken);

const buildAttendanceDeviceContext = (req, { tenantId, branchId, attendanceDate }) => {
  const deviceFingerprint = getAttendanceDeviceFingerprint(req.body || {});
  const userAgent = String(req.get?.("user-agent") || "");
  const ipAddress = normalizeRequestIp(getRequestIp(req));
  const hashInput = [
    "attendance-device-v1",
    tenantId || "",
    branchId || "",
    attendanceDate || "",
    userAgent,
    ipAddress,
  ].join("|");
  const deviceKey = crypto.createHash("sha256").update(hashInput).digest("hex");

  return {
    deviceFingerprint,
    deviceKey,
    userAgent,
    ipAddress,
  };
};

const buildDeviceAlreadyUsedError = () => {
  const error = new Error(DEVICE_ALREADY_USED_MESSAGE);
  error.statusCode = 409;
  error.code = "DEVICE_ALREADY_USED_TODAY";
  return error;
};

const logAttendanceDeviceBindingDebug = (label, details = {}) => {
  console.info(`[attendance:device-binding:${label}]`, {
    employee_id: details.employeeId ?? null,
    device_fingerprint: details.deviceContext?.deviceFingerprint || null,
    device_key: details.deviceContext?.deviceKey || null,
    business_date: details.attendanceDate || null,
    branch_id: details.branchId ?? null,
    matched_binding_employee_id: details.matchedEmployeeId ?? null,
    blocked: Boolean(details.blocked),
  });
};

const enforceAttendanceDeviceBinding = async (client, { tenantId, branchId, employeeId, attendanceDate, deviceContext }) => {
  if (!tenantId || !branchId || !employeeId || !attendanceDate || !deviceContext?.deviceKey || !deviceContext?.deviceFingerprint) {
    logAttendanceDeviceBindingDebug("skipped", { employeeId, branchId, attendanceDate, deviceContext, blocked: false });
    return null;
  }

  const result = await client.query(
    `
    SELECT *
    FROM attendance_device_bindings
    WHERE tenant_id = $1
      AND branch_id = $2
      AND business_date = $3::date
      AND device_key = $4
      AND employee_id <> $5
    LIMIT 1
    FOR UPDATE
    `,
    [tenantId, branchId, attendanceDate, deviceContext.deviceKey, employeeId]
  );

  const existing = result.rows[0] || null;
  logAttendanceDeviceBindingDebug("lookup", {
    employeeId,
    branchId,
    attendanceDate,
    deviceContext,
    matchedEmployeeId: existing?.employee_id || null,
    blocked: Boolean(existing),
  });
  if (existing) {
    throw buildDeviceAlreadyUsedError();
  }
  return existing;
};

const upsertAttendanceDeviceBinding = async (client, { tenantId, branchId, employeeId, attendanceDate, deviceContext, attendanceLogId = null }) => {
  if (!tenantId || !branchId || !employeeId || !attendanceDate || !deviceContext?.deviceKey || !deviceContext?.deviceFingerprint) {
    logAttendanceDeviceBindingDebug("upsert-skipped", { employeeId, branchId, attendanceDate, deviceContext, blocked: false });
    return null;
  }

  const result = await client.query(
    `
    INSERT INTO attendance_device_bindings (
      tenant_id,
      branch_id,
      employee_id,
      business_date,
      device_key,
      device_fingerprint,
      user_agent,
      ip_address,
      first_attendance_log_id
    )
    VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)
    ON CONFLICT (tenant_id, branch_id, business_date, device_key) DO UPDATE
    SET
      employee_id = CASE
        WHEN attendance_device_bindings.employee_id = EXCLUDED.employee_id THEN EXCLUDED.employee_id
        ELSE attendance_device_bindings.employee_id
      END,
      device_fingerprint = COALESCE(attendance_device_bindings.device_fingerprint, EXCLUDED.device_fingerprint),
      user_agent = COALESCE(NULLIF(EXCLUDED.user_agent, ''), attendance_device_bindings.user_agent),
      ip_address = COALESCE(NULLIF(EXCLUDED.ip_address, ''), attendance_device_bindings.ip_address),
      first_attendance_log_id = COALESCE(attendance_device_bindings.first_attendance_log_id, EXCLUDED.first_attendance_log_id),
      updated_at = NOW()
    RETURNING *
    `,
    [
      tenantId,
      branchId,
      employeeId,
      attendanceDate,
      deviceContext.deviceKey,
      deviceContext.deviceFingerprint || null,
      deviceContext.userAgent || null,
      deviceContext.ipAddress || null,
      attendanceLogId || null,
    ]
  );

  const binding = result.rows[0] || null;
  logAttendanceDeviceBindingDebug("upsert", {
    employeeId,
    branchId,
    attendanceDate,
    deviceContext,
    matchedEmployeeId: binding?.employee_id || null,
    blocked: binding && String(binding.employee_id) !== String(employeeId),
  });
  if (binding && String(binding.employee_id) !== String(employeeId)) {
    throw buildDeviceAlreadyUsedError();
  }
  return binding;
};

const enforceAttendanceRateLimit = (req, keyParts = []) => {
  const now = Date.now();
  const key = [getRequestIp(req), ...keyParts.map((part) => String(part || ""))].join(":");
  const bucket = attendanceRateLimit.get(key) || { count: 0, resetAt: now + ATTENDANCE_RATE_LIMIT_WINDOW_MS };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + ATTENDANCE_RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  attendanceRateLimit.set(key, bucket);
  if (bucket.count <= ATTENDANCE_RATE_LIMIT_MAX) return;

  const error = new Error("Too many attendance attempts. Please wait and try again.");
  error.statusCode = 429;
  throw error;
};

const logSuspiciousAttendanceActivity = async (client, req, { tenantId = null, employeeId = null, branchId = null, deviceToken = "", eventType, severity = "warning", details = {} }) => {
  try {
    await client.query(
      `
      INSERT INTO attendance_suspicious_activity_logs (
        tenant_id,
        employee_id,
        branch_id,
        device_token,
        event_type,
        severity,
        details,
        user_agent,
        ip_address
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
      `,
      [
        tenantId,
        employeeId,
        branchId,
        deviceToken || null,
        eventType,
        severity,
        JSON.stringify(details || {}),
        String(req.get?.("user-agent") || ""),
        getRequestIp(req),
      ]
    );
  } catch (error) {
    console.warn("[attendance] suspicious activity log skipped", error.message);
  }
};

const getNewDevicePolicy = async (client, tenantId) => {
  const result = await safeQuery(
    client,
    `
    SELECT new_device_policy
    FROM attendance_device_settings
    WHERE tenant_id = $1
    LIMIT 1
    `,
    [tenantId]
  );
  const policy = String(result.rows[0]?.new_device_policy || DEFAULT_NEW_DEVICE_POLICY).toLowerCase();
  return policy === "block" ? "block" : "pending";
};

const getAttendanceRequireDeviceApproval = async (client, tenantId) => {
  if (String(process.env.ATTENDANCE_REQUIRE_DEVICE_APPROVAL || "").toLowerCase() === "true") {
    return true;
  }

  const result = await safeQuery(
    client,
    `
    SELECT (
      COALESCE(attendance_require_device_approval, FALSE)
      OR COALESCE(require_device_approval, FALSE)
    ) AS attendance_require_device_approval
    FROM attendance_device_settings
    WHERE tenant_id = $1
    LIMIT 1
    `,
    [tenantId]
  );
  return result.rows[0]?.attendance_require_device_approval === true;
};

const resolveApprovedDevice = async (client, tenantId, employeeId) => {
  const result = await client.query(
    `
    SELECT *
    FROM employee_attendance_devices
    WHERE tenant_id = $1
      AND employee_id = $2
      AND status = 'approved'
    ORDER BY approved_at DESC NULLS LAST, created_at DESC
    LIMIT 1
    `,
    [tenantId, employeeId]
  );
  return result.rows[0] || null;
};

const upsertPassiveAttendanceDevice = async (client, req, { tenantId, employeeId, deviceToken, status = "observed" }) => {
  const userAgent = String(req.get?.("user-agent") || "");
  const ipAddress = normalizeRequestIp(getRequestIp(req));
  const deviceFingerprint = getAttendanceDeviceFingerprint(req.body || {});
  const result = await client.query(
    `
    INSERT INTO employee_attendance_devices (
      tenant_id,
      employee_id,
      device_token,
      device_fingerprint,
      user_agent,
      ip_address,
      status,
      first_seen_at,
      last_seen_at,
      approved_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),CASE WHEN $7 = 'approved' THEN NOW() ELSE NULL END)
    ON CONFLICT (tenant_id, device_token) DO UPDATE
    SET
      employee_id = CASE
        WHEN employee_attendance_devices.employee_id = EXCLUDED.employee_id THEN EXCLUDED.employee_id
        ELSE employee_attendance_devices.employee_id
      END,
      device_fingerprint = COALESCE(NULLIF(EXCLUDED.device_fingerprint, ''), employee_attendance_devices.device_fingerprint),
      user_agent = COALESCE(NULLIF(EXCLUDED.user_agent, ''), employee_attendance_devices.user_agent),
      ip_address = COALESCE(NULLIF(EXCLUDED.ip_address, ''), employee_attendance_devices.ip_address),
      status = CASE
        WHEN employee_attendance_devices.employee_id = EXCLUDED.employee_id
          AND employee_attendance_devices.status IN ('pending', 'rejected', 'reset')
          THEN EXCLUDED.status
        ELSE employee_attendance_devices.status
      END,
      approved_at = CASE
        WHEN employee_attendance_devices.employee_id = EXCLUDED.employee_id
          AND EXCLUDED.status = 'approved'
          THEN COALESCE(employee_attendance_devices.approved_at, NOW())
        ELSE employee_attendance_devices.approved_at
      END,
      reset_at = CASE
        WHEN employee_attendance_devices.employee_id = EXCLUDED.employee_id
          THEN NULL
        ELSE employee_attendance_devices.reset_at
      END,
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    [tenantId, employeeId, deviceToken, deviceFingerprint, userAgent, ipAddress, status]
  );
  return result.rows[0] || null;
};

const validateAttendanceDevice = async ({ client, req, tenantId, employeeId, branchId, deviceToken, gpsVerification, allowRegistration = false }) => {
  if (!isValidDeviceToken(deviceToken)) {
    await logSuspiciousAttendanceActivity(client, req, {
      tenantId,
      employeeId,
      branchId,
      deviceToken,
      eventType: "invalid_device_token",
      severity: "high",
    });
    const error = new Error("Valid device token is required");
    error.statusCode = 400;
    throw error;
  }

  const approvedDevice = await resolveApprovedDevice(client, tenantId, employeeId);
  const requireDeviceApproval = await getAttendanceRequireDeviceApproval(client, tenantId);
  if (!approvedDevice) {
    if (!allowRegistration || gpsVerification?.withinRange !== true) {
      await logSuspiciousAttendanceActivity(client, req, {
        tenantId,
        employeeId,
        branchId,
        deviceToken,
        eventType: "first_device_registration_blocked",
        severity: "high",
        details: { gps: gpsVerification?.result || null },
      });
      const error = new Error("First device registration is allowed only inside the branch GPS radius");
      error.statusCode = 403;
      throw error;
    }

    const device = await upsertPassiveAttendanceDevice(client, req, {
      tenantId,
      employeeId,
      deviceToken,
      status: "approved",
    });
    if (String(device?.employee_id) !== String(employeeId) || device.status !== "approved") {
      await logSuspiciousAttendanceActivity(client, req, {
        tenantId,
        employeeId,
        branchId,
        deviceToken,
        eventType: "device_token_collision",
        severity: "high",
        details: { linked_employee_id: device.employee_id, status: device.status },
      });
      const error = new Error("This device token is already linked to another employee");
      error.statusCode = 403;
      throw error;
    }

    return { device, status: "registered" };
  }

  if (approvedDevice.device_token === deviceToken) {
    const updated = await upsertPassiveAttendanceDevice(client, req, {
      tenantId,
      employeeId,
      deviceToken,
      status: "approved",
    });
    return { device: updated || approvedDevice, status: "matched" };
  }

  if (!requireDeviceApproval) {
    await logSuspiciousAttendanceActivity(client, req, {
      tenantId,
      employeeId,
      branchId,
      deviceToken,
      eventType: "new_device_auto_registered",
      severity: "warning",
      details: { approved_device_id: approvedDevice.id, policy: "approval_disabled" },
    });
    const device = await upsertPassiveAttendanceDevice(client, req, {
      tenantId,
      employeeId,
      deviceToken,
      status: "observed",
    });
    return { device, status: "auto_registered" };
  }

  const policy = await getNewDevicePolicy(client, tenantId);
  await logSuspiciousAttendanceActivity(client, req, {
    tenantId,
    employeeId,
    branchId,
    deviceToken,
    eventType: policy === "pending" ? "new_device_pending" : "new_device_blocked",
    severity: "high",
    details: { approved_device_id: approvedDevice.id, policy },
  });

  if (policy === "pending") {
    await upsertPassiveAttendanceDevice(client, req, {
      tenantId,
      employeeId,
      deviceToken,
      status: "pending",
    });
    const error = new Error("Device approval is required before check-in");
    error.statusCode = 202;
    error.pendingDevice = true;
    throw error;
  }

  const error = new Error("Attendance is allowed only from the linked device");
  error.statusCode = 403;
  throw error;
};

const getAllowedActionFromEligibility = (eligibility = {}) => {
  if (eligibility.completed) return null;
  if (eligibility.can_check_out) return "check_out";
  if (eligibility.can_check_in) return "check_in";
  return null;
};

const inspectAttendanceDeviceApproval = async (client, { tenantId, employeeId, deviceToken, allowedAction }) => {
  if (!allowedAction) {
    return {
      deviceApprovalRequired: false,
      deviceApprovalStatus: "not_required",
      deviceActionBlocked: false,
      deviceApprovalMessage: "",
      device: null,
    };
  }

  const requireDeviceApproval = await getAttendanceRequireDeviceApproval(client, tenantId);
  if (!isValidDeviceToken(deviceToken)) {
    const blocksAction = requireDeviceApproval && allowedAction === "check_in";
    return {
      deviceApprovalRequired: blocksAction,
      deviceApprovalStatus: "invalid_token",
      deviceActionBlocked: blocksAction,
      deviceApprovalMessage: blocksAction ? "Valid device approval is required before check in." : "",
      device: null,
    };
  }

  const approvedDevice = await resolveApprovedDevice(client, tenantId, employeeId);
  if (!approvedDevice) {
    return {
      deviceApprovalRequired: false,
      deviceApprovalStatus: "unregistered",
      deviceActionBlocked: false,
      deviceApprovalMessage: "",
      device: null,
    };
  }

  if (approvedDevice.device_token === deviceToken) {
    return {
      deviceApprovalRequired: false,
      deviceApprovalStatus: "approved",
      deviceActionBlocked: false,
      deviceApprovalMessage: "",
      device: approvedDevice,
    };
  }

  const pendingResult = await safeQuery(
    client,
    `
    SELECT *
    FROM employee_attendance_devices
    WHERE tenant_id = $1
      AND employee_id = $2
      AND device_token = $3
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
    `,
    [tenantId, employeeId, deviceToken]
  );
  const pendingDevice = pendingResult.rows[0] || null;
  const status = String(pendingDevice?.status || (requireDeviceApproval ? "pending" : "approval_not_required")).toLowerCase();

  if (!requireDeviceApproval || allowedAction === "check_out") {
    return {
      deviceApprovalRequired: false,
      deviceApprovalStatus: status,
      deviceActionBlocked: false,
      deviceApprovalMessage: "",
      device: pendingDevice || approvedDevice,
    };
  }

  return {
    deviceApprovalRequired: true,
    deviceApprovalStatus: status === "approved" ? "pending" : status,
    deviceActionBlocked: true,
    deviceApprovalMessage: "Device approval is required before check-in.",
    device: pendingDevice || approvedDevice,
  };
};

const buildPublicQrState = ({ eligibility = {}, deviceApproval = {} }) => {
  const baseAllowedAction = getAllowedActionFromEligibility(eligibility);
  const actionBlocked = Boolean(deviceApproval.deviceActionBlocked);
  const allowedAction = actionBlocked ? null : baseAllowedAction;

  return {
    attendance_state: eligibility,
    allowed_action: allowedAction,
    can_check_in: allowedAction === "check_in",
    can_check_out: allowedAction === "check_out",
    device_approval_required: Boolean(deviceApproval.deviceApprovalRequired),
    device_approval_status: deviceApproval.deviceApprovalStatus || "unknown",
    device_action_blocked: actionBlocked,
    device_approval_message: deviceApproval.deviceApprovalMessage || "",
  };
};

const logPublicQrDecision = (label, { employee = {}, deviceContext = {}, deviceApproval = {}, eligibility = {}, allowedAction = null }) => {
  console.info(`[attendance:${label}] decision`, {
    employee_id: employee.id || employee.employee_id || null,
    employee_code: employee.employee_code || null,
    device_key: deviceContext.deviceKey || null,
    device_approval_status: deviceApproval.deviceApprovalStatus || null,
    device_approval_required: Boolean(deviceApproval.deviceApprovalRequired),
    attendance_state: {
      status: eligibility.status || null,
      can_check_in: Boolean(eligibility.can_check_in),
      can_check_out: Boolean(eligibility.can_check_out),
      completed: Boolean(eligibility.completed),
    },
    allowed_action: allowedAction,
  });
};

const buildPublicOrigin = (req) => {
  const envOrigin = String(
    process.env.PUBLIC_APP_URL ||
      process.env.VITE_PUBLIC_APP_URL ||
      process.env.FRONTEND_URL ||
      process.env.PUBLIC_FRONTEND_URL ||
      process.env.VITE_PUBLIC_FRONTEND_URL ||
      process.env.CLIENT_URL ||
      process.env.APP_URL ||
      ""
  ).trim().replace(/\/$/, "");
  if (envOrigin) return envOrigin;

  if (process.env.NODE_ENV === "development") {
    const requestOrigin = String(req.get?.("origin") || "").trim().replace(/\/$/, "");
    if (requestOrigin) return requestOrigin;
    return "http://localhost:5173";
  }

  return "";
};

const buildAttendancePublicUrl = (req, branchKey) => `${buildPublicOrigin(req)}/a/${encodeURIComponent(branchKey)}`;
const buildLegacyAttendancePublicUrl = (req, token) => `${buildPublicOrigin(req)}/attendance/branch/${encodeURIComponent(token)}`;
const buildEmployeePortalUrl = (req, token) => `${buildPublicOrigin(req)}/employee/portal/${encodeURIComponent(token)}`;

const resolvePublicAttendanceBranch = async (clientOrPool, branchKey, { tenantId = null, includeEmployeeId = null } = {}) => {
  const key = normalizeBranchEntryKey(branchKey);
  const numericKey = /^\d+$/.test(key) ? Number(key) : null;
  if (!key) return null;

  const result = await clientOrPool.query(
    `
    SELECT
      b.id,
      b.tenant_id,
      b.name,
      b.code,
      b.is_active,
      b.latitude,
      b.longitude,
      COALESCE(b.attendance_radius_meters, b.allowed_radius_meters, 100) AS attendance_radius_meters,
      b.allowed_radius_meters,
      b.attendance_public_code,
      b.attendance_qr_token,
      b.qr_token,
      e.id AS employee_id,
      e.full_name,
      e.employee_code,
      e.status AS employee_status
    FROM branches b
    LEFT JOIN employees e
      ON e.tenant_id = b.tenant_id
     AND ($4::bigint IS NOT NULL AND e.id = $4::bigint)
     AND COALESCE(e.is_deleted, FALSE) = FALSE
    WHERE (
        ($2::bigint IS NOT NULL AND b.id = $2::bigint)
        OR LOWER(COALESCE(b.attendance_public_code, '')) = LOWER($1)
        OR b.attendance_qr_token = $1
        OR b.qr_token = $1
      )
      AND ($3::bigint IS NULL OR b.tenant_id = $3::bigint)
    ORDER BY
      CASE
        WHEN $2::bigint IS NOT NULL AND b.id = $2::bigint THEN 0
        WHEN LOWER(COALESCE(b.attendance_public_code, '')) = LOWER($1) THEN 1
        WHEN b.attendance_qr_token = $1 THEN 2
        WHEN b.qr_token = $1 THEN 3
        ELSE 4
      END,
      b.id ASC
    LIMIT 1
    `,
    [key, numericKey, tenantId, includeEmployeeId]
  );

  return result.rows[0] || null;
};

const getRequestAttendanceDate = (req) =>
  normalizeAttendanceDate(
    req.body?.business_date ||
      req.body?.businessDate ||
      req.body?.attendance_date ||
      req.body?.attendanceDate ||
      req.query?.business_date ||
      req.query?.businessDate ||
      req.query?.attendance_date ||
      req.query?.attendanceDate ||
      req.query?.date
  ) ||
  getAttendanceDate();

const createEmployeePortalResponse = async ({ clientOrPool = db, req, tenantId, branchId = null, employeeId, attendanceLogId = null }) => {
  const portalSettings = await getEmployeePortalSettings(tenantId, clientOrPool);
  const portalSession = await createEmployeePortalSession({
    tenantId,
    branchId,
    employeeId,
    attendanceLogId,
  }, clientOrPool);

  if (!portalSession?.token) {
    throw new Error("Failed to create employee portal session");
  }

  const url = buildEmployeePortalUrl(req, portalSession.token);
  return {
    portal_url: url,
    employee_portal: {
      token: portalSession.token,
      expires_at: portalSession.expires_at,
      url,
      auto_redirect: portalSettings?.auto_redirect_after_checkin !== false,
      require_checkin_to_view_tasks: portalSettings?.require_checkin_to_view_tasks !== false,
    },
  };
};

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
      timeZone: getAttendanceTimeZone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch (error) {
    console.warn("[attendance] timezone date fallback used", {
      timezone: getAttendanceTimeZone(),
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

const attendanceHasCheckout = (row = {}) => Boolean(row.check_out || row.check_out_at);
const normalizeAttendanceStatus = (row = {}) => {
  if (attendanceHasCheckout(row)) return "checked_out";
  const status = String(row.status || "").toLowerCase();
  return status && status !== "checked_out" && status !== "completed" ? status : "checked_in";
};

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
    timezone: getAttendanceTimeZone(),
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
      AND ($4::bigint IS NULL OR branch_id = $4::bigint)
    ORDER BY
      CASE WHEN check_out IS NULL AND check_out_at IS NULL THEN 0 ELSE 1 END,
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
  user_id: row.user_id || null,
  branch_id: row.branch_id || null,
  branch_name: row.branch_name || "",
  employee_code: row.employee_code || "",
  full_name: row.full_name || "",
  photo_url: row.photo_url || "",
  phone: row.phone || "",
  email: row.email || "",
  national_id: row.national_id || "",
  role: row.role || "",
  job_title: row.job_title || "",
  position: row.position || "",
  salary: Number(row.salary || 0),
  daily_work_hours: Number(row.daily_work_hours || 8),
  working_days_per_month: Number(row.working_days_per_month || 26),
  working_days_per_week: Number(row.working_days_per_week || 6),
  work_start_time: row.work_start_time || "",
  work_end_time: row.work_end_time || "",
  absence_deduction_enabled: row.absence_deduction_enabled !== false,
  missing_hours_deduction_enabled: row.missing_hours_deduction_enabled !== false,
  late_deduction_enabled: row.late_deduction_enabled !== false,
  early_leave_deduction_enabled: row.early_leave_deduction_enabled !== false,
  hire_date: row.hire_date || null,
  status: row.status || "active",
  can_open_branch: row.can_open_branch !== false,
  pos_alias: row.pos_alias || "",
  is_sales_active: row.is_sales_active === true,
  active_for_pos: row.is_sales_active === true,
  profile_configured: row.sales_profile_configured === true,
  commission_type: row.commission_type || "none",
  fixed_commission_mode: row.fixed_commission_mode || "fixed_per_item",
  commission_mode: row.commission_type === "fixed" ? (row.fixed_commission_mode || "fixed_per_item") : (row.commission_type || "none"),
  commission_value: Number(row.commission_value || 0),
  is_deleted: Boolean(row.is_deleted),
  manager_portal_enabled: Boolean(row.manager_portal_enabled),
  manager_portal_token: row.manager_portal_token || "",
  deleted_at: row.deleted_at || null,
  deleted_by_user_id: row.deleted_by_user_id || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  current_shift: row.shift_id
    ? {
        id: row.shift_id,
        shift_name: row.shift_name || "",
        start_time: row.start_time || "",
        end_time: row.end_time || "",
        check_in_window_start: row.check_in_window_start || "",
        check_in_window_end: row.check_in_window_end || "",
        allowed_late_minutes: Number(row.allowed_late_minutes || 0),
        overtime_after_minutes: Number(row.overtime_after_minutes || 0),
        working_days: parseJson(row.working_days, []),
      }
    : null,
  attendance_device: {
    id: row.device_id || null,
    status: row.device_status || (row.device_id ? "approved" : "none"),
    user_agent: row.device_user_agent || "",
    first_seen_at: row.device_first_seen_at || null,
    last_seen_at: row.device_last_seen_at || null,
    pending_count: Number(row.pending_device_count || 0),
  },
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
        status: normalizeAttendanceStatus(row),
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
  selected_shift_id: row.selected_shift_id || row.shift_id || null,
  resolved_shift_start_time: row.resolved_shift_start_time || row.start_time || "",
  resolved_shift_end_time: row.resolved_shift_end_time || row.end_time || "",
  shift_resolution_status: row.shift_resolution_status || "",
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
  status: normalizeAttendanceStatus(row),
  attendance_status: Number(row.late_minutes || 0) > 0 ? "late" : "on_time",
  work_minutes: Number(row.work_minutes || 0),
  late_minutes: Number(row.late_minutes || 0),
  early_leave_minutes: Number(row.early_leave_minutes || 0),
  overtime_minutes: Number(row.overtime_minutes || 0),
  notes: row.notes || "",
  created_at: row.created_at || null,
});

const findLatestShift = async (client, employeeId, tenantId, shiftId = null) => {
  await ensureShiftResolutionSchema(client);
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
    ORDER BY start_time ASC, created_at DESC
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
      AND COALESCE(e.is_deleted, FALSE) = FALSE
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

const recordAttendanceAuditLog = async (req, { action, entityType = "attendance", entityId = null, details = {} } = {}) => {
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
      INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, details, ip_address, user_agent, created_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,NULLIF($7, '')::inet,$8,NOW())
      `,
      [
        getTenantScope(req),
        getUserId(req),
        String(action || "attendance.action").slice(0, 120),
        String(entityType || "attendance").slice(0, 120),
        entityId || null,
        JSON.stringify(details || {}),
        getRequestIp(req),
        String(req.headers?.["user-agent"] || "").slice(0, 500),
      ]
    );
  } catch (error) {
    console.warn("[attendance-center] audit log skipped", error?.message || error);
  }
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
  job_title: row.job_title || "",
  position: row.position || "",
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
  if (options.branchId || options.workDate) {
    const rows = await listEligibleOpeningEmployees(client, {
      tenantId,
      branchId: options.branchId || null,
      workDate: options.workDate || getDefaultOpeningWorkDate(),
      includeAllBranches: options.includeAllBranches,
    });
    return rows.map((row) => ({
      ...normalizeOpeningCandidate(
        {
          ...row,
          last_opening_at: row.last_opening_date || null,
          employee_status: row.status || "active",
        },
        rows.find((candidate) => candidate.is_recommended)?.id || null
      ),
      is_test_like: isTestLikeEmployee(row),
      can_open_branch: row.can_open_branch !== false,
      is_branch_eligible: row.is_branch_eligible !== false,
      target_work_date: options.workDate || getDefaultOpeningWorkDate(),
    }));
  }

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
      AND COALESCE(e.is_deleted, FALSE) = FALSE
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
      AND COALESCE(e.is_deleted, FALSE) = FALSE
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
    await ensureSalesCommissionSchema();
    const tenantId = getTenantScope(req);
    const attendanceDate = getRequestAttendanceDate(req);
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
        al.notes,
        ad.id AS device_id,
        ad.status AS device_status,
        ad.user_agent AS device_user_agent,
        ad.first_seen_at AS device_first_seen_at,
        ad.last_seen_at AS device_last_seen_at,
        COALESCE(pd.pending_device_count, 0) AS pending_device_count
        , esp.employee_id IS NOT NULL AS sales_profile_configured
        , COALESCE(esp.pos_alias, '') AS pos_alias
        , COALESCE(esp.is_sales_active, FALSE) AS is_sales_active
        , COALESCE(esp.commission_type, 'none') AS commission_type
        , COALESCE(esp.fixed_commission_mode, 'fixed_per_item') AS fixed_commission_mode
        , COALESCE(esp.commission_value, 0) AS commission_value
      FROM employees e
    LEFT JOIN branches w ON w.id = e.branch_id
      LEFT JOIN employee_sales_profiles esp ON esp.employee_id = e.id
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
      LEFT JOIN LATERAL (
        SELECT *
        FROM employee_attendance_devices ad
        WHERE ad.employee_id = e.id
          AND ad.status = 'approved'
          AND ($1::bigint IS NULL OR ad.tenant_id = $1::bigint)
        ORDER BY ad.approved_at DESC NULLS LAST, ad.created_at DESC
        LIMIT 1
      ) ad ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS pending_device_count
        FROM employee_attendance_devices pd
        WHERE pd.employee_id = e.id
          AND pd.status = 'pending'
          AND ($1::bigint IS NULL OR pd.tenant_id = $1::bigint)
      ) pd ON TRUE
      WHERE ${tenantPredicate}
      AND COALESCE(e.is_deleted, FALSE) = FALSE
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
      photo_url,
      phone,
      email,
      national_id,
      role,
      job_title,
      jobTitle,
      position,
      salary,
      daily_work_hours = 8,
      working_days_per_month = 26,
      working_days_per_week = 6,
      work_start_time = null,
      work_end_time = null,
      absence_deduction_enabled = true,
      missing_hours_deduction_enabled = true,
      late_deduction_enabled = true,
      early_leave_deduction_enabled = true,
      hire_date,
      status,
      can_open_branch = true,
      manager_portal_enabled = false,
    } = req.body || {};

    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({
        success: false,
        message: "Employee full name is required",
      });
    }

    const code = String(employee_code || `EMP-${Date.now()}`).trim();
    const resolvedJobTitle = String(job_title ?? jobTitle ?? position ?? "").trim();
    const resolvedPosition = String(position ?? job_title ?? jobTitle ?? "").trim();
    const created = await db.query(
      `
      INSERT INTO employees (
        tenant_id,
        branch_id,
        employee_code,
        full_name,
        photo_url,
        phone,
        email,
        national_id,
        role,
        job_title,
        position,
        salary,
        daily_work_hours,
        working_days_per_month,
        working_days_per_week,
        work_start_time,
        work_end_time,
        absence_deduction_enabled,
        missing_hours_deduction_enabled,
        late_deduction_enabled,
        early_leave_deduction_enabled,
        hire_date,
        status,
        can_open_branch,
        manager_portal_enabled
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      RETURNING *
      `,
      [
        tenantId,
        branch_id || null,
        code,
        String(full_name).trim(),
        String(photo_url || "").trim(),
        phone || "",
        email || "",
        national_id || "",
        role || "",
        resolvedJobTitle,
        resolvedPosition,
        Number(salary || 0),
        Number(daily_work_hours || 8),
        Number(working_days_per_month || 26),
        Number(working_days_per_week || 6),
        work_start_time || null,
        work_end_time || null,
        absence_deduction_enabled !== false,
        missing_hours_deduction_enabled !== false,
        late_deduction_enabled !== false,
        early_leave_deduction_enabled !== false,
        hire_date || new Date().toISOString().slice(0, 10),
        status || "active",
        can_open_branch !== false,
        Boolean(manager_portal_enabled),
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
      photo_url,
      phone,
      email,
      national_id,
      role,
      job_title,
      jobTitle,
      position,
      salary,
      daily_work_hours = 8,
      working_days_per_month = 26,
      working_days_per_week = 6,
      work_start_time = null,
      work_end_time = null,
      absence_deduction_enabled = true,
      missing_hours_deduction_enabled = true,
      late_deduction_enabled = true,
      early_leave_deduction_enabled = true,
      hire_date,
      status,
      can_open_branch = true,
      manager_portal_enabled = false,
    } = req.body || {};

    const resolvedJobTitle = String(job_title ?? jobTitle ?? position ?? "").trim();
    const resolvedPosition = String(position ?? job_title ?? jobTitle ?? "").trim();
    const updated = await db.query(
      `
      UPDATE employees
      SET
        branch_id = $1,
        employee_code = $2,
        full_name = $3,
        photo_url = $4,
        phone = $5,
        email = $6,
        national_id = $7,
        role = $8,
        job_title = $9,
        position = $10,
        salary = $11,
        daily_work_hours = $12,
        working_days_per_month = $13,
        working_days_per_week = $14,
        work_start_time = $15,
        work_end_time = $16,
        absence_deduction_enabled = $17,
        missing_hours_deduction_enabled = $18,
        late_deduction_enabled = $19,
        early_leave_deduction_enabled = $20,
        hire_date = $21,
        status = $22,
        can_open_branch = $23,
        manager_portal_enabled = $24,
        updated_at = NOW()
      WHERE id = $25
        AND ($26::bigint IS NULL OR tenant_id = $26::bigint)
        AND COALESCE(is_deleted, FALSE) = FALSE
      RETURNING *
      `,
      [
        branch_id || null,
        employee_code || `EMP-${id}`,
        String(full_name || "").trim(),
        String(photo_url || "").trim(),
        phone || "",
        email || "",
        national_id || "",
        role || "",
        resolvedJobTitle,
        resolvedPosition,
        Number(salary || 0),
        Number(daily_work_hours || 8),
        Number(working_days_per_month || 26),
        Number(working_days_per_week || 6),
        work_start_time || null,
        work_end_time || null,
        absence_deduction_enabled !== false,
        missing_hours_deduction_enabled !== false,
        late_deduction_enabled !== false,
        early_leave_deduction_enabled !== false,
        hire_date || new Date().toISOString().slice(0, 10),
        status || "active",
        can_open_branch !== false,
        Boolean(manager_portal_enabled),
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

const isAdminLikeRole = (value = "") => ["admin", "super_admin", "superadmin", "super admin", "platform_admin"].includes(String(value || "").trim().toLowerCase());

const resolveEmployeeLinkedUser = async (client, tenantId, employee = {}) => {
  const result = await safeQuery(
    client,
    `
    SELECT u.*, r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE ($1::bigint IS NULL OR u.tenant_id = $1::bigint)
      AND (
        u.id = $2
        OR LOWER(COALESCE(u.email, '')) = LOWER(COALESCE($3, ''))
        OR LOWER(COALESCE(u.name, '')) = LOWER(COALESCE($4, ''))
      )
    ORDER BY CASE WHEN u.id = $2 THEN 0 ELSE 1 END, u.id DESC
    LIMIT 1
    `,
    [tenantId, employee.user_id || 0, employee.email || "", employee.full_name || ""]
  );
  return result.rows[0] || null;
};

const countActiveAdminUsers = async (client, tenantId) => {
  const result = await safeQuery(
    client,
    `
    SELECT COUNT(*)::int AS count
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE ($1::bigint IS NULL OR u.tenant_id = $1::bigint)
      AND COALESCE(u.is_active, TRUE) = TRUE
      AND (
        COALESCE(u.is_super_admin, FALSE) = TRUE
        OR LOWER(COALESCE(u.role, '')) IN ('admin', 'super_admin', 'superadmin', 'super admin', 'platform_admin')
        OR LOWER(COALESCE(r.name, '')) IN ('admin', 'super_admin', 'superadmin', 'super admin', 'platform_admin')
      )
    `,
    [tenantId]
  );
  return Number(result.rows[0]?.count || 0);
};

export const deleteEmployee = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureAttendanceSchema();
    await client.query("BEGIN");

    const tenantId = getTenantScope(req);
    const employeeId = Number(req.params.id || 0);
    const actorUserId = getUserId(req);

    if (!employeeId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ success: false, message: "Employee is required" });
    }

    const employeeResult = await client.query(
      `
      SELECT *
      FROM employees
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        AND COALESCE(is_deleted, FALSE) = FALSE
      FOR UPDATE
      `,
      [employeeId, tenantId]
    );
    const employee = employeeResult.rows[0] || null;

    if (!employee) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const linkedUser = await resolveEmployeeLinkedUser(client, tenantId, employee);
    const isCurrentUser =
      actorUserId &&
      (String(linkedUser?.id || "") === String(actorUserId) ||
        String(employee.user_id || "") === String(actorUserId) ||
        String(req.user?.employee_id || "") === String(employee.id));

    if (isCurrentUser) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        code: "CANNOT_DELETE_CURRENT_USER",
        message: "You cannot delete the employee linked to your current user.",
      });
    }

    const linkedUserIsAdmin =
      linkedUser &&
      (linkedUser.is_super_admin === true || isAdminLikeRole(linkedUser.role) || isAdminLikeRole(linkedUser.role_name));
    if (linkedUserIsAdmin) {
      const activeAdminCount = await countActiveAdminUsers(client, tenantId);
      if (activeAdminCount <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          code: "CANNOT_DELETE_LAST_ADMIN",
          message: "You cannot delete the last active admin user.",
        });
      }
    }

    const updated = await client.query(
      `
      UPDATE employees
      SET
        status = 'deleted',
        is_deleted = TRUE,
        deleted_at = NOW(),
        deleted_by_user_id = $3,
        updated_at = NOW()
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      RETURNING *
      `,
      [employeeId, tenantId, actorUserId || null]
    );

    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      message: "Employee deleted",
      data: normalizeEmployee(updated.rows[0]),
      employee: normalizeEmployee(updated.rows[0]),
      soft_deleted: true,
      historical_relations_preserved: true,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("DELETE EMPLOYEE ERROR:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete employee",
      error: error.message,
    });
  } finally {
    client.release();
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
      check_in_window_start = null,
      check_in_window_end = null,
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
        check_in_window_start,
        check_in_window_end,
        allowed_late_minutes,
        overtime_after_minutes,
        working_days
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      RETURNING *
      `,
      [
        tenantId,
        id,
        String(shift_name).trim(),
        start_time,
        end_time,
        check_in_window_start || start_time,
        check_in_window_end || null,
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
      check_in_window_start = null,
      check_in_window_end = null,
      working_days = [],
    } = req.body || {};

    const updated = await db.query(
      `
      UPDATE employee_shifts
      SET
        shift_name = $1,
        start_time = $2,
        end_time = $3,
        check_in_window_start = $4,
        check_in_window_end = $5,
        allowed_late_minutes = $6,
        overtime_after_minutes = $7,
        working_days = $8::jsonb,
        updated_at = NOW()
      WHERE id = $9
        AND ($10::bigint IS NULL OR tenant_id = $10::bigint)
      RETURNING *
      `,
      [
        shift_name || "",
        start_time || "09:00",
        end_time || "17:00",
        check_in_window_start || start_time || "09:00",
        check_in_window_end || null,
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
    const attendanceDate = getRequestAttendanceDate(req);

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

    const checkInAt = new Date();
    const shiftResolution = await resolveShiftForCheckIn({
      clientOrPool: client,
      tenantId,
      employeeId,
      checkInAt,
      requestedShiftId: shiftId,
      timeZone: req.body?.timezone || req.body?.time_zone || getAttendanceTimeZone(),
    });
    const shift = shiftResolution.shift || await findLatestShift(client, employeeId, tenantId, shiftId);

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
        check_in_at,
        attendance_source,
        work_minutes,
        late_minutes,
        early_leave_minutes,
        overtime_minutes,
        selected_shift_id,
        resolved_shift_start_time,
        resolved_shift_end_time,
        shift_resolution_status,
        notes
      )
      VALUES (
        $1,$2,$3,$4,$5::date,$6,$6,$7,0,$8,0,0,$9,$10,$11,$12,$13
      )
      RETURNING *
      `,
      [
        tenantId,
        employeeId,
        shift?.id || null,
        attendanceBranchId,
        attendanceDate,
        checkInAt,
        attendanceSource || "manual",
        normalizeAttendanceMinutes(shiftResolution.lateMinutes),
        shift?.id || null,
        shiftResolution.resolvedStartTime,
        shiftResolution.resolvedEndTime,
        shiftResolution.status,
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
    const portalResponse = await createEmployeePortalResponse({
      clientOrPool: client,
      req,
      tenantId,
      branchId: attendanceBranchId,
      employeeId,
      attendanceLogId: created.rows[0]?.id || null,
    });

    await client.query("COMMIT");

    let staffTasks = null;
    if (attendanceBranchId) {
      try {
        staffTasks = await handleBranchQrCheckInStaffTasks({
          tenantId,
          branchId: attendanceBranchId,
          employeeId,
          actionType: "check_in",
          attendanceDate,
          attendanceEventId: null,
        });
      } catch (taskError) {
        console.warn("[attendance] manual check-in staff task integration skipped", taskError.message);
      }
    }

    return res.status(201).json({
      success: true,
      portal_url: portalResponse.portal_url,
      employee_portal: portalResponse.employee_portal,
      data: normalizeAttendance(responseRow),
      attendance: normalizeAttendance(responseRow),
      staff_tasks: staffTasks,
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
    const attendanceDate = getRequestAttendanceDate(req);

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
    // check_in is written from a JS Date, so the checkout has to come from the
    // same clock. Persisting NOW() instead put the two ends of one shift on the
    // database clock and the application clock, and the stored duration then
    // disagreed with the stored timestamps whenever the two differ.
    const checkOutAt = new Date();
    const metrics = calculateAttendanceMetrics({
      attendanceDate: attendanceRow.attendance_date,
      checkIn: attendanceRow.check_in_time || attendanceRow.check_in,
      checkOut: checkOutAt,
      shift: shift ? { ...shift, start_time: shiftStartTime } : { start_time: shiftStartTime },
      timeZone: getAttendanceTimeZone(),
    });

    const updated = await client.query(
      `
      UPDATE attendance_logs
      SET
        check_out = $10,
        check_out_at = $10,
        status = 'checked_out',
        work_minutes = $1,
        late_minutes = $2,
        early_leave_minutes = $3,
        overtime_minutes = $4,
        next_opening_employee_id = $8,
        closed_by_user_id = $9,
        closed_at = $10,
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
        normalizeAttendanceMinutes(metrics.work_minutes),
        normalizeAttendanceMinutes(metrics.late_minutes),
        normalizeAttendanceMinutes(metrics.early_leave_minutes),
        normalizeAttendanceMinutes(metrics.overtime_minutes),
        notes || "",
        attendanceRow.id,
        tenantId,
        nextOpeningEmployeeId,
        getUserId(req),
        checkOutAt,
      ]
    );

    if (updated.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Open attendance not found for tenant",
      });
    }

    if (normalizeAttendanceMinutes(metrics.overtime_minutes) > 0) {
      await client.query(
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
        VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)
        ON CONFLICT (attendance_log_id) WHERE attendance_log_id IS NOT NULL DO UPDATE
        SET
          overtime_minutes = EXCLUDED.overtime_minutes,
          status = CASE
            WHEN attendance_overtime_approvals.status = 'approved' THEN attendance_overtime_approvals.status
            ELSE 'pending'
          END,
          requested_by_user_id = EXCLUDED.requested_by_user_id,
          notes = EXCLUDED.notes,
          updated_at = NOW()
        `,
        [
          tenantId,
          attendanceRow.employee_id,
          attendanceRow.branch_id || employee?.branch_id || null,
          updated.rows[0].id,
          attendanceRow.attendance_date,
          normalizeAttendanceMinutes(metrics.overtime_minutes),
          getUserId(req),
          "Auto-created from attendance checkout overtime",
        ]
      );
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
      const openingResult = await assignNextOpeningEmployee(client, {
        tenantId,
        branchId: attendanceRow.branch_id || employee?.branch_id || null,
        employeeId: nextOpeningEmployeeId,
        workDate: req.body?.next_opening_work_date || req.body?.nextOpeningWorkDate || getDefaultOpeningWorkDate(),
        assignedByUserId: getUserId(req),
        attendanceLogId: updated.rows[0].id,
        source: "attendance_checkout",
        note: req.body?.next_opening_note || req.body?.note || "Assigned during attendance checkout",
      });

      openingAssignment = normalizeOpeningAssignment({
        ...openingResult.assignment,
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
        e.job_title,
        e.position,
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
        COALESCE(w.name, 'No branch assigned') AS branch_name,
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
  const earlyCheckoutLogs = logs.filter((row) => Number(row.early_leave_minutes || 0) > 0);
  const outsideGpsLogs = logs.filter((row) =>
    String(row.check_in_gps_verification_result || "").toLowerCase() === "outside_range" ||
    String(row.check_out_gps_verification_result || "").toLowerCase() === "outside_range"
  );
  const totalWorkedMinutes = logs.reduce((sum, row) => sum + Number(row.work_minutes || 0), 0);

  return {
    totalEmployees: Number(employeesCount || 0),
    presentNow: logs.length,
    checkedOut: checkedOut.length,
    missingCheckout: openLogs.length,
    lateEmployees: lateLogs.length,
    earlyCheckoutToday: earlyCheckoutLogs.length,
    outsideGpsToday: outsideGpsLogs.length,
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
        e.job_title,
        e.position,
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
        e.job_title,
        e.position,
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
        acc.totalLateMinutes += Number(row.late_minutes || 0);
        acc.totalEarlyLeaveMinutes += Number(row.early_leave_minutes || 0);
        acc.totalRawOvertimeMinutes += Number(row.overtime_minutes || 0);
        return acc;
      },
      {
        present: 0,
        checkedOut: 0,
        missingCheckout: 0,
        late: 0,
        totalWorkedMinutes: 0,
        totalLateMinutes: 0,
        totalEarlyLeaveMinutes: 0,
        totalRawOvertimeMinutes: 0,
      }
    );

    const scheduleParams = [tenantId, from, to];
    const scheduleClauses = ["($1::bigint IS NULL OR ess.tenant_id = $1::bigint)", "ess.work_date BETWEEN $2::date AND $3::date"];
    if (branchId) {
      scheduleParams.push(branchId);
      scheduleClauses.push(`ess.branch_id::text = $${scheduleParams.length}::text`);
    }
    if (employeeId) {
      scheduleParams.push(employeeId);
      scheduleClauses.push(`ess.employee_id::text = $${scheduleParams.length}::text`);
    }
    const scheduleResult = await db.query(
      `
      SELECT
        ess.*,
        e.full_name AS employee_name,
        e.employee_code,
        b.name AS branch_name
      FROM employee_shift_schedules ess
      LEFT JOIN employees e ON e.id = ess.employee_id
      LEFT JOIN branches b ON b.id = ess.branch_id
      WHERE ${scheduleClauses.join(" AND ")}
      ORDER BY ess.work_date DESC, ess.start_time ASC
      `,
      scheduleParams
    );

    const overtimeParams = [tenantId, from, to];
    const overtimeClauses = ["($1::bigint IS NULL OR aoa.tenant_id = $1::bigint)", "aoa.attendance_date BETWEEN $2::date AND $3::date"];
    if (branchId) {
      overtimeParams.push(branchId);
      overtimeClauses.push(`aoa.branch_id::text = $${overtimeParams.length}::text`);
    }
    if (employeeId) {
      overtimeParams.push(employeeId);
      overtimeClauses.push(`aoa.employee_id::text = $${overtimeParams.length}::text`);
    }
    const overtimeResult = await db.query(
      `
      SELECT
        aoa.*,
        e.full_name AS employee_name,
        e.employee_code,
        b.name AS branch_name
      FROM attendance_overtime_approvals aoa
      LEFT JOIN employees e ON e.id = aoa.employee_id
      LEFT JOIN branches b ON b.id = aoa.branch_id
      WHERE ${overtimeClauses.join(" AND ")}
      ORDER BY aoa.attendance_date DESC, aoa.created_at DESC
      `,
      overtimeParams
    );

    const openingParams = [tenantId, from, to];
    const openingClauses = ["($1::bigint IS NULL OR soa.tenant_id = $1::bigint)", "soa.work_date BETWEEN $2::date AND $3::date"];
    if (branchId) {
      openingParams.push(branchId);
      openingClauses.push(`soa.branch_id::text = $${openingParams.length}::text`);
    }
    if (employeeId) {
      openingParams.push(employeeId);
      openingClauses.push(`soa.employee_id::text = $${openingParams.length}::text`);
    }
    const openingResult = await db.query(
      `
      SELECT
        soa.*,
        e.full_name AS employee_name,
        e.employee_code,
        b.name AS branch_name,
        u.name AS assigned_by_name
      FROM shift_opening_assignments soa
      LEFT JOIN employees e ON e.id = soa.employee_id
      LEFT JOIN branches b ON b.id = soa.branch_id
      LEFT JOIN users u ON u.id = soa.assigned_by_user_id
      WHERE ${openingClauses.join(" AND ")}
      ORDER BY soa.work_date DESC, soa.assigned_at DESC
      `,
      openingParams
    );

    const dateKey = (value) => centerDateKey(value);
    const scheduleByEmployeeDate = new Map(
      scheduleResult.rows.map((row) => [`${row.employee_id}:${dateKey(row.work_date)}`, row])
    );
    const overtimeByLogId = new Map(
      overtimeResult.rows.filter((row) => row.attendance_log_id).map((row) => [String(row.attendance_log_id), row])
    );
    const overtimeByEmployeeDate = new Map(
      overtimeResult.rows.map((row) => [`${row.employee_id}:${dateKey(row.attendance_date)}`, row])
    );

    const overtimeSummary = overtimeResult.rows.reduce(
      (acc, row) => {
        const status = String(row.status || "pending").toLowerCase();
        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;
        acc.totalMinutes += Number(row.overtime_minutes || 0);
        if (status === "approved") acc.approvedMinutes += Number(row.overtime_minutes || 0);
        if (status === "pending") acc.pendingMinutes += Number(row.overtime_minutes || 0);
        if (status === "rejected") acc.rejectedMinutes += Number(row.overtime_minutes || 0);
        return acc;
      },
      { total: 0, pending: 0, approved: 0, rejected: 0, totalMinutes: 0, approvedMinutes: 0, pendingMinutes: 0, rejectedMinutes: 0 }
    );

    const normalizedLogs = result.rows.map((row) => {
      const normalized = normalizeAttendance(row);
      const key = `${row.employee_id}:${dateKey(row.attendance_date)}`;
      const schedule = scheduleByEmployeeDate.get(key) || null;
      const overtime = overtimeByLogId.get(String(row.id)) || overtimeByEmployeeDate.get(key) || null;
      return {
        ...normalized,
        scheduled_shift: schedule
          ? {
              id: schedule.id,
              shift_type: schedule.shift_type,
              shift_name: schedule.shift_name,
              work_date: schedule.work_date,
              start_time: schedule.start_time,
              end_time: schedule.end_time,
              expected_hours: Number(schedule.expected_hours || 0),
              source: schedule.source,
              status: schedule.status,
            }
          : null,
        overtime_approval: overtime
          ? {
              id: overtime.id,
              status: overtime.status,
              overtime_minutes: Number(overtime.overtime_minutes || 0),
              approved_at: overtime.approved_at || null,
              payroll_applied: Boolean(overtime.payroll_applied),
              notes: overtime.notes || "",
            }
          : null,
      };
    });

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
          totalLateHours: formatMinutes(summary.totalLateMinutes),
          totalEarlyLeaveHours: formatMinutes(summary.totalEarlyLeaveMinutes),
          totalRawOvertimeHours: formatMinutes(summary.totalRawOvertimeMinutes),
          schedules: scheduleResult.rowCount,
          openingAssignments: openingResult.rowCount,
          overtimeApprovals: overtimeSummary,
        },
        monthlyTotals: buildMonthlyTotals(result.rows),
        logs: normalizedLogs,
        schedules: scheduleResult.rows.map((row) => ({
          id: row.id,
          employee_id: row.employee_id,
          employee_name: row.employee_name || "",
          employee_code: row.employee_code || "",
          branch_id: row.branch_id || null,
          branch_name: row.branch_name || "",
          work_date: row.work_date,
          shift_type: row.shift_type,
          shift_name: row.shift_name,
          start_time: row.start_time,
          end_time: row.end_time,
          expected_hours: Number(row.expected_hours || 0),
          source: row.source,
          status: row.status,
        })),
        openingAssignments: openingResult.rows.map((row) => ({
          id: row.id,
          employee_id: row.employee_id,
          employee_name: row.employee_name || "",
          employee_code: row.employee_code || "",
          branch_id: row.branch_id || null,
          branch_name: row.branch_name || "",
          work_date: row.work_date,
          source: row.source,
          assigned_at: row.assigned_at,
          assigned_by_name: row.assigned_by_name || "",
          override_reason: row.override_reason || "",
          note: row.note || "",
        })),
        overtimeApprovals: overtimeResult.rows.map((row) => ({
          id: row.id,
          employee_id: row.employee_id,
          employee_name: row.employee_name || "",
          employee_code: row.employee_code || "",
          branch_id: row.branch_id || null,
          branch_name: row.branch_name || "",
          attendance_log_id: row.attendance_log_id || null,
          attendance_date: row.attendance_date,
          overtime_minutes: Number(row.overtime_minutes || 0),
          status: row.status,
          approved_at: row.approved_at || null,
          payroll_applied: Boolean(row.payroll_applied),
          notes: row.notes || "",
        })),
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

const centerPad = (value) => String(value).padStart(2, "0");

// `date` columns come back from pg as local midnight, so their calendar day is
// the process-local one. Reading that back through `toISOString()` files every
// attendance row under the previous day whenever the process runs east of
// Greenwich, which hides the record from the day it was actually saved for.
const centerDateKey = (value) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) return value.trim().slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return `${date.getFullYear()}-${centerPad(date.getMonth() + 1)}-${centerPad(date.getDate())}`;
};

const centerEachDate = (start, end) => {
  const startDate = new Date(`${centerDateKey(start)}T00:00:00Z`);
  const endDate = new Date(`${centerDateKey(end)}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) return [];
  const rows = [];
  for (let cursor = new Date(startDate); cursor <= endDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    rows.push(cursor.toISOString().slice(0, 10));
  }
  return rows;
};

const centerNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const centerWeekdayCodes = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const centerWorkingDayCodes = (workingDays) => {
  let source = workingDays;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      source = source.split(",");
    }
  }
  return new Set((Array.isArray(source) ? source : []).map((day) => String(day || "").trim().toLowerCase().slice(0, 3)).filter(Boolean));
};

const centerIsExpectedWeekday = (dateValue, workingDays = [], workingDaysPerWeek = 6) => {
  const date = new Date(`${centerDateKey(dateValue)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const configuredDays = centerWorkingDayCodes(workingDays);
  if (configuredDays.size) return configuredDays.has(centerWeekdayCodes[date.getUTCDay()]);
  return date.getUTCDay() < Math.max(1, Math.min(7, Math.round(centerNumber(workingDaysPerWeek, 6))));
};

const centerBuildFilters = (req) => {
  const today = getAttendanceDate();
  const startDate = centerDateKey(req.query.startDate || req.query.start_date || req.query.from || req.query.date || today);
  const endDate = centerDateKey(req.query.endDate || req.query.end_date || req.query.to || req.query.date || startDate);
  return {
    tenantId: getTenantScope(req),
    startDate,
    endDate,
    branchId: String(req.query.branchId || req.query.branch_id || "").trim(),
    employeeId: String(req.query.employeeId || req.query.employee_id || "").trim(),
    status: String(req.query.status || "").trim().toLowerCase(),
    source: String(req.query.source || req.query.attendance_source || "").trim().toLowerCase(),
    search: String(req.query.search || "").trim().toLowerCase(),
    lateOnly: ["1", "true", "yes"].includes(String(req.query.lateOnly || req.query.late_only || "").toLowerCase()),
    missingOnly: ["1", "true", "yes"].includes(String(req.query.missingOnly || req.query.missing_hours_only || "").toLowerCase()),
    payrollAffectedOnly: ["1", "true", "yes"].includes(String(req.query.payrollAffectedOnly || req.query.payroll_affected_only || "").toLowerCase()),
  };
};

const centerMonthStart = (dateValue) => {
  const date = new Date(`${centerDateKey(dateValue)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return centerDateKey(dateValue);
  date.setUTCDate(1);
  return date.toISOString().slice(0, 10);
};

const centerSourceLabel = (value = "") => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "qr") return "QR";
  if (normalized === "qr_branch" || normalized === "branch_qr") return "QR Branch";
  if (normalized === "imported" || normalized === "import") return "Imported";
  return normalized ? "Manual" : "";
};

const loadAttendanceCenterRows = async (filters = {}, { qrOnly = false, includeGenerated = true } = {}) => {
  const dates = centerEachDate(filters.startDate, filters.endDate).slice(0, 62);
  const employeeParams = [filters.tenantId];
  const employeeWhere = [
    "($1::bigint IS NULL OR e.tenant_id = $1::bigint)",
    "COALESCE(e.is_deleted, FALSE) = FALSE",
    "LOWER(COALESCE(e.status, 'active')) = 'active'",
  ];
  if (filters.branchId) {
    employeeParams.push(filters.branchId);
    employeeWhere.push(`e.branch_id::text = $${employeeParams.length}::text`);
  }
  if (filters.employeeId) {
    employeeParams.push(filters.employeeId);
    employeeWhere.push(`e.id::text = $${employeeParams.length}::text`);
  }
  if (filters.search) {
    employeeParams.push(`%${filters.search}%`);
    employeeWhere.push(`(LOWER(COALESCE(e.full_name, '')) LIKE $${employeeParams.length} OR LOWER(COALESCE(e.employee_code, '')) LIKE $${employeeParams.length})`);
  }

  const employeeResult = await db.query(
    `
    SELECT e.id, e.tenant_id, e.branch_id, e.full_name, e.employee_code,
      COALESCE(e.salary, 0)::numeric AS salary,
      COALESCE(e.daily_work_hours, 8)::numeric AS daily_work_hours,
      COALESCE(e.working_days_per_month, 26)::int AS working_days_per_month,
      COALESCE(e.working_days_per_week, 6)::int AS working_days_per_week,
      COALESCE(active_shift.working_days, '[]'::jsonb) AS working_days,
      b.name AS branch_name
    FROM employees e
    LEFT JOIN branches b ON b.id = e.branch_id
    LEFT JOIN LATERAL (
      SELECT es.working_days
      FROM employee_shifts es
      WHERE es.employee_id = e.id
        AND (e.tenant_id IS NULL OR es.tenant_id = e.tenant_id OR es.tenant_id IS NULL)
      ORDER BY es.updated_at DESC NULLS LAST, es.created_at DESC NULLS LAST, es.id DESC
      LIMIT 1
    ) active_shift ON TRUE
    WHERE ${employeeWhere.join(" AND ")}
    ORDER BY b.name NULLS LAST, e.full_name
    LIMIT 500
    `,
    employeeParams
  );
  const employees = employeeResult.rows;

  const logParams = [filters.tenantId, filters.startDate, filters.endDate];
  const logWhere = ["($1::bigint IS NULL OR al.tenant_id = $1::bigint)", "al.attendance_date BETWEEN $2::date AND $3::date"];
  if (filters.branchId) {
    logParams.push(filters.branchId);
    logWhere.push(`COALESCE(al.branch_id, e.branch_id)::text = $${logParams.length}::text`);
  }
  if (filters.employeeId) {
    logParams.push(filters.employeeId);
    logWhere.push(`al.employee_id::text = $${logParams.length}::text`);
  }
  if (qrOnly) {
    logParams.push(["qr", "qr_branch", "branch_qr"]);
    logWhere.push(`LOWER(COALESCE(al.attendance_source, '')) = ANY($${logParams.length}::text[])`);
  } else if (filters.source) {
    logParams.push(filters.source === "qr_branch" ? ["qr_branch", "branch_qr"] : [filters.source]);
    logWhere.push(`LOWER(COALESCE(al.attendance_source, '')) = ANY($${logParams.length}::text[])`);
  }

  const logResult = await db.query(
    `
    SELECT al.employee_id, COALESCE(al.branch_id, e.branch_id) AS branch_id, al.attendance_date,
      MIN(COALESCE(al.check_in_at, al.check_in)) AS check_in_time,
      MAX(COALESCE(al.check_out_at, al.check_out)) AS check_out_time,
      MAX(CASE
        -- A closed shift is defined by its own two timestamps. Taking the
        -- GREATEST of those and the stored columns let a stale work_minutes
        -- survive every later correction, so an edited day kept reporting the
        -- hours it had before the edit.
        WHEN COALESCE(al.check_in_at, al.check_in) IS NOT NULL AND COALESCE(al.check_out_at, al.check_out) IS NOT NULL
          THEN GREATEST(EXTRACT(EPOCH FROM (COALESCE(al.check_out_at, al.check_out) - COALESCE(al.check_in_at, al.check_in))) / 60, 0)
        ELSE GREATEST(COALESCE(al.work_minutes, 0), COALESCE(al.worked_hours, 0) * 60)
      END)::numeric AS worked_minutes,
      MAX(COALESCE(al.late_minutes, 0))::numeric AS late_minutes,
      MAX(COALESCE(al.early_leave_minutes, 0))::numeric AS early_leave_minutes,
      MAX(COALESCE(al.overtime_minutes, 0))::numeric AS overtime_minutes,
      STRING_AGG(DISTINCT COALESCE(NULLIF(al.attendance_source, ''), 'manual'), ', ') AS attendance_source,
      STRING_AGG(NULLIF(al.notes, ''), '; ') AS notes,
      COUNT(*)::int AS records_count,
      b.name AS branch_name
    FROM attendance_logs al
    LEFT JOIN employees e ON e.id = al.employee_id
    LEFT JOIN branches b ON b.id = COALESCE(al.branch_id, e.branch_id)
    WHERE ${logWhere.join(" AND ")}
    GROUP BY al.employee_id, COALESCE(al.branch_id, e.branch_id), al.attendance_date, b.name
    `,
    logParams
  );
  // The unique index allows one row per branch per day, so an employee who moved
  // between branches has several rows for the same date. Keying by employee+date
  // alone made the last branch silently replace the others.
  const logsByKey = new Map();
  logResult.rows.forEach((row) => {
    const key = `${row.employee_id}:${centerDateKey(row.attendance_date)}`;
    const existing = logsByKey.get(key);
    if (!existing) {
      logsByKey.set(key, row);
      return;
    }
    const earliest = (a, b) => (!a ? b : !b ? a : (new Date(a) <= new Date(b) ? a : b));
    const latest = (a, b) => (!a ? b : !b ? a : (new Date(a) >= new Date(b) ? a : b));
    const joinText = (a, b) => [a, b].map((item) => String(item || "").trim()).filter(Boolean).join("; ");
    logsByKey.set(key, {
      ...existing,
      check_in_time: earliest(existing.check_in_time, row.check_in_time),
      check_out_time: latest(existing.check_out_time, row.check_out_time),
      worked_minutes: centerNumber(existing.worked_minutes) + centerNumber(row.worked_minutes),
      late_minutes: Math.max(centerNumber(existing.late_minutes), centerNumber(row.late_minutes)),
      early_leave_minutes: Math.max(centerNumber(existing.early_leave_minutes), centerNumber(row.early_leave_minutes)),
      overtime_minutes: centerNumber(existing.overtime_minutes) + centerNumber(row.overtime_minutes),
      attendance_source: joinText(existing.attendance_source, row.attendance_source),
      notes: joinText(existing.notes, row.notes),
      records_count: centerNumber(existing.records_count) + centerNumber(row.records_count),
    });
  });

  const leaveResult = await db.query(
    `
    SELECT 'leave' AS record_type, id, employee_id, leave_type, NULL::text AS vacation_type,
      COALESCE(leave_date, start_date) AS start_date,
      COALESCE(leave_date, end_date, start_date) AS end_date,
      status, notes
    FROM employee_leaves
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND COALESCE(leave_date, start_date) <= $3::date
      AND COALESCE(leave_date, end_date, start_date) >= $2::date
    UNION ALL
    SELECT 'vacation' AS record_type, id, employee_id, NULL::text AS leave_type, vacation_type,
      COALESCE(vacation_date, start_date) AS start_date,
      COALESCE(vacation_date, end_date, start_date) AS end_date,
      status, notes
    FROM employee_vacations
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
      AND COALESCE(vacation_date, start_date) <= $3::date
      AND COALESCE(vacation_date, end_date, start_date) >= $2::date
    `,
    [filters.tenantId, filters.startDate, filters.endDate]
  );
  const approvedLeaveDates = new Map();
  leaveResult.rows
    .filter((row) => String(row.status || "").toLowerCase() === "approved")
    .forEach((row) => {
      centerEachDate(row.start_date, row.end_date).forEach((item) => approvedLeaveDates.set(`${row.employee_id}:${item}`, row));
    });

  const holidayResult = await db.query(
    `
    SELECT holiday_date, name
    FROM holidays
    WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
      AND holiday_date BETWEEN $2::date AND $3::date
    `,
    [filters.tenantId, filters.startDate, filters.endDate]
  );
  const holidays = new Map(holidayResult.rows.map((row) => [centerDateKey(row.holiday_date), row]));

  const expectedDatesByEmployee = new Map();
  employees.forEach((employee) => {
    const candidates = dates.filter((date) =>
      centerIsExpectedWeekday(date, employee.working_days, employee.working_days_per_week) &&
      !approvedLeaveDates.has(`${employee.id}:${date}`) &&
      !holidays.has(date)
    );
    expectedDatesByEmployee.set(String(employee.id), new Set(candidates.slice(0, Math.min(centerNumber(employee.working_days_per_month, 26), candidates.length))));
  });

  const rows = [];
  employees.forEach((employee) => {
    dates.forEach((date) => {
      const log = logsByKey.get(`${employee.id}:${date}`);
      if (!includeGenerated && !log) return;
      const leave = approvedLeaveDates.get(`${employee.id}:${date}`);
      const holiday = holidays.get(date);
      const weeklyExpected = centerIsExpectedWeekday(date, employee.working_days, employee.working_days_per_week);
      const expectedDate = expectedDatesByEmployee.get(String(employee.id))?.has(date);
      const workedMinutes = centerNumber(log?.worked_minutes);
      const dailyMinutes = Math.round(centerNumber(employee.daily_work_hours, 8) * 60);
      const missingMinutes = log && expectedDate ? Math.max(0, dailyMinutes - workedMinutes) : 0;
      const lateMinutes = centerNumber(log?.late_minutes);
      const earlyLeaveMinutes = centerNumber(log?.early_leave_minutes);
      let status = "present";
      if (log) {
        if (lateMinutes > 0) status = "late";
        else if (missingMinutes > 0) status = "missing_hours";
        else if (earlyLeaveMinutes > 0) status = "early_leave";
      } else if (leave) status = "on_leave";
      else if (holiday) status = "holiday";
      else if (!weeklyExpected) status = "weekly_off";
      else if (!expectedDate) status = "monthly_off";
      else status = "absent";

      const dailyRate = centerNumber(employee.salary) / Math.max(1, centerNumber(employee.working_days_per_month, 26));
      const hourlyRate = dailyRate / Math.max(0.1, centerNumber(employee.daily_work_hours, 8));
      const payrollImpact = status === "absent" ? dailyRate : (status === "missing_hours" ? (missingMinutes / 60) * hourlyRate : 0);
      rows.push({
        employee_id: employee.id,
        employee_name: employee.full_name,
        employee_code: employee.employee_code,
        branch_id: log?.branch_id || employee.branch_id,
        branch_name: log?.branch_name || employee.branch_name || "",
        attendance_date: date,
        check_in_time: log?.check_in_time || null,
        check_out_time: log?.check_out_time || null,
        worked_hours: Number((workedMinutes / 60).toFixed(2)),
        status,
        late_minutes: lateMinutes,
        missing_hours: Number((missingMinutes / 60).toFixed(2)),
        overtime_hours: Number((centerNumber(log?.overtime_minutes) / 60).toFixed(2)),
        attendance_source: log?.attendance_source || "",
        source_label: centerSourceLabel(log?.attendance_source),
        payroll_impact: Number(payrollImpact.toFixed(2)),
        notes: log?.notes || leave?.notes || holiday?.name || "",
        records_count: centerNumber(log?.records_count),
        daily_rate: Number(dailyRate.toFixed(2)),
        hourly_rate: Number(hourlyRate.toFixed(2)),
        expected_working_day: Boolean(expectedDate),
        leave_type: leave ? (leave.leave_type || leave.vacation_type || "paid") : "",
      });
    });
  });

  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false;
    if (filters.lateOnly && row.late_minutes <= 0) return false;
    if (filters.missingOnly && row.missing_hours <= 0) return false;
    if (filters.payrollAffectedOnly && row.payroll_impact <= 0) return false;
    return true;
  });
};

const summarizeAttendanceCenter = (rows = []) => {
  const presentRows = rows.filter((row) => row.check_in_time);
  const expectedRows = rows.filter((row) => row.expected_working_day);
  const qrRows = rows.filter((row) => ["qr", "qr_branch", "branch_qr"].some((source) => String(row.attendance_source || "").toLowerCase().includes(source)));
  const workedTotal = presentRows.reduce((sum, row) => sum + centerNumber(row.worked_hours), 0);
  return {
    present_today: presentRows.length,
    absent_today: rows.filter((row) => row.status === "absent").length,
    late_employees: rows.filter((row) => row.status === "late").length,
    missing_hours: Number(rows.reduce((sum, row) => sum + centerNumber(row.missing_hours), 0).toFixed(2)),
    average_work_hours: Number((presentRows.length ? workedTotal / presentRows.length : 0).toFixed(2)),
    attendance_rate: Number((expectedRows.length ? (presentRows.length / expectedRows.length) * 100 : 0).toFixed(2)),
    qr_checkins_today: qrRows.length,
    qr_checkouts_today: qrRows.filter((row) => row.check_out_time).length,
  };
};

const loadLeavePayrollImpact = async (filters) => {
  const settingsResult = await db.query(
    `
    SELECT COALESCE(monthly_paid_leave_days, 3)::int AS monthly_paid_leave_days
    FROM hr_attendance_settings
    WHERE ($1::bigint IS NOT NULL AND tenant_id = $1::bigint)
    LIMIT 1
    `,
    [filters.tenantId]
  );
  const paidAllowance = Math.max(0, centerNumber(settingsResult.rows[0]?.monthly_paid_leave_days, 3));
  const fromMonthStart = centerMonthStart(filters.startDate);
  const params = [filters.tenantId, fromMonthStart, filters.endDate];
  const where = [
    "($1::bigint IS NULL OR e.tenant_id = $1::bigint)",
    "ld.leave_day BETWEEN $2::date AND $3::date",
  ];
  if (filters.branchId) {
    params.push(filters.branchId);
    where.push(`e.branch_id::text = $${params.length}::text`);
  }
  if (filters.employeeId) {
    params.push(filters.employeeId);
    where.push(`e.id::text = $${params.length}::text`);
  }

  const result = await db.query(
    `
    WITH leave_days AS (
      SELECT l.employee_id,
        generate_series(COALESCE(l.leave_date, l.start_date), COALESCE(l.leave_date, l.end_date, l.start_date), interval '1 day')::date AS leave_day,
        COALESCE(l.leave_type, 'paid') AS leave_kind,
        l.status
      FROM employee_leaves l
      WHERE ($1::bigint IS NULL OR l.tenant_id = $1::bigint)
        AND COALESCE(l.leave_date, l.start_date) <= $3::date
        AND COALESCE(l.leave_date, l.end_date, l.start_date) >= $2::date
      UNION ALL
      SELECT v.employee_id,
        generate_series(COALESCE(v.vacation_date, v.start_date), COALESCE(v.vacation_date, v.end_date, v.start_date), interval '1 day')::date AS leave_day,
        COALESCE(v.vacation_type, 'annual') AS leave_kind,
        v.status
      FROM employee_vacations v
      WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint)
        AND COALESCE(v.vacation_date, v.start_date) <= $3::date
        AND COALESCE(v.vacation_date, v.end_date, v.start_date) >= $2::date
    )
    SELECT ld.employee_id, e.full_name AS employee_name, e.branch_id, ld.leave_day, ld.leave_kind,
      COALESCE(e.salary, 0)::numeric AS salary,
      COALESCE(e.working_days_per_month, 26)::int AS working_days_per_month
    FROM leave_days ld
    JOIN employees e ON e.id = ld.employee_id
    WHERE ${where.join(" AND ")}
      AND LOWER(COALESCE(ld.status, 'pending')) = 'approved'
      AND LOWER(COALESCE(ld.leave_kind, 'paid')) NOT IN ('unpaid', 'no_pay', 'deducted', 'غير مدفوعة', 'بدون راتب')
    ORDER BY ld.employee_id, ld.leave_day
    `,
    params
  );

  const runningByEmployeeMonth = new Map();
  const impactByEmployee = new Map();
  result.rows.forEach((row) => {
    const leaveDate = centerDateKey(row.leave_day);
    const monthKey = `${row.employee_id}:${leaveDate.slice(0, 7)}`;
    const usedAfter = (runningByEmployeeMonth.get(monthKey) || 0) + 1;
    runningByEmployeeMonth.set(monthKey, usedAfter);
    if (leaveDate < filters.startDate || leaveDate > filters.endDate) return;

    const employeeKey = String(row.employee_id);
    const dailyRate = centerNumber(row.salary) / Math.max(1, centerNumber(row.working_days_per_month, 26));
    const bucket = impactByEmployee.get(employeeKey) || {
      employee_id: row.employee_id,
      leave_days: 0,
      paid_leave_days: 0,
      deducted_leave_days: 0,
      leave_deduction: 0,
      monthly_paid_leave_days: paidAllowance,
    };
    bucket.leave_days += 1;
    if (usedAfter <= paidAllowance) {
      bucket.paid_leave_days += 1;
    } else {
      bucket.deducted_leave_days += 1;
      bucket.leave_deduction += dailyRate;
    }
    impactByEmployee.set(employeeKey, bucket);
  });

  return impactByEmployee;
};

const loadApprovedOvertimePayrollImpact = async (filters) => {
  const params = [filters.tenantId, filters.startDate, filters.endDate];
  const where = [
    "($1::bigint IS NULL OR e.tenant_id = $1::bigint)",
    "a.attendance_date BETWEEN $2::date AND $3::date",
    "LOWER(COALESCE(a.status, 'pending')) = 'approved'",
  ];
  if (filters.branchId) {
    params.push(filters.branchId);
    where.push(`COALESCE(a.branch_id, e.branch_id)::text = $${params.length}::text`);
  }
  if (filters.employeeId) {
    params.push(filters.employeeId);
    where.push(`e.id::text = $${params.length}::text`);
  }

  const result = await db.query(
    `
    SELECT
      a.employee_id,
      SUM(COALESCE(a.overtime_minutes, 0))::numeric AS overtime_minutes,
      MAX(COALESCE(e.salary, 0))::numeric AS salary,
      MAX(COALESCE(e.working_days_per_month, 26))::numeric AS working_days_per_month,
      MAX(COALESCE(e.daily_work_hours, 8))::numeric AS daily_work_hours
    FROM attendance_overtime_approvals a
    JOIN employees e ON e.id = a.employee_id
    WHERE ${where.join(" AND ")}
    GROUP BY a.employee_id
    `,
    params
  );

  return new Map(result.rows.map((row) => {
    const dailyRate = centerNumber(row.salary) / Math.max(1, centerNumber(row.working_days_per_month, 26));
    const hourlyRate = dailyRate / Math.max(0.1, centerNumber(row.daily_work_hours, 8));
    const minutes = centerNumber(row.overtime_minutes);
    return [String(row.employee_id), {
      employee_id: row.employee_id,
      approved_overtime_minutes: minutes,
      approved_overtime_hours: Number((minutes / 60).toFixed(2)),
      approved_overtime_pay: Number(((minutes / 60) * hourlyRate).toFixed(2)),
    }];
  }));
};

export const getAttendanceDashboard = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const rows = await loadAttendanceCenterRows(filters);
    const schedules = await loadAttendanceSchedules(filters);
    const trendMap = new Map();
    const branchMap = new Map();
    const employeeMap = new Map();
    rows.forEach((row) => {
      const trend = trendMap.get(row.attendance_date) || { date: row.attendance_date, present: 0, absent: 0, late: 0, missing_hours: 0 };
      if (row.check_in_time) trend.present += 1;
      if (row.status === "absent") trend.absent += 1;
      if (row.status === "late") trend.late += 1;
      trend.missing_hours += centerNumber(row.missing_hours);
      trendMap.set(row.attendance_date, trend);

      const branchKey = row.branch_id || "none";
      const branch = branchMap.get(branchKey) || { branch_id: row.branch_id, branch_name: row.branch_name || "No branch assigned", present: 0, absent: 0, late: 0 };
      if (row.check_in_time) branch.present += 1;
      if (row.status === "absent") branch.absent += 1;
      if (row.status === "late") branch.late += 1;
      branchMap.set(branchKey, branch);

      const employee = employeeMap.get(row.employee_id) || { employee_id: row.employee_id, employee_name: row.employee_name, present: 0, absent: 0, missing_hours: 0 };
      if (row.check_in_time) employee.present += 1;
      if (row.status === "absent") employee.absent += 1;
      employee.missing_hours += centerNumber(row.missing_hours);
      employeeMap.set(row.employee_id, employee);
    });
    const summary = summarizeAttendanceCenter(rows);
    if (analyticsDebugEnabled()) console.info("[attendance-center]", {
      endpoint: "dashboard",
      filters: { branch_id: filters.branchId, employee_id: filters.employeeId, start_date: filters.startDate, end_date: filters.endDate },
      rows: rows.length,
      attendance_trend_points: trendMap.size,
      branch_rows: branchMap.size,
      employee_ranking_rows: employeeMap.size,
      totals: summary,
    });
    return res.json({
      success: true,
      summary,
      trends: {
        attendance: [...trendMap.values()],
        late_arrivals: [...trendMap.values()].map((row) => ({ date: row.date, late: row.late })),
      },
      branches: [...branchMap.values()],
      employee_ranking: [...employeeMap.values()].sort((a, b) => b.present - a.present).slice(0, 10),
      schedules: {
        opening_today: schedules.find((row) => row.shift_type === "opening" && String(row.work_date).slice(0, 10) === filters.endDate) || null,
        opening_upcoming: schedules.filter((row) => row.shift_type === "opening").slice(0, 5),
        rows: schedules,
      },
    });
  } catch (error) {
    console.error("[attendance-center] dashboard error", error);
    return res.status(500).json({ success: false, message: "Failed to load attendance dashboard", error: error.message });
  }
};

const loadAttendanceSchedules = async (filters) => {
  const params = [filters.tenantId, filters.startDate, filters.endDate];
  const where = [
    "($1::bigint IS NULL OR s.tenant_id = $1::bigint)",
    "s.work_date BETWEEN $2::date AND $3::date",
  ];
  if (filters.branchId) {
    params.push(filters.branchId);
    where.push(`s.branch_id::text = $${params.length}::text`);
  }
  if (filters.employeeId) {
    params.push(filters.employeeId);
    where.push(`s.employee_id::text = $${params.length}::text`);
  }
  const result = await db.query(
    `
    SELECT
      s.id,
      s.tenant_id,
      s.employee_id,
      e.full_name AS employee_name,
      e.employee_code,
      s.branch_id,
      b.name AS branch_name,
      s.work_date::text AS work_date,
      s.shift_type,
      s.shift_name,
      s.start_time::text AS start_time,
      s.end_time::text AS end_time,
      s.expected_hours,
      s.source,
      s.status,
      soa.assigned_by_user_id,
      COALESCE(u.name, u.email, '') AS assigned_by_name,
      soa.assigned_at,
      soa.note AS assignment_note,
      soa.cash_drawer_shift_id
    FROM employee_shift_schedules s
    LEFT JOIN employees e ON e.id = s.employee_id
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN shift_opening_assignments soa ON soa.id = s.source_assignment_id
    LEFT JOIN users u ON u.id = soa.assigned_by_user_id
    WHERE ${where.join(" AND ")}
      AND LOWER(COALESCE(s.status, 'scheduled')) <> 'cancelled'
    ORDER BY s.work_date ASC, s.start_time ASC, s.shift_type ASC, e.full_name ASC
    `,
    params
  );
  return result.rows.map((row) => ({
    ...row,
    expected_hours: Number(row.expected_hours || 0),
  }));
};

export const getAttendanceSchedules = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const rows = await loadAttendanceSchedules(filters);
    return res.json({
      success: true,
      rows,
      schedules: rows,
      summary: {
        total: rows.length,
        opening: rows.filter((row) => row.shift_type === "opening").length,
        regular: rows.filter((row) => row.shift_type !== "opening").length,
      },
    });
  } catch (error) {
    console.error("[attendance-center] schedules error", error);
    return res.status(500).json({ success: false, message: "Failed to load attendance schedules", error: error.message });
  }
};

export const generateAttendanceOpeningSchedule = async (req, res) => {
  try {
    const tenantId = getTenantScope(req);
    const startDate = centerDateKey(req.body?.start_date || req.body?.startDate || req.query?.startDate || req.query?.start_date);
    const endDate = centerDateKey(req.body?.end_date || req.body?.endDate || req.query?.endDate || req.query?.end_date || startDate);
    const branchId = req.body?.branch_id || req.body?.branchId || req.query?.branchId || req.query?.branch_id;
    const result = await generateOpeningShiftSchedule({
      tenantId,
      branchId,
      startDate,
      endDate,
      createdByUserId: getUserId(req),
      overwrite: req.body?.overwrite === true || String(req.body?.overwrite || req.query?.overwrite || "").toLowerCase() === "true",
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[attendance-center] generate opening schedule error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to generate opening schedule", error: error.message });
  }
};

export const getAttendanceList = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const rows = await loadAttendanceCenterRows(filters);
    if (analyticsDebugEnabled()) console.info("[attendance-center]", {
      endpoint: "list",
      filters: { branch_id: filters.branchId, employee_id: filters.employeeId, status: filters.status, start_date: filters.startDate, end_date: filters.endDate },
      rows: rows.length,
      totals: summarizeAttendanceCenter(rows),
    });
    return res.json({ success: true, rows, attendance: rows, summary: summarizeAttendanceCenter(rows) });
  } catch (error) {
    console.error("[attendance-center] list error", error);
    return res.status(500).json({ success: false, message: "Failed to load attendance list", error: error.message });
  }
};

export const getAttendanceLive = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const params = [filters.tenantId];
    const where = ["($1::bigint IS NULL OR al.tenant_id = $1::bigint)", "COALESCE(al.check_out_at, al.check_out) IS NULL"];
    if (filters.branchId) {
      params.push(filters.branchId);
      where.push(`COALESCE(al.branch_id, e.branch_id)::text = $${params.length}::text`);
    }
    const result = await db.query(
      `
      SELECT al.id, al.employee_id, e.full_name AS employee_name, e.employee_code,
        COALESCE(al.branch_id, e.branch_id) AS branch_id, b.name AS branch_name,
        al.attendance_date, COALESCE(al.check_in_at, al.check_in) AS check_in_time,
        al.attendance_source,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(al.check_in_at, al.check_in))) / 3600 AS current_worked_hours,
        COALESCE(e.daily_work_hours, 8)::numeric AS daily_work_hours
      FROM attendance_logs al
      JOIN employees e ON e.id = al.employee_id
      LEFT JOIN branches b ON b.id = COALESCE(al.branch_id, e.branch_id)
      WHERE ${where.join(" AND ")}
      ORDER BY COALESCE(al.check_in_at, al.check_in) DESC
      LIMIT 100
      `,
      params
    );
    return res.json({ success: true, rows: result.rows.map((row) => ({
      ...row,
      current_worked_hours: Number(centerNumber(row.current_worked_hours).toFixed(2)),
      progress_percent: Math.min(100, Math.round((centerNumber(row.current_worked_hours) / Math.max(1, centerNumber(row.daily_work_hours, 8))) * 100)),
      status: "still_working",
    })) });
  } catch (error) {
    console.error("[attendance-center] live error", error);
    return res.status(500).json({ success: false, message: "Failed to load live attendance", error: error.message });
  }
};

export const getAttendancePayrollImpact = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const rows = await loadAttendanceCenterRows(filters, { qrOnly: true });
    const leaveImpactByEmployee = await loadLeavePayrollImpact(filters);
    const approvedOvertimeByEmployee = await loadApprovedOvertimePayrollImpact(filters);
    let penaltiesByEmployee = new Map();
    try {
      const penaltyResult = await db.query(
        `
        SELECT employee_id, SUM(COALESCE(amount, 0))::numeric AS penalties
        FROM employee_penalties
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
          AND penalty_date BETWEEN $2::date AND $3::date
          AND COALESCE(status, 'pending') <> 'cancelled'
        GROUP BY employee_id
        `,
        [filters.tenantId, filters.startDate, filters.endDate]
      );
      penaltiesByEmployee = new Map(penaltyResult.rows.map((row) => [String(row.employee_id), centerNumber(row.penalties)]));
    } catch {
      penaltiesByEmployee = new Map();
    }
    const grouped = [...rows.reduce((map, row) => {
      const bucket = map.get(row.employee_id) || {
        employee_id: row.employee_id,
        employee_name: row.employee_name,
        branch_name: row.branch_name,
        present_days: 0,
        absence_days: 0,
        missing_hours: 0,
        late_count: 0,
        attendance_deduction: 0,
        leave_days: 0,
        paid_leave_days: 0,
        deducted_leave_days: 0,
        leave_deduction: 0,
        monthly_paid_leave_days: 3,
        approved_overtime_hours: 0,
        approved_overtime_pay: 0,
        daily_rate: row.daily_rate,
        hourly_rate: row.hourly_rate,
      };
      if (row.check_in_time) bucket.present_days += 1;
      if (row.status === "absent") bucket.absence_days += 1;
      bucket.missing_hours += centerNumber(row.missing_hours);
      if (row.late_minutes > 0) bucket.late_count += 1;
      bucket.attendance_deduction += centerNumber(row.payroll_impact);
      map.set(row.employee_id, bucket);
      return map;
    }, new Map()).values()].map((row) => {
      const penalties = penaltiesByEmployee.get(String(row.employee_id)) || 0;
      const leaveImpact = leaveImpactByEmployee.get(String(row.employee_id)) || {};
      const overtimeImpact = approvedOvertimeByEmployee.get(String(row.employee_id)) || {};
      const leaveDeduction = centerNumber(leaveImpact.leave_deduction);
      const totalAttendanceDeduction = row.attendance_deduction + leaveDeduction;
      const approvedOvertimePay = centerNumber(overtimeImpact.approved_overtime_pay);
      return {
        ...row,
        missing_hours: Number(row.missing_hours.toFixed(2)),
        leave_days: centerNumber(leaveImpact.leave_days),
        paid_leave_days: centerNumber(leaveImpact.paid_leave_days),
        deducted_leave_days: centerNumber(leaveImpact.deducted_leave_days),
        monthly_paid_leave_days: centerNumber(leaveImpact.monthly_paid_leave_days, 3),
        leave_deduction: Number(leaveDeduction.toFixed(2)),
        approved_overtime_hours: centerNumber(overtimeImpact.approved_overtime_hours),
        approved_overtime_pay: Number(approvedOvertimePay.toFixed(2)),
        attendance_deduction: Number(totalAttendanceDeduction.toFixed(2)),
        raw_attendance_deduction: Number(row.attendance_deduction.toFixed(2)),
        penalties: Number(penalties.toFixed(2)),
        net_salary_impact: Number((totalAttendanceDeduction + penalties - approvedOvertimePay).toFixed(2)),
        explanation: `Daily rate ${row.daily_rate}, hourly rate ${row.hourly_rate}, absence ${row.absence_days} days, missing ${row.missing_hours.toFixed(2)} hours, paid leave ${centerNumber(leaveImpact.paid_leave_days)}, deducted leave ${centerNumber(leaveImpact.deducted_leave_days)}, approved overtime ${centerNumber(overtimeImpact.approved_overtime_hours)}h.`,
      };
    });
    if (analyticsDebugEnabled()) console.info("[payroll-impact]", {
      filters: { branch_id: filters.branchId, employee_id: filters.employeeId, start_date: filters.startDate, end_date: filters.endDate },
      qr_rows: rows.length,
      employee_rows: grouped.length,
      attendance_deduction_total: grouped.reduce((sum, row) => sum + centerNumber(row.attendance_deduction), 0),
      penalties_total: grouped.reduce((sum, row) => sum + centerNumber(row.penalties), 0),
    });
    return res.json({ success: true, rows: grouped });
  } catch (error) {
    console.error("[attendance-center] payroll impact error", error);
    return res.status(500).json({ success: false, message: "Failed to load payroll impact", error: error.message });
  }
};

export const getAttendanceOvertimeApprovals = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const params = [filters.tenantId, filters.startDate, filters.endDate];
    const where = [
      "($1::bigint IS NULL OR a.tenant_id = $1::bigint)",
      "a.attendance_date BETWEEN $2::date AND $3::date",
    ];
    if (filters.branchId) {
      params.push(filters.branchId);
      where.push(`COALESCE(a.branch_id, e.branch_id)::text = $${params.length}::text`);
    }
    if (filters.employeeId) {
      params.push(filters.employeeId);
      where.push(`a.employee_id::text = $${params.length}::text`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`LOWER(COALESCE(a.status, 'pending')) = $${params.length}`);
    }
    const result = await db.query(
      `
      SELECT a.*, e.full_name AS employee_name, e.employee_code, b.name AS branch_name,
        u.name AS approved_by_name
      FROM attendance_overtime_approvals a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN branches b ON b.id = COALESCE(a.branch_id, e.branch_id)
      LEFT JOIN users u ON u.id = a.approved_by_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.attendance_date DESC, a.created_at DESC
      LIMIT 500
      `,
      params
    );
    return res.json({ success: true, rows: result.rows });
  } catch (error) {
    console.error("[attendance-center] overtime approvals error", error);
    return res.status(500).json({ success: false, message: "Failed to load overtime approvals", error: error.message });
  }
};

export const updateAttendanceOvertimeApproval = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const id = req.params.id;
    const status = String(req.body?.status || "").trim().toLowerCase();
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "Unsupported overtime approval status" });
    }
    const previousResult = await db.query(
      `
      SELECT *
      FROM attendance_overtime_approvals
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [id, tenantId]
    );
    const previousRow = previousResult.rows[0] || null;
    const result = await db.query(
      `
      UPDATE attendance_overtime_approvals
      SET
        status = $3,
        approved_by_user_id = CASE WHEN $3 = 'approved' THEN $4 ELSE NULL END,
        approved_at = CASE WHEN $3 = 'approved' THEN NOW() ELSE NULL END,
        notes = CASE
          WHEN COALESCE($5::text, '') = '' THEN notes
          WHEN COALESCE(notes, '') = '' THEN $5::text
          ELSE notes || E'\n' || $5::text
        END,
        updated_at = NOW()
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      RETURNING *
      `,
      [id, tenantId, status, getUserId(req), req.body?.notes || ""]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Overtime approval request not found" });
    await recordAttendanceAuditLog(req, {
      action: `attendance_overtime.${status}`,
      entityType: "attendance_overtime_approval",
      entityId: result.rows[0].id,
      details: {
        employee_id: result.rows[0].employee_id,
        branch_id: result.rows[0].branch_id,
        attendance_date: result.rows[0].attendance_date,
        overtime_minutes: result.rows[0].overtime_minutes,
        previous_status: previousRow?.status || null,
        new_status: result.rows[0].status,
        notes: req.body?.notes || "",
      },
    });
    return res.json({ success: true, row: result.rows[0], overtime: result.rows[0] });
  } catch (error) {
    console.error("[attendance-center] overtime approval update error", error);
    return res.status(500).json({ success: false, message: "Failed to update overtime approval", error: error.message });
  }
};

export const getAttendanceLeaves = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const result = await db.query(
      `
      SELECT 'leave' AS record_type, l.id, l.employee_id, e.full_name AS employee_name,
        e.branch_id, b.name AS branch_name, l.leave_type, l.start_date, l.end_date,
        l.leave_date, l.notes, l.status
      FROM employee_leaves l
      JOIN employees e ON e.id = l.employee_id
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE ($1::bigint IS NULL OR l.tenant_id = $1::bigint)
        AND COALESCE(l.leave_date, l.start_date) <= $3::date
        AND COALESCE(l.leave_date, l.end_date, l.start_date) >= $2::date
        AND ($4::text = '' OR e.branch_id::text = $4::text)
      UNION ALL
      SELECT 'vacation' AS record_type, v.id, v.employee_id, e.full_name AS employee_name,
        e.branch_id, b.name AS branch_name, v.vacation_type AS leave_type, v.start_date, v.end_date,
        v.vacation_date AS leave_date, v.notes, v.status
      FROM employee_vacations v
      JOIN employees e ON e.id = v.employee_id
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint)
        AND COALESCE(v.vacation_date, v.start_date) <= $3::date
        AND COALESCE(v.vacation_date, v.end_date, v.start_date) >= $2::date
        AND ($4::text = '' OR e.branch_id::text = $4::text)
      ORDER BY start_date DESC NULLS LAST, leave_date DESC NULLS LAST
      `,
      [filters.tenantId, filters.startDate, filters.endDate, filters.branchId]
    );
    return res.json({ success: true, rows: result.rows });
  } catch (error) {
    console.error("[attendance-center] leaves error", error);
    return res.status(500).json({ success: false, message: "Failed to load leaves", error: error.message });
  }
};

export const getAttendanceCenterReports = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const rows = await loadAttendanceCenterRows(filters);
    return res.json({ success: true, summary: summarizeAttendanceCenter(rows), rows, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error("[attendance-center] reports error", error);
    return res.status(500).json({ success: false, message: "Failed to load attendance reports", error: error.message });
  }
};

export const getAttendanceQrSessions = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const filters = centerBuildFilters(req);
    const result = await db.query(
      `
      SELECT ev.id, ev.employee_id, e.full_name AS employee_name, ev.branch_id, b.name AS branch_name,
        ev.action_type AS qr_type, ev.action_timestamp AS scan_time,
        COALESCE(ev.device_fingerprint, ev.device_key, ev.device_token, '') AS device,
        ev.source, ev.attendance_log_id,
        CASE
          WHEN al.check_in_at IS NOT NULL AND al.check_out_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (al.check_out_at - al.check_in_at)) / 3600
          ELSE NULL
        END AS session_duration,
        CASE WHEN duplicate_counts.scan_count > 1 THEN TRUE ELSE FALSE END AS duplicate_scan,
        CASE WHEN ev.action_type = 'check_in' AND COALESCE(al.check_out_at, al.check_out) IS NULL THEN TRUE ELSE FALSE END AS missing_checkout,
        COALESCE(suspicious.suspicious_count, 0)::int AS suspicious_count
      FROM attendance_events ev
      LEFT JOIN attendance_logs al ON al.id = ev.attendance_log_id
      LEFT JOIN employees e ON e.id = ev.employee_id
      LEFT JOIN branches b ON b.id = ev.branch_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS scan_count
        FROM attendance_events ev2
        WHERE ev2.employee_id = ev.employee_id
          AND ev2.branch_id = ev.branch_id
          AND ev2.action_type = ev.action_type
          AND ABS(EXTRACT(EPOCH FROM (ev2.action_timestamp - ev.action_timestamp))) <= 60
      ) duplicate_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS suspicious_count
        FROM attendance_suspicious_activity_logs sal
        WHERE sal.employee_id = ev.employee_id
          AND sal.branch_id = ev.branch_id
          AND sal.created_at::date = ev.action_timestamp::date
      ) suspicious ON TRUE
      WHERE ($1::bigint IS NULL OR ev.tenant_id = $1::bigint)
        AND ev.action_timestamp::date BETWEEN $2::date AND $3::date
        AND ($4::text = '' OR ev.branch_id::text = $4::text)
      ORDER BY ev.action_timestamp DESC
      LIMIT 300
      `,
      [filters.tenantId, filters.startDate, filters.endDate, filters.branchId]
    );
    return res.json({ success: true, rows: result.rows.map((row) => ({
      ...row,
      session_duration: row.session_duration === null ? null : Number(centerNumber(row.session_duration).toFixed(2)),
    })) });
  } catch (error) {
    console.error("[attendance-center] qr sessions error", error);
    return res.status(500).json({ success: false, message: "Failed to load QR sessions", error: error.message });
  }
};

export const getOpeningCandidates = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const includeTestEmployees = ["1", "true", "yes"].includes(String(req.query.include_test || req.query.includeTest || "").toLowerCase());
    const branchId = req.query.branch_id || req.query.branchId || null;
    const workDate = req.query.work_date || req.query.workDate || getDefaultOpeningWorkDate();
    const candidates = await fetchOpeningCandidates(db, tenantId, {
      includeTestEmployees,
      branchId,
      workDate,
      includeAllBranches: ["1", "true", "yes"].includes(String(req.query.include_all_branches || req.query.includeAllBranches || "").toLowerCase()),
    });
    const recommended = candidates.find((candidate) => candidate.is_recommended) || null;
    const latestAssignment = await fetchLatestOpeningAssignment(db, tenantId);

    return res.status(200).json({
      success: true,
      data: {
        candidates,
        recommended,
        latest_assignment: latestAssignment,
        branch_id: branchId || null,
        work_date: workDate,
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
        attendance_public_code,
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

    const branchKey = branch.attendance_public_code || branch.id;
    const publicAttendanceUrl = buildAttendancePublicUrl(req, branchKey);
    const legacyPublicAttendanceUrl = buildLegacyAttendancePublicUrl(req, branch.attendance_qr_token);
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
      attendance_public_code: branch.attendance_public_code || "",
      tenant_id: branch.tenant_id,
    };
    const payload = {
      success: true,
      data: {
        branch_id: branch.id,
        branch_name: branch.name || "",
        branch_code: branch.code || "",
        attendance_public_code: branch.attendance_public_code || "",
        branch: branchPayload,
        company_name: company.company_name || "",
        company_logo_url: company.logo_url || "",
        generated_at: generatedAt,
        generatedAt,
        short_public_attendance_url: publicAttendanceUrl,
        shortPublicAttendanceUrl: publicAttendanceUrl,
        shortUrl: publicAttendanceUrl,
        public_attendance_url: publicAttendanceUrl,
        publicAttendanceUrl,
        publicUrl: publicAttendanceUrl,
        legacy_public_attendance_url: legacyPublicAttendanceUrl,
        legacyPublicAttendanceUrl,
        qrSvg,
        qrDataUrl,
        qrImage: qrDataUrl,
        qr_code_data_url: qrDataUrl,
        qrCodeDataUrl: qrDataUrl,
      },
    };
    console.log("[attendance] branch QR payload", {
      branchId: branch.id,
      branchKey,
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
    const branchKey = req.params.branchKey || req.params.token;
    const branch = await resolvePublicAttendanceBranch(db, branchKey);
    if (!branch || branch.is_active === false) {
      return res.status(404).json({
        success: false,
        message: "Attendance QR code is invalid or expired",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        branch_id: branch.id,
        branch_name: branch.name || "",
        branch_code: branch.code || "",
        attendance_public_code: branch.attendance_public_code || "",
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
    const branchKey = req.params.branchKey || req.params.token;
    const token = normalizeBranchEntryKey(branchKey);
    const identifier = normalizeLookupValue(req.body?.identifier || req.body?.phone || req.body?.employee_code || req.body?.employeeCode);
    const identifierDigits = normalizePhoneDigits(identifier);
    enforceAttendanceRateLimit(req, ["public-identify", token, identifierDigits || identifier]);

    if (!identifier) {
      return res.status(400).json({
        success: false,
        message: "Phone number or employee code is required",
      });
    }

    const branch = await resolvePublicAttendanceBranch(db, branchKey);
    if (!branch || branch.is_active === false) {
      return res.status(404).json({
        success: false,
        message: "Attendance QR code is invalid or expired",
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
        $1::bigint AS qr_branch_id,
        $2::bigint AS tenant_id,
        $3::text AS branch_name
      FROM employees e
      WHERE e.tenant_id = $2::bigint
        AND COALESCE(e.is_deleted, FALSE) = FALSE
        AND LOWER(COALESCE(e.status, 'active')) = 'active'
        AND (
          LOWER(COALESCE(e.employee_code, '')) = LOWER($4)
          OR regexp_replace(COALESCE(e.phone, ''), '\\D', '', 'g') = $5
        )
      ORDER BY CASE WHEN e.branch_id = $1::bigint THEN 0 ELSE 1 END, e.id DESC
      LIMIT 1
      `,
      [branch.id, branch.tenant_id, branch.name || "", identifier, identifierDigits || "__no_phone_match__"]
    );

    const employee = result.rows[0];
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found for this attendance QR",
      });
    }
    console.info("[attendance:public-identify] resolved employee", {
      employee_code: employee.employee_code || identifier,
      employee_id: employee.id,
      branch_id: employee.qr_branch_id,
    });

    const attendanceDate = getRequestAttendanceDate(req);
    const { eligibility } = await resolveAttendanceEligibility(db, {
      tenantId: employee.tenant_id,
      employeeId: employee.id,
      branchId: employee.qr_branch_id,
      attendanceDate,
      label: "public-identify",
    });
    const deviceContext = buildAttendanceDeviceContext(req, {
      tenantId: employee.tenant_id,
      branchId: employee.qr_branch_id,
      attendanceDate,
    });
    await enforceAttendanceDeviceBinding(db, {
      tenantId: employee.tenant_id,
      branchId: employee.qr_branch_id,
      employeeId: employee.id,
      attendanceDate,
      deviceContext,
    });
    if (eligibility.attendance?.id) {
      await upsertAttendanceDeviceBinding(db, {
        tenantId: employee.tenant_id,
        branchId: employee.qr_branch_id,
        employeeId: employee.id,
        attendanceDate,
        deviceContext,
        attendanceLogId: eligibility.attendance.id,
      });
    }
    const baseAllowedAction = getAllowedActionFromEligibility(eligibility);
    const deviceApproval = await inspectAttendanceDeviceApproval(db, {
      tenantId: employee.tenant_id,
      employeeId: employee.id,
      deviceToken: normalizeDeviceToken(req.body?.device_token || req.body?.deviceToken),
      allowedAction: baseAllowedAction,
    });
    const publicState = buildPublicQrState({ eligibility, deviceApproval });
    logPublicQrDecision("public-identify", {
      employee,
      deviceContext,
      deviceApproval,
      eligibility,
      allowedAction: publicState.allowed_action,
    });

    return res.status(200).json({
      success: true,
      ...publicState,
      data: {
        employee_id: employee.id,
        employee_name: employee.full_name || "",
        employee_code: employee.employee_code || "",
        branch_name: employee.branch_name || "",
        business_date: attendanceDate,
        attendance_date: attendanceDate,
        ...publicState,
      },
    });
  } catch (error) {
    console.log("PUBLIC BRANCH EMPLOYEE IDENTIFY ERROR:", error);
    if (error.code === "DEVICE_ALREADY_USED_TODAY") {
      return res.status(409).json({
        success: false,
        code: error.code,
        message: DEVICE_ALREADY_USED_MESSAGE,
      });
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to identify employee",
      error: error.message,
    });
  }
};

const createPublicAttendanceEvent = async ({ client, req, branch, employee, actionType, latitude, longitude, gpsVerification, attendanceDate, attendanceState, attendanceDevice = null, deviceContext = null }) => {
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
    const checkInAt = new Date();
    const shiftResolution = await resolveShiftForCheckIn({
      clientOrPool: client,
      tenantId: branch.tenant_id,
      employeeId: employee.id,
      checkInAt,
      timeZone: req.body?.timezone || req.body?.time_zone || getAttendanceTimeZone(),
    });
    const selectedShift = shiftResolution.shift;

    const created = await client.query(
      `
      INSERT INTO attendance_logs (
        tenant_id,
        employee_id,
        shift_id,
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
        device_fingerprint,
        device_key,
        user_agent,
        ip_address,
        worked_hours,
        work_minutes,
        late_minutes,
        early_leave_minutes,
        overtime_minutes,
        selected_shift_id,
        resolved_shift_start_time,
        resolved_shift_end_time,
        shift_resolution_status
      )
      VALUES ($1,$2,$3,$4,$5::date,$6,$6,$7,$8,$9,$10,'qr_branch','checked_in',$11,$12,$13,$14,0,0,$15,0,0,$16,$17,$18,$19)
      RETURNING *
      `,
      [
        branch.tenant_id,
        employee.id,
        selectedShift?.id || null,
        branch.id,
        attendanceDate,
        checkInAt,
        latitude,
        longitude,
        gpsVerification.distanceMeters,
        gpsVerification.result,
        deviceContext?.deviceFingerprint || null,
        deviceContext?.deviceKey || null,
        deviceContext?.userAgent || null,
        deviceContext?.ipAddress || null,
        normalizeAttendanceMinutes(shiftResolution.lateMinutes),
        selectedShift?.id || null,
        shiftResolution.resolvedStartTime,
        shiftResolution.resolvedEndTime,
        shiftResolution.status,
      ]
    );
    attendanceLog = created.rows[0];
  } else {
    if (!attendanceState?.can_check_out || !attendanceState?.attendance?.id) {
      const error = new Error(attendanceState?.completed ? "Attendance completed for today" : "No open check-in found for today");
      error.statusCode = 409;
      error.attendanceState = attendanceState;
      throw error;
    }

    // The stored checkout and the stored duration have to come from one clock:
    // check_in is written from a JS Date, so NOW() put the two ends of the same
    // shift on the database clock and the application clock.
    const checkOutAt = new Date();
    const metrics = calculateAttendanceMetrics({
      attendanceDate,
      checkIn: attendanceState.attendance.check_in,
      checkOut: checkOutAt,
      shift: {},
      timeZone: getAttendanceTimeZone(),
    });

    const updated = await client.query(
      `
      UPDATE attendance_logs
      SET
        branch_id = COALESCE(branch_id, $1),
        check_out = $12,
        check_out_at = $12,
        check_out_latitude = $2,
        check_out_longitude = $3,
        check_out_gps_distance_meters = $4,
        check_out_gps_verification_result = $5,
        device_fingerprint = COALESCE(device_fingerprint, $8),
        device_key = COALESCE(device_key, $9),
        user_agent = COALESCE(user_agent, $10),
        ip_address = COALESCE(ip_address, $11),
        attendance_source = 'qr_branch',
        status = 'checked_out',
        worked_hours = ROUND((COALESCE($6::numeric, 0) / 60.0), 2),
        work_minutes = COALESCE($6::integer, 0),
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
      `,
      [
        branch.id,
        latitude,
        longitude,
        gpsVerification.distanceMeters,
        gpsVerification.result,
        normalizeAttendanceMinutes(metrics.work_minutes),
        attendanceState.attendance.id,
        deviceContext?.deviceFingerprint || null,
        deviceContext?.deviceKey || null,
        deviceContext?.userAgent || null,
        deviceContext?.ipAddress || null,
        checkOutAt,
      ]
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
      device_token,
      device_id,
      device_fingerprint,
      device_key,
      source
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'qr_branch')
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
      attendanceDevice?.device_token || null,
      attendanceDevice?.id || null,
      deviceContext?.deviceFingerprint || null,
      deviceContext?.deviceKey || null,
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

    const branchKey = req.params.branchKey || req.params.token;
    const token = normalizeBranchEntryKey(branchKey);
    const employeeId = Number(req.body?.employee_id || req.body?.employeeId || 0);
    const actionType = normalizeLookupValue(req.body?.action_type || req.body?.actionType || req.body?.action).toLowerCase();
    const latitude = parseOptionalCoordinate(req.body?.latitude);
    const longitude = parseOptionalCoordinate(req.body?.longitude);
    const deviceToken = normalizeDeviceToken(req.body?.device_token || req.body?.deviceToken);
    enforceAttendanceRateLimit(req, ["public-action", token, employeeId, deviceToken.slice(0, 16)]);

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

    const row = await resolvePublicAttendanceBranch(client, branchKey, { includeEmployeeId: employeeId });
    if (!row || row.is_active === false) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Attendance QR code is invalid or expired",
      });
    }

    if (!row.employee_id) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Employee not found for this attendance QR",
      });
    }

    if (String(row.employee_status || "active").toLowerCase() !== "active") {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "Employee is not active",
      });
    }
    console.info("[attendance:public-action] resolved employee", {
      employee_code: row.employee_code || null,
      employee_id: row.employee_id,
      action_type: actionType,
      branch_id: row.id,
    });

    const attendanceDate = getRequestAttendanceDate(req);
    const deviceContext = buildAttendanceDeviceContext(req, {
      tenantId: row.tenant_id,
      branchId: row.id,
      attendanceDate,
    });
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
    try {
      enforceGpsVerification(gpsVerification);
    } catch (gpsError) {
      gpsError.attendanceState = eligibility;
      throw gpsError;
    }

    await enforceAttendanceDeviceBinding(client, {
      tenantId: row.tenant_id,
      branchId: row.id,
      employeeId: row.employee_id,
      attendanceDate,
      deviceContext,
    });

    const baseAllowedAction = getAllowedActionFromEligibility(eligibility);
    const deviceApproval = await inspectAttendanceDeviceApproval(client, {
      tenantId: row.tenant_id,
      employeeId: row.employee_id,
      deviceToken,
      allowedAction: baseAllowedAction,
    });
    logPublicQrDecision("public-action-before", {
      employee: { id: row.employee_id, employee_code: row.employee_code },
      deviceContext,
      deviceApproval,
      eligibility,
      allowedAction: deviceApproval.deviceActionBlocked ? null : baseAllowedAction,
    });

    if (deviceApproval.deviceActionBlocked || actionType !== baseAllowedAction) {
      await client.query("ROLLBACK");
      const publicState = buildPublicQrState({ eligibility, deviceApproval });
      return res.status(409).json({
        success: false,
        message: deviceApproval.deviceApprovalMessage || `Allowed action is ${baseAllowedAction || "none"}`,
        ...publicState,
        pending_device: deviceApproval.deviceApprovalStatus === "pending",
      });
    }

    const validatedDevice = actionType === "check_in"
      ? await validateAttendanceDevice({
          client,
          req,
          tenantId: row.tenant_id,
          employeeId: row.employee_id,
          branchId: row.id,
          deviceToken,
          gpsVerification,
          allowRegistration: true,
        })
      : {
          device: deviceApproval.device,
          status: deviceApproval.deviceApprovalStatus || "checkout_allowed",
        };
    const attendanceDevice = validatedDevice.device;
    const deviceStatus = validatedDevice.status;

    if (eligibility.completed && eligibility.attendance?.id) {
      await upsertAttendanceDeviceBinding(client, {
        tenantId: row.tenant_id,
        branchId: row.id,
        employeeId: row.employee_id,
        attendanceDate,
        deviceContext,
        attendanceLogId: eligibility.attendance.id,
      });
      await client.query("COMMIT");
      const publicState = buildPublicQrState({ eligibility, deviceApproval });
      return res.status(409).json({
        success: false,
        message: "Attendance completed for today",
        ...publicState,
        device: {
          id: attendanceDevice?.id || null,
          status: deviceStatus,
        },
      });
    }

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
      attendanceDevice,
      deviceContext,
    });

    await upsertAttendanceDeviceBinding(client, {
      tenantId: row.tenant_id,
      branchId: row.id,
      employeeId: row.employee_id,
      attendanceDate,
      deviceContext,
      attendanceLogId: attendanceLog?.id || null,
    });

    const { eligibility: nextEligibility } = await resolveAttendanceEligibility(client, {
      tenantId: row.tenant_id,
      employeeId: row.employee_id,
      branchId: row.id,
      attendanceDate,
      label: "public-action-after",
    });
    const nextAllowedAction = getAllowedActionFromEligibility(nextEligibility);
    const nextDeviceApproval = await inspectAttendanceDeviceApproval(client, {
      tenantId: row.tenant_id,
      employeeId: row.employee_id,
      deviceToken,
      allowedAction: nextAllowedAction,
    });
    const publicState = buildPublicQrState({ eligibility: nextEligibility, deviceApproval: nextDeviceApproval });
    logPublicQrDecision("public-action-after", {
      employee: { id: row.employee_id, employee_code: row.employee_code },
      deviceContext,
      deviceApproval: nextDeviceApproval,
      eligibility: nextEligibility,
      allowedAction: publicState.allowed_action,
    });

    const portalResponse = actionType === "check_in"
      ? await createEmployeePortalResponse({
          clientOrPool: client,
          req,
          tenantId: row.tenant_id,
          branchId: row.id,
          employeeId: row.employee_id,
          attendanceLogId: attendanceLog?.id || null,
        })
      : { portal_url: null, employee_portal: null };

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
          attendanceEventId: event?.id || null,
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
      ...publicState,
      staff_tasks: staffTasks,
      portal_url: portalResponse.portal_url,
      employee_portal: portalResponse.employee_portal,
      data: {
        event_id: event.id,
        action_type: event.action_type,
        timestamp: event.action_timestamp,
        employee_id: row.employee_id,
        employee_name: row.full_name || "",
        employee_code: row.employee_code || "",
        branch_name: row.name || "",
        ...publicState,
        device: {
          id: attendanceDevice?.id || null,
          status: deviceStatus,
          first_seen_at: attendanceDevice?.first_seen_at || null,
          last_seen_at: attendanceDevice?.last_seen_at || null,
        },
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
    if (error.code === "DEVICE_ALREADY_USED_TODAY") {
      return res.status(409).json({
        success: false,
        code: error.code,
        message: DEVICE_ALREADY_USED_MESSAGE,
      });
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to record attendance",
      error: error.message,
      pending_device: Boolean(error.pendingDevice),
      ...(error.attendanceState
        ? buildPublicQrState({
            eligibility: error.attendanceState,
            deviceApproval: {
              deviceApprovalRequired: Boolean(error.pendingDevice),
              deviceApprovalStatus: error.pendingDevice ? "pending" : "unknown",
              deviceActionBlocked: Boolean(error.pendingDevice),
              deviceApprovalMessage: error.pendingDevice ? "Device approval is required before check-in." : "",
            },
          })
        : {}),
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

const normalizeAttendanceDevice = (row = {}) => ({
  id: row.id,
  record_type: row.record_type || "approval",
  tenant_id: row.tenant_id,
  employee_id: row.employee_id,
  employee_name: row.employee_name || row.full_name || "",
  employee_code: row.employee_code || "",
  branch_id: row.branch_id || null,
  branch_name: row.branch_name || "",
  business_date: row.business_date || null,
  device_key: row.device_key || "",
  device_token_tail: row.device_key
    ? String(row.device_key).slice(-8)
    : row.device_token
      ? String(row.device_token).slice(-8)
      : "",
  device_fingerprint: row.device_fingerprint || "",
  user_agent: row.user_agent || "",
  ip_address: row.ip_address || "",
  status: row.status || "",
  first_seen_at: row.first_seen_at || null,
  last_seen_at: row.last_seen_at || null,
  approved_at: row.approved_at || null,
  rejected_at: row.rejected_at || null,
  reset_at: row.reset_at || null,
});

export const getAttendanceDevices = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const status = String(req.query.status || "").trim().toLowerCase();
    const employeeId = Number(req.query.employee_id || req.query.employeeId || 0);
    const params = [tenantId];
    let statusPredicate = "AND d.status <> 'reset'";
    let employeePredicate = "";

    if (["approved", "pending", "rejected", "reset"].includes(status)) {
      params.push(status);
      statusPredicate = `AND d.status = $${params.length}`;
    }
    if (employeeId) {
      params.push(employeeId);
      employeePredicate = `AND d.employee_id = $${params.length}`;
    }
    const bindingParams = [tenantId];
    let bindingEmployeePredicate = "";
    if (employeeId) {
      bindingParams.push(employeeId);
      bindingEmployeePredicate = `AND b.employee_id = $${bindingParams.length}`;
    }

    const result = await db.query(
      `
      SELECT
        d.*,
        'approval' AS record_type,
        NULL::date AS business_date,
        NULL::text AS device_key,
        NULL::text AS device_fingerprint,
        e.full_name AS employee_name,
        e.employee_code,
        e.branch_id,
        b.name AS branch_name
      FROM employee_attendance_devices d
      JOIN employees e ON e.id = d.employee_id
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE ($1::bigint IS NULL OR d.tenant_id = $1::bigint)
        ${statusPredicate}
        ${employeePredicate}
      ORDER BY
        CASE d.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        d.last_seen_at DESC,
        d.id DESC
      LIMIT 300
      `,
      params
    );
    const bindings = await db.query(
      `
      SELECT
        b.id,
        'binding' AS record_type,
        b.tenant_id,
        b.employee_id,
        e.full_name AS employee_name,
        e.employee_code,
        b.branch_id,
        br.name AS branch_name,
        b.business_date,
        b.device_key,
        b.device_fingerprint,
        b.user_agent,
        'locked' AS status,
        b.created_at AS first_seen_at,
        b.updated_at AS last_seen_at,
        NULL::timestamp AS approved_at,
        NULL::timestamp AS rejected_at,
        NULL::timestamp AS reset_at
      FROM attendance_device_bindings b
      JOIN employees e ON e.id = b.employee_id
      LEFT JOIN branches br ON br.id = b.branch_id
      WHERE ($1::bigint IS NULL OR b.tenant_id = $1::bigint)
        ${bindingEmployeePredicate}
      ORDER BY b.business_date DESC, b.updated_at DESC, b.id DESC
      LIMIT 300
      `,
      bindingParams
    );
    const rows = [...bindings.rows, ...result.rows].map(normalizeAttendanceDevice);

    return res.status(200).json({
      success: true,
      data: rows,
      devices: rows,
    });
  } catch (error) {
    console.log("GET ATTENDANCE DEVICES ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch attendance devices",
      error: error.message,
    });
  }
};

export const getAttendanceDeviceSettings = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req) ?? resolveAuthenticatedTenantId(req) ?? 1;
    const policy = await getNewDevicePolicy(db, tenantId);
    const requireDeviceApproval = await getAttendanceRequireDeviceApproval(db, tenantId);
    return res.status(200).json({
      success: true,
      data: {
        new_device_policy: policy,
        attendance_require_device_approval: requireDeviceApproval,
        require_device_approval: requireDeviceApproval,
      },
      settings: {
        new_device_policy: policy,
        attendance_require_device_approval: requireDeviceApproval,
        require_device_approval: requireDeviceApproval,
      },
    });
  } catch (error) {
    console.log("GET ATTENDANCE DEVICE SETTINGS ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch attendance device settings", error: error.message });
  }
};

const normalizeForbiddenWeekdays = (value) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
      : [];
  const unique = new Set();
  source.forEach((item) => {
    const weekday = Number(item);
    if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) unique.add(weekday);
  });
  return Array.from(unique).sort((a, b) => a - b);
};

const normalizeHrAttendanceSettings = (row = {}) => {
  let forbiddenLeaveWeekdays = row.forbidden_leave_weekdays;
  if (typeof forbiddenLeaveWeekdays === "string") {
    try {
      forbiddenLeaveWeekdays = JSON.parse(forbiddenLeaveWeekdays);
    } catch {
      forbiddenLeaveWeekdays = normalizeForbiddenWeekdays(forbiddenLeaveWeekdays);
    }
  }
  return {
    require_next_opening_on_pos_close: row.require_next_opening_on_pos_close !== false,
    grace_minutes: Math.max(0, Number(row.grace_minutes ?? 10)),
    monthly_paid_leave_days: Math.max(0, Number(row.monthly_paid_leave_days ?? 3)),
    forbidden_leave_weekdays: normalizeForbiddenWeekdays(forbiddenLeaveWeekdays?.length ? forbiddenLeaveWeekdays : [4, 5, 6]),
    updated_at: row.updated_at || null,
  };
};

export const getAttendanceHrSettings = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req) ?? resolveAuthenticatedTenantId(req) ?? 1;
    const result = await db.query(
      `
      INSERT INTO hr_attendance_settings (tenant_id)
      VALUES ($1)
      ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
      RETURNING require_next_opening_on_pos_close, grace_minutes, monthly_paid_leave_days, forbidden_leave_weekdays, updated_at
      `,
      [tenantId]
    );
    const settings = normalizeHrAttendanceSettings(result.rows[0]);
    return res.status(200).json({ success: true, data: settings, settings });
  } catch (error) {
    console.log("GET ATTENDANCE HR SETTINGS ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch attendance HR settings", error: error.message });
  }
};

export const updateAttendanceHrSettings = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req) ?? resolveAuthenticatedTenantId(req) ?? 1;
    const requireNextOpening = Object.prototype.hasOwnProperty.call(req.body || {}, "require_next_opening_on_pos_close")
      ? req.body.require_next_opening_on_pos_close === true
      : Object.prototype.hasOwnProperty.call(req.body || {}, "requireNextOpeningOnPosClose")
        ? req.body.requireNextOpeningOnPosClose === true
        : true;
    const graceMinutes = Math.max(0, Math.round(Number(req.body?.grace_minutes ?? req.body?.graceMinutes ?? 10)));
    const monthlyPaidLeaveDays = Math.max(0, Math.round(Number(req.body?.monthly_paid_leave_days ?? req.body?.monthlyPaidLeaveDays ?? 3)));
    const forbiddenLeaveWeekdays = normalizeForbiddenWeekdays(req.body?.forbidden_leave_weekdays ?? req.body?.forbiddenLeaveWeekdays ?? [4, 5, 6]);

    const result = await db.query(
      `
      INSERT INTO hr_attendance_settings (
        tenant_id,
        require_next_opening_on_pos_close,
        grace_minutes,
        monthly_paid_leave_days,
        forbidden_leave_weekdays,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
      ON CONFLICT (tenant_id) DO UPDATE
      SET require_next_opening_on_pos_close = EXCLUDED.require_next_opening_on_pos_close,
          grace_minutes = EXCLUDED.grace_minutes,
          monthly_paid_leave_days = EXCLUDED.monthly_paid_leave_days,
          forbidden_leave_weekdays = EXCLUDED.forbidden_leave_weekdays,
          updated_at = NOW()
      RETURNING require_next_opening_on_pos_close, grace_minutes, monthly_paid_leave_days, forbidden_leave_weekdays, updated_at
      `,
      [tenantId, requireNextOpening, graceMinutes, monthlyPaidLeaveDays, JSON.stringify(forbiddenLeaveWeekdays)]
    );

    await recordAttendanceAuditLog(req, {
      action: "attendance_hr_settings.updated",
      entityType: "hr_attendance_settings",
      entityId: tenantId,
      details: {
        require_next_opening_on_pos_close: requireNextOpening,
        grace_minutes: graceMinutes,
        monthly_paid_leave_days: monthlyPaidLeaveDays,
        forbidden_leave_weekdays: forbiddenLeaveWeekdays,
      },
    });

    const settings = normalizeHrAttendanceSettings(result.rows[0]);
    return res.status(200).json({ success: true, data: settings, settings });
  } catch (error) {
    console.log("UPDATE ATTENDANCE HR SETTINGS ERROR:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to update attendance HR settings", error: error.message });
  }
};

export const updateAttendanceDeviceSettings = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req) ?? resolveAuthenticatedTenantId(req) ?? 1;
    const requested = String(req.body?.new_device_policy || req.body?.newDevicePolicy || "").toLowerCase();
    const policy = requested === "block" ? "block" : "pending";
    const hasRequireDeviceApproval = Object.prototype.hasOwnProperty.call(req.body || {}, "require_device_approval")
      || Object.prototype.hasOwnProperty.call(req.body || {}, "requireDeviceApproval")
      || Object.prototype.hasOwnProperty.call(req.body || {}, "attendance_require_device_approval")
      || Object.prototype.hasOwnProperty.call(req.body || {}, "attendanceRequireDeviceApproval");
    const requireDeviceApproval = hasRequireDeviceApproval
      ? req.body?.require_device_approval === true
        || req.body?.requireDeviceApproval === true
        || req.body?.attendance_require_device_approval === true
        || req.body?.attendanceRequireDeviceApproval === true
      : null;
    const result = await db.query(
      `
      INSERT INTO attendance_device_settings (tenant_id, new_device_policy, attendance_require_device_approval, require_device_approval, updated_at)
      VALUES ($1,$2,COALESCE($3::boolean, FALSE),COALESCE($3::boolean, FALSE),NOW())
      ON CONFLICT (tenant_id) DO UPDATE
      SET new_device_policy = EXCLUDED.new_device_policy,
          attendance_require_device_approval = COALESCE($3::boolean, attendance_device_settings.attendance_require_device_approval),
          require_device_approval = COALESCE($3::boolean, attendance_device_settings.require_device_approval),
          updated_at = NOW()
      RETURNING new_device_policy, attendance_require_device_approval, require_device_approval
      `,
      [tenantId, policy, requireDeviceApproval]
    );
    const settings = {
      new_device_policy: result.rows[0]?.new_device_policy || policy,
      attendance_require_device_approval: result.rows[0]?.attendance_require_device_approval === true || result.rows[0]?.require_device_approval === true,
      require_device_approval: result.rows[0]?.attendance_require_device_approval === true || result.rows[0]?.require_device_approval === true,
    };
    return res.status(200).json({
      success: true,
      data: settings,
      settings,
    });
  } catch (error) {
    console.log("UPDATE ATTENDANCE DEVICE SETTINGS ERROR:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to update attendance device settings", error: error.message });
  }
};

export const approveAttendanceDevice = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureAttendanceSchema();
    await client.query("BEGIN");
    const tenantId = getTenantScope(req);
    const deviceId = Number(req.params.id || 0);
    const userId = getUserId(req);

    const result = await client.query(
      `
      SELECT *
      FROM employee_attendance_devices
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      FOR UPDATE
      `,
      [deviceId, tenantId]
    );
    const device = result.rows[0];
    if (!device) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Device request not found" });
    }

    await client.query(
      `
      UPDATE employee_attendance_devices
      SET status = 'reset',
          reset_at = NOW(),
          reset_by_user_id = $4,
          updated_at = NOW()
      WHERE tenant_id = $1
        AND employee_id = $2
        AND status = 'approved'
        AND id <> $3
      `,
      [device.tenant_id, device.employee_id, device.id, userId]
    );

    const approved = await client.query(
      `
      UPDATE employee_attendance_devices
      SET status = 'approved',
          approved_at = NOW(),
          approved_by_user_id = $2,
          rejected_at = NULL,
          rejected_by_user_id = NULL,
          reset_at = NULL,
          reset_by_user_id = NULL,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [device.id, userId]
    );

    await client.query("COMMIT");
    return res.status(200).json({ success: true, data: normalizeAttendanceDevice(approved.rows[0]), device: normalizeAttendanceDevice(approved.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("APPROVE ATTENDANCE DEVICE ERROR:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to approve device", error: error.message });
  } finally {
    client.release();
  }
};

export const rejectAttendanceDevice = async (req, res) => {
  try {
    await ensureAttendanceSchema();
    const tenantId = getTenantScope(req);
    const deviceId = Number(req.params.id || 0);
    const userId = getUserId(req);
    const result = await db.query(
      `
      UPDATE employee_attendance_devices
      SET status = 'rejected',
          rejected_at = NOW(),
          rejected_by_user_id = $2,
          updated_at = NOW()
      WHERE id = $1
        AND ($3::bigint IS NULL OR tenant_id = $3::bigint)
      RETURNING *
      `,
      [deviceId, userId, tenantId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Device request not found" });
    }
    return res.status(200).json({ success: true, data: normalizeAttendanceDevice(result.rows[0]), device: normalizeAttendanceDevice(result.rows[0]) });
  } catch (error) {
    console.log("REJECT ATTENDANCE DEVICE ERROR:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to reject device", error: error.message });
  }
};

export const resetEmployeeAttendanceDevice = async (req, res) => {
  const client = await db.connect();
  try {
    await ensureAttendanceSchema();
    await ensureStaffTasksSchema(client);
    await client.query("BEGIN");
    const tenantId = getTenantScope(req);
    const identifier = String(req.params.id || req.params.employeeId || "").trim();
    const numericId = Number(identifier);
    const userId = getUserId(req);
    const employeeResult = await client.query(
      `
      SELECT id, employee_code
      FROM employees
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
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
    const employee = employeeResult.rows[0] || null;
    if (!employee) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Employee not found" });
    }
    const employeeId = Number(employee.id);
    const attendanceDate = getRequestAttendanceDate(req);
    const resetQuery = async (sql, values) => {
      console.log("[attendance-reset]", {
        sql,
        values,
        valuesLength: values.length,
      });
      return client.query(sql, values);
    };
    const resetDevicesSql = `
      UPDATE employee_attendance_devices
      SET status = 'reset',
          reset_at = NOW(),
          reset_by_user_id = $3,
          updated_at = NOW()
      WHERE employee_id = $1
        AND status IN ('approved', 'pending')
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      RETURNING *
      `;
    const devicesReset = await resetQuery(resetDevicesSql, [employeeId, tenantId, userId]);

    const deleteSessionsSql = `
      DELETE FROM employee_portal_sessions
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND employee_id = $2
      RETURNING id
      `;
    const sessionsDeleted = await resetQuery(deleteSessionsSql, [tenantId, employeeId]);

    const deleteBindingsSql = `
      DELETE FROM attendance_device_bindings
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND employee_id = $2
        AND business_date = $3::date
      RETURNING id
      `;
    const bindingsDeleted = await resetQuery(deleteBindingsSql, [tenantId, employeeId, attendanceDate]);

    const deleteLogsSql = `
      DELETE FROM attendance_logs
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND employee_id = $2
        AND attendance_date = $3::date
      RETURNING id
      `;
    const logsDeleted = await resetQuery(deleteLogsSql, [tenantId, employeeId, attendanceDate]);
    const deletedRows = {
      attendance_logs: logsDeleted.rowCount,
      attendance_device_bindings: bindingsDeleted.rowCount,
      employee_portal_sessions: sessionsDeleted.rowCount,
      employee_attendance_devices: devicesReset.rowCount,
    };
    const deletedCount = Object.values(deletedRows).reduce((sum, value) => sum + value, 0);
    console.info("[attendance:reset-employee-device]", {
      employee_code: employee.employee_code || null,
      employee_id: employeeId,
      attendance_date: attendanceDate,
      deleted_rows: deletedRows,
      deleted_count: deletedCount,
      reset_count: devicesReset.rowCount,
    });
    if (deletedCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        code: "NO_DEVICE_LOCK_ROWS",
        message: "No device lock rows were found for this employee",
        deletedCount: 0,
        deleted_count: 0,
        reset_count: devicesReset.rowCount,
      });
    }
    await client.query("COMMIT");
    return res.status(200).json({
      success: true,
      employee_id: employeeId,
      employee_code: employee.employee_code || "",
      deletedCount,
      deleted_count: deletedCount,
      deleted_rows: deletedRows,
      reset_count: devicesReset.rowCount,
      data: devicesReset.rows.map(normalizeAttendanceDevice),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.log("RESET EMPLOYEE ATTENDANCE DEVICE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset employee device",
      error: {
        code: "ATTENDANCE_RESET_FAILED",
      },
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
    const deviceToken = normalizeDeviceToken(req.body?.device_token || req.body?.deviceToken);
    enforceAttendanceRateLimit(req, ["qr-scan", employee.id, qrToken, deviceToken.slice(0, 16)]);

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
    console.info("[attendance:qr-scan] resolved employee", {
      employee_code: employee.employee_code || null,
      employee_id: employee.id,
      branch_id: branch.id,
    });
    const attendanceDate = getRequestAttendanceDate(req);
    const deviceContext = buildAttendanceDeviceContext(req, {
      tenantId: effectiveTenantId,
      branchId: branch.id,
      attendanceDate,
    });
    await lockEmployeeAttendanceDay(client, effectiveTenantId, employee.id);
    const { eligibility } = await resolveAttendanceEligibility(client, {
      tenantId: effectiveTenantId,
      employeeId: employee.id,
      branchId: branch.id,
      attendanceDate,
      lock: true,
      label: "qr-scan-before",
    });

    await enforceAttendanceDeviceBinding(client, {
      tenantId: effectiveTenantId,
      branchId: branch.id,
      employeeId: employee.id,
      attendanceDate,
      deviceContext,
    });

    const { device: attendanceDevice, status: deviceStatus } = await validateAttendanceDevice({
      client,
      req,
      tenantId: effectiveTenantId,
      employeeId: employee.id,
      branchId: branch.id,
      deviceToken,
      gpsVerification,
      allowRegistration: true,
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
      device_fingerprint: deviceContext.deviceFingerprint || null,
      device_key: deviceContext.deviceKey || null,
      user_agent: deviceContext.userAgent || null,
      ip_address: deviceContext.ipAddress || null,
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
          device_fingerprint,
          device_key,
          user_agent,
          ip_address,
          worked_hours,
          work_minutes,
          late_minutes,
          early_leave_minutes,
          overtime_minutes
        )
        VALUES (
          $1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,0,0,0,0,0
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
          nowPayload.device_fingerprint,
          nowPayload.device_key,
          nowPayload.user_agent,
          nowPayload.ip_address,
        ]
      );

      await upsertAttendanceDeviceBinding(client, {
        tenantId: effectiveTenantId,
        branchId: branch.id,
        employeeId: employee.id,
        attendanceDate,
        deviceContext,
        attendanceLogId: created.rows[0]?.id || null,
      });

      const portalResponse = await createEmployeePortalResponse({
        clientOrPool: client,
        req,
        tenantId: effectiveTenantId,
        branchId: branch.id,
        employeeId: employee.id,
        attendanceLogId: created.rows[0]?.id || null,
      });

      await client.query("COMMIT");
      let staffTasks = null;
      try {
        staffTasks = await handleBranchQrCheckInStaffTasks({
          tenantId: effectiveTenantId,
          branchId: branch.id,
          employeeId: employee.id,
          actionType: "check_in",
          attendanceDate: created.rows[0]?.attendance_date || new Date(),
          attendanceEventId: null,
        });
      } catch (taskError) {
        console.warn("[attendance] authenticated QR staff task integration skipped", taskError.message);
      }
      return res.status(201).json({
        success: true,
        action: "check_in",
        message: "Check in recorded",
        staff_tasks: staffTasks,
        portal_url: portalResponse.portal_url,
        employee_portal: portalResponse.employee_portal,
        distanceMeters: Math.round(gpsVerification.distanceMeters),
        allowedRadiusMeters: gpsVerification.allowedRadiusMeters,
        device: {
          id: attendanceDevice?.id || null,
          status: deviceStatus,
        },
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
      if (eligibility.attendance?.id) {
        await upsertAttendanceDeviceBinding(client, {
          tenantId: effectiveTenantId,
          branchId: branch.id,
          employeeId: employee.id,
          attendanceDate,
          deviceContext,
          attendanceLogId: eligibility.attendance.id,
        });
      }
      await client.query("COMMIT");
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

    // One clock for the stored checkout and the stored duration; see the branch
    // QR path above.
    const checkOutAt = new Date();
    const metrics = calculateAttendanceMetrics({
      attendanceDate: todayLog.attendance_date,
      checkIn: todayLog.check_in_at || todayLog.check_in,
      checkOut: checkOutAt,
      shift: {},
      timeZone: getAttendanceTimeZone(),
    });

    const updated = await client.query(
      `
      UPDATE attendance_logs
      SET
        check_out = $11,
        check_out_at = $11,
        check_out_latitude = $1,
        check_out_longitude = $2,
        check_out_gps_distance_meters = $3,
        check_out_gps_verification_result = $4,
        device_fingerprint = COALESCE(device_fingerprint, $7),
        device_key = COALESCE(device_key, $8),
        user_agent = COALESCE(user_agent, $9),
        ip_address = COALESCE(ip_address, $10),
        status = 'checked_out',
        worked_hours = ROUND((COALESCE($5::numeric, 0) / 60.0), 2),
        work_minutes = COALESCE($5::integer, 0),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
      `,
      [
        latitude,
        longitude,
        gpsVerification.distanceMeters,
        gpsVerification.result,
        normalizeAttendanceMinutes(metrics.work_minutes),
        todayLog.id,
        deviceContext.deviceFingerprint || null,
        deviceContext.deviceKey || null,
        deviceContext.userAgent || null,
        deviceContext.ipAddress || null,
        checkOutAt,
      ]
    );

    await upsertAttendanceDeviceBinding(client, {
      tenantId: effectiveTenantId,
      branchId: branch.id,
      employeeId: employee.id,
      attendanceDate,
      deviceContext,
      attendanceLogId: updated.rows[0]?.id || todayLog.id,
    });

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      action: "check_out",
      message: "Check out recorded",
        distanceMeters: Math.round(gpsVerification.distanceMeters),
        allowedRadiusMeters: gpsVerification.allowedRadiusMeters,
        device: {
          id: attendanceDevice?.id || null,
          status: deviceStatus,
        },
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
    if (error.code === "DEVICE_ALREADY_USED_TODAY") {
      return res.status(409).json({
        success: false,
        code: error.code,
        message: DEVICE_ALREADY_USED_MESSAGE,
      });
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to record QR attendance",
      error: error.message,
      pending_device: Boolean(error.pendingDevice),
    });
  } finally {
    client.release();
  }
};
