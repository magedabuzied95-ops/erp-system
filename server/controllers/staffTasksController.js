import {
  addStaffTaskComment,
  assignDailyInventoryCountTasks,
  createStaffTask,
  deleteStaffTask,
  ensureStaffTasksSchema,
  getEmployeePortal,
  getEmployeePortalPushPublicKey,
  getEmployeePortalSettings,
  getStaffTaskDashboard,
  generateDueTaskInstancesFromTemplates,
  listStaffTasks,
  reassignOverdueTasks,
  redistributeTasks,
  resolveEmployeeForUser,
  resolveTaskTenantId,
  subscribeEmployeePortalPush,
  unsubscribeEmployeePortalPush,
  updateEmployeePortalSettings,
  updateEmployeePortalTaskStatus,
  updateStaffTaskDetails,
  updateStaffTaskStatus,
} from "../services/staffTasksService.js";
import db from "../database/db.js";
import { sendEmployeePortalPush } from "../services/employeePortalPushService.js";

export const getTasks = async (req, res) => {
  try {
    const tasks = await listStaffTasks(req.query || {}, req.user || {});
    return res.json({ success: true, tasks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to load staff tasks" });
  }
};

export const getMyTasks = async (req, res) => {
  try {
    const tasks = await listStaffTasks({ ...(req.query || {}), assignee: "me" }, req.user || {});
    return res.json({ success: true, tasks });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to load my tasks" });
  }
};

const portalTokenFromRequest = (req) => String(req.query?.token || req.body?.token || req.get?.("x-employee-portal-token") || "").trim();

export const getEmployeePortalTasks = async (req, res) => {
  try {
    const portal = await getEmployeePortal(portalTokenFromRequest(req));
    return res.json({ success: true, portal });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load employee portal",
      code: error.code,
      attendance_state: error.attendance_state,
      settings: error.settings,
    });
  }
};

export const updateEmployeePortalTask = async (req, res) => {
  try {
    const result = await updateEmployeePortalTaskStatus({
      token: portalTokenFromRequest(req),
      taskId: req.params.id,
      payload: req.body || {},
    });
    if (!result?.task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update employee task",
      code: error.code,
      attendance_state: error.attendance_state,
      settings: error.settings,
    });
  }
};

export const getEmployeePortalPushKey = async (req, res) => {
  try {
    const result = await getEmployeePortalPushPublicKey(req.params.token);
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load push configuration",
      message_ar: "انتهت صلاحية بوابة الموظف أو غير متاحة.",
      code: error.code,
    });
  }
};

export const subscribeEmployeePortalPushEndpoint = async (req, res) => {
  try {
    const result = await subscribeEmployeePortalPush({
      token: req.params.token,
      subscription: req.body?.subscription || req.body || {},
      userAgent: req.get?.("user-agent") || "",
    });
    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to save push subscription",
      message_ar: "تعذر حفظ اشتراك التنبيهات.",
      code: error.code,
    });
  }
};

export const unsubscribeEmployeePortalPushEndpoint = async (req, res) => {
  try {
    const result = await unsubscribeEmployeePortalPush({
      token: req.params.token,
      endpoint: req.body?.endpoint || req.query?.endpoint || "",
    });
    return res.json({ success: true, subscription: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to remove push subscription",
      message_ar: "تعذر إلغاء اشتراك التنبيهات.",
      code: error.code,
    });
  }
};

export const getPortalSettings = async (req, res) => {
  try {
    const settings = await getEmployeePortalSettings(resolveTaskTenantId(req));
    return res.json({ success: true, settings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to load employee portal settings" });
  }
};

export const updatePortalSettings = async (req, res) => {
  try {
    const settings = await updateEmployeePortalSettings(resolveTaskTenantId(req), req.body || {});
    return res.json({ success: true, settings });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to save employee portal settings" });
  }
};

export const createTask = async (req, res) => {
  try {
    const result = await createStaffTask(req.body || {}, req.user || {});
    if (result.duplicate) {
      return res.status(200).json({ success: true, duplicate: true, task: null, message: "Duplicate task assignment prevented" });
    }
    return res.status(201).json({ success: true, task: result.task });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to create staff task" });
  }
};

export const updateTaskStatus = async (req, res) => {
  try {
    const task = await updateStaffTaskStatus(req.params.id, req.body || {}, req.user || {});
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to update task", code: error.code });
  }
};

export const updateTask = async (req, res) => {
  try {
    const task = await updateStaffTaskDetails(req.params.id, req.body || {}, req.user || {});
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to update task", code: error.code });
  }
};

export const completeTask = async (req, res) => {
  try {
    const task = await updateStaffTaskStatus(req.params.id, { ...(req.body || {}), status: "completed" }, req.user || {});
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to complete task", code: error.code });
  }
};

export const addTaskComment = async (req, res) => {
  try {
    const comment = await addStaffTaskComment(req.params.id, req.body || {}, req.user || {});
    if (!comment) return res.status(404).json({ success: false, message: "Task not found" });
    return res.status(201).json({ success: true, comment });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to add task comment" });
  }
};

export const deleteTask = async (req, res) => {
  try {
    const task = await deleteStaffTask(req.params.id, req.user || {});
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to delete task" });
  }
};

export const getDashboard = async (req, res) => {
  try {
    const dashboard = await getStaffTaskDashboard({
      tenantId: resolveTaskTenantId(req),
      branchId: req.query?.branch_id || req.query?.branchId || null,
    });
    return res.json({ success: true, dashboard });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to load task dashboard" });
  }
};

export const autoAssignInventoryCounts = async (req, res) => {
  try {
    const tasks = await assignDailyInventoryCountTasks({
      tenantId: resolveTaskTenantId(req),
      actor: req.user || {},
      limit: req.body?.limit || req.query?.limit || 20,
    });
    return res.json({ success: true, tasks, created: tasks.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to assign inventory count tasks" });
  }
};

export const generateRecurringTasks = async (req, res) => {
  try {
    const result = await generateDueTaskInstancesFromTemplates({
      tenantId: resolveTaskTenantId(req),
      dueDate: req.body?.due_date || req.body?.dueDate || req.query?.due_date || undefined,
      actor: req.user || {},
    });
    return res.json({ success: true, tasks: result.created, created: result.created.length, skipped: result.skipped });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to generate recurring tasks" });
  }
};

export const redistributeAbsentTasks = async (req, res) => {
  try {
    const tasks = await redistributeTasks({
      tenantId: resolveTaskTenantId(req),
      employeeId: req.body?.employee_id || req.body?.employeeId || req.query?.employee_id || null,
      reason: req.body?.reason || "attendance_absence",
      actor: req.user || {},
    });
    return res.json({ success: true, tasks, reassigned: tasks.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to redistribute tasks" });
  }
};

export const reassignUnfinished = async (req, res) => {
  try {
    const tasks = await reassignOverdueTasks({ tenantId: resolveTaskTenantId(req), actor: req.user || {} });
    return res.json({ success: true, tasks, reassigned: tasks.length });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to reassign unfinished tasks" });
  }
};

export const getTaskBootstrap = async (req, res) => {
  try {
    await ensureStaffTasksSchema();
    const employee = await resolveEmployeeForUser(req.user || {}, resolveTaskTenantId(req));
    return res.json({
      success: true,
      employee,
      workflow: [
        "employee login",
        "attendance-aware assignment",
        "absence redistribution",
        "deadline reassignment",
        "completion",
        "live and email notifications",
      ],
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to load task bootstrap" });
  }
};

export const testEmployeePortalPush = async (req, res) => {
  try {
    const tenantId = resolveTaskTenantId(req);
    const employeeId = Number(req.body?.employee_id || req.body?.employeeId);
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      return res.status(400).json({ success: false, message: "employee_id is required" });
    }
    const employee = await db.query(
      `
      SELECT id, tenant_id
      FROM employees
      WHERE id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint)
      LIMIT 1
      `,
      [employeeId, tenantId]
    );
    if (!employee.rows[0]) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }
    const result = await sendEmployeePortalPush({
      tenantId: employee.rows[0].tenant_id,
      employeeId: employee.rows[0].id,
      title: req.body?.title || "اختبار التنبيهات",
      body: req.body?.body || "تم إرسال تنبيه تجريبي إلى بوابة الموظف.",
      tag: `employee-portal-test-${employee.rows[0].id}`,
      data: { event: "admin_test" },
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to send test push" });
  }
};
