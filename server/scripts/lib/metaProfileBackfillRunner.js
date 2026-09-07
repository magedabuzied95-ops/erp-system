/*
 * The Meta profile backfill, with every outside dependency injected: candidates,
 * the refresh call, the Graph budget predicate, the clock, sleep, the state store
 * and the lock directory. The CLI in ../backfillMetaCustomerProfiles.js wires the
 * real ones; the tests wire fakes and drive the clock.
 *
 * Rules the runner enforces:
 *   - It never waits for the Graph budget without a ceiling. Every pause is bounded,
 *     every pause counts toward one total wait budget, and when that budget is spent
 *     the run stops with exit code 75, the state saved, and a suggested retry time.
 *   - It never reads a stale "under pressure" verdict as permanent: the verdict is
 *     asked fresh before every customer, and the limiter's own usage reading expires.
 *   - One run at a time: an atomic lock file with the holder's pid; a lock whose pid
 *     is dead or whose age passed the stale threshold is taken over.
 *   - Small batches, paced calls, an optional ceiling on Graph calls per run, and a
 *     resumable state file: a customer refreshed within --skip-hours is skipped, an
 *     id Meta refused is skipped for a week.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const text = (value = "") => String(value ?? "").trim();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const EXIT_CODES = Object.freeze({
  OK: 0,
  FATAL: 1,
  INTERRUPTED: 2,
  LOCKED: 3,
  WAIT_BUDGET_EXHAUSTED: 75, // EX_TEMPFAIL: try again later
});

export const STOP_REASONS = Object.freeze({
  COMPLETED: "completed",
  MAX_CALLS: "max_calls_reached",
  WAIT_BUDGET: "graph_budget_wait_exhausted",
  INTERRUPTED: "interrupted",
});

// ---------------------------------------------------------------------------
// Where state, lock and log files live. Never assumes /app/uploads exists.
// ---------------------------------------------------------------------------
export const resolveBackfillDir = ({
  explicit = "",
  candidates = ["/app/uploads/backfill", path.resolve("server/data/backfill")],
  fsModule = fs,
  fallback = path.join(os.tmpdir(), "erp-meta-profile-backfill"),
} = {}) => {
  const tried = [];
  for (const candidate of [text(explicit), ...candidates].filter(Boolean)) {
    try {
      fsModule.mkdirSync(candidate, { recursive: true });
      fsModule.accessSync(candidate, fsModule.constants.W_OK);
      return { dir: candidate, tried };
    } catch (error) {
      tried.push({ dir: candidate, error: error?.code || error?.message || "unwritable" });
    }
  }
  fsModule.mkdirSync(fallback, { recursive: true });
  return { dir: fallback, tried };
};

// ---------------------------------------------------------------------------
// Lock: atomic create (wx). Holder pid + start time inside so a stale lock from a
// killed run can be recognised and taken over; a live holder is refused.
// ---------------------------------------------------------------------------
const defaultIsPidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

export const acquireBackfillLock = ({
  dir,
  name = "meta-profile-backfill.lock",
  pid = process.pid,
  now = () => Date.now(),
  staleMs = 6 * 60 * 60 * 1000,
  isPidAlive = defaultIsPidAlive,
  fsModule = fs,
} = {}) => {
  const file = path.join(dir, name);
  const payload = () => JSON.stringify({ pid, started_at: new Date(now()).toISOString(), host: os.hostname() });
  const tryCreate = () => {
    const handle = fsModule.openSync(file, "wx");
    fsModule.writeSync(handle, payload());
    fsModule.closeSync(handle);
  };
  const release = () => {
    try {
      const current = JSON.parse(fsModule.readFileSync(file, "utf8"));
      if (Number(current?.pid) !== Number(pid)) return false;
    } catch {
      return false;
    }
    try {
      fsModule.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  };
  try {
    tryCreate();
    return { acquired: true, file, release, holder: null, takenOver: false };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  let holder = null;
  try {
    holder = JSON.parse(fsModule.readFileSync(file, "utf8"));
  } catch {
    holder = null;
  }
  const holderPid = Number(holder?.pid) || 0;
  const startedAt = Date.parse(holder?.started_at || "") || 0;
  const alive = holderPid > 0 && holderPid !== pid && isPidAlive(holderPid);
  const stale = !alive || (startedAt > 0 && now() - startedAt > staleMs);
  if (!stale) {
    return { acquired: false, file, release: () => false, holder, takenOver: false };
  }
  try {
    fsModule.unlinkSync(file);
    tryCreate();
    return { acquired: true, file, release, holder, takenOver: true };
  } catch (error) {
    if (error?.code === "EEXIST") return { acquired: false, file, release: () => false, holder, takenOver: false };
    throw error;
  }
};

// ---------------------------------------------------------------------------
// State store: one JSON file, written after every customer so a kill loses at most
// the customer in flight.
// ---------------------------------------------------------------------------
export const emptyState = (now = () => Date.now()) => ({
  started_at: new Date(now()).toISOString(),
  done: {},
  unavailable: {},
  failed: {},
  last_stop: null,
});

export const createFileStateStore = ({ file, fsModule = fs, readOnly = false, now = () => Date.now() } = {}) => ({
  file,
  load: () => {
    try {
      const parsed = JSON.parse(fsModule.readFileSync(file, "utf8"));
      return { ...emptyState(now), ...parsed, done: parsed.done || {}, unavailable: parsed.unavailable || {}, failed: parsed.failed || {} };
    } catch {
      return emptyState(now);
    }
  },
  save: (state) => {
    if (readOnly) return false;
    state.updated_at = new Date(now()).toISOString();
    const tmp = `${file}.${process.pid}.tmp`;
    fsModule.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fsModule.renameSync(tmp, file);
    return true;
  },
});

export const createMemoryStateStore = ({ initial = null, now = () => Date.now() } = {}) => {
  let current = initial ? JSON.parse(JSON.stringify(initial)) : emptyState(now);
  return {
    file: "memory",
    load: () => JSON.parse(JSON.stringify(current)),
    save: (state) => {
      state.updated_at = new Date(now()).toISOString();
      current = JSON.parse(JSON.stringify(state));
      return true;
    },
    peek: () => current,
  };
};

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------
export const candidateKey = (row) => `${row.channel}:${row.external_customer_id}`;

const recentlyDone = ({ state, key, skipHours, force, now }) => {
  if (force || !skipHours) return false;
  const entry = state.done?.[key];
  if (!entry?.at) return false;
  return now() - Date.parse(entry.at) < skipHours * 60 * 60 * 1000;
};

const rememberedUnavailable = ({ state, key, force, now, unavailableRetryMs }) => {
  if (force) return false;
  const entry = state.unavailable?.[key];
  if (!entry?.at) return false;
  return now() - Date.parse(entry.at) < unavailableRetryMs;
};

/**
 * @param {object} deps
 * @param {Array} deps.candidates            rows: { channel, external_customer_id, ... }
 * @param {(row) => Promise<{has_name,has_username,has_avatar,updated_rows}>} deps.refresh
 * @param {() => {defer:boolean, reason:string, retry_after_ms:number, pressure:number}} deps.shouldDefer
 * @param {(ms:number) => Promise<void>} deps.sleep
 * @param {() => number} deps.now
 * @param {{load:Function, save:Function}} deps.stateStore
 * @param {(error) => boolean} deps.isRateLimitError
 * @param {(error) => {kind:string, code:number, subcode:number}} deps.classifyError
 * @param {(...parts) => void} deps.log
 * @param {{aborted:boolean}} [deps.signal]  AbortSignal or any object with .aborted
 */
export const runMetaProfileBackfill = async ({
  candidates = [],
  refresh,
  shouldDefer = () => ({ defer: false, reason: "", retry_after_ms: 0, pressure: 0 }),
  sleep,
  now = () => Date.now(),
  stateStore,
  isRateLimitError = () => false,
  classifyError = (error) => ({ kind: "unknown", code: 0, subcode: 0, message: error?.message || "" }),
  log = () => {},
  signal = null,
  options = {},
} = {}) => {
  const {
    dryRun = false,
    force = false,
    batch = 25,
    paceMs = 400,
    batchPauseMs = 3000,
    skipHours = 24,
    unavailableRetryMs = 7 * 24 * 60 * 60 * 1000,
    maxWaitMs = 15 * 60 * 1000, // total time this run may spend waiting for the Graph budget
    maxPauseMs = 60 * 1000, // one pause never longer than this, whatever the limiter suggests
    minPauseMs = 5 * 1000,
    rateLimitSleepMs = 65 * 1000,
    maxCalls = 0, // 0 = no ceiling on Graph calls in this run
    rateLimitRetries = 2,
  } = options;
  if (typeof refresh !== "function") throw new TypeError("runMetaProfileBackfill requires refresh()");
  if (typeof sleep !== "function") throw new TypeError("runMetaProfileBackfill requires sleep()");
  if (!stateStore) throw new TypeError("runMetaProfileBackfill requires a stateStore");

  const state = stateStore.load();
  const summary = {
    candidates: candidates.length,
    processed: 0,
    skipped_recent: 0,
    skipped_unavailable: 0,
    named: 0,
    pictured: 0,
    refused: 0,
    failed: 0,
    rate_limited: 0,
    graph_calls: 0,
    waited_ms: 0,
    pauses: 0,
  };
  let waitedMs = 0;
  let inBatch = 0;
  let stopReason = STOP_REASONS.COMPLETED;
  let retryAt = null;
  let exitCode = EXIT_CODES.OK;
  const interrupted = () => Boolean(signal?.aborted);

  const finish = (reason, code, extra = {}) => {
    stopReason = reason;
    exitCode = code;
    state.last_stop = {
      at: new Date(now()).toISOString(),
      reason,
      exit_code: code,
      retry_at: retryAt ? new Date(retryAt).toISOString() : null,
      summary: { ...summary, waited_ms: waitedMs },
      ...extra,
    };
    stateStore.save(state);
    return { exitCode, stopReason, retryAt, summary: { ...summary, waited_ms: waitedMs }, state };
  };

  // Wait for the Graph budget, bounded. Returns false when the wait budget is spent.
  const waitForBudget = async () => {
    for (;;) {
      if (interrupted()) return true;
      const verdict = shouldDefer() || {};
      if (!verdict.defer) return true;
      const remaining = maxWaitMs - waitedMs;
      if (remaining <= 0) {
        retryAt = now() + clamp(Number(verdict.retry_after_ms) || minPauseMs, minPauseMs, 60 * 60 * 1000);
        return false;
      }
      const suggested = Number(verdict.retry_after_ms) || 30 * 1000;
      const pause = Math.min(clamp(suggested, minPauseMs, maxPauseMs), remaining);
      summary.pauses += 1;
      log(`Graph budget under pressure (${verdict.reason || "unknown"}, pressure=${Number(verdict.pressure) || 0}) — pausing ${Math.round(pause / 1000)}s, ${Math.round((remaining - pause) / 1000)}s of wait budget left`);
      await sleep(pause);
      waitedMs += pause;
    }
  };

  for (const row of candidates) {
    if (interrupted()) return finish(STOP_REASONS.INTERRUPTED, EXIT_CODES.INTERRUPTED);
    const key = candidateKey(row);
    if (recentlyDone({ state, key, skipHours, force, now })) {
      summary.skipped_recent += 1;
      continue;
    }
    if (rememberedUnavailable({ state, key, force, now, unavailableRetryMs })) {
      summary.skipped_unavailable += 1;
      continue;
    }
    if (dryRun) {
      log(`would refresh ${key}`);
      summary.processed += 1;
      continue;
    }
    if (maxCalls > 0 && summary.graph_calls >= maxCalls) {
      log(`reached --max-calls ${maxCalls}; stopping with the rest pending for the next run`);
      return finish(STOP_REASONS.MAX_CALLS, EXIT_CODES.OK);
    }
    if (!(await waitForBudget())) {
      log(`Graph budget stayed under pressure for ${Math.round(waitedMs / 1000)}s (limit ${Math.round(maxWaitMs / 1000)}s); stopping safely. Retry after ${new Date(retryAt).toISOString()}.`);
      return finish(STOP_REASONS.WAIT_BUDGET, EXIT_CODES.WAIT_BUDGET_EXHAUSTED);
    }
    if (interrupted()) return finish(STOP_REASONS.INTERRUPTED, EXIT_CODES.INTERRUPTED);

    let attempt = 0;
    let settled = false;
    while (!settled) {
      attempt += 1;
      summary.graph_calls += 1;
      try {
        const outcome = await refresh(row);
        summary.processed += 1;
        if (outcome?.has_name) summary.named += 1;
        if (outcome?.has_avatar) summary.pictured += 1;
        state.done[key] = { at: new Date(now()).toISOString(), ...(outcome || {}) };
        delete state.failed[key];
        if (!outcome?.has_name && !outcome?.has_avatar && !outcome?.has_username) {
          summary.refused += 1;
          state.unavailable[key] = { at: new Date(now()).toISOString() };
        } else {
          delete state.unavailable[key];
        }
        log(`${key} name=${outcome?.has_name ? "yes" : "no"} avatar=${outcome?.has_avatar ? "yes" : "no"} rows=${Number(outcome?.updated_rows || 0)}`);
        settled = true;
      } catch (error) {
        if (isRateLimitError(error) && attempt <= rateLimitRetries) {
          summary.rate_limited += 1;
          const remaining = maxWaitMs - waitedMs;
          if (remaining <= 0) {
            retryAt = now() + rateLimitSleepMs;
            stateStore.save(state);
            log(`rate limited and the wait budget is spent; stopping safely. Retry after ${new Date(retryAt).toISOString()}.`);
            return finish(STOP_REASONS.WAIT_BUDGET, EXIT_CODES.WAIT_BUDGET_EXHAUSTED);
          }
          const pause = Math.min(rateLimitSleepMs, remaining);
          summary.pauses += 1;
          log(`rate limited — sleeping ${Math.round(pause / 1000)}s before retrying ${key}`);
          await sleep(pause);
          waitedMs += pause;
          if (interrupted()) return finish(STOP_REASONS.INTERRUPTED, EXIT_CODES.INTERRUPTED);
          continue;
        }
        const classified = classifyError(error);
        summary.failed += 1;
        state.failed[key] = { at: new Date(now()).toISOString(), kind: classified.kind, code: classified.code, subcode: classified.subcode };
        if (classified.kind === "unavailable" || classified.kind === "permission") {
          state.unavailable[key] = { at: new Date(now()).toISOString(), kind: classified.kind };
        }
        log(`${key} failed: ${classified.kind} (${classified.code}/${classified.subcode})`);
        settled = true;
      }
    }
    stateStore.save(state);
    inBatch += 1;
    if (inBatch >= batch) {
      inBatch = 0;
      if (batchPauseMs > 0) await sleep(batchPauseMs);
    } else if (paceMs > 0) {
      await sleep(paceMs);
    }
  }
  return finish(STOP_REASONS.COMPLETED, EXIT_CODES.OK);
};
