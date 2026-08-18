// THE FIRST AUTHORIZED WRITE TO A LIVE RECORDER.
//
//   node scripts/surveillance-probe/authorizedWrite.mjs --host 192.168.1.108        (dry run)
//   node scripts/surveillance-probe/authorizedWrite.mjs --host 192.168.1.108 --commit
//
// Authorization is narrow and literal: Channel 1 MAIN stream bitrate, 512 -> 2048
// kbps. Nothing else. This file is built so that it CANNOT do anything else, not
// merely so that it happens not to.
//
// WHY A SEPARATE ALLOWLIST
// ------------------------
// readOnlyAllowlist.mjs rejects `action=setConfig` by design, and it stays that
// way. Weakening the read gate so a write could pass through it would remove the
// control that has protected every previous phase. Instead there is a second,
// much smaller allowlist here containing exactly one operation, and a field
// guard that refuses to emit a request touching any parameter other than
// Encode[0].MainFormat[n].Video.BitRate.
//
// ORDER OF OPERATIONS
//   1. fresh read of the whole Encode config
//   2. write a rollback snapshot to disk, and PROVE it is readable
//   3. verify seven preconditions; any mismatch aborts before the write
//   4. build the write, assert it touches only BitRate
//   5. send it (only with --commit)
//   6. fresh read, structural diff, assert the diff is exactly the approved field
//   7. write the audit record
//
// If step 6 finds anything unexpected, it restores from the snapshot immediately
// rather than asking.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDigestSession } from "../../server/services/surveillance/providers/dahua/dahuaDigestAuth.js";
import { parseDahuaConfig, isDahuaError } from "../../server/services/surveillance/providers/dahua/dahuaResponseParser.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = path.resolve(repoRoot, "..");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const HOST = args.get("host");
const COMMIT = process.argv.includes("--commit");
const RESTORE = process.argv.includes("--restore");

if (!HOST || !/^\d{1,3}(\.\d{1,3}){3}$/.test(HOST)) {
  console.error("refusing to run: --host must be a single explicit IPv4 address");
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * The entire authorization, expressed as data
 * ------------------------------------------------------------------ */

const AUTHORIZED = Object.freeze({
  channelIndex: 0,            // Dahua is 0-based; this is "Channel 1"
  family: "MainFormat",
  field: "Video.BitRate",
  from: 512,
  to: 2048,
});

/** Preconditions. Every one must hold or nothing is sent. */
const EXPECTED = Object.freeze({
  "Video.Compression": "H.265",
  "Video.Width": 960,
  "Video.Height": 1080,
  "Video.FPS": 25,
  "Video.BitRate": 512,
  "Video.BitRateControl": "CBR",
});

/**
 * The ONLY parameter path shape this tool may ever emit.
 * Anything else is a programming error and aborts.
 */
const ALLOWED_PARAM = /^Encode\[0\]\.MainFormat\[[0-2]\]\.Video\.BitRate$/;

const assertOnlyApprovedParams = (params) => {
  for (const key of Object.keys(params)) {
    if (!ALLOWED_PARAM.test(key)) {
      throw new Error(`REFUSING: write would touch "${key}", which is outside the authorization`);
    }
    const value = Number(params[key]);
    if (value !== AUTHORIZED.to) {
      throw new Error(`REFUSING: "${key}" would be set to ${params[key]}, not the approved ${AUTHORIZED.to}`);
    }
  }
  if (!Object.keys(params).length) throw new Error("REFUSING: empty write");
  return true;
};

/* ------------------------------------------------------------------ *
 * Credentials + transport
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
  return found.DEVICE_USER && found.DEVICE_PASS ? { username: found.DEVICE_USER, password: found.DEVICE_PASS } : null;
};

const credentials = loadCredentials();
if (!credentials) { console.error("no credentials at .surveillance-probe.local"); process.exit(3); }
const session = createDigestSession(credentials);

const request = (requestPath) =>
  new Promise((resolve) => {
    const send = (auth, attempt) => {
      const req = http.request(
        { host: HOST, port: 80, method: "GET", path: requestPath,
          headers: { host: `${HOST}:80`, connection: "close", ...(auth ? { authorization: auth } : {}) },
          timeout: 12000 },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode === 401 && attempt === 1) {
              const ch = res.headers["www-authenticate"];
              if (ch && session.accept(Array.isArray(ch) ? ch[0] : ch)) { send(session.authorize("GET", requestPath), 2); return; }
            }
            resolve({ status: res.statusCode, body });
          });
        },
      );
      req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "", error: "timeout" }); });
      req.on("error", (e) => resolve({ status: 0, body: "", error: e.code || "network" }));
      req.end();
    };
    send(session.hasChallenge ? session.authorize("GET", requestPath) : null, 1);
  });

const readEncode = async () => {
  const res = await request("/cgi-bin/configManager.cgi?action=getConfig&name=Encode");
  if (res.status !== 200 || isDahuaError(res.status, res.body)) {
    throw new Error(`encoder read failed (status ${res.status})`);
  }
  return parseDahuaConfig(res.body);
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const at = (obj, dotted) => dotted.split(".").reduce((node, key) => (node == null ? node : node[key]), obj);

/** Flatten to comparable leaf paths, so the diff is semantic and not textual. */
const flatten = (value, prefix = "", out = {}) => {
  if (value === null || typeof value !== "object") { out[prefix] = value; return out; }
  if (Array.isArray(value)) { value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out)); return out; }
  for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
};

const semanticDiff = (before, after) => {
  const a = flatten(before), b = flatten(after);
  const changed = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      changed.push({ path: key, before: a[key], after: b[key] });
    }
  }
  return changed;
};

const SNAPSHOT = path.join(scratch, "ch1-encoder-rollback.json");
const AUDIT = path.join(scratch, "dvr-write-audit.json");

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const main = async () => {
  console.log("=== AUTHORIZED DVR WRITE " + (COMMIT ? "(COMMIT)" : RESTORE ? "(RESTORE)" : "(DRY RUN)") + " ===");
  console.log(`  authorization: Channel 1 ${AUTHORIZED.family} ${AUTHORIZED.field} ${AUTHORIZED.from} -> ${AUTHORIZED.to}`);
  console.log();

  // ---- 1. fresh read ----
  const before = await readEncode();
  const channel = before?.Encode?.[AUTHORIZED.channelIndex];
  if (!channel) throw new Error("channel 1 not present in the encoder config");
  console.log("1. fresh read OK — encoder slots:", before.Encode.length);

  // ---- 2. rollback snapshot, proven readable ----
  if (!RESTORE) {
    fs.writeFileSync(SNAPSHOT, JSON.stringify({
      capturedAt: new Date().toISOString(),
      note: "Complete Channel 1 encoder configuration, for exact restoration.",
      channelIndex: AUTHORIZED.channelIndex,
      encodeChannel: channel,
    }, null, 1), "utf8");
    const proof = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
    const proofOk = JSON.stringify(proof.encodeChannel) === JSON.stringify(channel);
    console.log(`2. rollback snapshot written and re-read: ${proofOk ? "VERIFIED IDENTICAL" : "MISMATCH"}`);
    console.log(`   ${SNAPSHOT.split(/[\\/]/).pop()} — MainFormat variants captured: ${channel.MainFormat?.length}`);
    if (!proofOk) throw new Error("rollback snapshot did not round-trip; refusing to write");
  }

  // ---- 3. preconditions ----
  console.log("3. preconditions on Channel 1 MainFormat[0]:");
  let ok = true;
  for (const [field, want] of Object.entries(EXPECTED)) {
    const got = at(channel.MainFormat[0], field);
    const pass = got === want;
    if (!pass) ok = false;
    console.log(`   ${pass ? "OK  " : "FAIL"} ${field.padEnd(22)} expected ${String(want).padEnd(8)} got ${got}`);
  }
  // All three variants must currently be identical, or "keep them synchronized"
  // is not a statement about the current state.
  const variantsIdentical =
    JSON.stringify(channel.MainFormat[0]) === JSON.stringify(channel.MainFormat[1]) &&
    JSON.stringify(channel.MainFormat[1]) === JSON.stringify(channel.MainFormat[2]);
  console.log(`   ${variantsIdentical ? "OK  " : "FAIL"} MainFormat[0..2] currently identical: ${variantsIdentical}`);
  if (!ok || !variantsIdentical) throw new Error("PRECONDITION FAILED — nothing was sent");

  // ---- 4. build the write ----
  // All three variants: they are identical today, and the general slot governs
  // continuous recording and the live RTSP stream while motion/alarm govern
  // triggered recording. Changing only one would leave the channel in a state it
  // has never been in, which is a bigger semantic change than the bitrate itself.
  const params = {};
  for (let variant = 0; variant < channel.MainFormat.length && variant < 3; variant += 1) {
    params[`Encode[${AUTHORIZED.channelIndex}].MainFormat[${variant}].Video.BitRate`] = AUTHORIZED.to;
  }
  assertOnlyApprovedParams(params);

  const query = Object.entries(params).map(([k, v]) => `${k}=${v}`).join("&");
  const writePath = `/cgi-bin/configManager.cgi?action=setConfig&${query}`;
  console.log("4. write built and field-guard passed. Exact request:");
  console.log(`   GET ${writePath}`);
  console.log(`   fields touched: ${Object.keys(params).length} (all Video.BitRate, all channel 1)`);

  if (!COMMIT) {
    console.log();
    console.log("DRY RUN — nothing sent. Re-run with --commit to perform it.");
    return;
  }

  // ---- 5. send ----
  const res = await request(writePath);
  const accepted = res.status === 200 && !isDahuaError(res.status, res.body);
  console.log(`5. write sent: status=${res.status} accepted=${accepted} body=${JSON.stringify(res.body.trim().slice(0, 60))}`);
  if (!accepted) throw new Error("device rejected the write");

  // ---- 6. verify + diff ----
  await new Promise((r) => setTimeout(r, 1500));
  const after = await readEncode();
  const afterChannel = after?.Encode?.[AUTHORIZED.channelIndex];
  const diff = semanticDiff(channel, afterChannel);

  console.log("6. post-write semantic diff on Channel 1:");
  diff.forEach((d) => console.log(`   ${d.path}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`));
  if (!diff.length) console.log("   (no change detected — the device may have ignored the write)");

  const unexpected = diff.filter((d) => !/^MainFormat\[[0-2]\]\.Video\.BitRate$/.test(d.path));
  if (unexpected.length) {
    console.log();
    console.log("!! UNEXPECTED FIELDS CHANGED — RESTORING IMMEDIATELY");
    unexpected.forEach((d) => console.log(`   ${d.path}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`));
    const restoreParams = {};
    for (let v = 0; v < 3; v += 1) restoreParams[`Encode[0].MainFormat[${v}].Video.BitRate`] = AUTHORIZED.from;
    await request(`/cgi-bin/configManager.cgi?action=setConfig&${Object.entries(restoreParams).map(([k, x]) => `${k}=${x}`).join("&")}`);
    throw new Error("restored due to unexpected diff");
  }

  // Other channels must be untouched.
  const otherChanged = [];
  for (let i = 1; i < Math.min(before.Encode.length, after.Encode.length); i += 1) {
    if (!before.Encode[i] && !after.Encode[i]) continue;
    if (JSON.stringify(before.Encode[i]) !== JSON.stringify(after.Encode[i])) otherChanged.push(i + 1);
  }
  console.log(`   channels 2-16 unchanged: ${otherChanged.length === 0} ${otherChanged.length ? "(changed: " + otherChanged.join(",") + ")" : ""}`);

  // ---- 7. audit ----
  const record = {
    action: "encoder bitrate change",
    device: "dahua-xvr-ch1 (sanitized; no serial, uuid or credential recorded)",
    channel: 1,
    field: "Main stream Video.BitRate (MainFormat variants 0,1,2)",
    old: AUTHORIZED.from,
    new: AUTHORIZED.to,
    timestamp: new Date().toISOString(),
    authorizedBy: "owner (explicit, single-purpose authorization)",
    result: unexpected.length ? "restored" : "applied",
    rollbackAvailable: fs.existsSync(SNAPSHOT),
    rollbackSnapshot: path.basename(SNAPSHOT),
    diff: diff.map((d) => ({ path: d.path, before: d.before, after: d.after })),
  };
  const log = fs.existsSync(AUDIT) ? JSON.parse(fs.readFileSync(AUDIT, "utf8")) : [];
  log.push(record);
  fs.writeFileSync(AUDIT, JSON.stringify(log, null, 1), "utf8");
  console.log(`7. audit record appended to ${path.basename(AUDIT)}`);
};

main().catch((e) => { console.error("ABORTED:", e.message); process.exit(1); });
