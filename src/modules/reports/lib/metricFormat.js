// Explicit .js so this module is loadable by Node's test runner as well as Vite.
import { formatCurrency, formatCurrencyParts, formatNumber } from "../../../shared/lib/currency.js";

/**
 * Presentation helpers for the Executive Overview.
 *
 * Money always goes through the shared currency utility — EGP formatting is never
 * reimplemented here.
 */

export const METRIC_KIND = Object.freeze({
  netSales: "currency",
  grossProfit: "currency",
  grossMargin: "percent",
  orders: "integer",
  averageOrderValue: "currency",
  itemsSold: "integer",
  itemsPerOrder: "decimal",
  discountRate: "percent",
  returns: "currency",
  returnRate: "percent",
  newCustomers: "integer",
  inventoryValue: "currency",
  // R4 inventory metrics.
  unitsInStock: "integer",
  stockedProducts: "integer",
  stockedVariants: "integer",
  unitsSoldPeriod: "integer",
  netSalesPeriod: "currency",
});

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * Compact NUMBER for chart axes, where a full currency string would not fit.
 *
 * Deliberately no currency symbol: appending a scale suffix to a formatted currency
 * produces things like "113.00 ج.م ألف", with the symbol stranded mid-number. Axes
 * carry their unit in the panel title; tooltips and KPI tiles show exact currency.
 */
export const formatCompactNumber = (value, language = "") => {
  if (!isNumber(value)) return null;
  const abs = Math.abs(value);
  if (abs < 1000) return formatNumber(Number(value.toFixed(0)), language);
  const millions = abs >= 1000000;
  const scaled = millions ? value / 1000000 : value / 1000;
  const suffix = String(language).startsWith("ar") ? (millions ? " م" : " ألف") : millions ? "M" : "K";
  const digits = Math.abs(scaled) < 10 ? 1 : 0;
  return `${formatNumber(Number(scaled.toFixed(digits)), language)}${suffix}`;
};

/** Percentages: one decimal, and never 12.483726%. */
export const formatPercentValue = (value, language = "", { digits = 1 } = {}) => {
  if (!isNumber(value)) return null;
  const percent = value * 100;
  const rounded = Number(percent.toFixed(Math.abs(percent) < 10 ? digits : Math.min(digits, 1)));
  return `${formatNumber(rounded, language)}%`;
};

/** Signed percentage for deltas. */
export const formatDeltaPercent = (value, language = "") => {
  if (!isNumber(value)) return null;
  const percent = value * 100;
  const rounded = Number(percent.toFixed(Math.abs(percent) < 10 ? 1 : 0));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${formatNumber(rounded, language)}%`;
};

/** Percentage-point delta, used for margin and return-rate changes. */
export const formatPoints = (value, language = "") => {
  if (!isNumber(value)) return null;
  const rounded = Number(value.toFixed(1));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${formatNumber(rounded, language)}`;
};

/**
 * Money for analytics, without a trailing ".00" on whole amounts.
 *
 * A column of "348,870.00 ج.م" spends two characters per row on zeros that carry no
 * information, and the noise is what makes a wall of figures hard to scan. Piastres
 * still print whenever they exist, so nothing financially meaningful is dropped, and
 * the exact value remains available in tooltips.
 *
 * Built on the shared currency utility rather than reimplementing EGP formatting: the
 * symbol, locale and RTL placement stay identical to the rest of the ERP. Only the
 * fraction is trimmed, and only here — POS, invoices and accounting are untouched.
 */
export const formatMoney = (value, language = "") => {
  if (!isNumber(value)) return null;
  const parts = formatCurrencyParts(value, language);
  if (!Number.isInteger(value)) return parts.text;
  // Strip a fraction of zeros only, whatever separator the locale used.
  const amount = parts.amount.replace(/[.,]0+$/, "");
  return parts.isRtl ? `${amount} ${parts.symbol}`.trim() : `${parts.symbol} ${amount}`.trim();
};

/**
 * KPI values are always exact. Compacting money hurts more than it helps: a manager
 * comparing 113,091 against 98,400 needs the digits, and "113 ألف" hides them.
 */
export const formatMetricValue = (metric, value, language = "") => {
  if (!isNumber(value)) return null;
  switch (METRIC_KIND[metric]) {
    case "currency":
      return formatMoney(value, language);
    case "percent":
      return formatPercentValue(value, language);
    case "decimal":
      return formatNumber(Number(value.toFixed(2)), language);
    case "integer":
    default:
      return formatNumber(Math.round(value), language);
  }
};

/**
 * Full precision, for tooltips and title attributes.
 *
 * Money keeps its decimals here even when the tile trimmed them, so the exact figure is
 * always one hover away.
 */
export const formatMetricExact = (metric, value, language = "") => {
  if (!isNumber(value)) return null;
  if (METRIC_KIND[metric] === "currency") return formatCurrency(value, language);
  return formatMetricValue(metric, value, language);
};

/**
 * Growth beyond which a comparison is treated as measured against a partial period.
 *
 * 3x current-to-previous is +200%. A period that tripled usually did not triple: it was
 * measured against an incomplete one, and rendering that as a plain green success
 * misleads. Declines are bounded at -100% and never reach this, deliberately — "sales
 * stopped" is real information rather than an artefact of a thin base.
 */
export const THIN_BASELINE_RATIO = 3;

/** Whether this comparison rests on a baseline too small to carry a percentage. */
export const isBaselineThin = (current, previous) =>
  typeof previous === "number" &&
  previous > 0 &&
  typeof current === "number" &&
  current / previous >= THIN_BASELINE_RATIO;

/**
 * Whether a movement is good for the business.
 *
 * `favourable` comes from the backend per metric: rising returns or a rising discount
 * rate are NOT good, so direction alone must never drive the colour.
 */
export const resolveSentiment = (favourable, delta) => {
  if (!isNumber(delta) || delta === 0) return "neutral";
  if (favourable === "neutral") return "neutral";
  const better = favourable === "lower" ? delta < 0 : delta > 0;
  return better ? "positive" : "negative";
};

export const SENTIMENT_CLASS = Object.freeze({
  positive: "text-[var(--success)]",
  negative: "text-[var(--danger)]",
  neutral: "text-[var(--text-tertiary)]",
});
