import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import useAnalyticsFilters from "./useAnalyticsFilters.js";

/**
 * R4 filter state, in the URL like every other Reporting Center page.
 *
 * The period applies to SALES and DEMAND only. Stock is a snapshot of now and cannot be
 * filtered by date at all — product_variants.stock has no history — so the period never
 * reaches a stock figure. The UI states this; the hook simply never pretends otherwise.
 */

export const INVENTORY_DIMENSIONS = ["product_type", "brand", "category"];
export const DEFAULT_DIMENSION = "product_type";

export const INVENTORY_SORTS = [
  "inventory_value",
  "units",
  "units_sold",
  "net_sales",
  "product",
  "last_sale",
  "first_receipt",
];
export const DEFAULT_SORT = "inventory_value";

/** Pure so the allowlist can be tested without a router. */
export const normaliseInventoryFilters = (searchParams) => {
  const get = (key) => searchParams.get(key) || "";
  const dimension = searchParams.get("dimension");
  const sort = searchParams.get("sort");
  const velocity = searchParams.get("velocity");

  return {
    dimension: INVENTORY_DIMENSIONS.includes(dimension) ? dimension : DEFAULT_DIMENSION,
    sort: INVENTORY_SORTS.includes(sort) ? sort : DEFAULT_SORT,
    sortDir: searchParams.get("sortDir") === "asc" ? "asc" : "desc",
    velocity: velocity || "",
    productType: get("productType"),
    brandId: get("brandId"),
    category: get("category"),
    gender: get("gender"),
    search: get("q"),
    page: Math.max(Number(searchParams.get("page") || 1) || 1, 1),
  };
};

export default function useInventoryFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const base = useAnalyticsFilters();

  const { dimension, sort, sortDir, velocity, productType, brandId, category, gender, search, page } =
    normaliseInventoryFilters(searchParams);

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

  const activeFilterCount = [productType, brandId, category, gender, velocity].filter(Boolean).length;

  const clearFilters = useCallback(
    () => patch({ productType: null, brandId: null, category: null, gender: null, velocity: null, q: null }),
    [patch]
  );

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

  // Sizes need one product type; without it the endpoint returns a scope warning rather
  // than a meaningless mixed axis.
  const sizeParams = useMemo(
    () => ({ ...base.requestParams, productType: productType || undefined, gender: gender || undefined }),
    [base.requestParams, productType, gender]
  );

  return {
    ...base,
    dimension, sort, sortDir, velocity, productType, brandId, category, gender, search, page,
    activeFilterCount,
    analyticalParams, breakdownParams, productParams, sizeParams,
    setDimension: (value) => patch({ dimension: value }),
    setSort: (key, dir) => patch({ sort: key, sortDir: dir }),
    setSearch: (value) => patch({ q: value || null }),
    setPage: (value) => patch({ page: value > 1 ? value : null }, { resetPage: false }),
    setVelocity: (value) => patch({ velocity: value || null }),
    setProductType: (value) => patch({ productType: value || null }),
    setBrand: (value) => patch({ brandId: value || null }),
    setCategory: (value) => patch({ category: value || null }),
    setGender: (value) => patch({ gender: value || null }),
    clearFilters,
  };
}
