import express from "express";
import {
  autoAssignInventoryCounts,
  addTaskComment,
  completeTask,
  createTask,
  deleteTask,
  getDashboard,
  getEmployeePortalTasks,
  getMyTasks,
  getPortalSettings,
  getTaskBootstrap,
  getTasks,
  generateRecurringTasks,
  reassignUnfinished,
  redistributeAbsentTasks,
  updateTask,
  updateEmployeePortalTask,
  updatePortalSettings,
  updateTaskStatus,
} from "../controllers/staffTasksController.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";

const router = express.Router();

router.get("/employee-portal", getEmployeePortalTasks);
router.patch("/employee-portal/tasks/:id/status", updateEmployeePortalTask);
router.post("/employee-portal/tasks/:id/complete", updateEmployeePortalTask);
router.get("/portal-settings", protect, permit("staff_tasks", "manage"), getPortalSettings);
router.put("/portal-settings", protect, permit("staff_tasks", "manage"), updatePortalSettings);
router.get("/bootstrap", protect, permit("staff_tasks", "view"), getTaskBootstrap);
router.get("/", protect, permit("staff_tasks", "view"), getTasks);
router.get("/my", protect, permit("staff_tasks", "view"), getMyTasks);
router.get("/dashboard", protect, permit("staff_tasks", "view"), getDashboard);
router.post("/", protect, permit("staff_tasks", "create"), createTask);
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
