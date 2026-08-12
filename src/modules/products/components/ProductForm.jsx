import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProductClassifications } from "../hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../lib/productClassifications";
import { isSchoolBagType, SCHOOL_BAG_SIZE_OPTIONS } from "../lib/schoolBagSizes";

const PRODUCT_AUDIENCE_OPTIONS = [
  { value: "men", label: "رجال" },
  { value: "women", label: "نساء" },
  { value: "kids", label: "أطفال" },
];

function ProductForm({
  brands = [],
  units = [],
  variationMode = "full_variations",
  brand = "",
  unit = "",
  gender = "",
  audiences = [],
  productType = "",
  bagType = "",
  schoolBagSize = "",
  grade = "",
  isOfferStory = false,
  useCustomComparePrice = false,
  customComparePrice = "",
  purchaseAlertsEnabled = true,
  purchaseAlertByColor = false,
  cartonSize = "",
  suggestedPurchaseCartons = 1,
  onBrandChange,
  onUnitChange,
  onVariationModeChange,
  onProductTypeChange,
  onBagTypeChange,
  onSchoolBagSizeChange,
  onGradeChange,
  onIsOfferStoryChange,
  onUseCustomComparePriceChange,
  onCustomComparePriceChange,
  onPurchaseAlertsEnabledChange,
  onPurchaseAlertByColorChange,
  onCartonSizeChange,
  onSuggestedPurchaseCartonsChange,
}) {
  const { t } = useTranslation();
  const brandWrapRef = useRef(null);
  const [brandOpen, setBrandOpen] = useState(false);
  const [brandQuery, setBrandQuery] = useState(() => brand || "");
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const filteredBrands = useMemo(() => {
    const query = String(brandQuery || "").trim().toLowerCase();
    if (!query) return brands;
    return brands.filter((item) => String(item.name || "").toLowerCase().includes(query));
  }, [brands, brandQuery]);
  const selectedAudiences = useMemo(() => normalizeAudiences(audiences, gender), [audiences, gender]);
  const classificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, { gender: selectedAudiences[0] || gender, productType, bagType, grade }, { includeInactive: false, includeCurrentValue: false }),
    [classificationGroups, selectedAudiences, gender, productType, bagType, grade]
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
    <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(280px,.95fr)_minmax(440px,1.35fr)_minmax(280px,.9fr)] xl:gap-x-0 xl:gap-y-5 xl:items-stretch">
      <section className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 xl:col-start-1 xl:row-start-1 xl:rounded-e-none">

        <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">01 · بيانات البيع</p>
            <h3 className="m1-section-title mt-1 text-text">العلامة والوحدة</h3>
          </div>
          <div className="h-9 w-1 rounded-full bg-primary" />
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="relative" ref={brandWrapRef}>
            <label className="text-sm font-semibold text-text-muted">{t("products.form.brand")} *</label>
            <button
              type="button"
              onClick={() => setBrandOpen((current) => !current)}
              className="mt-2 flex h-[var(--control-height-lg)] w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border bg-surface px-4 text-left text-text outline-none transition hover:border-border-strong focus:border-emerald-400/50"
            >
              <span className={brand ? "truncate" : "text-text-muted"}>{brand || t("products.form.searchBrand")}</span>
              <ChevronDown size={16} className="shrink-0 text-text-muted" />
            </button>

            {brandOpen ? (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <Search size={16} className="shrink-0 text-text-muted" />
                  <input
                    value={brandQuery}
                    onChange={(event) => setBrandQuery(event.target.value)}
                    placeholder={t("products.form.searchBrand")}
                    className="w-full bg-transparent py-1 text-sm text-text outline-none placeholder:text-text-muted"
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
                          onBrandChange?.(item.name, item);
                          setBrandQuery(item.name);
                          setBrandOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-sm transition hover:bg-surface-hover ${ String(brand || "").trim() === String(item.name || "").trim() ? "bg-surface-soft text-text" : "text-text-muted" }`}
                      >
                        <span>{item.name}</span>
                        {String(brand || "").trim() === String(item.name || "").trim() ? (
                          <span className="text-xs text-emerald-300">{t("products.form.selected", "Selected")}</span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-sm text-text-muted">{t("products.form.noBrands")}</div>
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
            options={units.map((item) => ({
              value: String(item.id || item.unit_id || item.unitId || ""),
              label: item.symbol ? `${item.name} (${item.symbol})` : item.name,
              id: item.id || item.unit_id || item.unitId,
            }))}
          />
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 sm:p-5 xl:col-span-3 xl:row-start-2">
        <div className="mb-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-primary">{t("products.form.variationMode")}</p>
            <p className="mt-1 text-sm text-text-muted">{t("products.form.variationHelp")}</p>
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

      <section className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 xl:col-start-2 xl:row-start-1 xl:rounded-none xl:border-x-0">
        <div className="mb-4 border-b border-border pb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">02 · التصنيف الذكي</p>
            <h3 className="m1-section-title mt-1 text-text">{t("products.form.smartPosFilters")}</h3>
            <p className="mt-1 text-xs leading-5 text-text-muted">{t("products.form.smartPosHelp")}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          <SmartClassificationSelect
            label={`${t("products.form.productType")} *`}
            value={productType}
            onChange={onProductTypeChange}
            options={classificationOptions.productType}
            placeholder={t("products.form.selectProductType", "اختر نوع المنتج")}
          />

          {String(productType || "").trim().toLowerCase() === "bags" ? (
            <SmartClassificationSelect
              label={t("products.form.bagType", "نوع الشنطة")}
              value={bagType}
              onChange={onBagTypeChange}
              options={classificationOptions.bagType}
              placeholder={t("products.form.selectBagType", "اختر نوع الشنطة")}
            />
          ) : null}

          {String(productType || "").trim().toLowerCase() === "bags" &&
          isSchoolBagType(bagType) &&
          typeof onSchoolBagSizeChange === "function" ? (
            <SmartClassificationSelect
              label="مقاس الشنطة المدرسية *"
              value={schoolBagSize}
              onChange={onSchoolBagSizeChange}
              options={SCHOOL_BAG_SIZE_OPTIONS}
              placeholder="اختر المقاس من 12 إلى 22 بوصة"
            />
          ) : null}

          <SmartClassificationSelect
            label={t("products.form.grade")}
            value={grade}
            onChange={onGradeChange}
            options={classificationOptions.grade}
            placeholder={t("products.form.selectGrade", "اختر الدرجة")}
          />

          <label className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-3 md:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(isOfferStory)}
              onChange={(event) => onIsOfferStoryChange?.(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border bg-surface accent-[var(--primary)]"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text">
                {t("products.form.offerStory", "إضافة إلى العروض")}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t("products.form.offerStoryHelp", "يظهر هذا المنتج داخل قائمة العروض التي يحددها المدير يدوياً.")}
              </p>
            </div>
          </label>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 xl:col-start-3 xl:row-start-1 xl:rounded-s-none">
        <div className="mb-4 border-b border-border pb-4">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-300">03 · التسعير التسويقي</p>
          <h3 className="m1-section-title mt-1 text-text">{t("products.fields.originalPrice", "السعر قبل الخصم")}</h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">{t("products.form.originalPriceHelp", "اختياري، ويظهر مشطوبًا فقط عندما يكون أكبر من سعر البيع الحالي.")}</p>
        </div>
        <label className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-3">
          <input type="checkbox" checked={Boolean(useCustomComparePrice)} onChange={(event) => onUseCustomComparePriceChange?.(event.target.checked)} className="mt-1 h-4 w-4 rounded border-border bg-surface accent-violet-400" />
          <span>
            <span className="block text-sm font-black text-text">{t("products.form.setOriginalPrice", "إضافة سعر قبل الخصم")}</span>
            <span className="mt-1 block text-xs leading-5 text-text-muted">{t("products.form.originalPriceStorageHelp", "اختياري للعرض في المتجر ولا يغيّر سعر البيع أو الفواتير أو الأرباح.")}</span>
          </span>
        </label>
        {useCustomComparePrice ? (
          <div className="mt-4">
            <label className="text-sm font-semibold text-text-muted">{t("products.fields.originalPrice", "السعر قبل الخصم")}</label>
            <input type="number" min="0" step="0.01" value={customComparePrice} onChange={(event) => onCustomComparePriceChange?.(event.target.value)} placeholder={t("products.form.originalPricePlaceholder", "اختياري: السعر قبل الخصم")} className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 font-semibold text-text outline-none placeholder:text-text-muted focus:border-violet-300/50" />
          </div>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 sm:p-5 xl:col-span-3 xl:row-start-3">
        <div className="mb-4">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-200">
            {t("products.form.purchaseSettings", "إعدادات الشراء")}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {t("products.form.purchaseSettingsHelp", "احفظ افتراضيات الشراء المرتبطة بالكرتونة داخل سجل المنتج.")}
          </p>
        </div>

        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-3 text-left">
            <input
              type="checkbox"
              checked={Boolean(purchaseAlertsEnabled)}
              onChange={(event) => onPurchaseAlertsEnabledChange?.(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border bg-surface accent-[var(--primary)]"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text">
                {t("products.form.enablePurchaseAlerts", "تفعيل تنبيهات الشراء")}
              </div>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {t("products.form.purchaseAlertsHelp", "إذا تم إيقاف تنبيهات الشراء فلن يظهر المنتج في تنبيهات إعادة الطلب.")}
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-3 text-left">
            <input
              type="checkbox"
              checked={Boolean(purchaseAlertByColor)}
              onChange={(event) => onPurchaseAlertByColorChange?.(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border bg-surface accent-[var(--primary)]"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text">
                {t("products.form.purchaseAlertByColor", "تفعيل طلب الشراء حسب اللون")}
              </div>
              <p className="mt-1 whitespace-pre-line text-xs leading-5 text-text-muted">
                {t(
                  "products.form.purchaseAlertByColorHelp",
                  "عند التفعيل يتم إنشاء تنبيهات الشراء لكل لون بشكل مستقل.\nعند الإلغاء يتم إنشاء التنبيهات على مستوى الموديل بالكامل."
                )}
              </p>
            </div>
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-text-muted">
                {t("products.form.cartonSize", "حجم الكرتونة")}
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={cartonSize}
                onChange={(event) => onCartonSizeChange?.(event.target.value)}
                placeholder={t("products.form.cartonSizePlaceholder", "اختياري")}
                className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 text-text outline-none transition hover:border-border-strong focus:border-amber-400/50"
              />
              <p className="mt-2 text-xs leading-5 text-text-muted">
                {t("products.form.cartonSizeHelp", "حجم الكرتونة يستخدم لاحقاً في تنبيهات الكرتونة.")}
              </p>
            </div>

            <div>
              <label className="text-sm font-semibold text-text-muted">
                {t("products.form.suggestedPurchaseCartons", "عدد الكراتين المقترح طلبها")}
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={suggestedPurchaseCartons}
                onChange={(event) => onSuggestedPurchaseCartonsChange?.(event.target.value)}
                className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 text-text outline-none transition hover:border-border-strong focus:border-amber-400/50"
              />
              <p className="mt-2 text-xs leading-5 text-text-muted">
                {t("products.form.suggestedPurchaseCartonsHelp", "عدد الكراتين المقترح يستخدم كإجراء افتراضي عند إنشاء طلب شراء.")}
              </p>
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-amber-300/15 bg-surface-soft px-4 py-3 text-sm leading-6 text-amber-50/90">
            <ul className="space-y-2">
              <li>{t("products.form.purchaseSettingsBullet1", "إذا تم إيقاف تنبيهات الشراء فلن يظهر المنتج في تنبيهات إعادة الطلب.")}</li>
              <li>{t("products.form.purchaseSettingsBullet2", "حجم الكرتونة يستخدم لاحقاً في تنبيهات الكرتونة.")}</li>
              <li>{t("products.form.purchaseSettingsBullet3", "عدد الكراتين المقترح يستخدم كإجراء افتراضي عند إنشاء طلب شراء.")}</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function normalizeAudienceValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["men", "man", "male"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls"].includes(normalized)) return "kids";
  return "";
}

function normalizeAudiences(...sources) {
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|]+/)
      .map(normalizeAudienceValue)
      .filter(Boolean)
      .forEach((item) => seen.add(item));
  };
  sources.forEach(visit);
  return PRODUCT_AUDIENCE_OPTIONS.map((option) => option.value).filter((value) => seen.has(value));
}

function SmartClassificationSelect({ label, value, onChange, options = [], placeholder }) {
  const normalizedValue = String(value || "").trim();
  const hasSelectedOption = !normalizedValue || options.some((item) => String(item.value || "") === normalizedValue);

  return (
    <div>
      <label className="text-sm font-semibold text-text-muted">{label}</label>
      <select
        value={hasSelectedOption ? normalizedValue : ""}
        onChange={(event) => onChange?.(event.target.value)}
        className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 text-text outline-none transition hover:border-border-strong focus:border-emerald-400/50"
      >
        <option value="">{placeholder}</option>
        {options.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {!hasSelectedOption ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-amber-300/15 bg-amber-400/8 px-3 py-2 text-xs text-amber-100">
          <span className="min-w-0 truncate">قيمة غير متاحة: {normalizedValue}</span>
          <button
            type="button"
            onClick={() => onChange?.("")}
            className="shrink-0 rounded-[var(--radius-control)] border border-amber-200/20 bg-surface-soft px-2.5 py-1 font-bold text-amber-50 transition hover:bg-amber-300/15"
          >
            مسح
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ModeCard({ active, title, subtitle, detail, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[var(--radius-control)] border p-4 text-left transition ${ active ? "border-primary/40 bg-primary/15 text-text shadow-lg shadow-primary/10" : "border-border bg-surface text-text-muted hover:border-border-strong hover:bg-surface-hover" }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-black">{title}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-text-muted">{subtitle}</div>
        </div>
        <div
          className={`h-3 w-3 rounded-full ${active ? "bg-primary" : "bg-border-strong"}`}
          aria-hidden="true"
        />
      </div>
      <p className="mt-3 text-sm leading-6 text-text-muted">{detail}</p>
    </button>
  );
}

function FormSelect({ label, value, onChange, options = [], placeholder, tabIndex }) {
  const normalizedValue = String(value || "").trim();
  const hasSelectedOption = !normalizedValue || options.some((item) => String(item.value || "") === normalizedValue);

  return (
    <div>
      <label className="text-sm font-semibold text-text-muted">{label}</label>
      <select
        value={hasSelectedOption ? normalizedValue : ""}
        onChange={(event) => onChange?.(event.target.value)}
        tabIndex={tabIndex}
        className="mt-2 h-[var(--control-height-lg)] w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 text-text outline-none transition hover:border-border-strong focus:border-emerald-400/50"
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
