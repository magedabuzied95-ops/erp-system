// First real live camera — local proof of concept.
//
// RUNS ON THE SHOP LAPTOP ONLY. The VPS cannot reach the recorder.
//
//   node scripts/surveillance-probe/mediaPoc.mjs --host 192.168.1.108 --channel 1
//
// WHY TWO HOPS INSTEAD OF ONE
// ---------------------------
// The obvious pipeline is FFmpeg pulling the DVR directly:
//
//   ffmpeg -i rtsp://user:pass@192.168.1.108/... -c:v libx264 ...
//
// That puts the DVR password in a process command line, where Task Manager,
// `wmic process`, any local user and any crash dump can read it. On Windows
// there is no way to hide argv from the same user.
//
// So MediaMTX pulls from the recorder instead — its source URL lives in a config
// file, not on a command line — and FFmpeg reads the already-authenticated
// stream back from loopback:
//
//   XVR --(RTSP, credentials in mediamtx.yml)--> MediaMTX path "dvr_raw"
//       --(RTSP, no credentials)--> FFmpeg  H.265 -> H.264
//       --(RTSP, no credentials)--> MediaMTX path "live"
//       --(WHEP/WebRTC)--> browser
//
// The extra loopback hop costs a few milliseconds and buys: no credential in any
// argv, no credential in FFmpeg's logs, and no credential in anything committed.
//
// MediaMTX does NOT transcode. It is the session, distribution and auth layer;
// FFmpeg is the codec bridge. Saying otherwise would be designing against a
// feature that does not exist.
//
// EVERYTHING BINDS TO LOOPBACK.
// No LAN interface, no public interface, no firewall rule, no port forward.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const scratch = path.resolve(repoRoot, "..");
const pocDir = path.join(scratch, "media-poc");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);

const HOST = args.get("host");
const CHANNEL = Number(args.get("channel") || 1);
// Sub stream. 352x288 at 7fps and 80 kbps on this recorder — the cheapest real
// source, and the one the grid will eventually use.
const SUBTYPE = Number(args.get("subtype") ?? 1);
const DURATION_S = Number(args.get("seconds") || 60);

if (!HOST || !/^\d{1,3}(\.\d{1,3}){3}$/.test(HOST)) {
  console.error("refusing to run: --host must be a single explicit IPv4 address");
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * Credentials — read here, written only into a gitignored config
 * ------------------------------------------------------------------ */

const loadCredentials = () => {
  const file = path.join(repoRoot, ".surveillance-probe.local");
  if (!fs.existsSync(file)) return null;
  const found = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) found[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return found.DEVICE_USER && found.DEVICE_PASS
    ? { username: found.DEVICE_USER, password: found.DEVICE_PASS }
    : null;
};

const credentials = loadCredentials();
if (!credentials) {
  console.error("no credentials: create .surveillance-probe.local with DEVICE_USER and DEVICE_PASS");
  process.exit(3);
}

/** Anything printed goes through this. Belt and braces on top of not printing. */
const scrub = (text) =>
  String(text)
    .split(credentials.password).join("[redacted]")
    .replace(/\b([a-z][a-z0-9+.-]{1,15}:\/\/)([^/\s:@]+(?::[^/\s@]*)?)@/gi, (_m, s) => `${s}[redacted]@`);

/* ------------------------------------------------------------------ *
 * Binaries
 * ------------------------------------------------------------------ */

const findBinary = (name) => {
  const stack = [pocDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === name) return full;
    }
  }
  return null;
};

const FFMPEG = findBinary("ffmpeg.exe") || findBinary("ffmpeg");
const FFPROBE = findBinary("ffprobe.exe") || findBinary("ffprobe");
const MEDIAMTX = findBinary("mediamtx.exe") || findBinary("mediamtx");
if (!FFMPEG || !MEDIAMTX) {
  console.error("ffmpeg or mediamtx not found under", pocDir);
  process.exit(4);
}

/* ------------------------------------------------------------------ *
 * MediaMTX config — the only place the credential is written
 * ------------------------------------------------------------------ */

const RTSP_PORT = 8554;
const WHEP_PORT = 8889;
const API_PORT = 9997;

const encodeUserinfo = (value) => encodeURIComponent(value);

const configPath = path.join(pocDir, "mediamtx.yml");

const writeConfig = () => {
  const source =
    `rtsp://${encodeUserinfo(credentials.username)}:${encodeUserinfo(credentials.password)}` +
    `@${HOST}:554/cam/realmonitor?channel=${CHANNEL}&subtype=${SUBTYPE}`;

  const yml = [
    "# GENERATED, LOCAL ONLY, GITIGNORED. Contains a device credential.",
    "# Delete after the proof of concept.",
    "logLevel: info",
    "",
    "# Loopback only. No LAN interface, no public interface, no firewall rule.",
    `rtspAddress: 127.0.0.1:${RTSP_PORT}`,
    // MediaMTX defaults its RTP/RTCP listeners to UDP 8000/8001. The ERP dev
    // backend already owns 8000, which produced a bind error on the first run.
    "rtpAddress: 127.0.0.1:8100",
    "rtcpAddress: 127.0.0.1:8101",
    "rtsp: yes",
    "rtmp: no",
    "hls: no",
    "srt: no",
    "webrtc: yes",
    `webrtcAddress: 127.0.0.1:${WHEP_PORT}`,
    "webrtcLocalUDPAddress: 127.0.0.1:8189",
    "# The browser and the server are the same machine, so a host candidate on",
    "# loopback is all that is needed. No STUN, no TURN, nothing leaves the box.",
    "webrtcIPsFromInterfaces: no",
    "webrtcAdditionalHosts: [127.0.0.1]",
    "api: yes",
    `apiAddress: 127.0.0.1:${API_PORT}`,
    "",
    "paths:",
    "  # Hop 1: MediaMTX authenticates to the recorder. The credential lives",
    "  # here, in a gitignored file, and NOT in any process command line.",
    "  dvr_raw:",
    `    source: ${source}`,
    "    sourceProtocol: tcp",
    "    # NOT on-demand for the POC. The first run set sourceOnDemand with a",
    "    # 10s close, and the source was torn down ten seconds after the step-1",
    "    # probe let go -- which is what killed FFmpeg mid-stream with a reset.",
    "    # On-demand belongs in the product; it needs its own lifecycle test.",
    "    sourceOnDemand: no",

    "",
    "  # Hop 2: the transcoded H.264 stream FFmpeg publishes back. This is the",
    "  # only path a browser ever touches.",
    "  live:",
    "",
  ].join("\n");

  fs.writeFileSync(configPath, yml, "utf8");
  return configPath;
};

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const measure = async (pid) =>
  new Promise((resolve) => {
    const ps = spawn("powershell.exe", [
      "-NoProfile", "-Command",
      `$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($p){"{0},{1}" -f $p.CPU,[math]::Round($p.WorkingSet64/1MB,1)}`,
    ]);
    let out = "";
    ps.stdout.on("data", (d) => { out += d; });
    ps.on("close", () => {
      const [cpu, rss] = out.trim().split(",");
      resolve({ cpuSeconds: Number(cpu) || 0, rssMb: Number(rss) || 0 });
    });
  });

const main = async () => {
  console.log("=== FIRST LIVE CHANNEL — LOCAL POC ===");
  console.log(`  source   : ${HOST} channel ${CHANNEL} subtype ${SUBTYPE} (sub stream)`);
  console.log(`  ffmpeg   : ${path.basename(FFMPEG)}`);
  console.log(`  mediamtx : ${path.basename(MEDIAMTX)}`);
  console.log(`  binding  : 127.0.0.1 only`);
  console.log();

  writeConfig();
  console.log("wrote mediamtx.yml (gitignored, credential inside)");

  // ---- start MediaMTX ----
  const mtx = spawn(MEDIAMTX, [configPath], { cwd: pocDir });
  const mtxLog = [];
  const capture = (buf) => {
    const text = scrub(buf.toString());
    mtxLog.push(text);
    for (const line of text.split(/\r?\n/)) {
      if (/ERR|WAR|error|failed/i.test(line) && line.trim()) console.log("  [mediamtx]", line.trim());
    }
  };
  const mtxLogPath = path.join(pocDir, "mediamtx.log");
  mtx.stdout.on("data", capture);
  mtx.stderr.on("data", capture);

  await sleep(2500);
  console.log("mediamtx started, pid", mtx.pid);

  // ---- probe the source THROUGH MediaMTX (no credentials in argv) ----
  console.log();
  console.log("--- step 1-2: authenticate + decode (via loopback, no credentials on the command line) ---");
  const probeStart = Date.now();
  const probe = spawn(FFPROBE, [
    "-hide_banner", "-v", "error",
    "-rtsp_transport", "tcp",
    "-show_entries", "stream=codec_name,width,height,avg_frame_rate,bit_rate",
    "-of", "default=noprint_wrappers=1",
    `rtsp://127.0.0.1:${RTSP_PORT}/dvr_raw`,
  ]);
  let probeOut = "";
  probe.stdout.on("data", (d) => { probeOut += d; });
  probe.stderr.on("data", (d) => { probeOut += d; });
  const probeCode = await new Promise((resolve) => probe.on("close", resolve));
  const probeMs = Date.now() - probeStart;

  if (probeCode !== 0) {
    console.log(`  FAILED at layer: XVR -> MediaMTX (exit ${probeCode}, ${probeMs} ms)`);
    console.log(scrub(probeOut).split("\n").map((l) => "    " + l).join("\n"));
    mtx.kill();
    process.exit(1);
  }
  console.log(`  source reached in ${probeMs} ms:`);
  console.log(scrub(probeOut).trim().split("\n").map((l) => "    " + l.trim()).join("\n"));

  // ---- transcode ----
  console.log();
  console.log("--- step 3-4: H.265 -> H.264, published back to MediaMTX ---");
  const ffStart = Date.now();
  const ff = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "warning",
    "-rtsp_transport", "tcp",
    "-i", `rtsp://127.0.0.1:${RTSP_PORT}/dvr_raw`,
    // Resolution and frame rate are NOT touched: no upscaling of CIF, no
    // invented frames. Only the codec changes.
    // Pass source timing through untouched. Without this the RTSP muxer
    // targets a constant frame rate and FFmpeg DUPLICATES frames to fill it --
    // the first run logged over a thousand duplicates and reported 100 fps out
    // of a 7 fps camera, burning CPU to invent frames nobody asked for.
    "-fps_mode", "passthrough",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    // ~2 s keyframe interval at 7 fps, so WebRTC can start quickly.
    "-g", "14",
    "-b:v", "150k", "-maxrate", "200k", "-bufsize", "300k",
    "-pix_fmt", "yuv420p",
    // The encoder reports audio disabled on every channel; nothing to carry.
    "-an",
    "-f", "rtsp", "-rtsp_transport", "tcp",
    `rtsp://127.0.0.1:${RTSP_PORT}/live`,
  ]);

  const ffErrors = [];
  const onFf = (buf) => {
    const text = scrub(buf.toString());
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) { ffErrors.push(line.trim()); console.log("  [ffmpeg]", line.trim()); }
    }
  };
  ff.stdout.on("data", onFf);
  ff.stderr.on("data", onFf);

  await sleep(4000);
  if (ff.exitCode !== null) {
    console.log(`  FAILED at layer: MediaMTX -> FFmpeg (exit ${ff.exitCode})`);
    mtx.kill();
    process.exit(1);
  }
  const startupMs = Date.now() - ffStart;
  console.log(`  transcode running after ${startupMs} ms, pid ${ff.pid}`);

  // ---- confirm the published stream is H.264 ----
  console.log();
  console.log("--- step 5: what a browser would receive ---");
  const out = spawn(FFPROBE, [
    "-hide_banner", "-v", "error",
    "-rtsp_transport", "tcp",
    "-show_entries", "stream=codec_name,width,height,avg_frame_rate",
    "-of", "default=noprint_wrappers=1",
    `rtsp://127.0.0.1:${RTSP_PORT}/live`,
  ]);
  let outText = "";
  out.stdout.on("data", (d) => { outText += d; });
  out.stderr.on("data", (d) => { outText += d; });
  await new Promise((resolve) => out.on("close", resolve));
  console.log(scrub(outText).trim().split("\n").map((l) => "    " + l.trim()).join("\n"));
  console.log(`    WHEP URL: http://127.0.0.1:${WHEP_PORT}/live/whep`);

  // ---- stability + resource measurement ----
  console.log();
  console.log(`--- stability: sampling for ${DURATION_S}s ---`);
  const samples = [];
  const started = Date.now();
  while ((Date.now() - started) / 1000 < DURATION_S) {
    await sleep(10000);
    const [f, m] = await Promise.all([measure(ff.pid), measure(mtx.pid)]);
    const elapsed = Math.round((Date.now() - started) / 1000);
    samples.push({ elapsed, ffmpeg: f, mediamtx: m, alive: ff.exitCode === null });
    console.log(
      `  t+${String(elapsed).padStart(3)}s  ffmpeg ${f.cpuSeconds.toFixed(1)}s cpu / ${f.rssMb} MB` +
      `   mediamtx ${m.cpuSeconds.toFixed(1)}s cpu / ${m.rssMb} MB   alive=${ff.exitCode === null}`,
    );
    if (ff.exitCode !== null) { console.log("  FFMPEG DIED"); break; }
  }

  // CPU seconds -> average percent of one core, over the sampled window.
  const last = samples[samples.length - 1];
  if (last) {
    const secs = last.elapsed;
    console.log();
    console.log("--- averages over the run ---");
    console.log(`  ffmpeg   : ${((last.ffmpeg.cpuSeconds / secs) * 100).toFixed(1)}% of one core, ${last.ffmpeg.rssMb} MB`);
    console.log(`  mediamtx : ${((last.mediamtx.cpuSeconds / secs) * 100).toFixed(1)}% of one core, ${last.mediamtx.rssMb} MB`);
    console.log(`  total RAM: ${(last.ffmpeg.rssMb + last.mediamtx.rssMb).toFixed(1)} MB`);
  }

  const realErrors = ffErrors.filter((l) => /error|failed|invalid|cannot/i.test(l));
  console.log();
  console.log(`  ffmpeg error lines: ${realErrors.length}`);
  realErrors.slice(0, 5).forEach((l) => console.log("    " + l));

  ff.kill();
  mtx.kill();
  await sleep(500);
  fs.writeFileSync(mtxLogPath, mtxLog.join(""), "utf8");
  console.log(`mediamtx log written to ${path.basename(mtxLogPath)} (already scrubbed)`);
  console.log();
  console.log("stopped. mediamtx.yml still on disk — delete it, it holds the credential.");
};

main().catch((error) => {
  console.error("poc aborted:", scrub(error?.message || "unknown"));
  process.exit(1);
});
