import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  EXIT_CODES,
  STOP_REASONS,
  acquireBackfillLock,
  createFileStateStore,
  createMemoryStateStore,
  resolveBackfillDir,
  runMetaProfileBackfill,
} from "../server/scripts/lib/metaProfileBackfillRunner.js";

// A clock the tests drive: sleep() advances it instantly, so a "15 minute" wait
// budget is exhausted in microseconds and a hang would show up as a real timeout.
const makeClock = () => {
  let t = 1_700_000_000_000;
  const sleeps = [];
  return {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    advance: (ms) => { t += ms; },
  };
};
const rows = (count, channel = "facebook_messenger") =>
  Array.from({ length: count }, (_, index) => ({ channel, external_customer_id: String(1_000_000_000_000_000 + index) }));
const okRefresh = () => async () => ({ has_name: true, has_username: false, has_avatar: true, updated_rows: 3 });
const quiet = () => {};

test("low budget: the run starts immediately and refreshes every candidate", async () => {
  const clock = makeClock();
  let calls = 0;
  const result = await runMetaProfileBackfill({
    candidates: rows(4),
    refresh: async () => { calls += 1; return { has_name: true, has_avatar: true }; },
    shouldDefer: () => ({ defer: false, reason: "", retry_after_ms: 0, pressure: 12 }),
    sleep: clock.sleep,
    now: clock.now,
    stateStore: createMemoryStateStore({ now: clock.now }),
    log: quiet,
    options: { paceMs: 100, batch: 2, batchPauseMs: 500 },
  });
  assert.equal(result.exitCode, EXIT_CODES.OK);
  assert.equal(result.stopReason, STOP_REASONS.COMPLETED);
  assert.equal(calls, 4);
  assert.equal(result.summary.processed, 4);
  assert.equal(result.summary.pauses, 0);
  assert.equal(result.summary.waited_ms, 0);
});

test("high then low budget: the run waits (bounded pauses) and then completes", async () => {
  const clock = makeClock();
  const verdicts = [
    { defer: true, reason: "critical_pressure", retry_after_ms: 60_000, pressure: 95 },
    { defer: true, reason: "breaker_open", retry_after_ms: 600_000, pressure: 95 },
    { defer: false, reason: "", retry_after_ms: 0, pressure: 40 },
  ];
  let asked = 0;
  const result = await runMetaProfileBackfill({
    candidates: rows(3),
    refresh: okRefresh(),
    shouldDefer: () => { asked += 1; return verdicts[Math.min(asked - 1, verdicts.length - 1)]; },
    sleep: clock.sleep,
    now: clock.now,
    stateStore: createMemoryStateStore({ now: clock.now }),
    log: quiet,
    options: { paceMs: 0, batchPauseMs: 0, maxWaitMs: 15 * 60_000, maxPauseMs: 60_000 },
  });
  assert.equal(result.exitCode, EXIT_CODES.OK);
  assert.equal(result.summary.processed, 3);
  assert.equal(result.summary.pauses, 2);
  // the 10-minute suggestion was clamped to the 60s ceiling: no single blind wait
  assert.deepEqual(clock.sleeps, [60_000, 60_000]);
  assert.equal(result.summary.waited_ms, 120_000);
  assert.ok(asked >= 3, "the verdict is re-asked after every pause, never cached");
});

test("budget stays high: the run stops after the total wait limit with exit 75, state saved, retry time printed", async () => {
  const clock = makeClock();
  const store = createMemoryStateStore({ now: clock.now });
  const lines = [];
  let refreshCalls = 0;
  const result = await runMetaProfileBackfill({
    candidates: rows(5),
    refresh: async () => { refreshCalls += 1; return { has_name: true }; },
    shouldDefer: () => ({ defer: true, reason: "critical_pressure", retry_after_ms: 60_000, pressure: 99 }),
    sleep: clock.sleep,
    now: clock.now,
    stateStore: store,
    log: (line) => lines.push(line),
    options: { maxWaitMs: 5 * 60_000, maxPauseMs: 60_000 },
  });
  assert.equal(result.exitCode, EXIT_CODES.WAIT_BUDGET_EXHAUSTED);
  assert.equal(result.stopReason, STOP_REASONS.WAIT_BUDGET);
  assert.equal(refreshCalls, 0);
  assert.equal(result.summary.waited_ms, 5 * 60_000, "waited exactly the budget, not a millisecond more");
  assert.equal(clock.sleeps.length, 5);
  assert.ok(result.retryAt > clock.now(), "a retry time in the future is suggested");
  assert.ok(lines.some((line) => /stopping safely\. Retry after \d{4}-\d{2}-\d{2}T/.test(line)), lines.join("\n"));
  const saved = store.peek();
  assert.equal(saved.last_stop.reason, STOP_REASONS.WAIT_BUDGET);
  assert.equal(saved.last_stop.exit_code, 75);
  assert.ok(saved.last_stop.retry_at);
});

test("a stale verdict object is never mistaken for pressure: only verdict.defer decides", async () => {
  const clock = makeClock();
  let calls = 0;
  const result = await runMetaProfileBackfill({
    candidates: rows(2),
    refresh: async () => { calls += 1; return { has_name: true }; },
    // the object is truthy but says "do not defer" — the bug the production run hit
    shouldDefer: () => ({ defer: false, reason: "", retry_after_ms: 0, pressure: 0 }),
    sleep: clock.sleep,
    now: clock.now,
    stateStore: createMemoryStateStore({ now: clock.now }),
    log: quiet,
    options: { paceMs: 0 },
  });
  assert.equal(calls, 2);
  assert.equal(result.summary.pauses, 0);
});

test("interrupted then restarted: the second run resumes from the saved state without repeating", async () => {
  const clock = makeClock();
  const store = createMemoryStateStore({ now: clock.now });
  const controller = new AbortController();
  const refreshed = [];
  const first = await runMetaProfileBackfill({
    candidates: rows(6),
    refresh: async (row) => {
      refreshed.push(row.external_customer_id);
      if (refreshed.length === 3) controller.abort(); // the kill lands after customer 3
      return { has_name: true, has_avatar: true };
    },
    sleep: clock.sleep,
    now: clock.now,
    stateStore: store,
    signal: controller.signal,
    log: quiet,
    options: { paceMs: 0 },
  });
  assert.equal(first.exitCode, EXIT_CODES.INTERRUPTED);
  assert.equal(first.stopReason, STOP_REASONS.INTERRUPTED);
  assert.equal(refreshed.length, 3);
  assert.equal(Object.keys(store.peek().done).length, 3, "the three finished customers are on disk");

  const second = await runMetaProfileBackfill({
    candidates: rows(6),
    refresh: async (row) => { refreshed.push(row.external_customer_id); return { has_name: true, has_avatar: true }; },
    sleep: clock.sleep,
    now: clock.now,
    stateStore: store,
    log: quiet,
    options: { paceMs: 0, skipHours: 24 },
  });
  assert.equal(second.exitCode, EXIT_CODES.OK);
  assert.equal(second.summary.skipped_recent, 3);
  assert.equal(second.summary.processed, 3);
  assert.equal(refreshed.length, 6);
  assert.equal(new Set(refreshed).size, 6, "no customer refreshed twice");
});

test("the state file survives a crash mid-run and the next run picks it up (real filesystem)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-backfill-state-"));
  const file = path.join(dir, "state.json");
  const clock = makeClock();
  let calls = 0;
  await assert.rejects(runMetaProfileBackfill({
    candidates: rows(4),
    refresh: async () => { calls += 1; if (calls === 3) throw Object.assign(new Error("process died"), { fatal: true }); return { has_name: true }; },
    sleep: clock.sleep,
    now: clock.now,
    stateStore: createFileStateStore({ file, now: clock.now }),
    classifyError: (error) => { if (error.fatal) throw error; return { kind: "unknown", code: 0, subcode: 0 }; },
    log: quiet,
    options: { paceMs: 0 },
  }));
  const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(Object.keys(persisted.done).length, 2);
  const resumed = await runMetaProfileBackfill({
    candidates: rows(4),
    refresh: async () => { calls += 1; return { has_name: true }; },
    sleep: clock.sleep,
    now: clock.now,
    stateStore: createFileStateStore({ file, now: clock.now }),
    log: quiet,
    options: { paceMs: 0 },
  });
  assert.equal(resumed.summary.skipped_recent, 2);
  assert.equal(resumed.summary.processed, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("two instances: the second is refused while the first holds the lock; released or dead locks can be taken", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-backfill-lock-"));
  const first = acquireBackfillLock({ dir, pid: 4242, isPidAlive: (pid) => pid === 4242 });
  assert.equal(first.acquired, true);
  const second = acquireBackfillLock({ dir, pid: 4343, isPidAlive: (pid) => pid === 4242 });
  assert.equal(second.acquired, false);
  assert.equal(second.holder.pid, 4242);
  assert.equal(second.release(), false, "a refused instance cannot remove someone else's lock");
  assert.ok(fs.existsSync(first.file), "the live lock is still there");
  assert.equal(first.release(), true);
  assert.equal(fs.existsSync(first.file), false);
  // a lock left behind by a killed process (pid not alive) is taken over
  const orphan = acquireBackfillLock({ dir, pid: 5000, isPidAlive: () => false });
  assert.equal(orphan.acquired, true);
  const takeover = acquireBackfillLock({ dir, pid: 6000, isPidAlive: (pid) => pid === 6000 });
  assert.equal(takeover.acquired, true);
  assert.equal(takeover.takenOver, true);
  assert.equal(takeover.holder.pid, 5000);
  takeover.release();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--max-calls caps the Graph calls in one run and leaves the rest for the next", async () => {
  const clock = makeClock();
  let calls = 0;
  const store = createMemoryStateStore({ now: clock.now });
  const result = await runMetaProfileBackfill({
    candidates: rows(10),
    refresh: async () => { calls += 1; return { has_name: true }; },
    sleep: clock.sleep,
    now: clock.now,
    stateStore: store,
    log: quiet,
    options: { paceMs: 0, maxCalls: 3 },
  });
  assert.equal(calls, 3);
  assert.equal(result.summary.graph_calls, 3);
  assert.equal(result.stopReason, STOP_REASONS.MAX_CALLS);
  assert.equal(result.exitCode, EXIT_CODES.OK);
  assert.equal(Object.keys(store.peek().done).length, 3);
});

test("a rate-limit error pauses and retries, and its pauses count toward the same wait budget", async () => {
  const clock = makeClock();
  let attempts = 0;
  const result = await runMetaProfileBackfill({
    candidates: rows(1),
    refresh: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("(#4) Application request limit reached"), { status: 400, meta: { code: 4 } });
      return { has_name: true };
    },
    isRateLimitError: (error) => error?.meta?.code === 4,
    sleep: clock.sleep,
    now: clock.now,
    stateStore: createMemoryStateStore({ now: clock.now }),
    log: quiet,
    options: { paceMs: 0, rateLimitSleepMs: 65_000, maxWaitMs: 10 * 60_000 },
  });
  assert.equal(attempts, 2);
  assert.equal(result.summary.rate_limited, 1);
  assert.equal(result.summary.waited_ms, 65_000);
  assert.equal(result.exitCode, EXIT_CODES.OK);

  // and when the budget is already gone, a rate limit ends the run instead of looping
  const clock2 = makeClock();
  const exhausted = await runMetaProfileBackfill({
    candidates: rows(1),
    refresh: async () => { throw Object.assign(new Error("limit"), { meta: { code: 4 } }); },
    isRateLimitError: () => true,
    sleep: clock2.sleep,
    now: clock2.now,
    stateStore: createMemoryStateStore({ now: clock2.now }),
    log: quiet,
    options: { paceMs: 0, rateLimitSleepMs: 65_000, maxWaitMs: 0 },
  });
  assert.equal(exhausted.exitCode, EXIT_CODES.WAIT_BUDGET_EXHAUSTED);
  assert.ok(exhausted.retryAt);
});

test("the state/lock directory is created when missing and falls back past unwritable candidates", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "meta-backfill-dir-"));
  const wanted = path.join(base, "deep", "uploads", "backfill");
  const { dir, tried } = resolveBackfillDir({
    explicit: "",
    candidates: [path.join(base, "not-allowed"), wanted],
    fsModule: {
      ...fs,
      constants: fs.constants,
      mkdirSync: (target, opts) => { if (target.includes("not-allowed")) { const e = new Error("EACCES"); e.code = "EACCES"; throw e; } return fs.mkdirSync(target, opts); },
      accessSync: fs.accessSync,
    },
    fallback: path.join(base, "fallback"),
  });
  assert.equal(dir, wanted);
  assert.ok(fs.existsSync(wanted));
  assert.deepEqual(tried.map((entry) => entry.error), ["EACCES"]);
  fs.rmSync(base, { recursive: true, force: true });
});

test("the CLI wires the runner and offers no flag that disables rate-limit protection", () => {
  const cli = fs.readFileSync(new URL("../server/scripts/backfillMetaCustomerProfiles.js", import.meta.url), "utf8");
  assert.match(cli, /shouldDefer: shouldDeferBackgroundGraphWork/);
  assert.match(cli, /lane: "background"/);
  assert.match(cli, /acquireBackfillLock\(/);
  assert.match(cli, /META_PROFILE_BACKFILL_MAX_WAIT_MS/);
  assert.match(cli, /lock\.release\(\)/);
  assert.doesNotMatch(cli, /while \(shouldDeferBackgroundGraphWork\(\)\)/, "the truthy-object loop is gone");
  assert.doesNotMatch(cli, /ignore-rate-limit|skip-rate-limit|no-limiter|unsafe/i);
});
