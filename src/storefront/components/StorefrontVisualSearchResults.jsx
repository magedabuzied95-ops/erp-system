import { Component, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { PackageSearch } from "lucide-react";
import { parseSaleModeEnabled } from "../../shared/lib/storefrontPricing";

class VisualSearchCardBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.setState({ hasError: true });
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function VisualSearchProductCard({ product, index, onPickProduct, onQuickAdd, helpers }) {
  const { t } = useTranslation();
  const {
    firstDisplayVariant,
    productTotalStock,
    safeStockNumber,
    displayImageForProduct,
    variantHasStock,
    money,
    imageFor,
    fallbackProductImage,
    sfText,
    getDisplayPricing,
    saleModeEnabled,
    rawSaleModeEnabled,
  } = helpers;
  const safeProduct = product && typeof product === "object" ? product : {};
  const variants = Array.isArray(safeProduct?.variants) ? safeProduct.variants : [];
  const imageRef = useRef(null);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [showSizes, setShowSizes] = useState(false);
  const variant = variants.find((item) => String(item.id) === String(selectedVariantId)) || firstDisplayVariant(variants);
  if (!safeProduct?.id && !safeProduct?.name) return null;
  const stock = productTotalStock(safeProduct);
  const variantStock = safeStockNumber(variant?.stock ?? variant?.quantity ?? variant?.inventory_stock ?? variant?.available_stock);
  const isAvailable = stock > 0 && (!variant || variantStock > 0);
  const parsedSaleModeEnabled = parseSaleModeEnabled(saleModeEnabled, false);
  const pricing = getDisplayPricing(safeProduct, parsedSaleModeEnabled, variant);
  const activePrice = pricing.price;
  const comparePrice = pricing.comparePrice && pricing.comparePrice > activePrice ? pricing.comparePrice : 0;
  const meta = [safeProduct?.brand, safeProduct?.category, safeProduct?.gender, safeProduct?.grade].filter(Boolean).join(" / ") || t("storefront.products.storeProduct", "منتج من المتجر");

  const viewProduct = (event) => {
    event.stopPropagation();
    if (safeProduct?.id && onPickProduct) onPickProduct({ ...safeProduct, selected_variant_id: variant?.id || safeProduct.selected_variant_id });
  };

  const quickAdd = (event) => {
    event.stopPropagation();
    if (!onQuickAdd || !variant || variantStock <= 0) {
      toast.error(sfText("storefront.toasts.variantUnavailable", "هذا المقاس أو اللون غير متاح حاليًا."));
      return;
    }
    onQuickAdd(safeProduct, variant, 1, { sourceEl: imageRef.current });
  };

  return (
    <article className="sf-visual-card" style={{ animationDelay: `${index * 45}ms` }}>
      <button type="button" onClick={viewProduct} className="sf-visual-card-main">
        <span className="sf-visual-card-image-wrap">
          <img ref={imageRef} src={imageFor(displayImageForProduct(safeProduct, variant))} onError={fallbackProductImage} alt={safeProduct?.name || ""} className="sf-visual-card-image" loading="lazy" decoding="async" />
        </span>
        <span className="min-w-0 flex-1 text-start">
          <span className="sf-visual-card-name">{safeProduct?.name}</span>
          <span className="sf-visual-card-meta">{meta}</span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold tabular-nums" style={{ color: "var(--m1h-text)" }}>{money(activePrice)}</span>
            {comparePrice ? <span className="text-xs font-medium tabular-nums line-through" style={{ color: "var(--m1h-text-3)" }}>{money(comparePrice)}</span> : null}
          </span>
          <span className={`mt-2 sfx-badge ${isAvailable ? "sfx-badge--success" : "sfx-badge--danger"}`}>
            {isAvailable ? t("storefront.products.availableNow", "متاح الآن") : t("storefront.products.unavailable", "غير متاح")}
          </span>
        </span>
      </button>
      <div className="sf-visual-actions">
        <button type="button" onClick={viewProduct} className="sf-visual-action-primary sfx-btn sfx-btn--primary sfx-btn--sm">{t("storefront.products.viewProduct", "عرض المنتج")}</button>
        <button type="button" onClick={quickAdd} disabled={!isAvailable} className="sf-visual-action-soft sfx-btn sfx-btn--secondary sfx-btn--sm">{t("storefront.cart.addToCart", "إضافة إلى السلة")}</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); setShowSizes((value) => !value); }} className="sf-visual-action-soft sfx-btn sfx-btn--secondary sfx-btn--sm">{t("storefront.products.sizes", "المقاسات")}</button>
      </div>
      {showSizes ? (
        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          {(variants.length ? variants : [variant]).filter(Boolean).map((item) => {
            const selected = String(item.id) === String(variant?.id);
            const size = item.size || item.size_label || t("storefront.products.oneSize", "مقاس واحد");
            const hasStock = variantHasStock(item);
            return (
              <button
                key={item.id || size}
                type="button"
                disabled={!hasStock}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedVariantId(item.id || "");
                }}
                aria-pressed={selected}
                className={`sfx-chip disabled:cursor-not-allowed disabled:opacity-40${selected ? " is-active" : ""}`}
              >
                {size}
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function VisualSearchSkeleton() {
  return (
    <div className="sf-visual-card-list">
      {[0, 1].map((item) => (
        <div key={item} className="sf-visual-card">
          <div className="sf-visual-card-main">
            <div className="sfx-skel h-24 w-24 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="sfx-skel h-4 w-4/5" style={{ borderRadius: "var(--m1h-r-pill)" }} />
              <div className="sfx-skel mt-3 h-3 w-3/5" style={{ borderRadius: "var(--m1h-r-pill)" }} />
              <div className="sfx-skel mt-4 h-4 w-24" style={{ borderRadius: "var(--m1h-r-pill)" }} />
            </div>
          </div>
          <div className="sf-visual-actions">
            <div className="sfx-skel h-9" style={{ borderRadius: "var(--m1h-r-pill)" }} />
            <div className="sfx-skel h-9" style={{ borderRadius: "var(--m1h-r-pill)" }} />
            <div className="sfx-skel h-9" style={{ borderRadius: "var(--m1h-r-pill)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function VisualSearchEmpty({ message, keywords, onPickTerm }) {
  const { t } = useTranslation();
  return (
    <div className="sf-visual-empty">
      <div className="grid h-14 w-14 shrink-0 place-items-center" style={{ borderRadius: "var(--m1h-r-lg)", background: "var(--m1h-accent-soft)", color: "var(--m1h-accent)" }}>
        <PackageSearch className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: "var(--m1h-text)" }}>{t("storefront.visualSearch.noSimilarProduct", "لم يتم العثور على منتج مشابه")}</div>
        <div className="mt-1 text-xs leading-5" style={{ color: "var(--m1h-text-2)" }}>{message || t("storefront.visualSearch.emptyHint", "جرّب صورة أوضح أو استخدم الكلمات المقترحة.")}</div>
        {keywords.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {keywords.map((keyword) => (
              <button key={keyword} type="button" onClick={() => onPickTerm(keyword)} className="sfx-chip">
                {keyword}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function StorefrontVisualSearchResults({ products = [], loading, visualSearch, onPickTerm, onPickProduct, onQuickAdd, helpers }) {
  const { t } = useTranslation();
  const keywords = Array.isArray(visualSearch?.keywords) ? visualSearch.keywords.filter(Boolean).slice(0, 8) : [];
  const countLabel = loading ? "..." : products.length;
  return (
    <section className="sf-visual-results grid gap-3" aria-live="polite">
      {visualSearch?.previewUrl ? (
        <div className="sf-visual-preview">
          <img src={visualSearch.previewUrl} alt="" className="sf-visual-preview-image" decoding="async" />
          {visualSearch?.fileName ? <div className="sf-visual-preview-name" title={visualSearch.fileName}>{visualSearch.fileName}</div> : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: "var(--m1h-text)" }}>{t("storefront.visualSearch.similarProducts", "منتجات مشابهة")}</h3>
          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--m1h-text-3)" }}>
            {loading ? t("storefront.visualSearch.analyzing", "جاري تحليل الصورة والبحث عن أقرب المنتجات...") : visualSearch?.error || visualSearch?.message || t("storefront.visualSearch.resultsFromImage", "نتائج مبنية على الصورة المرفوعة")}
          </p>
        </div>
        <span className="sfx-badge sfx-badge--ink shrink-0">
          {t("storefront.search.resultCount", "{{count}} result", { count: countLabel })}
        </span>
      </div>

      {loading ? <VisualSearchSkeleton /> : products.length ? (
        <div className="sf-visual-card-list">
          {products.map((product, index) => (
            <VisualSearchCardBoundary key={product?.id || `visual-product-${index}`}>
              <VisualSearchProductCard
                product={product}
                index={index}
                onPickProduct={onPickProduct}
                onQuickAdd={onQuickAdd}
                helpers={helpers}
              />
            </VisualSearchCardBoundary>
          ))}
        </div>
      ) : (
        <VisualSearchEmpty
          message={visualSearch?.error || visualSearch?.message || t("storefront.visualSearch.noSimilarProduct", "لم يتم العثور على منتج مشابه")}
          keywords={keywords}
          onPickTerm={onPickTerm}
        />
      )}
    </section>
  );
}
