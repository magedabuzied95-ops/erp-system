import { metaAdsRequest } from "../../shared/metaAdsApi";
import { API_BASE_URL } from "../../../../shared/constants/app.js";
import { getCurrentTenant, getCurrentUser, getToken } from "../../../../shared/auth/authStorage";

// Endpoint wrappers for /api/meta-ads/manager/wizard (see server wizard.routes.js).
const W = "/manager/wizard";

export const wizardApi = {
  loadTree: (campaignId) => metaAdsRequest.get(`${W}/drafts/${campaignId}`),
  saveCampaign: (body) => metaAdsRequest.post(`${W}/drafts/campaign`, body),
  saveAdset: (body) => metaAdsRequest.post(`${W}/drafts/adset`, body),
  saveAd: (body) => metaAdsRequest.post(`${W}/drafts/ad`, body),
  deleteDraft: (level, id) => metaAdsRequest.post(`${W}/drafts/delete`, { level, id }),
  validate: (campaignId) => metaAdsRequest.post(`${W}/validate`, { campaign_id: campaignId }),
  publish: (campaignId) => metaAdsRequest.post(`${W}/publish`, { campaign_id: campaignId }),
  searchLocations: (params) => metaAdsRequest.get(`${W}/search/locations`, params),
  searchInterests: (params) => metaAdsRequest.get(`${W}/search/interests`, params),
  searchLocales: (params) => metaAdsRequest.get(`${W}/search/locales`, params),
  geocode: (params) => metaAdsRequest.get(`${W}/geo/geocode`, params),
  estimateReach: (body) => metaAdsRequest.post(`${W}/estimate/reach`, body),
  listAudiences: (accountId) => metaAdsRequest.get(`${W}/saved-audiences`, { account_id: accountId }),
  saveAudience: (body) => metaAdsRequest.post(`${W}/saved-audiences/save`, body),
  getAudience: (id) => metaAdsRequest.get(`${W}/saved-audiences/${id}`),
  deleteAudience: (id) => metaAdsRequest.post(`${W}/saved-audiences/delete`, { id }),
  preview: (adId, adFormat) => metaAdsRequest.post(`${W}/preview`, { ad_id: adId, ad_format: adFormat }),
};

// Same base-URL rule as shared/api/api.js (Vercel / nip.io hosts go through /api).
const apiBase = () => {
  if (typeof window !== "undefined") {
    const host = String(window.location.hostname || "").toLowerCase();
    if (host.endsWith(".nip.io") || host.endsWith(".vercel.app")) return "/api";
  }
  return API_BASE_URL;
};

// Multipart upload with progress (fetch cannot report upload progress, XHR can).
export const uploadMedia = ({ file, accountId, onProgress }) =>
  new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (accountId) form.append("account_id", String(accountId));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase()}/meta-ads${W}/media/upload`);
    const token = getToken();
    const user = getCurrentUser();
    const tenant = getCurrentTenant();
    const tenantId = user?.tenant_id || user?.tenantId || tenant?.id || tenant?.tenant_id || "";
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (tenantId) xhr.setRequestHeader("x-tenant-id", String(tenantId));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText || "{}");
      } catch {
        body = {};
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.success !== false) resolve(body);
      else reject(Object.assign(new Error(body.message || `Upload failed (${xhr.status})`), { status: xhr.status, responseBody: body }));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
