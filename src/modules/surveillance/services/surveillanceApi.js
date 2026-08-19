import { api } from "../../../shared/api/api";

// Every call goes through the ERP API. There is no direct-to-device path from
// the browser and there must never be one: the recorder's address and its
// credentials are server-side facts, and the only thing that crosses to the
// client is a gateway URL plus a short-lived ticket.

const BASE = "/surveillance";
const opts = (headers) => ({ headers, suppressErrorStatuses: [400, 403, 404, 409, 429, 500, 503] });

/* ---- dashboard ----------------------------------------------------- */
/**
 * @param {object} [options]
 * @param {boolean} [options.fast] skip the recorder round-trips (storage,
 *        clock) so the page paints immediately. Those tiles then render as
 *        "unknown" rather than as a stale number, and a second non-fast call
 *        fills them in.
 */
export const getOverview = ({ fast = false } = {}, headers) =>
  api.get(`${BASE}/overview`, { headers, params: fast ? { fast: 1 } : {}, suppressErrorStatuses: [400, 403, 404, 409, 429, 500, 503] });

/* ---- devices & channels ------------------------------------------- */
export const listDevices = (headers) => api.get(`${BASE}/devices`, opts(headers));
export const getDevice = (id, headers) => api.get(`${BASE}/devices/${encodeURIComponent(id)}`, opts(headers));
export const testConnection = (id, headers) =>
  api.post(`${BASE}/devices/${encodeURIComponent(id)}/test-connection`, {}, opts(headers));
export const probeDevice = (id, headers) =>
  api.post(`${BASE}/devices/${encodeURIComponent(id)}/probe`, {}, opts(headers));
export const listChannels = (deviceId, headers) =>
  api.get(`${BASE}/devices/${encodeURIComponent(deviceId)}/channels`, opts(headers));

/* ---- live ---------------------------------------------------------- */
export const getStreamPlan = (channelId, payload, headers) =>
  api.post(`${BASE}/channels/${encodeURIComponent(channelId)}/stream-plan`, payload || {}, opts(headers));

/**
 * Open a stream. Returns { whep_url, ticket, path_name, coded geometry, ... }.
 *
 * The ticket is short-lived by design, so this is called when a tile mounts —
 * not once at page load and cached. A ticket sitting in component state for an
 * hour is a ticket that has been in a heap snapshot for an hour.
 */
export const openStream = (channelId, payload, headers) =>
  api.post(`${BASE}/channels/${encodeURIComponent(channelId)}/stream`, payload || {}, opts(headers));

export const closeStream = (channelId, payload, headers) =>
  api.post(`${BASE}/channels/${encodeURIComponent(channelId)}/stream/close`, payload || {}, opts(headers));

export const getMediaCapacity = (headers) => api.get(`${BASE}/media/capacity`, opts(headers));

export const estimateLayout = (channelIds, budgetKbps, headers) =>
  api.post(`${BASE}/layout/estimate`, { channel_ids: channelIds, budget_kbps: budgetKbps }, opts(headers));

/* ---- device configuration (read) ----------------------------------- */
export const getStorage = (id, headers) => api.get(`${BASE}/devices/${encodeURIComponent(id)}/storage`, opts(headers));
export const getNetworkInfo = (id, headers) => api.get(`${BASE}/devices/${encodeURIComponent(id)}/network`, opts(headers));
export const getSystemTime = (id, headers) => api.get(`${BASE}/devices/${encodeURIComponent(id)}/time`, opts(headers));

// Path shape is /devices/:id/<thing>/:channelIndex — NOT nested under
// /channels/, which is a different resource keyed by the ERP channel id rather
// than the device-local index.
export const getEncoderConfig = (id, channelIndex, headers) =>
  api.get(`${BASE}/devices/${encodeURIComponent(id)}/encoder/${encodeURIComponent(channelIndex)}`, opts(headers));
export const getRecordingConfig = (id, channelIndex, headers) =>
  api.get(`${BASE}/devices/${encodeURIComponent(id)}/recording/${encodeURIComponent(channelIndex)}`, opts(headers));
export const getMotionConfig = (id, channelIndex, headers) =>
  api.get(`${BASE}/devices/${encodeURIComponent(id)}/motion/${encodeURIComponent(channelIndex)}`, opts(headers));

/* ---- playback ------------------------------------------------------ */
export const playbackBackend = (id, headers) =>
  api.get(`${BASE}/devices/${encodeURIComponent(id)}/playback/backend`, opts(headers));
export const searchPlayback = (id, channelIndex, payload, headers) =>
  api.post(`${BASE}/devices/${encodeURIComponent(id)}/playback/search/${encodeURIComponent(channelIndex)}`, payload || {}, opts(headers));
export const openPlayback = (id, channelIndex, payload, headers) =>
  api.post(`${BASE}/devices/${encodeURIComponent(id)}/playback/open/${encodeURIComponent(channelIndex)}`, payload || {}, opts(headers));

/* ---- snapshot ------------------------------------------------------ */
/**
 * Capture a still. Returns a blob URL the caller must revokeObjectURL() when
 * done — the bytes are never written to disk server-side, and leaking the
 * object URL is the browser-side equivalent of doing so.
 */
export const captureSnapshot = async (id, channelIndex, { save = false } = {}) => {
  const query = save ? "?save=1" : "";
  const response = await fetch(
    `/api/surveillance/devices/${encodeURIComponent(id)}/snapshot/${encodeURIComponent(channelIndex)}${query}`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) throw Object.assign(new Error("snapshot-failed"), { status: response.status });
  return URL.createObjectURL(await response.blob());
};

/* ---- audit --------------------------------------------------------- */
export const listDeviceAudit = (id, headers) =>
  api.get(`${BASE}/devices/${encodeURIComponent(id)}/audit`, opts(headers));
