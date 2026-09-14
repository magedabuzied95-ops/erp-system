import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Crown, GitCompareArrows, Plus, Ruler, Share2, ShoppingCart, Trash2, X } from "lucide-react";
import {
  classificationLabel,
  cleanDisplayText,
  fallbackProductImage,
  getProductTypeLabel,
  imageFor,
  mirrorProductTitle,
  money,
  productAudienceValues,
  productFromDetailsResponse,
  storefrontApi,
  uniqueClassificationOptions,
  useStorefrontGenderClassifications,
  variantColorKey,
  variantColorName,
  variantHasStock,
} from "../Storefront";
import { getDisplayPricing } from "../../shared/lib/storefrontPricing";
import { useProductClassifications } from "../../modules/products/hooks/useProductClassifications";
import { sortProductSizes } from "../../modules/products/lib/variantBulkSizes";
import { buildCrocsStorefrontSizeOptions, isCrocsProduct } from "../../shared/lib/crocsSizes";
import { buildProductColorGroups, colorSwatchImage, resolveColorGroup } from "../lib/productColorGallery";
import {
  COMPARE_MAX_ITEMS,
  clearCompareItems,
  comparePagePath,
  parseCompareQuery,
  removeCompareItem,
  replaceCompareItems,
  serializeCompareQuery,
  updateCompareItem,
  useCompareItems,
} from "../lib/compareStore";
import { ROOT_PATHS, productPath } from "../lib/paths";
import { openSizeGuide } from "../lib/sizeGuideStore";
import { localizeColorName, localizeSizeLabel } from "../lib/displayCopy";
import "./compare.css";

const LOW_STOCK_THRESHOLD = 3;
const text = (value) => String(value ?? "").trim();

/** Everything one column needs, derived from the product payload and the column's picks. */
const buildColumn = ({ product, colorKey, variantId, saleModeEnabled, lang, gradeOptions, genderOptions }) => {
  const variants = (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => variant && typeof variant === "object");
  const colorGroups = buildProductColorGroups({ product, variants, colorKey: variantColorKey, colorName: variantColorName, variantHasStock });
  const colorGroup = resolveColorGroup(colorGroups, colorKey);
  const groupVariants = colorGroup ? colorGroup.variants : variants;

  const sizeOptions = isCrocsProduct(product)
    ? buildCrocsStorefrontSizeOptions(groupVariants).map((option) => ({
        key: String(option.variant?.id || option.originalSize),
        label: option.displaySize,
        variant: option.variant,
        inStock: variantHasStock(option.variant),
      }))
    : sortProductSizes([...new Set(groupVariants.map((variant) => text(variant.size)).filter(Boolean))]).map((size) => {
        const variant = groupVariants.find((item) => text(item.size) === size && variantHasStock(item))
          || groupVariants.find((item) => text(item.size) === size);
        return { key: String(variant?.id || size), label: size, variant, inStock: variantHasStock(variant) };
      });
  const inStockSizes = sizeOptions.filter((option) => option.inStock);

  const selectedVariant = groupVariants.find((variant) => String(variant.id) === String(variantId) && variantHasStock(variant))
    || (inStockSizes.length === 1 ? inStockSizes[0].variant : null);
  const priceVariant = selectedVariant || groupVariants.find(variantHasStock) || groupVariants[0] || {};
  const pricing = getDisplayPricing(product, saleModeEnabled, priceVariant);
  const price = Number(pricing.price) || 0;
  const comparePrice = Number(pricing.comparePrice) > price ? Number(pricing.comparePrice) : 0;
  const stock = groupVariants.reduce((sum, variant) => sum + Math.max(0, Number(variant.stock) || 0), 0);

  const gradeValue = text(product.grade || product.quality || product.quality_grade);
  const gradeOption = gradeOptions.find((option) => text(option.value).toLowerCase() === gradeValue.toLowerCase());
  const audiences = productAudienceValues(product).map((value) => {
    const option = genderOptions.find((entry) => text(entry.value).toLowerCase() === text(value).toLowerCase());
    return option ? classificationLabel(option, lang) : classificationLabel({ value }, lang);
  }).filter(Boolean);

  const rawDescription = text(
    (lang === "ar" ? product.description_ar || product.description_en : product.description_en || product.description_ar) || product.description
  );

  const image = colorSwatchImage(colorGroup, product.image_url || product.gallery_images?.[0] || "");
  return {
    product,
    title: cleanDisplayText(mirrorProductTitle(product, priceVariant) || product.name || ""),
    brand: cleanDisplayText(product.brand_name || product.brand || product.product_brand || ""),
    type: getProductTypeLabel(product.product_type || product.productType || "", lang),
    grade: gradeOption ? classificationLabel(gradeOption, lang) : cleanDisplayText(gradeValue.replace(/_/g, " ")),
    audiences,
    colorGroups,
    colorGroup,
    sizeOptions,
    inStockSizes,
    selectedVariant,
    price,
    comparePrice,
    saving: comparePrice ? comparePrice - price : 0,
    discountPercent: pricing.isOnSale ? Number(pricing.discountPercent) || 0 : 0,
    stock,
    image,
    description: cleanDisplayText(rawDescription.replace(/\s+/g, " ")),
    href: productPath(product.slug || product.canonical_slug || product.id, colorGroup?.key ? { color: colorGroup.key } : ""),
  };
};

function useCompareProducts(items) {
  const [entries, setEntries] = useState({});
  const [reloadToken, setReloadToken] = useState(0);
  const slugsKey = items.map((item) => item.slug).join("|");

  useEffect(() => {
    let cancelled = false;
    const slugs = slugsKey ? slugsKey.split("|") : [];
    slugs.forEach((slug) => {
      setEntries((current) => (current[slug]?.product ? current : { ...current, [slug]: { loading: true, error: "", product: null } }));
      storefrontApi.getProductDetails(slug)
        .then((payload) => {
          const product = productFromDetailsResponse(payload);
          if (cancelled) return;
          setEntries((current) => ({ ...current, [slug]: product ? { loading: false, error: "", product } : { loading: false, error: "empty", product: null } }));
        })
        .catch((error) => {
          if (cancelled) return;
          setEntries((current) => ({ ...current, [slug]: { loading: false, error: error?.message || "failed", product: null } }));
        });
    });
    return () => {
      cancelled = true;
    };
  }, [slugsKey, reloadToken]);

  return { entries, retry: useCallback(() => setReloadToken((value) => value + 1), []) };
}

function CompareRow({ label, hint, children, className = "" }) {
  return (
    <div className={`sfx-cmp-row ${className}`} role="row">
      <div className="sfx-cmp-row__label" role="rowheader">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </div>
      {children}
    </div>
  );
}

export function StorefrontComparePage({ onAddToCart, saleModeEnabled }) {
  const { t, i18n } = useTranslation();
  const lang = String(i18n.resolvedLanguage || i18n.language || "ar").toLowerCase().startsWith("en") ? "en" : "ar";
  const location = useLocation();
  const navigate = useNavigate();
  const items = useCompareItems();
  const [picks, setPicks] = useState({});
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  const headsRef = useRef(null);
  const stickyRef = useRef(null);
  const imageRefs = useRef({});
  const urlAppliedRef = useRef(false);

  // A shared link wins once, on arrival; after that the list is the source and the
  // address bar follows it, so what a customer copies is always what they see.
  useEffect(() => {
    if (urlAppliedRef.current) return;
    urlAppliedRef.current = true;
    const fromUrl = parseCompareQuery(new URLSearchParams(location.search).get("items") || "");
    if (!fromUrl.length) return;
    const current = serializeCompareQuery(items);
    const wanted = fromUrl.map((entry) => (entry.colorKey ? `${entry.slug}~${entry.colorKey}` : entry.slug)).join(",");
    if (current === wanted) return;
    replaceCompareItems(fromUrl.map((entry) => {
      const known = items.find((item) => item.slug === entry.slug || item.id === entry.slug);
      return known ? { ...known, colorKey: entry.colorKey || known.colorKey } : { id: entry.slug, slug: entry.slug, colorKey: entry.colorKey };
    }));
  }, [items, location.search]);

  useEffect(() => {
    if (!urlAppliedRef.current) return;
    const target = comparePagePath(items);
    if (`${location.pathname}${location.search}` !== target) navigate(target, { replace: true });
  }, [items, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const previousTitle = document.title;
    document.title = `${t("storefront.compare.title")} | M1 Store`;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, follow";
    robots.dataset.compare = "1";
    document.head.appendChild(robots);
    return () => {
      document.title = previousTitle;
      robots.remove();
    };
  }, [t]);

  // The strip slides in once the product photos have scrolled under the site
  // header, and pins itself to that header's current bottom edge (the header
  // collapses on scroll, so a fixed offset would leave a gap or an overlap).
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const heads = headsRef.current;
      const strip = stickyRef.current;
      if (!heads || !strip) return;
      const header = document.querySelector(".sf-luxury-header");
      const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      strip.style.top = `${headerBottom}px`;
      setShowSticky(heads.getBoundingClientRect().bottom < headerBottom + 24);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // The header's announcement row folds away a moment AFTER the scroll event,
    // so its size change is what settles the final offset.
    const header = document.querySelector(".sf-luxury-header");
    const resizeObserver = header && typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(header);
    return () => {
      resizeObserver?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [items.length]);

  const { entries, retry } = useCompareProducts(items);
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const { options: genderOptions } = useStorefrontGenderClassifications();
  const gradeOptions = useMemo(
    () => uniqueClassificationOptions((classificationGroups.find((group) => group.key === "grade")?.options) || []),
    [classificationGroups]
  );

  // Once a column's product arrives, the list learns its real id, name and photo, so
  // the tray and a later card toggle recognise it (a shared link only carries the slug).
  useEffect(() => {
    items.forEach((item) => {
      const product = entries[item.slug]?.product;
      if (!product) return;
      const id = text(product.id);
      const patch = {};
      if (id && id !== item.id) patch.id = id;
      if (!item.name && product.name) patch.name = cleanDisplayText(product.name);
      if (!item.productType && (product.product_type || product.productType)) patch.productType = product.product_type || product.productType;
      if (!item.image) patch.image = imageFor(product.image_url || product.gallery_images?.[0] || "");
      if (Object.keys(patch).length) updateCompareItem(item.id, patch);
    });
  }, [entries, items]);

  const columns = useMemo(() => items.map((item) => {
    const entry = entries[item.slug] || { loading: true };
    if (!entry.product) return { item, entry, data: null };
    const pick = picks[item.id] || {};
    return {
      item,
      entry,
      data: buildColumn({
        product: entry.product,
        colorKey: pick.colorKey || item.colorKey,
        variantId: pick.variantId,
        saleModeEnabled,
        lang,
        gradeOptions,
        genderOptions,
      }),
    };
  }), [entries, genderOptions, gradeOptions, items, lang, picks, saleModeEnabled]);

  const ready = columns.filter((column) => column.data);
  const allReady = ready.length === columns.length && columns.length > 0;
  const lowestPrice = allReady && ready.length > 1 ? Math.min(...ready.map((column) => column.data.price).filter((price) => price > 0)) : 0;
  const pricesDiffer = new Set(ready.map((column) => column.data.price)).size > 1;
  const mostSizes = ready.length > 1 ? Math.max(...ready.map((column) => column.data.inStockSizes.length)) : 0;
  const sizesDiffer = new Set(ready.map((column) => column.data.inStockSizes.length)).size > 1;

  const differs = (read) => {
    if (!onlyDifferences || !allReady || ready.length < 2) return true;
    return new Set(ready.map((column) => JSON.stringify(read(column.data)))).size > 1;
  };

  const chooseColor = (item, group) => {
    setPicks((current) => ({ ...current, [item.id]: { colorKey: group.key, variantId: "" } }));
    updateCompareItem(item.id, { colorKey: group.key, colorName: group.colorName || "", image: imageFor(colorSwatchImage(group, "")) || item.image });
  };
  const chooseSize = (item, variant) => {
    setPicks((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), variantId: variant?.id || "" } }));
  };

  const addToCart = async (column) => {
    const { item, data } = column;
    if (!data.selectedVariant) {
      toast.error(t("storefront.compare.sizeRequired"), { id: "storefront-compare-size" });
      document.getElementById(`sfx-cmp-sizes-${item.id}`)?.focus?.();
      return;
    }
    await Promise.resolve(onAddToCart?.(data.product, data.selectedVariant, 1, { sourceEl: imageRefs.current[item.id] || null }));
  };

  const share = async () => {
    const url = `${window.location.origin}${comparePagePath(items)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: t("storefront.compare.title"), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(t("storefront.compare.linkCopied"));
    } catch {
      // A dismissed share sheet is not an error worth a toast.
    }
  };

  if (!items.length) {
    return (
      <section className="sfx-cmp sfx-cmp--empty sfx-wrap" dir={lang === "ar" ? "rtl" : "ltr"}>
        <div className="sfx-empty sfx-cmp-empty">
          <span className="sfx-empty__icon"><GitCompareArrows size={28} aria-hidden="true" /></span>
          <h1 className="sfx-empty__title">{t("storefront.compare.emptyTitle")}</h1>
          <p className="sfx-empty__text">{t("storefront.compare.emptyText")}</p>
          <Link to={ROOT_PATHS.products} className="sfx-btn sfx-btn--primary sfx-btn--lg">{t("storefront.compare.browse")}</Link>
        </div>
      </section>
    );
  }

  const slotCount = Math.min(COMPARE_MAX_ITEMS, items.length + (items.length < COMPARE_MAX_ITEMS ? 1 : 0));
  const gridStyle = { "--sfx-cmp-cols": slotCount, "--sfx-cmp-items": items.length };

  const cell = (column, render, extraClass = "") => (
    <div key={column.item.id} className={`sfx-cmp-cell ${extraClass}`} role="cell">
      {column.data ? render(column.data, column.item) : <span className="sfx-skel sfx-cmp-skeleton" aria-hidden="true" />}
    </div>
  );
  const addSlot = (key, content = null) => (items.length < COMPARE_MAX_ITEMS ? <div key={key} className="sfx-cmp-cell sfx-cmp-cell--slot" role="cell">{content}</div> : null);

  return (
    <section className="sfx-cmp sfx-wrap" dir={lang === "ar" ? "rtl" : "ltr"} style={gridStyle}>
      <header className="sfx-page-head sfx-cmp-top">
        <div className="sfx-page-head__text">
          <h1 className="sfx-title">{t("storefront.compare.title")}</h1>
          <p className="sfx-subtitle">{t("storefront.compare.subtitle")}</p>
        </div>
        <div className="sfx-page-head__actions sfx-cmp-top__actions">
          <label className={`sfx-cmp-switch${items.length < 2 ? " is-disabled" : ""}`}>
            <input type="checkbox" checked={onlyDifferences} disabled={items.length < 2} onChange={(event) => setOnlyDifferences(event.target.checked)} />
            <span className="sfx-cmp-switch__track" aria-hidden="true"><span /></span>
            <span>{t("storefront.compare.onlyDifferences")}</span>
          </label>
          <button type="button" className="sfx-btn sfx-btn--secondary sfx-btn--sm sfx-cmp-btn" onClick={share}>
            <Share2 size={15} aria-hidden="true" />
            <span>{t("storefront.compare.share")}</span>
          </button>
          <button type="button" className="sfx-btn sfx-btn--ghost sfx-btn--sm sfx-cmp-btn sfx-cmp-btn--ghost" onClick={clearCompareItems}>
            <Trash2 size={15} aria-hidden="true" />
            <span>{t("storefront.compare.clear")}</span>
          </button>
        </div>
      </header>

      <div ref={stickyRef} className={`sfx-cmp-sticky${showSticky ? " is-visible" : ""}`} aria-hidden={!showSticky}>
        <div className="sfx-cmp-row sfx-cmp-row--sticky">
          <div className="sfx-cmp-row__label" />
          {columns.map((column) => (
            <div key={column.item.id} className="sfx-cmp-cell">
              {column.data ? (
                <div className="sfx-cmp-mini">
                  <img src={imageFor(column.data.image)} alt="" onError={fallbackProductImage} />
                  <div>
                    <span className="sfx-cmp-mini__name">{column.data.title}</span>
                    <span className="sfx-cmp-mini__price">{money(column.data.price)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {addSlot("sticky-slot")}
        </div>
      </div>

      <div className="sfx-cmp-table" role="table" aria-label={t("storefront.compare.title")}>
        <div className="sfx-cmp-row sfx-cmp-row--heads" role="row" ref={headsRef}>
          <div className="sfx-cmp-row__label" aria-hidden="true" />
          {columns.map((column) => (
            <div key={column.item.id} className="sfx-cmp-cell sfx-cmp-head" role="columnheader">
              <button type="button" className="sfx-cmp-head__remove" onClick={() => removeCompareItem(column.item.id)} aria-label={`${t("storefront.compare.remove")}: ${column.data?.title || column.item.name}`}>
                <X size={14} aria-hidden="true" />
              </button>
              {column.data ? (
                <>
                  <Link to={column.data.href} className="sfx-cmp-head__media">
                    <img
                      ref={(node) => { imageRefs.current[column.item.id] = node; }}
                      src={imageFor(column.data.image)}
                      alt={column.data.title}
                      onError={fallbackProductImage}
                      loading="lazy"
                      decoding="async"
                    />
                    {column.data.discountPercent ? <span className="m1h-badge m1h-badge--sale">-{column.data.discountPercent}%</span> : null}
                  </Link>
                  {column.data.brand && !column.data.title.toLowerCase().includes(column.data.brand.toLowerCase()) ? (
                    <span className="sfx-cmp-head__brand">{column.data.brand}</span>
                  ) : null}
                  <Link to={column.data.href} className="sfx-cmp-head__name">{column.data.title}</Link>
                </>
              ) : column.entry.error ? (
                <div className="sfx-cmp-error">
                  <p>{t("storefront.compare.loadFailed")}</p>
                  <button type="button" className="sfx-btn sfx-btn--secondary sfx-btn--sm" onClick={retry}>{t("storefront.compare.retry")}</button>
                </div>
              ) : (
                <>
                  <span className="sfx-skel sfx-cmp-skeleton sfx-cmp-skeleton--media" aria-hidden="true" />
                  <span className="sfx-skel sfx-cmp-skeleton" aria-hidden="true" />
                </>
              )}
            </div>
          ))}
          {addSlot("head-slot", (
            <Link to={ROOT_PATHS.products} className="sfx-cmp-add">
              <span><Plus size={22} aria-hidden="true" /></span>
              <strong>{t("storefront.compare.addAnother")}</strong>
            </Link>
          ))}
        </div>

        {differs((data) => data.price) ? (
          <CompareRow label={t("storefront.compare.rows.price")}>
            {columns.map((column) => cell(column, (data) => (
              <div className="sfx-cmp-price">
                <span className={`sfx-cmp-price__now${data.comparePrice ? " is-sale" : ""}`}>{data.price > 0 ? money(data.price) : "—"}</span>
                {data.comparePrice ? <span className="sfx-cmp-price__was">{money(data.comparePrice)}</span> : null}
                {pricesDiffer && data.price > 0 && data.price === lowestPrice ? (
                  <span className="sfx-badge sfx-badge--success sfx-cmp-flag"><Crown size={12} aria-hidden="true" />{t("storefront.compare.bestPrice")}</span>
                ) : null}
              </div>
            ), pricesDiffer && column.data?.price === lowestPrice ? "is-best" : ""))}
            {addSlot("price-slot")}
          </CompareRow>
        ) : null}

        {ready.some((column) => column.data.saving > 0) && differs((data) => data.saving) ? (
          <CompareRow label={t("storefront.compare.rows.saving")}>
            {columns.map((column) => cell(column, (data) => (
              data.saving > 0 ? <span className="sfx-cmp-saving">{t("storefront.compare.save", { amount: money(data.saving) })}</span> : <span className="sfx-cmp-muted">—</span>
            )))}
            {addSlot("saving-slot")}
          </CompareRow>
        ) : null}

        {differs((data) => data.brand) ? (
          <CompareRow label={t("storefront.compare.rows.brand")}>
            {columns.map((column) => cell(column, (data) => <span className="sfx-cmp-value">{data.brand || "—"}</span>))}
            {addSlot("brand-slot")}
          </CompareRow>
        ) : null}

        {differs((data) => data.type) ? (
          <CompareRow label={t("storefront.compare.rows.type")}>
            {columns.map((column) => cell(column, (data) => <span className="sfx-cmp-value">{data.type || "—"}</span>))}
            {addSlot("type-slot")}
          </CompareRow>
        ) : null}

        {differs((data) => data.grade) ? (
          <CompareRow label={t("storefront.compare.rows.grade")}>
            {columns.map((column) => cell(column, (data) => (data.grade ? <span className="sfx-badge sfx-badge--accent sfx-cmp-chip">{data.grade}</span> : <span className="sfx-cmp-muted">—</span>)))}
            {addSlot("grade-slot")}
          </CompareRow>
        ) : null}

        {differs((data) => data.audiences) ? (
          <CompareRow label={t("storefront.compare.rows.audience")}>
            {columns.map((column) => cell(column, (data) => <span className="sfx-cmp-value">{data.audiences.join(" · ") || "—"}</span>))}
            {addSlot("audience-slot")}
          </CompareRow>
        ) : null}

        {differs((data) => data.colorGroups.map((group) => group.colorName).sort()) ? (
          <CompareRow label={t("storefront.compare.rows.colors")}>
            {columns.map((column) => cell(column, (data, item) => (
              <div className="sfx-cmp-colors">
                <div className="sfx-cmp-colors__list">
                  {data.colorGroups.map((group) => {
                    const active = group.key === data.colorGroup?.key;
                    return (
                      <button
                        key={group.key}
                        type="button"
                        className={`sfx-cmp-color${active ? " is-active" : ""}`}
                        onClick={() => chooseColor(item, group)}
                        aria-pressed={active}
                        aria-label={group.colorName}
                        title={group.colorName}
                      >
                        <img src={imageFor(colorSwatchImage(group, data.product.image_url))} alt="" onError={fallbackProductImage} loading="lazy" />
                      </button>
                    );
                  })}
                </div>
                {data.colorGroup?.colorName ? <span className="sfx-cmp-muted">{localizeColorName(data.colorGroup.colorName, i18n.language)}</span> : null}
              </div>
            )))}
            {addSlot("colors-slot")}
          </CompareRow>
        ) : null}

        {differs((data) => data.inStockSizes.map((option) => option.label)) ? (
          <CompareRow label={t("storefront.compare.rows.sizes")}>
            {columns.map((column) => cell(column, (data, item) => (
              <div className="sfx-cmp-sizes">
                <div id={`sfx-cmp-sizes-${item.id}`} tabIndex={-1} className="sfx-cmp-sizes__list" role="group" aria-label={t("storefront.compare.chooseSize")}>
                  {data.sizeOptions.map((option) => {
                    const active = data.selectedVariant && String(option.variant?.id) === String(data.selectedVariant.id);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        disabled={!option.inStock}
                        className={`sfx-cmp-size${active ? " is-active" : ""}`}
                        onClick={() => chooseSize(item, option.variant)}
                        aria-pressed={Boolean(active)}
                      >
                        {localizeSizeLabel(option.label, i18n.language)}
                      </button>
                    );
                  })}
                </div>
                <span className="sfx-cmp-muted">
                  {data.inStockSizes.length ? t("storefront.compare.sizesCount", { count: data.inStockSizes.length }) : t("storefront.compare.noSizes")}
                </span>
                {sizesDiffer && data.inStockSizes.length === mostSizes && mostSizes > 0 ? <span className="sfx-badge sfx-badge--success sfx-cmp-flag">{t("storefront.compare.mostSizes")}</span> : null}
                <button type="button" onClick={() => openSizeGuide({ product: data.product })} className="sfx-cmp-link">
                  <Ruler size={13} aria-hidden="true" />
                  {t("storefront.products.sizeGuide")}
                </button>
              </div>
            )))}
            {addSlot("sizes-slot")}
          </CompareRow>
        ) : null}

        {differs((data) => (data.stock <= 0 ? "out" : data.stock <= LOW_STOCK_THRESHOLD ? "low" : "in")) ? (
          <CompareRow label={t("storefront.compare.rows.availability")}>
            {columns.map((column) => cell(column, (data) => {
              if (data.stock <= 0) return <span className="sfx-cmp-stock is-out">{t("storefront.compare.outOfStock")}</span>;
              if (data.stock <= LOW_STOCK_THRESHOLD) return <span className="sfx-cmp-stock is-low">{t("storefront.compare.lowStock", { count: data.stock })}</span>;
              return <span className="sfx-cmp-stock is-in">{t("storefront.compare.inStock")}</span>;
            }))}
            {addSlot("stock-slot")}
          </CompareRow>
        ) : null}

        {differs((data) => data.description) ? (
          <CompareRow label={t("storefront.compare.rows.description")}>
            {columns.map((column) => cell(column, (data) => (
              data.description ? <p className="sfx-cmp-description">{data.description}</p> : <span className="sfx-cmp-muted">—</span>
            )))}
            {addSlot("description-slot")}
          </CompareRow>
        ) : null}

        <div className="sfx-cmp-row sfx-cmp-row--buy" role="row">
          <div className="sfx-cmp-row__label" aria-hidden="true" />
          {columns.map((column) => cell(column, (data) => (
            <div className="sfx-cmp-buy">
              <button type="button" className="sfx-btn sfx-btn--primary sfx-btn--block sfx-cmp-btn--primary" disabled={!data.inStockSizes.length} onClick={() => addToCart(column)}>
                <ShoppingCart size={16} aria-hidden="true" />
                <span>{data.inStockSizes.length ? t("storefront.cart.addToCart") : t("storefront.compare.outOfStock")}</span>
              </button>
              <Link to={data.href} className="sfx-cmp-link sfx-cmp-link--center">{t("storefront.compare.viewDetails")}</Link>
            </div>
          )))}
          {addSlot("buy-slot")}
        </div>
      </div>
    </section>
  );
}

export default StorefrontComparePage;
