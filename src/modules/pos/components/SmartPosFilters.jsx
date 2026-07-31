import { createPortal } from "react-dom";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import "./SmartPosFilters.m1.css";

function CategoryPill({ active, onClick, name, count, icon, color }) {
  const disabled = !active && Number.isFinite(Number(count)) && Number(count) === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={!active && !disabled && color ? { borderColor: `${color}66`, color } : undefined}
      className={`m1-smart-filter-pill inline-flex min-h-8 max-w-full shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold leading-normal transition duration-200 sm:text-xs ${
        active ? "is-active" : ""
      } ${disabled ? "is-disabled" : ""} ${
        active
          ? "border-emerald-200/60 bg-gradient-to-r from-emerald-300 via-emerald-400 to-lime-300 text-emerald-950 shadow-[0_0_10px_rgba(16,185,129,0.16)]"
          : disabled
            ? "cursor-not-allowed border-white/5 bg-white/[0.02] text-zinc-600"
            : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-emerald-300/30 hover:bg-emerald-400/10 hover:text-white"
      }`}
    >
      {icon ? <span className="m1-smart-filter-icon shrink-0 text-[10px] leading-none sm:text-[11px]">{icon}</span> : null}
      <span className="m1-smart-filter-pill-name min-w-0 truncate">{name}</span>
      {Number.isFinite(Number(count)) ? (
        <span className={`m1-smart-filter-count rounded-full px-1.5 py-1 text-[9px] font-bold leading-none sm:text-[10px] ${active ? "bg-black/10 text-emerald-950/80" : "bg-white/10 text-zinc-400"}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function SmartFilterRow({ label, options, value, onChange }) {
  const { t } = useTranslation();
  const items = Array.isArray(options) ? options : [];
  const selectedValues = Array.isArray(value) ? value.map(String) : [];
  const hasMultiValue = Array.isArray(value);

  if (items.length === 0) return null;

  return (
    <div className="m1-smart-filter-group min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2 sm:px-3 sm:py-2.5">
      <div className="mb-1.5 flex min-h-4 items-center">
        <div className="m1-smart-filter-label text-[11px] font-bold tracking-[0.04em] text-zinc-500 sm:text-xs">{label}</div>
      </div>

      <div className="flex min-w-0 flex-wrap items-start gap-1.5 sm:gap-2">
        <CategoryPill active={hasMultiValue ? selectedValues.length === 0 : value === "all"} onClick={() => onChange("all")} name={t("pos.labels.all")} count={items.reduce((sum, option) => sum + Number(option.count || 0), 0)} />
        {items.map((option) => (
          <CategoryPill
            key={option.id}
            active={hasMultiValue ? selectedValues.includes(String(option.id)) : value === option.id}
            onClick={() => onChange(option.id)}
            name={option.name}
            count={option.count}
            icon={option.icon}
            color={option.color}
          />
        ))}
      </div>
    </div>
  );
}

function SmartSelectBlock({ label, options, value = "all", onChange, allLabel }) {
  const items = Array.isArray(options) ? options : [];
  const selectedValues = Array.isArray(value) ? value.map(String) : [];
  const hasMultiValue = Array.isArray(value);

  if (items.length === 0) return null;

  if (hasMultiValue) {
    return (
      <div className="m1-smart-filter-group rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2 sm:px-3 sm:py-2.5">
        <div className="m1-smart-filter-label mb-1.5 text-[11px] font-bold tracking-[0.04em] text-zinc-500 sm:text-xs">{label}</div>
        <div className="flex min-w-0 flex-wrap items-start gap-1.5 sm:gap-2">
          <CategoryPill active={selectedValues.length === 0} onClick={() => onChange?.("all")} name={allLabel} />
          {items.map((item) => (
            <CategoryPill
              key={item.id || item.name}
              active={selectedValues.includes(String(item.id))}
              onClick={() => onChange?.(item.id)}
              name={item.name}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="m1-smart-filter-group rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2 sm:px-3 sm:py-2.5">
      <div className="m1-smart-filter-label mb-1.5 text-[11px] font-bold tracking-[0.04em] text-zinc-500 sm:text-xs">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        className="m1-smart-filter-select h-11 w-full rounded-[1.1rem] border border-white/10 bg-black/70 px-3 text-sm font-semibold text-white outline-none transition"
      >
        <option value="all">{allLabel}</option>
        {items.map((item) => (
          <option key={item.id || item.name} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function SmartPosFilters({
  open,
  panelRef,
  portalTarget,
  categoryOptions,
  selectedCategoryId = "all",
  onCategoryChange,
  smartFilterOptions,
  selectedGender,
  onGenderChange,
  selectedProductType,
  onProductTypeChange,
  selectedGrade,
  onGradeChange,
  brandOptions,
  selectedBrandId,
  onBrandChange,
  manufacturerOptions,
  selectedManufacturerId,
  onManufacturerChange,
  colorOptions,
  selectedColor = "all",
  onColorChange,
  sizeOptions,
  selectedSize = "all",
  onSizeChange,
  stockOptions,
  selectedStock = "all",
  onStockChange,
  favoriteOptions,
  selectedFavorite = "all",
  onFavoriteChange,
  activeSmartFilterCount = 0,
  onApply,
  onReset,
  onClose,
}) {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar");
  const copy = {
    eyebrow: isArabic ? "فلاتر POS الذكية" : "SMART POS FILTERS",
    title: isArabic ? "فلاتر نقطة البيع الذكية" : "Smart POS Filters",
    subtitle: isArabic ? "اختر من التصنيفات النشطة فقط." : "Choose only from active classifications.",
    close: isArabic ? "إغلاق الفلاتر" : "Close filters",
    gender: isArabic ? "الجنس" : "Gender",
    productType: isArabic ? "نوع المنتج" : "Product type",
    grade: isArabic ? "الفئة" : "Grade",
    size: isArabic ? "المقاس" : "Size",
    brand: isArabic ? "العلامة التجارية" : "Brand",
    allBrands: isArabic ? "كل العلامات التجارية" : "All brands",
    manufacturer: isArabic ? "الشركة المصنعة" : "Manufacturer",
    allManufacturers: isArabic ? "كل الشركات المصنعة" : "All manufacturers",
    apply: isArabic ? "تطبيق الفلاتر" : "Apply filters",
    reset: isArabic ? "إعادة الضبط" : "Reset",
    cancel: isArabic ? "إلغاء" : "Cancel",
  };
  const hasExtendedFilters = Boolean(categoryOptions || colorOptions || stockOptions || favoriteOptions);

  if (!open || typeof document === "undefined") return null;

  const content = (
    <div
      className="m1-smart-filter-overlay fixed inset-0 flex items-end justify-center bg-black/75 px-4 py-4 sm:items-center sm:py-6"
      style={{ zIndex: 2147483000 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-pos-filters-title"
        className="m1-smart-filter-panel flex h-[84vh] max-h-[84vh] w-[min(1050px,calc(100vw-40px))] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/95 shadow-2xl shadow-black/60 sm:w-[min(1050px,calc(100vw-56px))] sm:max-w-[calc(100vw-56px)] sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="m1-smart-filter-header flex items-start justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="min-w-0">
            <div className="m1-smart-filter-eyebrow text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200 sm:text-[11px]">{copy.eyebrow}</div>
            <h2 id="smart-pos-filters-title" className="m1-smart-filter-title mt-1 text-lg font-extrabold text-white sm:text-xl">
              {copy.title}
            </h2>
            <p className="m1-smart-filter-subtitle mt-1 text-xs font-medium text-zinc-400 sm:text-sm">{copy.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="m1-smart-filter-close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label={copy.close}
            title={copy.close}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
          <div className="grid gap-2 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            {hasExtendedFilters ? (
              <>
                <div className="grid content-start gap-2">
                  <SmartSelectBlock label={isArabic ? "الفئة" : "Category"} options={categoryOptions} value={selectedCategoryId} onChange={onCategoryChange} allLabel={isArabic ? "كل الفئات" : "All categories"} />
                  <SmartSelectBlock label={copy.brand} options={brandOptions} value={selectedBrandId} onChange={onBrandChange} allLabel={copy.allBrands} />
                  <SmartFilterRow label={copy.gender} options={smartFilterOptions?.gender} value={selectedGender} onChange={onGenderChange} />
                  <SmartFilterRow label={copy.productType} options={smartFilterOptions?.productType} value={selectedProductType} onChange={onProductTypeChange} />
                </div>

                <div className="grid content-start gap-2">
                  <SmartFilterRow label={isArabic ? "اللون" : "Color"} options={colorOptions} value={selectedColor} onChange={onColorChange} />
                  <SmartFilterRow label={copy.size} options={sizeOptions} value={selectedSize} onChange={onSizeChange} />
                  <SmartFilterRow label={isArabic ? "المخزون" : "Stock"} options={stockOptions} value={selectedStock} onChange={onStockChange} />
                  <SmartFilterRow label={isArabic ? "المفضلة" : "Favorites"} options={favoriteOptions} value={selectedFavorite} onChange={onFavoriteChange} />
                </div>
              </>
            ) : (
              <>
                <div className="grid content-start gap-2">
                  <SmartFilterRow label={copy.gender} options={smartFilterOptions?.gender} value={selectedGender} onChange={onGenderChange} />
                  <SmartFilterRow label={copy.productType} options={smartFilterOptions?.productType} value={selectedProductType} onChange={onProductTypeChange} />
                  <SmartFilterRow label={copy.grade} options={smartFilterOptions?.grade} value={selectedGrade} onChange={onGradeChange} />
                  {Array.isArray(sizeOptions) && sizeOptions.length ? <SmartFilterRow label={copy.size} options={sizeOptions} value={selectedSize} onChange={onSizeChange} /> : null}
                </div>

                <div className="grid content-start gap-2">
                  <SmartSelectBlock label={copy.brand} options={brandOptions} value={selectedBrandId} onChange={onBrandChange} allLabel={copy.allBrands} />
                  <SmartSelectBlock label={copy.manufacturer} options={manufacturerOptions} value={selectedManufacturerId} onChange={onManufacturerChange} allLabel={copy.allManufacturers} />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="m1-smart-filter-footer sticky bottom-0 border-t border-white/10 bg-slate-950/95 px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={onApply || onClose}
              className="m1-smart-filter-apply inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-bold transition"
            >
              {copy.apply}
            </button>
            <button
              type="button"
              onClick={onReset}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-bold transition ${
                activeSmartFilterCount > 0
                  ? "border-amber-200/30 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]"
                  : "border-white/10 bg-white/[0.03] text-zinc-500"
              }`}
            >
              {copy.reset}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-transparent px-4 text-sm font-bold text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
            >
              {copy.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, portalTarget || document.body);
}

export default memo(SmartPosFilters);
