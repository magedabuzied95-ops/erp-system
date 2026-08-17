/* eslint-disable react-refresh/only-export-components -- Shared storefront helpers are imported by route-level modules. */
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { memo, useCallback } from "react";
import { useDeferredValue } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import {
  FaCcMastercard,
  FaCcPaypal,
  FaCcVisa,
  FaFacebookF,
  FaInstagram,
  FaTiktok,
  FaWhatsapp,
  FaYoutube,
} from "react-icons/fa";
import { useTranslation } from "react-i18next";
import { lazy, Suspense } from "react";
import i18n, { applyDocumentLanguage, normalizeLanguage, persistApplicationLanguage } from "../i18n/i18n";
import usePageTitle from "../shared/hooks/usePageTitle";
import { safeSetSessionStorage } from "../utils/safeStorage";
import {
  BadgePercent,
  Baby,
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Clock3,
  Footprints,
  Gem,
  Heart,
  Home,
  ImagePlus,
  Loader2,
  Menu,
  MessageCircle,
  Mic,
  Minus,
  Moon,
  MapPin,
  Mail,
  Headphones,
  CreditCard,
  Grid2x2,
  PackageCheck,
  PackageSearch,
  Phone,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  ShieldCheck,
  Tag,
  RefreshCcw,
  Trash2,
  Truck,
  Upload,
  User,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { api } from "../shared/api/api";
import { API_BASE_URL } from "../shared/constants/app";
import { resolveProductImageUrl } from "../shared/lib/imageUrls";
import {
  buildCrocsStorefrontSizeOptions,
  compareCrocsSizes,
  isCrocsProduct,
  isKnownCrocsSize,
  resolveCrocsEuSize,
} from "../shared/lib/crocsSizes";
import { clearStorefrontCustomerAuth, readStorefrontCustomerAuth, storefrontCustomerRequest } from "./lib/storefrontCustomerAuth";
import { formatCurrencyParts, getCurrency } from "../shared/lib/currency";
import useDismissableLayer from "../shared/hooks/useDismissableLayer";
import { isMirrorProduct, mirrorProductTitle } from "../shared/lib/mirrorProduct";
import { productToSocialMeta } from "../shared/lib/socialMeta";
import { normalizeMerchantReturnPolicy } from "../shared/lib/merchantPolicies";
import { displayPublicOrderNumber } from "../shared/utils/publicOrderNumber";
import { defaultEgyptShippingLocations } from "../../shared/egyptShippingLocations.js";
import { VirtualList } from "../shared/components/VirtualList";
import { getStorefrontResponsiveImageProps } from "../shared/lib/storefrontImage";
import { forceCleanReload, recoverFromChunkLoadError } from "../shared/utils/chunkLoadRecovery";
import { buildSizeGuidePath, resolveSizeGuideTypeForProduct } from "./lib/sizeGuide";
import { animateFlyToCart } from "./lib/flyToCart";
import { formatSchoolBagCardSize } from "./lib/schoolBagSize";
import { getStorefrontThemeTokens } from "./lib/themeTokens";
import "./storefront-light.css";
import {
  isStorefrontCheckoutFlowPath,
  isStorefrontCheckoutPath,
  isStorefrontHomePath,
  isStorefrontOfferPath,
  isStorefrontPath,
  isStorefrontProductPath,
  isStorefrontProductsPath,
  ROOT_PATHS,
  normalizePathname,
  productPath,
  productsPath,
  resolveStorefrontPathname,
  storefrontPath,
  storefrontPathFromLink,
} from "./lib/paths";
import { sortProductSizes } from "../modules/products/lib/variantBulkSizes";
import { getDisplayPricing, parseSaleModeEnabled as importedParseSaleModeEnabled } from "../shared/lib/storefrontPricing";
import {
  isMetaPurchaseEligible,
  trackMetaAddToCart,
  trackMetaInitiateCheckout,
  trackMetaPurchase,
} from "./lib/metaPixelEvents";
import { initMetaPixel } from "../shared/lib/metaPixel";
import {
  trackGa4AddToCart,
  trackGa4BeginCheckout,
  trackGa4PageView,
  trackGa4PaymentInfo,
  trackGa4Purchase,
  trackGa4ShippingInfo,
  trackGa4ViewCart,
} from "./lib/ga4Events";
import {
  isCustomerReviewOrderEligible,
  isValidSurveyEmail,
  renderGoogleCustomerReviewOptIn,
} from "./lib/googleCustomerReviews";
import instaPayLogoWebp from "../assets/payments/instapay.webp";
import instaPayLogo from "../assets/payments/instapay.png";
import vodafoneCashLogoWebp from "../assets/payments/vodafone-cash.webp";
import vodafoneCashLogo from "../assets/payments/vodafone-cash.png";
const productRouteIdentifier = (product = {}) =>
  firstTextValue(
    product.product_id,
    product.productId,
    product.parent_product_id,
    product.id,
    product.slug,
    product.product_slug,
    product.canonical_slug,
    product.card_id
  );
const productBaseUrl = (product = {}) => {
  const identifier = productRouteIdentifier(product);
  return identifier ? productPath(identifier) : productsPath();
};
const parseSaleModeEnabled = importedParseSaleModeEnabled;
const appendProductUrlParams = (url = "", entries = []) => {
  const [path, query = ""] = String(url || "").split("?");
  const params = new URLSearchParams(query);
  entries.forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") params.set(key, String(value));
    else params.delete(key);
  });
  const suffix = params.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
};
const productUrl = (product = {}) => {
  const variantId = product.selected_variant_id || product.display_variant_id || product.matched_variant_id || "";
  const color = product.color_key || product.display_color_key || product.color || product.display_color || "";
  const linkedPath = storefrontPathFromLink(product.link || product.product_url || product.url);
  const linkedProductPath = isStorefrontProductPath(linkedPath) ? linkedPath : "";
  return appendProductUrlParams(linkedProductPath || productBaseUrl(product), [
    ["variant", variantId],
    ["color", color],
  ]);
};
const productSharePath = (product = {}) => {
  const identifier = productRouteIdentifier(product);
  return identifier ? `/share/product/${encodeURIComponent(identifier)}` : "/share/product";
};
const productShareUrl = (product = {}, variant = null, shareVersion = Date.now()) => {
  const path = appendProductUrlParams(productSharePath(product), [
    ["variant", variant?.id || variant?.variant_id || product.selected_variant_id || product.display_variant_id || ""],
    ["color", variant?.color || variant?.color_key || product.color_key || product.display_color_key || ""],
    ["size", variant?.size || product.selected_size || ""],
    ["v", shareVersion || Date.now()],
  ]);
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
};

const resetStorefrontViewportScroll = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const scrollTargets = [
    window,
    document.scrollingElement,
    document.documentElement,
    document.body,
    ...Array.from(document.querySelectorAll("[data-storefront-scroll-root]")),
  ].filter(Boolean);
  const scrollTop = () => {
    scrollTargets.forEach((target) => {
      try {
        if (typeof target?.scrollTo === "function") {
          target.scrollTo({ top: 0, left: 0, behavior: "auto" });
          return;
        }
        if ("scrollTop" in target) target.scrollTop = 0;
      } catch {
        // Ignore best-effort scroll reset failures.
      }
    });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    document.scrollingElement?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
  };
  scrollTop();
  window.requestAnimationFrame(scrollTop);
  window.setTimeout(scrollTop, 80);
};

const compactStorefrontReceipt = (payload = {}, meta = {}) => ({
  order: payload.order || {},
  items: Array.isArray(payload.items) ? payload.items : [],
  customer: payload.customer || {},
  checkout: payload.checkout || {},
  customer_reviews: payload.customer_reviews || null,
  ...meta,
});

const resolveStorefrontBrandName = (settings = {}) =>
  String(
    settings?.company_name ||
      settings?.companyName ||
      settings?.["general.company_name"] ||
      settings?.["storefront.store_name"] ||
      settings?.store_name ||
      "MONE"
  ).trim() || "MONE";

const resolveStorefrontBrandLogoUrl = (settings = {}) =>
  String(
    settings?.company_logo_url ||
      settings?.companyLogoUrl ||
      settings?.["general.company_logo_url"] ||
      settings?.["storefront.store_logo_url"] ||
      settings?.store_logo_url ||
      ""
  ).trim();

const resolveStorefrontHeaderLogoUrl = (settings = {}) =>
  String(
    settings?.header_logo_url ||
      settings?.headerLogoUrl ||
      settings?.["storefront.header_logo_url"] ||
      settings?.storefront?.header_logo_url ||
      resolveStorefrontBrandLogoUrl(settings)
  ).trim();

const resolveBrandInitials = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "MONE";
  const parts = text.split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}` : text.slice(0, 2);
  return String(initials || "MONE").toUpperCase();
};

const normalizeWishlistProduct = (item = {}) => {
  const nestedItem = item?.item && typeof item.item === "object" ? item.item : {};
  const product = nestedProductFor(item);
  const variant = nestedVariantFor(item, product);
  const productIdValue = item?.product && typeof item.product !== "object" ? item.product : "";
  const id = firstTextValue(item.id, item.product_id, item.productId, productIdValue, nestedItem.id, nestedItem.product_id, nestedItem.productId, product.id, product.product_id, product.productId);
  const title = firstTextValue(item.name, item.title, item.product_name, item.productName, nestedItem.name, nestedItem.title, nestedItem.product_name, product.name, product.title, product.product_name);
  const slug = firstTextValue(item.slug, item.product_slug, item.canonical_slug, nestedItem.slug, nestedItem.product_slug, nestedItem.canonical_slug, product.slug, product.product_slug, product.canonical_slug, id);
  const image = resolveProductImage({ ...nestedItem, ...item }, product, variant);
  const price = displaySellingPrice(product, variant) || firstNumberValue(item.price, nestedItem.price, product.selling_price, product.regular_price, product.price);
  const comparePrice = displayComparePrice(product, variant);
  const originalPrice = storefrontOriginalPrice(product, variant) || firstNumberValue(item.original_price, item.base_price, item.list_price, item.compare_at_price, item.regular_price, nestedItem.original_price, product.original_price, product.base_price, product.list_price, product.regular_price);
  const stock = Number(item.stock ?? item.total_stock ?? item.available_stock ?? nestedItem.stock ?? nestedItem.total_stock ?? nestedItem.available_stock ?? variant.stock ?? variant.quantity ?? product.total_stock ?? product.stock ?? 0) || 0;
  const hasRenderableData = Boolean(title || image || price);
  return {
    ...product,
    ...item,
    id,
    product_id: id,
    productId: id,
    name: title,
    title,
    slug,
    image_url: image,
    image,
    price,
    selling_price: storefrontSellingPrice(product, variant) || price,
    regular_price: originalPrice,
    original_price: originalPrice,
    base_price: originalPrice,
    list_price: originalPrice,
    compare_base_price: originalPrice,
    sale_price: firstNumberValue(item.sale_price, nestedItem.sale_price, product.sale_price),
    compare_at_price: comparePrice,
    variant,
    stock,
    total_stock: Number(item.total_stock ?? product.total_stock ?? stock) || stock,
    unavailable: !hasRenderableData,
  };
};

const compactImageValue = (value = "") => {
  const text = String(value || "");
  if (!text || text.startsWith("data:") || text.length > 500) return "";
  return text;
};

const imageUrlCache = new Map();
const isAiSupportDebugEnabled = () => {
  if (import.meta.env.VITE_AI_SUPPORT_DEBUG === "1") return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("AI_SUPPORT_DEBUG") === "1";
  } catch {
    return false;
  }
};
const imageFor = (value) => {
  const key = String(value || "");
  if (imageUrlCache.has(key)) return imageUrlCache.get(key);
  const resolved = resolveProductImageUrl(value) || "/favicon.svg";
  if (imageUrlCache.size > 500) imageUrlCache.clear();
  imageUrlCache.set(key, resolved);
  return resolved;
};
const responsiveImageProps = (value, preset = "grid") => getStorefrontResponsiveImageProps(imageFor(value), preset);
const storefrontImagePreloadCache = new Map();
const preloadStorefrontImage = (value, preset = "hero") => {
  const src = imageFor(value);
  if (!src || src === "/favicon.svg" || typeof window === "undefined" || typeof window.Image !== "function") {
    return Promise.resolve(Boolean(src));
  }
  if (storefrontImagePreloadCache.has(src)) return storefrontImagePreloadCache.get(src);

  const promise = new Promise((resolve) => {
    const image = new window.Image();
    const responsive = responsiveImageProps(value, preset);
    image.decoding = "async";
    if (responsive.srcSet) image.srcset = responsive.srcSet;
    if (responsive.sizes) image.sizes = responsive.sizes;
    image.onload = () => {
      const decode = typeof image.decode === "function" ? image.decode() : Promise.resolve();
      Promise.resolve(decode).catch(() => undefined).finally(() => resolve(true));
    };
    image.onerror = () => resolve(false);
    image.src = src;
  });

  storefrontImagePreloadCache.set(src, promise);
  promise.then((loaded) => {
    if (!loaded && storefrontImagePreloadCache.get(src) === promise) storefrontImagePreloadCache.delete(src);
  });
  if (storefrontImagePreloadCache.size > 36) {
    const oldestKey = storefrontImagePreloadCache.keys().next().value;
    if (oldestKey && oldestKey !== src) storefrontImagePreloadCache.delete(oldestKey);
  }
  return promise;
};
const money = (value) => {
  const parts = formatCurrencyParts(Number(value || 0));
  const amount = String(parts.amount || "").replace(/([.,])0{2}$/, "");
  return parts.isRtl ? `${amount} ${parts.symbol}`.trim() : `${parts.symbol} ${amount}`.trim();
};
const sfText = (key, fallback, options = {}) => i18n.t(String(key || ""), { defaultValue: fallback, ...options });
const couponErrorKeyMap = {
  "Coupon code is required": "storefront.checkout.couponErrors.required",
  "Coupon not found": "storefront.checkout.couponErrors.notFound",
  "Coupon is inactive": "storefront.checkout.couponErrors.inactive",
  "Campaign is inactive": "storefront.checkout.couponErrors.inactive",
  "Campaign has not started": "storefront.checkout.couponErrors.notStarted",
  "Campaign has expired": "storefront.checkout.couponErrors.expired",
  "Coupon has expired": "storefront.checkout.couponErrors.expired",
  "Coupon usage limit reached": "storefront.checkout.couponErrors.limitReached",
  "Minimum order amount not reached": "storefront.checkout.couponErrors.minimumNotReached",
  "Coupon is not valid for this channel": "storefront.checkout.couponErrors.channelMismatch",
  "Coupon is assigned to another customer": "storefront.checkout.couponErrors.assignedCustomer",
  "Fixed coupon discount exceeds order total": "storefront.checkout.couponErrors.discountTooHigh",
  "Coupon is invalid": "storefront.checkout.couponErrors.invalid",
};
const couponErrorText = (reason = "") => {
  const key = couponErrorKeyMap[String(reason || "").trim()] || "storefront.checkout.couponErrors.invalid";
  return sfText(key, String(reason || "").trim() || "تعذر تطبيق العملية");
};
const truthyFlag = (value) => value === true || value === 1 || String(value || "").toLowerCase() === "true";
// Sale prices are opt-in and are controlled by the public POS sale-mode setting.
// Defaulting to `true` made cards briefly (or permanently, when settings failed)
// show saved sale prices while the product page showed the regular price.
let storefrontSalePricesEnabled = false;
let storefrontPublicSaleModeEnabledRaw = undefined;
const normalizeStorefrontSalePricesEnabled = (settings = {}) => {
  return Boolean(parseSaleModeEnabled(settings?.sale_mode_enabled, false));
};
const setStorefrontSalePricesEnabled = (settings = {}) => {
  storefrontSalePricesEnabled = normalizeStorefrontSalePricesEnabled(settings);
};
const extractPublicStorefrontSettings = (response = {}) => {
  const directSettings = response?.settings && typeof response.settings === "object" ? response.settings : null;
  const nestedSettings = response?.data?.settings && typeof response.data.settings === "object" ? response.data.settings : null;
  const responseBodySettings = response?.responseBody?.settings && typeof response.responseBody.settings === "object" ? response.responseBody.settings : null;
  const payloadSettings = response?.payload?.settings && typeof response.payload.settings === "object" ? response.payload.settings : null;
  const resultSettings = response?.result?.settings && typeof response.result.settings === "object" ? response.result.settings : null;
  const bodySettings = response?.body?.settings && typeof response.body.settings === "object" ? response.body.settings : null;
  const dataObject = response?.data && typeof response.data === "object" ? response.data : null;
  const settings =
    directSettings ||
    nestedSettings ||
    responseBodySettings ||
    payloadSettings ||
    resultSettings ||
    bodySettings ||
    (dataObject && !Array.isArray(dataObject) ? dataObject : null) ||
    (response && typeof response === "object" && !Array.isArray(response) ? response : {});
  const saleModeEnabledCandidate =
    settings?.sale_mode_enabled ??
    settings?.saleModeEnabled ??
    settings?.global_sale_enabled ??
    settings?.sale_prices_enabled ??
    settings?.storefront?.sale_mode_enabled ??
    settings?.storefront?.saleModeEnabled ??
    settings?.storefront?.global_sale_enabled ??
    settings?.storefront?.sale_prices_enabled ??
    response?.sale_mode_enabled ??
    response?.saleModeEnabled ??
    response?.global_sale_enabled ??
    response?.sale_prices_enabled ??
    response?.data?.sale_mode_enabled ??
    response?.data?.saleModeEnabled ??
    response?.data?.global_sale_enabled ??
    response?.data?.sale_prices_enabled ??
    response?.data?.settings?.sale_mode_enabled ??
    response?.data?.settings?.saleModeEnabled ??
    response?.data?.settings?.global_sale_enabled ??
    response?.data?.settings?.sale_prices_enabled ??
    response?.data?.settings?.storefront?.sale_mode_enabled ??
    response?.data?.settings?.storefront?.saleModeEnabled ??
    response?.data?.settings?.storefront?.global_sale_enabled ??
    response?.data?.settings?.storefront?.sale_prices_enabled ??
    response?.responseBody?.sale_mode_enabled ??
    response?.responseBody?.saleModeEnabled ??
    response?.responseBody?.global_sale_enabled ??
    response?.responseBody?.sale_prices_enabled ??
    response?.responseBody?.settings?.sale_mode_enabled ??
    response?.responseBody?.settings?.saleModeEnabled ??
    response?.responseBody?.settings?.global_sale_enabled ??
    response?.responseBody?.settings?.sale_prices_enabled ??
    response?.responseBody?.settings?.storefront?.sale_mode_enabled ??
    response?.responseBody?.settings?.storefront?.saleModeEnabled ??
    response?.responseBody?.settings?.storefront?.global_sale_enabled ??
    response?.responseBody?.settings?.storefront?.sale_prices_enabled ??
    response?.payload?.sale_mode_enabled ??
    response?.payload?.saleModeEnabled ??
    response?.payload?.global_sale_enabled ??
    response?.payload?.sale_prices_enabled ??
    response?.payload?.settings?.sale_mode_enabled ??
    response?.payload?.settings?.saleModeEnabled ??
    response?.payload?.settings?.global_sale_enabled ??
    response?.payload?.settings?.sale_prices_enabled ??
    response?.payload?.settings?.storefront?.sale_mode_enabled ??
    response?.payload?.settings?.storefront?.saleModeEnabled ??
    response?.payload?.settings?.storefront?.global_sale_enabled ??
    response?.payload?.settings?.storefront?.sale_prices_enabled ??
    response?.result?.sale_mode_enabled ??
    response?.result?.saleModeEnabled ??
    response?.result?.global_sale_enabled ??
    response?.result?.sale_prices_enabled ??
    response?.result?.settings?.sale_mode_enabled ??
    response?.result?.settings?.saleModeEnabled ??
    response?.result?.settings?.global_sale_enabled ??
    response?.result?.settings?.sale_prices_enabled ??
    response?.result?.settings?.storefront?.sale_mode_enabled ??
    response?.result?.settings?.storefront?.saleModeEnabled ??
    response?.result?.settings?.storefront?.global_sale_enabled ??
    response?.result?.settings?.storefront?.sale_prices_enabled ??
    response?.body?.sale_mode_enabled ??
    response?.body?.saleModeEnabled ??
    response?.body?.global_sale_enabled ??
    response?.body?.sale_prices_enabled ??
    response?.body?.settings?.sale_mode_enabled ??
    response?.body?.settings?.saleModeEnabled ??
    response?.body?.settings?.global_sale_enabled ??
    response?.body?.settings?.sale_prices_enabled ??
    response?.body?.settings?.storefront?.sale_mode_enabled ??
    response?.body?.settings?.storefront?.saleModeEnabled ??
    response?.body?.settings?.storefront?.global_sale_enabled ??
    response?.body?.settings?.storefront?.sale_prices_enabled;
  const rawSaleModeEnabled =
    saleModeEnabledCandidate;
  return { settings, rawSaleModeEnabled };
};
const BODY_SCROLL_LOCK_ATTR = "data-storefront-scroll-lock-count";
const BODY_SCROLL_LOCK_Y_ATTR = "data-storefront-scroll-lock-y";
const lockBodyScroll = () => {
  if (typeof document === "undefined" || typeof window === "undefined") return undefined;
  const root = document.documentElement;
  const body = document.body;
  const currentCount = Number(body.getAttribute(BODY_SCROLL_LOCK_ATTR) || "0");
  if (!currentCount) {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const scrollbarCompensation = Math.max(0, window.innerWidth - root.clientWidth);
    body.setAttribute(BODY_SCROLL_LOCK_Y_ATTR, String(scrollY));
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    if (scrollbarCompensation > 0) {
      body.style.paddingRight = `${scrollbarCompensation}px`;
    }
  }
  body.setAttribute(BODY_SCROLL_LOCK_ATTR, String(currentCount + 1));
  return () => {
    const nextCount = Math.max(0, Number(body.getAttribute(BODY_SCROLL_LOCK_ATTR) || "0") - 1);
    if (nextCount > 0) {
      body.setAttribute(BODY_SCROLL_LOCK_ATTR, String(nextCount));
      return;
    }
    const lockedScrollY = Number(body.getAttribute(BODY_SCROLL_LOCK_Y_ATTR) || "0");
    body.removeAttribute(BODY_SCROLL_LOCK_ATTR);
    body.removeAttribute(BODY_SCROLL_LOCK_Y_ATTR);
    body.style.position = "";
    body.style.top = "";
    body.style.left = "";
    body.style.right = "";
    body.style.width = "";
    body.style.overflow = "";
    body.style.paddingRight = "";
    window.scrollTo({ top: lockedScrollY, left: 0, behavior: "instant" });
  };
};
const useBodyScrollLock = (locked) => {
  useEffect(() => {
    if (!locked) return undefined;
    return lockBodyScroll();
  }, [locked]);
};
const buildStorefrontProductsRequestUrl = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    const safeKey = String(key || "").trim();
    if (!safeKey || value === undefined || value === null || value === "" || value === false) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== "" && item !== false) query.append(safeKey, item === true ? "1" : String(item));
      });
      return;
    }
    query.set(safeKey, value === true ? "1" : String(value));
  });
  if (!query.has("sort")) query.set("sort", "newest");
  query.set("_last_piece_scope", "product");
  const queryString = query.toString();
  return `/storefront/products${queryString ? `?${queryString}` : ""}`;
};
const useProducts = (params = {}, { ttlMs = STOREFRONT_PRODUCTS_CACHE_TTL_MS } = {}) => {
  const queryKey = JSON.stringify(params);
  const offerStoryValue = String(params?.offer_story ?? params?.offerStory ?? "").trim().toLowerCase();
  const hasOfferStoryFilter = Boolean(offerStoryValue && !["0", "false", "no", "off"].includes(offerStoryValue));
  const effectiveTtlMs = hasOfferStoryFilter ? 0 : ttlMs;
  const requestUrl = useMemo(() => buildStorefrontProductsRequestUrl(JSON.parse(queryKey || "{}")), [queryKey]);
  const queryString = requestUrl.split("?")[1] || "";
  const cachedProductsData = getCachedStorefrontGetData(requestUrl, { ttlMs: effectiveTtlMs });
  const [state, setState] = useState(() => {
    const initialProducts = extractStorefrontProductsFromResponse(cachedProductsData);
    return cachedProductsData ? { loading: false, error: "", products: initialProducts, total: Number(cachedProductsData.total ?? cachedProductsData.total_count ?? initialProducts.length), hasMore: Boolean(cachedProductsData.hasMore ?? cachedProductsData.has_more), page: Number(cachedProductsData.page || 1) } : { loading: true, error: "", products: [], total: 0, hasMore: false, page: 1 };
  });
  const hasCachedInitialDataRef = useRef(Boolean(cachedProductsData));

  useEffect(() => {
    let cancelled = false;
    if (!hasCachedInitialDataRef.current) {
      deferReactState(() => {
        if (!cancelled) setState((prev) => ({ ...prev, loading: true, error: "" }));
      });
    }
    if (import.meta.env.DEV) {
      const requestParams = new URLSearchParams(queryString);
      console.debug("[storefront-random-seed]", {
        seed: requestParams.get("random_seed") || "",
        sort: requestParams.get("sort") || "",
        url: requestUrl,
        ttlMs: effectiveTtlMs,
      });
    }
    cachedStorefrontGet(requestUrl, { ttlMs: effectiveTtlMs })
      .then((data) => {
        const products = extractStorefrontProductsFromResponse(data);
        if (import.meta.env.DEV) {
          console.log("[offer-story-raw-response]", requestUrl, data);
          console.log("[offer-story-normalized]", products.length, products.map((product) => ({
            id: product?.id,
            name: product?.name,
            is_offer_story: product?.is_offer_story,
            is_storefront_visible: product?.is_storefront_visible,
            active: product?.active,
          })));
          console.debug("[storefront-color-card-response]", products.map((product) => ({
            card_id: product?.card_id,
            parent_product_id: product?.parent_product_id,
            color: product?.color || product?.display_color,
            selected_variant_id: product?.selected_variant_id || product?.display_variant_id,
            image_url: product?.image_url,
            sizes: product?.sizes,
          })));
        }
        if (!cancelled) setState({ loading: false, error: "", products, total: Number(data?.total ?? data?.total_count ?? products.length), hasMore: Boolean(data?.hasMore ?? data?.has_more), page: Number(data?.page || 1) });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error || "Failed to load products");
        setState({ loading: false, error: message, products: [], total: 0, hasMore: false, page: 1 });
      });
    return () => {
      cancelled = true;
    };
  }, [queryString, requestUrl, effectiveTtlMs]);

  return state;
};

const normalizeHomeProduct = (product = {}) => {
  const link = storefrontPathFromLink(product.link || product.product_url || product.url);
  const image = compactImageValue(
    product.image_url ||
      product.product_image_url ||
      product.thumbnail_url ||
      product.photo_url ||
      product.image ||
      (Array.isArray(product.gallery_images) ? product.gallery_images[0] : "")
  );
  const price = Number(product.price || product.final_price || product.selling_price || product.regular_price || 0) || 0;
  const salePrice = Number(product.sale_price || 0) || 0;
  const sourceSellingPrice = Number(product.selling_price || product.price || price || 0) || 0;
  const id = firstTextValue(product.id, product.product_id, product.productId, product.card_id, product.slug, product.canonical_slug);
  const name = firstTextValue(product.name, product.title, product.product_name, product.productName);
  return {
    ...product,
    id,
    product_id: product.product_id || product.productId || id,
    card_id: product.card_id || id,
    slug: product.slug || product.canonical_slug || id,
    name,
    image_url: image,
    product_image_url: product.product_image_url || image,
    gallery_images: Array.isArray(product.gallery_images) ? product.gallery_images : image ? [image] : [],
    price,
    final_price: price,
    selling_price: price || sourceSellingPrice,
    regular_price: Number(product.regular_price || product.original_price || product.compare_at_price || sourceSellingPrice || price || 0) || 0,
    sale_price: salePrice,
    sale_price_enabled: Boolean(product.sale_price_enabled && salePrice > 0 && sourceSellingPrice > 0 && salePrice < sourceSellingPrice),
    sale_mode_applied: Boolean(product.sale_price_enabled && salePrice > 0 && sourceSellingPrice > 0 && salePrice < sourceSellingPrice),
    total_stock: Number(product.total_stock ?? product.stock ?? 1) || 0,
    stock: Number(product.stock ?? product.total_stock ?? 1) || 0,
    link,
  };
};

const normalizeHomeCollection = (collection = {}) => ({
  ...collection,
  key: collection.key || collection.id || collection.slug || collection.title || "",
  title: collection.title || collection.name || collection.label || "",
  subtitle: collection.subtitle || collection.description || "",
  products: (Array.isArray(collection.products) ? collection.products : []).map(normalizeHomeProduct).filter((product) => product.id && product.name),
});

const getStorefrontHomeFromResponse = (response = {}) =>
  response?.home ||
  response?.data?.home ||
  response?.result?.home ||
  response?.payload?.home ||
  response?.storefront?.home ||
  response ||
  {};

const normalizeStorefrontBrand = (brand = {}) => {
  const image = compactImageValue(brand.logo_url || brand.image_url || brand.logo || brand.image || brand.logoUrl || brand.imageUrl || "");
  const id = firstTextValue(brand.id, brand.brand_id, brand.brandId, brand.slug, brand.canonical_slug);
  const name = firstTextValue(brand.name, brand.title, brand.brand_name);
  return {
    ...brand,
    id,
    name,
    slug: firstTextValue(brand.slug, brand.brand_slug, brand.brandSlug, id),
    logo_url: image,
    image_url: image,
    sort_order: Number(brand.sort_order ?? brand.sortOrder ?? 0) || 0,
  };
};

const storefrontHomeStateFromResponse = (response, { loading = false } = {}) => {
  const home = getStorefrontHomeFromResponse(response);
  const normalizedHero = home.hero ? normalizeHomeProduct(home.hero) : null;
  const hero = normalizedHero && isMirrorProduct(normalizedHero) ? normalizedHero : null;
  const mirrorProducts = (Array.isArray(home.mirror_products) ? home.mirror_products : [])
    .map(normalizeHomeProduct)
    .filter((product) => product.id && product.name && isMirrorProduct(product));
  const collections = (Array.isArray(home.featured_collections) ? home.featured_collections : [])
    .map(normalizeHomeCollection)
    .filter((collection) => collection.products.length);
  return { loading, error: "", hero: hero?.id ? hero : null, mirrorProducts, collections };
};

const useStorefrontHome = () => {
  const requestSequenceRef = useRef(0);
  const initialHomeRef = useRef(null);
  if (initialHomeRef.current === null) {
    const memoryHome = storefrontGetCache.get(STOREFRONT_HOME_REQUEST_URL)?.data;
    initialHomeRef.current = memoryHome || readPersistedStorefrontHome() || false;
  }
  const initialHome = initialHomeRef.current || null;
  const [state, setState] = useState(() => {
    if (initialHome) return storefrontHomeStateFromResponse(initialHome);
    return { loading: true, error: "", hero: null, mirrorProducts: [], collections: [] };
  });

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestSequenceRef.current;
    if (!initialHome) setState({ loading: true, error: "", hero: null, mirrorProducts: [], collections: [] });
    cachedStorefrontGet(STOREFRONT_HOME_REQUEST_URL, {
      ttlMs: STOREFRONT_HOME_CACHE_TTL_MS,
      forceRefresh: Boolean(initialHome),
      persist: true,
    })
      .then((json) => {
        if (cancelled || requestId !== requestSequenceRef.current) return;
        const nextState = storefrontHomeStateFromResponse(json);
        setState(nextState);
      })
      .catch((error) => {
        if (!cancelled && requestId === requestSequenceRef.current && error?.cause?.name !== "AbortError") {
          setState({ loading: false, error: error?.message || "Failed to load storefront home", hero: null, mirrorProducts: [], collections: [] });
        }
      });
    return () => {
      cancelled = true;
      requestSequenceRef.current += 1;
    };
  }, []);

  return state;
};

const useStorefrontBrands = () => {
  const [state, setState] = useState({ loading: true, error: "", brands: [] });

  useEffect(() => {
    let cancelled = false;
    cachedStorefrontGet("/storefront/brands", { ttlMs: STOREFRONT_BRANDS_CACHE_TTL_MS })
      .then((data) => {
        const brands = (Array.isArray(data?.brands) ? data.brands : Array.isArray(data?.data) ? data.data : [])
          .map(normalizeStorefrontBrand)
          .filter((brand) => brand.id && brand.name && brand.logo_url);
        if (!cancelled) setState({ loading: false, error: "", brands });
      })
      .catch((error) => {
        if (!cancelled && error?.cause?.name !== "AbortError") {
          setState({ loading: false, error: error?.message || "Failed to load storefront brands", brands: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};


const useStorefrontGenderClassifications = () => {
  const cachedGenderData = getCachedStorefrontGetData("/storefront/classifications/gender", { ttlMs: STOREFRONT_GENDER_CACHE_TTL_MS });
  const [state, setState] = useState(() => ({
    loading: !cachedGenderData,
    error: "",
    options: cachedGenderData ? uniqueClassificationOptions(cachedGenderData?.options || []) : [],
  }));

  useEffect(() => {
    let cancelled = false;
    cachedStorefrontGet("/storefront/classifications/gender", { ttlMs: STOREFRONT_GENDER_CACHE_TTL_MS })
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: "", options: uniqueClassificationOptions(data?.options || []) });
      })
      .catch((error) => {
        if (!cancelled && error?.cause?.name !== "AbortError") {
          setState({ loading: false, error: error?.message || "تعذر تحميل خيارات الفئة", options: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cachedGenderData]);

  return state;
};
const storefrontOriginalPrice = (product = {}, variant = {}) => {
  const pricing = getDisplayPricing(product, storefrontSalePricesEnabled, variant);
  return pricing.comparePrice || storefrontSellingPrice(product, variant) || 0;
};
const storefrontSellingPrice = (product = {}, variant = {}) =>
  Number(variant?.selling_price || variant?.price || product?.selling_price || product?.price || product?.regular_price || 0);
const displaySellingPrice = (product = {}, variant = {}) => {
  return getDisplayPricing(product, storefrontSalePricesEnabled, variant).price;
};
const resolveStorefrontPrice = (product = {}, variant = {}) => {
  const pricing = getDisplayPricing(product, storefrontSalePricesEnabled, variant);
  return {
    activePrice: pricing.price,
    comparePrice: pricing.comparePrice || 0,
    sellingPrice: pricing.price,
    originalPrice: pricing.comparePrice || 0,
    saleModeOn: pricing.isOnSale,
    discountPercent: pricing.discountPercent || 0,
  };
};
const fallbackProductImage = (event) => {
  if (event.currentTarget.dataset.fallbackApplied === "true") return;
  const originalSrc = String(event.currentTarget.dataset.originalSrc || "").trim();
  event.currentTarget.dataset.fallbackApplied = "true";
  if (isAiSupportDebugEnabled()) {
    console.warn("[storefront-ai] suggested product image failed", {
      src: event.currentTarget.currentSrc || event.currentTarget.src,
      alt: event.currentTarget.alt,
    });
  }
  event.currentTarget.removeAttribute("srcset");
  event.currentTarget.removeAttribute("sizes");
  if (originalSrc && event.currentTarget.src !== originalSrc) {
    event.currentTarget.src = originalSrc;
    return;
  }
  event.currentTarget.src = "/favicon.svg";
};
const safeStorefrontRecord = (value) => (value && typeof value === "object" ? value : {});
const variantHasStock = (variant = {}) => Number(safeStorefrontRecord(variant).stock || 0) > 0;
const variantPrimaryImage = (variant = {}) => {
  const safeVariant = safeStorefrontRecord(variant);
  const images = Array.isArray(safeVariant.images) ? safeVariant.images : Array.isArray(safeVariant.color_images) ? safeVariant.color_images : [];
  const primary = images.find((image) => image?.is_primary) || images[0] || null;
  return compactImageValue(primary?.image_url || primary?.preview || safeVariant.image_url || safeVariant.image || safeVariant.photo_url || safeVariant.thumbnail_url);
};
const variantImage = (variant = {}) => variantPrimaryImage(variant);
const variantImages = (variant = {}) => {
  const safeVariant = safeStorefrontRecord(variant);
  const images = Array.isArray(safeVariant.images) ? safeVariant.images : Array.isArray(safeVariant.color_images) ? safeVariant.color_images : [];
  return [
    ...images.map((image) => compactImageValue(image?.image_url || image?.preview || image?.url || "")),
    variantImage(safeVariant),
  ].filter(Boolean).reduce((acc, image) => (acc.includes(image) ? acc : [...acc, image]), []);
};
const cardImageCandidateValue = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.image_url || value.preview || value.url || value.src || value.image || value.photo_url || value.thumbnail_url || value.large || value.medium || value.small || "";
  }
  return "";
};
const cardImageAtIndex = (collection = [], index = 0) => {
  if (!Array.isArray(collection) || index < 0) return "";
  return cardImageCandidateValue(collection[index]);
};
const productCardResolvedImageCollection = (collection = []) =>
  (Array.isArray(collection) ? collection : [])
    .map((item) => resolveCardImageUrl(item))
    .filter(Boolean)
    .reduce((acc, image) => (acc.includes(image) ? acc : [...acc, image]), []);
const resolveCardImageUrl = (value = "") => {
  const resolved = compactImageValue(resolveProductImageUrl(cardImageCandidateValue(value)));
  if (!resolved || resolved === "/favicon.svg") return "";
  return resolved;
};
const variantColorName = (variant = {}) => {
  const safeVariant = safeStorefrontRecord(variant);
  return cleanDisplayText(safeVariant.color_name || safeVariant.edition_name || safeVariant.color || safeVariant.color_slug || "Default") || "Default";
};
const variantColorKey = (variant = {}) => {
  const safeVariant = safeStorefrontRecord(variant);
  // color_group_key first: two colours can share a visible name and still be two
  // different shoes, and this key is what the server cards are grouped by.
  const stable = safeVariant.color_group_key || safeVariant.colorGroupKey ||
    safeVariant.color_id || safeVariant.color_slug || safeVariant.edition_slug || variantColorName(safeVariant);
  return String(stable || "Default").trim().toLowerCase();
};
const firstVariantImage = (variants = []) => variantImage(variants.find((variant) => variantHasStock(variant) && variantImage(variant))) || variantImage(variants.find((variant) => variantImage(variant)));
const firstDisplayVariant = (variants = []) =>
  variants.find((variant) => variantHasStock(variant) && variantImage(variant)) ||
  variants.find((variant) => variantHasStock(variant)) ||
  variants.find((variant) => variantImage(variant)) ||
  variants[0];
const productCardColorScopedImages = (activeColorGroup = null, variant = null) => {
  const sameColorVariants = Array.isArray(activeColorGroup?.variants) ? activeColorGroup.variants : [];
  const sameColorVariantImages = sameColorVariants.flatMap((colorVariant) => [
    ...(Array.isArray(colorVariant?.images) ? colorVariant.images : []),
    ...(Array.isArray(colorVariant?.color_images) ? colorVariant.color_images : []),
    ...(Array.isArray(colorVariant?.gallery_images) ? colorVariant.gallery_images : []),
    ...(Array.isArray(colorVariant?.image_urls) ? colorVariant.image_urls : []),
    ...(Array.isArray(colorVariant?.additional_images) ? colorVariant.additional_images : []),
    colorVariant?.image_url,
    colorVariant?.image,
  ]);
  return productCardResolvedImageCollection([
    ...(Array.isArray(activeColorGroup?.images) ? activeColorGroup.images : []),
    ...sameColorVariantImages,
    ...(Array.isArray(variant?.images) ? variant.images : []),
    ...(Array.isArray(variant?.color_images) ? variant.color_images : []),
    ...(Array.isArray(variant?.gallery_images) ? variant.gallery_images : []),
    ...(Array.isArray(variant?.image_urls) ? variant.image_urls : []),
    ...(Array.isArray(variant?.additional_images) ? variant.additional_images : []),
  ]);
};
const productCardPrimaryImageFor = (product = {}, variant = null, activeColorGroup = null) => {
  const cardImages = productCardResolvedImageCollection([
    ...(Array.isArray(product?.images) ? product.images : []),
    ...(Array.isArray(product?.gallery_images) ? product.gallery_images : []),
    ...(Array.isArray(product?.image_urls) ? product.image_urls : []),
    ...(Array.isArray(product?.product_images) ? product.product_images : []),
    ...(Array.isArray(product?.color_images) ? product.color_images : []),
  ]);
  const variantImagesList = productCardColorScopedImages(activeColorGroup, variant);
  return (
    cardImages[0] ||
    variantImagesList[0] ||
    resolveCardImageUrl(activeColorGroup?.primaryImage) ||
    resolveCardImageUrl(activeColorGroup?.image_url) ||
    resolveCardImageUrl(variant?.image_url) ||
    resolveCardImageUrl(variant?.image) ||
    resolveCardImageUrl(product?.image_url) ||
    ""
  );
};
const displayImageForProduct = (product = {}, variant = null) => variantImage(variant || {}) || firstVariantImage(product.variants || []) || product.image_url || product.gallery_images?.[0];
const productCardSecondaryImageFor = (product = {}, variant = null, activeColorGroup = null, primaryImage = "") => {
  const primary = resolveCardImageUrl(primaryImage || productCardPrimaryImageFor(product, variant, activeColorGroup) || "");
  const cardImages = productCardResolvedImageCollection([
    ...(Array.isArray(product?.images) ? product.images : []),
    ...(Array.isArray(product?.gallery_images) ? product.gallery_images : []),
    ...(Array.isArray(product?.image_urls) ? product.image_urls : []),
    ...(Array.isArray(product?.product_images) ? product.product_images : []),
    ...(Array.isArray(product?.color_images) ? product.color_images : []),
  ]);
  const variantImagesList = productCardColorScopedImages(activeColorGroup, variant);
  const colorScopedCandidates = [
    variantImagesList[1],
    variantImagesList[0],
    cardImageAtIndex(activeColorGroup?.additional_images, 0),
    cardImageAtIndex(variant?.additional_images, 0),
  ];
  const hasColorScope = Boolean(activeColorGroup || variantColorName(variant || {}) !== "Default");
  const candidates = hasColorScope
    ? colorScopedCandidates
    : [...colorScopedCandidates, cardImages[1], cardImages[0]];
  for (const candidate of candidates) {
    const next = resolveCardImageUrl(candidate);
    if (next && next !== primary) return next;
  }
  return "";
};
const normalizeModelToken = (value = "") =>
  cleanDisplayText(value)
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const productVariantColorWords = (product = {}) => {
  const words = new Set([
    "black", "white", "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "beige", "grey", "gray", "silver", "gold", "navy", "burgundy", "maroon", "olive", "cream", "ivory", "tan", "camel", "mocha", "coffee", "charcoal", "volt", "cobalt", "aqua", "mint", "rose",
  ]);
  const visit = (value) => {
    normalizeModelToken(value).split(/\s+/).filter(Boolean).forEach((word) => words.add(word));
  };
  visit(product.color);
  visit(product.display_color);
  (Array.isArray(product.colors) ? product.colors : []).forEach(visit);
  (Array.isArray(product.variants) ? product.variants : []).forEach((variant) => {
    visit(variant.color);
    visit(variant.color_name);
    visit(variant.edition_name);
  });
  return words;
};
const normalizeProductModelName = (product = {}) => {
  const rawName = cleanDisplayText(product.model_name || product.base_model_name || product.parent_name || product.name || product.title || "");
  const words = productVariantColorWords(product);
  const stripped = normalizeModelToken(rawName)
    .split(/\s+/)
    .filter((word) => word && !words.has(word) && !/^color$/i.test(word) && !/^variant$/i.test(word))
    .join(" ")
    .replace(/\b(size)\s*\d+(\.\d+)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || normalizeModelToken(rawName) || String(product.id || product.parent_product_id || "");
};
const getProductGroupKey = (product = {}) => {
  const explicit = product.model_code || product.style_code || product.parent_model_code || product.parent_style_code || product.parent_product_id;
  if (explicit) return `explicit:${String(explicit).trim().toLowerCase()}`;
  const brand = normalizeModelToken(product.brand || product.manufacturer || "");
  const model = normalizeProductModelName(product);
  return `name:${brand}:${model}`;
};
const sortStorefrontColorCardsByModel = (products = []) => {
  const indexed = (Array.isArray(products) ? products : []).map((product, index) => ({
    product,
    index,
    groupKey: getProductGroupKey(product),
  }));
  const firstIndexByGroup = new Map();
  indexed.forEach((item) => {
    if (!firstIndexByGroup.has(item.groupKey)) firstIndexByGroup.set(item.groupKey, item.index);
  });
  return indexed
    .sort((a, b) =>
      (firstIndexByGroup.get(a.groupKey) ?? a.index) - (firstIndexByGroup.get(b.groupKey) ?? b.index) ||
      a.groupKey.localeCompare(b.groupKey, "en", { numeric: true }) ||
      String(a.product?.color_key || a.product?.display_color_key || a.product?.color || a.product?.display_color || "").localeCompare(
        String(b.product?.color_key || b.product?.display_color_key || b.product?.color || b.product?.display_color || ""),
        "en",
        { numeric: true }
      ) ||
      a.index - b.index
    )
    .map((item) => item.product);
};
const safeStockNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const productTotalStock = (product = {}) => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variantStock = variants.reduce(
    (sum, variant) =>
      sum + safeStockNumber(variant?.stock ?? variant?.quantity ?? variant?.inventory_stock ?? variant?.available_stock),
    0
  );
  const directStock = safeStockNumber(
    product?.total_stock ??
      product?.stock ??
      product?.inventory_stock ??
      product?.available_stock ??
      product?.quantity ??
      product?.inventory?.stock ??
      product?.inventory?.available_stock
  );
  return Number(directStock || variantStock || 0) || 0;
};
const productStock = (product = {}) => productTotalStock(product);
const isAvailableProduct = (product = {}) => productStock(product) > 0;
const stockScore = (product = {}) => productTotalStock(product);
const newestScore = (product = {}) => new Date(product.created_at || 0).getTime() || Number(product.id || 0);
const popularScore = (product = {}) => {
  const sold = Number(product.total_sold ?? product.sold_count ?? product.sales_count ?? product.order_count ?? product.orders_count ?? product.units_sold ?? 0);
  const viewed = Number(product.views_count ?? product.view_count ?? product.product_views ?? product.analytics?.views ?? 0);
  const featured = product.featured || product.is_featured || product.home_featured ? 1 : 0;
  return (Number.isFinite(sold) ? sold * 1000 : 0) +
    (Number.isFinite(viewed) ? viewed * 10 : 0) +
    (featured * 500) +
    Math.min(stockScore(product), 100);
};
const isOfferStory = (product = {}) =>
  product?.is_offer_story === true ||
  String(product?.is_offer_story || "").toLowerCase() === "true" ||
  product?.isOfferStory === true ||
  String(product?.isOfferStory || "").toLowerCase() === "true";
const isStorefrontVisibleOfferProduct = (product = {}) =>
  product?.is_storefront_visible !== false &&
  String(product?.is_storefront_visible || "").trim().toLowerCase() !== "false";
const normalizeOfferStoryProductTypeValue = (value = "") => {
  const normalized = storefrontLabelKey(value);
  if (["bag", "bags", "handbag", "handbags", "شنط", "شنطة", "شنطتي", "حقائب", "حقيبة", "حقيبه"].includes(normalized)) return "bags";
  if (["croc", "crocs", "كروكس"].includes(normalized)) return "crocs";
  if (["slipper", "slippers", "slide", "slides", "سليبر", "شباشب"].includes(normalized)) return "slippers";
  if (["sneaker", "sneakers", "سنيكرز"].includes(normalized)) return "sneakers";
  if (["shoe", "shoes", "أحذية", "حذاء", "احذية"].includes(normalized)) return "shoes";
  if (["running", "run", "رياضي", "جري"].includes(normalized)) return "running";
  if (["casual shoe", "casual shoes", "casual", "كاجوال", "كاجوال شوز"].includes(normalized)) return "casualshoes";
  return normalized.replace(/[\s_-]+/g, "");
};
const offerStoryProductTypeValues = (product = {}) => {
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|]+/)
      .map((entry) => normalizeOfferStoryProductTypeValue(entry))
      .filter(Boolean)
      .forEach((entry) => seen.add(entry));
  };
  visit(product.product_type);
  visit(product.productType);
  visit(product.type);
  visit(product.category);
  visit(product.categories);
  visit(product.tags);
  visit(product.labels);
  visit(product.classifications);
  return Array.from(seen);
};
const offerStoryProductGradeValues = (product = {}) => {
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|/]+/)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .forEach((entry) => seen.add(entry));
  };
  visit(product.grade);
  visit(product.grades);
  visit(product.quality);
  visit(product.condition);
  visit(product.conditions);
  return Array.from(seen);
};
const offerStoryColorKeyFromValue = (value = "") => normalizeOfferStoryProductTypeValue(value) || storefrontLabelKey(value);
const offerStoryColorNameFromValue = (value = "") => cleanDisplayText(
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
) || "";
const offerStoryColorImageFromEntry = (entry = {}) => compactImageValue(
  entry.image_url ||
    entry.image ||
    entry.photo_url ||
    entry.thumbnail_url ||
    entry.preview ||
    entry.url ||
    entry.src ||
    entry.color_image ||
    entry.colorImage ||
    ""
);
const offerStoryValueLooksLikeImage = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^data:image\//i.test(text)) return true;
  if (/^https?:\/\//i.test(text) || /^\/(?!\/)/.test(text) || /^\.\.?\//.test(text)) {
    return /\.(avif|gif|jpe?g|png|svg|webp)(\?.*)?$/i.test(text) || text.includes("://");
  }
  return false;
};
const offerStoryReadColorEntries = (source = {}) => {
  const entries = [];
  const pushEntry = (value, hints = {}) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => pushEntry(item, hints));
      return;
    }
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (!text) return;
      const key = offerStoryColorKeyFromValue(hints.key || hints.color || text);
      const color = offerStoryColorNameFromValue(hints.color || hints.key || text);
      entries.push({
        key,
        color,
        image: offerStoryValueLooksLikeImage(text) ? compactImageValue(text) : "",
        variants: [],
        source: null,
      });
      return;
    }
    if (typeof value !== "object") return;

    const hasDescriptor = Boolean(
      value.color ||
      value.color_name ||
      value.colorName ||
      value.color_slug ||
      value.colorSlug ||
      value.name ||
      value.title ||
      value.label ||
      value.value ||
      value.key ||
      value.image_url ||
      value.image ||
      value.photo_url ||
      value.thumbnail_url ||
      value.preview ||
      value.color_image ||
      value.colorImage ||
      value.variants ||
      value.items
    );

    if (!hasDescriptor) {
      Object.entries(value).forEach(([dictKey, dictValue]) => {
        pushEntry(dictValue, {
          key: dictKey,
          color: dictKey,
        });
      });
      return;
    }

    const colorValue = firstTextValue(
      value.color,
      value.color_name,
      value.colorName,
      value.color_slug,
      value.colorSlug,
      value.name,
      value.title,
      value.label,
      value.value,
      value.key,
      hints.color,
      hints.key
    );
    const key = offerStoryColorKeyFromValue(
      firstTextValue(
        // Same durable-key-first rule as variantColorKey, so a story entry and the
        // variants it owns land in one group instead of splitting in two.
        value.color_group_key,
        value.colorGroupKey,
        value.color_key,
        value.colorKey,
        value.key,
        value.slug,
        value.color,
        value.color_name,
        value.name,
        value.title,
        value.label,
        value.value,
        hints.key,
        hints.color
      )
    );
    const variants = [
      ...(Array.isArray(value.variants) ? value.variants : []),
      ...(Array.isArray(value.items) ? value.items : []),
    ];
    entries.push({
      key,
      color: offerStoryColorNameFromValue(colorValue || hints.color || key),
      image: offerStoryColorImageFromEntry(value) || compactImageValue(hints.image || ""),
      variants,
      source: value,
    });
  };

  pushEntry(source.color_cards);
  pushEntry(source.colors);
  pushEntry(source.available_colors);
  pushEntry(source.images_by_color);
  pushEntry(source.colorImages);

  return entries;
};
const offerStoryBuildStoryItems = (product = {}) => {
  const baseProduct = { ...product };
  const variants = Array.isArray(baseProduct.variants) ? baseProduct.variants.filter(Boolean) : [];
  const groups = new Map();
  const ensureGroup = (key, fallback = {}) => {
    const normalizedKey = String(key || "").trim().toLowerCase() || "default";
    if (!groups.has(normalizedKey)) {
      groups.set(normalizedKey, {
        key: normalizedKey,
        color: cleanDisplayText(fallback.color || fallback.name || fallback.label || fallback.key || "Default") || "Default",
        image: compactImageValue(fallback.image || fallback.image_url || ""),
        variants: [],
        source: fallback.source || null,
      });
    }
    const group = groups.get(normalizedKey);
    if (!group.color && (fallback.color || fallback.name || fallback.label)) group.color = cleanDisplayText(fallback.color || fallback.name || fallback.label) || group.color;
    if (!group.image && (fallback.image || fallback.image_url)) group.image = compactImageValue(fallback.image || fallback.image_url || "");
    if (!group.source && fallback.source) group.source = fallback.source;
    return group;
  };
  const addVariantToGroup = (variant = {}, fallbackKey = "") => {
    if (!variant || typeof variant !== "object") return;
    const variantKey = String(variantColorKey(variant) || fallbackKey || "").trim().toLowerCase() || "default";
    const group = ensureGroup(variantKey, {
      color: variantColorName(variant),
      image: variantPrimaryImage(variant),
    });
    if (!group.image) group.image = variantPrimaryImage(variant);
    group.variants.push(variant);
  };
  const colorEntries = offerStoryReadColorEntries(baseProduct);

  colorEntries.forEach((entry) => {
    const group = ensureGroup(entry.key, {
      color: entry.color,
      image: entry.image,
      source: entry.source,
    });
    if (entry.image && !group.image) group.image = entry.image;
    if (entry.source && !group.source) group.source = entry.source;
    (Array.isArray(entry.variants) ? entry.variants : []).forEach((variant) => addVariantToGroup(variant, entry.key));
  });

  variants.forEach((variant) => addVariantToGroup(variant));

  if (!groups.size && variants.length) {
    const fallbackVariant = firstDisplayVariant(variants);
    const group = ensureGroup("default", {
      color: variantColorName(fallbackVariant) || "Default",
      image: variantPrimaryImage(fallbackVariant) || imageFor(baseProduct.image_url || baseProduct.image || baseProduct.gallery_images?.[0] || ""),
    });
    variants.forEach((variant) => group.variants.push(variant));
    if (!group.image) group.image = variantPrimaryImage(fallbackVariant) || imageFor(baseProduct.image_url || baseProduct.image || baseProduct.gallery_images?.[0] || "");
  }

  if (!groups.size) {
    groups.set("default", {
      key: "default",
      color: "Default",
      image: compactImageValue(imageFor(baseProduct.image_url || baseProduct.image || baseProduct.gallery_images?.[0] || "")),
      variants: variants.slice(),
      source: null,
    });
  }

  const storyItems = Array.from(groups.values())
    .map((group) => {
      const groupVariants = Array.isArray(group.variants) ? group.variants.filter(Boolean) : [];
      const seenVariantKeys = new Set();
      const uniqueGroupVariants = groupVariants.filter((variant, index) => {
        const key = String(variant?.id || variant?.variant_id || variant?.edition_slug || variant?.sku || `${variant?.color || ""}:${variant?.size || ""}:${index}`).trim();
        if (!key || seenVariantKeys.has(key)) return false;
        seenVariantKeys.add(key);
        return true;
      });
      const sizes = sortProductSizes(
        Array.from(
          new Set(
            uniqueGroupVariants.flatMap((variant) => {
              const stockValue =
                variant?.stock ?? variant?.quantity ?? variant?.inventory_stock ?? variant?.available_stock ?? variant?.qty ?? variant?.available_qty;
              const hasStockField = stockValue !== undefined && stockValue !== null && String(stockValue).trim() !== "";
              if (hasStockField && Number(stockValue) <= 0) return [];
              const sizeValue = String(variant?.size || variant?.variant_size || variant?.selected_size || "").trim();
              return sizeValue ? [sizeValue] : [];
            })
          )
        )
      );
      const fallbackSizes = sizes.length ? sizes : sortProductSizes(
        Array.from(
          new Set(
            [
              ...(Array.isArray(group.source?.sizes) ? group.source.sizes : []),
              ...(Array.isArray(group.source?.available_sizes) ? group.source.available_sizes : []),
              ...(Array.isArray(group.source?.availableSizes) ? group.source.availableSizes : []),
            ].map((size) => String(size || "").trim()).filter(Boolean)
          )
        )
      );
      const storyVariant = offerStoryMatchingVariant({ variants: uniqueGroupVariants }, fallbackSizes[0] || "");
      const image = compactImageValue(
        group.image ||
          variantImage(storyVariant) ||
          variantImage(firstDisplayVariant(uniqueGroupVariants)) ||
          imageFor(baseProduct.image_url || baseProduct.image || baseProduct.gallery_images?.[0] || "")
      );
      const colorLabel = group.color && group.color !== "Default" ? group.color : "";
      const baseName = cleanDisplayText(baseProduct.name || baseProduct.title || "");
      const name = colorLabel ? `${baseName} - ${colorLabel}` : baseName;
      return {
        ...baseProduct,
        ...group.source,
        product: baseProduct,
        productId: baseProduct.id || baseProduct.product_id || "",
        color: colorLabel || group.color || "",
        colorKey: group.key,
        name,
        title: name,
        image,
        image_url: image,
        variant_image_url: image,
        sizes: fallbackSizes,
        variants: uniqueGroupVariants,
        storyVariant,
        selected_variant_id: storyVariant?.id || baseProduct.selected_variant_id || baseProduct.display_variant_id || "",
        display_variant_id: storyVariant?.id || baseProduct.display_variant_id || "",
        color_key: group.key,
        display_color_key: group.key,
        display_color: colorLabel || group.color || "",
        typeValues: offerStoryProductTypeValues(baseProduct),
        gradeValues: offerStoryProductGradeValues(baseProduct),
      };
    })
    .filter((item) => item && ((Array.isArray(item.variants) && item.variants.length > 0) || !variants.length || item.color || item.display_color));

  return sortStorefrontColorCardsByModel(storyItems);
};
const extractOfferSizes = (product = {}) => {
  const seen = new Set();
  const addSize = (value, { respectStock = false, stockValue } = {}) => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    if (respectStock && Number.isFinite(Number(stockValue)) && Number(stockValue) <= 0) return;
    seen.add(key);
  };
  const visit = (value, options = {}) => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, options));
      return;
    }
    if (value && typeof value === "object") {
      const objectValues = [
        value.size,
        value.eu,
        value.label,
        value.value,
        value.name,
        value.variant_size,
        value.selected_size,
        value.available_size,
        value.available_sizes,
      ];
      objectValues.forEach((entry) => visit(entry, options));
      return;
    }
    String(value || "")
      .split(/[,\n|]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const normalized = entry.replace(/\s*[(-].*$/, "").trim() || entry;
        addSize(normalized, options);
      });
  };

  const walkVariantCollection = (collection, options = {}) => {
    (Array.isArray(collection) ? collection : []).forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const stockValue =
        entry.stock ?? entry.quantity ?? entry.inventory_stock ?? entry.available_stock ?? entry.qty ?? entry.available_qty;
      const hasStockField = stockValue !== undefined && stockValue !== null && String(stockValue).trim() !== "";
      visit(
        [
          entry.size,
          entry.variant_size,
          entry.selected_size,
          entry.eu,
          entry.label,
          entry.value,
          entry.size_label,
        ],
        { respectStock: hasStockField, stockValue }
      );
      visit(entry.options, options);
      visit(entry.sizes, options);
      visit(entry.items, options);
      visit(entry.variants, options);
      visit(entry.color_cards, options);
    });
  };

  walkVariantCollection(product?.variants);
  walkVariantCollection(product?.color_cards);
  walkVariantCollection(product?.variant_matrix);
  walkVariantCollection(product?.inventory_variants);
  walkVariantCollection(product?.available_options);

  visit(product?.sizes);
  visit(product?.available_sizes);
  visit(product?.availableSizes);
  visit(product?.size);
  visit(product?.selected_size);
  visit(product?.variant_size);
  visit(product?.variant_matrix);
  visit(product?.inventory_variants);
  visit(product?.available_options);
  visit(product?.color_cards);

  return sortProductSizes(Array.from(seen));
};
const offerStoryMatchingVariant = (product = {}, selectedSize = "") => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const targetSize = String(selectedSize || "").trim().toLowerCase();
  const candidates = targetSize
    ? variants.filter((variant) => String(variant?.size || "").trim().toLowerCase() === targetSize && variantHasStock(variant))
    : variants.filter((variant) => variantHasStock(variant));
  return candidates[0] || firstDisplayVariant(variants) || null;
};
const offerStoryProductMatches = (product = {}, selectedSize = "", selectedType = "", selectedGrade = "") => {
  if (!isStorefrontVisibleOfferProduct(product)) return false;
  const sizeKey = String(selectedSize || "").trim().toLowerCase();
  if (sizeKey) {
    const sizeValues = (Array.isArray(product?.sizes) && product.sizes.length ? product.sizes : extractOfferSizes(product)).map((value) => String(value || "").trim().toLowerCase());
    if (!sizeValues.includes(sizeKey)) return false;
  }
  const typeKey = String(selectedType || "").trim().toLowerCase();
  if (typeKey) {
    const typeValues = (Array.isArray(product?.typeValues) && product.typeValues.length ? product.typeValues : offerStoryProductTypeValues(product)).map((value) => String(value || "").trim().toLowerCase());
    if (!typeValues.includes(typeKey)) return false;
  }
  const gradeKey = String(selectedGrade || "").trim().toLowerCase();
  if (gradeKey) {
    const gradeValues = offerStoryProductGradeValues(product).map((value) => String(value || "").trim().toLowerCase());
    if (!gradeValues.includes(gradeKey)) return false;
  }
  return true;
};
const LAST_PIECE_MAX_STOCK = 3;
const isLastPieceProduct = (product = {}) => {
  const totalStock = productTotalStock(product);
  return totalStock > 0 && totalStock <= LAST_PIECE_MAX_STOCK;
};
const normalizeAudienceValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["men", "man", "male", "mens", "رجالي", "رجال"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies", "lady", "حريمي", "نساء", "بناتي"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls", "أطفال", "طفل"].includes(normalized)) return "kids";
  return "";
};
const productAudienceValues = (product = {}) => {
  const seen = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || value === undefined) return;
    String(value)
      .split(/[,\n|]+/)
      .map((entry) => normalizeAudienceValue(entry))
      .filter(Boolean)
      .forEach((entry) => seen.add(entry));
  };
  (Array.isArray(product.variants) ? product.variants : []).forEach((variant) => {
    visit(variant.audience);
    visit(variant.variant_audience);
  });
  if (seen.size > 0) return Array.from(seen);
  visit(product.audience);
  visit(product.audiences);
  visit(product.gender);
  visit(product.genders);
  visit(product.product_audience);
  visit(product.product_audiences);
  visit(product.target_audience);
  return Array.from(seen);
};
const isExclusiveCategoryAudience = (product = {}, audience = "") => {
  const audiences = productAudienceValues(product);
  if (!audiences.includes(audience)) return false;
  if (audience === "men" || audience === "women") {
    return !(audiences.includes("men") && audiences.includes("women"));
  }
  return true;
};
const categoryCardProductText = (product = {}) =>
  [
    product.name,
    product.name_ar,
    product.title,
    product.category,
    product.product_type,
    product.productType,
  ]
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") return Object.values(value);
      return value;
    })
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
const categoryCardHasCrocs = (product = {}) => {
  const text = categoryCardProductText(product);
  return text.includes("crocs") || text.includes("crocband") || text.includes("croc");
};
const productCardKey = (product = {}, fallback = "") =>
  product.card_id ||
  product.storefront_card_id ||
  [product.id, product.color_key || product.display_color_key || product.selected_variant_id || product.display_variant_id || product.matched_variant_id || fallback].filter(Boolean).join(":");
const productIdentityKey = (product = {}, fallback = "") =>
  String(product.product_id || product.id || product.slug || productCardKey(product, fallback) || fallback || "");
const uniqueProductsByIdentity = (products = []) => {
  const seen = new Set();
  return (Array.isArray(products) ? products : []).filter((product, index) => {
    const key = productIdentityKey(product, index);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const pickHomeProducts = ({ preferred = [], fallback = [], exclude = new Set(), limit = 8 } = {}) => {
  const picked = [];
  const pickedKeys = new Set();
  const add = (product, index) => {
    const key = productIdentityKey(product, index);
    if (!key || pickedKeys.has(key)) return;
    if (exclude.has(key)) return;
    picked.push(product);
    pickedKeys.add(key);
  };
  (Array.isArray(preferred) ? preferred : []).forEach(add);
  if (picked.length < limit) (Array.isArray(fallback) ? fallback : []).forEach(add);
  return picked.slice(0, limit);
};
const getProductColorGroups = (product = {}) => {
  const groups = new Map();
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  variants.forEach((variant) => {
    const key = variantColorKey(variant);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        color: variantColorName(variant),
        image_url: variantPrimaryImage(variant),
        variants: [],
      });
    }
    const group = groups.get(key);
    if (!group.image_url) group.image_url = variantPrimaryImage(variant);
    group.variants.push(variant);
  });
  return Array.from(groups.values()).filter((group) => group.variants.some((variant) => variantHasStock(variant)));
};
const getActiveColorGroup = (product = {}, selectedColorId = "") => {
  const groups = getProductColorGroups(product);
  const selectedKey = String(selectedColorId || "").trim().toLowerCase();
  if (selectedKey) {
    const selectedGroup = groups.find((group) => String(group.key || "") === selectedKey);
    if (selectedGroup) return selectedGroup;
  }
  const displayedVariant = firstDisplayVariant(Array.isArray(product?.variants) ? product.variants : []);
  if (displayedVariant) {
    const selectedGroup = groups.find((group) => group.variants.includes(displayedVariant));
    if (selectedGroup) return selectedGroup;
  }
  return groups[0] || null;
};
const getSizesForColorGroup = (activeColorGroup = {}, product = {}) => {
  const variants = Array.isArray(activeColorGroup?.variants) ? activeColorGroup.variants : [];
  if (isCrocsProduct(product)) {
    return buildCrocsStorefrontSizeOptions(variants.filter(variantHasStock)).map((option) => ({
      size: option.displaySize,
      originalSize: option.originalSize,
      collision: option.collision,
      variant: option.variant,
    }));
  }
  const sizes = new Map();
  variants.forEach((variant) => {
    const size = String(variant?.size || "").trim();
    if (!size || !variantHasStock(variant) || sizes.has(size)) return;
    sizes.set(size, { size, variant });
  });
  return Array.from(sizes.values());
};
const getSizeOptionsForColorGroup = (activeColorGroup = {}, product = {}) => {
  const variants = Array.isArray(activeColorGroup?.variants) ? activeColorGroup.variants : [];
  if (isCrocsProduct(product)) {
    return buildCrocsStorefrontSizeOptions(variants).map((option) => ({
      size: option.displaySize,
      originalSize: option.originalSize,
      collision: option.collision,
      variant: option.variant,
      hasStock: variantHasStock(option.variant),
    }));
  }
  const sizes = new Map();
  variants.forEach((variant) => {
    const size = String(variant?.size || "").trim();
    if (!size || sizes.has(size)) return;
    sizes.set(size, { size, variant, hasStock: variantHasStock(variant) });
  });
  return Array.from(sizes.values());
};
const productCardBrandLabel = (product = {}) => firstTextValue(
  product.brand_name,
  product.brand,
  product.product_brand,
  product.manufacturer_name,
  product.manufacturer
);
const productCardBrandFilterUrl = (product = {}) => {
  const brandLabel = String(productCardBrandLabel(product) || "").trim();
  if (!brandLabel) return "";
  return productsPath({ brand: brandLabel });
};
const productCardIsNew = (product = {}) => {
  const createdAt = new Date(product.created_at || product.createdAt || 0).getTime();
  return Number.isFinite(createdAt) && createdAt > 0 && (Date.now() - createdAt) <= (1000 * 60 * 60 * 24 * 40);
};

const repairedDefaultEgyptShippingLocations = defaultEgyptShippingLocations;

const OrderInvoiceCard = lazy(() => import("../shared/components/invoices/OrderInvoiceCard"));
const Select = lazy(() => import("react-select"));
const LazyFiltersDrawer = lazy(() => Promise.resolve({ default: MobileFilterDrawer }));
const LazyStorefrontProductListingPage = lazy(() =>
  import("./pages/StorefrontProductListingPage.jsx")
    .then((module) => ({ default: module.StorefrontProductListingPage }))
    .catch((error) => {
      recoverFromChunkLoadError(error);
      throw error;
    })
);
const LazyStorefrontProductDetailPage = lazy(() => import("./pages/StorefrontProductDetailPage.jsx").then((module) => ({ default: module.StorefrontProductDetailPage })));
const LazyProductCardVariantSheet = lazy(() => Promise.resolve({ default: ProductCardVariantSheet }));
const LazyProductDetailsVariantSheet = lazy(() => Promise.resolve({ default: ProductDetailsVariantSheet }));
const LazyStorefrontCheckoutSummary = lazy(() => import("./components/StorefrontCheckoutSummary"));
const LazyStorefrontProductGallery = lazy(() => import("./components/StorefrontProductGallery"));
const LazyStorefrontCartPage = lazy(() => import("./pages/StorefrontAsyncPages").then((module) => ({ default: module.CartPageRoute })));
const LazyStorefrontTrackOrderPage = lazy(() => import("./pages/StorefrontAsyncPages").then((module) => ({ default: module.TrackOrderPage })));
const LazyStorefrontAccountPage = lazy(() => import("./pages/StorefrontAccountPage.jsx").then((module) => ({ default: module.StorefrontAccountPage })));
const LazyStorefrontWishlistPage = lazy(() => import("./pages/StorefrontAsyncPages").then((module) => ({ default: module.WishlistPageRoute })));
const LazyStorefrontRecentPage = lazy(() => import("./pages/StorefrontAsyncPages").then((module) => ({ default: module.RecentPageRoute })));
const LazyStorefrontSizeGuidePage = lazy(() => import("./pages/StorefrontSizeGuidePage.jsx").then((module) => ({ default: module.default })));
const LazyOrderConfirmationActionPage = lazy(() => import("./pages/OrderConfirmationActionPage.jsx").then((module) => ({ default: module.OrderConfirmationActionPage })));

const CART_KEY = "storefront.cart";
const WISHLIST_KEY = "storefront.wishlist";
const RECENT_KEY = "storefront.recent";
const PROFILE_KEY = "storefront.profile";
const STOREFRONT_THEME_KEY = "storefront.theme";
const storefrontGetCache = new Map();
const storefrontGetInFlight = new Map();
const storefrontProductDetailsCache = new Map();
const storefrontProductDetailsInFlight = new Map();
const storefrontPrefetchedDetails = new Set();
const STOREFRONT_GET_CACHE_TTL_MS = 60 * 1000;
const STOREFRONT_PRODUCTS_CACHE_TTL_MS = 30 * 1000;
const STOREFRONT_HOME_CACHE_TTL_MS = 60 * 1000;
const STOREFRONT_HOME_MIRROR_FILTER_SLUG = "mirror_original";
const STOREFRONT_HOME_REQUEST_URL = `/storefront/home?quality_slug=${STOREFRONT_HOME_MIRROR_FILTER_SLUG}&in_stock=1&limit=12&catalog=mirror-v3`;
const STOREFRONT_HOME_PERSISTED_CACHE_KEY = "storefront.home.bootstrap.v3.mirror_original";
const STOREFRONT_BRANDS_CACHE_TTL_MS = 10 * 60 * 1000;
const STOREFRONT_GENDER_CACHE_TTL_MS = 10 * 60 * 1000;
const STOREFRONT_PRODUCT_DETAILS_CACHE_TTL_MS = 60 * 1000;
const STOREFRONT_PREFETCH_LIMIT = 12;
const storefrontDebugLog = (label, payload = {}) => {
  if (!import.meta.env.DEV) return;
  console.log(label, payload);
};
const persistStorefrontHome = (data) => {
  if (typeof window === "undefined" || !data) return;
  try {
    window.localStorage.setItem(STOREFRONT_HOME_PERSISTED_CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // The memory cache still works if storage is unavailable or full.
  }
};
const cachedStorefrontGet = (url, { ttlMs = STOREFRONT_GET_CACHE_TTL_MS, forceRefresh = false, persist = false } = {}) => {
  if (ttlMs <= 0) {
    storefrontDebugLog("[storefront-cache-miss]", { url, ttlMs, strategy: "no-store" });
    return api.get(url, { cache: "no-store", headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  }
  const now = Date.now();
  const cached = storefrontGetCache.get(url);
  if (!forceRefresh && cached && now - cached.at < ttlMs) {
    storefrontDebugLog("[storefront-cache-hit]", { url, ttlMs, ageMs: now - cached.at });
    return Promise.resolve(cached.data);
  }
  if (storefrontGetInFlight.has(url)) {
    storefrontDebugLog("[storefront-cache-hit]", { url, ttlMs, strategy: "in-flight" });
    return storefrontGetInFlight.get(url);
  }
  storefrontDebugLog("[storefront-cache-miss]", { url, ttlMs, strategy: "network" });
  const request = api.get(url)
    .then((data) => {
      storefrontGetCache.set(url, { at: Date.now(), data });
      if (persist) persistStorefrontHome(data);
      return data;
    })
    .finally(() => {
      storefrontGetInFlight.delete(url);
    });
  storefrontGetInFlight.set(url, request);
  return request;
};
const prefetchStorefrontProducts = (params = {}) =>
  cachedStorefrontGet(buildStorefrontProductsRequestUrl(params), { ttlMs: STOREFRONT_PRODUCTS_CACHE_TTL_MS })
    .catch(() => null);
const extractStorefrontProductsFromResponse = (response) => {
  const normalizePriceAliases = (product = {}) => {
    if (!product || typeof product !== "object") return product;
    const salePrice = product.sale_price ?? product.salePrice ?? product.discounted_price ?? product.discountedPrice ?? null;
    const sellingPrice = product.selling_price ?? product.sellingPrice ?? product.price ?? null;
    const compareAtPrice = product.compare_at_price ?? product.compareAtPrice ?? product.original_price ?? product.originalPrice ?? null;
    const asPrice = (value) => {
      const parsed = parseStorefrontPriceValue(value);
      return parsed > 0 ? parsed : value;
    };
    const next = { ...product };
    if (salePrice !== null && salePrice !== undefined) {
      next.sale_price = asPrice(salePrice);
      next.salePrice = asPrice(salePrice);
    }
    if (sellingPrice !== null && sellingPrice !== undefined) {
      next.selling_price = asPrice(sellingPrice);
      next.sellingPrice = asPrice(sellingPrice);
      if (next.price === undefined || next.price === null || String(next.price).trim() === "") next.price = asPrice(sellingPrice);
    }
    if (compareAtPrice !== null && compareAtPrice !== undefined) {
      next.compare_at_price = asPrice(compareAtPrice);
      next.compareAtPrice = asPrice(compareAtPrice);
      next.original_price = asPrice(compareAtPrice);
      next.originalPrice = asPrice(compareAtPrice);
    }
    if (next.discounted_price === undefined && salePrice !== null && salePrice !== undefined) next.discounted_price = asPrice(salePrice);
    if (next.discountedPrice === undefined && salePrice !== null && salePrice !== undefined) next.discountedPrice = asPrice(salePrice);
    return next;
  };
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];
  if (Array.isArray(response.products)) return response.products.map(normalizePriceAliases);
  if (Array.isArray(response.items)) return response.items.map(normalizePriceAliases);
  if (Array.isArray(response.data)) return response.data.map(normalizePriceAliases);
  if (response.data && typeof response.data === "object") {
    if (Array.isArray(response.data.products)) return response.data.products.map(normalizePriceAliases);
    if (Array.isArray(response.data.items)) return response.data.items.map(normalizePriceAliases);
    if (Array.isArray(response.data.data)) return response.data.data.map(normalizePriceAliases);
  }
  return [];
};
const getCachedStorefrontGetData = (url, { ttlMs = STOREFRONT_GET_CACHE_TTL_MS } = {}) => {
  const cached = storefrontGetCache.get(url);
  if (!cached) return null;
  return Date.now() - cached.at < ttlMs ? cached.data : null;
};
const getCachedProductDetails = (identifier, { ttlMs = STOREFRONT_PRODUCT_DETAILS_CACHE_TTL_MS } = {}) => {
  const key = String(identifier || "").trim();
  if (!key) return null;
  const cached = storefrontProductDetailsCache.get(key);
  if (!cached) return null;
  const ageMs = Date.now() - cached.at;
  if (ageMs >= ttlMs) {
    storefrontProductDetailsCache.delete(key);
    return null;
  }
  storefrontDebugLog("[storefront-cache-hit]", { url: `/storefront/products/resolve/${encodeURIComponent(key)}`, ttlMs, ageMs, strategy: "product-details-memory" });
  return cached.data;
};
const setCachedProductDetails = (identifier, data) => {
  const key = String(identifier || "").trim();
  if (!key || !data) return;
  storefrontProductDetailsCache.set(key, { at: Date.now(), data });
};
const cleanupStorefrontStorage = () => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    [
      CART_KEY,
      WISHLIST_KEY,
      RECENT_KEY,
      PROFILE_KEY,
    ].forEach((key) => window.localStorage.removeItem(key));
    Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter(Boolean).forEach((key) => {
      if (STOREFRONT_CACHE_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`) || key.startsWith(`${prefix}:`))) {
        window.localStorage.removeItem(key);
      }
    });
  } catch {
    // Storage cleanup is best-effort in restricted browser contexts.
  }
};
const getSuccessMessages = () => {
  const messages = i18n.t("storefront.toasts.successMessages", { returnObjects: true });
  return Array.isArray(messages) && messages.length ? messages : ["اختيار ممتاز", "طلبك يتم تجهيزه الآن", "اختيار قوي", "سنجهزه لك بأسرع وقت"];
};



const storefrontApi = {
  peekProductDetails(identifier, options = {}) {
    const routeValue = String(identifier || "");
    const ttlMs = Number(options?.ttlMs || STOREFRONT_PRODUCT_DETAILS_CACHE_TTL_MS);
    return getCachedProductDetails(routeValue, { ttlMs });
  },
  cacheProductDetails(identifier, data) {
    const routeValue = String(identifier || "");
    if (routeValue && data) setCachedProductDetails(routeValue, data);
    return data;
  },
  getProductDetails(identifier, options = {}) {
    const routeValue = String(identifier || "");
    const { ttlMs: ttlMsInput, allowCache = true, ...requestOptions } = options || {};
    const ttlMs = Number(ttlMsInput || STOREFRONT_PRODUCT_DETAILS_CACHE_TTL_MS);
    const cached = allowCache ? getCachedProductDetails(routeValue, { ttlMs }) : null;
    if (cached) return Promise.resolve(cached);
    if (allowCache && storefrontProductDetailsInFlight.has(routeValue)) {
      storefrontDebugLog("[storefront-cache-hit]", {
        url: `/storefront/products/resolve/${encodeURIComponent(routeValue)}`,
        ttlMs,
        strategy: "product-details-in-flight",
      });
      return storefrontProductDetailsInFlight.get(routeValue);
    }
    const endpoint = `/storefront/products/resolve/${encodeURIComponent(routeValue)}`;
    const apiUrl = `${API_BASE_URL}${endpoint}`;
    if (storefrontDebugEnabled()) console.log("[storefront-product] resolver request", {
      identifier: routeValue,
      routeIdentifier: routeValue,
      endpoint,
      resolverUrl: apiUrl,
      apiUrl,
      apiBaseUrl: API_BASE_URL,
    });
    storefrontDebugLog("[storefront-cache-miss]", {
      url: endpoint,
      ttlMs,
      strategy: allowCache ? "product-details-network" : "product-details-no-store",
    });
    const request = api.get(endpoint, {
      ...requestOptions,
      debugLabel: "storefront-product-details",
    }).then((data) => {
      if (allowCache) setCachedProductDetails(routeValue, data);
      return data;
    }).finally(() => {
      storefrontProductDetailsInFlight.delete(routeValue);
    });
    if (allowCache) storefrontProductDetailsInFlight.set(routeValue, request);
    return request;
  },
};
const prefetchStorefrontProductDetails = (identifier) => {
  const key = String(identifier || "").trim();
  if (!key) return Promise.resolve(null);
  if (storefrontPrefetchedDetails.has(key)) {
    return storefrontApi.getProductDetails(key, { ttlMs: STOREFRONT_PRODUCT_DETAILS_CACHE_TTL_MS });
  }
  if (storefrontPrefetchedDetails.size >= STOREFRONT_PREFETCH_LIMIT) return Promise.resolve(null);
  storefrontPrefetchedDetails.add(key);
  storefrontDebugLog("[storefront-prefetch-count]", {
    count: storefrontPrefetchedDetails.size,
    identifier: key,
  });
  return storefrontApi.getProductDetails(key, { ttlMs: STOREFRONT_PRODUCT_DETAILS_CACHE_TTL_MS }).catch(() => {
    storefrontPrefetchedDetails.delete(key);
    return null;
  });
};
const readPersistedStorefrontHome = () => {
  if (typeof window === "undefined") return null;
  try {
    const cached = JSON.parse(window.localStorage.getItem(STOREFRONT_HOME_PERSISTED_CACHE_KEY) || "null");
    return cached?.data || null;
  } catch {
    return null;
  }
};
const extractProductPayload = (payload = {}) => {
  const hasIdentity = (candidate) =>
    Boolean(
      candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate) &&
        (candidate.id ||
          candidate.product_id ||
          candidate.productId ||
          candidate.slug ||
          candidate.product_slug ||
          candidate.canonical_slug ||
          candidate.name ||
          candidate.title)
    );
  const queue = [
    payload?.product,
    payload?.data?.product,
    payload?.item,
    payload?.data?.item,
    payload?.payload?.product,
    payload?.payload?.item,
    payload?.payload?.data,
    payload?.data,
    payload?.responseBody?.product,
    payload?.responseBody?.item,
    payload?.responseBody?.data,
    payload?.result?.product,
    payload?.result?.item,
    payload?.result?.data,
    payload,
  ].filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
  const visited = new Set();
  while (queue.length) {
    const candidate = queue.shift();
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || visited.has(candidate)) continue;
    visited.add(candidate);
    if (hasIdentity(candidate)) return candidate;
    const nextCandidates = [
      candidate.product,
      candidate.data,
      candidate.item,
      candidate.payload,
      candidate.responseBody,
      candidate.result,
    ].filter((nextCandidate) => nextCandidate && typeof nextCandidate === "object" && !Array.isArray(nextCandidate));
    queue.push(...nextCandidates);
  }
  return null;
};
const productFromDetailsResponse = (data = {}) => extractProductPayload(data);
const MANUAL_CITY_AREA_LABEL = "الاختيار اليدوي";
const governorateCityAreas = repairedDefaultEgyptShippingLocations.reduce((acc, location) => {
  const governorate = String(location.governorate_name_ar || location.governorate_name_en || "").trim();
  const area = String(location.area_name_ar || location.area_name_en || location.city_name_ar || location.city_name_en || "").trim();
  if (!governorate || !area) return acc;
  const bucket = acc[governorate] || (acc[governorate] = []);
  if (!bucket.includes(area)) bucket.push(area);
  return acc;
}, {});
const governorates = Object.keys(governorateCityAreas);
const normalizeCheckoutLocations = (locations = []) => {
  const source = Array.isArray(locations) && locations.length ? locations : repairedDefaultEgyptShippingLocations;
  return source
    .map((location, index) => ({
      id: String(location.id || location.area_id || `location-${index + 1}`).trim(),
      governorate_id: String(location.governorate_id || "").trim(),
      governorate_name_en: String(location.governorate_name_en || location.governorate || "").trim(),
      governorate_name_ar: String(location.governorate_name_ar || "").trim(),
      city_id: String(location.city_id || "").trim(),
      city_name_en: String(location.city_name_en || location.city || "").trim(),
      city_name_ar: String(location.city_name_ar || "").trim(),
      area_id: String(location.area_id || location.location_id || "").trim(),
      area_name_en: String(location.area_name_en || location.area || location.district || "").trim(),
      area_name_ar: String(location.area_name_ar || "").trim(),
      provider_location_code: String(location.provider_location_code || location.zone_code || "").trim(),
      provider: String(location.provider || "manual").trim(),
      active: location.active !== false,
    }))
    .filter((location) => location.active && (location.governorate_name_en || location.governorate_name_ar));
};
const checkoutLocationName = (location = {}, lang = "ar", scope = "area") => {
  const prefix = scope === "governorate" ? "governorate" : scope === "city" ? "city" : "area";
  return normalizeLanguage(lang) === "ar"
    ? location[`${prefix}_name_ar`] || location[`${prefix}_name_en`] || ""
    : location[`${prefix}_name_en`] || location[`${prefix}_name_ar`] || "";
};
const uniqueCheckoutLocations = (locations, key, filter = () => true) => {
  const seen = new Set();
  return locations.filter((location) => {
    if (!filter(location)) return false;
    const value = location[key];
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
};
const normalizeCheckoutPickerText = (value = "") =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u0625\u0623\u0622\u0627]/g, "\u0627")
    .replace(/[\u0629]/g, "\u0647")
    .replace(/[\u0649]/g, "\u064a")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const buildBostaPickerOption = (item = {}, scope = "city", lang = "ar") => {
  const nameAr = String(item.name_ar || item.governorate_name_ar || item.city_name_ar || item.area_name_ar || "").trim();
  const nameEn = String(item.name_en || item.governorate_name_en || item.city_name_en || item.area_name_en || "").trim();
  const label = normalizeLanguage(lang) === "ar" ? (nameAr || nameEn) : (nameEn || nameAr);
  const secondary = [nameAr && nameAr !== label ? nameAr : "", nameEn && nameEn !== label ? nameEn : ""].filter(Boolean).join(" / ");
  const id = String(item.id || item.value || item.districtId || item.zoneId || item.cityId || item.governorateId || "").trim();
  const value = String(item.value || item.id || item.districtId || item.zoneId || item.cityId || item.governorateId || id || "").trim();
  const districtId = String(item.districtId || item.district_id || item.provider_district_id || item.providerDistrictId || item.district || "").trim();
  const name = label || id;
  const searchText = normalizeCheckoutPickerText([
    nameAr,
    nameEn,
    item.provider_city_id,
    item.provider_zone_id,
    item.provider_district_id,
    item.code,
    item.zone_code,
    item.governorate_name_en,
    item.governorate_name_ar,
    item.name,
    item.district,
    item.district_name,
    item.district_name_ar,
    item.district_name_en,
  ].filter(Boolean).join(" "));
  return {
    id,
    value,
    districtId,
    name,
    nameAr,
    nameEn,
    label: label || id,
    secondary,
    searchText,
    scope,
    raw: item,
  };
};
const buildBostaPickerOptions = (items = [], scope = "city", lang = "ar") => items.map((item) => buildBostaPickerOption(item, scope, lang)).filter((option) => option.id || option.label);
const matchBostaPickerOption = (options = [], source = {}) => {
  const savedIds = [
    source.shipping_district_id,
    source.district_id,
    source.bosta_district_id,
    source.provider_district_id,
    source.id,
    source.value,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const savedNames = [
    source.district,
    source.district_name,
    source.district_name_ar,
    source.district_name_en,
    source.area,
    source.area_name,
    source.area_name_ar,
    source.area_name_en,
    source.city_area,
  ].map((value) => normalizeCheckoutPickerText(value)).filter(Boolean);
  return options.find((option) => {
    const optionIds = [
      option.id,
      option.value,
      option.districtId,
      option.raw?.district_id,
      option.raw?.provider_district_id,
      option.raw?.id,
    ].map((value) => String(value || "").trim()).filter(Boolean);
    if (savedIds.some((id) => optionIds.some((optionId) => String(optionId) === String(id)))) return true;
    if (!savedNames.length) return false;
    const optionNames = [
      option.name,
      option.nameAr,
      option.nameEn,
      option.label,
      option.raw?.name,
      option.raw?.name_ar,
      option.raw?.name_en,
      option.raw?.district,
      option.raw?.district_name,
      option.raw?.district_name_ar,
      option.raw?.district_name_en,
    ].map((value) => normalizeCheckoutPickerText(value)).filter(Boolean);
    return savedNames.some((savedName) => optionNames.some((optionName) => optionName === savedName));
  }) || null;
};
const DEFAULT_STOREFRONT_PAYMENT_SETTINGS = {
  instapay: {
    enabled: true,
    displayName: "InstaPay",
    paymentUrl: "https://ipn.eg/S/maged.helal/instapay/5BEvfH",
    handle: "01000000000@instapay",
    logoUrl: "",
    helperText: "",
  },
  vodafoneCash: {
    enabled: true,
    displayName: "Vodafone Cash",
    number: "01000000000",
    logoUrl: "",
    helperText: "",
  },
  shippingConfirmation: {
    enabled: true,
    amount: 75,
    label: "Shipping confirmation amount",
  },
};
const getPaymentMethods = (paymentSettings = DEFAULT_STOREFRONT_PAYMENT_SETTINGS) => [
  {
    id: "cod",
    title: sfText("storefront.checkout.payment.cod.title"),
    text: sfText("storefront.checkout.payment.cod.text"),
  },
  {
    id: "shipping_confirmation",
    title: paymentSettings.shippingConfirmation?.label || sfText("storefront.checkout.payment.shippingConfirmation.title"),
    text: sfText("storefront.checkout.payment.shippingConfirmation.text"),
  },
  {
    id: "instapay",
    title: paymentSettings.instapay?.displayName || "InstaPay",
    text: sfText("storefront.checkout.transfer.instantBankTransfer"),
  },
  {
    id: "vodafone_cash",
    title: paymentSettings.vodafoneCash?.displayName || "Vodafone Cash",
    text: sfText("storefront.checkout.transfer.vodafoneWallet"),
  },
];
const INSTA_PAY_QR_URL = import.meta.env.VITE_INSTAPAY_QR_URL || "";
const VODAFONE_CASH_QR_URL = import.meta.env.VITE_VODAFONE_CASH_QR_URL || "";
const storefrontDebugEnabled = () => ["1", "true", "yes", "on"].includes(String(import.meta.env?.VITE_ERP_PERF_DEBUG || import.meta.env?.VITE_STOREFRONT_DEBUG || "").toLowerCase());
const paymentBrandLogos = {
  instapay: { webp: instaPayLogoWebp, png: instaPayLogo },
  vodafone_cash: { webp: vodafoneCashLogoWebp, png: vodafoneCashLogo },
};
const normalizeStorefrontPaymentSettings = (settings = {}) => {
  const text = (value, fallback = "") => String(value ?? fallback ?? "").trim();
  const number = (value, fallback = 0) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : Number(fallback || 0);
  };
  const bool = (value, fallback = true) => {
    if (value === undefined || value === null || value === "") return Boolean(fallback);
    if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
    return Boolean(value);
  };
  return {
    instapay: {
      enabled: bool(settings["storefront.payment_methods.instapay_enabled"], settings["payments.instapay_enabled"] ?? true),
      displayName: text(settings["storefront.payment_methods.instapay_display_name"], settings["payments.instapay_display_name"] || "InstaPay"),
      paymentUrl: text(
        settings.storefront?.payment_methods?.instapay?.payment_url,
        settings["storefront.payment_methods.instapay.payment_url"] || settings["payments.instapay_payment_url"] || DEFAULT_STOREFRONT_PAYMENT_SETTINGS.instapay.paymentUrl || ""
      ),
      handle: text(
        settings.storefront?.payment_methods?.instapay?.handle,
        settings["storefront.payment_methods.instapay.handle"] || settings["storefront.payment_methods.instapay_handle"] || settings["payments.instapay_handle"] || import.meta.env.VITE_INSTAPAY_HANDLE || "01000000000@instapay"
      ),
      logoUrl: text(settings["storefront.payment_methods.instapay_logo_url"], settings["payments.instapay_logo_url"] || ""),
      helperText: text(settings["storefront.payment_methods.instapay_helper_text"], settings["payments.instapay_helper_text"] || ""),
    },
    vodafoneCash: {
      enabled: bool(settings["storefront.payment_methods.vodafone_cash_enabled"], settings["payments.vodafone_cash_enabled"] ?? true),
      displayName: text(settings["storefront.payment_methods.vodafone_cash_display_name"], settings["payments.vodafone_cash_display_name"] || "Vodafone Cash"),
      number: text(settings["storefront.payment_methods.vodafone_cash_number"], settings["payments.vodafone_cash_number"] || import.meta.env.VITE_VODAFONE_CASH_NUMBER || "01000000000"),
      logoUrl: text(settings["storefront.payment_methods.vodafone_cash_logo_url"], settings["payments.vodafone_cash_logo_url"] || ""),
      helperText: text(settings["storefront.payment_methods.vodafone_cash_helper_text"], settings["payments.vodafone_cash_helper_text"] || ""),
    },
    shippingConfirmation: {
      enabled: bool(settings["storefront.payment_methods.shipping_confirmation_enabled"], true),
      amount: number(settings["storefront.payment_methods.shipping_confirmation_amount"], 75),
      label: sfText("storefront.checkout.transfer.amountDueNow"),
    },
  };
};
const rawOptionValue = (value, fallback = "") => {
  if (value && typeof value === "object") {
    return String(value.value ?? value.id ?? value.key ?? value.status ?? fallback ?? "").trim();
  }
  return String(value ?? fallback ?? "").trim();
};
const normalizeCheckoutPaymentMethod = (value) => (rawOptionValue(value).toLowerCase() === "cod" ? "cod" : "shipping_confirmation");
const CHECKOUT_STEP_STORAGE_KEY = "storefront.checkout.step";
const normalizeShippingQuote = (quote = {}) => ({
  loading: false,
  price: Number.isFinite(Number(quote.price ?? quote.shipping_price)) ? Number(quote.price ?? quote.shipping_price) : 0,
  cod_allowed: quote.cod_allowed !== false,
  requires_shipping_proof: quote.requires_shipping_proof !== false,
  estimated_delivery_text: String(quote.estimated_delivery_text || ""),
  match_level: String(quote.match_level || ""),
  provider: String(quote.provider || "manual"),
  provider_id: String(quote.provider_id || quote.provider || "in_store_delivery"),
  zone: quote.zone || null,
  governorate_id: String(quote.governorate_id || quote.zone?.governorate_id || ""),
  city_id: String(quote.city_id || quote.zone?.city_id || ""),
  area_id: String(quote.area_id || quote.zone?.area_id || quote.zone?.district_id || ""),
  district_id: String(quote.district_id || quote.zone?.district_id || quote.zone?.area_id || ""),
  zone_id: String(quote.zone_id || quote.zone?.zone_id || ""),
  free_shipping_threshold: Number.isFinite(Number(quote.free_shipping_threshold)) ? Number(quote.free_shipping_threshold) : 0,
  original_price: Number.isFinite(Number(quote.original_price)) ? Number(quote.original_price) : 0,
  free_shipping_applied: Boolean(quote.free_shipping_applied),
});

const CHECKOUT_ADDRESS_FIELDS = [
  "full_name",
  "primary_phone",
  "governorate",
  "city_area",
  "detailed_address",
  "street_address",
  "building_number",
  "floor_number",
  "apartment_number",
  "landmark",
  "delivery_notes",
  "governorate_id",
  "city_id",
  "area_id",
  "zone_id",
  "district_id",
  "shipping_city_id",
  "shipping_zone_id",
  "shipping_district_id",
];

const whatsappPhone = String(import.meta.env.VITE_WHATSAPP_PHONE || import.meta.env.VITE_STORE_WHATSAPP || "").replace(/\D/g, "");
const buildWhatsAppHref = (text = "") => (whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(text)}` : "https://wa.me/");
const getStatusLabels = () => {
  const labels = i18n.t("storefront.orders.timelineLabels", { returnObjects: true });
  return Array.isArray(labels) && labels.length ? labels : ["Order received", "Preparing", "Shipped", "On the way", "Delivered"];
};
const SEARCH_RECENT_KEY = "storefront.search.recent";
const getSearchPlaceholders = () => {
  const values = i18n.t("storefront.search.placeholders", { returnObjects: true });
  return Array.isArray(values) && values.length ? values : ["ابحث عن Jordan 4...", "ابحث عن Sneakers...", "ابحث بالمقاس 42...", "ابحث باسم البراند...", "ابحث بـ SKU..."];
};

const getTrendingSearches = () => {
  const values = i18n.t("storefront.search.trending", { returnObjects: true });
  return Array.isArray(values) && values.length ? values : ["Jordan 4", "Sneakers", "مقاس 42", "Mirror Original", "Adidas", "رجالي أسود"];
};

const getSearchFallbackSections = () => {
  const sections = i18n.t("storefront.search.fallbackSections", { returnObjects: true });
  return sections && typeof sections === "object" && !Array.isArray(sections)
    ? sections
    : {
      categories: ["رجالي", "حريمي", "أطفال", "عروض", "آخر قطعة"],
      brands: ["Nike", "Adidas", "New Balance", "Air Jordan"],
    };
};

const STOREFRONT_CACHE_PREFIXES = ["storefront.cache", "storefront.products", "storefront.product", "storefront.last-piece", "storefront.story", "storefront.stories"];

const deferReactState = (callback) => {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }
  Promise.resolve().then(callback);
};

const pickSuccessMessage = (seed = "") => {
  const text = String(seed || "");
  const score = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const messages = getSuccessMessages();
  return messages[score % messages.length] || messages[0];
};


const productSearchText = (product = {}) => {
  const values = [
    product.name,
    product.name_ar,
    product.title,
    product.description,
    product.category,
    product.product_type,
    product.productType,
    product.gender,
    product.brand,
    product.tags,
    product.labels,
    product.audiences,
    product.product_audiences,
    product.classifications,
  ];
  return values
    .flatMap((value) => {
      if (Array.isArray(value)) return value.map((item) => (typeof item === "object" ? Object.values(item).join(" ") : item));
      if (value && typeof value === "object") return Object.values(value);
      return value;
    })
    .join(" ")
    .toLowerCase();
};

const featuredSlideProduct = (product = {}) => {
  const variant = firstDisplayVariant(product.variants || []);
  const image = displayImageForProduct(product, variant);
  const pricing = getDisplayPricing(product, storefrontSalePricesEnabled, variant);
  return { product, variant, image, price: pricing.price, comparePrice: pricing.comparePrice || 0 };
};

const displayCartItemPrice = (item = {}) => {
  return getDisplayPricing(item, storefrontSalePricesEnabled).price;
};

const displayCartItemComparePrice = (item = {}) => {
  return getDisplayPricing(item, storefrontSalePricesEnabled).comparePrice || 0;
};


const getVisibleCartActionElement = () => {
  if (typeof document === "undefined") return null;
  const candidates = Array.from(document.querySelectorAll(".sf-cart-action"));
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.getBoundingClientRect !== "function") continue;
    const rect = candidate.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const style = typeof window !== "undefined" && typeof window.getComputedStyle === "function" ? window.getComputedStyle(candidate) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || Number.parseFloat(style.opacity || "1") === 0)) continue;
    return candidate;
  }
  return null;
};

const firstArrayItem = (value) => (Array.isArray(value) && value.length ? value[0] : null);
const localizedDisplayText = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return cleanDisplayText(value);
  const language = normalizeLanguage(i18n.resolvedLanguage || i18n.language || "en");
  const preferred = language === "ar"
    ? [value.ar, value.arabic, value.name_ar, value.title_ar, value.label_ar, value.en, value.english, value.name_en, value.title_en, value.label_en, value.name, value.title, value.label, value.value]
    : [value.en, value.english, value.name_en, value.title_en, value.label_en, value.ar, value.arabic, value.name_ar, value.title_ar, value.label_ar, value.name, value.title, value.label, value.value];
  return preferred.map((item) => cleanDisplayText(item)).find(Boolean) || "";
};
const firstTextValue = (...values) => values.map((value) => localizedDisplayText(value)).find(Boolean) || "";
const firstNumberValue = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
};
const nestedProductFor = (item = {}) => {
  if (item?.product && typeof item.product === "object") return item.product;
  if (item?.item?.product && typeof item.item.product === "object") return item.item.product;
  if (item?.data?.product && typeof item.data.product === "object") return item.data.product;
  return {};
};
const nestedVariantFor = (item = {}, product = {}) => {
  if (item?.variant && typeof item.variant === "object") return item.variant;
  if (item?.product_variant && typeof item.product_variant === "object") return item.product_variant;
  if (item?.matched_variant && typeof item.matched_variant === "object") return item.matched_variant;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return firstDisplayVariant(variants) || {};
};
const resolveProductImage = (item = {}, product = {}, variant = {}) => {
  const safeItem = safeStorefrontRecord(item);
  const safeProduct = safeStorefrontRecord(product);
  const safeVariant = safeStorefrontRecord(variant);
  const itemFirstImage = firstArrayItem(safeItem.images);
  const productFirstImage = firstArrayItem(safeProduct.images) || firstArrayItem(safeProduct.gallery_images);
  return compactImageValue(
    safeVariant.image_url ||
      safeVariant.image ||
      safeVariant.primary_image ||
      safeItem.image_url ||
      safeItem.image ||
      safeItem.primary_image ||
      safeItem.thumbnail ||
      safeItem.thumbnail_url ||
      itemFirstImage?.image_url ||
      itemFirstImage?.url ||
      itemFirstImage ||
      safeProduct.image_url ||
      safeProduct.image ||
      safeProduct.primary_image ||
      safeProduct.thumbnail ||
      safeProduct.thumbnail_url ||
      productFirstImage?.image_url ||
      productFirstImage?.url ||
      productFirstImage ||
      ""
  );
};

const displayComparePrice = (product = {}, variant = {}) => {
  return getDisplayPricing(product, storefrontSalePricesEnabled, variant).comparePrice || 0;
};
const parseStorefrontPriceValue = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const normalized = Number(String(value).replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(normalized) ? normalized : 0;
};
const offerStoryPriceInfo = (product = {}) => {
  const pricing = getDisplayPricing(
    {
      ...product,
      sale_price: product?.sale_price || product?.salePrice || product?.discounted_price || product?.discountedPrice,
      selling_price: product?.selling_price || product?.sellingPrice || product?.price,
      compare_at_price: product?.compare_at_price || product?.compareAtPrice || product?.original_price || product?.originalPrice,
    },
    storefrontSalePricesEnabled
  );
  return {
    offerSalePrice: pricing.isOnSale ? pricing.salePrice : 0,
    regularPrice: pricing.sellingPrice,
    comparePrice: pricing.isOnSale ? pricing.comparePrice || 0 : 0,
    displayPrice: pricing.price,
    crossedPrice: pricing.isOnSale ? pricing.comparePrice || 0 : 0,
  };
};

const cleanDisplayText = (value = "") =>
  String(value || "")
    .replace(/\uFFFD/g, "")
    .replace(/\u00e2\u0153\u00a8/g, "")
    .replace(/\u00e2\u20ac\u00a6/g, "...")
    .replace(/\u0637\u0152/g, "ط·آ·ط¥â€™")
    .replace(/\s+/g, " ")
    .trim();
const classificationColor = (option = {}) => option.color || "#d4af37";
const storefrontLabelKey = (value = "") =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\u0640/g, "")
    .replace(/[\u200c\u200e\u200f]/g, "")
    .replace(/\u200d/g, "")
    .replace(/\p{M}+/gu, "")
    .replace(/['\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const PRODUCT_TYPE_LABELS = {
  bags: { ar: "شنط", en: "Bags", aliases: ["bag", "bags", "handbag", "handbags", "شنط", "شنطة", "شنطتي", "حقائب", "حقيبة", "حقيبه"] },
  crocs: { ar: "كروكس", en: "Crocs", aliases: ["croc", "crocs", "كروكس"] },
  slippers: { ar: "سليبر", en: "Slippers", aliases: ["slipper", "slippers", "slide", "slides", "سليبر", "شباشب"] },
  sneakers: { ar: "سنيكرز", en: "Sneakers", aliases: ["sneaker", "sneakers", "سنيكرز"] },
  shoes: { ar: "Shoes", en: "Shoes", aliases: ["shoe", "shoes", "أحذية", "حذاء", "أحذيه"] },
  running: { ar: "Running", en: "Running", aliases: ["running", "run", "جري", "رياضي"] },
  casualshoes: { ar: "Casual Shoes", en: "Casual Shoes", aliases: ["casual shoe", "casual shoes", "casual", "كاجوال", "كاجوال شوز"] },
};
const normalizeProductTypeKey = (value = "") => storefrontLabelKey(value).replace(/[\s_-]+/g, "");
const resolveProductTypeKey = (value = "") => {
  const normalized = normalizeProductTypeKey(value);
  if (!normalized) return "";
  for (const [key, entry] of Object.entries(PRODUCT_TYPE_LABELS)) {
    if (normalizeProductTypeKey(key) === normalized) return key;
    if ((entry.aliases || []).some((alias) => normalizeProductTypeKey(alias) === normalized)) return key;
  }
  if (normalized === "shoe") return "shoes";
  if (normalized === "sneaker") return "sneakers";
  if (normalized === "bag") return "bags";
  if (normalized === "slipper") return "slippers";
  if (normalized === "casualshoe") return "casualshoes";
  return normalized;
};
const getProductTypeLabel = (value = "", lang = "ar") => {
  const key = resolveProductTypeKey(value);
  const entry = PRODUCT_TYPE_LABELS[key];
  if (!entry) return cleanDisplayText(String(value || ""));
  return cleanDisplayText((lang === "en" ? entry.en : entry.ar) || entry.ar || entry.en || value || "");
};
const storefrontLocalizedLabels = {
  ar: { men: "رجالي", women: "حريمي", kids: "أطفال" },
  en: { men: "Men", women: "Women", kids: "Kids" },
};
const classificationLabel = (option = {}, lang = "ar") =>
  (() => {
    const rawValue = option?.value || option?.slug || option?.id || option?.key || option?.label || option?.name || option?.title || option?.display_name || option?.displayName || "";
    const rawKey = storefrontLabelKey(rawValue);
    const productTypeKey = resolveProductTypeKey(rawValue);
    const productTypeEntry = PRODUCT_TYPE_LABELS[productTypeKey];
    const productTypeLabel = productTypeEntry ? getProductTypeLabel(rawValue, lang) : "";
    // Prefer the canonical locale-specific display label (from the product-classification
    // taxonomy: label_en / label_ar) over the generic `label`, which the taxonomy sets to
    // label_ar||label_en||value and therefore renders Arabic in English mode. Options without
    // a localized field (brand/colour/free-text facets) fall through to the raw label unchanged,
    // so unknown merchant-authored values keep their original stored value. Display-only —
    // raw `value`, filter query values, URLs and comparisons are untouched.
    const localizedField = lang === "en"
      ? (option?.label_en || option?.name_en || option?.title_en)
      : (option?.label_ar || option?.name_ar || option?.title_ar);
    return cleanDisplayText(
      productTypeLabel ||
        storefrontLocalizedLabels[lang]?.[rawKey] ||
      localizedField ||
      option?.label ||
      option?.name ||
      option?.title ||
      option?.display_name ||
      option?.displayName ||
      option?.slug ||
      option?.value ||
      option?.id ||
      option?.key ||
      "",
    ) || "";
  })();
const normalizeStorefrontProductTypeKey = (value = "") => {
  const normalized = storefrontLabelKey(value);
  if (["sneaker", "sneakers"].includes(normalized)) return "sneaker";
  return normalized;
};
const normalizeFilterKey = (value = "") => storefrontLabelKey(value);
const uniqueClassificationOptions = (options = []) => {
  const seen = new Set();
  return (Array.isArray(options) ? options : []).filter((option) => {
    const key = String(option.value || option.id || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};




// Men's category motion clip (Pexels video 33294342, free to use).
// Product/category media from the API still takes priority when configured.
const MEN_CATEGORY_TRIAL_VIDEO_URL = "https://videos.pexels.com/video-files/33294342/14180878_640_360_24fps.mp4";
// Men's slippers motion clip (Pexels video 8994975). The SD rendition is ~425 KB.
const MEN_SLIPPERS_VIDEO_URL = "https://videos.pexels.com/video-files/8994975/8994975-sd_360_640_25fps.mp4";
const MEN_SLIPPERS_POSTER_URL = "https://images.pexels.com/videos/8994975/pexels-photo-8994975.jpeg?auto=compress&cs=tinysrgb&w=480";
// Women's category motion clip (Pexels video 7877138, free to use).
const WOMEN_CATEGORY_TRIAL_VIDEO_URL = "https://videos.pexels.com/video-files/7877138/7877138-sd_640_338_25fps.mp4";
// Women's slippers motion clip (Pexels video 6919220, free to use).
// The 720px rendition is ~1.42 MB versus ~9.21 MB for the original UHD file.
const WOMEN_SLIPPERS_VIDEO_URL = "https://videos.pexels.com/video-files/6919220/6919220-hd_720_1366_30fps.mp4";
const WOMEN_SLIPPERS_POSTER_URL = "https://images.pexels.com/videos/6919220/pexels-photo-6919220.jpeg?auto=compress&cs=tinysrgb&w=480";
const KIDS_CATEGORY_TRIAL_VIDEO_URL = "https://videos.pexels.com/video-files/8456205/8456205-sd_640_360_25fps.mp4";
const SALE_CATEGORY_TRIAL_VIDEO_URL = "https://videos.pexels.com/video-files/5889624/5889624-sd_426_240_25fps.mp4";

const mainHomeCategoryCards = [
  {
    id: "men",
    titleAr: "رجالي",
    titleEn: "Men",
    subtitleAr: "أحدث Nike و Adidas و Jordan",
    subtitleEn: "Latest Nike, Adidas & Jordan",
    href: "/men?product_type=sneakers",
    test: (product) => isExclusiveCategoryAudience(product, "men") && resolveProductTypeKey(product.product_type || product.productType) === "sneakers",
    icon: Briefcase,
    overlay: "from-slate-950/95 via-slate-950/35 to-transparent",
    video: MEN_CATEGORY_TRIAL_VIDEO_URL,
    poster: "/storefront/category-posters/men.webp",
  },
  {
    id: "men-slipper",
    titleAr: "سليبر رجالي",
    titleEn: "Men Slipper",
    subtitleAr: "راحة خفيفة للاستخدام اليومي",
    subtitleEn: "Light comfort for every day",
    href: "/slippers?gender=men",
    test: (product) => isExclusiveCategoryAudience(product, "men") && resolveProductTypeKey(product.product_type || product.productType) === "slippers",
    icon: Footprints,
    overlay: "from-cyan-950/90 via-slate-950/30 to-transparent",
    video: MEN_SLIPPERS_VIDEO_URL,
    poster: MEN_SLIPPERS_POSTER_URL,
    preferDefinitionVideo: true,
  },
  {
    id: "women",
    titleAr: "حريمي",
    titleEn: "Women",
    subtitleAr: "راحة وأناقة لكل يوم",
    subtitleEn: "Comfort and style for every day",
    href: "/women?product_type=sneakers",
    test: (product) => isExclusiveCategoryAudience(product, "women") && resolveProductTypeKey(product.product_type || product.productType) === "sneakers",
    icon: Users,
    overlay: "from-rose-950/90 via-rose-950/30 to-transparent",
    video: WOMEN_CATEGORY_TRIAL_VIDEO_URL,
    poster: "/storefront/category-posters/women.webp",
    preferDefinitionVideo: true,
  },
  {
    id: "women-slipper",
    titleAr: "سليبر حريمي",
    titleEn: "Women Slipper",
    subtitleAr: "راحة خفيفة لكل يوم",
    subtitleEn: "Light comfort for every day",
    href: "/slippers?gender=women",
    test: (product) => isExclusiveCategoryAudience(product, "women") && resolveProductTypeKey(product.product_type || product.productType) === "slippers",
    icon: Footprints,
    overlay: "from-fuchsia-950/90 via-rose-950/30 to-transparent",
    video: WOMEN_SLIPPERS_VIDEO_URL,
    poster: WOMEN_SLIPPERS_POSTER_URL,
    preferDefinitionVideo: true,
  },
  {
    id: "kids",
    titleAr: "أطفال",
    titleEn: "Kids",
    subtitleAr: "مصممة للمدرسة واللعب والحركة",
    subtitleEn: "Built for school, play and movement",
    href: "/kids?product_type=sneakers",
    test: (product) => productAudienceValues(product).includes("kids") && resolveProductTypeKey(product.product_type || product.productType) === "sneakers",
    icon: Baby,
    overlay: "from-amber-950/90 via-amber-950/25 to-transparent",
    video: KIDS_CATEGORY_TRIAL_VIDEO_URL,
    poster: "/storefront/category-posters/kids.webp",
  },
  {
    id: "offers",
    titleAr: "عروض",
    titleEn: "Offers",
    subtitleAr: "عروض الموسم",
    subtitleEn: "Season offers",
    overlay: "from-red-950/95 via-red-950/35 to-transparent",
    href: "/offers",
    test: (product) => isOfferStory(product),
    icon: BadgePercent,
    video: SALE_CATEGORY_TRIAL_VIDEO_URL,
    poster: "/storefront/category-posters/sale.webp",
    preferDefinitionVideo: true,
  },
  {
    id: "crocs",
    titleAr: "كروكس",
    titleEn: "Crocs",
    subtitleAr: "راحة سهلة لكل يوم",
    subtitleEn: "Easy comfort for every day",
    href: "/crocs",
    test: (product) => categoryCardHasCrocs(product),
    icon: Footprints,
  },
  {
    id: "last-sizes",
    titleAr: "آخر المقاسات",
    titleEn: "Last Sizes",
    subtitleAr: "مقاسات محدودة قبل النفاد",
    subtitleEn: "Limited pairs before they disappear",
    href: "/products?stock=last",
    test: (product) => isLastPieceProduct(product),
    icon: PackageSearch,
  },
];

const homeProductWithImage = (product = {}) => {
  const slide = featuredSlideProduct(product);
  return slide.image ? { ...slide, product } : null;
};







function PremiumHomePage(props) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const homeMotionRootRef = useRef(null);
  const lang = i18n.language || "ar";
  const isRtl = normalizeLanguage(lang) === "ar";
  const themeMode = props.themeMode || "light";
  const themeTokens = useMemo(() => getStorefrontThemeTokens(themeMode), [themeMode]);
  const brandName = props.brandName || "M1 Store";
  const brandFilter = params.get("brand") || "";
  const storefrontHome = useStorefrontHome();
  const { brands, loading: brandsLoading } = useStorefrontBrands();
  const storefrontHomeProducts = useMemo(
    () => uniqueProductsByIdentity((storefrontHome.collections || []).flatMap((collection) => collection.products || [])),
    [storefrontHome.collections]
  );
  const products = storefrontHomeProducts;
  const loading = storefrontHome.loading;
  const saleProducts = useMemo(() => products.filter(isOfferStory), [products]);
  const mirrorProducts = useMemo(
    () => uniqueProductsByIdentity(storefrontHome.mirrorProducts || []).filter(isMirrorProduct),
    [storefrontHome.mirrorProducts]
  );
  const mirrorLoading = storefrontHome.loading;
  const womenCategoryProducts = useMemo(
    () => products.filter((product) => productAudienceValues(product).includes("women")),
    [products]
  );
  const womenCategoryLoading = storefrontHome.loading;

  useEffect(() => {
    if (!brandFilter || !isStorefrontHomePath(location.pathname)) return;
    navigate(productsPath({ brand: brandFilter }), { replace: true });
  }, [brandFilter, location.pathname, navigate]);

  const merchProducts = useMemo(() => products.filter(isAvailableProduct), [products]);
  const railProducts = useMemo(() => (merchProducts.length ? merchProducts : products), [merchProducts, products]);
  const saleRailProducts = useMemo(() => saleProducts.filter(isAvailableProduct), [saleProducts]);
  const saleFallback = useMemo(() => railProducts.filter(isOfferStory), [railProducts]);
  const bestBase = useMemo(
    () => uniqueProductsByIdentity([...railProducts].sort((a, b) => stockScore(b) - stockScore(a) || newestScore(b) - newestScore(a))),
    [railProducts]
  );
  const freshBase = useMemo(
    () => uniqueProductsByIdentity([...railProducts].sort((a, b) => newestScore(b) - newestScore(a))),
    [railProducts]
  );
  const saleBase = useMemo(
    () => uniqueProductsByIdentity([...(saleRailProducts.length ? saleRailProducts : saleProducts), ...saleFallback].filter(isOfferStory)),
    [saleFallback, saleProducts, saleRailProducts]
  );
  const homepageProductPool = useMemo(
    () => uniqueProductsByIdentity([...railProducts, ...storefrontHomeProducts, ...saleBase, ...saleProducts, ...freshBase, ...bestBase]),
    [bestBase, freshBase, railProducts, saleBase, saleProducts, storefrontHomeProducts]
  );
  const homepageProductsWithImages = useMemo(
    () => homepageProductPool.filter((product) => isAvailableProduct(product) && homeProductWithImage(product)),
    [homepageProductPool]
  );
  const mirrorHeroSlides = useMemo(() => {
    const mirrorCandidates = uniqueProductsByIdentity([
      ...(Array.isArray(mirrorProducts) ? mirrorProducts : []),
      ...homepageProductPool.filter(isMirrorProduct),
    ])
      .filter((product) => isAvailableProduct(product) && homeProductWithImage(product))
      .sort((a, b) => stockScore(b) - stockScore(a) || newestScore(b) - newestScore(a));
    return mirrorCandidates.slice(0, 12).map(featuredSlideProduct);
  }, [homepageProductPool, mirrorProducts]);
  const heroSlide = useMemo(() => {
    if (mirrorHeroSlides.length) return mirrorHeroSlides[0];
    const candidate = storefrontHome.hero && isMirrorProduct(storefrontHome.hero) ? storefrontHome.hero : null;
    return candidate ? featuredSlideProduct(candidate) : null;
  }, [mirrorHeroSlides, storefrontHome.hero]);
  const heroCollection = storefrontHome.collections[0] || null;
  const homeCategoryCards = useMemo(() => {
    const sourceProducts = uniqueProductsByIdentity([...womenCategoryProducts, ...homepageProductPool]).filter((product) => product?.id && product?.name && isAvailableProduct(product));
    return mainHomeCategoryCards.slice(0, 6).map((definition) => {
      const matchingProducts = sourceProducts.filter((product) => {
        if (definition.id === "offers") return isOfferStory(product);
        if (isOfferStory(product)) return false;
        return definition.test(product, productSearchText(product));
      });
      const offerVisualProduct = definition.id === "offers"
        ? saleProducts.find((product) => isAvailableProduct(product) && homeProductWithImage(product))
        : null;
      const match = matchingProducts.find((product) => homeProductWithImage(product)) || offerVisualProduct || matchingProducts[0];
      const matchSlide = match ? homeProductWithImage(match) : null;
      const totalMatches = definition.id === "offers" ? Math.max(matchingProducts.length, saleProducts.length) : matchingProducts.length;
      return {
        ...definition,
        title: isRtl ? definition.titleAr : definition.titleEn,
        subtitle: isRtl ? definition.subtitleAr : definition.subtitleEn,
        image: definition.poster || matchSlide?.image || "",
        video: compactImageValue(definition.preferDefinitionVideo
          ? definition.video
          : (
            match?.category_video_url ||
            match?.storefront_video_url ||
            match?.promo_video_url ||
            match?.primary_video_url ||
            match?.video_url ||
            match?.media?.video_url ||
            definition.video ||
            ""
          )),
        count: totalMatches,
      };
    });
  }, [homepageProductPool, isRtl, saleProducts, womenCategoryProducts]);
  const visibleBrands = useMemo(() => (Array.isArray(brands) ? brands : []).filter((brand) => brand?.id && brand?.name && brand?.logo_url), [brands]);
  const homeSections = useMemo(() => {
    const used = new Set();
    const pick = ({ preferred = [], fallback = [], limit = 8, allowRepeatIfEmpty = false } = {}) => {
      let selected = pickHomeProducts({ preferred, fallback, exclude: used, limit });
      if (!selected.length && allowRepeatIfEmpty) {
        selected = pickHomeProducts({ preferred, fallback, limit });
      }
      selected.forEach((product, index) => {
        const key = productIdentityKey(product, index);
        if (key) used.add(key);
      });
      return selected;
    };

    const popularPreferred = uniqueProductsByIdentity([...homepageProductPool]
      .filter((product) => homeProductWithImage(product))
      .sort((a, b) => popularScore(b) - popularScore(a) || newestScore(b) - newestScore(a)));
    const newestPreferred = freshBase.filter((product) => homeProductWithImage(product));

    return {
      mostPopular: pick({ preferred: popularPreferred, fallback: homepageProductsWithImages, limit: 8 }),
      newArrivals: pick({ preferred: newestPreferred, fallback: [], limit: 8, allowRepeatIfEmpty: true }),
    };
  }, [freshBase, homepageProductPool, homepageProductsWithImages]);

  const heroCopy = isRtl
    ? {
        badge: "مختارات M1 Store",
        title: "اختيارات مميزة.\nستايل يلفت من أول خطوة.",
        subtitle: "اكتشف أحدث الموديلات والمقاسات المتاحة، مع توصيل سريع ودفع عند الاستلام.",
        mobileTitle: "ستايلك يبدأ من هنا",
        mobileSubtitle: "أحدث الموديلات والمقاسات في مكان واحد",
        primary: "تسوق الجديد",
        secondary: "استكشف العروض",
      }
    : {
        badge: "Curated by M1 Store",
        title: "Standout picks.\nStyle that starts with every step.",
        subtitle: "Discover the latest models and available sizes, with fast delivery and cash on delivery.",
        mobileTitle: "Your style starts here",
        mobileSubtitle: "The latest models and sizes in one place",
        primary: "Shop new arrivals",
        secondary: "Explore offers",
      };

  useEffect(() => {
    const root = homeMotionRootRef.current;
    if (!root || typeof window === "undefined") return undefined;
    const elements = Array.from(root.querySelectorAll(".sf-home-motion"));
    if (!elements.length) return undefined;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const saveData = Boolean(window.navigator?.connection?.saveData);
    if (reduceMotion || saveData || typeof IntersectionObserver === "undefined") {
      root.classList.remove("sf-home-motion-ready");
      elements.forEach((element) => element.classList.add("is-visible"));
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -7% 0px" });
    elements.forEach((element) => {
      if (!element.classList.contains("is-visible")) observer.observe(element);
    });
    root.classList.add("sf-home-motion-ready");
    return () => observer.disconnect();
  }, [brandsLoading, homeSections.mostPopular.length, homeSections.newArrivals.length, loading, storefrontHome.loading, visibleBrands.length, womenCategoryLoading]);

  return (
    <div
      ref={homeMotionRootRef}
      className="sf-page pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.5rem)] md:pb-0"
      data-theme={themeTokens.resolvedMode}
      style={{
        background: themeTokens.background,
        color: themeTokens.textPrimary,
      }}
    >
      <HomePremiumHero
        lang={lang}
        brandName={brandName}
        themeTokens={themeTokens}
        loading={loading || mirrorLoading || storefrontHome.loading}
        heroSlide={heroSlide}
        heroSlides={mirrorHeroSlides}
        heroCollection={heroCollection}
        heroCopy={{
          ...heroCopy,
          badge: isRtl ? "ميرور أوريجنال • مختارات M1" : "Mirror Original • M1 Picks",
          title: isRtl ? "ميرور أوريجنال.\nموديلات تستاهل تكون اختيارك." : "Mirror Original.\nModels made to stand out.",
          subtitle: isRtl ? "اختيارات مميزة بصور واضحة وأسعار مباشرة، علشان تختار موديلك من أول نظرة." : "Premium picks, clear imagery, and direct pricing so you can choose at first sight.",
          mobileTitle: isRtl ? "اختار ميرور أوريجنال" : "Choose Mirror Original",
          mobileSubtitle: isRtl ? "موديلات مميزة، أسعار واضحة، ومقاسات جاهزة للطلب" : "Standout models, clear prices, and sizes ready to order",
          primary: isRtl ? "تسوق ميرور أوريجنال" : "Shop Mirror Original",
        }}
      />
      <HomeCategoryCards cards={homeCategoryCards} lang={lang} themeTokens={themeTokens} loading={loading || womenCategoryLoading || storefrontHome.loading} />
      <SimpleHomeProductGrid
        title={isRtl ? "الأكثر طلبًا" : "Most Wanted"}
        subtitle={isRtl ? "مختارات قوية من القطع الأكثر جذبًا." : "The strongest edits and the most wanted picks."}
        viewAllTo="/products?sort=trending"
        loading={loading || storefrontHome.loading}
        products={homeSections.mostPopular}
        themeTokens={themeTokens}
        lang={lang}
      />
      <SimpleHomeProductGrid
        title={isRtl ? "وصل حديثًا" : "New Arrivals"}
        subtitle={isRtl ? "أحدث القطع المختارة حديثًا للعرض الأول." : "Fresh arrivals with a calmer, more premium presentation."}
        viewAllTo="/products?sort=newest"
        loading={loading || storefrontHome.loading}
        products={homeSections.newArrivals}
        themeTokens={themeTokens}
        lang={lang}
      />
      <HomeBrandStrip lang={lang} themeTokens={themeTokens} brands={visibleBrands} loading={brandsLoading} />
      <HomeWhySection lang={lang} themeTokens={themeTokens} />
      <HomeSimpleFooter lang={lang} themeTokens={themeTokens} />
    </div>
  );
}

function HomePremiumHero({ lang = "ar", brandName = "M1 Store", themeTokens = {}, loading = false, heroSlide = null, heroSlides = [], heroCollection = null, heroCopy = {} }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const availableHeroSlides = useMemo(() => {
    const slides = Array.isArray(heroSlides) ? heroSlides.filter((slide) => slide?.image && slide?.product) : [];
    if (slides.length) return slides;
    return heroSlide ? [heroSlide] : [];
  }, [heroSlide, heroSlides]);
  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  useEffect(() => {
    setActiveHeroIndex(0);
  }, [availableHeroSlides.length]);
  useEffect(() => {
    availableHeroSlides
      .slice(0, 6)
      .forEach((slide) => preloadStorefrontImage(slide?.image || "", "hero"));
  }, [availableHeroSlides]);
  useEffect(() => {
    if (availableHeroSlides.length < 2) return undefined;
    let cancelled = false;
    const nextIndex = (activeHeroIndex + 1) % availableHeroSlides.length;
    const nextImage = availableHeroSlides[nextIndex]?.image || "";
    const displayTimer = window.setTimeout(() => {
      Promise.race([
        preloadStorefrontImage(nextImage, "hero"),
        new Promise((resolve) => window.setTimeout(() => resolve(false), 900)),
      ]).finally(() => {
        if (!cancelled) setActiveHeroIndex(nextIndex);
      });
    }, 2800);

    return () => {
      cancelled = true;
      window.clearTimeout(displayTimer);
    };
  }, [activeHeroIndex, availableHeroSlides]);
  const activeHeroSlide = availableHeroSlides[activeHeroIndex] || heroSlide;
  const heroImage = activeHeroSlide?.image || heroCollection?.image || heroCollection?.hero_image || "";
  const heroTitle = heroCopy.title || (isRtl ? "اختيارات مميزة.\nستايل يلفت من أول خطوة." : "Standout picks.\nStyle that starts with every step.");
  const heroSubtitle = heroCopy.subtitle || (isRtl ? "اكتشف أحدث الموديلات والمقاسات المتاحة، مع توصيل سريع ودفع عند الاستلام." : "Discover the latest models and available sizes, with fast delivery and cash on delivery.");
  const heroMobileTitle = heroCopy.mobileTitle || (isRtl ? "ستايلك يبدأ من هنا" : "Your style starts here");
  const heroMobileSubtitle = heroCopy.mobileSubtitle || (isRtl ? "أحدث الموديلات والمقاسات في مكان واحد" : "The latest models and sizes in one place");
  const activePrice = Number(activeHeroSlide?.price || 0);
  const comparePrice = Number(activeHeroSlide?.comparePrice || 0);
  const heroPrice = activePrice > 0 ? money(activePrice) : "";
  const heroComparePrice = comparePrice > activePrice && activePrice > 0 ? money(comparePrice) : "";
  const heroDiscount = heroComparePrice ? Math.max(1, Math.round(((comparePrice - activePrice) / comparePrice) * 100)) : 0;
  const heroProduct = activeHeroSlide?.product || {};
  const heroProductHref = heroProduct?.id ? productUrl(heroProduct) : "/products";
  const heroSizes = extractOfferSizes(heroProduct).slice(0, 4);
  const trustItems = [
    { icon: Truck, ar: "شحن سريع", en: "Fast delivery" },
    { icon: PackageCheck, ar: "دفع عند الاستلام", en: "Cash on delivery" },
    { icon: RefreshCcw, ar: "استبدال سهل", en: "Easy exchange" },
  ];

  if (loading && !heroImage && !heroProduct?.id) {
    return (
      <section data-testid="mirror-hero-loading" className="sf-home-hero-v2 mx-auto max-w-[1400px] px-3 pt-3 sm:px-4 md:pt-8" aria-busy="true" aria-label={isRtl ? "جاري تجهيز واجهة المتجر" : "Preparing storefront"}>
        <div
          className="relative min-h-[564px] overflow-hidden rounded-[1.7rem] border sm:min-h-[604px] md:min-h-[720px] md:rounded-[2.4rem] lg:min-h-[700px]"
          style={{ background: themeTokens.heroGradient, borderColor: themeTokens.border, boxShadow: themeTokens.shadow }}
        >
          <div className="pointer-events-none absolute inset-0" style={{ background: themeTokens.heroGlow }} />
          <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full border border-[#b4860b]/10" />
          <div className="relative grid min-h-[inherit] items-stretch lg:grid-cols-[1.02fr_0.98fr]">
            <div className="hidden min-w-0 flex-col justify-center px-14 py-14 lg:flex">
              <div className="sf-skeleton-shimmer h-9 w-44 rounded-full" style={{ background: themeTokens.cardSoft }} />
              <div className="sf-skeleton-shimmer mt-7 h-16 w-[82%] rounded-2xl" style={{ background: themeTokens.cardSoft }} />
              <div className="sf-skeleton-shimmer mt-4 h-6 w-[65%] rounded-full" style={{ background: themeTokens.cardSoft }} />
              <div className="sf-skeleton-shimmer mt-3 h-6 w-[48%] rounded-full" style={{ background: themeTokens.cardSoft }} />
              <div className="sf-skeleton-shimmer mt-9 h-14 w-48 rounded-full" style={{ background: themeTokens.cardSoft }} />
            </div>

            <div className="relative min-h-[564px] p-3 sm:min-h-[604px] sm:p-5 md:min-h-[720px] md:p-7 lg:min-h-[700px] lg:p-9">
              <div className="relative flex h-full min-h-[540px] flex-col items-center justify-center overflow-hidden rounded-[1.45rem] border px-6 py-10 text-center sm:min-h-[564px] md:min-h-[666px] md:rounded-[2rem] lg:min-h-[628px]" style={{ background: themeTokens.surface, borderColor: themeTokens.borderStrong, boxShadow: themeTokens.shadowSoft }}>
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(212,175,55,0.18),transparent_48%)]" />
                <span className="absolute end-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-[#b4860b]/20 bg-white/90 px-3 py-1.5 text-[10px] font-black text-stone-800 shadow-md md:end-6 md:top-6 md:px-4 md:py-2 md:text-xs">
                  <Sparkles className="h-3.5 w-3.5 text-[#b4860b]" />
                  {isRtl ? "ميرور أوريجنال" : "Mirror Original"}
                </span>
                <div className="relative grid h-24 w-24 place-items-center rounded-full border border-[#b4860b]/20 bg-[#fff7df]/80 shadow-[0_18px_55px_rgba(180,134,11,0.16)] md:h-28 md:w-28">
                  <span className="sf-home-hero-loader__ring absolute inset-[-10px] rounded-full border border-[#b4860b]/20" />
                  <ShoppingBag className="h-9 w-9 text-[#9a7108] md:h-11 md:w-11" strokeWidth={1.8} />
                </div>
                <h2 className="relative mt-7 text-xl font-black md:text-2xl" style={{ color: themeTokens.textPrimary }}>
                  {isRtl ? "بنجهز لك أحدث الاختيارات" : "Preparing the latest picks"}
                </h2>
                <p className="relative mt-2 max-w-xs text-sm font-bold leading-6 md:text-base" style={{ color: themeTokens.textSecondary }}>
                  {isRtl ? "لحظات وتظهر الصور والأسعار والمقاسات كاملة" : "Images, prices, and sizes will be ready in a moment"}
                </p>
                <div className="relative mt-7 flex items-center gap-2" aria-hidden="true">
                  <span className="sf-home-hero-loader__dot h-2 w-2 rounded-full bg-[#b4860b]" />
                  <span className="sf-home-hero-loader__dot h-2 w-2 rounded-full bg-[#b4860b]" />
                  <span className="sf-home-hero-loader__dot h-2 w-2 rounded-full bg-[#b4860b]" />
                </div>
                <div className="absolute inset-x-5 bottom-5 rounded-[1.2rem] border p-4 md:inset-x-7 md:bottom-7" style={{ background: themeTokens.card, borderColor: themeTokens.border }}>
                  <div className="sf-skeleton-shimmer h-4 w-28 rounded-full" style={{ background: themeTokens.cardSoft }} />
                  <div className="sf-skeleton-shimmer mt-3 h-7 w-[72%] rounded-full" style={{ background: themeTokens.cardSoft }} />
                  <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4" style={{ borderColor: themeTokens.border }}>
                    <div className="sf-skeleton-shimmer h-7 w-24 rounded-full" style={{ background: themeTokens.cardSoft }} />
                    <div className="sf-skeleton-shimmer h-9 w-28 rounded-full" style={{ background: themeTokens.cardSoft }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="sf-home-hero-v2 mx-auto max-w-[1400px] px-3 pt-3 sm:px-4 md:pt-8">
      <div
        className="relative overflow-hidden rounded-[1.7rem] border md:rounded-[2.4rem]"
        style={{ background: themeTokens.heroGradient, borderColor: themeTokens.border, boxShadow: themeTokens.shadow }}
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: themeTokens.heroGlow }} />
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full border border-[#b4860b]/10" />
        <div className="relative grid items-stretch gap-0 lg:grid-cols-[1.02fr_0.98fr]">
          <div data-testid="mirror-hero-copy" className="order-2 hidden min-w-0 flex-col justify-center px-5 pb-7 pt-5 text-start sm:px-7 md:px-10 md:pb-10 lg:order-1 lg:flex lg:px-14 lg:py-14 xl:px-16">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[#b4860b]/20 bg-[#fff7df]/90 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#8a6508] shadow-sm md:px-4 md:py-2 md:text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              {heroCopy.badge || (isRtl ? "مختارات M1 Store" : "Curated by M1 Store")}
            </div>
            <h1 className="mt-4 max-w-2xl whitespace-pre-line text-[2.15rem] font-black leading-[1.04] tracking-[-0.035em] sm:text-[2.7rem] md:mt-6 md:text-[3.65rem] lg:text-[4.35rem] xl:text-[4.8rem]" style={{ color: themeTokens.textPrimary }}>
              <span className="md:hidden">{heroMobileTitle}</span>
              <span className="hidden md:inline">{heroTitle}</span>
            </h1>
            <p className="mt-3 max-w-xl text-[0.95rem] font-bold leading-7 md:mt-5 md:text-lg md:leading-8" style={{ color: themeTokens.textSecondary }}>
              <span className="md:hidden">{heroMobileSubtitle}</span>
              <span className="hidden md:inline">{heroSubtitle}</span>
            </p>
            <div className="mt-5 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap md:mt-8 md:gap-3">
              <Link to={productsPath({ quality: "mirror_original", sort: "newest" })} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-stone-950 px-6 text-sm font-black text-white shadow-[0_16px_34px_rgba(28,25,23,0.18)] transition duration-200 hover:-translate-y-0.5 hover:bg-stone-800 active:scale-[0.99] md:min-h-14 md:px-7 md:text-base">
                {heroCopy.primary || (isRtl ? "تسوق الجديد" : "Shop new arrivals")}
                <ChevronLeft className={`h-4 w-4 ${isRtl ? "" : "rotate-180"}`} />
              </Link>
              <Link to="/offers" className="inline-flex min-h-12 items-center justify-center rounded-full border px-6 text-sm font-black transition duration-200 hover:-translate-y-0.5 active:scale-[0.99] md:min-h-14 md:px-7 md:text-base" style={{ background: themeTokens.card, color: themeTokens.textPrimary, borderColor: themeTokens.borderStrong }}>
                {heroCopy.secondary || (isRtl ? "استكشف العروض" : "Explore offers")}
              </Link>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-2 border-t pt-5 md:mt-9 md:gap-3 md:pt-6" style={{ borderColor: themeTokens.border }}>
              {trustItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.en} className="flex min-w-0 flex-col items-center gap-1.5 text-center sm:flex-row sm:text-start">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fff7df] text-[#8a6508] md:h-9 md:w-9"><Icon className="h-4 w-4" /></span>
                    <span className="text-[10px] font-black leading-4 sm:text-[11px] md:text-xs" style={{ color: themeTokens.textSecondary }}>{isRtl ? item.ar : item.en}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="order-1 relative min-h-[540px] p-3 sm:min-h-[580px] sm:p-5 md:min-h-[680px] md:p-7 lg:order-2 lg:min-h-[700px] lg:p-9">
            <Link to={heroProductHref} className="group relative flex h-full min-h-[516px] flex-col overflow-hidden rounded-[1.45rem] border p-0 sm:min-h-[540px] md:min-h-[626px] md:rounded-[2rem] lg:min-h-[628px]" style={{ background: themeTokens.surface, borderColor: themeTokens.borderStrong, boxShadow: themeTokens.shadowSoft }}>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_32%,rgba(212,175,55,0.14),transparent_46%)]" />
              <span className="sf-home-hero-badge absolute end-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-stone-800 shadow-lg backdrop-blur md:end-6 md:top-6 md:px-4 md:py-2 md:text-xs">
                <Sparkles className="h-3.5 w-3.5 text-[#b4860b]" />
                {isRtl ? "ميرور أوريجنال" : "Mirror Original"}
              </span>
              <div className="sf-home-hero-product-stage relative z-[1] flex min-h-[315px] w-full flex-1 items-center justify-center px-3 pb-3 pt-14 sm:min-h-[350px] sm:px-5 md:min-h-[430px] md:px-7 md:pb-5 md:pt-20 lg:min-h-[440px]">
                {loading && !heroImage ? (
                  <div className="h-[180px] w-[82%] animate-pulse rounded-[1.5rem] md:h-[300px]" style={{ background: themeTokens.cardSoft }} />
                ) : heroImage ? (
                  <img key={`${activeHeroIndex}:${heroImage}`} src={imageFor(heroImage)} {...responsiveImageProps(heroImage, "hero")} alt={heroProduct?.name || brandName} onError={fallbackProductImage} className="sf-hero-image-transition h-full w-full max-h-[290px] rounded-[1.15rem] object-contain drop-shadow-[0_22px_28px_rgba(28,25,23,0.14)] transition duration-500 ease-out group-hover:scale-[1.035] sm:max-h-[330px] md:max-h-[405px] md:rounded-[1.5rem] lg:max-h-[420px]" loading="eager" decoding="async" fetchPriority="high" width="900" height="720" />
                ) : (
                  <div className="flex h-[220px] w-[82%] items-center justify-center rounded-[1.5rem] border border-dashed text-center text-sm font-black" style={{ color: themeTokens.textSecondary, borderColor: themeTokens.border }}>
                    {isRtl ? "صورة العرض تظهر هنا" : "Hero image appears here"}
                  </div>
                )}
              </div>
              {availableHeroSlides.length > 1 ? (
                <div data-testid="hero-slide-progress" className="sf-home-hero-progress relative z-10 mx-3 mb-2 flex min-h-9 w-[calc(100%-1.5rem)] shrink-0 items-center justify-center gap-1.5 rounded-full border border-stone-200/90 bg-stone-50/95 px-3 py-2 shadow-sm sm:mx-4 sm:w-[calc(100%-2rem)] md:mb-3 md:min-h-10">
                  <span className="me-1 text-[10px] font-black tabular-nums text-stone-600 md:text-xs">{activeHeroIndex + 1}/{availableHeroSlides.length}</span>
                  {availableHeroSlides.map((slide, index) => (
                    <span key={productIdentityKey(slide.product, index)} className={`h-1.5 rounded-full transition-all duration-300 ${index === activeHeroIndex ? "w-5 bg-[#b4860b]" : "w-1.5 bg-stone-300"}`} />
                  ))}
                </div>
              ) : null}
              <div className="sf-home-hero-details relative z-10 mx-3 mb-3 w-[calc(100%-1.5rem)] shrink-0 rounded-[1.2rem] border border-white/80 bg-white/95 p-3.5 shadow-[0_18px_45px_rgba(28,25,23,0.16)] backdrop-blur-xl sm:mx-4 sm:mb-4 sm:w-[calc(100%-2rem)] md:rounded-[1.5rem] md:p-4.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#9a7108] md:text-[10px]">{isRtl ? "اختيار ميرور مميز" : "Featured mirror pick"}</p>
                    <h2 className="mt-1 line-clamp-2 h-12 overflow-hidden break-words text-[1.05rem] font-black leading-6 text-stone-950 md:h-14 md:text-xl md:leading-7">{heroProduct?.name || brandName}</h2>
                  </div>
                  {heroDiscount ? <span className="shrink-0 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-black text-white shadow-sm md:text-xs">{isRtl ? `وفر ${heroDiscount}%` : `Save ${heroDiscount}%`}</span> : null}
                </div>
                <div className="mt-2.5 flex items-end justify-between gap-3 border-t border-stone-200/80 pt-2.5">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {heroPrice ? <span className="text-lg font-black text-stone-950 md:text-2xl">{heroPrice}</span> : null}
                    {heroComparePrice ? <span className="text-[11px] font-bold text-stone-400 line-through md:text-sm">{heroComparePrice}</span> : null}
                  </div>
                  <span className="sf-home-hero-cta inline-flex shrink-0 items-center gap-1.5 rounded-full bg-stone-950 px-3 py-2 text-[11px] font-black text-white md:px-4 md:text-sm">
                    <ShoppingBag className="h-3.5 w-3.5" />
                    {isRtl ? "اطلب الآن" : "Shop now"}
                  </span>
                </div>
                <div className="mt-2 flex min-h-7 items-center gap-1.5 overflow-hidden">
                  {heroSizes.length ? (
                    <>
                    <span className="shrink-0 text-[10px] font-bold text-stone-500">{isRtl ? "المقاسات:" : "Sizes:"}</span>
                    {heroSizes.map((size) => <span key={size} className="grid h-7 min-w-7 place-items-center rounded-full border border-stone-200 bg-stone-50 px-1.5 text-[10px] font-black text-stone-700 md:h-8 md:min-w-8 md:text-xs">{size}</span>)}
                    </>
                  ) : <span className="text-[10px] font-bold text-stone-400">{isRtl ? "اختر الموديل لمعرفة المقاسات" : "Open the model to view sizes"}</span>}
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function HomeCategoryMotionMedia({ video = "", image = "", alt = "" }) {
  const videoRef = useRef(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [shouldLoadVideo, setShouldLoadVideo] = useState(false);

  useEffect(() => {
    setVideoFailed(false);
    setShouldLoadVideo(false);
  }, [video]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !video || videoFailed || typeof window === "undefined") return undefined;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const saveData = Boolean(window.navigator?.connection?.saveData);
    if (reduceMotion || saveData) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoadVideo(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setShouldLoadVideo(true);
      observer.disconnect();
    }, { threshold: 0.12, rootMargin: "80px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [video, videoFailed]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !shouldLoadVideo || videoFailed) return undefined;
    element.play().catch(() => {});
    return () => element.pause();
  }, [shouldLoadVideo, videoFailed]);

  if (video && !videoFailed) {
    return (
      <video
        ref={videoRef}
        src={shouldLoadVideo ? video : undefined}
        poster={image ? imageFor(image) : undefined}
        className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.04]"
        muted
        loop
        playsInline
        preload="none"
        onCanPlay={() => videoRef.current?.play().catch(() => {})}
        onError={() => setVideoFailed(true)}
        aria-label={alt}
      />
    );
  }

  return image ? (
    <img
      src={imageFor(image)}
      {...responsiveImageProps(image, "hero")}
      alt={alt}
      onError={fallbackProductImage}
      className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.07]"
      loading="lazy"
      decoding="async"
      width="720"
      height="900"
    />
  ) : (
    <div className="h-full w-full bg-[radial-gradient(circle_at_50%_28%,rgba(212,175,55,0.30),transparent_40%),linear-gradient(145deg,#292524,#0c0a09)]" />
  );
}

function HomeCategoryCards({ cards = [], lang = "ar", themeTokens = {}, loading = false }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const visibleCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
  if (!visibleCards.length && !loading) return null;

  return (
    <section className="sf-home-motion sf-home-motion--stagger mx-auto max-w-[1400px] px-4 py-7 md:py-10">
      <div className="mb-5 flex items-end justify-between gap-3 md:mb-7">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: themeTokens.accent }}>
            {isRtl ? "تسوّق حسب القسم" : "Shop by category"}
          </p>
          <h2 className="mt-1.5 text-2xl font-black tracking-tight md:text-4xl" style={{ color: themeTokens.textPrimary }}>
            {isRtl ? "اختار ستايلك وابدأ" : "Pick your style and start"}
          </h2>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {(loading && !visibleCards.length ? Array.from({ length: 4 }) : visibleCards).map((card, index) => {
          const Icon = card?.icon || Sparkles;
          return (
            <Link
              key={card?.id || index}
              to={card?.href || "/products"}
              className="sf-home-motion-item group relative isolate min-h-[390px] overflow-hidden rounded-[1.75rem] border border-white/15 bg-stone-950 text-white shadow-[0_22px_60px_rgba(15,23,42,0.18)] transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_28px_75px_rgba(15,23,42,0.28)] active:scale-[0.99] sm:min-h-[430px] md:rounded-[2rem]"
              style={{ "--sf-motion-index": index }}
            >
              {card ? (
                <>
                  <div className="absolute inset-0">
                    <HomeCategoryMotionMedia video={card.video} image={card.image} alt={card.title} />
                  </div>
                  <div className={`absolute inset-0 bg-gradient-to-t ${card.overlay || "from-stone-950/95 via-stone-950/35 to-transparent"}`} />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.35),transparent_34%,transparent_58%,rgba(0,0,0,0.18))]" />
                  <div className="relative z-10 flex min-h-[390px] flex-col justify-between p-5 sm:min-h-[430px] md:p-6">
                    <div className="flex items-start justify-end gap-3">
                      {Number(card.count || 0) > 0 ? (
                        <span className="rounded-full border border-white/20 bg-black/30 px-3 py-2 text-[10px] font-black text-white backdrop-blur-md">
                          {card.count} {isRtl ? "موديل" : "styles"}
                        </span>
                      ) : null}
                    </div>
                    <div>
                      <h3 className="text-[2rem] font-black leading-none tracking-tight text-white drop-shadow-[0_3px_16px_rgba(0,0,0,0.55)] md:text-[2.35rem]">
                        {card.title}
                      </h3>
                      <p className="mt-2.5 max-w-[17rem] text-sm font-bold leading-6 text-white/82 drop-shadow-md">
                        {card.subtitle}
                      </p>
                      <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/20 pt-4">
                        <span className="text-sm font-black text-white">{isRtl ? "تسوّق الآن" : "Shop now"}</span>
                        <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-stone-950 shadow-xl transition duration-300 group-hover:-translate-x-1 group-hover:scale-105 rtl:group-hover:translate-x-1">
                          <ChevronLeft className={`h-5 w-5 ${isRtl ? "" : "rotate-180"}`} />
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="h-full min-h-[390px] animate-pulse bg-stone-800 sm:min-h-[430px]" />
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function HomeBrandStrip({ lang = "ar", themeTokens = {}, brands = [], loading = false }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const visibleBrands = Array.isArray(brands) ? brands.filter((brand) => brand?.id && brand?.name && brand?.logo_url) : [];
  const brandItems = loading && !visibleBrands.length ? Array.from({ length: 6 }) : visibleBrands;
  const groups = brandItems.length > 1 ? [brandItems, brandItems] : [brandItems];
  const brandTrackRef = useRef(null);
  const brandResetFrameRef = useRef(null);
  const [brandSlideIndex, setBrandSlideIndex] = useState(0);
  const [brandStepPx, setBrandStepPx] = useState(0);
  const [brandTransitionEnabled, setBrandTransitionEnabled] = useState(true);

  useLayoutEffect(() => {
    const track = brandTrackRef.current;
    if (!track || brandItems.length < 2) {
      setBrandStepPx(0);
      return undefined;
    }

    const updateBrandStep = () => {
      const firstItem = track.querySelector(".sf-brand-marquee__item");
      const firstGroup = track.querySelector(".sf-brand-marquee__group");
      if (!firstItem || !firstGroup) return;
      const groupStyles = window.getComputedStyle(firstGroup);
      const gap = Number.parseFloat(groupStyles.columnGap || groupStyles.gap || "0") || 0;
      setBrandStepPx(firstItem.getBoundingClientRect().width + gap);
    };

    updateBrandStep();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateBrandStep) : null;
    resizeObserver?.observe(track);
    window.addEventListener("resize", updateBrandStep);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateBrandStep);
    };
  }, [brandItems.length]);

  useEffect(() => {
    setBrandSlideIndex(0);
    setBrandTransitionEnabled(false);
    if (loading || brandItems.length < 2 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const enableFrame = window.requestAnimationFrame(() => {
      brandResetFrameRef.current = window.requestAnimationFrame(() => setBrandTransitionEnabled(true));
    });
    const moveTimer = window.setInterval(() => {
      setBrandSlideIndex((currentIndex) => (currentIndex < brandItems.length ? currentIndex + 1 : currentIndex));
    }, 4000);

    return () => {
      window.cancelAnimationFrame(enableFrame);
      if (brandResetFrameRef.current) window.cancelAnimationFrame(brandResetFrameRef.current);
      window.clearInterval(moveTimer);
    };
  }, [brandItems.length, loading]);

  const handleBrandTransitionEnd = () => {
    if (brandItems.length < 2 || brandSlideIndex < brandItems.length) return;
    setBrandTransitionEnabled(false);
    setBrandSlideIndex(0);
    brandResetFrameRef.current = window.requestAnimationFrame(() => {
      brandResetFrameRef.current = window.requestAnimationFrame(() => setBrandTransitionEnabled(true));
    });
  };

  if (!loading && !visibleBrands.length) return null;

  return (
    <section className="sf-home-brands sf-home-motion mt-8 md:mt-12" dir={isRtl ? "rtl" : "ltr"}>
      <div
        className="mx-auto max-w-[1400px] overflow-hidden px-5 py-9 md:px-8 md:py-14"
      >
        <div className="sf-home-brands__header pb-5 md:pb-6">
          <h2 className="sf-home-brands__title text-xl font-black md:text-2xl">
            {isRtl ? "العلامات التجارية" : "Brands"}
          </h2>
        </div>

        <div className="sf-brand-marquee" dir="ltr">
        <div
          ref={brandTrackRef}
          className={`sf-brand-marquee__track ${brandTransitionEnabled ? "sf-brand-marquee__track--stepping" : ""}`}
          style={{ transform: `translate3d(-${brandSlideIndex * brandStepPx}px, 0, 0)` }}
          onTransitionEnd={handleBrandTransitionEnd}
        >
          {groups.map((group, groupIndex) => (
            <div key={groupIndex} className="sf-brand-marquee__group" aria-hidden={groupIndex > 0 ? "true" : undefined}>
              {group.map((brand, index) => (
                brand ? (
                  <Link
                    key={`${groupIndex}-${brand.id || index}`}
                    to={`/products?brand=${encodeURIComponent(brand.name)}`}
                    className="sf-brand-marquee__item group"
                    aria-label={brand.name || (isRtl ? "عرض العلامة التجارية" : "View brand")}
                    tabIndex={groupIndex > 0 ? -1 : undefined}
                  >
                    <span className="sf-brand-marquee__logo-frame">
                      <img
                        src={imageFor(brand.logo_url)}
                        alt={groupIndex === 0 ? brand.name || "" : ""}
                        loading="lazy"
                        decoding="async"
                        className="sf-brand-marquee__logo"
                        width="240"
                        height="140"
                      />
                    </span>
                  </Link>
                ) : (
                  <div
                    key={`${groupIndex}-skeleton-${index}`}
                    className="sf-brand-marquee__item animate-pulse"
                    style={{ background: themeTokens.cardSoft }}
                  />
                )
              ))}
            </div>
          ))}
        </div>
        </div>
      </div>
    </section>
  );
}

function HomeWhySection({ lang = "ar", themeTokens = {} }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const items = [
    {
      icon: Truck,
      title: isRtl ? "شحن سريع" : "Fast delivery",
      text: isRtl ? "استلم طلبك خلال 24 ساعة داخل نطاق التوصيل." : "Get your order quickly with tracked delivery.",
    },
    {
      icon: RefreshCcw,
      title: isRtl ? "إرجاع سهل خلال 14 يوم" : "Easy 14-day returns",
      text: isRtl ? "يمكنك الإرجاع بسهولة طالما المنتج بحالته الأصلية." : "Simple returns while your item remains in original condition.",
    },
    {
      icon: CreditCard,
      title: isRtl ? "دفع آمن" : "Secure payment",
      text: isRtl ? "عمليات دفع موثوقة تحافظ على بياناتك ومعاملاتك." : "Trusted payment options that protect your information.",
    },
    {
      icon: Headphones,
      title: isRtl ? "دعم فني 24/7" : "24/7 support",
      text: isRtl ? "فريق خدمة العملاء جاهز لمساعدتك في أي وقت." : "Our support team is ready whenever you need help.",
    },
  ];

  return (
    <section data-testid="storefront-service-strip" className="sf-home-motion sf-home-motion--stagger hidden border-y border-white/[0.08] bg-[linear-gradient(180deg,#121212_0%,#080808_100%)] text-white md:mt-12 md:block">
      <div className="mx-auto grid max-w-[1440px] divide-y divide-white/15 px-5 sm:grid-cols-2 sm:divide-x sm:divide-y-0 md:grid-cols-4 md:px-8 rtl:sm:divide-x-reverse">
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="sf-home-motion-item flex min-h-[190px] flex-col items-center justify-center px-4 py-7 text-center md:min-h-[230px] md:px-7" style={{ "--sf-motion-index": index }}>
                <span className="grid h-16 w-16 place-items-center rounded-[42%_58%_52%_48%/48%_42%_58%_52%] bg-white text-[#d4af37] shadow-[0_14px_35px_rgba(0,0,0,0.12)] dark:bg-white/[0.08] dark:text-[#f3d77a] dark:ring-1 dark:ring-white/10">
                  <Icon className="h-8 w-8" strokeWidth={1.55} />
                </span>
                <h3 className="mt-5 text-base font-black leading-6 text-white md:text-lg">{item.title}</h3>
                <p className="mt-2 max-w-[250px] text-xs font-semibold leading-6 text-white/80 md:text-sm">{item.text}</p>
              </div>
            );
          })}
      </div>
    </section>
  );
}

function HomeSimpleFooter({ lang = "ar", themeTokens = {} }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const importantLinks = [
    { label: isRtl ? "الرئيسية" : "Home", to: "/" },
    { label: isRtl ? "حسابي" : "My account", to: "/account" },
    { label: isRtl ? "معلومات عنا" : "About us", to: "/" },
    { label: isRtl ? "موقع العروض" : "Offers", to: "/offers" },
    { label: isRtl ? "الشروط والأحكام" : "Terms & conditions", to: "/terms" },
    // Both legal pages must be reachable from the storefront without an account:
    // platform reviewers follow them from the site, not only from a portal field.
    { label: isRtl ? "سياسة الخصوصية" : "Privacy policy", to: "/privacy" },
  ];
  const categoryLinks = [
    { label: isRtl ? "سنيكرز رجالي" : "Men's sneakers", to: "/men" },
    { label: isRtl ? "سنيكرز حريمي" : "Women's sneakers", to: "/women" },
    { label: isRtl ? "أحذية أطفال" : "Kids sneakers", to: "/kids" },
    { label: isRtl ? "شنط" : "Bags", to: "/bags" },
    { label: isRtl ? "ميرور أوريجنال" : "Mirror Original", to: "/products?quality=mirror_original" },
  ];
  const whatsappHref = buildWhatsAppHref(isRtl ? "مرحبًا، أحتاج مساعدة من خدمة العملاء" : "Hi, I need customer support");
  const currentYear = new Date().getFullYear();
  const supportEmail = "support@m1store-egy.com";
  const socialLinks = [
    { label: "Facebook", href: "https://www.facebook.com/", icon: FaFacebookF },
    { label: "Instagram", href: "https://www.instagram.com/", icon: FaInstagram },
    { label: "TikTok", href: "https://www.tiktok.com/", icon: FaTiktok },
    { label: "YouTube", href: "https://www.youtube.com/", icon: FaYoutube },
  ];
  const paymentMarks = [
    { label: "Mastercard", icon: FaCcMastercard, className: "text-[#eb001b]" },
    { label: "Visa", icon: FaCcVisa, className: "text-[#1434cb]" },
    { label: "PayPal", icon: FaCcPaypal, className: "text-[#0070ba]" },
  ];

  return (
    <footer data-testid="storefront-modern-footer" dir={isRtl ? "rtl" : "ltr"} className="border-t border-stone-200 bg-[#f5f3ef] text-stone-900 dark:border-white/[0.08] dark:bg-[#080808] dark:text-white">
      <div className="mx-auto max-w-[1440px] px-5 pb-10 pt-10 md:px-8 md:pb-12 md:pt-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.25fr_1.6fr_0.9fr_1fr_1.15fr]">
          <div>
            <div className="relative h-24 w-24 md:h-28 md:w-28" aria-label="M1 Store">
              <div className="absolute inset-0 dark:hidden">
                <img src="/branding/m-one-logo-dark-fixed.png?v=20260716" alt="M1 Store" className="absolute inset-0 h-full w-full object-contain" width="160" height="160" decoding="async" />
                <img src="/branding/m-one-logo-dark-m.png?v=20260716" alt="" aria-hidden="true" className="sf-header-logo-moving-m absolute inset-0 h-full w-full object-contain" width="160" height="160" decoding="async" />
              </div>
              <div className="absolute inset-0 hidden dark:block">
                <img src="/branding/m-one-logo-white-fixed.png?v=20260716" alt="M1 Store" className="absolute inset-0 h-full w-full object-contain" width="160" height="160" decoding="async" />
                <img src="/branding/m-one-logo-white-m.png?v=20260716" alt="" aria-hidden="true" className="sf-header-logo-moving-m absolute inset-0 h-full w-full object-contain" width="160" height="160" decoding="async" />
              </div>
            </div>
            <p className="mt-5 text-xs font-bold text-stone-500 dark:text-white/50">{isRtl ? "كل يوم من 12 ظهرًا حتى 12 مساءً" : "Every day, 12 PM – 12 AM"}</p>
            <a href={whatsappHref} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 text-sm font-black text-stone-900 transition hover:text-[#121212] dark:text-white dark:hover:text-[#f3d77a]">
              <FaWhatsapp className="h-5 w-5 text-[#25D366]" />
              {isRtl ? "خدمة العملاء" : "Customer service"}
            </a>
            <a href={`mailto:${supportEmail}`} className="mt-4 flex items-center gap-2 text-sm font-black text-stone-800 transition hover:text-[#121212] dark:text-white/80 dark:hover:text-[#f3d77a]">
              <Mail className="h-5 w-5 text-[#121212] dark:text-[#d4af37]" />
              <span dir="ltr">{supportEmail}</span>
            </a>
            <div className="mt-5 flex flex-wrap gap-2">
              {socialLinks.map(({ label, href, icon: SocialIcon }) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={label} className="grid h-10 w-10 place-items-center rounded-full border border-stone-200 bg-white text-stone-800 transition hover:-translate-y-0.5 hover:border-[#121212] hover:text-[#121212] dark:border-white/10 dark:bg-white/[0.05] dark:text-white dark:hover:border-[#d4af37] dark:hover:text-[#f3d77a]">
                  <SocialIcon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-base font-black">{isRtl ? "معلومات عنا" : "About M1 Store"}</h3>
            <p className="mt-4 text-sm font-semibold leading-7 text-stone-600 dark:text-white/58">
              {isRtl
                ? "M1 Store متجر متخصص في الأحذية والسنيكرز والشنط المختارة بعناية. نهتم بالجودة، الراحة، التصميم العصري والسعر المناسب لتجد اختيارك المناسب لكل يوم."
                : "M1 Store offers carefully selected sneakers, footwear and bags. We focus on quality, comfort, modern design and fair prices for every day."}
            </p>
          </div>

          <nav aria-label={isRtl ? "الأقسام المميزة" : "Featured categories"}>
            <h3 className="text-base font-black">{isRtl ? "أقسام مميزة" : "Featured categories"}</h3>
            <div className="mt-4 grid gap-3">
              {categoryLinks.map((link) => (
                <Link key={link.label} to={link.to} className="text-sm font-bold text-stone-600 transition hover:text-[#121212] dark:text-white/55 dark:hover:text-[#f3d77a]">{link.label}</Link>
              ))}
            </div>
          </nav>

          <nav aria-label={isRtl ? "روابط مهمة" : "Important links"}>
            <h3 className="text-base font-black">{isRtl ? "روابط مهمة" : "Important links"}</h3>
            <div className="mt-4 grid gap-3">
              {importantLinks.map((link) => (
                <Link key={link.label} to={link.to} className="text-sm font-bold text-stone-600 transition hover:text-[#121212] dark:text-white/55 dark:hover:text-[#f3d77a]">{link.label}</Link>
              ))}
            </div>
          </nav>

          <div>
            <h3 className="text-base font-black">{isRtl ? "آخر العروض" : "Latest offers"}</h3>
            <p className="mt-4 text-sm font-semibold leading-7 text-stone-600 dark:text-white/55">
              {isRtl ? "تابع آخر العروض والمنتجات الجديدة مباشرة على بريدك." : "Receive the latest offers and new arrivals in your inbox."}
            </p>
            <form className="mt-4 grid gap-2" onSubmit={(event) => { event.preventDefault(); toast.success(isRtl ? "تم الاشتراك بنجاح" : "Subscribed successfully"); }}>
              <input type="email" required aria-label={isRtl ? "البريد الإلكتروني" : "Email address"} placeholder={isRtl ? "أدخل البريد الإلكتروني" : "Enter your email"} className="h-12 rounded-xl border border-stone-200 bg-white px-4 text-sm font-bold text-stone-900 outline-none transition focus:border-[#121212] dark:border-white/10 dark:bg-white/[0.06] dark:text-white dark:placeholder:text-white/35 dark:focus:border-[#d4af37]" />
              <button type="submit" className="h-12 rounded-xl bg-[#121212] px-4 text-sm font-black text-white transition hover:bg-[#000] active:scale-[0.99] dark:bg-[#d4af37] dark:text-[#111] dark:hover:bg-[#e5c158]">
                {isRtl ? "اشترك دلوقتي" : "Subscribe now"}
              </button>
            </form>
          </div>
        </div>

        {/* Payment marks only: the app-launch block was removed on request — the app is
            not published, so the footer does not advertise it. */}
        <div className="mt-10 border-t border-stone-200 pt-7 dark:border-white/10">
          <div className="flex flex-wrap items-center gap-3">
            {paymentMarks.map(({ label, icon: PaymentIcon, className }) => (
              <span key={label} title={label} aria-label={label} className="grid h-12 min-w-20 place-items-center rounded-xl border border-stone-200 bg-white px-3 shadow-sm dark:border-white/10 dark:bg-white">
                <PaymentIcon className={`h-8 w-14 ${className}`} />
              </span>
            ))}
            <span title="Meeza" aria-label="Meeza" className="grid h-12 min-w-20 place-items-center rounded-xl border border-stone-200 bg-white px-3 shadow-sm dark:border-white/10 dark:bg-white">
              <img src="/branding/meeza-logo.svg" alt="Meeza" className="h-8 w-14 object-contain" width="56" height="32" loading="lazy" decoding="async" />
            </span>
          </div>
        </div>
      </div>

      <div className="bg-[#050505] px-5 py-5 text-center text-sm font-bold text-white dark:text-white/55">
        {isRtl ? `جميع الحقوق محفوظة © ${currentYear} - M1 Store` : `© ${currentYear} M1 Store. All rights reserved.`}
      </div>
    </footer>
  );
}

function SimpleHomeProductGrid({ title, subtitle, viewAllTo = "/products", products = [], loading = false, themeTokens = getStorefrontThemeTokens("dark"), lang = "ar" }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const visibleProducts = (Array.isArray(products) ? products : []).filter((product) => product?.id && product?.name).slice(0, 8);
  if (!visibleProducts.length && !loading) return null;

  return (
    <section className="sf-home-motion sf-home-motion--stagger mx-auto max-w-[1400px] px-4 py-5 md:py-7">
      <div
        className="overflow-hidden rounded-[2rem] border"
        style={{
          background: themeTokens.surface,
          borderColor: themeTokens.border,
          boxShadow: themeTokens.shadowSoft,
        }}
      >
        <div className="flex flex-col gap-4 border-b px-4 py-5 md:flex-row md:items-end md:justify-between md:px-6" style={{ borderColor: themeTokens.border }}>
        <div className="min-w-0">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: themeTokens.accent }}>
            {isRtl ? "الأقسام المختارة" : "Selected section"}
          </div>
          <h2 className="text-[1.9rem] font-black tracking-tight md:text-[3.15rem]" style={{ color: themeTokens.textPrimary }}>{title}</h2>
          {subtitle ? <p className="mt-1.5 text-xs font-bold md:text-sm" style={{ color: themeTokens.textSecondary }}>{subtitle}</p> : null}
        </div>
        <Link
          to={viewAllTo}
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border px-4 py-2 text-xs font-black transition hover:-translate-y-0.5 active:scale-[0.98]"
          style={{
            background: themeTokens.card,
            borderColor: themeTokens.border,
            color: themeTokens.textPrimary,
          }}
        >
          {sfText("common.viewAll")}
        </Link>
      </div>
      {loading && !visibleProducts.length ? (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 md:p-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[320px] animate-pulse rounded-[1.45rem] border" style={{ background: themeTokens.cardSoft, borderColor: themeTokens.border }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 md:p-6">
          {visibleProducts.map((product, index) => {
            const slide = featuredSlideProduct(product);
            const price = Number(slide.price || product.price || product.final_price || product.selling_price || product.regular_price || 0) || 0;
            const comparePrice = Number(slide.comparePrice || 0) || 0;
            const image = slide.image || product.image_url || product.product_image_url || product.gallery_images?.[0] || "";
            return (
            <Link
              key={product.card_id || product.id || index}
              to={productUrl(product)}
              className="sf-home-motion-item group min-w-0 overflow-hidden rounded-[1.45rem] border text-right transition duration-300 hover:-translate-y-1 active:scale-[0.99]"
              style={{
                "--sf-motion-index": index,
                background: themeTokens.card,
                borderColor: themeTokens.border,
                boxShadow: themeTokens.shadowSoft,
              }}
            >
              <div className="relative aspect-[0.98/1] overflow-hidden" style={{ background: themeTokens.surface }}>
                <img
                  src={imageFor(image)}
                  {...responsiveImageProps(image, "grid")}
                  alt={product.name || ""}
                  onError={fallbackProductImage}
                  className="h-full w-full object-contain p-3 transition duration-500 group-hover:scale-[1.05]"
                  loading="lazy"
                  decoding="async"
                  width="360"
                  height="360"
                />
                {price > 0 && comparePrice > price ? (
                  <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: themeTokens.accent, color: themeTokens.accentText }}>
                    {Math.max(1, Math.round(((comparePrice - price) / comparePrice) * 100))}%
                  </span>
                ) : null}
              </div>
              <div className="p-4">
                <h3 className="line-clamp-2 min-h-12 text-[0.98rem] font-black leading-5" style={{ color: themeTokens.textPrimary }}>{product.name}</h3>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div className="text-[1.05rem] font-black" style={{ color: themeTokens.textPrimary }}>
                    {price > 0 ? money(price) : "-"}
                  </div>
                  {comparePrice > price ? (
                    <div className="text-xs font-bold line-through" style={{ color: themeTokens.muted }}>{money(comparePrice)}</div>
                  ) : null}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="inline-flex rounded-full border px-3 py-1 text-[11px] font-black" style={{ background: themeTokens.surface, borderColor: themeTokens.border, color: themeTokens.textSecondary }}>
                    {isRtl ? "تفاصيل" : "Details"}
                  </span>
                  <span className="inline-flex rounded-full px-3 py-1 text-[11px] font-black" style={{ background: themeTokens.accentSoft, color: themeTokens.accent }}>
                    {isRtl ? "تسوق" : "Shop"}
                  </span>
                </div>
              </div>
            </Link>
            );
          })}
        </div>
      )}
      </div>
    </section>
  );
}

function SectionIntro({ eyebrow, title, subtitle, compact = false }) {
  return (
    <div className={compact ? "max-w-2xl" : "max-w-3xl"}>
      <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-[#d4af37] dark:text-[#f3d77a] md:mb-1 md:text-[11px] md:tracking-[0.18em]">{eyebrow}</div>
      <h2 className={`${compact ? "text-[1.4rem] md:text-[2.2rem]" : "text-[1.65rem] md:text-[2.6rem]"} font-black tracking-tight text-stone-950 dark:text-stone-100`}>{title}</h2>
      {subtitle ? <p className="mt-1.5 text-xs font-semibold leading-5 text-stone-500 dark:text-stone-400 md:mt-2.5 md:text-sm md:leading-6">{subtitle}</p> : null}
      <div className="mt-2 h-1 w-12 rounded-full bg-gradient-to-l from-[#d4af37] to-[#f3d77a] md:mt-2.5 md:h-[3px] md:w-16" />
    </div>
  );
}



function OfferStoryEmptyState({ title, text, actionLabel, onAction }) {
  return (
    <div className="grid place-items-center rounded-[1.5rem] border border-white/12 bg-white/[0.08] p-6 text-center backdrop-blur">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-[#f8e7b3]/20 bg-[#d4af37]/10 text-[#f8e7b3]">
        <BadgePercent className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-xl font-black text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-6 text-white/66">{text}</p>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-[#f8e7b3]/20 bg-[#f8e7b3] px-5 py-3 text-sm font-black text-stone-950 transition hover:bg-[#f3d77a] active:scale-[0.98]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function OfferStoryBubble({ label, count, active, onClick, compact = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-full border px-3 py-2.5 text-center font-black transition active:scale-[0.98] ${ active ? "border-[#f8e7b3]/55 bg-[#f8e7b3] text-stone-950 shadow-[0_18px_34px_rgba(248,231,179,0.18)]" : "border-white/10 bg-white/[0.06] text-white hover:border-[#f8e7b3]/35 hover:bg-[#f8e7b3]/10" } ${compact ? "min-h-11 text-sm" : "min-h-14 text-[0.95rem] md:min-h-16 md:text-base"}`}
    >
      <span className="block truncate">{label}</span>
      {Number.isFinite(Number(count)) ? <span className={`mt-0.5 block text-[10px] font-black ${active ? "text-stone-800" : "text-white/45"}`}>{count} {Number(count) === 1 ? "موديل" : "موديلات"}</span> : null}
    </button>
  );
}

function OfferStorySlide({ storyItem, selectedSize, onViewProduct, onTouchStart, onTouchEnd }) {
  const product = storyItem || {};
  const variant = storyItem?.storyVariant || offerStoryMatchingVariant(product, selectedSize);
  const imageSrc = storyItem?.image || variantImage(variant) || imageFor(product.image_url || product.image || product.gallery_images?.[0] || "");
  const sizeChips = Array.isArray(storyItem?.sizes) && storyItem.sizes.length ? storyItem.sizes : extractOfferSizes(product);
  const priceInfo = offerStoryPriceInfo(product);
  return (
    <div
      className="relative isolate flex h-full min-h-[72dvh] overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-[0_28px_90px_rgba(0,0,0,0.45)] md:min-h-[76dvh]"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.14)_0%,rgba(0,0,0,0.03)_18%,rgba(0,0,0,0.22)_68%,rgba(0,0,0,0.64)_100%)]" />
      <div className="relative z-20 flex h-full w-full flex-col px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[3.25rem] md:px-5 md:pt-[3.5rem]">
        <div className="relative flex min-h-0 flex-[1.55] items-center justify-center">
          <div className="flex h-full w-full max-w-[58rem] items-center justify-center rounded-[1.5rem] bg-white/100 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.22)] md:p-4">
            <img
              src={imageSrc}
              onError={fallbackProductImage}
              alt={product.name}
              className="pointer-events-none h-full w-full max-h-[44dvh] aspect-square object-contain"
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
        <div className="mx-auto mt-4 flex w-full max-w-2xl flex-[1] min-h-0 flex-col">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-lg font-black leading-6 text-white md:text-2xl md:leading-7">{product.name}</h3>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-white/48">{product.brand_name || product.brand || ""}</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-2xl font-black text-white md:text-4xl">{money(priceInfo.displayPrice)}</span>
              {priceInfo.crossedPrice > priceInfo.displayPrice ? <span className="pb-1 text-sm font-bold text-white/40 line-through md:text-base">{money(priceInfo.crossedPrice)}</span> : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sizeChips.map((size) => (
              <span key={size} className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${String(size) === String(selectedSize) ? "border-[#f8e7b3]/40 bg-[#f8e7b3] text-stone-950" : "border-white/12 bg-black/30 text-white/86"}`}>
                {size}
              </span>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onViewProduct(variant);
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#f8e7b3]/25 bg-[#f8e7b3] px-5 py-3 text-sm font-black text-stone-950 transition hover:bg-[#f3d77a] active:scale-[0.98]"
            >
              عرض المنتج
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OfferStoryViewer() {
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const lang = normalizeLanguage(i18n.language || i18n.resolvedLanguage || "ar");
  const offerStoryQuery = useProducts({ offer_story: 1, sort: "newest", limit: 500 }, { ttlMs: 0 });
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartXRef = useRef(0);
  const touchEndXRef = useRef(0);

  const normalizedProducts = useMemo(() => (
    uniqueProductsByIdentity(offerStoryQuery.products || [])
      .filter((product) => Boolean(product?.id && product?.name))
  ), [offerStoryQuery.products]);
  const offerProducts = useMemo(() => (
    normalizedProducts.filter((product) => isStorefrontVisibleOfferProduct(product))
  ), [normalizedProducts]);
  const storyItems = useMemo(() => (
    offerProducts.flatMap((product) => offerStoryBuildStoryItems(product))
  ), [offerProducts]);
  const hasOfferProducts = offerProducts.length > 0;

  useEffect(() => {
    if (import.meta.env.DEV) {
      offerProducts.slice(0, 3).forEach((product) => {
        console.log("[offer-story-price-debug]", product.id, product.name, {
          sale_price: product.sale_price,
          salePrice: product.salePrice,
          selling_price: product.selling_price,
          price: product.price,
          compare_at_price: product.compare_at_price,
          original_price: product.original_price,
        });
      });
      console.log("[offer-story-items]", storyItems.map((item) => ({
        productId: item.productId,
        color: item.color,
        name: item.name,
        sizes: item.sizes,
        image: item.image,
      })));
      console.log("[offer-story-filter-check]", normalizedProducts.map((product) => ({
        id: product.id,
        name: product.name,
        is_offer_story: product.is_offer_story,
        isOfferStory: product.isOfferStory,
        is_storefront_visible: product.is_storefront_visible,
        storefront_visible: product.storefront_visible,
      })));
      console.log("[offer-story-final-products]", storyItems.length, storyItems.map((product) => ({
        id: product.id,
        name: product.name,
        sizes: product.sizes,
        variantsCount: Array.isArray(product.variants) ? product.variants.length : 0,
        firstVariant: Array.isArray(product.variants) ? product.variants[0] || null : null,
        extracted: extractOfferSizes(product),
      })));
    }
  }, [normalizedProducts, offerProducts, storyItems]);

  const availableSizes = useMemo(() => {
    return sortProductSizes(
      Array.from(
        new Set(
          storyItems.flatMap((product) => Array.isArray(product.sizes) && product.sizes.length ? product.sizes : extractOfferSizes(product))
        )
      )
    );
  }, [storyItems]);
  const sizeCounts = useMemo(() => {
    const map = new Map();
    storyItems.forEach((product) => {
      const sizes = Array.isArray(product.sizes) && product.sizes.length ? product.sizes : extractOfferSizes(product);
      sizes.forEach((size) => {
        const key = String(size || "").trim();
        if (!key) return;
        map.set(key, (map.get(key) || 0) + 1);
      });
    });
    return map;
  }, [storyItems]);

  const productsForSize = useMemo(
    () => storyItems.filter((product) => !selectedSize || offerStoryProductMatches(product, selectedSize)),
    [selectedSize, storyItems]
  );

  const typeOptions = useMemo(() => {
    const map = new Map();
    productsForSize.forEach((product) => {
      offerStoryProductTypeValues(product).forEach((typeValue) => {
        const key = String(typeValue || "").trim().toLowerCase();
        if (!key) return;
        if (!map.has(key)) {
          map.set(key, { value: key, label: getProductTypeLabel(key, lang), count: 0 });
        }
        map.get(key).count += 1;
      });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, lang, { numeric: true }));
  }, [lang, productsForSize]);

  const stage = !selectedSize ? "size" : !selectedType ? "type" : "story";

  const storyProducts = useMemo(() => (
    sortStorefrontColorCardsByModel(
      productsForSize.filter((product) => !selectedType || offerStoryProductMatches(product, selectedSize, selectedType))
    )
  ), [productsForSize, selectedSize, selectedType]);
  const isLoading = Boolean(offerStoryQuery.loading);
  const loadError = offerStoryQuery.error || "";

  console.log(
    "[offer-story-current-product]",
    currentIndex,
    storyProducts[currentIndex]?.id,
    storyProducts[currentIndex]?.name
  );

  useEffect(() => {
    setCurrentIndex(0);
  }, [selectedSize, selectedType]);

  useEffect(() => {
    if (currentIndex >= storyProducts.length) setCurrentIndex(0);
  }, [currentIndex, storyProducts.length]);

  const hasAnyProducts = storyProducts.length > 0 || storyItems.length > 0;
  const currentStory = storyProducts[currentIndex] || storyProducts[0] || null;

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") navigate("/");
      if (stage !== "story") return;
      if (event.key === "ArrowLeft") setCurrentIndex((index) => Math.max(0, index - 1));
      if (event.key === "ArrowRight") setCurrentIndex((index) => Math.min(Math.max(storyProducts.length - 1, 0), index + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, stage, storyProducts.length]);

  const goPrev = useCallback(() => {
    if (stage === "size") return navigate("/");
    if (stage === "type") return setSelectedSize("");
    setCurrentIndex((index) => {
      const total = storyProducts.length;
      console.log("[offer-story-nav]", { direction: "prev", currentIndex: index, total });
      if (!total) return 0;
      return (index - 1 + total) % total;
    });
  }, [navigate, stage, storyProducts.length]);

  const goNext = useCallback(() => {
    if (stage === "size" || stage === "type") return;
    setCurrentIndex((index) => {
      const total = storyProducts.length;
      console.log("[offer-story-nav]", { direction: "next", currentIndex: index, total });
      if (!total) return 0;
      return (index + 1) % total;
    });
  }, [stage, storyProducts.length]);

  const handleTouchStart = (event) => {
    touchStartXRef.current = event.changedTouches?.[0]?.screenX ?? 0;
  };

  const handleTouchEnd = (event) => {
    touchEndXRef.current = event.changedTouches?.[0]?.screenX ?? 0;
    const delta = touchStartXRef.current - touchEndXRef.current;
    if (Math.abs(delta) < 48) return;
    if (delta > 0) goNext();
    else goPrev();
  };

  const openProduct = (variant = null) => {
    if (!currentStory) return;
    const url = appendProductUrlParams(productUrl(currentStory), [
      ["variant", variant?.edition_slug || variant?.id || ""],
      ["size", selectedSize || variant?.size || ""],
      ["color", variant?.color || variant?.color_key || ""],
    ]);
    navigate(url);
  };

  const closeStory = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/");
  }, [navigate]);

  const handleViewerClick = useCallback((event) => {
    if (stage !== "story") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const isRightHalf = clickX > rect.width / 2;
    if (isRightHalf) goNext();
    else goPrev();
  }, [goNext, goPrev, stage]);

  const storyProgressTotal = Math.max(stage === "story" ? storyProducts.length : 0, 0);
  const storyProgressIndex = stage === "story" ? currentIndex : 0;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[2000] overflow-hidden bg-[linear-gradient(180deg,#040404_0%,#101010_45%,#040404_100%)] text-white" dir="rtl" onClick={handleViewerClick}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(212,175,55,0.22),transparent_24%),radial-gradient(circle_at_82%_10%,rgba(248,231,179,0.12),transparent_18%)]" />
      <div className="relative flex h-[100dvh] w-[100vw] flex-col px-3 pb-[calc(0.8rem+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top,12px)+0.35rem)] md:px-5">
        <div className="flex items-start gap-3">
          <button type="button" onClick={(event) => { event.stopPropagation(); closeStory(); }} className="relative z-30 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/12 bg-white/8 text-white transition active:scale-95" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
          <div className="flex-1 pt-1">
            {stage === "story" && storyProgressTotal > 0 ? (
              <div className="relative z-30 flex gap-1.5">
                {Array.from({ length: storyProgressTotal }).map((_, itemIndex) => (
                  <span key={itemIndex} className={`h-1 flex-1 overflow-hidden rounded-full ${itemIndex === storyProgressIndex ? "bg-white/22 after:block after:h-full after:w-full after:rounded-full after:bg-[#f8e7b3] after:content-['']" : itemIndex < storyProgressIndex ? "bg-[#f8e7b3]" : "bg-white/16"}`} />
                ))}
              </div>
            ) : null}
          </div>
          {stage === "story" ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); goPrev(); }} className="relative z-30 grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/12 bg-white/8 text-white transition active:scale-95" aria-label="رجوع">
              <ChevronLeft className="h-5 w-5 rotate-180" />
            </button>
          ) : (
            <div className="h-11 w-11 shrink-0" />
          )}
        </div>

        <div className="min-h-0 flex-1 pt-2 md:pt-3">
          {isLoading && !offerProducts.length ? (
            <div className="grid h-full min-h-[52vh] place-items-center">
              <div className="text-center">
                <div className="mx-auto h-14 w-14 animate-pulse rounded-full border border-[#f8e7b3]/30 bg-[#f8e7b3]/12" />
                <p className="mt-4 text-sm font-black text-white/70">جاري تحميل العروض</p>
              </div>
            </div>
          ) : loadError && !offerProducts.length ? (
            <div className="flex h-full items-center justify-center">
              <OfferStoryEmptyState
                title="تعذر تحميل العروض"
                text={String(loadError || "حدث خطأ أثناء تحميل العروض")}
                actionLabel="العودة للرئيسية"
                onAction={() => navigate("/")}
              />
            </div>
          ) : stage === "size" ? (
            <div className="flex h-full min-h-0 flex-col justify-start pt-0">
              <div className="mx-auto max-w-2xl text-center">
                <h2 className="text-2xl font-black md:text-4xl">اختر مقاسك</h2>
                <p className="mt-1 text-sm font-bold text-white/58 md:text-base">المقاسات المتاحة داخل عروض المتجر</p>
              </div>
              {availableSizes.length > 0 ? (
                <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {availableSizes.map((size) => (
                    <OfferStoryBubble
                      key={size}
                      label={size}
                      count={sizeCounts.get(size) || 0}
                      active={false}
                      onClick={() => {
                        setSelectedSize(size);
                        setSelectedType("");
                        setCurrentIndex(0);
                      }}
                    />
                  ))}
                </div>
              ) : null}
              {!availableSizes.length && hasOfferProducts ? (
                <div className="mt-6 rounded-[1.4rem] border border-[#f8e7b3]/18 bg-[linear-gradient(145deg,rgba(212,175,55,0.10),rgba(255,255,255,0.03))] p-5 text-center shadow-[0_14px_30px_rgba(0,0,0,0.18)]">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-[#f8e7b3]/20 bg-[#f8e7b3]/10 text-[#f8e7b3]">
                    <BadgePercent className="h-7 w-7" />
                  </div>
                  <h3 className="mt-4 text-lg font-black text-white">تم العثور على 7 منتجات عروض</h3>
                  <p className="mt-2 text-sm font-bold leading-6 text-white/72">
                    لكن لم يتم العثور على أي مقاسات داخل بيانات المنتج.
                  </p>
                  <p className="mt-2 text-xs font-bold leading-5 text-white/50">
                    يرجى التحقق من `variants` أو `color_cards` أو `variant_matrix` أو `inventory_variants` أو `available_options` داخل بيانات المنتج.
                  </p>
                </div>
              ) : null}
              {!availableSizes.length && !hasOfferProducts ? (
                <div className="mt-8">
                  <OfferStoryEmptyState
                    title="لا توجد عروض متاحة الآن"
                    text="لم نتمكن من العثور على منتجات عروض صالحة للعرض في المتجر."
                    actionLabel="العودة للرئيسية"
                    onAction={() => navigate("/")}
                  />
                </div>
              ) : null}
            </div>
          ) : stage === "type" ? (
            <div className="flex h-full min-h-0 flex-col justify-start pt-0">
              <div className="mx-auto max-w-2xl text-center">
                <h2 className="text-2xl font-black md:text-4xl">اختر نوع المنتج</h2>
                <p className="mt-1 text-sm font-bold text-white/58 md:text-base">المقاس المختار: {selectedSize}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {typeOptions.map((option) => (
                  <OfferStoryBubble
                    key={option.value}
                    label={option.label}
                    count={option.count}
                    active={false}
                    compact
                    onClick={() => {
                      setSelectedType(option.value);
                      setCurrentIndex(0);
                    }}
                  />
                ))}
              </div>
              {!typeOptions.length ? (
                <div className="mt-8">
                  <OfferStoryEmptyState
                    title="لا توجد أنواع لهذا المقاس"
                    text="جرّب مقاساً آخر من نفس العروض."
                    actionLabel="رجوع"
                    onAction={() => setSelectedSize("")}
                  />
                </div>
              ) : null}
            </div>
          ) : hasAnyProducts && currentStory ? (
            <div className="flex h-full min-h-0">
              <OfferStorySlide
                storyItem={currentStory}
                index={currentIndex}
                total={storyProducts.length}
                selectedSize={selectedSize}
                lang={lang}
                onPrev={(event) => { event?.stopPropagation?.(); setCurrentIndex((index) => Math.max(0, index - 1)); }}
                onNext={(event) => { event?.stopPropagation?.(); goNext(); }}
                onViewProduct={(variant) => openProduct(variant)}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <OfferStoryEmptyState
                title="لا توجد عروض متاحة"
                text="لا توجد منتجات مطابقة للمقاس أو النوع الحاليين."
                actionLabel="إعادة التصفية"
                onAction={() => {
                  setSelectedSize("");
                  setSelectedType("");
                  setCurrentIndex(0);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

const ProductRail = memo(function ProductRail({ title, subtitle, products, loading, wishlist, toggleWishlist, onAddToCart, saleModeEnabled, railType = "default", featuredFirst = false }) {
  const { t } = useTranslation();
  const orderedProducts = useMemo(() => sortStorefrontColorCardsByModel(products), [products]);
  const hasProducts = orderedProducts.length > 0;
  const visibleProducts = hasProducts ? orderedProducts.slice(0, 5) : [];
  const skeletonItems = Array.from({ length: 5 });
  const cardDensity = railType === "new" || railType === "similar" ? "compact" : "standard";
  if (!loading && !hasProducts) return null;
  return (
    <section className="sf-reveal mx-auto max-w-[1200px] px-4 py-2 md:py-4">
      <div className="mb-2 flex items-end justify-between gap-3 text-right md:mb-4 md:gap-4">
        <div className="min-w-0">
          <div className="mb-0.5 text-[9px] font-black uppercase tracking-[0.15em] text-[#d4af37] dark:text-[#f3d77a] md:mb-1 md:text-[11px] md:tracking-[0.18em]">{t("storefront.common.shopNow")}</div>
          <h2 className="text-[1.25rem] font-black tracking-normal md:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[11px] font-bold text-stone-500 dark:text-stone-400 md:mt-1 md:text-sm">{subtitle}</p> : null}
          <div className="mt-1 h-0.5 w-10 rounded-full bg-gradient-to-l from-[#d4af37] to-[#f3d77a] md:mt-1.5 md:h-1 md:w-14" />
        </div>
        <Link to="/products" className="mb-0.5 inline-flex min-h-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-black text-stone-700 shadow-[0_10px_26px_rgba(39,20,75,0.07)] transition hover:-translate-y-0.5 hover:border-[#d4af37]/50 hover:text-[#d4af37] active:scale-[0.98] md:mb-1 md:min-h-10 md:px-5 md:py-2 md:text-xs dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
          {t("common.viewAll")}
        </Link>
      </div>
      <div className="sf-product-rail sf-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1.5 md:flex-nowrap md:gap-4 md:overflow-hidden md:pb-1">
        {loading ? skeletonItems.map((_, index) => (
          <div key={index} className={`w-[82vw] max-w-[22rem] shrink-0 snap-start sm:w-[43vw] md:w-auto md:max-w-none md:basis-[calc((100%_-_2rem)/3)] xl:basis-[calc((100%_-_4rem)/5)] ${index >= 3 ? "md:hidden xl:block" : ""}`}>
            <div className="h-56 animate-pulse rounded-[1.35rem] bg-white shadow-[0_12px_32px_rgba(39,20,75,0.06)] md:h-72 md:rounded-[1.75rem] dark:bg-white/5" />
          </div>
        )) : visibleProducts.map((product, index) => (
          <div key={productCardKey(product, index)} className={`w-[82vw] max-w-[22rem] shrink-0 snap-start sm:w-[43vw] md:w-auto md:max-w-none md:basis-[calc((100%_-_2rem)/3)] xl:basis-[calc((100%_-_4rem)/5)] ${index >= 3 ? "md:hidden xl:block" : ""}`}>
            <ProductCard product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} railType={railType} rank={index + 1} featured={featuredFirst && index === 0} density={cardDensity} imagePreset="grid" saleModeEnabled={saleModeEnabled} />
          </div>
        ))}
      </div>
    </section>
  );
});

function useStorefrontProductGridColumns() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  return width >= 768 ? 4 : 2;
}

// `revealAll` belongs to a paginated listing: the page already carries exactly the
// count the customer chose, so revealing it in batches makes a full page look short
// until they scroll. Endless rails keep the batched reveal.
const ProductGrid = memo(function ProductGrid({ products = [], loading, wishlist, toggleWishlist, onAddToCart, saleModeEnabled, revealAll = false }) {
  const columnCount = useStorefrontProductGridColumns();
  const initialBatchSize = revealAll ? Math.max(products.length, 1) : columnCount >= 4 ? 16 : 12;
  const appendBatchSize = columnCount >= 4 ? 8 : 4;
  const [visibleCount, setVisibleCount] = useState(initialBatchSize);
  const [isAppending, setIsAppending] = useState(false);
  const loadMoreSentinelRef = useRef(null);
  const productSignature = useMemo(
    () => products.map((product, index) => productCardKey(product, index)).join("|"),
    [products]
  );
  const visibleProducts = useMemo(
    () => products.slice(0, visibleCount),
    [products, visibleCount]
  );
  const hasMoreProducts = visibleCount < products.length;

  useEffect(() => {
    setVisibleCount(initialBatchSize);
    setIsAppending(false);
  }, [initialBatchSize, productSignature]);

  const loadMoreProducts = useCallback(() => {
    if (isAppending || !hasMoreProducts) return;
    setIsAppending(true);
    window.setTimeout(() => {
      setVisibleCount((current) => Math.min(products.length, current + appendBatchSize));
      setIsAppending(false);
    }, 120);
  }, [appendBatchSize, hasMoreProducts, isAppending, products.length]);

  useEffect(() => {
    const target = loadMoreSentinelRef.current;
    if (!target || !hasMoreProducts || isAppending || typeof window === "undefined" || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreProducts();
        }
      },
      { rootMargin: "320px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreProducts, isAppending, loadMoreProducts]);

  const renderProduct = useCallback((product, index, key) => {
    return (
      <ProductCard
        key={key}
        product={product}
        wishlist={wishlist}
        toggleWishlist={toggleWishlist}
        onAddToCart={onAddToCart}
        saleModeEnabled={saleModeEnabled}
        sizeLimit={4}
        eagerImage={index < columnCount}
        priorityImage={index === 0}
      />
    );
  }, [columnCount, onAddToCart, saleModeEnabled, toggleWishlist, wishlist]);

  if (loading && !products.length) return <ProductSkeleton count={8} />;

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-5">
        {visibleProducts.map((product, index) => renderProduct(product, index, productCardKey(product, index)))}
      </div>
      {isAppending ? <div className="mt-3"><ProductSkeleton count={appendBatchSize} /></div> : null}
      {hasMoreProducts ? <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-px w-full" /> : null}
    </>
  );
});

const productHasAvailableSize = (product = {}, size = "") => {
  const target = String(size || "").trim().toLowerCase();
  if (!target) return true;
  const crocsProduct = isCrocsProduct(product);
  return (Array.isArray(product.variants) ? product.variants : []).some((variant) =>
    String(crocsProduct ? resolveCrocsEuSize(variant?.size) : variant?.size || "").trim().toLowerCase() === target && variantHasStock(variant)
  );
};

const buildAvailableSizeOptions = (products = []) => {
  const sizes = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
      const originalSize = String(variant?.size || "").trim();
      const size = isCrocsProduct(product) ? resolveCrocsEuSize(originalSize) : originalSize;
      if (!size) continue;
      const current = sizes.get(size) || { size, available: false, stock: 0, productCount: 0 };
      const stock = safeStockNumber(variant?.stock ?? variant?.quantity ?? variant?.inventory_stock ?? variant?.available_stock);
      current.available ||= stock > 0;
      current.stock += stock;
      if (stock > 0) current.productCount += 1;
      sizes.set(size, current);
    }
  }
  return Array.from(sizes.values()).sort((a, b) => {
    if (isKnownCrocsSize(a.size) || isKnownCrocsSize(b.size)) {
      return compareCrocsSizes(a.size, b.size);
    }
    const numericA = Number(a.size);
    const numericB = Number(b.size);
    if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
    return String(a.size).localeCompare(String(b.size), "ar", { numeric: true });
  });
};

function StepPill({ active, done, label }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] md:px-3 md:py-1.5 md:text-xs ${active ? "border-[#d4af37] bg-[#f5f3ff] text-[#d4af37]" : done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-white text-stone-500"} dark:border-white/10 dark:bg-white/5 dark:text-stone-200`}>
      {label}
    </span>
  );
}

function GuidedGenderStep({ options = [], selectedGender, lang, onSelect }) {
  const { t } = useTranslation();
  return (
    <section className="scroll-mt-20">
      <div className="mb-2 flex items-end justify-between gap-2 md:mb-2.5 md:gap-3">
        <SectionIntro eyebrow={t("storefront.filters.gender")} title={t("storefront.products.chooseWearer")} subtitle={t("storefront.products.chooseWearerSubtitle")} compact />
      </div>
      <div className="flex flex-wrap gap-1.5 md:gap-2">
        {options.map((option) => {
          const active = String(selectedGender || "") === String(option.value || "");
          const Icon = filterOptionIcon("gender", option, lang);
          return (
            <button
              key={option.id || option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`group inline-flex min-h-[44px] min-w-[96px] items-center gap-2 rounded-full border px-3 py-1.5 text-right shadow-[0_10px_24px_rgba(39,20,75,0.045)] transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-[52px] md:min-w-[120px] md:px-4 ${ active ? "border-[#d4af37] bg-[#151515] text-[#d4af37] ring-2 ring-[#d4af37]/15" : "border-stone-200 bg-white text-stone-900 hover:border-[#d4af37]/45 dark:border-white/10 dark:bg-[#101010] dark:text-white" }`}
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${active ? "bg-[#d4af37] text-stone-950" : "bg-stone-100 text-[#d4af37] dark:bg-white/8"}`}>
                <Icon className="h-3 w-3" />
              </span>
              <span className="block whitespace-nowrap text-[11px] font-black leading-4 md:text-[13px] md:leading-5">{classificationLabel(option, lang)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GuidedGradeStep({ options = [], selectedGrade, lang, disabled, loading, onSelect }) {
  const { t } = useTranslation();
  return (
    <div className={`rounded-[0.9rem] border border-stone-200 bg-white p-2 shadow-[0_10px_24px_rgba(39,20,75,0.05)] dark:border-white/10 dark:bg-[#101010] md:rounded-[1.25rem] md:p-2.5 ${disabled ? "pointer-events-none opacity-55" : ""}`}>
      <div className="flex flex-wrap gap-1.5 md:gap-2">
        {loading ? <ProductTypeSkeleton /> : options.map((option) => {
          const active = normalizeFilterKey(selectedGrade) === normalizeFilterKey(option.value);
          const Icon = filterOptionIcon("grade", option, lang);
          const count = Number(option.count ?? option.product_count ?? filterOptionCount(option));
          return (
            <button
              key={option.id || option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`group inline-flex min-h-[44px] min-w-[112px] items-center gap-2 rounded-full border px-3 py-1.5 text-right transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-[52px] md:min-w-[128px] md:px-4 ${ active ? "border-[#d4af37] bg-[#151515] text-[#d4af37] ring-2 ring-[#d4af37]/15" : "border-stone-200 bg-[#fbfaf7] text-stone-900 hover:border-[#d4af37]/45 dark:border-white/10 dark:bg-white/5 dark:text-white" }`}
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${active ? "bg-[#d4af37] text-stone-950" : "bg-white text-[#d4af37] shadow-sm dark:bg-white/8"}`}>
                <Icon className="h-3 w-3" />
              </span>
              <span className="block truncate text-[11px] font-black leading-4 md:text-[13px] md:leading-5">{classificationLabel(option, lang)}</span>
              {Number.isFinite(Number(count)) ? <span className="mr-auto text-[9px] font-bold leading-3 text-stone-500 dark:text-stone-400 md:text-[10px] md:leading-4">{t("storefront.products.productCount", undefined, { count })}</span> : null}
            </button>
          );
        })}
      </div>
      {!loading && !options.length ? <EmptyState title={t("storefront.products.noGradesAvailable")} text={t("storefront.products.goBackChooseAnother")} /> : null}
    </div>
  );
}

function GuidedProductTypeStep({ options = [], selectedProductType, lang, disabled, loading, products = [], onSelect }) {
  const { t } = useTranslation();
  const productCountByType = useMemo(() => {
    const counts = new Map();
    for (const product of Array.isArray(products) ? products : []) {
      const key = normalizeStorefrontProductTypeKey(product?.product_type || product?.productType || product?.category || "");
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [products]);
  return (
    <div className={`rounded-[0.9rem] border border-stone-200 bg-white p-2 shadow-[0_10px_24px_rgba(39,20,75,0.05)] dark:border-white/10 dark:bg-[#0d0d0d] md:rounded-[1.25rem] md:p-2.5 ${disabled ? "pointer-events-none opacity-55" : ""}`}>
      <div className="flex flex-wrap gap-1.5 md:gap-2">
        {loading ? <ProductTypeSkeleton /> : options.map((option) => {
          const active = normalizeStorefrontProductTypeKey(selectedProductType) === normalizeStorefrontProductTypeKey(option.value);
          const Icon = filterOptionIcon("product_type", option, lang);
          const count = productCountByType.get(normalizeStorefrontProductTypeKey(option.value)) ?? filterOptionCount(option);
          return (
            <button
              key={option.id || option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`group inline-flex min-h-[44px] min-w-[112px] items-center gap-2 rounded-full border px-3 py-1.5 text-right transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-[52px] md:min-w-[128px] md:px-4 ${ active ? "border-[#d4af37] bg-[#f5f3ff] text-[#5b21b6] ring-2 ring-[#d4af37]/15" : "border-stone-200 bg-[#fbfaf7] text-stone-900 hover:border-[#d4af37]/45 dark:border-white/10 dark:bg-white/5 dark:text-white" }`}
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${active ? "bg-[#d4af37] text-white" : "bg-white text-[#d4af37] shadow-sm dark:bg-white/8"}`}>
                <Icon className="h-3 w-3" />
              </span>
              <span className="block truncate text-[11px] font-black leading-4 md:text-[13px] md:leading-5">{classificationLabel(option, lang)}</span>
              {Number.isFinite(Number(count)) ? <span className="mr-auto text-[9px] font-bold leading-3 text-stone-500 dark:text-stone-400 md:text-[10px] md:leading-4">{t("storefront.products.productCount", undefined, { count })}</span> : null}
            </button>
          );
        })}
      </div>
      {!loading && !options.length ? <EmptyState title={t("storefront.products.noTypesForCategory")} text={t("storefront.products.goBackChooseAnother")} /> : null}
    </div>
  );
}

function ProductTypeSkeleton() {
  return Array.from({ length: 5 }).map((_, index) => (
    <div key={index} className="h-[44px] min-w-[96px] animate-pulse rounded-full bg-stone-100 dark:bg-white/5 md:h-[52px] md:min-w-[120px]" />
  ));
}

function GuidedSizeFilter({ sizes = [], selectedSize, onSelect, disabled }) {
  const { t } = useTranslation();
  return (
    <div className={`mb-2 rounded-[0.9rem] border border-stone-200 bg-white p-2 shadow-[0_10px_24px_rgba(39,20,75,0.05)] dark:border-white/10 dark:bg-[#101010] md:mb-3 md:rounded-[1.15rem] md:p-2.5 ${disabled ? "opacity-55" : ""}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2 md:mb-2 md:gap-3">
        <div>
          <p className="text-[8px] font-black uppercase tracking-[0.14em] text-[#d4af37] md:text-[9px] md:tracking-[0.18em]">{t("storefront.filters.sizeFilter")}</p>
          <h3 className="text-[11px] font-black md:text-xs">{t("storefront.filters.availableSize")}</h3>
        </div>
        {selectedSize ? (
          <button type="button" onClick={() => onSelect("")} className="rounded-full bg-stone-100 px-2 py-1 text-[9px] font-black text-stone-600 transition hover:bg-stone-950 hover:text-white dark:bg-white/8 dark:text-stone-200 md:px-3 md:py-1 md:text-[11px]">
            {t("storefront.filters.showAllSizes")}
          </button>
        ) : null}
      </div>
      <div className="sf-scroll flex flex-wrap gap-1.5 overflow-x-auto pb-0.5 md:gap-2 md:pb-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect("")}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black transition md:px-3 md:py-1.5 md:text-xs ${!selectedSize ? "border-[#d4af37] bg-[#151515] text-[#d4af37]" : "border-stone-200 bg-stone-50 text-stone-700 hover:border-[#d4af37]/50 dark:border-white/10 dark:bg-white/5 dark:text-stone-200"}`}
        >
          {t("common.all")}
        </button>
        {sizes.map((item) => {
          const active = String(selectedSize) === String(item.size);
          return (
            <button
              key={item.size}
              type="button"
              disabled={disabled || !item.available}
              onClick={() => onSelect(item.size)}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black transition md:px-3 md:py-1.5 md:text-xs ${ active ? "border-[#d4af37] bg-[#d4af37] text-white shadow-[0_10px_24px_rgba(212,175,55,0.24)]" : "border-stone-200 bg-stone-50 text-stone-700 hover:border-[#d4af37]/50 dark:border-white/10 dark:bg-white/5 dark:text-stone-200" } disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-300 disabled:line-through dark:disabled:bg-white/5 dark:disabled:text-stone-500`}
            >
              {item.size}
              {item.available ? <span className="mr-1 opacity-60">({item.productCount})</span> : null}
            </button>
          );
        })}
        {!sizes.length ? <span className="rounded-full border border-dashed border-stone-200 px-2.5 py-1 text-[10px] font-bold text-stone-400 dark:border-white/10 md:px-3 md:py-1.5 md:text-xs">{t("storefront.filters.sizesAppearAfterType")}</span> : null}
      </div>
    </div>
  );
}

const renderableFilterSections = (sections = []) =>
  (Array.isArray(sections) ? sections : []).filter((section) => {
    if (!section || section.key === "style") return false;
    return uniqueClassificationOptions(section.options || []).length > 0;
  });

function PremiumFilterPanel({ sections, lang, buildFilterUrl, clearUrl, activeFilterCount = 0 }) {
  const { t } = useTranslation();
  const visibleSections = renderableFilterSections(sections);
  const gridClass = visibleSections.length >= 4 ? "xl:grid-cols-4" : visibleSections.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-2";
  if (!visibleSections.length) return null;
  return (
    <div className="mb-5 hidden md:block">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-2xl border border-white/10 bg-stone-950 text-white shadow-[0_14px_36px_rgba(0,0,0,0.18)]">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#d4af37]">{t("storefront.filters.curatedFilters")}</p>
            <h2 className="text-sm font-black text-stone-950 dark:text-white">{t("storefront.filters.quickPremium")}</h2>
          </div>
        </div>
        {activeFilterCount ? (
          <Link
            to={clearUrl}
            className="rounded-full border border-stone-200 bg-white/80 px-4 py-2 text-[11px] font-black text-stone-600 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-[#d4af37]/35 hover:text-[#d4af37] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
          >
            {t("storefront.filters.clearFilters")}
          </Link>
        ) : null}
      </div>
      <div className={`grid gap-3 md:grid-cols-2 ${gridClass}`}>
        {visibleSections.map((section) => (
          <PremiumFilterSection key={section.key} section={section} lang={lang} buildFilterUrl={buildFilterUrl} />
        ))}
      </div>
    </div>
  );
}

function PremiumFilterSection({ section, lang, buildFilterUrl }) {
  const { t } = useTranslation();
  const SectionIcon = section.icon || Sparkles;
  const options = uniqueClassificationOptions(section.options || []);
  if (section.key === "style" || !options.length) return null;
  return (
    <section className="group/filter relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-[linear-gradient(145deg,rgba(12,16,32,0.96),rgba(24,18,39,0.92))] p-4 text-white shadow-[0_18px_54px_rgba(0,0,0,0.20)] backdrop-blur-xl">
      <div className="pointer-events-none absolute -left-10 -top-10 h-28 w-28 rounded-full bg-[#d4af37]/18 blur-3xl transition group-hover/filter:bg-[#d4af37]/28" />
      <div className="relative mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/8 text-[#ddd6fe]">
            <SectionIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/35">{section.eyebrow}</p>
            <h3 className="truncate text-sm font-black">{section.label}</h3>
          </div>
        </div>
        {section.value ? <span className="h-2 w-2 rounded-full bg-[#f3d77a] shadow-[0_0_18px_rgba(216,180,254,0.85)]" /> : null}
      </div>
      <div className="relative flex flex-wrap gap-2">
        <PremiumFilterChip to={buildFilterUrl(section.key, "")} active={!section.value} icon={Tag} label={t("common.all")} />
        {options.map((option) => (
          <PremiumFilterChip
            key={option.id || option.value}
            to={buildFilterUrl(section.key, option.value)}
            active={section.value === option.value}
            icon={filterOptionIcon(section.key, option, lang)}
            label={classificationLabel(option, lang)}
            count={filterOptionCount(option)}
            color={classificationColor(option)}
            preview={section.key === "grade"}
          />
        ))}
      </div>
    </section>
  );
}

function PremiumFilterChip({ to, active, icon: Icon = Sparkles, label, count, color, preview = false }) {
  return (
    <Link
      to={to}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] font-black transition duration-200 ${ active ? "scale-[1.03] border-[#d4af37]/55 bg-[linear-gradient(135deg,rgba(212,175,55,0.95),rgba(17,24,39,0.92))] text-white shadow-[0_12px_30px_rgba(212,175,55,0.32)]" : "border-white/10 bg-white/6 text-white/70 hover:-translate-y-0.5 hover:border-[#d4af37]/40 hover:bg-white/10 hover:text-white" }`}
      style={!active && color ? { borderColor: `${color}44` } : undefined}
    >
      {preview ? <span className="h-3 w-3 rounded-full border border-white/20" style={{ background: color || "#d4af37" }} /> : <Icon className="h-3.5 w-3.5" />}
      <span>{label}</span>
      {count !== null ? <span className={active ? "text-white/70" : "text-white/35"}>({count})</span> : null}
    </Link>
  );
}

function MobileFilterTrigger({ activeFilterCount = 0, onOpen }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="sf-mobile-filter-trigger fixed right-4 z-30 inline-flex items-center gap-2 rounded-full border border-white/15 bg-stone-950/92 px-4 py-3 text-xs font-black text-white shadow-[0_18px_44px_rgba(0,0,0,0.28)] backdrop-blur-xl transition active:scale-95 md:hidden"
      style={{ bottom: "calc(var(--mobile-bottom-nav-height, 76px) + env(safe-area-inset-bottom) + 1rem)" }}
    >
      <SlidersHorizontal className="h-4 w-4" />
      <span>{t("storefront.filters.filters")}</span>
      {activeFilterCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#f3d77a] px-1 text-[10px] text-stone-950">{activeFilterCount}</span> : null}
    </button>
  );
}

function MobileFilterDrawer({ open, sections, lang, draftFilters, setDraftFilters, onClose, onApply, onReset }) {
  const { t } = useTranslation();
  const visibleSections = renderableFilterSections(sections);
  if (!open) return null;
  return (
    <div className="sf-mobile-filter-drawer fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-stone-950/55 backdrop-blur-sm" onClick={onClose} aria-label={t("storefront.filters.closeFilters")} />
      <div className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-hidden rounded-t-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,#101426_0%,#070b16_100%)] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.42)]">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-white/20" />
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3.5 py-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#f3d77a]">{t("storefront.filters.premiumFilters")}</p>
            <h2 className="text-base font-black">{t("storefront.filters.chooseWhatFits")}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 transition active:scale-95" aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scroll max-h-[calc(82dvh-124px)] space-y-1.5 overflow-y-auto px-2.5 py-2.5 pb-24">
          {visibleSections.map((section) => (
            <MobileFilterSection key={section.key} section={section} lang={lang} draftValue={draftFilters[section.key] || ""} onSelect={(value) => setDraftFilters((current) => ({ ...current, [section.key]: value }))} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-white/10 bg-[#070b16]/92 px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] backdrop-blur-xl">
          <button type="button" onClick={onApply} className="flex-1 rounded-xl bg-gradient-to-l from-[#d4af37] to-[#151515] px-4 py-2.5 text-sm font-black text-white shadow-[0_14px_34px_rgba(212,175,55,0.32)] active:scale-[0.98]">
            {t("storefront.filters.applyFilters")}
          </button>
          <button type="button" onClick={onReset} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-white/80 active:scale-[0.98]">
            {t("common.reset")}
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileFilterSection({ section, lang, draftValue, onSelect }) {
  const { t } = useTranslation();
  const SectionIcon = section.icon || Sparkles;
  const options = uniqueClassificationOptions(section.options || []);
  if (section.key === "style" || !options.length) return null;
  return (
    <section className="rounded-[0.9rem] border border-white/10 bg-white/[0.055] p-2 shadow-[0_12px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/8 text-[#ddd6fe]">
          <SectionIcon className="h-3 w-3" />
        </span>
        <div>
          <p className="text-[7.5px] font-black uppercase tracking-[0.14em] text-white/35">{section.eyebrow}</p>
          <h3 className="text-xs font-black leading-4">{section.label}</h3>
        </div>
      </div>
      <div className="sf-scroll flex gap-1.5 overflow-x-auto pb-0.5">
        <MobileFilterChip active={!draftValue} label={t("common.all")} icon={Tag} onClick={() => onSelect("")} />
        {options.map((option) => (
          <MobileFilterChip
            key={option.id || option.value}
            active={draftValue === option.value}
            label={classificationLabel(option, lang)}
            count={filterOptionCount(option)}
            icon={filterOptionIcon(section.key, option, lang)}
            color={classificationColor(option)}
            preview={section.key === "grade"}
            onClick={() => onSelect(option.value)}
          />
        ))}
      </div>
    </section>
  );
}

function MobileFilterChip({ active, label, count, icon: Icon = Sparkles, color, preview = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black transition ${ active ? "scale-[1.03] border-[#d4af37]/60 bg-[linear-gradient(135deg,rgba(212,175,55,0.95),rgba(17,24,39,0.92))] text-white shadow-[0_12px_30px_rgba(212,175,55,0.34)]" : "border-white/10 bg-white/6 text-white/65" }`}
      style={!active && color ? { borderColor: `${color}44` } : undefined}
    >
      {preview ? <span className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: color || "#d4af37" }} /> : <Icon className="h-3 w-3" />}
      <span>{label}</span>
      {count !== null ? <span className={active ? "text-white/70" : "text-white/35"}>({count})</span> : null}
    </button>
  );
}

function filterOptionCount(option = {}) {
  const count = option.product_count ?? option.products_count ?? option.count ?? option.total;
  return Number.isFinite(Number(count)) ? Number(count) : null;
}

function filterOptionIcon(sectionKey, option = {}, lang = "ar") {
  const label = `${classificationLabel(option, lang)} ${option.value || ""}`.toLowerCase();
  if (sectionKey === "gender") {
    if (label.includes("kid") || label.includes("child") || label.includes("ط·آ·ط¢آ£ط·آ·ط¢آ·ط·آ¸ط¸آ¾ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چ") || label.includes("ط·آ·ط¢آ§ط·آ·ط¢آ·ط·آ¸ط¸آ¾ط·آ·ط¢آ§ط·آ¸أ¢â‚¬â€چ")) return Baby;
    if (label.includes("women") || label.includes("woman") || label.includes("ط·آ·ط¢آ­ط·آ·ط¢آ±ط·آ¸ط¸آ¹ط·آ¸أ¢â‚¬آ¦ط·آ¸ط¸آ¹") || label.includes("ط·آ¸أ¢â‚¬آ ط·آ·ط¢آ³ط·آ·ط¢آ§ط·آ·ط¢آ¦ط·آ¸ط¸آ¹")) return Heart;
    return Users;
  }
  if (sectionKey === "product_type") {
    if (label.includes("bag") || label.includes("شنط") || label.includes("حقائب")) return Briefcase;
    if (label.includes("sneaker") || label.includes("shoe") || label.includes("كروكس") || label.includes("سليبر")) return Footprints;
    return ShoppingBag;
  }
  if (sectionKey === "grade") {
    if (label.includes("mirror") || label.includes("original") || label.includes("ميرور")) return Crown;
    if (label.includes("import") || label.includes("vietnam") || label.includes("فيتنام")) return Gem;
    return ShieldCheck;
  }
  return Sparkles;
}

const swatchColorStyle = (label = "") => {
  const value = String(label || "").toLowerCase();
  const color =
    /(black|أسود|charcoal)/.test(value) ? "#151515" :
    /(white|أبيض|ivory|cream)/.test(value) ? "#f8fafc" :
    /(burgundy|maroon|عنابي)/.test(value) ? "#7f1d1d" :
    /(red|أحمر)/.test(value) ? "#dc2626" :
    /(blue|navy|أزرق|كحلي)/.test(value) ? "#d4af37" :
    /(green|olive|أخضر|زيتي)/.test(value) ? "#16a34a" :
    /(brown|mocha|coffee|بني|بُنّي|شوكلت)/.test(value) ? "#7c4a2d" :
    /(beige|tan|camel|بيج|جملي|رملي)/.test(value) ? "#d6b88f" :
    /(grey|gray|silver|رمادي|فضي)/.test(value) ? "#a1a1aa" :
    /(pink|rose|وردي|روز)/.test(value) ? "#fb7185" :
    /(purple|بنفسجي|أرجواني)/.test(value) ? "#d4af37" :
    /(yellow|gold|أصفر|ذهبي)/.test(value) ? "#facc15" :
    "#e5c158";
  return { background: color };
};
function HeaderAction({ to, icon, count, label, className = "" }) {
  return (
    <Link
      to={to}
      className={`sf-header-action border border-stone-200/80 bg-white/92 text-stone-800 shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition duration-200 ease-out hover:-translate-y-px hover:border-[var(--sf-purple)] hover:text-stone-950 active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.06] dark:text-white/82 dark:shadow-[0_14px_30px_rgba(0,0,0,0.24)] dark:hover:bg-white/[0.10] ${className}`}
      aria-label={label}
      title={label}
    >
      {icon}
      {count ? <span className="sf-action-badge">{count}</span> : null}
    </Link>
  );
}

function Header({ cartCount, onCart, onAddToCart, effectiveTheme, onThemeToggle = () => {}, brandName = "MONE", brandLogoUrl = "", headerLogoUrl = "", brandSettingsLoading = false, mobileMenuOpen = false, setMobileMenuOpen = () => {} }) {
  const preferredHeaderLogoUrl = headerLogoUrl || brandLogoUrl;
  const resolvedHeaderLogoUrl = resolveProductImageUrl(preferredHeaderLogoUrl);
  const mOneHeaderLogoPattern = /\/branding\/m-one-wordmark-(?:orange|white|dark)\.png/;
  const isMOneHeaderLogo = mOneHeaderLogoPattern.test(resolvedHeaderLogoUrl);
  const isMOneBrand = /(?:^|\s)m\s*(?:1|one)(?:\s|$)/i.test(String(brandName || "").trim());
  const useAnimatedMOneHeaderLogo = isMOneHeaderLogo || isMOneBrand;
  const mOneHeaderLogoVariant = "white";
  const displayedHeaderLogoUrl = isMOneHeaderLogo
    ? `${resolvedHeaderLogoUrl.split("?")[0].replace(mOneHeaderLogoPattern, `/branding/m-one-wordmark-${mOneHeaderLogoVariant}.png`)}?v=20220228`
    : resolvedHeaderLogoUrl;
  const mOneHeaderLayerUrl = (layer) => `/branding/m-one-logo-${mOneHeaderLogoVariant}-${layer}.png?v=20260716`;
  const primaryHeaderLogoUrl = useAnimatedMOneHeaderLogo
    ? mOneHeaderLayerUrl("fixed")
    : displayedHeaderLogoUrl;
  const { i18n: storefrontI18n, t } = useTranslation();
  const [logoStatus, setLogoStatus] = useState("loading");
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [visualSearch, setVisualSearch] = useState({
    active: false,
    loading: false,
    exactMatches: [],
    similarMatches: [],
    confidence: 0,
    message: "",
    error: "",
    previewUrl: "",
    fileName: "",
    fileType: "",
  });
  const [imageSearchOpen, setImageSearchOpen] = useState(false);

  useEffect(() => {
    if (brandSettingsLoading) {
      setLogoStatus("loading");
      return undefined;
    }
    if (!primaryHeaderLogoUrl) {
      setLogoStatus("error");
      return undefined;
    }

    let cancelled = false;
    setLogoStatus("loading");
    const preload = document.createElement("link");
    preload.rel = "preload";
    preload.as = "image";
    preload.href = primaryHeaderLogoUrl;
    preload.dataset.storefrontHeaderLogoPreload = "true";
    document.head.appendChild(preload);

    const image = new Image();
    image.onload = () => {
      if (!cancelled) setLogoStatus("loaded");
    };
    image.onerror = () => {
      if (!cancelled) setLogoStatus("error");
    };
    image.src = primaryHeaderLogoUrl;

    return () => {
      cancelled = true;
      preload.remove();
    };
  }, [brandSettingsLoading, primaryHeaderLogoUrl]);

  const renderHeaderLogo = ({ mobile = false } = {}) => {
    const frameClassName = mobile
      ? "sf-header-wordmark relative inline-flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden bg-transparent transition"
      : "sf-header-wordmark relative inline-flex h-[72px] w-[82px] shrink-0 items-center justify-center overflow-hidden bg-transparent transition group-hover:scale-[1.02]";
    const imageSize = mobile ? 160 : 240;

    return (
      <span className={frameClassName} aria-busy={logoStatus === "loading"}>
        {logoStatus === "loading" ? (
          <span data-testid="storefront-logo-loading" className="sf-skeleton-shimmer block h-full w-full rounded-full bg-white/10" aria-hidden="true" />
        ) : null}
        {logoStatus === "loaded" ? (
          useAnimatedMOneHeaderLogo ? (
            <>
              <img src={mOneHeaderLayerUrl("fixed")} alt={brandName} className="absolute inset-0 block h-full w-full object-contain" decoding="async" width={imageSize} height={imageSize} />
              <img src={mOneHeaderLayerUrl("m")} alt="" aria-hidden="true" className="sf-header-logo-moving-m absolute inset-0 block h-full w-full object-contain" decoding="async" width={imageSize} height={imageSize} />
            </>
          ) : (
            <img src={displayedHeaderLogoUrl} alt={brandName} className="block h-full w-full object-contain" decoding="async" width={imageSize} height={imageSize} />
          )
        ) : null}
        {logoStatus === "error" ? (
          <span data-testid="storefront-logo-fallback" className="grid h-full w-full place-items-center rounded-full bg-white/10" aria-label={brandName}>
            <ShoppingBag className={mobile ? "h-6 w-6" : "h-7 w-7"} aria-hidden="true" />
          </span>
        ) : null}
      </span>
    );
  };
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState(() => readJson(SEARCH_RECENT_KEY, []));
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [isCompact, setIsCompact] = useState(false);
  const visualPreviewUrlRef = useRef("");
  const selectedVisualImageRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const deferredSearch = useDeferredValue(search);
  const compactDisabled = isStorefrontProductPath(location.pathname);
  const isCheckoutMobile = isStorefrontCheckoutPath(location.pathname);
  const currentLanguage = normalizeLanguage(storefrontI18n.resolvedLanguage || storefrontI18n.language || "en");
  const isRtl = currentLanguage === "ar";
  const nextLanguage = currentLanguage === "ar" ? "en" : "ar";
  const languageLabel = nextLanguage === "ar" ? "العربية" : "English";
  const searchPlaceholders = getSearchPlaceholders();
  const announcementItems = [
    t("storefront.header.announcements.fastShipping"),
    t("storefront.header.announcements.exchange"),
    t("storefront.header.announcements.cod"),
    t("storefront.header.announcements.premium"),
    t("storefront.header.announcements.todayDeals"),
  ];
  const headerCategoryItems = [
    { label: t("storefront.nav.men"), to: "/men" },
    { label: t("storefront.nav.women"), to: "/women" },
    { label: t("storefront.nav.kids"), to: "/kids" },
    { label: getProductTypeLabel("bags", currentLanguage), to: "/bags" },
    { label: getProductTypeLabel("crocs", currentLanguage), to: "/crocs" },
    { label: getProductTypeLabel("slippers", currentLanguage), to: "/slippers" },
  ];
  const utilityItems = [
    { label: "WhatsApp", to: "https://wa.me/", icon: <MessageCircle className="h-3.5 w-3.5" />, external: true },
    { label: t("storefront.header.trackOrder"), to: "/track", icon: <PackageSearch className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.wishlist"), to: "/wishlist", icon: <Heart className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.account"), to: "/account", icon: <User className="h-3.5 w-3.5" /> },
  ];
  const themeIsDark = effectiveTheme === "dark";
  const themeToggleLabel = themeIsDark
    ? (isRtl ? "تفعيل الوضع الفاتح" : "Switch to light mode")
    : (isRtl ? "تفعيل الوضع الداكن" : "Switch to dark mode");
  const headerShellClassName = [
    "sf-luxury-header sf-header-v2 sticky top-0 z-40 bg-transparent shadow-none backdrop-blur-2xl transition-all duration-300 dark:bg-transparent",
    themeIsDark ? "" : "border-b border-black/5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]",
  ].join(" ");
  const mobileMenuIsRtl = currentLanguage === "ar";
  const mobileMenuSideClass = mobileMenuIsRtl
    ? "right-0 rounded-l-[1.75rem] border-l shadow-[-24px_0_64px_rgba(28,25,23,0.18)] dark:shadow-[-26px_0_70px_rgba(0,0,0,0.48)]"
    : "left-0 rounded-r-[1.75rem] border-r shadow-[24px_0_64px_rgba(28,25,23,0.18)] dark:shadow-[26px_0_70px_rgba(0,0,0,0.48)]";
  const menuOpen = Boolean(mobileMenuOpen);
  const mobilePortalTarget = typeof document !== "undefined" ? document.body : null;
  const mobileMenuScrollRef = useRef(0);

  useEffect(() => {
    if (!menuOpen || typeof document === "undefined" || typeof window === "undefined") return undefined;
    const { body } = document;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    mobileMenuScrollRef.current = scrollY;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      window.scrollTo(0, mobileMenuScrollRef.current);
    };
  }, [menuOpen]);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    setMobileSearchOpen(false);
  }, [setMobileMenuOpen, setMobileSearchOpen]);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let frameId = 0;
    let lastCompactState = null;
    const updateCompact = () => {
      frameId = 0;
      const nextCompact = !compactDisabled && window.scrollY > 72;
      if (lastCompactState === nextCompact) return;
      lastCompactState = nextCompact;
      setIsCompact((current) => (current === nextCompact ? current : nextCompact));
    };
    const onScroll = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(updateCompact);
    };
    updateCompact();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", onScroll);
    };
  }, [compactDisabled]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPlaceholderIndex((current) => (current + 1) % searchPlaceholders.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [searchPlaceholders.length]);

  useEffect(() => () => {
    if (visualPreviewUrlRef.current) URL.revokeObjectURL(visualPreviewUrlRef.current);
  }, []);

  const clearVisualSearch = useCallback(() => {
    if (visualPreviewUrlRef.current) {
      URL.revokeObjectURL(visualPreviewUrlRef.current);
      visualPreviewUrlRef.current = "";
    }
    selectedVisualImageRef.current = null;
    setVisualSearch({ active: false, loading: false, exactMatches: [], similarMatches: [], confidence: 0, message: "", error: "", previewUrl: "", fileName: "", fileType: "" });
    setImageSearchOpen(false);
  }, []);

  useEffect(() => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setActiveSearchIndex(-1);
    setSearchLoading(false);
    setSuggestions([]);
    clearVisualSearch();
  }, [clearVisualSearch, location.pathname, location.search]);

  useEffect(() => {
    if (visualSearch.active) {
      return;
    }
    const normalizedSearch = deferredSearch.trim();
    if (normalizedSearch.length < 2) {
      let cancelled = false;
      deferReactState(() => {
        if (cancelled) return;
        setSuggestions([]);
        setSearchLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    const controller = new AbortController();
    deferReactState(() => {
      if (!cancelled) setSearchLoading(true);
    });
    const timer = setTimeout(() => {
      api.get(`/storefront/products/search?q=${encodeURIComponent(normalizedSearch)}&limit=8`, { signal: controller.signal })
        .then((data) => {
          if (!cancelled) setSuggestions(data.products || []);
        })
        .catch((error) => {
          if (!cancelled && error?.cause?.name !== "AbortError") setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [deferredSearch, visualSearch.active]);

  const handleSearchChange = useCallback((value) => {
    setSearch(value);
    if (visualSearch.active) {
      clearVisualSearch();
    }
  }, [clearVisualSearch, visualSearch.active]);

  const rememberSearch = useCallback((value) => {
    const term = String(value || "").trim();
    if (!term) return;
    setRecentSearches((current) => {
      const next = [term, ...current.filter((item) => item !== term)].slice(0, 8);
      writeJson(SEARCH_RECENT_KEY, next);
      return next;
    });
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setActiveSearchIndex(-1);
    setSearchLoading(false);
    clearVisualSearch();
  }, [clearVisualSearch]);
  const handleQuickSearchAdd = useCallback((...args) => {
    closeSearch();
    onAddToCart(...args);
  }, [closeSearch, onAddToCart]);

  const submit = (event) => {
    event.preventDefault();
    const term = search.trim();
    if (!term) return;
    rememberSearch(term);
    closeSearch();
    navigate(`/products?q=${encodeURIComponent(term)}`);
  };

  const pickSearchTerm = (term) => {
    const value = String(term || "").trim();
    if (!value) return;
    setSearch(value);
    rememberSearch(value);
    closeSearch();
    navigate(`/products?q=${encodeURIComponent(value)}`);
  };

  const pickProduct = (product, options = {}) => {
    if (!product?.id) return;
    rememberSearch(product.name || search);
    closeSearch();
    if (!options.keepQuery) setSearch("");
    navigate(productUrl(product));
  };

  const handleVoiceSearch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error(sfText("storefront.toasts.voiceUnsupported"));
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ar-EG";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      setSearch(transcript);
      setSearchOpen(true);
      setMobileSearchOpen(window.innerWidth < 768);
    };
    recognition.start();
  };

  const handleImageSearch = async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      selectedVisualImageRef.current = file;
      const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
      if (!supportedTypes.has(file.type)) {
        toast.error(sfText("storefront.toasts.unsupportedImageType"));
        selectedVisualImageRef.current = null;
        event.target.value = "";
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error(sfText("storefront.toasts.imageTooLarge"));
        selectedVisualImageRef.current = null;
        event.target.value = "";
        return;
      }
      if (visualPreviewUrlRef.current) URL.revokeObjectURL(visualPreviewUrlRef.current);
      const previewUrl = URL.createObjectURL(file);
      visualPreviewUrlRef.current = previewUrl;
      setSuggestions([]);
      setImageSearchOpen(true);
      setSearchLoading(false);
      setVisualSearch({
        active: true,
        loading: true,
        exactMatches: [],
        similarMatches: [],
        confidence: 0,
        message: "",
        error: "",
        previewUrl,
        fileName: file.name,
        fileType: file.type,
      });
      setSearchOpen(true);
      setMobileSearchOpen(true);
      const formData = new FormData();
      formData.append("image", selectedVisualImageRef.current);
      const tenantId = document.documentElement.dataset.tenantId || "1";
      formData.append("tenant_id", tenantId);
      formData.append("query", search.trim());
      const endpoint = "/storefront/image-search";
      try {
        const data = await api.post(endpoint, formData, { timeoutMs: 45000, headers: { "x-tenant-id": tenantId } });
        const exactMatches = Array.isArray(data.exactMatches) ? data.exactMatches : [];
        const similarMatches = Array.isArray(data.similarMatches) ? data.similarMatches : Array.isArray(data.products) ? data.products : [];
        const combined = [...exactMatches, ...similarMatches];
        setSuggestions(combined);
        setVisualSearch({
          active: true,
          loading: false,
          exactMatches,
          similarMatches,
          confidence: Number(data.confidence || 0),
          message: data.message || "",
          error: "",
          previewUrl,
          fileName: file.name,
          fileType: file.type,
        });
        setImageSearchOpen(true);
      } catch (error) {
        const message =
          error?.responseBody?.message ||
          error?.responseBody?.error ||
          (error?.message && error.message !== "Request Failed" ? error.message : "") ||
          "البحث بالصورة غير متاح حاليًا. جرّب تاني أو استخدم البحث النصي.";
        setSuggestions([]);
        setVisualSearch({
          active: true,
          loading: false,
          exactMatches: [],
          similarMatches: [],
          confidence: 0,
          message,
          error: message,
          previewUrl,
          fileName: file.name,
          fileType: file.type,
        });
        setImageSearchOpen(true);
      } finally {
        setSearchLoading(false);
      }
    }
    event.target.value = "";
  };

  const shareVisualSearchImage = useCallback(async () => {
    const file = selectedVisualImageRef.current;
    const text = "هذه صورة المنتج الذي أبحث عنه";
    if (file && typeof navigator !== "undefined" && navigator.share) {
      try {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text, title: "صورة للبحث عن موديل" });
          return;
        }
      } catch {
        // Fall through to WhatsApp text link.
      }
    }
    window.open(buildWhatsAppHref(text), "_blank", "noopener,noreferrer");
  }, []);

  const requestVisualSearchSupply = useCallback(() => {
    window.open(buildWhatsAppHref("عايز أطلب توفير الموديل ده لو متاح"), "_blank", "noopener,noreferrer");
  }, []);


  const switchLanguage = async () => {
    persistApplicationLanguage(nextLanguage);
    await storefrontI18n.changeLanguage(nextLanguage);
    applyDocumentLanguage(nextLanguage);
  };

  return (
    <header
      data-compact={!compactDisabled && isCompact ? "true" : "false"}
      className={headerShellClassName}
    >
      <div className={`${isCheckoutMobile ? "hidden md:block" : ""} sf-announcement-row sf-header-announcement overflow-hidden text-white/90 backdrop-blur transition-all duration-300`}>
        <div className="relative mx-auto h-8 w-full max-w-7xl overflow-hidden md:h-10">
          <div className="sf-announcement-track sf-announcement-track-ltr absolute inset-y-0 left-0 items-center">
            {[0, 1].map((copyIndex) => (
              <span key={copyIndex} className="inline-flex shrink-0 items-center gap-10 pe-10">
                {announcementItems.map((announcement, itemIndex) => (
                  <span key={`${copyIndex}-${itemIndex}`} dir="auto" className="inline-flex shrink-0 items-center gap-2 text-[10px] font-bold tracking-[0.04em] text-stone-100/88 md:text-[12px] md:tracking-wide">
                    <Sparkles className="sf-header-announcement-icon h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {announcement}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="sf-mobile-header-shell md:hidden" dir="rtl">
        <div className="px-3 pb-2.5 pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <div className="sf-mobile-header-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <button
              className="sf-mobile-header-button grid h-10 w-10 shrink-0 place-items-center rounded-full transition duration-200 ease-out active:scale-[0.98]"
              onClick={() => setMobileMenuOpen((value) => !value)}
              aria-label={t("storefront.header.menu")}
              type="button"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <Link to="/" className="sf-header-logo mx-auto inline-flex min-w-0 items-center justify-center" aria-label={brandName || "MONE"}>
              {renderHeaderLogo({ mobile: true })}
            </Link>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onThemeToggle}
                className="sf-mobile-header-button grid h-10 w-10 shrink-0 place-items-center rounded-full transition duration-200 ease-out active:scale-[0.98]"
                aria-label={themeToggleLabel}
                title={themeToggleLabel}
              >
                {themeIsDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <button onClick={onCart} className="sf-mobile-header-button sf-cart-action relative grid h-10 w-10 shrink-0 place-items-center rounded-full transition duration-200 ease-out active:scale-[0.98]" aria-label={t("storefront.cart.title")} type="button">
                <ShoppingCart className="h-5 w-5" />
                {cartCount ? <span key={cartCount} className="sf-action-badge sf-mobile-cart-badge sf-cart-count-pop">{cartCount}</span> : null}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="sf-utility-row hidden border-b px-4 text-xs font-semibold transition-all duration-300 sm:block">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            {utilityItems.map((item) => {
              const className = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:bg-white/10 hover:text-white";
              return item.external ? (
                <a key={item.label} href={item.to} className={className}>
                  {item.icon}
                  <span>{item.label}</span>
                </a>
              ) : (
                <Link key={item.label} to={item.to} className={className}>
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="hidden items-center gap-2 lg:flex">
            <button type="button" onClick={switchLanguage} className="rounded-full px-2.5 py-1 text-white/80 transition hover:bg-white/10 hover:text-white">{languageLabel}</button>
            <span className="h-3 w-px bg-white/15" />
            <button type="button" className="rounded-full px-2.5 py-1 text-white/80 transition hover:bg-white/10 hover:text-white">{getCurrency().code}</button>
          </div>
        </div>
      </div>
      <div className="sf-main-row sf-header-main sf-header-main-v2 relative mx-auto hidden max-w-7xl px-4 py-3 md:block">
        <div className="flex w-full items-center gap-3 md:gap-6" dir="rtl">
          <div className="flex shrink-0 items-center gap-2 md:gap-4">
            <button
              className="sf-header-menu-button grid h-12 w-12 shrink-0 place-items-center rounded-full border transition duration-200 ease-out hover:-translate-y-px active:scale-[0.98]"
              onClick={() => setMobileMenuOpen((value) => !value)}
              aria-label={t("storefront.header.menu")}
              type="button"
            >
              {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <span className="sf-header-divider hidden h-12 w-px md:block" />
            <Link to="/" className="sf-header-logo group inline-flex shrink-0 items-center text-stone-950 transition hover:text-[#d4af37] dark:text-white" aria-label={brandName || "MONE"}>
              {renderHeaderLogo()}
            </Link>
          </div>
          <nav className="sf-collapsible-nav hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden text-sm font-bold text-stone-700 dark:text-stone-300 lg:flex">
            {headerCategoryItems.map(({ label, to }) => (
              <NavLink
                key={`${label}-${to}`}
                to={to}
                className={({ isActive }) => `sf-nav-link sf-header-nav-link relative overflow-hidden rounded-full px-3.5 py-2.5 transition duration-200 ease-out after:absolute after:inset-x-4 after:bottom-1 after:h-px after:origin-center after:bg-current after:transition-transform after:duration-200 ${isActive ? "active text-stone-950 dark:text-white after:scale-x-100" : "text-stone-700/90 hover:bg-white/55 hover:text-stone-950 dark:text-stone-300/90 dark:hover:bg-white/8 dark:hover:text-white after:scale-x-0 hover:after:scale-x-100"}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <button
              type="button"
              onClick={onThemeToggle}
              className="sf-header-action hidden md:grid transition duration-200 ease-out hover:-translate-y-px hover:border-stone-300 hover:bg-white hover:text-stone-950 active:scale-[0.98] dark:hover:bg-white/10"
              aria-label={themeToggleLabel}
              title={themeToggleLabel}
            >
              {themeIsDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="sf-header-action hidden md:grid transition duration-200 ease-out hover:-translate-y-px hover:border-stone-300 hover:bg-white hover:text-stone-950 active:scale-[0.98] dark:hover:bg-white/10"
              aria-label={t("storefront.header.search")}
              title={t("storefront.header.search")}
            >
              <Search className="h-5 w-5" />
            </button>
            <HeaderAction to="/account" label={t("storefront.header.account")} icon={<User className="h-5 w-5" />} className="sf-secondary-action hidden md:grid" />
            <button onClick={onCart} className="sf-header-action sf-cart-action transition duration-200 ease-out hover:-translate-y-px hover:border-stone-300 hover:bg-white hover:text-stone-950 active:scale-[0.98] dark:hover:bg-white/10" aria-label={t("storefront.cart.title")} type="button">
              <ShoppingCart className="h-5 w-5" />
              {cartCount ? <span key={cartCount} className="sf-action-badge sf-cart-count-pop">{cartCount}</span> : null}
            </button>
          </div>
        </div>
        {searchOpen ? (
          <div className="absolute left-4 right-4 top-full z-50 hidden md:block">
            <PremiumSearch
              value={search}
              onChange={handleSearchChange}
              onSubmit={submit}
              onOpen={() => setSearchOpen(true)}
              onClose={closeSearch}
              open={searchOpen}
              mobileOpen={mobileSearchOpen}
              setMobileOpen={setMobileSearchOpen}
              placeholder={searchPlaceholders[placeholderIndex] || searchPlaceholders[0]}
              suggestions={suggestions}
              loading={searchLoading}
              visualSearch={visualSearch}
              recentSearches={recentSearches}
              activeIndex={activeSearchIndex}
              setActiveIndex={setActiveSearchIndex}
              onPickTerm={pickSearchTerm}
              onPickProduct={pickProduct}
              onQuickAdd={handleQuickSearchAdd}
              onVoice={handleVoiceSearch}
              onImage={handleImageSearch}
              imageSearchOpen={imageSearchOpen}
              imageSearch={visualSearch}
              onShareImageOnWhatsApp={shareVisualSearchImage}
              onRequestVisualSearchSupply={requestVisualSearchSupply}
              onClearImageSearch={clearVisualSearch}
            />
          </div>
        ) : null}
      </div>
      {menuOpen && mobilePortalTarget ? createPortal(
        <div
          className="fixed inset-0 z-[160] md:hidden"
          dir={mobileMenuIsRtl ? "rtl" : "ltr"}
          role="dialog"
          aria-modal="true"
          aria-label={t("storefront.header.menu")}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            aria-label={t("storefront.common.close")}
            onClick={closeMobileMenu}
          />
          <aside data-theme={effectiveTheme} className={`sf-mobile-menu-drawer fixed inset-y-0 z-[161] flex h-full w-[min(23rem,92vw)] flex-col overflow-hidden border-stone-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#faf9f6_58%,#f2efe8_100%)] text-stone-950 dark:border-white/10 dark:bg-[linear-gradient(180deg,#050505_0%,#0a0a0a_55%,#111111_100%)] dark:text-white ${mobileMenuSideClass}`}>
            <div className="border-b border-stone-200/80 px-4 pb-3 pt-4 dark:border-white/10">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={onThemeToggle}
                    className="sf-mobile-menu-toolbar-button grid h-9 w-9 shrink-0 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:border-[#d4af37]/45 hover:text-stone-950 active:scale-[0.98] dark:border-white/10 dark:bg-white/8 dark:text-white dark:shadow-none dark:hover:bg-white/12"
                    aria-label={themeToggleLabel}
                    title={themeToggleLabel}
                  >
                    {themeIsDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={switchLanguage}
                    className="sf-mobile-menu-toolbar-button inline-flex h-9 items-center justify-center rounded-full border border-stone-200 bg-white px-3.5 text-xs font-bold text-stone-700 shadow-sm transition hover:border-[#d4af37]/45 hover:text-stone-950 active:scale-[0.98] dark:border-white/10 dark:bg-white/8 dark:text-white dark:shadow-none dark:hover:bg-white/12"
                  >
                    {languageLabel}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={closeMobileMenu}
                  className="sf-mobile-menu-toolbar-button grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:border-[#d4af37]/45 hover:text-stone-950 active:scale-[0.98] dark:border-white/10 dark:bg-white/8 dark:text-white dark:shadow-none dark:hover:bg-white/12"
                  aria-label={t("storefront.common.close")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3">
                <p className="sf-mobile-menu-eyebrow text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a7108] dark:text-[#f3d77a]/70">{t("storefront.header.menu")}</p>
                <h2 className="sf-mobile-menu-title mt-1 text-xl font-black text-stone-950 dark:text-white">{t("storefront.header.quickLinks")}</h2>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              <div className="grid gap-4">
                <PremiumSearch
                  value={search}
                  onChange={handleSearchChange}
                  onSubmit={(event) => {
                    submit(event);
                    closeMobileMenu();
                  }}
                  onOpen={() => {
                    setSearchOpen(true);
                    setMobileSearchOpen(true);
                  }}
                  onClose={closeSearch}
                  open={searchOpen}
                  mobileOpen={menuOpen}
                  setMobileOpen={setMobileSearchOpen}
                  placeholder={searchPlaceholders[placeholderIndex] || searchPlaceholders[0]}
                  suggestions={suggestions}
                  loading={searchLoading}
                  visualSearch={visualSearch}
                  recentSearches={recentSearches}
                  activeIndex={activeSearchIndex}
                  setActiveIndex={setActiveSearchIndex}
                  onPickTerm={(term) => {
                    pickSearchTerm(term);
                    closeMobileMenu();
                  }}
                  onPickProduct={(product, options) => {
                    pickProduct(product, options);
                    closeMobileMenu();
                  }}
                  onQuickAdd={handleQuickSearchAdd}
                  onVoice={handleVoiceSearch}
                  onImage={handleImageSearch}
                  imageSearchOpen={imageSearchOpen}
                  imageSearch={visualSearch}
                  onShareImageOnWhatsApp={shareVisualSearchImage}
                  onRequestVisualSearchSupply={requestVisualSearchSupply}
                  onClearImageSearch={clearVisualSearch}
                  drawerMode
                />
                {[
                  { label: t("storefront.nav.sizeGuide"), to: "/size-guide" },
                  { label: t("storefront.nav.returns"), to: "/returns" },
                  { label: t("storefront.nav.contact"), to: "/contact" },
                ].map(({ label, to, external = false, icon: Icon }) =>
                  external ? (
                    <a
                      key={`${label}-${to}`}
                      href={to}
                      target="_blank"
                      rel="noreferrer"
                      onClick={closeMobileMenu}
                      className="sf-mobile-menu-link flex min-h-12 items-center gap-3 rounded-2xl border border-stone-200/80 bg-white/82 px-4 py-3.5 text-sm font-bold text-stone-800 shadow-sm transition hover:border-[#d4af37]/40 hover:bg-white active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.045] dark:text-white dark:shadow-none dark:hover:bg-white/[0.08]"
                    >
                      {Icon ? <Icon className="h-4 w-4 shrink-0 text-[#f3d77a]" /> : null}
                      <span>{label}</span>
                    </a>
                  ) : (
                    <Link
                      key={`${label}-${to}`}
                      to={to}
                      onClick={closeMobileMenu}
                      className="sf-mobile-menu-link flex min-h-12 items-center gap-3 rounded-2xl border border-stone-200/80 bg-white/82 px-4 py-3.5 text-sm font-bold text-stone-800 shadow-sm transition hover:border-[#d4af37]/40 hover:bg-white active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.045] dark:text-white dark:shadow-none dark:hover:bg-white/[0.08]"
                    >
                      {Icon ? <Icon className="h-4 w-4 shrink-0 text-[#f3d77a]" /> : null}
                      <span>{label}</span>
                    </Link>
                  )
                )}
              </div>
            </div>
          </aside>
        </div>,
        mobilePortalTarget
      ) : null}

    </header>
  );
}

function PremiumSearch({
  value,
  onChange,
  onSubmit,
  onOpen,
  onClose,
  open,
  mobileOpen,
  placeholder,
  suggestions = [],
  loading = false,
  recentSearches = [],
  activeIndex,
  setActiveIndex,
  onPickTerm,
  onPickProduct,
  onVoice,
  onImage,
  imageSearch = null,
  onShareImageOnWhatsApp = () => {},
  onRequestVisualSearchSupply = () => {},
  onClearImageSearch = () => {},
  className = "",
  mobileOnly = false,
  drawerMode = false,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const trendingSearches = getTrendingSearches();
  const searchFallbackSections = getSearchFallbackSections();
  const uniqueRecentSearches = [...new Set(recentSearches.filter(Boolean))]
    .filter((term) => !trendingSearches.some((trending) => trending.toLocaleLowerCase() === String(term).toLocaleLowerCase()))
    .slice(0, 6);
  const keyboardTerms = value.trim() ? [] : [...uniqueRecentSearches, ...trendingSearches];
  const keyboardItems = [...suggestions.map((item) => ({ type: "product", item })), ...keyboardTerms.map((term) => ({ type: "term", term }))];

  useEffect(() => {
    if (mobileOpen) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [mobileOpen]);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (!keyboardItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % keyboardItems.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? keyboardItems.length - 1 : current - 1));
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      const selected = keyboardItems[activeIndex];
      if (selected?.type === "product") {
        event.preventDefault();
        onPickProduct(selected.item);
      } else if (selected?.term) {
        event.preventDefault();
        onPickTerm(selected.term);
      }
    }
  };

  const searchInput = (
    <form onSubmit={onSubmit} className="relative">
      <div className="sf-search-input-shell group relative overflow-hidden rounded-[1.35rem] border border-white/50 bg-white/72 shadow-[0_18px_50px_rgba(39,20,75,0.10)] backdrop-blur-2xl transition duration-300 focus-within:border-[#e5c158]/70 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(212,175,55,0.10),0_24px_70px_rgba(212,175,55,0.18)] dark:border-white/10 dark:bg-white/[0.075] dark:focus-within:bg-white/[0.10]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(216,180,254,0.22),transparent_28%)] opacity-0 transition group-focus-within:opacity-100" />
        <Search className="pointer-events-none absolute right-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#d4af37] dark:text-[#f3d77a]" />
        <input
          ref={inputRef}
          value={value}
          onFocus={onOpen}
          onChange={(event) => {
            onChange(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="sf-search-input relative z-10 h-13 w-full bg-transparent pr-12 pl-24 text-sm font-bold text-stone-950 outline-none placeholder:text-stone-400 dark:text-white dark:placeholder:text-stone-500 md:h-12"
          aria-label={t("storefront.search.aria")}
          role="combobox"
          aria-expanded={Boolean(open || mobileOpen)}
        />
        <div className="absolute left-2 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1.5">
          <button type="button" onClick={onVoice} className="sf-search-tool-button grid h-8 w-8 place-items-center rounded-full bg-stone-950/5 text-stone-600 transition hover:bg-[#d4af37] hover:text-white dark:bg-white/8 dark:text-stone-200" aria-label={t("storefront.search.voice")}>
            <Mic className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="sf-search-tool-button grid h-8 w-8 place-items-center rounded-full bg-stone-950/5 text-stone-600 transition hover:bg-[#d4af37] hover:text-white dark:bg-white/8 dark:text-stone-200" aria-label={t("storefront.search.image")}>
            <ImagePlus className="h-4 w-4" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onImage} />
        </div>
      </div>
    </form>
  );

  const resultsPanel = (
    <div className="sf-mobile-search-panel rounded-[1.6rem] border border-white/60 bg-white/92 p-3 text-stone-950 shadow-[0_28px_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#0a0a0a]/96 dark:text-white">
      <SearchQuickSections
        value={value}
        loading={loading}
        suggestions={suggestions}
        imageSearch={imageSearch}
        recentSearches={uniqueRecentSearches}
        activeIndex={activeIndex}
        onPickTerm={onPickTerm}
        onPickProduct={onPickProduct}
        trendingSearches={trendingSearches}
        searchFallbackSections={searchFallbackSections}
        onShareImageOnWhatsApp={onShareImageOnWhatsApp}
        onRequestVisualSearchSupply={onRequestVisualSearchSupply}
        onClearImageSearch={onClearImageSearch}
      />
    </div>
  );

  if (drawerMode) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="min-w-0 flex-none">{searchInput}</div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(0.25rem+env(safe-area-inset-bottom))]">
          {resultsPanel}
        </div>
      </div>
    );
  }

  if (mobileOnly) {
    if (!mobileOpen) return null;
    return (
      <div className="fixed inset-0 z-[100] bg-[#050505]/88 p-4 pt-[calc(1rem+env(safe-area-inset-top))] text-white backdrop-blur-2xl md:hidden" dir="rtl">
        <div className="mx-auto flex h-full max-w-xl flex-col">
          <div className="sticky top-0 z-10 flex items-center gap-2 pb-4">
            <div className="min-w-0 flex-1">{searchInput}</div>
            <button type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/8 text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
            {resultsPanel}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full max-w-[520px] justify-self-center transition-all duration-300 ${open ? "max-w-[640px]" : ""} ${className}`}>
      {open ? <button type="button" onClick={onClose} className="fixed inset-0 z-40 hidden bg-stone-950/24 backdrop-blur-[2px] md:block" aria-label="Close search" /> : null}
      <div className="relative z-50">
        {searchInput}
        {open ? <div className="absolute left-0 right-0 top-full mt-3 animate-[sfFadeUp_180ms_ease-out_both]">{resultsPanel}</div> : null}
      </div>
    </div>
  );
}

function SearchQuickSections({
  value,
  loading,
  suggestions,
  imageSearch = null,
  recentSearches = [],
  activeIndex,
  onPickTerm,
  onPickProduct,
  trendingSearches = [],
  searchFallbackSections = {},
  onShareImageOnWhatsApp = () => {},
  onRequestVisualSearchSupply = () => {},
  onClearImageSearch = () => {},
}) {
  const { t } = useTranslation();
  const query = value.trim();
  const exactMatches = Array.isArray(imageSearch?.exactMatches) ? imageSearch.exactMatches : [];
  const similarMatches = Array.isArray(imageSearch?.similarMatches) ? imageSearch.similarMatches : [];
  const hasImageSearch = Boolean(imageSearch?.active || imageSearch?.loading || imageSearch?.error || exactMatches.length || similarMatches.length);
  const imageResults = exactMatches.length ? exactMatches : similarMatches;
  const imageTitle = imageSearch?.loading
    ? "بنبحث عن أقرب موديل..."
    : exactMatches.length && Number(imageSearch?.confidence || 0) >= 80
      ? "لقينا الموديل ده"
      : similarMatches.length
        ? "الموديل مش متوفر، بس دي أقرب موديلات شبهه"
        : imageSearch?.error
          ? "البحث بالصورة غير متاح حاليًا"
          : "الموديل ده مش متوفر حاليًا";
  return (
    <div className="grid gap-3">
      {hasImageSearch ? (
        <div className="sf-image-search-card rounded-[1.4rem] border border-[#d4af37]/18 bg-[linear-gradient(180deg,rgba(255,248,225,0.94),rgba(255,255,255,0.98))] p-3 text-stone-950 shadow-[0_18px_40px_rgba(212,175,55,0.08)] dark:border-[#d4af37]/18 dark:bg-white/[0.04] dark:text-white">
          <div className="flex items-start gap-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/60 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
              {imageSearch?.previewUrl ? <img src={imageSearch.previewUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-[#b0891b] dark:text-[#f3d77a]">البحث بالصورة</div>
              <h3 className="mt-1 text-sm font-black">{imageTitle}</h3>
              {imageSearch?.loading ? (
                <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-300">بنبحث عن أقرب موديل...</p>
              ) : null}
              {!imageSearch?.loading && imageSearch?.message ? (
                <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-300">{imageSearch.message}</p>
              ) : null}
              {Number.isFinite(Number(imageSearch?.confidence)) && Number(imageSearch?.confidence || 0) > 0 ? (
                <div className="mt-2 inline-flex items-center rounded-full border border-amber-300/30 bg-amber-100 px-2.5 py-1 text-[10px] font-black text-amber-700 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">
                  ثقة {Math.round(Number(imageSearch.confidence || 0))}%
                </div>
              ) : null}
            </div>
          </div>

          {imageSearch?.loading ? (
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-dashed border-[#d4af37]/25 bg-white/70 px-3 py-3 text-xs font-bold text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
              <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" />
              <span>بنبحث عن أقرب موديل...</span>
            </div>
          ) : null}

          {!imageSearch?.loading && imageResults.length ? (
            <div className="mt-3 grid gap-1.5">
              {exactMatches.length ? <div className="px-1 text-[11px] font-black uppercase tracking-[0.14em] text-stone-500 dark:text-stone-400">النتيجة المطابقة</div> : null}
              {imageResults.slice(0, 6).map((product, index) => (
                <SearchResultRow
                  key={`${product.id || product.product_id || index}-${product.match_type || "image"}`}
                  product={product}
                  active={false}
                  onPickProduct={onPickProduct}
                />
              ))}
            </div>
          ) : null}

          {!imageSearch?.loading && !imageResults.length ? (
            <div className="mt-3 grid gap-2 rounded-[1.2rem] border border-dashed border-[#d4af37]/24 bg-white/75 p-3 dark:border-white/10 dark:bg-white/5">
              <p className="text-sm font-black text-stone-900 dark:text-white">الموديل ده مش متوفر حاليًا</p>
              <p className="text-xs leading-5 text-stone-600 dark:text-stone-300">ممكن تبعتلنا الصورة على واتساب أو تسيب رقمك ونبلغك أول ما يوصل</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={onShareImageOnWhatsApp} className="inline-flex min-h-10 items-center justify-center rounded-full border border-emerald-300/35 bg-emerald-500/10 px-3 text-xs font-black text-emerald-700 transition hover:bg-emerald-500/15 dark:text-emerald-100">
                  إرسال الصورة على واتساب
                </button>
                <button type="button" onClick={onRequestVisualSearchSupply} className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#d4af37]/28 bg-[#d4af37]/12 px-3 text-xs font-black text-[#8a6700] transition hover:bg-[#d4af37]/18 dark:text-[#f3d77a]">
                  طلب توفير الموديل
                </button>
              </div>
              <button type="button" onClick={onClearImageSearch} className="inline-flex min-h-9 items-center justify-center rounded-full border border-stone-200 bg-white px-3 text-[11px] font-black text-stone-600 transition hover:border-stone-300 hover:text-stone-900 dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
                رجوع للبحث النصي
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {query ? (
        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-bold text-stone-500 dark:text-stone-400">{t("storefront.search.smartResults")}</span>
            {loading ? <span className="text-[11px] font-bold text-[#d4af37]">{t("storefront.search.searching")}</span> : null}
          </div>
          <div className="grid gap-1.5">
              {suggestions.length ? suggestions.map((product, index) => (
                <SearchResultRow
                  key={product.id}
                  product={product}
                  active={activeIndex === index}
                  onPickProduct={onPickProduct}
                />
              )) : (
                <button type="button" onClick={() => onPickTerm(query)} className="rounded-2xl border border-dashed border-stone-200 p-4 text-right text-sm font-black text-stone-600 dark:border-white/10 dark:text-stone-300">
                {t("storefront.search.searchFor")} "{query}"
                </button>
              )}
          </div>
        </div>
      ) : null}

      {!query && !hasImageSearch ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <SearchQuickCard title={t("storefront.search.categories")} items={searchFallbackSections.categories || []} onPick={onPickTerm} />
            <SearchQuickCard title={t("storefront.search.brands")} items={searchFallbackSections.brands || []} onPick={onPickTerm} />
            <SearchQuickCard title={t("storefront.search.styles")} items={searchFallbackSections.styles || []} onPick={onPickTerm} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function SearchChips({ title, items, onPick }) {
  return (
    <div>
      <div className="mb-2 px-1 text-xs font-bold text-stone-500 dark:text-stone-400">{title}</div>
      <div className="flex flex-wrap gap-2">
        {[...new Set(items)].slice(0, 8).map((item) => (
          <button key={item} type="button" onClick={() => onPick(item)} className="sf-search-chip rounded-full border border-stone-200/80 bg-white/92 px-3.5 py-2 text-xs font-bold text-stone-700 shadow-[0_8px_18px_rgba(15,23,42,0.06)] transition hover:-translate-y-px hover:border-[var(--sf-purple)] hover:text-stone-950 dark:border-white/10 dark:bg-white/[0.05] dark:text-stone-200 dark:shadow-[0_12px_24px_rgba(0,0,0,0.22)]">
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchQuickCard({ title, items, onPick }) {
  if (!items.length) return null;
  return (
    <div className="sf-search-quick-card rounded-[1.4rem] border border-white/[0.08] bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-3.5 shadow-[0_18px_42px_rgba(0,0,0,0.28)]">
      <div className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-white/55">{title}</div>
      <div className="grid gap-1.5">
        {items.map((item) => (
          <button key={item} type="button" onClick={() => onPick(item)} className="sf-search-quick-item rounded-[1rem] border border-white/[0.08] bg-[#101010] px-3 py-2 text-start text-xs font-bold text-white/82 transition hover:border-[#d0a632]/45 hover:bg-[#151515] hover:text-white">
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchResultRow({ product, active, onPickProduct }) {
  return (
    <button
      type="button"
      onClick={() => onPickProduct(product)}
      className={`sf-search-result-row flex items-center gap-3 rounded-[1.2rem] border p-2.5 text-right text-stone-950 shadow-[0_10px_22px_rgba(15,23,42,0.05)] transition hover:-translate-y-px active:scale-[0.99] dark:text-white dark:shadow-[0_14px_26px_rgba(0,0,0,0.22)] ${active ? "border-[var(--sf-purple)] bg-[rgba(212,175,55,0.10)] dark:bg-white/[0.08]" : "border-stone-200/80 bg-white/92 hover:border-[var(--sf-purple)] hover:bg-[var(--sf-cream)] dark:border-white/10 dark:bg-white/[0.045] dark:hover:bg-white/[0.06]"}`}
    >
      <img src={imageFor(product.image_url)} alt="" className="h-14 w-14 rounded-2xl bg-stone-100 object-cover shadow-sm dark:bg-white/5" loading="lazy" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-stone-950 dark:text-white">{product.name}</div>
        <div className="truncate text-xs font-bold text-stone-500 dark:text-stone-400">
          {[product.category, product.brand, product.style, product.grade].filter(Boolean).join(" / ") || product.sizes?.slice(0, 4).join(" / ") || "Browse items"}
        </div>
      </div>
      <div className="rounded-full border border-stone-200/80 bg-white px-3 py-1 text-xs font-black text-stone-950 shadow-[0_8px_18px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:shadow-none">{money(displaySellingPrice(product))}</div>
    </button>
  );
}

const ProductCard = memo(function ProductCard({ product: rawProduct, groupedProduct = null, colorOptions: providedColorOptions = null, selectedColor: providedSelectedColor = "", selectedVariant: providedSelectedVariant = null, availableSizes: providedAvailableSizes = null, wishlist, toggleWishlist, onAddToCart, saleModeEnabled, railType = "default", rank = null, featured = false, density = "standard", sizeLimit = 4, eagerImage = false, priorityImage = false, imagePreset = "grid" }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const product = useMemo(() => groupedProduct || rawProduct || {}, [groupedProduct, rawProduct]);
  const cardRef = useRef(null);
  const primaryImageRef = useRef(null);
  const variants = useMemo(() => {
    const allVariants = Array.isArray(product.variants) ? product.variants : [];
    const colorKey = String(product.color_key || product.display_color_key || "").trim().toLowerCase();
    if (!colorKey) return allVariants;
    const colorVariants = allVariants.filter((variant) => variantColorKey(variant) === colorKey);
    return colorVariants.length ? colorVariants : allVariants;
  }, [product]);
  const sellableVariants = useMemo(() => variants.filter(variantHasStock), [variants]);
  const colorGroups = useMemo(
    () => providedColorOptions || getProductColorGroups({ ...product, variants: sellableVariants.length ? sellableVariants : variants }),
    [product, providedColorOptions, sellableVariants, variants]
  );
  const firstAvailableVariant = useMemo(() => firstDisplayVariant(variants), [variants]);
  const initialVariant = providedSelectedVariant || firstAvailableVariant;
  const [selectedVariantId, setSelectedVariantId] = useState(initialVariant?.id || "");
  const [selectedColorKeyState, setSelectedColorKeyState] = useState(providedSelectedColor || (initialVariant ? variantColorKey(initialVariant) : ""));
  const [hoverProductDetails, setHoverProductDetails] = useState(null);
  const selectedVariant = useMemo(
    () => variants.find((variant) => String(variant.id) === String(selectedVariantId)) || null,
    [selectedVariantId, variants]
  );
  const selectedVariantIsAvailable = Boolean(selectedVariant && variantHasStock(selectedVariant));
  const selectedColorKey = selectedColorKeyState || (selectedVariant ? variantColorKey(selectedVariant) : "");
  const activeColorGroup = useMemo(
    () => getActiveColorGroup(product, selectedColorKey),
    [product, selectedColorKey]
  );
  const activeColorVariant = useMemo(
    () => firstDisplayVariant(activeColorGroup?.variants || []),
    [activeColorGroup]
  );
  const availableVariant = useMemo(
    () => (selectedVariantIsAvailable ? selectedVariant : null) || activeColorVariant || firstAvailableVariant,
    [activeColorVariant, firstAvailableVariant, selectedVariant, selectedVariantIsAvailable]
  );
  const inWishlist = useMemo(() => wishlist.some((item) => String(item.id) === String(product.id)), [product.id, wishlist]);
  const rawSaleModeEnabled = saleModeEnabled;
  const parsedSaleModeEnabled = parseSaleModeEnabled(rawSaleModeEnabled, false);
  const pricing = useMemo(
    () => getDisplayPricing(product, parsedSaleModeEnabled, availableVariant),
    [availableVariant, product, parsedSaleModeEnabled]
  );
  const sellingPrice = pricing.price;
  const comparePrice = pricing.comparePrice && pricing.comparePrice > sellingPrice ? pricing.comparePrice : 0;
  const discountPercent = pricing.isOnSale ? pricing.discountPercent || 0 : 0;
  const activeSizes = useMemo(
    () => providedAvailableSizes || getSizesForColorGroup(activeColorGroup, product),
    [activeColorGroup, providedAvailableSizes]
  );
  const visibleSizes = useMemo(() => {
    const maxVisible = activeSizes.length > 1 ? 2 : activeSizes.length;
    return activeSizes.slice(0, Math.min(maxVisible, sizeLimit));
  }, [activeSizes, sizeLimit]);
  const extraSizeCount = Math.max(0, activeSizes.length - visibleSizes.length);
  const displayImage = useMemo(
    () => productCardPrimaryImageFor(product, availableVariant, activeColorGroup),
    [activeColorGroup, availableVariant, product]
  );
  const hoverDetailVariants = useMemo(
    () => (Array.isArray(hoverProductDetails?.variants) ? hoverProductDetails.variants : []),
    [hoverProductDetails]
  );
  const hoverDetailVariant = useMemo(() => (
    hoverDetailVariants.find((variant) => String(variant.id) === String(availableVariant?.id))
    || hoverDetailVariants.find((variant) => variantColorKey(variant) === selectedColorKey)
    || firstDisplayVariant(hoverDetailVariants)
  ), [availableVariant?.id, hoverDetailVariants, selectedColorKey]);
  const hoverDetailColorGroup = useMemo(
    () => (hoverProductDetails ? getActiveColorGroup(hoverProductDetails, variantColorKey(hoverDetailVariant || {}) || selectedColorKey) : null),
    [hoverDetailVariant, hoverProductDetails, selectedColorKey]
  );
  const secondaryDisplayImage = useMemo(
    () => productCardSecondaryImageFor(product, availableVariant, activeColorGroup, displayImage)
      || productCardSecondaryImageFor(hoverProductDetails || {}, hoverDetailVariant, hoverDetailColorGroup, displayImage),
    [activeColorGroup, availableVariant, displayImage, hoverDetailColorGroup, hoverDetailVariant, hoverProductDetails, product]
  );
  const primaryImageUrl = useMemo(() => resolveCardImageUrl(displayImage), [displayImage]);
  const secondaryImageUrl = useMemo(() => resolveCardImageUrl(secondaryDisplayImage), [secondaryDisplayImage]);
  const hasReadySecondaryImage = Boolean(secondaryImageUrl && secondaryImageUrl !== primaryImageUrl);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddColorKey, setQuickAddColorKey] = useState("");
  const [quickAddVariantId, setQuickAddVariantId] = useState("");
  const [quickAddQty, setQuickAddQty] = useState(1);
  const [secondaryImageReady, setSecondaryImageReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHoverProductDetails(null);
    deferReactState(() => {
      if (!cancelled) {
        const next = providedSelectedVariant && variantHasStock(providedSelectedVariant) ? providedSelectedVariant : firstAvailableVariant;
        setSelectedVariantId(next?.id || "");
        setSelectedColorKeyState(providedSelectedColor || (next ? variantColorKey(next) : ""));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [firstAvailableVariant, product.id, providedSelectedColor, providedSelectedVariant]);
  useEffect(() => {
    setSecondaryImageReady(false);
    if (!hasReadySecondaryImage || typeof window === "undefined") return undefined;
    let cancelled = false;
    const preloadImage = new Image();
    preloadImage.decoding = "async";
    preloadImage.onload = () => {
      if (!cancelled) setSecondaryImageReady(true);
    };
    preloadImage.onerror = () => {
      if (!cancelled) setSecondaryImageReady(false);
    };
    preloadImage.src = imageFor(secondaryImageUrl);
    if (preloadImage.complete) {
      if (preloadImage.naturalWidth > 0) {
        setSecondaryImageReady(true);
      } else {
        setSecondaryImageReady(false);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [hasReadySecondaryImage, secondaryImageUrl]);

  useEffect(() => {
    if (!selectedVariantId || !activeSizes.length) return;
    if (activeSizes.some((item) => String(item.variant?.id) === String(selectedVariantId))) return;
    const nextVariant = activeSizes.find((item) => String(item.originalSize || item.size) === String(selectedVariant?.size))?.variant || activeSizes[0]?.variant;
    if (nextVariant?.id) setSelectedVariantId(nextVariant.id);
  }, [activeSizes, selectedVariant?.size, selectedVariantId]);
  const quickAddActiveGroup = useMemo(
    () => colorGroups.find((group) => String(group.key) === String(quickAddColorKey)) || (colorGroups.length === 1 ? colorGroups[0] : null),
    [colorGroups, quickAddColorKey]
  );
  const quickAddSizeOptions = useMemo(
    () => getSizeOptionsForColorGroup(quickAddActiveGroup, product),
    [product, quickAddActiveGroup]
  );
  const quickAddSelectedVariant = useMemo(
    () => quickAddSizeOptions.find((item) => String(item.variant?.id) === String(quickAddVariantId))?.variant || null,
    [quickAddSizeOptions, quickAddVariantId]
  );
  const quickAddMaxQty = Math.max(1, Number(quickAddSelectedVariant?.stock || 1));
  const canQuickAdd = sellableVariants.length > 0;
  const openVariantSheet = useCallback(() => {
    const nextGroup = colorGroups.length === 1 ? colorGroups[0] : null;
    const nextSizes = getSizeOptionsForColorGroup(nextGroup, product);
    const availableSizes = nextSizes.filter((item) => variantHasStock(item.variant));
    const nextVariant = availableSizes.length === 1 ? availableSizes[0]?.variant : null;
    setQuickAddColorKey(nextGroup?.key || "");
    setQuickAddVariantId(nextVariant?.id || "");
    setQuickAddQty(1);
    setQuickAddOpen(true);
  }, [colorGroups, product]);
  const closeVariantSheet = useCallback(() => {
    setQuickAddOpen(false);
    setQuickAddColorKey("");
    setQuickAddVariantId("");
    setQuickAddQty(1);
  }, []);
  const handleVariantSheetAdd = useCallback(async (variant, quantity) => {
    await Promise.resolve(onAddToCart(product, variant, quantity, { sourceEl: primaryImageRef.current }));
    closeVariantSheet();
  }, [closeVariantSheet, onAddToCart, product]);
  const handleQuickAddColorChange = useCallback((colorKey) => {
    const nextGroup = colorGroups.find((group) => String(group.key) === String(colorKey)) || null;
    const nextSizes = getSizeOptionsForColorGroup(nextGroup, product);
    const availableSizes = nextSizes.filter((item) => variantHasStock(item.variant));
    const currentSize = quickAddSizeOptions.find((item) => String(item.variant?.id) === String(quickAddVariantId))?.originalSize
      || quickAddSizeOptions.find((item) => String(item.variant?.id) === String(quickAddVariantId))?.size
      || "";
    const sizeMatch = currentSize
      ? nextSizes.find((item) => String(item.originalSize || item.size) === String(currentSize) && variantHasStock(item.variant))?.variant || null
      : null;
    const nextVariant = sizeMatch
      || (availableSizes.length === 1
        ? availableSizes[0]?.variant || null
        : null);
    setQuickAddColorKey(nextGroup?.key || "");
    setQuickAddVariantId(nextVariant?.id || "");
    setQuickAddQty(1);
  }, [colorGroups, product, quickAddSizeOptions, quickAddVariantId]);
  const handleQuickAddVariantChange = useCallback((variantId) => {
    setQuickAddVariantId(variantId);
    setQuickAddQty(1);
  }, []);
  const handleQuickAddQuantityChange = useCallback((nextQty) => {
    setQuickAddQty((current) => {
      const target = Number.isFinite(Number(nextQty)) ? Number(nextQty) : Number(current || 1);
      return Math.min(Math.max(1, target || 1), quickAddMaxQty);
    });
  }, [quickAddMaxQty]);
  const handleWishlist = useCallback(() => {
    toggleWishlist(product);
    playSoftClick();
  }, [product, toggleWishlist]);
  const visibleColorOptions = useMemo(() => colorGroups.slice(0, 4), [colorGroups]);
  const extraColorCount = Math.max(0, colorGroups.length - visibleColorOptions.length);
  const detailsUrl = useMemo(
    () => productUrl({ ...product, selected_variant_id: availableVariant?.id || product.selected_variant_id, color_key: selectedColorKey || product.color_key }),
    [availableVariant?.id, product, selectedColorKey]
  );
  const productIdentifier = useMemo(() => productRouteIdentifier(product), [product]);
  const requestDetailPrefetch = useCallback(() => {
    if (!productIdentifier) return;
    void prefetchStorefrontProductDetails(productIdentifier).then((payload) => {
      const detailProduct = productFromDetailsResponse(payload || {});
      if (detailProduct && typeof detailProduct === "object") setHoverProductDetails(detailProduct);
    });
  }, [productIdentifier]);
  const chooseColor = useCallback((event, group) => {
    event.preventDefault();
    event.stopPropagation();
    const next = firstDisplayVariant(group?.variants || []);
    setSelectedColorKeyState(group?.key || "");
    setSelectedVariantId(next?.id || "");
  }, []);
  useEffect(() => {
    const node = cardRef.current;
    if (!node || !productIdentifier || typeof window === "undefined" || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        requestDetailPrefetch();
        observer.disconnect();
      },
      { threshold: 0.35, rootMargin: "120px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [productIdentifier, requestDetailPrefetch]);
  const cardDensityClasses = {
    hero: {
      image: "aspect-[0.9/1] p-0",
      body: "px-[12px] pb-[10px] pt-[5px]",
      title: "min-h-10 text-[13px] leading-[1.22rem]",
      price: "text-[20px]",
      sizes: "gap-1.5",
      chip: "h-6 px-2 text-[8.5px]",
      color: "h-6 w-6",
      swatch: "h-3.5 w-3.5",
    },
    standard: {
      image: "aspect-[0.92/1] p-0",
      body: "px-[11px] pb-[10px] pt-[5px] md:px-[12px]",
      title: "min-h-10 text-[13px] leading-[1.2rem]",
      price: "text-[20px]",
      sizes: "gap-1.5",
      chip: "h-6 px-2 text-[8.5px]",
      color: "h-[22px] w-[22px]",
      swatch: "h-3.5 w-3.5",
    },
    compact: {
      image: "aspect-[0.96/1] p-0",
      body: "px-[11px] pb-[9px] pt-[5px] md:px-[12px]",
      title: "min-h-9 text-[13px] leading-[1.18rem]",
      price: "text-[20px]",
      sizes: "gap-1.25",
      chip: "h-6 px-2 text-[8.5px]",
      color: "h-6 w-6",
      swatch: "h-3.5 w-3.5",
    },
  };
  const densityClasses = cardDensityClasses[density] || cardDensityClasses.standard;
  const brandLabel = productCardBrandLabel(product);
  const brandFilterUrl = useMemo(() => productCardBrandFilterUrl(product), [product]);
  const cardBadge = useMemo(() => {
    if (parsedSaleModeEnabled && discountPercent) {
      return { key: "sale", label: "Sale" };
    }
    return null;
  }, [discountPercent, parsedSaleModeEnabled]);

  return (
    <article ref={cardRef} style={eagerImage ? undefined : { contentVisibility: "auto", containIntrinsicSize: "240px 340px" }} onMouseEnter={requestDetailPrefetch} onTouchStart={requestDetailPrefetch} className={`sf-product-card group/product relative flex h-full transform-gpu flex-col overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[linear-gradient(180deg,#050505_0%,#101010_40%,#151515_100%)] shadow-[0_14px_36px_rgba(15,23,42,0.08)] ring-1 ring-white/[0.045] transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out hover:-translate-y-1 hover:border-[#d4af37]/30 hover:shadow-[0_18px_42px_rgba(15,23,42,0.12)] active:translate-y-[1px] active:scale-[0.995] touch-manipulation md:rounded-[1.7rem] dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,#050505_0%,#101010_40%,#151515_100%)] dark:ring-white/[0.04] dark:shadow-[0_10px_24px_rgba(0,0,0,0.18)] dark:hover:border-[#d4af37]/22 dark:hover:shadow-[0_20px_34px_rgba(0,0,0,0.26)] ${featured ? "md:shadow-[0_16px_38px_rgba(212,175,55,0.08)]" : ""}`}>
      <div className="pointer-events-none absolute inset-x-8 top-6 h-16 rounded-full bg-[rgba(212,175,55,0)] transition duration-200 group-hover/product:bg-[rgba(212,175,55,0.075)]" />
      <div className={`relative overflow-hidden rounded-[1.05rem] bg-[linear-gradient(180deg,#050505_0%,#101010_40%,#151515_100%)] ring-1 ring-white/[0.04] md:rounded-[1.2rem] dark:bg-[linear-gradient(180deg,#050505_0%,#101010_40%,#151515_100%)] dark:ring-white/10 ${densityClasses.image}`}>
        <Link to={detailsUrl} onClick={resetStorefrontViewportScroll} className="relative z-10 block h-full active:opacity-95">
          {displayImage ? (
            <div className="sf-product-card-media group/card-image relative h-full w-full overflow-hidden rounded-[0.95rem] md:rounded-[1.05rem]">
              <img
                ref={primaryImageRef}
                src={imageFor(displayImage)}
                {...responsiveImageProps(displayImage, imagePreset)}
                alt={product.name}
                onError={fallbackProductImage}
                className={`sf-card-primary-image pointer-events-none absolute inset-0 z-[1] h-full w-full scale-[1.08] transform-gpu rounded-[0.95rem] object-contain object-center opacity-100 transition-[opacity,transform] duration-1000 ease-[cubic-bezier(0.25,0.1,0.25,1)] will-change-[opacity,transform] md:rounded-[1.05rem] md:group-hover/card-image:scale-[1.19] md:group-active/product:scale-[1.19] ${hasReadySecondaryImage && secondaryImageReady ? "md:group-hover/card-image:opacity-0" : "md:group-hover/card-image:opacity-100"}`}
                style={{ backfaceVisibility: "hidden" }}
                loading={eagerImage ? "eager" : "lazy"}
                fetchPriority={priorityImage ? "high" : undefined}
                decoding="async"
                width="360"
                height="432"
              />
              {hasReadySecondaryImage && secondaryImageReady ? (
                <img
                  src={imageFor(secondaryImageUrl)}
                  {...responsiveImageProps(secondaryImageUrl, imagePreset)}
                  alt={product.name}
                  aria-hidden="true"
                  onError={fallbackProductImage}
                  className="sf-card-secondary-image pointer-events-none absolute inset-0 z-[2] h-full w-full scale-[1.08] transform-gpu rounded-[0.95rem] object-contain object-center opacity-0 transition-[opacity,transform] duration-1000 ease-[cubic-bezier(0.25,0.1,0.25,1)] will-change-[opacity,transform] md:rounded-[1.05rem] md:group-hover/card-image:scale-[1.13] md:group-hover/card-image:opacity-100 md:group-active/product:opacity-95"
                  style={{ backfaceVisibility: "hidden" }}
                  loading="lazy"
                  decoding="async"
                  width="360"
                  height="432"
                />
              ) : null}
            </div>
          ) : (
            <div className="grid h-full w-full place-items-center rounded-[1rem] bg-white/70 text-center text-xs font-black text-stone-400 dark:bg-white/5 dark:text-stone-500 md:rounded-[1.15rem]">
              <Sparkles className="h-6 w-6 opacity-50" />
            </div>
          )}
        </Link>
        <div className="absolute right-3 top-[29px] z-20 flex flex-col items-end gap-2.5 md:right-3.5 md:top-[31px]">
          {rank && railType === "bestseller" && rank <= 3 ? <span className="sf-storefront-gold-badge inline-flex min-h-6 items-center gap-1 rounded-full border border-[#f3d77a]/24 bg-[linear-gradient(135deg,rgba(212,175,55,0.98),rgba(229,193,88,0.98))] px-2.5 py-0.5 text-[8.5px] font-extrabold leading-none tracking-[0.02em] text-stone-950 shadow-[0_10px_22px_rgba(212,175,55,0.24)] backdrop-blur md:min-h-7 md:px-3 md:text-[9px]"><Star className="h-3 w-3 fill-current" />TOP {rank}</span> : null}
          {discountPercent ? <span className="sf-storefront-gold-badge inline-flex min-h-7 items-center rounded-full border border-[#f3d77a]/26 bg-[linear-gradient(135deg,#d4af37,#e5c158)] px-2.5 py-0.5 text-[9px] font-extrabold leading-none tracking-[0.02em] text-white shadow-[0_8px_18px_rgba(212,175,55,0.16)] backdrop-blur md:min-h-8 md:px-3 md:text-[9px] dark:border-[#f3d77a]/18 dark:bg-[linear-gradient(135deg,#d4af37,#e5c158)] dark:text-[#ffffff]">-{discountPercent}%</span> : null}
        </div>
          <button
            onClick={(event) => { event.stopPropagation(); handleWishlist(); }}
          className="absolute left-3 top-[28px] z-20 grid h-10 w-10 place-items-center rounded-full border border-white/70 bg-white text-stone-700 shadow-[0_12px_24px_rgba(15,23,42,0.16)] backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:scale-[1.04] hover:border-white hover:bg-white active:translate-y-[1px] active:scale-[0.96] touch-manipulation md:h-11 md:w-11 dark:border-white/12 dark:bg-[#0d0d0d] dark:text-stone-100 dark:shadow-[0_10px_22px_rgba(0,0,0,0.2)] dark:hover:bg-[#151515]"
          aria-label={t("storefront.header.wishlist")}
        >
          <Heart className={`h-4.5 w-4.5 transition duration-200 md:h-5 md:w-5 ${inWishlist ? "animate-[wishlist-pop_320ms_ease-out] fill-rose-500 text-rose-500" : "text-stone-600 dark:text-stone-200"}`} />
        </button>
        {cardBadge ? (
          <div className="absolute bottom-3 right-3 z-20 flex max-w-[78%] flex-col items-end gap-1.5 md:bottom-3.5 md:right-3.5 md:gap-1.5">
            <span
              className={`inline-flex min-h-8 items-center gap-1 rounded-full px-3.5 py-0.5 text-[10px] font-black leading-none tracking-[0.02em] shadow-[0_8px_18px_rgba(15,23,42,0.14)] backdrop-blur-md ${cardBadge.key === "sale" ? "sf-storefront-gold-badge border border-[#f3d77a]/28 bg-[linear-gradient(135deg,#d4af37,#e5c158)] text-white dark:border-[#f3d77a]/18 dark:bg-[linear-gradient(135deg,#d4af37,#e5c158)]" : cardBadge.key === "bestseller" ? "sf-storefront-gold-badge border border-[#f3d77a]/30 bg-[linear-gradient(135deg,#d4af37,#e5c158)] text-white dark:border-[#f3d77a]/20 dark:bg-[linear-gradient(135deg,#d4af37,#e5c158)]" : "border border-emerald-300/30 bg-[linear-gradient(135deg,rgba(22,163,74,0.98),rgba(34,197,94,0.98))] text-white dark:border-emerald-300/20 dark:bg-[linear-gradient(135deg,rgba(21,128,61,0.98),rgba(22,163,74,0.98))]"}`}
            >
              {cardBadge.key === "bestseller" ? <Star className="h-3 w-3 fill-current" /> : null}
              {cardBadge.label}
            </span>
          </div>
        ) : null}
      </div>
      <div className={`flex flex-col md:p-3 md:pt-2 ${densityClasses.body}`}>
        {brandLabel ? (
          <Link
            to={brandFilterUrl || "/products"}
            onClick={(event) => event.stopPropagation()}
            aria-label={`${normalizeLanguage(i18n.language) === "ar" ? "عرض منتجات" : "Shop"} ${brandLabel}`}
            dir="ltr"
            className="line-clamp-1 flex min-h-[1rem] w-full max-w-full items-start text-left text-[11px] font-bold leading-4 text-stone-700 transition hover:text-[#d4af37] hover:underline focus-visible:text-[#d4af37] focus-visible:underline focus-visible:outline-none dark:text-stone-300 dark:hover:text-[#f3d77a] md:min-h-[1.05rem]"
          >
            {brandLabel}
          </Link>
        ) : null}
        <Link
          to={detailsUrl}
          onClick={resetStorefrontViewportScroll}
          dir="ltr"
          className={`mt-0 flex min-h-[2.4rem] w-full items-start text-left line-clamp-2 overflow-hidden font-black tracking-[-0.01em] text-stone-900 transition duration-200 hover:text-[#d4af37] md:min-h-[2.55rem] md:text-[13px] md:leading-5 dark:text-stone-100 dark:hover:text-[#f3d77a] ${densityClasses.title}`}
        >
          {product.name}
        </Link>
        {/* Desktop hover swap: the price row slides up out of a fixed 35px window and
            the add-to-cart row takes its place. Touch has no hover, so it keeps the
            price permanently visible next to the round quick-add button. */}
        <div className="mt-[4px] flex min-h-[2.35rem] items-center justify-between gap-2 md:min-h-[2.35rem]">
          {/* clip, not hidden: an overflow-hidden window is programmatically
              scrollable, so tabbing to the clipped CTA scrolled it 35px out of
              place for good instead of letting the slide reveal it. */}
          <div className="sf-card-action-wrap min-w-0 flex-1 overflow-clip md:h-[35px]">
            <div className="sf-card-action-track flex flex-col transition-transform duration-500 ease-out md:group-hover/product:-translate-y-[35px] md:focus-within:-translate-y-[35px]">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 md:h-[35px] md:flex-nowrap md:items-center">
                <span className={`sf-product-card-price font-black leading-none text-[#d4af37] md:text-[1.32rem] dark:text-white ${densityClasses.price}`}>{money(sellingPrice)}</span>
                {comparePrice ? <span className="sf-product-card-compare-price text-[10px] font-bold leading-none text-stone-400 line-through opacity-85 dark:text-white/45 md:text-[11px]">{money(comparePrice)}</span> : null}
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openVariantSheet();
                }}
                disabled={!canQuickAdd}
                className="sf-card-slide-cta hidden h-[35px] w-full shrink-0 items-center gap-1.5 whitespace-nowrap bg-transparent p-0 text-[13px] font-black leading-none text-stone-900 transition-colors duration-200 hover:text-[#d4af37] disabled:cursor-not-allowed disabled:text-stone-400 disabled:hover:text-stone-400 dark:text-stone-100 dark:hover:text-[#f3d77a] dark:disabled:text-stone-500 md:inline-flex"
                aria-label={canQuickAdd ? t("storefront.cart.addToCart") : t("storefront.products.unavailable")}
                title={canQuickAdd ? t("storefront.cart.addToCart") : t("storefront.products.unavailable")}
              >
                <ShoppingCart className="h-[18px] w-[18px] shrink-0 text-[#d4af37] dark:text-[#f3d77a]" />
                {canQuickAdd ? t("storefront.cart.addToCart") : t("storefront.products.unavailable")}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openVariantSheet();
            }}
            disabled={!canQuickAdd}
            className="sf-quick-add-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d4af37]/28 bg-[linear-gradient(135deg,#d4af37,#e5c158)] p-0 text-stone-950 shadow-[0_10px_24px_rgba(212,175,55,0.18)] transition duration-200 active:translate-y-[1px] active:scale-[0.98] touch-manipulation disabled:cursor-not-allowed disabled:border-white/10 disabled:from-stone-500/70 disabled:via-stone-500/70 disabled:to-stone-600/70 disabled:text-white/60 disabled:shadow-none md:hidden"
            aria-label={canQuickAdd ? t("storefront.cart.addToCart") : t("storefront.products.unavailable")}
            title={canQuickAdd ? t("storefront.cart.addToCart") : t("storefront.products.unavailable")}
          >
            <ShoppingCart className="h-[18px] w-[18px]" />
          </button>
        </div>
        {colorGroups.length > 1 ? (
          <div className="mt-1.5 flex min-h-7 items-center gap-1 overflow-hidden md:mt-1.5 md:min-h-7 md:gap-1.25">
            {visibleColorOptions.map((group) => {
              const active = String(group.key) === String(selectedColorKey);
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={(event) => chooseColor(event, group)}
                  title={group.colorName || group.color}
                  aria-label={group.colorName || group.color}
                className={`grid shrink-0 place-items-center rounded-full border transition duration-200 active:scale-95 md:h-7 md:w-7 ${densityClasses.color} ${active ? "border-[#d4af37] bg-[rgba(212,175,55,0.12)] shadow-[0_0_0_2px_rgba(212,175,55,0.12)] dark:border-[#e5c158] dark:bg-[rgba(212,175,55,0.12)]" : "border-stone-200 bg-white/70 hover:border-[#d4af37]/35 dark:border-white/10 dark:bg-white/[0.055]"}`}
                >
                  <span className={`rounded-full border border-black/10 shadow-inner md:h-4 md:w-4 ${densityClasses.swatch}`} style={swatchColorStyle(group.colorName || group.color)} />
                </button>
              );
            })}
            {extraColorCount ? <span dir="ltr" className="inline-flex h-6 shrink-0 items-center rounded-full border border-stone-200/80 bg-white/[0.58] px-2 text-[9px] font-black leading-none text-stone-500 dark:border-white/10 dark:bg-white/[0.045] dark:text-stone-400">+{extraColorCount}</span> : null}
          </div>
        ) : null}
        <div className={`mt-[4px] flex h-8 min-w-0 items-center gap-1.5 overflow-hidden pb-0.5 whitespace-nowrap md:h-8 md:gap-2 ${densityClasses.sizes}`}>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              navigate(buildSizeGuidePath(resolveSizeGuideTypeForProduct(product)));
            }}
            className="sf-size-guide-chip inline-flex h-6 shrink-0 whitespace-nowrap items-center justify-center rounded-full border border-stone-200 bg-white px-2.5 text-[9px] font-black text-stone-600 shadow-sm transition duration-200 hover:border-[#b68a2c]/40 hover:text-[#7b5318] active:translate-y-[1px] active:scale-[0.98] md:px-3 dark:border-white/10 dark:bg-white/[0.045] dark:text-stone-200 dark:hover:border-[#d8b75f]/45 dark:hover:text-[#d8b75f]"
          >
            {t("storefront.products.sizeGuide", "\u062f\u0644\u064a\u0644 \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a")}
          </button>
          <div className="sf-scroll flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap md:gap-1.5">
            {visibleSizes.map(({ size, variant }) => {
              const selected = String(availableVariant?.id) === String(variant?.id);
              return (
                <button
                  key={`${activeColorGroup?.key || "default"}-${variant?.id || size}`}
                  type="button"
                  onClick={(event) => { event.stopPropagation(); setSelectedVariantId(variant.id); setSelectedColorKeyState(variantColorKey(variant)); }}
                  className={`inline-flex shrink-0 items-center justify-center rounded-full border font-black leading-none transition duration-200 active:translate-y-[1px] active:scale-[0.98] md:h-6 md:px-2 md:text-[10px] ${densityClasses.chip} ${selected ? "border-[#d4af37] bg-[linear-gradient(135deg,#d4af37,#d4af37)] text-white shadow-[0_8px_18px_rgba(212,175,55,0.12)] ring-1 ring-[#f3d77a]/12 dark:border-[#f3d77a] dark:bg-[linear-gradient(135deg,#e5c158,#d4af37)] dark:text-white dark:ring-[#f3d77a]/14" : "border-stone-300/90 bg-white text-stone-700 shadow-none hover:border-[#d4af37]/35 hover:bg-[#faf7ff] hover:text-[#d4af37] dark:border-white/12 dark:bg-white/[0.055] dark:text-stone-300 dark:hover:border-[#f3d77a]/45 dark:hover:bg-white/[0.08] dark:hover:text-white"} disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-300 disabled:line-through disabled:opacity-45 dark:disabled:bg-white/5 dark:disabled:text-stone-500`}
                >
                  {formatSchoolBagCardSize(size, i18n.resolvedLanguage || i18n.language)}
                </button>
              );
            })}
            {extraSizeCount ? (
              <span dir="ltr" className="inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-stone-300/90 bg-white px-2 text-[9px] font-black leading-none text-stone-500 shadow-none md:text-[10px] dark:border-white/10 dark:bg-white/[0.045] dark:text-stone-500">+{extraSizeCount}</span>
            ) : null}
            {!visibleSizes.length ? (
              <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-stone-300/90 bg-white px-2 text-[9px] font-bold leading-none text-stone-500 shadow-none md:text-[10px] dark:border-white/10 dark:bg-white/5 dark:text-stone-500">{t("storefront.products.oneSize")}</span>
            ) : null}
          </div>
        </div>
      </div>
      {quickAddOpen ? (
        <Suspense fallback={null}>
          <LazyProductCardVariantSheet
            open={quickAddOpen}
            product={product}
            colorGroups={colorGroups}
            selectedColorKey={quickAddColorKey}
            selectedVariantId={quickAddVariantId}
            quantity={quickAddQty}
            onColorChange={handleQuickAddColorChange}
            onVariantChange={handleQuickAddVariantChange}
            onQuantityChange={handleQuickAddQuantityChange}
            onClose={closeVariantSheet}
            onAdd={handleVariantSheetAdd}
          />
        </Suspense>
      ) : null}
    </article>
  );
}, (prev, next) => {
  const wasInWishlist = prev.wishlist.some((item) => String(item.id) === String(prev.product.id));
  const isInWishlist = next.wishlist.some((item) => String(item.id) === String(next.product.id));
  return (
    prev.product === next.product &&
    prev.groupedProduct === next.groupedProduct &&
    prev.colorOptions === next.colorOptions &&
    prev.selectedColor === next.selectedColor &&
    prev.selectedVariant === next.selectedVariant &&
    prev.availableSizes === next.availableSizes &&
    wasInWishlist === isInWishlist &&
    prev.toggleWishlist === next.toggleWishlist &&
    prev.onAddToCart === next.onAddToCart &&
    prev.railType === next.railType &&
    prev.rank === next.rank &&
    prev.featured === next.featured &&
    prev.density === next.density &&
    prev.sizeLimit === next.sizeLimit &&
    prev.eagerImage === next.eagerImage &&
    prev.priorityImage === next.priorityImage &&
    prev.imagePreset === next.imagePreset
  );
});

function ProductCardVariantSheet({
  open = false,
  product,
  colorGroups = [],
  selectedColorKey,
  selectedVariantId,
  quantity = 1,
  onColorChange,
  onVariantChange,
  onQuantityChange,
  onClose,
  onAdd,
}) {
  const { t } = useTranslation();
  useBodyScrollLock(open);
  const activeGroup = useMemo(
    () => colorGroups.find((group) => String(group.key) === String(selectedColorKey)) || (colorGroups.length === 1 ? colorGroups[0] : null),
    [colorGroups, selectedColorKey]
  );
  const sizeOptions = useMemo(
    () => getSizeOptionsForColorGroup(activeGroup, product),
    [activeGroup, product]
  );
  const availableSizeOptions = useMemo(
    () => sizeOptions.filter((item) => variantHasStock(item.variant)),
    [sizeOptions]
  );
  const selectedVariant = useMemo(
    () => sizeOptions.find((item) => String(item.variant?.id) === String(selectedVariantId))?.variant || null,
    [selectedVariantId, sizeOptions]
  );
  const priceVariant = selectedVariant || availableSizeOptions[0]?.variant || firstDisplayVariant(activeGroup?.variants || []) || null;
  const sellingPrice = displaySellingPrice(product, priceVariant);
  const comparePrice = displayComparePrice(product, priceVariant);
  const previewImage = productCardPrimaryImageFor(product, priceVariant, activeGroup);
  const maxQty = Math.max(1, Number(selectedVariant?.stock || 1));
  const safeQty = Math.min(Math.max(1, Number(quantity || 1)), maxQty);
  const submitLabel = !activeGroup ? "اختار اللون أولًا" : selectedVariant ? t("storefront.cart.addToCart") : "اختار المقاس أولًا";
  const handleCloseRequest = useCallback((event) => {
    if (event) {
      event.stopPropagation();
    }
    if (typeof onClose === "function") {
      onClose();
    }
  }, [onClose]);
  useEffect(() => {
    const selectable = availableSizeOptions.filter((item) => variantHasStock(item.variant));
    if (selectable.length !== 1) return;
    const nextVariantId = selectable[0]?.variant?.id || "";
    if (String(nextVariantId) && String(nextVariantId) !== String(selectedVariantId) && typeof onVariantChange === "function") {
      onVariantChange(nextVariantId);
    }
  }, [availableSizeOptions, onVariantChange, selectedVariantId]);

  if (!open) return null;

  return createPortal(
    <div dir="rtl" className="sf-product-variant-sheet fixed inset-0 z-[120] flex items-end justify-center pointer-events-auto md:items-center" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 z-0 bg-stone-950/72 backdrop-blur-sm transition-opacity"
        onClick={handleCloseRequest}
        aria-label={t("common.close")}
      />
      <section
        className="sf-product-variant-sheet-panel relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden border border-white/10 bg-[linear-gradient(180deg,#0a0a0a_0%,#111111_45%,#151515_100%)] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.42)] md:mx-4 md:w-[min(44rem,calc(100vw-2rem))] md:max-h-[90dvh] md:rounded-[2rem] rounded-t-[1.55rem]"
        onClick={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-white/20 md:hidden" />
        <div className="flex items-start justify-between gap-3 border-b border-white/8 px-4 py-4 md:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[1rem] border border-white/10 bg-white/[0.04]">
              <img
                src={imageFor(previewImage)}
                onError={fallbackProductImage}
                alt={product?.name || ""}
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                width="64"
                height="64"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#f3d77a]">{t("storefront.products.chooseColor", "اختار اللون والمقاس")}</p>
              <h3 className="mt-1 line-clamp-2 text-[1rem] font-black leading-6 md:text-[1.05rem]">{product?.name}</h3>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[1.05rem] font-black leading-none text-[#f3d77a]">{money(sellingPrice)}</span>
                {comparePrice ? <span className="text-[11px] font-bold leading-none text-white/40 line-through">{money(comparePrice)}</span> : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onPointerUp={handleCloseRequest}
            onClick={handleCloseRequest}
            className="relative z-20 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/75 transition hover:border-white/20 hover:bg-white/10"
            title={t("common.close")}
            aria-label={t("common.close")}
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 md:px-5">
          <div className="rounded-[1.25rem] border border-[#d4af37]/18 bg-[linear-gradient(145deg,rgba(212,175,55,0.10),rgba(255,255,255,0.03))] px-3 py-2 text-[12px] font-bold leading-5 text-white/80">
            سيتم إضافة اللون والمقاس المختارين فقط إلى السلة.
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">{t("storefront.products.color", "اللون")}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {colorGroups.map((group) => {
                const active = String(group.key) === String(activeGroup?.key);
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => onColorChange(group.key)}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition ${active ? "border-[#f3d77a]/70 bg-[rgba(212,175,55,0.16)] text-white shadow-[0_12px_28px_rgba(212,175,55,0.22)]" : "border-white/10 bg-white/[0.055] text-white/75 hover:border-[#d4af37]/35 hover:bg-white/[0.075]"}`}
                  >
                    <span className="h-3.5 w-3.5 rounded-full border border-white/10" style={swatchColorStyle(group.colorName || group.color)} />
                    <span className="whitespace-nowrap">{group.colorName || group.color}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">{t("storefront.products.size", "المقاس")}</div>
            </div>
            {activeGroup ? (
              <>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {sizeOptions.map(({ size, originalSize, collision, variant, hasStock }) => {
                    const active = String(variant?.id) === String(selectedVariant?.id);
                    return (
                      <button
                        key={variant?.id || size}
                        type="button"
                        onClick={() => {
                          if (!hasStock || !variant?.id) return;
                          onVariantChange(variant.id);
                        }}
                        disabled={!hasStock}
                        className={`min-h-11 rounded-2xl border px-1 text-sm font-black transition ${active ? "border-[#f3d77a]/70 bg-[#d4af37] text-white shadow-[0_12px_28px_rgba(212,175,55,0.24)]" : hasStock ? "border-white/10 bg-white/[0.055] text-white/80 hover:border-[#d4af37]/35 hover:bg-white/[0.08]" : "cursor-not-allowed border-white/[0.08] bg-white/[0.03] text-white/25 line-through opacity-60"}`}
                      >
                        <span className="block">{size || t("storefront.products.oneSize", "مقاس واحد")}</span>
                        {collision && originalSize !== size ? <span className="mt-0.5 block text-[9px] font-bold opacity-65">{originalSize}</span> : null}
                      </button>
                    );
                  })}
                </div>
                {!sizeOptions.length ? (
                  <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.04] p-3 text-center text-xs font-bold text-white/50">
                    {t("storefront.products.unavailable", "غير متاح")}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.04] p-3 text-center text-xs font-bold text-white/50">
                اختار اللون أولًا
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.18em] text-white/45">{t("storefront.cart.quantity", "الكمية")}</div>
            <div className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-white/10 bg-white/[0.045] p-2">
              <button
                type="button"
                onClick={() => onQuantityChange(Math.max(1, safeQty - 1))}
                disabled={!selectedVariant}
                className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-lg font-black transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="-"
              >
                -
              </button>
              <div className="min-w-16 text-center">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{t("storefront.cart.quantity", "الكمية")}</div>
                <div className="text-lg font-black">{safeQty}</div>
              </div>
              <button
                type="button"
                onClick={() => onQuantityChange(Math.min(maxQty, safeQty + 1))}
                disabled={!selectedVariant || safeQty >= maxQty}
                className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-lg font-black transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="+"
              >
                +
              </button>
            </div>
            {selectedVariant ? (
              <div className="mt-2 text-[11px] font-bold text-white/45">
                المتاح لهذا المقاس: {maxQty}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={async () => {
              if (!selectedVariant || !variantHasStock(selectedVariant) || !onAdd) return;
              await Promise.resolve(onAdd(selectedVariant, safeQty));
            }}
            disabled={!selectedVariant || !variantHasStock(selectedVariant)}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-[1.15rem] border border-[#d4af37]/25 bg-[linear-gradient(135deg,#d4af37,#e5c158)] text-sm font-black text-stone-950 shadow-[0_14px_34px_rgba(212,175,55,0.28)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(212,175,55,0.34)] disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.08] disabled:text-white/45 disabled:shadow-none disabled:hover:translate-y-0"
          >
            <ShoppingCart className="h-4 w-4" />
            {submitLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ProductDetailsVariantSheet({
  open = false,
  product,
  variant,
  colors = [],
  selectedColorKey,
  quantity = 1,
  action = "cart",
  onClose,
  onColorSelect,
  onSizeSelect,
  onQuantityChange,
  onSubmit,
}) {
  const colorGroups = Array.isArray(colors) ? colors : [];
  const selectedVariantId = variant?.id || "";
  const allVariants = colorGroups.flatMap((group) => (Array.isArray(group?.variants) ? group.variants : []));

  return (
    <ProductCardVariantSheet
      open={open}
      product={product}
      colorGroups={colorGroups}
      selectedColorKey={selectedColorKey}
      selectedVariantId={selectedVariantId}
      quantity={quantity}
      onColorChange={(nextColorKey) => onColorSelect?.(nextColorKey)}
      onVariantChange={(variantId) => {
        const candidate = allVariants.find((item) => String(item?.id) === String(variantId));
        if (!candidate) return;
        const nextColorKey = variantColorKey(candidate);
        if (String(nextColorKey || "") !== String(selectedColorKey || "")) {
          onColorSelect?.(nextColorKey);
        }
        onSizeSelect?.(candidate.size || "");
      }}
      onQuantityChange={onQuantityChange}
      onClose={onClose}
      onAdd={(candidate, qty) => onSubmit?.(candidate, qty, action)}
    />
  );
}

const recommendationText = (value) => {
  if (value && typeof value === "object") return String(value.name || value.title || value.label || value.value || "").trim();
  return String(value || "").trim();
};

function RecommendationProductTile({ product, wishlist = [], toggleWishlist, saleModeEnabled }) {
  const variant = firstDisplayVariant(Array.isArray(product?.variants) ? product.variants : []);
  const pricing = getDisplayPricing(product, parseSaleModeEnabled(saleModeEnabled, false), variant || {});
  const image = productCardPrimaryImageFor(product, variant);
  const brand = recommendationText(product?.brand?.name || product?.brand_name || product?.brand);
  const inWishlist = wishlist.some((item) => String(item?.id) === String(product?.id));
  // Same two-photo swap as the grid card, on the same shared classes so both
  // surfaces stay on one timing. Only swap once the second photo has decoded --
  // fading to a half-loaded image reads as a flicker.
  const secondaryImage = useMemo(
    () => productCardSecondaryImageFor(product || {}, variant, null, image),
    [image, product, variant]
  );
  const secondaryImageUrl = useMemo(() => resolveCardImageUrl(secondaryImage), [secondaryImage]);
  const primaryImageUrl = useMemo(() => resolveCardImageUrl(image), [image]);
  const hasSecondaryImage = Boolean(secondaryImageUrl && secondaryImageUrl !== primaryImageUrl);
  const [secondaryImageReady, setSecondaryImageReady] = useState(false);
  useEffect(() => {
    setSecondaryImageReady(false);
    if (!hasSecondaryImage || typeof window === "undefined") return undefined;
    let cancelled = false;
    const preloadImage = new Image();
    preloadImage.decoding = "async";
    preloadImage.onload = () => {
      if (!cancelled) setSecondaryImageReady(true);
    };
    preloadImage.src = imageFor(secondaryImageUrl);
    if (preloadImage.complete && preloadImage.naturalWidth > 0) setSecondaryImageReady(true);
    return () => {
      cancelled = true;
    };
  }, [hasSecondaryImage, secondaryImageUrl]);
  const showSecondaryImage = hasSecondaryImage && secondaryImageReady;
  return (
    <div className="sf-product-recommendation-tile group relative min-w-0 text-center">
      <Link to={productUrl(product)} onClick={resetStorefrontViewportScroll} className="block min-w-0">
        <div className="sf-product-card-media group/card-image relative aspect-square overflow-hidden bg-white">
          <img
            src={imageFor(image)}
            onError={fallbackProductImage}
            alt={product?.name || ""}
            className={`sf-card-primary-image absolute inset-0 z-[1] h-full w-full transform-gpu object-contain p-2 opacity-100 ${showSecondaryImage ? "md:group-hover/card-image:opacity-0" : ""}`}
            loading="lazy"
            decoding="async"
          />
          {showSecondaryImage ? (
            <img
              src={imageFor(secondaryImageUrl)}
              onError={fallbackProductImage}
              alt=""
              aria-hidden="true"
              className="sf-card-secondary-image absolute inset-0 z-[2] h-full w-full transform-gpu object-contain p-2 opacity-0 md:group-hover/card-image:opacity-100"
              loading="lazy"
              decoding="async"
            />
          ) : null}
          {pricing.isOnSale && pricing.discountPercent ? <span className="absolute end-2 top-2 z-[3] rounded-full bg-[#d4af37] px-2 py-1 text-[9px] font-black text-black">-{pricing.discountPercent}%</span> : null}
        </div>
        <div className="px-1 pt-2">
          {brand ? <div className="sf-product-recommendation-meta truncate text-[10px] font-bold text-stone-500 dark:text-white/45">{brand}</div> : null}
          <h3 className="sf-product-recommendation-name mt-1 line-clamp-2 min-h-[2.5rem] text-xs font-black leading-5 text-stone-900 dark:text-white md:text-sm">{cleanDisplayText(product?.name || product?.title || "")}</h3>
          <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-xs font-black">
            <span className="sf-product-recommendation-current-price">{money(pricing.price)}</span>
            {pricing.comparePrice > pricing.price ? <span className="sf-product-recommendation-compare-price line-through">{money(pricing.comparePrice)}</span> : null}
          </div>
        </div>
      </Link>
      {typeof toggleWishlist === "function" ? <button type="button" onClick={() => toggleWishlist(product)} aria-label="المفضلة" className={`absolute start-2 top-2 grid h-7 w-7 place-items-center rounded-full border bg-white/95 shadow-sm transition ${inWishlist ? "border-rose-300 text-rose-500" : "border-stone-200 text-stone-700"}`}><Heart className={`h-3.5 w-3.5 ${inWishlist ? "fill-current" : ""}`} /></button> : null}
    </div>
  );
}

// One full desktop row. Below it a rail looks broken, so it unfolds colour cards.
const RECOMMENDATION_RAIL_MIN_ITEMS = 5;

// Matched to the Swiper config the storefront's sibling site runs on its product
// carousels: advance a single card, glide for 1500ms, rest, repeat — never swap a
// whole page at once.
const RAIL_GAP_PX = 10;
const RAIL_AUTOPLAY_MS = 2500;
const RAIL_SLIDE_MS = 1500;
const RAIL_BREAKPOINTS = [
  { minWidth: 1024, perView: 5 },
  { minWidth: 768, perView: 3 },
  { minWidth: 640, perView: 2 },
  { minWidth: 0, perView: 1 },
];

const railPerViewForWidth = (width = 0) =>
  (RAIL_BREAKPOINTS.find((breakpoint) => width >= breakpoint.minWidth) || RAIL_BREAKPOINTS[RAIL_BREAKPOINTS.length - 1]).perView;

function useRailPerView() {
  const [perView, setPerView] = useState(() =>
    typeof window === "undefined" ? RAIL_BREAKPOINTS[0].perView : railPerViewForWidth(window.innerWidth)
  );
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const update = () => setPerView(railPerViewForWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return perView;
}

function StorefrontRecommendationRail({ title, subtitle, href, products = [], currentId, loading = false, minItems = 0, ...cardProps }) {
  const [slide, setSlide] = useState(0);
  const [animating, setAnimating] = useState(true);
  const perView = useRailPerView();
  const touchStartXRef = useRef(null);
  const items = useMemo(() => {
    const cards = sortStorefrontColorCardsByModel(products).filter((product) => {
      const parentId = String(product.parent_product_id || product.id || "");
      if (!parentId || parentId === String(currentId)) return false;
      return true;
    });
    const seen = new Set();
    const onePerModel = cards.filter((product) => {
      const parentId = String(product.parent_product_id || product.id || "");
      if (seen.has(parentId)) return false;
      seen.add(parentId);
      return true;
    });
    // A brand that only carries one or two models would otherwise render a
    // half-empty row, so the rail falls back to that model's colour cards.
    const source = onePerModel.length >= minItems ? onePerModel : cards;
    const seenCards = new Set();
    return source.filter((product, index) => {
      const cardKey = productCardKey(product, index);
      if (seenCards.has(cardKey)) return false;
      seenCards.add(cardKey);
      return true;
    }).slice(0, 15);
  }, [currentId, minItems, products]);
  const itemsSignature = items.map((item, index) => productCardKey(item, index)).join("|");
  const canSlide = items.length > perView;
  // The head of the list is repeated once so the track can run past the end and
  // be snapped back to the start while the clones are on screen — the seam is
  // never visible, which is what makes the loop read as endless.
  const trackItems = canSlide ? [...items, ...items.slice(0, perView)] : items;
  // Sizing stays in CSS. Measuring the viewport in JS meant a missed measurement
  // (a hidden tab, a resize the observer slept through, a mount before layout)
  // rendered every card at a stale width — or at zero, which reads as an empty
  // rail. Percentages here resolve against the shifter, which is exactly one
  // viewport wide, so a slide step is (100% + gap) / perView.
  const slideBasis = `calc((100% - ${(perView - 1) * RAIL_GAP_PX}px) / ${perView})`;
  const slideOffset = `calc((100% + ${RAIL_GAP_PX}px) * ${slide} / ${perView})`;
  // In RTL the track sits flush right, so it advances the other way.
  const direction = typeof document !== "undefined" && document.documentElement.dir === "rtl" ? 1 : -1;

  useEffect(() => {
    setSlide(0);
    setAnimating(true);
  }, [currentId, itemsSignature, perView]);

  useEffect(() => {
    if (loading || !canSlide || typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    // Swiper counts its autoplay delay from the moment a glide ENDS, so a card rests
    // for the delay and only then moves again. Restarting the clock every
    // RAIL_AUTOPLAY_MS instead left the row gliding 1500ms out of every 2500ms - and a
    // gliding row shows a sliced card at each edge, so the rail read as permanently cut.
    const moveTimer = window.setInterval(() => setSlide((current) => current + 1), RAIL_AUTOPLAY_MS + RAIL_SLIDE_MS);
    return () => window.clearInterval(moveTimer);
  }, [canSlide, loading, itemsSignature]);

  // Repositioning by a whole lap must land before the browser paints, otherwise
  // the jump is visible. Two frames: one to apply the untransitioned offset, one
  // to arm the transition again.
  const jumpLap = useCallback((nextSlide) => {
    setAnimating(false);
    setSlide(nextSlide);
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setAnimating(true)));
  }, []);

  useEffect(() => {
    if (!canSlide || slide < items.length || typeof window === "undefined") return undefined;
    // Let the glide into the clones finish, then snap back to the real cards.
    const snapTimer = window.setTimeout(() => jumpLap(slide - items.length), RAIL_SLIDE_MS);
    return () => window.clearTimeout(snapTimer);
  }, [canSlide, items.length, jumpLap, slide]);

  const moveBy = (step) => {
    if (!canSlide) return;
    if (slide + step >= 0) {
      setSlide(slide + step);
      return;
    }
    // Only the head is cloned, so stepping back off the start means teleporting a
    // lap forward first and gliding from there.
    jumpLap(slide + items.length);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setSlide((current) => current + step)));
  };
  const activeDot = ((slide % items.length) + items.length) % items.length;
  if (!loading && !items.length) return null;
  return (
    <section className="sf-product-recommendation-rail border-t border-stone-200 py-6 dark:border-white/[0.08] md:py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-stone-950 dark:text-white md:text-2xl">{title}</h2>
          {subtitle ? <p className="mt-1 truncate text-xs font-bold text-stone-500 dark:text-white/55 md:text-sm">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => moveBy(-1)} disabled={!canSlide} aria-label="السابق" className="grid h-9 w-9 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:border-[#d4af37] disabled:opacity-30 dark:border-white/10 dark:bg-white/[0.055] dark:text-white"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => moveBy(1)} disabled={!canSlide} aria-label="التالي" className="grid h-9 w-9 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 shadow-sm transition hover:border-[#d4af37] disabled:opacity-30 dark:border-white/10 dark:bg-white/[0.055] dark:text-white"><ChevronLeft className="h-4 w-4" /></button>
          <Link to={href || "/products"} className="ms-1 hidden rounded-full border border-stone-200 px-3 py-2 text-xs font-black text-stone-700 transition hover:border-[#d4af37] sm:inline-flex dark:border-white/10 dark:text-white/70">{sfText("storefront.common.viewAll")}</Link>
        </div>
      </div>
      <div
        className="sf-product-recommendation-viewport overflow-hidden pb-3"
        onTouchStart={(event) => {
          touchStartXRef.current = event.touches?.[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStartXRef.current == null) return;
          const touchEndX = event.changedTouches?.[0]?.clientX ?? touchStartXRef.current;
          const distance = touchEndX - touchStartXRef.current;
          touchStartXRef.current = null;
          if (Math.abs(distance) < 45) return;
          moveBy(distance * direction > 0 ? 1 : -1);
        }}
      >
        <div
          className="sf-product-recommendation-shifter"
          style={{
            transform: `translate3d(${direction < 0 ? `-${slideOffset}` : slideOffset}, 0, 0)`,
            transition: animating ? `transform ${RAIL_SLIDE_MS}ms ease` : "none",
          }}
        >
          <div className="sf-product-recommendation-page flex touch-pan-y" style={{ gap: `${RAIL_GAP_PX}px` }}>
            {loading
              ? Array.from({ length: perView }).map((_, index) => (
                  <div key={index} style={{ flex: `0 0 ${slideBasis}` }} className="aspect-[0.72] animate-pulse bg-stone-100 dark:bg-white/5" />
                ))
              : trackItems.map((product, index) => (
                  <div key={`${productCardKey(product, index)}-${index}`} style={{ flex: `0 0 ${slideBasis}` }} className="min-w-0">
                    <RecommendationProductTile product={product} {...cardProps} saleModeEnabled={cardProps?.saleModeEnabled} />
                  </div>
                ))}
          </div>
        </div>
      </div>
      {canSlide ? <div className="mt-3 flex flex-wrap justify-center gap-1.5">{items.map((product, index) => <button key={productCardKey(product, index)} type="button" onClick={() => moveBy(index - activeDot)} aria-label={`شريحة ${index + 1}`} className={`h-1.5 rounded-full transition-all ${activeDot === index ? "w-6 bg-[#d4af37]" : "w-1.5 bg-stone-300 dark:bg-white/20"}`} />)}</div> : null}
    </section>
  );
}

function RelatedProductsContent({ currentProduct, ...props }) {
  const currentId = currentProduct?.id;
  // Relevance follows the product family — a bag sits next to bags and a sneaker
  // next to sneakers. The grade only says how good a copy is, so it used to mix
  // shoes into a bag page.
  const productType = recommendationText(currentProduct?.product_type || currentProduct?.productType || currentProduct?.type);
  const category = recommendationText(currentProduct?.category || currentProduct?.category_name || currentProduct?.categoryName);
  const brand = recommendationText(currentProduct?.brand?.name || currentProduct?.brand_name || currentProduct?.brand);
  const similarFilter = productType ? { product_type: productType } : { category: category || "__no_category__" };
  const similarHref = productType
    ? `/products?product_type=${encodeURIComponent(productType)}`
    : category
      ? `/products?category=${encodeURIComponent(category)}`
      : "/products";
  const similarResult = useProducts({ ...similarFilter, limit: 15, in_stock: 1, grouping: "product" });
  const brandResult = useProducts({ brand: brand || "__no_brand__", limit: 15, in_stock: 1, grouping: "product" });
  return (
    <div className="sf-related-products mt-5">
      <StorefrontRecommendationRail title="منتجات ذات صلة" subtitle="منتجات مشابهة مختارة لك" href={similarHref} products={similarResult.products} loading={similarResult.loading} currentId={currentId} minItems={RECOMMENDATION_RAIL_MIN_ITEMS} {...props} />
      <StorefrontRecommendationRail title={brand ? `المزيد من منتجات ${brand}` : "منتجات من نفس الماركة"} subtitle="منتجات من نفس الماركة" href={brand ? `/products?brand=${encodeURIComponent(brand)}` : "/products"} products={brandResult.products} loading={brandResult.loading} currentId={currentId} minItems={RECOMMENDATION_RAIL_MIN_ITEMS} {...props} />
    </div>
  );
}

function RelatedProducts({ currentProduct, ...props }) {
  const containerRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return undefined;
    const node = containerRef.current;
    if (!node || typeof window === "undefined") return undefined;
    if (!("IntersectionObserver" in window)) {
      const timer = window.setTimeout(() => setReady(true), 800);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setReady(true);
        observer.disconnect();
      },
      { rootMargin: "600px 0px", threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div ref={containerRef} className="sf-related-products-deferred min-h-px">
      {ready ? <RelatedProductsContent currentProduct={currentProduct} {...props} /> : null}
    </div>
  );
}

function RecentProductsSection({ currentId, recent = [], ...props }) {
  const items = useMemo(
    () => recent.filter((item) => String(item.id) !== String(currentId)).slice(0, 15),
    [currentId, recent]
  );
  if (!items.length) return null;
  return (
    <StorefrontRecommendationRail title={sfText("storefront.account.recentlyViewed")} subtitle={sfText("storefront.account.recentEmpty")} href="/recently-viewed" products={items} currentId={currentId} {...props} />
  );
}

function CheckoutPage({ cart, clearCart, profile, setProfile, themeMode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const checkoutLanguage = normalizeLanguage(i18n.language);
  const [form, setForm] = useState({
    full_name: profile.full_name || "",
    primary_phone: profile.primary_phone || "",
    email: profile.email || profile.customer_email || "",
    secondary_phone: "",
    governorate_id: "",
    governorate: "",
    city_id: "",
    city: "",
    area_id: "",
    area: "",
    zone_id: "",
    zone: "",
    district_id: "",
    district: "",
    shipping_city_id: "",
    shipping_zone_id: "",
    shipping_district_id: "",
    city_area: "",
    detailed_address: "",
    street_address: "",
    building_number: "",
    floor_number: "",
    apartment_number: "",
    landmark: "",
    delivery_notes: "",
    payment_method: "cod",
    coupon: "",
    order_notes: "",
  });
  const [shippingPaymentFile, setShippingPaymentFile] = useState(null);
  const [, setShippingPaymentPreviewUrl] = useState("");
  const [errors, setErrors] = useState({});
  const [, setCustomerTrust] = useState({ loading: false, customer: null });
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(() => {
    if (typeof window === "undefined") return 1;
    try {
      const storedStep = Number(window.sessionStorage.getItem(CHECKOUT_STEP_STORAGE_KEY));
      return [1, 2, 3].includes(storedStep) ? storedStep : 1;
    } catch {
      return 1;
    }
  });
  const [manualCityArea, setManualCityArea] = useState(false);
  const [shippingTransferMethod, setShippingTransferMethod] = useState("instapay");
  const [paymentMode, setPaymentMode] = useState("cod");
  const [showElectronicPaymentMethods, setShowElectronicPaymentMethods] = useState(false);
  const [paymentProofDragActive, setPaymentProofDragActive] = useState(false);
  const [paymentProofUploaded, setPaymentProofUploaded] = useState(false);
  const [couponValidation, setCouponValidation] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [latestAddressApplied, setLatestAddressApplied] = useState(false);
  const [latestAddressRestore, setLatestAddressRestore] = useState({ token: 0, candidate: null, status: "idle", stage: "idle" });
  const [shippingQuote, setShippingQuote] = useState(normalizeShippingQuote());
  const [shippingLocations, setShippingLocations] = useState(() => normalizeCheckoutLocations());
  const [publicStoreSettings, setPublicStoreSettings] = useState({});
  const [bostaLocations, setBostaLocations] = useState({ cities: [], zones: [], districts: [], loadingCities: false, loadingZones: false, loadingDistricts: false });
  const editedCheckoutFieldsRef = useRef(new Set());
  const latestAddressLookupsRef = useRef(new Set());
  const latestAddressRestoreTokenRef = useRef(0);
  const couponValidationKeyRef = useRef("");
  const metaCheckoutSentRef = useRef(false);
  useEffect(() => {
    setStorefrontSalePricesEnabled(publicStoreSettings);
  }, [publicStoreSettings]);
  const pricedCart = useMemo(() => cart.map((item) => ({ ...item, price: displayCartItemPrice(item) })), [cart]);
  const subtotal = pricedCart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const couponDiscount = couponValidation?.valid ? Math.max(0, Number(couponValidation.discount_amount || 0)) : 0;
  const discount = couponDiscount;
  const deliveryFee = form.governorate ? shippingQuote.price : 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);
  const codAvailable = shippingQuote.cod_allowed !== false;
  const normalizedFormPaymentMethod = paymentMode === "cod" ? "cod" : "shipping_confirmation";
  const isShippingConfirmation = paymentMode === "electronic";
  const shippingProofRequired = isShippingConfirmation;
  const hasShippingPaymentProof = Boolean(shippingPaymentFile);
  const amountDueNow = normalizedFormPaymentMethod === "cod" ? 0 : total;
  const isFinalCheckoutStep = checkoutStep === 3;
  const couponCode = String(form.coupon || "").trim().toUpperCase();
  const submitDisabled = isFinalCheckoutStep && (submitting || couponLoading || shippingQuote.loading || (shippingProofRequired && !hasShippingPaymentProof));
  const checkoutActionLabel = checkoutStep === 1
  ? t("storefront.checkout.actions.continueToAddress")
  : checkoutStep === 2
    ? t("storefront.checkout.actions.continueToPayment")
    : normalizedFormPaymentMethod === "cod"
      ? t("storefront.checkout.actions.confirmOrder")
      : shippingProofRequired
        ? t("storefront.checkout.actions.uploadProofAndConfirm")
        : t("storefront.checkout.actions.confirmOrder");
  const codAmount = normalizedFormPaymentMethod === "cod" ? total : Math.max(0, total - deliveryFee);
  const storefrontPaymentSettings = useMemo(() => normalizeStorefrontPaymentSettings(publicStoreSettings), [publicStoreSettings]);
  const locationGovernorates = useMemo(() => uniqueCheckoutLocations(shippingLocations, "governorate_id"), [shippingLocations]);
  const locationCities = useMemo(() => uniqueCheckoutLocations(shippingLocations, "city_id", (item) => !form.governorate_id || item.governorate_id === form.governorate_id), [shippingLocations, form.governorate_id]);
  const locationAreas = useMemo(() => uniqueCheckoutLocations(shippingLocations, "area_id", (item) => !form.city_id || item.city_id === form.city_id), [shippingLocations, form.city_id]);
  const bostaMode = bostaLocations.loadingCities || bostaLocations.cities.length > 0;
  const bostaCityOptions = useMemo(() => buildBostaPickerOptions(bostaLocations.cities, "city", checkoutLanguage), [bostaLocations.cities, checkoutLanguage]);
  const bostaZoneOptions = useMemo(() => buildBostaPickerOptions(bostaLocations.zones, "zone", checkoutLanguage), [bostaLocations.zones, checkoutLanguage]);
  const bostaDistrictOptions = useMemo(() => buildBostaPickerOptions(bostaLocations.districts, "district", checkoutLanguage), [bostaLocations.districts, checkoutLanguage]);
  const cityAreaOptions = governorateCityAreas[form.governorate] || [];
  const paymentTransferMethods = useMemo(() => ([
    {
      id: "instapay",
      enabled: storefrontPaymentSettings.instapay.enabled,
      label: storefrontPaymentSettings.instapay.displayName || "InstaPay",
      helperText: storefrontPaymentSettings.instapay.helperText,
      paymentUrl: storefrontPaymentSettings.instapay.paymentUrl,
      legacyHandle: storefrontPaymentSettings.instapay.handle,
      value: storefrontPaymentSettings.instapay.paymentUrl || storefrontPaymentSettings.instapay.handle,
      logoUrl: storefrontPaymentSettings.instapay.logoUrl,
      qrUrl: INSTA_PAY_QR_URL,
      deepLink: "instapay://",
    },
    {
      id: "vodafone_cash",
      enabled: storefrontPaymentSettings.vodafoneCash.enabled,
      label: storefrontPaymentSettings.vodafoneCash.displayName || "Vodafone Cash",
      helperText: storefrontPaymentSettings.vodafoneCash.helperText,
      value: storefrontPaymentSettings.vodafoneCash.number,
      logoUrl: storefrontPaymentSettings.vodafoneCash.logoUrl,
      qrUrl: VODAFONE_CASH_QR_URL,
      deepLink: "tel:*9%23",
    },
  ]), [storefrontPaymentSettings]);
  const visibleTransferMethods = paymentTransferMethods.filter((method) => method.enabled && (method.id !== "instapay" || method.paymentUrl || method.legacyHandle));
  const activeTransferMethod = visibleTransferMethods.find((method) => method.id === shippingTransferMethod) || visibleTransferMethods[0] || null;
  const activeTransferValue = activeTransferMethod?.value || "";
  const activeTransferPaymentUrl = activeTransferMethod?.paymentUrl || "";
  const checkoutSummaryHelpers = useMemo(() => ({
    displayCartItemComparePrice,
    fallbackProductImage,
    imageFor,
    money,
  }), []);
  const checkoutSummaryComponents = useMemo(() => ({
    SummaryRow,
    SubmitButton,
    TrustPills,
  }), []);

  useEffect(() => {
    if (pricedCart.length) trackGa4BeginCheckout(pricedCart, { value: subtotal });
  }, [pricedCart, subtotal]);

  useEffect(() => {
    if (checkoutStep !== 3 || metaCheckoutSentRef.current || !pricedCart.length) return;
    const payload = trackMetaInitiateCheckout({
      items: pricedCart,
      value: total,
      customer: {
        ...profile,
        full_name: form.full_name,
        phone: form.primary_phone,
        email: form.email,
        city: form.city || form.city_area || form.area || form.district,
        state: form.governorate,
      },
    });
    if (payload) metaCheckoutSentRef.current = true;
  }, [checkoutStep, form, pricedCart, profile, total]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.style.setProperty("--checkout-sticky-actions-height", "88px");
    return () => {
      document.documentElement.style.setProperty("--checkout-sticky-actions-height", "0px");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get("/settings/public", {
      suppressErrorStatuses: [404, 500],
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    })
      .then((data) => {
        if (cancelled) return;
        const { settings, rawSaleModeEnabled } = extractPublicStorefrontSettings(data);
        const parsedSaleModeEnabled = parseSaleModeEnabled(rawSaleModeEnabled, false);
        const normalizedSettings = {
          ...settings,
          sale_mode_enabled: parsedSaleModeEnabled,
        };
        setShippingLocations(normalizeCheckoutLocations(normalizedSettings["storefront.shipping_locations"]));
        setPublicStoreSettings(normalizedSettings);
        storefrontPublicSaleModeEnabledRaw = rawSaleModeEnabled;
        console.debug("[payment-settings:loaded]", {
          instapay_enabled: Boolean(normalizedSettings["storefront.payment_methods.instapay_enabled"] ?? normalizedSettings["payments.instapay_enabled"]),
          vodafone_cash_enabled: Boolean(normalizedSettings["storefront.payment_methods.vodafone_cash_enabled"] ?? normalizedSettings["payments.vodafone_cash_enabled"]),
          shipping_confirmation_enabled: Boolean(normalizedSettings["storefront.payment_methods.shipping_confirmation_enabled"] ?? true),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    console.debug("[checkout:payment-settings-applied]", {
      instapay_enabled: storefrontPaymentSettings.instapay.enabled,
      vodafone_cash_enabled: storefrontPaymentSettings.vodafoneCash.enabled,
      shipping_confirmation_enabled: storefrontPaymentSettings.shippingConfirmation.enabled,
      shipping_confirmation_amount: storefrontPaymentSettings.shippingConfirmation.amount,
    });
    if (storefrontPaymentSettings.instapay.paymentUrl) {
      console.debug("[checkout:instapay-payment-link-applied]", {
        payment_url: storefrontPaymentSettings.instapay.paymentUrl,
      });
    } else if (storefrontPaymentSettings.instapay.handle) {
      console.debug("[checkout:instapay-legacy-handle-fallback]", {
        handle: storefrontPaymentSettings.instapay.handle,
      });
    }
  }, [storefrontPaymentSettings]);

  useEffect(() => {
    if (!visibleTransferMethods.length) return;
    if (visibleTransferMethods.some((method) => method.id === shippingTransferMethod)) return;
    setShippingTransferMethod(visibleTransferMethods[0].id);
  }, [shippingTransferMethod, visibleTransferMethods]);

  useEffect(() => {
    if (paymentMode !== "electronic") return;
    const nextPaymentMethod = visibleTransferMethods.some((method) => method.id === shippingTransferMethod)
      ? shippingTransferMethod
      : (visibleTransferMethods[0]?.id || "instapay");
    setForm((current) => (current.payment_method === nextPaymentMethod ? current : { ...current, payment_method: nextPaymentMethod }));
  }, [paymentMode, shippingTransferMethod, visibleTransferMethods, setForm]);

  useEffect(() => {
    let cancelled = false;
    setBostaLocations((prev) => ({ ...prev, loadingCities: true }));
    api.get("/shipping/cities?provider=bosta&dropoff=1", { suppressErrorStatuses: [404, 500] })
      .then((data) => {
        if (!cancelled) setBostaLocations((prev) => ({ ...prev, cities: Array.isArray(data.cities) ? data.cities : [], loadingCities: false }));
      })
      .catch(() => {
        if (!cancelled) setBostaLocations((prev) => ({ ...prev, cities: [], loadingCities: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bostaMode || !form.shipping_city_id) {
      setBostaLocations((prev) => ({ ...prev, zones: [], districts: [], loadingZones: false, loadingDistricts: false }));
      return undefined;
    }
    let cancelled = false;
    setBostaLocations((prev) => ({ ...prev, zones: [], districts: [], loadingZones: true, loadingDistricts: false }));
    api.get(`/shipping/zones?provider=bosta&dropoff=1&cityId=${encodeURIComponent(form.shipping_city_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => {
        if (!cancelled) setBostaLocations((prev) => ({ ...prev, zones: Array.isArray(data.zones) ? data.zones : [], districts: [], loadingZones: false }));
      })
      .catch(() => {
        if (!cancelled) setBostaLocations((prev) => ({ ...prev, zones: [], districts: [], loadingZones: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [bostaMode, form.shipping_city_id]);

  useEffect(() => {
    if (!bostaMode || !form.shipping_zone_id) {
      setBostaLocations((prev) => ({ ...prev, districts: [], loadingDistricts: false }));
      return undefined;
    }
    let cancelled = false;
    setBostaLocations((prev) => ({ ...prev, districts: [], loadingDistricts: true }));
    api.get(`/shipping/districts?provider=bosta&dropoff=1&zoneId=${encodeURIComponent(form.shipping_zone_id)}`, { suppressErrorStatuses: [404, 500] })
      .then((data) => {
        if (!cancelled) setBostaLocations((prev) => ({ ...prev, districts: Array.isArray(data.districts) ? data.districts : [], loadingDistricts: false }));
      })
      .catch(() => {
        if (!cancelled) setBostaLocations((prev) => ({ ...prev, districts: [], loadingDistricts: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [bostaMode, form.shipping_zone_id]);

  useEffect(() => {
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) setSubmitting(false);
    });
    return () => {
      cancelled = true;
    };
  }, [checkoutStep]);

  useEffect(() => {
    safeSetSessionStorage(CHECKOUT_STEP_STORAGE_KEY, String(checkoutStep), { raw: true });
  }, [checkoutStep]);

  useEffect(() => {
    if (!form.governorate) {
      setShippingQuote(normalizeShippingQuote());
      return undefined;
    }
    let cancelled = false;
    setShippingQuote((prev) => ({ ...prev, loading: true }));
    const params = new URLSearchParams({
      governorate: form.governorate,
      city: form.city || form.city_area || "",
      area: form.area || form.city_area || "",
      governorate_id: form.governorate_id || "",
      city_id: form.city_id || "",
      area_id: form.area_id || "",
      district_id: form.district_id || "",
      zone_id: form.zone_id || "",
      subtotal: String(subtotal),
    });
    api
      .get(`/storefront/shipping/quote?${params.toString()}`)
      .then((data) => {
        const quote = normalizeShippingQuote(data.quote || data);
        if (import.meta.env.DEV) {
          console.debug("[storefront-shipping-quote]", {
            governorate: form.governorate,
            city_area: form.city_area,
            subtotal,
            match_level: quote.match_level,
            zone: quote.zone,
            price: quote.price,
            free_shipping_applied: quote.free_shipping_applied,
          });
        }
        if (!cancelled) setShippingQuote(quote);
      })
      .catch(() => {
        if (!cancelled) setShippingQuote((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [form.governorate, form.city_area, form.governorate_id, form.city_id, form.area_id, form.city, form.area, form.district_id, form.zone_id, subtotal]);

  const setField = (key, value, options = {}) => {
    if (options.markDirty !== false) editedCheckoutFieldsRef.current.add(key);
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    if (key === "coupon") {
      setCouponValidation(null);
      couponValidationKeyRef.current = "";
    }
  };

  useEffect(() => {
    if (!couponValidation) return;
    const validationKey = `${couponCode}::${Math.max(0, subtotal + deliveryFee).toFixed(2)}`;
    if (couponValidationKeyRef.current !== validationKey) {
      setCouponValidation(null);
      couponValidationKeyRef.current = "";
    }
  }, [couponValidation, couponCode, subtotal, deliveryFee]);

  const applyCoupon = async ({ silent = false } = {}) => {
    const trimmedCode = String(form.coupon || "").trim().toUpperCase();
    if (!trimmedCode) {
      setCouponValidation(null);
      if (!silent) toast.error(couponErrorText("Coupon code is required"));
      return null;
    }
    setCouponLoading(true);
    try {
      const response = await api.post("/coupons/validate", {
        code: trimmedCode,
        orderTotal: Math.max(0, subtotal + deliveryFee),
        source: "website",
        customerId: profile?.customer_id || profile?.id || null,
      });
      if (!response?.valid) {
        setCouponValidation(null);
        if (!silent) toast.error(couponErrorText(response?.reason || response?.message));
        return null;
      }
      setCouponValidation(response);
      couponValidationKeyRef.current = `${trimmedCode}::${Math.max(0, subtotal + deliveryFee).toFixed(2)}`;
      if (!silent) toast.success(sfText("storefront.checkout.couponApplied"));
      return response;
    } catch (error) {
      setCouponValidation(null);
      const reason = error?.responseBody?.reason || error?.responseBody?.message || error?.message;
      if (!silent) toast.error(couponErrorText(reason));
      return null;
    } finally {
      setCouponLoading(false);
    }
  };

  const setGovernorate = (value, options = {}) => {
    if (options.markDirty !== false) {
      editedCheckoutFieldsRef.current.add("governorate");
      editedCheckoutFieldsRef.current.add("city_area");
    }
    setManualCityArea(false);
    const selected = shippingLocations.find((location) => location.governorate_id === value);
    if (selected) {
      setForm((prev) => ({
        ...prev,
        governorate_id: selected.governorate_id,
        governorate: selected.governorate_name_ar || selected.governorate_name_en,
        city_id: "",
        city: "",
        area_id: "",
        area: "",
        city_area: "",
      }));
    } else {
      setForm((prev) => ({ ...prev, governorate_id: "", governorate: value, city_id: "", city: "", area_id: "", area: "", city_area: "" }));
    }
    setErrors((prev) => ({ ...prev, governorate: "", city_area: "" }));
  };

  const setCityArea = (value, options = {}) => {
    if (options.markDirty !== false) editedCheckoutFieldsRef.current.add("city_area");
    if (value === MANUAL_CITY_AREA_LABEL) {
      setManualCityArea(true);
      setForm((prev) => ({ ...prev, city_id: "", city: "", area_id: "", area: "", city_area: "" }));
      return;
    }
    const selectedCity = shippingLocations.find((location) => location.city_id === value);
    if (selectedCity) {
      setManualCityArea(false);
      setForm((prev) => ({
        ...prev,
        governorate_id: selectedCity.governorate_id,
        governorate: selectedCity.governorate_name_ar || selectedCity.governorate_name_en,
        city_id: selectedCity.city_id,
        city: selectedCity.city_name_ar || selectedCity.city_name_en,
        area_id: "",
        area: "",
        city_area: selectedCity.city_name_ar || selectedCity.city_name_en,
      }));
      setErrors((prev) => ({ ...prev, city_area: "" }));
      return;
    }
    const selectedArea = shippingLocations.find((location) => location.area_id === value);
    if (selectedArea) {
      setManualCityArea(false);
      setForm((prev) => ({
        ...prev,
        governorate_id: selectedArea.governorate_id,
        governorate: selectedArea.governorate_name_ar || selectedArea.governorate_name_en,
        city_id: selectedArea.city_id,
        city: selectedArea.city_name_ar || selectedArea.city_name_en,
        area_id: selectedArea.area_id,
        area: selectedArea.area_name_ar || selectedArea.area_name_en,
        city_area: selectedArea.area_name_ar || selectedArea.area_name_en,
      }));
      setErrors((prev) => ({ ...prev, city_area: "" }));
      return;
    }
    setManualCityArea(false);
    setField("city_area", value);
  };

  const setBostaCity = useCallback((value, options = {}) => {
    if (options.markDirty !== false) {
      editedCheckoutFieldsRef.current.add("governorate");
      editedCheckoutFieldsRef.current.add("city_area");
    }
    const selected = bostaLocations.cities.find((city) => {
      const cityIds = [
        city.id,
        city.value,
        city.city_id,
        city.provider_city_id,
        city.governorate_id,
        city.provider_governorate_id,
      ].map((item) => String(item || "").trim()).filter(Boolean);
      return cityIds.some((item) => String(item) === String(value));
    });
    setForm((prev) => ({
      ...prev,
      governorate_id: selected?.provider_city_id || "",
      governorate: selected?.name_ar || selected?.name_en || "",
      city_id: selected?.provider_city_id || "",
      city: selected?.name_ar || selected?.name_en || "",
      city_area: selected?.name_ar || selected?.name_en || "",
      shipping_city_id: selected?.id ? String(selected.id) : "",
      zone_id: "",
      zone: "",
      shipping_zone_id: "",
      area_id: "",
      area: "",
      district_id: "",
      district: "",
      shipping_district_id: "",
    }));
    setErrors((prev) => ({ ...prev, governorate: "", city_area: "" }));
  }, [bostaLocations.cities]);

  const setBostaZone = useCallback((value, options = {}) => {
    if (options.markDirty !== false) {
      editedCheckoutFieldsRef.current.add("city_area");
    }
    const selected = bostaLocations.zones.find((zone) => {
      const zoneIds = [
        zone.id,
        zone.value,
        zone.zoneId,
        zone.provider_zone_id,
        zone.provider_district_id,
        zone.district_id,
      ].map((item) => String(item || "").trim()).filter(Boolean);
      return zoneIds.some((item) => String(item) === String(value));
    });
    setForm((prev) => ({
      ...prev,
      zone_id: selected?.provider_zone_id || "",
      zone: selected?.name_ar || selected?.name_en || "",
      shipping_zone_id: selected?.id ? String(selected.id) : "",
      area_id: "",
      area: "",
      district_id: "",
      district: "",
      shipping_district_id: "",
    }));
    setErrors((prev) => ({ ...prev, city_area: "" }));
  }, [bostaLocations.zones]);

  const setBostaDistrict = useCallback((value, options = {}) => {
    if (options.markDirty !== false) {
      editedCheckoutFieldsRef.current.add("city_area");
    }
    const selected = matchBostaPickerOption(bostaDistrictOptions, { shipping_district_id: value, district_id: value, bosta_district_id: value });
    setForm((prev) => ({
      ...prev,
      area_id: selected?.districtId || selected?.raw?.provider_district_id || selected?.raw?.district_id || selected?.id || "",
      area: selected?.nameAr || selected?.nameEn || selected?.name || "",
      district_id: selected?.districtId || selected?.raw?.provider_district_id || selected?.raw?.district_id || selected?.id || "",
      district: selected?.nameAr || selected?.nameEn || selected?.name || "",
      city_area: selected?.nameAr || selected?.nameEn || selected?.name || prev.city_area,
      shipping_district_id: selected?.id ? String(selected.id) : String(value || ""),
    }));
    setErrors((prev) => ({ ...prev, city_area: "" }));
  }, [bostaDistrictOptions]);

  useEffect(() => {
    const phone = form.primary_phone.replace(/\s/g, "");
    if (!/^01[0125][0-9]{8}$/.test(phone)) {
      let cancelled = false;
      deferReactState(() => {
        if (!cancelled) setCustomerTrust({ loading: false, customer: null });
      });
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) setCustomerTrust((prev) => ({ ...prev, loading: true }));
    });
    const params = new URLSearchParams();
    params.set("phone", phone);
    if (String(profile.email || profile.customer_email || "").trim()) {
      params.set("email", String(profile.email || profile.customer_email || "").trim().toLowerCase());
    }
    api
      .get(`/storefront/customers/latest-shipping-address?${params.toString()}`)
      .then((data) => {
        if (!cancelled) {
          const address = data.address || null;
          setCustomerTrust({ loading: false, customer: address });
        }
      })
      .catch(() => {
        if (!cancelled) setCustomerTrust({ loading: false, customer: null });
      });
    return () => {
      cancelled = true;
    };
  }, [form.primary_phone, profile.customer_email, profile.email]);

  useEffect(() => {
    if (checkoutStep !== 2) return undefined;
    const cleanPhone = form.primary_phone.replace(/\D/g, "");
    const validPhone = /^01[0125][0-9]{8}$/.test(cleanPhone);
    const email = String(profile.email || profile.customer_email || "").trim().toLowerCase();
    if (!validPhone && !email) return undefined;

    const lookupKey = validPhone ? `phone:${cleanPhone}` : `email:${email}`;
    if (latestAddressLookupsRef.current.has(lookupKey)) return undefined;
    latestAddressLookupsRef.current.add(lookupKey);

    const params = new URLSearchParams();
    if (validPhone) params.set("phone", cleanPhone);
    if (email) params.set("email", email);

    let cancelled = false;
    api
      .get(`/storefront/customers/latest-shipping-address?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const address = data.address || null;
        if (!address) {
          console.info("[checkout:last-address-restore-skipped]", { reason: "no_address_found", lookupKey });
          return;
        }
        console.info("[checkout:last-address-found]", {
          lookupKey,
          hasBosta: Boolean(address.shipping_city_id || address.shipping_zone_id || address.shipping_district_id),
          hasTextAddress: Boolean(address.detailed_address || address.street_address),
        });

        if (CHECKOUT_ADDRESS_FIELDS.some((key) => editedCheckoutFieldsRef.current.has(key))) {
          console.info("[checkout:last-address-restore-skipped]", { reason: "manual_edit_detected", lookupKey });
          return;
        }

        const token = latestAddressRestoreTokenRef.current + 1;
        latestAddressRestoreTokenRef.current = token;
        setLatestAddressApplied(false);
        setLatestAddressRestore({ token, candidate: address, status: "restoring", stage: "governorate" });
        console.info("[checkout:last-address-restore-start]", { token, lookupKey });

        const restoredValues = {
          full_name: String(address.customer_name || "").trim(),
          primary_phone: String(address.phone || "").trim(),
          governorate: String(address.governorate || address.province || "").trim(),
          city_area: String(address.city_area || address.city || address.area || "").trim(),
          detailed_address: String(address.detailed_address || address.address || "").trim(),
          street_address: String(address.street_address || address.detailed_address || address.address || "").trim(),
          building_number: String(address.building_number || "").trim(),
          floor_number: String(address.floor_number || "").trim(),
          apartment_number: String(address.apartment_number || "").trim(),
          landmark: String(address.landmark || "").trim(),
          delivery_notes: String(address.delivery_notes || "").trim(),
          governorate_id: String(address.governorate_id || "").trim(),
          city_id: String(address.city_id || "").trim(),
          area_id: String(address.area_id || "").trim(),
          zone_id: String(address.zone_id || "").trim(),
          district_id: String(address.district_id || address.bosta_district_id || address.shipping_district_id || "").trim(),
          shipping_city_id: String(address.shipping_city_id || "").trim(),
          shipping_zone_id: String(address.shipping_zone_id || "").trim(),
          shipping_district_id: String(address.shipping_district_id || address.bosta_district_id || address.district_id || "").trim(),
        };

        setForm((prev) => {
          const next = { ...prev };
          Object.entries(restoredValues).forEach(([key, value]) => {
            if (String(value || "").trim()) {
              next[key] = value;
            }
          });
          return next;
        });
        setErrors((prev) => {
          const next = { ...prev };
          CHECKOUT_ADDRESS_FIELDS.forEach((key) => {
            delete next[key];
          });
          return next;
        });

        if (!restoredValues.shipping_city_id) {
          setLatestAddressApplied(true);
          setLatestAddressRestore({ token, candidate: address, status: "done", stage: "done" });
          console.info("[checkout:last-address-restore-success]", { token, mode: "text-only" });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[checkout:last-address-restore-failed]", { lookupKey, message: error?.message || error?.responseBody?.message || "Unknown error" });
      });

    return () => {
      cancelled = true;
    };
  }, [checkoutStep, form.primary_phone, profile.email, profile.customer_email]);

  useEffect(() => {
    const candidate = latestAddressRestore.candidate;
    if (!candidate || latestAddressRestore.status !== "restoring" || latestAddressRestore.stage !== "governorate") return undefined;
    if (checkoutStep !== 2) return undefined;
    if (CHECKOUT_ADDRESS_FIELDS.some((key) => editedCheckoutFieldsRef.current.has(key))) {
      console.info("[checkout:last-address-restore-skipped]", { reason: "manual_edit_detected", token: latestAddressRestore.token });
      setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, status: "skipped", stage: "idle" } : prev));
      return undefined;
    }
    if (!candidate.shipping_city_id) return undefined;
    if (bostaLocations.loadingCities) return undefined;
    const cityOption = bostaCityOptions.find((option) => String(option.id) === String(candidate.shipping_city_id));
    if (!cityOption) {
      console.info("[checkout:last-address-restore-skipped]", { reason: "city_options_not_ready", token: latestAddressRestore.token });
      setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, status: "skipped", stage: "idle" } : prev));
      return undefined;
    }
    console.info("[checkout:last-address-bosta-governorate-restored]", {
      token: latestAddressRestore.token,
      governorate_id: cityOption.id,
      governorate: cityOption.label,
    });
    setBostaCity(cityOption.id, { markDirty: false });
    setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, stage: "zone" } : prev));
    return undefined;
  }, [bostaCityOptions, bostaLocations.loadingCities, checkoutStep, latestAddressRestore, setBostaCity]);

  useEffect(() => {
    const candidate = latestAddressRestore.candidate;
    if (!candidate || latestAddressRestore.status !== "restoring" || latestAddressRestore.stage !== "zone") return undefined;
    if (checkoutStep !== 2) return undefined;
    if (CHECKOUT_ADDRESS_FIELDS.some((key) => editedCheckoutFieldsRef.current.has(key))) {
      console.info("[checkout:last-address-restore-skipped]", { reason: "manual_edit_detected", token: latestAddressRestore.token });
      setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, status: "skipped", stage: "idle" } : prev));
      return undefined;
    }
    if (!candidate.shipping_zone_id) {
      setLatestAddressApplied(true);
      setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, status: "done", stage: "done" } : prev));
      console.info("[checkout:last-address-restore-success]", { token: latestAddressRestore.token, mode: "bosta-city-only" });
      return undefined;
    }
    if (bostaLocations.loadingZones) return undefined;
    const zoneOption = bostaZoneOptions.find((option) => String(option.id) === String(candidate.shipping_zone_id));
    if (!zoneOption) {
      console.info("[checkout:last-address-restore-skipped]", { reason: "zone_options_not_ready", token: latestAddressRestore.token });
      setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, status: "skipped", stage: "idle" } : prev));
      return undefined;
    }
    console.info("[checkout:last-address-bosta-zone-restored]", {
      token: latestAddressRestore.token,
      zone_id: zoneOption.id,
      zone: zoneOption.label,
    });
    setBostaZone(zoneOption.id, { markDirty: false });
    setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, stage: "district" } : prev));
    return undefined;
  }, [bostaLocations.loadingZones, bostaZoneOptions, checkoutStep, latestAddressRestore, setBostaZone]);

  useEffect(() => {
    const candidate = latestAddressRestore.candidate;
    if (!candidate || latestAddressRestore.status !== "restoring" || latestAddressRestore.stage !== "district") return undefined;
    if (checkoutStep !== 2) return undefined;
    const districtSource = {
      shipping_district_id: candidate.shipping_district_id,
      bosta_district_id: candidate.bosta_district_id,
      district_id: candidate.district_id,
      district: candidate.district,
      district_name: candidate.district_name,
      district_name_ar: candidate.district_name_ar,
      district_name_en: candidate.district_name_en,
      area: candidate.area,
      area_name: candidate.area_name,
      area_name_ar: candidate.area_name_ar,
      area_name_en: candidate.area_name_en,
      city_area: candidate.city_area,
      provider_district_id: candidate.provider_district_id,
    };
    console.info("[checkout:last-address-district-source]", {
      token: latestAddressRestore.token,
      source: districtSource,
    });
    if (!districtSource.shipping_district_id && !districtSource.bosta_district_id && !districtSource.district_id && !districtSource.district && !districtSource.district_name && !districtSource.district_name_ar && !districtSource.district_name_en && !districtSource.area && !districtSource.area_name && !districtSource.area_name_ar && !districtSource.area_name_en && !districtSource.city_area) {
      setLatestAddressApplied(true);
      setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, status: "done", stage: "done" } : prev));
      console.info("[checkout:last-address-restore-success]", { token: latestAddressRestore.token, mode: "bosta-city-zone" });
      return undefined;
    }
    console.info("[checkout:last-address-district-options-loaded]", {
      token: latestAddressRestore.token,
      loading: bostaLocations.loadingDistricts,
      optionsCount: bostaDistrictOptions.length,
    });
    if (bostaLocations.loadingDistricts || !bostaDistrictOptions.length) return undefined;
    const districtOption = matchBostaPickerOption(bostaDistrictOptions, districtSource);
    if (!districtOption) {
      console.info("[checkout:last-address-district-match-missing]", {
        token: latestAddressRestore.token,
        source: districtSource,
        optionsCount: bostaDistrictOptions.length,
      });
      return undefined;
    }
    console.info("[checkout:last-address-district-match-found]", {
      token: latestAddressRestore.token,
      option: {
        id: districtOption.id,
        value: districtOption.value,
        districtId: districtOption.districtId,
        label: districtOption.label,
        name: districtOption.name,
        nameAr: districtOption.nameAr,
        nameEn: districtOption.nameEn,
      },
    });
    console.info("[checkout:last-address-bosta-district-restored]", {
      token: latestAddressRestore.token,
      district_id: districtOption.id,
      district: districtOption.label,
    });
    setBostaDistrict(districtOption.id, { markDirty: false });
    setLatestAddressApplied(true);
    setLatestAddressRestore((prev) => (prev.token === latestAddressRestore.token ? { ...prev, status: "done", stage: "done" } : prev));
    console.info("[checkout:last-address-restore-success]", { token: latestAddressRestore.token, mode: "bosta-city-zone-district" });
    return undefined;
  }, [bostaDistrictOptions, bostaLocations.loadingDistricts, checkoutStep, latestAddressRestore, setBostaDistrict]);

  const useNewAddress = useCallback(() => {
    console.info("[checkout:last-address-restore-skipped]", { reason: "user_requested_new_address" });
    latestAddressRestoreTokenRef.current += 1;
    latestAddressLookupsRef.current.clear();
    editedCheckoutFieldsRef.current = new Set();
    setLatestAddressApplied(false);
    setLatestAddressRestore({ token: latestAddressRestoreTokenRef.current, candidate: null, status: "idle", stage: "idle" });
    setManualCityArea(false);
    setForm((prev) => ({
      ...prev,
      governorate_id: "",
      governorate: "",
      city_id: "",
      city: "",
      area_id: "",
      area: "",
      zone_id: "",
      zone: "",
      district_id: "",
      district: "",
      shipping_city_id: "",
      shipping_zone_id: "",
      shipping_district_id: "",
      city_area: "",
      detailed_address: "",
      street_address: "",
      building_number: "",
      floor_number: "",
      apartment_number: "",
      landmark: "",
      delivery_notes: "",
    }));
    setErrors((prev) => {
      const next = { ...prev };
      [
        "governorate",
        "city_area",
        "detailed_address",
        "street_address",
        "building_number",
        "floor_number",
        "apartment_number",
        "landmark",
        "delivery_notes",
      ].forEach((key) => {
        delete next[key];
      });
      return next;
    });
    setShippingQuote(normalizeShippingQuote());
  }, []);

  useEffect(() => {
    const normalizedPaymentMethod = normalizeCheckoutPaymentMethod(form.payment_method);
    if (normalizedPaymentMethod === "cod") {
      if (paymentMode !== "cod") setPaymentMode("cod");
      if (showElectronicPaymentMethods) setShowElectronicPaymentMethods(false);
    } else if (paymentMode !== "electronic") {
      setPaymentMode("electronic");
    }
    return undefined;
  }, [codAvailable, form.payment_method, paymentMode, showElectronicPaymentMethods]);

  useEffect(() => {
    if (!shippingProofRequired) {
      let cancelled = false;
      deferReactState(() => {
        if (cancelled) return;
        setShippingPaymentFile(null);
        setErrors((prev) => ({ ...prev, shipping_payment_screenshot: "" }));
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [shippingProofRequired]);

  useEffect(() => {
    if (!shippingPaymentFile) {
      let cancelled = false;
      deferReactState(() => {
        if (!cancelled) {
          setShippingPaymentPreviewUrl("");
          setPaymentProofUploaded(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const previewUrl = URL.createObjectURL(shippingPaymentFile);
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) {
        setShippingPaymentPreviewUrl(previewUrl);
        setPaymentProofUploaded(true);
      }
    });

    return () => {
      cancelled = true;
      URL.revokeObjectURL(previewUrl);
    };
  }, [shippingPaymentFile]);

  const validateStep = (step = checkoutStep, options = {}) => {
    const { showToast = true } = options;
    const next = {};
    const stepKeys = step === 1
      ? ["full_name", "primary_phone", "email"]
      : step === 2
        ? ["governorate", "city_area", "detailed_address", "street_address", "building_number"]
        : ["payment_method", "shipping_payment_screenshot"];
    const phone = form.primary_phone.replace(/\s/g, "");
    const composedAddress = [
      form.street_address || form.detailed_address,
      form.building_number ? `Building ${form.building_number}` : "",
      form.floor_number ? `Floor ${form.floor_number}` : "",
      form.apartment_number ? `Apartment ${form.apartment_number}` : "",
      form.landmark ? `Near ${form.landmark}` : "",
    ].filter(Boolean).join(", ");

    if (step === 1) {
      if (!form.full_name.trim()) next.full_name = sfText("storefront.validation.fullNameRequired");
      if (!phone) next.primary_phone = sfText("storefront.validation.phoneRequired");
      else if (!/^01[0125][0-9]{8}$/.test(phone)) next.primary_phone = sfText("storefront.validation.invalidEgyptPhone");
      if (form.email.trim() && !isValidSurveyEmail(form.email)) {
        next.email = "يرجى إدخال بريد إلكتروني صحيح أو ترك الحقل فارغًا.";
      }
    }

    if (step === 2) {
      if (!form.governorate) next.governorate = sfText("storefront.validation.governorateRequired");
      if (bostaMode && (!form.shipping_city_id || !form.shipping_zone_id || !form.shipping_district_id)) next.city_area = sfText("storefront.validation.cityAreaRequired");
      else if (!form.city_area.trim()) next.city_area = manualCityArea ? sfText("storefront.validation.cityAreaManualRequired") : sfText("storefront.validation.cityAreaRequired");
      if (!form.detailed_address.trim()) next.detailed_address = sfText("storefront.validation.addressRequired");
      else if (bostaMode && composedAddress.trim().length < 12) next.detailed_address = sfText("storefront.validation.addressRequired");
      if (bostaMode && !form.street_address.trim()) next.street_address = sfText("storefront.validation.streetAddressRequired");
      if (bostaMode && !form.building_number.trim()) next.building_number = sfText("storefront.validation.buildingNumberRequired");
    }

    if (step === 3) {
      if (!form.payment_method) next.payment_method = sfText("storefront.validation.paymentMethodRequired");
      if (shippingProofRequired && !shippingPaymentFile) {
        next.shipping_payment_screenshot = sfText("storefront.validation.transferProofRequired");
      }
    }

    setErrors((prev) => {
      const cleared = { ...prev };
      stepKeys.forEach((key) => {
        delete cleared[key];
      });
      return { ...cleared, ...next };
    });
    if (showToast && Object.keys(next).length) toast.error(sfText("storefront.toasts.completeRequiredData"));
    if (showToast && next.shipping_payment_screenshot) toast.error(sfText("storefront.toasts.uploadTransferProof"));
    return !Object.keys(next).length;
  };

  const validate = () => {
    let valid = true;
    let firstInvalidStep = null;
    [1, 2, 3].forEach((step) => {
      if (!validateStep(step, { showToast: false })) {
        valid = false;
        firstInvalidStep ||= step;
      }
    });
    if (!valid) {
      if (firstInvalidStep) goToCheckoutStep(firstInvalidStep);
      toast.error(sfText("storefront.toasts.completeRequiredData"));
      if (firstInvalidStep === 3 && shippingProofRequired && !shippingPaymentFile) toast.error(sfText("storefront.toasts.uploadTransferProof"));
    }
    return valid;
  };

  const goToCheckoutStep = (step) => {
    setSubmitting(false);
    setCheckoutStep(step);
    setSummaryOpen(false);
  };

  const handlePaymentProofChange = (file) => {
    if (!file) {
      setShippingPaymentFile(null);
      setPaymentProofUploaded(false);
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error(sfText("storefront.toasts.invalidTransferProof"));
      setShippingPaymentFile(null);
      setPaymentProofUploaded(false);
      return;
    }
    if (Number(file.size || 0) < 5 * 1024) {
      toast.error(sfText("storefront.toasts.invalidTransferProof"));
      setShippingPaymentFile(null);
      setPaymentProofUploaded(false);
      return;
    }
    setErrors((prev) => ({ ...prev, shipping_payment_screenshot: "" }));
    setShippingPaymentFile(file);
  };

  const handlePaymentProofDrop = (event) => {
    event.preventDefault();
    setPaymentProofDragActive(false);
    handlePaymentProofChange(event.dataTransfer?.files?.[0]);
  };

  const removePaymentProof = () => {
    setShippingPaymentFile(null);
    setPaymentProofUploaded(false);
    setErrors((prev) => ({ ...prev, shipping_payment_screenshot: "" }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!isFinalCheckoutStep) {
      if (validateStep(checkoutStep)) {
        if (checkoutStep === 2) {
          trackGa4ShippingInfo(pricedCart, {
            value: total,
            coupon: couponValidation?.valid ? couponCode : "",
            shipping: deliveryFee,
            shipping_tier: shippingQuote.provider || shippingQuote.provider_id || "standard",
          });
        }
        goToCheckoutStep(Math.min(3, checkoutStep + 1));
      }
      return;
    }
    if (submitting || !validate()) {
      setSubmitting(false);
      return;
    }
    setSubmitting(true);
    try {
      const activeCouponCode = String(form.coupon || "").trim().toUpperCase();
      const currentCouponKey = `${activeCouponCode}::${Math.max(0, subtotal + deliveryFee).toFixed(2)}`;
      let activeCouponValidation = couponValidation;
      if (activeCouponCode && couponValidationKeyRef.current !== currentCouponKey) {
        activeCouponValidation = await applyCoupon();
        if (!activeCouponValidation?.valid) {
          setSubmitting(false);
          return;
        }
      }
      const couponCodeToSend = activeCouponValidation?.valid ? String(activeCouponValidation.coupon?.code || activeCouponCode).trim().toUpperCase() : "";
      const couponDiscountToSend = activeCouponValidation?.valid ? Math.max(0, Number(activeCouponValidation.discount_amount || 0)) : 0;
      const cleanPhone = form.primary_phone.replace(/\s/g, "");
      const paymentMethod = paymentMode === "cod" ? "cod" : (visibleTransferMethods.some((method) => method.id === shippingTransferMethod) ? shippingTransferMethod : (visibleTransferMethods[0]?.id || "instapay"));
      const shippingPaymentMethod = paymentMode === "cod" ? "" : paymentMethod;
      const paidAmount = amountDueNow;
      const selectedShippingProvider = bostaMode && form.shipping_city_id ? "bosta" : (shippingQuote.provider_id || shippingQuote.provider || "in_store_delivery");
      const shippingProviderAddress = {
        country: "EG",
        country_code: "EG",
        governorate_id: form.governorate_id,
        governorate: form.governorate,
        city_id: form.city_id,
        city: form.city || form.city_area,
        area_id: form.area_id,
        district_id: form.district_id || shippingQuote.district_id || shippingQuote.zone?.district_id || "",
        zone_id: form.zone_id || shippingQuote.zone_id || shippingQuote.zone?.zone_id || "",
        shipping_city_id: form.shipping_city_id,
        shipping_zone_id: form.shipping_zone_id,
        shipping_district_id: form.shipping_district_id,
        provider_city_id: shippingQuote.zone?.provider_city_id || "",
        provider_district_id: shippingQuote.zone?.provider_district_id || "",
        provider_zone_id: shippingQuote.zone?.provider_zone_id || "",
        area: form.area || form.city_area,
        street_address: form.street_address || form.detailed_address,
        building_number: form.building_number,
        floor_number: form.floor_number,
        apartment_number: form.apartment_number,
        landmark: form.landmark,
        notes: form.delivery_notes,
      };
      const checkoutPayload = {
        ...form,
        payment_method: paymentMethod,
        payment_type: paymentMethod,
        primary_phone: cleanPhone,
        delivery_fee: deliveryFee,
        shipping_fee: deliveryFee,
        shipping_cost: deliveryFee,
        shipping_provider: selectedShippingProvider,
        shipping_provider_id: selectedShippingProvider,
        governorate_id: form.governorate_id || shippingQuote.governorate_id || shippingQuote.zone?.governorate_id || "",
        city_id: form.city_id || shippingQuote.city_id || shippingQuote.zone?.city_id || "",
        area_id: form.area_id || shippingQuote.area_id || shippingQuote.zone?.area_id || shippingQuote.zone?.district_id || "",
        district_id: form.district_id || shippingQuote.district_id || shippingQuote.zone?.district_id || shippingQuote.zone?.area_id || "",
        zone_id: form.zone_id || shippingQuote.zone_id || shippingQuote.zone?.zone_id || "",
        shipping_city_id: form.shipping_city_id,
        shipping_zone_id: form.shipping_zone_id,
        shipping_district_id: form.shipping_district_id,
        paid_amount: paidAmount,
        remaining_amount: Math.max(0, total - paidAmount),
        shipping_address: shippingProviderAddress,
        shipping_provider_address: shippingProviderAddress,
        shipping_payment_method: shippingPaymentMethod,
        coupon_code: couponCodeToSend,
        coupon_discount_amount: couponDiscountToSend,
      };
      trackGa4PaymentInfo(pricedCart, {
        value: total,
        coupon: couponCodeToSend,
        payment_type: paymentMethod,
      });
      const requestBody = shippingPaymentFile
        ? (() => {
            const formData = new FormData();
            formData.append("checkout", JSON.stringify(checkoutPayload));
            formData.append("items", JSON.stringify(pricedCart));
            formData.append("delivery_fee", String(deliveryFee));
            formData.append("discount", "0");
            if (paymentMode !== "cod") formData.append("shipping_payment_screenshot", shippingPaymentFile);
            return formData;
          })()
        : {
            checkout: checkoutPayload,
            items: pricedCart,
            delivery_fee: deliveryFee,
            discount: 0,
      };
      const data = await api.post("/storefront/checkout", requestBody);
      const successPayload = {
        order: data.order,
        items: data.items || pricedCart,
        customer: {
          full_name: form.full_name,
          phone: cleanPhone,
          email: form.email.trim().toLowerCase(),
          city: form.city || form.city_area || form.area || form.district,
          state: form.governorate,
          customer_id: data.order?.customer_id || profile?.customer_id || profile?.id || "",
        },
        checkout: { ...checkoutPayload, shipping_payment_method: shippingPaymentMethod, coupon_code: couponCodeToSend, coupon_discount_amount: couponDiscountToSend },
        customer_reviews: data.customer_reviews || null,
      };
      trackMetaPurchase({
        order: data.order,
        items: data.items || pricedCart,
        value: data.order?.total_amount ?? data.order?.total ?? total,
        customer: {
          ...profile,
          full_name: form.full_name,
          phone: cleanPhone,
          email: form.email,
          city: form.city || form.city_area || form.area || form.district,
          state: form.governorate,
          customer_id: data.order?.customer_id || profile?.customer_id || profile?.id || "",
        },
      });
      trackGa4Purchase({
        order: data.order,
        items: data.items || pricedCart,
        checkout: successPayload.checkout,
        value: data.order?.total_amount ?? data.order?.total ?? total,
      });
      const publicNumber = displayPublicOrderNumber(data.order);
      const receiptPayload = compactStorefrontReceipt(successPayload, {
        id: data.order?.id,
        invoice_number: data.order?.invoice_number,
        public_order_number: publicNumber,
        total: data.order?.total,
        customer_name: form.full_name,
        customer_phone: cleanPhone,
      });
      safeSetSessionStorage(`storefront.order.${publicNumber}`, receiptPayload, { maxBytes: 24 * 1024 });
      if (data.order?.invoice_number && data.order.invoice_number !== publicNumber) {
        safeSetSessionStorage(`storefront.order.${data.order.invoice_number}`, receiptPayload, { maxBytes: 24 * 1024 });
      }
      setProfile({
        full_name: form.full_name,
        primary_phone: cleanPhone,
        phone: cleanPhone,
        email: form.email.trim().toLowerCase(),
        customer_email: form.email.trim().toLowerCase(),
        customer_id: data.order?.customer_id || profile?.customer_id || profile?.id || "",
        city: form.city || form.city_area || form.area || form.district,
        governorate: form.governorate,
        street_address: form.street_address,
        building_number: form.building_number,
        floor_number: form.floor_number,
        apartment_number: form.apartment_number,
        detailed_address: form.detailed_address,
        landmark: form.landmark,
      });
      clearCart();
      playSuccess();
      navigate(`/success/${encodeURIComponent(publicNumber)}?phone=${encodeURIComponent(cleanPhone)}`, { state: successPayload });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("[storefront-checkout-error]", {
          message: error?.responseBody?.message || error?.message,
          field: error?.responseBody?.field || null,
          details: error?.responseBody?.details || null,
          status: error?.status,
          responseData: error?.responseBody || null,
        });
      }
      const backendMessage = error?.responseBody?.message || error?.message;
      const couponReason = error?.responseBody?.details?.coupon?.reason || error?.responseBody?.coupon?.reason || backendMessage;
      const field = String(error?.responseBody?.field || "").toLowerCase();
      toast.error(field === "coupon_code" ? couponErrorText(couponReason) : (backendMessage || sfText("storefront.toasts.checkoutFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  if (!cart.length) return <EmptyState title={sfText("storefront.checkout.emptyCartTitle")} text={sfText("storefront.checkout.emptyCartText")} />;

  return (
    <section className="sf-checkout-shell sf-checkout-page mx-auto max-w-7xl overflow-x-hidden px-4 pt-4 md:pt-7" data-theme={themeMode}>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="sf-checkout-eyebrow text-sm font-black text-[#f3d77a]">{sfText("storefront.checkout.eyebrow")}</p>
          <h1 className="sf-checkout-title text-3xl font-black text-white md:text-4xl">{sfText("storefront.checkout.title")}</h1>
          <p className="sf-checkout-subtitle mt-2 text-sm font-bold text-white/62">{sfText("storefront.checkout.subtitle")}</p>
        </div>
        <TrustPills compact />
      </div>
      <CheckoutProgress currentStep={checkoutStep} onStepChange={goToCheckoutStep} />
      <form id="storefront-checkout-form" noValidate onSubmit={submit} className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-3">
          {checkoutStep === 1 ? <CheckoutSection number="1" title={sfText("storefront.checkout.sections.customer")}>
            <div className="grid gap-2.5 md:grid-cols-2">
              <Field label={sfText("storefront.form.fullName")} placeholder={sfText("storefront.form.fullNamePlaceholder")} value={form.full_name} onChange={(v) => setField("full_name", v)} required error={errors.full_name} />
              <Field label={sfText("storefront.form.primaryPhone")} placeholder="01012345678" value={form.primary_phone} onChange={(v) => setField("primary_phone", v)} required error={errors.primary_phone} inputMode="tel" />
              <Field label={sfText("storefront.form.secondaryPhone")} placeholder={sfText("storefront.form.secondaryPhonePlaceholder")} value={form.secondary_phone} onChange={(v) => setField("secondary_phone", v)} inputMode="tel" />
              <Field
                label="البريد الإلكتروني لاستلام الفاتورة وطلب التقييم بعد التسليم"
                placeholder="name@example.com"
                value={form.email}
                onChange={(value) => setField("email", value)}
                error={errors.email}
                inputMode="email"
                type="email"
                autoComplete="email"
              />
            </div>
          </CheckoutSection> : null}
          {checkoutStep === 2 ? <CheckoutSection number="2" title={sfText("storefront.checkout.sections.address")} note={sfText("storefront.checkout.addressNote")} className="checkout-address-section" dir="rtl">
            {latestAddressApplied ? (
              <div className="sf-checkout-address-success mb-3 flex items-center justify-between gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-black leading-5 text-emerald-100">
                <span className="sf-checkout-address-success-text">{sfText("storefront.checkout.latestAddressApplied")}</span>
                <button type="button" onClick={useNewAddress} className="shrink-0 rounded-full border border-emerald-200/20 bg-white/10 px-3 py-1 text-[10px] font-black text-white transition hover:bg-white/15">
                  استخدم عنوانًا جديدًا
                </button>
              </div>
            ) : null}
            <div className="grid gap-2.5 md:grid-cols-2">
              {bostaMode ? (
                <>
                  <CheckoutLocationPicker
                    label={sfText("storefront.checkout.governorate")}
                    mobileTitle={sfText("storefront.checkout.governorate")}
                    value={form.shipping_city_id || ""}
                    onChange={setBostaCity}
                    options={bostaCityOptions}
                    loading={bostaLocations.loadingCities}
                    required
                    error={errors.governorate}
                    placeholder={sfText("storefront.checkout.chooseGovernorate")}
                    searchPlaceholder="ابحث عن المحافظة..."
                    loadingText={sfText("storefront.checkout.loadingGovernorates")}
                    themeMode={themeMode}
                  />
                  <CheckoutLocationPicker
                    label={sfText("storefront.checkout.zone")}
                    mobileTitle={sfText("storefront.checkout.zone")}
                    value={form.shipping_zone_id || ""}
                    onChange={setBostaZone}
                    options={bostaZoneOptions}
                    loading={bostaLocations.loadingZones}
                    required
                    disabled={!form.shipping_city_id}
                    error={!form.shipping_zone_id && errors.city_area ? errors.city_area : ""}
                    placeholder={form.shipping_city_id ? sfText("storefront.checkout.chooseZone") : sfText("storefront.checkout.chooseGovernorateFirst")}
                    searchPlaceholder="ابحث عن المنطقة..."
                    loadingText={sfText("storefront.checkout.loadingZones")}
                    themeMode={themeMode}
                    helperText={form.shipping_city_id ? sfText("storefront.checkout.zoneSearchHint") : ""}
                    emptyText={sfText("storefront.common.noResults")}
                  />
                  <CheckoutLocationPicker
                    label={sfText("storefront.checkout.area")}
                    mobileTitle={sfText("storefront.checkout.area")}
                    value={form.shipping_district_id || ""}
                    onChange={setBostaDistrict}
                    options={bostaDistrictOptions}
                    loading={bostaLocations.loadingDistricts}
                    required
                    disabled={!form.shipping_zone_id}
                    error={!form.shipping_district_id ? errors.city_area : ""}
                    placeholder={form.shipping_zone_id ? sfText("storefront.checkout.chooseDistrict") : sfText("storefront.checkout.chooseZoneFirst")}
                    searchPlaceholder="ابحث عن الحي..."
                    loadingText={sfText("storefront.checkout.loadingDistricts")}
                    themeMode={themeMode}
                    helperText={form.shipping_zone_id ? sfText("storefront.checkout.districtSearchHint") : ""}
                    emptyText={sfText("storefront.common.noResults")}
                  />
                </>
              ) : (
                <>
                  <SelectField themeMode={themeMode} label={sfText("storefront.checkout.governorate")} value={form.governorate_id || form.governorate} onChange={setGovernorate} options={locationGovernorates.length ? locationGovernorates.map((item) => item.governorate_id) : governorates} labels={Object.fromEntries(locationGovernorates.map((item) => [item.governorate_id, checkoutLocationName(item, i18n.language, "governorate")]))} required error={errors.governorate} />
                  <SelectField themeMode={themeMode} label={sfText("storefront.checkout.city")} value={form.city_id || ""} onChange={setCityArea} options={locationCities.map((item) => item.city_id)} labels={Object.fromEntries(locationCities.map((item) => [item.city_id, checkoutLocationName(item, i18n.language, "city")]))} required error={!form.city_id && errors.city_area ? errors.city_area : ""} />
                  <SelectField themeMode={themeMode} label={sfText("storefront.checkout.area")} value={form.area_id || ""} onChange={setCityArea} options={locationAreas.map((item) => item.area_id)} labels={Object.fromEntries(locationAreas.map((item) => [item.area_id, checkoutLocationName(item, i18n.language, "area")]))} required error={errors.city_area} />
                  {!locationGovernorates.length ? <CityAreaField themeMode={themeMode} governorate={form.governorate} options={cityAreaOptions} value={form.city_area} onChange={setCityArea} manual={manualCityArea} onManualChange={(value) => setField("city_area", value)} required error={errors.city_area} /> : null}
                </>
              )}
              <TextField label={sfText("storefront.checkout.fullAddress")} placeholder={sfText("storefront.checkout.fullAddressPlaceholder")} value={form.detailed_address} onChange={(v) => setField("detailed_address", v)} required error={errors.detailed_address} inputClassName="text-right" />
              <div className="sf-checkout-bosta-card md:col-span-2 rounded-[1.25rem] border border-white/10 bg-white/[0.035] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-white/54">{sfText("storefront.checkout.bostaAddressDetails")}</p>
                  {bostaMode ? <span className="rounded-full border border-cyan-300/30 bg-cyan-50 px-2.5 py-1 text-[10px] font-black text-cyan-800 shadow-[0_8px_18px_rgba(15,118,110,0.08)] dark:border-cyan-300/25 dark:bg-cyan-300/15 dark:text-cyan-100">{sfText("storefront.checkout.requiredForBosta")}</span> : null}
                </div>
                <div className="grid gap-2.5 md:grid-cols-4">
                  <Field label={sfText("storefront.checkout.streetAddress")} placeholder={sfText("storefront.checkout.streetAddressPlaceholder")} value={form.street_address} onChange={(v) => setField("street_address", v)} required={bostaMode} error={errors.street_address} inputClassName="text-right" />
                  <Field label={sfText("storefront.checkout.buildingNumber")} placeholder={sfText("storefront.checkout.buildingNumberPlaceholder")} value={form.building_number} onChange={(v) => setField("building_number", v)} required={bostaMode} error={errors.building_number} inputClassName="text-right" />
                  <Field label={sfText("storefront.checkout.floorNumber")} placeholder={sfText("storefront.checkout.floorNumberPlaceholder")} value={form.floor_number} onChange={(v) => setField("floor_number", v)} inputClassName="text-right" />
                  <Field label={sfText("storefront.checkout.apartmentNumber")} placeholder={sfText("storefront.checkout.apartmentNumberPlaceholder")} value={form.apartment_number} onChange={(v) => setField("apartment_number", v)} inputClassName="text-right" />
                </div>
              </div>
              <Field label={sfText("storefront.checkout.landmark")} placeholder={sfText("storefront.checkout.landmarkPlaceholder")} value={form.landmark} onChange={(v) => setField("landmark", v)} inputClassName="text-right" />
              <TextField label={sfText("storefront.checkout.deliveryNotes")} placeholder={sfText("storefront.checkout.deliveryNotesPlaceholder")} value={form.delivery_notes} onChange={(v) => setField("delivery_notes", v)} inputClassName="text-right" />
            </div>
          </CheckoutSection> : null}
          {checkoutStep === 3 ? (
            <CheckoutSection number="3" title={sfText("storefront.checkout.sections.payment")}>
              <div className="checkout-payment-clean mx-auto w-full max-w-[680px]">
                <div className="grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMode("cod");
                      setShowElectronicPaymentMethods(false);
                      setShippingPaymentFile(null);
                      setPaymentProofUploaded(false);
                      setForm((current) => ({ ...current, payment_method: "cod" }));
                    }}
                    className={`checkout-payment-choice flex min-h-[4.75rem] flex-col items-start justify-center rounded-[1.35rem] border px-4 py-3 text-right transition ${paymentMode === "cod" ? "border-emerald-300/35 bg-emerald-400/12 shadow-[0_16px_34px_rgba(16,185,129,0.12)]" : "border-white/10 bg-white/[0.045] hover:border-white/18 hover:bg-white/[0.07]"}`}
                  >
                    <span className="text-sm font-black text-white">الدفع عند الاستلام</span>
                    <span className="mt-1 text-xs font-semibold leading-5 text-white/56">{sfText("storefront.checkout.payment.cod.text")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMode("electronic");
                      setShowElectronicPaymentMethods(true);
                      setForm((current) => ({ ...current, payment_method: visibleTransferMethods[0]?.id || shippingTransferMethod || "instapay" }));
                      setShippingTransferMethod((current) => (visibleTransferMethods.some((method) => method.id === current) ? current : (visibleTransferMethods[0]?.id || "instapay")));
                    }}
                    className={`checkout-payment-choice flex min-h-[4.75rem] flex-col items-start justify-center rounded-[1.35rem] border px-4 py-3 text-right transition ${paymentMode === "electronic" ? "border-[#e5c158]/35 bg-[#d4af37]/14 shadow-[0_16px_34px_rgba(212,175,55,0.12)]" : "border-white/10 bg-white/[0.045] hover:border-white/18 hover:bg-white/[0.07]"}`}
                  >
                    <span className="text-sm font-black text-white">تأكيد الشحن</span>
                    <span className="mt-1 text-xs font-semibold leading-5 text-white/56">{sfText("storefront.checkout.payment.shippingConfirmation.text")}</span>
                  </button>
                </div>
                {showElectronicPaymentMethods && isShippingConfirmation ? (
                  <div className="grid gap-3">
                    {storefrontPaymentSettings.shippingConfirmation.enabled ? (
                      <div className="checkout-payment-amount">
                        <div className="text-sm font-black text-white/66">{storefrontPaymentSettings.shippingConfirmation.label || sfText("storefront.checkout.transfer.amountDueNow")}</div>
                        <div className="mt-2 flex items-end justify-between gap-3">
                          <div className="text-3xl font-black tracking-tight text-white">{money(amountDueNow)}</div>
                          <div className="text-xs font-semibold leading-5 text-white/54">{sfText("storefront.checkout.transfer.amountHelper")}</div>
                        </div>
                      </div>
                    ) : null}

                    <div className="checkout-payment-methods">
                      {visibleTransferMethods.map((method) => {
                        const active = shippingTransferMethod === method.id;
                        return (
                          <button
                            key={method.id}
                            type="button"
                            onClick={() => {
                              setShippingTransferMethod(method.id);
                              setForm((current) => ({ ...current, payment_method: method.id }));
                            }}
                            className={`checkout-payment-method ${active ? "checkout-payment-method--active" : ""}`}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <PaymentBrandLogo method={method.id} size="copy" active={active} label={method.label} logoUrl={method.logoUrl} />
                              <span className="min-w-0">
                                <span className="block text-sm font-black text-white">{method.label}</span>
                                <span className={`block text-xs font-semibold ${active ? "text-white/72" : "text-white/46"}`}>
                                  {method.helperText || (method.id === "instapay"
                                    ? sfText("storefront.checkout.transfer.instantBankTransfer")
                                    : sfText("storefront.checkout.transfer.vodafoneWallet"))}
                                </span>
                              </span>
                            </span>
                            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? "border-[#e5c158] bg-[#d4af37] text-white" : "border-white/18 bg-white/[0.04] text-transparent"}`}>
                              <Check className="h-3 w-3" />
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="checkout-payment-details">
                      <div className="text-sm font-black text-white/80">{sfText("storefront.checkout.transfer.paymentDetails")}</div>
                      {activeTransferMethod?.id === "instapay" && activeTransferPaymentUrl ? (
                        <div className="mt-3 grid gap-3">
                          <div className="rounded-[1rem] border border-[#e5c158]/12 bg-white/[0.045] px-3 py-2.5 text-sm font-black text-white/80">
                            {sfText("storefront.checkout.transfer.directPaymentAvailable")}
                          </div>
                          <button
                            type="button"
                            onClick={() => window.open(activeTransferPaymentUrl, "_blank", "noopener,noreferrer")}
                            className="sf-checkout-instapay-button inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-[#e5c158]/20 bg-[linear-gradient(135deg,rgba(212,175,55,0.98),rgba(17,24,39,0.98))] px-4 py-3 text-sm font-black text-white shadow-[0_16px_36px_rgba(212,175,55,0.24)] transition hover:-translate-y-0.5 hover:border-[#f3d77a]/36 hover:bg-[#d4af37]"
                          >
                            {sfText("storefront.checkout.transfer.openInstapayLink")}
                          </button>
                          <p className="text-xs font-semibold leading-6 text-white/56">
                            {sfText("storefront.checkout.transfer.instantPayHelper")}
                          </p>
                        </div>
                      ) : activeTransferMethod ? (
                        <div className="checkout-payment-copy-row mt-3">
                          <div className="min-w-0 flex-1 rounded-[1rem] border border-white/10 bg-black/14 px-3 py-2.5 font-mono text-base font-black tracking-wide text-white" dir="ltr">
                            {activeTransferValue}
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await navigator.clipboard?.writeText(activeTransferValue);
                              toast.success(sfText("storefront.toasts.copied"));
                            }}
                            className="checkout-payment-copy-button"
                          >
                            {sfText("storefront.checkout.transfer.copyShort")}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-[1rem] border border-white/10 bg-white/[0.045] px-3 py-2.5 text-sm font-semibold text-white/54">
                          {sfText("storefront.checkout.transfer.noPaymentMethod")}
                        </div>
                      )}
                    </div>

                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        setPaymentProofDragActive(true);
                      }}
                      onDragLeave={() => setPaymentProofDragActive(false)}
                      onDrop={handlePaymentProofDrop}
                      className={`checkout-payment-upload ${shippingPaymentFile ? "checkout-payment-upload--has-file" : ""} ${ errors.shipping_payment_screenshot ? "checkout-payment-upload--error" : paymentProofDragActive ? "checkout-payment-upload--active" : "" }`}
                    >
                      <label className="block cursor-pointer">
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handlePaymentProofChange(event.target.files?.[0])} className="sr-only" />
                        <div className="flex items-center gap-3">
                          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${paymentProofUploaded ? "bg-emerald-400/16 text-emerald-100" : "bg-[#d4af37]/14 text-[#f3d77a]"}`}>
                            {paymentProofUploaded ? <Check className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-black text-white">{shippingPaymentFile ? sfText("storefront.checkout.transfer.proofUploaded") : sfText("storefront.checkout.transfer.uploadPrompt")}</span>
                            <span className="block text-xs font-semibold text-white/52">{sfText("storefront.checkout.transfer.acceptedFormats")}</span>
                          </span>
                        </div>
                      </label>

                      {shippingPaymentFile ? (
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-100">
                            <Check className="h-3.5 w-3.5" />
                            <span className="truncate">{shippingPaymentFile.name}</span>
                          </span>
                          <button type="button" onClick={removePaymentProof} className="text-xs font-black text-white/52 transition hover:text-white">
                            {sfText("storefront.checkout.transfer.removeProof")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {errors.shipping_payment_screenshot ? <span className="text-xs font-bold text-rose-200">{errors.shipping_payment_screenshot}</span> : null}

                    <div className="checkout-payment-notes grid gap-2 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Field label={sfText("storefront.checkout.coupon")} placeholder={sfText("storefront.checkout.couponPlaceholder")} value={form.coupon} onChange={(v) => setField("coupon", v)} />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => applyCoupon()}
                            disabled={couponLoading || !String(form.coupon || "").trim()}
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#e5c158]/25 bg-[#d4af37] px-4 text-sm font-black text-white transition hover:bg-[#d4af37] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {couponLoading ? sfText("common.loading") : sfText("storefront.checkout.applyCoupon")}
                          </button>
                          {couponValidation?.valid ? (
                            <button
                              type="button"
                              onClick={() => {
                                setForm((current) => ({ ...current, coupon: "" }));
                                setCouponValidation(null);
                                couponValidationKeyRef.current = "";
                              }}
                              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm font-black text-white/85 transition hover:bg-white/[0.08]"
                            >
                              {sfText("storefront.checkout.removeCoupon")}
                            </button>
                          ) : null}
                        </div>
                        {couponValidation?.valid ? (
                          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-100">
                            {sfText("storefront.checkout.couponAppliedSummary", undefined, {
                              code: couponValidation?.coupon?.code || couponCode,
                              discount: money(couponDiscount),
                            })}
                          </div>
                        ) : couponCode ? (
                          <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-black text-amber-100">
                            {sfText("storefront.checkout.couponNeedsApply")}
                          </div>
                        ) : null}
                      </div>
                      <TextField label={sfText("storefront.checkout.orderNotes")} placeholder={sfText("storefront.checkout.orderNotesPlaceholder")} value={form.order_notes} onChange={(v) => setField("order_notes", v)} compact />
                    </div>

                    <SubmitButton submitting={isFinalCheckoutStep && submitting} paymentMethod={normalizedFormPaymentMethod} disabled={submitDisabled} label={checkoutActionLabel} variant="success" />
                  </div>
                ) : null}
              </div>
            </CheckoutSection>
          ) : null}
          <div className="sf-checkout-mobile-actions md:hidden">
            <SubmitButton
              submitting={isFinalCheckoutStep && submitting}
              compact
              disabled={submitDisabled}
              label={checkoutActionLabel}
              variant="success"
            />
          </div>
        </div>
        <Suspense fallback={<div className="h-[22rem] rounded-[1.7rem] border border-white/10 bg-white/[0.045] shadow-[0_24px_70px_rgba(0,0,0,0.18)] lg:sticky lg:top-24" />}>
          <LazyStorefrontCheckoutSummary
            cart={pricedCart}
            subtotal={subtotal}
            discount={discount}
            deliveryFee={deliveryFee}
            total={total}
            codAmount={codAmount}
            governorate={form.governorate}
            paymentMethod={normalizedFormPaymentMethod}
            shippingQuote={shippingQuote}
            open={summaryOpen}
            setOpen={setSummaryOpen}
            submitting={isFinalCheckoutStep && submitting}
            submitDisabled={submitDisabled}
            actionLabel={checkoutActionLabel}
            helpers={checkoutSummaryHelpers}
            components={checkoutSummaryComponents}
          />
        </Suspense>
      </form>
    </section>
  );
}

function OrderSuccess({ profile, brandName = "MONE", brandLogoUrl = "" }) {
  const { t } = useTranslation();
  const { orderNumber } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const decodedOrderNumber = decodeURIComponent(orderNumber || "");
  const phone = params.get("phone") || profile.primary_phone || location.state?.customer?.phone || "";
  const message = useMemo(() => pickSuccessMessage(decodedOrderNumber || phone), [decodedOrderNumber, phone]);
  const [confetti, setConfetti] = useState(true);
  const [loaded, setLoaded] = useState(() => {
    if (location.state?.order) return location.state;
    try {
      return JSON.parse(sessionStorage.getItem(`storefront.order.${decodedOrderNumber}`) || "null");
    } catch {
      return null;
    }
  });
  const { products } = useProducts({ limit: 4 });

  useEffect(() => {
    playSuccess();
    const timer = setTimeout(() => setConfetti(false), 2200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!decodedOrderNumber || !phone || loaded?.order) return;
    api.get(`/storefront/track?order_number=${encodeURIComponent(decodedOrderNumber)}&phone=${encodeURIComponent(phone)}`)
      .then((data) => setLoaded({ order: data.order, items: data.items || [], customer: { full_name: data.order?.customer_name, phone } }))
      .catch(() => undefined);
  }, [decodedOrderNumber, phone, loaded?.order]);

  const order = useMemo(() => loaded?.order || {}, [loaded?.order]);
  const brandedOrder = useMemo(() => ({
    ...order,
    company_name: brandName || order.company_name || order.store?.name || "MONE",
    companyName: brandName || order.companyName || order.store?.name || "MONE",
    logo_url: brandLogoUrl || order.logo_url || order.store?.logoUrl || order.store?.logo_url || "",
    store: {
      ...(order.store || {}),
      name: brandName || order.store?.name || order.company_name || "MONE",
      logoUrl: brandLogoUrl || order.store?.logoUrl || order.store?.logo_url || order.logo_url || "",
      logo_url: brandLogoUrl || order.store?.logo_url || order.store?.logoUrl || order.logo_url || "",
    },
  }), [brandLogoUrl, brandName, order]);
  const publicNumber = displayPublicOrderNumber(order) || displayPublicOrderNumber(decodedOrderNumber);
  const items = loaded?.items || [];
  const customerName = order.customer_name || loaded?.customer?.full_name || profile.full_name || t("storefront.customer.dearCustomer");
  const total = order.total_amount || order.total || order.total_price || 0;
  const address = [order.governorate, order.city_area, order.customer_address || loaded?.checkout?.detailed_address].filter(Boolean).join(" - ");
  const paymentLabel = paymentCopy(order.payment_method || loaded?.checkout?.payment_method || "cod");
  const isShippingAwaitingVerification =
    (order.payment_method || loaded?.checkout?.payment_method) === "shipping_confirmation" ||
    order.payment_status === "awaiting_verification" ||
    order.status === "awaiting_verification";
  useEffect(() => {
    if (!order?.id || !Array.isArray(items) || !items.length || !isMetaPurchaseEligible(order)) return;
    trackMetaPurchase({
      order,
      items,
      value: total,
      customer: {
        ...(loaded?.customer || {}),
        full_name: loaded?.customer?.full_name || customerName,
        phone: loaded?.customer?.phone || phone,
        email: loaded?.customer?.email || loaded?.checkout?.email || profile.email || profile.customer_email,
        city:
          loaded?.customer?.city ||
          loaded?.checkout?.city ||
          loaded?.checkout?.city_area ||
          loaded?.checkout?.area ||
          order.city_area,
        state: loaded?.customer?.state || loaded?.checkout?.governorate || order.governorate,
        customer_id: order.customer_id || profile.customer_id || profile.id || "",
      },
    });
    trackGa4Purchase({
      order,
      items,
      checkout: loaded?.checkout || {},
      value: total,
    });
  }, [customerName, isShippingAwaitingVerification, items, loaded?.checkout, loaded?.customer, order, phone, total]);
  useEffect(() => {
    if (!loaded?.customer_reviews || !isCustomerReviewOrderEligible(order)) return;
    renderGoogleCustomerReviewOptIn(loaded.customer_reviews);
  }, [loaded?.customer_reviews, order]);
  const successTitle = isShippingAwaitingVerification ? t("storefront.success.awaitingVerificationTitle") : t("storefront.success.confirmedTitle");
  const successSubtitle = isShippingAwaitingVerification
    ? t("storefront.success.awaitingVerificationSubtitle")
    : t("storefront.success.confirmedSubtitle");
  const successStatus = isShippingAwaitingVerification ? t("storefront.status.awaiting_verification") : statusCopy(order.status || "pending");
  const whatsAppHref = whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(`ط·آ·ط¢آ¸ط£آ¢أ¢â€ڑآ¬ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ¨ط·آ·ط¢آ¸ط£آ¢أ¢â€ڑآ¬ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¥أ¢â‚¬â„¢ ط·آ·ط¢آ·ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ±ط·آ·ط¢آ¸ط·آ¸ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ¯ ط·آ·ط¢آ¸ط£آ¢أ¢â€ڑآ¬ط¢آ¦ط·آ·ط¢آ·ط·آ¹ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ© ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¸ط£آ¢أ¢â€ڑآ¬أ¢â‚¬ع†ط·آ·ط¢آ·ط·آ¢ط¢آ¨ط·آ·ط¢آ¸ط·آ¸ط¢آ¹ ط·آ·ط¢آ·ط·آ¢ط¢آ±ط·آ·ط¢آ¸ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ·ط¢آ¸ط£آ¢أ¢â€ڑآ¬ط¢آ¦ ${publicNumber}`)}` : "";

  return (
    <section className="sf-order-success-page relative mx-auto max-w-6xl px-4 py-6 md:py-10">
      {confetti ? <Confetti /> : null}
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto grid h-24 w-24 animate-[success-pop_650ms_ease-out] place-items-center rounded-full bg-emerald-100 text-emerald-700 shadow-[0_20px_45px_rgba(16,185,129,0.18)]">
          <Check className="h-12 w-12" />
        </div>
        <h1 className="mt-6 text-3xl font-black text-white md:text-4xl">{successTitle}</h1>
        <p className="mt-2 text-lg font-bold text-white/72">{t("storefront.success.thanks")}</p>
        <p className="mt-1 text-sm font-bold text-white/54">{successSubtitle}</p>
        <div className="mt-5 inline-flex rounded-full border border-[#d4af37]/20 bg-[linear-gradient(135deg,rgba(212,175,55,0.12),rgba(255,255,255,0.05))] px-4 py-2 text-sm font-black text-[#d4af37]">{message}</div>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="sf-storefront-card rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)] md:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoBox label={t("storefront.orders.orderNumber")} value={<OrderNumberBadge value={publicNumber} className="border-[#d4af37]/20 bg-[#d4af37]/12 text-[#d4af37]" />} />
              <InfoBox label={t("storefront.customer.customer")} value={customerName} />
              <InfoBox label={t("storefront.checkout.total")} value={total ? money(total) : t("storefront.success.orderRecorded")} />
              <InfoBox label={t("storefront.checkout.paymentMethod")} value={paymentLabel} />
              <InfoBox label={t("storefront.orders.orderStatus")} value={successStatus} />
              <InfoBox label={t("storefront.orders.expectedDelivery")} value={t("storefront.orders.expectedDeliveryWindow")} />
            </div>
            <div className="sf-info-box mt-4 rounded-2xl border border-white/10 bg-[#101010] p-4 text-right text-white">
              <div className="sf-info-label text-xs font-black text-stone-500">{t("storefront.checkout.deliveryAddress")}</div>
              <div className="sf-info-value mt-1 font-black">{address || t("storefront.orders.addressSaved")}</div>
            </div>
          </div>
          <div className="sf-storefront-card rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)] md:p-6">
            <h2 className="sf-section-heading text-xl font-black">{t("storefront.orders.tracking")}</h2>
            <SuccessTimeline />
          </div>
          <Suspense fallback={<div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm font-bold text-white/60">{sfText("storefront.orders.itemsLoading")}</div>}>
            <OrderInvoiceCard className="sf-order-invoice-card" order={{ ...brandedOrder, source: "Website" }} items={items} />
          </Suspense>
        </div>
        <aside className="sf-storefront-card h-max rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)] lg:sticky lg:top-24">
          <div className="grid gap-3">
            <Link to={`/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="rounded-full bg-[#101010] px-5 py-4 text-center font-black text-white transition hover:bg-[#d4af37]">{t("storefront.orders.trackOrder")}</Link>
            <Link to="/products" className="sf-soft-pill rounded-full border border-stone-300 px-5 py-4 text-center font-black transition hover:border-[#d4af37] hover:text-[#d4af37]">{t("storefront.common.continueShopping")}</Link>
            {whatsAppHref ? <a href={whatsAppHref} className="rounded-full border border-emerald-200 bg-emerald-50 px-5 py-4 text-center font-black text-emerald-700">{t("storefront.support.whatsapp")}</a> : <button disabled className="rounded-full border border-stone-200 bg-stone-100 px-5 py-4 font-black text-stone-400">{t("storefront.support.whatsappUnavailable")}</button>}
          </div>
          <div className="sf-info-box mt-5 rounded-2xl border border-white/10 bg-[#101010] p-4 text-sm font-bold leading-6 text-white/72">{t("storefront.success.reviewNotice")}</div>
        </aside>
      </div>
      {products.length ? (
        <div className="mt-6">
          <ProductRail title={t("storefront.nav.new")} subtitle={t("storefront.success.recommendedProducts")} products={products} loading={false} railType="new" wishlist={[]} toggleWishlist={() => undefined} onAddToCart={() => undefined} saleModeEnabled={storefrontSalePricesEnabled} />
        </div>
      ) : null}
    </section>
  );
}

const statusCopy = (value = "") => {
  const raw = rawOptionValue(value, "pending");
  const key = raw.toLowerCase();
  return sfText(`storefront.status.${key.replace(/\s+/g, "_")}`, raw || "Pending review");
};

const paymentCopy = (value = "") => {
  const raw = rawOptionValue(value, "cod");
  return getPaymentMethods().find((method) => method.id === raw)?.title || statusCopy(raw);
};
const shippingProviderCopy = (value = "") => {
  const raw = String(rawOptionValue(value) || "").trim().toLowerCase();
  if (!raw || raw === "default" || raw === "dev" || raw === "undefined" || raw === "null" || raw === "dev: default") {
    return sfText("storefront.shipping.inStoreDelivery");
  }
  if (raw === "bosta" || raw.includes("bosta")) {
    return "بوسطة";
  }
  return sfText("storefront.shipping.inStoreDelivery");
};
const formatDate = (value) => {
  if (!value) return sfText("storefront.common.soon");
  try {
    return new Intl.DateTimeFormat(i18n.language || "en", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
};
const supportHref = (orderNumber = "") => {
  const text = orderNumber ? sfText("storefront.support.orderHelpMessage", undefined, { orderNumber }) : sfText("storefront.support.generalHelpMessage");
  return whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(text)}` : "https://wa.me/";
};

function OrderTimeline({ timeline = [] }) {
  const steps = timeline.length ? timeline : getStatusLabels().map((label, index) => ({ label, done: index === 0 }));
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step.key || step.label} className={`sf-order-step rounded-2xl border p-3 ${step.done ? "sf-order-step--done border-emerald-200 bg-emerald-50" : "sf-order-step--pending border-stone-200 bg-stone-50"}`}>
          <div className={`sf-order-step-icon mb-2 grid h-9 w-9 place-items-center rounded-full ${step.done ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-500"}`}>
            {step.done ? <Check className="h-4 w-4" /> : index + 1}
          </div>
          <div className="sf-order-step-label text-xs font-black leading-5">{step.label}</div>
        </div>
      ))}
    </div>
  );
}

function FaqPage() {
  const items = [
    [sfText("storefront.faq.deliveryTime.question"), sfText("storefront.faq.deliveryTime.answer")],
    [sfText("storefront.faq.paymentMethods.question"), sfText("storefront.faq.paymentMethods.answer")],
    [sfText("storefront.faq.exchangeReturns.question"), sfText("storefront.faq.exchangeReturns.answer")],
    [sfText("storefront.faq.sizeHelp.question"), sfText("storefront.faq.sizeHelp.answer")],
    [sfText("storefront.faq.trackOrder.question"), sfText("storefront.faq.trackOrder.answer")],
    [sfText("storefront.faq.shippingProviders.question"), sfText("storefront.faq.shippingProviders.answer")],
  ];
  return <StaticPage title={sfText("storefront.faq.title")} items={items} />;
}


function PremiumContactPage({ publicStoreSettings = {}, quickActionLinks = {} }) {
  const settings = publicStoreSettings || {};
  const storefrontSettings = settings.storefront && typeof settings.storefront === "object" ? settings.storefront : {};
  const readSetting = (key) => {
    if (String(key || "").startsWith("storefront.")) {
      const storefrontKey = String(key).slice("storefront.".length);
      return storefrontSettings[storefrontKey] ?? settings[key];
    }
    return settings[key];
  };
  const firstValue = (...keys) => keys.map((key) => String(readSetting(key) || "").trim()).find(Boolean) || "";
  const normalizeUrl = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^(https?:|mailto:|tel:|whatsapp:)/i.test(raw) || raw.startsWith("/")) return raw;
    return "";
  };

  const phoneNumber = firstValue("storefront.contact_phone", "storefront.phone", "general.phone", "company.phone", "contact.phone", "phone", "support.phone");
  const phoneHref = phoneNumber ? `tel:${phoneNumber.replace(/\D/g, "")}` : "";
  const whatsappPhone = firstValue("storefront.whatsapp_phone", "general.whatsapp_phone", "general.whatsapp", "company.whatsapp", "company.whatsapp_phone", "support.whatsapp", "contact.whatsapp", "whatsapp");
  const whatsappUrl = normalizeUrl(firstValue("storefront.whatsapp_url", "storefront.whatsapp_link"));
  const whatsappHref = quickActionLinks.whatsappHref || whatsappUrl || (whatsappPhone ? `https://wa.me/${whatsappPhone.replace(/\D/g, "")}` : "");
  const instagramUsername = firstValue("storefront.instagram_username", "storefront.instagram", "company.instagram_username", "social.instagram_username", "instagram_username");
  const instagramHref = normalizeUrl(firstValue("storefront.instagram_url", "storefront.instagram_link", "company.instagram_url", "social.instagram_url", "instagram_url")) || (instagramUsername ? `https://www.instagram.com/${String(instagramUsername).replace(/^@/, "")}` : "");
  const facebookPage = firstValue("storefront.facebook_page_name", "storefront.facebook_name", "company.facebook_page_name", "social.facebook_page_name", "facebook_page_name");
  const facebookHref = normalizeUrl(firstValue("storefront.facebook_url", "storefront.facebook_link", "company.facebook_url", "social.facebook_url", "facebook_url"));
  const address = firstValue("storefront.address", "address", "storeAddress", "store_address", "publicAddress", "public_address", "company.address");
  const mapHref = quickActionLinks.galleryHref || normalizeUrl(firstValue("storefront.map_url", "storefront.google_map_url", "storefront.location_url", "storefront.location_link", "storefront.store_location_url", "storefront.address_url", "general.map_url", "general.google_map_url", "company.map_url", "company.google_maps_url", "company.location_url", "map_url", "google_map_url", "location_url"));
  const workingHours = firstValue("storefront.working_hours", "working_hours", "business_hours", "storefront.weekday_hours", "storefront.working_hours_weekday", "working_hours_weekday");
  const workingHoursLines = String(workingHours || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const addressDisplay = String(address || "").replace(/\s+-\s+/g, "\n");

  const BrandInstagramIcon = ({ className = "h-5 w-5" }) => (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
    </svg>
  );
  const BrandFacebookIcon = ({ className = "h-5 w-5" }) => (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M14.5 8.5V7c0-.8.4-1.5 1.5-1.5H18V2h-2.5C12.8 2 11 3.8 11 6.5V8.5H8v3h3V22h3v-10.5h2.5l.5-3H14.5Z" />
    </svg>
  );
  const contactRows = [
    {
      id: "phone",
      title: "الهاتف",
      icon: Phone,
      value: phoneNumber,
      href: phoneHref,
      cta: "اتصال",
      tone: "phone",
    },
    {
      id: "instagram",
      title: "انستجرام",
      icon: BrandInstagramIcon,
      value: instagramUsername || instagramHref,
      href: instagramHref,
      cta: "زيارة الصفحة",
      tone: "instagram",
    },
    {
      id: "facebook",
      title: "فيسبوك",
      icon: BrandFacebookIcon,
      value: facebookPage || facebookHref,
      href: facebookHref,
      cta: "زيارة الصفحة",
      tone: "facebook",
    },
    {
      id: "address",
      title: "العنوان",
      icon: MapPin,
      value: addressDisplay,
      href: mapHref,
      cta: "فتح الخريطة",
      tone: "map",
    },
    {
      id: "working_hours",
      title: "مواعيد العمل",
      icon: Clock3,
      value: workingHours,
      href: "",
      cta: "",
      tone: "gold",
    },
  ].map((row) => ({
    ...row,
    hasValue: Boolean(String(row.value || "").trim()),
  }));
  const visibleContactRows = contactRows.filter((card) => card.id !== "whatsapp" && (card.id === "working_hours" ? workingHoursLines.length > 0 : Boolean(String(card.value || "").trim())));
  const helpItems = [
    { icon: Footprints, label: "استفسار عن مقاس" },
    { icon: PackageSearch, label: "متابعة طلب" },
    { icon: RefreshCcw, label: "استبدال أو استرجاع" },
    { icon: PackageCheck, label: "مشكلة في منتج" },
  ];
  const actionButtonStyles = {
    phone: "border-none bg-[#10B981] text-white shadow-[0_14px_34px_rgba(16,185,129,0.28)] hover:bg-[#0EA5E9]",
    instagram: "border-none bg-[linear-gradient(135deg,#F58529,#DD2A7B,#8134AF,#515BD4)] text-white shadow-[0_14px_34px_rgba(221,42,123,0.26)] hover:brightness-110",
    facebook: "border-none bg-[#1877F2] text-white shadow-[0_14px_34px_rgba(24,119,242,0.28)] hover:bg-[#166fe5]",
    map: "border-[rgba(212,175,55,0.3)] bg-gradient-to-r from-[#D4AF37] to-[#9c7b22] text-white shadow-[0_14px_34px_rgba(212,175,55,0.24)] hover:from-[#e0bc47] hover:to-[#b9922f]",
  };
  const actionIconStyles = {
    phone: "text-white",
    instagram: "text-white",
    facebook: "text-white",
    map: "text-white",
  };

  return (
    <section className="mx-auto w-full max-w-6xl bg-[#050505] px-4 pt-6 pb-[calc(var(--mobile-bottom-nav-height,58px)+env(safe-area-inset-bottom)+1.5rem)] text-white md:px-6 md:py-10 md:pb-10" dir="rtl">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-black uppercase tracking-[0.24em] text-[#D4AF37]/85">M1 Store</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white md:text-5xl">تواصل معنا</h1>
        <p className="mt-3 text-sm font-medium leading-7 text-slate-400 md:text-base">
          فريق M1 Store جاهز لمساعدتك في الطلبات، المقاسات، الاستبدال والاسترجاع.
        </p>
      </div>

      {whatsappHref ? (
        <div className="mx-auto mt-5 max-w-2xl">
          <a
            href={whatsappHref}
            target={whatsappHref.startsWith("http") ? "_blank" : undefined}
            rel={whatsappHref.startsWith("http") ? "noreferrer" : undefined}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500 px-4 py-3 text-sm font-black text-white shadow-[0_18px_40px_rgba(16,185,129,0.24)] transition duration-200 hover:bg-emerald-400 active:scale-[0.99]"
          >
            <MessageCircle className="h-4.5 w-4.5" />
            تواصل عبر واتساب
          </a>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              [Clock3, "الرد خلال دقائق"],
              [Footprints, "مساعدة المقاسات"],
              [PackageSearch, "متابعة الطلبات"],
              [RefreshCcw, "استبدال واسترجاع"],
            ].map(([Icon, label]) => (
              <div key={label} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-[11px] font-black text-slate-200 shadow-[0_10px_24px_rgba(0,0,0,0.18)]">
                <Icon className="h-3.5 w-3.5 text-[#D4AF37]" />
                <span className="leading-none">{label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        {visibleContactRows.map((card) => {
          const Icon = card.icon;
          const hasLink = Boolean(card.href) && Boolean(card.cta);
          const buttonTone = actionButtonStyles[card.tone] || actionButtonStyles.map;
          const buttonIconTone = actionIconStyles[card.tone] || actionIconStyles.map;
          const valueText = String(card.value || "").trim();
          return (
            <article key={card.id} className="rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[#101010] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.22)] backdrop-blur-xl transition duration-200 hover:-translate-y-0.5 hover:border-[rgba(212,175,55,0.18)] active:scale-[0.99]">
              <div className="flex items-start gap-3">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl border ${card.tone === "map" ? "border-[rgba(212,175,55,0.18)] bg-[rgba(212,175,55,0.08)] text-[#D4AF37]" : "border-[rgba(212,175,55,0.16)] bg-[rgba(255,255,255,0.04)] text-[#D4AF37]"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-black text-white">{card.title}</h2>
                  {card.id === "working_hours" ? (
                    <div className="mt-2 space-y-2">
                      {workingHoursLines.map((line, index) => (
                        <div key={`${card.id}-${index}`} className="whitespace-pre-line rounded-2xl border border-white/[0.06] bg-white/[0.035] px-3 py-2 text-sm font-semibold leading-6 text-slate-200">
                          {line}
                        </div>
                      ))}
                    </div>
                  ) : card.id === "address" ? (
                    <p className="mt-1 whitespace-pre-line break-words text-sm font-medium leading-7 text-slate-400">{valueText}</p>
                  ) : card.id === "phone" && phoneHref ? (
                    <a href={phoneHref} className="mt-1 inline-flex break-words text-sm font-medium leading-7 text-slate-400 transition hover:text-white">
                      {valueText}
                    </a>
                  ) : (
                    <p className="mt-1 break-words text-sm font-medium leading-7 text-slate-400">{valueText}</p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                {hasLink ? (
                  <a
                    href={card.href}
                    target={card.href.startsWith("http") ? "_blank" : undefined}
                    rel={card.href.startsWith("http") ? "noreferrer" : undefined}
                    className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-black transition duration-200 active:scale-[0.98] ${buttonTone}`}
                  >
                    <Icon className={`h-4.5 w-4.5 ${buttonIconTone}`} />
                    {card.cta}
                  </a>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <article className="mt-6 rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[#101010] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.22)] backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[rgba(212,175,55,0.18)] bg-[rgba(212,175,55,0.08)] text-[#D4AF37]">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-black text-white">كيف نساعدك؟</h2>
            <p className="mt-1 text-sm font-medium leading-7 text-slate-400">اختر نوع المساعدة المناسب وسيصلك الرد بأوضح طريقة ممكنة.</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {helpItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-white/[0.035] p-4 text-center">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-[rgba(212,175,55,0.14)] bg-[rgba(212,175,55,0.07)] text-[#D4AF37]">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-3 text-sm font-black text-white">{item.label}</div>
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}


function ReturnsPolicy({ publicStoreSettings = {} }) {
  let sections = [
    {
      title: "الاستبدال والاسترجاع",
      items: [
        "يحق للعميل طلب الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام وفقًا للشروط التالية:",
        "أن يكون المنتج في حالته الأصلية كما تم استلامه.",
        "عدم استخدام المنتج أو تعرضه لأي تلف أو اتساخ.",
        "وجود العلبة الأصلية وجميع الملحقات الخاصة بالمنتج.",
        "تقديم أصل الفاتورة أو رقم الطلب.",
      ],
    },
    {
      title: "حالات لا يشملها الاستبدال أو الاسترجاع",
      items: [
        "المنتجات التي تم استخدامها أو تعرضت للتلف بعد الاستلام.",
        "المنتجات التي لا تكون في حالتها الأصلية.",
        "المنتجات التي تم تعديلها أو إصلاحها بواسطة العميل.",
        "المنتجات التي يظهر عليها أي آثار استخدام أو سوء تخزين.",
      ],
    },
    {
      title: "الطلبات الأونلاين",
      items: [
        "في حالة طلب المنتج أونلاين واستلامه من شركة الشحن، يحق للعميل طلب الاستبدال أو الاسترجاع خلال 14 يومًا من تاريخ الاستلام وفقًا للشروط المذكورة.",
      ],
    },
    {
      title: "في حالة تغيير المقاس أو الاختيار الخاطئ من العميل",
      items: [
        "إذا كان سبب الاستبدال أو الاسترجاع هو اختيار مقاس غير مناسب.",
        "أو تغيير الرأي بعد الاستلام.",
        "أو الرغبة في تغيير اللون أو الموديل.",
        "فإن العميل يتحمل كامل مصاريف الشحن والاستبدال أو الاسترجاع ذهابًا وإيابًا.",
      ],
    },
    {
      title: "في حالة وجود خطأ من المتجر",
      items: [
        "إرسال مقاس مختلف عن الطلب.",
        "إرسال منتج مختلف عن الطلب.",
        "وجود عيب تصنيع مؤكد بالمنتج.",
        "فإن المتجر يتحمل جميع مصاريف الشحن والاستبدال أو الاسترجاع بالكامل.",
      ],
    },
    {
      title: "فحص المنتجات",
      items: [
        "يتم فحص جميع المنتجات المرتجعة قبل اعتماد طلب الاستبدال أو الاسترجاع.",
        "يحتفظ المتجر بحق رفض الطلب إذا تبين عدم مطابقة المنتج لشروط الاستبدال والاسترجاع.",
      ],
    },
    {
      title: "استرداد المبلغ",
      items: [
        "يتم رد قيمة الطلب بعد استلام المنتج وفحصه واعتماد طلب الاسترجاع.",
        "قد تستغرق عملية استرداد المبلغ عدة أيام عمل وفقًا لوسيلة الدفع المستخدمة.",
      ],
    },
    {
      title: "ملاحظات هامة",
      items: [
        "يُنصح بمراجعة جدول المقاسات والتواصل مع خدمة العملاء قبل إتمام الطلب لضمان اختيار المقاس المناسب.",
        "اختلاف درجة اللون بشكل بسيط نتيجة الإضاءة أو إعدادات شاشة الهاتف أو الكمبيوتر لا يُعد عيبًا في المنتج.",
        "إتمام عملية الشراء يعني الموافقة على سياسة الاستبدال والاسترجاع الخاصة بالمتجر.",
      ],
    },
  ];
  const configuredPolicy = normalizeMerchantReturnPolicy(publicStoreSettings);
  if (configuredPolicy) {
    const conditions = configuredPolicy.conditions && typeof configuredPolicy.conditions === "object"
      ? configuredPolicy.conditions
      : {};
    sections = [
      {
        title: "مدة الاستبدال والاسترجاع",
        items: [`يمكن طلب الاستبدال أو الاسترجاع خلال ${configuredPolicy.days} يومًا من تاريخ الاستلام.`],
      },
      {
        title: "شروط قبول المنتج",
        items: [conditions.unused_original_condition, conditions.invoice_required].filter(Boolean),
      },
      {
        title: "تكلفة الشحن",
        items: [conditions.customer_choice_shipping, conditions.defect_shipping].filter(Boolean),
      },
    ].filter((section) => section.items.length);
  }
  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_18px_54px_rgba(15,23,42,0.08)] sm:p-6 dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(7,11,22,0.96),rgba(7,11,22,0.88))]">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-black tracking-tight text-stone-950 sm:text-3xl dark:text-white">{sfText("storefront.returns.title")}</h1>
          <p className="mt-3 text-sm leading-7 text-stone-600 sm:text-base dark:text-slate-300">
            يوضح هذا القسم شروط الاستبدال والاسترجاع المعتمدة داخل المتجر، بما يضمن وضوح الإجراءات وحفظ حقوق العميل والمتجر.
          </p>
        </div>
        <div className="mt-6 grid gap-4">
          {sections.map((section) => (
            <section key={section.title} className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4 sm:p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <h2 className="text-base font-black text-stone-950 sm:text-lg dark:text-white">{section.title}</h2>
              <ul className="mt-3 space-y-2 text-sm leading-7 text-stone-700 sm:text-[15px] dark:text-slate-300">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

function StaticPage({ title, items }) {
  return (
    <section className="mx-auto max-w-4xl px-4 py-6">
      <div className="rounded-[1.75rem] border border-stone-200/80 bg-white/96 p-5 shadow-[0_20px_48px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.045] dark:shadow-[0_22px_56px_rgba(0,0,0,0.28)]">
        <h1 className="text-3xl font-black">{title}</h1>
        <div className="mt-5 grid gap-3">
        {items.map(([question, answer]) => (
          <div key={question} className="rounded-[1.35rem] border border-stone-200/80 bg-stone-50/82 p-5 shadow-[0_12px_28px_rgba(15,23,42,0.05)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
            <h2 className="font-black">{question}</h2>
            <p className="mt-2 font-bold leading-7 text-stone-600">{answer}</p>
          </div>
        ))}
        </div>
      </div>
    </section>
  );
}

function CheckoutProgress({ currentStep = 1, onStepChange }) {
  const steps = [
    sfText("storefront.checkout.progress.customer"),
    sfText("storefront.checkout.progress.address"),
    sfText("storefront.checkout.progress.payment"),
    sfText("storefront.checkout.progress.confirmation"),
  ];
  const activeIndex = Math.min(3, currentStep);
  return (
    <div className="sf-reveal sf-checkout-progress overflow-hidden rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#0a0a0a_55%,#111111_100%)] p-2 shadow-[0_16px_42px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-2xl">
      <div className="grid grid-cols-4 gap-1 text-center text-[11px] font-black text-white/48 sm:text-xs">
        {steps.map((step, index) => (
          <button
            key={step}
            type="button"
            disabled={index === 3 || index + 1 > currentStep}
            onClick={() => index < 3 && onStepChange?.(index + 1)}
            className={`sf-checkout-progress-step flex min-h-10 items-center justify-center rounded-2xl px-1 transition disabled:cursor-default ${index + 1 < activeIndex ? "sf-checkout-progress-step--done border border-[#e5c158]/20 bg-[#d4af37]/18 text-[#ddd6fe]" : index + 1 === activeIndex ? "sf-checkout-progress-step--active border border-[#e5c158]/35 bg-[#d4af37] text-white shadow-[0_10px_24px_rgba(212,175,55,0.24)]" : "sf-checkout-progress-step--pending border border-white/8 bg-white/[0.035] text-white/38"}`}
          >
            <span className="truncate">{step}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TrustPills({ compact = false }) {
  const darkMode = typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || document.body.classList.contains("storefront-dark"));
  const items = [
    [sfText("storefront.checkout.trust.safeData"), <Check className="h-4 w-4" />],
    [sfText("storefront.checkout.trust.fastShipping"), <Truck className="h-4 w-4" />],
    [sfText("storefront.checkout.trust.exchange"), <PackageCheck className="h-4 w-4" />],
    [sfText("storefront.checkout.trust.whatsapp"), <MessageCircle className={`h-4 w-4 ${darkMode ? "text-white" : "text-[#d4af37]"}`} />],
  ];
  return (
    <div className={`sf-checkout-trust-pills grid grid-cols-2 gap-2 text-xs font-black text-white/70 ${compact ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
      {items.map(([label, icon]) => (
        <span key={label} className="sf-checkout-trust-pill inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.18)] backdrop-blur-xl">
          <span className="sf-checkout-trust-pill-icon text-[#f3d77a]">{icon}</span>
          <span className="sf-checkout-trust-pill-text truncate">{label}</span>
        </span>
      ))}
    </div>
  );
}

function SubmitButton({ submitting, compact = false, paymentMethod = "cod", disabled = submitting, label, variant = "primary" }) {
  const fallbackLabel = paymentMethod === "cod" ? sfText("storefront.checkout.actions.confirmOrder") : sfText("storefront.checkout.actions.uploadProofAndConfirm");
  const isSuccess = variant === "success";
  return (
    <button
      form="storefront-checkout-form"
      type="submit"
      disabled={disabled}
      className={`sf-checkout-submit-button ${isSuccess ? "sf-checkout-submit-button--success checkout-payment-confirm" : ""} sf-shimmer-button inline-flex items-center justify-center gap-2 rounded-full border font-black ${isSuccess ? "text-white" : "text-stone-950"} shadow-[0_18px_42px_rgba(212,175,55,0.24)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_54px_rgba(212,175,55,0.34)] active:translate-y-0 active:scale-[0.985] disabled:translate-y-0 disabled:text-white/55 disabled:shadow-none ${isSuccess ? "border-emerald-300/25 bg-[linear-gradient(135deg,rgba(22,163,74,0.96),rgba(5,46,22,0.98))] hover:border-emerald-200/40 hover:bg-[linear-gradient(135deg,rgba(34,197,94,0.98),rgba(4,120,87,0.98))]" : "border-[#d4af37]/20 bg-[linear-gradient(135deg,#d4af37,#e5c158)] hover:border-[#e5c158]/40 hover:bg-[linear-gradient(135deg,#e5c158,#d4af37)]"} ${compact ? "sf-checkout-submit-button--compact min-h-13 min-w-36 px-5 py-3 text-sm" : "min-h-14 w-full px-5 py-4"} ${disabled ? "border-white/10 bg-[#1a1a1a]" : ""}`}
    >
      {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
      <span>{submitting ? sfText("storefront.checkout.actions.confirming") : label || fallbackLabel}</span>
    </button>
  );
}

function CheckoutSection({ number, title, note, children, className = "", dir }) {
  return (
    <section dir={dir} className={`sf-reveal sf-checkout-section ${className} rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-4 text-white shadow-[0_22px_60px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl md:p-5`}>
      <div className="mb-3 flex items-start gap-3">
        <span className="sf-checkout-step-badge grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#e5c158]/25 bg-[#d4af37]/24 text-sm font-black text-white shadow-[0_12px_28px_rgba(212,175,55,0.20)]">{number}</span>
        <div>
          <h2 className="text-lg font-black text-white md:text-xl">{title}</h2>
          {note ? <p className="sf-checkout-note mt-1 text-xs font-bold text-white/56">{note}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function SuccessTimeline({ darkMode: darkModeProp } = {}) {
  const darkMode = typeof darkModeProp === "boolean"
    ? darkModeProp
    : typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || document.body.classList.contains("storefront-dark"));
  const steps = getStatusLabels();
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step} className={`sf-order-step sf-reveal rounded-2xl border p-3 ${index === 0 ? "sf-order-step--done border-emerald-200 bg-emerald-50" : index === 1 ? "sf-order-step--active border-amber-200 bg-amber-50" : "sf-order-step--pending border-stone-200 bg-stone-50"} ${darkMode ? "text-slate-900" : ""}`}>
          <div className={`sf-order-step-icon mb-2 grid h-8 w-8 place-items-center rounded-full ${index === 0 ? "bg-emerald-600 text-white" : index === 1 ? "bg-amber-400 text-white" : "bg-stone-200 text-stone-500"}`}>
            {index === 0 ? <Check className="h-4 w-4" /> : index === 1 ? "..." : index + 1}
          </div>
          <div className={`sf-order-step-label text-xs font-black leading-5 ${darkMode ? "text-slate-900" : ""}`}>{step}</div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, required, error, inputMode, placeholder, inputClassName = "", type = "text", autoComplete = "" }) {
  const inputStateClassName = error
    ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]"
    : "border-white/10 focus:border-[var(--sf-purple)] focus:shadow-[0_0_0_4px_rgba(212,175,55,0.12),0_18px_38px_rgba(15,23,42,0.18)]";
  return (
    <label className="sf-field sf-checkout-field block">
      <span className="sf-field-label sf-checkout-field-label mb-1.5 block text-sm font-black text-white/82">{label}{required ? " *" : ""}</span>
      <input type={type} autoComplete={autoComplete || undefined} required={required} inputMode={inputMode} placeholder={placeholder || ""} value={value} onChange={(event) => onChange(event.target.value)} className={`sf-field-input sf-checkout-field-input ${inputClassName} min-h-14 w-full rounded-[1.15rem] border bg-white/[0.045] px-4 text-[15px] font-bold text-white shadow-[0_14px_32px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:bg-white/[0.065] ${inputStateClassName}`} />
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-200">{error}</span> : null}
    </label>
  );
}

function TextField({ label, value, onChange, required, error, compact, placeholder, inputClassName = "" }) {
  const inputStateClassName = error
    ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]"
    : "border-white/10 focus:border-[var(--sf-purple)] focus:shadow-[0_0_0_4px_rgba(212,175,55,0.12),0_18px_38px_rgba(15,23,42,0.18)]";
  return (
    <label className="sf-checkout-field block md:col-span-2">
      <span className="sf-checkout-field-label mb-1.5 block text-sm font-black text-white/82">{label}{required ? " *" : ""}</span>
      <textarea required={required} placeholder={placeholder || ""} value={value} onChange={(event) => onChange(event.target.value)} rows={compact ? 2 : 3} className={`sf-field-input sf-checkout-field-input ${inputClassName} ${compact ? "sf-checkout-notes-textarea max-h-[90px]" : ""} w-full resize-y rounded-[1.15rem] border bg-white/[0.045] p-4 text-[15px] font-bold text-white shadow-[0_14px_32px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:bg-white/[0.065] ${inputStateClassName}`} />
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-200">{error}</span> : null}
    </label>
  );
}

function CityAreaField({ governorate, options, value, onChange, manual, onManualChange, required, error, themeMode = "light" }) {
  const selectOptions = [
    ...options.map((option) => ({ value: option, label: option })),
    { value: MANUAL_CITY_AREA_LABEL, label: MANUAL_CITY_AREA_LABEL },
  ];
  const darkMode = themeMode === "dark";
  const selectedOption = manual
    ? selectOptions[selectOptions.length - 1]
    : selectOptions.find((option) => option.value === value) || null;

  return (
    <div className="sf-checkout-field block">
      <span className={`sf-checkout-field-label mb-1.5 block text-sm font-black ${darkMode ? "text-white/82" : "text-slate-800"}`}>المدينة / المنطقة</span>
      <Suspense fallback={<CityAreaNativeSelect themeMode={themeMode} governorate={governorate} options={selectOptions} value={manual ? MANUAL_CITY_AREA_LABEL : value} onChange={onChange} required={required} error={error} />}>
        <Select
          instanceId="checkout-city-area"
          inputId="checkout-city-area"
          isRtl
          isSearchable
          isDisabled={!governorate}
          options={selectOptions}
          value={selectedOption}
          placeholder={
            governorate
              ? sfText("storefront.checkout.cityAreaPlaceholder")
              : sfText("storefront.checkout.chooseGovernorateFirst")
          }
          noOptionsMessage={() => sfText("storefront.common.noResults")}
          onChange={(option) => onChange(option?.value || "")}
          menuPortalTarget={typeof document !== "undefined" ? document.body : null}
          styles={{
            control: (base, state) => ({
              ...base,
              minHeight: 56,
              borderRadius: 16,
              backgroundColor: darkMode
                ? state.isFocused
                  ? "#151515"
                  : "#101010"
                : state.isFocused
                  ? "#151515"
                  : "#101010",
              borderColor: error
                ? "rgba(253,164,175,0.78)"
                : state.isFocused
                  ? "#d4af37"
                  : darkMode
                    ? "rgba(255,255,255,0.10)"
                    : "rgba(148,163,184,0.28)",
              boxShadow: state.isFocused
                ? "0 0 0 4px rgba(212,175,55,0.16),0 18px 38px rgba(212,175,55,0.16)"
                : darkMode
                  ? "0 12px 28px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)"
                  : "0 12px 28px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
              direction: "rtl",
              paddingInline: 4,
              transition: "all 200ms ease",
              "&:hover": { borderColor: error ? "#fb7185" : "#e5c158" },
            }),
            valueContainer: (base) => ({ ...base, paddingInline: 10 }),
            input: (base) => ({ ...base, color: "#ffffff", fontSize: 15, fontWeight: 700 }),
            singleValue: (base) => ({ ...base, color: "#ffffff", fontSize: 15, fontWeight: 700 }),
            placeholder: (base) => ({ ...base, color: "rgba(255,255,255,0.34)", opacity: 1, fontSize: 15, fontWeight: 700 }),
            dropdownIndicator: (base) => ({ ...base, color: "rgba(255,255,255,0.58)" }),
            indicatorSeparator: (base) => ({ ...base, backgroundColor: "rgba(255,255,255,0.10)" }),
            menu: (base) => ({ ...base, zIndex: 80, borderRadius: 16, overflow: "hidden", direction: "rtl", backgroundColor: "#101010", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 24px 60px rgba(0,0,0,0.42)" }),
            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
            option: (base, state) => ({
              ...base,
              backgroundColor: darkMode
                ? (state.isSelected ? "#d4af37" : state.isFocused ? "rgba(212,175,55,0.18)" : "#101010")
                : (state.isSelected ? "#d4af37" : state.isFocused ? "rgba(212,175,55,0.08)" : "#ffffff"),
              color: "#ffffff",
              cursor: "pointer",
              fontSize: 15,
              fontWeight: 800,
              padding: "12px 14px",
              textAlign: "right",
            }),
          }}
        />
      </Suspense>
      {manual ? (
        <input
          required={required}
          placeholder={sfText("storefront.checkout.cityAreaManualPlaceholder")}
          value={value}
          onChange={(event) => onManualChange(event.target.value)}
          className={`sf-field-input sf-checkout-field-input mt-2 min-h-14 w-full rounded-[1.15rem] border bg-white/[0.045] px-4 text-[15px] font-bold text-white shadow-[0_14px_32px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:border-[var(--sf-purple)] focus:bg-white/[0.065] focus:shadow-[0_0_0_4px_rgba(212,175,55,0.12),0_18px_38px_rgba(15,23,42,0.18)] ${error ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" : "border-white/10"}`}
        />
      ) : null}
      {error ? <span className={`mt-1.5 block text-xs font-black ${darkMode ? "text-rose-200" : "text-rose-600"}`}>{error}</span> : null}
    </div>
  );
}

function CityAreaNativeSelect({ governorate, options, value, onChange, required, error, themeMode = "light" }) {
  const darkMode = themeMode === "dark";
  return (
    <select
      required={required}
      disabled={!governorate}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      className={`sf-field-input sf-checkout-field-input min-h-14 w-full rounded-[1.15rem] border px-4 text-[15px] font-bold shadow-[0_14px_32px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 focus:-translate-y-0.5 focus:border-[var(--sf-purple)] focus:shadow-[0_0_0_4px_rgba(212,175,55,0.12),0_18px_38px_rgba(15,23,42,0.18)] disabled:opacity-60 ${darkMode ? "bg-white/[0.045] text-white placeholder:text-white/34 border-white/10 focus:bg-white/[0.065]" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-500 focus:bg-white"} ${error ? (darkMode ? "border-rose-300/70 focus:border-rose-300" : "border-rose-300/80 focus:border-rose-400") : ""}`}
    >
      <option value="" className={darkMode ? "bg-[#101010] text-white" : "bg-white text-slate-900"}>
        {governorate ? sfText("storefront.checkout.cityAreaPlaceholder") : sfText("storefront.checkout.chooseGovernorateFirst")}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value} className={darkMode ? "bg-[#101010] text-white" : "bg-white text-slate-900"}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SelectField({ label, value, onChange, options, labels = {}, required, error, themeMode = "light" }) {
  const darkMode = themeMode === "dark";
  return (
    <label className="block">
      <span className={`mb-1.5 block text-sm font-black ${darkMode ? "text-white/82" : "text-slate-800"}`}>{label}{required ? " *" : ""}</span>
      <select required={required} value={value} onChange={(event) => onChange(event.target.value)} className={`sf-field-input sf-checkout-field-input min-h-14 w-full rounded-[1.15rem] border px-4 text-[15px] font-bold shadow-[0_14px_32px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 focus:-translate-y-0.5 focus:border-[var(--sf-purple)] focus:shadow-[0_0_0_4px_rgba(212,175,55,0.12),0_18px_38px_rgba(15,23,42,0.18)] ${darkMode ? "bg-white/[0.045] text-white placeholder:text-white/34 border-white/10 focus:bg-white/[0.065]" : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-500 focus:bg-white"} ${error ? (darkMode ? "border-rose-300/70 focus:border-rose-300" : "border-rose-300/80 focus:border-rose-400") : ""}`}>
        <option value="" className={darkMode ? "bg-[#101010] text-white" : "bg-white text-slate-900"}>{sfText("storefront.common.choose")}</option>
        {options.map((option) => <option key={option} value={option} className={darkMode ? "bg-[#101010] text-white" : "bg-white text-slate-900"}>{labels[option] || option}</option>)}
      </select>
      {error ? <span className={`mt-1.5 block text-xs font-black ${darkMode ? "text-rose-200" : "text-rose-600"}`}>{error}</span> : null}
    </label>
  );
}

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return isMobile;
}

const CheckoutLocationPicker = memo(function CheckoutLocationPicker({
  label,
  mobileTitle,
  value,
  onChange,
  options = [],
  loading = false,
  required = false,
  disabled = false,
  error = "",
  placeholder = "",
  searchPlaceholder = "",
  emptyText = sfText("storefront.common.noResults"),
  loadingText = sfText("storefront.common.loading"),
  helperText = "",
  themeMode = "light",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const isMobile = useIsMobileViewport();
  const darkMode = themeMode === "dark";
  const selectedOption = useMemo(() => options.find((option) => String(option.id) === String(value)) || null, [options, value]);
  const deferredQuery = useDeferredValue(query);
  const filteredOptions = useMemo(() => {
    const search = normalizeCheckoutPickerText(deferredQuery);
    if (!search) return options;
    return options.filter((option) => option.searchText.includes(search));
  }, [deferredQuery, options]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open || !isMobile || typeof document === "undefined") return undefined;
    const { body } = document;
    const previousPosition = body.style.position;
    const previousOverflow = body.style.overflow;
    const previousTop = body.style.top;
    const previousWidth = body.style.width;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = previousPosition;
      body.style.top = previousTop;
      body.style.width = previousWidth;
      body.style.overflow = previousOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [isMobile, open]);

  useEffect(() => {
    if (!open || !inputRef.current || !isMobile) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }, [open, isMobile]);

  useDismissableLayer({
    enabled: open && !isMobile,
    refs: [containerRef],
    onDismiss: () => setOpen(false),
  });

  const close = () => setOpen(false);
  const chooseOption = (option) => {
    if (!option || disabled) return;
    onChange(option.id);
    close();
  };
  const triggerLabel = selectedOption?.label || (loading ? loadingText : placeholder || sfText("storefront.common.choose"));
  const isBlocked = disabled;
  const panelTitle = mobileTitle || label;
  const searchHint = searchPlaceholder || sfText("storefront.checkout.searchLocations");
  const mobilePortalTarget = typeof document !== "undefined" ? document.body : null;

  const panelBody = (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {loading ? (
        <div className={`flex min-h-24 items-center justify-center rounded-[1rem] border px-4 py-4 text-sm font-bold ${darkMode ? "border-white/10 bg-white/[0.03] text-white/62" : "border-slate-300 bg-white text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"}`}>
          <Loader2 className={`mr-2 h-4 w-4 animate-spin ${darkMode ? "text-[#f3d77a]" : "text-[#d4af37]"}`} />
          {loadingText}
        </div>
      ) : filteredOptions.length ? (
        <VirtualList
          items={filteredOptions}
          estimateSize={56}
          className="checkout-picker-list max-h-[260px] min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
          itemKey={(option) => option.id}
          renderItem={(option) => {
            const selected = String(option.id) === String(value);
            return (
              <button
                type="button"
                onClick={() => chooseOption(option)}
                className={`group mb-1.5 flex w-full items-center gap-2.5 rounded-[14px] border px-3 py-2.5 text-right transition duration-150 ${ selected ? darkMode ? "border-[#e5c158]/30 bg-[#d4af37]/10" : "border-[#f3d77a] bg-[#f5f3ff]" : darkMode ? "border-white/10 bg-white/[0.025] hover:border-[#e5c158]/22 hover:bg-white/[0.045]" : "border-slate-300 bg-white hover:border-[#e5c158]/30 hover:bg-[#faf5ff]" }`}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition ${selected ? (darkMode ? "border-[#f3d77a] bg-[#d4af37]/90 text-white" : "border-[#d4af37] bg-[#d4af37] text-white") : (darkMode ? "border-white/14 bg-white/[0.03] text-transparent group-hover:border-[#e5c158]/45" : "border-slate-300 bg-white text-transparent group-hover:border-[#d4af37]/35")}`}>
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-black ${darkMode ? "text-white" : "text-slate-900"}`}>{option.label}</span>
                  {option.secondary ? <span className={`mt-0.5 block truncate text-[11px] font-semibold leading-4 ${darkMode ? "text-white/42" : "text-slate-500"}`}>{option.secondary}</span> : null}
                </span>
              </button>
            );
          }}
        />
      ) : (
        <div className={`flex min-h-24 items-center justify-center rounded-[1rem] border px-4 py-4 text-sm font-black ${darkMode ? "border-white/10 bg-white/[0.03] text-white/62" : "border-slate-300 bg-white text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"}`}>
          {emptyText}
        </div>
      )}
    </div>
  );

  return (
    <div ref={containerRef} className="relative block">
      <span className={`mb-1.5 block text-sm font-black ${darkMode ? "text-white/82" : "text-slate-800"}`}>{label}{required ? " *" : ""}</span>
      <button
        type="button"
        onClick={() => !isBlocked && setOpen((current) => !current)}
        disabled={isBlocked}
        className={`flex min-h-[48px] w-full items-center gap-3 rounded-[16px] border px-3.5 text-right text-sm font-bold outline-none backdrop-blur transition duration-150 focus:border-[#d4af37] focus:shadow-[0_0_0_3px_rgba(212,175,55,0.12),0_12px_28px_rgba(212,175,55,0.10)] disabled:cursor-not-allowed disabled:opacity-65 ${darkMode ? `bg-white/[0.045] text-white shadow-[0_10px_22px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.03)] focus:bg-white/[0.065] ${error ? "border-rose-300/70 focus:border-rose-300" : "border-white/10"}` : `bg-white text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.92)] focus:bg-white ${error ? "border-rose-300/80 focus:border-rose-400" : "border-slate-300"}`}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-start">{triggerLabel}</span>
        {loading ? <Loader2 className={`h-4 w-4 shrink-0 animate-spin ${darkMode ? "text-[#f3d77a]" : "text-[#d4af37]"}`} /> : <ChevronLeft className={`h-4 w-4 shrink-0 transition ${darkMode ? "text-white/60" : "text-slate-600"} ${open ? "rotate-[-90deg]" : ""}`} />}
      </button>
      {helperText ? <p className={`sf-checkout-picker-text mt-1.5 text-xs font-bold ${darkMode ? "text-white/46" : "text-slate-500"}`}>{helperText}</p> : null}
      {error ? <span className={`mt-1.5 block text-xs font-black ${darkMode ? "text-rose-200" : "text-rose-600"}`}>{error}</span> : null}

      {open ? (
        isMobile ? (
          mobilePortalTarget ? createPortal(
            <div
              className="fixed inset-0 z-[100000] bg-black/65 backdrop-blur-sm"
              onClick={close}
              role="presentation"
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-label={typeof panelTitle === "string" ? panelTitle : undefined}
                onClick={(event) => event.stopPropagation()}
                className={`fixed inset-auto bottom-0 left-0 right-0 flex max-h-[75vh] flex-col overflow-hidden rounded-t-[1.5rem] border border-white/10 px-3 pt-3 shadow-[0_-28px_80px_rgba(0,0,0,0.48)] ${ darkMode ? "bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] text-white" : "bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] text-white" }`}
              >
                <div className="sticky top-0 z-20 border-b border-white/10 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className={`min-w-0 truncate text-sm font-black ${darkMode ? "text-white" : "text-slate-900"}`}>{panelTitle}</div>
                    <button
                      type="button"
                      onClick={close}
                      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition ${ darkMode ? "border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08] hover:text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950" }`}
                      aria-label={sfText("storefront.common.close")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="sticky top-[3.35rem] z-10 pt-3">
                  <div className="checkout-picker-search-wrap">
                    <label className={`checkout-picker-search flex items-center gap-2 ${darkMode ? "" : "border border-slate-300 bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"}`}>
                      <Search className={`h-4 w-4 shrink-0 ${darkMode ? "text-white/42" : "text-slate-600"}`} />
                      <input
                        ref={inputRef}
                        dir="rtl"
                        lang="ar"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={searchHint}
                        className={"min-w-0 flex-1 bg-transparent text-right text-sm font-bold outline-none " + (darkMode ? "text-white placeholder:text-white/34" : "text-slate-900 placeholder:text-slate-500")}
                      />
                      {query ? (
                        <button type="button" onClick={() => setQuery("")} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition ${darkMode ? "border-white/10 bg-white/[0.04] text-white/52 hover:bg-white/[0.08] hover:text-white" : "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`} aria-label={sfText("storefront.common.clear")}>
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </label>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+0.9rem)] pt-2">
                  {panelBody}
                </div>
              </section>
            </div>,
            mobilePortalTarget
          ) : null
        ) : (
          <div className={`absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-[16px] border p-2.5 backdrop-blur-2xl ${darkMode ? "border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] text-white shadow-[0_18px_46px_rgba(0,0,0,0.28)]" : "border-slate-300 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] text-white shadow-[0_18px_46px_rgba(15,23,42,0.14)]"}`}>
            {panelBody}
          </div>
        )
      ) : null}
    </div>
  );
});

function ProductCardSkeleton() {
  return (
    <article className="overflow-hidden rounded-[1.2rem] border border-white/70 bg-white shadow-[0_10px_26px_rgba(39,20,75,0.07)] ring-1 ring-stone-200/55 dark:border-white/[0.08] dark:bg-[linear-gradient(145deg,rgba(5,5,5,0.98),rgba(17,17,17,0.95)_52%,rgba(21,21,21,0.98))] dark:ring-white/[0.05]">
      <div className="relative aspect-[0.96/1] p-1.5">
        <div className="sf-skeleton-shimmer h-full rounded-[1rem] bg-stone-200/80 dark:bg-white/[0.04]" />
      </div>
      <div className="space-y-2 p-2.5 pt-2">
        <div className="sf-skeleton-shimmer h-5 w-[88%] rounded-full bg-stone-200/80 dark:bg-white/[0.04]" />
        <div className="sf-skeleton-shimmer h-4 w-2/3 rounded-full bg-stone-200/80 dark:bg-white/[0.04]" />
        <div className="flex gap-1.5 overflow-hidden">
          <div className="sf-skeleton-shimmer h-6 w-10 rounded-full bg-stone-200/80 dark:bg-white/[0.04]" />
          <div className="sf-skeleton-shimmer h-6 w-10 rounded-full bg-stone-200/80 dark:bg-white/[0.04]" />
          <div className="sf-skeleton-shimmer h-6 w-10 rounded-full bg-stone-200/80 dark:bg-white/[0.04]" />
        </div>
      </div>
    </article>
  );
}

function ProductSkeleton({ count, className = "grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-5" }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, index) => (
        <ProductCardSkeleton key={index} />
      ))}
    </div>
  );
}

function StorefrontPageFallback() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <div className="grid gap-4">
        <div className="sf-skeleton-shimmer h-28 rounded-[1.75rem] bg-white/80 shadow-[0_12px_32px_rgba(39,20,75,0.05)] dark:bg-[linear-gradient(180deg,#050505_0%,#101010_100%)]" />
        <div className="sf-skeleton-shimmer h-64 rounded-[1.75rem] bg-white/80 shadow-[0_12px_32px_rgba(39,20,75,0.05)] dark:bg-[linear-gradient(180deg,#050505_0%,#101010_100%)]" />
      </div>
    </section>
  );
}


function ProductGalleryFallback() {
  return (
    <div className="min-w-0">
      <div className="mx-auto h-[clamp(250px,42vh,340px)] w-full max-w-[92vw] animate-pulse rounded-[24px] bg-white/80 shadow-[0_14px_40px_rgba(39,20,75,0.10)] md:h-[clamp(420px,58vh,540px)] md:max-w-none md:rounded-[1.75rem] dark:bg-[linear-gradient(180deg,#050505_0%,#101010_100%)]" />
      <div className="mt-3 flex gap-2">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-12 w-12 animate-pulse rounded-xl bg-white/80 dark:bg-[linear-gradient(180deg,#050505_0%,#101010_100%)] md:h-20 md:w-20 md:rounded-2xl" />)}
      </div>
    </div>
  );
}

function EmptyState({ title, text, actionTo = "/products", actionLabel }) {
  return (
    <div className="sf-empty-state mx-auto mt-6 mb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.5rem)] max-w-xl rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] p-6 text-center text-stone-50 shadow-[0_22px_56px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl md:mb-6 md:p-7">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-[var(--sf-purple)]/25 bg-[rgba(212,175,55,0.12)] text-[var(--sf-purple)] shadow-[0_14px_34px_rgba(212,175,55,0.14)]">
        <PackageSearch className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-2xl font-black text-stone-50">{title}</h2>
      <p className="mx-auto mt-2 max-w-md font-bold leading-7 text-white/60">{text}</p>
      <Link to={actionTo} className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full border border-white/10 bg-[linear-gradient(135deg,var(--sf-purple),var(--sf-purple-2))] px-5 py-3 text-sm font-black text-stone-950 shadow-[0_16px_36px_rgba(212,175,55,0.20)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_44px_rgba(212,175,55,0.28)] active:scale-[0.98]">
        {actionLabel || sfText("storefront.common.shopNow")}
      </Link>
    </div>
  );
}

function CartDrawer({ open, onClose, cart, updateCart, removeFromCart }) {
  useBodyScrollLock(open);
  useEffect(() => {
    if (open && cart.length) trackGa4ViewCart(cart);
  }, [cart, open]);
  if (!open) return null;
  const subtotal = cart.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  const total = subtotal;
  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} aria-label={sfText("storefront.common.close")} />
      <aside dir="rtl" className="sf-cart-drawer absolute inset-x-0 bottom-0 flex max-h-[94dvh] min-h-[72dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[2rem] border border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] text-white shadow-[0_-28px_80px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:min-h-0 md:w-[28rem] md:rounded-s-[2rem] md:rounded-tr-none">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.035] px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-black text-[#f3d77a]">{cart.length ? sfText("storefront.products.productCount", undefined, { count: cart.length }) : "Your cart is empty"}</p>
            <h2 className="mt-1 truncate text-2xl font-black text-white">Cart</h2>
          </div>
          <button onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.065] text-white/74 shadow-[0_12px_28px_rgba(0,0,0,0.24)] transition hover:bg-white/[0.10] hover:text-white active:scale-95" aria-label={sfText("storefront.common.close")}><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">
          {!cart.length ? (
            <EmptyState title="Your cart is empty" text="Add items to your cart to see them here." actionLabel="Browse products" />
          ) : (
            <div className="grid gap-3 pb-2">
              {cart.map((item) => (
                <MobileCartRow key={item.lineId} item={item} updateCart={updateCart} removeFromCart={removeFromCart} />
              ))}
            </div>
          )}
        </div>
        {cart.length ? (
          <div dir="rtl" className="sf-cart-drawer-footer shrink-0 border-t border-white/10 bg-[linear-gradient(180deg,#050505_0%,#101010_45%,#151515_100%)] px-4 pb-[calc(1.35rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-24px_60px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:px-5">
            <div className="mb-3 flex items-end justify-between gap-3 text-right">
              <div className="sf-cart-drawer-total">
                <p className="text-xs font-black text-white/54">{sfText("storefront.checkout.total")}</p>
                <p className="mt-1 text-2xl font-black leading-none text-white">{money(total)}</p>
              </div>
              <p className="max-w-32 text-start text-[11px] font-bold leading-5 text-white/46">{sfText("storefront.checkout.finalShippingAtCheckout")}</p>
            </div>
            <Link to="/checkout" onClick={onClose} className="sf-cart-drawer-checkout-button sf-shimmer-button block min-h-14 rounded-full border border-[#d4af37]/20 bg-[linear-gradient(135deg,#d4af37,#e5c158)] px-5 py-4 text-center text-base font-black text-stone-950 shadow-[0_18px_42px_rgba(212,175,55,0.26)] transition hover:-translate-y-0.5 hover:border-[#e5c158]/40 hover:shadow-[0_22px_54px_rgba(212,175,55,0.34)] active:translate-y-0 active:scale-[0.98]">
              {sfText("storefront.checkout.actions.completePurchase")}
            </Link>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function MobileCartRow({ item, updateCart, removeFromCart }) {
  return (
    <article dir="rtl" className="sf-cart-row w-full min-w-0 rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,#101010_0%,#151515_100%)] p-3 text-right text-white shadow-[0_16px_42px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl">
      <div className="flex min-w-0 items-start gap-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/[0.065] ring-1 ring-white/10">
          <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" width="80" height="80" />
        </div>
        <div className="min-w-0 flex-1 self-stretch">
          <h3 className="line-clamp-2 break-words text-sm font-black leading-5 text-white">{item.name}</h3>
          <p className="mt-1 inline-flex max-w-full rounded-full border border-white/10 bg-white/[0.055] px-2 py-1 text-xs font-bold text-white/58">{item.color || sfText("storefront.products.color")} / {item.display_size || item.size || sfText("storefront.products.size")}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-black text-white">
            {displayCartItemComparePrice(item) ? <span className="text-xs text-white/38 line-through">{money(displayCartItemComparePrice(item))}</span> : null}
            <span>{money(displayCartItemPrice(item))}</span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
        <QuantityStepper quantity={item.quantity} onMinus={() => updateCart(item.lineId, item.quantity - 1)} onPlus={() => updateCart(item.lineId, item.quantity + 1)} />
        <button onClick={() => removeFromCart(item.lineId)} className="sf-cart-remove-button grid h-11 w-11 shrink-0 place-items-center rounded-full border border-rose-300/20 bg-rose-500/10 text-rose-200 shadow-[0_10px_24px_rgba(244,63,94,0.10)] transition hover:bg-rose-500/16 hover:text-rose-100 active:scale-95" aria-label="Remove item">
          <Trash2 className="h-5 w-5" />
        </button>
      </div>
    </article>
  );
}

function QuantityStepper({ quantity, onMinus, onPlus }) {
  return (
    <div className="sf-quantity-stepper sf-cart-quantity-stepper inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/20 p-1 shadow-inner shadow-black/30">
      <button onClick={onMinus} className="sf-cart-quantity-button grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.065] text-white/78 shadow-sm transition hover:bg-white/[0.10] hover:text-white active:scale-95" aria-label={sfText("storefront.cart.decreaseQuantity")}>
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-9 px-1 text-center text-sm font-black tabular-nums text-white">{quantity}</span>
      <button onClick={onPlus} className="sf-cart-quantity-button grid h-9 w-9 place-items-center rounded-full border border-[#e5c158]/30 bg-[#d4af37]/24 text-white shadow-[0_10px_22px_rgba(212,175,55,0.16)] transition hover:bg-[#d4af37]/34 active:scale-95" aria-label={sfText("storefront.cart.increaseQuantity")}>
        +
      </button>
    </div>
  );
}



function MobileBottomNav({ onHome = () => {}, themeMode = "dark" }) {
  const { i18n: storefrontI18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const mobilePortalTarget = typeof document !== "undefined" ? document.body : null;
  const path = location.pathname || "";
  const currentLanguage = normalizeLanguage(storefrontI18n.resolvedLanguage || storefrontI18n.language || "en");
  const isRtl = currentLanguage === "ar";
  const isDarkMode = themeMode === "dark";
  const isCheckoutFlow = isStorefrontCheckoutFlowPath(path);
  const isVisible = isStorefrontPath(path) && !isCheckoutFlow;
  const saleHref = storefrontPath("/offers");
  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const handleHomeClick = useCallback((event) => {
    event.preventDefault();
    if (!isStorefrontHomePath(path)) {
      navigate(storefrontPath("/"));
      requestAnimationFrame(() => requestAnimationFrame(scrollToTop));
      return;
    }
    scrollToTop();
  }, [navigate, path, scrollToTop]);
  const categoryLinks = [
    { id: "men", label: isRtl ? "رجالي" : "Men", to: "/men", icon: Users },
    { id: "women", label: isRtl ? "حريمي" : "Women", to: "/women", icon: Users },
    { id: "kids", label: isRtl ? "أطفال" : "Kids", to: "/kids", icon: Baby },
    { id: "bags", label: getProductTypeLabel("bags", currentLanguage), to: "/bags", icon: ShoppingBag },
    { id: "crocs", label: getProductTypeLabel("crocs", currentLanguage), to: "/crocs", icon: Footprints },
    { id: "slippers", label: getProductTypeLabel("slippers", currentLanguage), to: "/slippers", icon: SlidersHorizontal },
  ];
  const links = [
    { id: "home", to: "/", label: isRtl ? "الرئيسية" : "Home", icon: Home },
    { id: "categories", label: isRtl ? "الأقسام" : "Categories", icon: Grid2x2, action: "categories" },
    { id: "sale", to: saleHref, label: isRtl ? "العروض" : "Offers", icon: Tag },
    { id: "wishlist", to: "/wishlist", label: isRtl ? "المفضلة" : "Wishlist", icon: Heart },
    { id: "account", to: "/account", label: isRtl ? "حسابي" : "Account", icon: UserRound },
  ];
  const isActive = (item) => {
    if (item.id === "home") return isStorefrontHomePath(path);
    if (item.id === "categories") return isStorefrontProductsPath(path) || categoriesOpen;
    if (item.id === "sale") return isStorefrontOfferPath(path);
    if (item.id === "wishlist") return normalizePathname(path) === "/wishlist";
    if (item.id === "account") return normalizePathname(path) === "/account";
    return false;
  };

  useEffect(() => {
    if (!categoriesOpen || typeof document === "undefined") return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [categoriesOpen]);

  useEffect(() => {
    if (categoriesOpen) setCategoriesOpen(false);
  }, [location.pathname, location.search]);

  if (!isVisible) return null;

  const categoriesSheet = categoriesOpen && mobilePortalTarget ? createPortal(
    <div className="sf-mobile-categories-sheet fixed inset-0 z-[120] md:hidden" data-theme={isDarkMode ? "dark" : "light"} dir={isRtl ? "rtl" : "ltr"} role="dialog" aria-modal="true" aria-label={isRtl ? "الأقسام" : "Categories"}>
      <button type="button" className="sf-mobile-categories-sheet__backdrop absolute inset-0" aria-label={isRtl ? "إغلاق الأقسام" : "Close categories"} onClick={() => setCategoriesOpen(false)} />
      <div className="sf-mobile-categories-sheet__panel absolute inset-x-0 bottom-0 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <div className="sf-mobile-categories-sheet__header mx-auto flex max-w-[28rem] items-center justify-between gap-3">
          <div>
            <p className="sf-mobile-categories-sheet__eyebrow text-[10px] font-black uppercase tracking-[0.22em]">{isRtl ? "الأقسام" : "Categories"}</p>
            <h3 className="sf-mobile-categories-sheet__title mt-0.5 text-base font-black">{isRtl ? "تصفح الأقسام" : "Browse categories"}</h3>
          </div>
          <button type="button" onClick={() => setCategoriesOpen(false)} className="sf-mobile-categories-sheet__close grid h-10 w-10 place-items-center rounded-full transition active:scale-[0.98]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="sf-mobile-categories-sheet__list mx-auto mt-3 grid max-w-[28rem] gap-2">
          {categoryLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                to={item.to}
                onClick={() => setCategoriesOpen(false)}
                className="sf-mobile-categories-sheet__item flex items-center gap-3 rounded-[1rem] px-3 py-3.5 text-sm font-black transition active:scale-[0.99]"
              >
                <span className="sf-mobile-categories-sheet__icon grid h-9 w-9 shrink-0 place-items-center rounded-full">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <span className="flex-1">{item.label}</span>
                <ChevronLeft className="sf-mobile-categories-sheet__chevron h-4 w-4" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>,
    mobilePortalTarget
  ) : null;

  return (
    <>
      {categoriesSheet}
      <nav
        dir={isRtl ? "rtl" : "ltr"}
        className="sf-mobile-bottom-nav fixed left-1/2 z-[110] md:hidden"
        style={{ bottom: "calc(8px + env(safe-area-inset-bottom))", width: "calc(100% - 40px)", maxWidth: "410px", transform: "translateX(-50%)" }}
        data-theme={isDarkMode ? "dark" : "light"}
        aria-label={sfText("storefront.nav.mobileNavigation")}
      >
        <div className="mx-auto">
          <div className="sf-mobile-bottom-nav__surface flex items-center justify-evenly overflow-hidden rounded-[1.3rem] px-1">
            {links.map((item) => {
              const active = isActive(item);
              const Icon = item.icon;
              const baseClass = [
                "sf-mobile-bottom-nav__item group relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[0.95rem] px-0.5 text-[8.5px] leading-none transition duration-200 ease-out active:scale-[0.96]",
                active ? "is-active" : "",
              ].join(" ");
              const content = (
                <>
                  <span className="sf-mobile-bottom-nav__icon grid h-7 w-7 place-items-center rounded-[0.65rem] transition duration-200">
                    <Icon className="sf-mobile-bottom-nav__svg h-[19px] w-[19px]" strokeWidth={2.45} aria-hidden="true" />
                  </span>
                  <span className="sf-mobile-bottom-nav__label max-w-full min-w-[2.45rem] truncate text-center text-[8.5px] font-black">{item.label}</span>
                </>
              );
              if (item.action === "categories") {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCategoriesOpen(true)}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                    className={baseClass}
                  >
                    {content}
                  </button>
                );
              }
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={baseClass}
                  onClick={item.id === "home" ? handleHomeClick : onHome}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}

function SummaryRow({ label, value, strong, dark = false, rtl = false }) {
  if (dark) {
    return <div className={`sf-summary-row flex items-center justify-between gap-3 ${rtl ? "flex-row-reverse text-right" : ""} ${strong ? "mt-3 border-t border-white/10 pt-3 text-xl font-black text-white" : "mt-2 text-sm font-bold text-white/58"}`}><span className="sf-summary-row-label">{label}</span><span className={`sf-summary-row-value ${strong ? "rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-white shadow-[0_10px_24px_rgba(0,0,0,0.20)]" : "font-black text-white"}`}>{value}</span></div>;
  }
  return <div className={`sf-summary-row flex items-center justify-between gap-3 ${rtl ? "flex-row-reverse text-right" : ""} ${strong ? "mt-3 border-t border-stone-200/80 pt-3 text-xl font-black text-stone-950" : "mt-2 text-sm font-bold text-stone-600"}`}><span className="sf-summary-row-label">{label}</span><span className={`sf-summary-row-value ${strong ? "rounded-full border border-stone-200/80 bg-white px-3 py-1 shadow-[0_8px_18px_rgba(15,23,42,0.06)]" : "font-black text-stone-800"}`}>{value}</span></div>;
}



function PaymentBrandLogo({ method, size = "tab", active = false, label, logoUrl }) {
  const [failed, setFailed] = useState(false);
  const logo = paymentBrandLogos[method] || {};
  const fallbackLabel = label || (method === "vodafone_cash" ? "Vodafone Cash" : method === "instapay" ? "InstaPay" : "Payment");
  const isCopy = size === "copy";
  const containerClass = isCopy
    ? "grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white shadow-[0_14px_30px_rgba(0,0,0,0.20)] sm:h-14 sm:w-14"
    : `grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white shadow-[0_12px_30px_rgba(0,0,0,0.20)] transition duration-300 ${active ? "scale-105" : "opacity-80 group-hover:opacity-100"}`;
  const imageClass = isCopy ? "h-7 w-7 object-contain sm:h-8 sm:w-8" : "h-8 w-8 object-contain";

  return (
    <span className={containerClass}>
      {failed ? (
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#151515] text-xs font-black text-white">
          {label.slice(0, 1)}
        </span>
      ) : (
        <picture>
          {logoUrl ? null : logo.webp ? <source srcSet={logo.webp} type="image/webp" /> : null}
          {logoUrl ? null : logo.png ? <source srcSet={logo.png} type="image/png" /> : null}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={fallbackLabel}
              className={imageClass}
              decoding="async"
              width="32"
              height="32"
              onError={() => setFailed(true)}
            />
          ) : (
            <img
              src={logo.png}
              alt={fallbackLabel}
              className={imageClass}
              decoding="async"
              width="32"
              height="32"
              onError={() => setFailed(true)}
            />
          )}
        </picture>
      )}
    </span>
  );
}


function InfoBox({ label, value, darkMode: darkModeProp } = {}) {
  const darkMode = typeof darkModeProp === "boolean"
    ? darkModeProp
    : typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || document.body.classList.contains("storefront-dark"));
  return <div className="sf-info-box sf-checkout-info-box mt-3 rounded-2xl bg-stone-50 p-4"><div className={`sf-info-label text-xs font-bold ${darkMode ? "text-slate-700" : "text-stone-500"}`}>{label}</div><div className={`sf-info-value mt-1 font-black ${darkMode ? "text-slate-900" : ""}`}>{value}</div></div>;
}

function Panel({ title, children }) {
  return <div className="sf-panel sf-checkout-panel rounded-[1.75rem] border border-stone-200/80 bg-white/96 p-5 shadow-[0_18px_42px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-white/[0.045] dark:shadow-[0_22px_54px_rgba(0,0,0,0.26)]"><h2 className="sf-section-heading mb-3 text-xl font-black">{title}</h2><div className="grid gap-2.5">{children}</div></div>;
}

function SmallProductList({ items, empty = sfText("storefront.common.noResults") }) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return <p className="sf-muted-empty font-bold text-stone-500">{empty}</p>;
  return safeItems.slice(0, 6).map((item) => {
    const product = normalizeWishlistProduct(item);
    return (
      <Link key={product.id || product.slug} to={`/product/${product.slug || product.id}`} className="sf-small-product-row sf-storefront-card flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3">
        <img src={imageFor(product.image_url)} onError={fallbackProductImage} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" decoding="async" width="48" height="48" />
        <span className="sf-small-product-name truncate font-black">{product.name || sfText("storefront.products.savedProduct")}</span>
      </Link>
    );
  });
}

function SmallProductGrid({ items, action, onAddToCart }) {
  const normalizedItems = (Array.isArray(items) ? items : []).map(normalizeWishlistProduct).filter((item) => item.id);
  const addWishlistItemToCart = async (item) => {
    if (!onAddToCart) return;
    try {
      const data = await api.get(`/storefront/products/${item.id}`);
      const product = productFromDetailsResponse(data);
      const variant = product?.variants?.find((candidate) => Number(candidate.stock || 0) > 0);
      if (!product || !variant) {
      toast.error(sfText("storefront.toasts.sizeUnavailable"));
        return;
      }
      onAddToCart(product, variant, 1);
    } catch {
      toast.error(sfText("storefront.toasts.addFailed"));
    }
  };

  return (
    <div className="mt-6 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {normalizedItems.map((item) => (
        <div key={item.id} className={`sf-storefront-card sf-small-product-card group min-w-0 overflow-hidden rounded-[1.7rem] border border-white/[0.08] bg-[linear-gradient(180deg,#050505_0%,#101010_40%,#151515_100%)] shadow-[0_22px_60px_rgba(0,0,0,0.34)] ring-1 ring-white/[0.03] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-[#d4af37]/25 hover:shadow-[0_30px_80px_rgba(0,0,0,0.44)] active:translate-y-[1px] active:scale-[0.996] touch-manipulation ${item.unavailable ? "flex min-h-[430px] flex-col p-4" : "flex min-h-[460px] flex-col p-3.5"}`}>
          {item.unavailable ? (
            <div className="flex flex-1 flex-col justify-center rounded-[1.25rem] border border-rose-300/15 bg-gradient-to-br from-rose-500/10 to-white/[0.04] p-4 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-rose-300/20 bg-rose-400/10 text-rose-300 shadow-[0_12px_30px_rgba(244,63,94,0.12)]">
                <Heart className="h-5 w-5" />
              </span>
              <div className="mt-3 text-base font-black text-white">{sfText("storefront.products.unavailableNow")}</div>
              <p className="mt-1 text-xs font-bold leading-5 text-white/50">{sfText("storefront.products.openForDetails")}</p>
            </div>
          ) : (
            <Link to={`/product/${item.slug || item.id}`} className="flex min-h-0 flex-1 flex-col">
              <div className="aspect-[4/5] w-full overflow-hidden rounded-[1.15rem] border border-white/70 bg-gradient-to-br from-stone-50 via-white to-stone-100 p-2.5 shadow-inner shadow-stone-200/70">
                <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt={item.name || ""} className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03] group-active:scale-[1.01]" loading="lazy" decoding="async" width="320" height="400" />
              </div>
              <div className="mt-4 line-clamp-2 min-h-12 break-words text-start text-[15px] font-black leading-6 text-white">{item.name || sfText("storefront.products.savedProduct")}</div>
              <div className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-start text-sm font-black text-white">
                {item.price ? <span className="text-[1.05rem] text-[#f3d77a]">{money(item.price)}</span> : <span className="text-sm font-bold text-white/50">{sfText("storefront.products.openForDetails")}</span>}
                {displayComparePrice(item) > Number(item.price || 0) ? <span className="text-xs font-bold text-white/40 line-through">{money(displayComparePrice(item))}</span> : null}
              </div>
            </Link>
          )}
          <div className="mt-3 grid gap-2">
            {onAddToCart && !item.unavailable ? <button type="button" onClick={() => addWishlistItemToCart(item)} className="sf-wishlist-add-button min-h-12 rounded-full bg-gradient-to-l from-[#d4af37] via-[#e5c158] to-[#111111] px-4 py-3 text-sm font-black text-white shadow-[0_14px_34px_rgba(212,175,55,0.3)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(212,175,55,0.38)] active:translate-y-[1px] active:scale-[0.99] touch-manipulation">{sfText("storefront.cart.addToCart")}</button> : null}
            {action ? <button type="button" onClick={() => action(item)} className="sf-wishlist-remove-button min-h-11 rounded-full border border-white/[0.1] bg-white/[0.045] px-4 py-2 text-sm font-black text-rose-200 transition duration-200 hover:border-rose-400/70 hover:bg-rose-500 hover:text-white active:translate-y-[1px] active:scale-[0.99] touch-manipulation">{item.unavailable ? sfText("storefront.wishlist.removeFromWishlist") : sfText("storefront.common.remove")}</button> : null}
          </div>
        </div>
      ))}
    </div>
  );
}


function MobileBuyBar({ product, variant, visible, onAddToCart }) {
  const disabled = !variant || Number(variant.stock || 0) <= 0;
  if (!visible) return null;
  return (
    <div
      dir="rtl"
      className="sf-mobile-buy-bar fixed inset-x-3 z-[52] mx-auto max-w-md rounded-[1rem] px-3 py-3 text-white transition md:hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="sf-mobile-buy-bar-meta min-w-0">
          <div className="truncate text-xs font-black text-white">{cleanDisplayText(product.name)}</div>
          <div className="mt-0.5 text-sm font-black text-white">{money(displaySellingPrice(product, variant))}</div>
        </div>
        <button onClick={onAddToCart} disabled={disabled} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-l from-[#d4af37] to-[#111111] px-4 py-3 text-sm font-black text-stone-950 shadow-[0_18px_42px_rgba(212,175,55,0.34)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#d4af37]/35 disabled:text-white/60 disabled:shadow-none">
          <ShoppingCart className="h-4 w-4" />
          {sfText("storefront.cart.addToCart")}
        </button>
      </div>
    </div>
  );
}

function Confetti() {
  return <div className="pointer-events-none absolute inset-0 overflow-hidden">{CONFETTI_PARTICLES.map((particle) => <span key={particle.id} className="absolute h-2 w-2 animate-[confetti_1.8s_ease-out_forwards] rounded-full bg-emerald-500" style={{ right: particle.right, top: "0%", animationDelay: particle.animationDelay }} />)}</div>;
}

const CONFETTI_PARTICLES = Array.from({ length: 28 }, (_, index) => ({
  id: index,
  right: `${(index * 13) % 100}%`,
  animationDelay: `${(index % 10) * 0.12}s`,
}));

const getSessionId = () => {
  const key = "storefront.session";
  let existing = "";
  try {
    existing = localStorage.getItem(key);
  } catch {
    // Ignore storage access errors.
  }
  if (existing) return existing;
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  try {
    localStorage.setItem(key, id);
  } catch {
    // Ignore storage access errors.
  }
  return id;
};

const readStorefrontStorage = (key, fallback) => {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === "") return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const readJson = (key, fallback) => readStorefrontStorage(key, fallback);

const writeJson = (key, value) => {
  writeStorefrontStorage(key, value);
};

const normalizeStorefrontProfile = (value = {}) => {
  const profile = value && typeof value === "object" ? value : {};
  const primaryPhone = String(profile.primary_phone || profile.phone || profile.customer_phone || "").trim();
  const customerId = String(profile.customer_id || profile.id || "").trim();
  return {
    ...profile,
    full_name: String(profile.full_name || "").trim(),
    primary_phone: primaryPhone,
    phone: String(profile.phone || primaryPhone || "").trim(),
    customer_id: customerId,
  };
};

const writeStorefrontStorage = (key, value) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota and privacy mode errors.
  }
};

const normalizeStorefrontItem = (item = {}) => ({
  ...item,
  id: item.id || item.product_id || item.variant_id || item.slug || "",
});

const normalizeCartLine = (product = {}, variant = {}, quantity = 1) => {
  const image = variantImage(variant) || displayImageForProduct(product, variant) || product.image_url || product.product_image_url || "";
  const price = displaySellingPrice(product, variant);
  const compareAtPrice = displayComparePrice(product, variant);
  const originalSize = String(variant.size || "").trim();
  const displaySize = isCrocsProduct(product) ? resolveCrocsEuSize(originalSize) : originalSize;
  return {
    lineId: [
      product.id || product.slug || product.name || "product",
      variant.id || variant.sku || variant.size || variant.color || "variant",
    ].join(":"),
    product_id: product.id || "",
    variant_id: variant.id || "",
    // Keep the exact catalog identifier with the order/cart line for Meta matching.
    sku: variant.sku || variant.SKU || variant.variant_sku || product.sku || "",
    name: cleanDisplayText(mirrorProductTitle(product, variant) || product.name || product.title || ""),
    brand: product.brand?.name || product.brand_name || product.brand || variant.brand_name || "",
    category: product.category?.name || product.category_name || product.product_type || "",
    slug: product.slug || "",
    image_url: image,
    product_image: image,
    color: variantColorName(variant) || variant.color || "",
    size: originalSize,
    display_size: displaySize,
    factory_size: originalSize,
    quantity: Math.max(1, Number(quantity || 1)),
    price,
    sale_price: price,
    compare_at_price: compareAtPrice,
    total_amount: price * Math.max(1, Number(quantity || 1)),
  };
};

const normalizeCartCollection = (items = []) => {
  if (!Array.isArray(items)) return [];
  return items
    .filter(Boolean)
    .map((item) => {
      const quantity = Math.max(1, Number(item?.quantity || 1));
      const price = Number(item?.price || item?.sale_price || 0);
      const totalAmount = Number(item?.total_amount || price * quantity);
      const lineId = String(
        item?.lineId ||
          item?.line_id ||
          `${item?.product_id || item?.productId || item?.id || ""}:${item?.variant_id || item?.variantId || ""}:${item?.size || ""}:${item?.color || ""}`
      ).trim();
      return {
        ...item,
        lineId,
        product_id: item?.product_id || item?.productId || "",
        variant_id: item?.variant_id || item?.variantId || "",
        quantity,
        price,
        sale_price: Number(item?.sale_price || price),
        total_amount: totalAmount,
      };
    })
    .filter((item) => item.lineId);
};

const mergeCartCollections = (localItems = [], remoteItems = []) => {
  const local = normalizeCartCollection(localItems);
  const remote = normalizeCartCollection(remoteItems);
  if (!local.length) return remote;
  if (!remote.length) return local;
  const seen = new Set(local.map((item) => item.lineId));
  const merged = [...local];
  remote.forEach((item) => {
    if (seen.has(item.lineId)) return;
    merged.push(item);
    seen.add(item.lineId);
  });
  return merged;
};

const OrderNumberBadge = ({ value, className = "" }) => {
  const text = displayPublicOrderNumber(value);
  return <span className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-black ${className}`.trim()} dir="ltr">{text}</span>;
};

function Storefront() {
  usePageTitle("Storefront");
  const location = useLocation();
  const navigate = useNavigate();
  const [cart, setCart] = useState(() => readStorefrontStorage(CART_KEY, []));
  const [wishlist, setWishlist] = useState(() => readStorefrontStorage(WISHLIST_KEY, []));
  const [recent, setRecent] = useState(() => readStorefrontStorage(RECENT_KEY, []));
  const [profile, setProfile] = useState(() => normalizeStorefrontProfile(readStorefrontStorage(PROFILE_KEY, { full_name: "", primary_phone: "", phone: "", customer_id: "" })));
  const [themeMode, setThemeMode] = useState(() => {
    const savedTheme = readStorefrontStorage(STOREFRONT_THEME_KEY, "dark");
    return savedTheme === "light" ? "light" : "dark";
  });
  const [publicStoreSettings, setPublicStoreSettings] = useState({});
  const [publicStoreSettingsLoading, setPublicStoreSettingsLoading] = useState(true);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [customerAuth, setCustomerAuth] = useState(() => readStorefrontCustomerAuth());
  const storefrontRouteKey = location.pathname;
  const cartCount = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const wishlistCount = wishlist.length;
  const customerAuthTokenRef = useRef("");
  const cartSyncSaveTimerRef = useRef(null);
  const cartRef = useRef(cart);
  const previousDocumentThemeRef = useRef(null);
  const [cartSyncReady, setCartSyncReady] = useState(false);

  useEffect(() => {
    setStorefrontSalePricesEnabled(publicStoreSettings);
  }, [publicStoreSettings]);

  useEffect(() => {
    trackGa4PageView({
      path: `${location.pathname || "/"}${location.search || ""}`,
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    setRouteReady(true);
  }, []);

  useEffect(() => {
    const syncCustomerAuth = () => setCustomerAuth(readStorefrontCustomerAuth());
    syncCustomerAuth();
    window.addEventListener("storefront-customer-auth-changed", syncCustomerAuth);
    window.addEventListener("storage", syncCustomerAuth);
    return () => {
      window.removeEventListener("storefront-customer-auth-changed", syncCustomerAuth);
      window.removeEventListener("storage", syncCustomerAuth);
    };
  }, []);

  useEffect(() => {
    writeStorefrontStorage(CART_KEY, cart);
  }, [cart]);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    writeStorefrontStorage(WISHLIST_KEY, wishlist);
  }, [wishlist]);

  useEffect(() => {
    writeStorefrontStorage(RECENT_KEY, recent);
  }, [recent]);

  useEffect(() => {
    writeStorefrontStorage(PROFILE_KEY, normalizeStorefrontProfile(profile));
  }, [profile]);

  useEffect(() => {
    writeStorefrontStorage(STOREFRONT_THEME_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const syncTheme = (event) => {
      if (event.key !== STOREFRONT_THEME_KEY) return;
      try {
        const nextTheme = JSON.parse(event.newValue || '"dark"');
        setThemeMode(nextTheme === "light" ? "light" : "dark");
      } catch {
        setThemeMode("dark");
      }
    };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  useEffect(() => {
    initMetaPixel(profile);
  }, [profile]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const root = document.documentElement;
    const body = document.body;
    previousDocumentThemeRef.current = {
      rootDark: root.classList.contains("dark"),
      bodyDark: body.classList.contains("dark"),
      rootTheme: root.getAttribute("data-theme"),
      bodyTheme: body.getAttribute("data-theme"),
      bodyStorefrontDark: body.classList.contains("storefront-dark"),
      colorScheme: root.style.colorScheme,
    };
    body.classList.add("storefront-shell");

    return () => {
      const previous = previousDocumentThemeRef.current;
      body.classList.remove("storefront-shell");
      if (!previous) return;
      root.classList.toggle("dark", previous.rootDark);
      body.classList.toggle("dark", previous.bodyDark);
      body.classList.toggle("storefront-dark", previous.bodyStorefrontDark);
      if (previous.rootTheme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous.rootTheme);
      if (previous.bodyTheme === null) body.removeAttribute("data-theme");
      else body.setAttribute("data-theme", previous.bodyTheme);
      root.style.colorScheme = previous.colorScheme;
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const dark = themeMode === "dark";
    const root = document.documentElement;
    const body = document.body;
    root.classList.toggle("dark", dark);
    body.classList.toggle("dark", dark);
    body.classList.toggle("storefront-dark", dark);
    root.setAttribute("data-theme", themeMode);
    body.setAttribute("data-theme", themeMode);
    root.style.colorScheme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    let cancelled = false;
    api.get("/settings/public", {
      suppressErrorStatuses: [404, 500],
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    })
      .then((data) => {
        if (cancelled) return;
        const { settings, rawSaleModeEnabled } = extractPublicStorefrontSettings(data);
        const parsedSaleModeEnabled = parseSaleModeEnabled(rawSaleModeEnabled, false);
        const normalizedSettings = {
          ...settings,
          sale_mode_enabled: parsedSaleModeEnabled,
        };
        setPublicStoreSettings(normalizedSettings);
        storefrontPublicSaleModeEnabledRaw = rawSaleModeEnabled;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPublicStoreSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    if (!isStorefrontProductPath(location.pathname)) return undefined;
    const scrollTop = () => {
      const scrollTargets = [
        window,
        document.scrollingElement,
        document.documentElement,
        document.body,
        ...Array.from(document.querySelectorAll("[data-storefront-scroll-root]")),
      ].filter(Boolean);
      scrollTargets.forEach((target) => {
        try {
          if (typeof target?.scrollTo === "function") {
            target.scrollTo({ top: 0, left: 0, behavior: "auto" });
            return;
          }
          if ("scrollTop" in target) target.scrollTop = 0;
        } catch {
          // Ignore best-effort scroll reset failures.
        }
      });
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document.scrollingElement?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    };
    scrollTop();
    const raf = window.requestAnimationFrame(scrollTop);
    const timeout = window.setTimeout(scrollTop, 80);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [location.pathname]);

  const clearCart = useCallback(() => setCart([]), []);

  const updateCart = useCallback((lineId, quantity) => {
    setCart((prev) => {
      const nextQuantity = Number(quantity || 0);
      if (nextQuantity <= 0) return prev.filter((item) => item.lineId !== lineId);
      return prev.map((item) => (item.lineId === lineId ? { ...item, quantity: nextQuantity, total_amount: Number(item.price || 0) * nextQuantity } : item));
    });
  }, []);

  const removeFromCart = useCallback((lineId) => {
    setCart((prev) => prev.filter((item) => item.lineId !== lineId));
  }, []);

  const onAddToCart = useCallback((product, variant, quantity = 1, options = {}) => {
    if (!product || !variant) return;
    const sourceEl = options && typeof options === "object" ? options.sourceEl : null;
    if (sourceEl) {
      try {
        animateFlyToCart({ imageEl: sourceEl, cartEl: getVisibleCartActionElement() });
      } catch {
        // Keep cart updates working even if the animation path fails.
      }
    }
    const nextLine = normalizeCartLine(product, variant, quantity);
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => String(item.product_id) === String(nextLine.product_id) && String(item.variant_id) === String(nextLine.variant_id));
      if (existingIndex >= 0) {
        return prev.map((item, index) => {
          if (index !== existingIndex) return item;
          const nextQuantity = Number(item.quantity || 0) + Number(quantity || 1);
          return { ...item, quantity: nextQuantity, total_amount: Number(item.price || 0) * nextQuantity };
        });
      }
      return [...prev, nextLine];
    });
    trackMetaAddToCart({ product, variant, line: nextLine, quantity, customer: profile });
    trackGa4AddToCart({ product, variant, line: nextLine, quantity });
    setCartDrawerOpen(true);
    return "added";
  }, [profile]);

  const toggleWishlist = useCallback((product) => {
    const item = normalizeStorefrontItem(product);
    if (!item.id) return;
    const { token } = readStorefrontCustomerAuth();
    setWishlist((prev) => {
      const exists = prev.some((entry) => String(entry.id) === String(item.id));
      const next = exists ? prev.filter((entry) => String(entry.id) !== String(item.id)) : [item, ...prev];
      if (token) {
        storefrontCustomerRequest("/storefront/wishlist", {
          method: exists ? "DELETE" : "POST",
          body: { product_id: item.id, remove: exists },
        }).catch((error) => {
          const status = Number(error?.status || error?.response?.status || 0);
          if (status === 401 || status === 403) {
            clearStorefrontCustomerAuth();
          }
        });
      }
      return next;
    });
  }, []);

  const rememberProduct = useCallback((product) => {
    const item = normalizeStorefrontItem(product);
    if (!item.id) return;
    setRecent((prev) => {
      const next = [item, ...prev.filter((entry) => String(entry.id) !== String(item.id))];
      const { token } = readStorefrontCustomerAuth();
      if (token) {
        storefrontCustomerRequest("/storefront/recently-viewed", {
          method: "POST",
          body: { product_id: item.id, session_id: getSessionId() },
        }).catch((error) => {
          const status = Number(error?.status || error?.response?.status || 0);
          if (status === 401 || status === 403) {
            clearStorefrontCustomerAuth();
          }
        });
      }
      return next.slice(0, 20);
    });
  }, []);

  useEffect(() => {
    const token = String(customerAuth.token || "").trim();
    if (!token) {
      customerAuthTokenRef.current = "";
      setCartSyncReady(false);
      return undefined;
    }
    if (customerAuthTokenRef.current === token) return undefined;
    customerAuthTokenRef.current = token;
    let cancelled = false;
    setCartSyncReady(false);

    const syncCustomerLists = async () => {
      try {
        const data = await storefrontCustomerRequest("/storefront/account");
        if (cancelled) return;
        const backendCartData = await storefrontCustomerRequest("/storefront/customer/cart");
        if (cancelled) return;
        const backendCart = normalizeCartCollection(backendCartData?.cart || backendCartData?.items || backendCartData?.cart_items || []);
        const backendWishlist = Array.isArray(data?.wishlist_products) ? data.wishlist_products.map(normalizeStorefrontItem).filter((item) => item.id) : [];
        const backendRecent = Array.isArray(data?.recent_products) ? data.recent_products.map(normalizeStorefrontItem).filter((item) => item.id) : [];
        const guestCart = normalizeCartCollection(cartRef.current);
        const backendWishlistIds = new Set(backendWishlist.map((item) => String(item.id)));
        const backendRecentIds = new Set(backendRecent.map((item) => String(item.id)));
        const guestWishlist = (Array.isArray(wishlist) ? wishlist : []).map(normalizeStorefrontItem).filter((item) => item.id);
        const guestRecent = (Array.isArray(recent) ? recent : []).map(normalizeStorefrontItem).filter((item) => item.id);
        const mergedCart = mergeCartCollections(guestCart, backendCart);
        const mergedWishlist = [...backendWishlist, ...guestWishlist].reduce((acc, item) => {
          const id = String(item.id || "");
          if (!id || acc.some((entry) => String(entry.id) === id)) return acc;
          acc.push(item);
          return acc;
        }, []);
        const mergedRecent = [...backendRecent, ...guestRecent].reduce((acc, item) => {
          const id = String(item.id || "");
          if (!id || acc.some((entry) => String(entry.id) === id)) return acc;
          acc.push(item);
          return acc;
        }, []).slice(0, 20);
        setProfile((prev) => ({
          ...prev,
          primary_phone: data?.customer?.phone || prev.primary_phone || "",
          phone: data?.customer?.phone || prev.phone || "",
          customer_id: data?.customer?.id || prev.customer_id || "",
          full_name: data?.customer?.name || prev.full_name || "",
          email: data?.customer?.email || prev.email || prev.customer_email || "",
          customer_email: data?.customer?.email || prev.customer_email || prev.email || "",
        }));
        setCart(mergedCart);
        setWishlist(mergedWishlist);
        setRecent(mergedRecent);

        const missingWishlistItems = guestWishlist.filter((item) => !backendWishlistIds.has(String(item.id)));
        const missingRecentItems = guestRecent.filter((item) => !backendRecentIds.has(String(item.id)));
        await Promise.allSettled([
          ...missingWishlistItems.map((item) =>
            storefrontCustomerRequest("/storefront/wishlist", {
              method: "POST",
              body: { product_id: item.id },
            })
          ),
          ...missingRecentItems.map((item) =>
            storefrontCustomerRequest("/storefront/recently-viewed", {
              method: "POST",
              body: { product_id: item.id, session_id: getSessionId() },
            })
          ),
        ]);
      } catch (error) {
        const status = Number(error?.status || error?.response?.status || 0);
        if (status === 401 || status === 403) {
          clearStorefrontCustomerAuth();
          setCustomerAuth(readStorefrontCustomerAuth());
        }
      } finally {
        if (!cancelled) {
          setCartSyncReady(true);
        }
      }
    };

    void syncCustomerLists();
    return () => {
      cancelled = true;
    };
  }, [customerAuth.token, recent, setProfile, setRecent, setWishlist, wishlist]);

  useEffect(() => {
    const token = String(customerAuth.token || "").trim();
    if (!token) {
      setCartSyncReady(false);
      if (cartSyncSaveTimerRef.current) {
        window.clearTimeout(cartSyncSaveTimerRef.current);
        cartSyncSaveTimerRef.current = null;
      }
      return undefined;
    }
    if (!cartSyncReady) return undefined;
    if (cartSyncSaveTimerRef.current) {
      window.clearTimeout(cartSyncSaveTimerRef.current);
      cartSyncSaveTimerRef.current = null;
    }
    const snapshot = normalizeCartCollection(cart);
    cartSyncSaveTimerRef.current = window.setTimeout(() => {
      storefrontCustomerRequest("/storefront/customer/cart", {
        method: "PUT",
        body: { cart: snapshot },
      }).catch((error) => {
        const status = Number(error?.status || error?.response?.status || 0);
        if (status === 401 || status === 403) {
          clearStorefrontCustomerAuth();
          setCustomerAuth(readStorefrontCustomerAuth());
          setCartSyncReady(false);
        }
      });
    }, 750);
    return () => {
      if (!cartSyncSaveTimerRef.current) return;
      window.clearTimeout(cartSyncSaveTimerRef.current);
      cartSyncSaveTimerRef.current = null;
    };
  }, [cart, cartSyncReady, customerAuth.token]);

  const brandName = resolveStorefrontBrandName(publicStoreSettings);
  const brandLogoUrl = resolveStorefrontBrandLogoUrl(publicStoreSettings);
  const headerLogoUrl = resolveStorefrontHeaderLogoUrl(publicStoreSettings);
  const brandInitials = resolveBrandInitials(brandName);
  const publicSaleModeEnabled = useMemo(
    () => parseSaleModeEnabled(publicStoreSettings?.sale_mode_enabled, false),
    [publicStoreSettings]
  );

  const helpers = useMemo(() => ({
    sfText,
    money,
    imageFor,
    fallbackProductImage,
    displayOrderNumber: displayPublicOrderNumber,
    statusCopy,
    paymentCopy,
    shippingProviderCopy,
    formatDate,
    supportHref,
    deferReactState,
    getStatusLabels,
    getPaymentMethods,
    productFromDetailsResponse,
    productToSocialMeta,
    displayCartItemPrice,
    displayCartItemComparePrice,
    brandName,
    brandLogoUrl,
    brandInitials,
    getDisplayPricing,
    saleModeEnabled: publicSaleModeEnabled,
    rawSaleModeEnabled: storefrontPublicSaleModeEnabledRaw,
  }), [brandInitials, brandLogoUrl, brandName, publicSaleModeEnabled]);

  const storefrontBrandSettings = useMemo(() => ({
    brandName,
    brandTagline: String(publicStoreSettings?.["storefront.store_tagline"] || "").trim(),
    brandLogoUrl,
    headerLogoUrl,
  }), [brandLogoUrl, brandName, headerLogoUrl, publicStoreSettings]);
  const quickActionLinks = useMemo(() => {
    const settings = publicStoreSettings || {};
    const storefrontSettings = settings.storefront && typeof settings.storefront === "object" ? settings.storefront : {};
    const readSetting = (key) => {
      if (String(key || "").startsWith("storefront.")) {
        const storefrontKey = String(key).slice("storefront.".length);
        return storefrontSettings[storefrontKey] ?? settings[key];
      }
      return settings[key];
    };
    const firstValue = (...keys) => keys.map((key) => String(readSetting(key) || "").trim()).find(Boolean) || "";
    const normalizeWhatsAppHref = (value, fallback = "") => {
      const raw = String(value || "").trim();
      if (!raw) return fallback;
      if (/^(https?:|mailto:|tel:|whatsapp:)/i.test(raw) || raw.startsWith("/")) return raw;
      const digits = raw.replace(/\D/g, "");
      return digits ? `https://wa.me/${digits}` : fallback;
    };
    const normalizeStoreHref = (value, fallback = "") => {
      const raw = String(value || "").trim();
      if (!raw) return fallback;
      if (/^(https?:|mailto:|tel:)/i.test(raw) || raw.startsWith("/")) return raw;
      return fallback;
    };

    return {
      whatsappHref: normalizeWhatsAppHref(
        firstValue(
          "storefront.whatsapp_url",
          "storefront.whatsapp_link",
          "storefront.whatsapp_phone",
          "storefront.support_whatsapp",
          "general.whatsapp_phone",
          "general.whatsapp",
          "company.whatsapp",
          "company.whatsapp_phone",
          "support.whatsapp",
          "contact.whatsapp",
          "whatsapp",
        ),
        supportHref(),
      ),
      galleryHref: normalizeStoreHref(
        firstValue(
          "storefront.map_url",
          "storefront.google_map_url",
          "storefront.location_url",
          "storefront.location_link",
          "storefront.store_location_url",
          "storefront.address_url",
          "general.map_url",
          "general.google_map_url",
          "company.map_url",
          "company.google_maps_url",
          "company.location_url",
          "map_url",
          "google_map_url",
          "location_url",
        ),
        "/contact",
      ),
    };
  }, [publicStoreSettings]);
  const hideMobileBottomNav = isStorefrontCheckoutFlowPath(location.pathname || "");
  const showMobileBottomNav = routeReady && !hideMobileBottomNav && !cartDrawerOpen && !mobileMenuOpen;
  const isCheckoutPage = isStorefrontCheckoutPath(location.pathname || "");
  const isOfferStoryPage = isStorefrontOfferPath(location.pathname || "");
  const hideFloatingWhatsApp = cartDrawerOpen || mobileMenuOpen || isCheckoutPage || isOfferStoryPage;
  const currentStorefrontPath = resolveStorefrontPathname(location.pathname || "");

  useEffect(() => {
    if (!isOfferStoryPage || typeof document === "undefined") return undefined;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [isOfferStoryPage]);

  const components = useMemo(() => ({
    EmptyState,
    Field,
    InfoBox,
    OrderNumberBadge,
    OrderTimeline,
    Panel,
    SelectField,
    SmallProductGrid,
    SmallProductList,
    SummaryRow,
    TextField,
    TrustPills,
    CheckoutProgress,
    CityAreaField,
  }), []);

  const storefrontPage = useMemo(() => {
    if (isStorefrontProductsPath(currentStorefrontPath)) {
      return (
        <LazyStorefrontProductListingPage
          wishlist={wishlist}
          toggleWishlist={toggleWishlist}
          onAddToCart={onAddToCart}
          saleModeEnabled={storefrontSalePricesEnabled}
        />
      );
    }

    if (isStorefrontOfferPath(currentStorefrontPath)) return <OfferStoryViewer />;

    if (isStorefrontProductPath(currentStorefrontPath)) {
      return (
        <>
          <LazyStorefrontProductDetailPage
            key={storefrontRouteKey}
            onAddToCart={onAddToCart}
            toggleWishlist={toggleWishlist}
            wishlist={wishlist}
            rememberProduct={rememberProduct}
            recent={recent}
            profile={profile}
            saleModeEnabled={storefrontSalePricesEnabled}
          />
          <HomeWhySection lang={i18n.language || "ar"} />
          <HomeSimpleFooter lang={i18n.language || "ar"} />
        </>
      );
    }

    if (currentStorefrontPath === ROOT_PATHS.cart) {
      return (
        <LazyStorefrontCartPage
          cart={cart}
          updateCart={updateCart}
          removeFromCart={removeFromCart}
          helpers={helpers}
          components={components}
        />
      );
    }

    if (currentStorefrontPath === ROOT_PATHS.checkout) {
      return (
        <CheckoutPage
          cart={cart}
          clearCart={clearCart}
          profile={profile}
          setProfile={setProfile}
          themeMode={themeMode}
        />
      );
    }

    if (currentStorefrontPath.startsWith(`${ROOT_PATHS.success}/`)) {
      return (
        <OrderSuccess
          profile={profile}
          themeMode={themeMode}
          brandName={storefrontBrandSettings.brandName}
          brandLogoUrl={storefrontBrandSettings.brandLogoUrl}
        />
      );
    }

    if (currentStorefrontPath === ROOT_PATHS.track) {
      return <LazyStorefrontTrackOrderPage helpers={helpers} components={components} />;
    }

    if (currentStorefrontPath.startsWith(`${ROOT_PATHS.confirm}/`) || /^\/c\/[^/]+$/.test(currentStorefrontPath)) {
      return <LazyOrderConfirmationActionPage />;
    }

    if (currentStorefrontPath === ROOT_PATHS.account || currentStorefrontPath === `${ROOT_PATHS.account}/reset-password`) {
      return (
        <LazyStorefrontAccountPage
          profile={profile}
          setProfile={setProfile}
          wishlist={wishlist}
          recent={recent}
          onAddToCart={onAddToCart}
          helpers={helpers}
          components={components}
          initialAuthMode={currentStorefrontPath === `${ROOT_PATHS.account}/reset-password` ? "reset" : "login"}
        />
      );
    }

    if (currentStorefrontPath === ROOT_PATHS.wishlist) {
      return (
        <LazyStorefrontWishlistPage
          wishlist={wishlist}
          toggleWishlist={toggleWishlist}
          onAddToCart={onAddToCart}
          helpers={helpers}
          components={components}
        />
      );
    }

    if (currentStorefrontPath === ROOT_PATHS.recentlyViewed) {
      return <LazyStorefrontRecentPage recent={recent} helpers={helpers} components={components} />;
    }

    if (currentStorefrontPath === ROOT_PATHS.faq) return <FaqPage />;

    if (currentStorefrontPath === ROOT_PATHS.contact) {
      return <PremiumContactPage publicStoreSettings={publicStoreSettings} quickActionLinks={quickActionLinks} />;
    }

    if (currentStorefrontPath === ROOT_PATHS.sizeGuide) return <LazyStorefrontSizeGuidePage />;
    if (currentStorefrontPath === ROOT_PATHS.returns) return <ReturnsPolicy publicStoreSettings={publicStoreSettings} />;

    return (
      <PremiumHomePage
        wishlist={wishlist}
        toggleWishlist={toggleWishlist}
        onAddToCart={onAddToCart}
        themeMode={themeMode}
      />
    );
  }, [
    cart,
    clearCart,
    components,
    currentStorefrontPath,
    helpers,
    onAddToCart,
    profile,
    publicStoreSettings,
    quickActionLinks,
    recent,
    rememberProduct,
    setProfile,
    storefrontBrandSettings,
    storefrontRouteKey,
    themeMode,
    toggleWishlist,
    updateCart,
    removeFromCart,
    wishlist,
  ]);

  if (!routeReady) return <StorefrontPageFallback />;

  return (
    <>
      {!isOfferStoryPage ? (
        <Header
          cartCount={cartCount}
          wishlistCount={wishlistCount}
          onCart={() => navigate("/cart")}
          effectiveTheme={themeMode}
          onThemeToggle={() => setThemeMode((current) => current === "dark" ? "light" : "dark")}
          brandName={storefrontBrandSettings.brandName}
          brandTagline={storefrontBrandSettings.brandTagline}
          brandLogoUrl={storefrontBrandSettings.brandLogoUrl}
          headerLogoUrl={storefrontBrandSettings.headerLogoUrl}
          brandSettingsLoading={publicStoreSettingsLoading}
          quickActionLinks={quickActionLinks}
          mobileMenuOpen={mobileMenuOpen}
          setMobileMenuOpen={setMobileMenuOpen}
        />
      ) : null}
      {storefrontPage}
      {!isOfferStoryPage ? (
        <CartDrawer
          open={cartDrawerOpen}
          onClose={() => setCartDrawerOpen(false)}
          cart={cart}
          updateCart={updateCart}
          removeFromCart={removeFromCart}
        />
      ) : null}
      {!hideFloatingWhatsApp ? (
        <a
          href="https://wa.me/201000659301"
          target="_blank"
          rel="noreferrer"
          aria-label="WhatsApp"
          className="sf-whatsapp-float fixed z-[70] grid place-items-center rounded-full transition duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366]/45"
        >
          <FaWhatsapp aria-hidden="true" />
        </a>
      ) : null}
      {showMobileBottomNav && !isOfferStoryPage ? (
        <MobileBottomNav cartCount={cartCount} quickActionLinks={quickActionLinks} publicStoreSettings={publicStoreSettings} themeMode={themeMode} />
      ) : null}
    </>
  );
}

export {
  LazyFiltersDrawer,
  LazyProductCardVariantSheet,
  LazyProductDetailsVariantSheet,
  LazyStorefrontProductGallery,
  LazyStorefrontProductListingPage,
  LazyStorefrontProductDetailPage,
  EmptyState,
  GuidedGenderStep,
  GuidedGradeStep,
  GuidedProductTypeStep,
  GuidedSizeFilter,
  MobileBuyBar,
  MobileFilterDrawer,
  MobileFilterTrigger,
  PremiumFilterPanel,
  ProductCard,
  ProductGalleryFallback,
  ProductGrid,
  ProductSkeleton,
  RecentProductsSection,
  RelatedProducts,
  SectionIntro,
  StepPill,
  StorefrontPageFallback,
  buildAvailableSizeOptions,
  cleanDisplayText,
  classificationColor,
  classificationLabel,
  deferReactState,
  displayCartItemComparePrice,
  displayCartItemPrice,
  displayComparePrice,
  displayImageForProduct,
  displaySellingPrice,
  fallbackProductImage,
  firstDisplayVariant,
  firstVariantImage,
  filterOptionCount,
  getProductTypeLabel,
  getSessionId,
  getDisplayPricing,
  imageFor,
  isLastPieceProduct,
  isMirrorProduct,
  money,
  normalizeAudienceValue,
  normalizeFilterKey,
  mirrorProductTitle,
  productAudienceValues,
  productCardKey,
  productFromDetailsResponse,
  productShareUrl,
  productToSocialMeta,
  productHasAvailableSize,
  resolveStorefrontPrice,
  sfText,
  sortStorefrontColorCardsByModel,
  storefrontApi,
  truthyFlag,
  uniqueClassificationOptions,
  useBodyScrollLock,
  useProducts,
  prefetchStorefrontProducts,
  useStorefrontGenderClassifications,
  variantColorKey,
  variantColorName,
  variantHasStock,
  variantImage,
  variantImages,
};

const playSoftClick = () => {
  try {
    const audio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=");
    audio.volume = 0.08;
    audio.play().catch(() => undefined);
  } catch {
    // Ignore browsers that block short UI sounds.
  }
};

const playSuccess = () => playSoftClick();

class StorefrontErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[storefront] render error", error);
    cleanupStorefrontStorage({ aggressive: true });
    recoverFromChunkLoadError(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" className="min-h-screen bg-[#f7f4ee] px-4 py-10 text-center text-stone-950">
          <div className="mx-auto max-w-md rounded-[1.5rem] border border-stone-200 bg-white p-6 shadow-[0_18px_50px_rgba(39,20,75,0.08)]">
            <Sparkles className="mx-auto h-8 w-8 text-[#d4af37]" />
            <h1 className="mt-4 text-2xl font-black">{sfText("storefront.errors.simpleProblem")}</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-stone-500">{sfText("storefront.errors.cleanedTemporaryData")}</p>
            <button onClick={() => forceCleanReload()} className="mt-5 rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white">{sfText("storefront.common.refreshPage")}</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function StorefrontWithBoundary() {
  return (
    <StorefrontErrorBoundary>
      <Storefront />
    </StorefrontErrorBoundary>
  );
}

export default StorefrontWithBoundary;

