import { createPortal } from "react-dom";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

function CategoryPill({ active, onClick, name, count, icon, color }) {
  const disabled = !active && Number.isFinite(Number(count)) && Number(count) === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={!active && !disabled && color ? { borderColor: `${color}66`, color } : undefined}
      className={`inline-flex min-h-7 max-w-full shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black leading-none transition duration-200 sm:text-[11px] ${
        active
          ? "border-emerald-200/60 bg-gradient-to-r from-emerald-300 via-emerald-400 to-lime-300 text-emerald-950 shadow-[0_0_10px_rgba(16,185,129,0.16)]"
          : disabled
            ? "cursor-not-allowed border-white/5 bg-white/[0.02] text-zinc-600"
            : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-emerald-300/30 hover:bg-emerald-400/10 hover:text-white"
      }`}
    >
      {icon ? <span className="shrink-0 text-[9px] leading-none sm:text-[10px]">{icon}</span> : null}
      <span className="min-w-0 truncate">{name}</span>
      {Number.isFinite(Number(count)) ? (
        <span className={`rounded-full px-1.5 py-[3px] text-[9px] font-bold leading-none sm:text-[10px] ${active ? "bg-black/10 text-emerald-950/80" : "bg-white/10 text-zinc-400"}`}>
          {count}
        </span>
      ) : null}
    </button>
  );
}

function SmartFilterRow({ label, options, value, onChange }) {
  const { t } = useTranslation();
  const items = Array.isArray(options) ? options : [];

  if (items.length === 0) return null;

  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2 sm:px-3 sm:py-2.5">
      <div className="mb-1.5 flex min-h-4 items-center">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{label}</div>
      </div>

      <div className="flex min-w-0 flex-wrap items-start gap-1.5 sm:gap-2">
        <CategoryPill active={value === "all"} onClick={() => onChange("all")} name={t("pos.labels.all")} count={items.reduce((sum, option) => sum + Number(option.count || 0), 0)} />
        {items.map((option) => (
          <CategoryPill
            key={option.id}
            active={value === option.id}
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

function SmartPosFilters({
  open,
  panelRef,
  portalTarget,
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
  sizeOptions,
  selectedSize = "all",
  onSizeChange,
  activeSmartFilterCount = 0,
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

  if (!open || typeof document === "undefined") return null;

  const content = (
    <div
      className="fixed inset-0 flex items-end justify-center bg-black/75 px-4 py-4 backdrop-blur-xl sm:items-center sm:py-6"
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
        className="flex w-[min(1050px,calc(100vw-40px))] max-w-[calc(100vw-40px)] max-h-[84vh] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl sm:w-[min(1050px,calc(100vw-56px))] sm:max-w-[calc(100vw-56px)] sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">{copy.eyebrow}</div>
            <h2 id="smart-pos-filters-title" className="mt-0.5 text-lg font-black text-white sm:text-xl">
              {copy.title}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">{copy.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label={copy.close}
            title={copy.close}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
          <div className="grid gap-2 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <div className="grid gap-2">
              <SmartFilterRow label={copy.gender} options={smartFilterOptions?.gender} value={selectedGender} onChange={onGenderChange} />
              <SmartFilterRow label={copy.productType} options={smartFilterOptions?.productType} value={selectedProductType} onChange={onProductTypeChange} />
              <SmartFilterRow label={copy.grade} options={smartFilterOptions?.grade} value={selectedGrade} onChange={onGradeChange} />
              {Array.isArray(sizeOptions) && sizeOptions.length ? <SmartFilterRow label={copy.size} options={sizeOptions} value={selectedSize} onChange={onSizeChange} /> : null}
            </div>

            <div className="grid gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2 sm:px-3 sm:py-2.5">
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{copy.brand}</div>
                <select
                  value={selectedBrandId}
                  onChange={(event) => onBrandChange(event.target.value)}
                  className="h-10 w-full rounded-[1.1rem] border border-white/10 bg-black/70 px-3 text-[13px] font-semibold text-white outline-none transition focus:border-emerald-400/50"
                >
                  <option value="all">{copy.allBrands}</option>
                  {(brandOptions || []).map((brand) => (
                    <option key={brand.id || brand.name} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-2.5 py-2 sm:px-3 sm:py-2.5">
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{copy.manufacturer}</div>
                <select
                  value={selectedManufacturerId}
                  onChange={(event) => onManufacturerChange(event.target.value)}
                  className="h-10 w-full rounded-[1.1rem] border border-white/10 bg-black/70 px-3 text-[13px] font-semibold text-white outline-none transition focus:border-emerald-400/50"
                >
                  <option value="all">{copy.allManufacturers}</option>
                  {(manufacturerOptions || []).map((manufacturer) => (
                    <option key={manufacturer.id || manufacturer.name} value={manufacturer.id}>
                      {manufacturer.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 border-t border-white/10 bg-slate-950/95 px-3 py-3 backdrop-blur-xl sm:px-4 sm:py-3.5">
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-emerald-500/90 px-4 text-sm font-black text-black transition hover:bg-emerald-400"
            >
              {copy.apply}
            </button>
            <button
              type="button"
              onClick={onReset}
              className={`inline-flex h-10 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-black transition ${
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
              className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-transparent px-4 text-sm font-black text-zinc-300 transition hover:bg-white/[0.05] hover:text-white"
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
