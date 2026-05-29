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
import { isPerfDebugEnabled, logPerfTiming } from "../utils/perfDebug.js";

const router = express.Router();

const logRouteStart = (req, name) => {
  req._notificationRouteStartedAt = Date.now();
  if (!isPerfDebugEnabled()) return;
  console.info("[notifications] route start", {
    requestId: req.id,
    name,
    url: req.originalUrl,
    query: req.query,
  });
};

const logRouteEnd = (req, name, extra = {}) => {
  const totalMs = Date.now() - (req._notificationRouteStartedAt || Date.now());
  logPerfTiming(`notifications.${name}`, { handler_ms: totalMs, total_ms: totalMs }, { requestId: req.id, ...extra });
};

const logRouteError = (req, name, error) => {
  if (!isPerfDebugEnabled()) return;
  console.error("[notifications] route thrown", {
    requestId: req.id,
    name,
    durationMs: Date.now() - (req._notificationRouteStartedAt || Date.now()),
    message: error.message,
    code: error.code,
    stack: error.stack,
  });
};

router.get("/", protect, permit("notifications", "view"), async (req, res) => {
  logRouteStart(req, "list");
  if (req.permissionUnavailable) {
    logRouteEnd(req, "list", { permissionUnavailable: true });
    return res.json({ success: true, notifications: [], permissionUnavailable: true });
  }

  try {
    const notifications = await listNotifications({
      ...req.query,
      unread: req.query.unread === "1" || req.query.unread === "true",
      important: req.query.important === "1" || req.query.important === "true",
      user: req.user,
    });
    logRouteEnd(req, "list", { count: notifications.length });
    res.json({ success: true, notifications });
  } catch (error) {
    logRouteError(req, "list", error);
    res.status(500).json({ success: false, message: error.message || "Failed to load notifications" });
  }
});

router.get("/unread-count", protect, permit("notifications", "view"), async (req, res) => {
  logRouteStart(req, "unreadCount");
  if (req.permissionUnavailable) {
    logRouteEnd(req, "unreadCount", { permissionUnavailable: true });
    return res.json({ success: true, count: 0, permissionUnavailable: true });
  }

  try {
    const count = await getUnreadCount(req.user);
    logRouteEnd(req, "unreadCount", { count });
    res.json({ success: true, count });
  } catch (error) {
    logRouteError(req, "unreadCount", error);
    res.status(500).json({ success: false, message: error.message || "Failed to load unread count" });
  }
});

router.post("/:id/read", protect, permit("notifications", "view"), async (req, res) => {
  logRouteStart(req, "markRead");
  try {
    const notification = await markAsRead(req.params.id, req.user);
    if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });
    logRouteEnd(req, "markRead");
    res.json({ success: true, notification });
  } catch (error) {
    logRouteError(req, "markRead", error);
    res.status(500).json({ success: false, message: error.message || "Failed to mark notification as read" });
  }
});

router.post("/read-all", protect, permit("notifications", "view"), async (req, res) => {
  logRouteStart(req, "markAllRead");
  try {
    const updated = await markAllAsRead(req.user);
    logRouteEnd(req, "markAllRead", { updated });
    res.json({ success: true, updated });
  } catch (error) {
    logRouteError(req, "markAllRead", error);
    res.status(500).json({ success: false, message: error.message || "Failed to mark notifications as read" });
  }
});

router.delete("/:id", protect, permit("notifications", "manage"), async (req, res) => {
  logRouteStart(req, "delete");
  try {
    const deleted = await deleteNotification(req.params.id, req.user);
    if (!deleted) return res.status(404).json({ success: false, message: "Notification not found" });
    logRouteEnd(req, "delete");
    res.json({ success: true });
  } catch (error) {
    logRouteError(req, "delete", error);
    res.status(500).json({ success: false, message: error.message || "Failed to delete notification" });
  }
});

export default router;
