import express from "express";
import {
  autoAssignInventoryCounts,
  addTaskComment,
  completeTask,
  createTask,
  deleteTask,
  deleteTaskTemplate,
  getDashboard,
  getEmployeePortalTasks,
  getEmployeePortalPushKey,
  getMyTasks,
  getTaskTemplates,
  getPortalSettings,
  getTaskBootstrap,
  getTasks,
  generateRecurringTasks,
  reassignUnfinished,
  redistributeAbsentTasks,
  updateTask,
  updateEmployeePortalTask,
  subscribeEmployeePortalPushEndpoint,
  unsubscribeEmployeePortalPushEndpoint,
  updatePortalSettings,
  updateTaskTemplate,
  updateTaskStatus,
} from "../controllers/staffTasksController.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import staffTaskPhotoUpload from "../config/staffTaskPhotoUpload.js";

const router = express.Router();

const uploadStaffTaskPhoto = (req, res, next) => {
  staffTaskPhotoUpload.single("photo")(req, res, (error) => {
    if (!error) return next();
    return res.status(error.status || 400).json({
      success: false,
      code: error.code || "task_photo_invalid",
      message: error.code === "LIMIT_FILE_SIZE" ? "الصورة أكبر من 10 ميجابايت" : error.message || "Unsupported photo",
    });
  });
};

router.get("/employee-portal", getEmployeePortalTasks);
router.patch("/employee-portal/tasks/:id/status", updateEmployeePortalTask);
// Completion proof photo. Multipart, token in the query string (multer parses
// the body after the token check would have run). Stores the URL on the task
// metadata; the status call that follows is what closes the task.
router.post("/employee-portal/tasks/:id/photo", uploadStaffTaskPhoto, updateEmployeePortalTask);
router.post("/employee-portal/tasks/:id/complete", updateEmployeePortalTask);
router.get("/employee-portal/:token/push/public-key", getEmployeePortalPushKey);
router.post("/employee-portal/:token/push/subscribe", subscribeEmployeePortalPushEndpoint);
router.post("/employee-portal/:token/push/unsubscribe", unsubscribeEmployeePortalPushEndpoint);
router.get("/portal-settings", protect, permit("staff_tasks", "manage"), getPortalSettings);
router.put("/portal-settings", protect, permit("staff_tasks", "manage"), updatePortalSettings);
router.get("/bootstrap", protect, permit("staff_tasks", "view"), getTaskBootstrap);
router.get("/", protect, permit("staff_tasks", "view"), getTasks);
router.get("/templates", protect, permit("staff_tasks", "view"), getTaskTemplates);
router.put("/templates/:id", protect, permit("staff_tasks", "manage"), updateTaskTemplate);
router.delete(
  "/templates/:id",
  protect,
  permit("staff_tasks", "manage"),
  (req, _res, next) => {
    console.log("[staff-tasks-route] matched DELETE /api/staff-tasks/templates/:id", {
      templateId: req.params.id || null,
      userId: req.user?.id || null,
    });
    next();
  },
  deleteTaskTemplate
);
router.get("/my", protect, permit("staff_tasks", "view"), getMyTasks);
router.get("/dashboard", protect, permit("staff_tasks", "view"), getDashboard);
router.post(
  "/",
  protect,
  permit("staff_tasks", "create"),
  (req, res, next) => {
    console.time("staff-tasks-create-route");
    console.log("CREATE TASK START");
    console.log("[staff-tasks-route] POST /api/staff-tasks", {
      requestId: req.id || null,
      userId: req.user?.id || null,
      tenantId: req.user?.tenant_id || req.user?.tenantId || null,
    });
    console.log(req.body);
    console.log("STEP 1");
    res.once("finish", () => {
      console.timeEnd("staff-tasks-create-route");
    });
    next();
  },
  createTask
);
router.put("/:id", protect, permit("staff_tasks", "manage"), updateTask);
router.patch("/:id", protect, permit("staff_tasks", "manage"), updateTask);
router.patch("/:id/status", protect, permit("staff_tasks", "update"), updateTaskStatus);
router.post("/:id/complete", protect, permit("staff_tasks", "update"), completeTask);
router.post("/:id/comments", protect, permit("staff_tasks", "update"), addTaskComment);
router.delete("/:id", protect, permit("staff_tasks", "manage"), deleteTask);
router.post("/auto/inventory-counts", protect, permit("staff_tasks", "create"), autoAssignInventoryCounts);
router.post("/auto/generate-recurring", protect, permit("staff_tasks", "create"), generateRecurringTasks);
router.post("/redistribute/absent", protect, permit("staff_tasks", "manage"), redistributeAbsentTasks);
router.post("/reassign/unfinished", protect, permit("staff_tasks", "manage"), reassignUnfinished);

export default router;
