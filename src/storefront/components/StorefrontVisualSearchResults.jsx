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
  const parsedSaleModeEnabled = parseSaleModeEnabled(saleModeEnabled, true);
  const pricing = getDisplayPricing(safeProduct, parsedSaleModeEnabled, variant);
  const activePrice = pricing.price;
  const comparePrice = parsedSaleModeEnabled && pricing.comparePrice && pricing.comparePrice > activePrice ? pricing.comparePrice : 0;
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
        <span className="min-w-0 flex-1 text-right">
          <span className="sf-visual-card-name">{safeProduct?.name}</span>
          <span className="sf-visual-card-meta">{meta}</span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-stone-950 dark:text-white">{money(activePrice)}</span>
            {comparePrice ? <span className="text-[11px] font-bold text-stone-400 line-through">{money(comparePrice)}</span> : null}
          </span>
          <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${isAvailable ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-200"}`}>
            {isAvailable ? t("storefront.products.availableNow", "متاح الآن") : t("storefront.products.unavailable", "غير متاح")}
          </span>
        </span>
      </button>
      <div className="sf-visual-actions">
        <button type="button" onClick={viewProduct} className="sf-visual-action-primary">{t("storefront.products.viewProduct", "عرض المنتج")}</button>
        <button type="button" onClick={quickAdd} disabled={!isAvailable} className="sf-visual-action-soft">{t("storefront.cart.addToCart", "إضافة إلى السلة")}</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); setShowSizes((value) => !value); }} className="sf-visual-action-soft">{t("storefront.products.sizes", "المقاسات")}</button>
      </div>
      {showSizes ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
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
                className={`rounded-full border px-2.5 py-1 text-[10px] font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${selected ? "border-[#d4af37] bg-[rgba(212,175,55,0.12)] text-[#d4af37]" : "border-stone-200 bg-white text-stone-700 hover:border-[#d4af37]/50 dark:border-white/10 dark:bg-white/8 dark:text-stone-200"}`}
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
        <div key={item} className="sf-visual-card animate-pulse">
          <div className="sf-visual-card-main">
            <div className="h-24 w-24 shrink-0 rounded-2xl bg-stone-200/80 dark:bg-white/10" />
            <div className="min-w-0 flex-1">
              <div className="h-4 w-4/5 rounded-full bg-stone-200 dark:bg-white/10" />
              <div className="mt-3 h-3 w-3/5 rounded-full bg-stone-200 dark:bg-white/10" />
              <div className="mt-4 h-4 w-24 rounded-full bg-stone-200 dark:bg-white/10" />
            </div>
          </div>
          <div className="sf-visual-actions">
            <div className="h-9 rounded-full bg-stone-200 dark:bg-white/10" />
            <div className="h-9 rounded-full bg-stone-200 dark:bg-white/10" />
            <div className="h-9 rounded-full bg-stone-200 dark:bg-white/10" />
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
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-[#d4af37]/20 bg-[rgba(212,175,55,0.14)] text-[#d4af37] shadow-[0_14px_34px_rgba(212,175,55,0.16)]">
        <PackageSearch className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-black text-stone-50">{t("storefront.visualSearch.noSimilarProduct", "لم يتم العثور على منتج مشابه")}</div>
        <div className="mt-1 text-xs font-bold leading-5 text-stone-400">{message || t("storefront.visualSearch.emptyHint", "جرّب صورة أوضح أو استخدم الكلمات المقترحة.")}</div>
        {keywords.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {keywords.map((keyword) => (
              <button key={keyword} type="button" onClick={() => onPickTerm(keyword)} className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5 text-xs font-black text-stone-200 transition hover:border-[#d4af37]/40 hover:bg-[rgba(212,175,55,0.18)] hover:text-white active:scale-95">
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
          <h3 className="text-sm font-black text-stone-950 dark:text-white">{t("storefront.visualSearch.similarProducts", "منتجات مشابهة")}</h3>
          <p className="mt-0.5 truncate text-[11px] font-bold text-stone-500 dark:text-stone-400">
            {loading ? t("storefront.visualSearch.analyzing", "جاري تحليل الصورة والبحث عن أقرب المنتجات...") : visualSearch?.error || visualSearch?.message || t("storefront.visualSearch.resultsFromImage", "نتائج مبنية على الصورة المرفوعة")}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-stone-200 bg-stone-950 px-3 py-1 text-[11px] font-black text-white shadow-sm dark:border-white/10 dark:bg-white dark:text-stone-950">
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
