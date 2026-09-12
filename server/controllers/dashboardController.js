import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  getAiInsights,
  getBranchPerformance,
  getDashboardOverview,
  getHourlySales,
  getInventoryIntelligence,
  getLiveActivity,
  getLowStock,
  getMarketingAnalytics,
  getPaymentAnalytics,
  getPosLive,
  getSalesTrend,
  getTopProducts,
  resolveBusinessDayWindow,
  trackDashboardFailures,
} from "../services/dashboardAnalyticsService.js";

const resolveTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));
const normalizedRole = (user = {}) =>
  String(user.role_name || user.role || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
const isCashier = (user) => normalizedRole(user).includes("cashier");
export const dashboardFilters = (req) => {
  const cashierOnlyToday = isCashier(req.user);
  return {
    range: cashierOnlyToday ? "today" : req.query.range || "today",
    dateFrom: cashierOnlyToday ? "" : req.query.date_from || req.query.dateFrom || "",
    dateTo: cashierOnlyToday ? "" : req.query.date_to || req.query.dateTo || "",
    branchId: req.query.branch_id || req.query.branchId || "",
  };
};

/*
 * The dashboard's "today" is the shop's trading day: 05:00 → 05:00 the next morning (owner
 * request 2026-09-12). A sale rung up at 02:00 belongs to last night's takings, not to a new day
 * that has barely started. "yesterday" is the trading day before it. 7d / month / custom keep
 * their calendar meaning — nobody reads a month as starting at 05:00 on the 1st.
 *
 * Deliberately NOT the manager portal's `pos.business_day_start_hour` (04:00): that setting is
 * the portal's, and moving it would move the portal's day card too.
 */
export const DASHBOARD_DAY_START_HOUR = 5;
const DAY_OFFSETS = { today: 0, yesterday: -1 };

export const resolveDashboardFilters = async (req) => {
  const filters = dashboardFilters(req);
  if (!(filters.range in DAY_OFFSETS)) return filters;
  const window = await resolveBusinessDayWindow({ startHour: DASHBOARD_DAY_START_HOUR, dayOffset: DAY_OFFSETS[filters.range] });
  return window ? { ...filters, ...window } : filters;
};

/*
 * `degraded` is only present when something actually failed.
 *
 * It names the queries that blew up while this response was being built, so a zero on screen
 * can be told apart from a zero in the database. Without it the marketing card reported "0
 * sales from marketing" for weeks while its query was being rejected outright — and that is a
 * number people make spending decisions on.
 */
const send = (res, data, failures = []) => res.status(200).json({
  success: true,
  data,
  ...(failures.length
    ? { degraded: failures.map((failure) => failure.name), degraded_detail: failures }
    : {}),
});
const ERP_PERF_DEBUG = ["1", "true", "yes", "on"].includes(String(process.env.ERP_PERF_DEBUG || "").toLowerCase());
const isPoolTimeout = (error = {}) =>
  String(error?.message || "").toLowerCase().includes("timeout exceeded when trying to connect");

const fail = (req, res, error) => {
  console.error("[dashboard] route error", {
    requestId: req.id,
    route: req.originalUrl,
    message: error.message,
    code: error.code,
    stack: error.stack,
  });
  return res.status(500).json({
    success: false,
    message: isPoolTimeout(error) ? "Database is busy. Please retry shortly." : error.message || "Dashboard analytics failed",
    code: isPoolTimeout(error) ? "DB_POOL_TIMEOUT" : "DASHBOARD_ERROR",
  });
};

const route = (name, handler) => async (req, res) => {
  const startedAt = Date.now();
  if (ERP_PERF_DEBUG) console.log("[erp-perf] dashboard route start", {
    requestId: req.id,
    name,
    url: req.originalUrl,
    query: req.query,
  });

  try {
    const { result: data, failures } = await trackDashboardFailures(() => handler(req));
    if (ERP_PERF_DEBUG) console.log("[erp-perf] dashboard route end", {
      requestId: req.id,
      name,
      durationMs: Date.now() - startedAt,
    });
    if (failures.length) {
      // Warn, not error: the response still went out. This is the line that says a panel is
      // lying, and it names the query so it can be found without reading every log above it.
      console.warn("[dashboard] degraded response", {
        requestId: req.id,
        name,
        failed_queries: failures.map((failure) => failure.name),
        codes: failures.map((failure) => failure.code).filter(Boolean),
      });
    }
    return send(res, data, failures);
  } catch (error) {
    console.error("[dashboard] route thrown", {
      requestId: req.id,
      name,
      durationMs: Date.now() - startedAt,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return fail(req, res, error);
  }
};

export const overview = route("overview", async (req) =>
  getDashboardOverview({ tenantId: resolveTenantId(req), filters: await resolveDashboardFilters(req) })
);

export const salesTrend = route("salesTrend", (req) =>
  getSalesTrend({ tenantId: resolveTenantId(req), days: isCashier(req.user) ? 1 : req.query.days, filters: dashboardFilters(req) })
);

export const topProducts = route("topProducts", async (req) =>
  getTopProducts({ tenantId: resolveTenantId(req), limit: req.query.limit, filters: await resolveDashboardFilters(req) })
);

export const lowStock = route("lowStock", (req) =>
  getLowStock({ tenantId: resolveTenantId(req), limit: req.query.limit })
);

export const liveActivity = route("liveActivity", (req) =>
  getLiveActivity({ tenantId: resolveTenantId(req), limit: req.query.limit })
);

export const branchPerformance = route("branchPerformance", async (req) =>
  getBranchPerformance({ tenantId: resolveTenantId(req), filters: await resolveDashboardFilters(req) })
);

export const paymentAnalytics = route("paymentAnalytics", async (req) =>
  getPaymentAnalytics({ tenantId: resolveTenantId(req), filters: await resolveDashboardFilters(req) })
);

export const hourlySales = route("hourlySales", async (req) =>
  getHourlySales({ tenantId: resolveTenantId(req), filters: await resolveDashboardFilters(req) })
);

export const marketing = route("marketing", async (req) =>
  getMarketingAnalytics({ tenantId: resolveTenantId(req), filters: await resolveDashboardFilters(req) })
);

// Always the live trading day, whatever range the page is showing.
export const posLive = route("posLive", async (req) => {
  const window = await resolveBusinessDayWindow({ startHour: DASHBOARD_DAY_START_HOUR });
  return getPosLive({ tenantId: resolveTenantId(req), filters: { range: "today", ...(window || {}) } });
});

export const inventory = route("inventory", (req) => getInventoryIntelligence({ tenantId: resolveTenantId(req) }));

export const aiInsights = route("aiInsights", (req) => getAiInsights({ tenantId: resolveTenantId(req) }));
