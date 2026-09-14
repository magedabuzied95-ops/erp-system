import {
  OPEN_OFFLINE_ORDER_STATUSES,
  isOfflineRecordOwnedByAnotherUser,
  listOfflineOrders,
  readCurrentPosUser,
  pruneSyncedOfflineOrders,
  retryPendingOfflineOrders,
} from "./posOfflineOrders.js";
import {
  listPendingOfflineCustomers,
  pruneSyncedOfflineCustomers,
  retryPendingOfflineCustomers,
} from "./posOfflineCustomers.js";
import {
  listOpenOfflineExpenses,
  pruneSyncedOfflineExpenses,
  retryPendingOfflineExpenses,
} from "./posOfflineExpenses.js";

// `navigator.onLine` answers "is there a link", never "can I reach the ERP".
// A counter on shop Wi-Fi with a dead uplink, a captive portal, or a backend
// that is simply down all report `true`, so the queue used to sit still while
// the cashier believed it was syncing. Every sync run starts from a real probe.
const REACHABILITY_PATH = "/health";
const REACHABILITY_TIMEOUT_MS = 6000;

// The queue drains on its own. The `online` event alone is not enough: it never
// fires when the outage was the backend rather than the link, and a device that
// was asleep can miss it entirely. So we also poll, back off while it keeps
// failing, and probe again whenever the cashier returns to the tab.
const SYNC_INTERVAL_MIN_MS = 15000;
const SYNC_INTERVAL_MAX_MS = 5 * 60 * 1000;
const SYNC_BACKOFF_FACTOR = 2;

const nowMs = () => Date.now();

// Dispatched by shared/auth/authStorage on every login, logout and user refresh.
const AUTH_USER_UPDATED_EVENT = "erp:auth-user-updated";

/** What a pass request answers while another pass is still sending. */
export const BUSY_RESULT = Object.freeze({
  skipped: true,
  status: "busy",
  reason: "busy",
  reachable: null,
  orders: null,
  customers: null,
  expenses: null,
});

/**
 * Fetches the POS screens that are split into their own chunks while the line is
 * up, so the service worker's runtime cache holds them before an outage. Without
 * this the first tap on "restock" or "online order" during an outage asked the
 * network for a chunk it had never seen. Idle, best-effort, once per page.
 */
let offlineScreensWarmed = false;
export const warmOfflinePosScreens = (
  loaders = [
    () => import("../components/PosRestockModal.jsx"),
    () => import("../components/PosOnlineOrderModal.jsx"),
  ]
) => {
  if (offlineScreensWarmed) return Promise.resolve(false);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve(false);
  offlineScreensWarmed = true;
  return Promise.allSettled(loaders.map((load) => Promise.resolve().then(load))).then((results) => {
    // A failed warm is retried on the next call rather than remembered as done.
    if (results.some((entry) => entry.status === "rejected")) offlineScreensWarmed = false;
    return results.every((entry) => entry.status === "fulfilled");
  });
};

// `/health` is served under the API prefix (`/api/health`) as well as at the
// root. Only the prefixed form survives the SPA host's rewrite -- on Vercel just
// `/api/*` is forwarded to the backend, so a bare `/health` would be answered by
// the SPA shell with a 200 and the till would believe it was online.
const resolveReachabilityUrl = (apiBaseUrl = "") => {
  const base = String(apiBaseUrl || "").replace(/\/$/, "");
  if (!base) return `/api${REACHABILITY_PATH}`;
  return `${base}${REACHABILITY_PATH}`;
};

/**
 * Is the ERP actually answering? A network error, a timeout and a 5xx all count
 * as "no" -- the queue holds. Any other answer, including a 401, counts as
 * "yes": the server is up, and an auth problem is a different failure that the
 * per-record sync will classify on its own.
 */
export const probeBackendReachable = async ({
  apiBaseUrl = "",
  timeoutMs = REACHABILITY_TIMEOUT_MS,
  fetchImpl,
} = {}) => {
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await doFetch(resolveReachabilityUrl(apiBaseUrl), {
      method: "GET",
      cache: "no-store",
      signal: controller?.signal,
    });
    if (!response) return false;
    if (Number(response.status || 0) >= 500) return false;
    // The health endpoint answers JSON. A captive portal's login page and a
    // static host's SPA fallback both answer 200 with HTML, and treating either
    // as "the ERP is up" is exactly the false green light this probe exists to
    // prevent.
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    return contentType.includes("json");
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const countOpenOfflineWork = async ({ tenantId } = {}) => {
  const [orders, customers, expenses] = await Promise.all([
    listOfflineOrders().catch(() => []),
    listPendingOfflineCustomers({ tenantId }).catch(() => []),
    listOpenOfflineExpenses().catch(() => []),
  ]);
  const openOrders = orders.filter((order) =>
    OPEN_OFFLINE_ORDER_STATUSES.includes(String(order.status || ""))
  );
  const currentUser = readCurrentPosUser();
  // Still counted in the drawer block: the cash from another cashier's queued
  // sale is physically in this drawer. Reported separately so the UI can say
  // whose login it is waiting for.
  const foreignOwner =
    openOrders.filter((order) => isOfflineRecordOwnedByAnotherUser(order, currentUser)).length +
    expenses.filter((expense) => isOfflineRecordOwnedByAnotherUser(expense, currentUser)).length;
  const needsReview =
    openOrders.filter((order) => String(order.status || "") === "needs_review").length +
    expenses.filter((expense) => String(expense.status || "") === "needs_review").length;
  return {
    orders: openOrders.length,
    expenses: expenses.length,
    needsReview,
    foreignOwner,
    customers: customers.length,
    // Expenses count toward the shift-close block alongside invoices: both move
    // cash in the drawer the close is about to settle.
    drawerAffecting: openOrders.length + expenses.length,
    total: openOrders.length + customers.length + expenses.length,
  };
};

/**
 * One sync pass. Customers go first on purpose: the order's own payload can
 * create the account from the phone, but sending the queued customer first is
 * what preserves the source attribution and the personal-transaction flag on
 * the record the order then links to.
 */
export const runOfflineSyncPass = async ({ tenantId, apiBaseUrl = "", force = false } = {}) => {
  // The probe runs either way. `force` decides whether it *gates* the pass --
  // a cashier pressing "sync now" gets the attempt regardless -- but the result
  // is still reported, so the connection pill never turns green on the strength
  // of a button press alone.
  const reachable = await probeBackendReachable({ apiBaseUrl });
  if (!reachable && !force) {
    return { skipped: true, reason: "unreachable", reachable, customers: null, orders: null };
  }

  // Once any queue hears "log in again", the rest of the pass is skipped: the
  // session is gone for all of them, and each skipped record stays pending
  // untouched rather than collecting a failure it did not earn.
  const skippedForLogin = () => ({ total: 0, synced: [], failed: [], skipped_login_required: true });

  let customers;
  try {
    customers = await retryPendingOfflineCustomers(undefined, { tenantId });
  } catch (error) {
    customers = { total: 0, synced: [], failed: [{ error: String(error?.message || error) }], idMap: {} };
  }

  let orders;
  if (customers?.login_required) {
    orders = skippedForLogin();
  } else {
    try {
      orders = await retryPendingOfflineOrders();
    } catch (error) {
      orders = { total: 0, synced: [], failed: [{ error: String(error?.message || error) }] };
    }
  }

  // Expenses last. An expense needs an open shift exactly as an invoice does, so
  // sending them after the invoices means one shift lookup has already proved
  // itself before the drawer withdrawals go out.
  let expenses;
  if (customers?.login_required || orders?.login_required) {
    expenses = skippedForLogin();
  } else {
    try {
      expenses = await retryPendingOfflineExpenses();
    } catch (error) {
      expenses = { total: 0, synced: [], failed: [{ error: String(error?.message || error) }] };
    }
  }

  const loginRequired = Boolean(customers?.login_required || orders?.login_required || expenses?.login_required);

  // Housekeeping runs after a successful pass, never before: a device that is
  // still offline must not lose anything to a prune it could not replace.
  void pruneSyncedOfflineOrders().catch(() => 0);
  void pruneSyncedOfflineCustomers().catch(() => 0);
  void pruneSyncedOfflineExpenses().catch(() => 0);

  return {
    skipped: false,
    status: loginRequired ? "login_required" : "done",
    reason: loginRequired ? "login_required" : "",
    loginRequired,
    reachable,
    customers,
    orders,
    expenses,
  };
};

/**
 * Keeps the queue draining for as long as the POS is open. Returns a stop
 * function plus `syncNow` for the cashier's explicit "sync now" button, which
 * bypasses the backoff -- a person pressing a button is a better signal than
 * any timer.
 */
export const createOfflineSyncScheduler = ({
  tenantId,
  apiBaseUrl = "",
  onResult,
  minIntervalMs = SYNC_INTERVAL_MIN_MS,
  maxIntervalMs = SYNC_INTERVAL_MAX_MS,
} = {}) => {
  let stopped = false;
  let timer = null;
  let inFlightPass = null;
  let followUp = null;
  let currentInterval = minIntervalMs;
  let lastRunAt = 0;
  let loginRequired = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (delayMs) => {
    if (stopped) return;
    clearTimer();
    timer = setTimeout(() => {
      void run({ reason: "timer" });
    }, Math.max(1000, delayMs));
  };

  const run = ({ reason = "timer", force = false } = {}) => {
    if (stopped) return Promise.resolve(null);
    if (inFlightPass) {
      // A pass is already sending. That is not "no connection" -- the old null
      // read exactly like one, and a Retry pressed mid-pass then waited for the
      // backoff timer (up to five minutes). Remember the request; it runs the
      // moment the current pass ends.
      followUp = { reason, force: Boolean(force || followUp?.force) };
      return Promise.resolve({ ...BUSY_RESULT });
    }
    inFlightPass = runPass({ reason, force }).finally(() => {
      inFlightPass = null;
      const next = followUp;
      followUp = null;
      if (next && !stopped) void run(next);
    });
    return inFlightPass;
  };

  const runPass = async ({ reason, force }) => {
    const work = await countOpenOfflineWork({ tenantId }).catch(() => ({ total: 0 }));
    if (!work.total) {
      // Nothing owed. Still probe, at the slow cadence: the point of the
      // connection pill is to warn the cashier *before* the first sale drops
      // into the queue, and an idle till would otherwise look connected right up
      // until an invoice failed.
      const reachable = await probeBackendReachable({ apiBaseUrl });
      currentInterval = maxIntervalMs;
      schedule(currentInterval);
      const idle = { skipped: true, status: "idle", reason: "idle", reachable, orders: null, customers: null };
      onResult?.({ reason, work, result: idle });
      return idle;
    }

    lastRunAt = nowMs();
    const result = await runOfflineSyncPass({ tenantId, apiBaseUrl, force });
    const nextWork = await countOpenOfflineWork({ tenantId }).catch(() => work);
    const madeProgress = Boolean(
      result?.orders?.synced?.length || result?.customers?.synced?.length || result?.expenses?.synced?.length
    );
    loginRequired = Boolean(result?.loginRequired);

    if (result.skipped || (!madeProgress && nextWork.total > 0)) {
      currentInterval = Math.min(maxIntervalMs, Math.max(minIntervalMs, currentInterval * SYNC_BACKOFF_FACTOR));
    } else {
      currentInterval = minIntervalMs;
    }

    onResult?.({ reason, work: nextWork, result });
    schedule(nextWork.total > 0 ? currentInterval : maxIntervalMs);
    return result;
  };

  // The cashier's button waits for a pass that is already running and then runs
  // its own, so what it reports is a real outcome, never "busy".
  const syncNow = async ({ wait = true } = {}) => {
    if (!wait) return run({ reason: "manual", force: true });
    for (let attempt = 0; attempt < 3 && inFlightPass; attempt += 1) {
      await inFlightPass.catch(() => null);
    }
    if (inFlightPass) return { ...BUSY_RESULT };
    return run({ reason: "manual", force: true });
  };

  // A fresh login is the one thing that frees a queue held for "login required".
  const handleAuthChanged = (event) => {
    if (event?.detail && event.detail.user === null) return;
    wake("login");
  };

  const wake = (reason) => {
    if (stopped) return;
    // A wake signal resets the backoff: the world just changed.
    currentInterval = minIntervalMs;
    if (nowMs() - lastRunAt < 2000) {
      schedule(currentInterval);
      return;
    }
    void run({ reason });
  };

  const handleOnline = () => wake("online");
  const handleVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") wake("visible");
  };
  const handleFocus = () => wake("focus");

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
    window.addEventListener(AUTH_USER_UPDATED_EVENT, handleAuthChanged);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }

  void run({ reason: "start" });

  return {
    syncNow,
    refresh: () => wake("refresh"),
    isSyncing: () => Boolean(inFlightPass),
    isLoginRequired: () => loginRequired,
    stop: () => {
      stopped = true;
      clearTimer();
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("focus", handleFocus);
        window.removeEventListener(AUTH_USER_UPDATED_EVENT, handleAuthChanged);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    },
  };
};
