// ONE read-only request: encode.cgi?action=getConfigCaps
//
// Answers the only question left before the quality decision: what resolutions,
// frame rates, bitrates and codecs does this recorder actually permit on the
// Main and Extra streams — and specifically, can the Extra stream be raised
// above CIF without touching the Main stream that feeds recording.
//
// No setter. No write. No stream. One GET, gated by the same read-only check as
// every other probe operation.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertReadOnly } from "./readOnlyAllowlist.mjs";
import { createDigestSession } from "../../server/services/surveillance/providers/dahua/dahuaDigestAuth.js";
import { parseDahuaConfig, isDahuaError } from "../../server/services/surveillance/providers/dahua/dahuaResponseParser.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const HOST = args.get("host");
if (!HOST || !/^\d{1,3}(\.\d{1,3}){3}$/.test(HOST)) {
  console.error("refusing to run: --host must be a single explicit IPv4 address");
  process.exit(2);
}

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
if (!credentials) { console.error("no credentials"); process.exit(3); }

const session = createDigestSession(credentials);

const OPERATION = { id: "encodeConfigCaps", protocol: "http", method: "GET", path: "/cgi-bin/encode.cgi?action=getConfigCaps" };
assertReadOnly(OPERATION);

const get = (requestPath) =>
  new Promise((resolve) => {
    const send = (auth, attempt) => {
      const req = http.request(
        { host: HOST, port: 80, method: "GET", path: requestPath,
          headers: { host: `${HOST}:80`, connection: "close", ...(auth ? { authorization: auth } : {}) },
          timeout: 10000 },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            if (res.statusCode === 401 && attempt === 1) {
              const ch = res.headers["www-authenticate"];
              if (ch && session.accept(Array.isArray(ch) ? ch[0] : ch)) {
                send(session.authorize("GET", requestPath), 2);
                return;
              }
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

const main = async () => {
  const res = await get(OPERATION.path);
  console.log(`status=${res.status} bytes=${res.body.length} deviceError=${isDahuaError(res.status, res.body)}`);
  if (res.status !== 200 || isDahuaError(res.status, res.body)) {
    console.log("RAW (first 400 chars):");
    console.log(res.body.slice(0, 400));
    return;
  }
  const parsed = parseDahuaConfig(res.body);
  fs.writeFileSync(path.join(repoRoot, "..", "configcaps.json"), JSON.stringify(parsed, null, 1), "utf8");
  console.log("parsed and written to scratchpad/configcaps.json");
  console.log("top-level keys:", Object.keys(parsed).join(", "));
};

main().catch((e) => { console.error("aborted:", e?.code || "unknown"); process.exit(1); });
