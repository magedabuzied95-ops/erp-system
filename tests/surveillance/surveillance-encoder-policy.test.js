// Encoder selection and capacity.
//
// The measurement that produced these numbers, on the reference host
// (i7-7500U, 2 physical cores, Intel HD Graphics 620), transcoding
// 960x1080 25fps H.265 to H.264:
//
//   libx264 veryfast CRF18       0.702 cores/camera   22.0 s wall for 60 s
//   d3d11va decode + libx264     0.706 cores/camera   (decode offload: no gain)
//   hevc_qsv -> h264_qsv         0.049 cores/camera    5.1 s wall for 60 s
//
// and concurrently, on the hardware path:
//
//    1 stream   11.9x realtime      4 streams  18.5x
//    9 streams  18.7x realtime     16 streams  19.0x
//
// The flattening is the finding. These tests pin the two conclusions drawn
// from it, because both are easy to regress into something that looks
// reasonable and is wrong.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ENCODER_COST_CORES,
  capacityFor,
  decoderInputArgs,
  encoderOutputArgs,
} from "../../server/services/surveillance/media/mediaEncoderPolicy.js";

import { buildTranscodeArgs } from "../../server/services/surveillance/media/MediaMtxGateway.js";

/* ------------------------------------------------------------------ *
 * Capacity
 * ------------------------------------------------------------------ */

test("software encoding on the reference host supports ONE camera", () => {
  // 1.4 core budget / 0.702 per camera = 1.99, floored to 1. Not a rounding
  // quibble: it is the difference between "the wall is a bit tight" and "this
  // host cannot do the job in software at all". Sixteen channels would need
  // 11.2 cores on a machine that has two.
  const capacity = capacityFor("libx264", { cores: 2 });
  assert.equal(capacity.max_concurrent_transcodes, 1);
  assert.equal(capacity.limited_by, "cpu");
});

test("hardware capacity is bounded by the encode block, not the CPU budget", () => {
  // The trap: 1.4 cores / 0.049 = 28. Reporting 28 would promise nearly twice
  // what the measured ~19x realtime ceiling can actually deliver.
  const capacity = capacityFor("h264_qsv", { cores: 2 });
  assert.ok(capacity.max_concurrent_transcodes <= 19, `promised ${capacity.max_concurrent_transcodes}`);
  assert.ok(capacity.max_concurrent_transcodes >= 16, "must still cover all 16 channels");
  assert.equal(capacity.limited_by, "encoder-throughput");
});

test("a bigger CPU does not raise the hardware ceiling", () => {
  // More cores cannot conjure a second Quick Sync block. A capacity model that
  // scales with cores would over-promise on exactly the machines an operator
  // would buy to fix the problem.
  const small = capacityFor("h264_qsv", { cores: 2 });
  const large = capacityFor("h264_qsv", { cores: 32 });
  assert.equal(small.max_concurrent_transcodes, large.max_concurrent_transcodes);
});

test("a bigger CPU does raise the software ceiling", () => {
  assert.ok(capacityFor("libx264", { cores: 16 }).max_concurrent_transcodes >
            capacityFor("libx264", { cores: 2 }).max_concurrent_transcodes);
});

test("capacity is never zero, so the UI always has one tile to offer", () => {
  for (const cores of [0, 1, undefined]) {
    assert.ok(capacityFor("libx264", { cores }).max_concurrent_transcodes >= 1);
  }
});

test("an unknown encoder is costed as software rather than assumed cheap", () => {
  // Guessing cheap for an unrecognised encoder oversubscribes the host.
  const capacity = capacityFor("h264_someNewThing", { cores: 2 });
  assert.equal(capacity.cores_per_camera, ENCODER_COST_CORES.libx264);
});

/* ------------------------------------------------------------------ *
 * Encoder-specific flags
 * ------------------------------------------------------------------ */

test("QSV does not receive x264-only flags", () => {
  const args = encoderOutputArgs("h264_qsv", { bitrateKbps: 2048, fps: 25 }).join(" ");
  // -crf and -tune zerolatency are x264 vocabulary. QSV either errors on them
  // or ignores them and delivers a stream at the wrong bitrate.
  assert.ok(!args.includes("-crf"), args);
  assert.ok(!args.includes("zerolatency"), args);
  assert.ok(args.includes("h264_qsv"));
  assert.ok(args.includes("2048k"));
});

test("software encoding keeps the low-latency tuning it was measured with", () => {
  const args = encoderOutputArgs("libx264", { bitrateKbps: 2048, fps: 25 }).join(" ");
  assert.ok(args.includes("zerolatency"));
  assert.ok(args.includes("yuv420p"));
});

test("every encoder gets a bounded keyframe interval", () => {
  // Without it a joining viewer waits for the next keyframe, which on a long
  // GOP is the "black tile for ten seconds" complaint.
  for (const encoder of ["h264_qsv", "h264_nvenc", "h264_amf", "libx264"]) {
    const args = encoderOutputArgs(encoder, { bitrateKbps: 2048, fps: 25 });
    const gop = Number(args[args.indexOf("-g") + 1]);
    assert.ok(gop >= 2 && gop <= 100, `${encoder} gop ${gop}`);
  }
});

/* ------------------------------------------------------------------ *
 * Hardware decode pairing
 * ------------------------------------------------------------------ */

test("hardware decode is only requested for codecs the hardware decodes", () => {
  assert.deepEqual(decoderInputArgs("h264_qsv", { sourceCodec: "hevc" }),
    ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv", "-c:v", "hevc_qsv"]);
  // An unknown codec must fall back to software decode rather than failing the
  // whole stream. Safe, because decode was never the expensive half.
  assert.deepEqual(decoderInputArgs("h264_qsv", { sourceCodec: "mjpeg" }), []);
  assert.deepEqual(decoderInputArgs("libx264", { sourceCodec: "hevc" }), []);
});

test("the QSV path keeps frames on the GPU", () => {
  // Without -hwaccel_output_format every frame round-trips through system RAM,
  // and the measured cost lands near the software path instead of 14x below it.
  const args = decoderInputArgs("h264_qsv", { sourceCodec: "hevc" }).join(" ");
  assert.ok(args.includes("-hwaccel_output_format qsv"), args);
});

/* ------------------------------------------------------------------ *
 * The assembled command
 * ------------------------------------------------------------------ */

test("the transcode command carries no credential and no device address", () => {
  const args = buildTranscodeArgs({
    inputUrl: "rtsp://127.0.0.1:8554/sabc123_raw",
    outputUrl: "rtsp://127.0.0.1:8554/sabc123",
    encoder: "h264_qsv",
    sourceCodec: "hevc",
    bitrateKbps: 2048,
    fps: 25,
  }).join(" ");

  assert.ok(!args.includes("@"), "no userinfo segment may appear in argv");
  assert.ok(!args.includes("192.168."), "the recorder address must not appear");
  assert.ok(args.includes("127.0.0.1"), "both hops are loopback");
});

test("frame duplication stays disabled", () => {
  // The first live run produced 1000+ duplicated frames and reported 100 fps
  // from a 7 fps camera, inflating CPU roughly eightfold to invent frames.
  const args = buildTranscodeArgs({
    inputUrl: "rtsp://127.0.0.1:8554/a_raw",
    outputUrl: "rtsp://127.0.0.1:8554/a",
    encoder: "libx264",
  });
  assert.equal(args[args.indexOf("-fps_mode") + 1], "passthrough");
});

test("no resolution or frame-rate rewriting is smuggled into the command", () => {
  // Upscaling CIF multiplies encode cost to invent detail the source lacks.
  const args = buildTranscodeArgs({
    inputUrl: "rtsp://127.0.0.1:8554/a_raw",
    outputUrl: "rtsp://127.0.0.1:8554/a",
    encoder: "h264_qsv",
    sourceCodec: "hevc",
  }).join(" ");
  for (const flag of ["-vf", "scale=", "-s ", "-r "]) {
    assert.ok(!args.includes(flag), `command must not contain ${flag}`);
  }
});

/* ------------------------------------------------------------------ *
 * The flags that make hardware output playable
 * ------------------------------------------------------------------ */

test("no hardware encoder emits B-frames", () => {
  // THE REGRESSION THIS EXISTS FOR: with B-frames the QSV path produced a
  // stream that connected and decoded nothing — WebRTC `connected`, 3 packets,
  // 0 frames, 25 PLIs. B-frames make DTS lag PTS, the DTS went backwards 219
  // times in 20 seconds, and the browser discarded the lot.
  //
  // Someone will eventually be tempted to re-enable them for the bitrate
  // saving. On a live camera wall that trade is not available.
  for (const encoder of ["h264_qsv", "h264_nvenc", "h264_amf"]) {
    const args = encoderOutputArgs(encoder, { bitrateKbps: 2048, fps: 25 });
    assert.equal(args[args.indexOf("-bf") + 1], "0", `${encoder} must disable B-frames`);
  }
});

test("every hardware encoder repeats parameter sets on keyframes", () => {
  // A viewer joining mid-stream needs SPS/PPS. libx264 -tune zerolatency sends
  // them by default; no hardware encoder does.
  for (const encoder of ["h264_qsv", "h264_nvenc", "h264_amf"]) {
    const args = encoderOutputArgs(encoder, { bitrateKbps: 2048, fps: 25 }).join(" ");
    assert.ok(args.includes("dump_extra=freq=keyframe"), `${encoder} must repeat SPS/PPS`);
  }
});

test("hardware encoders target Main profile for decoder compatibility", () => {
  for (const encoder of ["h264_qsv", "h264_nvenc", "h264_amf"]) {
    const args = encoderOutputArgs(encoder, { bitrateKbps: 2048, fps: 25 }).join(" ");
    assert.ok(args.includes("-profile:v main"), `${encoder} should not default to High`);
  }
});

test("the QSV path stops the encoder queueing frames ahead", () => {
  const args = encoderOutputArgs("h264_qsv", { bitrateKbps: 2048, fps: 25 }).join(" ");
  assert.ok(args.includes("-async_depth 1"), args);
  assert.ok(args.includes("-forced_idr 1"), args);
});
