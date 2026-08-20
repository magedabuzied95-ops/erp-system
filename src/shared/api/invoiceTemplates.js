// Client for /api/invoice-templates — the customer-facing invoice template.
//
// Two audiences, two entry points:
//   - the operator in the Invoice Studio, who is signed in and manages the list
//   - the customer on /invoice/:token, who is signed OUT and only ever resolves
//     the one config their invoice renders with
// The public resolver is de-duplicated the same way getPublicSettings is: the
// invoice page and anything it mounts must not each fetch the config.

import { api } from "./api";
import { normalizeInvoiceTemplateConfig } from "../../../shared/invoiceTemplate.js";

export const listInvoiceTemplates = async () => {
  const response = await api.get("/invoice-templates");
  return Array.isArray(response?.templates) ? response.templates : [];
};

export const getInvoiceTemplateMeta = () => api.get("/invoice-templates/meta");

export const getInvoiceTemplate = async (id) => {
  const response = await api.get(`/invoice-templates/${id}`);
  return response?.template || null;
};

export const createInvoiceTemplate = async (payload) => {
  const response = await api.post("/invoice-templates", payload);
  return response?.template || null;
};

export const updateInvoiceTemplate = async (id, payload) => {
  const response = await api.patch(`/invoice-templates/${id}`, payload);
  return response?.template || null;
};

export const duplicateInvoiceTemplate = async (id, payload = {}) => {
  const response = await api.post(`/invoice-templates/${id}/duplicate`, payload);
  return response?.template || null;
};

export const deleteInvoiceTemplate = (id) => api.delete(`/invoice-templates/${id}`);

// Called on every invoice render. A backend that predates this endpoint answers 404,
// and the caller falls back to the defaults — that is a normal state while the frontend
// is ahead of the API, not something to log once per invoice.
export const resolveInvoiceTemplate = (params = {}) =>
  api.get("/invoice-templates/resolve", { params, suppressErrorStatuses: [401, 403, 404, 500] });

let publicInFlight = null;
let publicResolved = null;

// The signed-out invoice page. A failed read must never blank the invoice, so the
// normalized defaults — which reproduce the invoice as it renders today — are the
// fallback rather than an error state.
export const getPublicInvoiceTemplateConfig = async ({ force = false, ...params } = {}) => {
  if (!force && publicResolved) return publicResolved;
  if (!force && publicInFlight) return publicInFlight;

  publicInFlight = api
    .get("/public/invoice-template", { params, suppressErrorStatuses: [401, 403, 404, 500] })
    .then((response) => {
      publicResolved = normalizeInvoiceTemplateConfig(response?.config || {});
      return publicResolved;
    })
    .catch(() => normalizeInvoiceTemplateConfig({}))
    .finally(() => {
      publicInFlight = null;
    });

  return publicInFlight;
};

export const resetPublicInvoiceTemplateCache = () => {
  publicInFlight = null;
  publicResolved = null;
};
