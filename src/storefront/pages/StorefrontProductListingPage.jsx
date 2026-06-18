import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  EmptyState,
  GuidedGenderStep,
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
  productHasAvailableSize,
  sfText,
  truthyFlag,
  uniqueClassificationOptions,
  classificationLabel,
  displaySellingPrice,
  firstDisplayVariant,
  normalizeAudienceValue,
  money,
  sortStorefrontColorCardsByModel,
  useBodyScrollLock,
  useProducts,
  useStorefrontGenderClassifications,
} from "../Storefront";
import { useProductClassifications } from "../../modules/products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../../modules/products/lib/productClassifications";
import { ChevronLeft, DollarSign, Gem, Footprints, SlidersHorizontal, Tag, Users, X } from "lucide-react";

const normalizeFilterText = (value = "") => String(value ?? "").trim();
const normalizeFilterKey = (value = "") => normalizeFilterText(value).toLowerCase();
const normalizeAudienceFilterKey = (value = "") => normalizeFilterKey(String(value ?? "").normalize("NFKD").replace(/[\u0640\u200c\u200d\u200e\u200f]/g, "").replace(/\p{M}+/gu, "")).replace(/['\u2019]/g, "'");
const normalizeStorefrontAudienceValue = (value = "") => {
  const normalized = normalizeAudienceFilterKey(value);
  if (["men", "man", "male", "mens", "men's", "رجالي", "رجال"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies", "lady", "نسائي", "نساء", "حريمي"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls", "أطفال", "اطفال", "طفل", "ولادي", "بناتي"].includes(normalized)) return "kids";
  return normalizeAudienceValue(value) || "";
};
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
const productFacetBrandValues = (product = {}) => splitFacetValues([
  product.brand,
  product.brand_name,
  product.brandName,
  product.manufacturer,
  product.manufacturer_name,
  product.vendor,
  product.vendor_name,
].filter(Boolean).join(" | "));
const productFacetCategoryValues = (product = {}) => splitFacetValues([
  product.category,
  product.category_name,
  product.categoryName,
  product.product_type,
  product.productType,
].filter(Boolean).join(" | "));
const productFacetQualityValues = (product = {}) => splitFacetValues([
  product.grade,
  product.quality,
  product.condition,
].filter(Boolean).join(" | "));
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
  const selectedSizes = new Set((Array.isArray(filters.sizes) ? filters.sizes : []).map(normalizeFilterKey).filter(Boolean));
  const minPrice = parseNumberValue(filters.minPrice);
  const maxPrice = parseNumberValue(filters.maxPrice);
  const saleOnly = Boolean(filters.saleView);
  const lastSizesOnly = Boolean(filters.lastSizes);
  const inStockOnly = Boolean(filters.inStock);

  return (Array.isArray(products) ? products : []).filter((product) => {
    if (!product?.id || !product?.name) return false;
    if (saleOnly) {
      const price = productFacetPrice(product);
      const salePrice = Number(product.sale_price || product.offer_price || 0) || 0;
      if (!(salePrice > 0 && salePrice < price)) return false;
    }
    if (lastSizesOnly && !isLastPieceProduct(product)) return false;
    if (inStockOnly && productFacetStock(product) <= 0) return false;

    if (!ignoreSet.has("gender") && selectedGender && !productListingAudienceValues(product).includes(selectedGender)) return false;
    if (!ignoreSet.has("category") && selectedCategory) {
      const categoryValues = productFacetCategoryValues(product).map(normalizeFilterKey);
      if (!categoryValues.includes(selectedCategory)) return false;
    }
    if (!ignoreSet.has("brand") && selectedBrand) {
      const brandValues = productFacetBrandValues(product).map(normalizeFilterKey);
      if (!brandValues.includes(selectedBrand)) return false;
    }
    if (!ignoreSet.has("productType") && selectedProductType) {
      const typeValues = productFacetCategoryValues(product).map(normalizeFilterKey);
      if (!typeValues.includes(selectedProductType)) return false;
    }
    if (!ignoreSet.has("grade") && selectedGrade) {
      const gradeValues = productFacetQualityValues(product).map(normalizeFilterKey);
      if (!gradeValues.includes(selectedGrade)) return false;
    }
    if (!ignoreSet.has("quality") && selectedQuality) {
      const qualityValues = productFacetQualityValues(product).map(normalizeFilterKey);
      if (!qualityValues.includes(selectedQuality)) return false;
    }
    if (!ignoreSet.has("sizes") && selectedSizes.size) {
      const sizeValues = (Array.isArray(product.variants) ? product.variants : [])
        .map((variant) => normalizeFilterKey(variant?.size))
        .filter(Boolean);
      if (!sizeValues.some((sizeValue) => selectedSizes.has(sizeValue))) return false;
    }
    if (minPrice !== null || maxPrice !== null) {
      const price = productFacetPrice(product);
      if (minPrice !== null && price < minPrice) return false;
      if (maxPrice !== null && price > maxPrice) return false;
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
  const normalizedSearchTerm = normalizeStorefrontSearchTerm(q);
  const searchGender = normalizeStorefrontAudienceValue(q);
  const gender = normalizeStorefrontAudienceValue(genderParam) || genderParam || searchGender;
  const backendSearchTerm = searchGender ? "" : q;
  const size = params.get("size") || "";
  const selectedSizes = useMemo(() => readMultiQueryValues(params, ["size", "sizes"]), [params]);
  const inStock = params.get("inStock") || "";
  const quality = params.get("quality") || "";
  const productType = params.get("product_type") || "";
  const grade = params.get("grade") || "";
  const minPrice = params.get("min_price") || "";
  const maxPrice = params.get("max_price") || "";
  const sort = params.get("sort") || "";
  const saleQuery = truthyFlag(params.get("sale"));
  const lastSizes = truthyFlag(params.get("lastSizes") || params.get("last_sizes"));
  const saleView = sale || saleQuery;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedGender, setSelectedGender] = useState(gender);
  const [selectedProductType, setSelectedProductType] = useState(productType);
  const [selectedSize, setSelectedSize] = useState(size);
  const [currentStep, setCurrentStep] = useState(gender ? (productType ? "grid" : "productType") : "gender");
  const productTypeStepRef = useRef(null);
  const gridStepRef = useRef(null);
  const [draftFilters, setDraftFilters] = useState({ gender, product_type: productType, grade });
  useBodyScrollLock(filtersOpen);
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const { options: storefrontGenderOptions } = useStorefrontGenderClassifications();
  const classificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false }),
    [classificationGroups]
  );
  const isGuidedCategoryFlow = !q && !category && !brand && !saleView && !lastSizes && !gender && !size && !inStock && !quality && !productType && !grade && !sort;
  const productsApiParams = useMemo(
    () => ({ q: backendSearchTerm, gender: gender || "", sale: saleView ? 1 : "", sort, limit: 500 }),
    [backendSearchTerm, gender, saleView, sort]
  );
  const { products, loading, error } = useProducts(productsApiParams);
  const filterBasePath = sale ? "/shop/sale" : "/shop/products";
  const activeFilterCount = [
    brand,
    gender,
    category,
    selectedSizes.length,
    size,
    inStock,
    quality,
    productType,
    grade,
    minPrice,
    maxPrice,
    saleQuery ? "sale" : "",
    lastSizes ? "lastSizes" : "",
  ].filter(Boolean).length;

  useEffect(() => {
    if (!params.has("style")) return;
    const next = new URLSearchParams(params);
    next.delete("style");
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`, { replace: true });
  }, [filterBasePath, navigate, params]);

  const catalogProducts = useMemo(() => uniqueByKey((Array.isArray(products) ? products : []).filter((product) => product?.id && product?.name)), [products]);
  const catalogFilters = useMemo(
    () => ({
      gender,
      category,
      brand,
      productType,
      grade,
      quality,
      sizes: selectedSizes,
      minPrice,
      maxPrice,
      saleView,
      lastSizes,
      inStock,
    }),
    [brand, category, grade, inStock, lastSizes, maxPrice, minPrice, productType, quality, saleView, selectedSizes, gender]
  );
  const filteredProducts = useMemo(() => applyCatalogFilters(catalogProducts, catalogFilters), [catalogFilters, catalogProducts]);
  const orderedFilteredProducts = useMemo(() => sortStorefrontColorCardsByModel(filteredProducts), [filteredProducts]);
  const filteredProductsForGender = useMemo(() => applyCatalogFilters(catalogProducts, catalogFilters, ["gender"]), [catalogFilters, catalogProducts]);
  const filteredProductsForCategory = useMemo(() => applyCatalogFilters(catalogProducts, catalogFilters, ["category"]), [catalogFilters, catalogProducts]);
  const filteredProductsForBrand = useMemo(() => applyCatalogFilters(catalogProducts, catalogFilters, ["brand"]), [catalogFilters, catalogProducts]);
  const filteredProductsForGrade = useMemo(() => applyCatalogFilters(catalogProducts, catalogFilters, ["grade"]), [catalogFilters, catalogProducts]);
  const filteredProductsForSizes = useMemo(() => applyCatalogFilters(catalogProducts, catalogFilters, ["sizes"]), [catalogFilters, catalogProducts]);
  const filteredProductsForPrice = useMemo(() => applyCatalogFilters(catalogProducts, catalogFilters, ["minPrice", "maxPrice"]), [catalogFilters, catalogProducts]);
  const priceBounds = useMemo(() => {
    const prices = filteredProductsForPrice.map((product) => productFacetPrice(product)).filter((price) => Number.isFinite(price) && price >= 0);
    if (!prices.length) return { min: "", max: "" };
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [filteredProductsForPrice]);

  const genderOptions = useMemo(() => {
    const baseGenderOptions = uniqueClassificationOptions((storefrontGenderOptions.length ? storefrontGenderOptions : classificationOptions.gender) || []);
    return baseGenderOptions
      .map((option) => {
        const count = countAudienceMatches(filteredProductsForGender, option.value);
        return { ...option, count, product_count: count };
      })
      .filter((option) => option.count > 0 || normalizeFilterKey(option.value) === normalizeFilterKey(gender));
  }, [classificationOptions.gender, filteredProductsForGender, gender, storefrontGenderOptions]);
  const categoryOptions = useMemo(() => buildFacetOptions(filteredProductsForCategory, productFacetCategoryValues, category), [category, filteredProductsForCategory]);
  const brandOptions = useMemo(() => buildFacetOptions(filteredProductsForBrand, productFacetBrandValues, brand), [brand, filteredProductsForBrand]);
  const gradeOptions = useMemo(() => buildFacetOptions(filteredProductsForGrade, productFacetQualityValues, grade), [filteredProductsForGrade, grade]);
  const availableSizes = useMemo(() => buildAvailableSizeOptions(filteredProductsForSizes), [filteredProductsForSizes]);

  const setSearchParam = (mutator, { replace = false } = {}) => {
    const next = new URLSearchParams(params);
    mutator(next);
    setParams(next, { replace });
  };
  const buildFilterUrl = (field, value) => {
    const next = new URLSearchParams(params);
    if (value && value !== "all") next.set(field, value);
    else next.delete(field);
    return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
  };
  const clearClassificationFiltersUrl = () => {
    const next = new URLSearchParams(params);
    ["q", "brand", "gender", "category", "product_type", "style", "grade", "quality", "size", "sizes", "min_price", "max_price", "inStock"].forEach((field) => next.delete(field));
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
  const setPriceRange = (min, max) => {
    setSearchParam((next) => {
      if (normalizeFilterText(min)) next.set("min_price", String(min));
      else next.delete("min_price");
      if (normalizeFilterText(max)) next.set("max_price", String(max));
      else next.delete("max_price");
    });
  };
  const filterSections = useMemo(
    () => [
      { key: "gender", label: t("storefront.filters.gender", "Gender"), eyebrow: t("storefront.filters.gender", "Gender"), icon: Users, options: genderOptions, value: gender },
      { key: "category", label: t("storefront.filters.category", "Category"), eyebrow: t("storefront.filters.category", "Category"), icon: Footprints, options: categoryOptions, value: category },
      { key: "brand", label: t("storefront.filters.brand", "Brand"), eyebrow: t("storefront.filters.brand", "Brand"), icon: Gem, options: brandOptions, value: brand },
      { key: "grade", label: t("storefront.filters.grade", "Grade"), eyebrow: t("storefront.filters.grade", "Grade"), icon: Users, options: gradeOptions, value: grade },
    ],
    [brand, brandOptions, category, categoryOptions, gender, genderOptions, grade, gradeOptions, t]
  );

  useEffect(() => {
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) setDraftFilters({ gender, product_type: productType, grade });
    });
    return () => {
      cancelled = true;
    };
  }, [deferReactState, gender, productType, grade]);

  useEffect(() => {
    let cancelled = false;
    deferReactState(() => {
      if (cancelled) return;
      setSelectedGender(gender);
      setSelectedProductType(productType);
      setSelectedSize(size || "");
      if (isGuidedCategoryFlow) setCurrentStep(gender ? (productType ? "grid" : "productType") : "gender");
    });
    return () => {
      cancelled = true;
    };
  }, [deferReactState, gender, isGuidedCategoryFlow, productType, size]);

  const applyDraftFilters = () => {
    const next = new URLSearchParams(params);
    ["gender", "product_type", "grade"].forEach((field) => {
      if (draftFilters[field]) next.set(field, draftFilters[field]);
      else next.delete(field);
    });
    setFiltersOpen(false);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
  };
  const resetDraftFilters = () => {
    const next = new URLSearchParams(params);
    ["q", "brand", "gender", "product_type", "style", "grade", "quality"].forEach((field) => next.delete(field));
    setDraftFilters({ gender: "", product_type: "", grade: "" });
    setFiltersOpen(false);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
  };

  const scrollToStep = (step) => {
    const target = step === "grid" ? gridStepRef.current : step === "productType" ? productTypeStepRef.current : null;
    if (!target) return;
    window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const selectGender = (value) => {
    const normalizedGender = normalizeStorefrontAudienceValue(value) || normalizeFilterText(value);
    setSelectedGender(normalizedGender);
    setSelectedProductType("");
    setSelectedSize("");
    setCurrentStep("productType");
    const next = new URLSearchParams();
    if (normalizedGender) next.set("gender", normalizedGender);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
    scrollToStep("productType");
  };

  const selectProductType = (value) => {
    setSelectedProductType(value);
    setSelectedSize("");
    setCurrentStep("grid");
    const next = new URLSearchParams();
    if (selectedGender) next.set("gender", selectedGender);
    if (value) next.set("product_type", value);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
    scrollToStep("grid");
  };

  const changeGender = () => {
    setSelectedProductType("");
    setSelectedSize("");
    setCurrentStep("gender");
    navigate(filterBasePath);
  };

  const changeProductType = () => {
    setSelectedProductType("");
    setSelectedSize("");
    setCurrentStep("productType");
    const next = new URLSearchParams();
    if (selectedGender) next.set("gender", selectedGender);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
    scrollToStep("productType");
  };
  const guidedGenderProducts = useMemo(
    () => catalogProducts.filter((product) => !selectedGender || productListingAudienceValues(product).includes(normalizeStorefrontAudienceValue(selectedGender))),
    [catalogProducts, selectedGender]
  );
  const productTypeOptions = useMemo(() => {
    const options = uniqueClassificationOptions(classificationOptions.productType || []);
    if (!selectedGender || !guidedGenderProducts.length) return options;
    const availableTypeValues = new Set(
      guidedGenderProducts
        .map((product) => String(product.product_type || product.productType || product.category || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const filtered = options.filter((option) => availableTypeValues.has(String(option.value || "").trim().toLowerCase()));
    return filtered.length ? filtered : options;
  }, [classificationOptions.productType, guidedGenderProducts, selectedGender]);
  const guidedGridProducts = useMemo(() => {
    const genderValue = normalizeStorefrontAudienceValue(selectedGender);
    const typeValue = String(selectedProductType || "").trim().toLowerCase();
    return catalogProducts.filter((product) => {
      const productTypeValue = String(product.product_type || product.productType || product.category || "").trim().toLowerCase();
      const genderOk = !genderValue || productListingAudienceValues(product).includes(genderValue);
      const typeOk = !typeValue || productTypeValue === typeValue;
      return genderOk && typeOk;
    });
  }, [catalogProducts, selectedGender, selectedProductType]);
  const guidedAvailableSizes = useMemo(() => buildAvailableSizeOptions(guidedGridProducts), [guidedGridProducts]);
  const filteredGuidedProducts = useMemo(
    () => (selectedSize ? guidedGridProducts.filter((product) => productHasAvailableSize(product, selectedSize)) : guidedGridProducts),
    [guidedGridProducts, selectedSize]
  );
  const orderedGuidedProducts = useMemo(
    () => sortStorefrontColorCardsByModel(filteredGuidedProducts),
    [filteredGuidedProducts]
  );
  const showEmptyResults = !loading && !filteredProducts.length;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const sampleProducts = (Array.isArray(catalogProducts) ? catalogProducts : []).slice(0, 3).map((product) => {
      const rawAudience = product.audience || product.audiences || product.gender || product.genders || product.product_audience || product.product_audiences || product.target_audience || "";
      return {
        id: product.id,
        name: product.name,
        rawAudience,
        normalizedAudience: productListingAudienceValues(product),
      };
    });
    console.debug("[storefront-product-listing-debug]", {
      searchTerm: q,
      normalizedSearchTerm,
      selectedAudience: genderParam || "",
      normalizedSelectedAudience: gender || "",
      productsApiParams,
      productsBeforeFilters: Array.isArray(catalogProducts) ? catalogProducts.length : 0,
      productsAfterFilters: Array.isArray(filteredProducts) ? filteredProducts.length : 0,
      sampleProducts,
    });
  }, [catalogProducts, filteredProducts, gender, genderParam, normalizedSearchTerm, productsApiParams, q]);

  if (isGuidedCategoryFlow) {
    const selectedGenderOption = genderOptions.find((option) => normalizeStorefrontAudienceValue(option.value) === normalizeStorefrontAudienceValue(selectedGender));
    const selectedProductTypeOption = productTypeOptions.find((option) => String(option.value) === String(selectedProductType));
    return (
      <section className="mx-auto max-w-7xl px-3 pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.75rem)] pt-3 md:px-4 md:py-5">
        <div className="mb-3 flex flex-col gap-2 md:mb-4 md:gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold text-stone-500 md:text-sm">{t("storefront.products.guidedIntro", "Choose your way")}</p>
            <h1 className="mt-0.5 text-2xl font-black md:mt-1 md:text-3xl">{t("storefront.nav.categories", "Categories")}</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <StepPill active={currentStep === "gender"} done={Boolean(selectedGender)} label={t("storefront.products.steps.gender", "1. Type")} />
            <StepPill active={currentStep === "productType"} done={Boolean(selectedProductType)} label={t("storefront.products.steps.product", "2. Product")} />
            <StepPill active={currentStep === "grid"} done={Boolean(selectedProductType)} label={t("storefront.products.steps.sizes", "3. Sizes")} />
          </div>
        </div>

        <GuidedGenderStep
          options={genderOptions}
          selectedGender={selectedGender}
          lang={lang}
          onSelect={selectGender}
        />

        <section ref={productTypeStepRef} className={`mt-3 scroll-mt-28 transition md:mt-5 ${currentStep === "gender" && !selectedGender ? "opacity-60" : ""}`}>
          <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2 md:mb-3 md:gap-3">
            <SectionIntro eyebrow={t("storefront.filters.productType", "Product Type")} title={t("storefront.products.chooseProductType", "Choose product type")} subtitle={selectedGenderOption ? t("storefront.products.suitableFor", "Suitable choices for {{label}}", { label: classificationLabel(selectedGenderOption, lang) }) : t("storefront.products.chooseGenderFirst", "Choose type first")} compact />
            {selectedGender ? (
              <button type="button" onClick={changeGender} className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
                {t("storefront.products.changeType", "Change type")}
              </button>
            ) : null}
          </div>
          <GuidedProductTypeStep
            options={productTypeOptions}
            selectedProductType={selectedProductType}
            lang={lang}
            disabled={!selectedGender}
            loading={loading}
            products={guidedGenderProducts}
            onSelect={selectProductType}
          />
        </section>

        <section ref={gridStepRef} className="mt-3 scroll-mt-28 md:mt-6">
          <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2 md:mb-3 md:gap-3">
            <SectionIntro
              eyebrow={t("storefront.products.products", "Products")}
              title={selectedProductTypeOption ? classificationLabel(selectedProductTypeOption, lang) : t("storefront.products.products", "Products")}
              subtitle={selectedGenderOption ? `${classificationLabel(selectedGenderOption, lang)}${selectedSize ? ` / ${t("storefront.products.sizeWithValue", "Size {{size}}", { size: selectedSize })}` : ""}` : t("storefront.products.chooseTypeAndProductFirst", "Choose type and product type first")}
              compact
            />
            {selectedProductType ? (
              <button type="button" onClick={changeProductType} className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
                {t("storefront.products.changeProductType", "Change product type")}
              </button>
            ) : null}
          </div>
          <GuidedSizeFilter sizes={guidedAvailableSizes} selectedSize={selectedSize} onSelect={setSelectedSize} disabled={!selectedProductType} />
          {error ? <EmptyState title={t("storefront.errors.simpleProblem", "Something went wrong")} text={t("storefront.errors.tryAgainOrWhatsapp", "Try again or contact us on WhatsApp")} /> : null}
          <ProductGrid
            products={orderedGuidedProducts}
            loading={loading}
            wishlist={wishlist}
            toggleWishlist={toggleWishlist}
            onAddToCart={onAddToCart}
          />
          {!loading && selectedProductType && !orderedGuidedProducts.length ? (
            <EmptyState title={t("storefront.products.noProductsForSize", "No products for this size right now. Try another size.")} text={selectedSize ? t("storefront.products.pickDifferentSize", "Pick a different size above") : t("storefront.products.tryDifferentProductType", "Try another product type")} />
          ) : null}
        </section>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-4 pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.75rem)] pt-5 md:py-5">
      <div className="mb-3 flex flex-col gap-2 md:mb-4 md:gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-bold text-stone-500">{saleView ? t("storefront.products.limitedOffers", "Limited-time offers") : t("storefront.products.shopEasily", "Shop easily")}</p>
          <h1 className="mt-1 text-3xl font-black">{q ? t("storefront.search.resultsFor", "Search results for \"{{query}}\"", { query: q }) : brand ? t("storefront.filters.brand", "Brand") : category || (lastSizes ? t("storefront.home.lastSizes", "Last Sizes") : saleView ? t("storefront.nav.sale", "Sale") : t("storefront.products.allProducts", "All products"))}</h1>
        </div>
        <div className="text-sm font-bold text-stone-500">{t("storefront.products.productCount", "{{count}} product", { count: filteredProducts.length })}</div>
      </div>
      {!showEmptyResults ? (
        <>
          <PremiumFilterPanel
            sections={filterSections}
            lang={lang}
            buildFilterUrl={buildFilterUrl}
            clearUrl={clearClassificationFiltersUrl()}
            activeFilterCount={activeFilterCount}
          />
          <MobileFilterTrigger activeFilterCount={activeFilterCount} onOpen={() => setFiltersOpen(true)} />
        </>
      ) : null}
      {filtersOpen && !showEmptyResults ? (
        <LazyFiltersDrawer
          open={filtersOpen}
          sections={filterSections}
          lang={lang}
          draftFilters={draftFilters}
          setDraftFilters={setDraftFilters}
          onClose={() => setFiltersOpen(false)}
          onApply={applyDraftFilters}
          onReset={resetDraftFilters}
        />
      ) : null}
      {!showEmptyResults ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,20rem)]">
          <CatalogSizeFilter
            sizes={availableSizes}
            selectedSizes={selectedSizes}
            onToggle={toggleSizeValue}
            onClear={() => setSearchParam((next) => {
              next.delete("size");
              next.delete("sizes");
            })}
          />
          <CatalogPriceFilter
            minPrice={minPrice}
            maxPrice={maxPrice}
            onChange={setPriceRange}
            priceBounds={priceBounds}
          />
        </div>
      ) : null}
      {error ? <EmptyState title={t("storefront.errors.simpleProblem", "Something went wrong")} text={t("storefront.errors.tryAgainOrWhatsapp", "Try again or contact us on WhatsApp")} /> : null}
      {!showEmptyResults ? (
        <ProductGrid
          products={orderedFilteredProducts}
          loading={loading}
          wishlist={wishlist}
          toggleWishlist={toggleWishlist}
          onAddToCart={onAddToCart}
        />
      ) : null}
      {showEmptyResults ? (
        <EmptyState
          title={t("storefront.products.emptyTitle", "No products found")}
          text={t("storefront.products.emptyText", "Try another search or category")}
          actionTo={filterBasePath}
          actionLabel={t("storefront.filters.resetFilters", "Reset filters")}
        />
      ) : null}
    </section>
  );
}

function CatalogSizeFilter({ sizes = [], selectedSizes = [], onToggle, onClear }) {
  const { t } = useTranslation();
  const selectedSet = new Set((Array.isArray(selectedSizes) ? selectedSizes : []).map(normalizeFilterKey).filter(Boolean));
  return (
    <section className="rounded-[1.35rem] border border-stone-200 bg-white p-3 shadow-[0_12px_32px_rgba(39,20,75,0.06)] dark:border-white/10 dark:bg-[#0b1020] md:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7c3aed] dark:text-[#d8b4fe]">{t("storefront.filters.sizeFilter", "Size filter")}</p>
          <h3 className="mt-0.5 text-sm font-black text-stone-950 dark:text-white">{t("storefront.filters.availableSize", "Available sizes")}</h3>
        </div>
        {selectedSet.size ? (
          <button type="button" onClick={onClear} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-[11px] font-black text-stone-600 transition hover:border-[#7c3aed]/35 hover:text-[#6d28d9] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
            {t("storefront.filters.showAllSizes", "Show all sizes")}
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
              className={`inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border px-3.5 py-2 text-sm font-black transition md:min-h-11 md:px-4 ${active ? "border-[#7c3aed] bg-[#7c3aed] text-white shadow-[0_10px_24px_rgba(124,58,237,0.24)]" : "border-stone-200 bg-stone-50 text-stone-700 hover:border-[#7c3aed]/45 hover:text-[#6d28d9] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"}`}
            >
              {item.size}
              {Number(item.productCount || 0) ? <span className={active ? "text-white/72" : "text-stone-400 dark:text-stone-500"}>({item.productCount})</span> : null}
            </button>
          );
        })}
        {!sizes.length ? (
          <span className="rounded-full border border-dashed border-stone-200 px-3 py-2 text-xs font-bold text-stone-400 dark:border-white/10 dark:text-stone-500">
            {t("storefront.filters.sizesAppearAfterType", "Sizes appear after selecting a type")}
          </span>
        ) : null}
      </div>
    </section>
  );
}

function CatalogPriceFilter({ minPrice = "", maxPrice = "", onChange, priceBounds = {} }) {
  const { t } = useTranslation();
  const hasValue = Boolean(normalizeFilterText(minPrice) || normalizeFilterText(maxPrice));
  return (
    <section className="rounded-[1.35rem] border border-stone-200 bg-white p-3 shadow-[0_12px_32px_rgba(39,20,75,0.06)] dark:border-white/10 dark:bg-[#0b1020] md:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7c3aed] dark:text-[#d8b4fe]">{t("storefront.filters.priceRange", "Price range")}</p>
          <h3 className="mt-0.5 text-sm font-black text-stone-950 dark:text-white">{t("storefront.filters.filterByPrice", "Filter by price")}</h3>
        </div>
        {hasValue ? (
          <button type="button" onClick={() => onChange("", "")} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-[11px] font-black text-stone-600 transition hover:border-[#7c3aed]/35 hover:text-[#6d28d9] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
            {t("common.reset", "Reset")}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-right">
          <span className="text-[10px] font-bold text-stone-500 dark:text-stone-400">{t("storefront.filters.minPrice", "Min")}</span>
          <input
            type="number"
            min="0"
            step="1"
            value={minPrice}
            onChange={(event) => onChange(event.target.value, maxPrice)}
            placeholder={priceBounds.min !== "" ? String(priceBounds.min) : "0"}
            className="min-h-11 rounded-2xl border border-stone-200 bg-stone-50 px-3 text-sm font-bold text-stone-900 outline-none transition focus:border-[#7c3aed] dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </label>
        <label className="grid gap-1 text-right">
          <span className="text-[10px] font-bold text-stone-500 dark:text-stone-400">{t("storefront.filters.maxPrice", "Max")}</span>
          <input
            type="number"
            min="0"
            step="1"
            value={maxPrice}
            onChange={(event) => onChange(minPrice, event.target.value)}
            placeholder={priceBounds.max !== "" ? String(priceBounds.max) : "0"}
            className="min-h-11 rounded-2xl border border-stone-200 bg-stone-50 px-3 text-sm font-bold text-stone-900 outline-none transition focus:border-[#7c3aed] dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] font-bold text-stone-500 dark:text-stone-400">
        {priceBounds.min !== "" && priceBounds.max !== "" ? `${money(priceBounds.min)} - ${money(priceBounds.max)}` : t("storefront.filters.priceHint", "Use the price range to narrow the catalog")}
      </p>
    </section>
  );
}
