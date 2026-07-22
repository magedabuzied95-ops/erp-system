import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import {
  EmptyState,
  LazyProductDetailsVariantSheet,
  LazyStorefrontProductGallery,
  ProductSkeleton,
  ProductGalleryFallback,
  RecentProductsSection,
  RelatedProducts,
  cleanDisplayText,
  displayImageForProduct,
  displaySellingPrice,
  fallbackProductImage,
  firstDisplayVariant,
  firstVariantImage,
  getSessionId,
  imageFor,
  isMirrorProduct,
  mirrorProductTitle,
  money,
  productFromDetailsResponse,
  productShareUrl,
  productToSocialMeta,
  sfText,
  storefrontApi,
  variantColorKey,
  variantColorName,
  variantHasStock,
  variantImage,
} from "../Storefront";
import { api } from "../../shared/api/api";
import { applyProductSocialMeta } from "../../shared/lib/socialMeta";
import { getStorefrontResponsiveImageProps } from "../../shared/lib/storefrontImage";
import { getDisplayPricing } from "../../shared/lib/storefrontPricing";
import { readStorefrontCustomerAuth, storefrontCustomerRequest } from "../lib/storefrontCustomerAuth";
import { Check, Heart, Ruler, Share2, ShoppingCart } from "lucide-react";
import { buildSizeGuidePath, resolveSizeGuideTypeForProduct } from "../lib/sizeGuide";
import { sortProductSizes } from "../../modules/products/lib/variantBulkSizes";
import { createMetaEventOnceGuard, metaCatalogContentId, trackMetaViewContent } from "../lib/metaPixelEvents";
import { buildProductColorGroups, buildSelectedColorGallery, colorSwatchImage, resolveColorGroup } from "../lib/productColorGallery";

const variantColorIdentity = (variant = {}) => {
  const safeVariant = variant && typeof variant === "object" ? variant : {};
  const image = [safeVariant.images, safeVariant.color_images, safeVariant.gallery_images]
    .flatMap((images) => Array.isArray(images) ? images : [])
    .find((candidate) => candidate && typeof candidate === "object" && (candidate.color_group_key || candidate.colorGroupKey));
  return String(
    safeVariant.color_group_key || safeVariant.colorGroupKey || safeVariant.color_id || safeVariant.colorId ||
    image?.color_group_key || image?.colorGroupKey || variantColorKey(safeVariant)
  ).trim().toLowerCase();
};

function StorefrontProductDetailSkeleton() {
  return (
    <section className="sf-product-detail-skeleton mx-auto grid max-w-7xl gap-4 px-3 pb-20 pt-3 md:px-4 md:pb-28 md:pt-5 lg:grid-cols-[minmax(0,55fr)_minmax(360px,45fr)]">
      <div className="min-w-0">
        <div className="sf-skeleton-shimmer h-[clamp(250px,42vh,340px)] w-full rounded-[24px] bg-white/80 shadow-[0_14px_40px_rgba(39,20,75,0.10)] md:h-[clamp(420px,58vh,540px)] md:rounded-[1.75rem] dark:bg-white/5" />
        <div className="mt-3 flex gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="sf-skeleton-shimmer h-12 w-12 rounded-xl bg-white/80 dark:bg-white/5 md:h-20 md:w-20 md:rounded-2xl" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <div className="overflow-hidden rounded-[1rem] border border-white/[0.08] bg-[linear-gradient(180deg,#080808_0%,#080808_100%)] p-3.5 shadow-[0_24px_70px_rgba(0,0,0,0.35)] md:rounded-[1.45rem] md:p-6">
          <div className="sf-skeleton-shimmer h-4 w-28 rounded-full bg-white/[0.08]" />
          <div className="mt-3 sf-skeleton-shimmer h-10 w-4/5 rounded-[1rem] bg-white/[0.08] md:h-14" />
          <div className="mt-3 sf-skeleton-shimmer h-5 w-1/3 rounded-full bg-white/[0.08]" />
          <div className="mt-6 flex gap-2">
            <div className="sf-skeleton-shimmer h-10 w-24 rounded-full bg-white/[0.08]" />
            <div className="sf-skeleton-shimmer h-10 w-20 rounded-full bg-white/[0.08]" />
          </div>
        </div>
        <div className="rounded-[1.1rem] border border-white/[0.08] bg-[#080808] p-3 md:rounded-[1.45rem] md:p-4">
          <div className="sf-skeleton-shimmer h-4 w-24 rounded-full bg-white/[0.08]" />
          <div className="mt-3 flex gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="sf-skeleton-shimmer h-9 w-20 rounded-full bg-white/[0.08]" />
            ))}
          </div>
        </div>
        <div className="rounded-[1.1rem] border border-white/[0.08] bg-[#080808] p-3 md:rounded-[1.45rem] md:p-4">
          <div className="sf-skeleton-shimmer h-4 w-24 rounded-full bg-white/[0.08]" />
          <div className="mt-3 flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="sf-skeleton-shimmer h-8 w-14 rounded-full bg-white/[0.08]" />
            ))}
          </div>
        </div>
        <div className="sf-skeleton-shimmer h-12 rounded-2xl bg-white/[0.08]" />
      </div>
    </section>
  );
}

function StorefrontProductDetailErrorState({ title, text, onRetry, retryLabel, backToProductsLabel }) {
  return (
    <div className="mx-auto mt-6 mb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.5rem)] max-w-xl rounded-[1.75rem] border border-rose-400/18 bg-[linear-gradient(180deg,rgba(26,10,18,0.98),rgba(11,8,16,0.96))] p-6 text-center text-stone-50 shadow-[0_18px_45px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl md:mb-6 md:p-7">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-rose-300/20 bg-rose-500/12 text-rose-200 shadow-[0_14px_34px_rgba(244,63,94,0.16)]">
        <ShoppingCart className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-2xl font-black text-stone-50">{title}</h2>
      <p className="mx-auto mt-2 max-w-md font-bold leading-7 text-stone-400">{text}</p>
      <div className="mt-5 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#d4af37]/24 bg-[linear-gradient(135deg,#d4af37,#e5c158)] px-5 py-3 text-sm font-black text-[#151515] shadow-[0_14px_34px_rgba(212,175,55,0.25)] transition hover:-translate-y-0.5 hover:border-[#f3d77a]/45 hover:shadow-[0_18px_42px_rgba(212,175,55,0.34)] active:scale-[0.98]"
        >
          {retryLabel}
        </button>
        <Link
          to="/products"
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-5 py-3 text-sm font-black text-white/80 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white active:scale-[0.98]"
        >
          {backToProductsLabel}
        </Link>
      </div>
    </div>
  );
}

function ProductDetailReviewSection() {
  const reviews = [
    { id: "quality", name: "M", text: sfText("storefront.reviews.items.quality"), badge: "جودة ممتازة" },
    { id: "size", name: "A", text: sfText("storefront.reviews.items.size"), badge: "مقاس مضبوط" },
    { id: "experience", name: "S", text: sfText("storefront.reviews.items.experience"), badge: "تجربة مريحة" },
  ];

  return (
    <section className="rounded-[1.5rem] border border-white/[0.08] bg-[linear-gradient(180deg,#090909_0%,#111111_100%)] p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.28)] md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f3d77a]">Reviews</div>
          <h2 className="mt-2 text-2xl font-black">{sfText("storefront.reviews.title")}</h2>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-sm font-black text-white/80">
          {Array.from({ length: 5 }).map((_, index) => <Star key={index} className="h-3.5 w-3.5 fill-[#f3d77a] text-[#f3d77a]" />)}
          <span className="ms-1">4.9/5</span>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {reviews.map((review) => (
          <div key={review.id} className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <div className="flex items-start justify-between gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#d4af37]/14 text-sm font-black text-[#f3d77a]">
                {review.name}
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-black text-white/65">
                {review.badge}
              </span>
            </div>
            <p className="mt-4 text-sm font-bold leading-6 text-white/85">{review.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function StorefrontProductDetailPage({ onAddToCart, toggleWishlist, wishlist, rememberProduct, recent, saleModeEnabled }) {
  const { i18n } = useTranslation();
  const isRtl = String(i18n.resolvedLanguage || i18n.language || "ar").toLowerCase().startsWith("ar");
  const { identifier } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const productRouteKey = `${location.pathname}:${identifier || ""}`;
  const [state, setState] = useState({ loading: true, product: null, error: "" });
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState({ variantId: "", size: "", colorKey: "", colorName: "", image: "" });
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [variantSheetAction, setVariantSheetAction] = useState("");
  const [touchedOptions, setTouchedOptions] = useState({ color: false, size: false });
  const recentlyViewedSentRef = useRef("");
  const metaViewSentRef = useRef(createMetaEventOnceGuard());
  const productTopRef = useRef(null);
  const mainImageRef = useRef(null);
  const initialRouteSearchRef = useRef(location.search);
  const previousProductRouteRef = useRef(productRouteKey);
  const normalizeQueryValue = (value = "") => String(value || "").trim();

  useEffect(() => {
    if (previousProductRouteRef.current === productRouteKey) return;
    previousProductRouteRef.current = productRouteKey;
    initialRouteSearchRef.current = location.search;
  }, [location.search, productRouteKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const routeValue = String(identifier || "");
    if (import.meta.env.DEV) console.log("[storefront-product] useParams identifier", { identifier: routeValue });
    try {
      sessionStorage.removeItem(`storefront.product.${routeValue}`);
      localStorage.removeItem(`storefront.product.${routeValue}`);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
    const loadProduct = async () => {
      const attempts = [
        {
          label: "resolve",
          loader: () => storefrontApi.getProductDetails(routeValue, { signal: controller.signal }),
        },
        {
          label: "direct",
          loader: () => api.get(`/storefront/products/${encodeURIComponent(routeValue)}`, { signal: controller.signal, debugLabel: "storefront-product-direct" }),
        },
      ];
      let lastError = null;
      for (const attempt of attempts) {
        try {
          const data = await attempt.loader();
          const product = productFromDetailsResponse(data);
          if (import.meta.env.DEV) console.info("[ProductDetail] extracted product", {
            attempt: attempt.label,
            keys: Object.keys(data || {}),
            extractedKeys: Object.keys(product || {}),
            extracted: product,
          });
          if (import.meta.env.DEV) console.log("[storefront-product] load attempt", {
            routeIdentifier: routeValue,
            attempt: attempt.label,
            responseStatus: data?.__status || data?.status || "",
            productIdLoaded: product?.id || null,
            success: Boolean(product),
          });
          if (!product) {
            lastError = new Error(data?.message || "empty_product_payload");
            lastError.responseBody = data;
            continue;
          }
          const productVariants = (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => variant && typeof variant === "object");
          const routeSearchParams = new URLSearchParams(initialRouteSearchRef.current || "");
          const requestedVariantId = normalizeQueryValue(routeSearchParams.get("variant") || routeSearchParams.get("variantId"));
          const requestedSize = normalizeQueryValue(routeSearchParams.get("size"));
          const requestedColor = normalizeQueryValue(routeSearchParams.get("color")).toLowerCase();
          const requestedColorId = normalizeQueryValue(routeSearchParams.get("colorId"));
          const requestedColorKey = requestedColor;
          const matchesRequestedColor = (variant) => requestedColor && (
            variantColorIdentity(variant) === requestedColorKey ||
            String(variantColorName(variant) || "").toLowerCase() === requestedColorKey
          );
          const availableVariants = productVariants.filter(variantHasStock);
          const requested =
            availableVariants.find((variant) => requestedVariantId && String(variant?.id || "") === String(requestedVariantId)) ||
            availableVariants.find((variant) => requestedVariantId && String(variant?.edition_slug || "") === String(requestedVariantId)) ||
            availableVariants.find((variant) => requestedColorId && String(variant?.color_id || "") === String(requestedColorId)) ||
            availableVariants.find((variant) => requestedSize && matchesRequestedColor(variant) && String(variant?.size || "") === requestedSize) ||
            availableVariants.find(matchesRequestedColor) ||
            productVariants.find(matchesRequestedColor) ||
            productVariants.find(
              (variant) =>
                requestedSize &&
                String(variant?.size || "") === requestedSize &&
                (!requestedColor || matchesRequestedColor(variant)) &&
                variantHasStock(variant)
            ) ||
            availableVariants.find((variant) => requestedSize && String(variant?.size || "") === requestedSize) ||
            availableVariants[0] ||
            firstDisplayVariant(productVariants) ||
            null;
          const first = requested || availableVariants[0] || firstDisplayVariant(productVariants) || null;
          if (!cancelled) {
            setState({ loading: false, product, error: "" });
            setSelected({
              variantId: first?.id || "",
              size: first?.size || "",
              colorKey: first ? variantColorIdentity(first) : "",
              colorName: first ? variantColorName(first) : "",
              image: variantImage(first) || displayImageForProduct(product, first) || product?.image_url || product?.gallery_images?.[0] || "",
            });
            setActiveImageIndex(0);
            setTouchedOptions({ color: false, size: false });
            const pricing = getDisplayPricing(product, saleModeEnabled, first || {});
            const contentId = metaCatalogContentId(product, first || {});
            const viewKey = `${productRouteKey}:${contentId}`;
            if (contentId && metaViewSentRef.current(viewKey)) {
              trackMetaViewContent({ product, variant: first || {}, value: pricing.price });
            }
            try {
              rememberProduct(product);
              const { token } = readStorefrontCustomerAuth();
              if (token) {
                const recentlyViewedKey = `${product.id}:${token}`;
                if (recentlyViewedSentRef.current !== recentlyViewedKey) {
                  recentlyViewedSentRef.current = recentlyViewedKey;
                  const payload = { product_id: product.id, session_id: getSessionId() };
                  storefrontCustomerRequest("/storefront/recently-viewed", { method: "POST", body: payload }).catch(() => undefined);
                }
              }
            } catch (sideEffectError) {
              console.warn("[storefront-product] post-load side effect skipped", sideEffectError);
            }
          }
          return;
        } catch (error) {
          lastError = error;
          if (error?.cause?.name === "AbortError" || error?.name === "AbortError") return;
          console.warn("[storefront-product] load attempt failed", {
            routeIdentifier: routeValue,
            attempt: attempt.label,
            status: error?.status || "network_error",
            message: error?.responseBody?.message || error.message || "product_load_failed",
          });
        }
      }

      if (!cancelled) {
        const message = lastError?.responseBody?.message || lastError?.message || "product_load_failed";
        setState({ loading: false, product: null, error: message });
      }
    };
    void loadProduct();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [identifier, location.pathname, productRouteKey, rememberProduct, reloadToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("scrollRestoration" in window.history) {
      const previous = window.history.scrollRestoration;
      window.history.scrollRestoration = "manual";
      return () => {
        window.history.scrollRestoration = previous;
      };
    }
    return undefined;
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const scrollTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document.scrollingElement?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
      productTopRef.current?.scrollIntoView?.({ block: "start", inline: "nearest", behavior: "auto" });
    };
    scrollTop();
    const raf = window.requestAnimationFrame(scrollTop);
    const timeout = window.setTimeout(scrollTop, 80);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [identifier, location.pathname]);

  const product = state.product;
  const variants = useMemo(
    () => (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => variant && typeof variant === "object"),
    [product]
  );
  const colorGroups = useMemo(
    () => buildProductColorGroups({ product, variants, colorKey: variantColorIdentity, colorName: variantColorName, variantHasStock }),
    [product, variants]
  );
  const selectedVariant = variants.find((item) => String(item.id) === String(selected.variantId)) || null;
  const selectedColorKey = selected.colorKey || (selectedVariant ? variantColorIdentity(selectedVariant) : "");
  const selectedColorGroup = resolveColorGroup(colorGroups, selectedColorKey);
  const variantGroup = selectedColorGroup ? variants.filter((item) => variantColorIdentity(item) === selectedColorGroup.key) : variants;
  const sizes = sortProductSizes([...new Set(variantGroup.map((variant) => variant.size).filter(Boolean))]);
  const colors = colorGroups;
  const sizeGuideHref = useMemo(
    () => buildSizeGuidePath(product ? resolveSizeGuideTypeForProduct(product) : "men"),
    [product]
  );
  const activeVariant = variants.find((item) => String(item.id) === String(selected.variantId))
    || variants.find((item) => item.size === selected.size && (!selectedColorKey || variantColorIdentity(item) === selectedColorKey) && variantHasStock(item))
    || firstDisplayVariant(variants);
  const safeActiveVariant = activeVariant || {};
  const galleryEntries = useMemo(
    () => buildSelectedColorGallery({ product, colorGroup: selectedColorGroup }),
    [product, selectedColorGroup]
  );
  useEffect(() => {
    galleryEntries.forEach((item, index) => {
      const src = item?.image || item?.url || item?.src || item;
      if (!src) return;
      const resolvedSrc = imageFor(src);
      const responsiveProps = getStorefrontResponsiveImageProps(resolvedSrc, "hero");
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = index === 0 ? "high" : "low";
      if (responsiveProps.srcSet) image.srcset = responsiveProps.srcSet;
      if (responsiveProps.sizes) image.sizes = responsiveProps.sizes;
      image.src = resolvedSrc;
    });
  }, [galleryEntries]);
  useEffect(() => {
    if (!galleryEntries.length) return;
    const targetImage =
      selected.image ||
      variantImage(safeActiveVariant) ||
      selectedColorGroup?.primaryImage?.image ||
      "";
    if (!targetImage) return;
    const nextIndex = galleryEntries.findIndex((item) => String(item?.image || "") === String(targetImage));
    if (nextIndex >= 0) setActiveImageIndex(nextIndex);
  }, [galleryEntries, safeActiveVariant, selected.image, selectedColorGroup]);
  const activeGalleryEntry = galleryEntries[activeImageIndex] || galleryEntries[0] || null;
  const activeImage = activeGalleryEntry?.image || selected.image || variantImage(safeActiveVariant) || selectedColorGroup?.primaryImage?.image || firstVariantImage(variants) || product?.image_url || "";
  const galleryItems = galleryEntries;
  const mirrorProduct = product ? isMirrorProduct(product) : false;
  const displayTitle = cleanDisplayText(product ? mirrorProductTitle(product, safeActiveVariant) || product.name : "");
  const selectedPrice = getDisplayPricing(product, saleModeEnabled, safeActiveVariant);
  const selectedSellingPrice = selectedPrice.price || displaySellingPrice(product, safeActiveVariant);
  const selectedComparePrice = selectedPrice.comparePrice || 0;
  const selectedDiscountPercent = Number(selectedPrice.discountPercent || 0) || 0;
  const descriptionText = cleanDisplayText(product?.seo_description || product?.description_ar || product?.description_en || product?.description)
    || "طھطµظ…ظٹظ… ط¹ظ…ظ„ظٹ ط¨ط®ط§ظ…ط© Premium ظ…ظ†ط§ط³ط¨ ظ„ظ„ط®ط±ظˆط¬ ط§ظ„ظٹظˆظ…ظٹ ظˆط³ظ‡ظ„ ط§ظ„طھظ†ط³ظٹظ‚ ظ…ط¹ ط³طھط§ظٹظ„ط§طھ ظ…ط®طھظ„ظپط©.";
  const inWishlist = product && wishlist.some((item) => String(item.id) === String(product.id));

  useEffect(() => {
    if (!product) return;
    document.title = mirrorProduct ? displayTitle : cleanDisplayText(product.name) || document.title;
    applyProductSocialMeta(productToSocialMeta(product));
  }, [product, mirrorProduct, displayTitle]);
  const selectVariant = (candidate, options = {}) => {
    if (!candidate) return;
    const candidateColorKey = variantColorIdentity(candidate);
    let nextVariant = candidate;
    if (options.preserveSize && selected.size) {
      const sameSize = variants.find((item) => variantColorIdentity(item) === candidateColorKey && String(item.size || "") === String(selected.size) && variantHasStock(item))
        || variants.find((item) => variantColorIdentity(item) === candidateColorKey && String(item.size || "") === String(selected.size));
      if (sameSize) nextVariant = sameSize;
    }
    const nextColorGroup = colorGroups.find((group) => group.key === candidateColorKey) || null;
    const nextImage = options.image || variantImage(nextVariant) || nextColorGroup?.primaryImage?.image || displayImageForProduct(product, nextVariant) || product?.image_url || "";
    setQty(1);
    setSelected({
      variantId: nextVariant.id || "",
      size: nextVariant.size || "",
      colorKey: variantColorIdentity(nextVariant),
      colorName: variantColorName(nextVariant),
      image: nextImage,
    });
    const nextImageIndex = galleryEntries.findIndex((item) => String(item?.image || "") === String(nextImage));
    setActiveImageIndex(nextImageIndex >= 0 ? nextImageIndex : 0);
  };
  const selectColor = (group) => {
    const colorKey = group?.key || "";
    const candidates = variants.filter((item) => variantColorIdentity(item) === colorKey);
    const candidate = candidates.find((item) => item.size === selected.size && variantHasStock(item))
      || candidates.find(variantHasStock)
      || candidates[0];
    if (!candidate) return;
    setTouchedOptions((prev) => ({ ...prev, color: true }));
    selectVariant(candidate, { preserveSize: true, image: colorSwatchImage(group, variantImage(candidate)) });
  };
  const selectSize = (size) => {
    const candidates = variants.filter((item) => String(item.size || "") === String(size) && (!selectedColorKey || variantColorIdentity(item) === selectedColorKey));
    const candidate = candidates.find(variantHasStock) || candidates[0];
    setTouchedOptions((prev) => ({ ...prev, size: true }));
    selectVariant(candidate);
  };
  const syncGallerySelection = (item, imageIndex) => {
    if (!item?.image) return;
    if (Number.isInteger(imageIndex)) setActiveImageIndex(imageIndex);
    setSelected((prev) => ({ ...prev, image: item.image || "" }));
  };
  const selectGalleryImage = (item, imageIndex) => {
    syncGallerySelection(item, imageIndex);
  };
  const selectGalleryStep = (direction = 1) => {
    if (!galleryEntries.length) return;
    const nextIndex = (activeImageIndex + direction + galleryEntries.length) % galleryEntries.length;
    const nextItem = galleryEntries[nextIndex];
    if (!nextItem) return;
    syncGallerySelection(nextItem, nextIndex);
  };
  const submitVariant = (candidate = safeActiveVariant, quantity = qty, action = "cart") => {
    if (!product || !candidate || Number(candidate.stock || 0) <= 0) return;
    const result = onAddToCart(product, candidate, quantity, {
      intent: action === "buy" ? "buy" : "cart",
      sourceEl: mainImageRef.current,
    });
    if (result === "capture_required") return;
    setVariantSheetAction("");
    if (action === "buy") navigate("/checkout");
  };
  const buyNow = () => {
    submitVariant(safeActiveVariant, qty, "buy");
  };
  const shareProduct = async () => {
    const shareVersion = Date.now();
    const url = productShareUrl(product, safeActiveVariant, shareVersion);
    const sharePayload = { url };
    try {
      if (navigator.share) {
        await navigator.share(sharePayload);
        return;
      }
      await navigator.clipboard?.writeText(url);
      toast.success(sfText("storefront.toasts.productLinkCopied", "Product link copied."));
    } catch {
      // User cancelled native share.
    }
  };

  const retryLoad = () => {
    setState((current) => ({ ...current, loading: true }));
    setReloadToken((current) => current + 1);
  };

  if (state.loading) return <StorefrontProductDetailSkeleton />;
  if (!product) {
    const hasError = Boolean(state.error);
    return hasError ? (
      <StorefrontProductDetailErrorState
        title={sfText("storefront.products.loadFailedTitle", "We could not load this product")}
        text={sfText("storefront.products.loadFailedText", "Please try again. If the issue continues, return to the product list and open the item again.")}
        onRetry={retryLoad}
        retryLabel={sfText("storefront.common.retry", "Try again")}
        backToProductsLabel={sfText("storefront.products.backToProducts", "Back to products")}
      />
    ) : (
      <EmptyState
        title={sfText("storefront.products.notFoundTitle", "Product not found")}
        text={sfText("storefront.products.notFoundText", "Go back to products and try another choice")}
      />
    );
  }

  return (
    <section dir={isRtl ? "rtl" : "ltr"} className="sf-product-details-page mx-auto max-w-7xl px-3 pb-28 pt-2 md:px-4 md:pb-36 md:pt-5 lg:pb-8">
      <div ref={productTopRef} aria-hidden="true" className="h-0 w-0 overflow-hidden" />
      <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,58fr)_minmax(380px,42fr)] lg:items-start">
        <div className="sf-product-gallery-shell overflow-hidden rounded-[1.6rem] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.12),transparent_34%),linear-gradient(180deg,#090909_0%,#111111_100%)] p-2 shadow-[0_28px_80px_rgba(0,0,0,0.32)] md:rounded-[2rem] md:p-3">
        <Suspense fallback={<ProductGalleryFallback />}>
          <LazyStorefrontProductGallery
            mainImage={activeImage}
            displayTitle={displayTitle}
            galleryItems={galleryItems}
            selectedImage={activeImage}
            activeImageIndex={activeImageIndex}
            onSelectImage={selectGalleryImage}
            onStepImage={selectGalleryStep}
            imageFor={imageFor}
            fallbackProductImage={fallbackProductImage}
            mainImageRef={mainImageRef}
          />
        </Suspense>
        </div>
        <div className="sf-product-info-sticky min-w-0 lg:sticky lg:self-start">
          <div className="sf-product-summary-card overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(212,175,55,0.16),transparent_35%),linear-gradient(180deg,#080808_0%,#111111_100%)] p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.35)] md:p-6">
            <div className="mb-2 flex items-start justify-between gap-3 md:mb-4">
              <div className="min-w-0">
                <div className="mt-1.5 hidden text-[11px] font-black text-[#f3d77a] md:mt-3 md:block md:text-xs">{sfText("storefront.products.curatedDetails", "Carefully selected product details")}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => toggleWishlist(product)} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 transition hover:border-white/20 hover:bg-white/[0.1] hover:text-white" aria-label={sfText("storefront.wishlist.toggleWishlist", "Toggle wishlist")}>
                  <Heart className={`h-4 w-4 ${inWishlist ? "fill-current text-rose-400" : ""}`} />
                </button>
                <button type="button" onClick={shareProduct} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 transition hover:border-white/20 hover:bg-white/[0.1] hover:text-white" aria-label={sfText("storefront.share.shareProduct", "Share product")}>
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/18 bg-[#d4af37]/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#f3d77a]">
              <Check className="h-3.5 w-3.5" />
              {sfText("storefront.products.selectedProduct", "Selected product")}
            </div>
            <h1 className="mt-3 line-clamp-2 text-[1.85rem] font-black leading-[1.08] md:text-4xl">{displayTitle}</h1>
            <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-2">
              <div className="text-3xl font-black text-white md:text-[2.65rem]">{money(selectedSellingPrice)}</div>
              {selectedComparePrice > selectedSellingPrice ? <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-sm font-black text-white/60 line-through">{money(selectedComparePrice)}</span> : null}
              {selectedDiscountPercent ? <span className="rounded-full bg-emerald-400/15 px-3 py-1.5 text-sm font-black text-emerald-200">{sfText("storefront.products.discountPercent", "-{{percent}}%", { percent: selectedDiscountPercent })}</span> : null}
              {safeActiveVariant && Number(safeActiveVariant.stock || 0) > 0 && Number(safeActiveVariant.stock || 0) <= 3 ? (
                <span className="rounded-full bg-amber-400/15 px-3 py-1.5 text-sm font-black text-amber-100">
                  {sfText("storefront.products.onlyLeft", "Only {{count}} left", { count: safeActiveVariant.stock })}
                </span>
              ) : null}
            </div>
            {false && <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-black text-white/78">
                <Star className="h-3.5 w-3.5 fill-[#f3d77a] text-[#f3d77a]" />
                تقييم مرتفع من العملاء
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-black text-white/78">
                <Truck className="h-3.5 w-3.5 text-emerald-200" />
                شحن سريع
              </span>
            </div>}
          </div>

          {colors.length > 1 ? (
            <div className="sf-product-option-card mt-4 rounded-[1.45rem] border border-white/[0.08] bg-[#0b0b0b] p-4 text-white shadow-[0_18px_52px_rgba(0,0,0,0.22)]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">{sfText("storefront.products.color", "Color")}</div>
                  <h2 className="text-base font-black">{sfText("storefront.products.chooseColor", "Choose color")}</h2>
                </div>
                {selected.colorName ? <span className="text-xs font-black text-white/55">{selected.colorName}</span> : null}
              </div>
              <div className="sf-scroll flex gap-2 overflow-x-auto pb-1">
                {colors.map((group) => {
                  const active = String(group.key) === String(selectedColorKey);
                  const hasStock = group.variants.some((item) => variantHasStock(item));
                  const swatchImage = colorSwatchImage(group, variantImage(group.variants[0]) || product?.image_url || fallbackProductImage);
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => selectColor(group)}
                      disabled={!hasStock}
                      aria-label={`${sfText("storefront.products.chooseColor", "Choose color")}: ${group.colorName || group.key}`}
                      aria-pressed={active}
                      className={`sf-product-option-choice sf-product-color-choice grid h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 bg-black/40 p-0.5 transition md:h-[4.5rem] md:w-[4.5rem] ${active ? "is-active border-[#d4af37] shadow-[0_0_0_2px_rgba(212,175,55,0.28),0_12px_28px_rgba(212,175,55,0.24)]" : hasStock ? "is-available border-white/15 hover:border-[#d4af37]/55" : "is-unavailable border-white/[0.07] opacity-35"} disabled:cursor-not-allowed disabled:opacity-55`}
                    >
                      <img src={imageFor(swatchImage)} alt="" className="h-full w-full rounded-[0.7rem] object-cover" loading="lazy" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="sf-product-option-card mt-4 rounded-[1.45rem] border border-white/[0.08] bg-[#0b0b0b] p-4 text-white shadow-[0_18px_52px_rgba(0,0,0,0.22)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">{sfText("storefront.products.size", "Size")}</div>
                <h2 className="text-base font-black">{sfText("storefront.products.chooseSize", "Choose size")}</h2>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {sizes.map((size) => {
                const hasStock = Array.isArray(selectedColorGroup?.variants) && selectedColorGroup.variants.some((item) => String(item.size || "") === String(size) && variantHasStock(item));
                const active = String(selected.size) === String(size);
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => selectSize(size)}
                    disabled={!hasStock}
                    className={`sf-product-option-choice sf-product-size-choice relative min-w-[3.25rem] overflow-hidden rounded-2xl border px-3 py-2 text-sm font-black transition ${active ? "is-active border-white bg-white text-stone-950 shadow-[0_14px_34px_rgba(255,255,255,0.14)]" : hasStock ? "is-available border-white/10 bg-white/[0.05] text-white/78 hover:border-white/20 hover:bg-white/[0.08] hover:text-white" : "is-unavailable cursor-not-allowed border-white/[0.07] bg-white/[0.035] text-white/25 opacity-60"}`}
                  >
                    {!hasStock ? <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[120%] -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] bg-white/35" /> : null}
                    <span className="relative z-10">{size || sfText("storefront.products.oneSize", "One size")}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <Link
                to={sizeGuideHref}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-black text-white/80 transition hover:border-[#d4af37]/35 hover:bg-white/[0.08] hover:text-[#f3d77a]"
              >
                <Ruler className="h-3.5 w-3.5" />
                {sfText("storefront.products.sizeGuide", isRtl ? "دليل المقاسات" : "Size guide")}
              </Link>
            </div>
          </div>

          <div className="sf-product-quantity-card mt-4 flex items-center justify-between gap-3 rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-2.5 shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
            <button type="button" onClick={() => setQty((current) => Math.max(1, current - 1))} className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-lg font-black text-white" aria-label={sfText("storefront.cart.decreaseQuantity", "Decrease quantity")}>-</button>
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{sfText("storefront.cart.quantity", "Quantity")}</div>
              <div className="mt-1 text-xl font-black text-white">{qty}</div>
            </div>
            <button type="button" onClick={() => setQty((current) => Math.min(Number(safeActiveVariant?.stock || 1), current + 1))} className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-lg font-black text-white" aria-label={sfText("storefront.cart.increaseQuantity", "Increase quantity")}>+</button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => safeActiveVariant && onAddToCart(product, safeActiveVariant, qty, { sourceEl: mainImageRef.current })}
              disabled={!safeActiveVariant || !variantHasStock(safeActiveVariant)}
              className="sf-product-cta col-span-full flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-black text-stone-950 shadow-[0_14px_34px_rgba(255,255,255,0.16)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
            >
              <ShoppingCart className="h-4 w-4" />
              {sfText("storefront.cart.addToCart", "Add to cart")}
            </button>
            {false && <button
              type="button"
              onClick={buyNow}
              disabled={!safeActiveVariant || !variantHasStock(safeActiveVariant)}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#d4af37]/24 bg-[linear-gradient(135deg,#d4af37,#e5c158)] text-sm font-black text-[#151515] shadow-[0_14px_34px_rgba(212,175,55,0.24)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/35"
            >
              <Sparkles className="h-4 w-4" />
              اشترِ الآن
            </button>}
          </div>
        </div>
      </div>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-[1.5rem] bg-white/50" />}>
        <LazyProductDetailsVariantSheet
          product={product}
          variant={safeActiveVariant}
          colors={colors}
          sizes={sizes}
          selectedColorKey={selectedColorKey}
          selectedSize={selected.size}
          quantity={qty}
          action={variantSheetAction || "cart"}
          onClose={() => setVariantSheetAction("")}
          onColorSelect={selectColor}
          onSizeSelect={selectSize}
          onQuantityChange={setQty}
          onSubmit={(candidate, quantity, action) => {
            if (!candidate || !variantHasStock(candidate)) return;
            const result = onAddToCart(product, candidate, quantity, {
              intent: action === "buy" ? "buy" : "cart",
              sourceEl: mainImageRef.current,
            });
            if (result === "capture_required") return;
            setVariantSheetAction("");
            if (action === "buy") navigate("/checkout");
          }}
        />
      </Suspense>
      <div className="mt-6 grid gap-5 md:mt-8">
        {false && <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <div className="rounded-[1.5rem] border border-white/[0.08] bg-[linear-gradient(180deg,#0b0b0b_0%,#111111_100%)] p-4 text-white shadow-[0_20px_60px_rgba(0,0,0,0.22)] md:p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f3d77a]">{sfText("storefront.products.selectedProduct", "Selected product")}</div>
            <h2 className="mt-3 text-xl font-black md:text-2xl">{sfText("storefront.products.productDetails", "Product details")}</h2>
            <p className="mt-3 text-sm font-bold leading-7 text-white/82">{descriptionText}</p>
          </div>
          <div className="rounded-[1.5rem] border border-white/[0.08] bg-[linear-gradient(180deg,#0a0a0a_0%,#101010_100%)] p-4 text-white shadow-[0_20px_60px_rgba(0,0,0,0.22)] md:p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f3d77a]">Why You'll Love It</div>
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#d4af37]/14 text-[#f3d77a]"><Sparkles className="h-4 w-4" /></span>
                <div>
                  <div className="font-black text-white">{sfText("storefront.products.curatedDetails", "Carefully selected product details")}</div>
                  <p className="mt-1 text-xs font-bold leading-6 text-white/68">خامات وشكل معروضين بوضوح قبل الشراء.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-400/12 text-emerald-200"><Truck className="h-4 w-4" /></span>
                <div>
                  <div className="font-black text-white">شحن سريع</div>
                  <p className="mt-1 text-xs font-bold leading-6 text-white/68">تجهيز سريع ووضوح في حالة المنتج المختار.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-400/12 text-sky-200"><ShieldCheck className="h-4 w-4" /></span>
                <div>
                  <div className="font-black text-white">اختيار آمن</div>
                  <p className="mt-1 text-xs font-bold leading-6 text-white/68">راجع اللون والمقاس قبل إضافة المنتج للسلة.</p>
                </div>
              </div>
            </div>
          </div>
        </div>}
        {false && <ProductDetailReviewSection />}
        <RelatedProducts currentId={product.id} wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} saleModeEnabled={saleModeEnabled} />
        <RecentProductsSection currentId={product.id} recent={recent} />
      </div>
      {false && <div className="md:hidden">
        <div className="h-28" aria-hidden="true" />
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+0.4rem)] z-[55] px-3">
          <div className="mx-auto max-w-xl rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(7,7,7,0.97),rgba(18,18,18,0.97))] p-3 text-white shadow-[0_20px_46px_rgba(0,0,0,0.38)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-white">{displayTitle}</div>
                <div className="mt-1 text-lg font-black text-[#f3d77a]">{money(selectedSellingPrice)}</div>
              </div>
              <button type="button" onClick={() => safeActiveVariant && onAddToCart(product, safeActiveVariant, qty, { sourceEl: mainImageRef.current })} disabled={!safeActiveVariant || !variantHasStock(safeActiveVariant)} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-black text-stone-950 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35">
                <ShoppingCart className="h-4 w-4" />
                {sfText("storefront.cart.addToCart", "Add to cart")}
              </button>
            </div>
          </div>
        </div>
      </div>}
    </section>
  );
}

