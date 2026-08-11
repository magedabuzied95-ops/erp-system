import { api } from "../../../shared/api/api";

const BASE = "/ai-studio";
const opts = (headers) => ({ headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });

export const getStudioOverview = (headers) => api.get(`${BASE}/overview`, opts(headers));
export const listWorkflows = (headers) => api.get(`${BASE}/workflows`, opts(headers));
export const getWorkflow = (id, headers) => api.get(`${BASE}/workflows/${encodeURIComponent(id)}`, opts(headers));
export const createWorkflow = (payload, headers) => api.post(`${BASE}/workflows`, payload || {}, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const updateWorkflow = (id, payload, headers) => api.put(`${BASE}/workflows/${encodeURIComponent(id)}`, payload || {}, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const validateDefinition = (definition, headers) => api.post(`${BASE}/workflows/validate`, { definition }, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const runWorkflow = (id, input, headers) => api.post(`${BASE}/workflows/${encodeURIComponent(id)}/run`, { input: input || {} }, { headers });
export const setWorkflowEnabled = (id, enabled, headers) => api.post(`${BASE}/workflows/${encodeURIComponent(id)}/enable`, { enabled }, { headers });
export const seedExampleWorkflow = (headers) => api.post(`${BASE}/workflows/seed-example`, {}, { headers });
export const listRuns = (headers, params) => api.get(`${BASE}/runs`, { headers, params, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const getRun = (id, headers) => api.get(`${BASE}/runs/${encodeURIComponent(id)}`, opts(headers));
export const listApprovals = (headers, status = "pending") => api.get(`${BASE}/approvals`, { headers, params: { status }, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const approveApproval = (id, headers) => api.post(`${BASE}/approvals/${encodeURIComponent(id)}/approve`, {}, { headers });
export const rejectApproval = (id, headers) => api.post(`${BASE}/approvals/${encodeURIComponent(id)}/reject`, {}, { headers });
export const listTools = (headers) => api.get(`${BASE}/tools`, opts(headers));
// Phase 4 — triggers, automation kill switch, archive.
export const listTriggers = (headers) => api.get(`${BASE}/triggers`, opts(headers));
export const getAutomationStatus = (headers) => api.get(`${BASE}/automation/status`, opts(headers));
export const setTenantAutomation = (enabled, headers) => api.post(`${BASE}/automation/tenant`, { enabled }, { headers });
export const archiveWorkflow = (id, headers) => api.post(`${BASE}/workflows/${encodeURIComponent(id)}/archive`, {}, { headers });
export const unarchiveWorkflow = (id, headers) => api.post(`${BASE}/workflows/${encodeURIComponent(id)}/unarchive`, {}, { headers });
export const listWorkflowsWithArchived = (headers) => api.get(`${BASE}/workflows`, { headers, params: { includeArchived: 1 }, suppressErrorStatuses: [400, 403, 404, 409, 500] });
// Phase 5 — delegated WRITE grants + tenant timezone.
export const listDelegatableTools = (headers) => api.get(`${BASE}/delegatable-tools`, opts(headers));
export const listWorkflowGrants = (id, headers) => api.get(`${BASE}/workflows/${encodeURIComponent(id)}/grants`, opts(headers));
export const grantWorkflowTool = (id, toolId, headers) => api.post(`${BASE}/workflows/${encodeURIComponent(id)}/grants`, { toolId }, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const revokeWorkflowTool = (id, toolId, headers) => api.delete(`${BASE}/workflows/${encodeURIComponent(id)}/grants/${encodeURIComponent(toolId)}`, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const getRestockRecovery = (headers) => api.get(`${BASE}/restock-recovery`, opts(headers));
export const seedRestockRecoveryTemplate = (headers) => api.post(`${BASE}/restock-recovery/seed-template`, {}, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
// Phase 7 — variant-level restock intents (operator view + management).
export const getRestockIntents = (headers, status = null) => api.get(`${BASE}/restock-intents`, { headers, params: status ? { status } : {}, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const cancelRestockIntent = (id, headers) => api.post(`${BASE}/restock-intents/${encodeURIComponent(id)}/cancel`, {}, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const fulfilRestockIntent = (id, headers) => api.post(`${BASE}/restock-intents/${encodeURIComponent(id)}/fulfil`, {}, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
// Phase 8 — human-approved customer restock messaging.
export const getRestockMessagingMode = (headers) => api.get(`${BASE}/restock-messaging/mode`, opts(headers));
export const setRestockMessagingMode = (mode, headers) => api.post(`${BASE}/restock-messaging/mode`, { mode }, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const getRestockNotifications = (headers, status = null) => api.get(`${BASE}/restock-notifications`, { headers, params: status ? { status } : {}, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const editRestockNotification = (id, text, headers) => api.post(`${BASE}/restock-notifications/${encodeURIComponent(id)}/edit`, { text }, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const rejectRestockNotification = (id, reason, headers) => api.post(`${BASE}/restock-notifications/${encodeURIComponent(id)}/reject`, { reason }, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const approveSendRestockNotification = (id, headers) => api.post(`${BASE}/restock-notifications/${encodeURIComponent(id)}/approve-send`, {}, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
// Phase 9 — delivery reconciliation observability.
export const getRestockUnmatchedDeliveryEvents = (headers) => api.get(`${BASE}/restock-notifications/unmatched-events`, opts(headers));
export const getAutomationTimezone = (headers) => api.get(`${BASE}/automation/timezone`, opts(headers));
export const setAutomationTimezone = (timezone, headers) => api.post(`${BASE}/automation/timezone`, { timezone }, { headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });
