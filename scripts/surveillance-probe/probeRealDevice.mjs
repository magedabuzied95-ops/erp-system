// Real-device read-only probe.
//
// RUN THIS ONLY FROM A MACHINE ON THE RECORDER'S LAN.
//
//   node scripts/surveillance-probe/probeRealDevice.mjs --host 192.168.1.108
//
// It performs exactly the operations in readOnlyAllowlist.mjs, against exactly
// the one host named on the command line, and nothing else. No subnet scan, no
// port sweep, no second host.
//
// CREDENTIALS
// -----------
// Read from a gitignored file next to the repository root:
//
//   .surveillance-probe.local        DEVICE_USER=...
//                                    DEVICE_PASS=...
//
// Deliberately NOT from command-line arguments (they land in shell history and
// in `ps` output), NOT from an inline environment assignment (same), and NOT
// from a prompt (this runs non-interactively). The file is read by this script
// and its values are never printed, never written to the report, and never
// included in an error. If the file is absent the probe still runs everything
// that does not need authentication, and says so.
//
// WHAT IT PRINTS
// --------------
// A structured report with these removed unconditionally: password, any
// Authorization header, the digest response and nonce, cookies, the device
// serial number, P2P serial and verification code, and account names. The
// serial is hashed for identity comparison and the original is discarded in the
// same expression that produces the hash.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { PROBE_OPERATIONS, assertAllOperationsReadOnly } from "./readOnlyAllowlist.mjs";
import { createDigestSession } from "../../server/services/surveillance/providers/dahua/dahuaDigestAuth.js";
import { parseDahuaConfig, parseDahuaResponse, isDahuaError } from "../../server/services/surveillance/providers/dahua/dahuaResponseParser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

/* ------------------------------------------------------------------ *
 * Arguments — one host, explicitly
 * ------------------------------------------------------------------ */

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}

const HOST = args.get("host");
const PORT = Number(args.get("port") || 80);
const RTSP_PORT = Number(args.get("rtsp-port") || 554);

if (!HOST || !/^\d{1,3}(\.\d{1,3}){3}$/.test(HOST)) {
  console.error("refusing to run: --host must be a single explicit IPv4 address");
  process.exit(2);
}

/* ------------------------------------------------------------------ *
 * Credentials — loaded, used, never surfaced
 * ------------------------------------------------------------------ */

const loadCredentials = () => {
  const file = path.join(repoRoot, ".surveillance-probe.local");
  if (!fs.existsSync(file)) return null;
  const found = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    found[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  if (!found.DEVICE_USER || !found.DEVICE_PASS) return null;
  return { username: found.DEVICE_USER, password: found.DEVICE_PASS };
};

const credentials = loadCredentials();

/* ------------------------------------------------------------------ *
 * Redaction specific to this probe
 * ------------------------------------------------------------------ */

/** Keys whose values never leave this process, whatever they contain. */
const FORBIDDEN_KEYS = /^(serialnumber|sn|serial|password|pwd|userid|username|name|authorization|nonce|cnonce|response|cookie|verificationcode|code|qrcode|token|secret|mac|physicaladdress)$/i;

const scrub = (value, depth = 0) => {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((entry) => scrub(entry, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = FORBIDDEN_KEYS.test(key.replace(/[\s_.-]/g, "")) ? "[redacted]" : scrub(entry, depth + 1);
    }
    return out;
  }
  return value;
};

/** Identity fingerprint. The original never exists outside this expression. */
const fingerprint = (raw) =>
  raw ? crypto.createHash("sha256").update(String(raw)).digest("hex").slice(0, 16) : null;

/* ------------------------------------------------------------------ *
 * HTTP with digest
 * ------------------------------------------------------------------ */

const session = credentials ? createDigestSession(credentials) : null;

const httpGet = (requestPath, { binary = false } = {}) =>
  new Promise((resolve) => {
    const send = (authHeader, attempt) => {
      const req = http.request(
        {
          host: HOST,
          port: PORT,
          method: "GET",
          path: requestPath,
          headers: { host: `${HOST}:${PORT}`, connection: "close", ...(authHeader ? { authorization: authHeader } : {}) },
          timeout: 8000,
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on("data", (c) => {
            size += c.length;
            if (size > 4 * 1024 * 1024) { res.destroy(); return; }
            chunks.push(c);
          });
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            // A 401 on the first attempt is the challenge, not a failure.
            if (res.statusCode === 401 && attempt === 1 && session) {
              const challenge = res.headers["www-authenticate"];
              if (challenge && session.accept(Array.isArray(challenge) ? challenge[0] : challenge)) {
                send(session.authorize("GET", requestPath), 2);
                return;
              }
            }
            resolve({
              status: res.statusCode,
              authScheme: String(res.headers["www-authenticate"] || "").split(" ")[0] || null,
              bytes: buf.length,
              body: binary ? null : buf.toString("utf8"),
              isImage: binary ? buf.slice(0, 3).toString("hex") === "ffd8ff" : null,
            });
          });
        },
      );
      req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "timeout" }); });
      req.on("error", (e) => resolve({ status: 0, error: e.code || "network" }));
      req.end();
    };
    send(session?.hasChallenge ? session.authorize("GET", requestPath) : null, 1);
  });

/* ------------------------------------------------------------------ *
 * RTSP — OPTIONS and DESCRIBE only. Never PLAY.
 * ------------------------------------------------------------------ */

const rtsp = (method, streamPath) =>
  new Promise((resolve) => {
    const url = `rtsp://${HOST}:${RTSP_PORT}${streamPath}`;
    const socket = net.connect({ host: HOST, port: RTSP_PORT });
    socket.setTimeout(8000);
    let buffer = "";
    let seq = 1;
    let sentAuth = false;
    const rtspSession = credentials ? createDigestSession(credentials) : null;

    const write = (authHeader) => {
      const lines = [
        `${method} ${url} RTSP/1.0`,
        `CSeq: ${seq}`,
        "User-Agent: ERP-Surveillance-Probe",
        ...(method === "DESCRIBE" ? ["Accept: application/sdp"] : []),
        ...(authHeader ? [`Authorization: ${authHeader}`] : []),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
      seq += 1;
    };

    socket.on("connect", () => write(null));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!buffer.includes("\r\n\r\n")) return;

      const statusLine = buffer.split("\r\n")[0] || "";
      const status = Number(statusLine.split(" ")[1]) || 0;

      if (status === 401 && !sentAuth && rtspSession) {
        const match = buffer.match(/WWW-Authenticate:\s*(.+)/i);
        if (match && rtspSession.accept(match[1].trim())) {
          sentAuth = true;
          buffer = "";
          write(rtspSession.authorize(method, url));
          return;
        }
      }

      const publicHeader = buffer.match(/Public:\s*(.+)/i);
      const sdp = buffer.includes("\r\n\r\n") ? buffer.split("\r\n\r\n").slice(1).join("\r\n\r\n") : "";
      socket.destroy();
      resolve({
        status,
        authScheme: (buffer.match(/WWW-Authenticate:\s*(\w+)/i) || [])[1] || null,
        methods: publicHeader ? publicHeader[1].trim() : null,
        // SDP carries codec and resolution, which is the whole point. It carries
        // no credential.
        sdp: sdp.trim() || null,
      });
    });
    socket.on("timeout", () => { socket.destroy(); resolve({ status: 0, error: "timeout" }); });
    socket.on("error", (e) => resolve({ status: 0, error: e.code || "network" }));
  });

/* ------------------------------------------------------------------ *
 * ONVIF — SOAP. POST is the transport; the OPERATION is what must be a read.
 * ------------------------------------------------------------------ */

const onvifEnvelope = (operation, withAuth) => {
  let security = "";
  if (withAuth && credentials) {
    // WS-UsernameToken with a digest of nonce+created+password. The password
    // itself is never placed in the envelope.
    const nonce = crypto.randomBytes(16);
    const created = new Date().toISOString();
    const digest = crypto
      .createHash("sha1")
      .update(Buffer.concat([nonce, Buffer.from(created, "utf8"), Buffer.from(credentials.password, "utf8")]))
      .digest("base64");
    security =
      `<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">` +
      `<UsernameToken><Username>${credentials.username}</Username>` +
      `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>` +
      `<Nonce>${nonce.toString("base64")}</Nonce>` +
      `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>` +
      `</UsernameToken></Security></s:Header>`;
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">${security}` +
    `<s:Body><${operation} xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>`
  );
};

const onvifCall = (operation, withAuth) =>
  new Promise((resolve) => {
    const body = onvifEnvelope(operation, withAuth);
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        method: "POST",
        path: "/onvif/device_service",
        headers: {
          host: `${HOST}:${PORT}`,
          "content-type": "application/soap+xml; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          connection: "close",
        },
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const fault = (text.match(/<[^>]*(?:Text|faultstring)[^>]*>([^<]+)</i) || [])[1] || null;
          const pick = (tag) => (text.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, "i")) || [])[1] || null;
          resolve({
            status: res.statusCode,
            fault,
            manufacturer: pick("Manufacturer"),
            model: pick("Model"),
            firmware: pick("FirmwareVersion"),
            // Deliberately NOT SerialNumber or HardwareId.
            hasMedia: /Media/i.test(text) || null,
            dateTime: pick("UTCDateTime") ? "present" : null,
            bytes: text.length,
          });
        });
      },
    );
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "timeout" }); });
    req.on("error", (e) => resolve({ status: 0, error: e.code || "network" }));
    req.write(body);
    req.end();
  });

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const report = {
  probe: {
    host: HOST,
    http_port: PORT,
    rtsp_port: RTSP_PORT,
    started_at: new Date().toISOString(),
    credentials_supplied: Boolean(credentials),
    writes_performed: 0,
  },
  operations: {},
};

const main = async () => {
  const gated = assertAllOperationsReadOnly();
  report.probe.operations_allowlisted = gated;

  for (const op of PROBE_OPERATIONS) {
    if (op.protocol === "http") {
      const binary = op.id === "snapshotCh1";
      const res = await httpGet(op.path, { binary });
      const entry = {
        capability: op.capability,
        status: res.status,
        error: res.error || null,
        auth_scheme: res.authScheme || null,
        bytes: res.bytes ?? null,
      };
      if (binary) {
        entry.is_jpeg = res.isImage;
      } else if (res.body !== null && res.body !== undefined) {
        entry.device_error = isDahuaError(res.status, res.body);
        const flat = parseDahuaResponse(res.body);
        const config = parseDahuaConfig(res.body);
        entry.data = scrub(Object.keys(config).length ? config : flat);
        if (flat.serialNumber) entry.serial_fingerprint = fingerprint(flat.serialNumber);
      }
      report.operations[op.id] = entry;
      continue;
    }

    if (op.protocol === "rtsp") {
      const res = await rtsp(op.method, op.path);
      report.operations[op.id] = {
        capability: op.capability,
        status: res.status,
        error: res.error || null,
        auth_scheme: res.authScheme || null,
        methods: res.methods || null,
        sdp: res.sdp || null,
      };
      continue;
    }

    if (op.protocol === "onvif") {
      const needsAuth = op.operation !== "GetSystemDateAndTime";
      const res = await onvifCall(op.operation, needsAuth);
      report.operations[op.id] = {
        capability: op.capability,
        operation: op.operation,
        authenticated: needsAuth,
        status: res.status,
        error: res.error || null,
        fault: res.fault || null,
        manufacturer: res.manufacturer || null,
        model: res.model || null,
        firmware: res.firmware || null,
        has_media_service: res.hasMedia || null,
        date_time_present: res.dateTime || null,
      };
    }
  }

  report.probe.finished_at = new Date().toISOString();
  process.stdout.write(JSON.stringify(report, null, 2));
};

main().catch((error) => {
  // Never print the raw error: it can carry the URL and, on some paths, headers.
  console.error("probe aborted:", error?.code || error?.message?.slice(0, 120) || "unknown");
  process.exit(1);
});
