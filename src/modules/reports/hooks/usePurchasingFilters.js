import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import useAnalyticsFilters from "./useAnalyticsFilters.js";

/**
 * R5 filter state. Extends the shared period/comparison hook with the breakdown
 * dimension, the supplier filter, and the sort/search/page of the two tables.
 *
 * Everything lives in the URL, exactly as R3 and R4 do, so a shared link reproduces the
 * view and browser back/forward restores the previous analytical state for free.
 */

export const PURCHASING_DIMENSIONS = ["supplier", "product_type", "brand", "category"];
export const DEFAULT_DIMENSION = "supplier";

export const PRODUCT_SORTS = ["spend", "units", "unit_cost", "cost_change", "purchases", "product"];
export const SUPPLIER_SORTS = ["spend", "units", "purchases", "average_purchase", "unpaid", "products", "returns", "supplier"];

/**
 * Read the purchasing filter state out of a URLSearchParams.
 *
 * Kept pure and separate from the hook: the URL is user-editable, so every value passes
 * an allowlist before it reaches a request, and that check is worth testing on its own.
 */
export const normalisePurchasingFilters = (searchParams) => {
  const get = (key) => searchParams.get(key) || "";
  const dimension = searchParams.get("dimension");
  const sort = searchParams.get("sort");
  const supplierSort = searchParams.get("supplierSort");

  return {
    dimension: PURCHASING_DIMENSIONS.includes(dimension) ? dimension : DEFAULT_DIMENSION,
    sort: PRODUCT_SORTS.includes(sort) ? sort : "spend",
    sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    supplierSort: SUPPLIER_SORTS.includes(supplierSort) ? supplierSort : "spend",
    supplierSortDir: searchParams.get("supplierSortDir") === "asc" ? "asc" : "desc",
    supplierId: get("supplierId"),
    productType: get("productType"),
    brandId: get("brandId"),
    category: get("category"),
    search: get("q"),
    page: Math.max(Number(searchParams.get("page") || 1) || 1, 1),
    supplierPage: Math.max(Number(searchParams.get("supplierPage") || 1) || 1, 1),
  };
};

export default function usePurchasingFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const base = useAnalyticsFilters();

  const {
    dimension, sort, sortDir, supplierSort, supplierSortDir,
    supplierId, productType, brandId, category, search, page, supplierPage,
  } = normalisePurchasingFilters(searchParams);

  const patch = useCallback(
    (changes, { resetPage = true } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(changes).forEach(([key, value]) => {
            if (value === null || value === undefined || value === "") next.delete(key);
            else next.set(key, String(value));
          });
          // Any filter change invalidates the current page of BOTH tables.
          if (resetPage && !("page" in changes)) next.delete("page");
          if (resetPage && !("supplierPage" in changes)) next.delete("supplierPage");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const activeFilterCount = [supplierId, productType, brandId, category].filter(Boolean).length;

  const clearFilters = useCallback(() => {
    patch({ supplierId: null, productType: null, brandId: null, category: null, q: null });
  }, [patch]);

  const analyticalParams = useMemo(
    () => ({
      ...base.requestParams,
      supplierId: supplierId || undefined,
      productType: productType || undefined,
      brandId: brandId || undefined,
      category: category || undefined,
    }),
    [base.requestParams, supplierId, productType, brandId, category]
  );

  const breakdownParams = useMemo(() => ({ ...analyticalParams, dimension }), [analyticalParams, dimension]);

  const productParams = useMemo(
    () => ({ ...analyticalParams, sort, sortDir, page, limit: 25, search: search || undefined }),
    [analyticalParams, sort, sortDir, page, search]
  );

  const supplierParams = useMemo(
    () => ({ ...analyticalParams, sort: supplierSort, sortDir: supplierSortDir, page: supplierPage, limit: 25 }),
    [analyticalParams, supplierSort, supplierSortDir, supplierPage]
  );

  return {
    ...base,
    dimension, sort, sortDir, supplierSort, supplierSortDir,
    supplierId, productType, brandId, category, search, page, supplierPage,
    activeFilterCount,
    analyticalParams, breakdownParams, productParams, supplierParams,
    setDimension: (value) => patch({ dimension: value }),
    setSort: (key, dir) => patch({ sort: key, sortDir: dir }),
    setSupplierSort: (key, dir) => patch({ supplierSort: key, supplierSortDir: dir }),
    setSearch: (value) => patch({ q: value || null }),
    setPage: (value) => patch({ page: value > 1 ? value : null }, { resetPage: false }),
    setSupplierPage: (value) => patch({ supplierPage: value > 1 ? value : null }, { resetPage: false }),
    setSupplier: (value) => patch({ supplierId: value || null }),
    setProductType: (value) => patch({ productType: value || null }),
    setBrand: (value) => patch({ brandId: value || null }),
    setCategory: (value) => patch({ category: value || null }),
    clearFilters,
  };
}
