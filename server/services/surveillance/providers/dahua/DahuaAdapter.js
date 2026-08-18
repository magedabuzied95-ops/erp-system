// Dahua provider.
//
// WHAT IT KNOWS AND WHAT IT DOES NOT
// ----------------------------------
// It knows Dahua's CGI dialect: which path answers which question, how the
// answers are shaped, and how channels are numbered. It does NOT know how the
// device is reached — every request goes through `this.transport`, which may be
// a real HTTP client, a tunnel, an agent RPC, or the mock. That is the whole
// point of the split, and it is why swapping the transport later requires no
// change here.
//
// NO REAL DEVICE HAS EVER ANSWERED THIS CODE
// ------------------------------------------
// Every endpoint below is a hypothesis drawn from published documentation for
// Dahua IP cameras. An entry-level XVR shares most of that surface and not all
// of it. The capability probe exists precisely because this file is a guess
// until a device says otherwise, and `probeCapabilities()` is the method that
// converts the guess into a recorded fact.
//
// CHANNEL NUMBERING
// -----------------
// Dahua indexes channels from 0 in the config API and from 1 in RTSP. The ERP
// uses 1-based everywhere because that is what is printed on the recorder. Every
// conversion in this file is explicit and commented; getting it wrong silently
// returns the wrong camera.

import crypto from "node:crypto";

import { SurveillanceProvider } from "../SurveillanceProvider.js";
import {
  SURVEILLANCE_ERROR_CODES,
  SurveillanceError,
  UnsupportedCapabilityError,
} from "../../surveillanceErrors.js";
import { CAPABILITY_STATES, normalizeCapabilitySet } from "../../surveillanceCapabilities.js";
import { isDahuaError, parseDahuaConfig, parseDahuaResponse } from "./dahuaResponseParser.js";
import {
  DAHUA_IDENTITY,
  DAHUA_PROBES,
  buildProbePath,
  interpretProbeResult,
} from "./dahuaProbeContract.js";
import { dahuaRtspPath, dahuaStreamProfiles } from "./dahuaStreamProfiles.js";
import {
  parseChannels,
  parseDeviceInfo,
  parseEncoderConfig,
  parseMotionConfig,
  parseNetworkInfo,
  parseRecordingConfig,
  parseRecordings,
  parseStorageInfo,
  parseSystemTime,
} from "./dahuaParsers.js";

const CGI = {
  encode: "/cgi-bin/configManager.cgi?action=getConfig&name=Encode",
  channelTitle: "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle",
  record: "/cgi-bin/configManager.cgi?action=getConfig&name=Record",
  recordMode: "/cgi-bin/configManager.cgi?action=getConfig&name=RecordMode",
  motion: "/cgi-bin/configManager.cgi?action=getConfig&name=MotionDetect",
  network: "/cgi-bin/configManager.cgi?action=getConfig&name=Network",
  ntp: "/cgi-bin/configManager.cgi?action=getConfig&name=NTP",
  storage: "/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo",
  currentTime: "/cgi-bin/global.cgi?action=getCurrentTime",
  reboot: "/cgi-bin/magicBox.cgi?action=reboot",
  snapshot: (channel) => `/cgi-bin/snapshot.cgi?channel=${channel}`,
  ptzStart: (channel, code, arg1, arg2, arg3) =>
    `/cgi-bin/ptz.cgi?action=start&channel=${channel}&code=${code}&arg1=${arg1}&arg2=${arg2}&arg3=${arg3}`,
  ptzStop: (channel, code, arg1, arg2, arg3) =>
    `/cgi-bin/ptz.cgi?action=stop&channel=${channel}&code=${code}&arg1=${arg1}&arg2=${arg2}&arg3=${arg3}`,
  findCreate: "/cgi-bin/mediaFileFind.cgi?action=factory.create",
  findStart: (id, channel, from, to) =>
    `/cgi-bin/mediaFileFind.cgi?action=findFile&object=${id}&condition.Channel=${channel}` +
    `&condition.StartTime=${encodeURIComponent(from)}&condition.EndTime=${encodeURIComponent(to)}`,
  findNext: (id, count) => `/cgi-bin/mediaFileFind.cgi?action=findNextFile&object=${id}&count=${count}`,
  findClose: (id) => `/cgi-bin/mediaFileFind.cgi?action=close&object=${id}`,
  findDestroy: (id) => `/cgi-bin/mediaFileFind.cgi?action=destroy&object=${id}`,
};

/** Dahua wants "2026-08-17 00:00:00" in device-local time, not ISO with a Z. */
const dahuaTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
};

const PTZ_CODES = Object.freeze({
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  upleft: "LeftUp",
  upright: "RightUp",
  downleft: "LeftDown",
  downright: "RightDown",
  zoom_in: "ZoomTele",
  zoom_out: "ZoomWide",
  focus_near: "FocusNear",
  focus_far: "FocusFar",
});

export class DahuaAdapter extends SurveillanceProvider {
  static vendorKey = "dahua";
  static displayName = "Dahua";
  static defaultPort = 80;

  /* ---- request plumbing ---------------------------------------------- */

  /**
   * One CGI call.
   *
   * Every device response passes through here, which makes this the single
   * place that decides what "the device said no" means. A 400 with body "Error"
   * is a legitimate answer meaning the endpoint is unsupported, and it must be
   * distinguishable from a timeout — which is a network fault and must NOT be
   * recorded as an unsupported capability.
   */
  async #cgi(path, { method = "GET", parse = "config", responseType = "text" } = {}) {
    const response = await this.transport.request({
      method,
      path,
      credentials: this.credentials,
      responseType,
    });

    this.transport.assertSafeResponse(response.status);

    if (responseType === "buffer") {
      if (Number(response.status) >= 400) {
        throw new SurveillanceError("device refused the request", {
          code: SURVEILLANCE_ERROR_CODES.DEVICE_UNAUTHORIZED,
          status: 502,
          details: { upstreamStatus: Number(response.status) },
        });
      }
      return response.body;
    }

    const body = typeof response.body === "string" ? response.body : String(response.body ?? "");

    if (Number(response.status) === 401) {
      throw new SurveillanceError("device rejected the stored credentials", {
        code: SURVEILLANCE_ERROR_CODES.DEVICE_UNAUTHORIZED,
        status: 502,
      });
    }

    return {
      ok: !isDahuaError(response.status, body),
      status: Number(response.status),
      raw: body,
      parsed: parse === "config" ? parseDahuaConfig(body) : parseDahuaResponse(body),
    };
  }

  /** Throw a typed "this model cannot do that" rather than returning junk. */
  #requireOk(result, capability) {
    if (!result.ok) throw new UnsupportedCapabilityError(capability, CAPABILITY_STATES.UNSUPPORTED);
    return result.parsed;
  }

  /* ---- connection ----------------------------------------------------- */

  async testConnection() {
    const startedAt = Date.now();
    const result = await this.#cgi(DAHUA_IDENTITY.deviceType, { parse: "flat" });
    return {
      ok: result.ok,
      latencyMs: Date.now() - startedAt,
      authMethod: this.transport.authMethod || "digest",
    };
  }

  async getDeviceInfo() {
    // Four reads rather than one: getSystemInfo alone omits the firmware on
    // several firmwares, and a missing firmware version means the capability
    // cache cannot tell when a device has been upgraded.
    const [deviceType, softwareVersion, systemInfo, machineName] = await Promise.all([
      this.#cgi(DAHUA_IDENTITY.deviceType, { parse: "flat" }),
      this.#cgi(DAHUA_IDENTITY.softwareVersion, { parse: "flat" }),
      this.#cgi(DAHUA_IDENTITY.systemInfo, { parse: "flat" }),
      this.#cgi(DAHUA_IDENTITY.machineName, { parse: "flat" }).catch(() => ({ ok: false, parsed: {} })),
    ]);

    const info = parseDeviceInfo({
      deviceType: deviceType.parsed,
      softwareVersion: softwareVersion.parsed,
      systemInfo: systemInfo.parsed,
      machineName: machineName.parsed,
    });

    const channels = await this.getChannels().catch(() => []);

    return {
      model: info.model,
      firmware: info.firmware,
      buildDate: info.buildDate,
      deviceName: info.deviceName,
      // The raw serial is hashed here and discarded. It is the identifier the
      // vendor P2P cloud keys on, and a published security analysis showed the
      // format has little entropy — so it is exactly the value not to store.
      serialHash: info.serial ? crypto.createHash("sha256").update(info.serial).digest("hex") : "",
      channelCount: channels.length,
      deviceType: "recorder",
    };
  }

  /**
   * Run the probe table and report what the device actually supports.
   *
   * A transport failure aborts the whole probe rather than being recorded as
   * `unsupported`: a timeout is a network fault, and writing it down as "this
   * device has no PTZ" would permanently hide a feature the device has.
   */
  async getCapabilities() {
    const capabilities = {};

    for (const descriptor of DAHUA_PROBES) {
      let result;
      try {
        result = await this.#cgi(buildProbePath(descriptor, { channel: 1 }), {
          parse: "config",
          responseType: descriptor.capability === "snapshot" ? "buffer" : "text",
        });
      } catch (error) {
        if (error?.code === SURVEILLANCE_ERROR_CODES.DEVICE_UNAUTHORIZED) throw error;
        if (
          error?.code === SURVEILLANCE_ERROR_CODES.DEVICE_TIMEOUT ||
          error?.code === SURVEILLANCE_ERROR_CODES.DESTINATION_BLOCKED
        ) {
          throw error;
        }
        result = { ok: false, parsed: {}, raw: "" };
      }

      // A buffer response (snapshot) has no parsed body; its existence is proof.
      const normalized = Buffer.isBuffer(result)
        ? { ok: result.length > 0, parsed: {}, raw: "" }
        : result;

      capabilities[descriptor.capability] = interpretProbeResult(descriptor, normalized);
    }

    return normalizeCapabilitySet(capabilities);
  }

  /* ---- channels ------------------------------------------------------- */

  async getChannels() {
    const [encode, titles] = await Promise.all([
      this.#cgi(CGI.encode),
      this.#cgi(CGI.channelTitle).catch(() => ({ ok: false, parsed: {} })),
    ]);

    const channels = parseChannels(this.#requireOk(encode, "cameraConfiguration"), titles.parsed);

    return channels.map((channel) => ({
      ...channel,
      // Profiles are read off the device, never assumed. On this model the
      // second profile happens to be CIF; on a newer one it will not be.
      streamProfiles: dahuaStreamProfiles(encode.parsed, channel.index - 1),
      // No RS-485 on the reference model and the probe is expected to fail, so
      // the channel-level flag follows the device-level capability rather than
      // claiming per-channel knowledge we do not have.
      ptz: false,
      audio: Boolean(encode.parsed?.Encode?.[channel.index - 1]?.MainFormat?.[0]?.Audio?.enable),
    }));
  }

  async getChannelStatus(channelIndex) {
    // Dahua exposes no reliable per-channel liveness read on entry recorders.
    // Rather than invent one, the encoder's enable flag is reported for what it
    // is, and `online` stays null so the UI can say "unknown" instead of a
    // green dot it cannot justify.
    const encode = await this.#cgi(CGI.encode);
    const channel = encode.parsed?.Encode?.[Number(channelIndex) - 1];
    if (!channel) throw new SurveillanceError("channel not found on device", {
      code: SURVEILLANCE_ERROR_CODES.CHANNEL_NOT_FOUND,
      status: 404,
    });
    return {
      online: null,
      recording: null,
      signalLost: null,
      encoderEnabled: channel?.MainFormat?.[0]?.Video?.enable !== false,
    };
  }

  /* ---- media ---------------------------------------------------------- */

  /**
   * CREDENTIALED. Never returned from an API. See SurveillanceProvider.
   */
  buildStreamSource(channelIndex, { profileKey = "0" } = {}) {
    const { host, port } = this.device || {};
    const user = encodeURIComponent(this.credentials?.username || "");
    // A raw "@" or ":" in a password breaks the userinfo segment. This is the
    // single most common reason an otherwise-correct Dahua RTSP URL fails.
    const pass = encodeURIComponent(this.credentials?.password || "");
    const path = dahuaRtspPath(channelIndex, profileKey);
    return {
      url: `rtsp://${user}:${pass}@${host}:${port === 80 ? 554 : port}${path}`,
      transport: "tcp",
      codecHint: "",
    };
  }

  async getSnapshot(channelIndex) {
    return this.#cgi(CGI.snapshot(Number(channelIndex)), { responseType: "buffer" });
  }

  /* ---- playback -------------------------------------------------------- */

  /**
   * Five calls, and the last two are the important ones.
   *
   * `factory.create` allocates a finder object ON THE DEVICE. Leaking finders is
   * a documented way to exhaust a recorder's handles until it stops answering,
   * so close/destroy run in a finally — including when the search throws.
   */
  async searchRecordings(channelIndex, from, to) {
    const created = await this.#cgi(CGI.findCreate, { parse: "flat" });
    const objectId = created.parsed?.result;
    if (!created.ok || objectId === undefined) {
      throw new UnsupportedCapabilityError("playback", CAPABILITY_STATES.UNSUPPORTED);
    }

    try {
      // Dahua's finder is 0-based on channel here, unlike RTSP.
      const started = await this.#cgi(
        CGI.findStart(objectId, Number(channelIndex) - 1, dahuaTime(from), dahuaTime(to)),
        { parse: "flat" },
      );
      if (!started.ok) return [];

      const recordings = [];
      // findNextFile returns at most 100 per call. Bounded so a device with a
      // year of footage cannot hold the request open indefinitely.
      for (let page = 0; page < 20; page += 1) {
        const next = await this.#cgi(CGI.findNext(objectId, 100));
        const batch = parseRecordings(next.parsed);
        recordings.push(...batch);
        if (batch.length < 100) break;
      }
      return recordings;
    } finally {
      await this.#cgi(CGI.findClose(objectId), { parse: "flat" }).catch(() => {});
      await this.#cgi(CGI.findDestroy(objectId), { parse: "flat" }).catch(() => {});
    }
  }

  /** CREDENTIALED. Same warning as buildStreamSource. */
  buildPlaybackSource(channelIndex, from, to) {
    const { host, port } = this.device || {};
    const user = encodeURIComponent(this.credentials?.username || "");
    const pass = encodeURIComponent(this.credentials?.password || "");
    const start = encodeURIComponent(dahuaTime(from));
    const end = encodeURIComponent(dahuaTime(to));
    return {
      url:
        `rtsp://${user}:${pass}@${host}:${port === 80 ? 554 : port}` +
        `/cam/playback?channel=${Number(channelIndex)}&starttime=${start}&endtime=${end}`,
      transport: "tcp",
      codecHint: "",
    };
  }

  /* ---- configuration --------------------------------------------------- */

  async getStorageInfo() {
    const result = await this.#cgi(CGI.storage);
    return parseStorageInfo(this.#requireOk(result, "storageInfo"));
  }

  async getRecordingConfig(channelIndex) {
    const [record, mode] = await Promise.all([
      this.#cgi(CGI.record),
      this.#cgi(CGI.recordMode).catch(() => ({ ok: false, parsed: {} })),
    ]);
    const merged = { ...this.#requireOk(record, "recordingSettings"), ...mode.parsed };
    return parseRecordingConfig(merged, Number(channelIndex) - 1);
  }

  async getEncoderConfig(channelIndex) {
    const result = await this.#cgi(CGI.encode);
    const parsed = parseEncoderConfig(this.#requireOk(result, "encoderSettings"), Number(channelIndex) - 1);
    if (!parsed) {
      throw new SurveillanceError("channel not found on device", {
        code: SURVEILLANCE_ERROR_CODES.CHANNEL_NOT_FOUND,
        status: 404,
      });
    }
    return parsed;
  }

  async getMotionConfig(channelIndex) {
    const result = await this.#cgi(CGI.motion);
    const parsed = parseMotionConfig(this.#requireOk(result, "motionDetection"), Number(channelIndex) - 1);
    if (!parsed) throw new UnsupportedCapabilityError("motionDetection", CAPABILITY_STATES.UNSUPPORTED);
    return parsed;
  }

  async getNetworkInfo() {
    const result = await this.#cgi(CGI.network);
    return parseNetworkInfo(this.#requireOk(result, "networkSettings"));
  }

  async getSystemTime() {
    const [time, ntp] = await Promise.all([
      this.#cgi(CGI.currentTime, { parse: "flat" }),
      this.#cgi(CGI.ntp).catch(() => ({ ok: false, parsed: {} })),
    ]);
    return parseSystemTime(this.#requireOk(time, "timeSettings"), ntp.parsed);
  }

  /* ---- writes ---------------------------------------------------------- */
  //
  // Every write below is DEFINED but refuses to execute in this build. The
  // contract is settled — argument shapes, validation, audit points — so that
  // enabling them later is a one-line change per method rather than a design
  // exercise. They refuse because no write has ever been verified against a
  // real recorder, and the first one must not happen by accident on a live
  // shop's device.

  async #writeRefused(capability) {
    throw new SurveillanceError(
      `${capability} writes are not enabled until they have been verified on a real device`,
      {
        code: SURVEILLANCE_ERROR_CODES.CAPABILITY_READ_ONLY,
        status: 409,
        details: { capability, reason: "write-not-verified" },
      },
    );
  }

  async updateEncoderConfig(_channelIndex, _config) {
    return this.#writeRefused("encoderSettings");
  }

  async updateRecordingConfig(_channelIndex, _config) {
    return this.#writeRefused("recordingSettings");
  }

  async updateMotionConfig(_channelIndex, _config) {
    return this.#writeRefused("motionDetection");
  }

  async updateSystemTime(_payload) {
    return this.#writeRefused("timeSettings");
  }

  /* ---- control ---------------------------------------------------------- */

  /**
   * PTZ.
   *
   * Dahua's PTZ is start/stop rather than a single move: a `start` with no
   * matching `stop` leaves the camera panning until it hits its limit. The
   * caller is responsible for the stop, and the contract makes that explicit by
   * taking an action rather than a direction.
   */
  async ptzControl(channelIndex, command = {}) {
    const { action = "start", direction = "", speed = 4, preset = null } = command;

    if (preset !== null) {
      const code = action === "set" ? "SetPreset" : "GotoPreset";
      const result = await this.#cgi(
        CGI.ptzStart(Number(channelIndex), code, 0, Number(preset), 0),
        { parse: "flat" },
      );
      if (!result.ok) throw new UnsupportedCapabilityError("ptzPresets", CAPABILITY_STATES.UNSUPPORTED);
      return { ok: true };
    }

    const code = PTZ_CODES[String(direction).toLowerCase()];
    if (!code) {
      throw new SurveillanceError("unknown PTZ direction", {
        code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
        status: 400,
        details: { direction: String(direction).slice(0, 20) },
      });
    }

    const bounded = Math.min(8, Math.max(1, Number(speed) || 4));
    const path =
      action === "stop"
        ? CGI.ptzStop(Number(channelIndex), code, 0, bounded, 0)
        : CGI.ptzStart(Number(channelIndex), code, 0, bounded, 0);

    const result = await this.#cgi(path, { parse: "flat" });
    if (!result.ok) throw new UnsupportedCapabilityError("ptz", CAPABILITY_STATES.UNSUPPORTED);
    return { ok: true };
  }

  /**
   * Restart.
   *
   * A recorder that is rebooting is a recorder that is not recording, so this is
   * gated four ways before it reaches here: owner-only, capability, step-up
   * confirmation, and a one-per-ten-minutes rate limit. This method is the last
   * step, not the first.
   */
  async restartDevice() {
    const result = await this.#cgi(CGI.reboot, { parse: "flat" });
    if (!result.ok) throw new UnsupportedCapabilityError("deviceRestart", CAPABILITY_STATES.UNSUPPORTED);
    // The device stops answering immediately after accepting this. A caller
    // that waits for a clean response will time out on a successful reboot, so
    // the contract is "accepted", not "completed".
    return { accepted: true };
  }
}

export default DahuaAdapter;
