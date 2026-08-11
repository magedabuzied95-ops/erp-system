/**
 * Analytics v2 controllers — thin. Parsing lives in analyticsFilters, metrics in the
 * analytics services. This layer resolves permissions and maps errors to status codes.
 *
 * Error policy (docs/analytics/metric-contract.md §2): a query failure is a 500 that
 * names the failing area. It is never converted into a zero.
 */

import { AnalyticsFilterError, parseAnalyticsFilters } from "../services/analytics/analyticsFilters.js";
import { getExecutiveOverview } from "../services/analytics/analyticsOverviewService.js";
import { resolveAnalyticsPermissions } from "../services/analytics/analyticsScope.js";

export async function getOverview(req, res) {
  let filters;
  try {
    filters = parseAnalyticsFilters(req);
  } catch (error) {
    if (error instanceof AnalyticsFilterError) {
      return res.status(error.status || 400).json({
        success: false,
        code: error.code,
        message: error.message,
        details: error.details || {},
      });
    }
    throw error;
  }

  try {
    const permissions = await resolveAnalyticsPermissions(req);
    const payload = await getExecutiveOverview({ filters, permissions });
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.error("[analytics-v2] overview failed", {
      requestId: req.id,
      tenantId: filters?.tenantId,
      from: filters?.from,
      to: filters?.to,
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      code: "OVERVIEW_QUERY_FAILED",
      message: "Failed to compute the executive overview",
      metric: "overview",
      error: error.message,
    });
  }
}
