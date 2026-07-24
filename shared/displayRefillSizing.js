const clean = (value = "") => String(value ?? "").trim();
const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== "") ?? null;

export const parseSizeNumber = (value = "") => {
  const normalized = clean(value).replace(/[^0-9.]+/g, " ");
  const parsed = Number(normalized.match(/\d+(?:\.\d+)?/)?.[0] || NaN);
  return Number.isFinite(parsed) ? parsed : null;
};
export const normalizeSizeComparable = (value = "") => {
  const raw = clean(value);
  if (!raw) return "";
  return raw.match(/\d+(?:\.\d+)?/)?.[0] || raw.toLowerCase().replace(/\s+/g, " ").replace(/^eu\s+/i, "").replace(/^size\s+/i, "");
};
export const normalizeStockValue = (row = {}) => {
  const parsed = Number(firstDefined(row.stock, row.quantity, row.stock_quantity, row.available_quantity, row.available_stock, row.current_stock, row.remaining_stock));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
export const sortVariantsBySize = (variants = []) => [...(Array.isArray(variants) ? variants : [])]
  .map((row) => ({ ...row, size_number: parseSizeNumber(row.size), size_comparable: normalizeSizeComparable(row.size), stock: normalizeStockValue(row) }))
  .filter((row) => clean(row.size))
  .sort((a, b) => a.size_number !== null && b.size_number !== null ? a.size_number - b.size_number : a.size_number !== null ? -1 : b.size_number !== null ? 1 : clean(a.size).localeCompare(clean(b.size), "en"));
export const buildAvailableSizeOptions = (variants = []) => {
  const seen = new Set();
  return sortVariantsBySize(variants).flatMap((row) => {
    if (normalizeStockValue(row) <= 0 || !clean(row.size)) return [];
    const normalized = parseSizeNumber(row.size); if (normalized === null || seen.has(String(normalized))) return [];
    seen.add(String(normalized)); return [{ size: clean(row.size), normalized }];
  });
};
