// Display-aspect regression suite.
//
// The bug: the real recorder encodes 1080N (960x1080 with 2:1 pixels) and
// declares no sample aspect ratio, and WebRTC discards the one the transcoder
// sets. Chrome therefore drew a tall, vertically stretched picture, and the
// operator saw it before anyone else did.
//
// These pin the correction so it cannot regress, and — just as importantly —
// pin the cases that must NOT be "corrected", because silently distorting a
// camera that was already right is the worse failure: the wrong one is obvious,
// a wrongly-corrected one just looks plausible.

import test from "node:test";
import assert from "node:assert/strict";

import {
  displayAspectFor,
  frameStyleFor,
  fullscreenFrameStyle,
} from "../../src/modules/surveillance/lib/displayAspect.js";

const SIXTEEN_NINE = 16 / 9;
const close = (a, b) => Math.abs(a - b) < 0.001;

/* ------------------------------------------------------------------ *
 * The real device
 * ------------------------------------------------------------------ */

test("1080N from the reference recorder is corrected to 16:9", () => {
  // The exact coded shape the DH-XVR1B16-I produces on its main stream.
  const result = displayAspectFor({ width: 960, height: 1080 });
  assert.ok(close(result.aspect, SIXTEEN_NINE), `got ${result.aspect}`);
  assert.equal(result.corrected, true);
  assert.equal(result.reason, "known-coded-mode");
  // The coded aspect it is being corrected FROM — the tall picture.
  assert.ok(close(960 / 1080, 0.889));
});

test("the sub stream is CIF with square pixels and must not be touched", () => {
  // 352x288 is genuinely 11:9 content. "Correcting" it to 16:9 would stretch a
  // stream that was already right.
  const result = displayAspectFor({ width: 352, height: 288 });
  assert.equal(result.corrected, false);
  assert.equal(result.reason, "square-pixels");
  assert.ok(close(result.aspect, 352 / 288));
});

/* ------------------------------------------------------------------ *
 * Things that must NOT be corrected
 * ------------------------------------------------------------------ */

test("ordinary square-pixel resolutions pass through untouched", () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [704, 576], [640, 480]]) {
    const result = displayAspectFor({ width: w, height: h });
    assert.equal(result.corrected, false, `${w}x${h}`);
    assert.ok(close(result.aspect, w / h), `${w}x${h}`);
  }
});

test("an unrecognised coded shape is drawn as coded rather than guessed", () => {
  // A formula like "half-width implies 16:9" would rewrite this. It must not.
  const result = displayAspectFor({ width: 800, height: 900 });
  assert.equal(result.corrected, false);
  assert.equal(result.reason, "coded-as-is");
  assert.ok(close(result.aspect, 800 / 900));
});

test("a device-reported aspect wins over the lookup", () => {
  const result = displayAspectFor({ width: 960, height: 1080, displayAspectRatio: 4 / 3 });
  assert.equal(result.reason, "device-reported");
  assert.ok(close(result.aspect, 4 / 3));
});

test("a missing resolution degrades to 16:9 without claiming a correction", () => {
  const result = displayAspectFor({});
  assert.equal(result.corrected, false);
  assert.equal(result.reason, "unknown-resolution");
});

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

test("the frame is sized by aspect ratio, not by hardcoded pixels", () => {
  const style = frameStyleFor({ width: 960, height: 1080 });
  assert.ok(close(Number(style.aspectRatio), SIXTEEN_NINE));
  assert.equal(style.width, "100%");
});

test("fullscreen sizing fits inside any screen shape and stays 16:9", () => {
  const style = fullscreenFrameStyle({ width: 960, height: 1080 });
  assert.ok(close(Number(style.aspectRatio), SIXTEEN_NINE));
  // min(100vw, 100vh * aspect) is what keeps an ultrawide or a 5:4 monitor from
  // overflowing. Verified in a browser at 1920x1080, 2560x1440, 1366x768,
  // 1280x1024 and 3440x1440 — every one landed on 1.7778 and fit the screen.
  assert.match(style.width, /^min\(100vw, calc\(100vh \* 1\.77/);
  assert.equal(style.maxHeight, "100vh");
});

test("the correction is display-only — no resampling is implied anywhere", () => {
  // The whole safety property: nothing here changes pixel data. If a future
  // edit introduces a scale/resize instruction, this fails.
  const style = { ...frameStyleFor({ width: 960, height: 1080 }), ...fullscreenFrameStyle({ width: 960, height: 1080 }) };
  const serialised = JSON.stringify(style).toLowerCase();
  for (const forbidden of ["scale(", "transform", "zoom", "resize", "upscale"]) {
    assert.ok(!serialised.includes(forbidden), `style must not contain ${forbidden}`);
  }
});
