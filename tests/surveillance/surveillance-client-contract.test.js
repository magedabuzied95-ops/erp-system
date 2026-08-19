// Browser-side contracts: capability gating and the WHEP client.
//
// These are the two client modules that carry a security property rather than
// a cosmetic one. Capability gating decides whether a control that could hurt a
// recorder is offered at all; the WHEP client decides where the stream ticket
// travels. Both are pure enough to test without a browser.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const {
  CAPABILITY_STATES, absenceReasonKey, canRead, canWrite, capabilityState,
} = await import("../../src/modules/surveillance/lib/capability.js");

const { streamErrorKey } = await import("../../src/modules/surveillance/lib/whepClient.js");

/* ------------------------------------------------------------------ *
 * Capability gating — four states, one of which earns a control
 * ------------------------------------------------------------------ */

test("only an explicit `supported` permits a write", () => {
  // `unknown` is the dangerous one. A control enabled on unknown fails at the
  // click, against a real recorder, in front of a customer.
  assert.equal(canWrite({ ptz: "supported" }, "ptz"), true);
  for (const state of ["unsupported", "unknown", "read-only", "", null, undefined]) {
    assert.equal(canWrite({ ptz: state }, "ptz"), false, `state ${String(state)} must not permit a write`);
  }
});

test("a capability the device never reported is unknown, not permitted", () => {
  // The map simply lacks the key — which is what a device that was never
  // probed looks like.
  assert.equal(capabilityState({}, "ptz"), CAPABILITY_STATES.UNKNOWN);
  assert.equal(canWrite({}, "ptz"), false);
  assert.equal(canRead({}, "ptz"), false);
});

test("read-only permits reading but never writing", () => {
  assert.equal(canRead({ storageInfo: "read-only" }, "storageInfo"), true);
  assert.equal(canWrite({ storageInfo: "read-only" }, "storageInfo"), false);
});

test("both the string and object shapes are understood", () => {
  // The API sends flat strings; an older shape used { state }. Reading the
  // wrong one silently enables a dangerous control.
  assert.equal(capabilityState({ ptz: "supported" }, "ptz"), "supported");
  assert.equal(capabilityState({ ptz: { state: "supported" } }, "ptz"), "supported");
  assert.equal(capabilityState({ ptz: { state: "unsupported" } }, "ptz"), "unsupported");
});

test("a bare boolean is not mistaken for a state string", () => {
  assert.equal(canWrite({ ptz: true }, "ptz"), true);
  assert.equal(canWrite({ ptz: false }, "ptz"), false);
});

test("every absence has a distinct explanation", () => {
  // "Not available" for all three tells an operator nothing about whether to
  // wait, re-probe, or stop asking.
  const reasons = new Set([
    absenceReasonKey({ x: "unsupported" }, "x"),
    absenceReasonKey({ x: "read-only" }, "x"),
    absenceReasonKey({ x: "unknown" }, "x"),
  ]);
  assert.equal(reasons.size, 3);
  for (const key of reasons) assert.match(key, /^surveillance\.capability\./);
});

/* ------------------------------------------------------------------ *
 * The ticket does not travel in a URL
 * ------------------------------------------------------------------ */

test("the WHEP client sends the ticket as an Authorization header", () => {
  const source = fs.readFileSync(
    new URL("../../src/modules/surveillance/lib/whepClient.js", import.meta.url), "utf8");

  assert.match(source, /authorization:\s*`Bearer \$\{ticket\}`/,
    "the ticket must travel in a header");
  // A URL lands in history, the address bar during a screen share, referer
  // headers, every reverse-proxy log, and every screenshot.
  assert.doesNotMatch(source, /[?&]ticket=/, "the ticket must never be a query parameter");
  assert.doesNotMatch(source, /searchParams\.set\(\s*["']ticket/);
});

test("a rejected ticket is distinguished from a transport failure", () => {
  // They need different responses: reopen the stream vs retry the connection.
  assert.equal(streamErrorKey({ message: "ticket-rejected" }), "surveillance.live.errorTicket");
  assert.equal(streamErrorKey({ status: 503 }), "surveillance.live.errorCapacity");
  assert.equal(streamErrorKey({ status: 429 }), "surveillance.live.errorRateLimited");
  assert.equal(streamErrorKey({ status: 403 }), "surveillance.live.errorForbidden");
  assert.equal(streamErrorKey({ status: 500 }), "surveillance.live.errorGeneric");
  assert.equal(streamErrorKey(null), null);
});

test("every stream error maps to a real translation key", async () => {
  const en = JSON.parse(fs.readFileSync(
    new URL("../../src/locales/en/surveillance.json", import.meta.url), "utf8"));
  const resolve = (path) => path.split(".").slice(1).reduce((node, part) => node?.[part], en);

  for (const error of [
    { message: "ticket-rejected" }, { status: 503 }, { status: 429 },
    { status: 403 }, { status: 500 },
  ]) {
    const key = streamErrorKey(error);
    assert.ok(resolve(key), `${key} has no translation — the tile would render a raw key path`);
  }
});

test("a failed connection is always torn down", () => {
  // A PeerConnection left open after a failure holds an encoder running on the
  // host for a tile that will never show a picture.
  const source = fs.readFileSync(
    new URL("../../src/modules/surveillance/lib/whepClient.js", import.meta.url), "utf8");
  assert.match(source, /connectionState === "failed"[\s\S]{0,40}close\(\)/);
  assert.match(source, /catch \(error\) \{\s*close\(\);/, "a throw during setup must close the connection");
});

test("closing detaches the sink before tearing down the connection", () => {
  // Order matters: Chrome keeps decoding into a detached element for a while,
  // so a tile can appear live after it was closed.
  const source = fs.readFileSync(
    new URL("../../src/modules/surveillance/lib/whepClient.js", import.meta.url), "utf8");
  const close = source.slice(source.indexOf("const close ="), source.indexOf("const close =") + 400);
  assert.ok(close.indexOf("srcObject = null") < close.indexOf("pc.close()"),
    "srcObject must be cleared before pc.close()");
});
