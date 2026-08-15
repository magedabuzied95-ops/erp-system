import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertTriangle,
  Box,
  PackageSearch,
  Pencil,
  Star,
} from "lucide-react";

import { formatCurrency } from "../lib/posUtils";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import { VirtualGrid } from "../../../shared/components/VirtualList";
import { hasPermission } from "../../permissions/lib/rbacStore";

const failedProductImageUrls = new Set();

// The grid renders dozens of cards at once and the permission read walks the
// role catalog, so resolve it once per signed-in user instead of per card.
let productEditAccess = { key: undefined, value: false };

const canEditCatalogProducts = () => {
  const key = typeof localStorage === "undefined" ? null : localStorage.getItem("user");
  if (productEditAccess.key !== key) {
    productEditAccess = { key, value: hasPermission("products.edit") };
  }
  return productEditAccess.value;
};

const getProductEditId = (product = {}) => {
  const id = product.product_id ?? product.id;
  const value = String(id ?? "").trim();
  return value && value !== "undefined" && value !== "null" ? value : "";
};

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

const uniqueTextValues = (values = [], limit = 3) => {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
};

const getSharedArticleCode = (product = {}) => {
  const productArticleCode = String(product.article_code || product.articleCode || "").trim();
  if (productArticleCode) return productArticleCode;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const articleCodes = [...new Set(
    variants
      .map((variant) => String(variant.article_code || variant.articleCode || "").trim())
      .filter(Boolean)
  )];
  return articleCodes.length === 1 ? articleCodes[0] : "";
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

  const isDesktop = width >= 1024;
  const columns =
    width < 380
      ? 1
      : width < 640
        ? 2
        : width >= 1536
          ? Math.max(2, Math.floor(width / 170))
          : Math.max(2, Math.floor(width / 156));

  return { columns, isDesktop };
}

function ProductGrid({
  loading,
  error,
  products,
  search,
  onSelectProduct,
  onToggleFavorite,
}) {
  const { t } = useTranslation();
  const renderCountRef = useRef(0);
  const { columns, isDesktop } = useProductGridColumns();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    renderCountRef.current += 1;
    console.log("[pos-render] ProductArea", {
      render: renderCountRef.current,
      product_count: Array.isArray(products) ? products.length : 0,
      loading: Boolean(loading),
    });
  });
  if (loading) {
    if (!isDesktop) {
      return (
        <div className="grid grid-cols-1 gap-2 max-[380px]:grid-cols-1 min-[381px]:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-[0_8px_20px_rgba(0,0,0,0.22)]">
              <div className="m-1.5 h-36 animate-pulse rounded-xl bg-white/10" />
              <div className="space-y-2 p-2 pt-1">
                <div className="h-3 w-3/4 animate-pulse rounded-full bg-white/10" />
                <div className="h-8 animate-pulse rounded-xl bg-white/10" />
              </div>
            </div>
          ))}
        </div>
      );
    }

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
      <div className="flex h-56 items-center justify-center rounded-3xl border border-red-500/20 bg-red-500/5 p-5 text-center lg:h-[28rem] lg:p-8">
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
      <div className="flex h-56 items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 text-center lg:h-[28rem] lg:p-8">
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
    <PosProductCard
      key={key}
      product={product}
      onSelectProduct={onSelectProduct}
      onToggleFavorite={onToggleFavorite}
    />
  );

  if (products.length > 36 && isDesktop) {
    return (
      <VirtualGrid
        items={products}
        columns={columns}
        estimateRowHeight={206}
        className="h-full min-h-0 overflow-auto pr-1 [-webkit-overflow-scrolling:touch]"
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

export const PosProductCard = memo(function PosProductCard({ product, onSelectProduct, onToggleFavorite }) {
  const { t } = useTranslation();
  const [favoritePending, setFavoritePending] = useState(false);
  const stock = getProductStock(product);
  const isOutOfStock = stock <= 0;
  const cover = product?.employee_exact_variant_image
    ? product.image_url || product.variant_image_url || product.product_image_url || ""
    : product.image_url || product.variant_image_url || product.product_image_url || product.variants?.[0]?.image_url || "";
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
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const colors = product?.employee_card_size ? [] : uniqueTextValues(variants.map((variant) => variant.color), 3);
  const sizes = product?.employee_card_size ? [] : uniqueTextValues(variants.map((variant) => variant.size), 4);
  const articleCode = getSharedArticleCode(product);
  const isFavorite = product?.is_pos_favorite === true || product?.isPosFavorite === true;
  const editId = getProductEditId(product);
  const canEditProduct = Boolean(editId) && canEditCatalogProducts();
  const canToggleFavorite = Boolean(onToggleFavorite) && canEditProduct;
  const stopCardActivation = useCallback((event) => {
    event.stopPropagation();
  }, []);
  const handleToggleFavorite = useCallback(async (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (favoritePending) return;
    setFavoritePending(true);
    try {
      await onToggleFavorite?.(product);
    } finally {
      setFavoritePending(false);
    }
  }, [favoritePending, onToggleFavorite, product]);
  const isEmployeeScopedVariant = Boolean(product?.employee_card_color || product?.employee_card_size);
  const employeeFilteredSizes = uniqueTextValues(
    Array.isArray(product?.employee_card_sizes) && product.employee_card_sizes.length
      ? product.employee_card_sizes
      : [product?.employee_card_size],
    6
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      style={{ contentVisibility: "auto", containIntrinsicSize: "144px 222px" }}
      className="pos-product-card group relative flex min-h-[12.75rem] touch-manipulation flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-start shadow-[0_8px_20px_rgba(0,0,0,0.28)] transition duration-150 active:scale-[0.99] hover:border-white/20 lg:min-h-0 lg:duration-200 lg:hover:-translate-y-0.5"
    >
      <div className="relative p-1.5 pb-0">
        <div className="pos-product-card-image relative h-36 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-300 max-[380px]:h-40 sm:h-32 lg:h-28">
          {(isFavorite || canEditProduct) ? (
            <div className="absolute left-1.5 top-1.5 z-10 flex flex-col items-start gap-1">
              {canToggleFavorite ? (
                <button
                  type="button"
                  onClick={handleToggleFavorite}
                  onKeyDown={stopCardActivation}
                  onPointerDown={stopCardActivation}
                  disabled={favoritePending}
                  aria-pressed={isFavorite}
                  className={`pos-product-favorite flex h-7 w-7 items-center justify-center rounded-full border shadow-md backdrop-blur transition disabled:opacity-60 ${
                    isFavorite
                      ? "border-amber-200/60 bg-zinc-950/90 text-amber-300"
                      : "pos-product-favorite-off border-white/25 bg-zinc-950/70 text-zinc-400 hover:border-amber-200/60 hover:text-amber-300"
                  }`}
                  title={isFavorite ? t("pos.productGrid.removeFavorite") : t("pos.productGrid.addFavorite")}
                  aria-label={isFavorite ? t("pos.productGrid.removeFavorite") : t("pos.productGrid.addFavorite")}
                >
                  <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
                </button>
              ) : isFavorite ? (
                <div
                  className="pos-product-favorite flex h-7 w-7 items-center justify-center rounded-full border border-amber-200/60 bg-zinc-950/90 text-amber-300 shadow-md backdrop-blur"
                  title={t("pos.productGrid.favorite")}
                  aria-label={t("pos.productGrid.favorite")}
                >
                  <Star className="h-3.5 w-3.5 fill-current" />
                </div>
              ) : null}
              {canEditProduct ? (
                <a
                  href={`/products/${editId}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={stopCardActivation}
                  onKeyDown={stopCardActivation}
                  onPointerDown={stopCardActivation}
                  className="pos-product-edit flex h-6 w-6 items-center justify-center rounded-full border border-sky-200/50 bg-zinc-950/90 text-sky-200 shadow-md backdrop-blur transition hover:border-sky-200 hover:text-white"
                  title={t("pos.productGrid.editProduct")}
                  aria-label={t("pos.productGrid.editProduct")}
                >
                  <Pencil className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          ) : null}
          {cover ? (
          <ProductImage
            src={cover}
            fallbackSrc={product?.employee_exact_variant_image ? "" : product.product_image_url}
            alt={product.name}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-200 via-zinc-100 to-zinc-300">
            <Box className="h-10 w-10 text-zinc-400" />
          </div>
        )}

          <div
            className="pos-product-stock absolute right-1.5 top-1.5 rounded-full border border-white/40 bg-zinc-950/80 px-1.5 py-0.5 text-[8px] font-black text-emerald-100 shadow-sm backdrop-blur"
            title={isOutOfStock ? t("pos.labels.outOfStock") : t("pos.labels.inStock", { count: stock })}
          >
            <span className="inline-flex items-center gap-0.5">
              {employeeFilteredSizes.length ? (
                <span dir="ltr" className="text-amber-100">{employeeFilteredSizes.join(" / ")}</span>
              ) : (
                <>
                  <Box className="h-2.5 w-2.5 text-emerald-500" />
                  {/* The count alone keeps the badge off the product photo; the
                      wording stays in the tooltip and for screen readers. */}
                  <span className="sr-only">
                    {isOutOfStock ? t("pos.labels.outOfStock") : t("pos.labels.inStock", { count: stock })}
                  </span>
                  <span aria-hidden="true" dir="ltr">
                    {isOutOfStock ? t("pos.labels.outOfStock") : stock}
                  </span>
                </>
              )}
            </span>
          </div>
          {articleCode ? (
            <div className="absolute inset-x-2 bottom-2 flex justify-center">
              <div className="pos-product-article inline-flex max-w-[calc(100%-12px)] items-center justify-center rounded-full border border-white/10 bg-black/70 px-2 py-1 text-[10px] font-black leading-none text-zinc-200 shadow-sm backdrop-blur-sm">
                <span className="min-w-0 max-w-full truncate">
                  {articleCode}
                </span>
              </div>
            </div>
          ) : null}
        </div>

      </div>

      <div className="pos-product-card-body flex flex-1 flex-col gap-1 p-1.5 pt-1 sm:p-2 sm:pt-1.5 lg:gap-0.5">
        <h3 className="pos-product-title min-w-0 text-center text-[0.7rem] font-semibold leading-tight text-zinc-100 sm:text-[0.76rem]">
          <span className="line-clamp-2 min-h-[1.8rem] sm:min-h-[1.7rem]">{product.name}</span>
        </h3>

        {(colors.length || sizes.length) ? (
          <div className={`flex min-h-5 flex-wrap justify-center gap-1 overflow-hidden ${isEmployeeScopedVariant ? "" : "lg:hidden"}`}>
            {colors.slice(0, 2).map((color) => (
              <span key={`color-${color}`} className="pos-product-meta max-w-[4.5rem] truncate rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[8px] font-black text-zinc-300">
                {color}
              </span>
            ))}
            {sizes.slice(0, 2).map((size) => (
              <span key={`size-${size}`} className="pos-product-meta pos-product-size rounded-full border border-emerald-300/15 bg-emerald-400/10 px-1.5 py-0.5 text-[8px] font-black text-emerald-100">
                {size}
              </span>
            ))}
          </div>
        ) : null}

        <div className={`pos-product-price mt-auto rounded-xl border px-2 py-1.5 text-center shadow-sm ${ hasPrice ? "border-emerald-300/20 bg-emerald-950/20" : "border-amber-300/30 bg-amber-500/10" }`}>
          <div className={`pos-product-price-label truncate text-[8px] font-black uppercase tracking-[0.12em] ${hasPrice ? "text-emerald-200/80" : "text-amber-200"}`}>
            {saleBadge || t("pos.productGrid.price")}
          </div>
          {originalPrice ? <div className="pos-product-original-price text-[9px] font-bold leading-tight text-zinc-400 line-through decoration-zinc-300/70">{originalPrice}</div> : null}
          <div className={`pos-product-price-value truncate text-[0.82rem] font-black leading-tight sm:text-[0.86rem] ${hasPrice ? "text-white" : "text-amber-100"}`}>
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
      className="h-full w-full object-contain p-1 transition duration-300 group-hover:scale-[1.03]"
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

export default memo(ProductGrid);
