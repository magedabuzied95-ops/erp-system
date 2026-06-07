import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Box,
  PackageSearch,
} from "lucide-react";

import { formatCurrency } from "../lib/posUtils";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { VirtualGrid } from "../../../shared/components/VirtualList";

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

const formatProductPrice = (product, t) => {
  const min = Number(product.min_price ?? product.base_price ?? product.sale_price ?? product.price ?? 0);
  const max = Number(product.max_price ?? min);
  if (!(min > 0) && !(max > 0)) return t("pos.labels.priceRequired", "Price required");
  return max > min ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(min);
};

const formatOriginalPrice = (product) => {
  const min = Number(product.min_regular_price ?? product.original_price ?? product.regular_price ?? 0);
  const max = Number(product.max_regular_price ?? min);
  if (!(min > 0) || min <= Number(product.min_price ?? product.price ?? 0)) return "";
  return max > min ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(min);
};

function useProductGridColumns() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  if (width < 380) return 1;
  if (width < 640) return 2;
  if (width >= 1536) return Math.max(2, Math.floor(width / 170));
  return Math.max(2, Math.floor(width / 156));
}

function ProductGrid({
  loading,
  error,
  products,
  search,
  onSelectProduct,
}) {
  const { t } = useTranslation();
  const columns = useProductGridColumns();
  if (loading) {
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[var(--primary-soft)] border-t-[var(--primary)]" />
          <p className="mt-4 text-sm text-[var(--muted)]">{t("pos.productGrid.loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[28rem] items-center justify-center rounded-3xl border border-red-500/20 bg-red-500/5 p-8 text-center">
        <div>
          <AlertTriangle className="mx-auto h-10 w-10 text-red-300" />
          <h3 className="mt-4 text-lg font-bold text-[var(--text)]">{t("pos.productGrid.feedUnavailable")}</h3>
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
            {hasSearch ? t("pos.productGrid.noMatching") : t("pos.productGrid.noSellable")}
          </h3>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {hasSearch
              ? t("pos.productGrid.tryDifferentSearch")
              : t("pos.productGrid.emptyFeed")}
          </p>
        </div>
      </div>
    );
  }

  const renderProduct = (product, _index, key) => (
    <ProductCard
      key={key}
      product={product}
      onSelectProduct={onSelectProduct}
    />
  );

  if (products.length > 36) {
    return (
      <VirtualGrid
        items={products}
        columns={columns}
        estimateRowHeight={196}
        className="h-[calc(100dvh-18rem)] min-h-[30rem] overflow-auto pr-1 [-webkit-overflow-scrolling:touch]"
        gridClassName="grid grid-cols-1 gap-2 max-[380px]:grid-cols-1 min-[381px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))] sm:gap-2.5 2xl:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
        itemKey={(product) => String(product.product_id || product.id)}
        renderItem={renderProduct}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 max-[380px]:grid-cols-1 min-[381px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))] sm:gap-2.5 2xl:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
      {products.map((product, index) => renderProduct(product, index, String(product.product_id || product.id)))}
    </div>
  );
}

const ProductCard = memo(function ProductCard({ product, onSelectProduct }) {
  const { t } = useTranslation();
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
  const originalPrice = formatOriginalPrice(product);
  const saleBadge = product.sale_badge || (product.sale_source === "global" ? t("pos.productGrid.globalSale") : product.sale_source === "product" ? t("pos.productGrid.sale") : "");
  const hasPrice = Number(product.min_price ?? product.base_price ?? product.sale_price ?? product.price ?? 0) > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      style={{ contentVisibility: "auto", containIntrinsicSize: "132px 172px" }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-start shadow-[0_8px_20px_rgba(0,0,0,0.28)] transition duration-200 hover:-translate-y-0.5 hover:border-white/20"
    >
      <div className="relative p-1.5 pb-0">
        <div className="relative h-24 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-300 max-[380px]:h-28 sm:h-24">
        {cover ? (
          <ProductImage
            src={cover}
            fallbackSrc={product.product_image_url}
            alt={product.name}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-300">
            <Box className="h-10 w-10 text-zinc-400" />
          </div>
        )}

          <div className="absolute end-1.5 top-1.5 rounded-full border border-white/40 bg-zinc-950/80 px-1.5 py-0.5 text-[8px] font-black text-emerald-100 shadow-sm backdrop-blur">
            <span className="inline-flex items-center gap-0.5">
              <Box className="h-2.5 w-2.5 text-emerald-500" />
              {isOutOfStock ? t("pos.labels.outOfStock") : t("pos.labels.inStock", { count: stock })}
            </span>
          </div>
        </div>

      </div>

      <div className="flex flex-1 flex-col gap-1 p-1.5 pt-1.5 sm:p-2">
        <h3 className="min-w-0 text-center text-[0.72rem] font-semibold leading-tight text-zinc-100 sm:text-[0.76rem]">
          <span className="line-clamp-2 min-h-[2rem] sm:min-h-[1.9rem]">{product.name}</span>
        </h3>

        <div className={`mt-auto rounded-xl border px-2 py-1.5 text-center shadow-sm ${
          hasPrice ? "border-violet-500/20 bg-black/55" : "border-amber-300/30 bg-amber-500/10"
        }`}>
          <div className={`truncate text-[8px] font-black uppercase tracking-[0.12em] ${hasPrice ? "text-violet-300" : "text-amber-200"}`}>
            {saleBadge || t("pos.productGrid.price")}
          </div>
          {originalPrice ? <div className="text-[9px] font-bold leading-tight text-zinc-400 line-through decoration-zinc-300/70">{originalPrice}</div> : null}
          <div className={`truncate text-[0.82rem] font-black leading-tight sm:text-[0.86rem] ${hasPrice ? "text-white" : "text-amber-100"}`}>
            {formatProductPrice(product, t)}
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
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-300">
        <Box className="h-10 w-10 text-zinc-400" />
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      loading="lazy"
      decoding="async"
      width="320"
      height="240"
      className="h-full w-full object-contain p-1.5 transition duration-300 group-hover:scale-[1.03]"
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
