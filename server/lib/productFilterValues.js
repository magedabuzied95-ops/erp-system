// Pure helpers for multi-select product filters. Kept dependency-free so the
// filter semantics are unit-testable without loading the controller (and its db
// connection).
//
// Semantics, unchanged from the single-value behaviour they replace:
//   OR  within one filter  — brand IN ('Nike','Adidas')
//   AND between filters    — brand AND manufacturer AND size AND ...
// The caller joins the returned fragments with AND.

export const normalizeAdminListFilterValue = (value = "") => String(value ?? "").trim();

/**
 * Normalises a filter selection into a clean list of values.
 * Accepts a single value or an array (Express parses `brand[]=A&brand[]=B` into
 * an array). Drops blanks and the "all" sentinel, and de-duplicates
 * case-insensitively while preserving the caller's original casing and order.
 *
 * Passing an array to the single-value normaliser used to stringify it to "A,B",
 * which matched nothing — a multi-selection silently returned an empty page.
 */
export const normalizeAdminListFilterValues = (value) => {
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const text = normalizeAdminListFilterValue(entry);
    if (!text || text.toLowerCase() === "all") continue;
    const dedupeKey = text.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(text);
  }
  return out;
};

/**
 * `expr = $1` for a single value, `expr IN ($1,$2,…)` for several.
 * Pushes the bound values onto `values` and returns the SQL fragment, so a
 * single selection produces byte-identical SQL to the previous implementation.
 */
export const buildInClause = (expr, selectedValues, values) => {
  if (!selectedValues.length) return "";
  if (selectedValues.length === 1) {
    values.push(selectedValues[0]);
    return `${expr} = $${values.length}`;
  }
  const tokens = selectedValues.map((entry) => {
    values.push(entry);
    return `$${values.length}`;
  });
  return `${expr} IN (${tokens.join(", ")})`;
};
