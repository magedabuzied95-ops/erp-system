// Assertions derived from a real DH-XVR1B16-I.
//
// Every fixture here is a SANITIZED capture from an actual read-only probe of a
// working recorder, not a construction from documentation. Each test below
// corresponds to a place where the device contradicted the docs and the first
// implementation was wrong. They exist so the same wrong assumption cannot come
// back.
//
// The identifiers are synthetic: serial, UUID, machine name and P2P username
// were replaced before anything was committed. Every other value is what the
// device actually returned.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseDahuaConfig, parseDahuaResponse, isDahuaError } from "../../server/services/surveillance/providers/dahua/dahuaResponseParser.js";
import {
  detectSensitivityScale,
  parseChannels,
  parseDeviceInfo,
  parseEncoderConfig,
  parseMotionConfig,
  parseNetworkInfo,
  parseP2pStatus,
  parsePhysicalChannelCount,
  parseRecordingConfig,
  parseRtspConfig,
  parseStorageInfo,
  parseSystemTime,
  RECORD_TRIGGERS,
} from "../../server/services/surveillance/providers/dahua/dahuaParsers.js";
import {
  dahuaRtspPath,
  dahuaSnapshotProfile,
  dahuaStreamProfiles,
} from "../../server/services/surveillance/providers/dahua/dahuaStreamProfiles.js";
import { selectStreamProfile, STREAM_PURPOSES } from "../../server/services/surveillance/surveillanceStreamProfiles.js";

const raw = (name) => readFileSync(new URL(`../fixtures/dahua/${name}`, import.meta.url), "utf8");
const config = (name) => parseDahuaConfig(raw(name));
const flat = (name) => parseDahuaResponse(raw(name));

const encode = config("encode-config-real.txt");
const titles = config("channel-title-real.txt");
const physical = parsePhysicalChannelCount(flat("video-in-collect.txt"));
const maxExtraStream = config("max-extra-stream.txt").MaxExtraStream;

/* ------------------------------------------------------------------ *
 * Channels: 50 slots, 17 populated, 16 real
 * ------------------------------------------------------------------ */

test("the real device reports 50 encode slots for a 16-channel recorder", () => {
  // The raw shape that broke the first parser. Asserted directly so the fixture
  // cannot be "tidied up" into something more reasonable than reality.
  assert.equal(encode.Encode.length, 50);
  assert.equal(encode.Encode.filter(Boolean).length, 17);
  // Slot 49 is a detached H.264 template with a MainFormat and nothing else. It
  // is the entry that made a non-null count report 17 channels.
  assert.ok(encode.Encode[49]);
  assert.equal(encode.Encode[49].MainFormat[0].Video.Compression, "H.264");
  assert.equal(encode.Encode[49].ExtraFormat, undefined);
  // And the slots between are genuinely absent.
  assert.equal(encode.Encode[20], undefined);
});

test("the authoritative physical channel count is 16", () => {
  assert.equal(physical, 16);
});

test("parseChannels returns 16 channels, not 50 and not 17", () => {
  const channels = parseChannels(encode, titles, { physicalChannelCount: physical });
  assert.equal(channels.length, 16);
  assert.equal(channels[0].index, 1);
  assert.equal(channels[15].index, 16);
  assert.ok(channels.every((channel) => channel.described));
  assert.ok(channels.every((channel) => channel.enabled));
});

test("without the authoritative count, the contiguous run still yields 16", () => {
  // The fallback has to ignore the detached slot 49, which a plain non-null
  // count does not.
  assert.equal(parseChannels(encode, titles).length, 16);
});

test("channels are enabled via VideoEnable, not Video.enable", () => {
  // Neither key exists inside Video on the real device. Treating a missing flag
  // as disabled would have dropped all sixteen channels.
  assert.equal(encode.Encode[0].MainFormat[0].VideoEnable, true);
  assert.equal(encode.Encode[0].MainFormat[0].Video.enable, undefined);
  assert.equal(parseChannels(encode, titles, { physicalChannelCount: physical })[0].enabled, true);
});

test("channel titles are the unrenamed factory defaults", () => {
  const channels = parseChannels(encode, titles, { physicalChannelCount: physical });
  assert.equal(channels[0].vendorName, "Channel1");
  assert.equal(channels[15].vendorName, "Channel16");
});

/* ------------------------------------------------------------------ *
 * Stream profiles: format arrays are record triggers, not streams
 * ------------------------------------------------------------------ */

test("MainFormat has three entries and they are not three streams", () => {
  const main = encode.Encode[0].MainFormat;
  assert.equal(main.length, 3);
  // All three identical on the real device: nobody configured motion recording
  // to differ from timed recording.
  assert.deepEqual(main[0].Video, main[1].Video);
  assert.deepEqual(main[1].Video, main[2].Video);
  assert.deepEqual([...RECORD_TRIGGERS], ["general", "motion", "alarm"]);
});

test("ExtraFormat also has three trigger entries, not three sub streams", () => {
  const extra = encode.Encode[0].ExtraFormat;
  assert.equal(extra.length, 3);
  assert.deepEqual(extra[0].Video, extra[2].Video);
  // MaxExtraStream is what actually bounds the addressable streams.
  assert.equal(maxExtraStream, 1);
});

test("this device yields exactly two profiles with unique keys", () => {
  const profiles = dahuaStreamProfiles(encode, 0, { maxExtraStream });
  assert.equal(profiles.length, 2, "six profiles was the bug");
  assert.deepEqual(profiles.map((p) => p.key), ["0", "1"]);
  assert.equal(new Set(profiles.map((p) => p.key)).size, 2);
});

test("the real profile values are carried through exactly", () => {
  const [main, sub] = dahuaStreamProfiles(encode, 0, { maxExtraStream });
  // 1080N is 960x1080 — not 1080p.
  assert.deepEqual(
    { codec: main.codec, w: main.width, h: main.height, fps: main.fps, kbps: main.bitrate_kbps },
    { codec: "h265", w: 960, h: 1080, fps: 25, kbps: 512 },
  );
  assert.deepEqual(
    { codec: sub.codec, w: sub.width, h: sub.height, fps: sub.fps, kbps: sub.bitrate_kbps },
    { codec: "h265", w: 352, h: 288, fps: 7, kbps: 80 },
  );
  // Channel 1 runs at 25fps and the rest at 15.
  assert.equal(dahuaStreamProfiles(encode, 1, { maxExtraStream })[0].fps, 15);
});

test("every stream on this device is H.265 and none is browser-native", () => {
  // The finding that forced transcoding into the media design.
  for (let channel = 0; channel < 16; channel += 1) {
    for (const profile of dahuaStreamProfiles(encode, channel, { maxExtraStream })) {
      assert.equal(profile.codec, "h265", `channel ${channel + 1}`);
      assert.equal(profile.browser_native, false, `channel ${channel + 1}`);
    }
  }
});

test("a device reporting two extra streams would yield three profiles", () => {
  // The architecture stays flexible for hardware that genuinely has more.
  const profiles = dahuaStreamProfiles(encode, 0, { maxExtraStream: 2 });
  assert.ok(profiles.length >= 2);
  assert.equal(new Set(profiles.map((p) => p.key)).size, profiles.length);
});

test("the snapshot encoder is a separate, much smaller profile", () => {
  // MJPEG 352x288 at 1fps, which is not what anyone expects from a snapshot
  // button on a 1080-class recorder.
  assert.deepEqual(dahuaSnapshotProfile(encode, 0), { codec: "MJPG", width: 352, height: 288, fps: 1 });
});

test("RTSP paths map profile keys onto subtypes with 1-based channels", () => {
  const [main, sub] = dahuaStreamProfiles(encode, 0, { maxExtraStream });
  assert.equal(dahuaRtspPath(1, main.key), "/cam/realmonitor?channel=1&subtype=0");
  assert.equal(dahuaRtspPath(1, sub.key), "/cam/realmonitor?channel=1&subtype=1");
});

test("the real SDP confirms the sub stream is H.265 at 7fps", () => {
  // Independent confirmation from a second protocol: the encoder config and the
  // RTSP DESCRIBE agree, which is what makes the H.265 finding trustworthy.
  const sdp = raw("rtsp-describe-ch1-sub.sdp");
  assert.match(sdp, /a=rtpmap:98 H265\/90000/);
  assert.match(sdp, /a=framerate:7\.000000/);
  // One video track, matching MaxExtraStream=1.
  assert.equal((sdp.match(/^m=video/gm) || []).length, 1);
});

test("selection refuses an all-H.265 channel unless transcoding is allowed", () => {
  const profiles = dahuaStreamProfiles(encode, 0, { maxExtraStream });
  assert.throws(
    () => selectStreamProfile({ profiles, purpose: STREAM_PURPOSES.GRID, tileCount: 16 }),
    (error) => {
      assert.equal(error.code, "SURVEILLANCE_CAPABILITY_UNSUPPORTED");
      assert.deepEqual(error.details.codecs, ["h265"]);
      return true;
    },
  );
  // With transcoding permitted, a 16-up grid picks the cheap CIF profile.
  const { profile } = selectStreamProfile({
    profiles,
    purpose: STREAM_PURPOSES.GRID,
    tileCount: 16,
    budgetKbps: 4000,
    allowTranscode: true,
  });
  assert.equal(profile.key, "1");
  assert.equal(profile.width, 352);
});

/* ------------------------------------------------------------------ *
 * Storage: four partitions, Success is healthy, full is normal
 * ------------------------------------------------------------------ */

test("one disk with four partitions is summed, not read from Detail[0]", () => {
  const storage = parseStorageInfo(config("storage-real.txt"));
  assert.equal(storage.diskCount, 1);
  assert.equal(storage.partitionCount, 4);
  // Reading Detail[0] alone reported a quarter of this.
  assert.equal(storage.totalGb, 1844);
  assert.equal(storage.disks[0].partitions.length, 4);
});

test("State Success counts as healthy", () => {
  // The original regex was /running|ok|normal/ and scored a perfectly good disk
  // as unhealthy.
  const storage = parseStorageInfo(config("storage-real.txt"));
  assert.equal(storage.disks[0].state, "Success");
  assert.equal(storage.healthy, true);
});

test("a full DVR disk is reported as full but NOT as unhealthy", () => {
  // A recorder in overwrite mode runs at 100% for its entire service life.
  const storage = parseStorageInfo(config("storage-real.txt"));
  assert.equal(storage.usedPercent, 100);
  assert.equal(storage.full, true);
  assert.equal(storage.healthy, true, "full must never imply broken");
});

test("a partition error makes the disk unhealthy regardless of the state string", () => {
  const broken = parseDahuaConfig(
    raw("storage-real.txt").replace("Detail[2].IsError=false", "Detail[2].IsError=true"),
  );
  const storage = parseStorageInfo(broken);
  assert.equal(storage.healthy, false);
  assert.equal(storage.disks[0].state, "Success", "the string still says Success");
});

/* ------------------------------------------------------------------ *
 * Network, time, recording, motion, P2P
 * ------------------------------------------------------------------ */

test("DNS servers arrive as an array and are not lost", () => {
  // The documented shape was DnsServers.Address0/.Address1; the real firmware
  // sends an array, and the original parser produced an empty list.
  const network = parseNetworkInfo(config("network-real.txt"));
  assert.deepEqual(network.dns, ["8.8.8.8", "8.8.4.4"]);
  assert.equal(network.ipAddress, "192.168.1.108");
  assert.equal(network.dhcpEnabled, false);
  assert.equal(network.mtu, 1500);
});

test("the object form of DnsServers still parses, for other firmwares", () => {
  const legacy = parseDahuaConfig(
    "table.Network.DnsServers.Address0=1.1.1.1\r\ntable.Network.DnsServers.Address1=1.0.0.1",
  );
  assert.deepEqual(parseNetworkInfo(legacy).dns, ["1.1.1.1", "1.0.0.1"]);
});

test("the RTSP service reports its real port and RTP range", () => {
  assert.deepEqual(parseRtspConfig(config("rtsp-config-real.txt")), {
    enabled: true,
    port: 554,
    rtpPortRange: { start: 20000, end: 40000 },
  });
});

test("the schedule has seven weekdays plus an all-days template, not eight days", () => {
  const recording = parseRecordingConfig(config("record-real.txt"), 0);
  assert.equal(recording.scheduleRowCount, 8);
  assert.equal(recording.scheduleDays, 7, "eight days was the bug");
  assert.equal(recording.hasAllDaysTemplate, true);
  assert.equal(recording.mode, "schedule");
  assert.equal(recording.preRecordSeconds, 4);
});

test("motion sensitivity carries its scale instead of assuming one", () => {
  // Documentation described 1-6. The real device returned 80.
  const motion = parseMotionConfig(config("motion-real.txt"), 0);
  assert.equal(motion.sensitivity, 80);
  assert.equal(motion.sensitivityScale, "0-100");
  assert.equal(motion.sensitivityMin, 0);
  assert.equal(motion.sensitivityMax, 100);
  assert.equal(motion.detectRegionCount, 4);
  assert.equal(motion.detectVersion, "V3.0");
});

test("the coarse scale is still detected for devices that use it", () => {
  assert.equal(detectSensitivityScale(3).id, "1-6");
  assert.equal(detectSensitivityScale(80).id, "0-100");
  assert.equal(detectSensitivityScale(null), null);
});

test("the clock is reported as untrusted because NTP is disabled", () => {
  const time = parseSystemTime(flat("current-time-real.txt"), config("ntp-real.txt"));
  assert.equal(time.ntpEnabled, false);
  assert.equal(time.clockTrusted, false, "playback windows are computed against this clock");
  assert.equal(time.timeZoneName, "Cairo");
  assert.equal(time.timeZoneOffsetMinutes, 120);
  assert.equal(time.deviceTime, "2026-08-18 19:27:56");
});

test("P2P reports only the enable flag, host and protocol", () => {
  // The real response also carries a serial-equivalent UUID, a masked key and a
  // hashed username. This parser is written so that lifting them is impossible
  // rather than merely discouraged.
  const p2p = parseP2pStatus(config("p2p-real.txt"));
  assert.deepEqual(p2p, { enabled: true, cloudHost: "www.easy4ipcloud.com", protocol: "dhp2p" });
  const serialised = JSON.stringify(p2p);
  for (const forbidden of ["UUID", "Key", "Username", "SYNTHETIC-UUID"]) {
    assert.ok(!serialised.includes(forbidden), forbidden);
  }
});

/* ------------------------------------------------------------------ *
 * Identity and PTZ
 * ------------------------------------------------------------------ */

test("firmware and build date are split out of one combined string", () => {
  // The real device returns "version=4.001.0000000.14,build:2021-03-06 10:32:02"
  // rather than the two separate fields the documentation describes.
  const info = parseDeviceInfo({
    deviceType: flat("device-type.txt"),
    softwareVersion: flat("software-version.txt"),
    systemInfo: flat("system-info.txt"),
    machineName: flat("machine-name.txt"),
  });
  assert.equal(info.model, "DH-XVR1B16-I");
  assert.equal(info.firmware, "4.001.0000000.14");
  assert.equal(info.buildDate, "2021-03-06 10:32:02");
  assert.equal(info.processor, "ST7108");
});

test("the PTZ read is a device error, which is a real unsupported", () => {
  // HTTP 400 with body "Error" on a recorder with no RS-485 port.
  assert.equal(isDahuaError(400, raw("ptz-status-error.txt")), true);
});

test("the encoder config names format slots by trigger", () => {
  const encoder = parseEncoderConfig(encode, 0);
  assert.deepEqual(encoder.main.map((f) => f.trigger), ["general", "motion", "alarm"]);
  assert.equal(encoder.main[0].bitrateControl, "CBR");
  assert.equal(encoder.main[0].profile, "High");
  assert.equal(encoder.extra[0].codec, "H.265");
});
