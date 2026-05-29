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
} from "../services/dashboardAnalyticsService.js";

const resolveTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));
const filters = (req) => ({
  range: req.query.range || "today",
  dateFrom: req.query.date_from || req.query.dateFrom || "",
  dateTo: req.query.date_to || req.query.dateTo || "",
  branchId: req.query.branch_id || req.query.branchId || "",
});

const send = (res, data) => res.status(200).json({ success: true, data });
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
    const data = await handler(req);
    if (ERP_PERF_DEBUG) console.log("[erp-perf] dashboard route end", {
      requestId: req.id,
      name,
      durationMs: Date.now() - startedAt,
    });
    return send(res, data);
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

export const overview = route("overview", (req) =>
  getDashboardOverview({ tenantId: resolveTenantId(req), filters: filters(req) })
);

export const salesTrend = route("salesTrend", (req) =>
  getSalesTrend({ tenantId: resolveTenantId(req), days: req.query.days, filters: filters(req) })
);

export const topProducts = route("topProducts", (req) =>
  getTopProducts({ tenantId: resolveTenantId(req), limit: req.query.limit, filters: filters(req) })
);

export const lowStock = route("lowStock", (req) =>
  getLowStock({ tenantId: resolveTenantId(req), limit: req.query.limit })
);

export const liveActivity = route("liveActivity", (req) =>
  getLiveActivity({ tenantId: resolveTenantId(req), limit: req.query.limit })
);

export const branchPerformance = route("branchPerformance", (req) =>
  getBranchPerformance({ tenantId: resolveTenantId(req), filters: filters(req) })
);

export const paymentAnalytics = route("paymentAnalytics", (req) =>
  getPaymentAnalytics({ tenantId: resolveTenantId(req), filters: filters(req) })
);

export const hourlySales = route("hourlySales", (req) =>
  getHourlySales({ tenantId: resolveTenantId(req), filters: filters(req) })
);

export const marketing = route("marketing", (req) =>
  getMarketingAnalytics({ tenantId: resolveTenantId(req), filters: filters(req) })
);

export const posLive = route("posLive", (req) => getPosLive({ tenantId: resolveTenantId(req) }));

export const inventory = route("inventory", (req) => getInventoryIntelligence({ tenantId: resolveTenantId(req) }));

export const aiInsights = route("aiInsights", (req) => getAiInsights({ tenantId: resolveTenantId(req) }));
