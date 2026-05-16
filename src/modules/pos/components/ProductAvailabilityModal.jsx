import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Package2, X } from "lucide-react";

import { formatCurrency } from "../lib/posUtils";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const failedAvailabilityImageUrls = new Set();

function ProductAvailabilityModal({ product, onClose, onAddVariant }) {
  const variationMode = String(product?.variation_mode || "full_variations").trim().toLowerCase();
  const isColorOnlyMode = variationMode === "color_only";
  const isSimpleMode = variationMode === "simple";
  const colors = Array.isArray(product?.colors) ? product.colors : [];
  const firstAvailableColor =
    colors.find((color) => color.sizes?.some((size) => size.available)) ||
    colors[0] ||
    null;
  const [selectedColor, setSelectedColor] = useState(() => firstAvailableColor?.color || "");
  const activeColor =
    colors.find((color) => String(color.color || "") === String(selectedColor || "")) ||
    firstAvailableColor;
  const firstAvailableSize =
    activeColor?.sizes?.find((size) => size.available) ||
    activeColor?.sizes?.[0] ||
    null;
  const [selectedVariantId, setSelectedVariantId] = useState(() => firstAvailableSize?.variant_id || null);
  const [imageFailed, setImageFailed] = useState(false);

  const selectedSize = useMemo(
    () =>
      (activeColor?.sizes || []).find((size) => String(size.variant_id) === String(selectedVariantId)) ||
      null,
    [activeColor, selectedVariantId]
  );

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
    selectedSize?.image_url ||
    selectedSize?.variant_image_url ||
    activeColor?.image_url ||
    product?.image_url ||
    product?.product_image_url ||
    ""
  );
  const hasAvailableSizes = isSimpleMode
    ? true
    : colors.some((color) => color.sizes?.some((size) => size.available));

  useEffect(() => {
    setImageFailed(failedAvailabilityImageUrls.has(imageUrl));
  }, [imageUrl]);

  const handleAdd = () => {
    if (isSimpleMode) {
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
          fixed_size_label: product.fixed_size_label || "One Size",
        },
        simpleVariant
      );
      onClose();
      return;
    }

    if (!selectedSize || !selectedSize.available) return;
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
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 px-4 py-6 lg:items-center">
      <div className="w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">Barcode Shop</div>
            <h2 className="mt-2 text-2xl font-black text-white">{product.name}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              {isSimpleMode
                ? "Simple product. Add directly to cart."
                : isColorOnlyMode
                  ? "Choose the color to add to cart."
                  : "Choose the exact color and size to add to cart."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/5 p-3 text-white transition hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-4">
            <div className="flex h-72 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5">
              {imageUrl && !imageFailed ? (
                <img
                  src={imageUrl}
                  alt={product.name}
                  loading="lazy"
                  className="h-full w-full object-contain p-4"
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
              <Info label="Brand" value={product.brand || "Unbranded"} />
              <Info label="Category" value={product.category || "Uncategorized"} />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Colors</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(isSimpleMode ? [{ color: "Default", sizes: [{ available: true }] }] : colors).map((color) => {
                  const availableCount = (color.sizes || []).filter((size) => size.available).length;
                  const active = String(color.color || "") === String(activeColor?.color || "");
                  return (
                    <button
                      key={color.color || "Default"}
                      type="button"
                      onClick={() => {
                        setSelectedColor(color.color || "");
                        const nextSize = color.sizes?.find((size) => size.available) || color.sizes?.[0] || null;
                        setSelectedVariantId(nextSize?.variant_id || null);
                      }}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        active
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-50"
                          : "border-white/10 bg-black/20 text-white hover:bg-white/10"
                      }`}
                    >
                      <div className="font-bold">{color.color || "Default"}</div>
                      <div className="mt-1 text-xs text-zinc-400">{availableCount} available size(s)</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {!isColorOnlyMode && !isSimpleMode ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Sizes</div>
                {!hasAvailableSizes ? (
                  <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                    No available sizes in stock
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {(activeColor?.sizes || []).map((size) => {
                      const active = String(size.variant_id) === String(selectedVariantId);
                      const low = size.available && Number(size.stock_quantity || 0) <= 3;
                      return (
                        <button
                          key={String(size.variant_id)}
                          type="button"
                          disabled={!size.available}
                          onClick={() => setSelectedVariantId(size.variant_id)}
                          className={`rounded-2xl border px-4 py-3 text-left transition ${
                            active
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-50"
                              : !size.available
                                ? "cursor-not-allowed border-white/5 bg-black/20 text-zinc-600"
                                : "border-white/10 bg-black/20 text-white hover:bg-white/10"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-lg font-black">{size.size || "One size"}</span>
                            <StatusBadge available={size.available} low={low} />
                          </div>
                          <div className="mt-2 text-xs text-zinc-400">
                            {Number(size.stock_quantity || 0)} in stock · {formatCurrency(size.sale_price)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Selected variant</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <Info label="Color" value={activeColor?.color || "Default"} />
                <Info label="Size" value={isSimpleMode ? product?.fixed_size_label || "One Size" : selectedSize?.size || "n/a"} />
                <Info label="SKU" value={selectedSize?.sku || "n/a"} />
                <Info label="Barcode" value={selectedSize?.barcode || "n/a"} />
                <Info label="Stock" value={String(isSimpleMode ? product?.stock ?? 0 : selectedSize?.stock_quantity ?? 0)} />
                <Info label="Price" value={formatCurrency(isSimpleMode ? simpleVariant.sale_price : selectedSize?.sale_price || 0)} />
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={isSimpleMode ? false : !selectedSize?.available}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                Add to cart
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function StatusBadge({ available, low }) {
  if (!available) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-bold text-red-300">
        <AlertTriangle className="h-3 w-3" />
        Out
      </span>
    );
  }

  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${low ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-300"}`}>
      {low ? "Low stock" : "In stock"}
    </span>
  );
}

export default ProductAvailabilityModal;
