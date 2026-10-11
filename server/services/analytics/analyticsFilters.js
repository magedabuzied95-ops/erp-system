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

/* ------------------------------------------------------------------- time of day */

/**
 * The window a query actually scans, as a pair of instants rather than a pair of days.
 *
 * Every analytics predicate used to be written `col >= $from::date AND col < ($to::date +
 * INTERVAL '1 day')`, which can only express whole calendar days. A shop whose night
 * crosses midnight could not ask for "the 1st at 2pm to the 2nd at 2am" at all.
 *
 * So the contract carries `windowStart` (inclusive) and `windowEnd` (EXCLUSIVE) as
 * wall-clock stamps and the services compare against those. For a request with no times
 * they are `from 00:00:00` and `to + 1 day 00:00:00` — the very same window the `::date`
 * form produced, because the database session runs on the app's own zone (db.js pins
 * `timezone=Africa/Cairo`) and both casts resolve there.
 *
 * NOTE the asymmetry, which is deliberate: `to` is an INCLUSIVE day when no time is given
 * ("up to and including the 30th"), and `toTime` is an EXCLUSIVE instant when one is
 * ("…to the 30th at 12am" ends the moment the 30th begins). That is what a person means
 * by each. The envelope reports both, so a screen can say which one it used.
 */
const TIME_OF_DAY = /^([01]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/;

const pad2 = (value) => String(value).padStart(2, "0");

/** "14:00" / "2:30:15" -> "14:00:00" / "02:30:15"; anything else -> null. */
export const parseTimeOfDay = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const match = TIME_OF_DAY.exec(String(value).trim());
  if (!match) return null;
  const [, h, m, s] = match;
  return `${pad2(h)}:${pad2(m)}:${pad2(s || 0)}`;
};

/**
 * Wall-clock arithmetic, done on a Date whose UTC fields hold the LOCAL reading.
 *
 * The stamps go to Postgres as text and are resolved in the session zone, so no offset
 * belongs in them. Shifting a window back a month across a DST change therefore keeps the
 * same clock reading rather than the same count of elapsed hours — which is what "the
 * same window last month" means to the person reading the comparison.
 */
const stampToDate = (stamp) => new Date(`${String(stamp).replace(" ", "T")}Z`);

const dateToStamp = (date) =>
  `${toIsoDate(date)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;

const buildWindow = ({ from, to, fromTime, toTime }) => ({
  windowStart: `${toIsoDate(from)} ${fromTime || "00:00:00"}`,
  windowEnd: toTime ? `${toIsoDate(to)} ${toTime}` : `${toIsoDate(addDays(to, 1))} 00:00:00`,
});

/**
 * THE predicate for "this row happened inside the window". One helper, so no service can
 * express the window a second way and quietly disagree with the others.
 */
export const windowClause = (column, fromParam, toParam) =>
  `${column} >= ${fromParam}::timestamptz AND ${column} < ${toParam}::timestamptz`;

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
 * The comparison window as a pair of instants, for a request that named times.
 *
 * Whole-day requests keep the day arithmetic above untouched — it is what every existing
 * comparison on every screen already uses, and re-deriving it here would be a second
 * answer to a settled question. A request with times cannot go through it, because its
 * window does not start or end on a day boundary, so the instants are shifted directly:
 * the previous period by the window's own length, a month or a year by that calendar
 * unit on BOTH ends (so "the same hours last month" keeps the same hours).
 */
const resolveComparisonStamps = ({ windowStart, windowEnd, mode, compareFrom, compareTo, fromTime, toTime }) => {
  if (!mode || mode === "none") return null;

  if (mode === "custom") {
    const cFrom = parseIsoDate(compareFrom);
    const cTo = parseIsoDate(compareTo);
    if (!cFrom || !cTo) {
      throw new AnalyticsFilterError("COMPARISON_RANGE_INVALID", "Custom comparison requires compareFrom and compareTo");
    }
    const window = buildWindow({ from: cFrom, to: cTo, fromTime, toTime });
    if (window.windowEnd <= window.windowStart) {
      throw new AnalyticsFilterError("COMPARISON_RANGE_INVALID", "compareFrom must be before compareTo");
    }
    return window;
  }

  const start = stampToDate(windowStart);
  const end = stampToDate(windowEnd);

  if (mode === "previous_period") {
    const span = end.getTime() - start.getTime();
    return { windowStart: dateToStamp(new Date(start.getTime() - span)), windowEnd: windowStart };
  }

  const unit = mode === "previous_month" ? { months: 1 } : { years: 1 };
  const back = (date) =>
    new Date(
      Date.UTC(
        date.getUTCFullYear() - (unit.years || 0),
        date.getUTCMonth() - (unit.months || 0),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
      )
    );
  return { windowStart: dateToStamp(back(start)), windowEnd: dateToStamp(back(end)) };
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

  // Times are optional and independent of the preset: a caller that sends neither gets
  // the whole-day window this contract has always produced.
  const rawFromTime = query.fromTime ?? query.from_time;
  const rawToTime = query.toTime ?? query.to_time;
  const fromTime = parseTimeOfDay(rawFromTime);
  const toTime = parseTimeOfDay(rawToTime);
  if (rawFromTime && !fromTime) throw new AnalyticsFilterError("TIME_INVALID", "fromTime is not a valid time of day");
  if (rawToTime && !toTime) throw new AnalyticsFilterError("TIME_INVALID", "toTime is not a valid time of day");

  const { windowStart, windowEnd } = buildWindow({ from, to, fromTime, toTime });
  if (windowEnd <= windowStart) {
    throw new AnalyticsFilterError("DATE_RANGE_INVALID", "The window must end after it starts");
  }

  // The day count still drives the range cap, the trend's bucket size and every per-day
  // average, so a part-day window counts as the day it lands in rather than as zero.
  const spanMs = stampToDate(windowEnd).getTime() - stampToDate(windowStart).getTime();
  const days = fromTime || toTime ? Math.max(1, Math.ceil(spanMs / MS_PER_DAY)) : inclusiveDays(from, to);
  if (days > MAX_RANGE_DAYS) {
    throw new AnalyticsFilterError("RANGE_TOO_LARGE", `Range of ${days} days exceeds the ${MAX_RANGE_DAYS} day maximum`, { days });
  }

  const comparisonMode = cleanString(query.compare) || "none";
  if (!COMPARISON_MODES.includes(comparisonMode)) {
    throw new AnalyticsFilterError("COMPARISON_MODE_INVALID", `Unknown comparison mode: ${comparisonMode}`);
  }
  const comparison = fromTime || toTime
    ? null
    : resolveComparisonWindow({
        from,
        to,
        mode: comparisonMode,
        compareFrom: query.compareFrom,
        compareTo: query.compareTo,
      });
  const comparisonStamps = fromTime || toTime
    ? resolveComparisonStamps({
        windowStart,
        windowEnd,
        mode: comparisonMode,
        compareFrom: query.compareFrom,
        compareTo: query.compareTo,
        fromTime,
        toTime,
      })
    : comparison
      ? buildWindow({ from: comparison.from, to: comparison.to })
      : null;

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
    // Null when the caller asked for whole days. The screen needs to tell the two apart:
    // "to the 30th" and "to the 30th at 12am" are different windows.
    fromTime,
    toTime,
    // The window the SQL actually scans: inclusive start, EXCLUSIVE end.
    windowStart,
    windowEnd,
    days,
    comparisonMode,
    comparison: comparisonStamps
      ? {
          from: comparisonStamps.windowStart.slice(0, 10),
          to: comparison ? toIsoDate(comparison.to) : comparisonStamps.windowEnd.slice(0, 10),
          windowStart: comparisonStamps.windowStart,
          windowEnd: comparisonStamps.windowEnd,
        }
      : null,
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
    /*
     * The two filters the legacy page had and this one did not. Both are backed by a real
     * foreign key on `orders` with real coverage on production — shift_id -> and
     * cash_drawer_shifts (576/579), salesperson_id -> employees (517/579, zero dangling).
     * Neither infers anything: an order with no salesperson falls out of the filtered set
     * rather than being attributed to somebody.
     */
    shiftId: positiveInt(query.shiftId ?? query.shift_id),
    salespersonId: positiveInt(query.salespersonId ?? query.salesperson_id),
    dimension,
    granularity,
    limit,
    page,
    // R3 product-attribute filters. Bound as parameters by the services, never
    // interpolated. sort/dimension are validated against allowlists downstream.
    // brandId is already resolved above; R3 reuses it rather than declaring it twice.
    productType: cleanString(query.productType ?? query.product_type),
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
