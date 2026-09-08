import {
  OPEN_OFFLINE_ORDER_STATUSES,
  listOfflineOrders,
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
  const needsReview =
    openOrders.filter((order) => String(order.status || "") === "needs_review").length +
    expenses.filter((expense) => String(expense.status || "") === "needs_review").length;
  return {
    orders: openOrders.length,
    expenses: expenses.length,
    needsReview,
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

  let customers;
  try {
    customers = await retryPendingOfflineCustomers(undefined, { tenantId });
  } catch (error) {
    customers = { total: 0, synced: [], failed: [{ error: String(error?.message || error) }], idMap: {} };
  }

  let orders;
  try {
    orders = await retryPendingOfflineOrders();
  } catch (error) {
    orders = { total: 0, synced: [], failed: [{ error: String(error?.message || error) }] };
  }

  // Expenses last. An expense needs an open shift exactly as an invoice does, so
  // sending them after the invoices means one shift lookup has already proved
  // itself before the drawer withdrawals go out.
  let expenses;
  try {
    expenses = await retryPendingOfflineExpenses();
  } catch (error) {
    expenses = { total: 0, synced: [], failed: [{ error: String(error?.message || error) }] };
  }

  // Housekeeping runs after a successful pass, never before: a device that is
  // still offline must not lose anything to a prune it could not replace.
  void pruneSyncedOfflineOrders().catch(() => 0);
  void pruneSyncedOfflineCustomers().catch(() => 0);
  void pruneSyncedOfflineExpenses().catch(() => 0);

  return { skipped: false, reason: "", reachable, customers, orders, expenses };
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
  let inFlight = false;
  let currentInterval = minIntervalMs;
  let lastRunAt = 0;

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

  const run = async ({ reason = "timer", force = false } = {}) => {
    if (stopped || inFlight) return null;

    const work = await countOpenOfflineWork({ tenantId }).catch(() => ({ total: 0 }));
    if (!work.total) {
      // Nothing owed. Still probe, at the slow cadence: the point of the
      // connection pill is to warn the cashier *before* the first sale drops
      // into the queue, and an idle till would otherwise look connected right up
      // until an invoice failed.
      const reachable = await probeBackendReachable({ apiBaseUrl });
      currentInterval = maxIntervalMs;
      schedule(currentInterval);
      onResult?.({ reason, work, result: { skipped: true, reason: "idle", reachable, orders: null, customers: null } });
      return null;
    }

    inFlight = true;
    lastRunAt = nowMs();
    try {
      const result = await runOfflineSyncPass({ tenantId, apiBaseUrl, force });
      const nextWork = await countOpenOfflineWork({ tenantId }).catch(() => work);
      const madeProgress = Boolean(
        result?.orders?.synced?.length || result?.customers?.synced?.length || result?.expenses?.synced?.length
      );

      if (result.skipped || (!madeProgress && nextWork.total > 0)) {
        currentInterval = Math.min(maxIntervalMs, Math.max(minIntervalMs, currentInterval * SYNC_BACKOFF_FACTOR));
      } else {
        currentInterval = minIntervalMs;
      }

      onResult?.({ reason, work: nextWork, result });
      schedule(nextWork.total > 0 ? currentInterval : maxIntervalMs);
      return result;
    } finally {
      inFlight = false;
    }
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

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleFocus);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibility);
  }

  void run({ reason: "start" });

  return {
    syncNow: () => run({ reason: "manual", force: true }),
    refresh: () => wake("refresh"),
    stop: () => {
      stopped = true;
      clearTimer();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("focus", handleFocus);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    },
  };
};
