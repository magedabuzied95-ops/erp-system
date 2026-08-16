// Dahua capability probe — the contract, not the connection.
//
// WHAT THIS IS
// ------------
// A declarative table saying, for each capability: which request would prove it,
// and how to read the answer. It performs no I/O. Phase 2B-1 supplies a
// transport that executes these descriptors; until a network path exists, the
// table plus the fixtures is the whole of what can be built honestly.
//
// WHY DECLARATIVE
// ---------------
// The probe is the one piece of vendor code whose correctness cannot be checked
// by reading it — it is right only if it matches a device. Keeping it as data
// means the executor is written and tested once, and correcting a wrong guess
// after the first real connection is a data edit rather than a code change.
//
// It also makes the honest thing easy: `expect` distinguishes "the device
// answered and the answer proves the feature" from "the device answered". A
// probe that treats HTTP 200 as proof reports `supported` for an endpoint that
// replied "Error", which is how fake controls get shipped.
//
// EVERY ENTRY IS A HYPOTHESIS
// --------------------------
// Nothing here is confirmed against DH-XVR1B16-I. Public Dahua HTTP API
// documentation is written for IP cameras; an entry-level XVR shares most of it
// and not all. The `confidence` field records that, and the first real probe
// replaces every hypothesis with an observation.

import { CAPABILITY_STATES } from "../../surveillanceCapabilities.js";

/** How much the datasheet and public documentation actually support an entry. */
export const CONFIDENCE = Object.freeze({
  /** Named in the official datasheet for this model. */
  DATASHEET: "datasheet",
  /** Documented for Dahua devices generally, and used by working clients. */
  DOCUMENTED: "documented",
  /** Plausible by analogy with other Dahua models. Weakest. */
  INFERRED: "inferred",
});

const GET = "GET";

/**
 * @typedef {object} ProbeDescriptor
 * @property {string}   capability   key in CAPABILITIES
 * @property {string}   method
 * @property {string}   path         CGI path, `{channel}` substituted by the executor
 * @property {string}   confidence
 * @property {string}   note         why this proves the capability
 * @property {(parsed: object, raw: string) => boolean} [expect]
 *           Given the parsed body, does it PROVE the capability? Absent means a
 *           non-error response is proof enough (only used where the endpoint
 *           exists solely to serve that capability).
 * @property {boolean}  [writeProbe] true when a successful read still does not
 *           prove the device accepts writes — the result is `read-only`, not
 *           `supported`, until a write is verified separately.
 */

/** @type {ProbeDescriptor[]} */
export const DAHUA_PROBES = Object.freeze([
  {
    capability: "liveView",
    method: GET,
    path: "/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxExtraStream",
    confidence: CONFIDENCE.DATASHEET,
    note:
      "RTSP is named in the datasheet, but RTSP itself cannot be probed over HTTP. " +
      "MaxExtraStream proves the device reports a stream topology at all; the real " +
      "proof is the first successful RTSP DESCRIBE, which the media phase performs.",
    expect: (parsed) => parsed?.MaxExtraStream !== undefined || parsed?.table?.MaxExtraStream !== undefined,
  },
  {
    capability: "snapshot",
    method: GET,
    path: "/cgi-bin/snapshot.cgi?channel={channel}",
    confidence: CONFIDENCE.DOCUMENTED,
    note:
      "Documented for IP cameras. On an XVR the analogue channels may or may not " +
      "serve it, which is precisely why it is probed per device rather than assumed.",
  },
  {
    capability: "encoderSettings",
    method: GET,
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=Encode",
    confidence: CONFIDENCE.DOCUMENTED,
    note:
      "Also the source of the per-channel stream profiles: MainFormat and " +
      "ExtraFormat entries carry compression, resolution, fps and bitrate.",
    expect: (parsed) => Array.isArray(parsed?.Encode) && parsed.Encode.length > 0,
    writeProbe: true,
  },
  {
    capability: "recordingSettings",
    method: GET,
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=Record",
    confidence: CONFIDENCE.DOCUMENTED,
    note: "Recording mode and schedule.",
    expect: (parsed) => parsed?.Record !== undefined,
    writeProbe: true,
  },
  {
    capability: "motionDetection",
    method: GET,
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=MotionDetect",
    confidence: CONFIDENCE.DOCUMENTED,
    note: "Per-channel enable, sensitivity and schedule.",
    expect: (parsed) => parsed?.MotionDetect !== undefined,
    writeProbe: true,
  },
  {
    capability: "storageInfo",
    method: GET,
    path: "/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo",
    confidence: CONFIDENCE.DOCUMENTED,
    note:
      "Known to answer 400 on devices with no storage attached, which is a true " +
      "`unsupported` for that unit rather than a probe failure.",
    expect: (parsed) => Array.isArray(parsed?.info) && parsed.info.length > 0,
  },
  {
    capability: "timeSettings",
    method: GET,
    path: "/cgi-bin/global.cgi?action=getCurrentTime",
    confidence: CONFIDENCE.DOCUMENTED,
    note: "Reading the clock. NTP configuration is a separate config read.",
    expect: (parsed) => typeof parsed?.result === "string" || typeof parsed?.time === "string",
    writeProbe: true,
  },
  {
    capability: "networkSettings",
    method: GET,
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=Network",
    confidence: CONFIDENCE.DOCUMENTED,
    note:
      "READ ONLY by policy regardless of what this returns. Writing network " +
      "configuration disconnects the device, and the safe workflow for it is not " +
      "implemented. A successful read yields `read-only`, never `supported`.",
    expect: (parsed) => parsed?.Network !== undefined,
    writeProbe: true,
    // Even a proven write capability stays read-only until the disconnect
    // workflow exists. This flag is what enforces that, rather than a comment.
    forceState: CAPABILITY_STATES.READ_ONLY,
  },
  {
    capability: "deviceRestart",
    method: GET,
    // NOTE: the probe does NOT call action=reboot. Probing a restart by
    // restarting is not a probe. Presence of the magicBox surface plus a
    // documented reboot action is as far as a non-destructive probe can go, and
    // the capability is reported `unknown` rather than `supported` because of it.
    path: "/cgi-bin/magicBox.cgi?action=getDeviceType",
    confidence: CONFIDENCE.INFERRED,
    note:
      "Cannot be proven without performing it. Reported `unknown` on a successful " +
      "read: the UI hides the control, which is the correct outcome for something " +
      "we have not verified and must not test speculatively on a live recorder.",
    expect: () => false,
  },
  {
    capability: "ptz",
    method: GET,
    path: "/cgi-bin/ptz.cgi?action=getStatus&channel={channel}",
    confidence: CONFIDENCE.DOCUMENTED,
    note:
      "Expected to fail on DH-XVR1B16-I: no RS-485 port is listed and the attached " +
      "cameras are most likely fixed. A failure here is a correct `unsupported`, " +
      "not a defect — and a different vendor or a PTZ-capable channel will pass it.",
    expect: (parsed) => parsed?.status !== undefined || parsed?.Status !== undefined,
  },
  {
    capability: "playback",
    method: GET,
    path: "/cgi-bin/mediaFileFind.cgi?action=factory.create",
    confidence: CONFIDENCE.DOCUMENTED,
    note:
      "factory.create returns an object id and allocates a finder on the device. " +
      "The executor MUST call action=destroy afterwards; leaking finders is a " +
      "documented way to exhaust a recorder's handles.",
    expect: (parsed) => parsed?.result !== undefined,
  },
  {
    capability: "cameraConfiguration",
    method: GET,
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle",
    confidence: CONFIDENCE.DOCUMENTED,
    note: "Channel titles as configured on the device. The ERP name is separate.",
    expect: (parsed) => parsed?.ChannelTitle !== undefined,
    writeProbe: true,
  },
]);

/** Device identity reads. Not capabilities — these run before the probe table. */
export const DAHUA_IDENTITY = Object.freeze({
  deviceType: "/cgi-bin/magicBox.cgi?action=getDeviceType",
  serialNumber: "/cgi-bin/magicBox.cgi?action=getSerialNo",
  softwareVersion: "/cgi-bin/magicBox.cgi?action=getSoftwareVersion",
  systemInfo: "/cgi-bin/magicBox.cgi?action=getSystemInfo",
  machineName: "/cgi-bin/magicBox.cgi?action=getMachineName",
  vendor: "/cgi-bin/magicBox.cgi?action=getVendor",
});

/**
 * Turn one probe result into a capability state.
 *
 * The three outcomes map deliberately:
 *   device said no / errored        -> unsupported  (it answered, and the answer was no)
 *   device answered but no proof    -> unknown      (we did not establish it)
 *   device answered and proved it   -> supported, or read-only when writes are unproven
 *
 * A transport failure — timeout, refused connection — must NOT reach here as
 * `unsupported`. That is a network fault, not a device answer, and recording it
 * as unsupported would permanently hide a feature the device has. The executor
 * is responsible for aborting the whole probe in that case.
 */
export const interpretProbeResult = (descriptor, { ok, parsed = {}, raw = "" } = {}) => {
  if (!ok) return CAPABILITY_STATES.UNSUPPORTED;

  const proved = typeof descriptor.expect === "function" ? Boolean(descriptor.expect(parsed, raw)) : true;
  if (!proved) return CAPABILITY_STATES.UNKNOWN;

  if (descriptor.forceState) return descriptor.forceState;
  // A read proves reading. It does not prove the device will accept a write, and
  // several Dahua config surfaces are readable by accounts that cannot write
  // them — which is exactly the account separation we intend to use.
  if (descriptor.writeProbe) return CAPABILITY_STATES.READ_ONLY;

  return CAPABILITY_STATES.SUPPORTED;
};

/** Substitute the runtime values a descriptor path needs. */
export const buildProbePath = (descriptor, { channel = 1 } = {}) =>
  String(descriptor.path).replace("{channel}", String(Number(channel) || 1));
