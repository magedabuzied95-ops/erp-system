// Which encoder the media gateway may use, and how many cameras that allows.
//
// WHY THIS FILE EXISTS
// --------------------
// Measured on the shop laptop (i7-7500U, 2 physical cores, HD Graphics 620),
// transcoding one 960x1080 25fps H.265 channel to H.264:
//
//   libx264 veryfast CRF18          0.702 cores per camera
//   d3d11va decode + libx264        0.706 cores per camera   (no gain)
//   hevc_qsv decode + h264_qsv      0.050 cores per camera   (14x cheaper)
//
// The d3d11va row is the informative one: offloading DECODE changed nothing,
// because decode was never the cost. Encode is. Any plan that keeps a software
// encoder is a plan for two cameras, not sixteen.
//
// WHAT THIS MEANS FOR CAPACITY
// ----------------------------
// Against a 1.4-core budget (70% of two cores, leaving the ERP backend room):
//
//   libx264   -> 2 cameras
//   QSV       -> 16 cameras, with the iGPU's own fixed-function block as the
//                real limit rather than the CPU
//
// HOW THE ENCODER IS CHOSEN — AND WHY NOT SILENTLY
// ------------------------------------------------
// Presence in `ffmpeg -encoders` proves nothing: the build lists h264_qsv on
// every machine, including ones with no Intel GPU and ones whose driver refuses
// to initialise it. So capability is a RUNTIME PROBE — encode a handful of
// frames and see whether it works — cached for the process lifetime.
//
// When hardware is unavailable the gateway does NOT quietly switch to libx264
// and carry on. It switches AND reports a reduced camera ceiling, because a
// silent fallback here does not fail loudly: it succeeds for the first two
// tiles and then starves the whole machine, including the ERP that pays the
// bills. Degrading capacity visibly is the entire point. This mirrors the rule
// that production never silently falls back to the mock transport.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { surveillanceLog } from "../surveillanceRedaction.js";

const execFileAsync = promisify(execFile);

/**
 * Measured cost in CPU cores per 960x1080 25fps camera.
 *
 * These are observations, not estimates. Re-measure with
 * scripts/surveillance-probe/benchmarkEncoders.mjs when the host changes —
 * a different CPU or GPU generation moves both numbers.
 */
export const ENCODER_COST_CORES = Object.freeze({
  h264_qsv: 0.05,
  h264_nvenc: 0.04,
  h264_amf: 0.06,
  libx264: 0.702,
});

/**
 * Fraction of the host's cores the media plane may consume.
 *
 * Not 100%: this laptop also runs the ERP backend, PostgreSQL and the shop's
 * own work. A media plane that wins every scheduling contest is a media plane
 * that takes the point-of-sale down at the till.
 */
const CPU_BUDGET_FRACTION = 0.7;

/** Hardware encoders in preference order. First one that actually works wins. */
const HARDWARE_CANDIDATES = ["h264_qsv", "h264_nvenc", "h264_amf"];

/**
 * Aggregate throughput of the hardware encode block, in multiples of realtime.
 *
 * MEASURED, and it is the constraint that actually binds. Running 1 / 4 / 9 / 16
 * concurrent 960x1080 25fps transcodes on HD Graphics 620:
 *
 *   1 stream   11.9x realtime   0.00 cores
 *   4 streams  18.5x realtime   0.23 cores
 *   9 streams  18.7x realtime   0.12 cores
 *  16 streams  19.0x realtime   0.00 cores
 *
 * Aggregate throughput flattens at ~19x from four streams on. That is the
 * signature of ONE fixed-function block being shared: adding streams divides
 * the same throughput rather than adding more of it.
 *
 * So the CPU-budget calculation ("0.049 cores each, therefore 28 cameras") is
 * arithmetic that describes nothing. 16 cameras need 16x of a ~19x ceiling —
 * they fit, with 19% headroom, and the seventeenth does not.
 */
const HARDWARE_REALTIME_CEILING = 19;

/**
 * Headroom kept below the measured ceiling.
 *
 * At exactly 1.0 the encoders are keeping up on average, which is not the same
 * as keeping up continuously: a keyframe burst or a moment of contention puts
 * every tile behind at once, and they recover together, so the whole wall
 * stutters in unison. 0.85 buys back the margin.
 */
const HARDWARE_SAFETY_FACTOR = 0.85;

let probeCache = null;

const ffmpegBinary = () => String(process.env.SURVEILLANCE_FFMPEG_PATH || "ffmpeg");

/**
 * Does this encoder actually initialise on this machine?
 *
 * Encodes 10 frames of colour bars to null. Cheap, and it exercises the exact
 * failure that matters: driver present, device openable, session allocatable.
 */
const encoderWorks = async (encoder) => {
  try {
    await execFileAsync(
      ffmpegBinary(),
      [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=0.4",
        "-c:v", encoder, "-b:v", "1000k",
        "-f", "null", "-",
      ],
      { timeout: 20000, windowsHide: true },
    );
    return true;
  } catch {
    // Any failure — missing binary, missing driver, refused session — means
    // unavailable. The reason is not actionable at this layer and the stderr
    // can contain host paths, so it is not propagated.
    return false;
  }
};

/**
 * Detect once, reuse for the process lifetime.
 *
 * Cached because probing costs ~1s and the answer cannot change without the
 * host rebooting. `refresh` exists for tests and for an admin-triggered
 * re-detect after a driver install.
 */
export const detectEncoderCapability = async ({ refresh = false } = {}) => {
  if (probeCache && !refresh) return probeCache;

  const forced = String(process.env.SURVEILLANCE_MEDIA_ENCODER || "").trim();
  if (forced) {
    // An operator override still gets probed. Forcing an encoder that does not
    // work would fail per-stream at runtime, which is far harder to diagnose
    // than one honest line at startup.
    const works = await encoderWorks(forced);
    probeCache = {
      encoder: works ? forced : "libx264",
      hardware: works && forced !== "libx264",
      forced: true,
      forcedEncoderWorks: works,
      candidates: [forced],
    };
  } else {
    let chosen = null;
    const tried = [];
    for (const candidate of HARDWARE_CANDIDATES) {
      tried.push(candidate);
      if (await encoderWorks(candidate)) { chosen = candidate; break; }
    }
    probeCache = {
      encoder: chosen || "libx264",
      hardware: Boolean(chosen),
      forced: false,
      candidates: tried,
    };
  }

  surveillanceLog("media_encoder_selected", {
    encoder: probeCache.encoder,
    hardware: probeCache.hardware,
    forced: probeCache.forced,
  });
  return probeCache;
};

/**
 * How many simultaneous transcodes this host can carry.
 *
 * Returned to the UI so the Live View grid can refuse to open a 16-tile layout
 * it cannot serve, rather than opening it and delivering sixteen stuttering
 * tiles plus an unusable ERP.
 */
export const capacityFor = (encoder, { cores = 0 } = {}) => {
  const hostCores = Number(cores) > 0 ? Number(cores) : 2;
  const perCamera = ENCODER_COST_CORES[encoder] ?? ENCODER_COST_CORES.libx264;
  const budget = hostCores * CPU_BUDGET_FRACTION;
  const cpuLimit = Math.floor(budget / perCamera);

  // On hardware, the encode block saturates long before the CPU budget does.
  // Taking the LOWER of the two is the whole point: reporting the CPU number
  // alone would promise 28 cameras from a GPU that can serve 16.
  const hardware = encoder !== "libx264";
  const gpuLimit = hardware
    ? Math.floor(HARDWARE_REALTIME_CEILING * HARDWARE_SAFETY_FACTOR)
    : Number.POSITIVE_INFINITY;

  const limit = Math.max(1, Math.min(cpuLimit, gpuLimit));
  return {
    encoder,
    cores_per_camera: perCamera,
    cpu_budget_cores: Number(budget.toFixed(2)),
    max_concurrent_transcodes: limit,
    // Which ceiling actually bound, so an operator asking "why only N?" gets an
    // answer instead of a number.
    limited_by: hardware && gpuLimit <= cpuLimit ? "encoder-throughput" : "cpu",
  };
};

/**
 * The four flags that make hardware output PLAYABLE, not merely cheap.
 *
 * Proven against the live recorder. Without them the QSV path produced a
 * stream that connected perfectly and decoded NOTHING: WebRTC reported
 * `connected`, 3 packets received, 0 frames decoded, and 25 PLIs — the browser
 * asking over and over for a keyframe it could never use. The pipeline looked
 * healthy from every server-side angle while showing a black tile.
 *
 *   -bf 0            No B-frames. This was the actual cause. B-frames make DTS
 *                    lag PTS, the encoder emitted DTS values that went
 *                    backwards, and ffmpeg "repaired" each one by adding a
 *                    single tick — 219 times in 20 seconds. The resulting RTP
 *                    timestamps were incoherent and the browser discarded
 *                    everything. With -bf 0, DTS == PTS and cannot regress:
 *                    warnings fell from 219 to 1, and that one is two frames
 *                    sharing a timestamp rather than a backwards jump.
 *                    B-frames are wrong for live surveillance anyway — they buy
 *                    compression by adding latency to a picture whose entire
 *                    value is being current.
 *   -async_depth 1   Stop the encoder queueing frames ahead, which is what
 *                    reorders them. Also cuts latency.
 *   -forced_idr 1    Make -g emit real IDRs. Plain I-frames are not enough for
 *                    a viewer joining mid-stream to start decoding.
 *   dump_extra       Repeat SPS/PPS on every keyframe. libx264 with
 *                    `-tune zerolatency` does this by default and QSV does not,
 *                    so a late joiner never receives the parameter sets.
 *
 * After: 193 frames decoded, 5 keyframes, zero packet loss, zero PLI.
 */
const QSV_LIVE_ARGS = Object.freeze([
  "-bf", "0",
  "-async_depth", "1",
  "-forced_idr", "1",
  // low_power off: the fixed-function VDEnc path on this generation ignores
  // several rate-control settings above.
  "-low_power", "0",
  "-bsf:v", "dump_extra=freq=keyframe",
]);

/**
 * Encoder-specific output arguments.
 *
 * The rate-control flags differ per encoder and getting them wrong is not
 * cosmetic: QSV ignores -crf and -preset veryfast means something different to
 * it than to x264, so a copied-and-pasted x264 argument list produces either an
 * error or a stream at the wrong bitrate.
 */
export const encoderOutputArgs = (encoder, { bitrateKbps = 2048, fps = 25 }) => {
  const gop = String(Math.max(2, Math.round(fps * 2)));
  const maxrate = `${Math.round(bitrateKbps * 1.35)}k`;
  const bufsize = `${bitrateKbps * 2}k`;

  switch (encoder) {
    case "h264_qsv":
      return [
        "-c:v", "h264_qsv",
        // `veryfast` on QSV maps to TargetUsage 7 — the fixed-function block's
        // speed/quality dial, unrelated to the x264 preset of the same name.
        "-preset", "veryfast",
        // Main, not High. Widest hardware-decoder compatibility on the tablets
        // and phones an operator actually watches a camera wall on.
        "-profile:v", "main",
        "-b:v", `${bitrateKbps}k`, "-maxrate", maxrate, "-bufsize", bufsize,
        "-g", gop,
        ...QSV_LIVE_ARGS,
      ];
    // NVENC and AMF are UNVERIFIED here — neither vendor's hardware was
    // present on the reference host. They carry the same -bf 0 / repeated
    // parameter sets that the QSV path needed, because the defect is a
    // property of hardware encoders generally rather than of Intel's: all of
    // them default to B-frames, and B-frames are what broke playback.
    // Treat these as untested until a machine with the hardware confirms them.
    case "h264_nvenc":
      return [
        "-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll",
        "-profile:v", "main",
        "-b:v", `${bitrateKbps}k`, "-maxrate", maxrate, "-bufsize", bufsize,
        "-g", gop, "-bf", "0", "-forced-idr", "1",
        "-bsf:v", "dump_extra=freq=keyframe",
      ];
    case "h264_amf":
      return [
        "-c:v", "h264_amf", "-quality", "speed", "-usage", "lowlatency",
        "-profile:v", "main",
        "-b:v", `${bitrateKbps}k`, "-maxrate", maxrate, "-bufsize", bufsize,
        "-g", gop, "-bf", "0",
        "-bsf:v", "dump_extra=freq=keyframe",
      ];
    default:
      return [
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-b:v", `${bitrateKbps}k`, "-maxrate", maxrate, "-bufsize", bufsize,
        "-g", gop, "-pix_fmt", "yuv420p",
      ];
  }
};

/**
 * Input-side arguments that keep frames on the GPU.
 *
 * This is where the 14x actually comes from. Without `-hwaccel_output_format`
 * every decoded frame is copied GPU -> system RAM -> GPU, and the measured cost
 * lands much closer to the software path than to the hardware one.
 *
 * Only applied when the SOURCE codec is one the hardware can decode. Feeding a
 * QSV decoder something it does not support fails the whole stream, so an
 * unknown codec falls back to software decode — which is safe, because decode
 * was never the expensive half.
 */
export const decoderInputArgs = (encoder, { sourceCodec = "" } = {}) => {
  const codec = String(sourceCodec).toLowerCase();
  if (encoder === "h264_qsv" && (codec === "hevc" || codec === "h265")) {
    return ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv", "-c:v", "hevc_qsv"];
  }
  if (encoder === "h264_qsv" && codec === "h264") {
    return ["-hwaccel", "qsv", "-hwaccel_output_format", "qsv", "-c:v", "h264_qsv"];
  }
  if (encoder === "h264_nvenc" && (codec === "hevc" || codec === "h265")) {
    return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-c:v", "hevc_cuvid"];
  }
  return [];
};

/** Test-only. */
export const __resetEncoderProbe = () => { probeCache = null; };
