import express from "express";
import {
  buildEmployeePayrollPortalPayload,
  createEmployeePortalRequest,
  getEmployeePortalPushPublicKey,
  loadEmployeePortalByToken,
  recordEmployeePortalAudit,
  recordEmployeePortalAttendance,
  subscribeEmployeePortalPush,
  unsubscribeEmployeePortalPush,
  updateEmployeeWalletTaskStatus,
} from "../services/employeePayrollPortalService.js";
import { isPerfDebugEnabled, logPerfTiming } from "../utils/perfDebug.js";

const router = express.Router();
const invalidPortalLinkMessage = "Invalid employee portal link. Please request a new link from management.";

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

const logPortalTokenDebug = ({ req, token, employee = null, reason = "" }) => {
  if (!walletDebugEnabled()) return;
  console.info("[employee-payroll-portal] token-auth", {
    requestId: req.id,
    tokenSuffix: String(token || "").slice(-8),
    employeeId: employee?.id || null,
    tokenEmployeeId: employee?.id || null,
    tokenEmployeeCode: employee?.employee_code || null,
    tokenEmployeeStatus: employee?.status || null,
    tokenEmployeeBranchId: employee?.branch_id || null,
    failureReason: reason || "",
  });
};

const invalidTokenResponse = (req, res, token) => {
  logPortalTokenDebug({
    req,
    token,
    reason: "invalid_token",
  });
  return res.status(404).json({
    success: false,
    code: "invalid_token",
    message: invalidPortalLinkMessage,
  });
};

const employeePortalManifest = (token) => ({
  name: "بوابة الموظف",
  short_name: "الموظف",
  description: "بوابة الموظف لمتابعة المهام والطلبات والراتب.",
  start_url: `/employee-portal/${encodeURIComponent(token)}?source=pwa`,
  scope: "/employee-portal/",
  display: "standalone",
  orientation: "portrait",
  dir: "rtl",
  lang: "ar",
  background_color: "#f1f5f9",
  theme_color: "#0f172a",
  icons: [
    {
      src: "/icons/employee-portal-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: "/icons/employee-portal-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: "/apple-touch-icon.png",
      sizes: "180x180",
      type: "image/png",
      purpose: "any",
    },
  ],
});

const employeeNotFoundResponse = (req, res, token) => {
  logPortalTokenDebug({
    req,
    token,
    reason: "employee_not_found",
  });
  return res.status(404).json({
    success: false,
    code: "employee_not_found",
    message: invalidPortalLinkMessage,
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
  logPortalTokenDebug({
    req,
    token,
    employee,
  });
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

    await recordEmployeePortalAudit({
      employee,
      action: "token_login",
      audit: auditContextFromRequest(req),
      metadata: { matched_field: "employee_portal_token" },
    });
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
      token_authenticated: true,
    });
    return res.json({
      success: true,
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

router.get("/:token/manifest.webmanifest", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.json(employeePortalManifest(String(req.params.token || "").trim()));
  } catch (error) {
    console.error("[employee-payroll-portal] manifest error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load employee portal manifest" });
  }
});

router.get("/:token/push/public-key", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const payload = await getEmployeePortalPushPublicKey();
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("[employee-payroll-portal] push key error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load push key" });
  }
});

router.post("/:token/push/subscribe", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const result = await subscribeEmployeePortalPush({
      employee,
      subscription: req.body?.subscription || req.body || {},
      userAgent: req.get?.("user-agent") || "",
      portalUrl: req.body?.portal_url || req.body?.portalUrl || "",
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("[employee-payroll-portal] push subscribe error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to save push subscription" });
  }
});

router.post("/:token/push/unsubscribe", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const subscription = req.body?.subscription || {};
    const result = await unsubscribeEmployeePortalPush({
      employee,
      endpoint: req.body?.endpoint || subscription.endpoint || "",
    });
    return res.json({ success: true, subscription: result });
  } catch (error) {
    console.error("[employee-payroll-portal] push unsubscribe error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to remove push subscription" });
  }
});

router.delete("/:token/push/unsubscribe", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const result = await unsubscribeEmployeePortalPush({
      employee,
      endpoint: req.body?.endpoint || req.query?.endpoint || "",
    });
    return res.json({ success: true, subscription: result });
  } catch (error) {
    console.error("[employee-payroll-portal] push unsubscribe error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to remove push subscription" });
  }
});

export default router;
