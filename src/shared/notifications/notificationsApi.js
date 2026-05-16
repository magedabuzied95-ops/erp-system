import { api } from "../api/api";

export const normalizeNotification = (row = {}) => ({
  id: row.id,
  tenant_id: row.tenant_id ?? null,
  user_id: row.user_id ?? null,
  role_key: row.role_key || "",
  branch_id: row.branch_id ?? null,
  type: row.type || "system",
  category: row.category || "system",
  priority: row.priority || "medium",
  title: row.title || "Notification",
  message: row.message || "",
  action_url: row.action_url || "",
  action_label: row.action_label || "",
  entity_type: row.entity_type || "",
  entity_id: row.entity_id || "",
  metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  is_read: Boolean(row.is_read),
  read_at: row.read_at || null,
  created_at: row.created_at || new Date().toISOString(),
  updated_at: row.updated_at || null,
});

const unwrapNotifications = (response) =>
  (Array.isArray(response?.notifications) ? response.notifications : Array.isArray(response) ? response : []).map(normalizeNotification);

export const fetchNotifications = async (params = {}) => unwrapNotifications(await api.get("/notifications", { params }));

export const fetchUnreadCount = async () => {
  const response = await api.get("/notifications/unread-count");
  return Number(response?.count || 0);
};

export const markNotificationRead = async (id) => {
  const response = await api.post(`/notifications/${encodeURIComponent(id)}/read`, {});
  return normalizeNotification(response?.notification || response);
};

export const markAllNotificationsRead = async () => api.post("/notifications/read-all", {});

export const deleteNotificationById = async (id) => api.delete(`/notifications/${encodeURIComponent(id)}`);
