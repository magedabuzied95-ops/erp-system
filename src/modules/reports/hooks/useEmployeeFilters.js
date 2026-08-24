import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import useAnalyticsFilters from "./useAnalyticsFilters.js";

/**
 * R9 filter state. Period and comparison from the shared hook, plus the breakdown
 * dimension, the channel and branch filters, and the seller table's sort and page.
 *
 * URL-backed like every other Reporting Center page, so a shared link reproduces the view.
 */

export const EMPLOYEE_DIMENSIONS = ["seller", "cashier", "channel", "branch"];
export const DEFAULT_DIMENSION = "seller";
export const EMPLOYEE_SORTS = ["net_sales", "orders", "units", "average_order", "last_sale", "seller"];

/** Pure, so the allowlist that protects a user-editable URL can be tested on its own. */
export const normaliseEmployeeFilters = (searchParams) => {
  const get = (key) => searchParams.get(key) || "";
  const dimension = searchParams.get("dimension");
  const sort = searchParams.get("sort");
  return {
    dimension: EMPLOYEE_DIMENSIONS.includes(dimension) ? dimension : DEFAULT_DIMENSION,
    sort: EMPLOYEE_SORTS.includes(sort) ? sort : "net_sales",
    sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    channel: get("channel"),
    branchId: get("branchId"),
    page: Math.max(Number(searchParams.get("page") || 1) || 1, 1),
  };
};

export default function useEmployeeFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const base = useAnalyticsFilters();
  const { dimension, sort, sortDir, channel, branchId, page } = normaliseEmployeeFilters(searchParams);

  const patch = useCallback(
    (changes, { resetPage = true } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(changes).forEach(([key, value]) => {
            if (value === null || value === undefined || value === "") next.delete(key);
            else next.set(key, String(value));
          });
          if (resetPage && !("page" in changes)) next.delete("page");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const activeFilterCount = [channel, branchId].filter(Boolean).length;
  const clearFilters = useCallback(() => patch({ channel: null, branchId: null }), [patch]);

  const analyticalParams = useMemo(
    () => ({ ...base.requestParams, channel: channel || undefined, branchId: branchId || undefined }),
    [base.requestParams, channel, branchId]
  );
  const breakdownParams = useMemo(() => ({ ...analyticalParams, dimension }), [analyticalParams, dimension]);
  const listParams = useMemo(
    () => ({ ...analyticalParams, sort, sortDir, page, limit: 25 }),
    [analyticalParams, sort, sortDir, page]
  );

  return {
    ...base,
    dimension, sort, sortDir, channel, branchId, page,
    activeFilterCount, analyticalParams, breakdownParams, listParams,
    setDimension: (value) => patch({ dimension: value }),
    setSort: (key, dir) => patch({ sort: key, sortDir: dir }),
    setPage: (value) => patch({ page: value > 1 ? value : null }, { resetPage: false }),
    setChannel: (value) => patch({ channel: value || null }),
    setBranch: (value) => patch({ branchId: value || null }),
    clearFilters,
  };
}
