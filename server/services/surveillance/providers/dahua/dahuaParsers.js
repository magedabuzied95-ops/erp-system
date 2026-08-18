// Dahua config responses -> neutral shapes.
//
// Each function takes an already-parsed config object (see dahuaResponseParser)
// and returns the vendor-neutral shape the rest of the system uses. Nothing here
// does I/O, so every one is testable against a fixture.
//
// THE RULE THEY ALL FOLLOW
// ------------------------
// A field the device did not report comes back as null, never as a plausible
// default. `fps: 0` and `fps: null` look similar and mean opposite things: one
// says the device reports zero, the other says we do not know. A UI showing
// "0 fps" for an unreported value is lying, and an operator acting on it is
// acting on our invention.
//
// EVERY FIX IN THIS FILE CAME FROM A REAL DEVICE
// ----------------------------------------------
// The first version was written against published documentation for Dahua IP
// cameras. A read-only probe of an actual DH-XVR1B16-I found six places where
// the recorder disagrees with that documentation. Each is marked below with what
// the device actually returned, because the next person to doubt one of these
// will be right to, and should be able to see the evidence.

const num = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const bool = (value) => (typeof value === "boolean" ? value : null);

const text = (value) => {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
};

const BYTES_PER_GB = 1024 ** 3;

/* ------------------------------------------------------------------ *
 * Device identity
 * ------------------------------------------------------------------ */

/**
 * @param {object} sources { deviceType, softwareVersion, systemInfo, machineName }
 *        each already parsed
 */
export const parseDeviceInfo = (sources = {}) => {
  const { deviceType = {}, softwareVersion = {}, systemInfo = {}, machineName = {} } = sources;

  // The real device returns a single combined string:
  //   version=4.001.0000000.14,build:2021-03-06 10:32:02
  // rather than the separate `version` and `BuildDate` fields the documentation
  // describes. Both shapes are handled.
  const rawVersion = text(softwareVersion.version) || "";
  const [versionPart, buildPart] = rawVersion.split(/,\s*build:\s*/i);

  return {
    model: text(deviceType.type) || text(systemInfo.deviceType) || null,
    firmware: text(versionPart) || null,
    buildDate: text(buildPart) || text(softwareVersion.BuildDate) || text(softwareVersion.buildDate) || null,
    // The raw serial never leaves this function. The caller hashes it; see
    // surveillanceSchema for why the column is serial_hash.
    serial: text(systemInfo.serialNumber) || null,
    deviceName: text(machineName.name) || text(machineName.MachineName) || null,
    processor: text(systemInfo.processor) || null,
    hardwareVersion: text(systemInfo.hardwareVersion) || null,
  };
};

/* ------------------------------------------------------------------ *
 * Channels
 * ------------------------------------------------------------------ */

/**
 * The physical channel count as the device reports it.
 * `devVideoInput.cgi?action=getCollect` answered `result=16` on the real unit.
 */
export const parsePhysicalChannelCount = (collectResponse = {}) => {
  const value = num(collectResponse?.result);
  return Number.isInteger(value) && value > 0 ? value : null;
};

/**
 * Channel list from the encode config plus the title config.
 *
 * HOW MANY CHANNELS DOES THIS RECORDER HAVE?
 *
 * Not `encoders.length`. The real DH-XVR1B16-I reports FIFTY encode slots for a
 * sixteen-channel recorder: slots 0-15 are the physical channels, 16-48 are
 * null, and slot 49 holds a detached H.264 704x576 template with a MainFormat
 * and nothing else. Reading the array length reported 50 channels. Counting
 * non-null entries reported 17. Both are wrong, and the 17th would have shown
 * in the UI as a phantom camera that never displays a picture.
 *
 * The authority is the device answering directly, via
 * parsePhysicalChannelCount. The contiguous-run fallback exists for firmwares
 * that do not serve it, and yields 16 here while correctly ignoring slot 49 —
 * which a plain non-null count does not.
 */
export const parseChannels = (encodeConfig = {}, titleConfig = {}, options = {}) => {
  const encoders = Array.isArray(encodeConfig?.Encode) ? encodeConfig.Encode : [];
  const titles = Array.isArray(titleConfig?.ChannelTitle) ? titleConfig.ChannelTitle : [];

  const authoritative = Number(options.physicalChannelCount);
  const hasAuthoritative = Number.isInteger(authoritative) && authoritative > 0;

  let contiguous = 0;
  while (contiguous < encoders.length && encoders[contiguous]) contiguous += 1;

  const channelCount = hasAuthoritative
    ? Math.min(authoritative, encoders.length || authoritative)
    : contiguous;

  const channels = [];
  for (let index = 0; index < channelCount; index += 1) {
    const entry = encoders[index];
    const mainFormat = entry?.MainFormat?.[0];
    const main = mainFormat?.Video || {};
    const extra = entry?.ExtraFormat?.[0]?.Video || {};

    channels.push({
      // ERP-facing channel numbers are 1-based, matching RTSP and matching what
      // is printed on the recorder's front panel.
      index: index + 1,
      vendorName: text(titles[index]?.Name) || null,
      // The real firmware carries the flag as `VideoEnable` on the format entry,
      // not as `Video.enable` inside it. Neither key was present inside `Video`
      // on the real device, so treating a missing flag as disabled would have
      // dropped all sixteen channels. Only an explicit false disables.
      enabled: entry ? mainFormat?.VideoEnable !== false && main.enable !== false : false,
      // A gap inside the authoritative range is reported rather than skipped: it
      // means the device claims a channel it did not describe, which is worth
      // seeing rather than silently renumbering everything after it.
      described: Boolean(entry),
      mainCodec: text(main.Compression),
      subCodec: text(extra.Compression),
    });
  }

  return channels;
};

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

/**
 * `storageDevice.cgi?action=getDeviceAllInfo`
 *
 * ONE DISK, FOUR PARTITIONS. The first version read `Detail[0]` and reported a
 * quarter of the real capacity. The reference recorder returns a single disk
 * with four ReadWrite partitions of roughly 500 GB each; the disk's capacity is
 * their sum.
 */
export const parseStorageInfo = (config = {}) => {
  const disks = Array.isArray(config?.info) ? config.info : [];

  const parsed = disks.map((disk) => {
    const details = Array.isArray(disk?.Detail) ? disk.Detail.filter(Boolean) : [];

    const partitions = details.map((detail) => {
      const totalBytes = num(detail.TotalBytes);
      const usedBytes = num(detail.UsedBytes);
      return {
        path: text(detail.Path),
        type: text(detail.Type),
        totalBytes,
        usedBytes,
        freeBytes: totalBytes !== null && usedBytes !== null ? totalBytes - usedBytes : null,
        // A structured error flag the real firmware provides, and a far better
        // health signal than parsing a status string.
        isError: bool(detail.IsError),
      };
    });

    const sized = partitions.filter((partition) => partition.totalBytes !== null);
    const totalBytes = sized.length ? sized.reduce((sum, p) => sum + p.totalBytes, 0) : null;
    const usedBytes = sized.length ? sized.reduce((sum, p) => sum + (p.usedBytes || 0), 0) : null;

    // HEALTH: FLAGS FIRST, STRING LAST.
    //
    // The real firmware reports State "Success", which the original regex
    // (running|ok|normal) scored as UNHEALTHY — a false alarm on a perfectly
    // good disk. IsError and HealthDataFlag are structured and unambiguous, so
    // they decide. The string is consulted only when neither is present.
    const state = text(disk.State);
    const healthFlag = num(disk.HealthDataFlag);
    const anyPartitionError = partitions.some((partition) => partition.isError === true);

    let healthy = null;
    if (anyPartitionError) healthy = false;
    else if (healthFlag !== null) healthy = healthFlag === 0;
    else if (partitions.some((partition) => partition.isError === false)) healthy = true;
    else if (state !== null) healthy = /success|running|ok|normal/i.test(state);

    return {
      name: text(disk.Name),
      state,
      healthDataFlag: healthFlag,
      partitionCount: partitions.length,
      partitions,
      totalBytes,
      usedBytes,
      freeBytes: totalBytes !== null && usedBytes !== null ? totalBytes - usedBytes : null,
      totalGb: totalBytes !== null ? Math.round(totalBytes / BYTES_PER_GB) : null,
      usedGb: usedBytes !== null ? Math.round(usedBytes / BYTES_PER_GB) : null,
      isHealthy: healthy,
    };
  });

  const sized = parsed.filter((disk) => disk.totalBytes !== null);
  const totalBytes = sized.length ? sized.reduce((sum, disk) => sum + disk.totalBytes, 0) : null;
  const usedBytes = sized.length ? sized.reduce((sum, disk) => sum + (disk.usedBytes || 0), 0) : null;
  const usedPercent =
    totalBytes !== null && totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : null;

  return {
    disks: parsed,
    diskCount: parsed.length,
    partitionCount: parsed.reduce((sum, disk) => sum + disk.partitionCount, 0),
    totalBytes,
    usedBytes,
    freeBytes: totalBytes !== null && usedBytes !== null ? totalBytes - usedBytes : null,
    totalGb: totalBytes !== null ? Math.round(totalBytes / BYTES_PER_GB) : null,
    usedGb: usedBytes !== null ? Math.round(usedBytes / BYTES_PER_GB) : null,
    usedPercent,
    // A FULL DVR IS NOT A BROKEN DVR.
    //
    // A recorder in overwrite mode runs at 100% used for its entire service
    // life: it fills the disk once, then recycles the oldest footage. The
    // reference device reports every partition at Total == Used and is working
    // perfectly. Surfacing that as an alert would train the operator to ignore
    // storage warnings, which is worse than showing none. `full` is reported as
    // a fact; `healthy` is the field that decides whether anything is wrong.
    full: usedPercent !== null ? usedPercent >= 99 : null,
    healthy: parsed.length ? parsed.every((disk) => disk.isHealthy === true) : null,
  };
};

/* ------------------------------------------------------------------ *
 * Recording configuration
 * ------------------------------------------------------------------ */

/**
 * Dahua schedules are a per-day list of time periods, per record type.
 *
 * THE EIGHTH DAY. The first version reported `scheduleDays: 8` because the real
 * `TimeSection` array has eight rows: row 0 is the ALL-DAYS template that
 * applies unless a specific day overrides it, and rows 1-7 are Sunday to
 * Saturday. Reporting eight days made the recorder look like it had a schedule
 * nobody could explain.
 */
const ALL_DAYS_ROW = 0;
const WEEK_DAYS = 7;

export const parseRecordingConfig = (config = {}, channelIndex = 0) => {
  const modes = Array.isArray(config?.RecordMode) ? config.RecordMode : [];
  const schedules = Array.isArray(config?.Record) ? config.Record : [];

  const mode = modes[channelIndex] || {};
  const schedule = schedules[channelIndex] || {};

  // 0 = follow schedule, 1 = always record, 2 = never record.
  const modeValue = num(mode.Mode);
  const modeName =
    modeValue === 1 ? "always" : modeValue === 2 ? "off" : modeValue === 0 ? "schedule" : null;

  const rows = Array.isArray(schedule.TimeSection) ? schedule.TimeSection : [];
  const allDays = rows[ALL_DAYS_ROW] ?? null;
  const perDay = rows.slice(1, 1 + WEEK_DAYS);

  return {
    channelIndex: channelIndex + 1,
    mode: modeName,
    modeRaw: modeValue,
    hasSchedule: rows.length > 0,
    // Exactly the seven weekdays the device actually describes.
    scheduleDays: perDay.length || null,
    hasAllDaysTemplate: allDays !== null,
    scheduleRowCount: rows.length || null,
    preRecordSeconds: num(schedule.PreRecord),
    redundant: bool(schedule.Redundant),
  };
};

/* ------------------------------------------------------------------ *
 * Encoder configuration
 * ------------------------------------------------------------------ */

/**
 * Record-trigger slot names.
 *
 * MainFormat[] and ExtraFormat[] are indexed by WHAT TRIGGERED the recording,
 * not by which stream it is. On the real device all three entries were
 * byte-for-byte identical because nobody had configured motion recording to
 * differ from timed recording.
 */
export const RECORD_TRIGGERS = Object.freeze(["general", "motion", "alarm"]);

const parseFormat = (entry = {}) => {
  const video = entry?.Video || {};
  const audio = entry?.Audio || {};
  return {
    codec: text(video.Compression),
    width: num(video.Width),
    height: num(video.Height),
    fps: num(video.FPS),
    bitrateKbps: num(video.BitRate),
    // "CBR" or "VBR". Matters because a VBR stream's reported bitrate is a
    // ceiling rather than a measurement, and the bandwidth budget should treat
    // it as one. The real device is CBR on every channel.
    bitrateControl: text(video.BitRateControl),
    // H.264/H.265 profile, e.g. "High". Affects decoder compatibility.
    profile: text(video.Profile),
    quality: num(video.Quality),
    gop: num(video.GOP),
    // The real firmware puts the flag here, not inside Video.
    enabled: entry?.VideoEnable === false || video.enable === false ? false : true,
    audioEnabled: entry?.AudioEnable === true || audio.enable === true,
    audioCodec: text(audio.Compression),
  };
};

export const parseEncoderConfig = (config = {}, channelIndex = 0) => {
  const channels = Array.isArray(config?.Encode) ? config.Encode : [];
  const channel = channels[channelIndex];
  if (!channel) return null;

  const byTrigger = (list) =>
    (Array.isArray(list) ? list : []).map((entry, index) => ({
      trigger: RECORD_TRIGGERS[index] || `slot${index}`,
      ...parseFormat(entry),
    }));

  return {
    channelIndex: channelIndex + 1,
    // Named by trigger so nothing downstream can mistake three configurations
    // of one stream for three streams.
    main: byTrigger(channel.MainFormat),
    extra: byTrigger(channel.ExtraFormat),
    snapshot: byTrigger(channel.SnapFormat),
  };
};

/* ------------------------------------------------------------------ *
 * Motion detection
 * ------------------------------------------------------------------ */

/**
 * Sensitivity scale is a property of the device, not a constant.
 *
 * Documentation for Dahua recorders describes a 1-6 scale. The real
 * DH-XVR1B16-I returned 80, which is meaningless on a 1-6 scale. The scale is
 * therefore reported as metadata alongside the value so the UI can render the
 * right control instead of assuming one, and so a future device with a third
 * scale does not need a code change.
 */
const SENSITIVITY_SCALES = Object.freeze({
  COARSE: { id: "1-6", min: 1, max: 6 },
  PERCENT: { id: "0-100", min: 0, max: 100 },
});

export const detectSensitivityScale = (value) => {
  if (value === null || value === undefined) return null;
  return Number(value) > SENSITIVITY_SCALES.COARSE.max
    ? SENSITIVITY_SCALES.PERCENT
    : SENSITIVITY_SCALES.COARSE;
};

export const parseMotionConfig = (config = {}, channelIndex = 0) => {
  const channels = Array.isArray(config?.MotionDetect) ? config.MotionDetect : [];
  const channel = channels[channelIndex];
  if (!channel) return null;

  const windows = Array.isArray(channel.MotionDetectWindow) ? channel.MotionDetectWindow : [];
  const window = windows[0] || {};
  const sensitivity = num(window.Sensitive);
  const scale = detectSensitivityScale(sensitivity);

  return {
    channelIndex: channelIndex + 1,
    enabled: bool(channel.Enable),
    detectVersion: text(channel.DetectVersion),
    sensitivity,
    // Metadata, not an assumption. See detectSensitivityScale.
    sensitivityScale: scale ? scale.id : null,
    sensitivityMin: scale ? scale.min : null,
    sensitivityMax: scale ? scale.max : null,
    threshold: num(window.Threshold),
    detectRegionCount: windows.length || null,
    recordEnabled: bool(channel.EventHandler?.RecordEnable),
    recordSeconds: num(channel.EventHandler?.RecordLatch),
    snapshotEnabled: bool(channel.EventHandler?.SnapshotEnable),
  };
};

/* ------------------------------------------------------------------ *
 * Network (read-only by policy)
 * ------------------------------------------------------------------ */

/**
 * DNS SERVERS COME BACK AS AN ARRAY.
 *
 * The documentation describes `DnsServers.Address0` / `.Address1`. The real
 * firmware returns `DnsServers: ["8.8.8.8", "8.8.4.4"]`, and the original
 * parser silently produced an empty list. Both shapes are accepted; an
 * unrecognised third shape yields an empty list rather than junk.
 */
const parseDnsServers = (network = {}) => {
  const raw = network.DnsServers;
  if (Array.isArray(raw)) return raw.map(text).filter(Boolean);
  if (raw && typeof raw === "object") {
    return Object.keys(raw)
      .filter((key) => /^Address\d+$/.test(key))
      .sort()
      .map((key) => text(raw[key]))
      .filter(Boolean);
  }
  return [];
};

export const parseNetworkInfo = (config = {}) => {
  const network = config?.Network || {};
  const interfaces = network.eth0 || network.Interfaces?.[0] || {};

  return {
    hostname: text(network.Hostname),
    // Deliberately reported, never written. See the capability model: this
    // surface is forced read-only until the disconnect workflow exists.
    ipAddress: text(interfaces.IPAddress),
    subnetMask: text(interfaces.SubnetMask),
    gateway: text(interfaces.DefaultGateway),
    dhcpEnabled: bool(interfaces.DhcpEnable),
    dnsAutoGet: bool(interfaces.DnsAutoGet),
    macAddress: text(interfaces.PhysicalAddress),
    mtu: num(interfaces.MTU),
    dns: parseDnsServers(network).concat(parseDnsServers(interfaces)).filter(Boolean),
  };
};

/** `configManager.cgi?action=getConfig&name=RTSP` — the port the device serves. */
export const parseRtspConfig = (config = {}) => {
  const rtsp = config?.RTSP || {};
  return {
    enabled: bool(rtsp.Enable),
    port: num(rtsp.Port),
    rtpPortRange:
      num(rtsp.RTP?.StartPort) !== null && num(rtsp.RTP?.EndPort) !== null
        ? { start: num(rtsp.RTP.StartPort), end: num(rtsp.RTP.EndPort) }
        : null,
  };
};

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/**
 * The device reports "2026-08-18 19:27:56" with no timezone.
 *
 * Returned as the literal device-local string plus the offset the device
 * believes it is in, and NOT converted: converting without certainty invents an
 * offset, and a playback search built on an invented offset returns the wrong
 * hour of footage.
 *
 * `ntpEnabled: false` on the real device, which means the clock is drifting.
 * That is surfaced as `clockTrusted` so a caller can warn before a playback
 * search silently returns the wrong window.
 */
export const parseSystemTime = (currentTime = {}, ntpConfig = {}) => {
  const raw = text(currentTime.result) || text(currentTime.time);
  const ntp = ntpConfig?.NTP || {};
  const ntpEnabled = bool(ntp.Enable);

  return {
    deviceTime: raw,
    timeZoneOffsetMinutes: num(ntp.TimeZone) !== null ? num(ntp.TimeZone) * 60 : null,
    timeZoneName: text(ntp.TimeZoneDesc),
    ntpEnabled,
    ntpServer: text(ntp.Address),
    ntpPort: num(ntp.Port),
    ntpUpdatePeriodMinutes: num(ntp.UpdatePeriod),
    // A device with NTP off will drift. Playback windows are computed against
    // this clock, so the caller needs to know it is unverified.
    clockTrusted: ntpEnabled === true,
  };
};

/* ------------------------------------------------------------------ *
 * P2P
 * ------------------------------------------------------------------ */

/**
 * Enable flag and cloud host ONLY.
 *
 * The real response also carries a device UUID, a masked key and a hashed
 * username. The UUID is serial-equivalent, and a published analysis showed the
 * serial format has little entropy — so it is exactly the value not to store.
 * This function is written to make lifting it impossible rather than merely
 * discouraged: it names the three fields it returns and touches nothing else.
 */
export const parseP2pStatus = (config = {}) => {
  const entry = Array.isArray(config?.T2UServer) ? config.T2UServer[0] || {} : config?.T2UServer || {};
  return {
    enabled: bool(entry.Enable),
    cloudHost: text(entry.Address),
    protocol: text(entry.Type),
  };
};

/* ------------------------------------------------------------------ *
 * Recording search
 * ------------------------------------------------------------------ */

/**
 * `mediaFileFind.cgi?action=findNextFile` returns `items[n]` entries.
 *
 * NOTE: this parser is not currently reachable. The probe safety gate excludes
 * mediaFileFind because `factory.create` allocates a finder handle on the
 * recorder, and the device advertises ONVIF recording/search/replay services
 * which are a better read path. Kept because the shape is settled and the ONVIF
 * path will normalise into the same output.
 */
export const parseRecordings = (config = {}) => {
  const items = Array.isArray(config?.items) ? config.items : [];

  return items
    .map((item) => {
      const startedAt = text(item.StartTime);
      const endedAt = text(item.EndTime);
      if (!startedAt || !endedAt) return null;
      return {
        startedAt,
        endedAt,
        channelIndex: num(item.Channel) !== null ? num(item.Channel) + 1 : null,
        sizeBytes: num(item.Length),
        type: text(item.Type),
        recordType: Array.isArray(item.Flags) ? text(item.Flags[0]) : text(item.Flags),
        // A device-internal locator. Playback uses it server-side; it is
        // stripped before any response reaches a browser.
        devicePath: text(item.FilePath),
      };
    })
    .filter(Boolean);
};

/** Total duration of a recording set, for the playback timeline. */
export const summariseRecordings = (recordings = []) => {
  if (!recordings.length) return { count: 0, totalBytes: null, earliest: null, latest: null };
  const sizes = recordings.map((entry) => entry.sizeBytes).filter((value) => value !== null);
  return {
    count: recordings.length,
    totalBytes: sizes.length ? sizes.reduce((sum, value) => sum + value, 0) : null,
    earliest: recordings.reduce((min, entry) => (entry.startedAt < min ? entry.startedAt : min), recordings[0].startedAt),
    latest: recordings.reduce((max, entry) => (entry.endedAt > max ? entry.endedAt : max), recordings[0].endedAt),
  };
};
