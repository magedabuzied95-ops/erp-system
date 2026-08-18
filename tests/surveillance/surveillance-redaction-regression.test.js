// Redaction regression suite.
//
// WHY THIS EXISTS
// ---------------
// During the first authenticated probe of the real recorder, the P2P config
// returned a device UUID that is serial-equivalent, and the redaction list did
// not cover the `UUID` key. The value reached a terminal.
//
// It never reached git, and the list was extended the same day. But "we extended
// the list" is not a control — the next unfamiliar response will carry the next
// unfamiliar key. These tests pin every identifier class that has actually
// appeared in a real device response, plus the ones a Dahua device is documented
// to return, so a regression is a failing test rather than another incident.
//
// The lesson, stated once here and in the probe source: a redaction list is only
// ever as good as the last response that surprised it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  REDACTED,
  redactString,
  redactSurveillance,
  surveillanceLogContext,
} from "../../server/services/surveillance/surveillanceRedaction.js";

/** Values that must never survive redaction, whatever wraps them. */
const SECRETS = Object.freeze({
  password: "Hunter2-dvr-2026",
  serialNumber: "5J09A21PAZ00123",
  // The exact class of value that leaked. Serial-equivalent.
  uuid: "7C09654PAZ03900",
  deviceId: "DEV-4471-XVR",
  did: "did:9931:abc",
  key: "b7f3c1a95e2d4806af17bc3d9e0512",
  username: "4365c117bad4ebff27ab18f4a33bd55f",
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  authorization: "Digest username=admin, response=9a8b7c6d5e4f3a2b",
});

const assertNothingLeaked = (serialised, label) => {
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!serialised.includes(value), `${label}: ${name} leaked`);
  }
};

/* ------------------------------------------------------------------ *
 * Every identifier class, at the top level
 * ------------------------------------------------------------------ */

test("every secret key class is redacted at the top level", () => {
  const payload = {
    password: SECRETS.password,
    serialNumber: SECRETS.serialNumber,
    sn: SECRETS.serialNumber,
    serial: SECRETS.serialNumber,
    UUID: SECRETS.uuid,
    uuid: SECRETS.uuid,
    deviceId: SECRETS.deviceId,
    DeviceID: SECRETS.deviceId,
    did: SECRETS.did,
    DID: SECRETS.did,
    key: SECRETS.key,
    Key: SECRETS.key,
    username: SECRETS.username,
    Username: SECRETS.username,
    token: SECRETS.token,
    authorization: SECRETS.authorization,
    Authorization: SECRETS.authorization,
  };
  const out = JSON.stringify(redactSurveillance(payload));
  assertNothingLeaked(out, "top level");
  // And the keys themselves survive, so a log still says WHAT was withheld.
  assert.ok(out.includes("UUID"));
  assert.ok(out.includes(REDACTED));
});

test("key matching ignores case, separators and surrounding words", () => {
  const payload = {
    "device-id": SECRETS.deviceId,
    "DEVICE_ID": SECRETS.deviceId,
    "Serial Number": SECRETS.serialNumber,
    "p2p.uuid": SECRETS.uuid,
    devicePassword: SECRETS.password,
    accessToken: SECRETS.token,
    apiKey: SECRETS.key,
  };
  assertNothingLeaked(JSON.stringify(redactSurveillance(payload)), "key variants");
});

/* ------------------------------------------------------------------ *
 * Recursion: nested objects and arrays
 * ------------------------------------------------------------------ */

test("redaction is recursive through nested objects", () => {
  // The real P2P response is an array inside an object inside a config table,
  // which is exactly why a shallow pass missed it.
  const payload = {
    table: {
      T2UServer: [
        {
          Enable: true,
          Address: "www.easy4ipcloud.com",
          UUID: SECRETS.uuid,
          Key: SECRETS.key,
          Username: SECRETS.username,
        },
      ],
    },
  };
  const out = JSON.stringify(redactSurveillance(payload));
  assertNothingLeaked(out, "nested P2P");
  // Non-secret siblings survive, or the log is useless.
  assert.ok(out.includes("easy4ipcloud.com"));
  assert.ok(out.includes("Enable"));
});

test("redaction reaches secrets buried several levels deep", () => {
  const payload = { a: { b: { c: { d: [{ e: { serialNumber: SECRETS.serialNumber } }] } } } };
  assertNothingLeaked(JSON.stringify(redactSurveillance(payload)), "deep nesting");
});

test("redaction handles arrays of objects and arrays of arrays", () => {
  const payload = [
    [{ uuid: SECRETS.uuid }],
    { list: [{ password: SECRETS.password }, { key: SECRETS.key }] },
  ];
  assertNothingLeaked(JSON.stringify(redactSurveillance(payload)), "arrays");
});

test("a secret-named key is redacted even when its value is an object", () => {
  // How `auth: { username, password }` and `headers: { authorization }` get
  // neutralised wholesale rather than walked into.
  const payload = { auth: { username: "admin", password: SECRETS.password }, credentials: { key: SECRETS.key } };
  const out = JSON.stringify(redactSurveillance(payload));
  assertNothingLeaked(out, "object-valued secret key");
  assert.ok(!out.includes("admin"));
});

/* ------------------------------------------------------------------ *
 * RTSP URLs carrying credentials
 * ------------------------------------------------------------------ */

test("credentials inside an RTSP URL are stripped, host preserved", () => {
  const url = `rtsp://erp_surveillance:${SECRETS.password}@192.168.1.108:554/cam/realmonitor?channel=1&subtype=1`;
  const out = redactString(url);
  assert.ok(!out.includes(SECRETS.password));
  assert.ok(!out.includes("erp_surveillance:"));
  assert.ok(out.includes(REDACTED));
  // The host stays readable, which is what makes the log worth keeping.
  assert.ok(out.includes("192.168.1.108"));
  assert.ok(out.includes("subtype=1"));
});

test("RTSP credentials are stripped wherever the URL appears", () => {
  const url = `rtsp://admin:${SECRETS.password}@192.168.1.108:554/cam/realmonitor?channel=1`;
  for (const wrapper of [
    { message: url },
    { nested: { deep: [url] } },
    new Error(`connect failed for ${url}`),
  ]) {
    assert.ok(!JSON.stringify(redactSurveillance(wrapper)).includes(SECRETS.password));
  }
});

test("URL-encoded passwords are stripped too", () => {
  const out = redactString("rtsp://admin:P%40ssw0rd%21@192.168.1.108:554/cam/realmonitor?channel=1");
  assert.ok(!out.includes("P%40ssw0rd"));
  assert.ok(out.includes(REDACTED));
});

/* ------------------------------------------------------------------ *
 * Errors: the realistic leak path
 * ------------------------------------------------------------------ */

test("an error carrying config, headers and a stack leaks none of them", () => {
  const error = new Error(`probe failed for rtsp://admin:${SECRETS.password}@192.168.1.108`);
  error.config = {
    auth: { username: "admin", password: SECRETS.password },
    headers: { Authorization: SECRETS.authorization },
  };
  error.response = { data: { serialNumber: SECRETS.serialNumber, UUID: SECRETS.uuid } };
  error.stack = `Error: ${SECRETS.password}\n    at probe (/app/x.js:1:1)`;

  const out = JSON.stringify(redactSurveillance(error));
  assertNothingLeaked(out, "axios-shaped error");
  assert.ok(!out.includes("/app/x.js"), "stack must be dropped");
  // The useful part survives.
  assert.ok(out.includes("probe failed"));
});

test("the standard log context carries identity only", () => {
  const context = surveillanceLogContext({ tenantId: 7, userId: 3, deviceId: 4 });
  const out = JSON.stringify(context);
  // No host: a recorder's LAN address is information about the customer's
  // network and has no place in a shared log.
  assert.ok(!out.includes("192.168"));
  assert.deepEqual(Object.keys(context).sort(), ["branch_id", "channel_id", "device_id", "tenant_id", "user_id"]);
});

/* ------------------------------------------------------------------ *
 * The probe's own redaction list
 * ------------------------------------------------------------------ */

test("the probe redacts every identifier class the real device returned", () => {
  // Asserted structurally because the probe only runs against hardware. The
  // regex is the control; this pins its contents.
  const source = readFileSync(
    new URL("../../scripts/surveillance-probe/probeRealDevice.mjs", import.meta.url),
    "utf8",
  );
  const match = source.match(/const FORBIDDEN_KEYS = \/\^\(([^)]+)\)/);
  assert.ok(match, "FORBIDDEN_KEYS not found");
  const covered = match[1].split("|");

  for (const key of [
    "serialnumber", "sn", "serial",
    "uuid", "deviceid", "did", "key", "username",
    "password", "authorization", "nonce", "cnonce", "response",
    "token", "secret", "verificationcode", "qrcode",
  ]) {
    assert.ok(covered.includes(key), `probe redaction is missing "${key}"`);
  }
});

test("the probe never stores the account payload, only its size", () => {
  const source = readFileSync(
    new URL("../../scripts/surveillance-probe/probeRealDevice.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /account_count/);
  // The serial is hashed and the original discarded in the same expression.
  assert.match(source, /const fingerprint =/);
  assert.match(source, /createHash\("sha256"\)/);
});

test("committed fixtures contain no real device identifiers", () => {
  // The sanitization that let real captures be committed at all.
  const files = [
    "system-info.txt", "p2p-real.txt", "machine-name.txt",
    "network-real.txt", "rtsp-describe-ch1-sub.sdp",
  ];
  for (const name of files) {
    const body = readFileSync(new URL(`../fixtures/dahua/${name}`, import.meta.url), "utf8");
    assert.ok(!body.includes(SECRETS.uuid), `${name} contains the real UUID`);
    assert.ok(!/PAZ0\d{4}/.test(body), `${name} contains a real-looking serial`);
    assert.ok(!body.includes(SECRETS.username), `${name} contains the real P2P username`);
  }
});
