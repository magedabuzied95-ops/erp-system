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
  normalizeAudienceValue,
  productAudienceValues,
  sortStorefrontColorCardsByModel,
  useBodyScrollLock,
  useProducts,
  useStorefrontGenderClassifications,
} from "../Storefront";
import { useProductClassifications } from "../../modules/products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../../modules/products/lib/productClassifications";
import { Gem, Footprints, Users } from "lucide-react";

export function StorefrontProductListingPage({ sale = false, wishlist, toggleWishlist, onAddToCart }) {
  const { i18n, t } = useTranslation();
  const lang = i18n.language || "ar";
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const gender = params.get("gender") || "";
  const size = params.get("size") || "";
  const inStock = params.get("inStock") || "";
  const quality = params.get("quality") || "";
  const productType = params.get("product_type") || "";
  const grade = params.get("grade") || "";
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
  const isGuidedCategoryFlow = !q && !category && !saleView && !lastSizes && !gender && !size && !inStock && !quality && !productType && !grade && !sort;
  const { products, loading, error } = useProducts({ q, category, sale: saleView ? 1 : "", gender, size, inStock, quality, product_type: productType, grade, sort });
  const {
    products: genderProducts,
    loading: genderProductsLoading,
  } = useProducts({ limit: 160, gender: selectedGender, sale: "", product_type: "", q: "", category: "", grade: "" });
  const {
    products: gridProducts,
    loading: gridProductsLoading,
    error: gridProductsError,
  } = useProducts({ limit: 160, gender: selectedGender, product_type: selectedProductType, sale: "", q: "", category: "", grade: "" });
  const filterBasePath = sale ? "/shop/sale" : "/shop/products";
  const activeFilterCount = [gender, size, inStock, quality, productType, grade, saleQuery ? "sale" : "", lastSizes ? "lastSizes" : ""].filter(Boolean).length;

  useEffect(() => {
    if (!params.has("style")) return;
    const next = new URLSearchParams(params);
    next.delete("style");
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`, { replace: true });
  }, [filterBasePath, navigate, params]);

  const filterSections = useMemo(
    () => [
      { key: "gender", label: t("storefront.filters.gender", "Gender"), eyebrow: t("storefront.filters.gender", "Gender"), icon: Users, options: classificationOptions.gender, value: gender },
      { key: "product_type", label: t("storefront.filters.productType", "Product Type"), eyebrow: t("storefront.filters.type", "Type"), icon: Footprints, options: classificationOptions.productType, value: productType },
      { key: "grade", label: t("storefront.filters.grade", "Grade"), eyebrow: t("storefront.filters.grade", "Grade"), icon: Gem, options: classificationOptions.grade, value: grade },
    ],
    [classificationOptions, gender, grade, productType, t]
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

  const buildFilterUrl = (field, value) => {
    const next = new URLSearchParams(params);
    if (value && value !== "all") next.set(field, value);
    else next.delete(field);
    return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
  };
  const clearClassificationFiltersUrl = () => {
    const next = new URLSearchParams(params);
    ["gender", "product_type", "style", "grade", "quality"].forEach((field) => next.delete(field));
    return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
  };
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
    ["gender", "product_type", "style", "grade", "quality"].forEach((field) => next.delete(field));
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
    setSelectedGender(value);
    setSelectedProductType("");
    setSelectedSize("");
    setCurrentStep("productType");
    const next = new URLSearchParams();
    if (value) next.set("gender", value);
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

  const genderOptions = useMemo(
    () => uniqueClassificationOptions((storefrontGenderOptions.length ? storefrontGenderOptions : classificationOptions.gender) || []),
    [classificationOptions.gender, storefrontGenderOptions]
  );
  const productTypeOptions = useMemo(() => {
    const options = uniqueClassificationOptions(classificationOptions.productType || []);
    if (!selectedGender || !genderProducts.length) return options;
    const availableTypeValues = new Set(
      genderProducts
        .map((product) => String(product.product_type || product.productType || product.category || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const filtered = options.filter((option) => availableTypeValues.has(String(option.value || "").trim().toLowerCase()));
    return filtered.length ? filtered : options;
  }, [classificationOptions.productType, genderProducts, selectedGender]);
  const filteredProductsBeforeSize = useMemo(() => {
    const genderValue = normalizeAudienceValue(selectedGender);
    const typeValue = String(selectedProductType || "").trim().toLowerCase();
    return (Array.isArray(gridProducts) ? gridProducts : []).filter((product) => {
      const productTypeValue = String(product.product_type || product.productType || product.category || "").trim().toLowerCase();
      const genderOk = !genderValue || productAudienceValues(product).includes(genderValue);
      const typeOk = !typeValue || productTypeValue === typeValue;
      return genderOk && typeOk;
    });
  }, [gridProducts, selectedGender, selectedProductType]);
  const availableSizes = useMemo(() => buildAvailableSizeOptions(filteredProductsBeforeSize), [filteredProductsBeforeSize]);
  const filteredProducts = useMemo(
    () => selectedSize ? filteredProductsBeforeSize.filter((product) => productHasAvailableSize(product, selectedSize)) : filteredProductsBeforeSize,
    [filteredProductsBeforeSize, selectedSize]
  );
  const orderedFilteredProducts = useMemo(
    () => sortStorefrontColorCardsByModel(filteredProducts),
    [filteredProducts]
  );
  const orderedProducts = useMemo(
    () => sortStorefrontColorCardsByModel(products),
    [products]
  );
  const displayedProducts = useMemo(
    () => orderedProducts.filter((product) => productHasAvailableSize(product, size) && (!lastSizes || isLastPieceProduct(product))),
    [lastSizes, orderedProducts, size]
  );

  if (isGuidedCategoryFlow) {
    const selectedGenderOption = genderOptions.find((option) => String(option.value) === String(selectedGender));
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
            loading={genderProductsLoading}
            products={genderProducts}
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
          <GuidedSizeFilter sizes={availableSizes} selectedSize={selectedSize} onSelect={setSelectedSize} disabled={!selectedProductType} />
          {gridProductsError ? <EmptyState title={t("storefront.errors.simpleProblem", "Something went wrong")} text={t("storefront.errors.tryAgainOrWhatsapp", "Try again or contact us on WhatsApp")} /> : null}
          <ProductGrid
            products={orderedFilteredProducts}
            loading={gridProductsLoading}
            wishlist={wishlist}
            toggleWishlist={toggleWishlist}
            onAddToCart={onAddToCart}
          />
          {!gridProductsLoading && selectedProductType && !orderedFilteredProducts.length ? (
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
          <h1 className="mt-1 text-3xl font-black">{q ? t("storefront.search.resultsFor", "Search results for \"{{query}}\"", { query: q }) : category || (lastSizes ? t("storefront.home.lastSizes", "Last Sizes") : saleView ? t("storefront.nav.sale", "Sale") : t("storefront.products.allProducts", "All products"))}</h1>
        </div>
        <div className="text-sm font-bold text-stone-500">{t("storefront.products.productCount", "{{count}} product", { count: orderedProducts.length })}</div>
      </div>
      <PremiumFilterPanel
        sections={filterSections}
        lang={lang}
        buildFilterUrl={buildFilterUrl}
        clearUrl={clearClassificationFiltersUrl()}
        activeFilterCount={activeFilterCount}
      />
      <MobileFilterTrigger activeFilterCount={activeFilterCount} onOpen={() => setFiltersOpen(true)} />
      {filtersOpen ? (
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
      {error ? <EmptyState title={t("storefront.errors.simpleProblem", "Something went wrong")} text={t("storefront.errors.tryAgainOrWhatsapp", "Try again or contact us on WhatsApp")} /> : null}
      <ProductGrid
        products={displayedProducts}
        loading={loading}
        wishlist={wishlist}
        toggleWishlist={toggleWishlist}
        onAddToCart={onAddToCart}
      />
      {!loading && !displayedProducts.length ? (
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
