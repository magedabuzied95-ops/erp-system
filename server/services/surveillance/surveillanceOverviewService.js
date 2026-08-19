// The Surveillance dashboard's data, assembled honestly.
//
// THE RULE THIS FILE IS BUILT AROUND
// ----------------------------------
// Never invent a value. A dashboard whose tiles are always populated is a
// dashboard nobody can trust, because the one time the recorder is unreachable
// it will show the last plausible number instead of saying so. Every field here
// is either a real reading or an explicit `null` with a `*_status` of
// "unknown", and the UI renders those differently.
//
// WHY THE DEVICE CALLS ARE BEST-EFFORT
// ------------------------------------
// Storage and clock come from the recorder itself, over the LAN, and a recorder
// that has just gone offline does not fail fast — it hangs until a TCP timeout.
// A dashboard that blocks on that is a dashboard that appears broken whenever a
// camera is. So those calls are bounded and their failure degrades one tile
// rather than the page.

import db from "../../database/db.js";
import { configuredGatewayKey, getMediaGateway } from "./media/mediaGatewayRegistry.js";
import { capacityFor, detectEncoderCapability } from "./media/mediaEncoderPolicy.js";
import * as devices from "./repositories/surveillanceDeviceRepository.js";
import { getStorage, getSystemTime, listDevices } from "./surveillanceDeviceService.js";
import { surveillanceLogError } from "./surveillanceRedaction.js";

/**
 * Bound a device call so one unreachable recorder cannot hang the dashboard.
 *
 * Resolves to `null` rather than rejecting, because "we could not read this"
 * is a legitimate dashboard state and not an error the page should die on.
 */
const withTimeout = async (promise, ms = 6000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Is the recorder's clock trustworthy?
 *
 * NTP is disabled on the reference device and this build must NOT enable it —
 * that is an explicit approval gate. So the clock is reported, compared, and
 * flagged, and the operator decides. Playback timestamps are only as good as
 * this, which is why it earns a dashboard tile rather than a footnote.
 */
const clockStateFrom = (systemTime) => {
  if (!systemTime) return { status: "unknown", ntp_enabled: null, drift_seconds: null };

  // Field names come from parseSystemTime, not from guesswork: `deviceTime`
  // and `ntpEnabled`. An earlier draft read `currentTime`, which does not
  // exist, so the tile would have reported "unknown" forever while the data
  // sat right there.
  const { ntpEnabled = null, deviceTime = null, clockTrusted = null } = systemTime;

  let drift = null;
  if (deviceTime) {
    // The device reports local wall time with no zone. Treating it as UTC
    // would manufacture a drift equal to the timezone offset, so it is parsed
    // as local time — the same zone the ERP host runs in, which is the shop's.
    const parsed = new Date(String(deviceTime).replace(" ", "T"));
    if (!Number.isNaN(parsed.getTime())) {
      drift = Math.round((Date.now() - parsed.getTime()) / 1000);
    }
  }

  return {
    status: "known",
    ntp_enabled: ntpEnabled,
    clock_trusted: clockTrusted,
    device_time: deviceTime,
    timezone_name: systemTime.timeZoneName ?? null,
    drift_seconds: drift,
    // The warning the operator must see before trusting a playback timeline.
    warn: clockTrusted === false || (drift !== null && Math.abs(drift) > 60),
  };
};

/**
 * Storage, using the four-partition interpretation the probe established.
 *
 * The trap this avoids: the recorder reports `State: "Success"` and a per-
 * partition `IsError` flag, and an earlier reading called the disk unhealthy
 * because "Success" did not match a naive /running|ok|normal/ test. It also
 * read only Detail[0] and therefore reported a quarter of the real capacity.
 *
 * And a full disk in overwrite mode is NORMAL for a recorder — that is what
 * continuous recording looks like once the disk has wrapped. Showing it as a
 * failure trains the operator to ignore the storage tile.
 */
const storageStateFrom = (storage) => {
  if (!storage) return { status: "unknown", total_gb: null, used_gb: null };

  // parseStorageInfo has ALREADY summed across disks and their partitions and
  // exposes the totals directly. An earlier draft re-summed a `partitions`
  // array that does not exist at the top level — the same "read only Detail[0]"
  // class of mistake that once reported a quarter of the real capacity.
  const { totalGb = null, usedGb = null, usedPercent = null, full = null, healthy = null,
          diskCount = null, partitionCount = null } = storage;

  return {
    status: "known",
    disks: diskCount,
    partitions: partitionCount,
    total_gb: totalGb,
    used_gb: usedGb,
    used_percent: usedPercent,
    healthy,
    full,
    // A recorder in overwrite mode runs at 100% for its whole service life.
    // `healthy` is the field that decides whether anything is wrong; `full` is
    // just a fact. Showing a recycling disk as a fault teaches the operator to
    // ignore the storage tile, which is worse than showing nothing.
    health_label: healthy === false ? "error" : full === true ? "recycling" : healthy === true ? "ok" : "unknown",
  };
};

/** Live media-plane state: what is actually transcoding right now. */
const mediaStateFrom = async () => {
  if (!configuredGatewayKey()) {
    return { configured: false, reachable: false, active_streams: 0, viewers: 0, capacity: null, encoder: null };
  }

  const capability = await detectEncoderCapability().catch(() => null);
  const capacity = capability
    ? capacityFor(capability.encoder, { cores: (await import("node:os")).default.availableParallelism?.() ?? 2 })
    : null;

  let gateway = null;
  try { gateway = getMediaGateway(); } catch { /* not configured for this deployment */ }
  if (!gateway) {
    return { configured: true, reachable: false, active_streams: 0, viewers: 0, capacity, encoder: capability?.encoder ?? null };
  }

  const health = await withTimeout(gateway.healthCheck(), 4000);
  const stats = await withTimeout(gateway.getStats(), 4000);

  return {
    configured: true,
    reachable: Boolean(health?.ok),
    // Each stream owns two paths — the credentialed source and the transcode.
    active_streams: stats ? Math.ceil((stats.paths || 0) / 2) : 0,
    viewers: stats?.viewers ?? 0,
    capacity: capacity?.max_concurrent_transcodes ?? null,
    limited_by: capacity?.limited_by ?? null,
    encoder: capability?.encoder ?? null,
    hardware_accelerated: capability?.hardware ?? false,
  };
};

/**
 * Everything the dashboard renders.
 *
 * @param {object} options
 * @param {boolean} [options.includeDeviceReadings] when false, skips the
 *        recorder round-trips entirely. The UI uses this for its fast first
 *        paint and then asks again for the slow tiles.
 */
export const surveillanceOverview = async (
  tenantId,
  { branchFilter, includeDeviceReadings = true } = {},
  client = db,
) => {
  const deviceList = await listDevices(tenantId, { branchFilter }, client);

  const perDevice = [];
  for (const device of deviceList) {
    const channels = await devices.listChannels(tenantId, device.id, client).catch(() => []);

    let storage = { status: "unknown", total_bytes: null, used_bytes: null };
    let clock = { status: "unknown", ntp_enabled: null, drift_seconds: null };

    // Only worth asking a recorder that is actually answering.
    if (includeDeviceReadings && device.status === "online") {
      const [rawStorage, rawTime] = await Promise.all([
        withTimeout(getStorage(tenantId, device.id, client)).catch((error) => {
          surveillanceLogError("overview_storage_failed", error, { tenantId, deviceId: device.id });
          return null;
        }),
        withTimeout(getSystemTime(tenantId, device.id, client)).catch(() => null),
      ]);
      storage = storageStateFrom(rawStorage);
      clock = clockStateFrom(rawTime);
    }

    perDevice.push({
      id: device.id,
      name: device.name,
      vendor_key: device.vendor_key,
      model: device.model,
      firmware: device.firmware,
      branch_id: device.branch_id,
      status: device.status,
      last_seen_at: device.last_seen_at,
      last_error_code: device.last_error_code,
      // The recorder's own channel count vs how many we have imported. A
      // mismatch means a probe is overdue, which is worth seeing.
      channel_count_device: device.channel_count ?? null,
      channel_count_imported: channels.length,
      channels_online: channels.filter((c) => c.status === "online").length,
      channels_offline: channels.filter((c) => c.status === "offline").length,
      channels_enabled: channels.filter((c) => c.is_enabled).length,
      channels_recording: channels.filter((c) => c.is_recording === true).length,
      storage,
      clock,
    });
  }

  const media = await mediaStateFrom();

  return {
    devices: perDevice,
    media,
    totals: {
      devices: deviceList.length,
      devices_online: deviceList.filter((d) => d.status === "online").length,
      devices_offline: deviceList.filter((d) => d.status === "offline").length,
      devices_unknown: deviceList.filter((d) => !["online", "offline"].includes(d.status)).length,
      channels_imported: perDevice.reduce((n, d) => n + d.channel_count_imported, 0),
      channels_online: perDevice.reduce((n, d) => n + d.channels_online, 0),
      channels_offline: perDevice.reduce((n, d) => n + d.channels_offline, 0),
      channels_recording: perDevice.reduce((n, d) => n + d.channels_recording, 0),
    },
    // Surfaced at the top level so the page can show one banner rather than
    // making the operator find the device with the bad clock.
    warnings: perDevice
      .filter((d) => d.clock?.warn)
      .map((d) => ({ device_id: d.id, device_name: d.name, kind: "clock-untrusted" })),
  };
};

/**
 * Test seam.
 *
 * These two are pure functions over a parser's output and carry the field-name
 * contract that a first draft got wrong in four places. Exported so the tests
 * can drive them with real captured device responses rather than mocking a
 * database and a recorder to reach them.
 */
export const __testables = { storageStateFrom, clockStateFrom };
