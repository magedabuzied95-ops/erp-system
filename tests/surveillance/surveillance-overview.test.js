// The dashboard's aggregation, checked against the REAL recorder's output.
//
// WHY THESE TESTS EXIST
// ---------------------
// The first draft of the overview read `storage.partitions`, `totalBytes` per
// partition, `storage.overwrite` and `systemTime.currentTime`. Not one of those
// fields exists. The parsers expose `totalGb`, `usedGb`, `full`, `healthy` and
// `deviceTime`, and they have already summed across disks.
//
// Nothing would have thrown. Every tile would simply have rendered "unknown"
// forever, on a dashboard whose entire selling point is that "unknown" is
// honest — the failure would have looked exactly like correct behaviour.
//
// So these run the real captured device responses through the real parsers and
// assert the dashboard shape comes out populated.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.SURVEILLANCE_ENCRYPTION_KEY ||= "0".repeat(64);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = (name) => fs.readFileSync(path.join(ROOT, "tests/fixtures/dahua", name), "utf8");

// TWO parsers, and picking the wrong one yields a silent empty object rather
// than an error: parseDahuaConfig builds the nested tree these configs need,
// parseDahuaResponse returns the flat key/value form used by simple responses.
const { parseDahuaConfig, parseDahuaResponse } = await import(
  "../../server/services/surveillance/providers/dahua/dahuaResponseParser.js"
);
const { parseStorageInfo, parseSystemTime } = await import(
  "../../server/services/surveillance/providers/dahua/dahuaParsers.js"
);
const { __testables } = await import(
  "../../server/services/surveillance/surveillanceOverviewService.js"
);

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

test("the real recorder's storage reaches the dashboard populated", () => {
  const storage = parseStorageInfo(parseDahuaConfig(fixture("storage-real.txt")));
  const tile = __testables.storageStateFrom(storage);

  assert.equal(tile.status, "known");
  // The specific regression: these were null because the aggregation summed a
  // `partitions` array that lives one level deeper than it looked for.
  assert.ok(Number(tile.total_gb) > 0, `total_gb was ${tile.total_gb}`);
  assert.ok(Number(tile.used_gb) > 0, `used_gb was ${tile.used_gb}`);
  assert.equal(tile.total_gb, storage.totalGb);
  assert.equal(tile.used_gb, storage.usedGb);
});

test("a full recorder that is healthy reads as recycling, not as a failure", () => {
  // The reference device runs at 100% for its whole service life: it fills the
  // disk once and then overwrites the oldest footage. Flagging that as an error
  // trains the operator to ignore the storage tile.
  const tile = __testables.storageStateFrom({
    totalGb: 931, usedGb: 931, usedPercent: 100, full: true, healthy: true,
    diskCount: 1, partitionCount: 4,
  });
  assert.equal(tile.health_label, "recycling");
  assert.notEqual(tile.health_label, "error");
});

test("a genuinely unhealthy disk reads as an error even when not full", () => {
  const tile = __testables.storageStateFrom({
    totalGb: 931, usedGb: 100, usedPercent: 11, full: false, healthy: false,
    diskCount: 1, partitionCount: 4,
  });
  assert.equal(tile.health_label, "error");
});

test("storage that could not be read is unknown, never zero", () => {
  const tile = __testables.storageStateFrom(null);
  assert.equal(tile.status, "unknown");
  assert.equal(tile.total_gb, null);
  assert.notEqual(tile.total_gb, 0);
});

test("health is unknown rather than ok when the device did not say", () => {
  const tile = __testables.storageStateFrom({ totalGb: 931, usedGb: 400, healthy: null, full: null });
  assert.equal(tile.health_label, "unknown");
});

/* ------------------------------------------------------------------ *
 * Clock
 * ------------------------------------------------------------------ */

test("the real recorder's clock reaches the dashboard populated", () => {
  const time = parseSystemTime(
    parseDahuaResponse(fixture("current-time-real.txt")),
    parseDahuaConfig(fixture("ntp-real.txt")),
  );
  const tile = __testables.clockStateFrom(time);

  assert.equal(tile.status, "known");
  assert.ok(tile.device_time, "device_time must be populated");
  // NTP is OFF on the reference recorder. Asserting the concrete value rather
  // than tile === parser, which would pass with both of them null.
  assert.equal(tile.ntp_enabled, false);
  assert.equal(tile.warn, true, "an untrusted clock must warn");
});

test("NTP disabled raises the warning the operator must see", () => {
  // NTP is off on the reference device and this build must NOT enable it —
  // that is an explicit approval gate. So the only correct behaviour is to
  // surface it, every time, wherever a timestamp is trusted.
  const tile = __testables.clockStateFrom({
    deviceTime: new Date().toISOString().slice(0, 19).replace("T", " "),
    ntpEnabled: false,
    clockTrusted: false,
  });
  assert.equal(tile.warn, true);
});

test("a large drift warns even when NTP claims to be on", () => {
  const stale = new Date(Date.now() - 45 * 60 * 1000);
  const tile = __testables.clockStateFrom({
    deviceTime: `${stale.getFullYear()}-${String(stale.getMonth() + 1).padStart(2, "0")}-${String(stale.getDate()).padStart(2, "0")} ${String(stale.getHours()).padStart(2, "0")}:${String(stale.getMinutes()).padStart(2, "0")}:${String(stale.getSeconds()).padStart(2, "0")}`,
    ntpEnabled: true,
    clockTrusted: true,
  });
  assert.equal(tile.warn, true);
  assert.ok(Math.abs(tile.drift_seconds) > 60);
});

test("a trusted clock in sync does not warn", () => {
  const now = new Date();
  const tile = __testables.clockStateFrom({
    deviceTime: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
    ntpEnabled: true,
    clockTrusted: true,
  });
  assert.equal(tile.warn, false);
  assert.ok(Math.abs(tile.drift_seconds) < 60, `drift ${tile.drift_seconds}s — device time is parsed as LOCAL, not UTC`);
});

test("an unreadable clock is unknown and does not warn", () => {
  const tile = __testables.clockStateFrom(null);
  assert.equal(tile.status, "unknown");
  assert.equal(tile.ntp_enabled, null);
});
