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
const fail = (res, error) => {
  console.error("[dashboard] controller error", error);
  return res.status(500).json({ success: false, message: error.message || "Dashboard analytics failed" });
};

export const overview = async (req, res) => {
  try {
    return send(res, await getDashboardOverview({ tenantId: resolveTenantId(req), filters: filters(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const salesTrend = async (req, res) => {
  try {
    return send(res, await getSalesTrend({ tenantId: resolveTenantId(req), days: req.query.days, filters: filters(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const topProducts = async (req, res) => {
  try {
    return send(res, await getTopProducts({ tenantId: resolveTenantId(req), limit: req.query.limit, filters: filters(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const lowStock = async (req, res) => {
  try {
    return send(res, await getLowStock({ tenantId: resolveTenantId(req), limit: req.query.limit }));
  } catch (error) {
    return fail(res, error);
  }
};

export const liveActivity = async (req, res) => {
  try {
    return send(res, await getLiveActivity({ tenantId: resolveTenantId(req), limit: req.query.limit }));
  } catch (error) {
    return fail(res, error);
  }
};

export const branchPerformance = async (req, res) => {
  try {
    return send(res, await getBranchPerformance({ tenantId: resolveTenantId(req), filters: filters(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const paymentAnalytics = async (req, res) => {
  try {
    return send(res, await getPaymentAnalytics({ tenantId: resolveTenantId(req), filters: filters(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const hourlySales = async (req, res) => {
  try {
    return send(res, await getHourlySales({ tenantId: resolveTenantId(req), filters: filters(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const marketing = async (req, res) => {
  try {
    return send(res, await getMarketingAnalytics({ tenantId: resolveTenantId(req), filters: filters(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const posLive = async (req, res) => {
  try {
    return send(res, await getPosLive({ tenantId: resolveTenantId(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const inventory = async (req, res) => {
  try {
    return send(res, await getInventoryIntelligence({ tenantId: resolveTenantId(req) }));
  } catch (error) {
    return fail(res, error);
  }
};

export const aiInsights = async (req, res) => {
  try {
    return send(res, await getAiInsights({ tenantId: resolveTenantId(req) }));
  } catch (error) {
    return fail(res, error);
  }
};
