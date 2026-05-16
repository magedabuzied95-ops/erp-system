import { memo, useCallback, useEffect, useMemo, useState } from "react";

import {
  AlertTriangle,
  Box,
  PackageSearch,
  Plus,
} from "lucide-react";

import { formatCurrency } from "../lib/posUtils";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const failedProductImageUrls = new Set();

const getVariantStock = (variant = {}) =>
  Number(
    variant.stock ??
      variant.quantity ??
      variant.qty ??
      variant.available_quantity ??
      variant.inventory_quantity ??
      variant.current_stock ??
      0
  );

const getProductStock = (product = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];

  if (variants.length > 0) {
    const variantStock = variants.reduce((sum, variant) => sum + getVariantStock(variant), 0);
    if (variantStock > 0) return variantStock;
  }

  return Number(
    product.total_stock ??
      product.stock ??
      product.quantity ??
      product.qty ??
      product.available_quantity ??
      product.inventory_quantity ??
      product.current_stock ??
      0
  );
};

const formatProductPrice = (product) => {
  const min = Number(product.min_price ?? product.base_price ?? product.sale_price ?? product.price ?? 0);
  const max = Number(product.max_price ?? min);
  return max > min ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(min);
};

function ProductGrid({
  loading,
  error,
  products,
  search,
  onSelectProduct,
  onQuickAdd,
}) {
  if (loading) {
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[var(--primary-soft)] border-t-[var(--primary)]" />
          <p className="mt-4 text-sm text-[var(--muted)]">Loading products...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-3xl border border-red-500/20 bg-red-500/5 p-8 text-center">
        <div>
          <AlertTriangle className="mx-auto h-10 w-10 text-red-300" />
          <h3 className="mt-4 text-lg font-bold text-[var(--text)]">Product feed unavailable</h3>
          <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!products.length) {
    const hasSearch = Boolean(String(search || "").trim());
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <div>
          <PackageSearch className="mx-auto h-12 w-12 text-[var(--muted)]" />
          <h3 className="mt-4 text-xl font-black text-[var(--text)]">
            {hasSearch ? "No matching products" : "No sellable products found"}
          </h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {hasSearch
              ? "Try a different search, SKU, barcode, color, size, category, brand, or manufacturer."
              : "The product feed loaded, but it did not return any sellable rows."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {products.map((product) => (
        <ProductCard
          key={String(product.product_id || product.id)}
          product={product}
          onSelectProduct={onSelectProduct}
          onQuickAdd={onQuickAdd}
        />
      ))}
    </div>
  );
}

const ProductCard = memo(function ProductCard({ product, onSelectProduct, onQuickAdd }) {
  const stock = getProductStock(product);
  const isOutOfStock = stock <= 0;
  const cover =
    product.image_url ||
    product.variant_image_url ||
    product.product_image_url ||
    product.variants?.[0]?.image_url ||
    "";
  const handleSelect = useCallback(() => {
    onSelectProduct(product);
  }, [onSelectProduct, product]);
  const handleKeyDown = useCallback((event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectProduct(product);
    }
  }, [onSelectProduct, product]);
  const handleQuickAdd = useCallback((event) => {
    event.stopPropagation();
    onQuickAdd(product);
  }, [onQuickAdd, product]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className="group relative flex flex-col overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-left shadow-[0_24px_60px_rgba(0,0,0,0.45)] transition duration-300 hover:-translate-y-1 hover:border-white/20"
    >
      <div className="relative p-4 pb-0">
        <div className="relative h-60 overflow-hidden rounded-[28px] border border-white/70 bg-[#f8f8f8]">
        {cover ? (
          <ProductImage
            src={cover}
            fallbackSrc={product.product_image_url}
            alt={product.name}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[#f8f8f8]">
            <Box className="h-14 w-14 text-zinc-400" />
          </div>
        )}

          <div className="absolute right-3 top-3 rounded-full border border-white/80 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-emerald-600 shadow-sm">
            <span className="inline-flex items-center gap-1.5">
              <Box className="h-3.5 w-3.5 text-emerald-500" />
              {isOutOfStock ? "Out of stock" : `${stock} in stock`}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleQuickAdd}
          disabled={isOutOfStock}
          className="absolute right-7 top-7 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white opacity-0 shadow-lg backdrop-blur transition duration-200 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={isOutOfStock ? "Out of stock" : "Quick add"}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5 pt-4">
        <div className="flex items-start justify-between gap-4">
          <h3 className="min-w-0 flex-1 text-[1.08rem] font-semibold leading-tight text-white">
            <span className="block truncate">{product.name}</span>
          </h3>

          <div className="shrink-0 rounded-2xl border border-violet-500/25 bg-black/70 px-4 py-3 text-right shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-violet-300">
              SALE
            </div>
            <div className="mt-1 text-base font-bold text-white">
              {formatProductPrice(product)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.product === next.product);

function ProductImage({ src, fallbackSrc, alt }) {
  const resolvedSrc = useMemo(() => resolveProductImageUrl(src), [src]);
  const resolvedFallbackSrc = useMemo(() => resolveProductImageUrl(fallbackSrc), [fallbackSrc]);
  const initialSrc = failedProductImageUrls.has(resolvedSrc) ? "" : resolvedSrc;
  const [currentSrc, setCurrentSrc] = useState(initialSrc);
  const [failed, setFailed] = useState(!initialSrc && Boolean(resolvedSrc));

  useEffect(() => {
    const nextSrc = failedProductImageUrls.has(resolvedSrc) ? "" : resolvedSrc;
    setCurrentSrc(nextSrc);
    setFailed(!nextSrc && Boolean(resolvedSrc));
  }, [resolvedSrc]);

  if (!currentSrc || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#f8f8f8]">
        <Box className="h-14 w-14 text-zinc-400" />
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      loading="lazy"
      className="h-full w-full object-contain p-5 transition duration-500 group-hover:scale-[1.03]"
      onError={() => {
        failedProductImageUrls.add(currentSrc);
        if (resolvedFallbackSrc && resolvedFallbackSrc !== currentSrc) {
          if (failedProductImageUrls.has(resolvedFallbackSrc)) {
            setFailed(true);
          } else {
            setCurrentSrc(resolvedFallbackSrc);
          }
          return;
        }
        setFailed(true);
      }}
    />
  );
}

export default ProductGrid;
