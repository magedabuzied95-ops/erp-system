import { metaAdsRequest } from "../shared/metaAdsApi";

// Endpoint wrappers for /api/meta-ads/records (see server records.routes.js).
const base = (resource) => `/records/${encodeURIComponent(resource)}`;
const one = (resource, id) => `${base(resource)}/${encodeURIComponent(id)}`;

export const recordsApi = {
  list: (resource, params) => metaAdsRequest.get(base(resource), params),
  get: (resource, id, params) => metaAdsRequest.get(one(resource, id), params),
  create: (resource, body) => metaAdsRequest.post(base(resource), body),
  update: (resource, id, body) => metaAdsRequest.put(one(resource, id), body),
  remove: (resource, id) => metaAdsRequest.delete(one(resource, id)),
  duplicate: (resource, id, suffix) => metaAdsRequest.post(`${one(resource, id)}/duplicate`, { suffix }),
  action: (resource, id, action) => metaAdsRequest.post(`${one(resource, id)}/actions/${encodeURIComponent(action)}`),
  aiInstructions: (resource, id) => metaAdsRequest.get(`${one(resource, id)}/ai-instructions`),
  saveAiInstructions: (resource, id, rows) => metaAdsRequest.put(`${one(resource, id)}/ai-instructions`, { rows }),
  lookup: (kind, params) => metaAdsRequest.get(`/records/lookups/${encodeURIComponent(kind)}`, params),
};
