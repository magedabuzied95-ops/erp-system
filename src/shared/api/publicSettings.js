// Shared, de-duplicated access to /settings/public.
//
// The endpoint is large (~51 KB brotli, ~334 KB decoded) and every surface that
// decorates itself from settings wants it, so without a shared reader the same
// payload gets fetched several times per page load. It was measured twice on the
// public invoice page (the second call cost 456ms for data the page already had),
// and twice again on the storefront homepage -- at t=2.09s and t=3.83s, both with
// `cache: "no-store"`, which also defeats the HTTP cache.
//
// Two readers over one request:
//   getPublicSettingsResponse() -> the raw payload, for callers that read fields
//                                  outside `settings` (the storefront reads sale
//                                  mode from the envelope).
//   getPublicSettings()         -> the `settings` object, for everyone else.
//
// Both share one in-flight promise, so concurrent mounts collapse into a single
// request, and both share one short-lived cache so two mounts a second apart do
// not become two requests.

import { api } from "./api";

// Long enough to collapse everything a single page load asks for, short enough
// that a navigation after a settings change still picks the change up. The old
// direct callers passed `cache: "no-store"` to get that freshness; this bounds it
// instead of disabling caching outright.
const DEFAULT_MAX_AGE_MS = 60_000;

let inFlight = null;
let resolvedResponse = null;
let resolvedAt = 0;

const isFresh = (maxAgeMs) =>
  resolvedResponse !== null && Date.now() - resolvedAt < Math.max(0, maxAgeMs);

/**
 * The raw /settings/public payload.
 *
 * @param {{force?: boolean, maxAgeMs?: number}} [options]
 *   force    - bypass the cache and re-request (after saving settings).
 *   maxAgeMs - how old a cached payload may be and still be reused.
 */
export const getPublicSettingsResponse = async ({ force = false, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) => {
  if (!force && isFresh(maxAgeMs)) return resolvedResponse;
  if (!force && inFlight) return inFlight;

  inFlight = api
    .get("/settings/public", {
      suppressErrorStatuses: [401, 403, 404, 500],
      // Deliberately NOT `no-store`. The response carries an ETag and the server
      // sets no-cache, so the browser revalidates rather than refetching the whole
      // body -- which is what the old `no-store` callers actually wanted.
      headers: { "Cache-Control": "no-cache" },
    })
    .then((response) => {
      resolvedResponse = response || {};
      resolvedAt = Date.now();
      return resolvedResponse;
    })
    .catch(() => {
      // A failed settings read must never block the page it decorates; callers
      // fall back to their own defaults. Not cached, so the next mount retries.
      return {};
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

export const getPublicSettings = async (options = {}) => {
  const response = await getPublicSettingsResponse(options);
  return response?.settings || {};
};

// Exposed for tests and for a deliberate refresh after a settings change.
export const resetPublicSettingsCache = () => {
  inFlight = null;
  resolvedResponse = null;
  resolvedAt = 0;
};
