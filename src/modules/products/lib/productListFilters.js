export const PRODUCTS_LIST_FILTERS_STORAGE_KEY = "erp.products.list.filters.v1";

export const DEFAULT_PRODUCTS_LIST_FILTERS = Object.freeze({
  catalogTab: "products",
  status: "all",
  colorImageStatus: "all",
  storefrontVisibility: "all",
  brand: "all",
  manufacturer: "all",
  classifications: {
    gender: "all",
    productType: "all",
    grade: "all",
  },
});

const safeFilterValue = (value, fallback = "all") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

export const normalizeProductsListFilters = (value = {}) => ({
  catalogTab: ["products", "offers"].includes(value?.catalogTab) ? value.catalogTab : "products",
  status: safeFilterValue(value?.status),
  colorImageStatus: safeFilterValue(value?.colorImageStatus),
  storefrontVisibility: safeFilterValue(value?.storefrontVisibility),
  brand: safeFilterValue(value?.brand),
  manufacturer: safeFilterValue(value?.manufacturer),
  classifications: {
    gender: safeFilterValue(value?.classifications?.gender),
    productType: safeFilterValue(value?.classifications?.productType),
    grade: safeFilterValue(value?.classifications?.grade),
  },
});

export const readProductsListFilters = (storage = globalThis?.localStorage) => {
  if (!storage) return normalizeProductsListFilters(DEFAULT_PRODUCTS_LIST_FILTERS);
  try {
    const raw = storage.getItem(PRODUCTS_LIST_FILTERS_STORAGE_KEY);
    return normalizeProductsListFilters(raw ? JSON.parse(raw) : DEFAULT_PRODUCTS_LIST_FILTERS);
  } catch {
    return normalizeProductsListFilters(DEFAULT_PRODUCTS_LIST_FILTERS);
  }
};

export const writeProductsListFilters = (filters, storage = globalThis?.localStorage) => {
  if (!storage) return;
  try {
    storage.setItem(PRODUCTS_LIST_FILTERS_STORAGE_KEY, JSON.stringify(normalizeProductsListFilters(filters)));
  } catch {
    // Filters remain usable when browser storage is unavailable.
  }
};

export const removeStoredProductsListFilters = (storage = globalThis?.localStorage) => {
  try {
    storage?.removeItem(PRODUCTS_LIST_FILTERS_STORAGE_KEY);
  } catch {
    // Clearing the visible filters must still work when storage is unavailable.
  }
};
