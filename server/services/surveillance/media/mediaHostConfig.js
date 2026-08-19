// The media host's secret contract.
//
// WHAT REPLACED THE POC
// ---------------------
// The proof-of-concept put the recorder's credential in `mediamtx.yml` as a
// static path source. That worked and was the wrong shape permanently: the
// password sat on disk in cleartext for as long as the file existed, survived
// reboots, and was one `cp` away from a backup, a support bundle or a repo.
//
// The replacement pushes the credentialed source through MediaMTX's control
// API at the moment a viewer asks for a stream. MEASURED, not assumed
// (scripts/surveillance-probe/verifyNoDiskPersist): after adding a path whose
// password was a recognisable canary, the config file's SHA-256 was unchanged,
// the canary appeared nowhere on disk under the working directory, and nowhere
// in stdout or stderr. MediaMTX holds API-added paths in memory only.
//
// So the credential's whole life is: decrypted in the ERP process, POSTed over
// loopback, resident in MediaMTX's memory, gone when the process exits. It is
// never written, never logged, and never in any process's argv — the two-hop
// pipeline already keeps it out of FFmpeg's command line.
//
// THE COST OF THIS DESIGN, STATED PLAINLY
// ---------------------------------------
// The running config is READABLE back from the control API: `GET
// /v3/config/paths/list` returns the source URL, credential included. That is
// not a flaw to be worked around, it is the consequence of MediaMTX needing the
// password in order to dial the recorder. It does mean the control API is now
// exactly as sensitive as the credential itself, so:
//
//   * it must bind to loopback and nothing else;
//   * it must never be published, proxied, or port-forwarded;
//   * anything that can reach it can read every recorder password in the tenant.
//
// assertApiIsLoopback() below is what stops that being a comment nobody checks.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";

/**
 * Config keys that must NOT appear in a media host's config file.
 *
 * `paths` is the one that matters: a static path is the only way a credential
 * gets into that file, and the POC proved how easily it happens.
 */
const FORBIDDEN_CONFIG = Object.freeze(["paths"]);

/**
 * The config a media host is supposed to run from.
 *
 * No paths, no credentials, no protocols that are not used. Everything the
 * gateway needs it adds at runtime.
 *
 * Written WITHOUT a byte-order mark. PowerShell's `Set-Content -Encoding utf8`
 * emits one on Windows, and MediaMTX's parser reads it as part of the first key
 * name and dies with `unknown field "﻿logLevel"` — a failure that looks
 * like a bad key rather than an encoding problem and cost real time to find.
 */
export const MEDIA_HOST_CONFIG_TEMPLATE = [
  "# Generated for the Surveillance Center. Do NOT add paths here.",
  "# Every path is pushed at runtime through the control API so that no",
  "# recorder credential is ever written to disk. See mediaHostConfig.js.",
  "logLevel: warn",
  "api: yes",
  "apiAddress: 127.0.0.1:9997",
  "rtspAddress: 127.0.0.1:8554",
  "webrtcAddress: 127.0.0.1:8889",
  "rtmp: no",
  "hls: no",
  "srt: no",
  "paths: {}",
  "",
].join("\n");

const hostOf = (url) => {
  try { return new URL(url).hostname; } catch { return ""; }
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/**
 * Refuse to talk to a control API that is not on loopback.
 *
 * Anything that can reach this API can read every credential the gateway has
 * pushed into it. Binding it to a LAN interface is not a smaller version of
 * that problem, it is the whole problem.
 */
export const assertApiIsLoopback = (apiUrl) => {
  const host = hostOf(apiUrl);
  if (!host) {
    throw new SurveillanceError("the media control API address is not a valid URL", {
      code: SURVEILLANCE_ERROR_CODES.MEDIA_GATEWAY_UNAVAILABLE,
      status: 500,
    });
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    // Deliberately fatal rather than a warning. A warning here is a warning
    // nobody reads until the credentials are already reachable from the shop
    // wifi. `host` is safe to include: it is our own configuration, not a
    // device address or a secret.
    throw new SurveillanceError("the media control API must bind to loopback only", {
      code: SURVEILLANCE_ERROR_CODES.MEDIA_GATEWAY_UNAVAILABLE,
      status: 500,
      details: { configured_host: host },
    });
  }
  return true;
};

/**
 * Inspect a media host config for statically-configured credentials.
 *
 * Called at startup against the file the host was launched with, so a leftover
 * POC config is caught before it can be used rather than discovered later by a
 * repository sweep.
 *
 * @returns {{ ok: boolean, problems: string[] }} problems name the RULE that
 *          was broken, never the offending value.
 */
export const inspectMediaHostConfig = (configText = "") => {
  const problems = [];
  const text = String(configText || "");

  // A credentialed URL anywhere in the file. This is the actual defect; the
  // `paths:` check below is the structural cause of it.
  if (/(?:rtsp|rtsps|http|https):\/\/[^/\s:@"']+:[^/\s@"']+@/.test(text)) {
    problems.push("config-contains-credentialed-url");
  }

  for (const key of FORBIDDEN_CONFIG) {
    // `paths: {}` and `paths:` alone are fine — an empty map is the point.
    const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(text);
    if (!match) continue;
    const value = match[1].trim();
    if (value === "{}" || value === "") {
      // Empty inline map is fine; a following indented block is not.
      const after = text.slice(match.index + match[0].length);
      if (value === "" && /^\s*\n\s{2,}\S/.test(after)) problems.push("config-defines-static-paths");
      continue;
    }
    problems.push("config-defines-static-paths");
  }

  if (/^apiAddress:\s*(?!127\.0\.0\.1|\[::1\]|localhost)\S/m.test(text)) {
    problems.push("control-api-not-on-loopback");
  }

  return { ok: problems.length === 0, problems };
};

/**
 * Where the media host's config lives, if this deployment manages one.
 *
 * Unset means the gateway talks to a host somebody else runs — valid, and in
 * that case the startup inspection is skipped because there is no file to read.
 */
export const mediaHostConfigPath = () =>
  String(process.env.SURVEILLANCE_MEDIA_CONFIG_PATH || "").trim();
