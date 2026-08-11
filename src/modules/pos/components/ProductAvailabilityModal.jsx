import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Package2, X } from "lucide-react";

import { formatCurrency } from "../lib/posUtils";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { getCrocsSizeInputDisplayLabel, isCrocsProductType } from "../../products/lib/variantBulkSizes";

const failedAvailabilityImageUrls = new Set();

const getAvailabilitySizeDisplayLabel = (product = {}, size = "") => {
  const rawSize = String(size || "").trim();
  if (!rawSize) return "";

  const crocsSource = [
    product?.product_type,
    product?.productType,
    product?.category,
    product?.category_name,
    product?.brand,
    product?.brand_name,
    product?.type,
  ]
    .filter(Boolean)
    .join(" ");

  return isCrocsProductType(crocsSource) ? getCrocsSizeInputDisplayLabel(rawSize) || rawSize : rawSize;
};

function ProductAvailabilityModal({ product, onClose, onAddVariant }) {
  const { t } = useTranslation();
  const variationMode = String(product?.variation_mode || "full_variations").trim().toLowerCase();
  const isColorOnlyMode = variationMode === "color_only";
  const isSimpleMode = variationMode === "simple";
  const colors = Array.isArray(product?.colors) ? product.colors : [];
  const matchedColor = String(product?.matched_color || product?.matchedColor || "").trim();
  const matchedVariantId = String(product?.matched_variant_id || product?.matchedVariantId || "").trim();
  const matchedColorLower = matchedColor.toLowerCase();
  const matchedColorGroup =
    (matchedColorLower
      ? colors.find((color) => String(color.color || "").trim().toLowerCase() === matchedColorLower)
      : null) ||
    null;
  const matchedSize = (() => {
    if (!matchedVariantId) return "";
    for (const color of colors) {
      const size = (Array.isArray(color.sizes) ? color.sizes : []).find((item) => String(item.variant_id) === matchedVariantId);
      if (size) return String(size.size || "").trim();
    }
    return "";
  })();
  const firstAvailableColor =
    colors.find((color) => color.sizes?.some((size) => size.available)) ||
    colors[0] ||
    null;
  const [selectedColor, setSelectedColor] = useState(() => matchedColor || matchedColorGroup?.color || firstAvailableColor?.color || "");
  const activeColor =
    colors.find((color) => String(color.color || "") === String(selectedColor || "")) ||
    firstAvailableColor;
  const firstAvailableSize =
    activeColor?.sizes?.find((size) => size.available) ||
    activeColor?.sizes?.[0] ||
    null;
  const initialVariantId = (() => {
    if (matchedVariantId) {
      for (const color of colors) {
        const size = (Array.isArray(color.sizes) ? color.sizes : []).find((item) => String(item.variant_id) === matchedVariantId);
        if (size) return size.variant_id || null;
      }
    }
    return firstAvailableSize?.variant_id || null;
  })();
  const [selectedVariantId, setSelectedVariantId] = useState(() => initialVariantId);
  const [imageFailed, setImageFailed] = useState(false);

  const selectedSize = useMemo(
    () =>
      (activeColor?.sizes || []).find((size) => String(size.variant_id) === String(selectedVariantId)) ||
      null,
    [activeColor, selectedVariantId]
  );

  useEffect(() => {
    if (matchedColor && String(selectedColor || "") !== matchedColor) {
      setSelectedColor(matchedColorGroup?.color || matchedColor || firstAvailableColor?.color || "");
    }
    if (matchedSize && !selectedVariantId) {
      const nextVariant = (activeColor?.sizes || []).find((size) => String(size.variant_id) === String(matchedVariantId)) || null;
      if (nextVariant) setSelectedVariantId(nextVariant.variant_id || null);
    }
    // This effect is only for initializing selection from search metadata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedColor, matchedSize, matchedVariantId, matchedColorGroup, firstAvailableColor, activeColor]);

  const simpleVariant = useMemo(
    () => ({
      variant_id: null,
      color: "",
      size: "",
      sku: product?.sku || "",
      barcode: product?.barcode || "",
      price: Number(product?.sale_price || product?.price || 0),
      stock: Number(product?.stock || 0),
      image_url: product?.image_url || product?.product_image_url || "",
      product_image_url: product?.product_image_url || product?.image_url || "",
      variant_image_url: "",
    }),
    [product]
  );

  const imageUrl = resolveProductImageUrl(
    (isSimpleMode ? simpleVariant.image_url : "") ||
    selectedSize?.variant_image_url ||
    selectedSize?.primary_image_url ||
    selectedSize?.image_url ||
    activeColor?.primary_image_url ||
    activeColor?.image_url ||
    product?.product_image_url ||
    product?.image_url ||
    ""
  );
  const hasAvailableSizes = isSimpleMode
    ? true
    : colors.some((color) => color.sizes?.some((size) => size.available));
  const selectedVariant = isSimpleMode ? simpleVariant : selectedSize;
  const selectedStock = Number(selectedVariant?.stock_quantity ?? selectedVariant?.stock ?? 0);
  const selectedPrice = Number(selectedVariant?.sale_price ?? selectedVariant?.price ?? 0);
  const hasSelectedColor = isSimpleMode ? true : Boolean(activeColor?.color || selectedColor);
  const hasSelectedVariant = isSimpleMode ? true : isColorOnlyMode ? Boolean(activeColor) : Boolean(selectedSize?.variant_id);
  const canAddSelected = hasSelectedColor && hasSelectedVariant && selectedStock > 0;
  const isOutOfStock = hasSelectedColor && hasSelectedVariant && selectedStock <= 0;

  useEffect(() => {
    setImageFailed(failedAvailabilityImageUrls.has(imageUrl));
  }, [imageUrl]);

  useEffect(() => {
    console.log("[pos-mobile-variant-modal-render]", {
      selectedColor,
      selectedSize,
      selectedVariant,
      selectedVariantStock: selectedVariant?.stock,
      selectedVariantPrice: selectedVariant?.price,
      canAddSelectedVariant: canAddSelected,
    });
  }, [canAddSelected, selectedColor, selectedSize, selectedVariant]);

  const handleAdd = () => {
    if (isSimpleMode) {
      if (!canAddSelected) return;
      onAddVariant(
        {
          id: product.id,
          product_id: product.id,
          name: product.name,
          product_name: product.name,
          image_url: product.image_url,
          product_image_url: product.product_image_url || product.image_url,
          brand: product.brand,
          category: product.category,
          variation_mode: product.variation_mode || "simple",
          fixed_size_label: product.fixed_size_label || t("pos.labels.oneSize"),
        },
        simpleVariant
      );
      onClose();
      return;
    }

    if (!canAddSelected) return;
    onAddVariant(
      {
        id: product.id,
        product_id: product.id,
        name: product.name,
        product_name: product.name,
        image_url: product.image_url,
        product_image_url: product.product_image_url || product.image_url,
        brand: product.brand,
        category: product.category,
      },
      {
        variant_id: selectedSize.variant_id,
        color: activeColor?.color || "",
        size: selectedSize.size || "",
        sku: selectedSize.sku || "",
        barcode: selectedSize.barcode || "",
        price: Number(selectedSize.sale_price || 0),
        stock: Number(selectedSize.stock_quantity || 0),
        image_url: selectedSize.image_url || activeColor?.image_url || product.image_url || "",
        variant_image_url: selectedSize.variant_image_url || "",
        product_image_url: product.product_image_url || product.image_url || "",
      }
    );
    onClose();
  };

  if (!product) return null;

  return (
    <div className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/75 px-2 py-2 sm:px-4 sm:py-6 lg:items-center">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.25rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 sm:rounded-[2rem]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-3 sm:gap-4 sm:p-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">{t("pos.variantSelector.barcodeShop", "Barcode Shop")}</div>
            <h2 className="mt-1 line-clamp-1 text-base font-black text-white sm:mt-2 sm:text-2xl">{product.name}</h2>
            <p className="mt-1 hidden text-sm text-zinc-400 sm:block">
              {isSimpleMode
                ? t("pos.variantSelector.simplePrompt", "Simple product. Add directly to cart.")
                : isColorOnlyMode
                  ? t("pos.variantSelector.colorPrompt", "Choose the color to add to cart.")
                  : t("pos.variantSelector.fullPrompt", "Choose the exact color and size to add to cart.")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-white transition hover:bg-white/10 sm:rounded-2xl sm:p-3"
          >
            <X className="h-4 w-4 sm:h-5 sm:w-5" />
          </button>
        </div>

        <div className="grid flex-1 gap-3 overflow-y-auto p-3 pb-[calc(10rem+env(safe-area-inset-bottom))] sm:gap-5 sm:p-5 sm:pb-5 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-3 sm:space-y-4">
            <div className="flex h-36 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:h-72 sm:rounded-3xl">
              {imageUrl && !imageFailed ? (
                <img
                  src={imageUrl}
                  alt={product.name}
                  loading="lazy"
                  className="h-full w-full object-contain p-2 sm:p-4"
                  onError={() => {
                    failedAvailabilityImageUrls.add(imageUrl);
                    setImageFailed(true);
                  }}
                />
              ) : (
                <Package2 className="h-16 w-16 text-zinc-600" />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label={t("products.fields.brand", "Brand")} value={product.brand || t("common.unbranded", "Unbranded")} />
              <Info label={t("products.fields.category", "Category")} value={product.category || t("common.uncategorized", "Uncategorized")} />
            </div>
          </div>

          <div className="space-y-3 sm:space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-2.5 sm:rounded-3xl sm:p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:text-xs sm:tracking-[0.18em]">{t("pos.variantSelector.colors", "Colors")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3 sm:grid sm:grid-cols-2 sm:gap-2">
                {(isSimpleMode ? [{ color: t("pos.labels.default"), sizes: [{ available: true }] }] : colors).map((color) => {
                  const availableCount = (color.sizes || []).filter((size) => size.available).length;
                  const active = String(color.color || "") === String(activeColor?.color || "");
                  return (
                    <button
                      key={color.color || t("pos.labels.default")}
                      type="button"
                      onClick={() => {
                        setSelectedColor(color.color || "");
                        const nextSize = color.sizes?.find((size) => size.available) || color.sizes?.[0] || null;
                        setSelectedVariantId(nextSize?.variant_id || null);
                      }}
                      className={`min-h-[var(--control-height-md)] rounded-full border px-3 py-1.5 text-left text-xs font-black transition sm:min-h-0 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm ${
                        active
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-50"
                          : "border-white/10 bg-black/20 text-white hover:bg-white/10"
                      }`}
                    >
                      <div className="font-bold">{color.color || t("pos.labels.default")}</div>
                      <div className="hidden sm:mt-1 sm:block sm:text-xs sm:text-zinc-400">{t("pos.variantSelector.availableSizes", { count: availableCount, defaultValue: "{{count}} available size(s)" })}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {!isColorOnlyMode && !isSimpleMode ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-2.5 sm:rounded-3xl sm:p-4">
                <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:text-xs sm:tracking-[0.18em]">{t("pos.variantSelector.sizes", "Sizes")}</div>
                {!hasAvailableSizes ? (
                  <div className="mt-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100 sm:mt-4 sm:p-4 sm:text-sm">
                    {t("pos.variantSelector.noAvailableSizes", "No available sizes in stock")}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3 sm:grid sm:grid-cols-2 sm:gap-2">
                    {(activeColor?.sizes || []).map((size) => {
                      const active = String(size.variant_id) === String(selectedVariantId);
                      const low = size.available && Number(size.stock_quantity || 0) <= 3;
                      return (
                        <button
                          key={String(size.variant_id)}
                          type="button"
                          disabled={!size.available}
                          onClick={() => setSelectedVariantId(size.variant_id)}
                          className={`min-h-[var(--control-height-md)] rounded-full border px-3 py-1.5 text-left transition sm:min-h-0 sm:rounded-2xl sm:px-4 sm:py-3 ${
                            active
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-50"
                              : !size.available
                                ? "cursor-not-allowed border-white/5 bg-black/20 text-zinc-600"
                                : "border-white/10 bg-black/20 text-white hover:bg-white/10"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-black sm:text-lg">{getAvailabilitySizeDisplayLabel(product, size.size) || t("pos.labels.oneSize")}</span>
                            <StatusBadge available={size.available} low={low} compact />
                          </div>
                          <div className="mt-1 text-[10px] font-bold text-zinc-400 sm:mt-2 sm:text-xs">
                            {Number(size.stock_quantity || 0)} in stock · {formatCurrency(size.sale_price)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 sm:rounded-3xl sm:p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:text-xs sm:tracking-[0.18em]">{t("pos.labels.selectedVariant")}</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs sm:mt-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:text-sm">
                <Info compact label={t("pos.labels.color")} value={activeColor?.color || t("pos.labels.default")} />
                <Info compact label={t("pos.labels.size")} value={isSimpleMode ? getAvailabilitySizeDisplayLabel(product, product?.fixed_size_label || t("pos.labels.oneSize")) || t("pos.labels.oneSize") : getAvailabilitySizeDisplayLabel(product, selectedSize?.size) || t("common.notAvailable")} />
                <Info compact label={t("pos.labels.stock")} value={String(isSimpleMode ? product?.stock ?? 0 : selectedSize?.stock_quantity ?? 0)} />
                <Info compact label={t("pos.labels.price")} value={formatCurrency(isSimpleMode ? simpleVariant.price : selectedSize?.sale_price || 0)} />
                <Info className="hidden sm:block" label={t("pos.labels.sku")} value={selectedSize?.sku || t("common.notAvailable")} />
                <Info className="hidden sm:block" label={t("pos.labels.barcode")} value={selectedSize?.barcode || t("common.notAvailable")} />
              </div>
              <details className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-400 sm:hidden">
                <summary className="cursor-pointer font-bold text-zinc-300">{t("pos.labels.sku")} / {t("pos.labels.barcode")}</summary>
                <div className="mt-2 space-y-1">
                  <div className="truncate">{t("pos.labels.sku")}: {selectedSize?.sku || t("common.notAvailable")}</div>
                  <div className="truncate">{t("pos.labels.barcode")}: {selectedSize?.barcode || t("common.notAvailable")}</div>
                </div>
              </details>
              <div className="hidden mt-3 sm:hidden">
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!canAddSelected}
                  className="inline-flex min-h-[var(--control-height-lg)] w-full flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-500 px-4 py-3 text-center text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-400"
                >
                  <span className="text-base leading-none">{isOutOfStock ? t("pos.variantSelector.outOfStock", "Out of stock") : t("pos.labels.addToInvoiceArabic", "إضافة للفاتورة")}</span>
                  <span className="text-[11px] font-bold leading-none text-black/75">
                    {formatCurrency(selectedPrice)} • {selectedStock > 0 ? `${t("pos.labels.stock", "Stock")} ${selectedStock}` : t("pos.variantSelector.outOfStock", "Out of stock")}
                  </span>
                </button>
              </div>
              {selectedVariant ? (
                <div className="mt-3 sm:hidden">
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={selectedStock <= 0}
                    className="inline-flex min-h-[var(--control-height-lg)] w-full flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-500 px-4 py-3 text-center text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-400"
                  >
                    <span className="text-base leading-none">
                      {selectedStock <= 0 ? t("pos.variantSelector.outOfStock", "Out of stock") : t("pos.labels.addToInvoiceArabic", "إضافة للفاتورة")}
                    </span>
                    <span className="text-[11px] font-bold leading-none text-black/75">
                      {formatCurrency(selectedPrice)} • {selectedStock > 0 ? `${t("pos.labels.stock", "Stock")} ${selectedStock}` : t("pos.variantSelector.outOfStock", "Out of stock")}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            <div className="hidden flex-col-reverse gap-3 sm:flex sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!canAddSelected}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t("pos.labels.addToCart", "Add to cart")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, compact = false, className = "" }) {
  return (
    <div className={`${compact ? "rounded-full px-2.5 py-1 sm:rounded-2xl sm:px-3 sm:py-3" : "rounded-2xl px-3 py-3"} border border-white/10 bg-black/20 ${className}`}>
      <div className={`${compact ? "inline text-[10px] tracking-normal sm:block sm:uppercase sm:tracking-[0.16em]" : "text-[10px] uppercase tracking-[0.16em]"} text-zinc-500`}>{label}</div>
      <div className={`${compact ? "ml-1 inline truncate text-xs sm:ml-0 sm:mt-1 sm:block sm:text-sm" : "mt-1 truncate text-sm"} font-semibold text-white`}>{value}</div>
    </div>
  );
}

function StatusBadge({ available, low, compact = false }) {
  const { t } = useTranslation();
  if (!available) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-300 ${compact ? "px-1.5 py-0.5" : ""}`}>
        <AlertTriangle className="h-3 w-3" />
        <span className={compact ? "sr-only sm:not-sr-only" : ""}>{t("pos.variantSelector.outOfStock", "Out of stock")}</span>
      </span>
    );
  }

  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${compact ? "px-1.5 py-0.5" : ""} ${low ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-300"}`}>
      {low ? t("pos.variantSelector.lowStock", "Low stock") : t("pos.variantSelector.inStock", "In stock")}
    </span>
  );
}

export default memo(ProductAvailabilityModal);
