import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Period + comparison state, stored in the URL.
 *
 * The URL is the single source of truth: refreshing, sharing or using browser
 * back/forward all preserve the selected range. Nothing is kept in localStorage.
 */

const pad = (value) => String(value).padStart(2, "0");
export const toIso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const today = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** Week starts Saturday, matching the Egyptian retail week. */
const startOfWeek = (date) => addDays(date, -((date.getDay() + 1) % 7));

export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "thisWeek",
  "thisMonth",
  "lastMonth",
  "thisYear",
  "custom",
];

export const resolvePreset = (preset) => {
  const now = today();
  switch (preset) {
    case "today":
      return { from: toIso(now), to: toIso(now) };
    case "yesterday": {
      const day = addDays(now, -1);
      return { from: toIso(day), to: toIso(day) };
    }
    case "last7":
      return { from: toIso(addDays(now, -6)), to: toIso(now) };
    case "thisWeek":
      return { from: toIso(startOfWeek(now)), to: toIso(now) };
    case "thisMonth":
      return { from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: toIso(now) };
    case "lastMonth": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toIso(first), to: toIso(last) };
    }
    case "thisYear":
      return { from: toIso(new Date(now.getFullYear(), 0, 1)), to: toIso(now) };
    case "last30":
    default:
      return { from: toIso(addDays(now, -29)), to: toIso(now) };
  }
};

export const COMPARISON_MODES = ["none", "previous_period", "previous_month", "previous_year"];

const daysBetween = (from, to) => {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  return Math.floor((b - a) / 86400000) + 1;
};

/**
 * Only offer comparisons that are meaningful for the chosen window.
 * A 200-day range has no sensible "previous month"; a same-day range does.
 */
export const availableComparisons = (from, to) => {
  if (!from || !to) return COMPARISON_MODES;
  const days = daysBetween(from, to);
  const modes = ["none", "previous_period"];
  if (days <= 31) modes.push("previous_month");
  if (days <= 366) modes.push("previous_year");
  return modes;
};

const DEFAULT_PRESET = "last30";
const DEFAULT_COMPARE = "previous_period";

export default function useAnalyticsFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const preset = searchParams.get("preset") || DEFAULT_PRESET;
  const resolved = useMemo(() => {
    if (preset === "custom") {
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      if (from && to) return { from, to };
      return resolvePreset(DEFAULT_PRESET);
    }
    return resolvePreset(preset);
  }, [preset, searchParams]);

  const allowed = useMemo(() => availableComparisons(resolved.from, resolved.to), [resolved.from, resolved.to]);
  const requestedCompare = searchParams.get("compare") || DEFAULT_COMPARE;
  // Silently fall back rather than sending a comparison the backend would reject.
  const compare = allowed.includes(requestedCompare) ? requestedCompare : "previous_period";

  const branchId = searchParams.get("branchId") || "";

  const filters = useMemo(
    () => ({
      preset,
      from: resolved.from,
      to: resolved.to,
      compare,
      branchId,
      days: daysBetween(resolved.from, resolved.to),
    }),
    [preset, resolved.from, resolved.to, compare, branchId]
  );

  const setPreset = useCallback(
    (nextPreset, custom = null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("preset", nextPreset);
          if (nextPreset === "custom" && custom?.from && custom?.to) {
            next.set("from", custom.from);
            next.set("to", custom.to);
          } else {
            next.delete("from");
            next.delete("to");
          }
          const range = nextPreset === "custom" && custom ? custom : resolvePreset(nextPreset);
          const modes = availableComparisons(range.from, range.to);
          if (!modes.includes(next.get("compare") || DEFAULT_COMPARE)) next.set("compare", "previous_period");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setCompare = useCallback(
    (mode) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("compare", mode);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  /** Exactly what the API expects — nothing presentational. */
  const requestParams = useMemo(
    () => ({
      from: filters.from,
      to: filters.to,
      compare: filters.compare === "none" ? undefined : filters.compare,
      branchId: filters.branchId || undefined,
    }),
    [filters.from, filters.to, filters.compare, filters.branchId]
  );

  return { filters, requestParams, allowedComparisons: allowed, setPreset, setCompare };
}
