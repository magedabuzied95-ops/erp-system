import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
// Module-scope constants carry translation KEYS, never resolved strings: resolving
// here would freeze every label in whichever language loaded first.
const PRODUCT_TABS = [
  { key: "sneakers", labelKey: "employeePortal.display.groups.sneakers" },
  { key: "crocs", labelKey: "employeePortal.display.groups.crocs" },
  { key: "bags", labelKey: "employeePortal.display.groups.bags" },
  { key: "winter", labelKey: "employeePortal.display.groups.winter" },
];
// `special` is an AUDIENCE here, not a product category - it deliberately does not
// reuse pos.categories.special, which carries the same word in a different domain.
const AUDIENCE_TABS = [
  { key: "men", labelKey: "employeePortal.display.audiences.men" },
  { key: "women", labelKey: "employeePortal.display.audiences.women" },
  { key: "kids", labelKey: "employeePortal.display.audiences.kids" },
  { key: "special", labelKey: "employeePortal.display.audiences.special" },
];
const KIDS_STAGE_PANELS = [
  { key: "kids-22-26", labelKey: "employeePortal.display.stages.baby", range: "22–26" },
  { key: "kids-27-31", labelKey: "employeePortal.display.stages.middle", range: "27–31" },
  { key: "kids-32-36", labelKey: "employeePortal.display.stages.boys", range: "32–36" },
];

export default function EmployeeDisplayAuditPanel({ data = {}, loading = false, savingId = "", error = "", onRefresh, onMarkDisplayed }) {
  const { t, i18n } = useTranslation();
  const dir = i18n.dir ? i18n.dir() : (i18n.language === "ar" ? "rtl" : "ltr");
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
    return <article key={`${product.product_id}:${colorKey}`} className="grid grid-cols-[74px_minmax(0,1fr)] gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-sm">
      <div className="h-[74px] w-[74px] overflow-hidden rounded-[var(--radius-control)] bg-surface-soft">{imageUrl ? <img src={imageUrl} alt={product.name} loading="lazy" className="h-full w-full object-cover" /> : <PackageCheck className="m-5 h-8 w-8 text-text-muted" />}</div>
      <div className="min-w-0"><h5 className="line-clamp-2 text-sm font-black leading-5 text-text" dir="auto">{product.name}</h5><div className="mt-1 flex flex-wrap gap-1 text-[11px] font-bold"><span className="rounded-full bg-surface-soft px-2 py-1 text-text">{t("employeePortal.common.color")}: {product.color || "-"}</span><span className="rounded-full bg-primary-subtle px-2 py-1 text-text">{t("employeePortal.display.smallestSize")}: {product.size || "-"}</span><span className="rounded-full bg-warning-subtle px-2 py-1 text-text">{t("employeePortal.display.quantity")}: {product.stock || 0}</span></div><button type="button" onClick={() => onMarkDisplayed?.(product)} disabled={saving} className="mt-2 inline-flex min-h-[var(--control-height-md)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 text-xs font-black text-[var(--primary-contrast)] transition hover:bg-primary-hover disabled:opacity-60">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{t("employeePortal.display.markDisplayed")}</button></div>
    </article>;
  };

  return (
    <div className="grid gap-3" dir={dir}>
      <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface p-3 text-text shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-black text-success"><PackageCheck className="h-4 w-4" />{t("employeePortal.display.independentManagement")}</div>
            <h2 className="m1-section-title mt-2">{t("employeePortal.display.confirmDisplay")}</h2>
            <p className="mt-1 text-xs font-semibold leading-5 text-text-muted">{t("employeePortal.display.unconfirmedModels")}</p>
          </div>
          <button type="button" onClick={onRefresh} disabled={loading} className="grid h-[var(--control-height-md)] w-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-soft text-text disabled:opacity-50" aria-label={t("employeePortal.common.refresh")}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
        <div className="mt-4 flex items-end justify-between rounded-[var(--radius-card)] border border-border bg-surface-soft px-4 py-3">
          <span className="text-xs font-bold text-text-muted">{t("employeePortal.display.totalNotDisplayed")}</span>
          <strong className="text-3xl font-black tabular-nums text-success" dir="ltr">{Number(data.total || 0)}</strong>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-sm">
        {/* Same segmented-control shape as the audience row below: the WELL owns
            the surface and only the active key is filled. Giving each inactive
            button its own bg-surface-soft instead left them invisible against the
            panel in dark, where soft and surface are one step apart. */}
        <div className="grid grid-cols-4 gap-1.5 rounded-[var(--radius-control)] bg-surface-soft p-1.5">
          {PRODUCT_TABS.map((tab) => {
            const count = Number(data.product_group_counts?.[tab.key] || 0);
            const active = productGroup === tab.key;
            return <button key={tab.key} type="button" onClick={() => count && setProductGroup(tab.key)} disabled={!count} className={`rounded-[var(--radius-control)] px-1 py-2.5 text-xs font-black transition ${active ? "bg-primary text-[var(--primary-contrast)] shadow-sm" : "text-text-muted"} disabled:opacity-35`}>{t(tab.labelKey)}<span className="mr-1 opacity-75" dir="ltr">({count})</span></button>;
          })}
        </div>

        {sourceOptions.length ? <div className="relative mt-3">
          <select value={selectedSource?.key || ""} onChange={(event) => setSourceKey(event.target.value)} className="h-[var(--control-height-lg)] w-full appearance-none rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 pl-10 text-sm font-black text-text outline-none focus:border-border">
            {sourceOptions.map((section) => <option key={section.key} value={section.key}>{section.label} ({section.filteredCount})</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-text-muted" />
        </div> : null}

        {availableAudiences.length ? <div className={`mt-3 grid gap-1.5 rounded-[var(--radius-control)] bg-surface-soft p-1.5 ${availableAudiences.length >= 4 ? "grid-cols-4" : "grid-cols-3"}`}>
          {availableAudiences.map((audience) => <button key={audience.key} type="button" onClick={() => setAudienceKey(audience.key)} className={`rounded-[var(--radius-control)] px-2 py-2 text-xs font-black ${audienceKey === audience.key ? "bg-primary text-[var(--primary-contrast)] shadow-sm" : "text-text-muted"}`}>{t(audience.labelKey)} <span dir="ltr">({audience.count})</span></button>)}
        </div> : null}
      </section>

      {error ? <div className="rounded-[var(--radius-card)] border border-border bg-danger-subtle px-3 py-3 text-sm font-bold text-text">{error}</div> : null}
      {loading && !sections.length ? <div className="flex min-h-40 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface"><Loader2 className="h-6 w-6 animate-spin text-success" /></div> : null}
      {!loading && !sections.length ? <div className="rounded-[var(--radius-card)] border border-border bg-success-subtle px-4 py-10 text-center"><Check className="mx-auto h-9 w-9 text-success" /><div className="mt-2 text-base font-black text-success">{t("employeePortal.display.allDisplayed")}</div></div> : null}

      {audienceKey === "kids" ? <div className="grid gap-3">
        {KIDS_STAGE_PANELS.map((stage) => {
          const stageProducts = kidsStageProducts[stage.key] || [];
          // The stage header is the card; its products are siblings. Nesting the
          // grid inside a padded panel cost every product card ~12px a side.
          return <section key={stage.key} className="grid gap-2.5">
            <header className="flex items-center justify-between rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-text shadow-sm">
              <div><h3 className="m1-section-title">{t(stage.labelKey)}</h3><p className="mt-0.5 text-[11px] font-bold text-text-muted">{t("employeePortal.display.stageSizesFrom", { range: stage.range })}</p></div>
              <span className="rounded-full bg-surface-soft px-3 py-1 text-xs font-black">{stageProducts.length}</span>
            </header>
            {stageProducts.length ? <div className="grid gap-2.5 sm:grid-cols-2">{stageProducts.map(renderProductCard)}</div> : <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-3 py-6 text-center text-xs font-bold text-text-muted">{t("employeePortal.display.noStageSizes")}</div>}
          </section>;
        })}
      </div> : expandedSelectedProducts.length ? <section className="grid gap-2.5 sm:grid-cols-2">{expandedSelectedProducts.map(renderProductCard)}</section> : null}
    </div>
  );
}
