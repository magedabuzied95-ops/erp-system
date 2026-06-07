import { createPortal } from "react-dom";
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
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] font-black transition duration-200 ${
        active
          ? "border-emerald-200/60 bg-gradient-to-r from-emerald-300 via-emerald-400 to-lime-300 text-emerald-950 shadow-[0_0_14px_rgba(16,185,129,0.2)]"
          : disabled
            ? "cursor-not-allowed border-white/5 bg-white/[0.02] text-zinc-600"
            : "border-white/10 bg-white/[0.04] text-zinc-200 hover:border-emerald-300/30 hover:bg-emerald-400/10 hover:text-white"
      }`}
    >
      {icon ? <span className="text-[10px] leading-none">{icon}</span> : null}
      <span>{name}</span>
      {Number.isFinite(Number(count)) ? (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${active ? "bg-black/10 text-emerald-950" : "bg-white/10 text-zinc-300"}`}>
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
    <div className="min-w-0 rounded-[18px] border border-white/10 bg-white/[0.03] p-2.5">
      <div className="mb-1.5 flex min-h-5 items-center">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">{label}</div>
      </div>

      <div className="flex min-w-0 flex-wrap gap-1">
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

export default function SmartPosFilters({
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
  activeSmartFilterCount = 0,
  onReset,
  onClose,
}) {
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
        className="flex w-[min(1050px,calc(100vw-56px))] max-w-[calc(100vw-56px)] max-h-[84vh] flex-col overflow-hidden rounded-t-[2rem] rounded-b-[2rem] border border-white/10 bg-slate-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-200">SMART POS FILTERS</div>
            <h2 id="smart-pos-filters-title" className="mt-0.5 text-lg font-black text-white sm:text-xl">
              فلاتر POS الذكية
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">اختر من التصنيفات النشطة فقط.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Close filters"
            title="Close filters"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
          <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <div className="grid gap-2.5">
              <SmartFilterRow label="الجنس" options={smartFilterOptions?.gender} value={selectedGender} onChange={onGenderChange} />
              <SmartFilterRow label="نوع المنتج" options={smartFilterOptions?.productType} value={selectedProductType} onChange={onProductTypeChange} />
              <SmartFilterRow label="الفئة" options={smartFilterOptions?.grade} value={selectedGrade} onChange={onGradeChange} />
            </div>

            <div className="grid gap-2.5">
              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-2.5">
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Brand</div>
                <select
                  value={selectedBrandId}
                  onChange={(event) => onBrandChange(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/70 px-3.5 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50"
                >
                  <option value="all">All brands</option>
                  {(brandOptions || []).map((brand) => (
                    <option key={brand.id || brand.name} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-2.5">
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Manufacturer</div>
                <select
                  value={selectedManufacturerId}
                  onChange={(event) => onManufacturerChange(event.target.value)}
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/70 px-3.5 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50"
                >
                  <option value="all">All manufacturers</option>
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
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-black text-black transition hover:bg-emerald-400"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={onReset}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-black transition ${
                activeSmartFilterCount > 0
                  ? "border-rose-400/40 bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                  : "border-white/10 bg-white/[0.04] text-zinc-400"
              }`}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-zinc-200 transition hover:bg-white/[0.08] hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, portalTarget || document.body);
}
