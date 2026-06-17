import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Loader2, Search, ShoppingBag, Square, X } from "lucide-react";

import { getPosSellableProducts } from "../../pos/services/posProductsApi";
import { formatCurrency } from "../../../shared/lib/currency";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const lower = (value = "") => clean(value).toLowerCase();
const money = (value) => formatCurrency(value);

const uniqueTextValues = (values = []) =>
  [...new Set(values.map((item) => clean(item)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));

const uniqueSizeValues = (values = []) =>
  [...new Set(values.map((item) => clean(item)).filter(Boolean))].sort((a, b) => {
    const left = Number(a);
    const right = Number(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    return a.localeCompare(b, "ar");
  });

const resolveStorefrontUrl = (product = {}, variant = null, color = "", size = "") => {
  const rawUrl = clean(product.storefront_url || product.product_url || product.url || "");
  const productId = product.product_id || product.id || "";
  const baseUrl = rawUrl || (productId
    ? (typeof window !== "undefined" && window.location?.origin
      ? (() => {
          try {
            return new URL(`/shop/product/${encodeURIComponent(productId)}`, window.location.origin).toString();
          } catch {
            return `/shop/product/${encodeURIComponent(productId)}`;
          }
        })()
      : `/shop/product/${encodeURIComponent(productId)}`)
    : "");
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl, typeof window !== "undefined" && window.location?.origin ? window.location.origin : "http://localhost");
    const variantId = clean(variant?.variant_id || variant?.id || "");
    const normalizedColor = clean(color || variant?.color || variant?.color_name || variant?.variant_color || "");
    const normalizedSize = clean(size || variant?.size || variant?.size_name || variant?.variant_size || "");
    if (variantId) url.searchParams.set("variant", variantId);
    if (normalizedColor) url.searchParams.set("color", normalizedColor);
    if (normalizedSize) url.searchParams.set("size", normalizedSize);
    return url.toString();
  } catch {
    return baseUrl;
  }
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
    if (Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0) <= 0) return false;
    if (!normalizedColor) return true;
    return lower(variant.color || variant.color_name || variant.variant_color) === normalizedColor;
  });
  return uniqueSizeValues(variants.map((variant) => variant.size || variant.size_name || variant.variant_size));
};

const findMatchingVariant = (product = {}, color = "", size = "") => {
  const variants = asArray(product.variants);
  if (!variants.length) return null;
  const normalizedColor = lower(color);
  const normalizedSize = lower(size);
  const availableVariants = variants.filter((variant) => Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0) > 0);
  const searchVariants = availableVariants.length ? availableVariants : variants;
  const exactMatch = searchVariants.find((variant) => {
    const variantColor = lower(variant.color || variant.color_name || variant.variant_color);
    const variantSize = lower(variant.size || variant.size_name || variant.variant_size);
    const colorMatches = !normalizedColor || variantColor === normalizedColor;
    const sizeMatches = !normalizedSize || variantSize === normalizedSize;
    return colorMatches && sizeMatches;
  });
  if (exactMatch) return exactMatch;
  const colorMatch = normalizedColor ? searchVariants.find((variant) => lower(variant.color || variant.color_name || variant.variant_color) === normalizedColor) : null;
  if (colorMatch) return colorMatch;
  const sizeMatch = normalizedSize ? searchVariants.find((variant) => lower(variant.size || variant.size_name || variant.variant_size) === normalizedSize) : null;
  if (sizeMatch) return sizeMatch;
  return searchVariants[0] || variants[0] || null;
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
    storefront_url: resolveStorefrontUrl(product, variant, color, size),
  };
};

const sizeModeCardKey = (product = {}, variant = {}) =>
  [
    product.product_id ?? product.id ?? "",
    variant.variant_id ?? variant.id ?? "",
    variant.color || variant.color_name || variant.variant_color || "",
    variant.size || variant.size_name || variant.variant_size || "",
  ]
    .map((value) => clean(value))
    .filter(Boolean)
    .join(":");

const productHasAvailableSize = (product = {}, size = "") => {
  const normalizedSize = lower(size);
  if (!normalizedSize) return false;
  return asArray(product.variants).some((variant) => {
    const variantSize = lower(variant.size || variant.size_name || variant.variant_size);
    const stock = Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0);
    return stock > 0 && variantSize === normalizedSize;
  });
};

const availableSizesForProducts = (products = []) =>
  uniqueSizeValues(
    asArray(products).flatMap((product) =>
      asArray(product.variants)
        .filter((variant) => Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0) > 0)
        .map((variant) => variant.size || variant.size_name || variant.variant_size)
        .filter(Boolean)
    )
  );

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

export default function ProductCardPicker({ open, onClose, onSubmit, sizeMode = false, allowMultiple = false }) {
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
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [selectedSizeCards, setSelectedSizeCards] = useState([]);
  const previousOpenRef = useRef(false);

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
        setError(err?.message || "طھط¹ط°ط± طھط­ظ…ظٹظ„ ظƒطھط§ظ„ظˆط¬ ط§ظ„ظ…ظ†طھط¬ط§طھ");
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

  const availableSizes = useMemo(() => availableSizesForProducts(filteredProducts), [filteredProducts]);
  const isSizeSelectionStep = Boolean(sizeMode && !selectedSize);
  const visibleProducts = useMemo(() => {
    if (!sizeMode || !selectedSize) return filteredProducts;
    return filteredProducts.filter((product) => productHasAvailableSize(product, selectedSize));
  }, [filteredProducts, selectedSize, sizeMode]);
  const visibleSizeCards = useMemo(() => {
    if (!sizeMode || !selectedSize) return [];
    const normalizedSize = lower(selectedSize);
    return filteredProducts.flatMap((product) =>
      asArray(product.variants)
        .filter((variant) => {
          const stock = Number(variant.stock ?? variant.stock_quantity ?? variant.available_quantity ?? variant.quantity ?? 0);
          const variantSize = lower(variant.size || variant.size_name || variant.variant_size);
          return stock > 0 && variantSize === normalizedSize;
        })
        .map((variant) => {
          const payload = buildProductCardPayload(product, variant);
          return {
            key: sizeModeCardKey(product, variant),
            product,
            variant,
            payload,
            productId: payload.product_id,
            variantId: payload.variant_id,
            productName: payload.product_name,
            color: payload.color,
            size: payload.size,
            image: payload.image_url,
            price: payload.price,
            storefrontUrl: payload.storefront_url,
          };
        })
    );
  }, [filteredProducts, selectedSize, sizeMode]);
  const visibleSizeCardKeySet = useMemo(() => new Set(visibleSizeCards.map((card) => card.key)), [visibleSizeCards]);
  const selectedSizeCardKeySet = useMemo(() => new Set(selectedSizeCards.map((card) => card.key)), [selectedSizeCards]);

  const brandOptions = useMemo(() => uniqueTextValues(products.map((product) => product.brand || product.brand_name)), [products]);
  const categoryOptions = useMemo(() => uniqueTextValues(products.map((product) => product.category || product.category_name)), [products]);

  useEffect(() => {
    const openedNow = open && !previousOpenRef.current;
    previousOpenRef.current = open;
    if (!openedNow) return;
    if (sizeMode) {
      setSelectedProductId("");
      setSelectedProductIds([]);
      setSelectedColor("");
      setSelectedSize("");
      setSelectedSizeCards([]);
      return;
    }
    if (!visibleProducts.length) {
      setSelectedProductId("");
      return;
    }
    const selectedExists = visibleProducts.some((product) => String(product.product_id || product.id || "") === String(selectedProductId || ""));
    if (!selectedProductId || !selectedExists) {
      setSelectedProductId(String(visibleProducts[0].product_id || visibleProducts[0].id || ""));
    }
  }, [open, selectedProductId, sizeMode, visibleProducts]);

  const selectedProduct = useMemo(() => {
    if (!visibleProducts.length) return null;
    if (sizeMode && !selectedProductId) return null;
    const selected = visibleProducts.find((product) => String(product.product_id || product.id || "") === String(selectedProductId || ""));
    return selected || (sizeMode ? null : visibleProducts[0] || null);
  }, [selectedProductId, sizeMode, visibleProducts]);

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
  const selectedProducts = useMemo(() => {
    if (allowMultiple && selectedProductIds.length) {
      return selectedProductIds
        .map((id) => visibleProducts.find((product) => String(product.product_id || product.id || "") === String(id)))
        .filter(Boolean);
    }
    return selectedProduct ? [selectedProduct] : [];
  }, [allowMultiple, selectedProduct, selectedProductIds, visibleProducts]);

  useEffect(() => {
    if (!open || !sizeMode) return;
    if (availableSizes.length === 1 && !selectedSize) {
      setSelectedSize(availableSizes[0]);
    }
  }, [availableSizes, open, selectedSize, sizeMode]);

  useEffect(() => {
    if (!open) return;
    setSelectedProductIds((current) => current.filter((id) => visibleProducts.some((product) => String(product.product_id || product.id || "") === String(id))));
  }, [open, visibleProducts]);

  useEffect(() => {
    if (!sizeMode || !selectedSize) return;
    setSelectedSizeCards([]);
  }, [selectedSize, sizeMode]);

  const toggleProductSelection = useCallback((product) => {
    const productId = String(product.product_id || product.id || "");
    setSelectedProductId(productId);
    if (!allowMultiple) {
      setSelectedProductIds([]);
      return;
    }
    setSelectedProductIds((current) => (
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    ));
  }, [allowMultiple]);

  const toggleSizeCardSelection = useCallback((card) => {
    setSelectedSizeCards((current) => {
      const exists = current.some((item) => item.key === card.key);
      if (exists) return current.filter((item) => item.key !== card.key);
      if (!allowMultiple) return [card];
      return [...current, card];
    });
  }, [allowMultiple]);

  const selectAllVisibleSizeCards = useCallback(() => {
    if (!visibleSizeCards.length) return;
    setSelectedSizeCards((current) => {
      const next = new Map(current.map((card) => [card.key, card]));
      visibleSizeCards.forEach((card) => {
        next.set(card.key, card);
      });
      return Array.from(next.values());
    });
  }, [visibleSizeCards]);

  const clearAllVisibleSizeCards = useCallback(() => {
    if (!visibleSizeCards.length) return;
    setSelectedSizeCards((current) => current.filter((card) => !visibleSizeCardKeySet.has(card.key)));
  }, [visibleSizeCardKeySet]);

  const submitSelection = useCallback(async () => {
    if (!activeCard || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.([activeCard]);
    } catch (err) {
      setError(err?.message || "طھط¹ط°ط± ط¥ط±ط³ط§ظ„ ط§ظ„ظ…ظ†طھط¬");
    } finally {
      setSubmitting(false);
    }
  }, [activeCard, onSubmit, submitting]);

  const submitSelectionWithSizeMode = useCallback(async () => {
    const cards = selectedSizeCards
      .map((card) => card.payload || buildProductCardPayload(card.product, card.variant))
      .filter((card) => card.product_name || card.product_id || card.storefront_url);
    const payloadCards = cards.length ? cards : [];
    if (!payloadCards.length || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.(payloadCards);
    } catch (err) {
      setError(err?.message || "ط·ع¾ط·آ¹ط·آ°ط·آ± ط·آ¥ط·آ±ط·آ³ط·آ§ط¸â€‍ ط·آ§ط¸â€‍ط¸â€¦ط¸â€ ط·ع¾ط·آ¬");
    } finally {
      setSubmitting(false);
    }
  }, [onSubmit, selectedSizeCards, submitting]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ai-product-card-picker-root fixed inset-0 z-[9999] isolate flex items-end justify-center p-2 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="fixed inset-0 z-0 bg-black/75 backdrop-blur-sm" />
      <section
        className="ai-product-card-picker-panel relative z-10 flex h-[calc(100dvh-1rem)] w-full max-w-[40rem] min-w-0 flex-col overflow-hidden rounded-t-[1.35rem] border border-white/10 bg-slate-950 shadow-[0_30px_90px_rgba(0,0,0,0.65)] sm:h-auto sm:max-h-[85vh] sm:rounded-[1.35rem]"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-product-card-picker-title"
        dir="rtl"
      >
        <div className="shrink-0 border-b border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">AI INBOX</div>
            <h3 id="ai-product-card-picker-title" className="mt-1 text-lg font-black text-white">ط¥ط±ط³ط§ظ„ ظ…ظ†طھط¬</h3>
            <p className="mt-1 text-xs font-semibold text-zinc-500">ط§ط¨ط­ط« ط¨ط§ظ„ط§ط³ظ… ط£ظˆ ط§ظ„ط¨ط§ط±ظƒظˆط¯طŒ ط«ظ… ط§ط®طھط± ط§ظ„ظ„ظˆظ† ظˆط§ظ„ظ…ظ‚ط§ط³ ظ‚ط¨ظ„ ط§ظ„ط¥ط±ط³ط§ظ„.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white"
          >
            <X className="h-4 w-4" />
          </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {isSizeSelectionStep ? (
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Size filter</div>
              <div className="mt-2 text-lg font-black text-white">ط§ط®طھط± ط§ظ„ظ…ظ‚ط§ط³ ط§ظ„ظ…طھط§ط­</div>
              <div className="mt-1 text-xs font-semibold text-slate-400">ط³ظٹطھظ… ط¥ط¸ظ‡ط§ط± ط§ظ„ظ…ظ†طھط¬ط§طھ ط§ظ„طھظٹ ظ„ط¯ظٹظ‡ط§ stock ظپط¹ظ„ظٹ ظ„ظ‡ط°ط§ ط§ظ„ظ…ظ‚ط§ط³ ظپظ‚ط·.</div>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {availableSizes.length ? availableSizes.map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setSelectedSize(size)}
                    className="min-h-12 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white transition hover:border-cyan-300/30 hover:bg-cyan-300/10"
                  >
                    {size}
                  </button>
                )) : (
                  <div className="col-span-full rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm font-semibold text-slate-500">
                    ظ„ط§ طھظˆط¬ط¯ ظ…ظ‚ط§ط³ط§طھ ظ…طھط§ط­ط© ط­ط§ظ„ظٹط§ظ‹
                  </div>
                )}
              </div>
            </div>
          </div>
          ) : (
        <div className="grid h-full min-h-0 gap-3 overflow-hidden p-3 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <label className="relative min-w-0">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ط§ط¨ط­ط« ط¨ط§ط³ظ… ط§ظ„ظ…ظ†طھط¬ ط£ظˆ ط§ظ„ط¨ط§ط±ظƒظˆط¯"
                className="h-11 w-full rounded-2xl border border-white/10 bg-slate-950/70 pl-3 pr-9 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
              />
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Brand</span>
                <select value={brand} onChange={(event) => setBrand(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-black text-white outline-none">
                  <option value="all">ط§ظ„ظƒظ„</option>
                  {brandOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-black text-white outline-none">
                  <option value="all">ط§ظ„ظƒظ„</option>
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
                  ط¬ط§ط±ظٹ طھط­ظ…ظٹظ„ ظƒطھط§ظ„ظˆط¬ ط§ظ„ظ…ظ†طھط¬ط§طھ...
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{error}</div>
              ) : sizeMode && selectedSize ? (
                visibleSizeCards.length ? (
                  <div className="grid gap-2">
                    {visibleSizeCards.slice(0, 80).map((card) => {
                      const isSelected = selectedSizeCardKeySet.has(card.key);
                      return (
                        <button
                          key={card.key}
                          type="button"
                          onClick={() => toggleSizeCardSelection(card)}
                          className={`relative flex items-start gap-3 rounded-2xl border p-2.5 text-right transition ${
                            isSelected ? "border-cyan-300/40 bg-cyan-300/10" : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-white/[0.04]"
                          }`}
                        >
                          <span className={`absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border ${isSelected ? "border-cyan-300 bg-cyan-300 text-slate-950" : "border-white/20 bg-black/40 text-white/60"}`}>
                            {isSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                          </span>
                          {card.image ? (
                            <img src={card.image} alt={card.productName || "ظ…ظ†طھط¬"} className="h-16 w-16 shrink-0 rounded-xl object-cover" loading="lazy" />
                          ) : (
                            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-slate-500">
                              <ShoppingBag className="h-5 w-5" />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-black text-white">{card.productName || "ظ…ظ†طھط¬"}</div>
                                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-400">
                                  {card.color ? <span>{card.color}</span> : null}
                                  {card.size ? <span>ط§ظ„ظ…ظ‚ط§ط³: {card.size}</span> : null}
                                </div>
                              </div>
                              {isSelected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-200" /> : null}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                              {Number.isFinite(card.price) && card.price > 0 ? <span className="font-black text-emerald-100">{money(card.price)}</span> : null}
                              {card.variantId ? <span>Variant: {card.variantId}</span> : null}
                            </div>
                            {card.storefrontUrl ? <div className="mt-2 truncate text-[10px] font-semibold text-slate-500">{card.storefrontUrl}</div> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500">
                    ظ„ط§ طھظˆط¬ط¯ ط¨ط·ط§ظ‚ط§طھ ظ…طھط§ط­ط© ظ„ظ‡ط°ط§ ط§ظ„ظ…ظ‚ط§ط³
                  </div>
                )
              ) : visibleProducts.length ? (
                <div className="grid gap-2">
                  {visibleProducts.slice(0, 80).map((product) => {
                    const isActive = String(product.product_id || product.id || "") === String(selectedProduct?.product_id || selectedProduct?.id || "");
                    const isSelected = selectedProductIds.includes(String(product.product_id || product.id || ""));
                    const previewVariant = findMatchingVariant(product, isActive ? selectedColor : "", isActive ? selectedSize : "") || asArray(product.variants)[0] || null;
                    const previewImage = productImage(product, previewVariant);
                    const previewPrice = Number(previewVariant?.price ?? product.final_price ?? product.price ?? 0);
                    const previewColors = productColors(product).slice(0, 3);
                    const previewSizes = productSizes(product, previewColors[0] || "").slice(0, 3);
                    return (
                      <button
                        key={`${product.product_id || product.id}`}
                        type="button"
                        onClick={() => toggleProductSelection(product)}
                        className={`relative flex items-start gap-3 rounded-2xl border p-2.5 text-right transition ${
                          isActive ? "border-cyan-300/40 bg-cyan-300/10" : "border-white/10 bg-slate-950/60 hover:border-white/20 hover:bg-white/[0.04]"
                        }`}
                      >
                        {allowMultiple ? (
                          <span className={`absolute left-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border ${isSelected ? "border-cyan-300 bg-cyan-300 text-slate-950" : "border-white/20 bg-black/40 text-white/60"}`}>
                            {isSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                          </span>
                        ) : null}
                        {previewImage ? (
                          <img src={previewImage} alt={product.name || "ظ…ظ†طھط¬"} className="h-16 w-16 shrink-0 rounded-xl object-cover" loading="lazy" />
                        ) : (
                          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-slate-500">
                            <ShoppingBag className="h-5 w-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-black text-white">{product.name || product.product_name || "ظ…ظ†طھط¬"}</div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-400">
                                {product.brand || product.brand_name ? <span>{product.brand || product.brand_name}</span> : null}
                                {product.category || product.category_name ? <span>{product.category || product.category_name}</span> : null}
                              </div>
                            </div>
                            {isActive ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-200" /> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                            {Number.isFinite(previewPrice) && previewPrice > 0 ? <span className="font-black text-emerald-100">{money(previewPrice)}</span> : null}
                            {productBarcode(product) ? <span>ط¨ط§ط±ظƒظˆط¯: {productBarcode(product)}</span> : null}
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
                  ظ„ط§ طھظˆط¬ط¯ ظ…ظ†طھط¬ط§طھ ظ…ط·ط§ط¨ظ‚ط© ظ„ظ„ط¨ط­ط« ط§ظ„ط­ط§ظ„ظٹ
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.035] p-3">
            {sizeMode && selectedSize ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Size mode</div>
                  <div className="mt-1 text-lg font-black text-white">ط§ظ„ظ…ظ‚ط§ط³ ط§ظ„ظ…ط®طھط§ط±: {selectedSize}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-400">ط§ط®طھط± ط§ظ„ظ…ظ†طھط¬ط§طھ ط§ظ„طھظٹ طھط±ظٹط¯ ط¥ط±ط³ط§ظ„ظ‡ط§ ظ…ظ† ط§ظ„ظ‚ط§ط¦ظ…ط©.</div>
                  <div className="mt-3 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-black text-cyan-100">
                    ط¹ط¯ط¯ ط§ظ„ظ…ظ†طھط¬ط§طھ ط§ظ„ظ…ط­ط¯ط¯ط©: {selectedSizeCards.length}
                </div>
                  </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-sm font-black text-white">ط¥ط±ط³ط§ظ„ ظ…ط­ط¯ط¯ط§طھ ط§ظ„ظ…ظ‚ط§ط³</div>
                  <div className="mt-2 text-xs font-semibold leading-6 text-slate-400">
                    ط§ظ„ظ…ظ†طھط¬ط§طھ ط§ظ„ط¸ط§ظ‡ط±ط© ظپظٹ ط§ظ„ظ‚ط§ط¦ظ…ط© ظ‡ظٹ ظپظ‚ط· ط§ظ„طھظٹ ظ„ط¯ظٹظ‡ط§ stock ظپط¹ظ„ظٹ ظ„ظ‡ط°ط§ ط§ظ„ظ…ظ‚ط§ط³. ظ„ط§ ط­ط§ط¬ط© ظ„ط§ط®طھظٹط§ط± ظ„ظˆظ† ط£ظˆ ظ…ظ‚ط§ط³ ظ„ظƒظ„ ظ…ظ†طھط¬.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={selectAllVisibleSizeCards}
                    disabled={!visibleSizeCards.length}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    طھط­ط¯ظٹط¯ ط§ظ„ظƒظ„
                  </button>
                  <button
                    type="button"
                    onClick={clearAllVisibleSizeCards}
                    disabled={!visibleSizeCards.length}
                    className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-black text-white transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ط¥ظ„ط؛ط§ط، طھط­ط¯ظٹط¯ ط§ظ„ظƒظ„
                  </button>
                </div>

                {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
              </div>
            ) : selectedProduct ? (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/70">
                  {activeImage ? (
                    <img src={activeImage} alt={selectedProduct.name || "ظ…ظ†طھط¬"} className="aspect-[16/10] w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="grid aspect-[16/10] w-full place-items-center bg-white/[0.05]">
                      <ShoppingBag className="h-12 w-12 text-slate-500" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">Selected product</div>
                    <div className="mt-1 text-lg font-black text-white">{selectedProduct.name || selectedProduct.product_name || "ظ…ظ†طھط¬"}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-400">
                      {selectedProduct.brand || selectedProduct.brand_name ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{selectedProduct.brand || selectedProduct.brand_name}</span> : null}
                      {selectedProduct.category || selectedProduct.category_name ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">{selectedProduct.category || selectedProduct.category_name}</span> : null}
                      {productBarcode(selectedProduct) ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">ط¨ط§ط±ظƒظˆط¯: {productBarcode(selectedProduct)}</span> : null}
                    </div>
                    {activePrice > 0 ? <div className="mt-2 text-base font-black text-emerald-100">{money(activePrice)}</div> : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-sm font-black text-white">ط§ظ„ظ„ظˆظ†</div>
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
                      <span className="text-sm font-semibold text-slate-500">ظ„ط§ ظٹظˆط¬ط¯ ظ„ظˆظ† ظ…ط­ط¯ط¯</span>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-black text-white">ط§ظ„ظ…ظ‚ط§ط³</div>
                    <div className="text-[11px] font-bold text-slate-500">ط§ظ„ظ…ظ‚ط§ط³ط§طھ ط§ظ„ظ…طھط§ط­ط© ظپظ‚ط·</div>
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
                      <div className="col-span-full text-sm font-semibold text-slate-500">ظ„ط§ طھظˆط¬ط¯ ظ…ظ‚ط§ط³ط§طھ ظ…طھط§ط­ط© ظ„ظ‡ط°ط§ ط§ظ„ظ„ظˆظ†</div>
                    )}
                  </div>
                </div>

                {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}
              </div>
            ) : (
              <div className="grid min-h-[24rem] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-sm font-bold text-slate-500">
                ط§ط®طھط± ظ…ظ†طھط¬ظ‹ط§ ظ„ط¹ط±ط¶ ط§ظ„ظ„ظˆظ† ظˆط§ظ„ظ…ظ‚ط§ط³
              </div>
            )}
          </div>
        </div>
          )}
        </div>
        <div className="shrink-0 border-t border-white/10 bg-slate-950/95 px-4 py-3 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs font-semibold text-slate-500">
              {sizeMode && !selectedSize
                ? "ط§ط®طھط± ظ…ظ‚ط§ط³ظ‹ط§ ظ„ظ„ظ…طھط§ط¨ط¹ط©"
                : sizeMode
                  ? `${selectedSizeCards.length} ظ…ظ†طھط¬ ظ…ط­ط¯ط¯`
                  : activeCard
                    ? activeCard.product_name || "ظ…ظ†طھط¬ ظ…ط­ط¯ط¯"
                    : "ط§ط®طھط± ظ…ظ†طھط¬ظ‹ط§ ظ„ظ„ظ…طھط§ط¨ط¹ط©"}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-black text-white transition hover:bg-white/[0.08]"
              >
                ط¥ط؛ظ„ط§ظ‚
              </button>
              <button
                type="button"
                onClick={sizeMode ? submitSelectionWithSizeMode : submitSelection}
                disabled={submitting || (sizeMode ? (!selectedSize || (!allowMultiple ? !activeCard : !selectedSizeCards.length)) : !activeCard)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                ط¥ط±ط³ط§ظ„ ط§ظ„ظ…ظ†طھط¬
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}


