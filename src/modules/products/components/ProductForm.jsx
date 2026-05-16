import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProductClassifications } from "../hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../lib/productClassifications";

function ProductForm({
  categories = [],
  brands = [],
  units = [],
  variationMode = "full_variations",
  mainCategory = "",
  subCategory = "",
  brand = "",
  unit = "",
  gender = "",
  productType = "",
  style = "",
  grade = "",
  onMainCategoryChange,
  onSubCategoryChange,
  onChildCategoryChange,
  onBrandChange,
  onUnitChange,
  onVariationModeChange,
  onGenderChange,
  onProductTypeChange,
  onStyleChange,
  onGradeChange,
}) {
  const { t } = useTranslation();
  const brandWrapRef = useRef(null);
  const [brandOpen, setBrandOpen] = useState(false);
  const [brandQuery, setBrandQuery] = useState(() => brand || "");
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: true });

  const selectedMainCategory = useMemo(
    () => categories.find((item) => String(item.name || "").trim() === String(mainCategory || "").trim()) || null,
    [categories, mainCategory]
  );

  const subcategories = useMemo(
    () => categories.filter((item) => String(item.parentId || "") === String(selectedMainCategory?.id || "")),
    [categories, selectedMainCategory]
  );
  const filteredBrands = useMemo(() => {
    const query = String(brandQuery || "").trim().toLowerCase();
    if (!query) return brands;
    return brands.filter((item) => String(item.name || "").toLowerCase().includes(query));
  }, [brands, brandQuery]);
  const classificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, { gender, productType, style, grade }, { includeInactive: true }),
    [classificationGroups, gender, productType, style, grade]
  );

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (brandWrapRef.current && !brandWrapRef.current.contains(event.target)) {
        setBrandOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-[28px] border border-white/8 bg-white/[0.035] p-4 shadow-xl shadow-black/10 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-500">{t("products.form.catalogStructure")}</p>
            <p className="mt-1 text-sm text-zinc-400">{t("products.form.catalogHelp")}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormSelect
            label={t("products.form.mainCategory")}
            value={mainCategory}
            onChange={(value) => {
              onMainCategoryChange?.(value);
              onSubCategoryChange?.("");
              onChildCategoryChange?.("");
            }}
            placeholder={t("products.form.selectMainCategory")}
            options={categories.filter((item) => !item.parentId).map((item) => ({ value: item.name, label: item.name, id: item.id }))}
          />

          <FormSelect
            label={t("products.form.subCategory")}
            value={subCategory}
            onChange={(value) => {
              onSubCategoryChange?.(value);
              onChildCategoryChange?.("");
            }}
            placeholder={t("products.form.selectSubCategory")}
            options={subcategories.map((item) => ({ value: item.name, label: item.name, id: item.id }))}
          />

          <div className="relative" ref={brandWrapRef}>
            <label className="text-sm font-semibold text-zinc-300">{t("products.form.brand")}</label>
            <button
              type="button"
              onClick={() => setBrandOpen((current) => !current)}
              className="mt-2 flex h-12 w-full items-center justify-between gap-3 rounded-2xl border border-white/8 bg-zinc-950/70 px-4 text-left text-white outline-none transition hover:border-white/16 focus:border-emerald-400/50"
            >
              <span className={brand ? "truncate" : "text-zinc-500"}>{brand || t("products.form.searchBrand")}</span>
              <ChevronDown size={16} className="shrink-0 text-zinc-400" />
            </button>

            {brandOpen ? (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
                <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
                  <Search size={16} className="shrink-0 text-zinc-500" />
                  <input
                    value={brandQuery}
                    onChange={(event) => setBrandQuery(event.target.value)}
                    placeholder={t("products.form.searchBrand")}
                    className="w-full bg-transparent py-1 text-sm text-white outline-none placeholder:text-zinc-500"
                    autoFocus
                  />
                </div>
                <div className="max-h-56 overflow-auto p-1">
                  {filteredBrands.length > 0 ? (
                    filteredBrands.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onBrandChange?.(item.name);
                          setBrandQuery(item.name);
                          setBrandOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-white/8 ${
                          String(brand || "").trim() === String(item.name || "").trim() ? "bg-white/8 text-white" : "text-zinc-300"
                        }`}
                      >
                        <span>{item.name}</span>
                        {String(brand || "").trim() === String(item.name || "").trim() ? (
                          <span className="text-xs text-emerald-300">Selected</span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-sm text-zinc-500">{t("products.form.noBrands")}</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <FormSelect
            label={t("products.form.unit")}
            value={unit}
            onChange={onUnitChange}
            placeholder={t("products.form.selectUnit")}
            options={units.map((item) => ({ value: item.name, label: `${item.name} (${item.symbol})`, id: item.id }))}
          />
        </div>
      </section>

      <section className="rounded-[28px] border border-cyan-400/15 bg-gradient-to-br from-cyan-400/10 via-white/[0.03] to-blue-400/10 p-4 shadow-xl shadow-black/10 sm:p-5">
        <div className="mb-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">{t("products.form.variationMode")}</p>
            <p className="mt-1 text-sm text-zinc-400">{t("products.form.variationHelp")}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ModeCard
            active={variationMode === "full_variations"}
            title={t("products.form.fullVariations")}
            subtitle={t("products.form.colorSize")}
            detail={t("products.form.fullVariationsHelp")}
            onClick={() => onVariationModeChange?.("full_variations")}
          />
          <ModeCard
            active={variationMode === "color_only"}
            title={t("products.form.colorOnly")}
            subtitle={t("products.form.fixedSize")}
            detail={t("products.form.colorOnlyHelp")}
            onClick={() => onVariationModeChange?.("color_only")}
          />
          <ModeCard
            active={variationMode === "simple"}
            title={t("products.form.simpleProduct")}
            subtitle={t("products.form.singleStock")}
            detail={t("products.form.simpleProductHelp")}
            onClick={() => onVariationModeChange?.("simple")}
          />
        </div>
      </section>

      <section className="rounded-[28px] border border-emerald-400/15 bg-gradient-to-br from-emerald-400/10 via-white/[0.035] to-cyan-400/10 p-4 shadow-xl shadow-black/10 sm:p-5">
        <div className="mb-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-200">{t("products.form.smartPosFilters")}</p>
            <p className="mt-1 text-sm text-zinc-400">{t("products.form.smartPosHelp")}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SmartClassificationSelect
            label={t("products.form.gender")}
            value={gender}
            onChange={onGenderChange}
            options={classificationOptions.gender}
            placeholder={t("products.form.genderPlaceholder")}
          />

          <SmartClassificationSelect
            label={t("products.form.productType")}
            value={productType}
            onChange={onProductTypeChange}
            options={classificationOptions.productType}
            placeholder={t("products.form.productTypePlaceholder")}
          />

          <SmartClassificationSelect
            label={t("products.form.style")}
            value={style}
            onChange={onStyleChange}
            options={classificationOptions.style}
            placeholder={t("products.form.stylePlaceholder")}
          />

          <SmartClassificationSelect
            label={t("products.form.grade")}
            value={grade}
            onChange={onGradeChange}
            options={classificationOptions.grade}
            placeholder={t("products.form.gradePlaceholder")}
          />
        </div>
      </section>
    </div>
  );
}

function SmartClassificationSelect({ label, value, onChange, options = [], placeholder }) {
  return (
    <div>
      <label className="text-sm font-semibold text-zinc-300">{label}</label>
      <select
        value={value || ""}
        onChange={(event) => onChange?.(event.target.value)}
        className="mt-2 h-12 w-full rounded-2xl border border-white/8 bg-zinc-950/80 px-4 text-white outline-none transition hover:border-white/16 focus:border-emerald-400/50"
      >
        <option value="">{placeholder}</option>
        {options.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModeCard({ active, title, subtitle, detail, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-3xl border p-4 text-left transition ${
        active
          ? "border-cyan-400/40 bg-cyan-400/15 text-white shadow-lg shadow-cyan-500/10"
          : "border-white/8 bg-zinc-950/70 text-zinc-300 hover:border-white/16 hover:bg-zinc-950"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-black">{title}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-zinc-500">{subtitle}</div>
        </div>
        <div
          className={`h-3 w-3 rounded-full ${active ? "bg-cyan-300" : "bg-zinc-600"}`}
          aria-hidden="true"
        />
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-400">{detail}</p>
    </button>
  );
}

function FormSelect({ label, value, onChange, options = [], placeholder }) {
  return (
    <div>
      <label className="text-sm font-semibold text-zinc-300">{label}</label>
      <select
        value={value || ""}
        onChange={(event) => onChange?.(event.target.value)}
        className="mt-2 h-12 w-full rounded-2xl border border-white/8 bg-zinc-950/70 px-4 text-white outline-none transition hover:border-white/16 focus:border-emerald-400/50"
      >
        <option value="">{placeholder}</option>
        {options.map((item) => (
          <option key={item.id || item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default ProductForm;
