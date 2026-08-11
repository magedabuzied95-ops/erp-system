/**
 * Filter contract for Analytics v2.
 *
 * One parser for every analytics endpoint, so date semantics, tenant derivation and
 * dimension validation cannot drift between screens.
 *
 * Contract: docs/analytics/metric-contract.md §1.1 tenant scope, §1.2 date semantics.
 */

import { isSuperAdminUser } from "../../utils/requestScope.js";

/** Longest window a single analytics query may span. §1.2 */
export const MAX_RANGE_DAYS = 400;

/** Window used when the caller supplies no dates at all. §1.2 */
export const DEFAULT_RANGE_DAYS = 30;

export const COMPARISON_MODES = Object.freeze(["none", "previous_period", "previous_month", "previous_year", "custom"]);

/**
 * Dimensions a breakdown may group by. This is an ALLOWLIST, not a hint: the value is
 * mapped to a fixed SQL fragment by the metric layer and is never interpolated.
 */
export const BREAKDOWN_DIMENSIONS = Object.freeze([
  "category",
  "brand",
  "product",
  "variant",
  "size",
  "color",
  "employee",
  "channel",
  "payment_method",
  "branch",
  "supplier",
  "product_type",
]);

export const TIME_GRANULARITIES = Object.freeze(["auto", "hour", "day", "week", "month"]);

export class AnalyticsFilterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AnalyticsFilterError";
    this.code = code;
    this.status = 400;
    this.details = details;
  }
}

const MS_PER_DAY = 86_400_000;

/** UTC-midnight Date from YYYY-MM-DD, or null. */
const parseIsoDate = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }
  const [, y, m, d] = match;
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Reject impossible dates such as 2026-02-31, which Date would roll forward.
  if (parsed.getUTCMonth() !== Number(m) - 1 || parsed.getUTCDate() !== Number(d)) return null;
  return parsed;
};

export const toIsoDate = (date) => (date instanceof Date ? date.toISOString().slice(0, 10) : null);

const addDays = (date, days) => new Date(date.getTime() + days * MS_PER_DAY);

/** Inclusive day count between two UTC-midnight dates. */
export const inclusiveDays = (from, to) => Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;

const positiveInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};

const cleanString = (value) => {
  const parsed = String(value ?? "").trim();
  return parsed || null;
};

/**
 * Tenant scope for v2. Derived from req.user ONLY — the x-tenant-id header and
 * ?tenant_id query parameter that legacy getTenantId honours are deliberately ignored.
 * Returns null for super-admins, who query unscoped.
 */
export const resolveAnalyticsTenantId = (req) => {
  if (isSuperAdminUser(req?.user)) return null;
  const raw = req?.user?.tenant_id ?? req?.user?.tenantId;
  const tenantId = Number(raw);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    throw new AnalyticsFilterError("TENANT_CONTEXT_MISSING", "Tenant context missing");
  }
  return tenantId;
};

/**
 * Comparison window for a given current window.
 * `previous_month` / `previous_year` shift the window's start by a calendar unit and keep
 * the same length, so a 7-day window compares against the matching 7 days.
 */
export const resolveComparisonWindow = ({ from, to, mode, compareFrom, compareTo }) => {
  if (!mode || mode === "none") return null;

  if (mode === "custom") {
    const cFrom = parseIsoDate(compareFrom);
    const cTo = parseIsoDate(compareTo);
    if (!cFrom || !cTo) {
      throw new AnalyticsFilterError("COMPARISON_RANGE_INVALID", "Custom comparison requires compareFrom and compareTo");
    }
    if (cFrom > cTo) {
      throw new AnalyticsFilterError("COMPARISON_RANGE_INVALID", "compareFrom must not be after compareTo");
    }
    return { from: cFrom, to: cTo };
  }

  const length = inclusiveDays(from, to);

  if (mode === "previous_period") {
    const prevTo = addDays(from, -1);
    return { from: addDays(prevTo, -(length - 1)), to: prevTo };
  }

  const shift = mode === "previous_month" ? { months: 1 } : { years: 1 };
  const shifted = new Date(
    Date.UTC(
      from.getUTCFullYear() - (shift.years || 0),
      from.getUTCMonth() - (shift.months || 0),
      from.getUTCDate()
    )
  );
  return { from: shifted, to: addDays(shifted, length - 1) };
};

/**
 * Parse and validate an analytics request into the shape every v2 service consumes.
 * Throws AnalyticsFilterError (status 400) rather than silently coercing.
 */
export const parseAnalyticsFilters = (req = {}) => {
  const query = req.query || {};
  const tenantId = resolveAnalyticsTenantId(req);

  let from = parseIsoDate(query.from ?? query.startDate ?? query.from_date);
  let to = parseIsoDate(query.to ?? query.endDate ?? query.to_date);

  if ((query.from ?? query.startDate ?? query.from_date) && !from) {
    throw new AnalyticsFilterError("DATE_INVALID", "from is not a valid date");
  }
  if ((query.to ?? query.endDate ?? query.to_date) && !to) {
    throw new AnalyticsFilterError("DATE_INVALID", "to is not a valid date");
  }

  // Default window is applied server-side so no endpoint can accidentally scan all time.
  if (!from && !to) {
    const today = new Date();
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    from = addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  } else if (!from) {
    from = addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  } else if (!to) {
    to = addDays(from, DEFAULT_RANGE_DAYS - 1);
  }

  if (from > to) {
    throw new AnalyticsFilterError("DATE_RANGE_INVALID", "from must not be after to");
  }

  const days = inclusiveDays(from, to);
  if (days > MAX_RANGE_DAYS) {
    throw new AnalyticsFilterError("RANGE_TOO_LARGE", `Range of ${days} days exceeds the ${MAX_RANGE_DAYS} day maximum`, { days });
  }

  const comparisonMode = cleanString(query.compare) || "none";
  if (!COMPARISON_MODES.includes(comparisonMode)) {
    throw new AnalyticsFilterError("COMPARISON_MODE_INVALID", `Unknown comparison mode: ${comparisonMode}`);
  }
  const comparison = resolveComparisonWindow({
    from,
    to,
    mode: comparisonMode,
    compareFrom: query.compareFrom,
    compareTo: query.compareTo,
  });

  const dimension = cleanString(query.dimension);
  if (dimension && !BREAKDOWN_DIMENSIONS.includes(dimension)) {
    throw new AnalyticsFilterError("DIMENSION_INVALID", `Unknown dimension: ${dimension}`, { allowed: BREAKDOWN_DIMENSIONS });
  }

  const granularity = cleanString(query.granularity) || "auto";
  if (!TIME_GRANULARITIES.includes(granularity)) {
    throw new AnalyticsFilterError("GRANULARITY_INVALID", `Unknown granularity: ${granularity}`);
  }

  const limit = Math.min(Math.max(positiveInt(query.limit) || 25, 1), 200);
  const page = positiveInt(query.page) || 1;

  return {
    tenantId,
    from: toIsoDate(from),
    to: toIsoDate(to),
    days,
    comparisonMode,
    comparison: comparison ? { from: toIsoDate(comparison.from), to: toIsoDate(comparison.to) } : null,
    branchId: positiveInt(query.branchId ?? query.branch_id),
    warehouseId: positiveInt(query.warehouseId ?? query.warehouse_id),
    categoryId: positiveInt(query.categoryId ?? query.category_id),
    brandId: positiveInt(query.brandId ?? query.brand_id),
    supplierId: positiveInt(query.supplierId ?? query.supplier_id),
    productId: positiveInt(query.productId ?? query.product_id),
    customerId: positiveInt(query.customerId ?? query.customer_id),
    employeeId: positiveInt(query.employeeId ?? query.employee_id),
    channel: cleanString(query.channel),
    paymentMethod: cleanString(query.paymentMethod ?? query.payment_method),
    dimension,
    granularity,
    limit,
    page,
    // R3 product-attribute filters. Bound as parameters by the services, never
    // interpolated. sort/dimension are validated against allowlists downstream.
    productType: cleanString(query.productType ?? query.product_type),
    brandId: positiveInt(query.brandId ?? query.brand_id),
    gender: cleanString(query.gender),
    category: cleanString(query.category),
    search: cleanString(query.search),
    sort: cleanString(query.sort),
    sortDir: String(query.sortDir || query.sort_dir || "desc").toLowerCase() === "asc" ? "asc" : "desc",
    fresh: ["1", "true", "yes"].includes(String(query.fresh || "").toLowerCase()),
  };
};

/**
 * Time bucket for a series, chosen from the window length when granularity is "auto".
 * Keeps point counts render-friendly and query cost bounded.
 */
export const resolveGranularity = (granularity, days) => {
  if (granularity && granularity !== "auto") return granularity;
  if (days <= 2) return "hour";
  if (days <= 62) return "day";
  if (days <= 240) return "week";
  return "month";
};
