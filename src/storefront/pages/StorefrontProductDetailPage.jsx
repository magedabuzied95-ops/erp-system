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
  PairsWellWith,
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
  mirrorProductTitle,
  money,
  productFromDetailsResponse,
  productShareUrl,
  sfText,
  storefrontApi,
  variantColorKey,
  variantColorName,
  variantHasStock,
  variantImage,
} from "../Storefront";
import { api } from "../../shared/api/api";
import { applyProductSeo, clearProductSeo } from "../../shared/lib/socialMeta";
import { parseProductDescription } from "../../shared/lib/productDescriptionFormat";
import { getStorefrontResponsiveImageProps } from "../../shared/lib/storefrontImage";
import { getDisplayPricing } from "../../shared/lib/storefrontPricing";
import { readStorefrontCustomerAuth, storefrontCustomerRequest } from "../lib/storefrontCustomerAuth";
import { BellRing, Check, ChevronLeft, ChevronRight, Heart, Loader2, Ruler, Share2, ShieldCheck, ShoppingCart, Sparkles, Star, Truck } from "lucide-react";
import { shouldShowRestockCta, restockVariantKey, restockSuccessCopy, RESTOCK_COPY } from "../lib/restockIntentUi";
import { buildSizeGuidePath, resolveSizeGuideTypeForProduct } from "../lib/sizeGuide";
import { sortProductSizes } from "../../modules/products/lib/variantBulkSizes";
import { buildCrocsStorefrontSizeOptions, isCrocsProduct } from "../../shared/lib/crocsSizes";
import { createMetaEventOnceGuard, metaCatalogContentId, trackMetaViewContent } from "../lib/metaPixelEvents";
import { trackGa4ViewItem } from "../lib/ga4Events";
import { buildProductColorGroups, buildSelectedColorGallery, colorSwatchImage, resolveColorGroup } from "../lib/productColorGallery";
import { CompareToggleButton } from "../components/StorefrontCompare";

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

/** Time after which a boot prefetch is treated as stale rather than fresh data. */
const BOOT_PREFETCH_MAX_AGE_MS = 60_000;

/**
 * Claims the response the boot script in index.html requested for this route.
 *
 * Consumed exactly once: a later navigation to a different product must issue
 * its own request rather than be served the landing product's payload.
 */
const takeBootPrefetchedProduct = (routeValue) => {
  if (typeof window === "undefined") return null;
  const boot = window.__M1_BOOT_PRODUCT;
  if (!boot || typeof boot.promise?.then !== "function") return null;
  window.__M1_BOOT_PRODUCT = null;
  if (String(boot.key || "") !== String(routeValue || "")) return null;
  if (Date.now() - Number(boot.at || 0) > BOOT_PREFETCH_MAX_AGE_MS) return null;
  return boot.promise;
};

const isBagProduct = (product = {}) => {
  const safeProduct = product && typeof product === "object" ? product : {};
  const values = [
    safeProduct.product_type,
    safeProduct.productType,
    safeProduct.category,
    safeProduct.category_name,
    safeProduct.categoryName,
    safeProduct.type,
  ];
  return values.some((value) => {
    const normalized = String(value || "").trim().toLowerCase();
    return ["bag", "bags", "handbag", "handbags", "شنط", "شنطة", "حقائب", "حقيبة"].includes(normalized);
  });
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
    { id: "quality", name: "M", text: sfText("storefront.reviews.items.quality"), badge: sfText("storefront.reviews.badges.quality") },
    { id: "size", name: "A", text: sfText("storefront.reviews.items.size"), badge: sfText("storefront.reviews.badges.size") },
    { id: "experience", name: "S", text: sfText("storefront.reviews.items.experience"), badge: sfText("storefront.reviews.badges.experience") },
  ];

  return (
    <section className="rounded-[1.5rem] border border-white/[0.08] bg-[linear-gradient(180deg,#090909_0%,#111111_100%)] p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.28)] md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f3d77a]">{sfText("storefront.reviews.eyebrow")}</div>
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

export function StorefrontProductDetailPage({ onAddToCart, toggleWishlist, wishlist, rememberProduct, recent, profile = {}, saleModeEnabled }) {
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
      const prefetched = storefrontApi.peekProductDetails(routeValue);
      const booted = takeBootPrefetchedProduct(routeValue);
      const loadDirect = () => api.get(`/storefront/products/${encodeURIComponent(routeValue)}`, {
        signal: controller.signal,
        debugLabel: "storefront-product-direct",
      }).then((data) => storefrontApi.cacheProductDetails(routeValue, data));
      // The boot prefetch (see index.html) issued this exact request before any
      // JS chunk had downloaded, so on a cold product link its response is
      // already here. It stays FIRST but never alone: every existing attempt
      // remains behind it, so a failed prefetch costs nothing but a fallthrough.
      const bootAttempt = booted
        ? [{ label: "boot-prefetch", loader: () => booted.then((data) => storefrontApi.cacheProductDetails(routeValue, data)) }]
        : [];
      const attempts = prefetched
        ? [
            ...bootAttempt,
            { label: "prefetched", loader: () => Promise.resolve(prefetched) },
            { label: "direct", loader: loadDirect },
          ]
        : [
            ...bootAttempt,
            { label: "direct", loader: loadDirect },
            { label: "resolve", loader: () => storefrontApi.getProductDetails(routeValue, { signal: controller.signal }) },
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
              trackMetaViewContent({ product, variant: first || {}, value: pricing.price, customer: profile });
            }
            trackGa4ViewItem({ product, variant: first || {}, price: pricing.price });
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
  const crocsProduct = isCrocsProduct(product);
  const sizeOptions = crocsProduct
    ? buildCrocsStorefrontSizeOptions(variantGroup)
    : sortProductSizes([...new Set(variantGroup.map((variant) => variant.size).filter(Boolean))]).map((size) => ({
        originalSize: size,
        displaySize: size,
        collision: false,
        variant: variantGroup.find((item) => String(item.size || "") === String(size) && variantHasStock(item))
          || variantGroup.find((item) => String(item.size || "") === String(size))
          || null,
      }));
  const sizes = sizeOptions.map((option) => option.originalSize);
  const colors = colorGroups;
  // The swatch row scrolls sideways with its scrollbar hidden (.sf-scroll), so a product
  // with many colour groups looked like it only had the handful that fit. These arrows and
  // edge fades are the affordance that says the rest of the row exists.
  const colorStripRef = useRef(null);
  const [colorScroll, setColorScroll] = useState({ overflowing: false, atStart: true, atEnd: true });
  useEffect(() => {
    const strip = colorStripRef.current;
    if (!strip) return undefined;
    const measure = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      // Every current browser reports RTL scrollLeft as 0 → -max, so the magnitude is the
      // distance travelled in either direction.
      const position = Math.abs(strip.scrollLeft);
      setColorScroll({ overflowing: max > 4, atStart: position <= 4, atEnd: position >= max - 4 });
    };
    measure();
    strip.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(strip);
    return () => {
      strip.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
    // i18n.language is a dependency because switching to Arabic flips the strip to RTL
    // without resizing or scrolling it, which would otherwise leave the arrows reversed.
  }, [colors.length, i18n.language]);
  // scrollBy is relative and physical, so it lands correctly whichever convention the
  // browser uses for RTL scrollLeft; only the sign has to follow the writing direction.
  const scrollColors = (direction) => {
    const strip = colorStripRef.current;
    if (!strip) return;
    const rtl = typeof window !== "undefined" && window.getComputedStyle(strip).direction === "rtl";
    const step = Math.max(strip.clientWidth * 0.8, 160);
    strip.scrollBy({ left: step * direction * (rtl ? -1 : 1), behavior: "smooth" });
  };
  const hideSizeSelector = isBagProduct(product);
  const sizeGuideHref = useMemo(
    () => buildSizeGuidePath(product ? resolveSizeGuideTypeForProduct(product) : "men"),
    [product]
  );
  const activeVariant = variants.find((item) => String(item.id) === String(selected.variantId))
    || variants.find((item) => item.size === selected.size && (!selectedColorKey || variantColorIdentity(item) === selectedColorKey) && variantHasStock(item))
    || firstDisplayVariant(variants);
  const safeActiveVariant = activeVariant || {};

  // ---- Phase 7.5: Restock Intent ("بلغني لما يتوفر") for the CURRENT selected out-of-stock variant ----
  const [restockState, setRestockState] = useState({}); // variantKey -> loading|done|available|error|login
  const [activeIntentKeys, setActiveIntentKeys] = useState(() => new Set());
  const restockKey = restockVariantKey(safeActiveVariant);
  const showRestockCta = shouldShowRestockCta(safeActiveVariant);
  const restockStatus = restockState[restockKey] || (activeIntentKeys.has(restockKey) ? "done" : "idle");
  useEffect(() => {
    // One cheap fetch of the customer's existing active intents so already-requested variants show ✓.
    const { token } = readStorefrontCustomerAuth();
    if (!token || !product?.id) return;
    let alive = true;
    storefrontCustomerRequest("/storefront/restock-intents", { method: "GET" })
      .then((res) => {
        if (!alive) return;
        const keys = (res?.intents || []).filter((i) => String(i.product_id) === String(product.id) && i.variant_id).map((i) => String(i.variant_id));
        if (keys.length) setActiveIntentKeys((prev) => { const n = new Set(prev); keys.forEach((k) => n.add(k)); return n; });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [product?.id]);
  const handleRestockNotify = async () => {
    const variant = safeActiveVariant;
    const key = restockVariantKey(variant);
    if (!key || restockState[key] === "loading") return;
    const { token } = readStorefrontCustomerAuth();
    if (!token) { setRestockState((s) => ({ ...s, [key]: "login" })); return; }
    setRestockState((s) => ({ ...s, [key]: "loading" }));
    try {
      const res = await storefrontCustomerRequest("/storefront/restock-intents", { method: "POST", body: { product_id: product.id, variant_id: variant.id } });
      if (res?.available_now) { setRestockState((s) => ({ ...s, [key]: "available" })); }
      else { setRestockState((s) => ({ ...s, [key]: "done" })); setActiveIntentKeys((prev) => new Set(prev).add(key)); } // duplicate active intent = success
    } catch (e) {
      const status = Number(e?.status || e?.response?.status || 0);
      setRestockState((s) => ({ ...s, [key]: status === 401 || status === 403 ? "login" : "error" }));
    }
  };

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
  const displayTitle = cleanDisplayText(product ? mirrorProductTitle(product, safeActiveVariant) || product.name : "");
  const selectedPrice = getDisplayPricing(product, saleModeEnabled, safeActiveVariant);
  const selectedSellingPrice = selectedPrice.price || displaySellingPrice(product, safeActiveVariant);
  const selectedComparePrice = selectedPrice.comparePrice || 0;
  const selectedDiscountPercent = Number(selectedPrice.discountPercent || 0) || 0;
  // The visible body copy follows the page language: Arabic readers get the
  // Arabic description, English readers the English one, each falling back to
  // the other. seo_description is the search snippet, not page content.
  const rawDescription = String(
    (isRtl
      ? product?.description_ar || product?.description_en
      : product?.description_en || product?.description_ar) || product?.description || product?.seo_description || ""
  );
  const descriptionParagraphs = useMemo(
    () => rawDescription.split(/\r?\n+/).map((line) => cleanDisplayText(line)).filter(Boolean),
    [rawDescription]
  );
  // Headline, intro, "المميزات:" with • bullets, "مناسب لـ:" with ✓ items; an
  // older plain description comes back as paragraphs only.
  const descriptionBlocks = useMemo(() => parseProductDescription(descriptionParagraphs.join("\n")), [descriptionParagraphs]);
  const descriptionText = descriptionParagraphs.join(" ") || sfText("storefront.products.defaultDescription");
  const inWishlist = product && wishlist.some((item) => String(item.id) === String(product.id));

  useEffect(() => {
    if (!product) return undefined;
    applyProductSeo(product);
    return undefined;
  }, [product]);
  useEffect(() => () => clearProductSeo(), []);
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

  // Sticky add to cart: once the page's own buy buttons scroll up out of view, a
  // bar pinned to the bottom of the screen carries the same action, so a shopper
  // reading the description or the related rows never has to scroll back up.
  // It only appears after the buttons have been passed — on a phone the gallery
  // fills the first screen, and a bar there would cover it before it is needed.
  const buyBlockRef = useRef(null);
  const stickyBuyRef = useRef(null);
  const stickyThumbRef = useRef(null);
  const [stickyBuyVisible, setStickyBuyVisible] = useState(false);
  useEffect(() => {
    const block = buyBlockRef.current;
    if (!block || typeof IntersectionObserver !== "function") return undefined;
    // The root reaches far below the screen, so the buttons count as "in view"
    // everywhere except above its top edge. A plain viewport root missed a fling
    // or a jump that carried the 120px block past the screen between two frames:
    // it went from below to above without ever reporting a change.
    const observer = new IntersectionObserver(([entry]) => {
      setStickyBuyVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    }, { rootMargin: "0px 0px 100000px 0px" });
    observer.observe(block);
    return () => {
      observer.disconnect();
      setStickyBuyVisible(false);
    };
  }, [state.loading, product?.id]);
  // While the bar shows, its height lifts the chat launcher (--sf-ai-chat-bottom
  // reads --product-sticky-actions-height) and pads the page end so the footer's
  // last line is not left underneath it.
  useEffect(() => {
    if (!stickyBuyVisible || typeof document === "undefined") return undefined;
    const body = document.body;
    const bar = stickyBuyRef.current;
    const apply = () => body.style.setProperty("--product-sticky-actions-height", `${bar?.offsetHeight || 0}px`);
    apply();
    body.classList.add("sfx-sticky-buy-on");
    const observer = typeof ResizeObserver === "function" && bar ? new ResizeObserver(apply) : null;
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      body.classList.remove("sfx-sticky-buy-on");
      body.style.removeProperty("--product-sticky-actions-height");
    };
  }, [stickyBuyVisible]);

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
    <section dir={isRtl ? "rtl" : "ltr"} className="sf-product-details-page sfx-pdp mx-auto max-w-7xl px-4 pb-4 pt-3 md:px-8 md:pb-8 md:pt-8">
      <div ref={productTopRef} aria-hidden="true" className="h-0 w-0 overflow-hidden" />
      <div className="grid gap-6 md:gap-10 lg:grid-cols-[minmax(0,58fr)_minmax(380px,42fr)] lg:items-start">
        <div className="sfx-pdp-gallery">
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
          <div className="sfx-pdp-summary">
            {/* The badge shares the row with the wishlist and share buttons. It used
                to sit on a line of its own under a caption that phones hide, which
                left the whole top row empty except for two buttons. */}
            <div className="flex items-center justify-between gap-3">
              <span aria-hidden="true" />
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => toggleWishlist(product)} className={`sfx-pdp-icon${inWishlist ? " is-on" : ""}`} aria-pressed={inWishlist} aria-label={sfText("storefront.wishlist.toggleWishlist", "Toggle wishlist")}>
                  <Heart className="h-4 w-4" />
                </button>
                <CompareToggleButton
                  product={product}
                  colorKey={selectedColorKey}
                  colorName={selectedColorGroup?.colorName || ""}
                  image={activeImage ? imageFor(activeImage) : ""}
                  variant="pdp"
                />
                <button type="button" onClick={shareProduct} className="sfx-pdp-icon" aria-label={sfText("storefront.share.shareProduct", "Share product")}>
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <h1 className="sfx-pdp-title">{displayTitle}</h1>
            <div className="sfx-pdp-pricing">
              {/* A size with no price of its own used to render its strikethrough as the price, then
                  "0" once that fallback went. It says so instead. */}
              {selectedSellingPrice > 0 ? (
                <div className={`sfx-pdp-price${selectedComparePrice > selectedSellingPrice ? " is-sale" : ""}`}>{money(selectedSellingPrice)}</div>
              ) : (
                <div className="sfx-pdp-price sfx-pdp-price--muted">{sfText("storefront.products.priceUnavailable", "Price unavailable")}</div>
              )}
              {selectedComparePrice > selectedSellingPrice ? <span className="sfx-pdp-was">{money(selectedComparePrice)}</span> : null}
              {selectedDiscountPercent ? <span className="sfx-pdp-pill sfx-pdp-pill--sale">{sfText("storefront.products.discountPercent", "-{{percent}}%", { percent: selectedDiscountPercent })}</span> : null}
              {safeActiveVariant && Number(safeActiveVariant.stock || 0) > 0 && Number(safeActiveVariant.stock || 0) <= 3 ? (
                <span className="sfx-pdp-pill">
                  {sfText("storefront.products.onlyLeft", "Only {{count}} left", { count: safeActiveVariant.stock })}
                </span>
              ) : null}
            </div>
            {false && <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-black text-white/78">
                <Star className="h-3.5 w-3.5 fill-[#f3d77a] text-[#f3d77a]" />
                {sfText("storefront.products.highRating")}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-black text-white/78">
                <Truck className="h-3.5 w-3.5 text-emerald-200" />
                {sfText("storefront.products.fastShipping")}
              </span>
            </div>}
          </div>

          {colors.length > 1 ? (
            <div className="sfx-pdp-option">
              <div className="sfx-pdp-option__head">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="sfx-pdp-option__title">{sfText("storefront.products.chooseColor", "Choose color")}</h2>
                    <span className="sfx-pdp-option__meta">
                      {sfText("storefront.products.colorCount", "{{total}} colors", { total: colors.length })}
                    </span>
                  </div>
                </div>
                {selected.colorName ? <span className="sfx-pdp-option__value">{selected.colorName}</span> : null}
              </div>
              <div className="relative">
                <div ref={colorStripRef} className="sf-scroll sfx-pdp-colors">
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
                      className={`sfx-pdp-color${active ? " is-active" : hasStock ? "" : " is-unavailable"}`}
                    >
                      <img src={imageFor(swatchImage)} alt="" loading="lazy" />
                    </button>
                  );
                })}
                </div>
                {colorScroll.overflowing ? (
                  <>
                    <span aria-hidden="true" className={`sfx-pdp-fade sfx-pdp-fade--start ${colorScroll.atStart ? "opacity-0" : "opacity-100"}`} />
                    <span aria-hidden="true" className={`sfx-pdp-fade sfx-pdp-fade--end ${colorScroll.atEnd ? "opacity-0" : "opacity-100"}`} />
                    {/* Rendered conditionally rather than faded out: the dark product-card
                        override forces `opacity: 1 !important` on anything carrying text-white. */}
                    {!colorScroll.atStart ? (
                      <button
                        type="button"
                        onClick={() => scrollColors(-1)}
                        aria-label={sfText("storefront.products.previousColors", "Previous colors")}
                        className="sfx-pdp-strip-nav sfx-pdp-strip-nav--start"
                      >
                        <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                      </button>
                    ) : null}
                    {!colorScroll.atEnd ? (
                      <button
                        type="button"
                        onClick={() => scrollColors(1)}
                        aria-label={sfText("storefront.products.moreColors", "More colors")}
                        className="sfx-pdp-strip-nav sfx-pdp-strip-nav--end"
                      >
                        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {!hideSizeSelector ? <div className="sfx-pdp-option">
            <div className="sfx-pdp-option__head">
              <h2 className="sfx-pdp-option__title">{sfText("storefront.products.chooseSize", "Choose size")}</h2>
              {/* A quiet link beside the heading, where shoppers look for it, rather
                  than a pill on a row of its own under the sizes. */}
              <Link
                to={sizeGuideHref}
                className="sfx-link-btn"
              >
                <Ruler className="h-3.5 w-3.5" />
                {sfText("storefront.products.sizeGuide", isRtl ? "دليل المقاسات" : "Size guide")}
              </Link>
            </div>
            <div className="sfx-pdp-sizes">
              {sizeOptions.map((option) => {
                const { displaySize, originalSize, collision, variant: sizeVariant } = option;
                const hasStock = variantHasStock(sizeVariant);
                const active = String(selected.variantId) === String(sizeVariant?.id);
                return (
                  <button
                    key={sizeVariant?.id || originalSize}
                    type="button"
                    onClick={() => selectVariant(sizeVariant)}
                    disabled={!hasStock}
                    aria-pressed={active}
                    className={`sfx-pdp-size${active ? " is-active" : hasStock ? "" : " is-unavailable"}`}
                  >
                    {!hasStock ? <span className="sfx-pdp-size__slash" aria-hidden="true" /> : null}
                    <span className="sfx-pdp-size__label">{displaySize || sfText("storefront.products.oneSize", "One size")}</span>
                    {collision && originalSize !== displaySize ? <span className="sfx-pdp-size__alt">{originalSize}</span> : null}
                  </button>
                );
              })}
            </div>
          </div> : null}

          {/* Quantity and add to cart share one row, buy it now fills the row below —
              the arrangement of the reference shop the owner pointed at. These use
              their own sf-buy-* classes: the older sf-product-cta and
              sf-product-quantity-card rules repaint with !important in both themes. */}
          <div ref={buyBlockRef} className="sf-buy-bar sfx-pdp-buy grid gap-2">
            <div className="flex items-stretch gap-2">
              <div className="sf-buy-qty flex h-14 shrink-0 items-center" role="group" aria-label={sfText("storefront.cart.quantity", "Quantity")}>
                <button type="button" onClick={() => setQty((current) => Math.max(1, current - 1))} disabled={qty <= 1} className="sf-buy-qty__step" aria-label={sfText("storefront.cart.decreaseQuantity", "Decrease quantity")}>−</button>
                <span className="sf-buy-qty__value" aria-live="polite">{qty}</span>
                <button type="button" onClick={() => setQty((current) => Math.min(Number(safeActiveVariant?.stock || 1), current + 1))} disabled={qty >= Number(safeActiveVariant?.stock || 1)} className="sf-buy-qty__step" aria-label={sfText("storefront.cart.increaseQuantity", "Increase quantity")}>+</button>
              </div>
              <button
                type="button"
                onClick={() => safeActiveVariant && onAddToCart(product, safeActiveVariant, qty, { sourceEl: mainImageRef.current })}
                disabled={!safeActiveVariant || !variantHasStock(safeActiveVariant)}
                className="sf-buy-atc h-14 min-w-0 flex-1"
              >
                <span className="sf-buy-atc__label">{sfText("storefront.cart.addToCart", "Add to cart")}</span>
              </button>
            </div>
            <button
              type="button"
              onClick={buyNow}
              disabled={!safeActiveVariant || !variantHasStock(safeActiveVariant)}
              className="sf-buy-now h-14 w-full"
            >
              {sfText("storefront.cart.buyNow", isRtl ? "اشتري الآن" : "Buy it now")}
            </button>
          </div>

          <div className="mt-2 grid gap-2 empty:hidden sm:grid-cols-2">

            {showRestockCta ? (
              restockStatus === "done" ? (
                <div className="sfx-pdp-note sfx-pdp-note--ok col-span-full"><Check className="h-4 w-4" />{sfText(...restockSuccessCopy(safeActiveVariant))}</div>
              ) : restockStatus === "available" ? (
                <div className="sfx-pdp-note col-span-full"><Sparkles className="h-4 w-4" />{sfText("storefront.restock.availableNow", RESTOCK_COPY.availableNow)}</div>
              ) : (
                <button
                  type="button"
                  onClick={handleRestockNotify}
                  disabled={restockStatus === "loading"}
                  className="sfx-btn sfx-btn--outline col-span-full w-full"
                >
                  {restockStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                  {sfText("storefront.restock.cta", RESTOCK_COPY.cta)}
                </button>
              )
            ) : null}
            {showRestockCta && restockStatus === "login" ? (
              <div className="sfx-muted col-span-full text-center">{sfText("storefront.restock.loginRequired", RESTOCK_COPY.loginRequired)}</div>
            ) : null}
            {showRestockCta && restockStatus === "error" ? (
              <div className="sfx-pdp-error col-span-full text-center">{sfText("storefront.restock.error", RESTOCK_COPY.error)}</div>
            ) : null}
          </div>

          <PairsWellWith key={product.id} product={product} currentVariant={safeActiveVariant} onAddToCart={onAddToCart} saleModeEnabled={saleModeEnabled} />
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
      {/* A grid item defaults to min-width:auto, so a carousel track inside one still
          contributes its full intrinsic width even though the track is clipped - the
          rails then stretched this column past the page's padding on one side and the
          row sat off centre. The width of every child here comes from the column. */}
      <div className="mt-6 grid gap-5 [&>*]:min-w-0 md:mt-8">
        {false && <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <div className="rounded-[1.5rem] border border-white/[0.08] bg-[linear-gradient(180deg,#0b0b0b_0%,#111111_100%)] p-4 text-white shadow-[0_20px_60px_rgba(0,0,0,0.22)] md:p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f3d77a]">{sfText("storefront.products.selectedProduct", "Selected product")}</div>
            <h2 className="mt-3 text-xl font-black md:text-2xl">{sfText("storefront.products.productDetails", "Product details")}</h2>
            <p className="mt-3 text-sm font-bold leading-7 text-white/82">{descriptionText}</p>
          </div>
          <div className="rounded-[1.5rem] border border-white/[0.08] bg-[linear-gradient(180deg,#0a0a0a_0%,#101010_100%)] p-4 text-white shadow-[0_20px_60px_rgba(0,0,0,0.22)] md:p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f3d77a]">{sfText("storefront.products.whyYouWillLoveIt")}</div>
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#d4af37]/14 text-[#f3d77a]"><Sparkles className="h-4 w-4" /></span>
                <div>
                  <div className="font-black text-white">{sfText("storefront.products.curatedDetails", "Carefully selected product details")}</div>
                  <p className="mt-1 text-xs font-bold leading-6 text-white/68">{sfText("storefront.products.perks.materialsText")}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-400/12 text-emerald-200"><Truck className="h-4 w-4" /></span>
                <div>
                  <div className="font-black text-white">{sfText("storefront.products.fastShipping")}</div>
                  <p className="mt-1 text-xs font-bold leading-6 text-white/68">{sfText("storefront.products.perks.shippingText")}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-400/12 text-sky-200"><ShieldCheck className="h-4 w-4" /></span>
                <div>
                  <div className="font-black text-white">{sfText("storefront.products.perks.safeChoiceTitle")}</div>
                  <p className="mt-1 text-xs font-bold leading-6 text-white/68">{sfText("storefront.products.perks.safeChoiceText")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>}
        {/* The product description is real page content for the crawler as well
            as for the shopper: it used to be authored in the ERP and then never
            rendered here. One card, the language of the page, paragraphs kept. */}
        {descriptionParagraphs.length ? (
          <section
            aria-labelledby="sf-product-description-title"
            className="sfx-pdp-description"
          >
            <h2 id="sf-product-description-title" className="sfx-pdp-h2">{sfText("storefront.products.productDetails", "Product details")}</h2>
            <div className="sfx-pdp-description__body">
              {descriptionBlocks.map((block, index) => {
                const key = `${index}-${block.type}`;
                if (block.type === "headline") {
                  return (
                    <p key={key} className="sfx-pdp-lead">
                      {block.text}
                    </p>
                  );
                }
                if (block.type === "heading") {
                  return (
                    <h3 key={key} className="sfx-pdp-h3">
                      {block.text}
                    </h3>
                  );
                }
                if (block.type === "features") {
                  return (
                    <ul key={key} className="sfx-pdp-list">
                      {block.items.map((item, itemIndex) => (
                        <li key={`${key}-${itemIndex}`}>
                          {item.title ? <strong>{item.title}</strong> : null}
                          {item.detail}
                        </li>
                      ))}
                    </ul>
                  );
                }
                if (block.type === "checks") {
                  return (
                    <ul key={key} className="sfx-pdp-checks">
                      {block.items.map((item, itemIndex) => (
                        <li key={`${key}-${itemIndex}`}>
                          <Check className="sfx-pdp-checks__icon" aria-hidden="true" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={key} className="sfx-pdp-text">
                    {block.text}
                  </p>
                );
              })}
            </div>
          </section>
        ) : null}
        {false && <ProductDetailReviewSection />}
        <RelatedProducts currentProduct={product} wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} saleModeEnabled={saleModeEnabled} />
        <RecentProductsSection currentId={product.id} recent={recent} wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} saleModeEnabled={saleModeEnabled} />
      </div>
      {/* Rendered all the time and slid in, so it animates and its height can be
          measured; `inert` keeps the hidden bar out of the tab order. A size that
          sold out sends the shopper back up to the options instead of doing nothing. */}
      <div
        ref={stickyBuyRef}
        className={`sfx-sticky-buy${stickyBuyVisible ? " is-visible" : ""}`}
        aria-hidden={!stickyBuyVisible}
        inert={!stickyBuyVisible}
      >
        <div className="sfx-sticky-buy__inner">
          {activeImage ? (
            <img ref={stickyThumbRef} src={imageFor(activeImage)} onError={fallbackProductImage} alt="" className="sfx-sticky-buy__thumb" loading="lazy" decoding="async" />
          ) : null}
          <div className="sfx-sticky-buy__meta">
            <div className="sfx-sticky-buy__title">{displayTitle}</div>
            <div className="sfx-sticky-buy__sub">
              {selectedSellingPrice > 0 ? (
                <span className={`sfx-sticky-buy__price${selectedComparePrice > selectedSellingPrice ? " is-sale" : ""}`}>{money(selectedSellingPrice)}</span>
              ) : null}
              {selectedComparePrice > selectedSellingPrice ? <span className="sfx-sticky-buy__was">{money(selectedComparePrice)}</span> : null}
              {!hideSizeSelector && safeActiveVariant?.size ? (
                <span className="sfx-sticky-buy__size">{sfText("storefront.products.size", isRtl ? "المقاس" : "Size")} {safeActiveVariant.size}</span>
              ) : null}
            </div>
          </div>
          {variantHasStock(safeActiveVariant) ? (
            <button
              type="button"
              onClick={() => onAddToCart(product, safeActiveVariant, qty, { sourceEl: stickyThumbRef.current || mainImageRef.current })}
              className="sf-buy-now sfx-sticky-buy__cta"
            >
              <ShoppingCart className="h-4 w-4" aria-hidden="true" />
              <span>{sfText("storefront.cart.addToCart", "Add to cart")}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => buyBlockRef.current?.parentElement?.scrollIntoView({ block: "start", behavior: "smooth" })}
              className="sf-buy-now sfx-sticky-buy__cta"
            >
              <span>{sfText("storefront.products.chooseSize", "Choose size")}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

