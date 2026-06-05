import db from "../database/db.js";
import { createPerfTimer } from "../utils/perfDebug.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import { getCommissionSnapshot, pickCommissionRule } from "../utils/employeeAnalytics.js";
import { ensureAttendanceSchema } from "../utils/attendanceSchema.js";
import { cleanupFakeLegacyEmployees } from "../services/employeeCleanupService.js";
import {
  cancelEmployeePenalty,
  createEmployeePenalty,
  listEmployeePenalties,
  updateEmployeePenalty,
} from "../services/salesCommissionService.js";
import {
  buildEmployeePortalLink,
  ensureEmployeePayrollPortalSchema,
  getEmployeeGamificationAdmin,
  grantEmployeeAdminReward,
  listEmployeePortalRequests,
  reviewEmployeePortalRequest,
  repairMissingEmployeePortalTokens,
  regenerateEmployeePortalToken,
  updateEmployeeGamificationSettings,
} from "../services/employeePayrollPortalService.js";
import {
  buildManagerPortalLink,
  ensureManagerPortalSchema,
  repairMissingManagerPortalTokens,
  regenerateManagerPortalToken,
} from "../services/managerPortalService.js";
import {
  getAdminEmployeeChatThread,
  listEmployeeChatThreads,
  markAdminEmployeeChatThreadRead,
  sendAdminEmployeeChatMessage,
} from "../services/employeeChatService.js";
import { sendEmployeePortalPush } from "../services/employeePortalPushService.js";

const safeQuery = async (client, text, params = []) => {
  try {
    return await client.query(text, params);
  } catch (error) {
    console.warn("Employee analytics query failed:", error.message);
    return { rows: [] };
  }
};

const analyticsDebugEnabled = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.ERP_ANALYTICS_DEBUG || "").toLowerCase());

const logAnalyticsDebug = (tag, payload = {}) => {
  if (!analyticsDebugEnabled()) return;
  console.info(tag, payload);
};

const buildRangeClause = (alias, startDate, endDate, params) => {
  const parts = [];

  if (startDate) {
    params.push(startDate);
    parts.push(`${alias}.created_at >= $${params.length}::date`);
  }

  if (endDate) {
    params.push(endDate);
    parts.push(`${alias}.created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return parts.length ? `AND ${parts.join(" AND ")}` : "";
};

const buildBranchClause = (alias, branchId, params) => {
  if (!branchId) return "";
  params.push(branchId);
  return `AND ${alias}.branch_id = $${params.length}`;
};

const buildShiftClause = (alias, shiftId, params) => {
  if (!shiftId) return "";
  params.push(shiftId);
  return `AND ${alias}.shift_id = $${params.length}`;
};

const baseFilters = (req) => ({
  startDate: req.query.startDate || "",
  endDate: req.query.endDate || "",
  branchId: req.query.branchId || "",
  shiftId: req.query.shiftId || "",
});

const getTenantContext = (req) => ({
  tenantId: isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id),
  userId: req.user?.id || null,
});

const normalizeOptionalLookupId = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  return text ? text : null;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
};

const normalizeRoleValue = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

const canApprovePayrollPenalty = (user = {}) => {
  if (isSuperAdminUser(user)) return true;
  const role = normalizeRoleValue(user.role_name || user.role || "");
  if (["admin", "super admin", "superadmin", "platform admin"].includes(role)) return true;
  const permissions = Array.isArray(user.permissions) ? user.permissions.map((item) => String(item).toLowerCase()) : [];
  return permissions.some((permission) =>
    ["*", "*.*", "employees:edit", "employees.edit", "payroll:approve", "payroll.approve", "expenses:approve", "expenses.approve"].includes(permission)
  );
};

export const getEmployees = async (req, res) => {
  try {
    await ensureAttendanceSchema(db);
    await ensureEmployeePayrollPortalSchema(db);
    const { tenantId } = getTenantContext(req);
    const branchId = normalizeOptionalLookupId(req.query.branch_id || req.query.branchId);
    const activeOnly = toBool(req.query.active, false);
    const search = String(req.query.search || "").trim().toLowerCase();
    const params = [tenantId, branchId, activeOnly];
    const clauses = [
      "($1::bigint IS NULL OR e.tenant_id = $1::bigint)",
      "COALESCE(e.is_deleted, FALSE) = FALSE",
      "($2::text IS NULL OR e.branch_id::text = $2::text)",
      "($3::boolean = FALSE OR LOWER(COALESCE(e.status, 'active')) NOT IN ('inactive', 'disabled', 'false', '0', 'deleted'))",
    ];

    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(
        LOWER(COALESCE(e.full_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(e.employee_code, '')) LIKE $${params.length}
        OR LOWER(COALESCE(e.phone, '')) LIKE $${params.length}
        OR LOWER(COALESCE(e.email, '')) LIKE $${params.length}
      )`);
    }

    const result = await db.query(
      `
      SELECT
        e.id,
        e.tenant_id,
        e.branch_id,
        b.name AS branch_name,
        e.user_id,
        e.full_name,
        e.full_name AS name,
        e.employee_code,
        e.employee_code AS code,
        COALESCE(e.photo_url, '') AS photo_url,
        e.phone,
        e.email,
        e.role,
        e.salary,
        e.salary AS base_salary,
        COALESCE(e.daily_work_hours, 8) AS daily_work_hours,
        COALESCE(e.working_days_per_month, 26) AS working_days_per_month,
        COALESCE(e.working_days_per_week, 6) AS working_days_per_week,
        e.work_start_time,
        e.work_end_time,
        COALESCE(e.absence_deduction_enabled, TRUE) AS absence_deduction_enabled,
        COALESCE(e.missing_hours_deduction_enabled, TRUE) AS missing_hours_deduction_enabled,
        COALESCE(e.late_deduction_enabled, TRUE) AS late_deduction_enabled,
        COALESCE(e.early_leave_deduction_enabled, TRUE) AS early_leave_deduction_enabled,
        e.status,
        e.employee_portal_token,
        e.created_at,
        e.updated_at
      FROM employees e
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY LOWER(COALESCE(e.full_name, '')) ASC, e.id ASC
      `,
      params
    );

    return res.json({ success: true, employees: result.rows, data: result.rows });
  } catch (error) {
    console.error("[employees] list error", error);
    return res.status(500).json({ success: false, message: "Failed to load employees", error: error.message });
  }
};

export const regenerateEmployeePayrollPortalToken = async (req, res) => {
  try {
    await ensureEmployeePayrollPortalSchema(db);
    const { tenantId } = getTenantContext(req);
    const token = await regenerateEmployeePortalToken({
      employeeId: req.params.employeeId,
      tenantId,
    });
    const portalUrl = buildEmployeePortalLink(token, req);
    console.info("[employees] payroll portal token regenerated", {
      requestId: req.id,
      employeeId: req.params.employeeId,
      token,
    });
    return res.json({
      success: true,
      token,
      portal_url: portalUrl,
      qr_url: portalUrl,
      url: portalUrl,
    });
  } catch (error) {
    console.error("[employees] regenerate payroll portal token error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to regenerate employee portal token" });
  }
};

export const regenerateManagerPortalTokenRecord = async (req, res) => {
  try {
    await ensureManagerPortalSchema(db);
    const { tenantId } = getTenantContext(req);
    const token = await regenerateManagerPortalToken({
      employeeId: req.params.employeeId,
      tenantId,
    });
    const portalUrl = buildManagerPortalLink(token);
    console.info("[employees] manager portal token regenerated", {
      requestId: req.id,
      employeeId: req.params.employeeId,
      token,
    });
    return res.json({
      success: true,
      token,
      portal_url: portalUrl,
      url: portalUrl,
    });
  } catch (error) {
    console.error("[employees] regenerate manager portal token error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to regenerate manager portal token" });
  }
};

export const repairMissingEmployeePayrollPortalTokens = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    const result = await repairMissingEmployeePortalTokens({
      tenantId,
      limit: req.body?.limit || req.query?.limit || 500,
    });
    console.info("[employees] missing payroll portal tokens repaired", {
      requestId: req.id,
      tenantId,
      scanned: result.scanned,
      repaired_count: result.repaired_count,
    });
    return res.json({
      success: true,
      scanned: result.scanned,
      repaired_count: result.repaired_count,
      repaired_employee_ids: result.repaired.map((employee) => employee.id),
    });
  } catch (error) {
    console.error("[employees] repair missing payroll portal tokens error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to repair employee portal tokens" });
  }
};

export const repairMissingManagerPortalTokensRecord = async (req, res) => {
  try {
    await ensureManagerPortalSchema(db);
    const { tenantId } = getTenantContext(req);
    const result = await repairMissingManagerPortalTokens({
      tenantId,
      limit: req.body?.limit || req.query?.limit || 500,
    });
    console.info("[employees] missing manager portal tokens repaired", {
      requestId: req.id,
      tenantId,
      scanned: result.scanned,
      repaired_count: result.repaired_count,
    });
    return res.json({
      success: true,
      scanned: result.scanned,
      repaired_count: result.repaired_count,
      repaired_employee_ids: result.repaired.map((employee) => employee.id),
    });
  } catch (error) {
    console.error("[employees] repair missing manager portal tokens error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to repair manager portal tokens" });
  }
};

export const getEmployeePortalRequests = async (req, res) => {
  const perf = createPerfTimer("GET /api/employees/portal-requests", { requestId: req.id });
  try {
    let phaseStartedAt = perf.phaseStart();
    await ensureEmployeePayrollPortalSchema(db);
    perf.mark("schema_guard", phaseStartedAt);
    const { tenantId } = getTenantContext(req);
    phaseStartedAt = perf.phaseStart();
    const requests = await listEmployeePortalRequests({
      tenantId,
      status: String(req.query.status || "").trim(),
      limit: req.query.limit,
    });
    perf.mark("query", phaseStartedAt);
    perf.end({ count: requests.length });
    return res.json({ success: true, requests });
  } catch (error) {
    perf.fail(error);
    console.error("[employees] portal requests list error", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to load employee portal requests" });
  }
};

export const reviewEmployeePortalRequestRecord = async (req, res) => {
  const perf = createPerfTimer("PATCH /api/employees/portal-requests/:id", { requestId: req.id });
  try {
    let phaseStartedAt = perf.phaseStart();
    await ensureEmployeePayrollPortalSchema(db);
    perf.mark("schema_guard", phaseStartedAt);
    const { tenantId, userId } = getTenantContext(req);
    phaseStartedAt = perf.phaseStart();
    const request = await reviewEmployeePortalRequest({
      tenantId,
      requestId: req.params.id,
      status: req.body?.status,
      adminNote: req.body?.admin_note || req.body?.adminNote || "",
      reviewedBy: userId,
      createAdvance: req.body?.create_advance === true || req.body?.createAdvance === true,
    });
    perf.mark("review_write", phaseStartedAt);
    perf.end({ status: request.status, requestType: request.request_type });
    return res.json({ success: true, request });
  } catch (error) {
    perf.fail(error);
    console.error("[employees] portal request review error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to review employee portal request" });
  }
};

export const getEmployeeChatThreads = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    const threads = await listEmployeeChatThreads({ tenantId, limit: req.query.limit });
    return res.json({ success: true, threads });
  } catch (error) {
    console.error("[employees] chat threads list error", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to load employee chat threads" });
  }
};

export const getEmployeeChatThreadRecord = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    const chat = await getAdminEmployeeChatThread({ tenantId, threadId: req.params.threadId, markRead: true });
    return res.json({ success: true, ...chat });
  } catch (error) {
    console.error("[employees] chat thread load error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to load employee chat thread" });
  }
};

export const sendEmployeeChatThreadMessageRecord = async (req, res) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    const result = await sendAdminEmployeeChatMessage({
      tenantId,
      threadId: req.params.threadId,
      userId,
      body: req.body?.body || req.body?.message || "",
      file: req.file || null,
      replyToMessageId: req.body?.reply_to_message_id || req.body?.replyToMessageId || null,
      attachmentDurationSeconds: req.body?.attachment_duration_seconds || req.body?.duration || null,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("[employees] chat message send error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to send employee chat message" });
  }
};

export const markEmployeeChatThreadReadRecord = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    const result = await markAdminEmployeeChatThreadRead({ tenantId, threadId: req.params.threadId });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[employees] chat thread read error", error);
    return res.status(error.status || 500).json({ success: false, code: error.code, message: error.message || "Failed to mark employee chat read" });
  }
};

export const getEmployeeGamificationSettingsRecord = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    const data = await getEmployeeGamificationAdmin({ tenantId });
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("[employees] gamification settings load error", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to load gamification settings" });
  }
};

export const updateEmployeeGamificationSettingsRecord = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    const settings = await updateEmployeeGamificationSettings({ tenantId, data: req.body || {} });
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("[employees] gamification settings update error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update gamification settings" });
  }
};

export const grantEmployeeRewardRecord = async (req, res) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    const reward = await grantEmployeeAdminReward({
      tenantId,
      employeeId: req.body?.employee_id || req.body?.employeeId,
      title: req.body?.title || req.body?.reward_title,
      pointsCost: req.body?.points_cost || req.body?.pointsCost,
      adminNote: req.body?.admin_note || req.body?.adminNote || "",
      createdBy: userId,
    });
    return res.status(201).json({ success: true, reward });
  } catch (error) {
    console.error("[employees] reward grant error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to grant employee reward" });
  }
};

export const updateEmployeePayrollSettings = async (req, res) => {
  try {
    await ensureAttendanceSchema(db);
    const { tenantId } = getTenantContext(req);
    const employeeId = normalizeOptionalLookupId(req.params.employeeId);
    if (!employeeId) return res.status(400).json({ success: false, message: "Employee is required" });

    const dailyWorkHours = Number(req.body?.daily_work_hours ?? req.body?.dailyWorkHours ?? 8);
    const workingDaysPerMonth = Number(req.body?.working_days_per_month ?? req.body?.workingDaysPerMonth ?? 26);
    const workingDaysPerWeek = Number(req.body?.working_days_per_week ?? req.body?.workingDaysPerWeek ?? 6);
    if (!Number.isFinite(dailyWorkHours) || dailyWorkHours <= 0) return res.status(400).json({ success: false, message: "Daily work hours must be greater than zero" });
    if (!Number.isFinite(workingDaysPerMonth) || workingDaysPerMonth <= 0) return res.status(400).json({ success: false, message: "Working days per month must be greater than zero" });
    if (!Number.isFinite(workingDaysPerWeek) || workingDaysPerWeek <= 0 || workingDaysPerWeek > 7) return res.status(400).json({ success: false, message: "Working days per week must be between 1 and 7" });

    const result = await db.query(
      `
      UPDATE employees
      SET daily_work_hours = $3,
          working_days_per_month = $4,
          working_days_per_week = $5,
          work_start_time = NULLIF($6, '')::time,
          work_end_time = NULLIF($7, '')::time,
          absence_deduction_enabled = $8,
          missing_hours_deduction_enabled = $9,
          late_deduction_enabled = $10,
          early_leave_deduction_enabled = $11,
          updated_at = NOW()
      WHERE id::text = $1::text
        AND is_deleted IS DISTINCT FROM TRUE
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      RETURNING id, daily_work_hours, working_days_per_month, working_days_per_week, work_start_time, work_end_time,
        absence_deduction_enabled, missing_hours_deduction_enabled, late_deduction_enabled, early_leave_deduction_enabled
      `,
      [
        employeeId,
        tenantId,
        dailyWorkHours,
        Math.round(workingDaysPerMonth),
        Math.round(workingDaysPerWeek),
        String(req.body?.work_start_time ?? req.body?.workStartTime ?? "").slice(0, 8),
        String(req.body?.work_end_time ?? req.body?.workEndTime ?? "").slice(0, 8),
        toBool(req.body?.absence_deduction_enabled ?? req.body?.absenceDeductionEnabled, true),
        toBool(req.body?.missing_hours_deduction_enabled ?? req.body?.missingHoursDeductionEnabled, true),
        toBool(req.body?.late_deduction_enabled ?? req.body?.lateDeductionEnabled, true),
        toBool(req.body?.early_leave_deduction_enabled ?? req.body?.earlyLeaveDeductionEnabled, true),
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: "Employee not found" });
    return res.json({ success: true, settings: result.rows[0] });
  } catch (error) {
    console.error("[employees] payroll settings update error", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to update payroll settings" });
  }
};

export const cleanupFakeEmployees = async (req, res) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    const confirm = toBool(req.body?.confirm ?? req.query?.confirm, false);
    const result = await cleanupFakeLegacyEmployees({ tenantId, confirm, actorUserId: userId });
    return res.json({
      success: true,
      message: confirm ? "Fake legacy employees deleted" : "Dry run only. Re-run with confirm=true to delete.",
      ...result,
    });
  } catch (error) {
    console.error("[employees] cleanup fake employees error", error);
    return res.status(500).json({ success: false, message: "Failed to cleanup fake employees", error: error.message });
  }
};

export const getEmployeePenalties = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    console.log(`[employee-penalties] fetching penalties for employee ${req.params.employeeId}`);
    const penalties = await listEmployeePenalties({
      tenantId,
      employeeId: req.params.employeeId,
      status: req.query.status || "",
      includeCancelled: toBool(req.query.include_cancelled || req.query.includeCancelled, false),
    });
    return res.json({ success: true, penalties });
  } catch (error) {
    console.error("[employees] penalties list error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load employee penalties" });
  }
};

export const createEmployeePenaltyRecord = async (req, res) => {
  try {
    const { tenantId, userId } = getTenantContext(req);
    const penalty = await createEmployeePenalty({
      tenantId,
      employeeId: req.params.employeeId,
      userId,
      data: req.body || {},
      defaultStatus: canApprovePayrollPenalty(req.user) ? "approved" : "pending",
    });
    if (String(penalty?.status || "").toLowerCase() === "approved") {
      sendEmployeePortalPush({
        tenantId: penalty.tenant_id || tenantId,
        employeeId: penalty.employee_id || req.params.employeeId,
        title: "⚠️ جزاء جديد",
        body: `تم تسجيل جزاء بقيمة ${Number(penalty.amount || 0)} جنيه.`,
        tag: "penalty-added",
        data: { event: "penalty_added", penalty_id: penalty.id, amount: Number(penalty.amount || 0), tab: "salary" },
      }).catch((pushError) => console.warn("[employees] penalty push skipped", pushError?.message || pushError));
    }
    return res.status(201).json({ success: true, penalty });
  } catch (error) {
    console.error("[employees] penalty create error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create employee penalty" });
  }
};

export const updateEmployeePenaltyRecord = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    const penalty = await updateEmployeePenalty({ tenantId, id: req.params.id, data: req.body || {} });
    if (String(penalty?.status || "").toLowerCase() === "approved") {
      sendEmployeePortalPush({
        tenantId: penalty.tenant_id || tenantId,
        employeeId: penalty.employee_id,
        title: "⚠️ جزاء جديد",
        body: `تم تسجيل جزاء بقيمة ${Number(penalty.amount || 0)} جنيه.`,
        tag: "penalty-added",
        data: { event: "penalty_added", penalty_id: penalty.id, amount: Number(penalty.amount || 0), tab: "salary" },
      }).catch((pushError) => console.warn("[employees] penalty push skipped", pushError?.message || pushError));
    }
    return res.json({ success: true, penalty });
  } catch (error) {
    console.error("[employees] penalty update error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update employee penalty" });
  }
};

export const cancelEmployeePenaltyRecord = async (req, res) => {
  try {
    const { tenantId } = getTenantContext(req);
    const penalty = await cancelEmployeePenalty({ tenantId, id: req.params.id });
    return res.json({ success: true, penalty });
  } catch (error) {
    console.error("[employees] penalty cancel error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to cancel employee penalty" });
  }
};

const loadCommissionRules = async (client, tenantId) => {
  const result = await safeQuery(
    client,
    `
      SELECT *
      FROM commission_rules
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        AND is_active = TRUE
      ORDER BY priority DESC, id DESC
    `,
    [tenantId]
  );

  return result.rows || [];
};

const buildEmployeePerformance = async (client, tenantId, filters = {}) => {
  const params = [tenantId];
  const orderRangeClause = buildRangeClause("o", filters.startDate, filters.endDate, params);
  const orderBranchClause = buildBranchClause("o", filters.branchId, params);
  const orderShiftClause = buildShiftClause("o", filters.shiftId, params);
  const commissionRangeClause = buildRangeClause("ec", filters.startDate, filters.endDate, params);
  const commissionBranchClause = buildBranchClause("ec", filters.branchId, params);
  const commissionShiftClause = buildShiftClause("ec", filters.shiftId, params);

  const ordersResult = await safeQuery(
    client,
    `
      WITH order_rollup AS (
        SELECT
          COALESCE(o.sales_employee_id, o.cashier_id, o.created_by) AS employee_id,
          COUNT(*)::int AS total_orders,
          COALESCE(SUM(o.total), 0) AS total_sales,
          COALESCE(AVG(o.total), 0) AS average_order_value,
          COALESCE(SUM(CASE WHEN o.payment_status IN ('paid', 'completed', 'partial', 'partially_paid') THEN o.total ELSE 0 END), 0) AS paid_sales,
          COALESCE(SUM(CASE WHEN o.payment_status IN ('refunded', 'returned', 'cancelled') THEN o.total ELSE 0 END), 0) AS refunds_impact,
          MAX(o.created_at) AS last_order_at
        FROM orders o
        WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
        ${orderRangeClause}
        ${orderBranchClause}
        ${orderShiftClause}
        GROUP BY COALESCE(o.sales_employee_id, o.cashier_id, o.created_by)
      ),
      commission_rollup AS (
        SELECT
          ec.employee_id,
          COALESCE(SUM(ec.commission_amount), 0) AS commission_earned,
          COUNT(*)::int AS commission_count
        FROM employee_commissions ec
        WHERE ($1::bigint IS NULL OR ec.tenant_id = $1::bigint)
        ${commissionRangeClause}
        ${commissionBranchClause}
        ${commissionShiftClause}
        GROUP BY ec.employee_id
      )
      SELECT
        COALESCE(e.id, employee_user.id, u.id, order_rollup.employee_id) AS employee_id,
        COALESCE(e.full_name, employee_user.full_name, u.name, 'Unlinked employee') AS employee_name,
        COALESCE(u.email, '') AS employee_email,
        COALESCE(u.phone, '') AS employee_phone,
        COALESCE(r.name, 'staff') AS role_name,
        order_rollup.total_sales,
        order_rollup.total_orders,
        order_rollup.average_order_value,
        order_rollup.paid_sales,
        order_rollup.refunds_impact,
        COALESCE(commission_rollup.commission_earned, 0) AS commission_earned,
        order_rollup.last_order_at
      FROM order_rollup
      LEFT JOIN employees e
        ON e.id = order_rollup.employee_id
       AND e.is_deleted IS DISTINCT FROM TRUE
       AND ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
      LEFT JOIN employees employee_user
        ON employee_user.user_id = order_rollup.employee_id
       AND employee_user.is_deleted IS DISTINCT FROM TRUE
       AND ($1::bigint IS NULL OR employee_user.tenant_id = $1::bigint)
      LEFT JOIN users u ON u.id = order_rollup.employee_id
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN commission_rollup ON commission_rollup.employee_id = order_rollup.employee_id
      ORDER BY order_rollup.total_sales DESC, commission_rollup.commission_earned DESC
    `,
    params
  );

  const employeeRows = ordersResult.rows || [];

  const shiftParams = [tenantId];
  const shiftRangeClause = buildRangeClause("o", filters.startDate, filters.endDate, shiftParams);
  const shiftBranchClause = buildBranchClause("o", filters.branchId, shiftParams);
  const shiftResult = await safeQuery(
    client,
    `
      SELECT
        COALESCE(o.shift_id, 0) AS shift_id,
        COALESCE(c.name, 'No shift assigned') AS shift_name,
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(o.total), 0) AS total_sales,
        COALESCE(AVG(o.total), 0) AS average_order_value
      FROM orders o
      LEFT JOIN cashbox c ON c.id = o.shift_id
      WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
      ${shiftRangeClause}
      ${shiftBranchClause}
      GROUP BY COALESCE(o.shift_id, 0), c.name
      ORDER BY total_sales DESC
    `,
    shiftParams
  );

  const branchParams = [tenantId];
  const branchRangeClause = buildRangeClause("o", filters.startDate, filters.endDate, branchParams);
  const branchResult = await safeQuery(
    client,
    `
      SELECT
        COALESCE(o.branch_id, 0) AS branch_id,
        COALESCE(w.name, 'No branch assigned') AS branch_name,
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(o.total), 0) AS total_sales,
        COALESCE(AVG(o.total), 0) AS average_order_value
      FROM orders o
      LEFT JOIN warehouses w ON w.id = o.branch_id
      WHERE ($1::bigint IS NULL OR o.tenant_id = $1::bigint)
      ${branchRangeClause}
      GROUP BY COALESCE(o.branch_id, 0), w.name
      ORDER BY total_sales DESC
    `,
    branchParams
  );

  const totals = employeeRows.reduce(
    (acc, row) => {
      acc.totalSales += Number(row.total_sales || 0);
      acc.totalOrders += Number(row.total_orders || 0);
      acc.totalCommission += Number(row.commission_earned || 0);
      return acc;
    },
    { totalSales: 0, totalOrders: 0, totalCommission: 0 }
  );

  return {
    items: employeeRows,
    shiftPerformance: shiftResult.rows || [],
    branchPerformance: branchResult.rows || [],
    summary: {
      totalSales: totals.totalSales,
      totalOrders: totals.totalOrders,
      totalCommission: totals.totalCommission,
      bestCashier: employeeRows[0]?.employee_name || "n/a",
      highestAverageOrder:
        employeeRows.slice().sort((a, b) => Number(b.average_order_value || 0) - Number(a.average_order_value || 0))[0] || null,
    },
  };
};

export const getSalesPerformance = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const filters = baseFilters(req);
    const performance = await buildEmployeePerformance(client, tenantId, filters);
    logAnalyticsDebug("[commission-report]", {
      endpoint: "sales-performance",
      filters,
      rows: performance.items.length,
      shift_rows: performance.shiftPerformance.length,
      branch_rows: performance.branchPerformance.length,
      totals: performance.summary,
    });

    return res.json({
      success: true,
      salesPerformance: performance.items,
      shiftPerformance: performance.shiftPerformance,
      branchPerformance: performance.branchPerformance,
      summary: performance.summary,
    });
  } catch (error) {
    console.log("Employee sales performance error:", error);
    return res.status(500).json({ success: false, message: "Unable to load employee sales performance" });
  } finally {
    client.release();
  }
};

export const getCommissions = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const filters = baseFilters(req);

    const params = [tenantId];
    const rules = await loadCommissionRules(client, tenantId);
    const commissionsResult = await safeQuery(
      client,
      `
        SELECT
          ec.*,
          COALESCE(e.full_name, employee_user.full_name, u.name, 'Unlinked employee') AS employee_name,
          COALESCE(o.invoice_number, '') AS invoice_number
        FROM employee_commissions ec
        LEFT JOIN employees e
          ON e.id = ec.employee_id
         AND e.is_deleted IS DISTINCT FROM TRUE
         AND ($1::bigint IS NULL OR e.tenant_id = $1::bigint)
        LEFT JOIN employees employee_user
          ON employee_user.user_id = ec.employee_id
         AND employee_user.is_deleted IS DISTINCT FROM TRUE
         AND ($1::bigint IS NULL OR employee_user.tenant_id = $1::bigint)
        LEFT JOIN users u ON u.id = ec.employee_id
        LEFT JOIN orders o ON o.id = ec.order_id
        WHERE ($1::bigint IS NULL OR ec.tenant_id = $1::bigint)
        ${buildRangeClause("ec", filters.startDate, filters.endDate, params)}
        ${buildBranchClause("ec", filters.branchId, params)}
        ${buildShiftClause("ec", filters.shiftId, params)}
        ORDER BY ec.created_at DESC
      `,
      params
    );

    const totals = (commissionsResult.rows || []).reduce(
      (acc, row) => {
        acc.commissionEarned += Number(row.commission_amount || 0);
        acc.commissionCount += 1;
        return acc;
      },
      { commissionEarned: 0, commissionCount: 0 }
    );
    logAnalyticsDebug("[commission-report]", {
      endpoint: "commissions",
      filters,
      rows: commissionsResult.rows?.length || 0,
      rules: rules.length,
      totals,
    });

    return res.json({
      success: true,
      rules,
      commissions: commissionsResult.rows || [],
      summary: {
        totalCommission: totals.commissionEarned,
        totalCommissionRows: totals.commissionCount,
      },
    });
  } catch (error) {
    console.log("Employee commissions error:", error);
    return res.status(500).json({ success: false, message: "Unable to load employee commissions" });
  } finally {
    client.release();
  }
};

export const getTopPerformers = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const filters = baseFilters(req);
    const performance = await buildEmployeePerformance(client, tenantId, filters);
    const topPerformers = [...performance.items]
      .sort((a, b) => Number(b.total_sales || 0) - Number(a.total_sales || 0))
      .slice(0, 10);

    return res.json({
      success: true,
      topPerformers,
      summary: performance.summary,
      shiftPerformance: performance.shiftPerformance,
      branchPerformance: performance.branchPerformance,
    });
  } catch (error) {
    console.log("Employee top performers error:", error);
    return res.status(500).json({ success: false, message: "Unable to load top performers" });
  } finally {
    client.release();
  }
};

export const getCommissionRules = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const result = await safeQuery(
      client,
      `
        SELECT *
        FROM commission_rules
        WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint)
        ORDER BY priority DESC, id DESC
      `,
      [tenantId]
    );

    return res.json({ success: true, rules: result.rows || [] });
  } catch (error) {
    console.log("Commission rules error:", error);
    return res.status(500).json({ success: false, message: "Unable to load commission rules" });
  } finally {
    client.release();
  }
};

export const createCommissionRule = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId, userId } = getTenantContext(req);
    const {
      name,
      scope_type = "global",
      scope_id = null,
      rule_type = "percentage",
      value = 0,
      apply_to = "sale",
      priority = 0,
      is_active = true,
    } = req.body || {};

    if (!name) {
      return res.status(400).json({ success: false, message: "Rule name is required" });
    }

    const result = await client.query(
      `
        INSERT INTO commission_rules (
          tenant_id,
          name,
          scope_type,
          scope_id,
          rule_type,
          value,
          apply_to,
          priority,
          is_active,
          created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `,
      [tenantId, name, scope_type, scope_id, rule_type, value, apply_to, priority, is_active, userId]
    );

    return res.status(201).json({ success: true, rule: result.rows[0] });
  } catch (error) {
    console.log("Create commission rule error:", error);
    return res.status(500).json({ success: false, message: "Unable to create commission rule" });
  } finally {
    client.release();
  }
};

export const updateCommissionRule = async (req, res) => {
  const client = await db.connect();

  try {
    const { tenantId } = getTenantContext(req);
    const { id } = req.params;
    const fields = req.body || {};

    const existing = await client.query(
      `
        SELECT *
        FROM commission_rules
        WHERE id = $1
          AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
        LIMIT 1
      `,
      [id, tenantId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Rule not found" });
    }

    const current = existing.rows[0];
    const next = {
      name: fields.name ?? current.name,
      scope_type: fields.scope_type ?? current.scope_type,
      scope_id: fields.scope_id ?? current.scope_id,
      rule_type: fields.rule_type ?? current.rule_type,
      value: fields.value ?? current.value,
      apply_to: fields.apply_to ?? current.apply_to,
      priority: fields.priority ?? current.priority,
      is_active: fields.is_active ?? current.is_active,
    };

    const result = await client.query(
      `
        UPDATE commission_rules
        SET name = $1,
            scope_type = $2,
            scope_id = $3,
            rule_type = $4,
            value = $5,
            apply_to = $6,
            priority = $7,
            is_active = $8,
            updated_at = NOW()
        WHERE id = $9
          AND ($10::bigint IS NULL OR tenant_id = $10::bigint)
        RETURNING *
      `,
      [
        next.name,
        next.scope_type,
        next.scope_id,
        next.rule_type,
        next.value,
        next.apply_to,
        next.priority,
        next.is_active,
        id,
        tenantId,
      ]
    );

    return res.json({ success: true, rule: result.rows[0] });
  } catch (error) {
    console.log("Update commission rule error:", error);
    return res.status(500).json({ success: false, message: "Unable to update commission rule" });
  } finally {
    client.release();
  }
};

export const recordEmployeeAnalytics = async (client, {
  tenantId,
  orderId,
  orderItems = [],
  cashierId = null,
  salesEmployeeId = null,
  shiftId = null,
  branchId = null,
  paymentStatus = "unpaid",
  userId = null,
}) => {
  const employeeId = salesEmployeeId || cashierId || null;
  if (!employeeId) {
    return { recorded: false, commissionRows: [] };
  }

  const rules = await loadCommissionRules(client, tenantId);
  let totalSales = 0;
  let totalCommission = 0;
  const commissionRows = [];

  for (const item of orderItems) {
    const saleAmount = Number(item.total_amount ?? Number(item.sale_price || 0) * Number(item.quantity || 0));
    totalSales += saleAmount;
    const rule = pickCommissionRule(rules, item);
    const commissionSnapshot = getCommissionSnapshot(rule, saleAmount, Number(item.quantity || 0));
    totalCommission += commissionSnapshot.commissionAmount;

    if (commissionSnapshot.commissionAmount > 0) {
      const commissionResult = await client.query(
        `
          INSERT INTO employee_commissions (
            tenant_id,
            employee_id,
            order_id,
            order_item_id,
            product_id,
            category_id,
            commission_rule_id,
            rule_type,
            scope_type,
            sale_amount,
            commission_amount,
            status,
            branch_id,
            shift_id,
            created_by
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
          RETURNING *
        `,
        [
          tenantId,
          employeeId,
          orderId,
          item.order_item_id || null,
          item.product_id || null,
          item.category_id || null,
          rule?.id || null,
          commissionSnapshot.ruleType,
          commissionSnapshot.scopeType,
          saleAmount,
          commissionSnapshot.commissionAmount,
          paymentStatus === "paid" || paymentStatus === "completed" || paymentStatus === "partial" || paymentStatus === "partially_paid" ? "earned" : "pending",
          branchId,
          shiftId,
          userId,
        ]
      );
      commissionRows.push(commissionResult.rows[0]);
    }
  }

  await client.query(
    `
      INSERT INTO employee_sales (
        tenant_id,
        order_id,
        cashier_id,
        sales_employee_id,
        shift_id,
        branch_id,
        total_sales,
        total_orders,
        commission_amount,
        refund_amount,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,0,$9)
      ON CONFLICT (tenant_id, order_id) DO UPDATE
      SET cashier_id = EXCLUDED.cashier_id,
          sales_employee_id = EXCLUDED.sales_employee_id,
          shift_id = EXCLUDED.shift_id,
          branch_id = EXCLUDED.branch_id,
          total_sales = EXCLUDED.total_sales,
          commission_amount = EXCLUDED.commission_amount,
          status = EXCLUDED.status,
          updated_at = NOW()
    `,
    [
      tenantId,
      orderId,
      cashierId,
      salesEmployeeId || cashierId,
      shiftId,
      branchId,
      totalSales,
      totalCommission,
      paymentStatus === "paid" || paymentStatus === "completed" ? "earned" : "recorded",
    ]
  );

  return {
    recorded: true,
    totalSales,
    totalCommission,
    commissionRows,
  };
};
