// Playback: find recorded footage, then stream a window of it.
//
// TWO PATHS, AND THE ONE THAT IS TRIED FIRST
// ------------------------------------------
// ONVIF Profile G is preferred. It is a standard (the same code will serve a
// Hikvision or Uniview recorder), it filters by time window ON THE DEVICE, and
// it does not allocate the leak-prone finder handles Dahua's `mediaFileFind`
// does.
//
// Dahua's implementation is the fallback and is already written and tested. It
// is NOT reached by a try/catch around ONVIF: the ONVIF path is probed once,
// per device, and the OUTCOME is cached and reported. "It threw so we tried the
// other one" hides the difference between a recorder that needs its own ONVIF
// account and one whose firmware has no Profile G at all — and those have
// completely different answers.
//
// THE CLOCK PROBLEM, STATED WHEREVER A TIME IS USED
// -------------------------------------------------
// NTP is DISABLED on the reference recorder and this build must not enable it.
// Every timestamp here — the search window, the returned file times, the
// seek position — is expressed in the RECORDER'S clock, which drifts. The
// service reports that drift alongside the results so the UI can warn, rather
// than silently presenting device time as if it were real time.
//
// AND PLAYBACK NEVER DOWNLOADS A DAY
// ----------------------------------
// The search returns metadata. Streaming a selected window goes through the
// same media gateway as live, as a bounded RTSP replay — never a file transfer.

import db from "../../database/db.js";
import { configuredGatewayKey, getMediaGateway } from "./media/mediaGatewayRegistry.js";
import { detectEncoderCapability } from "./media/mediaEncoderPolicy.js";
import { OnvifRecordingClient } from "./providers/onvif/OnvifRecordingClient.js";
import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "./surveillanceErrors.js";
import { surveillanceLog } from "./surveillanceRedaction.js";
import * as devices from "./repositories/surveillanceDeviceRepository.js";
import { getSystemTime, withDevice } from "./surveillanceDeviceService.js";

/**
 * Per-device ONVIF outcome, decided once.
 *
 * Cached because probing costs a network round trip and the answer only
 * changes when somebody reconfigures the recorder. `refresh` exists for the
 * Device Details page, so an operator who has just created an ONVIF account can
 * re-check without restarting the backend.
 */
const onvifSupport = new Map();

export const playbackBackendFor = async (tenantId, deviceId, { refresh = false } = {}, client = db) => {
  const key = `${tenantId}:${deviceId}`;
  if (!refresh && onvifSupport.has(key)) return onvifSupport.get(key);

  const outcome = await withDevice(
    tenantId,
    deviceId,
    async (provider, device) => {
      // The ONVIF client borrows the provider's already-guarded transport. It
      // must never open its own socket — the SSRF guard, the allowlist and the
      // pinned destination all live on that transport.
      const onvif = new OnvifRecordingClient({
        transport: provider.transport,
        credentials: provider.credentials,
        device,
      });
      return onvif.probeSupport();
    },
    client,
  ).catch(() => ({ state: "unreachable", reason: "probe-failed" }));

  const result = {
    backend: outcome.state === "supported" ? "onvif" : "dahua",
    onvif_state: outcome.state,
    // Kept so the UI can say WHY it fell back. "needs-account" is a question
    // for the owner; "not-supported" is a firmware fact.
    onvif_reason: outcome.reason,
  };
  onvifSupport.set(key, result);
  surveillanceLog("playback_backend_selected", { tenantId, deviceId, backend: result.backend, state: outcome.state });
  return result;
};

/** Test seam. */
export const __resetPlaybackBackends = () => onvifSupport.clear();

/**
 * Recordings in a window.
 *
 * The window is REQUIRED and bounded. An unbounded search is how a recorder
 * with a year of footage is asked to enumerate all of it.
 */
export const searchPlayback = async (
  tenantId,
  deviceId,
  channelIndex,
  { from, to },
  client = db,
) => {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new SurveillanceError("an invalid playback window was requested", {
      code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
      status: 400,
    });
  }
  const MAX_WINDOW_HOURS = 24;
  if ((end - start) / 3_600_000 > MAX_WINDOW_HOURS) {
    throw new SurveillanceError("playback windows are limited to 24 hours", {
      code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
      status: 400,
      details: { max_hours: MAX_WINDOW_HOURS },
    });
  }

  const selected = await playbackBackendFor(tenantId, deviceId, {}, client);

  const recordings = await withDevice(
    tenantId,
    deviceId,
    async (provider, device) => {
      if (selected.backend === "onvif") {
        const onvif = new OnvifRecordingClient({
          transport: provider.transport,
          credentials: provider.credentials,
          device,
        });
        return onvif.searchRecordings({ from: start, to: end });
      }
      // The vendor path. `devicePath` is stripped by the service layer above;
      // a browser has no use for an on-device file locator.
      return provider.searchRecordings(channelIndex, start, end);
    },
    client,
  );

  // The clock these timestamps came from, so the UI can warn rather than
  // present a drifting device clock as real time.
  const clock = await getSystemTime(tenantId, deviceId, client).catch(() => null);

  return {
    backend: selected.backend,
    onvif_state: selected.onvif_state,
    onvif_reason: selected.onvif_reason,
    window: { from: start.toISOString(), to: end.toISOString() },
    recordings: recordings.map(({ devicePath, ...rest }) => rest),
    clock: clock
      ? { device_time: clock.deviceTime, ntp_enabled: clock.ntpEnabled, trusted: clock.clockTrusted }
      : { device_time: null, ntp_enabled: null, trusted: null },
  };
};

/**
 * Open a bounded replay window through the media gateway.
 *
 * Identical security shape to live: the credentialed source is built here,
 * handed to the gateway here, and the browser receives a path plus a ticket.
 * The only difference is the source URL points at recorded footage.
 */
export const openPlayback = async (
  tenantId,
  deviceId,
  channelIndex,
  { from, to, recordingToken, userId },
  client = db,
) => {
  if (!configuredGatewayKey()) {
    return { playable: false, unavailable_reason: "media-gateway-not-configured" };
  }

  const device = await devices.getDeviceById(tenantId, deviceId, client);
  const selected = await playbackBackendFor(tenantId, deviceId, {}, client);
  const capability = await detectEncoderCapability();
  const gateway = getMediaGateway();

  const source = await withDevice(
    tenantId,
    deviceId,
    async (provider, deviceRow) => {
      if (selected.backend === "onvif" && recordingToken) {
        const onvif = new OnvifRecordingClient({
          transport: provider.transport,
          credentials: provider.credentials,
          device: deviceRow,
        });
        return onvif.buildReplaySource(recordingToken);
      }
      // CREDENTIALED. Same handling as a live source from here on.
      return provider.buildPlaybackSource(channelIndex, new Date(from), new Date(to));
    },
    client,
  );

  const opened = await gateway.ensurePath({
    tenantId,
    deviceId,
    channelId: channelIndex,
    userId,
    // A distinct stream key so a playback path can never collide with — or be
    // opened by a ticket minted for — the live view of the same channel.
    stream: `pb${Number(channelIndex)}`,
    sourceUrl: source.url,
    fps: 25,
    bitrateKbps: 2048,
    encoder: capability.encoder,
    sourceCodec: "hevc",
  });

  return {
    playable: true,
    backend: selected.backend,
    path_name: opened.pathName,
    whep_url: opened.whepUrl,
    ticket: opened.ticket,
    expires_in: opened.expiresIn,
    device_id: device.id,
    channel_index: Number(channelIndex),
  };
};
