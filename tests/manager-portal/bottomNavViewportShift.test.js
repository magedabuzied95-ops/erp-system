import test from "node:test";
import assert from "node:assert/strict";

import { measureShift } from "../../src/shared/hooks/useVisualViewportBottomShift.js";

const withWindow = (innerHeight, visualViewport, run) => {
  const previous = globalThis.window;
  globalThis.window = { innerHeight, visualViewport };
  try { return run(); } finally { globalThis.window = previous; }
};

test("a healthy viewport leaves the bar where CSS put it", () => {
  assert.equal(withWindow(800, { height: 800, offsetTop: 0, scale: 1 }, measureShift), 0);
});

test("a viewport stranded below the layout one pulls the bar down by the gap", () => {
  // iPhone after the keyboard closed: same height, but the visual viewport sits 360px lower.
  assert.equal(withWindow(800, { height: 800, offsetTop: 360, scale: 1 }, measureShift), 360);
});

test("an open keyboard and a pinch-zoom are left alone", () => {
  assert.equal(withWindow(800, { height: 450, offsetTop: 300, scale: 1 }, measureShift), 0);
  assert.equal(withWindow(800, { height: 400, offsetTop: 200, scale: 2 }, measureShift), 0);
});

test("no visualViewport means no shift", () => {
  assert.equal(withWindow(800, undefined, measureShift), 0);
});
