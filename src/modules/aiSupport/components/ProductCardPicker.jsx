import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, Search, ShoppingBag, X } from "lucide-react";

import { getPosSellableProducts } from "../../pos/services/posProductsApi";
import { formatCurrency } from "../../../shared/lib/currency";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const money = (value) => formatCurrency(value);

const uniqueTextValues = (values = []) =>
  [...new Set(values.map((item) => clean(item)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));

const resolveStorefrontUrl = (product = {}) => {
  const rawUrl = clean(product.storefront_url || product.product_url || product.url || "");
  if (rawUrl) return rawUrl;
  const productId = product.product_id || product.id || "";
  if (!productId) return "";
  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      return new URL(`/shop/product/${encodeURIComponent(productId)}`, window.location.origin).toString();
    } catch {
      return `/shop/product/${encodeURIComponent(productId)}`;
    }
  }
  return `/shop/product/${encodeURIComponent(productId)}`;
};

const productImage = (product = {}, variant = null) =>
  clean(
    variant?.image_url ||
      variant?.variant_image_url ||
      product.product_image_url ||
      product.image_url ||
      product.image ||
      product.thumbnail_url ||
      ""
  );

const productBarcode = (product = {}) =>
  clean(product.barcode || product.product_barcode || "");

const variantBarcode = (variant = {}) =>
  clean(variant.barcode || variant.variant_barcode || "");

const productColors = (product = {}) =>
  uniqueTextValues(asArray(product.variants).map((variant) => variant.color || variant.color_name || variant.variant_color));

const productSizes = (product = {}, color = "") => {
  const normalizedColor = lower(color);
  const variants = asArray(product.variants).filter((variant) => {
    if (!normalizedColor) return true;
    return lower(variant.color || variant.color_name || variant.variant_color) === normalizedColor;
  });
  return uniqueTextValues(variants.map((variant) => variant.size || variant.size_name || variant.variant_size));
};

const findMatchingVariant = (product = {}, color = "", size = "") => {
  const variants = asArray(product.variants);
  if (!variants.length) return null;
  const normalizedColor = lower(color);
  const normalizedSize = lower(size);
  const exactMatch = variants.find((variant) => {
    const variantColor = lower(variant.color || variant.color_name || variant.variant_color);
    const variantSize = lower(variant.size || variant.size_name || variant.variant_size);
    const colorMatches = !normalizedColor || variantColor === normalizedColor;
    const sizeMatches = !normalizedSize || variantSize === normalizedSize;
    return colorMatches && sizeMatches;
  });
  if (exactMatch) return exactMatch;
  const colorMatch = normalizedColor ? variants.find((variant) => lower(variant.color || variant.color_name || variant.variant_color) === normalizedColor) : null;
  if (colorMatch) return colorMatch;
  const sizeMatch = normalizedSize ? variants.find((variant) => lower(variant.size || variant.size_name || variant.variant_size) === normalizedSize) : null;
  if (sizeMatch) return sizeMatch;
  return variants[0] || null;
};

const buildProductCardPayload = (product = {}, variant = null) => {
  const activeImage = productImage(product, variant);
  const activeVariantId = variant?.variant_id ?? variant?.id ?? null;
  const activeProductId = product.product_id ?? product.id ?? variant?.product_id ?? null;
  const color = clean(variant?.color || variant?.color_name || variant?.variant_color || "");
  const size = clean(variant?.size || variant?.size_name || variant?.variant_size || "");
  const priceValue = Number(variant?.price ?? variant?.final_price ?? variant?.regular_price ?? product.final_price ?? product.price ?? 0);
  return {
    product_id: activeProductId,
    variant_id: activeVariantId,
    product_name: clean(product.name || product.product_name || product.title || ""),
    image_url: activeImage,
    price: Number.isFinite(priceValue) ? priceValue : 0,
    color,
    size,
    storefront_url: resolveStorefrontUrl(product),
  };
};

const matchesQuery = (product = {}, query = "") => {
  const normalized = lower(query);
  if (!normalized) return true;
  const searchable = [
    product.name,
    product.product_name,
    product.title,
    product.sku,
    product.barcode,
    product.product_barcode,
    product.brand,
    product.brand_name,
    product.category,
    product.category_name,
    product.category_path,
    product.manufacturer,
    product.manufacturer_name,
    ...asArray(product.variants).flatMap((variant) => [
      variant.name,
      variant.color,
      variant.size,
      variant.sku,
      variant.barcode,
      variant.variant_barcode,
      variant.article_code,
      variant.variant_article_code,
    ]),
  ];
  return searchable.some((item) => lower(item).includes(normalized));
};

export default function ProductCardPicker({ open, onClose, onSubmit }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("all");
  const [category, setCategory] = useState("all");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedColor, setSelectedColor] = useState("");
  const [selectedSize, setSelectedSize] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    Promise.resolve()
      .then(() => getPosSellableProducts())
      .then((data) => {
        if (!active) return;
        setProducts(asArray(data));
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || "تعذر تحميل كتالوج المنتجات");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const filteredProducts = useMemo(() => {
    const searchValue = clean(search);
    return products.filter((product) => {
      if (brand !== "all" && lower(product.brand || product.brand_name) !== lower(brand)) return false;
      if (category !== "all" && lower(product.category || product.category_name) !== lower(category)) return false;
      if (!matchesQuery(product, searchValue)) return false;
      return true;
    });
  }, [brand, category, products, search]);

  const brandOptions = useMemo(() => uniqueTextValues(products.map((product) => product.brand || product.brand_name)), [products]);
  const categoryOptions = useMemo(() => uniqueTextValues(products.map((product) => product.category || product.category_name)), [products]);

  useEffect(() => {
    if (!open) return;
    const visibleProducts = filteredProducts;
    if (!visibleProducts.length) {
      setSelectedProductId("");
      return;
    }
    const selectedExists = visibleProducts.some((product) => String(product.product_id || product.id || "") === String(selectedProductId || ""));
    if (!selectedProductId || !selectedExists) {
      setSelectedProductId(String(visibleProducts[0].product_id || visibleProducts[0].id || ""));
    }
  }, [filteredProducts, open, selectedProductId]);

  const selectedProduct = useMemo(() => {
    if (!filteredProducts.length) return null;
    const selected = filteredProducts.find((product) => String(product.product_id || product.id || "") === String(selectedProductId || ""));
    return selected || filteredProducts[0] || null;
  }, [filteredProducts, selectedProductId]);

  useEffect(() => {
    if (!selectedProduct) return;
    const colors = productColors(selectedProduct);
    const initialColor = colors.includes(selectedColor) ? selectedColor : colors[0] || "";
    if (initialColor !== selectedColor) setSelectedColor(initialColor);
    const sizes = productSizes(selectedProduct, initialColor);
    const initialSize = sizes.includes(selectedSize) ? selectedSize : sizes[0] || "";
    if (initialSize !== selectedSize) setSelectedSize(initialSize);
    if (!colors.length && selectedColor) setSelectedColor("");
    if (!sizes.length && selectedSize) setSelectedSize("");
  }, [selectedProduct, selectedColor, selectedSize]);

  const activeVariant = useMemo(() => findMatchingVariant(selectedProduct || {}, selectedColor, selectedSize), [selectedColor, selectedProduct, selectedSize]);
  const activeCard = useMemo(() => (selectedProduct ? buildProductCardPayload(selectedProduct, activeVariant) : null), [activeVariant, selectedProduct]);
  const activeImage = productImage(selectedProduct || {}, activeVariant);
  const activeColors = useMemo(() => productColors(selectedProduct || {}), [selectedProduct]);
  const activeSizes = useMemo(() => productSizes(selectedProduct || {}, selectedColor), [selectedColor, selectedProduct]);
  const activePrice = Number(activeCard?.price || 0);

  const submitSelection = useCallback(async () => {
    if (!activeCard || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.([activeCard]);
    } catch (err) {
      setError(err?.message || "تعذر إرسال المنتج");
    } finally {
      setSubmitting(false);
    }
  }, [activeCard, onSubmit, submitting]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        className="flex max-h-[94vh] w-full max-w-6xl min-w-0 flex-col overflow-hidden rounded-[1.35rem] border border-white/10 bg-slate-950 shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-product-card-picker-title"
        dir="rtl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">AI INBOX</div>
            <h3 id="ai-product-card-picker-title" className="mt-1 text-lg font-black text-white">إرسال منتج</h3>
            <p className="mt-1 text-xs font-semibold text-zinc-500">ابحث بالاسم أو الباركود، ثم اختر اللون والمقاس قبل الإرسال.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <label className="relative min-w-0">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث باسم المنتج أو الباركود"
                className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/70 pl-3 pr-9 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
              />
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Brand</span>
                <select value={brand} onChange={(event) => setBrand(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-black text-white outline-none">
                  <option value="all">الكل</option>
                  {brandOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-black text-white outline-none">
                  <option value="all">الكل</option>
                  {categoryOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {loading ? (
                <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500">
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  جاري تحميل كتالوج المنتجات...
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{error}</div>
              ) : filteredProducts.length ? (
                <div className="grid gap-2">
                  {filteredProducts.slice(0, 80).map((product) => {
                    const isActive = String(product.product_id || product.id || "") === String(selectedProduct?.product_id || selectedProduct?.id || "");
                    const previewVariant = findMatchingVariant(product, isActive ? selectedColor : "", isActive ? selectedSize : "") || asArray(product.variants)[0] || null;
                    const previewImage = productImage(product, previewVariant);
                    const previewPrice = Number(previewVariant?.price ?? product.final_price ?? product.price ?? 0);
                    const previewColors = productColors(product).slice(0, 3);
                    const previewSizes = productSizes(product, previewColors[0] || "").slice(0, 3);
                    return (
                      <button
                        key={`${product.product_id || product.id}`}
                        type="button"
                        onClick={() => setSelectedProductId(String(product.product_id || product.id || ""))}
                        className={`flex items-start gap-3 rounded-2xl border p-2.5 text-right transition ${
                          isActive ? "border-cyan-300/40 bg-cyan-300/10" : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-white/[0.04]"
                        }`}
                      >
                        {previewImage ? (
                          <img src={previewImage} alt={product.name || "منتج"} className="h-16 w-16 shrink-0 rounded-xl object-cover" loading="lazy" />
                        ) : (
                          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-slate-500">
                            <ShoppingBag className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-white">{product.name || product.product_name || "منتج"}</div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-400">
                                {product.brand || product.brand_name ? <span>{product.brand || product.brand_name}</span> : null}
                                {product.category || product.category_name ? <span>{product.category || product.category_name}</span> : null}
                              </div>
                            </div>
                            {isActive ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-200" /> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                            {Number.isFinite(previewPrice) && previewPrice > 0 ? <span className="font-black text-emerald-100">{money(previewPrice)}</span> : null}
                            {productBarcode(product) ? <span>باركود: {productBarcode(product)}</span> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {previewColors.map((item) => (
                              <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-slate-300">{item}</span>
                            ))}
                            {previewSizes.map((item) => (
                              <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-slate-300">{item}</span>
                            ))}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500">
                  لا توجد منتجات مطابقة للبحث الحالي
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.035] p-3">
            {selectedProduct ? (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
                  {activeImage ? (
                    <img src={activeImage} alt={selectedProduct.name || "منتج"} className="aspect-[16/10] w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid aspect-[16/10] w-full place-items-center bg-white/[0.05]">
                      <ShoppingBag className="h-12 w-12 text-slate-500" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Selected product</div>
                    <div className="mt-1 text-lg font-black text-white">{selectedProduct.name || selectedProduct.product_name || "منتج"}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-400">
                      {selectedProduct.brand || selectedProduct.brand_name ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{selectedProduct.brand || selectedProduct.brand_name}</span> : null}
                      {selectedProduct.category || selectedProduct.category_name ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{selectedProduct.category || selectedProduct.category_name}</span> : null}
                      {productBarcode(selectedProduct) ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">باركود: {productBarcode(selectedProduct)}</span> : null}
                    </div>
                    {activePrice > 0 ? <div className="mt-2 text-base font-black text-emerald-100">{money(activePrice)}</div> : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-sm font-black text-white">اللون</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeColors.length ? (
                      activeColors.map((color) => {
                        const active = lower(selectedColor) === lower(color);
                        return (
                          <button
                            key={color}
                            type="button"
                            onClick={() => {
                              setSelectedColor(color);
                              const nextSizes = productSizes(selectedProduct, color);
                              if (nextSizes.length) {
                                setSelectedSize((current) => (nextSizes.some((item) => lower(item) === lower(current)) ? current : nextSizes[0]));
                              } else {
                                setSelectedSize("");
                              }
                            }}
                            className={`min-h-10 rounded-full border px-4 py-2 text-sm font-black transition ${
                              active ? "border-cyan-300/30 bg-cyan-300 text-slate-950" : "border-white/10 bg-black/30 text-white hover:bg-white/[0.08]"
                            }`}
                          >
                            {color}
                          </button>
                        );
                      })
                    ) : (
                      <span className="text-sm font-semibold text-slate-500">لا يوجد لون محدد</span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-white">المقاس</div>
                    <div className="text-[11px] font-bold text-slate-500">المقاسات المتاحة فقط</div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {activeSizes.length ? (
                      activeSizes.map((size) => {
                        const active = lower(selectedSize) === lower(size);
                        return (
                          <button
                            key={size}
                            type="button"
                            onClick={() => setSelectedSize(size)}
                            className={`min-h-12 rounded-2xl border px-3 py-2 text-right transition ${
                              active ? "border-cyan-300/30 bg-cyan-300 text-slate-950" : "border-white/10 bg-black/30 text-white hover:bg-white/[0.08]"
                            }`}
                          >
                            <div className="text-xl font-black leading-none">{size}</div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="col-span-full text-sm font-semibold text-slate-500">لا توجد مقاسات متاحة لهذا اللون</div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={submitSelection}
                  disabled={!activeCard || submitting}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  إرسال المنتج
                </button>

                {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
              </div>
            ) : (
              <div className="grid min-h-[24rem] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500">
                اختر منتجًا لعرض اللون والمقاس
              </div>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}
