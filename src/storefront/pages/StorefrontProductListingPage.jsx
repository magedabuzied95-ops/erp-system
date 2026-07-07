import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  EmptyState,
  GuidedGenderStep,
  GuidedGradeStep,
  GuidedProductTypeStep,
  GuidedSizeFilter,
  LazyFiltersDrawer,
  MobileFilterTrigger,
  PremiumFilterPanel,
  ProductGrid,
  SectionIntro,
  StepPill,
  buildAvailableSizeOptions,
  deferReactState,
  isLastPieceProduct,
  getProductTypeLabel,
  productHasAvailableSize,
  sfText,
  truthyFlag,
  uniqueClassificationOptions,
  classificationLabel,
  displayComparePrice,
  displaySellingPrice,
  firstDisplayVariant,
  filterOptionCount,
  normalizeAudienceValue,
  money,
  sortStorefrontColorCardsByModel,
  useBodyScrollLock,
  useProducts,
  normalizeFilterKey,
} from "../Storefront";
import { useProductClassifications } from "../../modules/products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../../modules/products/lib/productClassifications";
import { Baby, Briefcase, ChevronLeft, DollarSign, Gem, Footprints, ShoppingBag, Shirt, SlidersHorizontal, Tag, UserRound, Users, X } from "lucide-react";

const normalizeFilterText = (value = "") => String(value ?? "").trim();
const normalizeAudienceFilterKey = (value = "") => normalizeFilterKey(String(value ?? "").normalize("NFKD").replace(/[\u0640\u200c\u200d\u200e\u200f]/g, "").replace(/\p{M}+/gu, "")).replace(/['\u2019]/g, "'");
const normalizeStorefrontAudienceValue = (value = "") => {
  const normalized = normalizeAudienceFilterKey(value);
  if (["men", "man", "male", "mens", "men's", "رجالي", "رجال"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies", "lady", "حريمي", "نسائي", "نساء"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls", "أطفال", "اطفال", "طفل", "ولادي", "بناتي"].includes(normalized)) return "kids";
  return normalizeAudienceValue(value) || "";
};
const normalizeStorefrontProductTypeValue = (value = "") => {
  const normalized = normalizeAudienceFilterKey(value);
  if (["bag", "bags", "handbag", "handbags", "شنط", "شنطة", "شنطتي", "حقائب", "حقيبة", "حقيبه"].includes(normalized)) return "bags";
  if (["croc", "crocs", "كروكس"].includes(normalized)) return "crocs";
  if (["slipper", "slippers", "slide", "slides", "سليبر", "شباشب"].includes(normalized)) return "slippers";
  if (["sneaker", "sneakers", "سنيكرز"].includes(normalized)) return "sneakers";
  if (["shoe", "shoes", "أحذية", "حذاء"].includes(normalized)) return "shoes";
  if (["running", "run", "رياضي", "جري"].includes(normalized)) return "running";
  if (["casual shoe", "casual shoes", "casual", "كاجوال", "كاجوال شوز"].includes(normalized)) return "casualshoes";
  return normalizeFilterKey(value).replace(/[\s_-]+/g, "");
};
const storefrontProductTypeQueryValue = (value = "") => {
  return normalizeStorefrontProductTypeValue(value);
};
const storefrontGenderSwitchOptions = [
  { value: "men", label: "رجالي" },
  { value: "women", label: "حريمي" },
  { value: "kids", label: "أطفال" },
];
const normalizeStorefrontSearchTerm = (value = "") =>
  normalizeStorefrontAudienceValue(value) || normalizeFilterKey(String(value ?? "").normalize("NFKD").replace(/[\u0640\u200c\u200d\u200e\u200f]/g, "").replace(/\p{M}+/gu, ""));
const productListingAudienceValues = (product = {}) => {
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|]+/)
      .map((entry) => normalizeStorefrontAudienceValue(entry))
      .filter(Boolean)
      .forEach((entry) => seen.add(entry));
  };
  visit(product.audience);
  visit(product.audiences);
  visit(product.gender);
  visit(product.genders);
  visit(product.product_audience);
  visit(product.product_audiences);
  visit(product.target_audience);
  return Array.from(seen);
};
const splitFacetValues = (value = "") =>
  String(value ?? "")
    .split(/[,\|/]+/)
    .map((item) => normalizeFilterText(item))
    .filter(Boolean);
const parseNumberValue = (value) => {
  if (!normalizeFilterText(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const readMultiQueryValues = (params, keys = []) => {
  const values = [];
  (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
    if (!key) return;
    values.push(...params.getAll(key).flatMap(splitFacetValues));
  });
  return Array.from(new Set(values.map(normalizeFilterText).filter(Boolean)));
};
const writeMultiQueryValues = (params, key, values = []) => {
  const nextValues = Array.from(new Set((Array.isArray(values) ? values : [values]).map(normalizeFilterText).filter(Boolean)));
  params.delete(key);
  nextValues.forEach((value) => params.append(key, value));
};
const uniqueByKey = (items = [], keyGetter = (item) => item?.id || item?.slug || item?.card_id || "") => {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item, index) => {
    const key = normalizeFilterText(keyGetter(item, index));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const productFacetPrice = (product = {}) => {
  const variant = firstDisplayVariant(Array.isArray(product?.variants) ? product.variants : []);
  return Number(displaySellingPrice(product, variant) || product.price || product.final_price || product.selling_price || product.regular_price || 0) || 0;
};
const productFacetStock = (product = {}) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variantStock = variants.reduce(
    (sum, variant) => sum + Number(variant?.stock || variant?.quantity || variant?.inventory_stock || variant?.available_stock || 0),
    0
  );
  const directStock = Number(product?.total_stock || product?.stock || product?.inventory_stock || product?.available_stock || product?.quantity || 0) || 0;
  return Number(directStock || variantStock || 0) || 0;
};
const storefrontKnownBrandPrefixes = [
  "Air Jordan",
  "The North Face",
  "New Balance",
  "Skechers",
  "Adidas",
  "Nike",
  "Jordan",
  "Reebok",
  "Converse",
  "Vans",
  "Puma",
  "DC",
];
const normalizeBrandFacetText = (value = "") =>
  normalizeFilterKey(
    String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0640\u200c\u200d\u200e\u200f]/g, "")
      .replace(/\p{M}+/gu, "")
  ).replace(/\s+/g, " ").trim();
const deriveKnownBrandLabel = (value = "") => {
  const normalized = normalizeBrandFacetText(value);
  if (!normalized) return "";
  return storefrontKnownBrandPrefixes.find((brand) => {
    const normalizedBrand = normalizeBrandFacetText(brand);
    if (normalized === normalizedBrand) return true;
    if (normalized.startsWith(`${normalizedBrand} `)) return true;
    return normalizedBrand === "dc" && (normalized === "dc shoes" || normalized.startsWith("dc "));
  }) || "";
};
const productFacetBrandValues = (product = {}) => {
  const values = [];
  const addValues = (source = {}) => {
    values.push(
      source.brand,
      source.brand_name,
      source.brandName,
      source.product_brand,
      source.productBrand,
      source.manufacturer_brand
    );
  };
  addValues(product);
  (Array.isArray(product?.variants) ? product.variants : []).forEach(addValues);
  const explicit = values.filter(Boolean);
  if (!explicit.length) {
    const derived = deriveKnownBrandLabel([product.name, product.title, product.product_name, product.display_name, product.displayName].filter(Boolean).join(" "));
    if (derived) explicit.push(derived);
  }
  return splitFacetValues(explicit.join(" | "));
};
const productFacetCategoryValues = (product = {}) => splitFacetValues([
  product.category,
  product.category_name,
  product.categoryName,
  product.product_type,
  product.productType,
].filter(Boolean).join(" | "));
const catalogListingProductKey = (product = {}, index = 0) =>
  String(
      product?.card_id ||
      product?.storefront_card_id ||
      product?.id ||
      product?.product_id ||
      product?.productId ||
      product?.slug ||
      product?.canonical_slug ||
      product?.color_key ||
      product?.display_color_key ||
      product?.selected_variant_id ||
      product?.display_variant_id ||
      product?.name ||
      product?.title ||
      product?.product_name ||
      product?.productName ||
      product?.label ||
      product?.display_name ||
      product?.displayName ||
      index
  ).trim();
const normalizeCatalogListingProduct = (product = {}) => {
  const id = catalogListingProductKey(product);
  const name = String(product?.name || product?.title || product?.product_name || product?.productName || product?.label || product?.display_name || product?.displayName || id || "").trim();
  const resolvedBrand =
    normalizeFilterText(product?.brand)
      || normalizeFilterText(product?.brand_name)
      || normalizeFilterText(product?.brandName)
      || normalizeFilterText(product?.product_brand)
      || normalizeFilterText(product?.manufacturer_brand)
      || deriveKnownBrandLabel([product?.name, product?.title, product?.product_name, product?.productName, product?.label, product?.display_name, product?.displayName].filter(Boolean).join(" "));
  return {
    ...product,
    id,
    name,
    is_storefront_visible: product?.is_storefront_visible ?? true,
    card_id: product?.card_id || product?.storefront_card_id || id,
    storefront_card_id: product?.storefront_card_id || product?.card_id || id,
    product_id: product?.product_id || product?.productId || id,
    slug: product?.slug || product?.canonical_slug || id,
    title: product?.title || name,
    product_name: product?.product_name || name,
    brand: resolvedBrand || product?.brand || "",
    brand_name: resolvedBrand || product?.brand_name || "",
    brandName: resolvedBrand || product?.brandName || "",
    product_brand: resolvedBrand || product?.product_brand || "",
    manufacturer_brand: product?.manufacturer_brand || "",
  };
};
const productGradeValues = (product = {}) => splitFacetValues([
  product.grade,
  product.quality,
  product.condition,
].filter(Boolean).join(" | "));
const productFacetColorValues = (product = {}) => splitFacetValues([
  product.color,
  product.color_name,
  product.colorName,
  product.display_color,
  product.displayColor,
  product.primary_color,
  product.variant_color,
  ...(Array.isArray(product?.variants)
    ? product.variants.flatMap((variant) => [
        variant?.color,
        variant?.color_name,
        variant?.colorName,
        variant?.display_color,
        variant?.displayColor,
      ])
    : []),
].filter(Boolean).join(" | "));
const normalizeCatalogSortValue = (value = "") => {
  const normalized = normalizeFilterKey(value);
  if (["new", "newest", "latest", "recent"].includes(normalized)) return "newest";
  if (["price_desc", "price-desc", "price_high", "price-high", "high_to_low", "high-low"].includes(normalized)) return "price_desc";
  if (["price_asc", "price-asc", "price_low", "price-low", "low_to_high", "low-high"].includes(normalized)) return "price_asc";
  if (["best_selling", "bestselling", "best-selling", "popular", "trending", "top_sales", "top-seller", "sales"].includes(normalized)) return "best_selling";
  if (["most_viewed", "most-viewed", "viewed", "views", "top_viewed", "top-viewed"].includes(normalized)) return "most_viewed";
  return "newest";
};
const productNewestScore = (product = {}) => new Date(product.created_at || product.createdAt || product.published_at || product.updated_at || 0).getTime() || Number(product.id || 0);
const productPopularityScore = (product = {}) => {
  const sold = Number(product.total_sold ?? product.sold_count ?? product.sales_count ?? product.order_count ?? product.orders_count ?? product.units_sold ?? 0);
  const viewed = Number(product.views_count ?? product.view_count ?? product.product_views ?? product.analytics?.views ?? 0);
  const featured = product.featured || product.is_featured || product.home_featured ? 1 : 0;
  return (Number.isFinite(sold) ? sold * 1000 : 0) + (Number.isFinite(viewed) ? viewed * 10 : 0) + (featured * 500) + Math.min(productFacetStock(product), 100);
};
const sortCatalogProducts = (products = [], sort = "") => {
  const normalizedSort = normalizeCatalogSortValue(sort);
  const items = Array.isArray(products) ? [...products] : [];
  const fallback = (a, b) =>
    productNewestScore(b) - productNewestScore(a) ||
    String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""), "ar", { numeric: true }) ||
    String(a.id || "").localeCompare(String(b.id || ""), "en", { numeric: true });
  const sorters = {
    newest: (a, b) => productNewestScore(b) - productNewestScore(a) || fallback(a, b),
    price_desc: (a, b) => productFacetPrice(b) - productFacetPrice(a) || productNewestScore(b) - productNewestScore(a) || fallback(a, b),
    price_asc: (a, b) => productFacetPrice(a) - productFacetPrice(b) || productNewestScore(b) - productNewestScore(a) || fallback(a, b),
    best_selling: (a, b) =>
      (Number(b.total_sold ?? b.sold_count ?? b.sales_count ?? b.order_count ?? b.orders_count ?? b.units_sold ?? 0) -
        Number(a.total_sold ?? a.sold_count ?? a.sales_count ?? a.order_count ?? a.orders_count ?? a.units_sold ?? 0)) ||
      productPopularityScore(b) - productPopularityScore(a) ||
      productNewestScore(b) - productNewestScore(a) ||
      fallback(a, b),
    most_viewed: (a, b) =>
      (Number(b.views_count ?? b.view_count ?? b.product_views ?? b.analytics?.views ?? 0) - Number(a.views_count ?? a.view_count ?? a.product_views ?? a.analytics?.views ?? 0)) ||
      productNewestScore(b) - productNewestScore(a) ||
      productPopularityScore(b) - productPopularityScore(a) ||
      fallback(a, b),
  };
  return items.sort(sorters[normalizedSort] || sorters.newest);
};
const catalogQuickCategoryItems = [
  { key: "men", label: "رجالي", field: "gender", value: "men", icon: "shirt" },
  { key: "women", label: "حريمي", field: "gender", value: "women", icon: "user" },
  { key: "kids", label: "أطفال", field: "gender", value: "kids", icon: "baby" },
  { key: "bags", label: getProductTypeLabel("bags", "ar"), field: "type", value: "bags", icon: "bag" },
  { key: "crocs", label: getProductTypeLabel("crocs", "ar"), field: "type", value: "crocs", icon: "footprints" },
  { key: "slippers", label: getProductTypeLabel("slippers", "ar"), field: "type", value: "slippers", icon: "footprints" },
];
const catalogQuickCategoryIcon = (value = "") => {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("shirt") || normalized.includes("men")) return Shirt;
  if (normalized.includes("user") || normalized.includes("women")) return UserRound;
  if (normalized.includes("baby") || normalized.includes("kids")) return Baby;
  if (normalized.includes("bag")) return ShoppingBag;
  if (normalized.includes("foot")) return Footprints;
  return Briefcase;
};
const buildFacetOptions = (products = [], valueGetter = () => [], selectedValue = "") => {
  const selectedKey = normalizeFilterKey(selectedValue);
  const map = new Map();
  (Array.isArray(products) ? products : []).forEach((product) => {
    const values = Array.from(new Set((valueGetter(product) || []).map(normalizeFilterText).filter(Boolean)));
    values.forEach((value) => {
      const key = normalizeFilterKey(value);
      if (!key) return;
      const current = map.get(key) || { id: key, value: key, label: value, count: 0 };
      current.count += 1;
      if (!current.label) current.label = value;
      map.set(key, current);
    });
  });
  return Array.from(map.values())
    .filter((option) => option.count > 0 || normalizeFilterKey(option.value) === selectedKey)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ar", { numeric: true }));
};
const countAudienceMatches = (products = [], optionValue = "") => {
  const target = normalizeStorefrontAudienceValue(optionValue);
  if (!target) return 0;
  return (Array.isArray(products) ? products : []).reduce((count, product) => count + (productListingAudienceValues(product).includes(target) ? 1 : 0), 0);
};
const applyCatalogFilters = (products = [], filters = {}, ignore = []) => {
  const ignoreSet = new Set(Array.isArray(ignore) ? ignore : [ignore].filter(Boolean));
  const selectedGender = normalizeStorefrontAudienceValue(filters.gender);
  const selectedCategory = normalizeFilterKey(filters.category);
  const selectedBrand = normalizeFilterKey(filters.brand);
  const selectedProductType = normalizeFilterKey(filters.productType);
  const selectedGrade = normalizeFilterKey(filters.grade);
  const selectedQuality = normalizeFilterKey(filters.quality);
  const selectedColor = normalizeFilterKey(filters.color);
  const selectedSizes = new Set((Array.isArray(filters.sizes) ? filters.sizes : []).map(normalizeFilterKey).filter(Boolean));
  const minPrice = parseNumberValue(filters.minPrice);
  const maxPrice = parseNumberValue(filters.maxPrice);
  const saleOnly = Boolean(filters.saleView);
  const lastSizesOnly = Boolean(filters.lastSizes);
  const inStockOnly = Boolean(filters.inStock);
  return (Array.isArray(products) ? products : []).filter((product) => {
    if (!product?.id || !product?.name) {
      return false;
    }
    if (saleOnly) {
      const price = Number(displaySellingPrice(product) || productFacetPrice(product) || 0) || 0;
      const comparePrice = Number(displayComparePrice(product) || 0) || 0;
      if (!(comparePrice > price)) {
        return false;
      }
    }
    if (lastSizesOnly && !isLastPieceProduct(product)) {
      return false;
    }
    if (inStockOnly && productFacetStock(product) <= 0) {
      return false;
    }

    if (!ignoreSet.has("gender") && selectedGender && !productListingAudienceValues(product).includes(selectedGender)) {
      return false;
    }
    if (!ignoreSet.has("category") && selectedCategory) {
      const categoryValues = productFacetCategoryValues(product).map(normalizeFilterKey);
      if (!categoryValues.includes(selectedCategory)) {
        return false;
      }
    }
    if (!ignoreSet.has("brand") && selectedBrand) {
      const brandValues = productFacetBrandValues(product).map(normalizeFilterKey);
      if (!brandValues.includes(selectedBrand)) {
        return false;
      }
    }
    if (!ignoreSet.has("productType") && selectedProductType) {
      const typeValues = productFacetCategoryValues(product).map(normalizeFilterKey);
      if (!typeValues.includes(selectedProductType)) {
        return false;
      }
    }
    if (!ignoreSet.has("grade") && selectedGrade) {
      const gradeValues = productGradeValues(product).map(normalizeFilterKey);
      if (!gradeValues.includes(selectedGrade)) {
        return false;
      }
    }
    if (!ignoreSet.has("quality") && selectedQuality) {
      const qualityValues = productGradeValues(product).map(normalizeFilterKey);
      if (!qualityValues.includes(selectedQuality)) {
        return false;
      }
    }
    if (!ignoreSet.has("color") && selectedColor) {
      const colorValues = productFacetColorValues(product).map(normalizeFilterKey);
      if (!colorValues.includes(selectedColor)) {
        return false;
      }
    }
    if (!ignoreSet.has("sizes") && selectedSizes.size) {
      const sizeValues = (Array.isArray(product.variants) ? product.variants : [])
        .map((variant) => normalizeFilterKey(variant?.size))
        .filter(Boolean);
      if (!sizeValues.some((sizeValue) => selectedSizes.has(sizeValue))) {
        return false;
      }
    }
    if (minPrice !== null || maxPrice !== null) {
      const price = productFacetPrice(product);
      if (minPrice !== null && price < minPrice) {
        return false;
      }
      if (maxPrice !== null && price > maxPrice) {
        return false;
      }
    }
    return true;
  });
};

export function StorefrontProductListingPage({ sale = false, wishlist, toggleWishlist, onAddToCart }) {
  const { i18n, t } = useTranslation();
  const lang = i18n.language || "ar";
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const brand = params.get("brand") || "";
  const genderParam = params.get("gender") || "";
  const typeParam = params.get("type") || "";
  const normalizedSearchTerm = normalizeStorefrontSearchTerm(q);
  const searchGender = normalizeStorefrontAudienceValue(q);
  const gender = normalizeStorefrontAudienceValue(genderParam) || genderParam || searchGender;
  const backendSearchTerm = searchGender ? "" : q;
  const size = params.get("size") || "";
  const selectedSizes = useMemo(() => readMultiQueryValues(params, ["size", "sizes"]), [params]);
  const color = params.get("color") || "";
  const inStock = params.get("inStock") || "";
  const quality = params.get("quality") || "";
  const productType = normalizeStorefrontProductTypeValue(params.get("product_type") || typeParam || "");
  const selectedType = productType || "";
  const grade = params.get("grade") || "";
  const minPrice = params.get("min_price") || "";
  const maxPrice = params.get("max_price") || "";
  const sort = params.get("sort") || "";
  const selectedSort = normalizeCatalogSortValue(sort);
  const saleQuery = truthyFlag(params.get("sale"));
  const offerStoryQuery = truthyFlag(params.get("offer_story") || params.get("offerStory"));
  const lastSizes = truthyFlag(params.get("lastSizes") || params.get("last_sizes"));
  const saleView = sale || saleQuery || offerStoryQuery;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedGender, setSelectedGender] = useState(gender);
  const [selectedGrade, setSelectedGrade] = useState(grade);
  const [selectedProductType, setSelectedProductType] = useState(productType);
  const [selectedSize, setSelectedSize] = useState(size);
  const [currentStep, setCurrentStep] = useState(gender ? (grade ? (productType ? "grid" : "productType") : "grade") : "gender");
  const productTypeStepRef = useRef(null);
  const gradeStepRef = useRef(null);
  const gridStepRef = useRef(null);
  const [draftFilters, setDraftFilters] = useState({ gender, product_type: productType, grade });
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const classificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, { gender, productType, grade }, { includeInactive: false }),
    [classificationGroups, gender, grade, productType]
  );
  const productsApiParams = useMemo(
    () => ({ q: backendSearchTerm, gender: gender || "", offer_story: saleView ? 1 : "", sort, limit: 500 }),
    [backendSearchTerm, gender, saleView, sort]
  );
  const { products, loading, error } = useProducts(productsApiParams, { ttlMs: 0 });
  const filterBasePath = sale ? "/sale" : "/products";
  const activeFilterCount = [
    brand,
    gender,
    category,
    selectedSizes.length,
    size,
    color,
    inStock,
    quality,
    productType,
    grade,
    minPrice,
    maxPrice,
    selectedSort !== "newest" ? selectedSort : "",
    saleQuery ? "sale" : "",
    lastSizes ? "lastSizes" : "",
  ].filter(Boolean).length;

  useEffect(() => {
    if (!params.has("style")) return;
    const next = new URLSearchParams(params);
    next.delete("style");
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`, { replace: true });
  }, [filterBasePath, navigate, params]);

  const catalogProducts = useMemo(
    () =>
      uniqueByKey(
        (Array.isArray(products) ? products : [])
          .map(normalizeCatalogListingProduct)
          .filter((product) => Boolean(product?.id || product?.name || product?.title || product?.product_name))
      ),
    [products]
  );
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[storefront-listing-normalized-products]", catalogProducts.slice(0, 5).map((product) => ({
      id: product.id,
      name: product.name,
      title: product.title,
      brand: product.brand,
      brand_name: product.brand_name,
      product_brand: product.product_brand,
      manufacturer_brand: product.manufacturer_brand,
    })));
  }, [catalogProducts]);
  useEffect(() => {
    if (!import.meta.env.DEV || !(saleView || offerStoryQuery)) return;
    console.log("[offer-story-listing-catalog]", {
      requestUrl: `/storefront/products?${new URLSearchParams(productsApiParams).toString()}`,
      catalogCount: catalogProducts.length,
      sample: catalogProducts.slice(0, 5).map((product) => ({
        id: product.id,
        name: product.name,
        is_offer_story: product.is_offer_story,
        is_storefront_visible: product.is_storefront_visible,
        active: product.active,
      })),
    });
  }, [catalogProducts, offerStoryQuery, productsApiParams, saleView]);
  const catalogFilters = useMemo(
    () => ({
      gender,
      category,
      brand,
      productType,
      grade,
      color,
      quality,
      sizes: selectedSizes,
      minPrice,
      maxPrice,
      saleView,
      lastSizes,
      inStock,
    }),
    [brand, category, color, grade, inStock, lastSizes, maxPrice, minPrice, productType, quality, saleView, selectedSizes, gender]
  );
  const catalogFiltersWithoutGender = useMemo(
    () => ({ ...catalogFilters, gender: "" }),
    [catalogFilters]
  );
  const hasActiveCatalogFilters = Boolean(
    gender ||
      category ||
      brand ||
      productType ||
      grade ||
      quality ||
      color ||
      selectedSizes.length ||
      minPrice ||
      maxPrice ||
      saleView ||
      lastSizes ||
      inStock
  );
  const filterCatalogProducts = (items = [], filters = {}, ignore = []) => {
    const ignoreSet = new Set(Array.isArray(ignore) ? ignore : [ignore].filter(Boolean));
    const selectedGender = normalizeStorefrontAudienceValue(filters.gender);
    const selectedCategory = normalizeFilterKey(filters.category);
    const selectedBrand = normalizeFilterKey(filters.brand);
    const selectedProductType = normalizeFilterKey(filters.productType);
    const selectedGrade = normalizeFilterKey(filters.grade);
    const selectedQuality = normalizeFilterKey(filters.quality);
    const selectedColor = normalizeFilterKey(filters.color);
    const selectedSizesSet = new Set((Array.isArray(filters.sizes) ? filters.sizes : []).map(normalizeFilterKey).filter(Boolean));
    const min = parseNumberValue(filters.minPrice);
    const max = parseNumberValue(filters.maxPrice);
    const saleOnlyActive = Boolean(filters.saleView);
    const lastSizesOnlyActive = Boolean(filters.lastSizes);
    const inStockOnlyActive = Boolean(filters.inStock);
    const output = [];

    for (const product of Array.isArray(items) ? items : []) {
      if (!product?.id || !product?.name) continue;
      if (saleOnlyActive) {
        const price = Number(displaySellingPrice(product) || productFacetPrice(product) || 0) || 0;
        const comparePrice = Number(displayComparePrice(product) || 0) || 0;
        if (!(comparePrice > price)) continue;
      }
      if (lastSizesOnlyActive && !isLastPieceProduct(product)) continue;
      if (inStockOnlyActive && productFacetStock(product) <= 0) continue;

      if (!ignoreSet.has("gender") && selectedGender && !productListingAudienceValues(product).includes(selectedGender)) continue;
      if (!ignoreSet.has("category") && selectedCategory) {
        const categoryValues = productFacetCategoryValues(product).map(normalizeFilterKey);
        if (!categoryValues.includes(selectedCategory)) continue;
      }
      if (!ignoreSet.has("brand") && selectedBrand) {
        const brandValues = productFacetBrandValues(product).map(normalizeFilterKey);
        if (!brandValues.includes(selectedBrand)) continue;
      }
      if (!ignoreSet.has("productType") && selectedProductType) {
        const typeValues = productFacetCategoryValues(product).map(normalizeFilterKey);
        if (!typeValues.includes(selectedProductType)) continue;
      }
      if (!ignoreSet.has("grade") && selectedGrade) {
        const gradeValues = productGradeValues(product).map(normalizeFilterKey);
        if (!gradeValues.includes(selectedGrade)) continue;
      }
      if (!ignoreSet.has("quality") && selectedQuality) {
        const qualityValues = productGradeValues(product).map(normalizeFilterKey);
        if (!qualityValues.includes(selectedQuality)) continue;
      }
      if (!ignoreSet.has("color") && selectedColor) {
        const colorValues = productFacetColorValues(product).map(normalizeFilterKey);
        if (!colorValues.includes(selectedColor)) continue;
      }
      if (!ignoreSet.has("sizes") && selectedSizesSet.size) {
        const sizeValues = (Array.isArray(product.variants) ? product.variants : [])
          .map((variant) => normalizeFilterKey(variant?.size))
          .filter(Boolean);
        if (!sizeValues.some((sizeValue) => selectedSizesSet.has(sizeValue))) continue;
      }
      if (min !== null || max !== null) {
        const price = productFacetPrice(product);
        if (min !== null && price < min) continue;
        if (max !== null && price > max) continue;
      }
      output.push(product);
    }

    return output;
  };
  const filteredProducts = useMemo(
    () => (hasActiveCatalogFilters ? filterCatalogProducts(catalogProducts, catalogFiltersWithoutGender) : catalogProducts),
    [catalogFiltersWithoutGender, catalogProducts, hasActiveCatalogFilters]
  );
  const orderedFilteredProducts = useMemo(() => sortStorefrontColorCardsByModel(sortCatalogProducts(filteredProducts, selectedSort)), [filteredProducts, selectedSort]);
  const filteredProductsForGender = useMemo(
    () => (hasActiveCatalogFilters ? filterCatalogProducts(catalogProducts, catalogFilters, ["gender"]) : catalogProducts),
    [catalogFilters, catalogProducts, hasActiveCatalogFilters]
  );
  const filteredProductsForCategory = useMemo(
    () => (hasActiveCatalogFilters ? filterCatalogProducts(catalogProducts, catalogFilters, ["category"]) : catalogProducts),
    [catalogFilters, catalogProducts, hasActiveCatalogFilters]
  );
  const filteredProductsForBrand = useMemo(
    () => (hasActiveCatalogFilters ? filterCatalogProducts(catalogProducts, catalogFilters, ["brand"]) : catalogProducts),
    [catalogFilters, catalogProducts, hasActiveCatalogFilters]
  );
  const filteredProductsForGrade = useMemo(
    () => (hasActiveCatalogFilters ? filterCatalogProducts(catalogProducts, catalogFilters, ["grade"]) : catalogProducts),
    [catalogFilters, catalogProducts, hasActiveCatalogFilters]
  );
  const filteredProductsForColor = useMemo(
    () => (hasActiveCatalogFilters ? filterCatalogProducts(catalogProducts, catalogFilters, ["color"]) : catalogProducts),
    [catalogFilters, catalogProducts, hasActiveCatalogFilters]
  );
  const filteredProductsForSizes = useMemo(
    () => (hasActiveCatalogFilters ? filterCatalogProducts(catalogProducts, catalogFilters, ["sizes"]) : catalogProducts),
    [catalogFilters, catalogProducts, hasActiveCatalogFilters]
  );
  const filteredProductsForPrice = useMemo(
    () => (hasActiveCatalogFilters ? filterCatalogProducts(catalogProducts, catalogFilters, ["minPrice", "maxPrice"]) : catalogProducts),
    [catalogFilters, catalogProducts, hasActiveCatalogFilters]
  );
  const priceBounds = useMemo(() => {
    const prices = filteredProductsForPrice.map((product) => productFacetPrice(product)).filter((price) => Number.isFinite(price) && price >= 0);
    if (!prices.length) return { min: "", max: "" };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [filteredProductsForPrice]);
  const genderOptions = useMemo(
    () =>
      storefrontGenderSwitchOptions.map((option) => {
        const count = countAudienceMatches(filteredProductsForGender, option.value);
        return { ...option, count, product_count: count };
      }),
    [filteredProductsForGender]
  );
  const categoryOptions = useMemo(() => buildFacetOptions(filteredProductsForCategory, productFacetCategoryValues, category), [category, filteredProductsForCategory]);
  const brandOptions = useMemo(() => buildFacetOptions(filteredProductsForBrand, productFacetBrandValues, brand), [brand, filteredProductsForBrand]);
  const gradeOptions = useMemo(() => {
    const options = uniqueClassificationOptions(classificationOptions.grade || []);
    return options.map((option) => {
    const normalizedValue = normalizeFilterKey(option.value);
    const count = filteredProductsForGrade.reduce(
      (total, product) => total + (productGradeValues(product).map(normalizeFilterKey).includes(normalizedValue) ? 1 : 0),
      0
    );
    return { ...option, count, product_count: count };
    });
  }, [classificationOptions.grade, filteredProductsForGrade]);
  const typeOptions = useMemo(() => {
    const dynamicOptions = buildFacetOptions(
      applyCatalogFilters(catalogProducts, catalogFilters, ["productType", "category"]),
      productFacetCategoryValues,
      productType
    );
    const baseOptions = uniqueClassificationOptions(classificationOptions.productType || []);
    if (!dynamicOptions.length) return baseOptions;
    const seen = new Set(dynamicOptions.map((option) => normalizeFilterKey(option.value)));
    return uniqueClassificationOptions([
      ...dynamicOptions,
      ...baseOptions.filter((option) => !seen.has(normalizeFilterKey(option.value))),
    ]);
  }, [catalogFilters, catalogProducts, classificationOptions.productType, productType]);
  const colorOptions = useMemo(() => buildFacetOptions(filteredProductsForColor, productFacetColorValues, color), [color, filteredProductsForColor]);
  const availableSizes = useMemo(() => buildAvailableSizeOptions(filteredProductsForSizes), [filteredProductsForSizes]);
  const hasSalesData = useMemo(
    () =>
      catalogProducts.some((product) =>
        Number(product.total_sold ?? product.sold_count ?? product.sales_count ?? product.order_count ?? product.orders_count ?? product.units_sold ?? 0) > 0
      ),
    [catalogProducts]
  );
  const hasViewsData = useMemo(
    () =>
      catalogProducts.some((product) =>
        Number(product.views_count ?? product.view_count ?? product.product_views ?? product.analytics?.views ?? 0) > 0
      ),
    [catalogProducts]
  );
  const sortOptions = useMemo(
    () => {
      const options = [
        { value: "newest", label: t("storefront.products.sortNewest", "الأحدث") },
        { value: "price_desc", label: t("storefront.products.sortPriceDesc", "السعر من الأعلى للأقل") },
        { value: "price_asc", label: t("storefront.products.sortPriceAsc", "السعر من الأقل للأعلى") },
        hasSalesData ? { value: "best_selling", label: t("storefront.products.sortBestSelling", "الأكثر مبيعاً") } : null,
        hasViewsData ? { value: "most_viewed", label: t("storefront.products.sortMostViewed", "الأكثر مشاهدة") } : null,
      ].filter(Boolean);
      if (!options.some((option) => normalizeCatalogSortValue(option.value) === selectedSort)) {
        options.push({ value: selectedSort, label: sortLabelForValue(selectedSort, t) });
      }
      return options;
    },
    [hasSalesData, hasViewsData, selectedSort, t]
  );
  const selectedGenderOption = genderOptions.find((option) => normalizeStorefrontAudienceValue(option.value) === normalizeStorefrontAudienceValue(gender));
  const selectedGradeOption = gradeOptions.find((option) => normalizeFilterKey(option.value) === normalizeFilterKey(grade));
  const selectedTypeOption = typeOptions.find((option) => normalizeStorefrontProductTypeValue(option.value) === normalizeStorefrontProductTypeValue(productType));
  const selectedBrandOption = brandOptions.find((option) => normalizeFilterKey(option.value) === normalizeFilterKey(brand));
  const selectedColorOption = colorOptions.find((option) => normalizeFilterKey(option.value) === normalizeFilterKey(color));
  const selectedSortOption = sortOptions.find((option) => normalizeCatalogSortValue(option.value) === selectedSort);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.debug("[storefront-product-type-filter]", {
      availableProductTypeValues: typeOptions.map((option) => ({
        value: option.value,
        label: getProductTypeLabel(option.value, lang),
      })),
      selectedProductTypeValue: selectedType,
      selectedProductTypeLabel: getProductTypeLabel(selectedType, lang),
      appliedProductTypeValues: {
        type: params.get("type") || "",
        product_type: params.get("product_type") || "",
      },
      normalizedAppliedProductType: normalizeStorefrontProductTypeValue(params.get("type") || params.get("product_type") || ""),
    });
  }, [lang, params, selectedType, typeOptions]);

  const setSearchParam = (mutator, { replace = false } = {}) => {
    const next = new URLSearchParams(params);
    mutator(next);
    setParams(next, { replace });
  };
  const buildFilterUrl = (field, value) => {
    const next = new URLSearchParams(params);
    if (field === "type" || field === "productType") {
      next.delete("product_type");
      next.delete("category");
      if (value && value !== "all") next.set("type", value);
      else next.delete("type");
      return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
    }
    if (field === "gender") {
      if (value && value !== "all") next.set("gender", value);
      else next.delete("gender");
      return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
    }
    if (value && value !== "all") next.set(field, value);
    else next.delete(field);
    return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
  };
  const clearClassificationFiltersUrl = () => {
    const next = new URLSearchParams(params);
    ["q", "brand", "gender", "category", "product_type", "type", "style", "grade", "quality", "color", "size", "sizes", "min_price", "max_price", "inStock", "sale", "offer_story", "offerStory", "lastSizes", "last_sizes", "sort"].forEach((field) => next.delete(field));
    return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
  };
  const toggleSizeValue = (value) => {
    const nextValue = normalizeFilterText(value);
    if (!nextValue) return;
    setSearchParam((next) => {
      const current = new Set(readMultiQueryValues(next, ["size", "sizes"]).map(normalizeFilterKey));
      const normalized = normalizeFilterKey(nextValue);
      if (current.has(normalized)) current.delete(normalized);
      else current.add(normalized);
      writeMultiQueryValues(next, "size", Array.from(current));
      next.delete("sizes");
    });
  };
  const setSingleFilterValue = (field, value) => {
    setSearchParam((next) => {
      if (field === "type" || field === "productType") {
        next.delete("product_type");
        next.delete("category");
        if (normalizeFilterText(value)) next.set("type", String(value));
        else next.delete("type");
        return;
      }
      if (field === "gender") {
        if (normalizeFilterText(value)) next.set("gender", String(value));
        else next.delete("gender");
        return;
      }
      if (normalizeFilterText(value)) next.set(field, String(value));
      else next.delete(field);
    });
  };
  const setSortValue = (value) => {
    setSearchParam((next) => {
      const normalizedValue = normalizeCatalogSortValue(value);
      if (normalizedValue === "newest") next.delete("sort");
      else next.set("sort", normalizedValue);
    });
  };
  const setPriceRange = (min, max) => {
    setSearchParam((next) => {
      if (normalizeFilterText(min)) next.set("min_price", String(min));
      else next.delete("min_price");
      if (normalizeFilterText(max)) next.set("max_price", String(max));
      else next.delete("max_price");
    });
  };
  const showEmptyResults = !loading && !orderedFilteredProducts.length;
  const showGuidedProducts = Boolean(selectedGender && selectedGrade && selectedProductType);

  useEffect(() => {
    if (!import.meta.env.DEV || !(saleView || offerStoryQuery)) return;
    console.log("[offer-story-rendered]", {
      catalogCount: catalogProducts.length,
      filteredCount: orderedFilteredProducts.length,
      renderedCount: orderedFilteredProducts.length,
      hasActiveCatalogFilters,
      activeFilters: {
        gender,
        category,
        brand,
        productType,
        grade,
        color,
        size,
        selectedSizes,
        inStock,
        saleView,
        lastSizes,
        q,
      },
      sample: orderedFilteredProducts.slice(0, 5).map((product) => ({
        id: product.id,
        name: product.name,
        is_offer_story: product.is_offer_story,
        is_storefront_visible: product.is_storefront_visible,
        active: product.active,
      })),
    });
  }, [catalogProducts.length, gender, category, brand, productType, grade, color, size, selectedSizes, inStock, saleView, lastSizes, q, hasActiveCatalogFilters, orderedFilteredProducts, offerStoryQuery]);

  return (
    <section className="mx-auto max-w-7xl px-3 pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+2.25rem)] pt-2.5 md:px-4 md:py-5">
      <div className="flex flex-col gap-2 md:gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold text-stone-500 md:text-sm">{saleView ? t("storefront.products.limitedOffers", "عروض محدودة") : t("storefront.products.shopEasily", "تسوّق بسهولة")}</p>
          <h1 className="mt-1 text-[1.7rem] font-black leading-[1.08] md:text-3xl">
            {q
              ? t("storefront.search.resultsFor", "نتائج البحث عن \"{{query}}\"", { query: q })
              : selectedBrandOption
                ? classificationLabel(selectedBrandOption, lang)
                : selectedTypeOption
                  ? getProductTypeLabel(selectedTypeOption.value || productType, lang)
                  : selectedColorOption
                    ? classificationLabel(selectedColorOption, lang)
                    : selectedGenderOption
                      ? classificationLabel(selectedGenderOption, lang)
                    : category || (lastSizes ? t("storefront.home.lastSizes", "آخر المقاسات") : saleView ? t("storefront.nav.sale", "العروض") : t("storefront.products.allProducts", "كل المنتجات"))}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-bold text-stone-500">{t("storefront.products.productCount", "{{count}} منتج", { count: orderedFilteredProducts.length })}</div>
          <CatalogSortControl value={selectedSort} options={sortOptions} onChange={setSortValue} />
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-stone-200 bg-white px-3.5 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#d4af37]/45 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200 lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t("storefront.filters.filters", "الفلاتر")}
            {activeFilterCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#d4af37] px-1 text-[10px] text-white">{activeFilterCount}</span> : null}
          </button>
        </div>
      </div>

      <CatalogQuickChips
        params={params}
        lang={lang}
        items={catalogQuickCategoryItems}
        buildUrl={buildFilterUrl}
      />

      <CatalogAppliedFilterChips
        q={q}
        category={category}
        brand={brand}
        gender={gender}
        productType={productType}
        grade={grade}
        color={color}
        selectedSizes={selectedSizes}
        minPrice={minPrice}
        maxPrice={maxPrice}
        selectedSort={selectedSort}
        saleView={saleView}
        lastSizes={lastSizes}
        inStock={inStock}
        lang={lang}
        onClearAll={() => navigate(clearClassificationFiltersUrl())}
      onRemove={(field, value) => {
        setSearchParam((next) => {
          if (field === "q") {
            next.delete("q");
            return;
          }
          if (field === "size") {
            const current = new Set(readMultiQueryValues(next, ["size", "sizes"]).map(normalizeFilterKey));
            current.delete(normalizeFilterKey(value));
            if (current.size) writeMultiQueryValues(next, "size", Array.from(current));
            else next.delete("size");
            next.delete("sizes");
            return;
          }
          if (field === "type" || field === "productType") {
            next.delete("type");
            next.delete("product_type");
            next.delete("category");
            return;
          }
          if (field === "price") {
            next.delete("min_price");
            next.delete("max_price");
            return;
          }
          if (field === "sort") {
            next.delete("sort");
            return;
          }
          next.delete(field);
        });
      }}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:block">
          <div className="sticky top-[7.5rem]">
            <CatalogFiltersPanel
              lang={lang}
              title={t("storefront.filters.filters", "الفلاتر")}
              sortOptions={sortOptions}
              selectedSort={selectedSort}
              onSortChange={setSortValue}
              genderOptions={genderOptions}
              selectedGender={gender}
              onGenderChange={(value) => setSingleFilterValue("gender", value)}
              typeOptions={typeOptions}
              selectedType={productType}
              onTypeChange={(value) => setSingleFilterValue("type", storefrontProductTypeQueryValue(normalizeStorefrontProductTypeValue(value)))}
              gradeOptions={gradeOptions}
              selectedGrade={grade}
              onGradeChange={(value) => setSingleFilterValue("grade", value)}
              brandOptions={brandOptions}
              selectedBrand={brand}
              onBrandChange={(value) => setSingleFilterValue("brand", value)}
              colorOptions={colorOptions}
              selectedColor={color}
              onColorChange={(value) => setSingleFilterValue("color", value)}
              sizes={availableSizes}
              selectedSizes={selectedSizes}
              onToggleSize={toggleSizeValue}
              onClearSizes={() => setSearchParam((next) => {
                next.delete("size");
                next.delete("sizes");
              })}
              minPrice={minPrice}
              maxPrice={maxPrice}
              onPriceChange={setPriceRange}
              priceBounds={priceBounds}
              saleView={saleView}
              lastSizes={lastSizes}
              inStock={inStock}
              onToggleFlag={(field) => setSearchParam((next) => {
                if (next.get(field)) next.delete(field);
                else next.set(field, "1");
              })}
              onClearAll={() => navigate(clearClassificationFiltersUrl())}
            />
          </div>
        </aside>

        <div className="min-w-0">
          {error ? <EmptyState title={t("storefront.errors.simpleProblem", "Something went wrong")} text={t("storefront.errors.tryAgainOrWhatsapp", "Try again or contact us on WhatsApp")} /> : null}
          {showEmptyResults ? (
            <EmptyState
              title={t("storefront.products.emptyTitle", "لا توجد منتجات مطابقة للفلاتر الحالية")}
              text={t("storefront.products.emptyText", "جرّب مسح بعض الفلاتر أو عرض كل المنتجات")}
              actionTo={clearClassificationFiltersUrl()}
              actionLabel={t("storefront.filters.resetFilters", "مسح الفلاتر")}
            />
          ) : (
            <>
              <ProductGrid
                products={orderedFilteredProducts}
                loading={loading}
                wishlist={wishlist}
                toggleWishlist={toggleWishlist}
                onAddToCart={onAddToCart}
              />
            </>
          )}
        </div>
      </div>

      <CatalogFiltersDrawer
        open={filtersOpen}
        lang={lang}
        title={t("storefront.filters.filters", "الفلاتر")}
        sortOptions={sortOptions}
        selectedSort={selectedSort}
        onSortChange={setSortValue}
        genderOptions={genderOptions}
        selectedGender={gender}
        onGenderChange={(value) => setSingleFilterValue("gender", value)}
        typeOptions={typeOptions}
        selectedType={productType}
        onTypeChange={(value) => setSingleFilterValue("type", storefrontProductTypeQueryValue(normalizeStorefrontProductTypeValue(value)))}
        gradeOptions={gradeOptions}
        selectedGrade={grade}
        onGradeChange={(value) => setSingleFilterValue("grade", value)}
        brandOptions={brandOptions}
        selectedBrand={brand}
        onBrandChange={(value) => setSingleFilterValue("brand", value)}
        colorOptions={colorOptions}
        selectedColor={color}
        onColorChange={(value) => setSingleFilterValue("color", value)}
        sizes={availableSizes}
        selectedSizes={selectedSizes}
        onToggleSize={toggleSizeValue}
        onClearSizes={() => setSearchParam((next) => {
          next.delete("size");
          next.delete("sizes");
        })}
        minPrice={minPrice}
        maxPrice={maxPrice}
        onPriceChange={setPriceRange}
        priceBounds={priceBounds}
        saleView={saleView}
        lastSizes={lastSizes}
        inStock={inStock}
        onToggleFlag={(field) => setSearchParam((next) => {
          if (next.get(field)) next.delete(field);
          else next.set(field, "1");
        })}
        onClose={() => setFiltersOpen(false)}
        onClearAll={() => navigate(clearClassificationFiltersUrl())}
      />
    </section>
  );
}

function CatalogSizeFilter({ sizes = [], selectedSizes = [], onToggle, onClear }) {
  const { t } = useTranslation();
  const selectedSet = new Set((Array.isArray(selectedSizes) ? selectedSizes : []).map(normalizeFilterKey).filter(Boolean));
  return (
    <section className="rounded-[1.35rem] border border-stone-200 bg-white p-3 shadow-[0_12px_32px_rgba(39,20,75,0.06)] dark:border-white/10 dark:bg-[#0d0d0d] md:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#d4af37] dark:text-[#f3d77a]">{t("storefront.filters.sizeFilter", "فلتر المقاسات")}</p>
          <h3 className="mt-0.5 text-sm font-black text-stone-950 dark:text-white">{t("storefront.filters.availableSize", "المقاسات المتاحة")}</h3>
        </div>
        {selectedSet.size ? (
          <button type="button" onClick={onClear} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-[11px] font-black text-stone-600 transition hover:border-[#d4af37]/35 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
            {t("storefront.filters.showAllSizes", "عرض كل المقاسات")}
          </button>
        ) : null}
      </div>
      <div className="sf-scroll flex flex-wrap gap-2">
        {sizes.map((item) => {
          const key = normalizeFilterKey(item.size);
          const active = selectedSet.has(key);
          return (
            <button
              key={item.size}
              type="button"
              onClick={() => onToggle(item.size)}
              className={`inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border px-3.5 py-2 text-sm font-black transition md:min-h-11 md:px-4 ${active ? "border-[#d4af37] bg-[#d4af37] text-white shadow-[0_10px_24px_rgba(212,175,55,0.24)]" : "border-stone-200 bg-stone-50 text-stone-700 hover:border-[#d4af37]/45 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"}`}
            >
              {item.size}
              {Number(item.productCount || 0) ? <span className={active ? "text-white/72" : "text-stone-400 dark:text-stone-500"}>({item.productCount})</span> : null}
            </button>
          );
        })}
        {!sizes.length ? (
          <span className="rounded-full border border-dashed border-stone-200 px-3 py-2 text-xs font-bold text-stone-400 dark:border-white/10 dark:text-stone-500">
            {t("storefront.filters.sizesAppearAfterType", "ستظهر المقاسات بعد اختيار نوع المنتج")}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function CatalogPriceFilter({ minPrice = "", maxPrice = "", onChange, priceBounds = {} }) {
  const { t } = useTranslation();
  const hasValue = Boolean(normalizeFilterText(minPrice) || normalizeFilterText(maxPrice));
  const resolvedMinBound = Number.isFinite(Number(priceBounds.min)) ? Number(priceBounds.min) : 0;
  const resolvedMaxBound = Number.isFinite(Number(priceBounds.max)) ? Number(priceBounds.max) : resolvedMinBound;
  const rangeSpan = Math.max(1, resolvedMaxBound - resolvedMinBound);
  const currentMin = Number.isFinite(Number(minPrice)) ? Number(minPrice) : resolvedMinBound;
  const currentMax = Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : resolvedMaxBound;
  const safeMin = Math.min(Math.max(currentMin, resolvedMinBound), currentMax);
  const safeMax = Math.max(Math.min(currentMax, resolvedMaxBound), safeMin);
  const minPercent = ((safeMin - resolvedMinBound) / rangeSpan) * 100;
  const maxPercent = ((safeMax - resolvedMinBound) / rangeSpan) * 100;
  const handleMinChange = (nextValue) => {
    const nextMin = Math.min(Math.max(Number(nextValue) || resolvedMinBound, resolvedMinBound), safeMax);
    onChange(String(nextMin), normalizeFilterText(maxPrice) ? String(safeMax) : String(safeMax));
  };
  const handleMaxChange = (nextValue) => {
    const nextMax = Math.max(Math.min(Number(nextValue) || resolvedMaxBound, resolvedMaxBound), safeMin);
    onChange(normalizeFilterText(minPrice) ? String(safeMin) : String(safeMin), String(nextMax));
  };
  return (
    <section className="rounded-[1.35rem] border border-stone-200 bg-white p-3 shadow-[0_12px_32px_rgba(39,20,75,0.06)] dark:border-white/10 dark:bg-[#0d0d0d] md:p-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-stone-950 dark:text-white">{t("storefront.filters.filterByPrice", "فلترة بالسعر")}</h3>
        </div>
        {hasValue ? (
          <button type="button" onClick={() => onChange("", "")} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-[11px] font-black text-stone-600 transition hover:border-[#d4af37]/35 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
            {t("common.reset", "مسح")}
          </button>
        ) : null}
      </div>
      <div className="space-y-3">
        <div className="rounded-[1.15rem] border border-stone-200 bg-stone-50 px-3 py-4 dark:border-white/10 dark:bg-white/5">
          <div className="relative mx-1 h-10" dir="ltr">
            <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-stone-200 dark:bg-white/10" />
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#d4af37] to-[#a855f7]"
              style={{ left: `${minPercent}%`, right: `${100 - maxPercent}%` }}
            />
            <input
              type="range"
              min={resolvedMinBound}
              max={resolvedMaxBound}
              step="1"
              value={safeMin}
              onChange={(event) => handleMinChange(event.target.value)}
              className="absolute inset-0 z-20 h-10 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#d4af37] [&::-webkit-slider-thumb]:shadow-[0_8px_20px_rgba(212,175,55,0.35)] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#d4af37] [&::-moz-range-thumb]:shadow-[0_8px_20px_rgba(212,175,55,0.35)]"
              aria-label={t("storefront.filters.minPrice", "أقل")}
            />
            <input
              type="range"
              min={resolvedMinBound}
              max={resolvedMaxBound}
              step="1"
              value={safeMax}
              onChange={(event) => handleMaxChange(event.target.value)}
              className="absolute inset-0 z-30 h-10 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#d4af37] [&::-webkit-slider-thumb]:shadow-[0_8px_20px_rgba(212,175,55,0.35)] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[#d4af37] [&::-moz-range-thumb]:shadow-[0_8px_20px_rgba(212,175,55,0.35)]"
              aria-label={t("storefront.filters.maxPrice", "أعلى")}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-[11px] font-black text-stone-600 dark:text-stone-300">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">{t("storefront.filters.minPrice", "أقل سعر")}</span>
            <span className="mt-0.5 block text-sm font-black text-stone-950 dark:text-white">{money(safeMin)} جنيه</span>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">{t("storefront.filters.maxPrice", "أعلى سعر")}</span>
            <span className="mt-0.5 block text-sm font-black text-stone-950 dark:text-white">{money(safeMax)} جنيه</span>
          </div>
        </div>
        <p className="text-[11px] font-bold text-stone-500 dark:text-stone-400">
          {priceBounds.min !== "" && priceBounds.max !== "" ? `${money(priceBounds.min)} - ${money(priceBounds.max)}` : t("storefront.filters.priceHint", "استخدم نطاق السعر لتضييق النتائج")}
        </p>
      </div>
    </section>
  );
}

function CatalogSectionShell({ eyebrow, title, icon: Icon = SlidersHorizontal, action = null, children, className = "" }) {
  return (
    <section className={`rounded-[1.35rem] border border-stone-200 bg-white p-3 shadow-[0_12px_32px_rgba(39,20,75,0.06)] dark:border-white/10 dark:bg-[#0d0d0d] md:p-4 ${className}`}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-2xl border border-stone-200 bg-stone-50 text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-[#f3d77a]">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-stone-950 dark:text-white">{title}</h3>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CatalogSortControl({ value = "newest", options = [], onChange, compact = false }) {
  const { t } = useTranslation();
  return (
    <label className={`inline-flex min-h-10 items-center gap-2 rounded-full border border-stone-200 bg-white px-3.5 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#d4af37]/45 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200 ${compact ? "w-full justify-between" : ""}`}>
      <SlidersHorizontal className="h-4 w-4 shrink-0" />
      <select
        value={normalizeCatalogSortValue(value)}
        onChange={(event) => onChange?.(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-right text-xs font-black outline-none md:text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CatalogQuickChips({ params, items = [], buildUrl, lang = "ar" }) {
  return (
    <div className="sf-scroll mt-3 hidden min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1.5 rtl:justify-start md:mt-4 md:flex">
      {items.map((item) => {
        const activeValue = item.field === "gender" ? normalizeStorefrontAudienceValue(params.get("gender")) : normalizeStorefrontProductTypeValue(params.get("type") || params.get("product_type"));
        const isActive =
          item.field === "gender"
            ? normalizeStorefrontAudienceValue(activeValue) === normalizeStorefrontAudienceValue(item.value)
            : normalizeStorefrontProductTypeValue(activeValue) === normalizeStorefrontProductTypeValue(item.value);
        const Icon = catalogQuickCategoryIcon(item.icon);
        const label = item.field === "type" ? getProductTypeLabel(item.value, lang) : item.label;
        return (
          <Link
            key={item.key}
            to={buildUrl(item.field === "gender" ? "gender" : "type", item.value)}
            aria-current={isActive ? "page" : undefined}
            dir="rtl"
            className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-[14px] text-[12px] font-semibold transition duration-200 ease-out active:scale-[0.98] ${isActive ? "border border-[#d4af37]/55 bg-[#d4af37]/12 text-[#d4af37] shadow-[0_10px_28px_rgba(212,175,55,0.12)]" : "border border-stone-200 bg-white text-stone-700 hover:border-[#d4af37]/35 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"}`}
          >
            <Icon className="h-[15px] w-[15px] shrink-0" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function CatalogAppliedFilterChips({
  q = "",
  category = "",
  brand = "",
  gender = "",
  productType = "",
  grade = "",
  color = "",
  selectedSizes = [],
  minPrice = "",
  maxPrice = "",
  selectedSort = "newest",
  saleView = false,
  lastSizes = false,
  inStock = "",
  lang = "ar",
  onRemove,
  onClearAll,
}) {
  const { t } = useTranslation();
  const chips = [];
  if (q) chips.push({ key: "q", label: q, field: "q" });
  if (gender) chips.push({ key: "gender", label: gender === "men" ? "رجالي" : gender === "women" ? "حريمي" : "أطفال", field: "gender" });
  if (category) chips.push({ key: "category", label: category, field: "category" });
  if (productType) chips.push({ key: "type", label: getProductTypeLabel(productType, lang), field: "type" });
  if (grade) chips.push({ key: "grade", label: grade, field: "grade" });
  if (brand) chips.push({ key: "brand", label: brand, field: "brand" });
  if (color) chips.push({ key: "color", label: color, field: "color" });
  (Array.isArray(selectedSizes) ? selectedSizes : []).forEach((size) => {
    if (size) chips.push({ key: `size:${size}`, label: size, field: "size", value: size });
  });
  if (minPrice || maxPrice) chips.push({ key: "price", label: `${normalizeFilterText(minPrice) || "0"} - ${normalizeFilterText(maxPrice) || "∞"} جنيه`, field: "price" });
  if (normalizeCatalogSortValue(selectedSort) !== "newest") chips.push({ key: "sort", label: sortLabelForValue(selectedSort, t), field: "sort" });
  if (!chips.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemove?.(chip.field, chip.value || chip.label)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#d4af37]/18 bg-[#d4af37]/8 px-3 py-1.5 text-[12px] font-black text-[#4c1d95] transition hover:border-[#d4af37]/35 hover:bg-[#d4af37]/12 dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
        >
          <span className="truncate">{chip.label}</span>
          <X className="h-3.5 w-3.5" />
        </button>
      ))}
      {chips.length > 1 ? (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex min-h-9 items-center rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-black text-stone-700 transition hover:-translate-y-0.5 hover:border-[#d4af37]/35 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
        >
          {t("storefront.filters.clearAll", "مسح الكل")}
        </button>
      ) : null}
    </div>
  );
}

function sortLabelForValue(value = "", t = (key, fallback) => fallback) {
  const normalized = normalizeCatalogSortValue(value);
  if (normalized === "price_desc") return t("storefront.products.sortPriceDesc", "السعر من الأعلى للأقل");
  if (normalized === "price_asc") return t("storefront.products.sortPriceAsc", "السعر من الأقل للأعلى");
  if (normalized === "best_selling") return t("storefront.products.sortBestSelling", "الأكثر مبيعاً");
  if (normalized === "most_viewed") return t("storefront.products.sortMostViewed", "الأكثر مشاهدة");
  return t("storefront.products.sortNewest", "الأحدث");
}

function CatalogSingleSelectFilter({
  eyebrow,
  title,
  icon: Icon = SlidersHorizontal,
  options = [],
  value = "",
  onChange,
  onClear,
  lang = "ar",
  emptyLabel,
  normalizeValue = normalizeFilterKey,
}) {
  const { t } = useTranslation();
  const hasValue = Boolean(normalizeFilterKey(value));
  return (
    <CatalogSectionShell
      eyebrow={eyebrow}
      title={title}
      icon={Icon}
      action={hasValue ? (
        <button type="button" onClick={onClear} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-[11px] font-black text-stone-600 transition hover:border-[#d4af37]/35 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
          {t("common.reset", "مسح")}
        </button>
      ) : null}
    >
      <div className="sf-scroll flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange("")}
          className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-black transition ${
            !hasValue
              ? "border-[#d4af37] bg-[#d4af37] text-white shadow-[0_10px_24px_rgba(212,175,55,0.24)]"
              : "border-stone-200 bg-stone-50 text-stone-700 hover:border-[#d4af37]/45 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
          }`}
        >
          {emptyLabel || t("common.all", "الكل")}
        </button>
        {options.map((option) => {
          const optionValue = String(option.value || "").trim();
          const active = normalizeValue(value) === normalizeValue(optionValue);
          const count = filterOptionCount(option);
          return (
            <button
              key={option.id || option.value}
              type="button"
              onClick={() => onChange(optionValue)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-black transition ${
                active
                  ? "border-[#d4af37]/70 bg-[#d4af37] text-white shadow-[0_10px_24px_rgba(212,175,55,0.24)]"
                  : "border-stone-200 bg-stone-50 text-stone-700 hover:border-[#d4af37]/45 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
              }`}
            >
              <span className="truncate">{classificationLabel(option, lang)}</span>
              {count !== null ? <span className={active ? "text-white/70" : "text-stone-400 dark:text-stone-500"}>({count})</span> : null}
            </button>
          );
        })}
      </div>
    </CatalogSectionShell>
  );
}

function CatalogFiltersPanel({
  lang,
  title,
  sortOptions = [],
  selectedSort = "newest",
  onSortChange,
  genderOptions = [],
  selectedGender = "",
  onGenderChange,
  typeOptions = [],
  selectedType = "",
  onTypeChange,
  gradeOptions = [],
  selectedGrade = "",
  onGradeChange,
  brandOptions = [],
  selectedBrand = "",
  onBrandChange,
  colorOptions = [],
  selectedColor = "",
  onColorChange,
  sizes = [],
  selectedSizes = [],
  onToggleSize,
  onClearSizes,
  minPrice = "",
  maxPrice = "",
  onPriceChange,
  priceBounds = {},
  saleView = false,
  lastSizes = false,
  inStock = "",
  onToggleFlag,
  onClearAll,
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3">
      <CatalogSectionShell eyebrow={t("storefront.filters.sort", "ترتيب")} title={t("storefront.filters.sort", "ترتيب")} icon={SlidersHorizontal}>
        <CatalogSortControl value={selectedSort} options={sortOptions} onChange={onSortChange} compact />
      </CatalogSectionShell>
      <CatalogSingleSelectFilter eyebrow={t("storefront.filters.gender", "الجنس")} title={t("storefront.filters.gender", "الجنس")} icon={Users} options={genderOptions} value={selectedGender} onChange={onGenderChange} onClear={() => onGenderChange("")} lang={lang} normalizeValue={normalizeStorefrontAudienceValue} />
          <CatalogSingleSelectFilter eyebrow={t("storefront.filters.productType", "نوع المنتج")} title={t("storefront.filters.productType", "نوع المنتج")} icon={Footprints} options={typeOptions} value={selectedType} onChange={onTypeChange} onClear={() => onTypeChange("")} lang={lang} normalizeValue={normalizeStorefrontProductTypeValue} />
      <CatalogSingleSelectFilter eyebrow={t("storefront.filters.grade", "الفئة / الجودة")} title={t("storefront.filters.grade", "الفئة / الجودة")} icon={Gem} options={gradeOptions} value={selectedGrade} onChange={onGradeChange} onClear={() => onGradeChange("")} lang={lang} />
      <CatalogSizeFilter sizes={sizes} selectedSizes={selectedSizes} onToggle={onToggleSize} onClear={onClearSizes} />
      <CatalogPriceFilter minPrice={minPrice} maxPrice={maxPrice} onChange={onPriceChange} priceBounds={priceBounds} />
      <CatalogSingleSelectFilter eyebrow={t("storefront.filters.color", "اللون")} title={t("storefront.filters.color", "اللون")} icon={Tag} options={colorOptions} value={selectedColor} onChange={onColorChange} onClear={() => onColorChange("")} lang={lang} />
      <CatalogSingleSelectFilter eyebrow={t("storefront.filters.brand", "البرند")} title={t("storefront.filters.brand", "البرند")} icon={Briefcase} options={brandOptions} value={selectedBrand} onChange={onBrandChange} onClear={() => onBrandChange("")} lang={lang} />
      {onClearAll ? (
        <button type="button" onClick={onClearAll} className="rounded-[1.25rem] border border-stone-200 bg-white px-4 py-3 text-sm font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#d4af37]/45 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
          {t("storefront.filters.clearAll", "مسح الكل")}
        </button>
      ) : null}
    </div>
  );
}

function CatalogFiltersDrawer({
  open,
  lang,
  title,
  sortOptions,
  selectedSort,
  onSortChange,
  genderOptions,
  selectedGender,
  onGenderChange,
  typeOptions,
  selectedType,
  onTypeChange,
  gradeOptions,
  selectedGrade,
  onGradeChange,
  brandOptions,
  selectedBrand,
  onBrandChange,
  colorOptions,
  selectedColor,
  onColorChange,
  sizes,
  selectedSizes,
  onToggleSize,
  onClearSizes,
  minPrice,
  maxPrice,
  onPriceChange,
  priceBounds,
  saleView,
  lastSizes,
  inStock,
  onToggleFlag,
  onClose,
  onClearAll,
}) {
  const { t } = useTranslation();
  useBodyScrollLock(open);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[170] lg:hidden" dir="rtl" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 bg-stone-950/65 backdrop-blur-sm" onClick={onClose} aria-label={t("common.close", "إغلاق")} />
      <div className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-hidden rounded-t-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,#0d0d0d_0%,#050814_100%)] text-white shadow-[0_-28px_80px_rgba(0,0,0,0.48)]">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-white/20" />
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3.5 py-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#f3d77a]">{t("storefront.filters.premiumFilters", "الفلاتر")}</p>
            <h2 className="text-base font-black">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 transition active:scale-95" aria-label={t("common.close", "إغلاق")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scroll max-h-[calc(92dvh-138px)] space-y-3 overflow-y-auto px-3 py-3 pb-28">
          <CatalogFiltersPanel
            lang={lang}
            title={title}
            sortOptions={sortOptions}
            selectedSort={selectedSort}
            onSortChange={onSortChange}
            genderOptions={genderOptions}
            selectedGender={selectedGender}
            onGenderChange={onGenderChange}
            typeOptions={typeOptions}
            selectedType={selectedType}
            onTypeChange={onTypeChange}
            gradeOptions={gradeOptions}
            selectedGrade={selectedGrade}
            onGradeChange={onGradeChange}
            brandOptions={brandOptions}
            selectedBrand={selectedBrand}
            onBrandChange={onBrandChange}
            colorOptions={colorOptions}
            selectedColor={selectedColor}
            onColorChange={onColorChange}
            sizes={sizes}
            selectedSizes={selectedSizes}
            onToggleSize={onToggleSize}
            onClearSizes={onClearSizes}
            minPrice={minPrice}
            maxPrice={maxPrice}
            onPriceChange={onPriceChange}
            priceBounds={priceBounds}
            saleView={saleView}
            lastSizes={lastSizes}
            inStock={inStock}
            onToggleFlag={onToggleFlag}
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-white/10 bg-[#050814]/92 px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.7rem)] backdrop-blur-xl">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-gradient-to-l from-[#d4af37] to-[#151515] px-4 py-2.5 text-sm font-black text-white shadow-[0_14px_34px_rgba(212,175,55,0.32)] active:scale-[0.98]">
            {t("storefront.filters.applyFilters", "تطبيق")}
          </button>
          <button
            type="button"
            onClick={() => {
              onClearAll?.();
              onClose?.();
            }}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-white/80 active:scale-[0.98]"
          >
            {t("common.reset", "مسح")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

