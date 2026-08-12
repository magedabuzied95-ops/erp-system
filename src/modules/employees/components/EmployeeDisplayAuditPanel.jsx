import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Loader2, PackageCheck, RefreshCw } from "lucide-react";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls.js";

const safeArray = (value) => Array.isArray(value) ? value : [];
const normalizeModelSortKey = (value = "") => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const orderProductsByModelAndColor = (products = []) => [...safeArray(products)].sort((left, right) => {
  const modelOrder = normalizeModelSortKey(left?.name).localeCompare(normalizeModelSortKey(right?.name), "en", { numeric: true });
  if (modelOrder) return modelOrder;
  const colorOrder = String(left?.color || "").localeCompare(String(right?.color || ""), "en", { numeric: true });
  if (colorOrder) return colorOrder;
  return Number(left?.product_id || 0) - Number(right?.product_id || 0);
});
const expandModelColors = (products = []) => orderProductsByModelAndColor(products).flatMap((product) => {
  const colors = safeArray(product?.colors);
  if (!colors.length) return [product];
  return colors.map((color) => ({ ...product, ...color, colors }));
});
const PRODUCT_TABS = [
  { key: "sneakers", label: "اسنيكرز" },
  { key: "crocs", label: "كروكس" },
  { key: "bags", label: "شنط" },
  { key: "winter", label: "شتوي" },
];
const AUDIENCE_TABS = [
  { key: "men", label: "رجالي" },
  { key: "women", label: "حريمي" },
  { key: "kids", label: "أطفال" },
  { key: "special", label: "خاص" },
];
const KIDS_STAGE_PANELS = [
  { key: "kids-22-26", label: "بيبي", range: "22–26" },
  { key: "kids-27-31", label: "وسط", range: "27–31" },
  { key: "kids-32-36", label: "أولادي", range: "32–36" },
];

export default function EmployeeDisplayAuditPanel({ data = {}, loading = false, savingId = "", error = "", onRefresh, onMarkDisplayed }) {
  const sections = safeArray(data.sections);
  const availableProductTabs = useMemo(() => PRODUCT_TABS.filter((tab) => Number(data.product_group_counts?.[tab.key] || 0) > 0), [data.product_group_counts]);
  const [productGroup, setProductGroup] = useState("sneakers");
  const [sourceKey, setSourceKey] = useState("");
  const [audienceKey, setAudienceKey] = useState("");

  useEffect(() => {
    if (!availableProductTabs.some((tab) => tab.key === productGroup)) setProductGroup(availableProductTabs[0]?.key || "sneakers");
  }, [availableProductTabs, productGroup]);

  const sourceOptions = useMemo(() => sections.map((section) => {
    const count = safeArray(section.audiences).reduce((sum, audience) => sum + safeArray(audience.products).filter((product) => product.product_group === productGroup).length, 0);
    return { ...section, filteredCount: count };
  }).filter((section) => section.filteredCount > 0), [sections, productGroup]);

  useEffect(() => {
    if (!sourceOptions.some((section) => section.key === sourceKey)) setSourceKey(sourceOptions[0]?.key || "");
  }, [sourceOptions, sourceKey]);

  const selectedSource = sourceOptions.find((section) => section.key === sourceKey) || sourceOptions[0];
  const availableAudiences = useMemo(() => AUDIENCE_TABS.map((tab) => {
    const sourceAudience = safeArray(selectedSource?.audiences).find((audience) => audience.key === tab.key);
    const products = orderProductsByModelAndColor(
      safeArray(sourceAudience?.products).filter((product) => product.product_group === productGroup)
    );
    return { ...tab, products, count: products.length };
  }).filter((audience) => audience.count > 0), [selectedSource, productGroup]);

  useEffect(() => {
    if (!availableAudiences.some((audience) => audience.key === audienceKey)) setAudienceKey(availableAudiences[0]?.key || "");
  }, [availableAudiences, audienceKey]);

  const selectedAudience = availableAudiences.find((audience) => audience.key === audienceKey) || availableAudiences[0];
  const expandedSelectedProducts = useMemo(
    () => expandModelColors(selectedAudience?.products),
    [selectedAudience]
  );
  const kidsStageProducts = useMemo(() => Object.fromEntries(
    KIDS_STAGE_PANELS.map((stage) => [
      stage.key,
      expandedSelectedProducts.filter((product) => product.display_stage_key === stage.key),
    ])
  ), [expandedSelectedProducts]);

  const renderProductCard = (product) => {
    const stateKey = `${product.product_id}:${product.audience}:${product.display_stage_key || ""}:${String(product.color_group_key || product.color || "").trim().toLowerCase()}`;
    const saving = String(savingId) === stateKey;
    const colorKey = `${product.color_group_key || product.variant_id || product.color || "color"}:${product.display_stage_key || product.size || "size"}`;
    const imageUrl = resolveProductImageUrl(product.image_url || product.product_image_url || product.image);
    return <article key={`${product.product_id}:${colorKey}`} className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 rounded-[var(--radius-card)] border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="h-[74px] w-[74px] overflow-hidden rounded-xl bg-slate-100">{imageUrl ? <img src={imageUrl} alt={product.name} loading="lazy" className="h-full w-full object-cover" /> : <PackageCheck className="m-5 h-8 w-8 text-slate-300" />}</div>
      <div className="min-w-0"><h5 className="line-clamp-2 text-sm font-black leading-5 text-slate-950" dir="auto">{product.name}</h5><div className="mt-1 flex flex-wrap gap-1 text-[11px] font-bold"><span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">اللون: {product.color || "-"}</span><span className="rounded-full bg-primary-subtle px-2 py-1 text-primary">أصغر مقاس: {product.size || "-"}</span><span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">الكمية: {product.stock || 0}</span></div><button type="button" onClick={() => onMarkDisplayed?.(product)} disabled={saving} className="mt-2 inline-flex min-h-[var(--control-height-md)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-xs font-black text-[var(--primary-contrast)] transition hover:bg-primary disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}معروض</button></div>
    </article>;
  };

  return (
    <div className="grid gap-3" dir="rtl">
      <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-950 to-slate-950 p-4 text-white shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-black text-emerald-300"><PackageCheck className="h-4 w-4" />إدارة العرض المستقلة</div>
            <h2 className="m1-section-title mt-2">تمم على العرض</h2>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-300">الموديلات الموجودة بالمخزن ولم يتم تأكيد عرضها على الستاند.</p>
          </div>
          <button type="button" onClick={onRefresh} disabled={loading} className="grid h-[var(--control-height-md)] w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-white/10 text-white disabled:opacity-50" aria-label="تحديث">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
        <div className="mt-4 flex items-end justify-between rounded-[var(--radius-card)] border border-white/10 bg-white/10 px-4 py-3">
          <span className="text-xs font-bold text-slate-300">إجمالي الموديلات غير المعروضة</span>
          <strong className="text-3xl font-black tabular-nums text-emerald-300" dir="ltr">{Number(data.total || 0)}</strong>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-4 gap-1.5">
          {PRODUCT_TABS.map((tab) => {
            const count = Number(data.product_group_counts?.[tab.key] || 0);
            const active = productGroup === tab.key;
            return <button key={tab.key} type="button" onClick={() => count && setProductGroup(tab.key)} disabled={!count} className={`rounded-[var(--radius-control)] px-1 py-2.5 text-xs font-black transition ${active ? "bg-primary text-[var(--primary-contrast)]" : "bg-slate-100 text-slate-700"} disabled:opacity-35`}>{tab.label}<span className="mr-1 opacity-75" dir="ltr">({count})</span></button>;
          })}
        </div>

        {sourceOptions.length ? <div className="relative mt-3">
          <select value={selectedSource?.key || ""} onChange={(event) => setSourceKey(event.target.value)} className="h-[var(--control-height-lg)] w-full appearance-none rounded-[var(--radius-control)] border border-slate-200 bg-slate-50 px-4 pl-10 text-sm font-black text-slate-950 outline-none focus:border-emerald-500">
            {sourceOptions.map((section) => <option key={section.key} value={section.key}>{section.label} ({section.filteredCount})</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-slate-500" />
        </div> : null}

        {availableAudiences.length ? <div className={`mt-3 grid gap-1.5 rounded-2xl bg-slate-100 p-1.5 ${availableAudiences.length >= 4 ? "grid-cols-4" : "grid-cols-3"}`}>
          {availableAudiences.map((audience) => <button key={audience.key} type="button" onClick={() => setAudienceKey(audience.key)} className={`rounded-[var(--radius-control)] px-2 py-2 text-xs font-black ${audienceKey === audience.key ? "bg-primary text-[var(--primary-contrast)] shadow-sm" : "text-slate-600"}`}>{audience.label} <span dir="ltr">({audience.count})</span></button>)}
        </div> : null}
      </section>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-3 text-sm font-bold text-red-800">{error}</div> : null}
      {loading && !sections.length ? <div className="flex min-h-40 items-center justify-center rounded-[var(--radius-card)] border border-slate-200 bg-white"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div> : null}
      {!loading && !sections.length ? <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-10 text-center"><Check className="mx-auto h-9 w-9 text-emerald-600" /><div className="mt-2 text-base font-black text-emerald-950">كل الموديلات الموجودة بالمخزن معروضة</div></div> : null}

      {audienceKey === "kids" ? <div className="grid gap-3">
        {KIDS_STAGE_PANELS.map((stage) => {
          const stageProducts = kidsStageProducts[stage.key] || [];
          return <section key={stage.key} className="overflow-hidden rounded-3xl border border-violet-200 bg-violet-50/60 p-3 shadow-sm">
            <header className="mb-3 flex items-center justify-between rounded-2xl bg-violet-950 px-4 py-3 text-white">
              <div><h3 className="m1-section-title">{stage.label}</h3><p className="mt-0.5 text-[11px] font-bold text-violet-200">مقاسات العرض من {stage.range}</p></div>
              <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black">{stageProducts.length}</span>
            </header>
            {stageProducts.length ? <div className="grid gap-2 sm:grid-cols-2">{stageProducts.map(renderProductCard)}</div> : <div className="rounded-[var(--radius-card)] border border-dashed border-violet-200 bg-white px-3 py-6 text-center text-xs font-bold text-slate-500">لا توجد مقاسات متاحة في هذه المرحلة</div>}
          </section>;
        })}
      </div> : expandedSelectedProducts.length ? <section className="grid gap-2 sm:grid-cols-2">{expandedSelectedProducts.map(renderProductCard)}</section> : null}
    </div>
  );
}
