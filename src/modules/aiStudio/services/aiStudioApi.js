import { api } from "../../../shared/api/api";

const BASE = "/ai-studio";
const opts = (headers) => ({ headers, suppressErrorStatuses: [400, 403, 404, 409, 500] });

export const getStudioOverview = (headers) => api.get(`${BASE}/overview`, opts(headers));
export const listWorkflows = (headers) => api.get(`${BASE}/workflows`, opts(headers));
export const getWorkflow = (id, headers) => api.get(`${BASE}/workflows/${encodeURIComponent(id)}`, opts(headers));
export const runWorkflow = (id, input, headers) => api.post(`${BASE}/workflows/${encodeURIComponent(id)}/run`, { input: input || {} }, { headers });
export const setWorkflowEnabled = (id, enabled, headers) => api.post(`${BASE}/workflows/${encodeURIComponent(id)}/enable`, { enabled }, { headers });
export const seedExampleWorkflow = (headers) => api.post(`${BASE}/workflows/seed-example`, {}, { headers });
export const listRuns = (headers, params) => api.get(`${BASE}/runs`, { headers, params, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const getRun = (id, headers) => api.get(`${BASE}/runs/${encodeURIComponent(id)}`, opts(headers));
export const listApprovals = (headers, status = "pending") => api.get(`${BASE}/approvals`, { headers, params: { status }, suppressErrorStatuses: [400, 403, 404, 409, 500] });
export const approveApproval = (id, headers) => api.post(`${BASE}/approvals/${encodeURIComponent(id)}/approve`, {}, { headers });
export const rejectApproval = (id, headers) => api.post(`${BASE}/approvals/${encodeURIComponent(id)}/reject`, {}, { headers });
export const listTools = (headers) => api.get(`${BASE}/tools`, opts(headers));
