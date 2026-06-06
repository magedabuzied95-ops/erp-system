import { api } from "../../../shared/api/api";

const tokenPath = (token) => `/manager-portal/${encodeURIComponent(token)}`;

export const managerPortalApi = {
  me: (token) => api.get(`${tokenPath(token)}/me`),
  dashboard: (token, params = {}) => api.get(`${tokenPath(token)}/dashboard`, { params }),
  invoice: (token, invoiceId) => api.get(`${tokenPath(token)}/invoices/${encodeURIComponent(invoiceId)}`),
  staff: (token) => api.get(`${tokenPath(token)}/staff`),
  tasks: (token) => api.get(`${tokenPath(token)}/tasks`),
  sales: (token) => api.get(`${tokenPath(token)}/sales`),
  stockAlerts: (token) => api.get(`${tokenPath(token)}/stock-alerts`),
  pushPublicKey: (token) => api.get(`${tokenPath(token)}/push/public-key`),
  subscribePush: (token, payload) => api.post(`${tokenPath(token)}/push/subscribe`, payload),
  testPush: (token, payload = {}) => api.post(`${tokenPath(token)}/push/test`, payload),
  unsubscribePush: (token, payload = {}) => api.post(`${tokenPath(token)}/push/unsubscribe`, payload),
  notifications: (token, params = {}) => api.get(`${tokenPath(token)}/notifications`, { params }),
  markNotificationRead: (token, id) => api.post(`${tokenPath(token)}/notifications/${encodeURIComponent(id)}/read`),
  markAllNotificationsRead: (token) => api.post(`${tokenPath(token)}/notifications/read-all`),
  chat: (token, threadId = null) => api.get(`${tokenPath(token)}/chat`, { params: threadId ? { thread_id: threadId } : {} }),
  chatThread: (token, threadId) => api.get(`${tokenPath(token)}/chat/${encodeURIComponent(threadId)}`),
  sendChatMessage: (token, threadId, formData) => api.post(`${tokenPath(token)}/chat/${encodeURIComponent(threadId)}/messages`, formData),
  markChatRead: (token, threadId) => api.post(`${tokenPath(token)}/chat/${encodeURIComponent(threadId)}/read`),
  createTask: (token, payload) => api.post(`${tokenPath(token)}/tasks`, payload),
  approveTask: (token, id, payload = {}) => api.patch(`${tokenPath(token)}/tasks/${encodeURIComponent(id)}/approve`, payload),
  rejectTask: (token, id, payload = {}) => api.patch(`${tokenPath(token)}/tasks/${encodeURIComponent(id)}/reject`, payload),
  reopenTask: (token, id, payload = {}) => api.patch(`${tokenPath(token)}/tasks/${encodeURIComponent(id)}/reopen`, payload),
  noteTask: (token, id, payload = {}) => api.post(`${tokenPath(token)}/tasks/${encodeURIComponent(id)}/notes`, payload),
  updateSettings: (token, payload) => api.patch(`${tokenPath(token)}/settings`, payload),
};

export default managerPortalApi;
