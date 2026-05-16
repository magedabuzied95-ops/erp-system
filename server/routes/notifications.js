import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  deleteNotification,
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
} from "../services/notificationsService.js";

const router = express.Router();

router.get("/", protect, permit("notifications", "view"), async (req, res) => {
  try {
    const notifications = await listNotifications({
      ...req.query,
      unread: req.query.unread === "1" || req.query.unread === "true",
      important: req.query.important === "1" || req.query.important === "true",
      user: req.user,
    });
    res.json({ success: true, notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to load notifications" });
  }
});

router.get("/unread-count", protect, permit("notifications", "view"), async (req, res) => {
  try {
    const count = await getUnreadCount(req.user);
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to load unread count" });
  }
});

router.post("/:id/read", protect, permit("notifications", "view"), async (req, res) => {
  try {
    const notification = await markAsRead(req.params.id, req.user);
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to mark notification as read" });
  }
});

router.post("/read-all", protect, permit("notifications", "view"), async (req, res) => {
  try {
    const updated = await markAllAsRead(req.user);
    res.json({ success: true, updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to mark notifications as read" });
  }
});

router.delete("/:id", protect, permit("notifications", "manage"), async (req, res) => {
  try {
    const deleted = await deleteNotification(req.params.id, req.user);
    if (!deleted) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || "Failed to delete notification" });
  }
});

export default router;
