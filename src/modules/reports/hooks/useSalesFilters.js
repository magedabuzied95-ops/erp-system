import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import useAnalyticsFilters from "./useAnalyticsFilters.js";

/**
 * R3 filter state. Extends the R2 period/comparison hook with the product-attribute
 * filters, the breakdown dimension, and the table's sort/search/page.
 *
 * Everything lives in the URL, so drill-down is just a filter mutation and browser
 * back/forward restores the previous analytics state for free.
 */

export const BREAKDOWN_DIMENSIONS = ["product_type", "brand", "category"];
export const DEFAULT_DIMENSION = "product_type";

export const RANKING_KEYS = ["topBySales", "topByProfit", "topByUnits", "fastestGrowth", "largestDecline"];

export const TABLE_SORTS = ["net_sales", "gross_profit", "margin", "units", "growth", "discount_rate", "product"];
export const SALES_SORT_KEYS = TABLE_SORTS;

/**
 * Read the sales filter state out of a URLSearchParams.
 *
 * Kept pure and separate from the hook: the URL is user-editable, so every value has to
 * pass an allowlist before it is used, and that check is worth testing on its own.
 */
export const normaliseSalesFilters = (searchParams) => {
  const get = (key) => searchParams.get(key) || "";
  const dimension = searchParams.get("dimension");
  const sort = searchParams.get("sort");
  const ranking = searchParams.get("ranking");

  return {
    dimension: BREAKDOWN_DIMENSIONS.includes(dimension) ? dimension : DEFAULT_DIMENSION,
    sort: TABLE_SORTS.includes(sort) ? sort : "net_sales",
    sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    ranking: RANKING_KEYS.includes(ranking) ? ranking : "topBySales",
    productType: get("productType"),
    brandId: get("brandId"),
    category: get("category"),
    gender: get("gender"),
    search: get("q"),
    page: Math.max(Number(searchParams.get("page") || 1) || 1, 1),
  };
};

export default function useSalesFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const base = useAnalyticsFilters();

  const { dimension, sort, sortDir, ranking, productType, brandId, category, gender, search, page } =
    normaliseSalesFilters(searchParams);

  const patch = useCallback(
    (changes, { resetPage = true } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(changes).forEach(([key, value]) => {
            if (value === null || value === undefined || value === "") next.delete(key);
            else next.set(key, String(value));
          });
          // Any filter change invalidates the current table page.
          if (resetPage && !("page" in changes)) next.delete("page");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const activeFilterCount = [productType, brandId, category, gender].filter(Boolean).length;

  const clearFilters = useCallback(() => {
    patch({ productType: null, brandId: null, category: null, gender: null, q: null });
  }, [patch]);

  /** Shared analytical params. The table adds its own paging on top. */
  const analyticalParams = useMemo(
    () => ({
      ...base.requestParams,
      productType: productType || undefined,
      brandId: brandId || undefined,
      category: category || undefined,
      gender: gender || undefined,
    }),
    [base.requestParams, productType, brandId, category, gender]
  );

  const breakdownParams = useMemo(() => ({ ...analyticalParams, dimension }), [analyticalParams, dimension]);

  const productParams = useMemo(
    () => ({ ...analyticalParams, sort, sortDir, page, limit: 25, search: search || undefined }),
    [analyticalParams, sort, sortDir, page, search]
  );

  // Size analysis needs a single product type; without one the endpoint returns a
  // scope warning rather than a mixed, meaningless axis.
  const sizeParams = useMemo(
    () => ({ ...base.requestParams, productType: productType || undefined, gender: gender || undefined }),
    [base.requestParams, productType, gender]
  );

  return {
    ...base,
    dimension, sort, sortDir, productType, brandId, category, gender, search, page, ranking,
    activeFilterCount,
    analyticalParams, breakdownParams, productParams, sizeParams,
    setDimension: (value) => patch({ dimension: value }),
    setRanking: (value) => patch({ ranking: value }, { resetPage: false }),
    setSort: (key, dir) => patch({ sort: key, sortDir: dir }),
    setSearch: (value) => patch({ q: value || null }),
    setPage: (value) => patch({ page: value > 1 ? value : null }, { resetPage: false }),
    setProductType: (value) => patch({ productType: value || null }),
    setBrand: (value) => patch({ brandId: value || null }),
    setCategory: (value) => patch({ category: value || null }),
    setGender: (value) => patch({ gender: value || null }),
    clearFilters,
  };
}
