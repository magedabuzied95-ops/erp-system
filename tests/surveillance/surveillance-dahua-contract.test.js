// Dahua parsing and probe-contract tests.
//
// The fixtures are SANITIZED CAPTURES from a real DH-XVR1B16-I, not
// constructions from documentation. This file owns response PARSING and the
// PROBE CONTRACT; the device-shape assertions (channel counting, profiles,
// storage, DNS, schedule, motion scale) live in surveillance-real-device.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  coerceValue,
  isDahuaError,
  parseDahuaConfig,
  parseDahuaResponse,
  parseKeyPath,
} from "../../server/services/surveillance/providers/dahua/dahuaResponseParser.js";
import {
  CONFIDENCE,
  DAHUA_IDENTITY,
  DAHUA_PROBES,
  buildProbePath,
  interpretProbeResult,
} from "../../server/services/surveillance/providers/dahua/dahuaProbeContract.js";
import { CAPABILITY_KEYS, CAPABILITY_STATES } from "../../server/services/surveillance/surveillanceCapabilities.js";

const fixture = (name) => readFileSync(new URL(`../fixtures/dahua/${name}`, import.meta.url), "utf8");

/* ------------------------------------------------------------------ *
 * Response parsing
 * ------------------------------------------------------------------ */

test("a flat Dahua response becomes a nested object", () => {
  const parsed = parseDahuaResponse(fixture("system-info.txt"));
  assert.equal(parsed.deviceType, "DH-XVR1B16-I");
  assert.equal(parsed.processor, "ST7108");
});

test("indexed keys become arrays at the right depth", () => {
  const config = parseDahuaConfig(fixture("encode-config-real.txt"));
  assert.ok(Array.isArray(config.Encode));
  assert.equal(config.Encode.length, 50);
  assert.equal(config.Encode[0].MainFormat[0].Video.Width, 960);
  assert.equal(config.Encode[0].ExtraFormat[0].Video.FPS, 7);
});

test("the single wrapping table or list key is unwrapped", () => {
  assert.ok(parseDahuaResponse(fixture("encode-config-real.txt")).table);
  assert.ok(!parseDahuaConfig(fixture("encode-config-real.txt")).table);
  assert.ok(Array.isArray(parseDahuaConfig(fixture("storage-real.txt")).info));
});

test("values are coerced only where it is unambiguous", () => {
  assert.equal(coerceValue("15"), 15);
  assert.equal(coerceValue("1.5"), 1.5);
  assert.equal(coerceValue("true"), true);
  assert.equal(coerceValue("false"), false);
  assert.equal(coerceValue(""), "");
  // A serial that looks like scientific notation must stay a string.
  assert.equal(coerceValue("4E13"), "4E13");
  assert.equal(coerceValue("H.264"), "H.264");
  assert.equal(coerceValue("2026-08-17 00:31:45"), "2026-08-17 00:31:45");
});

test("a hostile response cannot make the parser allocate wildly", () => {
  // The device is on a network we do not control and runs firmware we have not
  // audited. An enormous index must be refused, not honoured.
  assert.equal(parseKeyPath("a[999999999]"), null);
  assert.equal(parseKeyPath("a.b.c.d.e.f.g.h.i.j.k.l.m.n"), null);
  const parsed = parseDahuaResponse("evil[999999999]=1\r\ngood=2");
  assert.equal(parsed.evil, undefined);
  // A bad line is skipped rather than poisoning the whole response.
  assert.equal(parsed.good, 2);
});

test("junk lines are skipped rather than throwing", () => {
  const parsed = parseDahuaResponse("ok=1\r\nnonsense-with-no-equals\r\n=novalue\r\nalso=2");
  assert.equal(parsed.ok, 1);
  assert.equal(parsed.also, 2);
});

test("device errors are recognised from the body as well as the status", () => {
  assert.equal(isDahuaError(200, fixture("unsupported-error.txt")), true);
  assert.equal(isDahuaError(400, "anything"), true);
  assert.equal(isDahuaError(200, fixture("system-info.txt")), false);
});

/* ------------------------------------------------------------------ *
 * Probe contract
 * ------------------------------------------------------------------ */

test("every probe names a real capability and carries a confidence and a reason", () => {
  for (const descriptor of DAHUA_PROBES) {
    assert.ok(CAPABILITY_KEYS.includes(descriptor.capability), descriptor.capability);
    assert.ok(Object.values(CONFIDENCE).includes(descriptor.confidence), descriptor.capability);
    assert.ok(descriptor.note && descriptor.note.length > 20, descriptor.capability);
    assert.match(descriptor.path, /^\/cgi-bin\//, descriptor.capability);
  }
});

test("the probe never performs the destructive action it is probing", () => {
  // Probing a restart by restarting is not a probe. The recorder is a live
  // device in a working shop.
  for (const descriptor of DAHUA_PROBES) {
    assert.doesNotMatch(descriptor.path, /action=reboot/i, descriptor.capability);
    assert.doesNotMatch(descriptor.path, /action=setConfig/i, descriptor.capability);
    assert.doesNotMatch(descriptor.path, /action=(remove|destroy|format)/i, descriptor.capability);
  }
  // Restart is therefore reported `unknown`, which hides the control.
  const restart = DAHUA_PROBES.find((d) => d.capability === "deviceRestart");
  assert.equal(interpretProbeResult(restart, { ok: true, parsed: { type: "XVR1B16-I" } }), CAPABILITY_STATES.UNKNOWN);
});

test("a device that errors reports unsupported, and one that answers without proof reports unknown", () => {
  const encode = DAHUA_PROBES.find((d) => d.capability === "encoderSettings");

  assert.equal(interpretProbeResult(encode, { ok: false }), CAPABILITY_STATES.UNSUPPORTED);
  // Answered, but the body does not contain what the capability needs.
  assert.equal(interpretProbeResult(encode, { ok: true, parsed: {} }), CAPABILITY_STATES.UNKNOWN);
});

test("a successful read of a writable surface yields read-only, not supported", () => {
  // Reading proves reading. Several Dahua config surfaces are readable by an
  // account that cannot write them — which is exactly the account split we
  // intend to use, so this must not be optimistic.
  const encode = DAHUA_PROBES.find((d) => d.capability === "encoderSettings");
  const parsed = parseDahuaConfig(fixture("encode-config-real.txt"));
  assert.equal(interpretProbeResult(encode, { ok: true, parsed }), CAPABILITY_STATES.READ_ONLY);
});

test("network settings stay read-only even when the device proves it can write", () => {
  // Policy, not capability: the disconnect-and-reconnect workflow does not exist
  // yet, so writing network configuration is not offered whatever the device says.
  const network = DAHUA_PROBES.find((d) => d.capability === "networkSettings");
  assert.equal(network.forceState, CAPABILITY_STATES.READ_ONLY);
  assert.equal(
    interpretProbeResult(network, { ok: true, parsed: { Network: { eth0: {} } } }),
    CAPABILITY_STATES.READ_ONLY,
  );
});

test("PTZ failing on the reference device is a correct unsupported", () => {
  const ptz = DAHUA_PROBES.find((d) => d.capability === "ptz");
  assert.equal(interpretProbeResult(ptz, { ok: false }), CAPABILITY_STATES.UNSUPPORTED);
  // And it is still in the contract, so a PTZ-capable device passes it.
  assert.equal(
    interpretProbeResult(ptz, { ok: true, parsed: { status: { Postion: [0, 0, 0] } } }),
    CAPABILITY_STATES.SUPPORTED,
  );
});

test("probe paths substitute the channel", () => {
  const ptz = DAHUA_PROBES.find((d) => d.capability === "ptz");
  assert.match(buildProbePath(ptz, { channel: 5 }), /channel=5$/);
  assert.match(buildProbePath(ptz), /channel=1$/);
});

test("identity reads are declared and contain no write action", () => {
  for (const [name, path] of Object.entries(DAHUA_IDENTITY)) {
    assert.match(path, /^\/cgi-bin\/magicBox\.cgi\?action=get/, name);
  }
});

test("nothing in the Dahua package opens a connection", () => {
  // Phase 2B-0 ships the contract and the parsing only. A network client here
  // would mean the boundary was crossed without a network path existing.
  for (const file of ["dahuaResponseParser.js", "dahuaProbeContract.js", "dahuaStreamProfiles.js"]) {
    const source = readFileSync(
      new URL(`../../server/services/surveillance/providers/dahua/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /\b(fetch|axios|undici|http|https|net|dgram)\s*[.(]/, file);
    assert.doesNotMatch(source, /from "node:(http|https|net|dgram|tls)"/, file);
  }
});
