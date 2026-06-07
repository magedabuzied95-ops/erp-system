import express from "express";
import employeeChatUpload from "../config/employeeChatUpload.js";
import {
  buildEmployeePayrollPortalPayload,
  createEmployeePortalRequest,
  getEmployeePortalPushSubscriptionDebug,
  getEmployeePortalPushPublicKey,
  inspectEmployeePortalTokenMatch,
  loadEmployeePortalByToken,
  recordEmployeePortalAudit,
  recordEmployeePortalAttendance,
  subscribeEmployeePortalPush,
  unsubscribeEmployeePortalPush,
  updateEmployeeWalletTaskStatus,
} from "../services/employeePayrollPortalService.js";
import { loadEmployeePortalProducts } from "../services/employeePortalProductsService.js";
import { getEmployeeChat, sendEmployeeChatMessage } from "../services/employeeChatService.js";
import {
  listDisplayRefillAlertsForEmployee,
  listRecentDisplayRefillAlerts,
  markDisplayRefillAlertRead,
  resolveDisplayRefillAlert,
} from "../services/displayRefillAlertService.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { emitToRooms } from "../utils/socket.js";
import { isPerfDebugEnabled, logPerfTiming } from "../utils/perfDebug.js";

const router = express.Router();
const invalidPortalLinkMessage = "رابط بوابة الموظف غير صحيح أو تم تغييره. اطلب رابط جديد من الإدارة.";

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
    tokenLength: String(token || "").length,
    tokenPrefix: String(token || "").slice(0, 6),
    employeeId: employee?.id || null,
    tokenEmployeeId: employee?.id || null,
    tokenEmployeeCode: employee?.employee_code || null,
    tokenEmployeeStatus: employee?.status || null,
    tokenEmployeeBranchId: employee?.branch_id || null,
    failureReason: reason || "",
  });
};

const portalRoutePath = (req) => `${req.baseUrl || ""}${req.route?.path || req.path || ""}`;
const clean = (value = "") => String(value || "").trim();

const logInvalidTokenFailure = async ({ req, token, reason = "" }) => {
  const matched = token ? await inspectEmployeePortalTokenMatch(token).catch(() => null) : null;
  console.warn("[employee-portal:token-invalid]", {
    requestId: req.id,
    tokenLength: String(token || "").length,
    tokenPrefix: String(token || "").slice(0, 6),
    routePath: portalRoutePath(req),
    anyEmployeeMatchedToken: Boolean(matched),
    matchedEmployeeActive: matched ? Boolean(matched.is_active) : null,
    matchedEmployeeDeleted: matched ? Boolean(matched.is_deleted) : null,
    matchedEmployeeStatus: matched?.status || null,
    reason,
  });
};

const invalidTokenResponse = async (req, res, token) => {
  logPortalTokenDebug({
    req,
    token,
    reason: "invalid_token",
  });
  await logInvalidTokenFailure({ req, token, reason: "invalid_token" });
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
  start_url: `/employee-app/${encodeURIComponent(token)}?source=pwa`,
  scope: "/employee-app/",
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

const employeeNotFoundResponse = async (req, res, token) => {
  logPortalTokenDebug({
    req,
    token,
    reason: "employee_not_found",
  });
  await logInvalidTokenFailure({ req, token, reason: "employee_not_found" });
  return res.status(404).json({
    success: false,
    code: "employee_not_found",
    message: invalidPortalLinkMessage,
  });
};

router.get("/debug/subscriptions/:employeeId", protect, permit("employees", "view"), async (req, res) => {
  try {
    const debug = await getEmployeePortalPushSubscriptionDebug({ employeeId: req.params.employeeId });
    return res.json({ success: true, ...debug });
  } catch (error) {
    console.error("[employee-payroll-portal] subscription debug error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load push subscription debug" });
  }
});

const loadVerifiedEmployee = async (req, res) => {
  const token = String(req.params.token || "");
  if (!token) {
    await invalidTokenResponse(req, res, token);
    return null;
  }
  const employee = await loadEmployeePortalByToken(token);
  if (!employee) {
    await employeeNotFoundResponse(req, res, token);
    return null;
  }
  logPortalTokenDebug({
    req,
    token,
    employee,
  });
  return employee;
};

const verifyEmployeePortalToken = async (req, res, next) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    req.employeePortalEmployee = employee;
    next();
  } catch (error) {
    next(error);
  }
};

const uploadEmployeeChatAttachment = (req, res, next) => {
  employeeChatUpload.single("attachment")(req, res, (error) => {
    if (!error) return next();
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "chat_attachment_invalid",
      message: error.code === "LIMIT_FILE_SIZE" ? "Attachment is too large" : error.message || "Unsupported attachment",
    });
  });
};

router.get("/:token/chat", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const chat = await getEmployeeChat({ employee });
    return res.json({ success: true, ...chat });
  } catch (error) {
    console.error("[employee-payroll-portal] chat load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load chat" });
  }
});

router.get("/:token/products", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const payload = await loadEmployeePortalProducts({ employee, query: req.query || {} });
    console.info("[employee-portal-products:fixed-query]", {
      requestId: req.id,
      employeeId: employee.id ?? null,
      productCount: Array.isArray(payload.products) ? payload.products.length : 0,
    });
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("[employee-payroll-portal] product browser load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load employee products" });
  }
});

router.post("/:token/warehouse-request", verifyEmployeePortalToken, async (req, res) => {
  try {
    const employee = req.employeePortalEmployee;
    const productId = Number(req.body?.productId || req.body?.product_id || 0);
    const color = clean(req.body?.color || req.body?.selectedColor || "");
    const size = clean(req.body?.size || req.body?.requested_size || req.body?.selectedSize || "");
    const quantity = Math.max(1, Number(req.body?.quantity || req.body?.requested_quantity || 1));

    if (!productId) {
      return res.status(422).json({ success: false, code: "invalid_product", message: "Product is required" });
    }

    const payload = await loadEmployeePortalProducts({
      employee,
      query: {
        productId,
        limit: 1,
      },
    });

    const product = Array.isArray(payload.products) ? payload.products.find((item) => Number(item.id) === productId) : null;
    if (!product) {
      return res.status(404).json({ success: false, code: "product_not_found", message: "Product not found" });
    }

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const selectedVariant = variants.find(
      (variant) => clean(variant.color || "") === color && clean(variant.size || "") === size
    );

    if (!selectedVariant) {
      return res.status(422).json({ success: false, code: "variant_not_found", message: "Selected color/size was not found" });
    }

    const stock = Number(selectedVariant.stock || 0);
    if (Number.isFinite(stock) && stock <= 0) {
      return res.status(409).json({ success: false, code: "out_of_stock", message: "Selected size is out of stock" });
    }

    const alertPayload = {
      productId: product.id ?? product.product_id ?? null,
      productName: product.name || product.product_name || "Product",
      productImage: product.image_url || product.product_image_url || "",
      color: selectedVariant.color || color,
      size: selectedVariant.size || size,
      stock,
      article_code: product.article_code || selectedVariant.article_code || "",
      manufacturer_name: product.manufacturer_name || selectedVariant.manufacturer_name || "",
      sellerName: employee.full_name || employee.name || "Employee",
      employeeName: employee.full_name || employee.name || "Employee",
      employeeId: employee.id ?? null,
      branchId: employee.branch_id ?? null,
      quantity,
      requested_quantity: quantity,
      requested_size: selectedVariant.size || size,
      timestamp: new Date().toISOString(),
    };

    emitToRooms([], "warehouse-pick-alert", alertPayload);
    console.info("[employee-portal-warehouse-request:fixed-query]", {
      requestId: req.id,
      employeeId: employee.id ?? null,
      productId,
      color,
      size,
      quantity,
    });

    return res.status(201).json({
      success: true,
      alert: alertPayload,
    });
  } catch (error) {
    console.error("[employee-payroll-portal] warehouse request error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to send warehouse request" });
  }
});

router.post("/:token/chat/messages", verifyEmployeePortalToken, uploadEmployeeChatAttachment, async (req, res) => {
  try {
    const employee = req.employeePortalEmployee;
    const result = await sendEmployeeChatMessage({
      employee,
      body: req.body?.body || req.body?.message || "",
      file: req.file || null,
      replyToMessageId: req.body?.reply_to_message_id || req.body?.replyToMessageId || null,
      attachmentDurationSeconds: req.body?.attachment_duration_seconds || req.body?.duration || null,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("[employee-payroll-portal] chat message error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to send message" });
  }
});

router.get("/debug/display-refill-alerts", protect, permit("employees", "view"), async (req, res) => {
  try {
    const employeeId = req.query.employee_id || req.query.employeeId || null;
    const branchId = req.query.branch_id || req.query.branchId || null;
    const latestAlerts = await listRecentDisplayRefillAlerts({ limit: 20 });
    const pendingAlerts = latestAlerts.filter((alert) => alert.status === "pending");
    const scopeSummary = latestAlerts.reduce((acc, alert) => {
      const key = `${alert.tenant_id ?? "null"}:${alert.branch_id ?? "null"}:${alert.employee_id ?? "branch"}`;
      if (!acc[key]) {
        acc[key] = {
          tenant_id: alert.tenant_id ?? null,
          branch_id: alert.branch_id ?? null,
          employee_id: alert.employee_id ?? null,
          scope: alert.employee_id ? "employee" : "branch",
          total: 0,
          pending: 0,
        };
      }
      acc[key].total += 1;
      if (String(alert.status || "pending") === "pending") acc[key].pending += 1;
      return acc;
    }, {});
    return res.json({
      success: true,
      employee_id: employeeId ? Number(employeeId) : null,
      branch_id: branchId ? Number(branchId) : null,
      latest_alerts: latestAlerts,
      pending_count: pendingAlerts.length,
      scope_summary: Object.values(scopeSummary),
      note: "Decision logs are not persisted; inspect server console for runtime [display-refill-alert:*] logs.",
    });
  } catch (error) {
    console.error("[employee-payroll-portal] display refill debug load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load display refill debug data" });
  }
});

router.get("/:token", async (req, res) => {
  const totalStartedAt = nowMs();
  const timings = {};
  try {
    const token = String(req.params.token || "");
    if (!token) return await invalidTokenResponse(req, res, token);

    let sectionStartedAt = nowMs();
    const employee = await loadEmployeePortalByToken(token);
    markPortalTiming(timings, "token_lookup_ms", sectionStartedAt);
    if (!employee) {
      timings.total_ms = nowMs() - totalStartedAt;
      logPortalPerf("GET /api/employee-portal/:token", timings, { requestId: req.id, failed: true, reason: "employee_not_found" });
      return await employeeNotFoundResponse(req, res, token);
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

router.get("/:token/display-refill-alerts", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const branchId = employee.branch_id || employee.branchId || null;
    const tenantId = employee.tenant_id || employee.tenantId || null;
    const alerts = await listDisplayRefillAlertsForEmployee({
      employeeId: employee.id,
      tenantId,
      branchId,
      limit: req.query.limit || 50,
      status: req.query.status || "all",
    });
    console.info("[display-refill-alert:employee-load]", {
      tenant_id: tenantId,
      employee_id: employee.id,
      branch_id: branchId,
      count: alerts.length,
      pending_count: alerts.filter((item) => item.status === "pending").length,
      completed_count: alerts.filter((item) => item.status === "resolved").length,
      branch_level_count: alerts.filter((item) => !item.employee_id && item.branch_id).length,
      employee_assigned_count: alerts.filter((item) => item.employee_id).length,
      fallback_used: !branchId,
      fallback_reason: branchId ? "" : "employee_branch_id_missing",
    });
    return res.json({
      success: true,
      alerts,
      pending_unread_count: alerts.filter((item) => item.status === "pending" && !item.is_read).length,
      completed_count: alerts.filter((item) => item.status === "resolved").length,
    });
  } catch (error) {
    console.error("[employee-payroll-portal] display refill alerts load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load display refill alerts" });
  }
});

router.patch("/:token/display-refill-alerts/:alertId/read", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const alert = await markDisplayRefillAlertRead({
      employeeId: employee.id,
      tenantId: employee.tenant_id || employee.tenantId || null,
      branchId: employee.branch_id || employee.branchId || null,
      alertId: req.params.alertId,
    });
    if (!alert) return res.status(404).json({ success: false, message: "Display refill alert not found" });
    return res.json({ success: true, alert });
  } catch (error) {
    console.error("[employee-payroll-portal] display refill read error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to mark display refill alert read" });
  }
});

router.patch("/:token/display-refill-alerts/:alertId/resolve", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const alert = await resolveDisplayRefillAlert({
      employeeId: employee.id,
      tenantId: employee.tenant_id || employee.tenantId || null,
      branchId: employee.branch_id || employee.branchId || null,
      alertId: req.params.alertId,
    });
    if (!alert) return res.status(404).json({ success: false, message: "Display refill alert not found" });
    return res.json({ success: true, alert });
  } catch (error) {
    console.error("[employee-payroll-portal] display refill resolve error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to resolve display refill alert" });
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
    return res.json(employeePortalManifest(String(req.params.token || "")));
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
    console.info("[employee-push:public-key]", {
      hasKey: Boolean(payload.publicKey),
      keyLength: String(payload.publicKey || "").length,
    });
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
    console.info("[employee-push:subscribe-request]", {
      employee_id: employee.id,
      endpointHost: (() => {
        try {
          return new URL(String((req.body?.subscription || req.body || {}).endpoint || "")).host;
        } catch {
          return "";
        }
      })(),
      p256dhLength: String((req.body?.subscription || req.body || {}).keys?.p256dh || "").length,
      authLength: String((req.body?.subscription || req.body || {}).keys?.auth || "").length,
      applicationServerKeyLength: Number(req.body?.application_server_key_length || req.body?.applicationServerKeyLength || (req.body?.subscription || {}).application_server_key_length || 0) || 0,
    });
    const result = await subscribeEmployeePortalPush({
      employee,
      subscription: {
        ...(req.body?.subscription || req.body || {}),
        application_server_key_length: Number(req.body?.application_server_key_length || req.body?.applicationServerKeyLength || (req.body?.subscription || {}).application_server_key_length || 0) || 0,
      },
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
