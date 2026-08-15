// Shared, de-duplicated access to /settings/public.
//
// The endpoint returns ~334 KB and was being fetched twice on the public invoice
// page: once by App.jsx (currency + favicon) and again by PublicInvoice.jsx with
// `cache: "no-store"`, which also defeated the HTTP cache. Measured in
// production the second call cost 456ms for data the page already had.
//
// One in-flight promise is shared by every caller, so concurrent mounts collapse
// into a single request and later mounts reuse the resolved value.

import { api } from "./api";

let inFlight = null;
let resolved = null;

export const getPublicSettings = async ({ force = false } = {}) => {
  if (!force && resolved) return resolved;
  if (!force && inFlight) return inFlight;

  inFlight = api
    .get("/settings/public", { suppressErrorStatuses: [401, 403, 404, 500] })
    .then((response) => {
      resolved = response?.settings || {};
      return resolved;
    })
    .catch(() => {
      // A failed settings read must never block the page it decorates; callers
      // fall back to their own defaults.
      return {};
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

// Exposed for tests and for a deliberate refresh after a settings change.
export const resetPublicSettingsCache = () => {
  inFlight = null;
  resolved = null;
};
