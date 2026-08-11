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

// Normalises a selection into a clean list. Mirrors the server's
// normalizeAdminListFilterValues: drops blanks and "all", de-duplicates
// case-insensitively, preserves order and original casing.
const selectedValues = (value) => {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (!isMeaningful(entry)) continue;
    const text = clean(entry);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

// Filters the endpoint can apply across the whole catalog.
export const SERVER_FILTER_KEYS = ["brand", "manufacturer", "gender", "product_type", "grade", "size", "color"];
// Multi-select filters: sent as arrays so the server matches ANY of them (OR
// within the filter, AND against the other filters). The rest stay single-valued.
export const MULTI_SELECT_FILTER_KEYS = ["brand", "manufacturer"];

export const buildPickerParams = ({ search = "", filters = {}, page = 1, limit = PICKER_PAGE_SIZE } = {}) => {
  const params = { compact: 1, limit, page };
  if (clean(search)) params.search = clean(search);
  for (const key of SERVER_FILTER_KEYS) {
    const values = selectedValues(filters?.[key]);
    if (!values.length) continue;
    // A single selection is still sent as a scalar, so the request shape — and the
    // SQL it produces — is byte-identical for the common case.
    params[key] = MULTI_SELECT_FILTER_KEYS.includes(key) && values.length > 1 ? values : values[0];
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
