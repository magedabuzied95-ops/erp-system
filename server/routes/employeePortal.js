import express from "express";
import {
  getEmployeePortalPushKey,
  subscribeEmployeePortalPushEndpoint,
  unsubscribeEmployeePortalPushEndpoint,
} from "../controllers/staffTasksController.js";
import {
  buildEmployeePayrollPortalPayload,
  createEmployeePortalRequest,
  diagnoseEmployeePortalIdentifier,
  getEmployeePortalVerificationResult,
  loadEmployeePortalByToken,
  recordEmployeePortalAudit,
  recordEmployeePortalAttendance,
  updateEmployeeWalletTaskStatus,
} from "../services/employeePayrollPortalService.js";
import { isPerfDebugEnabled, logPerfTiming } from "../utils/perfDebug.js";

const router = express.Router();
const failedAttempts = new Map();
const maxFailedAttempts = 5;
const windowMs = 15 * 60 * 1000;

const attemptKey = (req) => `${req.params.token || ""}:${req.ip || req.socket?.remoteAddress || "unknown"}`;

const readAttempt = (key) => {
  const current = failedAttempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    failedAttempts.delete(key);
    return { count: 0, resetAt: Date.now() + windowMs };
  }
  return current;
};

const recordFailure = (key) => {
  const current = readAttempt(key);
  const next = { count: current.count + 1, resetAt: current.resetAt };
  failedAttempts.set(key, next);
  return next;
};

const portalVerificationFromRequest = (req) =>
  req.query.verify ||
  req.query.identifier ||
  req.query.code ||
  req.query.employee_code ||
  req.query.employeeCode ||
  req.query.phone ||
  req.body?.verification ||
  req.body?.verify ||
  req.body?.identifier ||
  req.body?.code ||
  req.body?.employee_code ||
  req.body?.employeeCode ||
  req.body?.phone ||
  "";

const walletDebugEnabled = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.DEBUG_EMPLOYEE_PORTAL || "").toLowerCase()) ||
  String(process.env.NODE_ENV || "development").toLowerCase() !== "production";

const nowMs = () => Number(process.hrtime.bigint() / 1000000n);

const markPortalTiming = (timings, key, startedAt) => {
  timings[key] = nowMs() - startedAt;
};

const logPortalPerf = (endpoint, timings, meta = {}) => {
  logPerfTiming(endpoint, timings, meta);
};

const auditContextFromRequest = (req) => ({
  requestId: req.id,
  ip: req.headers["x-forwarded-for"]?.split?.(",")?.[0]?.trim?.() || req.ip || req.socket?.remoteAddress || "",
  userAgent: req.get?.("user-agent") || "",
  deviceId: req.get?.("x-device-id") || req.body?.device_id || req.body?.deviceId || req.query?.device_id || "",
  location: req.body?.location || {
    latitude: req.body?.latitude || req.query?.latitude,
    longitude: req.body?.longitude || req.query?.longitude,
    accuracy: req.body?.accuracy || req.query?.accuracy,
  },
});

const logVerificationDebug = ({ req, token, enteredIdentifier = "", employee = null, matchedEmployeeId = null, reason = "", matchedField = "", diagnostic = null }) => {
  if (!walletDebugEnabled()) return;
  console.info("[employee-payroll-portal] verification", {
    requestId: req.id,
    tokenSuffix: String(token || "").slice(-8),
    enteredIdentifier,
    matchedEmployeeId: matchedEmployeeId || employee?.id || null,
    tokenEmployeeId: employee?.id || null,
    tokenEmployeeCode: employee?.employee_code || null,
    tokenEmployeeStatus: employee?.status || null,
    tokenEmployeeHasPhone: Boolean(employee?.phone || employee?.mobile || employee?.phone_number),
    tokenEmployeeBranchId: employee?.branch_id || null,
    matchedField,
    failureReason: reason || "",
    diagnostic,
  });
};

const employeePortalDiagnostic = async ({ verification = "", employee = null } = {}) => {
  const diagnostic = await diagnoseEmployeePortalIdentifier(verification).catch((error) => ({
    reason: "employee_not_found",
    diagnostic_error: error?.message || String(error),
  }));
  return {
    reason: diagnostic.reason || "verification_failed",
    matched_employee_id: diagnostic.matched_employee_id || null,
    token_employee_id: employee?.id || null,
    identifier_matches_token_employee: String(diagnostic.matched_employee_id || "") === String(employee?.id || ""),
    matched_employee_code: diagnostic.employee?.employee_code || null,
    matched_employee_status: diagnostic.employee?.status || null,
    matched_employee_branch_id: diagnostic.employee?.branch_id || null,
    matched_employee_has_token: Boolean(diagnostic.employee?.employee_portal_token),
  };
};

const invalidTokenResponse = (req, res, token) => {
  logVerificationDebug({
    req,
    token,
    reason: "invalid_token",
  });
  return res.status(404).json({
    success: false,
    code: "invalid_token",
    message: "Invalid employee portal token",
  });
};

const employeeNotFoundResponse = (req, res, token) => {
  logVerificationDebug({
    req,
    token,
    reason: "employee_not_found",
  });
  return res.status(404).json({
    success: false,
    code: "employee_not_found",
    message: "Employee not found for this portal token",
  });
};

const verificationFailedResponse = (req, res, { token, employee, verification, failed }) => {
  const isLocked = failed.count >= maxFailedAttempts;
  logVerificationDebug({
    req,
    token,
    enteredIdentifier: verification,
    employee,
    matchedEmployeeId: employee?.id || null,
    reason: isLocked ? "too_many_attempts" : "verification_failed",
  });
  return res.status(isLocked ? 429 : 400).json({
    success: false,
    code: isLocked ? "too_many_attempts" : "verification_failed",
    message: isLocked ? "Too many verification attempts. Please try again later." : "Invalid employee phone or code",
    attempts_remaining: Math.max(0, maxFailedAttempts - failed.count),
  });
};

const loadVerifiedEmployee = async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (token.length < 32) {
    invalidTokenResponse(req, res, token);
    return null;
  }
  const employee = await loadEmployeePortalByToken(token);
  if (!employee) {
    employeeNotFoundResponse(req, res, token);
    return null;
  }
  const key = attemptKey(req);
  const currentAttempt = readAttempt(key);
  if (currentAttempt.count >= maxFailedAttempts) {
    res.status(429).json({
      success: false,
      message: "Too many verification attempts. Please try again later.",
      retry_after_seconds: Math.ceil((currentAttempt.resetAt - Date.now()) / 1000),
    });
    return null;
  }
  const verification = portalVerificationFromRequest(req);
  const verificationResult = getEmployeePortalVerificationResult(employee, verification);
  if (!verificationResult.ok) {
    const diagnostic = await employeePortalDiagnostic({ verification, employee });
    logVerificationDebug({
      req,
      token,
      enteredIdentifier: verification,
      employee,
      matchedEmployeeId: diagnostic.matched_employee_id,
      reason: diagnostic.reason,
      diagnostic,
    });
    const failed = recordFailure(key);
    verificationFailedResponse(req, res, { token, employee, verification, failed });
    return null;
  }
  logVerificationDebug({
    req,
    token,
    enteredIdentifier: verification,
    employee,
    matchedEmployeeId: employee.id,
    matchedField: verificationResult.matchedField,
  });
  failedAttempts.delete(key);
  return employee;
};

router.get("/:token", async (req, res) => {
  const totalStartedAt = nowMs();
  const timings = {};
  try {
    const token = String(req.params.token || "").trim();
    if (token.length < 32) return invalidTokenResponse(req, res, token);

    let sectionStartedAt = nowMs();
    const employee = await loadEmployeePortalByToken(token);
    markPortalTiming(timings, "token_lookup_ms", sectionStartedAt);
    if (!employee) {
      timings.total_ms = nowMs() - totalStartedAt;
      logPortalPerf("GET /api/employee-portal/:token", timings, { requestId: req.id, failed: true, reason: "employee_not_found" });
      return employeeNotFoundResponse(req, res, token);
    }

    const key = attemptKey(req);
    const currentAttempt = readAttempt(key);
    if (currentAttempt.count >= maxFailedAttempts) {
      timings.total_ms = nowMs() - totalStartedAt;
      logPortalPerf("GET /api/employee-portal/:token", timings, { requestId: req.id, failed: true, reason: "too_many_attempts" });
      return res.status(429).json({
        success: false,
        message: "Too many verification attempts. Please try again later.",
        retry_after_seconds: Math.ceil((currentAttempt.resetAt - Date.now()) / 1000),
      });
    }

    const verification = portalVerificationFromRequest(req);
    if (!verification) {
      timings.total_ms = nowMs() - totalStartedAt;
      logPortalPerf("GET /api/employee-portal/:token", timings, { requestId: req.id, requires_verification: true });
      return res.json({
        success: true,
        requires_verification: true,
        message: "Enter employee phone number or employee code to unlock payroll.",
      });
    }

    sectionStartedAt = nowMs();
    const verificationResult = getEmployeePortalVerificationResult(employee, verification);
    markPortalTiming(timings, "verification_ms", sectionStartedAt);
    if (!verificationResult.ok) {
      const diagnostic = await employeePortalDiagnostic({ verification, employee });
      logVerificationDebug({
        req,
        token,
        enteredIdentifier: verification,
        employee,
        matchedEmployeeId: diagnostic.matched_employee_id,
        reason: diagnostic.reason,
        diagnostic,
      });
      const failed = recordFailure(key);
      timings.total_ms = nowMs() - totalStartedAt;
      logPortalPerf("GET /api/employee-portal/:token", timings, { requestId: req.id, failed: true, reason: "verification_failed" });
      return verificationFailedResponse(req, res, { token, employee, verification, failed });
    }

    logVerificationDebug({
      req,
      token,
      enteredIdentifier: verification,
      employee,
      matchedEmployeeId: employee.id,
      matchedField: verificationResult.matchedField,
    });
    await recordEmployeePortalAudit({
      employee,
      action: "login",
      audit: auditContextFromRequest(req),
      metadata: { matched_field: verificationResult.matchedField },
    });
    failedAttempts.delete(key);
    const includeOptional = ["1", "true", "yes", "on"].includes(String(req.query.include_optional || req.query.includeOptional || "").toLowerCase());
    const portal = await buildEmployeePayrollPortalPayload({
      employee,
      includeOptional,
      timings,
      timeZone: req.query.timezone || req.query.time_zone || req.query.tz || "Africa/Cairo",
    });
    timings.total_ms = nowMs() - totalStartedAt;
    logPortalPerf("GET /api/employee-portal/:token", timings, {
      requestId: req.id,
      employeeId: employee.id,
      includeOptional,
    });
    return res.json({
      success: true,
      requires_verification: false,
      warnings: portal.warnings || [],
      portal,
    });
  } catch (error) {
    timings.total_ms = nowMs() - totalStartedAt;
    logPortalPerf("GET /api/employee-portal/:token", timings, {
      requestId: req.id,
      failed: true,
    });
    console.error("[employee-payroll-portal] public load error", error);
    return res.status(500).json({ success: false, message: "Failed to load employee portal" });
  }
});

router.post("/:token/requests", async (req, res) => {
  const totalStartedAt = nowMs();
  const timings = {};
  try {
    let sectionStartedAt = nowMs();
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    markPortalTiming(timings, "verify_ms", sectionStartedAt);
    sectionStartedAt = nowMs();
    const request = await createEmployeePortalRequest({ employee, data: req.body || {}, audit: auditContextFromRequest(req) });
    markPortalTiming(timings, "create_request_ms", sectionStartedAt);
    sectionStartedAt = nowMs();
    const portal = await buildEmployeePayrollPortalPayload({
      employee,
      timeZone: req.body?.timezone || req.body?.time_zone || req.body?.tz || "Africa/Cairo",
    });
    markPortalTiming(timings, "payload_ms", sectionStartedAt);
    timings.total_ms = nowMs() - totalStartedAt;
    logPortalPerf("POST /api/employee-portal/:token/requests", timings, { requestId: req.id, employeeId: employee.id });
    return res.status(201).json({ success: true, request, portal });
  } catch (error) {
    timings.total_ms = nowMs() - totalStartedAt;
    logPortalPerf("POST /api/employee-portal/:token/requests", timings, { requestId: req.id, failed: true });
    console.error("[employee-payroll-portal] request create error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create request" });
  }
});

router.post("/:token/attendance/actions", async (req, res) => {
  const totalStartedAt = nowMs();
  const timings = {};
  if (isPerfDebugEnabled()) {
    console.info("[employee-portal-attendance] route hit", {
      requestId: req.id,
      token: req.params.token,
      action: req.body?.action || req.body?.action_type || "",
    });
  }
  try {
    let sectionStartedAt = nowMs();
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    markPortalTiming(timings, "verify_ms", sectionStartedAt);
    sectionStartedAt = nowMs();
    const result = await recordEmployeePortalAttendance({ employee, data: req.body || {}, audit: auditContextFromRequest(req) });
    markPortalTiming(timings, "attendance_write_ms", sectionStartedAt);
    sectionStartedAt = nowMs();
    const portal = await buildEmployeePayrollPortalPayload({
      employee,
      timeZone: req.body?.timezone || req.body?.time_zone || req.body?.tz || "Africa/Cairo",
    });
    markPortalTiming(timings, "payload_ms", sectionStartedAt);
    timings.total_ms = nowMs() - totalStartedAt;
    logPortalPerf("POST /api/employee-portal/:token/attendance/actions", timings, { requestId: req.id, employeeId: employee.id });
    const debug = walletDebugEnabled()
      ? {
          debug: {
            requestId: req.id,
            employeeId: employee.id,
            branchId: result.branch?.id || null,
            action: result.action,
            attendanceId: result.attendance?.id || null,
            source: "employee_portal",
          },
        }
      : {};
    if (walletDebugEnabled()) {
      console.info("[employee-portal-attendance] response", debug.debug);
    }
    return res.status(201).json({ success: true, ...result, portal, ...debug });
  } catch (error) {
    timings.total_ms = nowMs() - totalStartedAt;
    logPortalPerf("POST /api/employee-portal/:token/attendance/actions", timings, { requestId: req.id, failed: true });
    const debug = walletDebugEnabled()
      ? {
          debug: {
            requestId: req.id,
            code: error.code || "",
            status: error.status || 500,
            message: error.message || "",
            source: "employee_portal",
          },
        }
      : {};
    if (walletDebugEnabled()) {
      console.error("[employee-portal-attendance] error response", error);
    }
    return res.status(error.status || 500).json({
      success: false,
      code: error.code,
      message: error.message || "Failed to record attendance",
      message_ar: error.message_ar || error.message || "تعذر تسجيل الحضور",
      gps: error.gps,
      ...debug,
    });
  }
});

router.patch("/:token/tasks/:id/status", async (req, res) => {
  const totalStartedAt = nowMs();
  const timings = {};
  try {
    let sectionStartedAt = nowMs();
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    markPortalTiming(timings, "verify_ms", sectionStartedAt);
    sectionStartedAt = nowMs();
    const task = await updateEmployeeWalletTaskStatus({
      employee,
      taskId: req.params.id,
      data: req.body || {},
      audit: auditContextFromRequest(req),
    });
    markPortalTiming(timings, "task_update_ms", sectionStartedAt);
    sectionStartedAt = nowMs();
    const portal = await buildEmployeePayrollPortalPayload({
      employee,
      timeZone: req.body?.timezone || req.body?.time_zone || req.body?.tz || "Africa/Cairo",
    });
    markPortalTiming(timings, "payload_ms", sectionStartedAt);
    timings.total_ms = nowMs() - totalStartedAt;
    logPortalPerf("PATCH /api/employee-portal/:token/tasks/:id/status", timings, { requestId: req.id, employeeId: employee.id });
    return res.json({ success: true, task, portal });
  } catch (error) {
    timings.total_ms = nowMs() - totalStartedAt;
    logPortalPerf("PATCH /api/employee-portal/:token/tasks/:id/status", timings, { requestId: req.id, failed: true });
    console.error("[employee-payroll-portal] task action error", error);
    return res.status(error.status || error.statusCode || 500).json({ success: false, code: error.code, message: error.message || "Failed to update task" });
  }
});

router.get("/:token/push/public-key", getEmployeePortalPushKey);
router.post("/:token/push/subscribe", subscribeEmployeePortalPushEndpoint);
router.delete("/:token/push/unsubscribe", unsubscribeEmployeePortalPushEndpoint);

export default router;
