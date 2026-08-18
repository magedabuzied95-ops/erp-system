// Simulated Dahua DH-XVR1B16-I.
//
// WHY THIS EXISTS
// ---------------
// The whole Surveillance Center can be built, wired and tested against this,
// so that when a network path finally exists the only change is which transport
// a device row names. If the feature could only be developed against real
// hardware, it could only be developed in the shop, in front of a live
// recorder, with a real password.
//
// IT CANNOT BE ENABLED BY ACCIDENT IN PRODUCTION
// ----------------------------------------------
// Three independent interlocks, each sufficient on its own:
//
//   1. NODE_ENV=production refuses registration outright, whatever else is set.
//   2. It is registered only when SURVEILLANCE_MOCK_DEVICE is explicitly "true".
//   3. Registration is skipped unless the process is a dev server or a test run.
//
// A mock that silently answers for a real device is worse than no mock at all:
// an operator would see sixteen healthy cameras and a full disk, and believe it.
// So every response it produces is also tagged `x-surveillance-mock: 1`, and a
// test asserts the tag survives to the API layer.
//
// WHAT IT SIMULATES
// -----------------
// The reference recorder's real, awkward properties — not a convenient fiction:
//   * 1080N main stream (960x1080), NOT 1080p
//   * CIF sub stream at 7 fps, which is what makes a 16-up grid ugly
//   * one channel on H.265, which browsers cannot play
//   * two offline channels, because a shop always has one
//   * PTZ absent, because the model has no RS-485
//   * network writes refused, storage management absent
//   * a configurable fault mode, so timeout and auth-failure paths get exercised

import { DeviceTransport } from "./DeviceTransport.js";
import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";

const MOCK_HEADER = "x-surveillance-mock";

/** Channels 7 and 12 are dark. Every real installation has a couple. */
const OFFLINE_CHANNELS = new Set([7, 12]);
/** Channel 4 records H.265 — the browser-incompatible case the UI must handle. */
const H265_CHANNELS = new Set([4]);

const CHANNEL_NAMES = [
  "Entrance", "Cashier 1", "Cashier 2", "Shop Floor A", "Shop Floor B",
  "Fitting Rooms", "Back Corridor", "Stock Room", "Loading Bay", "Office",
  "Safe", "Rear Exit", "Street View", "Window Display", "Stairwell", "Roof Access",
];

const encodeBlock = (channelZeroBased) => {
  const channel = channelZeroBased + 1;
  const mainCodec = H265_CHANNELS.has(channel) ? "H.265" : "H.264";
  const subCodec = H265_CHANNELS.has(channel) ? "H.265" : "H.264";
  const enabled = !OFFLINE_CHANNELS.has(channel);
  return [
    // 1080N is 960x1080 — half the horizontal resolution of 1080p, stretched on
    // display. Encoding the real value here is what stops the UI from promising
    // Full HD.
    `table.Encode[${channelZeroBased}].MainFormat[0].Video.Compression=${mainCodec}`,
    `table.Encode[${channelZeroBased}].MainFormat[0].Video.Width=960`,
    `table.Encode[${channelZeroBased}].MainFormat[0].Video.Height=1080`,
    `table.Encode[${channelZeroBased}].MainFormat[0].Video.FPS=15`,
    `table.Encode[${channelZeroBased}].MainFormat[0].Video.BitRate=1536`,
    `table.Encode[${channelZeroBased}].MainFormat[0].Video.BitRateControl=VBR`,
    `table.Encode[${channelZeroBased}].MainFormat[0].Video.enable=${enabled}`,
    `table.Encode[${channelZeroBased}].MainFormat[0].Audio.enable=false`,
    // CIF at 7 fps. This is the datasheet limit, and it is why grid layouts
    // look the way they do on this model.
    `table.Encode[${channelZeroBased}].ExtraFormat[0].Video.Compression=${subCodec}`,
    `table.Encode[${channelZeroBased}].ExtraFormat[0].Video.Width=352`,
    `table.Encode[${channelZeroBased}].ExtraFormat[0].Video.Height=288`,
    `table.Encode[${channelZeroBased}].ExtraFormat[0].Video.FPS=7`,
    `table.Encode[${channelZeroBased}].ExtraFormat[0].Video.BitRate=192`,
    `table.Encode[${channelZeroBased}].ExtraFormat[0].Video.BitRateControl=CBR`,
    `table.Encode[${channelZeroBased}].ExtraFormat[0].Video.enable=${enabled}`,
  ].join("\r\n");
};

const pad = (n) => String(n).padStart(2, "0");
const stamp = (date) =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
  `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;

/**
 * Hour-long recording segments, which is how a recorder actually files them.
 * Generated relative to now so the playback UI always has something to show.
 */
const recordingsFor = (channel, from, to) => {
  const start = new Date(from);
  const end = new Date(to);
  const items = [];
  const cursor = new Date(Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), start.getUTCHours(),
  ));

  while (cursor < end && items.length < 200) {
    const segmentEnd = new Date(cursor.getTime() + 60 * 60 * 1000);
    // A real recorder has gaps: a reboot, a full disk, a power cut. Channel 7 is
    // offline entirely; everything else loses the 03:00 hour.
    const isGap = OFFLINE_CHANNELS.has(channel) || cursor.getUTCHours() === 3;
    if (!isGap && segmentEnd > start) {
      items.push({
        start: stamp(cursor < start ? start : cursor),
        end: stamp(segmentEnd > end ? end : segmentEnd),
        channel: channel - 1,
        // ~1536 kbps for an hour.
        length: Math.round((1536 * 1000 * 3600) / 8),
      });
    }
    cursor.setTime(segmentEnd.getTime());
  }
  return items;
};

export class MockSurveillanceTransport extends DeviceTransport {
  static transportKey = "mock";
  static displayName = "Simulated device (development only)";

  constructor(options = {}) {
    super(options);
    // Fault injection, set per device row so a tester can keep one healthy
    // recorder and one broken one side by side.
    this.fault = String(options.device?.mock_fault || options.fault || "").toLowerCase();
    this.authMethod = "digest";
    this.finders = new Map();
    this.nextFinderId = 1;
  }

  /**
   * The mock never resolves an address, so the SSRF guard is not exercised by
   * it. That is deliberate: the guard is tested directly, and a mock that had to
   * satisfy it would need a fake allowlist entry, which would be a real
   * allowlist entry that someone eventually forgets to remove.
   */
  async resolveDestination() {
    return { address: "203.0.113.1", family: 4, port: 80, host: "mock.device.invalid", pinned: true };
  }

  async ping() {
    if (this.fault === "offline") {
      throw new SurveillanceError("device did not respond", {
        code: SURVEILLANCE_ERROR_CODES.DEVICE_TIMEOUT,
        status: 504,
      });
    }
    return { ok: true, latencyMs: 12 };
  }

  async request({ method = "GET", path = "", responseType = "text" } = {}) {
    if (this.fault === "offline") {
      throw new SurveillanceError("device did not respond", {
        code: SURVEILLANCE_ERROR_CODES.DEVICE_TIMEOUT,
        status: 504,
      });
    }
    if (this.fault === "unauthorized") {
      return this.#reply(401, "");
    }

    const body = this.#route(String(path), responseType);
    if (body === null) return this.#reply(400, "Error");
    if (responseType === "buffer") return this.#reply(200, body);
    return this.#reply(200, body);
  }

  #reply(status, body) {
    return {
      status,
      // Every mock response is labelled. A response that reaches production
      // without a real device behind it is then visible rather than plausible.
      headers: { [MOCK_HEADER]: "1" },
      body,
    };
  }

  #route(path, responseType) {
    // ---- identity ----
    if (path.includes("action=getDeviceType")) return "type=XVR1B16-I\r\n";
    if (path.includes("action=getSoftwareVersion")) {
      return "version=4.000.0000000.2\r\nBuildDate=2023-11-14\r\n";
    }
    if (path.includes("action=getSerialNo")) return "sn=MOCK00000000000\r\n";
    if (path.includes("action=getSystemInfo")) {
      return [
        "deviceType=XVR1B16-I",
        "processor=ARM",
        "hardwareVersion=1.00",
        // Obviously fake, and 15 chars like the real format so length-sensitive
        // parsing is still exercised.
        "serialNumber=MOCK00000000000",
        "updateSerial=XVR1B16-I",
      ].join("\r\n");
    }
    if (path.includes("action=getMachineName")) return "name=Mock XVR\r\n";
    if (path.includes("action=getVendor")) return "vendor=Dahua\r\n";
    if (path.includes("name=MaxExtraStream")) return "table.MaxExtraStream=1\r\n";

    // ---- channels and encoding ----
    if (path.includes("name=Encode")) {
      return Array.from({ length: 16 }, (_, index) => encodeBlock(index)).join("\r\n");
    }
    if (path.includes("name=ChannelTitle")) {
      return CHANNEL_NAMES.map((name, index) => `table.ChannelTitle[${index}].Name=${name}`).join("\r\n");
    }

    // ---- storage ----
    if (path.includes("storageDevice.cgi")) {
      if (this.fault === "no-storage") return null;
      return [
        "list.info[0].Name=sda",
        // Degraded on purpose in one fault mode, so the UI's unhealthy path is
        // reachable without breaking a disk.
        `list.info[0].State=${this.fault === "disk-error" ? "Error" : "Running"}`,
        "list.info[0].Detail[0].Type=Read-Write",
        "list.info[0].Detail[0].TotalBytes=1000204886016",
        "list.info[0].Detail[0].UsedBytes=812339907584",
      ].join("\r\n");
    }

    // ---- recording / motion / network / time ----
    if (path.includes("name=RecordMode")) {
      return Array.from({ length: 16 }, (_, i) => `table.RecordMode[${i}].Mode=0`).join("\r\n");
    }
    if (path.includes("name=Record")) {
      return Array.from({ length: 16 }, (_, i) =>
        [
          `table.Record[${i}].PreRecord=5`,
          `table.Record[${i}].Redundant=false`,
          `table.Record[${i}].TimeSection[0][0]=1 00:00:00-23:59:59`,
        ].join("\r\n"),
      ).join("\r\n");
    }
    if (path.includes("name=MotionDetect")) {
      return Array.from({ length: 16 }, (_, i) =>
        [
          `table.MotionDetect[${i}].Enable=${i % 3 !== 0}`,
          `table.MotionDetect[${i}].MotionDetectWindow[0].Sensitive=3`,
          `table.MotionDetect[${i}].MotionDetectWindow[0].Threshold=5`,
          `table.MotionDetect[${i}].EventHandler.RecordEnable=true`,
          `table.MotionDetect[${i}].EventHandler.RecordLatch=10`,
        ].join("\r\n"),
      ).join("\r\n");
    }
    if (path.includes("name=Network")) {
      return [
        "table.Network.Hostname=XVR1B16",
        "table.Network.eth0.IPAddress=192.168.1.108",
        "table.Network.eth0.SubnetMask=255.255.255.0",
        "table.Network.eth0.DefaultGateway=192.168.1.1",
        "table.Network.eth0.DhcpEnable=false",
        "table.Network.eth0.PhysicalAddress=00:11:22:33:44:55",
        "table.Network.DnsServers.Address0=8.8.8.8",
      ].join("\r\n");
    }
    if (path.includes("name=NTP")) {
      return [
        "table.NTP.Enable=true",
        "table.NTP.Address=pool.ntp.org",
        "table.NTP.Port=123",
        "table.NTP.TimeZone=2",
        "table.NTP.UpdatePeriod=60",
      ].join("\r\n");
    }
    if (path.includes("action=getCurrentTime")) return `result=${stamp(new Date())}\r\n`;

    // ---- snapshot ----
    if (path.includes("snapshot.cgi")) {
      if (responseType !== "buffer") return "Error";
      // A 1x1 JPEG. Enough to prove the path returns image bytes without
      // shipping a media file into the repository.
      return Buffer.from(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
          "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
          "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
        "base64",
      );
    }

    // ---- PTZ: absent on this model ----
    if (path.includes("ptz.cgi")) return null;

    // ---- recording search ----
    if (path.includes("action=factory.create")) {
      const id = this.nextFinderId;
      this.nextFinderId += 1;
      this.finders.set(id, { results: [], cursor: 0 });
      return `result=${id}\r\n`;
    }
    if (path.includes("action=findFile")) {
      const id = Number(new URLSearchParams(path.split("?")[1]).get("object"));
      const params = new URLSearchParams(path.split("?")[1]);
      const finder = this.finders.get(id);
      if (!finder) return null;
      finder.results = recordingsFor(
        Number(params.get("condition.Channel")) + 1,
        params.get("condition.StartTime"),
        params.get("condition.EndTime"),
      );
      finder.cursor = 0;
      return "OK\r\n";
    }
    if (path.includes("action=findNextFile")) {
      const params = new URLSearchParams(path.split("?")[1]);
      const finder = this.finders.get(Number(params.get("object")));
      if (!finder) return null;
      const count = Math.min(Number(params.get("count")) || 100, 100);
      const page = finder.results.slice(finder.cursor, finder.cursor + count);
      finder.cursor += page.length;
      if (!page.length) return "found=0\r\n";
      return [
        `found=${page.length}`,
        ...page.flatMap((item, index) => [
          `items[${index}].Channel=${item.channel}`,
          `items[${index}].StartTime=${item.start}`,
          `items[${index}].EndTime=${item.end}`,
          `items[${index}].Length=${item.length}`,
          `items[${index}].Type=dav`,
          `items[${index}].FilePath=/mnt/dvr/${item.channel}/${item.start.replace(/[: ]/g, "-")}.dav`,
        ]),
      ].join("\r\n");
    }
    if (path.includes("action=close") || path.includes("action=destroy")) {
      const params = new URLSearchParams(path.split("?")[1]);
      this.finders.delete(Number(params.get("object")));
      return "OK\r\n";
    }

    // ---- restart ----
    if (path.includes("action=reboot")) return "OK\r\n";

    // Anything else is an endpoint this model does not serve, which is exactly
    // what the capability probe needs to see.
    return null;
  }
}

/**
 * Whether the simulated device may be used at all.
 *
 * Read at registration time AND asserted again at device-creation time, so a
 * process that somehow started with it registered still cannot attach it to a
 * new device in production.
 */
export const mockTransportAllowed = () => {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") return false;
  return ["1", "true", "yes", "on"].includes(String(process.env.SURVEILLANCE_MOCK_DEVICE || "").toLowerCase());
};

export const assertMockTransportAllowed = () => {
  if (mockTransportAllowed()) return true;
  throw new SurveillanceError("the simulated device is not available in this environment", {
    code: SURVEILLANCE_ERROR_CODES.TRANSPORT_UNKNOWN,
    status: 403,
    details: { transport: "mock" },
  });
};

export const MOCK_RESPONSE_HEADER = MOCK_HEADER;
export default MockSurveillanceTransport;
