/**
 * Comparison and null semantics for Analytics v2.
 *
 * Contract: docs/analytics/metric-contract.md §2 null/error semantics, §8 comparison.
 *
 * The rule that matters most here: a metric that cannot be computed is `null`, never 0,
 * and a percentage change against a zero base is `null`, never 100.
 */

/** Warning codes. Machine-readable and stable — the UI keys off these, not the message. */
export const WARNING_CODES = Object.freeze({
  COGS_COVERAGE_LOW: "COGS_COVERAGE_LOW",
  COGS_COVERAGE_CRITICAL: "COGS_COVERAGE_CRITICAL",
  INVENTORY_COST_COVERAGE_LOW: "INVENTORY_COST_COVERAGE_LOW",
  NAN_VALUES_IGNORED: "NAN_VALUES_IGNORED",
  DISCOUNT_DEFINITION_DELTA: "DISCOUNT_DEFINITION_DELTA",
  SOFT_DELETED_EXCLUDED: "SOFT_DELETED_EXCLUDED",
  DRAFT_STATUS_EXCLUDED: "DRAFT_STATUS_EXCLUDED",
  DRAFT_EXPENSES_EXCLUDED: "DRAFT_EXPENSES_EXCLUDED",
  PAID_BUT_UNRECOGNISED: "PAID_BUT_UNRECOGNISED",
  EXCHANGE_COGS_UNREVERSED: "EXCHANGE_COGS_UNREVERSED",
  EXCHANGE_CREDIT_RETAINED: "EXCHANGE_CREDIT_RETAINED",
  ORPHAN_RETURN_ITEMS: "ORPHAN_RETURN_ITEMS",
  STOCK_SOURCE_DIVERGENCE: "STOCK_SOURCE_DIVERGENCE",
  UNKNOWN_MOVEMENT_TYPE: "UNKNOWN_MOVEMENT_TYPE",
  UNCATEGORISED_SALES_HIGH: "UNCATEGORISED_SALES_HIGH",
  PAYMENT_MIX_UNATTRIBUTED: "PAYMENT_MIX_UNATTRIBUTED",
  RETURNS_FALLBACK_USED: "RETURNS_FALLBACK_USED",
  RANGE_TOO_LARGE: "RANGE_TOO_LARGE",
  COMPARISON_BASE_ZERO: "COMPARISON_BASE_ZERO",
});

/** Coverage below this makes profit figures untrustworthy but still displayable. §4 */
export const COGS_COVERAGE_WARN_THRESHOLD = 0.95;
/** Coverage below this makes profit figures not displayable at all. §4 */
export const COGS_COVERAGE_CRITICAL_THRESHOLD = 0.5;

export const createWarning = (code, message, payload = {}) => ({ code, message, ...payload });

export class WarningCollector {
  constructor() {
    this.warnings = [];
  }

  add(code, message, payload = {}) {
    // Same code twice would be noise; merge instead so the UI shows one row per issue.
    const existing = this.warnings.find((warning) => warning.code === code);
    if (existing) {
      Object.assign(existing, payload);
      return this;
    }
    this.warnings.push(createWarning(code, message, payload));
    return this;
  }

  has(code) {
    return this.warnings.some((warning) => warning.code === code);
  }

  list() {
    return this.warnings;
  }
}

/**
 * Money coming back from pg is a string, and NUMERIC can legitimately hold IEEE NaN
 * (see docs/analytics/legacy-defects.md D-01). Anything not finite becomes null so it
 * cannot silently propagate as a zero.
 */
export const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Verified zero when the source really is zero; null when it is absent or NaN. */
export const toMoney = (value) => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? null : Math.round((parsed + Number.EPSILON) * 100) / 100;
};

/**
 * Safe ratio. Returns null — not 0 — when the denominator is 0 or either side is null,
 * because "no orders" and "average order value of zero" are different facts.
 */
export const safeRatio = (numerator, denominator) => {
  const a = toFiniteNumber(numerator);
  const b = toFiniteNumber(denominator);
  if (a === null || b === null || b === 0) return null;
  const result = a / b;
  return Number.isFinite(result) ? result : null;
};

/**
 * Delta between a current and comparison value.
 *
 * deltaPercent is null when the base is 0 — legacy returns 100, which reads as
 * "doubled" when the truth is "there was nothing to compare against".
 */
export const buildDelta = (current, previous, { collector = null, metric = "" } = {}) => {
  const currentValue = toFiniteNumber(current);
  const previousValue = toFiniteNumber(previous);

  if (currentValue === null || previousValue === null) {
    return { current: currentValue, previous: previousValue, delta: null, deltaPercent: null, direction: "flat" };
  }

  const delta = currentValue - previousValue;

  if (previousValue === 0) {
    if (collector) {
      collector.add(
        WARNING_CODES.COMPARISON_BASE_ZERO,
        "Comparison period had no value, so percentage change cannot be calculated.",
        { metric }
      );
    }
    return { current: currentValue, previous: 0, delta, deltaPercent: null, direction: delta === 0 ? "flat" : delta > 0 ? "up" : "down" };
  }

  const deltaPercent = delta / Math.abs(previousValue);
  return {
    current: currentValue,
    previous: previousValue,
    delta,
    deltaPercent: Number.isFinite(deltaPercent) ? deltaPercent : null,
    direction: delta === 0 ? "flat" : delta > 0 ? "up" : "down",
  };
};

/**
 * Apply the COGS-coverage policy to a profit-bearing payload.
 * Below the critical threshold the profit figures are blanked to null: an apparently
 * precise gross profit on a cost base that thin is worse than no number.
 */
export const applyCogsCoveragePolicy = ({ coverage, values, collector, uncostedUnits = null }) => {
  const ratio = toFiniteNumber(coverage);
  if (ratio === null) return values;

  if (ratio < COGS_COVERAGE_CRITICAL_THRESHOLD) {
    collector?.add(
      WARNING_CODES.COGS_COVERAGE_CRITICAL,
      "Cost data covers less than half of sold units; profit and margin are not shown.",
      { coverage: ratio, uncostedUnits }
    );
    return { ...values, grossProfit: null, grossMargin: null, netProfit: null };
  }

  if (ratio < COGS_COVERAGE_WARN_THRESHOLD) {
    collector?.add(
      WARNING_CODES.COGS_COVERAGE_LOW,
      "Some sold units have no recorded cost, so profit is overstated.",
      { coverage: ratio, uncostedUnits }
    );
  }

  return values;
};

/**
 * Standard envelope. Every v2 endpoint returns this shape. §2
 *
 * The default has to track CONTRACT_VERSION in analyticsMetrics, which cannot be imported
 * here — that module imports WARNING_CODES from this one, so it would be a cycle. A test
 * asserts the two agree.
 */
export const buildEnvelope = ({ data, filters, collector, contractVersion = "1.1.0", generatedAt = null, meta = null }) => ({
  data,
  meta: {
    filters,
    comparison: filters?.comparison || null,
    contractVersion,
    generatedAt: generatedAt || new Date().toISOString(),
    // Callers merge their own metadata here — resolved permissions, timings, coverage —
    // so the client can gate on what the server actually granted.
    ...(meta || {}),
  },
  warnings: collector ? collector.list() : [],
});

/**
 * Bind only the parameters a statement actually uses, renumbered densely.
 *
 * Several v2 screens build their queries from ONE shared parameter list and then run
 * statements that reference different subsets of it — the category and payment-mix
 * queries use the tenant, the current window and the order filters, but never the
 * comparison window. Passing the list sliced to the highest referenced index leaves a
 * hole, and Postgres rejects a statement carrying a parameter it can neither reference
 * nor type: "could not determine data type of parameter $5". Renumbering closes it.
 *
 * Lives here rather than in one service because R2 and R3 both need it, and the copy
 * that only existed in R3 is exactly why the Executive Overview returned a 500 for every
 * filtered request that also had a comparison period.
 */
export const densifyParams = (sql, params) => {
  const used = [...new Set([...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
  if (!used.length) return { sql, params: [] };
  const remap = new Map(used.map((index, position) => [index, position + 1]));
  return {
    sql: sql.replace(/\$(\d+)/g, (_match, index) => "$" + remap.get(Number(index))),
    params: used.map((index) => params[index - 1]),
  };
};
