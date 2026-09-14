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
import { BellRing, Check, ChevronLeft, ChevronRight, Heart, Loader2, Ruler, Share2, ShoppingCart, Sparkles, TrendingDown } from "lucide-react";
import { shouldShowRestockCta, restockVariantKey, restockSuccessCopy, RESTOCK_COPY } from "../lib/restockIntentUi";
import { usePriceDropAlerts } from "../lib/priceDropAlerts";
import { isInWishlist } from "../lib/wishlistIdentity";
import { openSizeGuide } from "../lib/sizeGuideStore";
import { localizeColorName, localizeSizeLabel } from "../lib/displayCopy";
import { sortProductSizes } from "../../modules/products/lib/variantBulkSizes";
import { buildCrocsStorefrontSizeOptions, isCrocsProduct } from "../../shared/lib/crocsSizes";
import { createMetaEventOnceGuard, metaCatalogContentId, trackMetaViewContent } from "../lib/metaPixelEvents";
import { trackGa4ViewItem } from "../lib/ga4Events";
import DeliveryEstimate from "../components/DeliveryEstimate";
import { buildProductColorGroups, buildSelectedColorGallery, colorSwatchImage, resolveColorGroup } from "../lib/productColorGallery";
import { productSelectionSearchKey, resolveRequestedVariant, soldOutColorKeyToKeep } from "../lib/pdpSelection";
import { CompareToggleButton } from "../components/StorefrontCompare";
import { releaseBootLoader } from "../lib/bootLoader";
import "./pdp.css";

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
    <section className="sf-product-detail-skeleton sfx-pdp-skeleton sfx-wrap grid gap-6 pb-20 pt-3 md:gap-10 md:pb-28 md:pt-8 lg:grid-cols-[minmax(0,58fr)_minmax(380px,42fr)]">
      <div className="min-w-0">
        <div className="sfx-skel sfx-pdp-skeleton__plate" />
        <div className="mt-3 flex gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="sfx-skel sfx-pdp-skeleton__thumb" />
          ))}
        </div>
      </div>
      <div className="grid content-start gap-4">
        <div className="sfx-skel h-10 w-4/5" />
        <div className="sfx-skel h-7 w-1/3" />
        <div className="mt-4 flex gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="sfx-skel sfx-pdp-skeleton__swatch" />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="sfx-skel h-11 w-14" />
          ))}
        </div>
        <div className="sfx-skel sfx-pdp-skeleton__cta mt-4" />
        <div className="sfx-skel sfx-pdp-skeleton__cta" />
      </div>
    </section>
  );
}

function StorefrontProductDetailErrorState({ title, text, onRetry, retryLabel, backToProductsLabel }) {
  return (
    <div className="sfx-wrap sfx-wrap--sm sfx-pdp-error-state">
      <div className="sfx-empty">
        <div className="sfx-empty__icon">
          <ShoppingCart className="h-7 w-7" aria-hidden="true" />
        </div>
        <h2 className="sfx-empty__title">{title}</h2>
        <p className="sfx-empty__text">{text}</p>
        <div className="sfx-pdp-error-state__actions">
          <button type="button" onClick={onRetry} className="sfx-btn sfx-btn--primary sfx-btn--lg">
            {retryLabel}
          </button>
          <Link to="/products" className="sfx-btn sfx-btn--secondary sfx-btn--lg">
            {backToProductsLabel}
          </Link>
        </div>
      </div>
    </div>
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

  useEffect(() => {
    if (!state.loading) releaseBootLoader();
  }, [state.loading]);
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
  const [keepColorKey, setKeepColorKey] = useState("");
  const appliedSelectionKeyRef = useRef(null);

  useEffect(() => {
    if (previousProductRouteRef.current === productRouteKey) return;
    previousProductRouteRef.current = productRouteKey;
    initialRouteSearchRef.current = location.search;
  }, [location.search, productRouteKey]);

  // Selects the variant a link's ?variant= / ?color= / ?size= asks for (lib/pdpSelection.js).
  const applyRequestedSelection = (loadedProduct, search) => {
    const productVariants = Array.isArray(loadedProduct?.variants) ? loadedProduct.variants : [];
    const { variant: first, sizeChosen } = resolveRequestedVariant({
      variants: productVariants,
      search,
      colorIdentity: variantColorIdentity,
      colorName: variantColorName,
      hasStock: variantHasStock,
      firstDisplayVariant,
    });
    appliedSelectionKeyRef.current = productSelectionSearchKey(search);
    setKeepColorKey(soldOutColorKeyToKeep(first, variantColorIdentity, variantHasStock, productVariants));
    setQty(1);
    setSelected({
      variantId: first?.id || "",
      size: first?.size || "",
      colorKey: first ? variantColorIdentity(first) : "",
      colorName: first ? variantColorName(first) : "",
      image: variantImage(first) || displayImageForProduct(loadedProduct, first) || loadedProduct?.image_url || loadedProduct?.gallery_images?.[0] || "",
    });
    setActiveImageIndex(0);
    // A size named in the link (a size chip tapped on the product card) is a
    // choice the shopper already made; a size the page picked itself is not.
    setTouchedOptions({ color: false, size: sizeChosen });
    return first;
  };

  // The page is keyed on the path, so a link to another colour or size of the product already open
  // (a bag line, a search hit) changes only the query: nothing remounted and the old colour stayed.
  // Re-run the selection when the variant-choosing params change; tracking params do not count.
  const selectionSearchKey = productSelectionSearchKey(location.search);
  useEffect(() => {
    if (!state.product || appliedSelectionKeyRef.current === null || appliedSelectionKeyRef.current === selectionSearchKey) return;
    initialRouteSearchRef.current = location.search;
    applyRequestedSelection(state.product, location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionSearchKey, state.product]);

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
          if (!cancelled) {
            setState({ loading: false, product, error: "" });
            const first = applyRequestedSelection(product, initialRouteSearchRef.current);
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
    () => buildProductColorGroups({ product, variants, colorKey: variantColorIdentity, colorName: variantColorName, variantHasStock, keepColorKey }),
    [product, variants, keepColorKey]
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

  // ---- Price Drop Alert ("نبّهني لو السعر نزل") — one follow per product, whichever size is picked ----
  const priceDrop = usePriceDropAlerts();
  const [priceDropStatus, setPriceDropStatus] = useState("idle"); // idle|loading|login|error
  const followingPrice = Boolean(product?.id) && priceDrop.isFollowing(product.id);
  useEffect(() => { setPriceDropStatus("idle"); }, [product?.id]);
  const handlePriceDropToggle = async () => {
    if (!product?.id || priceDropStatus === "loading") return;
    setPriceDropStatus("loading");
    try {
      const outcome = await priceDrop.setFollowing(product.id, !followingPrice);
      setPriceDropStatus(outcome === "login" ? "login" : "idle");
    } catch {
      setPriceDropStatus("error");
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
  const inWishlist = Boolean(product) && isInWishlist(wishlist, product);

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
      // The new colour does not come in the chosen size, so that choice is gone.
      if (String(nextVariant.size || "") !== String(selected.size)) setTouchedOptions((prev) => ({ ...prev, size: false }));
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
  // Choose the size first: the page preselects the first size in stock so the
  // price and stock line have something to show, but that is not the shopper's
  // size. With more than one size in stock, adding to the cart or buying waits
  // for a tap on a size — a silent default was sending the wrong size out.
  const sizeOptionRef = useRef(null);
  const [sizePromptTick, setSizePromptTick] = useState(0);
  const inStockSizeCount = sizeOptions.filter((option) => variantHasStock(option.variant)).length;
  const sizeChoiceRequired = !hideSizeSelector && inStockSizeCount > 1 && !touchedOptions.size;
  const promptForSize = () => {
    setSizePromptTick((tick) => tick + 1);
    const block = sizeOptionRef.current;
    if (!block) return;
    block.scrollIntoView({ block: "center", behavior: "smooth" });
    block.querySelector(".sfx-pdp-size:not(:disabled)")?.focus({ preventScroll: true });
  };
  const chooseSizeOption = (variant) => {
    setTouchedOptions((prev) => ({ ...prev, size: true }));
    setSizePromptTick(0);
    selectVariant(variant);
  };
  const addToCart = (sourceEl = mainImageRef.current) => {
    if (sizeChoiceRequired) {
      promptForSize();
      return;
    }
    if (safeActiveVariant) onAddToCart(product, safeActiveVariant, qty, { sourceEl });
  };
  const buyNow = () => {
    if (sizeChoiceRequired) {
      promptForSize();
      return;
    }
    submitVariant(safeActiveVariant, qty, "buy");
  };
  const shareProduct = async () => {
    const shareVersion = Date.now();
    // A size the page preselected is not one to hand on: the link would open with it already chosen.
    const url = productShareUrl(product, safeActiveVariant, shareVersion, { sizeChosen: !sizeChoiceRequired });
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
    <section dir={isRtl ? "rtl" : "ltr"} className="sf-product-details-page sfx-pdp sfx-wrap pb-4 pt-3 md:pb-8 md:pt-8">
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
              {/* The preselected size's stock is not the shopper's size's stock. */}
              {!sizeChoiceRequired && safeActiveVariant && Number(safeActiveVariant.stock || 0) > 0 && Number(safeActiveVariant.stock || 0) <= 3 ? (
                <span className="sfx-pdp-pill">
                  {sfText("storefront.products.onlyLeft", "Only {{count}} left", { count: safeActiveVariant.stock })}
                </span>
              ) : null}
            </div>
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
                {selected.colorName ? <span className="sfx-pdp-option__value">{localizeColorName(selected.colorName, i18n.language)}</span> : null}
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

          {!hideSizeSelector ? <div ref={sizeOptionRef} className={`sfx-pdp-option${sizeChoiceRequired && sizePromptTick ? " is-prompting" : ""}`}>
            <div className="sfx-pdp-option__head">
              <h2 className="sfx-pdp-option__title">{sfText("storefront.products.chooseSize", "Choose size")}</h2>
              {/* A quiet link beside the heading, where shoppers look for it, rather
                  than a pill on a row of its own under the sizes. */}
              <button
                type="button"
                onClick={() => openSizeGuide({ product, variants: variantGroup, selectedSize: touchedOptions.size ? selectedVariant?.size || selected.size || "" : "" })}
                className="sfx-link-btn"
              >
                <Ruler className="h-3.5 w-3.5" />
                {sfText("storefront.products.sizeGuide", isRtl ? "دليل المقاسات" : "Size guide")}
              </button>
            </div>
            {/* Keyed on the tick so a second tap on add to cart replays the nudge.
                The chips themselves are not remounted: that would drop the focus
                promptForSize just moved onto the first one. */}
            {sizeChoiceRequired && sizePromptTick ? (
              <p key={sizePromptTick} role="alert" className="sfx-pdp-size-prompt">
                {sfText("storefront.products.chooseSizeFirst", isRtl ? "اختار المقاس أولًا" : "Choose a size first")}
              </p>
            ) : null}
            <div className="sfx-pdp-sizes">
              {sizeOptions.map((option) => {
                const { displaySize, originalSize, collision, variant: sizeVariant } = option;
                const hasStock = variantHasStock(sizeVariant);
                // No chip reads as chosen until the shopper chooses one.
                const active = !sizeChoiceRequired && String(selected.variantId) === String(sizeVariant?.id);
                return (
                  <button
                    key={sizeVariant?.id || originalSize}
                    type="button"
                    onClick={() => chooseSizeOption(sizeVariant)}
                    disabled={!hasStock}
                    aria-pressed={active}
                    className={`sfx-pdp-size${active ? " is-active" : hasStock ? "" : " is-unavailable"}`}
                  >
                    {!hasStock ? <span className="sfx-pdp-size__slash" aria-hidden="true" /> : null}
                    <span className="sfx-pdp-size__label">{displaySize ? localizeSizeLabel(displaySize, i18n.language) : sfText("storefront.products.oneSize", "One size")}</span>
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
                onClick={() => addToCart()}
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

          <DeliveryEstimate inStock={variantHasStock(safeActiveVariant)} />

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

            {/* Price drop: offered while the picked size can be bought — an unavailable one gets the
                restock button above instead, and two bells side by side would read as one choice. */}
            {priceDrop.enabled && !showRestockCta ? (
              followingPrice ? (
                <div className="sfx-pdp-note sfx-pdp-note--ok col-span-full">
                  <Check className="h-4 w-4" />
                  <span className="min-w-0 flex-1">{sfText("storefront.priceDrop.following", "هنبلغك أول ما السعر ينزل")}</span>
                  <button type="button" onClick={handlePriceDropToggle} disabled={priceDropStatus === "loading"} className="sfx-link-btn shrink-0">
                    {priceDropStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : sfText("storefront.priceDrop.stop", "إلغاء")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handlePriceDropToggle}
                  disabled={priceDropStatus === "loading"}
                  className="sfx-btn sfx-btn--outline col-span-full w-full"
                >
                  {priceDropStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingDown className="h-4 w-4" />}
                  {sfText("storefront.priceDrop.follow", "نبّهني لو السعر نزل")}
                </button>
              )
            ) : null}
            {priceDrop.enabled && !showRestockCta && priceDropStatus === "login" ? (
              <div className="sfx-muted col-span-full text-center">{sfText("storefront.priceDrop.loginRequired", "سجّل دخولك علشان نبلغك لو السعر نزل")}</div>
            ) : null}
            {priceDrop.enabled && !showRestockCta && priceDropStatus === "error" ? (
              <div className="sfx-pdp-error col-span-full text-center">{sfText("storefront.priceDrop.error", "حصلت مشكلة، حاول تاني")}</div>
            ) : null}
          </div>

          <PairsWellWith key={product.id} product={product} currentVariant={safeActiveVariant} onAddToCart={onAddToCart} saleModeEnabled={saleModeEnabled} />
        </div>
      </div>
      <Suspense fallback={<div className="sfx-skel h-40" />}>
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
              {!hideSizeSelector && !sizeChoiceRequired && safeActiveVariant?.size ? (
                <span className="sfx-sticky-buy__size">{sfText("storefront.products.size", isRtl ? "المقاس" : "Size")} {safeActiveVariant.size}</span>
              ) : null}
            </div>
          </div>
          {sizeChoiceRequired ? (
            <button type="button" onClick={promptForSize} className="sf-buy-now sfx-sticky-buy__cta">
              <span>{sfText("storefront.products.chooseSize", "Choose size")}</span>
            </button>
          ) : variantHasStock(safeActiveVariant) ? (
            <button
              type="button"
              onClick={() => addToCart(stickyThumbRef.current || mainImageRef.current)}
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

