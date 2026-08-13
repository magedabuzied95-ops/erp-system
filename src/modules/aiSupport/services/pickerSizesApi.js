import { api } from "../../../shared/api/api";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value ?? "").trim();

// Builds the shared query params for the size-first picker endpoints from the
// picker's current sizeMode filter state. Empty / "all" values are omitted so the
// backend param-stripping keeps the query minimal.
const buildSizeParams = ({ brand, gender, types, offerStory = false, minPrice, maxPrice, search } = {}) => {
  const params = {};
  const brandValue = clean(brand);
  if (brandValue && brandValue.toLowerCase() !== "all") params.brand = brandValue;
  const genderValue = clean(gender);
  if (genderValue && genderValue.toLowerCase() !== "all") params.gender = genderValue;
  const typeValues = asArray(types).map(clean).filter(Boolean);
  if (typeValues.length) params.product_type = typeValues.join(",");
  if (offerStory) params.offer_story = 1;
  if (clean(minPrice)) params.min_price = clean(minPrice);
  if (clean(maxPrice)) params.max_price = clean(maxPrice);
  if (clean(search)) params.search = clean(search);
  return params;
};

// GET /products/available-sizes → { sizes:[{size,product_count}], brands:[], types:[] }
export const getAvailableProductSizes = async (filters = {}, options = {}) => {
  const payload = await api.get("/products/available-sizes", {
    params: buildSizeParams(filters),
    perfComponent: "ProductCardPicker.availableSizes",
    timeoutMs: 15000,
    ...options,
  });
  return {
    sizes: asArray(payload?.sizes),
    brands: asArray(payload?.brands),
    types: asArray(payload?.types),
  };
};

// GET /products/by-size?count_only=1 → total match count for the selected size(s)+filters.
export const getProductsBySizeCount = async ({ sizes = [], ...filters } = {}, options = {}) => {
  const sizeValues = asArray(sizes).map(clean).filter(Boolean);
  const payload = await api.get("/products/by-size", {
    params: { ...buildSizeParams(filters), size: sizeValues.join(","), count_only: 1 },
    perfComponent: "ProductCardPicker.bySizeCount",
    timeoutMs: 15000,
    ...options,
  });
  return Number(payload?.total) || 0;
};
