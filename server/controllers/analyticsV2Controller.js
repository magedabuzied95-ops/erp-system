/**
 * Analytics v2 controllers — thin. Parsing lives in analyticsFilters, metrics in the
 * analytics services. This layer resolves permissions and maps errors to status codes.
 *
 * Error policy (docs/analytics/metric-contract.md §2): a query failure is a 500 that
 * names the failing area. It is never converted into a zero.
 */

import { AnalyticsFilterError, parseAnalyticsFilters } from "../services/analytics/analyticsFilters.js";
import { getExecutiveOverview } from "../services/analytics/analyticsOverviewService.js";
import {
  getSalesBreakdown,
  getSalesProducts,
  getSalesSizes,
  getSalesSummary,
} from "../services/analytics/analyticsSalesService.js";
import {
  getInventoryBreakdown,
  getInventoryProducts,
  getInventorySizes,
  getInventorySummary,
} from "../services/analytics/analyticsInventoryService.js";
import {
  getPurchasingBreakdown,
  getPurchasingProducts,
  getPurchasingSummary,
  getPurchasingSuppliers,
} from "../services/analytics/analyticsPurchasingService.js";
import {
  getCustomersBreakdown,
  getCustomersList,
  getCustomersSummary,
} from "../services/analytics/analyticsCustomersService.js";
import {
  getEmployeesBreakdown,
  getEmployeesList,
  getEmployeesSummary,
} from "../services/analytics/analyticsEmployeesService.js";
import { runReconciliation } from "../services/analytics/analyticsReconciliationService.js";
import { getFilterOptions } from "../services/analytics/analyticsFilterOptionsService.js";
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

/**
 * Shared handler shape for the analytical endpoints. Filter errors are 400 with a
 * machine-readable code; anything else is a 500 naming the failing area, never a zero.
 */
const analyticsHandler = (area, name, code, run) => async (req, res) => {
  let filters;
  try {
    filters = parseAnalyticsFilters(req);
  } catch (error) {
    if (error instanceof AnalyticsFilterError) {
      return res.status(error.status || 400).json({
        success: false, code: error.code, message: error.message, details: error.details || {},
      });
    }
    throw error;
  }

  try {
    const permissions = await resolveAnalyticsPermissions(req);
    const payload = await run({ filters, permissions });
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    console.error(`[analytics-v2] ${area}/${name} failed`, {
      requestId: req.id, tenantId: filters?.tenantId, from: filters?.from, to: filters?.to,
      message: error.message, code: error.code, stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      code,
      message: `Failed to compute ${area} ${name}`,
      metric: `${area}.${name}`,
      error: error.message,
    });
  }
};

const salesHandler = (name, run) => analyticsHandler("sales", name, "SALES_QUERY_FAILED", run);
const inventoryHandler = (name, run) => analyticsHandler("inventory", name, "INVENTORY_QUERY_FAILED", run);

export const getSalesSummaryController   = salesHandler("summary", getSalesSummary);
export const getSalesBreakdownController = salesHandler("breakdown", getSalesBreakdown);
export const getSalesProductsController  = salesHandler("products", getSalesProducts);
export const getSalesSizesController     = salesHandler("sizes", getSalesSizes);

// R4 — Inventory Intelligence. Same envelope, same error policy.
export const getInventorySummaryController   = inventoryHandler("summary", getInventorySummary);
export const getInventoryBreakdownController = inventoryHandler("breakdown", getInventoryBreakdown);
export const getInventoryProductsController  = inventoryHandler("products", getInventoryProducts);
export const getInventorySizesController     = inventoryHandler("sizes", getInventorySizes);

// R5 - Purchasing & Supplier Intelligence. Entry is reports:view like every other
// analytics screen; every money figure is additionally gated on reports:cost INSIDE the
// service, which omits the column rather than blanking it after the fact.
const purchasingHandler = (name, run) => analyticsHandler("purchasing", name, "PURCHASING_QUERY_FAILED", run);

export const getPurchasingSummaryController   = purchasingHandler("summary", getPurchasingSummary);
export const getPurchasingBreakdownController = purchasingHandler("breakdown", getPurchasingBreakdown);
export const getPurchasingProductsController  = purchasingHandler("products", getPurchasingProducts);
export const getPurchasingSuppliersController = purchasingHandler("suppliers", getPurchasingSuppliers);

// R6 - Customer Intelligence. Aggregated only: no phone number and no email address ever
// leaves these endpoints. The NAMED top-customer list is additionally gated on
// customers:view inside the service; without it the same rows come back ranked and
// anonymised, so the shape of the business is still visible without the identities.
const customersHandler = (name, run) => analyticsHandler("customers", name, "CUSTOMERS_QUERY_FAILED", run);

export const getCustomersSummaryController   = customersHandler("summary", getCustomersSummary);
export const getCustomersBreakdownController = customersHandler("breakdown", getCustomersBreakdown);
export const getCustomersListController      = customersHandler("list", getCustomersList);

// R9 - Employee & Channel Intelligence. The seller attribution field is resolved from
// measured coverage inside the service and reported in meta.attribution, because the
// contract's declared precedence names a column that is empty on production.
const employeesHandler = (name, run) => analyticsHandler("employees", name, "EMPLOYEES_QUERY_FAILED", run);

export const getEmployeesSummaryController   = employeesHandler("summary", getEmployeesSummary);
export const getEmployeesBreakdownController = employeesHandler("breakdown", getEmployeesBreakdown);
export const getEmployeesListController      = employeesHandler("list", getEmployeesList);

// R10 - Reconciliation. One engine, shared with the CLI script; this controller only
// resolves permissions and maps errors, exactly like every other area.
// Filter options. Same envelope and the same reports:view gate; the values themselves
// are derived from the orders in scope, so a reader is never offered an id that would
// return nothing.
export const getFilterOptionsController = analyticsHandler(
  "filters", "options", "FILTER_OPTIONS_QUERY_FAILED", getFilterOptions
);

export const getReconciliationController = analyticsHandler(
  "reconciliation", "report", "RECONCILIATION_QUERY_FAILED", runReconciliation
);
