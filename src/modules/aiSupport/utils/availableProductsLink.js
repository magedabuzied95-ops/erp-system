const clean = (value = "") => String(value ?? "").trim();

const CANONICAL_STOREFRONT_ORIGIN = "https://m1store-egy.com";

const resolvePublicStorefrontOrigin = () => {
  if (typeof window === "undefined") return CANONICAL_STOREFRONT_ORIGIN;
  const currentOrigin = clean(window.location?.origin).replace(/\/+$/g, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(currentOrigin)) return currentOrigin;
  return CANONICAL_STOREFRONT_ORIGIN;
};

const uniqueTextValues = (values = []) =>
  [...new Set(values.map((item) => clean(item)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));

const uniqueSizeValues = (values = []) =>
  [...new Set(values.map((item) => clean(item)).filter(Boolean))].sort((a, b) => {
    const left = Number(a);
    const right = Number(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    return a.localeCompare(b, "ar");
  });

const normalizeSizes = (sizes = []) => {
  const list = Array.isArray(sizes) ? sizes : [sizes];
  return uniqueSizeValues(
    list.flatMap((item) => {
      const text = clean(item);
      if (!text) return [];
      return text.split(",").map((part) => clean(part)).filter(Boolean);
    })
  );
};

const normalizeFilterValue = (value = "") => {
  const text = clean(value);
  if (!text) return "";
  if (text.toLowerCase() === "all") return "";
  return text;
};

const normalizeFilterValues = (value = "") =>
  uniqueTextValues((Array.isArray(value) ? value : [value]).map(normalizeFilterValue).filter(Boolean));

export const buildAvailableProductsUrl = ({
  sizes = [],
  gender = "",
  type = "",
  brand = "",
  minPrice = "",
  maxPrice = "",
} = {}) => {
  const params = new URLSearchParams();
  normalizeSizes(sizes).forEach((size) => params.append("size", size));
  const normalizedGender = normalizeFilterValue(gender);
  const normalizedTypes = normalizeFilterValues(type);
  const normalizedBrand = normalizeFilterValue(brand);
  if (normalizedGender) params.set("gender", normalizedGender);
  normalizedTypes.forEach((item) => params.append("type", item));
  if (normalizedBrand) params.set("brand", normalizedBrand);
  if (clean(minPrice)) params.set("min_price", clean(minPrice));
  if (clean(maxPrice)) params.set("max_price", clean(maxPrice));
  params.set("inStock", "1");
  params.set("v", "6");
  const query = params.toString();
  const path = `/share/available${query ? `?${query}` : ""}`;
  return `${resolvePublicStorefrontOrigin()}${path}`;
};

export const buildAvailableProductsMessage = (filters = {}, url = "") => {
  const sizes = normalizeSizes(filters.sizes);
  const sizeLabel = sizes.length > 1 ? "المقاسات" : "المقاس";
  const sizeText = sizes.length ? sizes.join("، ") : "";
  const selectedFilters = uniqueTextValues([
    normalizeFilterValue(filters.gender),
    normalizeFilterValues(filters.type).join("، "),
    normalizeFilterValue(filters.brand),
    clean(filters.minPrice) ? `أقل سعر ${clean(filters.minPrice)}` : "",
    clean(filters.maxPrice) ? `أعلى سعر ${clean(filters.maxPrice)}` : "",
  ]);
  const finalUrl = clean(url) || buildAvailableProductsUrl(filters);
  const parts = [
    sizeText ? `دي كل الموديلات المتاحة ${sizeLabel} ${sizeText}` : "دي كل الموديلات المتاحة",
    selectedFilters.length ? `الفلاتر: ${selectedFilters.join(" / ")}` : "",
    finalUrl ? `افتح المنتجات من هنا:\n${finalUrl}` : "",
  ].filter(Boolean);
  return parts.join("\n");
};

export const normalizeAvailableProductsSizes = normalizeSizes;
