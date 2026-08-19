// Playback service: window bounds, path isolation, and the route contracts.
//
// The window validation runs BEFORE any device is contacted, which is what
// makes it testable here without a database or a recorder — and is also why it
// is the right place for the bound: an unbounded search should be refused
// without a recorder ever being asked to enumerate a year of footage.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.SURVEILLANCE_ENCRYPTION_KEY ||= "0".repeat(64);

const { searchPlayback } = await import(
  "../../server/services/surveillance/surveillancePlaybackService.js"
);
const { mediaPathName } = await import(
  "../../server/services/surveillance/media/MediaGateway.js"
);

const ROUTES = fs.readFileSync(
  new URL("../../server/routes/surveillance.js", import.meta.url), "utf8");

const rejects = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};

/* ------------------------------------------------------------------ *
 * The search window is bounded before a recorder is touched
 * ------------------------------------------------------------------ */

test("an inverted or malformed window is refused", async () => {
  for (const [from, to] of [
    ["2026-08-19T10:00:00Z", "2026-08-19T09:00:00Z"],  // end before start
    ["2026-08-19T10:00:00Z", "2026-08-19T10:00:00Z"],  // zero length
    ["not a date", "2026-08-19T10:00:00Z"],
    [undefined, undefined],
  ]) {
    const error = await rejects(() => searchPlayback(7, 3, 1, { from, to }));
    assert.ok(error, `must refuse ${String(from)} -> ${String(to)}`);
    assert.equal(error.status, 400);
  }
});

test("a window longer than 24 hours is refused", async () => {
  // A recorder with a year of footage must never be asked to enumerate it, and
  // the UI never needs more than a day at a time.
  const error = await rejects(() =>
    searchPlayback(7, 3, 1, { from: "2026-08-01T00:00:00Z", to: "2026-08-19T00:00:00Z" }));
  assert.ok(error);
  assert.equal(error.status, 400);
  assert.equal(error.details.max_hours, 24);
});

test("the bound is checked before any device call", async () => {
  // Proof by absence of a database: this runs with no db connection and no
  // recorder, so reaching a device would throw something else entirely.
  const error = await rejects(() =>
    searchPlayback(7, 3, 1, { from: "2026-08-01T00:00:00Z", to: "2026-08-19T00:00:00Z" }));
  assert.equal(error.code, "SURVEILLANCE_VALIDATION_FAILED");
});

/* ------------------------------------------------------------------ *
 * A playback path cannot be opened by a live ticket
 * ------------------------------------------------------------------ */

test("playback and live paths for the same channel are different", () => {
  // openPlayback uses stream key `pb<n>`; live uses the profile key. If the two
  // collided, a ticket minted to watch a camera live would also open its
  // recorded history — a different and much larger permission.
  const live = mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "0" });
  const playback = mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "pb1" });
  assert.notEqual(live, playback);
});

test("playback paths stay separated across channels and tenants", () => {
  const a = mediaPathName({ tenantId: 7, deviceId: 3, channelId: 1, stream: "pb1" });
  const b = mediaPathName({ tenantId: 7, deviceId: 3, channelId: 2, stream: "pb2" });
  const c = mediaPathName({ tenantId: 8, deviceId: 3, channelId: 1, stream: "pb1" });
  assert.equal(new Set([a, b, c]).size, 3);
});

test("the service uses a distinct playback stream key", () => {
  const source = fs.readFileSync(
    new URL("../../server/services/surveillance/surveillancePlaybackService.js", import.meta.url), "utf8");
  assert.match(source, /stream:\s*`pb\$\{Number\(channelIndex\)\}`/,
    "playback must not reuse the live profile key as its path key");
});

/* ------------------------------------------------------------------ *
 * Route contracts that are easy to regress
 * ------------------------------------------------------------------ */

test("playback routes are behind the playback permission and rate limit", () => {
  const block = ROUTES.slice(ROUTES.indexOf("/devices/:id/playback/backend"));
  for (const route of ["playback/search", "playback/open"]) {
    const index = block.indexOf(route);
    assert.ok(index > 0, `${route} missing`);
    const window = block.slice(index, index + 420);
    assert.match(window, /permit\("surveillance", "playback"\)/, `${route} is not permission-gated`);
    assert.match(window, /surveillanceRateLimit\("playback"\)/, `${route} is not rate limited`);
  }
});

test("the snapshot response is never cacheable", () => {
  // A still from a camera must not sit in a browser cache or a proxy after the
  // operator closes the tab.
  const index = ROUTES.indexOf("/devices/:id/snapshot/:channelIndex");
  assert.ok(index > 0);
  const window = ROUTES.slice(index, index + 1600);
  assert.match(window, /cache-control["']\s*,\s*["']no-store/);
  assert.match(window, /permit\("surveillance", "snapshot"\)/);
  assert.match(window, /surveillanceRateLimit\("snapshot"\)/);
});

test("every snapshot is audited, not only the saved ones", () => {
  // Auditing only saves would let anyone photograph any camera and leave no
  // trace by simply not clicking save.
  const index = ROUTES.indexOf("/devices/:id/snapshot/:channelIndex");
  const window = ROUTES.slice(index, index + 1600);
  const audit = window.indexOf("recordSurveillanceAudit");
  const savedCheck = window.indexOf('req.query?.save');
  assert.ok(audit > 0, "no audit call in the snapshot route");
  // The audit must NOT sit inside an `if (saved)` branch.
  assert.doesNotMatch(
    window.slice(savedCheck, audit),
    /if\s*\([^)]*saved[^)]*\)\s*\{[^}]*$/,
    "the audit call must not be conditional on saving",
  );
  assert.match(window, /saved\s*\}/, "the audit metadata should record whether it was saved");
});

test("the media-auth route refuses publishing from anywhere but loopback", () => {
  const index = ROUTES.indexOf('"/media/auth"');
  assert.ok(index > 0);
  const window = ROUTES.slice(index, index + 2200);
  assert.match(window, /isLoopbackAddress\(ip\)/, "publish must be loopback-gated");
  // The path is re-derived from the ticket rather than trusted from the request.
  assert.match(window, /mediaPathForClaims\(claims\)/);
  assert.match(window, /expectedPath !== String\(path\)/);
  // And it must never explain WHY it refused.
  assert.match(window, /catch\s*\{[\s\S]{0,200}return deny\(\)/);
});

test("the media-auth route reads the ticket from a header before a query string", () => {
  // A URL is the leakiest place for a credential: history, address bar during a
  // screen share, referer headers, proxy logs, screenshots.
  const index = ROUTES.indexOf('"/media/auth"');
  const window = ROUTES.slice(index, index + 2200);
  assert.match(window, /token \|\| password/, "Bearer token must be preferred over the RTSP password field");
});
