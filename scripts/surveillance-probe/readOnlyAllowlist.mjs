// Stage Zero — the only operations the real-device probe may perform.
//
// WHY AN ALLOWLIST AND NOT A DENYLIST
// -----------------------------------
// A denylist of dangerous actions is a list of the mutations somebody thought
// of. This is a working recorder in a working shop; the cost of one missed entry
// is a reboot during business hours, or a wiped recording schedule. So the probe
// may perform exactly the operations enumerated here and nothing else.
//
// THE SAFETY IS NOT THE NAME
// --------------------------
// assertReadOnly() below ignores each entry's `id` entirely and inspects the
// actual vendor operation: the HTTP method, and the `action=` parameter that
// Dahua's CGI uses to select behaviour. `getSystemInfo` is read-only because its
// action begins with `get`, not because it is called "systemInfo". An entry
// whose id says "read" but whose action says `setConfig` is rejected.
//
// WHAT IS DELIBERATELY ABSENT
// ---------------------------
//   * mediaFileFind (playback search). `action=factory.create` ALLOCATES a
//     finder handle on the recorder. It changes no configuration and no
//     recording, but it is device state, and a leaked handle contributes to
//     exhausting the device's supply. Playback therefore stays UNPROVEN in this
//     pass rather than being proven by allocating something. It is the one read
//     refused on principle, and it is listed as a follow-up.
//   * every setConfig, reboot, format, PTZ movement and user operation. Not
//     because they are hard, but because this pass is for learning, not touching.

/** Vendor operations that are reads, expressed as the device sees them. */
const READ_ACTION = /^get[A-Za-z0-9]*$/;

/**
 * Paths with no `action=` parameter, each needing its own justification.
 * Kept minimal: every addition here bypasses the action-name rule.
 */
const ACTIONLESS_READS = new Map([
  [
    "/cgi-bin/snapshot.cgi",
    // Returns the current frame to the caller. It stores nothing and changes no
    // configuration. The device does encode one frame on request, which is work
    // but not a state change.
    "returns a JPEG of the current frame to the caller; stores nothing",
  ],
]);

/** RTSP verbs that only ask questions. PLAY, RECORD, SET_PARAMETER are absent. */
const RTSP_READ_METHODS = new Set(["OPTIONS", "DESCRIBE"]);

/** ONVIF is SOAP; every read operation in the spec is named Get*. */
const ONVIF_READ_OPERATION = /^Get[A-Za-z0-9]+$/;

/**
 * Reject anything not provably a read.
 *
 * Throws rather than returning false. A probe that can continue past a failed
 * safety check has an advisory safety check.
 */
export const assertReadOnly = (entry) => {
  const where = `${entry.protocol}:${entry.id}`;

  if (entry.protocol === "http") {
    if (entry.method !== "GET") {
      throw new Error(`${where}: only GET is permitted, got ${entry.method}`);
    }
    const query = entry.path.includes("?") ? entry.path.slice(entry.path.indexOf("?") + 1) : "";
    const action = new URLSearchParams(query).get("action");

    if (action === null) {
      const basePath = entry.path.split("?")[0];
      if (!ACTIONLESS_READS.has(basePath)) {
        throw new Error(`${where}: no action= parameter and not an approved actionless read`);
      }
      return true;
    }
    if (!READ_ACTION.test(action)) {
      throw new Error(`${where}: action "${action}" is not a read operation`);
    }
    return true;
  }

  if (entry.protocol === "rtsp") {
    if (!RTSP_READ_METHODS.has(entry.method)) {
      throw new Error(`${where}: RTSP method ${entry.method} is not read-only`);
    }
    return true;
  }

  if (entry.protocol === "onvif") {
    if (!ONVIF_READ_OPERATION.test(entry.operation)) {
      throw new Error(`${where}: ONVIF operation ${entry.operation} is not a Get*`);
    }
    return true;
  }

  throw new Error(`${where}: unknown protocol`);
};

/** @type {ReadonlyArray<object>} */
export const PROBE_OPERATIONS = Object.freeze([
  // ---- identity -------------------------------------------------------
  { id: "deviceType", protocol: "http", method: "GET", capability: "deviceInfo",
    path: "/cgi-bin/magicBox.cgi?action=getDeviceType", note: "model string" },
  { id: "softwareVersion", protocol: "http", method: "GET", capability: "deviceInfo",
    path: "/cgi-bin/magicBox.cgi?action=getSoftwareVersion", note: "firmware and build date" },
  { id: "systemInfo", protocol: "http", method: "GET", capability: "deviceInfo",
    path: "/cgi-bin/magicBox.cgi?action=getSystemInfo", note: "processor and hw revision; serial hashed then dropped" },
  { id: "machineName", protocol: "http", method: "GET", capability: "deviceInfo",
    path: "/cgi-bin/magicBox.cgi?action=getMachineName", note: "operator-assigned device name" },
  { id: "vendor", protocol: "http", method: "GET", capability: "deviceInfo",
    path: "/cgi-bin/magicBox.cgi?action=getVendor", note: "confirms a Dahua-family unit" },
  { id: "maxExtraStream", protocol: "http", method: "GET", capability: "streamProfiles",
    path: "/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxExtraStream", note: "how many sub streams exist" },

  // ---- channels and encoding -----------------------------------------
  { id: "encodeConfig", protocol: "http", method: "GET", capability: "encoderSettings.read",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=Encode", note: "REAL codecs, resolutions, fps, bitrates per profile" },
  { id: "channelTitle", protocol: "http", method: "GET", capability: "channels",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle", note: "channel names as configured on the device" },
  { id: "encodeCaps", protocol: "http", method: "GET", capability: "streamProfiles",
    path: "/cgi-bin/encode.cgi?action=getCaps", note: "encoder ranges the device will accept" },
  { id: "videoInCollect", protocol: "http", method: "GET", capability: "channels",
    path: "/cgi-bin/devVideoInput.cgi?action=getCollect", note: "per-channel video input state, if served" },

  // ---- storage --------------------------------------------------------
  { id: "storageInfo", protocol: "http", method: "GET", capability: "storageInfo",
    path: "/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo", note: "disk count, capacity, used, state" },

  // ---- recording ------------------------------------------------------
  { id: "recordConfig", protocol: "http", method: "GET", capability: "recordingSettings.read",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=Record", note: "schedule matrix" },
  { id: "recordMode", protocol: "http", method: "GET", capability: "recordingSettings.read",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=RecordMode", note: "per-channel auto, manual or off" },

  // ---- motion ---------------------------------------------------------
  { id: "motionConfig", protocol: "http", method: "GET", capability: "motionDetection.read",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=MotionDetect", note: "enable, sensitivity, regions" },

  // ---- network (read only by this probe AND by product policy) --------
  { id: "networkConfig", protocol: "http", method: "GET", capability: "networkSettings.read",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=Network", note: "IP, mask, gateway, DHCP, DNS" },
  { id: "networkInterfaces", protocol: "http", method: "GET", capability: "networkSettings.read",
    path: "/cgi-bin/netApp.cgi?action=getInterfaces", note: "live interface state" },
  { id: "rtspPortConfig", protocol: "http", method: "GET", capability: "networkSettings.read",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=RTSP", note: "the RTSP port the device actually listens on" },

  // ---- time -----------------------------------------------------------
  { id: "currentTime", protocol: "http", method: "GET", capability: "timeSettings.read",
    path: "/cgi-bin/global.cgi?action=getCurrentTime", note: "device clock, for playback window alignment" },
  { id: "ntpConfig", protocol: "http", method: "GET", capability: "timeSettings.read",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=NTP", note: "NTP server and timezone offset" },

  // ---- P2P ------------------------------------------------------------
  // Only the enable flag and online state are lifted. Serial, verification code
  // and QR payload are dropped before anything is written or printed.
  { id: "p2pConfig", protocol: "http", method: "GET", capability: "p2p.read",
    path: "/cgi-bin/configManager.cgi?action=getConfig&name=T2UServer", note: "P2P enable flag only" },

  // ---- PTZ: a position query, never a movement ------------------------
  // getStatus asks where the head is. It does not move it. A device with no PTZ
  // answers with an error, and that error is the evidence we want.
  { id: "ptzStatus", protocol: "http", method: "GET", capability: "ptz",
    path: "/cgi-bin/ptz.cgi?action=getStatus&channel=1", note: "position query; no movement command is ever sent" },

  // ---- snapshot -------------------------------------------------------
  { id: "snapshotCh1", protocol: "http", method: "GET", capability: "snapshot",
    path: "/cgi-bin/snapshot.cgi?channel=1", note: "one frame, channel 1 only" },

  // ---- accounts: count only, to plan erp_surveillance later ------------
  { id: "userList", protocol: "http", method: "GET", capability: "accounts.read",
    path: "/cgi-bin/userManager.cgi?action=getUserInfoAll", note: "account count only; no names or hashes recorded" },

  // ---- RTSP: does the stream exist ------------------------------------
  // DESCRIBE returns SDP without starting a stream. One channel, sub stream, to
  // keep load off a live recorder.
  { id: "rtspOptions", protocol: "rtsp", method: "OPTIONS", capability: "rtsp",
    path: "/", note: "which RTSP methods the device advertises" },
  { id: "rtspDescribeCh1Sub", protocol: "rtsp", method: "DESCRIBE", capability: "rtsp",
    path: "/cam/realmonitor?channel=1&subtype=1", note: "SDP for channel 1 sub stream; no PLAY is sent" },

  // ---- ONVIF ----------------------------------------------------------
  { id: "onvifDateTime", protocol: "onvif", operation: "GetSystemDateAndTime", capability: "onvif",
    note: "the one ONVIF call the spec requires unauthenticated; proves the endpoint exists" },
  { id: "onvifDeviceInfo", protocol: "onvif", operation: "GetDeviceInformation", capability: "onvif",
    note: "needs credentials; failure here separates no-ONVIF from needs-its-own-account" },
  { id: "onvifCapabilities", protocol: "onvif", operation: "GetCapabilities", capability: "onvif",
    note: "which ONVIF services the device exposes" },
]);

/** Run the gate over the whole table. Called before the first request. */
export const assertAllOperationsReadOnly = () => {
  for (const entry of PROBE_OPERATIONS) assertReadOnly(entry);
  return PROBE_OPERATIONS.length;
};

export const ACTIONLESS_READ_REASONS = ACTIONLESS_READS;
