// The media host's secret contract.
//
// The POC left a cleartext recorder password in `mediamtx.yml`. These tests
// exist so that shape cannot come back quietly — by someone "temporarily"
// adding a static path to debug something, or by a deployment that binds the
// control API to a LAN address because loopback was inconvenient.

import test from "node:test";
import assert from "node:assert/strict";

process.env.SURVEILLANCE_ENCRYPTION_KEY ||= "0".repeat(64);

const {
  MEDIA_HOST_CONFIG_TEMPLATE,
  assertApiIsLoopback,
  inspectMediaHostConfig,
} = await import("../../server/services/surveillance/media/mediaHostConfig.js");

const caught = (fn) => {
  try { fn(); return null; } catch (error) { return error; }
};

/* ------------------------------------------------------------------ *
 * The control API is as sensitive as the credentials in it
 * ------------------------------------------------------------------ */

test("a loopback control API is accepted", () => {
  for (const url of ["http://127.0.0.1:9997", "http://localhost:9997", "http://[::1]:9997"]) {
    assert.equal(assertApiIsLoopback(url), true, url);
  }
});

test("a control API on any non-loopback address is refused", () => {
  // Anything that reaches this API can read every recorder password the
  // gateway has pushed into it. There is no "slightly exposed" version.
  for (const url of [
    "http://0.0.0.0:9997",
    "http://192.168.1.50:9997",
    "http://10.0.0.4:9997",
    "http://media.example.com:9997",
    "https://mtx.internal:9997",
  ]) {
    const error = caught(() => assertApiIsLoopback(url));
    assert.ok(error, `must refuse ${url}`);
    assert.equal(error.status, 500);
  }
});

test("refusing does not echo anything secret", () => {
  const error = caught(() => assertApiIsLoopback("http://192.168.1.50:9997"));
  const serialised = JSON.stringify(error.details || {});
  // The configured host is our own config and is safe; a password never is.
  assert.ok(serialised.includes("192.168.1.50"));
  assert.ok(!/password|secret|@/i.test(serialised));
});

test("a malformed API address is refused rather than treated as loopback", () => {
  for (const url of ["", "not a url", "://x", null, undefined]) {
    assert.ok(caught(() => assertApiIsLoopback(url)), `must refuse ${String(url)}`);
  }
});

/* ------------------------------------------------------------------ *
 * The config file must never hold a credential
 * ------------------------------------------------------------------ */

test("the shipped template is clean and has no static paths", () => {
  const result = inspectMediaHostConfig(MEDIA_HOST_CONFIG_TEMPLATE);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test("the template carries no byte-order mark", () => {
  // PowerShell's `Set-Content -Encoding utf8` writes one, and MediaMTX parses
  // it as part of the first key: `unknown field "\ufefflogLevel"`. The error
  // names a key rather than an encoding, which is why it wasted real time.
  assert.ok(!MEDIA_HOST_CONFIG_TEMPLATE.startsWith("\ufeff"));
  assert.ok(MEDIA_HOST_CONFIG_TEMPLATE.startsWith("#"));
});

test("a config with the POC's static credentialed path is rejected", () => {
  const poc = [
    "logLevel: warn",
    "api: yes",
    "apiAddress: 127.0.0.1:9997",
    "paths:",
    "  dvr_raw:",
    "    source: rtsp://erp_surveillance:Hunter2@192.0.2.10:554/cam/realmonitor?channel=1",
    "    sourceOnDemand: yes",
  ].join("\n");

  const result = inspectMediaHostConfig(poc);
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes("config-contains-credentialed-url"));
  assert.ok(result.problems.includes("config-defines-static-paths"));
});

test("a static path without a credential is still rejected", () => {
  // Paths belong to the runtime, not the file. Allowing "just one harmless
  // static path" is how the credentialed one gets added next to it later.
  const config = ["apiAddress: 127.0.0.1:9997", "paths:", "  test:", "    source: publisher"].join("\n");
  const result = inspectMediaHostConfig(config);
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes("config-defines-static-paths"));
});

test("an empty paths map is allowed in either spelling", () => {
  assert.equal(inspectMediaHostConfig("apiAddress: 127.0.0.1:9997\npaths: {}\n").ok, true);
  assert.equal(inspectMediaHostConfig("apiAddress: 127.0.0.1:9997\npaths:\n").ok, true);
});

test("a config binding the control API off loopback is rejected", () => {
  const result = inspectMediaHostConfig("apiAddress: 0.0.0.0:9997\npaths: {}\n");
  assert.equal(result.ok, false);
  assert.ok(result.problems.includes("control-api-not-on-loopback"));
});

test("problems name the rule, never the offending value", () => {
  const poc = "paths:\n  x:\n    source: rtsp://admin:Hunter2@192.0.2.10:554/cam\n";
  const { problems } = inspectMediaHostConfig(poc);
  const joined = problems.join(" ");
  assert.ok(!joined.includes("Hunter2"), "a problem code must not carry the credential");
  assert.ok(!joined.includes("192.0.2.10"));
  for (const p of problems) assert.match(p, /^[a-z-]+$/);
});
