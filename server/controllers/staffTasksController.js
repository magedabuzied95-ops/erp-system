import {
  addStaffTaskComment,
  assignDailyInventoryCountTasks,
  createStaffTask,
  deleteStaffTask,
  ensureStaffTasksSchema,
  getStaffTaskDashboard,
  listStaffTasks,
  reassignOverdueTasks,
  redistributeTasks,
  resolveEmployeeForUser,
  resolveTaskTenantId,
  updateStaffTaskStatus,
} from "../services/staffTasksService.js";

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
    return res.status(500).json({ success: false, message: error.message || "Failed to update task" });
  }
};

export const completeTask = async (req, res) => {
  try {
    const task = await updateStaffTaskStatus(req.params.id, { ...(req.body || {}), status: "completed" }, req.user || {});
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    return res.json({ success: true, task });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed to complete task" });
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
    const dashboard = await getStaffTaskDashboard({ tenantId: resolveTaskTenantId(req) });
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
