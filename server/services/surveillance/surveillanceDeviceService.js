// Surveillance orchestration — the layer between the routes and the device.
//
// The routes decide who may act. This decides what happens. It is the only
// place that assembles a provider, and therefore the only place a decrypted
// credential exists — for the duration of one call, on the stack, never stored.
//
// EVERY PUBLIC FUNCTION TAKES tenantId FIRST
// ------------------------------------------
// Same invariant as the repositories, for the same reason: a function whose
// tenant is a middle argument is a function someone eventually calls with the
// arguments transposed.

import crypto from "node:crypto";

import db from "../../database/db.js";
import { createProvider } from "./providers/providerRegistry.js";
import { createTransport } from "./transports/transportRegistry.js";
import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "./surveillanceErrors.js";
import { assertCapability, describeCapabilities, normalizeCapabilitySet } from "./surveillanceCapabilities.js";
import { validateProbedCapabilities } from "./surveillanceValidation.js";
import { STREAM_PURPOSES, estimateBitrateKbps, selectStreamProfile } from "./surveillanceStreamProfiles.js";
import { surveillanceLogError } from "./surveillanceRedaction.js";
import { assertMockTransportAllowed } from "./transports/MockSurveillanceTransport.js";
import * as devices from "./repositories/surveillanceDeviceRepository.js";
import * as credentials from "./repositories/surveillanceCredentialRepository.js";
import * as access from "./repositories/surveillanceAccessRepository.js";

/**
 * Build a provider for one device.
 *
 * The credential is decrypted here and passed straight into the provider. It is
 * never assigned to `req`, never returned, and never logged. When the call
 * stack unwinds it is garbage.
 */
const openDevice = async (tenantId, device, client = db) => {
  if (device.transport_type === "mock") assertMockTransportAllowed();

  const allowedCidrs = await access.listAllowedCidrs(tenantId, device.transport_type, client);
  const transport = createTransport(device.transport_type, {
    device,
    allowedCidrs,
    timeoutMs: 10000,
  });

  const secret = await credentials.loadCredentialsForConnection(tenantId, device.id, client);
  return createProvider(device.vendor_key, { transport, credentials: secret, device });
};

/** Same, but the caller only needs a device row it has already fetched. */
export const withDevice = async (tenantId, deviceId, handler, client = db) => {
  const device = await devices.getDeviceById(tenantId, deviceId, client);
  const provider = await openDevice(tenantId, device, client);
  return handler(provider, device);
};

/* ------------------------------------------------------------------ *
 * Device lifecycle
 * ------------------------------------------------------------------ */

export const listDevices = async (tenantId, { branchFilter } = {}, client = db) => {
  const rows = await devices.listDevices(
    tenantId,
    { branchIds: branchFilter?.restricted ? branchFilter.branchIds : null },
    client,
  );
  return rows.map(devices.toPublicDevice);
};

export const getDeviceDetail = async (tenantId, deviceId, client = db) => {
  const device = await devices.getDeviceById(tenantId, deviceId, client);
  const [capabilityRow, channels, credentialStatus] = await Promise.all([
    devices.getCapabilities(tenantId, deviceId, client),
    devices.listChannels(tenantId, deviceId, client),
    credentials.describeCredentials(tenantId, deviceId, client),
  ]);

  return {
    device: devices.toPublicDevice(device),
    ...describeCapabilities(capabilityRow?.capabilities, {
      probedAt: capabilityRow?.probed_at || null,
      probeStatus: capabilityRow?.probe_status || "",
    }),
    channels: channels.map(devices.toPublicChannel),
    credentials: credentialStatus,
  };
};

/**
 * Create a device and store its credential in one transaction.
 *
 * They must commit together. A device row with no credential is unusable and
 * looks like a bug; a credential with no device row is an orphaned secret.
 */
export const createDevice = async (tenantId, payload, secret, { userId } = {}, client = db) => {
  if (payload.transport_type === "mock") assertMockTransportAllowed();

  const connection = await client.connect();
  try {
    await connection.query("BEGIN");
    const device = await devices.createDevice(tenantId, payload, { userId }, connection);
    await credentials.saveCredentials(
      tenantId,
      device.id,
      { username: secret.username, password: secret.password },
      connection,
    );
    await connection.query("COMMIT");
    return devices.toPublicDevice(device);
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => {});
    // A duplicate endpoint is a user error, not a server fault: the same
    // recorder added twice would report two conflicting health states.
    if (error?.code === "23505") {
      throw new SurveillanceError("a device with this address already exists", {
        code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
        status: 409,
        details: { field: "host" },
      });
    }
    throw error;
  } finally {
    connection.release();
  }
};

export const updateDevice = async (tenantId, deviceId, payload, { userId } = {}, client = db) => {
  const updated = await devices.updateDevice(tenantId, deviceId, payload, { userId }, client);
  return devices.toPublicDevice(updated);
};

export const deleteDevice = async (tenantId, deviceId, client = db) =>
  devices.deleteDevice(tenantId, deviceId, client);

/* ------------------------------------------------------------------ *
 * Connection, probe, import
 * ------------------------------------------------------------------ */

export const testConnection = async (tenantId, deviceId, client = db) =>
  withDevice(tenantId, deviceId, async (provider) => {
    const result = await provider.testConnection();
    await devices.recordDeviceStatus(
      tenantId,
      deviceId,
      { status: result.ok ? "online" : "offline", errorCode: "" },
      client,
    );
    return result;
  }, client);

/**
 * Probe a device and write down what it can do.
 *
 * The status field distinguishes the three outcomes an operator needs to tell
 * apart: the probe ran, the probe could not reach the device, or the device
 * rejected our credentials. Collapsing them into "failed" turns a wrong
 * password into a hardware investigation.
 */
export const probeDevice = async (tenantId, deviceId, client = db) =>
  withDevice(tenantId, deviceId, async (provider, device) => {
    let identity = null;
    let capabilities = null;
    let probeStatus = "ok";
    let probeError = "";

    try {
      identity = await provider.getDeviceInfo();
      capabilities = validateProbedCapabilities(await provider.getCapabilities());
    } catch (error) {
      probeStatus =
        error?.code === SURVEILLANCE_ERROR_CODES.DEVICE_UNAUTHORIZED ? "unauthorized" : "unreachable";
      probeError = String(error?.code || "").slice(0, 120);
      await devices.recordDeviceStatus(
        tenantId,
        deviceId,
        { status: probeStatus === "unauthorized" ? "unauthorized" : "offline", errorCode: probeError },
        client,
      );
      surveillanceLogError("probe_failed", error, { tenantId, deviceId });
      throw error;
    }

    await devices.recordDeviceIdentity(tenantId, deviceId, identity, client);
    await devices.saveCapabilities(
      tenantId,
      deviceId,
      { capabilities, probeStatus, probeError, firmware: identity.firmware || "" },
      client,
    );
    await devices.recordDeviceStatus(tenantId, deviceId, { status: "online" }, client);

    return {
      identity,
      ...describeCapabilities(capabilities, { probedAt: new Date().toISOString(), probeStatus }),
      transport: device.transport_type,
    };
  }, client);

/**
 * Import channels discovered on the device.
 *
 * Re-running this must be safe: the upsert deliberately does not touch
 * `display_name`, so an operator who has renamed "Channel 3" to "Fitting Rooms"
 * keeps that name across every future import.
 */
export const importChannels = async (tenantId, deviceId, client = db) =>
  withDevice(tenantId, deviceId, async (provider) => {
    const discovered = await provider.getChannels();

    const saved = [];
    for (const channel of discovered) {
      const row = await devices.upsertChannel(tenantId, deviceId, channel, client);
      await devices.saveChannelProfiles(tenantId, row.id, channel.streamProfiles || [], client);
      saved.push({ ...row, stream_profiles: channel.streamProfiles || [] });
    }

    return {
      imported: saved.length,
      channels: saved.map((row) => ({
        ...devices.toPublicChannel(row),
        stream_profiles: row.stream_profiles,
      })),
    };
  }, client);

/* ------------------------------------------------------------------ *
 * Reads that need a capability
 * ------------------------------------------------------------------ */

const capabilitiesFor = async (tenantId, deviceId, client = db) => {
  const row = await devices.getCapabilities(tenantId, deviceId, client);
  return normalizeCapabilitySet(row?.capabilities);
};

/** Every device read goes through here, so the gate cannot be forgotten. */
const guarded = async (tenantId, deviceId, capability, handler, { intent = "read" } = {}, client = db) => {
  const capabilities = await capabilitiesFor(tenantId, deviceId, client);
  assertCapability(capabilities, capability, intent);
  return withDevice(tenantId, deviceId, handler, client);
};

export const getStorage = (tenantId, deviceId, client = db) =>
  guarded(tenantId, deviceId, "storageInfo", (provider) => provider.getStorageInfo(), {}, client);

export const getEncoderConfig = (tenantId, deviceId, channelIndex, client = db) =>
  guarded(tenantId, deviceId, "encoderSettings", (provider) => provider.getEncoderConfig(channelIndex), {}, client);

export const getRecordingConfig = (tenantId, deviceId, channelIndex, client = db) =>
  guarded(tenantId, deviceId, "recordingSettings", (provider) => provider.getRecordingConfig(channelIndex), {}, client);

export const getMotionConfig = (tenantId, deviceId, channelIndex, client = db) =>
  guarded(tenantId, deviceId, "motionDetection", (provider) => provider.getMotionConfig(channelIndex), {}, client);

export const getNetworkInfo = (tenantId, deviceId, client = db) =>
  guarded(tenantId, deviceId, "networkSettings", (provider) => provider.getNetworkInfo(), {}, client);

export const getSystemTime = (tenantId, deviceId, client = db) =>
  guarded(tenantId, deviceId, "timeSettings", (provider) => provider.getSystemTime(), {}, client);

export const searchRecordings = (tenantId, deviceId, channelIndex, from, to, client = db) =>
  guarded(
    tenantId,
    deviceId,
    "playback",
    async (provider) => {
      const recordings = await provider.searchRecordings(channelIndex, from, to);
      // The on-device file path is a device-internal locator. Playback uses it
      // server-side; a browser has no use for it and publishing it is a small
      // leak with no benefit.
      return recordings.map(({ devicePath, ...rest }) => rest);
    },
    {},
    client,
  );

/* ------------------------------------------------------------------ *
 * Streams
 * ------------------------------------------------------------------ */

/**
 * Choose a profile and return something a browser can act on.
 *
 * What it does NOT return is the stream source. That is built inside the media
 * layer from the credential, and the browser gets a gateway URL and a ticket.
 * Until a media gateway is deployed this reports the DECISION only, which is
 * what the Live View grid needs to render its tiles and its bandwidth estimate.
 */
export const resolveStreamPlan = async (tenantId, channelId, { purpose, tileCount, budgetKbps } = {}, client = db) => {
  const channel = await devices.getChannelById(tenantId, channelId, client);
  const capabilities = await capabilitiesFor(tenantId, channel.device_id, client);
  assertCapability(capabilities, purpose === STREAM_PURPOSES.PLAYBACK ? "playback" : "liveView", "read");

  const { profile, reason } = selectStreamProfile({
    profiles: channel.stream_profiles || [],
    purpose,
    tileCount,
    budgetKbps,
  });

  return {
    channel_id: channel.id,
    device_id: channel.device_id,
    profile_key: profile.key,
    profile: {
      label: profile.label,
      codec: profile.codec,
      width: profile.width,
      height: profile.height,
      fps: profile.fps,
      bitrate_kbps: estimateBitrateKbps(profile),
      browser_native: profile.browser_native,
    },
    selection_reason: reason,
    // No gateway is deployed, so nothing is playable yet. Saying so explicitly
    // lets the UI render a real tile with a real "not available" state rather
    // than a spinner that never resolves.
    playable: false,
    unavailable_reason: "media-gateway-not-configured",
  };
};

/**
 * Bandwidth estimate for a whole layout, so the grid can warn BEFORE it opens
 * sixteen streams on a connection that cannot carry them.
 */
export const estimateLayout = async (tenantId, channelIds = [], { tileCount, budgetKbps } = {}, client = db) => {
  const plans = [];
  for (const channelId of channelIds) {
    plans.push(
      await resolveStreamPlan(
        tenantId,
        channelId,
        { purpose: STREAM_PURPOSES.GRID, tileCount, budgetKbps },
        client,
      ).catch((error) => ({ channel_id: Number(channelId), error: error?.code || "unknown" })),
    );
  }

  const totalKbps = plans.reduce((sum, plan) => sum + (plan.profile?.bitrate_kbps || 0), 0);
  return {
    plans,
    total_kbps: totalKbps,
    over_budget: budgetKbps > 0 ? totalKbps > budgetKbps : false,
  };
};

/* ------------------------------------------------------------------ *
 * Dangerous actions
 * ------------------------------------------------------------------ */

/**
 * Restart.
 *
 * The capability is expected to be `unknown` on the reference device, because
 * the probe refuses to verify a restart by restarting. `unknown` blocks here,
 * which is the correct outcome: the control is hidden and the endpoint refuses.
 */
export const restartDevice = (tenantId, deviceId, client = db) =>
  guarded(
    tenantId,
    deviceId,
    "deviceRestart",
    async (provider) => {
      const result = await provider.restartDevice();
      await devices.recordDeviceStatus(tenantId, deviceId, { status: "unknown", errorCode: "restarting" }, client);
      return result;
    },
    { intent: "write" },
    client,
  );

/** A stable fingerprint for confirming a dangerous action against a device. */
export const dangerousActionToken = (tenantId, deviceId, action) =>
  crypto
    .createHash("sha256")
    .update(`${tenantId}:${deviceId}:${action}`)
    .digest("hex")
    .slice(0, 12);
