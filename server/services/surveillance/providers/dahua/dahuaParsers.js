// Dahua config responses -> neutral shapes.
//
// Each function takes an already-parsed config object (see dahuaResponseParser)
// and returns the vendor-neutral shape the rest of the system uses. Nothing
// here does I/O, so every one of them is testable against a fixture.
//
// THE RULE THEY ALL FOLLOW
// ------------------------
// A field the device did not report comes back as null, never as a plausible
// default. `fps: 0` and `fps: null` look similar and mean opposite things: one
// says the device reports zero, the other says we do not know. A UI that shows
// "0 fps" for an unreported value is lying, and an operator who acts on it is
// acting on our invention.

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

/* ------------------------------------------------------------------ *
 * Device identity
 * ------------------------------------------------------------------ */

/**
 * @param {object} sources { deviceType, softwareVersion, systemInfo, machineName }
 *        each already parsed
 */
export const parseDeviceInfo = (sources = {}) => {
  const { deviceType = {}, softwareVersion = {}, systemInfo = {}, machineName = {} } = sources;
  return {
    model: text(deviceType.type) || text(systemInfo.deviceType) || null,
    firmware: text(softwareVersion.version) || null,
    buildDate: text(softwareVersion.BuildDate) || text(softwareVersion.buildDate) || null,
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
 * Channel list from the title config plus the encode config.
 *
 * Dahua reports channel titles and encode settings separately, and a device may
 * report more encode entries than it has enabled channels. The encode config is
 * treated as the authority on how many channels exist, because a channel with
 * no encoder cannot be streamed whatever its title says.
 */
export const parseChannels = (encodeConfig = {}, titleConfig = {}) => {
  const encoders = Array.isArray(encodeConfig?.Encode) ? encodeConfig.Encode : [];
  const titles = Array.isArray(titleConfig?.ChannelTitle) ? titleConfig.ChannelTitle : [];

  return encoders.map((entry, index) => {
    const main = entry?.MainFormat?.[0]?.Video || {};
    const extra = entry?.ExtraFormat?.[0]?.Video || {};
    return {
      // ERP-facing channel numbers are 1-based, matching RTSP and matching what
      // is printed on the recorder's own front panel.
      index: index + 1,
      vendorName: text(titles[index]?.Name) || null,
      enabled: main.enable !== false,
      mainCodec: text(main.Compression),
      subCodec: text(extra.Compression),
    };
  });
};

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

const BYTES_PER_GB = 1024 ** 3;

/**
 * `storageDevice.cgi?action=getDeviceAllInfo`
 *
 * Dahua reports per-disk `Detail` entries. Totals are summed rather than read
 * from a device-level field, because the device-level field is absent on some
 * firmwares and summing is correct on all of them.
 */
export const parseStorageInfo = (config = {}) => {
  const disks = Array.isArray(config?.info) ? config.info : [];

  const parsed = disks.map((disk) => {
    const detail = Array.isArray(disk?.Detail) ? disk.Detail[0] || {} : {};
    const totalBytes = num(detail.TotalBytes);
    const usedBytes = num(detail.UsedBytes);
    return {
      name: text(disk.Name),
      // "Running", "Error", "No Disk"... reported as-is rather than mapped to a
      // boolean: "is the disk OK" is a question with more than two answers, and
      // flattening it hides the one an operator needs to act on.
      state: text(disk.State),
      type: text(detail.Type) || text(disk.Type),
      totalBytes,
      usedBytes,
      freeBytes: totalBytes !== null && usedBytes !== null ? totalBytes - usedBytes : null,
      totalGb: totalBytes !== null ? Math.round(totalBytes / BYTES_PER_GB) : null,
      usedGb: usedBytes !== null ? Math.round(usedBytes / BYTES_PER_GB) : null,
      isHealthy: text(disk.State) === null ? null : /running|ok|normal/i.test(String(disk.State)),
    };
  });

  const withTotals = parsed.filter((disk) => disk.totalBytes !== null);
  const totalBytes = withTotals.reduce((sum, disk) => sum + disk.totalBytes, 0);
  const usedBytes = withTotals.reduce((sum, disk) => sum + (disk.usedBytes || 0), 0);

  return {
    disks: parsed,
    diskCount: parsed.length,
    totalBytes: withTotals.length ? totalBytes : null,
    usedBytes: withTotals.length ? usedBytes : null,
    freeBytes: withTotals.length ? totalBytes - usedBytes : null,
    usedPercent: withTotals.length && totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : null,
    // Any disk not healthy makes the device not healthy. A recorder with one
    // failed disk of two is not "mostly fine".
    healthy: parsed.length ? parsed.every((disk) => disk.isHealthy === true) : null,
  };
};

/* ------------------------------------------------------------------ *
 * Recording configuration
 * ------------------------------------------------------------------ */

/**
 * Dahua schedules are a 7-day x 6-period matrix per record type. Rather than
 * exposing that shape, it is summarised into what an operator actually asks:
 * is this channel recording, and on what trigger.
 */
export const parseRecordingConfig = (config = {}, channelIndex = 0) => {
  const modes = Array.isArray(config?.RecordMode) ? config.RecordMode : [];
  const schedules = Array.isArray(config?.Record) ? config.Record : [];

  const mode = modes[channelIndex] || {};
  const schedule = schedules[channelIndex] || {};

  // 0 = follow schedule, 1 = always record, 2 = never record.
  const modeValue = num(mode.Mode);
  const modeName =
    modeValue === 1 ? "always" : modeValue === 2 ? "off" : modeValue === 0 ? "schedule" : null;

  const periods = Array.isArray(schedule.TimeSection) ? schedule.TimeSection : [];

  return {
    channelIndex: channelIndex + 1,
    mode: modeName,
    modeRaw: modeValue,
    // Whether any period in the week enables the continuous record type.
    hasSchedule: periods.length > 0,
    scheduleDays: periods.length || null,
    preRecordSeconds: num(schedule.PreRecord),
    redundant: bool(schedule.Redundant),
  };
};

/* ------------------------------------------------------------------ *
 * Encoder configuration
 * ------------------------------------------------------------------ */

const parseFormat = (entry = {}) => {
  const video = entry?.Video || {};
  const audio = entry?.Audio || {};
  return {
    codec: text(video.Compression),
    width: num(video.Width),
    height: num(video.Height),
    fps: num(video.FPS),
    bitrateKbps: num(video.BitRate),
    // "CBR" / "VBR". Matters because a VBR stream's reported bitrate is a
    // ceiling, not a measurement, and the bandwidth budget should treat it so.
    bitrateControl: text(video.BitRateControl),
    quality: num(video.Quality),
    gop: num(video.GOP),
    enabled: video.enable === false ? false : true,
    audioEnabled: audio.enable === true,
    audioCodec: text(audio.Compression),
  };
};

export const parseEncoderConfig = (config = {}, channelIndex = 0) => {
  const channels = Array.isArray(config?.Encode) ? config.Encode : [];
  const channel = channels[channelIndex];
  if (!channel) return null;

  return {
    channelIndex: channelIndex + 1,
    main: (Array.isArray(channel.MainFormat) ? channel.MainFormat : []).map(parseFormat),
    extra: (Array.isArray(channel.ExtraFormat) ? channel.ExtraFormat : []).map(parseFormat),
    snapshot: (Array.isArray(channel.SnapFormat) ? channel.SnapFormat : []).map(parseFormat),
  };
};

/* ------------------------------------------------------------------ *
 * Motion detection
 * ------------------------------------------------------------------ */

export const parseMotionConfig = (config = {}, channelIndex = 0) => {
  const channels = Array.isArray(config?.MotionDetect) ? config.MotionDetect : [];
  const channel = channels[channelIndex];
  if (!channel) return null;

  const window = Array.isArray(channel.MotionDetectWindow) ? channel.MotionDetectWindow[0] || {} : {};

  return {
    channelIndex: channelIndex + 1,
    enabled: bool(channel.Enable),
    // Dahua sensitivity is 1-6 on recorders and 0-100 on some cameras. Reported
    // with its scale so the UI renders the right control instead of guessing.
    sensitivity: num(window.Sensitive),
    sensitivityScale: num(window.Sensitive) !== null && num(window.Sensitive) <= 6 ? "1-6" : "0-100",
    threshold: num(window.Threshold),
    detectRegionCount: Array.isArray(channel.MotionDetectWindow) ? channel.MotionDetectWindow.length : null,
    recordEnabled: bool(channel.EventHandler?.RecordEnable),
    recordSeconds: num(channel.EventHandler?.RecordLatch),
    snapshotEnabled: bool(channel.EventHandler?.SnapshotEnable),
  };
};

/* ------------------------------------------------------------------ *
 * Network (read-only by policy)
 * ------------------------------------------------------------------ */

export const parseNetworkInfo = (config = {}) => {
  const network = config?.Network || {};
  const interfaces = network.eth0 || network.Interfaces?.[0] || {};

  return {
    hostname: text(network.Hostname),
    // Deliberately reported, never written. See the capability model: this
    // surface is forced to read-only until the disconnect workflow exists.
    ipAddress: text(interfaces.IPAddress),
    subnetMask: text(interfaces.SubnetMask),
    gateway: text(interfaces.DefaultGateway),
    dhcpEnabled: bool(interfaces.DhcpEnable),
    macAddress: text(interfaces.PhysicalAddress),
    mtu: num(interfaces.MTU),
    dns: [text(network.DnsServers?.Address0), text(network.DnsServers?.Address1)].filter(Boolean),
  };
};

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/**
 * Dahua reports "2026-08-17 00:31:45" with no timezone. Returned as the literal
 * device-local string plus a parsed value, and NOT converted: converting
 * without knowing the device's zone invents an offset, and a playback search
 * built on an invented offset returns the wrong hour of footage.
 */
export const parseSystemTime = (currentTime = {}, ntpConfig = {}) => {
  const raw = text(currentTime.result) || text(currentTime.time);
  const ntp = ntpConfig?.NTP || {};

  return {
    deviceTime: raw,
    timeZoneOffsetMinutes: num(ntp.TimeZone) !== null ? num(ntp.TimeZone) * 60 : null,
    ntpEnabled: bool(ntp.Enable),
    ntpServer: text(ntp.Address),
    ntpPort: num(ntp.Port),
    ntpUpdatePeriodMinutes: num(ntp.UpdatePeriod),
  };
};

/* ------------------------------------------------------------------ *
 * Recording search
 * ------------------------------------------------------------------ */

/**
 * `mediaFileFind.cgi?action=findNextFile` returns `items[n]` entries.
 *
 * Only fields the ERP needs are lifted. In particular the on-device file PATH is
 * kept, because playback needs it, but it is never sent to a browser — it is a
 * device-internal locator and exposing it is a small information leak with no
 * benefit.
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
        // "dav" normally. Kept because a container we cannot remux is a real
        // playback failure and the UI should be able to say which one.
        type: text(item.Type),
        recordType: num(item.Flags?.[0]) !== null ? text(item.Flags[0]) : text(item.Flags),
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
