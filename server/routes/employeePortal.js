import express from "express";
import db from "../database/db.js";
import employeeChatUpload from "../config/employeeChatUpload.js";
import employeeProfileUpload from "../config/employeeProfileUpload.js";
import {
  buildEmployeePayrollPortalPayload,
  createEmployeePortalRequest,
  getEmployeePortalPushSubscriptionDebug,
  getEmployeePortalPushPublicKey,
  inspectEmployeePortalTokenMatch,
  loadEmployeePortalByToken,
  markAllEmployeePortalNotificationsRead,
  markEmployeePortalNotificationRead,
  recordEmployeePortalAudit,
  recordEmployeePortalAttendance,
  refreshEmployeePayrollPortalMetadataCache,
  subscribeEmployeePortalPush,
  unsubscribeEmployeePortalPush,
  updateEmployeeWalletTaskStatus,
} from "../services/employeePayrollPortalService.js";
import { loadEmployeePortalProducts, loadEmployeePortalCompactProducts, loadEmployeePortalProductVariants, loadEmployeePortalFacets } from "../services/employeePortalProductsService.js";
import { loadEmployeeDisplayAudit, markEmployeeProductDisplayed } from "../services/employeeDisplayAuditService.js";
import {
  createInventoryCountSession,
  getInventoryCountSession,
  listInventoryCountSessions,
  openInventoryCountSession,
  reopenInventoryCountSession,
  searchInventoryCountVariants,
  submitInventoryCountSession,
  deleteInventoryCountColorGroup,
  updateInventoryCountSession,
  upsertInventoryCountItem,
} from "../services/inventoryCountService.js";
import {
  answerEmployeeChatRing,
  deleteEmployeeChatMessage,
  getEmployeeChat,
  sendEmployeeChatRing,
  reactEmployeeChatMessage,
  sendEmployeeChatMessage,
  updateEmployeeChatMessage,
} from "../services/employeeChatService.js";
import {
  listDisplayRefillAlertsForEmployee,
  isDisplayRefillSupervisor,
  listRecentDisplayRefillAlerts,
  markDisplayRefillAlertRead,
  resolveDisplayRefillAlert,
} from "../services/displayRefillAlertService.js";
import { getSettingsByCategory } from "../services/settingsService.js";
import { getSalesOpportunitiesForScope } from "../services/salesOpportunityService.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { emitToRooms } from "../utils/socket.js";
import { isPerfDebugEnabled, logPerfTiming } from "../utils/perfDebug.js";
import {
  barcodePrintSettingsFromValues,
  displayRefillBarcodeSettingsFromValues,
  normalizeBarcodePrintSettings,
  normalizeDisplayRefillBarcodeSettings,
} from "../../shared/barcodePrintSettings.js";

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
const normalizeId = (value) => (value === null || value === undefined || value === "" ? null : String(value));
const enrichInventoryImageFields = (row = {}) => {
  const imageUrl = clean(
    row.image_url ||
      row.image ||
      row.product_image ||
      row.color_image ||
      row.variant_image ||
      row.variant_image_url ||
      row.product_image_url ||
      row.color_image_url ||
      row.thumbnail_url ||
      row.photo_url ||
      ""
  );
  return {
    ...row,
    image_url: imageUrl,
    image: row.image || imageUrl,
    product_image: row.product_image || imageUrl,
    color_image: row.color_image || imageUrl,
    variant_image: row.variant_image || imageUrl,
    images: Array.isArray(row.images) && row.images.length ? row.images : imageUrl ? [imageUrl] : [],
  };
};
const normalizeColorKey = (value = "") => {
  const aliases = {
    black: "black",
    اسود: "black",
    أسود: "black",
    white: "white",
    ابيض: "white",
    أبيض: "white",
    red: "red",
    احمر: "red",
    أحمر: "red",
    blue: "blue",
    ازرق: "blue",
    أزرق: "blue",
    green: "green",
    اخضر: "green",
    أخضر: "green",
    yellow: "yellow",
    اصفر: "yellow",
    أصفر: "yellow",
    orange: "orange",
    purple: "purple",
    pink: "pink",
    brown: "brown",
    beige: "beige",
    gray: "gray",
    grey: "gray",
    رمادي: "gray",
    silver: "silver",
    فضي: "silver",
    gold: "gold",
    ذهبي: "gold",
    navy: "navy",
    كحلي: "navy",
    burgundy: "burgundy",
    maroon: "maroon",
    olive: "olive",
    زيتي: "olive",
    cream: "cream",
    كريمي: "cream",
    ivory: "ivory",
    camel: "camel",
    tan: "tan",
    mocha: "mocha",
    coffee: "coffee",
    charcoal: "charcoal",
    volt: "volt",
    cobalt: "cobalt",
    aqua: "aqua",
    mint: "mint",
    rose: "rose",
  };
  const normalized = clean(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return aliases[normalized] || normalized;
};

const findExactInventoryLookupRow = (rows = [], query = "") => {
  const normalizedSearch = clean(query).toLowerCase();
  if (!normalizedSearch) return null;
  return (
    rows.find((row) => Number(row.match_rank) === 0 && [
      row.barcode,
      row.sku,
      row.article_code,
      row.product_article_code,
      row.product_barcode,
      row.product_sku,
    ].some((value) => clean(value).toLowerCase() === normalizedSearch)) || null
  );
};

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
      src: "/icons/employee-portal-192.png?v=10",
      sizes: "192x192",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: "/icons/employee-portal-512.png?v=10",
      sizes: "512x512",
      type: "image/png",
      purpose: "any maskable",
    },
    {
      src: "/apple-touch-icon.png?v=10",
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

const uploadEmployeeProfilePhoto = (req, res, next) => {
  employeeProfileUpload.single("profile_photo")(req, res, (error) => {
    if (!error) return next();
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "employee_profile_image_invalid",
      message: error.code === "LIMIT_FILE_SIZE" ? "حجم الصورة يجب ألا يزيد عن 5 ميجابايت" : error.message,
    });
  });
};

router.patch("/:token/profile", verifyEmployeePortalToken, uploadEmployeeProfilePhoto, async (req, res) => {
  try {
    const employee = req.employeePortalEmployee;
    const mobile = clean(req.body?.mobile).replace(/[\s()-]/g, "");
    if (mobile && !/^01[0125]\d{8}$/.test(mobile)) {
      return res.status(400).json({ success: false, code: "employee_mobile_invalid", message: "أدخل رقم موبايل مصري صحيح" });
    }
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS mobile TEXT`);
    await db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo_url TEXT`);
    await refreshEmployeePayrollPortalMetadataCache(db);
    const photoUrl = req.file ? `/uploads/employee-profiles/${req.file.filename}` : clean(employee.photo_url);
    await db.query(
      `UPDATE employees SET mobile = $1, photo_url = COALESCE(NULLIF($2, ''), photo_url), updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
      [mobile, photoUrl, employee.id, employee.tenant_id]
    );
    const updatedEmployee = await loadEmployeePortalByToken(req.params.token);
    const portal = await buildEmployeePayrollPortalPayload({
      employee: updatedEmployee,
      timeZone: req.body?.timezone || "Africa/Cairo",
    });
    if (portal?.employee_profile && photoUrl) portal.employee_profile.photo_url = photoUrl;
    if (portal?.employee && photoUrl) portal.employee.photo_url = photoUrl;
    return res.json({
      success: true,
      portal,
      profile_photo_saved: Boolean(req.file),
      profile_photo_url: photoUrl,
    });
  } catch (error) {
    console.error("[employee-payroll-portal] profile update error", error);
    return res.status(500).json({ success: false, message: "تعذر حفظ بيانات الملف الشخصي" });
  }
});

const loadEmployeeInventorySession = async (req, res) => {
  const employee = await loadVerifiedEmployee(req, res);
  if (!employee) return null;
  if (!employee.branch_id) {
    res.status(400).json({
      success: false,
      code: "employee_branch_required",
      message: "Employee branch is required",
    });
    return null;
  }

  const sessionId = req.params?.sessionId || req.params?.id || req.body?.sessionId || req.body?.session_id;
  if (!sessionId) {
    res.status(400).json({ success: false, code: "inventory_count_session_required", message: "Inventory count session is required" });
    return null;
  }
  const result = await getInventoryCountSession(db, {
    tenantId: employee.tenant_id ?? null,
    sessionId,
  });
  if (!result?.session) {
    res.status(404).json({ success: false, code: "inventory_count_not_found", message: "Inventory count session not found" });
    return null;
  }
  if (normalizeId(result.session.branch_id) !== normalizeId(employee.branch_id)) {
    res.status(404).json({ success: false, code: "inventory_count_not_found", message: "Inventory count session not found" });
    return null;
  }

  return {
    employee,
    session: result.session,
    items: Array.isArray(result.items) ? result.items.map(enrichInventoryImageFields) : [],
  };
};

const loadEmployeePortalInventoryColorGroup = async ({ tenantId, productId, color }) => {
  if (!productId) return [];
  const result = await db.query(
    `
    SELECT
      v.id AS product_variant_id,
      v.product_id,
      p.name AS product_name,
      p.sku AS product_sku,
      p.barcode AS product_barcode,
      v.color,
      v.size,
      v.sku,
      v.barcode,
      v.article_code,
      COALESCE(v.stock, 0)::int AS stock,
      COALESCE(NULLIF(v.image_url, ''), NULLIF(p.image_url, ''), NULLIF(p.image, ''), '') AS image_url
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE ($1::bigint IS NULL OR v.tenant_id = $1::bigint OR v.tenant_id IS NULL)
      AND v.product_id = $2
      AND v.is_active IS DISTINCT FROM FALSE
      AND v.deleted_at IS NULL
    ORDER BY COALESCE(NULLIF(v.size, ''), ''), v.id ASC
    `,
    [tenantId, productId]
  );

  const targetColorKey = normalizeColorKey(color);
  return result.rows
    .map((row) => ({
      ...row,
      product_variant_id: row.product_variant_id ?? row.id,
      stock: Number(row.stock || 0),
    }))
    .filter((row) => normalizeColorKey(row.color) === targetColorKey);
};

const buildEmployeePortalFallbackPayload = (employee, timeZone = "Africa/Cairo", warnings = []) => {
  const now = new Date();
  const currentPeriod = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const fallbackEmployee = {
    id: employee.id,
    tenant_id: employee.tenant_id || null,
    tenantId: employee.tenant_id || null,
    name: employee.full_name || "",
    code: employee.employee_code || "",
    job_title: employee.job_title || employee.position || "",
    branch_id: employee.branch_id || null,
    branchId: employee.branch_id || null,
    branch: employee.branch_name || "",
    photo_url: "",
    avatar_url: "",
    image_url: "",
    profile_image: "",
    image: "",
    photo: "",
    employee_image: "",
    currentShift: null,
    shiftName: "",
    startTime: "",
    endTime: "",
    expectedHours: 0,
    workingDays: [],
  };
  return {
    employee_profile: {
      ...fallbackEmployee,
      avatar_initials: clean(employee.full_name).split(/\s+/).slice(0, 2).map((part) => part?.[0] || "").join("").toUpperCase(),
    },
    employee: fallbackEmployee,
    currentShift: null,
    shiftName: "",
    startTime: "",
    endTime: "",
    expectedHours: 0,
    workingDays: [],
    wallet_summary: {
      current_net_salary: null,
      total_advances: 0,
      pending_commissions: 0,
      total_deductions: 0,
      payroll_status: "draft",
    },
    recent_wallet_transactions: [],
    payslip: {
      employee_name: employee.full_name || "",
      employee_code: employee.employee_code || "",
      job_title: employee.job_title || employee.position || "",
      branch: employee.branch_name || "",
      payroll_period: currentPeriod,
      period_start: `${currentPeriod}-01`,
      period_end: `${currentPeriod}-01`,
      base_salary: Number(employee.salary || 0),
      commissions: 0,
      bonuses: 0,
      advances: 0,
      penalties: 0,
      absence_deduction: 0,
      other_deductions: 0,
      total_deductions: 0,
      net_salary: null,
      payroll_status: "draft",
      finalized_at: null,
      payroll_reference: "",
    },
    attendance: {
      summary: {
        records_count: 0,
        attended_days: 0,
        absence_days: 0,
        late_days: 0,
        missing_checkout_days: 0,
        overtime_hours: 0,
        late_minutes: 0,
        expected_working_days: 0,
        period_start: `${currentPeriod}-01`,
        period_end: `${currentPeriod}-01`,
        deducted_absence_amount: 0,
      },
      timeline: [],
    },
    employee_requests: [],
    notifications: [],
    unread_notifications_count: 0,
    tasks: [],
    task_summary: {
      today: 0,
      pending: 0,
      completed: 0,
      critical: 0,
    },
    qr_attendance: {
      enabled: true,
      branch_id: employee.branch_id || null,
      branch: employee.branch_name || "",
    },
    performance: {
      period: currentPeriod,
      score: { overall: 0, attendance: 0, sales: 0, punctuality: 0, customer_service: 0, penalties_impact: 0 },
      goals: { monthly_sales_target: 0, attendance_target_days: 0, branch_kpi_target: 0, sales_total: 0, attendance_days: 0, sales_progress: 0, attendance_progress: 0, branch_kpi_progress: 0 },
      reward_points: { points_balance: 0, rewards: [], badges: [], lazy: true, points_earned_this_month: 0 },
      achievements: [],
    },
    leaderboard: [],
    warnings,
    current_payroll_period: currentPeriod,
    payroll_generated: false,
    payroll_status: "draft",
    payment_status: "not_generated",
    base_salary: Number(employee.salary || 0),
    sales_commission: 0,
    commissions: 0,
    bonuses: 0,
    advances: 0,
    penalties: 0,
    absence_deduction: 0,
    other_deductions: 0,
    total_deductions: 0,
    net_salary: null,
    finalized_at: null,
    recent_advances: [],
    recent_attendance_summary: {
      records_count: 0,
      attended_days: 0,
      absence_days: 0,
      late_days: 0,
      missing_checkout_days: 0,
      overtime_hours: 0,
      late_minutes: 0,
      expected_working_days: 0,
      period_start: `${currentPeriod}-01`,
      period_end: `${currentPeriod}-01`,
      deducted_absence_amount: 0,
      missing_hours: 0,
      late_hours: 0,
    },
  };
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

// Compact product cards (no variant arrays / no images blobs / no price) — the
// fast Warehouse Request list + size-filter path. POS endpoint untouched.
router.get("/:token/products/compact", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const payload = await loadEmployeePortalCompactProducts({ employee, query: req.query || {} });
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("[employee-portal] compact products load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load products" });
  }
});

// Authoritative variants for a single product — fetched only when opened.
router.get("/:token/products/:productId/variants", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const inStockOnly = req.query.inStockOnly === undefined && req.query.in_stock_only === undefined
      ? true
      : ["1", "true", "yes", "on"].includes(String(req.query.inStockOnly ?? req.query.in_stock_only).toLowerCase());
    const payload = await loadEmployeePortalProductVariants({ employee, productId: req.params.productId, inStockOnly });
    return res.json({ success: true, ...payload });
  } catch (error) {
    console.error("[employee-portal] product variants load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load variants" });
  }
});

// Tiny filter facets (brands/types/genders/grades/sizes) — replaces the heavy
// limit=120 catalog download the Inventory Count page used for its filters.
router.get("/:token/facets", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const facets = await loadEmployeePortalFacets({ employee });
    return res.json({ success: true, facets });
  } catch (error) {
    console.error("[employee-portal] facets load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load facets" });
  }
});

router.get("/:token/display-audit", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    return res.json({ success: true, ...(await loadEmployeeDisplayAudit({ employee })) });
  } catch (error) {
    console.error("[employee-display-audit] load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load display audit" });
  }
});

router.patch("/:token/display-audit/:productId/displayed", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const product = await markEmployeeProductDisplayed({
      employee,
      productId: req.params.productId,
      audience: req.body?.audience,
      displayStageKey: req.body?.display_stage_key || req.body?.displayStageKey || "",
      colorGroupKey: req.body?.color_group_key || req.body?.colorGroupKey || "",
    });
    return res.json({ success: true, product });
  } catch (error) {
    console.error("[employee-display-audit] update error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to update display state" });
  }
});

router.get("/:token/sales-opportunities", async (req, res) => {
  let employee = null;
  try {
    employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const opportunities = await getSalesOpportunitiesForScope({
      tenantId: employee.tenant_id ?? null,
      branchId: employee.branch_id ?? null,
    });
    return res.json({ success: true, opportunities });
  } catch (error) {
    console.error("[employee-payroll-portal] sales opportunities load error", {
      route: "GET /api/employee-portal/:token/sales-opportunities",
      requestId: req.id ?? null,
      tenantId: employee?.tenant_id ?? null,
      branchId: employee?.branch_id ?? null,
      timeoutMs: Number(req.query?.timeoutMs || 0) || null,
      error: error?.message || String(error),
      code: error?.code || null,
    });
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load sales opportunities" });
  }
});

router.get("/:token/inventory/sessions", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    if (!employee.branch_id) {
      return res.status(400).json({ success: false, code: "employee_branch_required", message: "Employee branch is required" });
    }

    const result = await listInventoryCountSessions(db, {
      tenantId: employee.tenant_id ?? null,
      branchId: employee.branch_id,
      search: req.query?.search || "",
      status: req.query?.status || "",
      page: req.query?.page || 1,
      limit: req.query?.limit || 50,
    });

    const identity = { tenant_id: employee.tenant_id ?? null, employee_id: employee.id ?? null, branch_id: employee.branch_id ?? null };
    return res.json({ success: true, identity, ...result });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory sessions load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load inventory sessions" });
  }
});

router.post("/:token/inventory/sessions", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    if (!employee.branch_id) {
      return res.status(400).json({ success: false, code: "employee_branch_required", message: "Employee branch is required" });
    }

    const session = await createInventoryCountSession(db, {
      tenantId: employee.tenant_id ?? null,
      branchId: employee.branch_id,
      warehouseId: req.body?.warehouseId ?? req.body?.warehouse_id ?? null,
      title: req.body?.title || req.body?.session_title || "جرد جديد",
      notes: req.body?.notes || "",
      createdBy: employee.id || null,
    });

    return res.status(201).json({ success: true, session });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory create error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to create inventory session" });
  }
});

router.get("/:token/inventory/sessions/:sessionId", async (req, res) => {
  try {
    const scoped = await loadEmployeeInventorySession(req, res);
    if (!scoped) return;
    // Token-free stable identity for the client's local draft namespace.
    const identity = {
      tenant_id: scoped.employee?.tenant_id ?? scoped.session?.tenant_id ?? null,
      employee_id: scoped.employee?.id ?? null,
      branch_id: scoped.employee?.branch_id ?? scoped.session?.branch_id ?? null,
    };
    return res.json({
      success: true,
      identity,
      session: scoped.session,
      items: Array.isArray(scoped.items) ? scoped.items.map(enrichInventoryImageFields) : [],
    });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory session load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load inventory session" });
  }
});

router.patch("/:token/inventory/sessions/:sessionId", async (req, res) => {
  try {
    const scoped = await loadEmployeeInventorySession(req, res);
    if (!scoped) return;
    const session = await updateInventoryCountSession(db, {
      tenantId: scoped.employee.tenant_id ?? null,
      sessionId: scoped.session.id,
      branchId: scoped.employee.branch_id,
      warehouseId: req.body?.warehouseId ?? req.body?.warehouse_id ?? null,
      title: req.body?.title ?? req.body?.session_title,
      notes: req.body?.notes,
    });
    return res.json({ success: true, session });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory update error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to update inventory session" });
  }
});

router.post("/:token/inventory/sessions/:sessionId/open", async (req, res) => {
  try {
    const scoped = await loadEmployeeInventorySession(req, res);
    if (!scoped) return;
    const session = await openInventoryCountSession(db, {
      tenantId: scoped.employee.tenant_id ?? null,
      sessionId: scoped.session.id,
      openedBy: scoped.employee.id || null,
    });
    return res.json({ success: true, session });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory open error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to open inventory session" });
  }
});

router.get("/:token/inventory/sessions/:sessionId/lookup", async (req, res) => {
  try {
    const scoped = await loadEmployeeInventorySession(req, res);
    if (!scoped) return;
    const result = await searchInventoryCountVariants(db, {
      tenantId: scoped.employee.tenant_id ?? null,
      query: req.query?.query || req.query?.search || req.query?.term || "",
      limit: req.query?.limit || 15,
    });
    const queryText = clean(req.query?.query || req.query?.search || req.query?.term || "");
    const items = Array.isArray(result?.items) ? result.items : [];
    const exactRow = findExactInventoryLookupRow(items, queryText);
    if (exactRow?.product_id) {
      const colorGroup = await loadEmployeePortalInventoryColorGroup({
        tenantId: scoped.employee.tenant_id ?? null,
        productId: exactRow.product_id,
        color: exactRow.color,
      });
      if (colorGroup.length) {
        return res.json({
          success: true,
          items: colorGroup.map(enrichInventoryImageFields),
        });
      }
    }
    return res.json({
      success: true,
      items: Array.isArray(items) ? items.map(enrichInventoryImageFields) : [],
      resolvedProductId: result?.resolvedProductId ?? null,
      resolvedVariantId: result?.resolvedVariantId ?? null,
      matchedBy: result?.matchedBy || "",
      resolutionType: result?.resolutionType || "",
      queryText: result?.queryText || queryText,
    });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory lookup error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to search inventory session" });
  }
});

router.put("/:token/inventory/sessions/:sessionId/items", async (req, res) => {
  try {
    const scoped = await loadEmployeeInventorySession(req, res);
    if (!scoped) return;
    const result = await upsertInventoryCountItem(db, {
      tenantId: scoped.employee.tenant_id ?? null,
      sessionId: scoped.session.id,
      productVariantId: req.body?.productVariantId ?? req.body?.product_variant_id ?? req.body?.variantId ?? req.body?.variant_id,
      countedQuantity: req.body?.countedQuantity ?? req.body?.counted_quantity,
      systemQuantity: req.body?.systemQuantity ?? req.body?.system_quantity,
      reason: req.body?.reason || "",
      notes: req.body?.notes || "",
      userId: scoped.employee.id || null,
    });
    return res.json({ success: true, session: result.session, item: result.item });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory item save error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to save inventory item" });
  }
});

router.delete("/:token/inventory/sessions/:sessionId/color-groups", async (req, res) => {
  try {
    const scoped = await loadEmployeeInventorySession(req, res);
    if (!scoped) return;
    const result = await deleteInventoryCountColorGroup(db, {
      tenantId: scoped.employee.tenant_id ?? null,
      sessionId: scoped.session.id,
      productId: req.body?.productId ?? req.body?.product_id ?? req.query?.productId ?? req.query?.product_id,
      color: req.body?.color ?? req.body?.color_name ?? req.query?.color ?? req.query?.color_name ?? "",
    });
    return res.json({
      success: true,
      session: result.session,
      items: Array.isArray(result.items) ? result.items.map(enrichInventoryImageFields) : [],
      deletedCount: result.deletedCount || 0,
    });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory color group delete error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to delete inventory color group" });
  }
});

router.post("/:token/inventory/sessions/:sessionId/submit", async (req, res) => {
  try {
    const scoped = await loadEmployeeInventorySession(req, res);
    if (!scoped) return;
    const result = await submitInventoryCountSession(db, {
      tenantId: scoped.employee.tenant_id ?? null,
      sessionId: scoped.session.id,
      submittedBy: scoped.employee.id || null,
      user: { id: scoped.employee.id || null, role: scoped.employee.role || scoped.employee.role_name || "" },
    });
    return res.json({ success: true, session: result.session, submitted: result.submitted === true });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory submit error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to submit inventory session" });
  }
});

router.post("/:token/inventory/sessions/:sessionId/reopen", async (req, res) => {
  try {
    const scoped = await loadEmployeeInventorySession(req, res);
    if (!scoped) return;
    const result = await reopenInventoryCountSession(db, {
      tenantId: scoped.employee.tenant_id ?? null,
      sessionId: scoped.session.id,
      reopenedBy: scoped.employee.id || null,
      user: { id: scoped.employee.id || null, role: scoped.employee.role || scoped.employee.role_name || "" },
    });
    return res.json({ success: true, session: result.session, reopened: result.reopened === true });
  } catch (error) {
    console.error("[employee-payroll-portal] inventory reopen error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to reopen inventory session" });
  }
});

router.post("/:token/warehouse-request", verifyEmployeePortalToken, async (req, res) => {
  try {
    const employee = req.employeePortalEmployee;
    const productId = Number(req.body?.productId || req.body?.product_id || 0);
    const variantId = Number(req.body?.variantId || req.body?.variant_id || 0);
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
    const selectedVariant =
      (variantId && variants.find((variant) => Number(variant.variant_id ?? variant.id ?? 0) === variantId)) ||
      variants.find((variant) => clean(variant.color || "") === color && clean(variant.size || "") === size);

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

router.post("/:token/chat/ring", verifyEmployeePortalToken, async (req, res) => {
  try {
    const result = await sendEmployeeChatRing({ employee: req.employeePortalEmployee });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    if (!error.status) console.error("[employee-payroll-portal] chat ring error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to ring" });
  }
});

router.post("/:token/chat/ring/:messageId/answer", verifyEmployeePortalToken, async (req, res) => {
  try {
    const result = await answerEmployeeChatRing({ employee: req.employeePortalEmployee, messageId: req.params.messageId });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (!error.status) console.error("[employee-payroll-portal] chat ring answer error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to answer ring" });
  }
});

router.post("/:token/chat/messages/:messageId/reaction", verifyEmployeePortalToken, async (req, res) => {
  try {
    const result = await reactEmployeeChatMessage({ employee: req.employeePortalEmployee, messageId: req.params.messageId, emoji: req.body?.emoji });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to react to message" });
  }
});

router.patch("/:token/chat/messages/:messageId", verifyEmployeePortalToken, async (req, res) => {
  try {
    const result = await updateEmployeeChatMessage({
      employee: req.employeePortalEmployee,
      messageId: req.params.messageId,
      body: req.body?.body || req.body?.message || "",
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to update message" });
  }
});

router.delete("/:token/chat/messages/:messageId", verifyEmployeePortalToken, async (req, res) => {
  try {
    const result = await deleteEmployeeChatMessage({ employee: req.employeePortalEmployee, messageId: req.params.messageId });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to delete message" });
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

    try {
      await recordEmployeePortalAudit({
        employee,
        action: "token_login",
        audit: auditContextFromRequest(req),
        metadata: { matched_field: "employee_portal_token" },
      });
    } catch (auditError) {
      console.error("[employee-payroll-portal] public audit skipped", {
        requestId: req.id,
        employeeId: employee.id,
        message: auditError?.message || "",
        stack: auditError?.stack || "",
      });
    }
    const includeOptional = ["1", "true", "yes", "on"].includes(String(req.query.include_optional || req.query.includeOptional || "").toLowerCase());
    const portalTimeZone = req.query.timezone || req.query.time_zone || req.query.tz || "Africa/Cairo";
    let portal;
    try {
      portal = await buildEmployeePayrollPortalPayload({
        employee,
        includeOptional,
        timings,
        timeZone: portalTimeZone,
      });
    } catch (portalError) {
      console.error("[employee-payroll-portal] public portal payload failed", {
        requestId: req.id,
        employeeId: employee.id,
        message: portalError?.message || "",
        stack: portalError?.stack || "",
      });
      const fallbackWarnings = [
        {
          section: "portal",
          code: "fallback",
          message: "Portal payload fallback was used after a runtime error.",
        },
      ];
      try {
        portal = buildEmployeePortalFallbackPayload(employee, portalTimeZone, fallbackWarnings);
      } catch (fallbackError) {
        console.error("[employee-payroll-portal] public portal fallback failed", {
          requestId: req.id,
          employeeId: employee.id,
          message: fallbackError?.message || "",
          stack: fallbackError?.stack || "",
        });
        portal = buildEmployeePortalFallbackPayload(employee, "Africa/Cairo", fallbackWarnings);
      }
    }
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
    console.error("[employee-payroll-portal] public load error", {
      requestId: req.id,
      message: error?.message || "",
      stack: error?.stack || "",
    });
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
    const includeAll = isDisplayRefillSupervisor(employee);
    const alerts = await listDisplayRefillAlertsForEmployee({
      employeeId: employee.id,
      tenantId,
      branchId,
      includeAll,
      limit: req.query.limit || 50,
      status: req.query.status || "all",
    });
    const barcodeSettingsRecords = await getSettingsByCategory("barcode_printing").catch(() => []);
    const barcodeSettingsValues = barcodeSettingsRecords.reduce((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});
    console.info("[display-refill-alert:employee-load]", {
      tenant_id: tenantId,
      employee_id: employee.id,
      branch_id: branchId,
      include_all: includeAll,
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
      barcode_printing_settings: normalizeBarcodePrintSettings(barcodePrintSettingsFromValues(barcodeSettingsValues)),
      display_refill_barcode_settings: normalizeDisplayRefillBarcodeSettings(displayRefillBarcodeSettingsFromValues(barcodeSettingsValues)),
      pending_unread_count: alerts.filter((item) => item.status === "pending" && !item.is_read).length,
      completed_count: alerts.filter((item) => item.status === "resolved").length,
    });
  } catch (error) {
    console.error("[employee-payroll-portal] display refill alerts load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load display refill alerts" });
  }
});

router.patch("/:token/notifications/read-all", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const result = await markAllEmployeePortalNotificationsRead({
      tenantId: employee.tenant_id || employee.tenantId || null,
      employeeId: employee.id,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[employee-payroll-portal] notifications read-all error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to mark notifications as read" });
  }
});

router.patch("/:token/notifications/:notificationId/read", async (req, res) => {
  try {
    const employee = await loadVerifiedEmployee(req, res);
    if (!employee) return;
    const notification = await markEmployeePortalNotificationRead({
      tenantId: employee.tenant_id || employee.tenantId || null,
      employeeId: employee.id,
      notificationId: req.params.notificationId,
    });
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });
    return res.json({ success: true, notification });
  } catch (error) {
    console.error("[employee-payroll-portal] notification read error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to mark notification as read" });
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
      includeAll: isDisplayRefillSupervisor(employee),
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
      includeAll: isDisplayRefillSupervisor(employee),
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
