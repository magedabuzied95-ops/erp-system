// Pure query-building helpers for the AI Inbox product picker. Kept free of any
// runtime dependency so the filter contract is unit-testable on its own.
//
// Why this exists: the picker fetches ONE bounded page (24 rows). Any filter that
// is applied client-side therefore only ever sees that page — which is how
// picking a colour ended up showing "1 product" while many more matched in the
// ERP. Every filter listed here must travel to the server.

export const PICKER_PAGE_SIZE = 24; // /products/with-variants hard-caps limit at 48

const clean = (value) => String(value ?? "").trim();
const isMeaningful = (value) => {
  const text = clean(value);
  return Boolean(text) && text.toLowerCase() !== "all";
};

// Filters the endpoint can apply across the whole catalog.
export const SERVER_FILTER_KEYS = ["brand", "manufacturer", "gender", "product_type", "grade", "size", "color"];

export const buildPickerParams = ({ search = "", filters = {}, page = 1, limit = PICKER_PAGE_SIZE } = {}) => {
  const params = { compact: 1, limit, page };
  if (clean(search)) params.search = clean(search);
  for (const key of SERVER_FILTER_KEYS) {
    if (isMeaningful(filters?.[key])) params[key] = clean(filters[key]);
  }
  if (filters?.inStockOnly) params.inStockOnly = 1;
  return params;
};

// Canonical, order-independent signature. The cache keys on this so a filtered
// page can never be served as an unfiltered one (or as a different filter).
export const pickerQueryKey = (params = {}) =>
  Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
