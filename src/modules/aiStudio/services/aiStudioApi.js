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
