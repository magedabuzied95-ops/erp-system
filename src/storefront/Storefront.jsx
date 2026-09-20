/* eslint-disable react-refresh/only-export-components -- Shared storefront helpers are imported by route-level modules. */
import { Component, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { memo, useCallback } from "react";
import { useDeferredValue } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import {
  FaFacebookF,
  FaFacebookMessenger,
  FaInstagram,
  FaTiktok,
  FaWhatsapp,
  FaYoutube,
} from "react-icons/fa";
import { SiApplepay, SiMastercard, SiVisa, SiVodafone } from "react-icons/si";
import { useTranslation } from "react-i18next";
import { lazy, Suspense } from "react";
import i18n, { applyDocumentLanguage, normalizeLanguage, persistApplicationLanguage } from "../i18n/i18n";
import {
  bostaCityPatch,
  bostaDistrictPatch,
  bostaZonePatch,
  buildBostaPickerOptions,
  matchBostaPickerOption,
  normalizeShippingQuote,
} from "../shared/lib/shippingCheckout";
import usePageTitle from "../shared/hooks/usePageTitle";
import StorefrontScrollTopButton from "./components/StorefrontScrollTopButton";
import { safeSetSessionStorage } from "../utils/safeStorage";
import { signalContentPainted } from "../shared/utils/contentPainted";
import { getPublicSettingsResponse } from "../shared/api/publicSettings";
import {
  BadgePercent,
  Baby,
  Briefcase,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Crown,
  Clock3,
  Eye,
  Footprints,
  Gem,
  Heart,
  Camera,
  Loader2,
  Menu,
  MessageCircle,
  Mic,
  Minus,
  Plus,
  Languages,
  Moon,
  MapPin,
  Mail,
  Headphones,
  CreditCard,
  PackageCheck,
  PackageSearch,
  Phone,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Sun,
  ShieldCheck,
  Tag,
  RefreshCcw,
  Ruler,
  Trash2,
  Truck,
  Upload,
  User,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { api } from "../shared/api/api";
import { API_BASE_URL } from "../shared/constants/app";
import { resolveProductImageUrl } from "../shared/lib/imageUrls";
import {
  buildCrocsStorefrontSizeOptions,
  compareCrocsSizes,
  crocsSizeKey,
  isCrocsProduct,
  isKnownCrocsSize,
  resolveCrocsEuSize,
} from "../shared/lib/crocsSizes";
import { clearStorefrontCustomerAuth, readStorefrontCustomerAuth, storefrontCustomerRequest } from "./lib/storefrontCustomerAuth";
import { formatCurrencyParts, getCurrency } from "../shared/lib/currency";
import { isMirrorProduct, mirrorProductTitle } from "../shared/lib/mirrorProduct";
import { productToSocialMeta } from "../shared/lib/socialMeta";
import { displayPublicOrderNumber } from "../shared/utils/publicOrderNumber";
import { defaultEgyptShippingLocations } from "../../shared/egyptShippingLocations.js";
import { governorateOptions, normalizeCodPolicy } from "../../shared/codPolicy.js";
import { buildBundleId, computeBundleDiscount, normalizeBundleDiscountPercent } from "../../shared/bundleDiscount.js";
import { pickAutomaticPair } from "./lib/pairPicker.js";
import { hasStorefrontHomeContent, keepHomeFilterRowWhenEmpty, nextHomeFilterRowAudience, persistedStorefrontHomeData } from "./lib/listingHomeState.js";
import { getStorefrontResponsiveImageProps } from "../shared/lib/storefrontImage";
import { forceCleanReload, hasChunkReloadAttempted, importWithChunkRetry, isChunkLoadError, isChunkRecoveryBlockedOffline, isChunkRecoveryInFlight, recoverFromChunkLoadError } from "../shared/utils/chunkLoadRecovery";
import { openSizeGuide } from "./lib/sizeGuideStore";
import { SizeGuideHost } from "./components/SizeGuideSheet";
import { animateFlyToCart } from "./lib/flyToCart";
import { CART_REPRICE_ENDPOINT, applyCartReprice, cartRepriceKey, cartRepriceVariantIds, isCartLineCheckoutError, isStaleCartCheckoutError } from "./lib/cartReprice";
import CartRepriceNotice from "./components/CartRepriceNotice";
import { canIncreaseCartLine, cartFromStorageEvent, cartLineComparePrice, cartLineIssue, setCartLineQuantity } from "./lib/cartLine";
import { productShareParamEntries } from "./lib/pdpSelection";
import { startVoiceSearch } from "./lib/voiceSearch";
import { buildTrendingSearches } from "./lib/trendingSearches";
import { prepareSearchImage } from "./lib/searchImage";
import { parseSearchQuery } from "./lib/searchAliases";
import { applyProductImageFallback } from "./lib/productImageFallback";
import { couponAutoApplyStep, deliveryQuoteRefreshDelayMs, fallbackPaymentMode, isEgyptMobile, normalizeEgyptMobile, shippingQuoteSettled } from "./lib/checkoutGuards";
import { releaseBootLoader } from "./lib/bootLoader";
import { useDialogFocus } from "./lib/useDialogFocus";
import { formatSchoolBagCardSize, isSchoolBagProduct } from "./lib/schoolBagSize";
import { localizeColorName, localizeHoursLine, localizeSizeLabel } from "./lib/displayCopy";
import { storefrontCheckoutErrorCopy, visualSearchErrorKey, visualSearchSubtitleKey } from "./lib/serverCopy";
import { getStorefrontThemeTokens } from "./lib/themeTokens";
import { attachSiteDesign, detachSiteDesign, refreshSiteDesign, useSiteDesign } from "./lib/siteDesign";
import {
  GENDER_LABELS,
  HOME_FILTER_ROWS,
  HOME_FILTER_ROW_MAP,
  homeFilterRowHref,
  homeFilterRowQuery,
  resolveHeroCopy,
  resolveHomeSections,
  resolveSectionTitle,
  resolveStripItems,
  resolveCardLook,
} from "../../shared/siteDesign.js";
import { releaseStorefrontColorScheme, setStorefrontColorScheme } from "../theme/documentColorScheme";
import { splitProductDisplayName } from "./lib/productDisplayName";
import {
  HomeCategoryRail,
  HomeDeferred,
  HomeHero,
  HomeFilteredRail,
  HomeProductRail,
  HomeSectionHeader,
  HomeTrustStrip,
} from "./home/HomeSections.jsx";
import { buildHomeProductCard, useHomeReveal } from "./home/homeModel";
import "./storefront-light.css";
import "./components/cartDrawer.css";
import "./site-skin.css";
import "./catalog-skin.css";
import "./components/productQuickView.css";
import "./components/compare-controls.css";
import { CompareToggleButton, CompareTray } from "./components/StorefrontCompare";
import StorefrontCheckoutSummary, { CheckoutTotals } from "./components/StorefrontCheckoutSummary";
import FreeShippingProgress, { usePublicFreeShippingThreshold } from "./components/FreeShippingProgress";
import { deliveryEstimateDays, deliveryEstimateText, rememberGovernorate } from "./components/DeliveryEstimate";
import { CheckoutBlock, CheckoutChoice, CheckoutInput, CheckoutLocationSelect, CheckoutNativeSelect, CheckoutSubmit } from "./checkout/CheckoutParts";
import {
  isStorefrontCheckoutPath,
  isStorefrontHomePath,
  isStorefrontOfferPath,
  isStorefrontProductPath,
  isStorefrontProductsPath,
  ROOT_PATHS,
  productPath,
  productsPath,
  resolveStorefrontPathname,
  storefrontPathFromLink,
} from "./lib/paths";
import { sortProductSizes } from "../modules/products/lib/variantBulkSizes";
import { getDisplayPricing, parseSaleModeEnabled as importedParseSaleModeEnabled } from "../shared/lib/storefrontPricing";
import { isInWishlist, reconcileWishlistWithServer, toggleWishlistEntries, wishlistColourOf, wishlistIdOf, wishlistKeyOf } from "./lib/wishlistIdentity";
import {
  isMetaPurchaseEligible,
  trackMetaAddToCart,
  trackMetaInitiateCheckout,
  trackMetaPurchase,
} from "./lib/metaPixelEvents";
import { initMetaPixel } from "../shared/lib/metaPixel";
import { captureMetaBrowserIdentity } from "../shared/lib/metaBrowserAttribution";
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
const productShareUrl = (product = {}, variant = null, shareVersion = Date.now(), { sizeChosen = true } = {}) => {
  const path = appendProductUrlParams(productSharePath(product), [
    ...productShareParamEntries(product, variant, { sizeChosen }),
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
  delivery_estimate: payload.delivery_estimate || null,
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

// What the wishlist keeps: the model, the colour that was hearted, and enough to
// draw a row before the page fetches the live product. Not the whole catalogue
// payload (4-5 KB of variants a heart, frozen at the price of that day).
const wishlistEntryOf = (source = {}) => {
  const id = wishlistIdOf(source);
  if (!id) return { id: "", key: "" };
  const product = normalizeWishlistProduct(source);
  const compactNumber = (value) => (Number(value) > 0 ? Number(value) : 0);
  return {
    key: wishlistKeyOf(source),
    id,
    product_id: id,
    slug: String(source.parent_slug || source.slug || "").trim() || id,
    name: product.name || "",
    image_url: compactImageValue(product.image_url),
    color_key: wishlistColourOf(source),
    color: String(source.color || source.color_name || "").trim(),
    price: compactNumber(product.price || source.price),
    compare_at_price: compactNumber(product.compare_at_price || source.compare_at_price),
    added_at: source.added_at || new Date().toISOString(),
  };
};

const normalizeWishlistCollection = (items) => {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).map(wishlistEntryOf).filter((entry) => {
    if (!entry.key || seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
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
  "Coupon cannot be combined with other discounts": "storefront.checkout.couponErrors.noStacking",
  "Coupon cannot be combined with an invoice discount": "storefront.checkout.couponErrors.noStacking",
  "Coupon cannot be combined with loyalty points": "storefront.checkout.couponErrors.noStacking",
  "Coupon usage limit for this customer reached": "storefront.checkout.couponErrors.customerLimit",
  "Coupon is for first orders only": "storefront.checkout.couponErrors.firstOrderOnly",
  "Coupon does not apply to the items in this order": "storefront.checkout.couponErrors.notApplicable",
  "Free shipping coupon needs a shipping fee to waive": "storefront.checkout.couponErrors.freeShippingNoFee",
  "Campaign budget exhausted": "storefront.checkout.couponErrors.budgetExhausted",
  "Too many coupon checks, try again in a minute": "storefront.checkout.couponErrors.tooMany",
  "Coupon is invalid": "storefront.checkout.couponErrors.invalid",
};
const couponErrorText = (reason = "") => {
  const key = couponErrorKeyMap[String(reason || "").trim()] || "storefront.checkout.couponErrors.invalid";
  return sfText(key, String(reason || "").trim() || sfText("storefront.errors.operationFailed"));
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
      // Sorted, so the same selection is one cached request in any click order.
      value
        .filter((item) => item !== undefined && item !== null && item !== "" && item !== false)
        .map((item) => (item === true ? "1" : String(item)))
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
        .forEach((item) => query.append(safeKey, item));
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
  // Offers used to skip the client cache entirely (no-store plus custom headers),
  // which cost every /sale request a CORS preflight and threw its prefetched next
  // page away - while the server caches the same answer for two minutes anyway.
  const effectiveTtlMs = ttlMs;
  const requestUrl = useMemo(() => buildStorefrontProductsRequestUrl(JSON.parse(queryKey || "{}")), [queryKey]);
  const queryString = requestUrl.split("?")[1] || "";
  const cachedProductsData = getCachedStorefrontGetData(requestUrl, { ttlMs: effectiveTtlMs });
  const [state, setState] = useState(() => {
    const initialProducts = extractStorefrontProductsFromResponse(cachedProductsData);
    return cachedProductsData ? { loading: false, error: "", products: initialProducts, total: Number(cachedProductsData.total ?? cachedProductsData.total_count ?? initialProducts.length), hasMore: Boolean(cachedProductsData.hasMore ?? cachedProductsData.has_more), page: Number(cachedProductsData.page || 1), loadedUrl: requestUrl } : { loading: true, error: "", products: [], total: 0, hasMore: false, page: 1 };
  });
  useEffect(() => {
    let cancelled = false;
    // Decided per request, not once at mount: a listing that first rendered from
    // the cache used to show the old cards with no loading state for every later
    // filter change.
    if (!getCachedStorefrontGetData(requestUrl, { ttlMs: effectiveTtlMs })) {
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
        if (!cancelled) setState({ loading: false, error: "", products, total: Number(data?.total ?? data?.total_count ?? products.length), hasMore: Boolean(data?.hasMore ?? data?.has_more), page: Number(data?.page || 1), loadedUrl: requestUrl });
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

  return { ...state, requestUrl };
};

// The sidebar chips used to be counted from whatever 24 cards the current page
// happened to hold, so /women advertised "Black(2)" against 133 real cards, page
// 2 offered a size list that shared nothing with page 1, and picking a colour
// collapsed the colour group to the one colour left on the page. Counts now come
// from the API over the whole section.
//
// The scope deliberately carries only what the route itself pins - never the
// shopper's own picks. A group counted with its own selection applied can return
// nothing but the value already chosen, which is what emptied the group.
const STOREFRONT_FACETS_CACHE_TTL_MS = 5 * 60 * 1000;
const buildStorefrontFacetsRequestUrl = (scope = {}) => {
  const query = new URLSearchParams();
  Object.entries(scope || {}).forEach(([key, value]) => {
    const safeKey = String(key || "").trim();
    if (!safeKey || value === undefined || value === null || value === "" || value === false) return;
    query.set(safeKey, value === true ? "1" : String(value));
  });
  const queryString = query.toString();
  return `/storefront/products/facets${queryString ? `?${queryString}` : ""}`;
};
// The frontend ships on a push to main while the API waits on the VPS deploy, so
// for that window the endpoint simply is not there. One 404 is enough to learn
// that; asking again on every listing navigation only adds failed requests.
// Only a 404 counts - a transient network error must not cost the whole session
// its facets.
let storefrontFacetsEndpointMissing = false;
const useStorefrontProductFacets = (scope = {}) => {
  const scopeKey = JSON.stringify(scope);
  const requestUrl = useMemo(() => buildStorefrontFacetsRequestUrl(JSON.parse(scopeKey || "{}")), [scopeKey]);
  const cachedFacetsData = getCachedStorefrontGetData(requestUrl, { ttlMs: STOREFRONT_FACETS_CACHE_TTL_MS });
  const [state, setState] = useState(() => ({ facets: cachedFacetsData?.facets || null, loading: !cachedFacetsData, error: "" }));

  useEffect(() => {
    if (storefrontFacetsEndpointMissing) return undefined;
    let cancelled = false;
    cachedStorefrontGet(requestUrl, { ttlMs: STOREFRONT_FACETS_CACHE_TTL_MS })
      .then((data) => {
        if (cancelled) return;
        setState({ facets: data?.facets || null, loading: false, error: "" });
      })
      .catch((error) => {
        if (Number(error?.status) === 404) storefrontFacetsEndpointMissing = true;
        if (cancelled) return;
        // A facet failure must never blank the sidebar. Leaving `facets` null
        // drops the page back to the options it can still derive from the cards
        // it already holds - narrower, but never empty.
        setState({ facets: null, loading: false, error: error instanceof Error ? error.message : String(error || "") });
      });
    return () => {
      cancelled = true;
    };
  }, [requestUrl]);

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

  // Opens the gate that deferred, off-critical-path work waits on (the ~300 KB of
  // i18n bundles). Runs after commit, and only once there is something on screen --
  // a bootstrap paint from cache counts, an empty loading shell does not.
  const painted = Boolean(initialHome) || !state.loading;
  useEffect(() => {
    if (painted) signalContentPainted();
  }, [painted]);

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
          // A failed refresh of a hero already painted from cache keeps that hero:
          // blanking it turned one bad request into a worse homepage.
          setState((current) => (hasStorefrontHomeContent(current)
            ? { ...current, loading: false }
            : { loading: false, error: error?.message || "Failed to load storefront home", hero: null, mirrorProducts: [], collections: [] }));
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
          setState({ loading: false, error: error?.message || sfText("storefront.errors.categoryOptionsFailed"), options: [] });
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
// A dead photo used to drop straight to the site logo even when the product had
// another usable shot of the same shoe -- one missing file on the server turned a
// real product into a placeholder. Walk the alternates first, and only give up
// once they are exhausted. data-fallback-src carries them, pipe separated.
// The walk (and why its flags reset when React puts another photo on the same node) lives in
// lib/productImageFallback.js.
const fallbackProductImage = (event) => {
  const node = event.currentTarget;
  if (!node) return;
  if (isAiSupportDebugEnabled()) {
    console.warn("[storefront-ai] suggested product image failed", {
      src: node.currentSrc || node.src,
      alt: node.alt,
    });
  }
  applyProductImageFallback(node);
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
// Photos this card may fall back to when its own file is missing. Colour-scoped
// shots first; the product-wide gallery only joins when the product has a single
// colour, because another colour's photo on this card would misdescribe it.
const productCardFallbackImages = (product = {}, variant = null, activeColorGroup = null, primaryImage = "") => {
  const primary = resolveCardImageUrl(primaryImage);
  const colorCount = new Set(
    (Array.isArray(product?.variants) ? product.variants : []).map((item) => variantColorKey(item)).filter(Boolean)
  ).size;
  const wideCandidates = colorCount > 1
    ? []
    : [
        ...(Array.isArray(product?.gallery_images) ? product.gallery_images : []),
        ...(Array.isArray(product?.images) ? product.images : []),
        product?.image_url,
        product?.product_image_url,
      ];
  return productCardResolvedImageCollection([
    ...productCardColorScopedImages(activeColorGroup, variant),
    ...wideCandidates,
  ]).filter((url) => url && url !== primary);
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

// Every route below is a separate chunk fetched at click time, which is exactly
// when a customer is least willing to see a failure. importWithChunkRetry gives
// each one a second chance past a CDN edge that cached a 404, and falls back to
// a silent reload only when the chunk is really gone.
const OrderInvoiceCard = lazy(() => importWithChunkRetry(() => import("../shared/components/invoices/OrderInvoiceCard")));
const LazyFiltersDrawer = lazy(() => Promise.resolve({ default: MobileFilterDrawer }));
const LazyStorefrontProductListingPage = lazy(() =>
  importWithChunkRetry(() => import("./pages/StorefrontProductListingPage.jsx"))
    .then((module) => ({ default: module.StorefrontProductListingPage }))
);
const LazyStorefrontProductDetailPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontProductDetailPage.jsx")).then((module) => ({ default: module.StorefrontProductDetailPage })));
const LazyProductCardVariantSheet = lazy(() => Promise.resolve({ default: ProductCardVariantSheet }));
const LazyProductDetailsVariantSheet = lazy(() => Promise.resolve({ default: ProductDetailsVariantSheet }));
const LazyStorefrontProductGallery = lazy(() => importWithChunkRetry(() => import("./components/StorefrontProductGallery")));
const LazyStorefrontCartPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontCartPage.jsx")));
const LazyStorefrontTrackOrderPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontAsyncPages")).then((module) => ({ default: module.TrackOrderPage })));
const LazyStorefrontAccountPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontAccountPage.jsx")).then((module) => ({ default: module.StorefrontAccountPage })));
const LazyStorefrontWishlistPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontWishlistPage")));
const LazyStorefrontComparePage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontComparePage.jsx")).then((module) => ({ default: module.StorefrontComparePage })));
const LazyStorefrontFaqPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontHelpPages.jsx")).then((module) => ({ default: module.FaqPage })));
const LazyStorefrontReturnsPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontHelpPages.jsx")).then((module) => ({ default: module.ReturnsPolicyPage })));
const LazyStorefrontRecentPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontAsyncPages")).then((module) => ({ default: module.RecentPageRoute })));
const LazyOrderConfirmationActionPage = lazy(() => importWithChunkRetry(() => import("./pages/OrderConfirmationActionPage.jsx")).then((module) => ({ default: module.OrderConfirmationActionPage })));
const LazyStorefrontNotFoundPage = lazy(() => importWithChunkRetry(() => import("./pages/StorefrontNotFoundPage.jsx")));

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
/**
 * Claims the response index.html already started fetching for this URL, if any.
 *
 * The boot script issues the home request while the JS bundles are still
 * downloading, which is ~3.9s earlier than this module could. Consumed once and
 * then cleared: a later refresh must go to the network, not replay a stale boot
 * payload.
 */
const adoptBootPrefetch = (url) => {
  if (typeof window === "undefined") return null;
  const boot = window.__M1_BOOT_HOME;
  if (!boot || boot.key !== url) return null;
  window.__M1_BOOT_HOME = null;
  return boot.promise;
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
  const booted = adoptBootPrefetch(url);
  storefrontDebugLog("[storefront-cache-miss]", { url, ttlMs, strategy: booted ? "boot-prefetch" : "network" });
  // A failed boot prefetch falls back to the normal request rather than surfacing:
  // it is an optimisation, and the network path already reports errors properly.
  const request = (booted ? booted.catch(() => api.get(url)) : api.get(url))
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
// The cart and wishlist are NOT cleared here. They are the customer's own data, not a cache:
// a wiped local cart looks "removed on this device" to the three-way cart merge, which then
// PUTs an empty cart and erases a signed-in customer's cart on every device.
const cleanupStorefrontStorage = () => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    [
      RECENT_KEY,
      PROFILE_KEY,
      LAST_CHECKOUT_KEY,
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
    return persistedStorefrontHomeData(JSON.parse(window.localStorage.getItem(STOREFRONT_HOME_PERSISTED_CACHE_KEY) || "null"));
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
  // Paymob hosted checkout. Driven entirely by server config, so it stays off
  // until the backend reports the keys and integration ids are present.
  online: {
    enabled: false,
    card: false,
    applePay: false,
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
// "Pairs well with". Both keys are absent on a backend that predates the feature,
// which reads as off: no section, and no discount the server would not charge.
const storefrontBundleConfig = (settings = {}) => {
  const rawEnabled = settings?.["storefront.bundle.enabled"] ?? settings?.storefront?.["bundle.enabled"];
  const enabled = rawEnabled === true || rawEnabled === "true" || rawEnabled === 1 || rawEnabled === "1";
  const percent = enabled
    ? normalizeBundleDiscountPercent(settings?.["storefront.bundle.discount_percent"] ?? settings?.storefront?.["bundle.discount_percent"])
    : 0;
  return { enabled, percent };
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
    // Server-computed from the Paymob env config, never from a settings row —
    // an operator cannot switch this on without the keys actually being there.
    online: {
      enabled: Boolean(settings.storefront?.online_payment?.enabled),
      card: Boolean(settings.storefront?.online_payment?.card),
      applePay: Boolean(settings.storefront?.online_payment?.apple_pay),
    },
  };
};
const rawOptionValue = (value, fallback = "") => {
  if (value && typeof value === "object") {
    return String(value.value ?? value.id ?? value.key ?? value.status ?? fallback ?? "").trim();
  }
  return String(value ?? fallback ?? "").trim();
};
// Three buckets, not two: without the gateway case, "card" falls through to
// "shipping_confirmation" and the reconciliation effect below drags the
// customer straight back out of the online payment mode they just picked.
const normalizeCheckoutPaymentMethod = (value) => {
  const raw = rawOptionValue(value).toLowerCase();
  if (raw === "cod") return "cod";
  if (["card", "apple_pay", "paymob"].includes(raw)) return "card";
  return "shipping_confirmation";
};
const CHECKOUT_STEP_STORAGE_KEY = "storefront.checkout.step";

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
// The fields that describe the place. On a one-page checkout the customer types
// their name and phone before the address restore answers, so only an edit to
// one of THESE means "don't overwrite what I wrote".
const CHECKOUT_PLACE_FIELDS = CHECKOUT_ADDRESS_FIELDS.filter((key) => key !== "full_name" && key !== "primary_phone");

// The details of the last order placed from THIS browser. A customer who bought
// before should never type their name, phone and address again, and the saved
// addresses that come from the server only reach a signed-in customer — a guest
// asking for them by phone number would be asking for a stranger's home address.
// So the snapshot lives in this device's own storage: written once an order goes
// through, read back on the next checkout, cleared when the customer signs out.
const LAST_CHECKOUT_KEY = "storefront.checkout.lastDetails";
// Old enough and the address is probably not where they live any more; they get an
// empty form rather than a wrong one silently pre-filled.
const LAST_CHECKOUT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const LAST_CHECKOUT_EXTRA_FIELDS = ["email", "secondary_phone", "city", "area", "zone", "district"];

const readLastCheckoutDetails = () => {
  const saved = readStorefrontStorage(LAST_CHECKOUT_KEY, null);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  const savedAt = Number(saved.saved_at || 0);
  if (!savedAt || Date.now() - savedAt > LAST_CHECKOUT_MAX_AGE_MS) return null;
  return saved;
};

const writeLastCheckoutDetails = (form = {}, overrides = {}) => {
  const snapshot = { saved_at: Date.now() };
  [...CHECKOUT_ADDRESS_FIELDS, ...LAST_CHECKOUT_EXTRA_FIELDS].forEach((key) => {
    snapshot[key] = String(form[key] ?? "").trim();
  });
  Object.entries(overrides).forEach(([key, value]) => {
    snapshot[key] = String(value ?? "").trim();
  });
  writeStorefrontStorage(LAST_CHECKOUT_KEY, snapshot);
};

const clearLastCheckoutDetails = () => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(LAST_CHECKOUT_KEY);
  } catch {
    // Ignore storage access errors.
  }
};

// The store's WhatsApp number lives in the public settings, not in the build.
// VITE_WHATSAPP_PHONE was never defined for any deploy, so every WhatsApp entry
// point degraded to a numberless wa.me link and the order success page rendered
// the disabled "unavailable" button. The shell publishes the resolved number
// here once /settings/public lands; the env var stays a local-dev override.
const envWhatsAppPhone = String(import.meta.env.VITE_WHATSAPP_PHONE || import.meta.env.VITE_STORE_WHATSAPP || "").replace(/\D/g, "");
const toWhatsAppDigits = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  // wa.me needs a country code and a local Egyptian mobile (01xxxxxxxxx) has none.
  if (digits.length === 11 && digits.startsWith("01")) return `20${digits.slice(1)}`;
  return digits;
};
const toWhatsAppHref = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(https?:|whatsapp:)/i.test(raw)) return raw;
  const digits = toWhatsAppDigits(raw);
  return digits ? `https://wa.me/${digits}` : "";
};
// A bare `https://wa.me/` is truthy but opens WhatsApp with nobody to talk to.
const hasWhatsAppRecipient = (href) => {
  const raw = String(href || "").trim();
  if (!raw) return false;
  return /^whatsapp:/i.test(raw) || /wa\.me\/\d/.test(raw) || /[?&](phone|jid)=\d/.test(raw);
};
const withWhatsAppText = (href, text = "") => {
  if (!href || !text) return href || "";
  return `${href}${href.includes("?") ? "&" : "?"}text=${encodeURIComponent(text)}`;
};
let storefrontWhatsAppHrefValue = toWhatsAppHref(envWhatsAppPhone);
const setStorefrontWhatsAppHref = (href) => {
  storefrontWhatsAppHrefValue = hasWhatsAppRecipient(href) ? String(href).trim() : toWhatsAppHref(envWhatsAppPhone);
};
const storefrontWhatsAppHref = () => storefrontWhatsAppHrefValue;
const buildWhatsAppHref = (text = "") => withWhatsAppText(storefrontWhatsAppHrefValue, text) || "https://wa.me/";
const getStatusLabels = () => {
  const labels = i18n.t("storefront.orders.timelineLabels", { returnObjects: true });
  return Array.isArray(labels) && labels.length ? labels : ["Order received", "Preparing", "Shipped", "On the way", "Delivered"];
};
const SEARCH_RECENT_KEY = "storefront.search.recent";
const SEARCH_SIZE_KEY = "storefront.search.size";
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
  const pricing = getDisplayPricing(item, storefrontSalePricesEnabled);
  // A cart line carries no sale flags, so the rule alone never finds its struck-through price.
  return cartLineComparePrice(item, pricing.comparePrice, pricing.price);
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
    .replace(/\u0637\u0152/g, "،")
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
  shoes: { ar: "أحذية", en: "Shoes", aliases: ["shoe", "shoes", "أحذية", "حذاء", "أحذيه"] },
  running: { ar: "جري", en: "Running", aliases: ["running", "run", "جري", "رياضي"] },
  casualshoes: { ar: "أحذية كاجوال", en: "Casual Shoes", aliases: ["casual shoe", "casual shoes", "casual", "كاجوال", "كاجوال شوز"] },
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
// The hero names Mirror Original and opens the Mirror Original listing, but the
// grade also covers bags and slippers - a school bag under a "Mirror Original"
// headline reads as the wrong product. The first card is sneakers only.
const isSneakerProduct = (product) =>
  resolveProductTypeKey(product?.product_type || product?.productType || "") === "sneakers";
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





const homeProductWithImage = (product = {}) => {
  const slide = featuredSlideProduct(product);
  return slide.image ? { ...slide, product } : null;
};







// Category tiles for the homepage rail. Three of them play a short looping
// clip (free-to-use Pexels stock) behind the label -- the owner asked for the
// motion back after a cart fix silently dropped it. The poster is a frame of
// the same clip, so the tile paints instantly and the video simply takes over
// once it can play; where a clip fails or motion is off, the poster stays.
const HOME_CATEGORY_TILES = [
  {
    id: "men",
    titleAr: "رجالي",
    titleEn: "Men",
    href: "/men?product_type=sneakers",
    poster: "/storefront/category-posters/men.webp",
    // Pexels video 33294342, SD rendition (~1 MB).
    video: "https://videos.pexels.com/video-files/33294342/14180878_640_360_24fps.mp4",
    test: (product) => isExclusiveCategoryAudience(product, "men") && resolveProductTypeKey(product.product_type || product.productType) === "sneakers",
  },
  {
    id: "women",
    titleAr: "حريمي",
    titleEn: "Women",
    href: "/women?product_type=sneakers",
    poster: "/storefront/category-posters/women.webp",
    // Pexels video 7877138, SD rendition (~0.7 MB).
    video: "https://videos.pexels.com/video-files/7877138/7877138-sd_640_338_25fps.mp4",
    test: (product) => isExclusiveCategoryAudience(product, "women") && resolveProductTypeKey(product.product_type || product.productType) === "sneakers",
  },
  {
    id: "kids",
    titleAr: "أطفال",
    titleEn: "Kids",
    href: "/kids?product_type=sneakers",
    poster: "/storefront/category-posters/kids.webp",
    // Pexels video 8456205, SD rendition (~0.6 MB).
    video: "https://videos.pexels.com/video-files/8456205/8456205-sd_640_360_25fps.mp4",
    test: (product) => productAudienceValues(product).includes("kids") && resolveProductTypeKey(product.product_type || product.productType) === "sneakers",
  },
];

// Real M1 campaign photography exists for three of the six product groups. The
// other three would have to borrow a cut-out product shot on white, which next
// to a lifestyle tile reads as two different components in one row -- so they
// are links instead. Same destinations, no invented art direction.
const HOME_CATEGORY_LINKS = [
  { id: "slippers", titleAr: "سليبر", titleEn: "Slippers", href: "/slippers" },
  { id: "bags", titleAr: "شنط", titleEn: "Bags", href: "/bags" },
  { id: "crocs", titleAr: "كروكس", titleEn: "Crocs", href: "/crocs" },
  // Mirror Original is deliberately absent: the hero headline names it and its
  // primary button already goes there. A third link to the same place in the
  // same viewport is repetition, not navigation.
];

// Two catalogue rows can be different products and still paint the same card:
// "Adidas sneakers - Black & White" and "Adidas Sneakers - Black & White" are
// separate ids with separate photos, and after the brand line is split off they
// read letter for letter alike. Nothing is wrong with the data -- the homepage
// is a shop window showing 8 of ~1,500 products, and spending two of those eight
// slots on cards a shopper cannot tell apart is the waste. Only the homepage
// selection is thinned; every one of these rows is still reachable from the
// listing, search and category pages.
const dedupeHomeCardsByLabel = (products = [], knownBrands = []) => {
  const seen = new Set();
  return products.filter((product) => {
    const { brand, title } = splitProductDisplayName(product, { knownBrands });
    const price = Number(featuredSlideProduct(product).price || 0);
    const signature = `${brand}|${title}|${price}`.toLowerCase();
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};

// The sizes the current offers actually come in, newest first by how many
// offers carry them. Read from the facets endpoint scoped to offers, so the
// picker can never list a size that has nothing behind it.
//
// Non-numeric sizes are dropped. "مقاس واحد" is reported by the facets with 8
// products, but filtering on it returns 0 — the stored variant value does not
// round-trip through the size filter — and a picker option that lands on an
// empty row is worse than one that is not offered.
const useOfferSizes = () => {
  const [sizes, setSizes] = useState([]);

  useEffect(() => {
    let cancelled = false;
    cachedStorefrontGet("/storefront/products/facets?offer_story=1&in_stock=1", { ttlMs: STOREFRONT_PRODUCTS_CACHE_TTL_MS })
      .then((data) => {
        if (cancelled) return;
        const raw = Array.isArray(data?.facets?.sizes) ? data.facets.sizes : Array.isArray(data?.sizes) ? data.sizes : [];
        const numeric = raw
          .map((entry) => ({ value: String(entry?.value ?? "").trim(), count: Number(entry?.count || 0) }))
          .filter((entry) => /^\d{1,3}$/.test(entry.value) && entry.count > 0)
          .sort((a, b) => Number(a.value) - Number(b.value));
        setSizes(numeric);
      })
      .catch(() => {
        // No sizes means no picker, and the row still shows every offer.
        if (!cancelled) setSizes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return sizes;
};

// The offer collection is the one homepage block that needs a request of its
// own, so it is mounted behind <HomeDeferred> and does not start until the
// reader is most of the way down the page. Boot still costs one /storefront/home
// call, exactly as before.
function HomeOfferCampaign({ isRtl, cardCtx, knownBrands, wishlist, toggleWishlist, onImageError }) {
  const sizes = useOfferSizes();
  const [size, setSize] = useState("");
  const { products, loading } = useProducts({
    offer_story: 1,
    sort: "newest",
    limit: 12,
    ...(size ? { size, in_stock: 1 } : {}),
  });
  // `is_offer_story` is re-checked on the client on purpose: an ignored filter
  // param comes back as a 200 with the whole catalogue in it, and that would
  // quietly file ordinary stock under an "Offers" heading.
  const offerProducts = useMemo(
    () => dedupeHomeCardsByLabel(
      uniqueProductsByIdentity(products).filter(
        (product) => isOfferStory(product) && isAvailableProduct(product) && homeProductWithImage(product)
      ),
      knownBrands
    ).slice(0, 10),
    [knownBrands, products]
  );
  const cards = useMemo(() => offerProducts.map((product) => buildHomeProductCard(product, cardCtx)), [cardCtx, offerProducts]);
  const isFavorite = useCallback(
    (product) => isInWishlist(wishlist, product),
    [wishlist]
  );

  if (!loading && !cards.length && !size) return null;

  // A native <select>: this is a one-of-many choice on a page whose visitors are
  // overwhelmingly on phones, where the platform picker is the better control —
  // it is reachable, scrollable with a thumb, and needs no z-index of its own.
  const sizePicker = sizes.length ? (
    <label className="m1h-frow__size">
      <span className="sr-only">{isRtl ? "اختر المقاس" : "Choose a size"}</span>
      <select value={size} onChange={(event) => setSize(event.target.value)} aria-label={isRtl ? "المقاس" : "Size"}>
        <option value="">{isRtl ? "كل المقاسات" : "All sizes"}</option>
        {sizes.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {isRtl ? `مقاس ${entry.value}` : `Size ${entry.value}`}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  return (
    <HomeFilteredRail
      title={isRtl ? "من العروض" : "From the offers"}
      subtitle=""
      control={sizePicker}
      cards={cards}
      loading={loading}
      viewAllHref={size ? `/offers?size=${encodeURIComponent(size)}` : "/offers"}
      viewAllLabel={
        size
          ? (isRtl ? `شوف كل عروض مقاس ${size}` : `View all size ${size}`)
          : (isRtl ? "شوف كل العروض" : "View all offers")
      }
      emptyLabel={!loading && !cards.length ? (isRtl ? "مفيش عروض في المقاس ده حاليًا." : "No offers in this size right now.") : ""}
      isFavorite={isFavorite}
      onToggleFavorite={toggleWishlist}
      onImageError={onImageError}
      favoriteLabel={isRtl ? "أضف إلى المفضلة" : "Add to wishlist"}
      prevLabel={isRtl ? sfText("storefront.common.previous") : "Previous"}
      nextLabel={isRtl ? sfText("storefront.common.next") : "Next"}
      isRtl={isRtl}
    />
  );
}

// The clip is trimmed and re-encoded to 12s / 1366x720 / no audio — 1.88 MB
// down from the 8.75 MB source, and still under what levelshoes.com ships for
// the same slot (2.79 MB). It was 640 wide once: sharp in a still at 1:1, mush
// on a phone, because a 375px-wide box on a 3x screen paints 1125 device
// pixels. Match the device pixels, not the CSS box.
//
// The loop cuts rather than dissolves. The footage is one continuous pull-back
// from tarmac to open sand, so no 12s window ends anywhere near where it
// began; crossfading the join — at 1s and again at 0.4s — put two very
// different framings on screen at once and read as a double exposure, which is
// worse than a cut. The window starts at 0 because that is where the shoes are
// closest to camera.
//
// Trimming the file is what makes it small: capping the loop in JS was tried
// first, on the theory that a progressive MP4 is fetched in ranges and
// restarting early would leave the tail undownloaded. Measured, and it does
// not — the browser buffered the whole clip either way.
function StorefrontHeroVideo() {
  const videoRef = useRef(null);
  // "Ready" means playing, not merely loadable. A clip that has downloaded but
  // was refused autoplay — Low Power Mode, data saver, a tab woken up offline —
  // is precisely the case where the browser paints its own centred play badge
  // over the middle of the frame. So nothing short of a moving frame is ever
  // shown: a hero that is not playing is the backdrop colour with the copy on
  // it, never a still with a play button on it.
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    // React assigns `muted` as a property, and a browser deciding whether a
    // video may autoplay reads the attribute. Without this the clip is treated
    // as audible, autoplay is refused, and iOS paints its own play button over
    // the middle of the hero — which is exactly what a background video must
    // never look like.
    video.muted = true;
    video.setAttribute("muted", "");

    let released = false;
    const play = () => {
      if (released || !videoRef.current || videoRef.current.paused === false) return;
      const attempt = videoRef.current.play();
      if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
    };

    // Low Power Mode and data-saver refuse autoplay outright. Nothing brings
    // those back except a user gesture, so borrow the first one that lands
    // anywhere on the page — the visitor never knows they started it.
    const playOnGesture = () => play();
    // A browser also pauses a playing video once its tab is hidden and does not
    // resume it on the way back, which would leave the hero frozen mid-stride.
    const resume = () => {
      if (document.visibilityState === "visible") play();
    };

    play();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("pointerdown", playOnGesture, { passive: true });
    document.addEventListener("touchstart", playOnGesture, { passive: true });
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("pointerdown", playOnGesture);
      document.removeEventListener("touchstart", playOnGesture);
    };
  }, []);

  return (
    <div className="sf-hero-video">
      {failed ? null : (
        <video
          ref={videoRef}
          className={`sf-hero-video__media${ready ? " is-ready" : ""}`}
          src="/media/hero-walk.mp4"
          // No poster file: the frame's own average colour is the backdrop, which
          // costs nothing to download and is already painted before the first
          // frame arrives.
          autoPlay
          muted
          loop
          playsInline
          controls={false}
          disablePictureInPicture
          disableRemotePlayback
          preload="auto"
          tabIndex={-1}
          aria-hidden="true"
          onPlaying={() => setReady(true)}
          onPause={() => setReady(false)}
          onError={() => setFailed(true)}
        />
      )}
      <StorefrontHeroVideoOverlay />
    </div>
  );
}

// The copy that sits on the clip.
//
// Footage moves, so nothing on top of it is reliably legible on its own: the
// scrim underneath the text is not decoration, it is what makes the words
// readable while the frame changes. It is a bottom-anchored gradient rather
// than a flat wash so the top of the frame — where the product is — stays
// clear, and its colour, opacity and height all come from Site Studio.
//
// The video is aria-hidden and out of the tab order; this overlay is not. It is
// real copy with real links, so it is announced and focusable in reading order.
// The title is a paragraph, not a heading: the page's <h1> belongs to the
// product hero below and there is only ever one.
function StorefrontHeroVideoOverlay() {
  const { i18n } = useTranslation();
  const design = useSiteDesign();

  useEffect(() => {
    refreshSiteDesign();
  }, []);

  const copy = useMemo(() => resolveHeroCopy(design, i18n.language), [design, i18n.language]);
  if (!copy) return null;

  return (
    <div className={`sf-hero-video__overlay is-${copy.position} is-align-${copy.align}`}>
      <div className="sf-hero-video__scrim" aria-hidden="true" />
      <div className="sf-hero-video__copy">
        {copy.eyebrow ? <span className="sf-hero-video__eyebrow">{copy.eyebrow}</span> : null}
        <p className="sf-hero-video__title">{copy.title}</p>
        {copy.subtitle ? <p className="sf-hero-video__sub">{copy.subtitle}</p> : null}
        {copy.primaryLabel || copy.secondaryLabel ? (
          <div className="sf-hero-video__actions">
            {copy.primaryLabel ? (
              <Link to={copy.primaryHref} className="sf-hero-video__cta">
                {copy.primaryLabel}
              </Link>
            ) : null}
            {copy.secondaryLabel ? (
              <Link to={copy.secondaryHref} className="sf-hero-video__cta sf-hero-video__cta--ghost">
                {copy.secondaryLabel}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// One filtered homepage row: which audience is selected, and the products the
// server returns for it.
//
// The audience switch re-requests rather than filtering in place. A row holds 8
// cards; filtering those 8 down to whichever happen to be men's would show 2 of
// the 69 men's Skechers in the catalogue, and the number on screen would depend
// on how the first page happened to be sorted.
//
// Each (row, audience) answer is cached for the session, so switching back and
// forth costs one request per pair and the second tap is instant.
const HOME_FILTER_ROW_TTL_MS = 5 * 60 * 1000;

const useHomeFilterRow = (rowId, cardCtx) => {
  const row = HOME_FILTER_ROW_MAP[rowId];
  const [gender, setGender] = useState(() => row?.genders?.[0] || "");
  // Whether the visitor chose the audience. Only the row's own opening choice
  // moves on by itself when it comes back empty.
  const [picked, setPicked] = useState(false);
  // `gender` records which audience the products answer, so a switch is never
  // judged on the previous audience's result.
  const [state, setState] = useState({ loading: true, products: [], gender: "" });

  useEffect(() => {
    if (!row) return undefined;
    let cancelled = false;
    const url = `/storefront/products?${homeFilterRowQuery(rowId, gender, { limit: 8 })}`;
    const cached = getCachedStorefrontGetData(url, { ttlMs: HOME_FILTER_ROW_TTL_MS });
    if (cached) {
      setState({ loading: false, products: Array.isArray(cached.products) ? cached.products : [], gender });
      return undefined;
    }
    setState((current) => ({ loading: true, products: current.products, gender }));
    cachedStorefrontGet(url, { ttlMs: HOME_FILTER_ROW_TTL_MS })
      .then((data) => {
        if (cancelled) return;
        setState({ loading: false, products: Array.isArray(data?.products) ? data.products : [], gender });
      })
      .catch(() => {
        // A failed row shows no error under its heading; the rest of the homepage
        // is unaffected by one collection being down.
        if (!cancelled) setState({ loading: false, products: [], gender });
      });
    return () => {
      cancelled = true;
    };
  }, [gender, row, rowId]);

  const cards = useMemo(
    () => state.products.map((product) => buildHomeProductCard(product, cardCtx)).filter((card) => card.image),
    [cardCtx, state.products]
  );

  useEffect(() => {
    const next = nextHomeFilterRowAudience({ genders: row?.genders || [], gender, answeredGender: state.gender, loading: state.loading, cardCount: cards.length, picked });
    if (next) setGender(next);
  }, [cards.length, gender, picked, row, state.gender, state.loading]);

  const chooseGender = useCallback((next) => {
    setPicked(true);
    setGender(next);
  }, []);

  return { gender, setGender: chooseGender, picked, cards, loading: state.loading || state.gender !== gender, row };
};

// One row per component instance, because each row owns a hook (its selected
// audience and its request). A single component looping over the five rows
// would be calling hooks in a loop.
function HomeFilterRowSection({ rowId, cardCtx, lang = "ar", wishlist = [], toggleWishlist, onImageError }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const { gender, setGender, picked, cards, loading, row } = useHomeFilterRow(rowId, cardCtx);

  const isFavorite = useCallback(
    (product) => isInWishlist(wishlist, product),
    [wishlist]
  );
  const genderLabel = useCallback(
    (value) => (isRtl ? GENDER_LABELS[value]?.ar : GENDER_LABELS[value]?.en) || value,
    [isRtl]
  );

  if (!row) return null;

  const audience = genderLabel(gender);
  return (
    <HomeFilteredRail
      title={isRtl ? row.label.ar : row.label.en}
      subtitle={isRtl ? row.subtitle.ar : row.subtitle.en}
      genders={row.genders}
      activeGender={gender}
      genderLabel={genderLabel}
      onGenderChange={setGender}
      // An audience with nothing right now (or a request that failed) keeps the
      // header and its switch, so the visitor can go back to one that has cards.
      keepWhenEmpty={keepHomeFilterRowWhenEmpty({ genders: row.genders, gender, picked })}
      emptyLabel={sfText("storefront.home.filterRowEmpty")}
      cards={cards}
      loading={loading}
      viewAllHref={homeFilterRowHref(rowId, gender)}
      // "شوف كل الرجالي" — the button names the audience the visitor is looking
      // at, so it never promises more than it opens.
      viewAllLabel={isRtl ? `شوف كل ${audience}` : `View all ${audience}`}
      isFavorite={isFavorite}
      onToggleFavorite={toggleWishlist}
      onImageError={onImageError}
      favoriteLabel={isRtl ? "أضف إلى المفضلة" : "Add to wishlist"}
      prevLabel={isRtl ? sfText("storefront.common.previous") : "Previous"}
      nextLabel={isRtl ? sfText("storefront.common.next") : "Next"}
      isRtl={isRtl}
    />
  );
}

function PremiumHomePage(props) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const homeRootRef = useRef(null);
  const lang = i18n.language || "ar";
  const isRtl = normalizeLanguage(lang) === "ar";
  const themeMode = props.themeMode || "light";
  const themeTokens = useMemo(() => getStorefrontThemeTokens(themeMode), [themeMode]);
  const siteDesign = useSiteDesign();
  const brandFilter = params.get("brand") || "";
  const wishlist = useMemo(() => (Array.isArray(props.wishlist) ? props.wishlist : []), [props.wishlist]);
  const toggleWishlist = props.toggleWishlist;
  const storefrontHome = useStorefrontHome();
  const { brands, loading: brandsLoading } = useStorefrontBrands();
  const loading = storefrontHome.loading;

  useEffect(() => {
    if (!loading) releaseBootLoader();
  }, [loading]);

  useEffect(() => {
    if (!brandFilter || !isStorefrontHomePath(location.pathname)) return;
    navigate(productsPath({ brand: brandFilter }), { replace: true });
  }, [brandFilter, location.pathname, navigate]);

  const knownBrandNames = useMemo(
    () => (Array.isArray(brands) ? brands : []).map((brand) => brand?.name).filter(Boolean),
    [brands]
  );
  const visibleBrands = useMemo(
    () => (Array.isArray(brands) ? brands : []).filter((brand) => brand?.id && brand?.name && brand?.logo_url),
    [brands]
  );

  const storefrontHomeProducts = useMemo(
    () => uniqueProductsByIdentity((storefrontHome.collections || []).flatMap((collection) => collection.products || [])),
    [storefrontHome.collections]
  );
  const mirrorProducts = useMemo(
    () => uniqueProductsByIdentity(storefrontHome.mirrorProducts || []).filter(isMirrorProduct),
    [storefrontHome.mirrorProducts]
  );
  const homepageProductPool = useMemo(() => {
    const available = storefrontHomeProducts.filter(isAvailableProduct);
    return uniqueProductsByIdentity([...(available.length ? available : storefrontHomeProducts), ...storefrontHomeProducts]);
  }, [storefrontHomeProducts]);
  const homepageProductsWithImages = useMemo(
    () => dedupeHomeCardsByLabel(
      homepageProductPool.filter((product) => isAvailableProduct(product) && homeProductWithImage(product)),
      knownBrandNames
    ),
    [homepageProductPool, knownBrandNames]
  );

  // Five hero slides, not twelve: a hero that has to cycle a dozen products is a
  // carousel of everything, and nothing in it gets looked at.
  const heroSlides = useMemo(() => {
    const mirrorPool = uniqueProductsByIdentity([
      ...(Array.isArray(mirrorProducts) ? mirrorProducts : []),
      ...homepageProductPool.filter(isMirrorProduct),
    ])
      .filter((product) => isAvailableProduct(product) && homeProductWithImage(product))
      .sort((a, b) => stockScore(b) - stockScore(a) || newestScore(b) - newestScore(a));
    // Sneakers only. The fallback to the whole mirror pool exists so a catalogue
    // that momentarily holds no in-stock mirror sneaker leaves a hero standing
    // rather than a blank slot at the top of the homepage.
    const mirrorSneakers = mirrorPool.filter(isSneakerProduct);
    const candidates = mirrorSneakers.length ? mirrorSneakers : mirrorPool;
    const heroFallback = storefrontHome.hero && isMirrorProduct(storefrontHome.hero) ? [storefrontHome.hero] : [];
    return (candidates.length ? candidates : heroFallback).slice(0, 5).map((product, index) => {
      const slide = featuredSlideProduct(product);
      const { brand, title } = splitProductDisplayName(product, { knownBrands: knownBrandNames });
      const slidePrice = Number(slide.price) || 0;
      const slideComparePrice = Number(slide.comparePrice) || 0;
      return {
        key: productIdentityKey(product, index),
        href: productUrl(product),
        image: slide.image ? imageFor(slide.image) : "",
        imageProps: slide.image ? responsiveImageProps(slide.image, "hero") : {},
        rawImage: slide.image || "",
        name: [brand, title].filter(Boolean).join(" "),
        priceText: slidePrice > 0 ? money(slidePrice) : "",
        // The struck-through original only says anything beside a real price,
        // and only while it is actually higher than what the shopper pays.
        compareText: slidePrice > 0 && slideComparePrice > slidePrice ? money(slideComparePrice) : "",
      };
    });
  }, [homepageProductPool, knownBrandNames, mirrorProducts, storefrontHome.hero]);

  const cardCtx = useMemo(
    () => ({
      imageFor,
      responsiveImageProps,
      money,
      productUrl,
      pricing: featuredSlideProduct,
      knownBrands: knownBrandNames,
      // No brand inside the name and none on the record: fall back to the
      // product type, which is a real catalogue field, rather than inventing a
      // label just to keep the row filled.
      fallbackEyebrow: (product) => getProductTypeLabel(product?.product_type || product?.productType || "", isRtl ? "ar" : "en"),
      isLastPiece: isLastPieceProduct,
      lastPieceLabel: isRtl ? "آخر قطعة" : "Last pair",
    }),
    [isRtl, knownBrandNames]
  );

  const categoryTiles = useMemo(
    () => HOME_CATEGORY_TILES.map((tile) => {
      const match = homepageProductsWithImages.find((product) => tile.test(product, productSearchText(product)));
      const image = tile.poster || (match ? homeProductWithImage(match)?.image || "" : "");
      return {
        id: tile.id,
        href: tile.href,
        title: isRtl ? tile.titleAr : tile.titleEn,
        image: image ? imageFor(image) : "",
        video: tile.video || "",
      };
    }).filter((tile) => tile.image),
    [homepageProductsWithImages, isRtl]
  );
  const categoryLinks = useMemo(
    () => HOME_CATEGORY_LINKS.map((link) => ({ href: link.href, label: isRtl ? link.titleAr : link.titleEn })),
    [isRtl]
  );

  const preloadSlide = useCallback((slide) => {
    if (slide?.rawImage) preloadStorefrontImage(slide.rawImage, "hero");
  }, []);

  useHomeReveal(homeRootRef, [categoryTiles.length, visibleBrands.length, loading]);

  // No eyebrow above this hero: the owner asked for the label to go entirely.
  // The slot is removed rather than emptied — HomeHero skips the element when
  // there is no eyebrow, so the title moves up instead of sitting under a gap.
  const heroCopy = isRtl
    ? {
        title: "ميرور أوريجنال",
        subtitle: "موديلات مختارة بمقاسات متاحة، وتوصيل لكل محافظات مصر.",
        primaryLabel: "تسوق ميرور أوريجنال",
        primaryHref: productsPath({ quality: "mirror_original", sort: "newest" }),
        secondaryLabel: "شوف العروض",
        secondaryHref: "/offers",
        slidesLabel: "اختيارات ميرور",
      }
    : {
        title: "Mirror Original",
        subtitle: "Selected models, sizes in stock, delivered across Egypt.",
        primaryLabel: "Shop Mirror Original",
        primaryHref: productsPath({ quality: "mirror_original", sort: "newest" }),
        secondaryLabel: "See offers",
        secondaryHref: "/offers",
        slidesLabel: "Mirror picks",
      };

  // The homepage as a set of named sections rather than a fixed sequence, so
  // Site Studio can reorder and hide them. The ids are the contract with
  // HOME_SECTIONS in shared/siteDesign.js — renaming one here drops that section
  // for every store that already saved an order.
  //
  // Every section is built whether it renders or not: they are plain elements,
  // not calls, so an unrendered one costs an object literal. Making this lazy
  // would mean hooks inside conditionals.
  const homeSectionOrder = resolveHomeSections(siteDesign);
  const homeSectionNodes = {
    heroVideo: <StorefrontHeroVideo />,
    productHero: (
      <HomeHero
        isRtl={isRtl}
        loading={loading}
        slides={heroSlides}
        copy={heroCopy}
        onImageError={fallbackProductImage}
        onPreloadSlide={preloadSlide}
      />
    ),
    categories: (
      <HomeCategoryRail
        title={resolveSectionTitle(siteDesign, "categories", lang)}
        cards={categoryTiles}
        links={categoryLinks}
        loading={loading}
        onImageError={fallbackProductImage}
      />
    ),
    // The five filtered rows. Each is its own component instance because each
    // owns a request and a selected audience.
    ...Object.fromEntries(
      HOME_FILTER_ROWS.map((row) => [
        row.id,
        <HomeFilterRowSection
          rowId={row.id}
          cardCtx={cardCtx}
          lang={lang}
          wishlist={wishlist}
          toggleWishlist={toggleWishlist}
          onImageError={fallbackProductImage}
        />,
      ])
    ),
    offers: (
      <HomeDeferred minHeight={420}>
        <HomeOfferCampaign
          isRtl={isRtl}
          cardCtx={cardCtx}
          knownBrands={knownBrandNames}
          wishlist={wishlist}
          toggleWishlist={toggleWishlist}
          onImageError={fallbackProductImage}
        />
      </HomeDeferred>
    ),
    brands: <HomeBrandStrip lang={lang} themeTokens={themeTokens} brands={visibleBrands} loading={brandsLoading} />,
    trust: <HomeTrustStrip isRtl={isRtl} />,
  };

  return (
    <div
      ref={homeRootRef}
      className="m1h sf-page pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.5rem)] md:pb-0"
      data-theme={themeTokens.resolvedMode}
    >
      {homeSectionOrder.map((sectionId) => {
        const section = homeSectionNodes[sectionId];
        // An id the renderer does not know is skipped rather than thrown on: a
        // section removed from the code must not blank the homepage of every
        // store that still has it in its saved order.
        return section ? <Fragment key={sectionId}>{section}</Fragment> : null;
      })}
      {/* Not a section. The footer is the end of the page, and an owner who
          dragged it to the top would only be reporting a bug. */}
      <HomeSimpleFooter lang={lang} themeTokens={themeTokens} />
      {/* Also not a section: it floats over the page and has no place in an order.
          It is portalled to the body, so it takes the accent as a value rather
          than reading the --m1h-* token declared on this root. */}
      <StorefrontScrollTopButton
        isRtl={isRtl}
        accent={siteDesign?.palette?.[themeTokens.resolvedMode]?.accent || themeTokens.accent}
      />
    </div>
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
    // sf-home-brands is kept for the marquee's dark-mode logo treatment (white
    // frame plus multiply blend); the section's own band, gold wash and rule are
    // neutralised in home.css so it sits on the same rhythm as every other block.
    <section className="sf-home-brands m1h-block m1h-reveal" dir={isRtl ? "rtl" : "ltr"}>
      <div className="m1h-shell overflow-hidden">
        <HomeSectionHeader title={isRtl ? "العلامات التجارية" : "Brands"} />

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
    // The `bg-[linear-gradient(...)]` utility stays only because
    // tests/storefront-home-footer.test.js pins it; the inline token background
    // outranks it. The strip used to be an always-black band whose headings the
    // `.text-white` remap turned black-on-black in light mode — it is now the
    // site surface in both themes, with accent-soft icon bubbles.
    <section
      data-testid="storefront-service-strip"
      className="sf-home-motion sf-home-motion--stagger hidden bg-[linear-gradient(180deg,#121212_0%,#080808_100%)] md:mt-12 md:block"
      style={{ background: "var(--m1h-surface)", color: "var(--m1h-text)", borderBlock: "1px solid var(--m1h-line)" }}
    >
      <div className="sfx-wrap grid sm:grid-cols-2 md:grid-cols-4">
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="sf-home-motion-item flex min-h-[190px] flex-col items-center justify-center px-4 py-7 text-center md:min-h-[230px] md:px-7" style={{ "--sf-motion-index": index }}>
                <span className="grid h-16 w-16 place-items-center rounded-full" style={{ background: "var(--m1h-accent-soft)", color: "var(--m1h-accent)" }}>
                  <Icon className="h-8 w-8" strokeWidth={1.55} />
                </span>
                <h3 className="sfx-h3 mt-5">{item.title}</h3>
                <p className="mt-2 mb-0 max-w-[250px] text-sm leading-6" style={{ color: "var(--m1h-text-2)" }}>{item.text}</p>
              </div>
            );
          })}
      </div>
    </section>
  );
}

// Meeza in one ink: the tile with its E knocked out, then the wordmark. Drawn
// in currentColor so it takes the bar's text colour like the other marks —
// /branding/meeza-logo.svg carries fixed brand colours and cannot.
function MeezaMark({ className = "" }) {
  return (
    <svg viewBox="0 0 150 60" className={className} fill="currentColor" aria-hidden="true" focusable="false">
      <path fillRule="evenodd" d="M12 4h26c6.6 0 12 5.4 12 12v28c0 6.6-5.4 12-12 12H12C5.4 56 0 50.6 0 44V16C0 9.4 5.4 4 12 4Zm0 13v26h27v-6.5H20.5v-4h15v-6h-15v-3h18V17Z" />
      <text x="58" y="42" fontFamily="Arial, Helvetica, sans-serif" fontSize="32" fontWeight="700" letterSpacing="-1">meeza</text>
    </svg>
  );
}

// The floating contact button sits over the last lines of every page. Near the
// bottom it turns see-through so the footer reads through it, and comes back
// in full on hover or keyboard focus (index.css), rather than the footer
// padding itself out to make room.
const WHATSAPP_FLOAT_FADE_DISTANCE_PX = 120;

// Our Facebook page slug, read off the page URL in the store settings, so the
// Messenger chip opens a chat with the page (m.me/<slug>) rather than the page.
const facebookPageSlug = (url = "") => {
  const match = String(url || "").trim().match(/^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/([^/?#]+)/i);
  const slug = match ? decodeURIComponent(match[1]) : "";
  return slug && !/^(share|profile\.php|pages|groups|people)$/i.test(slug) ? slug : "";
};

// One button, three chat channels: tapping it fans WhatsApp, Instagram and
// Messenger out above it and turns it into a close X. A channel whose account
// is not set in the store settings is left out.
function StorefrontContactFloat({ whatsappHref = "", instagramHref = "", messengerHref = "", lang = "ar" }) {
  const [atBottom, setAtBottom] = useState(false);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const isRtl = normalizeLanguage(lang) === "ar";
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    const onPointer = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    // Three reads and a boolean: cheap enough to run on every scroll event, and
    // React skips the render when the answer has not changed.
    const measure = () => {
      const root = document.documentElement;
      setAtBottom(window.innerHeight + window.scrollY >= root.scrollHeight - WHATSAPP_FLOAT_FADE_DISTANCE_PX);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);
  const channels = [
    { key: "whatsapp", label: "WhatsApp", href: whatsappHref, icon: FaWhatsapp },
    { key: "instagram", label: "Instagram", href: instagramHref, icon: FaInstagram },
    { key: "messenger", label: "Messenger", href: messengerHref, icon: FaFacebookMessenger },
  ].filter((channel) => channel.href);
  if (!channels.length) return null;
  const toggleLabel = open ? (isRtl ? "إغلاق" : "Close") : (isRtl ? "تواصل معنا" : "Chat with us");
  return (
    <div
      ref={rootRef}
      className="sf-contact-float fixed z-[70]"
      data-open={open ? "true" : "false"}
      data-at-bottom={atBottom ? "true" : "false"}
    >
      <ul id="sf-contact-float-list" className="sf-contact-float__list" aria-hidden={open ? undefined : "true"}>
        {channels.map(({ key, label, href, icon: Icon }, index) => (
          <li key={key} style={{ "--sf-contact-i": channels.length - 1 - index }}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={label}
              title={label}
              tabIndex={open ? undefined : -1}
              onClick={() => setOpen(false)}
              className={`sf-contact-float__chip sf-contact-float__chip--${key}`}
            >
              <Icon aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="sf-contact-float-list"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => setOpen((current) => !current)}
        className="sf-contact-float__toggle"
      >
        {open ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
      </button>
    </div>
  );
}

// A footer section: a tappable hairline row on phones, a plain column heading
// from md up (the button stays in the markup but the panel is always shown).
function FooterGroup({ id, as: Tag = "section", title, headingStyle, open, onToggle, children }) {
  const panelId = `sf-footer-panel-${id}`;
  return (
    <Tag aria-label={Tag === "nav" ? title : undefined} className="sf-footer__group border-b md:border-b-0" style={{ borderColor: "var(--m1h-line)" }}>
      <h3 className="font-semibold" style={headingStyle}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(id)}
          className="sf-footer__toggle flex w-full items-center justify-between gap-3 py-4 text-start md:pointer-events-none md:cursor-default md:py-0"
        >
          <span>{title}</span>
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform duration-200 md:hidden ${open ? "rotate-180" : ""}`} />
        </button>
      </h3>
      <div id={panelId} className={`sf-footer__panel pb-5 md:mt-4 md:block md:pb-0 ${open ? "block" : "hidden"}`}>
        {children}
      </div>
    </Tag>
  );
}

function HomeSimpleFooter({ lang = "ar", themeTokens = {} }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  // Grouped the way international shops group a footer: what to buy, and help
  // after buying. "Home" and an "About us" that also pointed at "/" were
  // dropped — the logo already goes home and the about text is its own section.
  const categoryLinks = [
    { label: isRtl ? "سنيكرز رجالي" : "Men's sneakers", to: "/men" },
    { label: isRtl ? "سنيكرز حريمي" : "Women's sneakers", to: "/women" },
    { label: isRtl ? "أحذية أطفال" : "Kids sneakers", to: "/kids" },
    { label: isRtl ? "شنط" : "Bags", to: "/bags" },
    { label: isRtl ? "ميرور أوريجنال" : "Mirror Original", to: "/products?quality=mirror_original" },
    { label: isRtl ? "العروض" : "Offers", to: "/offers" },
  ];
  const helpLinks = [
    { label: isRtl ? "تتبع طلبك" : "Track your order", to: "/track" },
    { label: isRtl ? "الاستبدال والاسترجاع" : "Returns & exchanges", to: "/returns" },
    { label: isRtl ? "الأسئلة الشائعة" : "FAQ", to: "/faq" },
    { label: isRtl ? "حسابي" : "My account", to: "/account" },
  ];
  // Both legal pages must be reachable from the storefront without an account:
  // platform reviewers follow them from the site, not only from a portal field.
  // They sit in the copyright bar, small, as on most international shops.
  const legalLinks = [
    { label: isRtl ? "الشروط والأحكام" : "Terms & conditions", to: "/terms" },
    { label: isRtl ? "سياسة الخصوصية" : "Privacy policy", to: "/privacy" },
  ];
  // Footer ink follows the Site Studio footer colours (--sf-footer-*, painted on
  // .sf-footer by index.css), never a Tailwind stone utility: those are
  // remapped to the ERP palette and their dark: twins never fire in the shop.
  const footerHeadingStyle = { fontSize: "var(--sfx-t-h3)", color: "var(--sf-footer-ink, var(--m1h-text))" };
  const footerMutedStyle = { color: "var(--sf-footer-ink, var(--m1h-text-2))", opacity: 0.78 };
  // One section open at a time on phones; desktop ignores it (panels always shown).
  const [openFooterGroup, setOpenFooterGroup] = useState("");
  const toggleFooterGroup = (id) => setOpenFooterGroup((current) => (current === id ? "" : id));
  const whatsappHref = buildWhatsAppHref(isRtl ? "مرحبًا، أحتاج مساعدة من خدمة العملاء" : "Hi, I need customer support");
  const currentYear = new Date().getFullYear();
  const supportEmail = "support@m1store-egy.com";
  const socialLinks = [
    { label: "Facebook", href: "https://www.facebook.com/", icon: FaFacebookF },
    { label: "Instagram", href: "https://www.instagram.com/", icon: FaInstagram },
    { label: "TikTok", href: "https://www.tiktok.com/", icon: FaTiktok },
    { label: "YouTube", href: "https://www.youtube.com/", icon: FaYoutube },
  ];
  // Only what checkout actually takes: cards, Meeza and Apple Pay through Paymob,
  // InstaPay and Vodafone Cash as transfers. A wallet the shop does not accept
  // was shown here once; a mark here is a promise checkout has to keep.
  const paymentMarks = [
    { label: "Visa", mark: <SiVisa className="-my-2 h-10 w-10" /> },
    { label: "Mastercard", mark: <SiMastercard className="h-5 w-7" /> },
    { label: "Meeza", mark: <MeezaMark className="h-5 w-auto" /> },
    { label: "Apple Pay", mark: <SiApplepay className="-my-2 h-10 w-10" /> },
    { label: "InstaPay", mark: <span className="text-[13px] font-black tracking-tight">InstaPay</span> },
    {
      label: "Vodafone Cash",
      mark: (
        <span className="inline-flex items-center gap-1 text-[12px] font-black tracking-tight">
          <SiVodafone className="h-4 w-4" />
          Cash
        </span>
      ),
    },
  ];

  return (
    <footer data-testid="storefront-modern-footer" data-theme={themeTokens.resolvedMode || "light"} dir={isRtl ? "rtl" : "ltr"} className="sf-footer border-t border-stone-200 bg-[#f5f3ef] text-stone-900 dark:border-white/[0.08] dark:bg-[#080808] dark:text-white">
      <div className="sfx-wrap pb-10 pt-10 md:pb-12 md:pt-14">
        <div className="grid gap-8 md:grid-cols-2 md:gap-10 lg:grid-cols-[1.25fr_1.6fr_0.9fr_1fr]">
          <div>
            <div className="relative h-16 w-16 md:h-20 md:w-20" aria-label="M1 Store">
              {/* Which artwork shows is decided by `.storefront-dark` in
                  index.css, not by the `dark:` variant — the shop runs with
                  Tailwind's `dark` class off in both themes, so `dark:hidden`
                  here left the DARK logo on the black footer. */}
              <div className="sf-footer-logo sf-footer-logo--on-light absolute inset-0">
                <img src="/branding/m-one-logo-dark-fixed.png?v=20260716" alt="M1 Store" className="absolute inset-0 h-full w-full object-contain" width="160" height="160" loading="lazy" decoding="async" />
                <img src="/branding/m-one-logo-dark-m.png?v=20260716" alt="" aria-hidden="true" className="sf-header-logo-moving-m absolute inset-0 h-full w-full object-contain" width="160" height="160" loading="lazy" decoding="async" />
              </div>
              <div className="sf-footer-logo sf-footer-logo--on-dark absolute inset-0 hidden">
                <img src="/branding/m-one-logo-white-fixed.png?v=20260716" alt="M1 Store" className="absolute inset-0 h-full w-full object-contain" width="160" height="160" loading="lazy" decoding="async" />
                <img src="/branding/m-one-logo-white-m.png?v=20260716" alt="" aria-hidden="true" className="sf-header-logo-moving-m absolute inset-0 h-full w-full object-contain" width="160" height="160" loading="lazy" decoding="async" />
              </div>
            </div>
            <p className="mt-5 text-xs font-medium" style={footerMutedStyle}>{isRtl ? "كل يوم من 12 ظهرًا حتى 12 مساءً" : "Every day, 12 PM – 12 AM"}</p>
            <a href={whatsappHref} target="_blank" rel="noreferrer" className="sf-footer__contact mt-2 flex items-center gap-2 text-sm font-semibold transition">
              <FaWhatsapp className="h-5 w-5" style={{ color: "var(--sfx-whatsapp)" }} />
              {isRtl ? "خدمة العملاء" : "Customer service"}
            </a>
            <a href={`mailto:${supportEmail}`} className="sf-footer__contact mt-4 flex items-center gap-2 text-sm font-semibold transition">
              <Mail className="h-5 w-5" style={{ color: "var(--m1h-accent)" }} />
              <span dir="ltr">{supportEmail}</span>
            </a>
            <div className="mt-5 flex flex-wrap gap-2">
              {socialLinks.map(({ label, href, icon: SocialIcon }) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" aria-label={label} className="sf-footer__social grid h-10 w-10 place-items-center rounded-full transition hover:-translate-y-0.5" style={{ border: "1px solid var(--m1h-line)", background: "var(--m1h-surface)", color: "var(--m1h-text)" }}>
                  <SocialIcon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Phones: one hairline row per section, closed until tapped
              (Nike/Zara/H&M) — the open lists made the footer longer than the
              page above it. Desktop: plain columns, always open. */}
          <div className="sf-footer__groups border-t md:contents" style={{ borderColor: "var(--m1h-line)" }}>
            <FooterGroup id="about" title={isRtl ? "معلومات عنا" : "About M1 Store"} headingStyle={footerHeadingStyle} open={openFooterGroup === "about"} onToggle={toggleFooterGroup}>
              <p className="text-sm leading-7" style={footerMutedStyle}>
                {isRtl
                  ? "M1 Store متجر متخصص في الأحذية والسنيكرز والشنط المختارة بعناية. نهتم بالجودة، الراحة، التصميم العصري والسعر المناسب لتجد اختيارك المناسب لكل يوم."
                  : "M1 Store offers carefully selected sneakers, footwear and bags. We focus on quality, comfort, modern design and fair prices for every day."}
              </p>
            </FooterGroup>

            <FooterGroup id="shop" as="nav" title={isRtl ? "تسوق" : "Shop"} headingStyle={footerHeadingStyle} open={openFooterGroup === "shop"} onToggle={toggleFooterGroup}>
              <ul className="grid gap-3">
                {categoryLinks.map((link) => (
                  <li key={link.label}><Link to={link.to} className="sf-footer__link text-sm font-medium transition" style={footerMutedStyle}>{link.label}</Link></li>
                ))}
              </ul>
            </FooterGroup>

            <FooterGroup id="help" as="nav" title={isRtl ? "المساعدة" : "Help"} headingStyle={footerHeadingStyle} open={openFooterGroup === "help"} onToggle={toggleFooterGroup}>
              <ul className="grid gap-3">
                {helpLinks.map((link) => (
                  <li key={link.label}><Link to={link.to} className="sf-footer__link text-sm font-medium transition" style={footerMutedStyle}>{link.label}</Link></li>
                ))}
              </ul>
            </FooterGroup>
          </div>

          {/* The newsletter sign-up was removed on request. It also never
              subscribed anyone: the form only raised a success toast, so every
              address typed into it was thrown away. */}
        </div>

        {/* The app-launch block was removed on request — the app is not
            published, so the footer does not advertise it. */}
      </div>

      {/* Payment marks sit in the copyright bar as one-ink logos, the way
          international shops show them: no tiles, no brand colours, the bar's
          own text colour at reduced strength so they read as part of it.
          Phones: logos first, copyright as the last line of the page. Desktop:
          one row. The floating WhatsApp button fades while the page bottom is
          in view (StorefrontContactFloat) instead of the bar reserving room. */}
      <div className="sf-footer__bar bg-[#050505] px-5 py-5 text-center text-xs font-semibold">
        <div className="sfx-wrap flex flex-col-reverse items-center gap-4 md:flex-row md:justify-between">
          <div className="flex flex-col items-center gap-2 md:flex-row md:gap-5">
            <span>{isRtl ? `جميع الحقوق محفوظة © ${currentYear} - M1 Store` : `© ${currentYear} M1 Store. All rights reserved.`}</span>
            <nav aria-label={isRtl ? "روابط قانونية" : "Legal"} className="flex items-center gap-4 font-medium">
              {legalLinks.map((link) => (
                <Link key={link.label} to={link.to} className="sf-footer__legal opacity-70 transition-opacity hover:opacity-100">{link.label}</Link>
              ))}
            </nav>
          </div>
          <ul aria-label={isRtl ? "طرق الدفع" : "Payment methods"} className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3" dir="ltr">
            {paymentMarks.map(({ label, mark }) => (
              <li key={label} title={label} aria-label={label} className="sf-footer__mark flex h-6 items-center opacity-70 transition-opacity hover:opacity-100">
                {mark}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

function SectionIntro({ eyebrow, title, subtitle, compact = false }) {
  return (
    <div className={compact ? "max-w-2xl" : "max-w-3xl"}>
      {/* A kicker only when it says something the title does not (owner decree). */}
      {eyebrow && String(eyebrow).trim() !== String(title || "").trim() ? <span className="sfx-kicker">{eyebrow}</span> : null}
      <h2 className="sfx-h2">{title}</h2>
      {subtitle ? <p className="sfx-subtitle">{subtitle}</p> : null}
    </div>
  );
}



// The offers story stays a dark media surface in both themes (a story reads
// over black), so it paints from the media tokens instead of Tailwind colour
// utilities: `text-white` is remapped to the ERP ink in light mode, which made
// this viewer black-on-black. Hairlines and glass are tints of the media ink (color-mix),
// so they move with the token too.
const OFFER_STORY_INK = { color: "var(--sfx-media-ink)" };
const OFFER_STORY_GOLD = { borderColor: "transparent", background: "var(--sfx-accent-strong)", color: "var(--sfx-on-accent)" };
const OFFER_STORY_GLASS = { borderColor: "color-mix(in srgb, var(--sfx-media-ink) 12%, transparent)", background: "color-mix(in srgb, var(--sfx-media-ink) 6%, transparent)", color: "var(--sfx-media-ink)" };
const OFFER_STORY_ICON = { background: "color-mix(in srgb, var(--sfx-media-ink) 8%, transparent)", color: "var(--sfx-accent-strong)" };

function OfferStoryEmptyState({ title, text, actionLabel, onAction }) {
  return (
    <div className="grid place-items-center border p-6 text-center backdrop-blur" style={{ ...OFFER_STORY_GLASS, borderRadius: "var(--m1h-r-xl)" }}>
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full" style={OFFER_STORY_ICON}>
        <BadgePercent className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-xl font-bold">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6" style={{ opacity: 0.72 }}>{text}</p>
      {onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="sfx-btn mt-5 active:scale-[0.98]" style={OFFER_STORY_GOLD}
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
      className={`relative overflow-hidden rounded-full border px-3 py-2.5 text-center font-semibold transition active:scale-[0.98] ${compact ? "min-h-11 text-sm" : "min-h-14 text-[0.95rem] md:min-h-16 md:text-base"}`}
      style={active ? OFFER_STORY_GOLD : OFFER_STORY_GLASS}
    >
      <span className="block truncate">{label}</span>
      {Number.isFinite(Number(count)) ? <span className="mt-0.5 block text-[10px] font-semibold" style={{ opacity: active ? 0.8 : 0.55 }}>{count} {Number(count) === 1 ? sfText("storefront.offers.modelOne") : sfText("storefront.offers.modelMany")}</span> : null}
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
      className="relative isolate flex h-full min-h-[72dvh] overflow-hidden border md:min-h-[76dvh]"
      style={{ borderColor: "color-mix(in srgb, var(--sfx-media-ink) 10%, transparent)", borderRadius: "var(--m1h-r-xl)", background: "var(--sfx-media-scrim)" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.14)_0%,rgba(0,0,0,0.03)_18%,rgba(0,0,0,0.22)_68%,rgba(0,0,0,0.64)_100%)]" />
      <div className="relative z-20 flex h-full w-full flex-col px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[3.25rem] md:px-5 md:pt-[3.5rem]">
        <div className="relative flex min-h-0 flex-[1.55] items-center justify-center">
          <div className="flex h-full w-full max-w-[58rem] items-center justify-center p-3 md:p-4" style={{ background: "var(--m1h-plate)", borderRadius: "var(--m1h-r-lg)" }}>
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
            <h3 className="line-clamp-2 text-lg font-bold leading-6 md:text-2xl md:leading-7">{product.name}</h3>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ opacity: 0.55 }}>{product.brand_name || product.brand || ""}</p>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-2xl font-bold md:text-4xl">{money(priceInfo.displayPrice)}</span>
              {priceInfo.crossedPrice > priceInfo.displayPrice ? <span className="pb-1 text-sm font-medium line-through md:text-base" style={{ opacity: 0.5 }}>{money(priceInfo.crossedPrice)}</span> : null}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sizeChips.map((size) => (
              <span key={size} className="rounded-full border px-2.5 py-1 text-[10px] font-semibold" style={String(size) === String(selectedSize) ? OFFER_STORY_GOLD : OFFER_STORY_GLASS}>
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
              className="sfx-btn active:scale-[0.98]" style={OFFER_STORY_GOLD}
            >
              {sfText("storefront.products.viewProduct")}
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
    <div className="sf-offer-story-viewer fixed inset-0 z-[2000] overflow-hidden bg-[linear-gradient(180deg,#040404_0%,#101010_45%,#040404_100%)]" style={OFFER_STORY_INK} onClick={handleViewerClick}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_12%,rgba(212,175,55,0.22),transparent_24%),radial-gradient(circle_at_82%_10%,rgba(248,231,179,0.12),transparent_18%)]" />
      <div className="relative flex h-[100dvh] w-[100vw] flex-col px-3 pb-[calc(0.8rem+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top,12px)+0.35rem)] md:px-5">
        <div className="flex items-start gap-3">
          <button type="button" onClick={(event) => { event.stopPropagation(); closeStory(); }} className="relative z-30 grid h-11 w-11 shrink-0 place-items-center rounded-full border transition active:scale-95" style={OFFER_STORY_GLASS} aria-label={sfText("storefront.common.close")}>
            <X className="h-5 w-5" />
          </button>
          <div className="flex-1 pt-1">
            {stage === "story" && storyProgressTotal > 0 ? (
              <div className="relative z-30 flex gap-1.5">
                {Array.from({ length: storyProgressTotal }).map((_, itemIndex) => (
                  <span key={itemIndex} className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: itemIndex <= storyProgressIndex ? "var(--sfx-accent-strong)" : "color-mix(in srgb, var(--sfx-media-ink) 18%, transparent)" }} />
                ))}
              </div>
            ) : null}
          </div>
          {stage === "story" ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); goPrev(); }} className="relative z-30 grid h-11 w-11 shrink-0 place-items-center rounded-full border transition active:scale-95" style={OFFER_STORY_GLASS} aria-label={sfText("storefront.common.back")}>
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
                <div className="mx-auto h-14 w-14 animate-pulse rounded-full" style={OFFER_STORY_ICON} />
                <p className="mt-4 text-sm font-semibold" style={{ opacity: 0.72 }}>{sfText("storefront.offers.loading")}</p>
              </div>
            </div>
          ) : loadError && !offerProducts.length ? (
            <div className="flex h-full items-center justify-center">
              <OfferStoryEmptyState
                title={sfText("storefront.offers.loadFailedTitle")}
                text={String(loadError || sfText("storefront.offers.loadFailedText"))}
                actionLabel={sfText("storefront.offers.backHome")}
                onAction={() => navigate("/")}
              />
            </div>
          ) : stage === "size" ? (
            <div className="flex h-full min-h-0 flex-col justify-start pt-0">
              <div className="mx-auto max-w-2xl text-center">
                <h2 className="text-2xl font-bold md:text-4xl">{sfText("storefront.offers.chooseSize")}</h2>
                <p className="mt-1 text-sm font-medium md:text-base" style={{ opacity: 0.62 }}>{sfText("storefront.offers.sizesInOffers")}</p>
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
                <div className="mt-6 border p-5 text-center" style={{ ...OFFER_STORY_GLASS, borderRadius: "var(--m1h-r-lg)" }}>
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full" style={OFFER_STORY_ICON}>
                    <BadgePercent className="h-7 w-7" />
                  </div>
                  <h3 className="mt-4 text-lg font-bold">{sfText("storefront.offers.foundProducts")}</h3>
                  <p className="mt-2 text-sm font-medium leading-6" style={{ opacity: 0.76 }}>
                    {sfText("storefront.offers.noSizesInData")}
                  </p>
                  <p className="mt-2 text-xs font-medium leading-5" style={{ opacity: 0.55 }}>
                    {sfText("storefront.offers.noSizesHint")}
                  </p>
                </div>
              ) : null}
              {!availableSizes.length && !hasOfferProducts ? (
                <div className="mt-8">
                  <OfferStoryEmptyState
                    title={sfText("storefront.offers.noneNowTitle")}
                    text={sfText("storefront.offers.noneNowText")}
                    actionLabel={sfText("storefront.offers.backHome")}
                    onAction={() => navigate("/")}
                  />
                </div>
              ) : null}
            </div>
          ) : stage === "type" ? (
            <div className="flex h-full min-h-0 flex-col justify-start pt-0">
              <div className="mx-auto max-w-2xl text-center">
                <h2 className="text-2xl font-bold md:text-4xl">{sfText("storefront.offers.chooseType")}</h2>
                <p className="mt-1 text-sm font-medium md:text-base" style={{ opacity: 0.62 }}>{sfText("storefront.offers.selectedSize")} {selectedSize}</p>
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
                    title={sfText("storefront.offers.noTypesTitle")}
                    text={sfText("storefront.offers.noTypesText")}
                    actionLabel={sfText("storefront.common.back")}
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
                title={sfText("storefront.offers.noneTitle")}
                text={sfText("storefront.offers.noneText")}
                actionLabel={sfText("storefront.offers.resetFilters")}
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
    <section className="sf-reveal sfx-wrap py-2 md:py-4">
      <div className="mb-3 flex items-end justify-between gap-3 text-start md:mb-4 md:gap-4">
        <div className="min-w-0">
          <h2 className="sfx-h2">{title}</h2>
          {subtitle ? <p className="sfx-subtitle" style={{ marginTop: "var(--m1h-s1)" }}>{subtitle}</p> : null}
        </div>
        <Link to="/products" className="sfx-btn sfx-btn--secondary sfx-btn--sm shrink-0">
          {t("common.viewAll")}
        </Link>
      </div>
      <div className="sf-product-rail sf-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1.5 md:flex-nowrap md:gap-4 md:overflow-hidden md:pb-1">
        {loading ? skeletonItems.map((_, index) => (
          <div key={index} className={`w-[82vw] max-w-[22rem] shrink-0 snap-start sm:w-[43vw] md:w-auto md:max-w-none md:basis-[calc((100%_-_2rem)/3)] xl:basis-[calc((100%_-_4rem)/5)] ${index >= 3 ? "md:hidden xl:block" : ""}`}>
            <div className="sfx-skel h-56 md:h-72" style={{ borderRadius: "var(--m1h-r-lg)" }} />
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
      <div className="sfx-product-grid grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
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
  // The chips show the EU label while inventory keeps the factory marking, so a
  // Crocs size can arrive either way — an AI-inbox link carries C8 / M7/W9, the
  // customer's own click carries 24/25. Both have to reach the same variant.
  const crocsTarget = crocsProduct ? crocsSizeKey(resolveCrocsEuSize(size)) : "";
  return (Array.isArray(product.variants) ? product.variants : []).some((variant) => {
    if (!variantHasStock(variant)) return false;
    const originalSize = String(variant?.size || "").trim().toLowerCase();
    if (!crocsProduct) return originalSize === target;
    return originalSize === target || crocsSizeKey(resolveCrocsEuSize(variant?.size)) === crocsTarget;
  });
};

const compareAvailableSizeOptions = (a, b) => {
  if (isKnownCrocsSize(a.size) || isKnownCrocsSize(b.size)) {
    return compareCrocsSizes(a.size, b.size);
  }
  const numericA = Number(a.size);
  const numericB = Number(b.size);
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
  return String(a.size).localeCompare(String(b.size), "ar", { numeric: true });
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
  return Array.from(sizes.values()).sort(compareAvailableSizeOptions);
};

// Same shape and ordering as buildAvailableSizeOptions, but fed by the API's
// section-wide size counts instead of the cards on the current page — a page-2
// shopper used to get a size list that shared nothing with page 1. Crocs stays
// the one exception: the chips are EU labels while inventory keeps the factory
// marking, so those still fold client-side.
const buildAvailableSizeOptionsFromFacets = (facetSizes = [], { crocs = false } = {}) => {
  const sizes = new Map();
  for (const entry of Array.isArray(facetSizes) ? facetSizes : []) {
    const originalSize = String(entry?.label ?? entry?.value ?? "").trim();
    const size = crocs ? resolveCrocsEuSize(originalSize) : originalSize;
    if (!size) continue;
    const count = Math.max(0, Number(entry?.count) || 0);
    const current = sizes.get(size) || { size, available: false, stock: 0, productCount: 0 };
    // The API only counts a size onto a card when that colour has it in stock,
    // so anything that reaches here is available by construction.
    current.available ||= count > 0;
    current.productCount += count;
    sizes.set(size, current);
  }
  return Array.from(sizes.values()).sort(compareAvailableSizeOptions);
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
              className={`group inline-flex min-h-[44px] min-w-[96px] items-center gap-2 rounded-full border px-3 py-1.5 text-start shadow-[0_10px_24px_rgba(39,20,75,0.045)] transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-[52px] md:min-w-[120px] md:px-4 ${ active ? "border-[#d4af37] bg-[#151515] text-[#d4af37] ring-2 ring-[#d4af37]/15" : "border-stone-200 bg-white text-stone-900 hover:border-[#d4af37]/45 dark:border-white/10 dark:bg-[#101010] dark:text-white" }`}
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
              className={`group inline-flex min-h-[44px] min-w-[112px] items-center gap-2 rounded-full border px-3 py-1.5 text-start transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-[52px] md:min-w-[128px] md:px-4 ${ active ? "border-[#d4af37] bg-[#151515] text-[#d4af37] ring-2 ring-[#d4af37]/15" : "border-stone-200 bg-[#fbfaf7] text-stone-900 hover:border-[#d4af37]/45 dark:border-white/10 dark:bg-white/5 dark:text-white" }`}
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
              className={`group inline-flex min-h-[44px] min-w-[112px] items-center gap-2 rounded-full border px-3 py-1.5 text-start transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-[52px] md:min-w-[128px] md:px-4 ${ active ? "border-[#d4af37] bg-[#f5f3ff] text-[#5b21b6] ring-2 ring-[#d4af37]/15" : "border-stone-200 bg-[#fbfaf7] text-stone-900 hover:border-[#d4af37]/45 dark:border-white/10 dark:bg-white/5 dark:text-white" }`}
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
    if (label.includes("kid") || label.includes("child") || label.includes("أطفال") || label.includes("اطفال")) return Baby;
    if (label.includes("women") || label.includes("woman") || label.includes("حريمي") || label.includes("نسائي")) return Heart;
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
      // The light chip and its shadow were spelled out here as utilities and the
      // dark: counterparts never fire in the storefront, so this one action
      // stayed a white pill on a black header while its neighbours went flat.
      // Appearance now comes from .sf-header-action alone, like the others.
      className={`sf-header-action transition duration-200 ease-out active:scale-[0.98] ${className}`}
      aria-label={label}
      title={label}
    >
      {icon}
      {count ? <span className="sf-action-badge">{count}</span> : null}
    </Link>
  );
}

function Header({ cartCount, wishlistCount = 0, customerAuth = {}, onCart, onAddToCart, effectiveTheme, onThemeToggle = () => {}, brandName = "MONE", brandLogoUrl = "", headerLogoUrl = "", brandSettingsLoading = false, mobileMenuOpen = false, setMobileMenuOpen = () => {}, quickActionLinks = {} }) {
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
  const [suggestionsTotal, setSuggestionsTotal] = useState(null);
  const [voiceState, setVoiceState] = useState("idle");
  const imageSearchRequestRef = useRef(0);
  const voiceSessionRef = useRef(null);
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
      // Sized to sit INSIDE the 52px row rather than push it open — the mark is
      // the tallest thing on the line, so the row height follows it.
      ? "sf-header-wordmark relative inline-flex h-[46px] w-[48px] shrink-0 items-center justify-center overflow-hidden bg-transparent transition"
      : "sf-header-wordmark relative inline-flex h-[72px] w-[82px] shrink-0 items-center justify-center overflow-hidden bg-transparent transition group-hover:scale-[1.02]";
    const imageSize = mobile ? 160 : 240;

    return (
      <span className={frameClassName} aria-busy={logoStatus === "loading"}>
        {logoStatus === "loading" ? (
          <span data-testid="storefront-logo-loading" className="sf-skeleton-shimmer block h-full w-full rounded-full" style={{ background: "var(--m1h-line)" }} aria-hidden="true" />
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
          <span data-testid="storefront-logo-fallback" className="grid h-full w-full place-items-center rounded-full" style={{ background: "var(--m1h-line)" }} aria-label={brandName}>
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
  // The five shipped promises are the fallback, not the content: the moment the
  // owner writes their own in Site Studio those are used instead, verbatim, and
  // an empty list turns the strip off entirely. resolveStripItems returns null
  // for "off" and [] for "nothing written", which is why the two cases are
  // distinguished here rather than with a truthiness check.
  const siteDesign = useSiteDesign();
  const ownAnnouncements = resolveStripItems(siteDesign, currentLanguage);
  const announcementItems = ownAnnouncements === null
    ? []
    : ownAnnouncements.length
      ? ownAnnouncements
      : [
          t("storefront.header.announcements.fastShipping"),
          t("storefront.header.announcements.exchange"),
          t("storefront.header.announcements.cod"),
          t("storefront.header.announcements.premium"),
          t("storefront.header.announcements.todayDeals"),
        ];
  // Mobile shows ONE promise at a time, centred, and swaps it on a timer. The
  // desktop marquee is untouched: on a phone a line sliding past is something
  // the eye has to chase, and the bar is 28px tall — there is room for one
  // sentence read in place, not for a queue moving through it.
  // Both indexes travel together in one state object so the updater stays pure:
  // the line being replaced has to keep rendering until it has finished moving
  // out, and only the swap itself knows which one that is.
  const [announcementSlide, setAnnouncementSlide] = useState({ current: 0, previous: -1 });
  const announcementCount = announcementItems.length;
  useEffect(() => {
    if (announcementCount < 2) return undefined;
    const timer = setInterval(() => {
      setAnnouncementSlide((slide) => ({
        current: (slide.current + 1) % announcementCount,
        previous: slide.current,
      }));
    }, 4200);
    return () => clearInterval(timer);
  }, [announcementCount]);
  // The drawer's audience tabs. They only carry selection today — the lists
  // under them are unchanged until the owner says what belongs in each.
  const menuTabs = [
    { id: "men", label: t("storefront.nav.men"), to: "/men" },
    { id: "women", label: t("storefront.nav.women"), to: "/women" },
    { id: "kids", label: t("storefront.nav.kids"), to: "/kids" },
  ];
  const [menuTab, setMenuTab] = useState(() => {
    const path = String(location?.pathname || "").toLowerCase();
    return menuTabs.find((tab) => path.startsWith(tab.to))?.id || "men";
  });
  // A signed-in customer must not be told to sign in; the phone is the only
  // identity the storefront keeps, so it stands in for a name.
  // The inspiration grid loads only once search is opened.
  // The sheet is opt-in, so a shopper who never taps search never pays for it —
  // which is why this is a lazy fetch rather than the useProducts hook, whose
  // request would fire on every page of the storefront.
  const INSPIRATION_PAGE_SIZE = 9;
  const [searchInspiration, setSearchInspiration] = useState([]);
  const [searchInspirationOffset, setSearchInspirationOffset] = useState(0);
  const [searchInspirationHasMore, setSearchInspirationHasMore] = useState(false);
  const [searchInspirationLoading, setSearchInspirationLoading] = useState(false);
  const [searchInspirationResetting, setSearchInspirationResetting] = useState(false);
  const [searchInspirationTotal, setSearchInspirationTotal] = useState(null);
  const inspirationRequestRef = useRef(0);
  // The shopper's size scopes the whole sheet: the grid, the live results and
  // the results page. Remembered, because a shopper's size does not change
  // between visits.
  const [searchSize, setSearchSizeState] = useState(() => String(readJson(SEARCH_SIZE_KEY, "") || ""));
  const [searchSizeOptions, setSearchSizeOptions] = useState([]);
  const [searchTrending, setSearchTrending] = useState([]);
  const setSearchSize = useCallback((value) => {
    const next = String(value || "").trim();
    setSearchSizeState(next);
    writeJson(SEARCH_SIZE_KEY, next);
  }, []);
  // What a typed or spoken query asks the catalogue for: the name in the catalogue's spelling,
  // plus colour / audience / size filters pulled out of the words. A size said out loud wins
  // over the sheet's size chip.
  const searchRequestParams = useCallback((term) => {
    const parsed = parseSearchQuery(term);
    const params = new URLSearchParams();
    if (parsed.q) params.set("q", parsed.q);
    if (parsed.color) params.set("color", parsed.color);
    if (parsed.gender) params.set("gender", parsed.gender);
    const size = parsed.size || searchSize;
    if (size) {
      params.set("size", size);
      params.set("in_stock", "1");
    }
    // Nothing recognisable at all: search the words as they were typed.
    if (![...params.keys()].length) params.set("q", String(term || "").trim());
    return params;
  }, [searchSize]);

  // "View all" grows the grid in place rather than navigating away, the way the
  // reference does it — leaving search to open a listing page throws away the
  // query the shopper is in the middle of typing.
  // "offset", not "page": this endpoint accepts a page parameter and ignores it
  // — page=2 comes back reporting page 1 with the same first product — while
  // offset genuinely moves the window. "skip" is ignored too. Verified against
  // the live API rather than assumed from the parameter names it accepts.
  const loadInspirationBatch = useCallback((offset, audience, size = "") => {
    // Tapping 42 then 43 quickly must not append 42's page under 43's grid.
    const requestId = inspirationRequestRef.current + 1;
    inspirationRequestRef.current = requestId;
    setSearchInspirationLoading(true);
    setSearchInspirationResetting(offset <= 0);
    return cachedStorefrontGet(
      buildStorefrontProductsRequestUrl({ limit: INSPIRATION_PAGE_SIZE, offset, gender: audience || "", size: size || "", in_stock: 1 }),
      { ttlMs: STOREFRONT_PRODUCTS_CACHE_TTL_MS }
    )
      .then((data) => {
        if (requestId !== inspirationRequestRef.current) return;
        const products = extractStorefrontProductsFromResponse(data);
        setSearchInspiration((current) => (offset <= 0 ? products : [...current, ...products]));
        const reported = data?.hasMore ?? data?.has_more;
        setSearchInspirationHasMore(
          reported === undefined ? products.length >= INSPIRATION_PAGE_SIZE : Boolean(reported)
        );
        setSearchInspirationOffset(offset + products.length);
        const total = Number(data?.total ?? data?.total_count);
        setSearchInspirationTotal(Number.isFinite(total) ? total : null);
      })
      .catch(() => {
        if (requestId !== inspirationRequestRef.current) return;
        // A grid of pictures is decoration around the search field; if it cannot
        // load, the field still works and the section simply does not render.
        if (offset <= 0) setSearchInspiration([]);
        setSearchInspirationHasMore(false);
        setSearchInspirationTotal(null);
      })
      .finally(() => {
        if (requestId !== inspirationRequestRef.current) return;
        setSearchInspirationLoading(false);
        setSearchInspirationResetting(false);
      });
  }, []);

  // Refetches from the top whenever the audience tab or the size changes, so the
  // grid shows what is selected rather than whatever loaded first. Repeat opens
  // are free: cachedStorefrontGet answers the same URL from memory.
  useEffect(() => {
    if (!mobileSearchOpen && !searchOpen) return undefined;
    loadInspirationBatch(0, menuTab, searchSize);
    return undefined;
  }, [mobileSearchOpen, searchOpen, menuTab, searchSize, loadInspirationBatch]);

  // Trending = the audience's best sellers, one entry per model (lib/trendingSearches.js), in the
  // chosen size when there is one. 96 cards, because the top 48 for men are 22 colours of one
  // Jordan and 17 Crocs — five models in all.
  useEffect(() => {
    if (!mobileSearchOpen && !searchOpen) return undefined;
    let cancelled = false;
    cachedStorefrontGet(
      buildStorefrontProductsRequestUrl({ gender: menuTab, size: searchSize || "", in_stock: 1, sort: "best_sellers", limit: 96 }),
      { ttlMs: STOREFRONT_PRODUCTS_CACHE_TTL_MS }
    )
      .then((data) => {
        if (!cancelled) setSearchTrending(buildTrendingSearches(extractStorefrontProductsFromResponse(data)));
      })
      .catch(() => {
        // The written list in the locale files stays as the fallback.
        if (!cancelled) setSearchTrending([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mobileSearchOpen, searchOpen, menuTab, searchSize]);

  // The sizes the selected audience actually has in stock, from the facets
  // endpoint, so the picker never offers a size with nothing behind it.
  // Numeric only: non-numeric values ("مقاس واحد", "18-inch") are reported by
  // the facets but do not round-trip through the size filter (see useOfferSizes).
  useEffect(() => {
    if (!mobileSearchOpen && !searchOpen) return undefined;
    let cancelled = false;
    cachedStorefrontGet(`/storefront/products/facets?gender=${encodeURIComponent(menuTab)}&in_stock=1`, { ttlMs: STOREFRONT_PRODUCTS_CACHE_TTL_MS })
      .then((data) => {
        if (cancelled) return;
        const raw = Array.isArray(data?.facets?.sizes) ? data.facets.sizes : Array.isArray(data?.sizes) ? data.sizes : [];
        const options = raw
          .map((entry) => ({ value: String(entry?.value ?? "").trim(), count: Number(entry?.count || 0) }))
          .filter((entry) => /^\d{1,3}(\.5)?$/.test(entry.value) && entry.count > 0)
          .sort((a, b) => Number(a.value) - Number(b.value));
        setSearchSizeOptions(options);
        // A remembered 43 is meaningless on the kids tab; drop it rather than
        // show an empty grid under a size the tab does not list.
        if (options.length) {
          setSearchSizeState((current) => (current && !options.some((option) => option.value === current) ? "" : current));
        }
      })
      .catch(() => {
        if (!cancelled) setSearchSizeOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mobileSearchOpen, searchOpen, menuTab]);
  const menuIsSignedIn = Boolean(String(customerAuth?.token || "").trim());
  const menuAccountTitle = menuIsSignedIn ? t("storefront.header.accountTitle") : t("storefront.header.signInTitle");
  const menuAccountSubtitle = menuIsSignedIn
    ? String(customerAuth?.phone || "").trim() || t("storefront.header.accountSubtitle")
    : t("storefront.header.signInSubtitle");
  const headerCategoryItems = [
    { label: t("storefront.nav.men"), to: "/men" },
    { label: t("storefront.nav.women"), to: "/women" },
    { label: t("storefront.nav.kids"), to: "/kids" },
    { label: getProductTypeLabel("bags", currentLanguage), to: "/bags" },
    { label: getProductTypeLabel("crocs", currentLanguage), to: "/crocs" },
    { label: getProductTypeLabel("slippers", currentLanguage), to: "/slippers" },
  ];
  // The number comes from the public settings; drop the row rather than ship a
  // wa.me link with no recipient behind it.
  const headerWhatsAppHref = hasWhatsAppRecipient(quickActionLinks.whatsappHref) ? quickActionLinks.whatsappHref : "";
  const utilityItems = [
    ...(headerWhatsAppHref ? [{ label: t("storefront.support.whatsapp", "WhatsApp"), to: headerWhatsAppHref, icon: <MessageCircle className="h-3.5 w-3.5" />, external: true }] : []),
    { label: t("storefront.header.trackOrder"), to: "/track", icon: <PackageSearch className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.wishlist"), to: "/wishlist", icon: <Heart className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.account"), to: "/account", icon: <User className="h-3.5 w-3.5" /> },
  ];
  const themeIsDark = effectiveTheme === "dark";
  const themeToggleLabel = themeIsDark
    ? (isRtl ? "تفعيل الوضع الفاتح" : "Switch to light mode")
    : (isRtl ? "تفعيل الوضع الداكن" : "Switch to dark mode");
  // One header shell for both themes: its palette comes from index.css /
  // site tokens, and the bottom hairline is the site line (inline, below). The
  // light-only `border-black/5` + shadow literals made the two themes differ.
  const headerShellClassName = "sf-luxury-header sf-header-v2 sticky top-0 z-40 bg-transparent shadow-none backdrop-blur-2xl transition-all duration-300";
  // What each audience tab lists. Every row is a real listing: /offers and
  // /products take gender and type from the query, /men pins its own gender.
  const menuAudienceLabel = menuTabs.find((tab) => tab.id === menuTab)?.label || "";
  const menuShopRows = [
    { label: t("storefront.nav.shopAll", { audience: menuAudienceLabel, defaultValue: "Shop all {{audience}}" }), to: `/${menuTab}` },
    { label: t("storefront.nav.sale"), to: `/offers?gender=${menuTab}`, accent: true },
    ...(menuTab === "men" ? [{ label: t("storefront.nav.largeSizes", "Large sizes 47–50"), to: "/men/large-sizes" }] : []),
    { label: getProductTypeLabel("slippers", currentLanguage), to: `/products?gender=${menuTab}&type=slippers` },
    { label: getProductTypeLabel("crocs", currentLanguage), to: `/products?gender=${menuTab}&type=crocs` },
  ];
  const menuMoreRows = [
    { label: getProductTypeLabel("bags", currentLanguage), to: "/bags" },
    { label: t("storefront.header.trackOrder"), to: "/track" },
    { label: t("storefront.header.wishlist"), to: "/wishlist" },
  ];
  const mobileMenuIsRtl = currentLanguage === "ar";
  // Which edge the panel hangs off, and nothing else. The rounded corner, the
  // border and the drop shadow used to live here as utilities — and a utility
  // outranks the panel's own rule, so they survived every attempt to flatten it
  // from CSS. The reference is a plain rectangle; this is where that is decided.
  const mobileMenuSideClass = mobileMenuIsRtl ? "right-0" : "left-0";
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
  const mobileMenuPanelRef = useRef(null);
  const mobileMenuCloseRef = useRef(null);
  useDialogFocus(menuOpen, mobileMenuPanelRef, { onClose: closeMobileMenu, initialFocusRef: mobileMenuCloseRef });
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
    // Closing the photo search must also drop an answer still on its way.
    imageSearchRequestRef.current += 1;
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
      // The search endpoint honours size + in_stock, so a chosen size narrows the
      // live results to models the shopper can actually buy in it. Arabic names,
      // colours, audience and a spoken "مقاس 42" are turned into the catalogue's
      // spelling and filters first (lib/searchAliases.js).
      const request = searchRequestParams(normalizedSearch);
      request.set("limit", "8");
      // Only filters and no name ("كوتشي اسود رجالي"): the listing endpoint answers those.
      if (!request.has("q")) {
        request.set("sort", "newest");
        request.set("_last_piece_scope", "product");
      }
      const endpoint = request.has("q") ? "/storefront/products/search" : "/storefront/products";
      api.get(`${endpoint}?${request.toString()}`, { signal: controller.signal })
        .then((data) => {
          if (cancelled) return;
          setSuggestions(data.products || []);
          const total = Number(data?.total ?? data?.total_count);
          setSuggestionsTotal(Number.isFinite(total) ? total : null);
        })
        .catch((error) => {
          if (!cancelled && error?.cause?.name !== "AbortError") {
            setSuggestions([]);
            setSuggestionsTotal(null);
          }
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
  }, [deferredSearch, searchRequestParams, visualSearch.active]);

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
    voiceSessionRef.current?.stop();
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
    navigate(searchResultsUrl(term));
  };

  // The results page reads ?size= too, so the size chosen in the sheet carries
  // through instead of silently widening back to every size.
  const searchResultsUrl = (term) => {
    const params = searchRequestParams(term);
    params.delete("in_stock");
    return `/products?${params.toString()}`;
  };

  const pickSearchTerm = (term) => {
    const value = String(term || "").trim();
    if (!value) return;
    setSearch(value);
    rememberSearch(value);
    closeSearch();
    navigate(searchResultsUrl(value));
  };

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    writeJson(SEARCH_RECENT_KEY, []);
  }, []);

  const pickProduct = (product, options = {}) => {
    if (!product?.id) return;
    rememberSearch(product.name || search);
    closeSearch();
    if (!options.keepQuery) setSearch("");
    // With a size chosen, the product page opens on that size in the card's
    // colour. The card's variant id would pin whatever size it happened to be,
    // and ?variant= outranks ?size=, so it is dropped.
    const url = searchSize && Array.isArray(product.sizes) && product.sizes.map(String).includes(searchSize)
      ? appendProductUrlParams(productUrl(product), [["variant", ""], ["size", searchSize]])
      : productUrl(product);
    navigate(url);
  };

  // A second tap stops listening early and still keeps what was said. See lib/voiceSearch.js for
  // why iPhone records a clip instead of using the browser's recogniser.
  const handleVoiceSearch = () => {
    if (voiceSessionRef.current) {
      voiceSessionRef.current.stop();
      return;
    }
    setSearchOpen(true);
    setMobileSearchOpen(window.innerWidth < 768);
    if (visualSearch.active) clearVisualSearch();
    voiceSessionRef.current = startVoiceSearch({
      language: storefrontI18n.language || "ar",
      onState: (state) => setVoiceState(state),
      onTranscript: (text) => {
        setSearch(text);
        setActiveSearchIndex(-1);
      },
      onError: (key) => toast.error(sfText(key)),
      onEnd: () => {
        voiceSessionRef.current = null;
        setVoiceState("idle");
      },
      transcribeClip: async (blob, type, language) => {
        const formData = new FormData();
        formData.append("audio", blob, type.includes("mp4") ? "voice.m4a" : "voice.webm");
        formData.append("language", String(language || "").startsWith("en") ? "en" : "ar");
        const data = await api.post("/storefront/voice-search", formData, { timeoutMs: 25000 });
        return data?.text || "";
      },
    });
  };

  const handleImageSearch = async (event) => {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (picked) {
      voiceSessionRef.current?.stop();
      let file;
      try {
        // Downscaled to a JPEG first: an iPhone HEIC used to be refused, a full-size photo took
        // seconds to upload. See lib/searchImage.js.
        file = await prepareSearchImage(picked);
      } catch {
        toast.error(sfText("storefront.toasts.unsupportedImageType"));
        return;
      }
      selectedVisualImageRef.current = file;
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
      // A second photo picked while the first is still searching wins; the first answer is dropped.
      imageSearchRequestRef.current += 1;
      const requestId = imageSearchRequestRef.current;
      try {
        const data = await api.post(endpoint, formData, { timeoutMs: 45000, headers: { "x-tenant-id": tenantId } });
        if (requestId !== imageSearchRequestRef.current) return;
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
          vision: data.vision || null,
          error: "",
          previewUrl,
          fileName: file.name,
          fileType: file.type,
        });
        setImageSearchOpen(true);
      } catch (error) {
        if (requestId !== imageSearchRequestRef.current) return;
        // A copy key, not the server's Arabic text: the results panel reads it in the shopper's language.
        const message = visualSearchErrorKey(error);
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
  };

  const shareVisualSearchImage = useCallback(async () => {
    const file = selectedVisualImageRef.current;
    const text = sfText("storefront.visualSearch.shareText");
    if (file && typeof navigator !== "undefined" && navigator.share) {
      try {
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text, title: sfText("storefront.visualSearch.shareTitle") });
          return;
        }
      } catch {
        // Fall through to WhatsApp text link.
      }
    }
    window.open(buildWhatsAppHref(text), "_blank", "noopener,noreferrer");
  }, []);

  const requestVisualSearchSupply = useCallback(() => {
    window.open(buildWhatsAppHref(sfText("storefront.visualSearch.requestRestockMessage")), "_blank", "noopener,noreferrer");
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
      style={{ borderBottom: "1px solid var(--m1h-line)" }}
    >
      <div className={`${isCheckoutMobile ? "hidden md:block" : ""} sf-announcement-row sf-header-announcement relative overflow-hidden text-white/90 backdrop-blur transition-all duration-300`}>
        {/* The two corner controls of the site live on the announcement strip,
            where the owner asked for them: the language switch (globe, current
            code, chevron) in the top-RIGHT corner and the theme toggle in the
            top-LEFT one. Both are pinned to physical sides in BOTH languages --
            "right" and "the other side" were the instructions, not "end" and
            "start". They sit outside the two ticker containers so their overflow
            clipping never touches them, and above them so the marquee slides
            underneath. */}
        <button
          type="button"
          onClick={onThemeToggle}
          className="sf-announcement-corner sf-announcement-theme"
          aria-label={themeToggleLabel}
          title={themeToggleLabel}
        >
          {themeIsDark ? <Sun strokeWidth={1.5} aria-hidden="true" /> : <Moon strokeWidth={1.5} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={switchLanguage}
          className="sf-announcement-corner sf-announcement-lang"
          aria-label={languageLabel}
          title={languageLabel}
          dir="ltr"
        >
          <Globe strokeWidth={1.5} aria-hidden="true" />
          <span>{currentLanguage.toUpperCase()}</span>
          <ChevronDown strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div className="sf-announcement-solo relative mx-auto h-7 w-full max-w-7xl overflow-hidden md:hidden">
          {announcementItems.map((announcement, index) => (
            // Deliberately a div, not a span: `.sf-header-announcement span` is
            // an !important rule inside @layer components, and an unlayered
            // !important cannot outrank a layered one — so as a span this line
            // could never set its own colour. See [[css-important-layer-inversion]].
            <div
              // Index key on purpose: this is a fixed list of promises, not data —
              // it never reorders, and two promises can legitimately read the same.
              key={index}
              dir="auto"
              aria-hidden={index !== announcementSlide.current}
              className={[
                "sf-announcement-solo-line",
                index === announcementSlide.current ? "is-active" : "",
                index === announcementSlide.previous ? "is-leaving" : "",
              ].filter(Boolean).join(" ")}
            >
              {announcement}
            </div>
          ))}
        </div>
        <div className="relative mx-auto hidden h-8 w-full max-w-7xl overflow-hidden md:block md:h-10">
          <div className="sf-announcement-track sf-announcement-track-ltr absolute inset-y-0 left-0 items-center">
            {[0, 1].map((copyIndex) => (
              <span key={copyIndex} className="inline-flex shrink-0 items-center gap-10 pe-10">
                {/* No icon per item: five sparkles chasing each other across the
                    ticker is decoration competing with the words it decorates. A
                    dot separates them and stays out of the way. */}
                {announcementItems.map((announcement, itemIndex) => (
                  <span key={`${copyIndex}-${itemIndex}`} dir="auto" className="inline-flex shrink-0 items-center gap-10 text-[11px] font-medium tracking-normal md:text-[12px]">
                    {announcement}
                    <span className="sf-header-announcement-dot" aria-hidden="true" />
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </div>
      {/* dir follows the language rather than being pinned to rtl: with the menu
          hard-coded to the right, an English reader met the hamburger on the
          wrong edge on every page. Search takes the slot the theme toggle used
          to hold -- the toggle is still in the menu drawer, one tap away, and
          search was the control buried there instead. */}
      <div className="sf-mobile-header-shell md:hidden" dir={mobileMenuIsRtl ? "rtl" : "ltr"}>
        {/* Five slots on one 52px line: menu and search hold the start edge,
            wishlist and bag the end edge, and the logo sits dead centre between
            them. No chips, no pills — the icon is the button, so nothing
            competes with the logo. */}
        <div className="px-2 pt-[env(safe-area-inset-top)]">
          <div className="sf-topbar-row grid h-[52px] grid-cols-[auto_minmax(0,1fr)_auto] items-center">
            <div className="flex items-center">
              <button
                className="sf-topbar-button"
                onClick={() => setMobileMenuOpen((value) => !value)}
                aria-label={t("storefront.header.menu")}
                aria-expanded={menuOpen}
                type="button"
              >
                {menuOpen ? <X strokeWidth={1.25} /> : <Menu strokeWidth={1.25} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  // Search has its own full-screen surface now. It used to live
                  // inside the menu drawer, so this had to open the menu first —
                  // which put a search field and its suggestion cards in the
                  // middle of what is meant to be a plain list.
                  setSearchOpen(true);
                  setMobileSearchOpen(true);
                }}
                className="sf-topbar-button"
                aria-label={t("storefront.header.search")}
              >
                <Search strokeWidth={1.25} />
              </button>
            </div>
            <Link to="/" className="sf-header-logo mx-auto inline-flex min-w-0 items-center justify-center" aria-label={brandName || "MONE"}>
              {renderHeaderLogo({ mobile: true })}
            </Link>
            <div className="flex items-center">
              <Link to="/wishlist" className="sf-topbar-button" aria-label={t("storefront.header.wishlist")}>
                <Heart strokeWidth={1.25} />
                {wishlistCount ? <span className="sf-action-badge">{wishlistCount}</span> : null}
              </Link>
              <button onClick={onCart} className="sf-topbar-button sf-cart-action" aria-label={t("storefront.cart.title")} type="button">
                <ShoppingBag strokeWidth={1.25} />
                {cartCount ? <span key={cartCount} className="sf-action-badge sf-cart-count-pop">{cartCount}</span> : null}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="sf-utility-row hidden border-b px-4 text-xs font-semibold transition-all duration-300 sm:block">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            {utilityItems.map((item) => {
              const className = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:opacity-80";
              return item.external ? (
                <a key={item.label} href={item.to} target="_blank" rel="noopener noreferrer" className={className}>
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
            {/* Language used to sit here too; it moved to the announcement strip
                above, so this row keeps only the currency. */}
            <button type="button" className="rounded-full px-2.5 py-1 transition hover:opacity-80">{getCurrency().code}</button>
          </div>
        </div>
      </div>
      <div className="sf-main-row sf-header-main sf-header-main-v2 relative mx-auto hidden max-w-7xl px-4 py-3 md:block">
        {/* Same fix as the mobile row: the desktop header was pinned to rtl, so an
            English reader found the logo on the right and the cart on the left. */}
        <div className="flex w-full items-center gap-3 md:gap-6" dir={mobileMenuIsRtl ? "rtl" : "ltr"}>
          <div className="flex shrink-0 items-center gap-2 md:gap-4">
            <button
              className="sf-header-action sf-header-menu-button grid h-12 w-12 shrink-0 place-items-center rounded-full transition duration-200 ease-out active:scale-[0.98]"
              onClick={() => setMobileMenuOpen((value) => !value)}
              aria-label={t("storefront.header.menu")}
              aria-expanded={menuOpen}
              type="button"
            >
              {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <span className="sf-header-divider hidden h-12 w-px md:block" />
            <Link to="/" className="sf-header-logo group inline-flex shrink-0 items-center transition" aria-label={brandName || "MONE"}>
              {renderHeaderLogo()}
            </Link>
          </div>
          <nav className="sf-collapsible-nav hidden min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden text-sm font-semibold lg:flex">
            {headerCategoryItems.map(({ label, to }) => (
              <NavLink
                key={`${label}-${to}`}
                to={to}
                className={({ isActive }) => `sf-nav-link sf-header-nav-link relative overflow-hidden rounded-full px-3.5 py-2.5 transition duration-200 ease-out after:absolute after:inset-x-4 after:bottom-1 after:h-px after:origin-center after:bg-current after:transition-transform after:duration-200 ${isActive ? "active after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100"}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            <button
              type="button"
              onClick={onThemeToggle}
              className="sf-header-action hidden md:grid transition duration-200 ease-out hover:-translate-y-px active:scale-[0.98]"
              aria-label={themeToggleLabel}
              title={themeToggleLabel}
            >
              {themeIsDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="sf-header-action hidden md:grid transition duration-200 ease-out hover:-translate-y-px active:scale-[0.98]"
              aria-label={t("storefront.header.search")}
              title={t("storefront.header.search")}
            >
              <Search className="h-5 w-5" />
            </button>
            <HeaderAction to="/account" label={t("storefront.header.account")} icon={<User className="h-5 w-5" />} className="sf-secondary-action hidden md:grid" />
            <button onClick={onCart} className="sf-header-action sf-cart-action transition duration-200 ease-out hover:-translate-y-px active:scale-[0.98]" aria-label={t("storefront.cart.title")} type="button">
              <ShoppingCart className="h-5 w-5" />
              {cartCount ? <span key={cartCount} className="sf-action-badge sf-cart-count-pop">{cartCount}</span> : null}
            </button>
          </div>
        </div>
        {searchOpen ? (
          <div className="absolute left-4 right-4 top-full z-50 hidden md:block">
            {/* Same empty state as the phone sheet — one search system, not two. */}
            <PremiumSearch
              inspiration={searchInspiration}
              inspirationHasMore={searchInspirationHasMore}
              inspirationLoading={searchInspirationLoading}
              onLoadMoreInspiration={() => loadInspirationBatch(searchInspirationOffset, menuTab, searchSize)}
              audienceTabs={menuTabs}
              audienceTab={menuTab}
              onPickAudience={setMenuTab}
              sizeOptions={searchSizeOptions}
              selectedSize={searchSize}
              onPickSize={setSearchSize}
              inspirationTotal={searchInspirationTotal}
              inspirationResetting={searchInspirationResetting}
              suggestionsTotal={suggestionsTotal}
              onClearRecentSearches={clearRecentSearches}
              trendingModels={searchTrending}
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
              voiceState={voiceState}
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
      {/* Mobile search is its own full-screen sheet, opened straight from the
          header icon. It used to be a field inside the menu drawer, which is
          why the menu carried a search box and its suggestion cards.
          Portalled to <body> for the same reason the drawer is: the header
          carries `backdrop-blur`, and a backdrop-filter makes its box the
          containing block for any `position: fixed` descendant — so the sheet
          covered the header strip only and left the page showing through. */}
      {mobileSearchOpen && mobilePortalTarget ? createPortal(
        <PremiumSearch
        mobileOnly
        inspiration={searchInspiration}
              inspirationHasMore={searchInspirationHasMore}
              inspirationLoading={searchInspirationLoading}
              onLoadMoreInspiration={() => loadInspirationBatch(searchInspirationOffset, menuTab, searchSize)}
        audienceTabs={menuTabs}
        audienceTab={menuTab}
        onPickAudience={setMenuTab}
              sizeOptions={searchSizeOptions}
              selectedSize={searchSize}
              onPickSize={setSearchSize}
              inspirationTotal={searchInspirationTotal}
              inspirationResetting={searchInspirationResetting}
              suggestionsTotal={suggestionsTotal}
              onClearRecentSearches={clearRecentSearches}
              trendingModels={searchTrending}
        mobileOpen={mobileSearchOpen}
        setMobileOpen={setMobileSearchOpen}
        value={search}
        onChange={handleSearchChange}
        onSubmit={submit}
        onOpen={() => {
          setSearchOpen(true);
          setMobileSearchOpen(true);
        }}
        onClose={closeSearch}
        open={searchOpen}
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
              voiceState={voiceState}
        onImage={handleImageSearch}
        imageSearchOpen={imageSearchOpen}
        imageSearch={visualSearch}
        onShareImageOnWhatsApp={shareVisualSearchImage}
        onRequestVisualSearchSupply={requestVisualSearchSupply}
        onClearImageSearch={clearVisualSearch}
        />,
        mobilePortalTarget
      ) : null}
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
            className="sfx-overlay absolute inset-0"
            aria-label={t("storefront.common.close")}
            onClick={closeMobileMenu}
          />
          {/* BOTH classes on purpose. `sf-mobile-menu-drawer` is what the light
              theme uses to strip the hard-coded dark gradients off everything
              inside the drawer — drop it and the lists below turn into black
              blocks on a white panel. `sf-menu-panel` only restyles the panel's
              own chrome. */}
          <aside ref={mobileMenuPanelRef} data-theme={effectiveTheme} className={`sf-mobile-menu-drawer sf-menu-panel fixed inset-y-0 z-[161] flex h-full w-[min(26rem,88vw)] flex-col overflow-hidden ${mobileMenuSideClass}`}>
            {/* Language and theme sit ABOVE the account row, where the owner
                asked for them. Close keeps the far side to itself. */}
            <div className="sf-menu-toolbar">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={switchLanguage}
                  className="sf-menu-chip sf-menu-chip--icon"
                  aria-label={languageLabel}
                  title={languageLabel}
                >
                  <Languages strokeWidth={1.25} />
                </button>
                <button
                  type="button"
                  onClick={onThemeToggle}
                  className="sf-menu-chip sf-menu-chip--icon"
                  aria-label={themeToggleLabel}
                  title={themeToggleLabel}
                >
                  {themeIsDark ? <Sun strokeWidth={1.25} /> : <Moon strokeWidth={1.25} />}
                </button>
              </div>
              <button
                ref={mobileMenuCloseRef}
                type="button"
                onClick={closeMobileMenu}
                className="sf-menu-chip sf-menu-chip--icon"
                aria-label={t("storefront.common.close")}
              >
                <X strokeWidth={1.25} />
              </button>
            </div>
            <Link to="/account" onClick={closeMobileMenu} className="sf-menu-account">
              <User className="sf-menu-account-icon" strokeWidth={1.25} />
              <span className="sf-menu-account-copy">
                <span className="sf-menu-account-title">{menuAccountTitle}</span>
                <span className="sf-menu-account-sub">{menuAccountSubtitle}</span>
              </span>
              {mobileMenuIsRtl ? (
                <ChevronLeft className="sf-menu-chevron" strokeWidth={1.25} />
              ) : (
                <ChevronRight className="sf-menu-chevron" strokeWidth={1.25} />
              )}
            </Link>
            {/* Selection only for now: the lists below are unchanged until the
                owner says what each audience should show. */}
            <div className="sf-menu-tabs" role="tablist" aria-label={t("storefront.header.menu")}>
              {menuTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={menuTab === tab.id}
                  onClick={() => setMenuTab(tab.id)}
                  className={`sf-menu-tab${menuTab === tab.id ? " is-active" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* The shop rows scroll; the help links are pinned under them at the
                very bottom of the panel, the way the big fashion sites do it. */}
            <nav className="sf-menu-body" aria-label={menuTabs.find((tab) => tab.id === menuTab)?.label}>
              <ul className="sf-menu-list">
                {menuShopRows.map(({ label, to, accent = false }) => (
                  <li key={to}>
                    <Link to={to} onClick={closeMobileMenu} className={`sf-menu-row${accent ? " is-accent" : ""}`}>
                      <span>{label}</span>
                      {mobileMenuIsRtl ? (
                        <ChevronLeft className="sf-menu-chevron" strokeWidth={1.25} />
                      ) : (
                        <ChevronRight className="sf-menu-chevron" strokeWidth={1.25} />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="sf-menu-heading">{t("storefront.nav.moreCategories", "More")}</p>
              <ul className="sf-menu-list">
                {menuMoreRows.map(({ label, to }) => (
                  <li key={to}>
                    <Link to={to} onClick={closeMobileMenu} className="sf-menu-row sf-menu-row--compact">
                      <span>{label}</span>
                      {mobileMenuIsRtl ? (
                        <ChevronLeft className="sf-menu-chevron" strokeWidth={1.25} />
                      ) : (
                        <ChevronRight className="sf-menu-chevron" strokeWidth={1.25} />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="sf-menu-footer">
              {[
                { label: t("storefront.nav.sizeGuide"), to: "/size-guide", icon: Ruler },
                { label: t("storefront.nav.returns"), to: "/returns", icon: RefreshCcw },
                { label: t("storefront.nav.contact"), to: "/contact", icon: Headphones },
              ].map(({ label, to, icon: Icon }) => (
                <Link key={to} to={to} onClick={closeMobileMenu} className="sf-menu-help">
                  <Icon strokeWidth={1.25} />
                  <span>{label}</span>
                </Link>
              ))}
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
  voiceState = "idle",
  onImage,
  imageSearch = null,
  onShareImageOnWhatsApp = () => {},
  onRequestVisualSearchSupply = () => {},
  onClearImageSearch = () => {},
  className = "",
  mobileOnly = false,
  inspiration = [],
  inspirationHasMore = false,
  inspirationLoading = false,
  onLoadMoreInspiration = () => {},
  audienceTabs = [],
  audienceTab = "",
  onPickAudience = () => {},
  sizeOptions = [],
  selectedSize = "",
  onPickSize = () => {},
  inspirationTotal = null,
  inspirationResetting = false,
  suggestionsTotal = null,
  onClearRecentSearches = () => {},
  trendingModels = [],
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

  const clearQuery = () => {
    onChange("");
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  // One flex row in reading order — search glyph, size scope, the text, clear,
  // then the voice and photo tools — so it mirrors itself in Arabic instead of
  // pinning icons to physical left/right the way the absolute layout did.
  const searchInput = (
    <form onSubmit={onSubmit} className="sf-search-form" role="search">
      <div className="sf-search-field">
        <Search className="sf-search-field-icon" aria-hidden="true" strokeWidth={1.75} />
        {selectedSize ? (
          <button
            type="button"
            className="sf-search-scope"
            onClick={() => onPickSize("")}
            aria-label={t("storefront.search.sizeRemove", { size: selectedSize })}
          >
            <span>{t("storefront.search.sizeChip", { size: selectedSize })}</span>
            <X aria-hidden="true" strokeWidth={2} />
          </button>
        ) : null}
        <input
          ref={inputRef}
          value={value}
          onFocus={onOpen}
          onChange={(event) => {
            onChange(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            voiceState === "listening"
              ? t("storefront.voiceSearch.listening")
              : voiceState === "transcribing"
                ? t("storefront.voiceSearch.transcribing")
                : placeholder
          }
          className="sf-search-input"
          aria-label={t("storefront.search.aria")}
          role="combobox"
          aria-expanded={Boolean(open || mobileOpen)}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {value ? (
          <button type="button" onClick={clearQuery} className="sf-search-clear" aria-label={t("storefront.search.clear")}>
            <X aria-hidden="true" strokeWidth={2.25} />
          </button>
        ) : null}
        <span className="sf-search-field-divider" aria-hidden="true" />
        <button
          type="button"
          onClick={onVoice}
          className={`sf-search-tool-button sf-search-voice${voiceState !== "idle" ? ` is-${voiceState}` : ""}`}
          aria-label={voiceState === "listening" ? t("storefront.voiceSearch.stop") : t("storefront.search.voice")}
          aria-pressed={voiceState === "listening"}
          title={t("storefront.search.voice")}
        >
          {voiceState === "transcribing" ? <Loader2 aria-hidden="true" strokeWidth={1.75} className="animate-spin" /> : <Mic aria-hidden="true" strokeWidth={1.75} />}
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()} className="sf-search-tool-button" aria-label={t("storefront.search.image")} title={t("storefront.search.image")}>
          <Camera aria-hidden="true" strokeWidth={1.75} />
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onImage} />
      </div>
    </form>
  );

  const resultsPanel = (
    <div className="sf-mobile-search-panel sfx-surface sfx-surface--float p-3">
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
        inspiration={inspiration}
        inspirationHasMore={inspirationHasMore}
        inspirationLoading={inspirationLoading}
        onLoadMoreInspiration={onLoadMoreInspiration}
        audienceTabs={audienceTabs}
        audienceTab={audienceTab}
        onPickAudience={onPickAudience}
        sizeOptions={sizeOptions}
        selectedSize={selectedSize}
        onPickSize={onPickSize}
        inspirationTotal={inspirationTotal}
        inspirationResetting={inspirationResetting}
        suggestionsTotal={suggestionsTotal}
        onClearRecentSearches={onClearRecentSearches}
        trendingModels={trendingModels}
        onImage={() => fileInputRef.current?.click()}
        onShareImageOnWhatsApp={onShareImageOnWhatsApp}
        onRequestVisualSearchSupply={onRequestVisualSearchSupply}
        onClearImageSearch={onClearImageSearch}
      />
    </div>
  );

  if (mobileOnly) {
    if (!mobileOpen) return null;
    return (
      <div className="sf-mobile-search-sheet fixed inset-0 z-[100] p-4 pt-[calc(1rem+env(safe-area-inset-top))] md:hidden" style={{ background: "var(--m1h-bg)", color: "var(--m1h-text)" }}>
        <div className="mx-auto flex h-full max-w-xl flex-col">
          <div className="sf-search-sheet-bar sticky top-0 z-10 flex items-center gap-3">
            <div className="min-w-0 flex-1">{searchInput}</div>
            {/* Named by its visible word; an aria-label here would make voice
                control users say a name they cannot see. */}
            <button type="button" onClick={onClose} className="sf-search-cancel">
              {t("storefront.search.cancel")}
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
      {open ? <button type="button" onClick={onClose} className="fixed inset-0 z-40 hidden md:block" style={{ background: "var(--sfx-scrim)" }} aria-label={sfText("storefront.search.close")} /> : null}
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
  activeIndex,
  onPickTerm,
  onPickProduct,
  trendingSearches = [],
  inspiration = [],
  inspirationHasMore = false,
  inspirationLoading = false,
  onLoadMoreInspiration = () => {},
  audienceTabs = [],
  audienceTab = "",
  onPickAudience = () => {},
  recentSearches = [],
  sizeOptions = [],
  selectedSize = "",
  onPickSize = () => {},
  inspirationTotal = null,
  inspirationResetting = false,
  suggestionsTotal = null,
  onClearRecentSearches = () => {},
  trendingModels = [],
  onImage = () => {},
  onShareImageOnWhatsApp = () => {},
  onRequestVisualSearchSupply = () => {},
  onClearImageSearch = () => {},
}) {
  const { t } = useTranslation();
  const query = value.trim();
  const sizeRowRef = useRef(null);
  // A remembered 44 sits off-screen in a row that starts at 32; bring the chosen
  // chip into view. scrollBy on the row itself, never scrollIntoView, which also
  // scrolls the sheet and the page. The rect delta works in RTL and LTR alike.
  useEffect(() => {
    const row = sizeRowRef.current;
    const chip = row?.querySelector(".sf-search-size.is-active");
    if (!row || !chip || typeof row.scrollBy !== "function") return;
    const rowRect = row.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    if (chipRect.left >= rowRect.left && chipRect.right <= rowRect.right) return;
    row.scrollBy({ left: chipRect.left + chipRect.width / 2 - (rowRect.left + rowRect.width / 2), behavior: "smooth" });
  }, [selectedSize, sizeOptions]);
  const exactMatches = Array.isArray(imageSearch?.exactMatches) ? imageSearch.exactMatches : [];
  const similarMatches = Array.isArray(imageSearch?.similarMatches) ? imageSearch.similarMatches : [];
  const hasImageSearch = Boolean(imageSearch?.active || imageSearch?.loading || imageSearch?.error || exactMatches.length || similarMatches.length);
  const imageResults = exactMatches.length ? exactMatches : similarMatches;
  const imageLoading = Boolean(imageSearch?.loading);
  const imageTitle = imageLoading
    ? t("storefront.visualSearch.searchingClosest")
    : exactMatches.length
      ? t("storefront.visualSearch.foundExact")
      : similarMatches.length
        ? t("storefront.visualSearch.notAvailableClosest")
        : imageSearch?.error
          ? t("storefront.visualSearch.unavailable")
          : t("storefront.visualSearch.modelUnavailable");
  // What the photo was read as ("Skechers · running shoe · grey"), so a near miss explains itself.
  const vision = imageSearch?.vision || null;
  const visionRead = vision?.status === "ok"
    ? [vision.brand, vision.model || vision.product_type, Array.isArray(vision.colors) ? vision.colors[0] : ""].filter(Boolean).join(" · ")
    : "";
  return (
    <div className="sf-search-sections grid gap-3">
      {hasImageSearch ? (
        <div className="sf-visual" aria-busy={imageLoading}>
          <div className="sf-visual-head">
            <div className={`sf-visual-photo${imageLoading ? " is-scanning" : ""}`}>
              {imageSearch?.previewUrl ? <img src={imageSearch.previewUrl} alt="" /> : null}
              {imageLoading ? <span className="sf-visual-scanline" aria-hidden="true" /> : null}
            </div>
            <div className="sf-visual-copy">
              <span className="sf-visual-kicker">{t("storefront.visualSearch.title")}</span>
              <span className="sf-visual-title">{imageTitle}</span>
              {imageLoading ? (
                <span className="sf-visual-sub">{t("storefront.visualSearch.analyzingShort")}</span>
              ) : visionRead ? (
                <span className="sf-visual-sub" dir="auto">{t("storefront.visualSearch.lookedLike", { what: visionRead })}</span>
              ) : null}
            </div>
            <button type="button" onClick={onClearImageSearch} className="sf-visual-close" aria-label={t("storefront.visualSearch.backToText")}>
              <X aria-hidden="true" strokeWidth={2} />
            </button>
          </div>

          {imageLoading ? (
            <div className="sf-visual-grid" aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => <span key={index} className="sf-visual-tile sf-visual-tile--skeleton" />)}
            </div>
          ) : null}

          {!imageLoading && exactMatches.length ? (
            <div className="sf-visual-group">
              <span className="sf-visual-group-title">{t("storefront.visualSearch.exactColours")}</span>
              <div className="sf-visual-grid">
                {exactMatches.slice(0, 12).map((product, index) => (
                  <VisualResultTile key={`exact-${product.card_id || product.id}-${index}`} product={product} onPickProduct={onPickProduct} />
                ))}
              </div>
            </div>
          ) : null}

          {!imageLoading && similarMatches.length ? (
            <div className="sf-visual-group">
              {exactMatches.length ? <span className="sf-visual-group-title">{t("storefront.visualSearch.similarProducts")}</span> : null}
              <div className="sf-visual-grid">
                {similarMatches.slice(0, 12).map((product, index) => (
                  <VisualResultTile key={`similar-${product.card_id || product.id}-${index}`} product={product} onPickProduct={onPickProduct} />
                ))}
              </div>
            </div>
          ) : null}

          {!imageLoading && !imageResults.length ? (
            <div className="sf-search-empty-note">
              <p>{imageSearch?.error ? t(visualSearchSubtitleKey(imageSearch)) : t("storefront.visualSearch.emptyHint")}</p>
              <p className="sf-visual-tip">{t("storefront.visualSearch.photoTip")}</p>
              <div className="sf-visual-actions">
                <button type="button" onClick={onShareImageOnWhatsApp} className="sfx-btn sfx-btn--whatsapp sfx-btn--sm">
                  {t("storefront.visualSearch.sendOnWhatsapp")}
                </button>
                <button type="button" onClick={onRequestVisualSearchSupply} className="sf-search-outline-btn">
                  {t("storefront.visualSearch.requestModel")}
                </button>
              </div>
            </div>
          ) : null}

          {!imageLoading ? (
            <button type="button" onClick={onImage} className="sf-search-submit-row">
              <Camera aria-hidden="true" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{t("storefront.visualSearch.tryAnother")}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {query ? (
        <div className="sf-search-results">
          <div className="sf-search-heading-row">
            <span className="sf-search-heading">
              {t("storefront.search.resultsTitle")}
              {!loading && suggestionsTotal ? <span className="sf-search-count">{t("storefront.search.modelCount", { total: suggestionsTotal })}</span> : null}
            </span>
            {loading ? <Loader2 className="sf-search-spinner" aria-label={t("storefront.search.searching")} /> : null}
          </div>
          {suggestions.length ? (
            <div className="sf-search-result-list">
              {suggestions.map((product, index) => (
                <SearchResultRow
                  key={product.card_id || `${product.id}-${index}`}
                  product={product}
                  query={query}
                  active={activeIndex === index}
                  onPickProduct={onPickProduct}
                />
              ))}
            </div>
          ) : loading ? (
            <div className="sf-search-result-list" aria-hidden="true">
              {[0, 1, 2].map((item) => <div key={item} className="sf-search-result-skeleton" />)}
            </div>
          ) : query.length < 2 ? null : (
            <div className="sf-search-empty-note">
              <p>{t("storefront.search.noResults", { query })}</p>
              {selectedSize ? (
                <button type="button" onClick={() => onPickSize("")} className="sf-search-outline-btn">
                  {t("storefront.search.searchAllSizes")}
                </button>
              ) : null}
            </div>
          )}
          <button type="button" onClick={() => onPickTerm(query)} className="sf-search-submit-row">
            <Search aria-hidden="true" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">
              {suggestions.length ? t("storefront.search.viewAllResults") : `${t("storefront.search.searchFor")} "${query}"`}
            </span>
            <ChevronRight className="sf-search-submit-chevron" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}

      {/* The empty state follows the reference: what people are searching for,
          as one scrollable row of pills, then a grid of things to look at. The
          three stacked cards of categories / brands / styles that used to live
          here asked the shopper to read a menu before they had typed anything. */}
      {!query && !hasImageSearch ? (
        <div className="sf-search-empty grid gap-6">
          {audienceTabs.length ? (
            <div className="sf-search-tabs" role="tablist">
              {audienceTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={audienceTab === tab.id}
                  onClick={() => onPickAudience(tab.id)}
                  className={`sf-search-tab${audienceTab === tab.id ? " is-active" : ""}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* The size row scopes the grid below: pick 42 and every photo is a
              model that is in stock in 42. */}
          {sizeOptions.length ? (
            <div className="sf-search-section">
              <div className="sf-search-heading-row">
                <span className="sf-search-heading">{t("storefront.search.sizeTitle")}</span>
                {selectedSize ? (
                  <button type="button" onClick={() => onPickSize("")} className="sf-search-viewall">
                    {t("storefront.search.sizeReset")}
                  </button>
                ) : null}
              </div>
              <div ref={sizeRowRef} className="sf-search-size-row" role="radiogroup" aria-label={t("storefront.search.sizeTitle")}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!selectedSize}
                  onClick={() => onPickSize("")}
                  className={`sf-search-size sf-search-size--all${!selectedSize ? " is-active" : ""}`}
                >
                  {t("storefront.search.sizeAll")}
                </button>
                {sizeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selectedSize === option.value}
                    onClick={() => onPickSize(selectedSize === option.value ? "" : option.value)}
                    className={`sf-search-size${selectedSize === option.value ? " is-active" : ""}`}
                  >
                    {option.value}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {recentSearches.length ? (
            <div className="sf-search-section">
              <div className="sf-search-heading-row">
                <span className="sf-search-heading">{t("storefront.search.recentTitle")}</span>
                <button type="button" onClick={onClearRecentSearches} className="sf-search-viewall">
                  {t("storefront.search.clearRecent")}
                </button>
              </div>
              <div className="sf-search-pill-row sf-search-pill-row--flush">
                {recentSearches.map((term) => (
                  <button key={term} type="button" onClick={() => onPickTerm(term)} className="sf-search-pill sf-search-pill--recent">
                    <Clock3 aria-hidden="true" strokeWidth={1.75} />
                    {term}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {trendingModels.length ? (
            <div className="sf-search-section">
              <div className="sf-search-heading-row">
                <span className="sf-search-heading">{t("storefront.search.bestSellersTitle")}</span>
              </div>
              <div className="sf-search-trend-row">
                {trendingModels.map((item, index) => (
                  <button
                    key={item.term}
                    type="button"
                    onClick={() => onPickTerm(item.term)}
                    className="sf-search-trend"
                  >
                    <span className="sf-search-trend-media">
                      <img src={imageFor(displayImageForProduct(item.product))} alt="" loading="lazy" decoding="async" />
                      {index < 3 ? <span className="sf-search-trend-rank">{index + 1}</span> : null}
                    </span>
                    <span dir="auto" className="sf-search-trend-name">{item.term}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : trendingSearches.length ? (
            <div className="sf-search-section">
              <div className="sf-search-heading">{t("storefront.search.trendingTitle")}</div>
              <div className="sf-search-pill-row">
                {[...new Set(trendingSearches)].slice(0, 10).map((term) => (
                  <button key={term} type="button" onClick={() => onPickTerm(term)} className="sf-search-pill">
                    {term}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!inspiration.length && inspirationLoading ? (
            <div className="sf-search-section" aria-hidden="true">
              <div className="sf-search-grid sf-search-grid--skeleton">
                {Array.from({ length: 9 }, (_, index) => <span key={index} className="sf-search-tile sf-search-tile--skeleton" />)}
              </div>
            </div>
          ) : null}

          {selectedSize && !inspiration.length && !inspirationLoading ? (
            <div className="sf-search-section">
              <div className="sf-search-empty-note">
                <p>{t("storefront.search.sizeEmpty", { size: selectedSize })}</p>
                <button type="button" onClick={() => onPickSize("")} className="sf-search-outline-btn">
                  {t("storefront.search.searchAllSizes")}
                </button>
              </div>
            </div>
          ) : null}

          {inspiration.length ? (
            <div className="sf-search-section">
              <div className="sf-search-heading-row">
                <span className="sf-search-heading">
                  {selectedSize ? t("storefront.search.sizeGridTitle", { size: selectedSize }) : t("storefront.search.inspirationTitle")}
                  {selectedSize && inspirationTotal ? <span className="sf-search-count">{t("storefront.search.modelCount", { total: inspirationTotal })}</span> : null}
                </span>
                {inspirationResetting ? <Loader2 className="sf-search-spinner" aria-hidden="true" /> : null}
              </div>
              <div className={`sf-search-grid${inspirationResetting ? " is-refreshing" : ""}`} aria-busy={inspirationResetting}>
                {inspiration.map((product, index) => (
                  <button
                    // Colour cards share their parent product id, so the id alone
                    // collides; the position disambiguates a fixed, ordered list.
                    key={product.card_id || `${product.id || product.slug || "tile"}-${index}`}
                    type="button"
                    onClick={() => onPickProduct(product)}
                    className="sf-search-tile"
                    aria-label={product.name || ""}
                  >
                    <img
                      src={imageFor(displayImageForProduct(product))}
                      alt={product.name || ""}
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                ))}
              </div>
              {/* Under the grid, not beside the heading — it is the end of the
                  list, so it belongs where the list ends. */}
              {inspirationHasMore ? (
                <button
                  type="button"
                  onClick={onLoadMoreInspiration}
                  disabled={inspirationLoading}
                  className="sf-search-viewall sf-search-viewall--foot"
                >
                  {inspirationLoading ? t("storefront.common.loading") : t("storefront.common.viewAll")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
// The typed text is bolded inside the name, the way every serious store search
// shows why a row matched. Case-insensitive, first occurrence only.
const highlightSearchMatch = (text = "", query = "") => {
  const source = String(text || "");
  const needle = String(query || "").trim();
  if (!needle) return source;
  const index = source.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return source;
  return (
    <>
      {source.slice(0, index)}
      <mark className="sf-search-mark">{source.slice(index, index + needle.length)}</mark>
      {source.slice(index + needle.length)}
    </>
  );
};

function VisualResultTile({ product, onPickProduct }) {
  const price = displaySellingPrice(product);
  return (
    <button type="button" onClick={() => onPickProduct(product)} className="sf-visual-tile">
      <span className="sf-visual-tile-media">
        <img src={imageFor(displayImageForProduct(product) || product.image_url)} alt="" loading="lazy" decoding="async" />
      </span>
      <span dir="auto" className="sf-visual-tile-name">{product.name}</span>
      {price ? <span className="sf-visual-tile-price">{money(price)}</span> : null}
    </button>
  );
}

function SearchResultRow({ product, active, onPickProduct, query = "" }) {
  return (
    <button
      type="button"
      onClick={() => onPickProduct(product)}
      className={`sf-search-result-row flex items-center gap-3 border p-2.5 text-start transition active:scale-[0.99]${active ? " is-active" : ""}`}
      style={{
        borderRadius: "var(--m1h-r-md)",
        borderColor: active ? "var(--m1h-accent)" : "var(--m1h-line)",
        background: active ? "var(--m1h-accent-soft)" : "var(--m1h-surface)",
        color: "var(--m1h-text)",
      }}
    >
      <img src={imageFor(displayImageForProduct(product) || product.image_url)} alt="" className="h-14 w-14 object-contain" style={{ borderRadius: "var(--m1h-r-sm)", background: "#ffffff" }} loading="lazy" />
      <div className="min-w-0 flex-1">
        {/* dir="auto": an English name in the Arabic sheet truncates at its own end, not its start. */}
        <div dir="auto" className="truncate text-sm font-semibold" style={{ textAlign: "match-parent" }}>{highlightSearchMatch(product.name, query)}</div>
        <div className="truncate text-xs" style={{ color: "var(--m1h-text-3)" }}>
          {[product.category, product.brand, product.style, product.grade].filter(Boolean).join(" / ") || product.sizes?.slice(0, 4).join(" / ") || "Browse items"}
        </div>
      </div>
      <span className="sfx-badge" style={{ color: "var(--m1h-text)", fontVariantNumeric: "tabular-nums" }}>{money(displaySellingPrice(product))}</span>
    </button>
  );
}

const ProductCard = memo(function ProductCard({ product: rawProduct, groupedProduct = null, colorOptions: providedColorOptions = null, selectedColor: providedSelectedColor = "", selectedVariant: providedSelectedVariant = null, availableSizes: providedAvailableSizes = null, wishlist, toggleWishlist, onAddToCart, saleModeEnabled, railType = "default", rank = null, featured = false, density = "standard", sizeLimit = 4, eagerImage = false, priorityImage = false, imagePreset = "grid" }) {
  const { t, i18n } = useTranslation();
  const product = useMemo(() => groupedProduct || rawProduct || {}, [groupedProduct, rawProduct]);
  const cardLook = resolveCardLook(useSiteDesign());
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
  const inWishlist = useMemo(() => isInWishlist(wishlist, product), [product, wishlist]);
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
  const cardFallbackImages = useMemo(
    () => productCardFallbackImages(product, availableVariant, activeColorGroup, displayImage),
    [activeColorGroup, availableVariant, displayImage, product]
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
  // The hover photo only shows on a pointer that can hover, so nothing is fetched until
  // such a pointer reaches the card (or it takes keyboard focus). A phone never asks for it.
  // The <img> itself is the preload: same responsive URL, so the browser downloads it once.
  const [secondaryImageWanted, setSecondaryImageWanted] = useState(false);
  const [secondaryLoadedUrl, setSecondaryLoadedUrl] = useState("");
  const secondaryImageReady = Boolean(secondaryImageUrl) && secondaryLoadedUrl === secondaryImageUrl;
  const requestSecondaryImage = (event) => {
    if (secondaryImageWanted || !hasReadySecondaryImage || typeof window === "undefined") return;
    if (event?.pointerType === "touch") return;
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(hover: hover)").matches) return;
    setSecondaryImageWanted(true);
  };
  const markSecondaryImageLoaded = (node) => {
    if (node?.complete && node.naturalWidth > 0 && node.dataset.cardSrc) setSecondaryLoadedUrl(node.dataset.cardSrc);
  };
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
  // A size chip the shopper tapped travels to the product page as ?size=, which
  // counts there as a chosen size; the variant the card picked on its own does not.
  const [sizeTapped, setSizeTapped] = useState(false);
  const tappedSize = sizeTapped && String(availableVariant?.id) === String(selectedVariantId) ? String(availableVariant?.size || "") : "";
  const detailsUrl = useMemo(() => {
    const url = productUrl({ ...product, selected_variant_id: availableVariant?.id || product.selected_variant_id, color_key: selectedColorKey || product.color_key });
    return tappedSize ? `${url}${url.includes("?") ? "&" : "?"}size=${encodeURIComponent(tappedSize)}` : url;
  }, [availableVariant?.id, product, selectedColorKey, tappedSize]);
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
    setSizeTapped(false);
  }, []);
  // The full product details are fetched on intent only (a pointer over the card,
  // a finger on it). Fetching them as each card scrolled into view sent a dozen
  // heavy, uncached lookups with every listing - phones included, which never
  // show the hover photo those details exist for.
  const brandLabel = productCardBrandLabel(product);
  const brandFilterUrl = useMemo(() => productCardBrandFilterUrl(product), [product]);
  // The homepage card, extended: same plate, badge, heart, brand/name/price type
  // and the same Site Studio template modifier, plus the listing's own tools
  // (quick add, colour swatches, sizes) underneath. One card look on every page.
  const cardClassName = [
    "sfx-product-card m1h-card group/product",
    cardLook.className,
    cardLook.showBrand ? "" : "m1h-card--no-brand",
    cardLook.showBadge ? "" : "m1h-card--no-badge",
    featured ? "sfx-product-card--featured" : "",
    density === "compact" ? "sfx-product-card--compact" : "",
  ].filter(Boolean).join(" ");

  return (
    <article ref={cardRef} style={eagerImage ? undefined : { contentVisibility: "auto", containIntrinsicSize: "240px 340px" }} onMouseEnter={requestDetailPrefetch} onTouchStart={requestDetailPrefetch} className={cardClassName}>
      <div className="m1h-card__plate">
        <Link to={detailsUrl} onClick={resetStorefrontViewportScroll} onFocus={requestSecondaryImage} className="sfx-card__media-link" aria-label={product.name}>
          {displayImage ? (
            <div className="sfx-card-media group/card-image" onPointerEnter={requestSecondaryImage}>
              <img
                ref={primaryImageRef}
                src={imageFor(displayImage)}
                {...responsiveImageProps(displayImage, imagePreset)}
                alt={product.name}
                onError={fallbackProductImage}
                data-fallback-src={cardFallbackImages.map((url) => imageFor(url)).join("|")}
                className={`sf-card-primary-image sfx-card__img opacity-100 ${hasReadySecondaryImage && secondaryImageReady ? "md:group-hover/card-image:opacity-0" : "md:group-hover/card-image:opacity-100"}`}
                style={{ backfaceVisibility: "hidden" }}
                loading={eagerImage ? "eager" : "lazy"}
                fetchPriority={priorityImage ? "high" : undefined}
                decoding="async"
                width="360"
                height="432"
              />
              {hasReadySecondaryImage && secondaryImageWanted ? (
                <img
                  ref={markSecondaryImageLoaded}
                  src={imageFor(secondaryImageUrl)}
                  {...responsiveImageProps(secondaryImageUrl, imagePreset)}
                  data-card-src={secondaryImageUrl}
                  alt={product.name}
                  aria-hidden="true"
                  onLoad={(event) => markSecondaryImageLoaded(event.currentTarget)}
                  onError={fallbackProductImage}
                  className={`sf-card-secondary-image sfx-card__img sfx-card__img--secondary opacity-0 ${secondaryImageReady ? "md:group-hover/card-image:opacity-100" : ""}`}
                  style={{ backfaceVisibility: "hidden" }}
                  loading="lazy"
                  decoding="async"
                  width="360"
                  height="432"
                />
              ) : null}
            </div>
          ) : (
            <span className="sfx-card__placeholder">
              <Sparkles size={22} aria-hidden="true" />
            </span>
          )}
        </Link>
        {discountPercent ? (
          <span className="m1h-badge m1h-badge--sale">-{discountPercent}%</span>
        ) : rank && railType === "bestseller" && rank <= 3 ? (
          <span className="m1h-badge m1h-badge--last">TOP {rank}</span>
        ) : null}
        <button
          type="button"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); handleWishlist(); }}
          className={`m1h-fav${inWishlist ? " is-on" : ""}`}
          aria-label={t("storefront.header.wishlist")}
          aria-pressed={inWishlist}
        >
          <Heart size={15} strokeWidth={2} />
        </button>
        <CompareToggleButton
          product={product}
          colorKey={selectedColorKey}
          colorName={activeColorGroup?.color || ""}
          image={displayImage ? imageFor(displayImage) : ""}
        />
        {/* With a mouse, a quick view slides up over the photo on hover; on a phone
            the cart button below opens the same sheet. */}
        {canQuickAdd ? (
          <button
            type="button"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); openVariantSheet(); }}
            className="sfx-card__quick"
          >
            <Eye size={15} aria-hidden="true" />
            {t("storefront.products.quickView", "نظرة سريعة")}
          </button>
        ) : null}
      </div>
      <div className="m1h-card__body">
        {brandLabel ? (
          <Link
            to={brandFilterUrl || "/products"}
            onClick={(event) => event.stopPropagation()}
            aria-label={`${normalizeLanguage(i18n.language) === "ar" ? "عرض منتجات" : "Shop"} ${brandLabel}`}
            className="sf-product-card-brand m1h-card__brand sfx-card__brand"
          >
            {brandLabel}
          </Link>
        ) : (
          <p className="m1h-card__brand" aria-hidden="true" />
        )}
        <Link
          to={detailsUrl}
          onClick={resetStorefrontViewportScroll}
          className={`sf-product-card-name m1h-card__name sfx-card__name`}
        >
          {product.name}
        </Link>
        <div className="sfx-card__buy">
          <div className="m1h-card__price sfx-card__price">
            <span className={`m1h-card__price-now${comparePrice ? " m1h-card__price-now--sale" : ""}`}>{money(sellingPrice)}</span>
            {comparePrice ? <span className="m1h-card__price-was">{money(comparePrice)}</span> : null}
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              openVariantSheet();
            }}
            disabled={!canQuickAdd}
            className="sfx-card__add"
            aria-label={canQuickAdd ? t("storefront.cart.addToCart") : t("storefront.products.unavailable")}
            title={canQuickAdd ? t("storefront.cart.addToCart") : t("storefront.products.unavailable")}
          >
            <ShoppingCart size={16} aria-hidden="true" />
          </button>
        </div>
        {colorGroups.length > 1 ? (
          <div className="sfx-card__swatches">
            {visibleColorOptions.map((group) => {
              const active = String(group.key) === String(selectedColorKey);
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={(event) => chooseColor(event, group)}
                  title={group.colorName || group.color}
                  aria-label={group.colorName || group.color}
                  aria-pressed={active}
                  className={`sfx-swatch${active ? " is-active" : ""}`}
                >
                  <span style={swatchColorStyle(group.colorName || group.color)} />
                </button>
              );
            })}
            {extraColorCount ? <span dir="ltr" className="sfx-card__more">+{extraColorCount}</span> : null}
          </div>
        ) : null}
        <div className="sfx-card__sizes">
          {visibleSizes.map(({ size, variant }) => {
            const selected = String(availableVariant?.id) === String(variant?.id);
            return (
              <button
                key={`${activeColorGroup?.key || "default"}-${variant?.id || size}`}
                type="button"
                onClick={(event) => { event.stopPropagation(); setSelectedVariantId(variant.id); setSelectedColorKeyState(variantColorKey(variant)); setSizeTapped(true); }}
                className={`sfx-size${selected ? " is-active" : ""}`}
              >
                {/* A bare "20" is inches only on a school bag; on a kids' shoe it is the EU size. */}
                {isSchoolBagProduct(product) ? formatSchoolBagCardSize(size, i18n.resolvedLanguage || i18n.language) : localizeSizeLabel(size, i18n.resolvedLanguage || i18n.language)}
              </button>
            );
          })}
          {extraSizeCount ? <span dir="ltr" className="sfx-card__more">+{extraSizeCount}</span> : null}
          {!visibleSizes.length ? <span className="sfx-card__more">{t("storefront.products.oneSize")}</span> : null}
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openSizeGuide({ product });
            }}
            className="sfx-card__guide"
          >
            {t("storefront.products.sizeGuide", "دليل المقاسات")}
          </button>
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
  const wasInWishlist = isInWishlist(prev.wishlist, prev.groupedProduct || prev.product);
  const nowInWishlist = isInWishlist(next.wishlist, next.groupedProduct || next.product);
  return (
    prev.product === next.product &&
    prev.groupedProduct === next.groupedProduct &&
    prev.colorOptions === next.colorOptions &&
    prev.selectedColor === next.selectedColor &&
    prev.selectedVariant === next.selectedVariant &&
    prev.availableSizes === next.availableSizes &&
    wasInWishlist === nowInWishlist &&
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

// Quick view: the product card's cart button (and, with a mouse, the "Quick view"
// button on the photo) opens this instead of the product page. A large photo of
// the chosen colour, the price, colours, sizes, quantity and add to cart — and a
// link through to the full page for anything more. Painted from the --m1h-*
// tokens in components/productQuickView.css; on a phone it is a bottom sheet.
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
  const [imageIndex, setImageIndex] = useState(0);
  const [nudge, setNudge] = useState({ tick: 0, target: "" });
  const [adding, setAdding] = useState(false);
  const sizesRef = useRef(null);
  const closeRef = useRef(null);
  const swipeRef = useRef(null);
  const titleId = `sfq-title-${product?.id || "product"}`;
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
  // Before a colour is chosen the photo and price follow the colour the card showed.
  const previewGroup = activeGroup || colorGroups[0] || null;
  const priceVariant = selectedVariant || availableSizeOptions[0]?.variant || firstDisplayVariant(previewGroup?.variants || []) || null;
  const sellingPrice = displaySellingPrice(product, priceVariant);
  const comparePrice = displayComparePrice(product, priceVariant);
  const discountPercent = comparePrice > sellingPrice && sellingPrice > 0 ? Math.round((1 - sellingPrice / comparePrice) * 100) : 0;
  const images = useMemo(() => {
    const primary = productCardPrimaryImageFor(product, priceVariant, previewGroup);
    const secondary = productCardSecondaryImageFor(product, priceVariant, previewGroup, primary);
    return [...new Set([primary, secondary].map((image) => resolveCardImageUrl(image)).filter(Boolean))];
  }, [previewGroup, priceVariant, product]);
  const safeImageIndex = Math.min(imageIndex, Math.max(0, images.length - 1));
  const maxQty = Math.max(1, Number(selectedVariant?.stock || 1));
  const safeQty = Math.min(Math.max(1, Number(quantity || 1)), maxQty);
  const brand = String(productCardBrandLabel(product) || "").trim();
  const detailsHref = useMemo(() => {
    const url = productUrl({
      ...product,
      selected_variant_id: (selectedVariant || priceVariant)?.id || product?.selected_variant_id,
      color_key: previewGroup?.key || product?.color_key,
    });
    // A size chosen here counts as chosen on the product page too.
    return selectedVariant?.size ? `${url}${url.includes("?") ? "&" : "?"}size=${encodeURIComponent(selectedVariant.size)}` : url;
  }, [previewGroup?.key, priceVariant, product, selectedVariant]);

  const handleCloseRequest = useCallback((event) => {
    event?.stopPropagation?.();
    if (typeof onClose === "function") onClose();
  }, [onClose]);

  useEffect(() => {
    setImageIndex(0);
  }, [previewGroup?.key]);

  useEffect(() => {
    const selectable = availableSizeOptions.filter((item) => variantHasStock(item.variant));
    if (selectable.length !== 1) return;
    const nextVariantId = selectable[0]?.variant?.id || "";
    if (String(nextVariantId) && String(nextVariantId) !== String(selectedVariantId) && typeof onVariantChange === "function") {
      onVariantChange(nextVariantId);
    }
  }, [availableSizeOptions, onVariantChange, selectedVariantId]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event) => {
      if (event.key === "Escape") handleCloseRequest();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [handleCloseRequest, open]);

  const submit = async () => {
    if (!activeGroup) {
      setNudge((prev) => ({ tick: prev.tick + 1, target: "color" }));
      return;
    }
    if (!selectedVariant || !variantHasStock(selectedVariant)) {
      setNudge((prev) => ({ tick: prev.tick + 1, target: "size" }));
      sizesRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      sizesRef.current?.querySelector(".sfq-size:not(:disabled)")?.focus({ preventScroll: true });
      return;
    }
    if (!onAdd || adding) return;
    setAdding(true);
    try {
      await Promise.resolve(onAdd(selectedVariant, safeQty));
    } finally {
      setAdding(false);
    }
  };

  const onMediaPointerDown = (event) => {
    swipeRef.current = { x: event.clientX, y: event.clientY };
  };
  const onMediaPointerUp = (event) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || images.length < 2) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(event.clientY - start.y)) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = (dx < 0) !== rtl ? 1 : -1;
    setImageIndex((safeImageIndex + step + images.length) % images.length);
  };

  if (!open) return null;

  return createPortal(
    <div className="sfq" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="sfq__backdrop" onClick={handleCloseRequest} aria-label={t("common.close")} tabIndex={-1} />
      <section className="sfq__panel" onClick={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}>
        <span className="sfq__grab" aria-hidden="true" />
        <button ref={closeRef} type="button" onClick={handleCloseRequest} className="sfq__close" aria-label={t("common.close")}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="sfq__media" onPointerDown={onMediaPointerDown} onPointerUp={onMediaPointerUp} onPointerCancel={() => { swipeRef.current = null; }}>
          {images.length ? (
            <img
              key={images[safeImageIndex]}
              src={imageFor(images[safeImageIndex])}
              onError={fallbackProductImage}
              alt={product?.name || ""}
              className="sfq__img"
              decoding="async"
              draggable={false}
            />
          ) : null}
          {discountPercent ? <span className="m1h-badge m1h-badge--sale sfq__badge">-{discountPercent}%</span> : null}
          {images.length > 1 ? (
            <div className="sfq__dots">
              {images.map((image, index) => (
                <button
                  key={image}
                  type="button"
                  onClick={() => setImageIndex(index)}
                  className={`sfq__dot${index === safeImageIndex ? " is-active" : ""}`}
                  aria-label={sfText("storefront.products.imageCount", "{{current}} of {{total}}", { current: index + 1, total: images.length })}
                  aria-current={index === safeImageIndex}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="sfq__body">
          {brand ? <p className="sfq__brand">{brand}</p> : null}
          <h2 id={titleId} className="sfq__name">{product?.name}</h2>
          <div className="sfq__price">
            <span className={`sfq__price-now${comparePrice > sellingPrice ? " is-sale" : ""}`}>{money(sellingPrice)}</span>
            {comparePrice > sellingPrice ? <span className="sfq__price-was">{money(comparePrice)}</span> : null}
          </div>

          {colorGroups.length > 1 ? (
            <div className="sfq__option">
              <div className="sfq__option-head">
                <span className="sfq__option-title">{t("storefront.products.color", "اللون")}</span>
                {activeGroup ? <span className="sfq__option-value">{localizeColorName(activeGroup.colorName || activeGroup.color, i18n.language)}</span> : null}
              </div>
              {nudge.target === "color" && !activeGroup ? (
                <p key={nudge.tick} role="alert" className="sfq__nudge">{sfText("storefront.products.chooseColorFirst", "اختار اللون أولًا")}</p>
              ) : null}
              <div className="sfq__colors">
                {colorGroups.map((group) => {
                  const active = String(group.key) === String(activeGroup?.key);
                  const swatch = resolveCardImageUrl(group.image_url || group.primaryImage);
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => onColorChange(group.key)}
                      className={`sfq-color${active ? " is-active" : ""}`}
                      aria-pressed={active}
                      aria-label={group.colorName || group.color}
                      title={group.colorName || group.color}
                    >
                      {swatch ? (
                        <img src={imageFor(swatch)} onError={fallbackProductImage} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <span className="sfq-color__chip" style={swatchColorStyle(group.colorName || group.color)} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div ref={sizesRef} className={`sfq__option${nudge.target === "size" && !selectedVariant ? " is-prompting" : ""}`}>
            <div className="sfq__option-head">
              <span className="sfq__option-title">{t("storefront.products.size", "المقاس")}</span>
              <button type="button" onClick={() => openSizeGuide({ product, variants: activeGroup?.variants || null, selectedSize: selectedVariant?.size || "" })} className="sfq__guide">
                {t("storefront.products.sizeGuide", "دليل المقاسات")}
              </button>
            </div>
            {nudge.target === "size" && !selectedVariant ? (
              <p key={nudge.tick} role="alert" className="sfq__nudge">{sfText("storefront.products.chooseSizeFirst", "اختار المقاس أولًا")}</p>
            ) : null}
            {activeGroup ? (
              sizeOptions.length ? (
                <div className="sfq__sizes">
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
                        aria-pressed={active}
                        className={`sfq-size${active ? " is-active" : hasStock ? "" : " is-unavailable"}`}
                      >
                        <span>{size ? localizeSizeLabel(size, i18n.language) : t("storefront.products.oneSize", "مقاس واحد")}</span>
                        {collision && originalSize !== size ? <span className="sfq-size__alt">{originalSize}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="sfq__muted">{t("storefront.products.unavailable", "غير متاح")}</p>
              )
            ) : (
              <p className="sfq__muted">{sfText("storefront.products.chooseColorFirst", "اختار اللون أولًا")}</p>
            )}
          </div>

          <div className="sfq__buy">
            <div className="sfq-qty" role="group" aria-label={t("storefront.cart.quantity", "الكمية")}>
              <button type="button" onClick={() => onQuantityChange(Math.max(1, safeQty - 1))} disabled={!selectedVariant || safeQty <= 1} aria-label={sfText("storefront.cart.decreaseQuantity", "Decrease quantity")}>
                <Minus className="h-4 w-4" aria-hidden="true" />
              </button>
              <span aria-live="polite">{safeQty}</span>
              <button type="button" onClick={() => onQuantityChange(Math.min(maxQty, safeQty + 1))} disabled={!selectedVariant || safeQty >= maxQty} aria-label={sfText("storefront.cart.increaseQuantity", "Increase quantity")}>
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <button type="button" onClick={submit} disabled={adding} className="sfq__add">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShoppingCart className="h-4 w-4" aria-hidden="true" />}
              {t("storefront.cart.addToCart")}
            </button>
          </div>

          <Link to={detailsHref} onClick={handleCloseRequest} className="sfq__details">
            {sfText("storefront.products.viewFullDetails", "شوف كل تفاصيل المنتج")}
            <ChevronLeft className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
          </Link>
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

// One full desktop row. Below it a rail looks broken, so it unfolds colour cards.
const RECOMMENDATION_RAIL_MIN_ITEMS = 5;

// The product page's rails are the homepage's filtered row, card for card: the
// same HomeFilteredRail, the same HomeProductCard and the same view model. The
// owner asked for the two to look alike, and a second card drawn by hand here
// is how they drifted apart in the first place.
//
// `.m1h` carries the tokens those components paint with; `m1h--embedded` keeps
// the homepage's page background and gutters out of the product page.
// The shop's theme lives on `body.storefront-dark`, which the shell toggles.
// Watched rather than read once, so flipping the theme repaints the rails too.
const readBodyStorefrontDark = () => typeof document !== "undefined" && document.body.classList.contains("storefront-dark");

function useBodyStorefrontDark() {
  const [dark, setDark] = useState(readBodyStorefrontDark);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return undefined;
    setDark(readBodyStorefrontDark());
    const observer = new MutationObserver(() => setDark(readBodyStorefrontDark()));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

// The same three audiences the homepage rows switch between.
const RECOMMENDATION_AUDIENCES = ["men", "women", "kids"];

function StorefrontRecommendationRail({ title, subtitle, href, products = [], currentId, loading = false, minItems = 0, wishlist = [], toggleWishlist, genders = [], activeGender = "", onGenderChange }) {
  const { i18n } = useTranslation();
  const dark = useBodyStorefrontDark();
  const isRtl = normalizeLanguage(i18n.language || "ar") === "ar";
  const { brands } = useStorefrontBrands();
  const knownBrandNames = useMemo(
    () => (Array.isArray(brands) ? brands : []).map((brand) => brand?.name).filter(Boolean),
    [brands]
  );
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
  const cardCtx = useMemo(
    () => ({
      imageFor,
      responsiveImageProps,
      money,
      productUrl,
      pricing: featuredSlideProduct,
      knownBrands: knownBrandNames,
      fallbackEyebrow: (product) => getProductTypeLabel(product?.product_type || product?.productType || "", isRtl ? "ar" : "en"),
      isLastPiece: isLastPieceProduct,
      lastPieceLabel: isRtl ? "آخر قطعة" : "Last pair",
    }),
    [isRtl, knownBrandNames]
  );
  // A card's key must be unique in the row, and colour cards of one model share
  // the product id, so the rail's own card key wins over the view model's.
  const cards = useMemo(
    () => items
      .map((product, index) => ({ ...buildHomeProductCard(product, cardCtx), key: productCardKey(product, index) }))
      .filter((card) => card.image),
    [cardCtx, items]
  );
  const isFavorite = useCallback(
    (product) => isInWishlist(wishlist, product),
    [wishlist]
  );
  const genderLabel = useCallback(
    (value) => (isRtl ? GENDER_LABELS[value]?.ar : GENDER_LABELS[value]?.en) || value,
    [isRtl]
  );
  // An audience the visitor picked and that came back empty keeps its switch, so
  // they can pick another. A rail empty with no audience applied simply goes.
  const keepWhenEmpty = genders.length > 1 && Boolean(activeGender);
  if (!loading && !cards.length && !keepWhenEmpty) return null;
  return (
    <div className="sf-related-rail m1h m1h--embedded min-w-0" data-theme={dark ? "dark" : "light"} dir={isRtl ? "rtl" : "ltr"}>
      <HomeFilteredRail
        title={title}
        subtitle={subtitle}
        genders={genders}
        activeGender={activeGender}
        genderLabel={genderLabel}
        onGenderChange={onGenderChange}
        keepWhenEmpty={keepWhenEmpty}
        emptyLabel={isRtl ? "مفيش منتجات هنا دلوقتي." : "Nothing here right now."}
        autoplay
        cards={cards}
        loading={loading}
        viewAllHref={href || "/products"}
        viewAllLabel={sfText("storefront.common.viewAll")}
        isFavorite={isFavorite}
        onToggleFavorite={typeof toggleWishlist === "function" ? toggleWishlist : undefined}
        onImageError={fallbackProductImage}
        favoriteLabel={sfText("storefront.header.wishlist")}
        prevLabel={sfText("storefront.common.previous")}
        nextLabel={sfText("storefront.common.next")}
        isRtl={isRtl}
      />
    </div>
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
  // Family alone still mixed a men's shoe with kids' and women's. The audience
  // narrows it to who the open product is actually for. A product with no
  // audience keeps the wider match rather than filtering itself down to nothing.
  const productAudience = normalizeAudienceValue(recommendationText(
    currentProduct?.gender ||
    (Array.isArray(currentProduct?.audiences) ? currentProduct.audiences[0] : "") ||
    (Array.isArray(currentProduct?.product_audiences) ? currentProduct.product_audiences[0] : "")
  ));
  // Each rail carries the homepage's رجالي / حريمي / أطفال switch. It opens on
  // the product's own audience and re-asks the server when changed, exactly as
  // a homepage row does. The two rails switch independently.
  const [audience, setAudience] = useState(productAudience);
  const [brandAudience, setBrandAudience] = useState(productAudience);
  // Grade is the third axis: a shopper looking at a Vietnamese import wants other
  // Vietnamese imports, not the mirror of the same shoe. It only ever narrows here
  // — on its own it used to be the whole filter, which is how a bag page ended up
  // recommending sneakers.
  const grade = recommendationText(
    currentProduct?.grade || currentProduct?.quality || currentProduct?.quality_grade || currentProduct?.product_grade
  );
  const similarFilter = {
    ...(productType ? { product_type: productType } : { category: category || "__no_category__" }),
    ...(audience ? { gender: audience } : {}),
    ...(grade ? { grade } : {}),
  };
  const similarQuery = new URLSearchParams(
    Object.entries(similarFilter).filter(([, value]) => value && !String(value).startsWith("__"))
  ).toString();
  const similarHref = similarQuery ? `/products?${similarQuery}` : "/products";
  const similarResult = useProducts({ ...similarFilter, limit: 15, in_stock: 1, grouping: "product" });
  const brandResult = useProducts({ brand: brand || "__no_brand__", limit: 15, in_stock: 1, grouping: "product", ...(brandAudience ? { gender: brandAudience } : {}) });
  const brandHref = brand
    ? `/products?${new URLSearchParams({ brand, ...(brandAudience ? { gender: brandAudience } : {}) }).toString()}`
    : "/products";
  return (
    <div className="sf-related-products mt-5">
      <StorefrontRecommendationRail title={sfText("storefront.products.relatedProducts")} href={similarHref} products={similarResult.products} loading={similarResult.loading} currentId={currentId} minItems={RECOMMENDATION_RAIL_MIN_ITEMS} genders={RECOMMENDATION_AUDIENCES} activeGender={audience} onGenderChange={setAudience} {...props} />
      <StorefrontRecommendationRail title={brand ? sfText("storefront.products.moreFromBrand", undefined, { brand }) : sfText("storefront.products.sameBrand")} href={brandHref} products={brandResult.products} loading={brandResult.loading} currentId={currentId} minItems={RECOMMENDATION_RAIL_MIN_ITEMS} genders={brand ? RECOMMENDATION_AUDIENCES : []} activeGender={brandAudience} onGenderChange={setBrandAudience} {...props} />
    </div>
  );
}

/* ==========================================================================
   "Pairs well with" — two products, one bundle button
   ==========================================================================
   The pair is the product the owner pinned in the ERP, or — with no pin — the
   first in-stock product for the same audience, preferring a different product
   type (a sneaker suggests a bag or slippers before another sneaker). Both
   cards start ticked; the button adds the ticked ones, and when both are ticked
   they go in as one bundle and earn the configured discount at checkout. The
   saving shown is computed by shared/bundleDiscount.js, the function checkout
   charges with, so the number on the button is the number on the invoice. */

const usePublicBundleConfig = () => {
  const [config, setConfig] = useState({ enabled: false, percent: 0, ready: false });
  useEffect(() => {
    let cancelled = false;
    getPublicSettingsResponse()
      .then((data) => {
        if (cancelled) return;
        const { settings } = extractPublicStorefrontSettings(data);
        setConfig({ ...storefrontBundleConfig(settings), ready: true });
      })
      .catch(() => {
        if (!cancelled) setConfig({ enabled: false, percent: 0, ready: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
};

const bundleSellableVariants = (product = {}) =>
  (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => variant?.id && variantHasStock(variant));

const bundleVariantLabel = (product, variant, multiColor) => {
  const size = isCrocsProduct(product) ? resolveCrocsEuSize(String(variant?.size || "")) : String(variant?.size || "");
  const color = variantColorName(variant) || variant?.color || "";
  return [multiColor ? color : "", size || (multiColor ? "" : color)].filter(Boolean).join(" · ") || sfText("storefront.products.oneSize", "One size");
};

// The catalogue readings the scored pick needs (./lib/pairPicker.js holds the rules).
const pairPickerContext = (saleModeEnabled) => ({
  audiencesOf: (item) => productAudienceValues(item || {}),
  priceOf: (item) => getDisplayPricing(item, parseSaleModeEnabled(saleModeEnabled, false), firstDisplayVariant(bundleSellableVariants(item)) || {}).price,
  isSellable: (item) => bundleSellableVariants(item).length > 0,
  typeOf: (item) => resolveProductTypeKey(item?.product_type || item?.productType || ""),
});

function PairsWellWithCard({ product, variantId, onVariantChange, checked, onCheckedChange, saleModeEnabled, isCurrent }) {
  const variants = useMemo(() => bundleSellableVariants(product), [product]);
  const multiColor = new Set(variants.map((variant) => variantColorKey(variant))).size > 1;
  const selectedVariant = variants.find((variant) => String(variant.id) === String(variantId)) || null;
  const pricing = getDisplayPricing(product, parseSaleModeEnabled(saleModeEnabled, false), selectedVariant || firstDisplayVariant(variants) || {});
  const image = productCardPrimaryImageFor(product, selectedVariant || firstDisplayVariant(variants));
  const name = cleanDisplayText(mirrorProductTitle(product, selectedVariant) || product?.name || "");
  const selectId = `sf-pair-size-${product?.id}`;
  const body = (
    <>
      <div className="sf-pair__plate">
        <img src={imageFor(image)} onError={fallbackProductImage} alt={name} loading="lazy" decoding="async" />
      </div>
      <p className="sf-pair__name">{name}</p>
    </>
  );
  return (
    <div className={`sf-pair__card${checked ? " is-checked" : ""}`}>
      {isCurrent ? <div className="sf-pair__link">{body}</div> : <Link to={productUrl(product)} className="sf-pair__link">{body}</Link>}
      <label htmlFor={selectId} className="sr-only">{sfText("storefront.bundle.chooseSize", "Size")}</label>
      <select id={selectId} className="sf-pair__select" value={variantId || ""} onChange={(event) => onVariantChange(event.target.value)}>
        <option value="" disabled>{sfText("storefront.bundle.chooseSize", "Size")}</option>
        {variants.map((variant) => (
          <option key={variant.id} value={variant.id}>{bundleVariantLabel(product, variant, multiColor)}</option>
        ))}
      </select>
      <div className="sf-pair__price">
        {pricing.comparePrice > pricing.price ? <s>{money(pricing.comparePrice)}</s> : null}
        <span>{money(pricing.price)}</span>
      </div>
      <label className="sf-pair__check">
        <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
        <span>{sfText("storefront.bundle.addThis", "Add this")}</span>
      </label>
    </div>
  );
}

function PairsWellWith({ product, currentVariant, onAddToCart, saleModeEnabled }) {
  const config = usePublicBundleConfig();
  const [pair, setPair] = useState(null);
  const [status, setStatus] = useState("idle");
  const [currentVariantId, setCurrentVariantId] = useState("");
  const [pairVariantId, setPairVariantId] = useState("");
  const [checked, setChecked] = useState({ current: true, pair: true });
  const productId = product?.id;
  // The pick depends on the product, not on each re-render handing a new object.
  const productRef = useRef(product);
  productRef.current = product;
  const saleModeRef = useRef(saleModeEnabled);
  saleModeRef.current = saleModeEnabled;
  const audience = normalizeAudienceValue(productAudienceValues(product)[0] || product?.gender || "");

  // The page's own size choice seeds the current card and follows it when the
  // shopper changes it above. Keyed on the id, not the object: the page builds a
  // new variant object on every render, and depending on that reset a size the
  // shopper had just picked in this card back to the page's.
  const currentVariantKey = currentVariant?.id && variantHasStock(currentVariant) ? String(currentVariant.id) : "";
  useEffect(() => {
    if (currentVariantKey) setCurrentVariantId(currentVariantKey);
  }, [currentVariantKey]);

  useEffect(() => {
    if (!config.ready || !config.enabled || !productId) return undefined;
    let cancelled = false;
    setStatus("loading");
    setPair(null);
    setPairVariantId("");
    setChecked({ current: true, pair: true });
    (async () => {
      let chosen = null;
      try {
        const pinned = await cachedStorefrontGet(`/storefront/products/${encodeURIComponent(productId)}/pair`, { ttlMs: 60_000 });
        const pinnedProduct = pinned?.product || pinned?.data?.product || null;
        if (pinnedProduct && bundleSellableVariants(pinnedProduct).length) chosen = pinnedProduct;
      } catch {
        // No pin endpoint or no pin: fall through to the automatic pick.
      }
      if (!chosen) {
        try {
          const response = await cachedStorefrontGet(
            // A wider pool than one page: the scoring needs complements to choose from.
            buildStorefrontProductsRequestUrl({ ...(audience ? { gender: audience } : {}), in_stock: 1, grouping: "product", limit: 60 }),
            { ttlMs: STOREFRONT_PRODUCTS_CACHE_TTL_MS }
          );
          chosen = pickAutomaticPair(extractStorefrontProductsFromResponse(response), productRef.current, pairPickerContext(saleModeRef.current));
        } catch {
          chosen = null;
        }
      }
      if (cancelled) return;
      setPair(chosen);
      const variants = bundleSellableVariants(chosen || {});
      // One size, nothing to choose. Otherwise the shopper picks — a guessed size is a return.
      if (variants.length === 1) setPairVariantId(String(variants[0].id));
      setStatus(chosen ? "ready" : "empty");
    })();
    return () => {
      cancelled = true;
    };
  }, [audience, config.enabled, config.ready, productId]);

  if (!config.enabled || status !== "ready" || !pair || !bundleSellableVariants(product).length) return null;

  const saleMode = parseSaleModeEnabled(saleModeEnabled, false);
  const currentVariants = bundleSellableVariants(product);
  const pairVariants = bundleSellableVariants(pair);
  const chosenCurrent = currentVariants.find((variant) => String(variant.id) === String(currentVariantId)) || null;
  const chosenPair = pairVariants.find((variant) => String(variant.id) === String(pairVariantId)) || null;
  const priceOf = (item, variant) => getDisplayPricing(item, saleMode, variant || firstDisplayVariant(bundleSellableVariants(item)) || {}).price;
  const bothChecked = checked.current && checked.pair;
  const bundleId = buildBundleId(product.id, pair.id);
  const preview = computeBundleDiscount(
    [
      { bundle_id: bundleId, product_id: product.id, price: priceOf(product, chosenCurrent), quantity: 1 },
      { bundle_id: bundleId, product_id: pair.id, price: priceOf(pair, chosenPair), quantity: 1 },
    ],
    bothChecked ? config.percent : 0
  );
  const selectedTotal = (checked.current ? priceOf(product, chosenCurrent) : 0) + (checked.pair ? priceOf(pair, chosenPair) : 0);
  const nothingChecked = !checked.current && !checked.pair;

  const addBundle = () => {
    const picks = [
      checked.current ? { item: product, variant: chosenCurrent } : null,
      checked.pair ? { item: pair, variant: chosenPair } : null,
    ].filter(Boolean);
    if (!picks.length) return;
    if (picks.some((pick) => !pick.variant)) {
      toast.error(sfText("storefront.bundle.chooseSizes", "Choose a size for each product"));
      return;
    }
    picks.forEach((pick, index) => {
      onAddToCart?.(pick.item, pick.variant, 1, {
        bundleId: bothChecked ? bundleId : "",
        openDrawer: index === picks.length - 1,
      });
    });
    if (bothChecked) toast.success(sfText("storefront.bundle.added", "Bundle added to your bag"));
  };

  return (
    <section className="sf-pair" aria-labelledby="sf-pair-title">
      <h2 id="sf-pair-title" className="sf-pair__title">{sfText("storefront.bundle.title", "Pairs well with")}</h2>
      <p className="sf-pair__subtitle">
        {config.percent > 0
          ? sfText("storefront.bundle.subtitle", "Buy them together and save {{percent}}%", { percent: config.percent })
          : sfText("storefront.bundle.subtitleNoDiscount", "Complete the look")}
      </p>
      <div className="sf-pair__grid">
        <PairsWellWithCard
          product={product}
          isCurrent
          variantId={currentVariantId}
          onVariantChange={setCurrentVariantId}
          checked={checked.current}
          onCheckedChange={(value) => setChecked((prev) => ({ ...prev, current: value }))}
          saleModeEnabled={saleModeEnabled}
        />
        <span className="sf-pair__plus" aria-hidden="true">+</span>
        <PairsWellWithCard
          product={pair}
          variantId={pairVariantId}
          onVariantChange={setPairVariantId}
          checked={checked.pair}
          onCheckedChange={(value) => setChecked((prev) => ({ ...prev, pair: value }))}
          saleModeEnabled={saleModeEnabled}
        />
      </div>
      <div className="sf-pair__footer">
        {config.percent > 0 && !bothChecked ? (
          <p className="sf-pair__hint">{sfText("storefront.bundle.selectBoth", "Select both products to get {{percent}}% off", { percent: config.percent })}</p>
        ) : null}
        {!nothingChecked ? (
          <p className="sf-pair__total">
            {preview.amount > 0 ? <s>{money(selectedTotal)}</s> : null}
            <span>{money(selectedTotal - preview.amount)}</span>
          </p>
        ) : null}
        <button type="button" className="sf-pair__cta" onClick={addBundle} disabled={nothingChecked}>
          {preview.amount > 0
            ? sfText("storefront.bundle.getBundleSave", "Get the bundle · save {{amount}}", { amount: money(preview.amount) })
            : sfText("storefront.bundle.getBundle", "Get the bundle")}
        </button>
      </div>
    </section>
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

const PENDING_COUPON_STORAGE_KEY = "sf_pending_coupon";

function CheckoutPage({ cart, clearCart, profile, setProfile, themeMode, repriceCart, cartRepriceNotice, dismissCartRepriceNotice }) {
  const [checkoutSearchParams] = useSearchParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const checkoutLanguage = normalizeLanguage(i18n.language);
  // What this browser typed the last time it bought something. The contact fields are
  // seeded from it right here so the form is filled on the very first paint; the address
  // needs the ids replayed into the pickers, so it goes through the restore below.
  const [deviceCheckoutDetails] = useState(() => readLastCheckoutDetails());
  const [form, setForm] = useState({
    full_name: profile.full_name || deviceCheckoutDetails?.full_name || "",
    primary_phone: profile.primary_phone || deviceCheckoutDetails?.primary_phone || "",
    email: profile.email || profile.customer_email || deviceCheckoutDetails?.email || "",
    secondary_phone: deviceCheckoutDetails?.secondary_phone || "",
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
  // Whether the phone the confirmation goes to has WhatsApp: exists is true/false once the
  // server answered, null while unknown (a down gateway never blocks the order).
  const [whatsappCheck, setWhatsappCheck] = useState({ phone: "", exists: null, checking: false });
  const whatsappAnswersRef = useRef(new Map());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Every distinct address this customer has ordered to (server-deduplicated),
  // offered as "saved addresses" once the phone number identifies them.
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedSavedAddress, setSelectedSavedAddress] = useState("");
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
  // Bumped to re-quote shipping when the server says the fee moved but the subtotal did not.
  const [shippingRequoteToken, setShippingRequoteToken] = useState(0);
  const [shippingLocations, setShippingLocations] = useState(() => normalizeCheckoutLocations());
  const [publicStoreSettings, setPublicStoreSettings] = useState({});
  const [bostaLocations, setBostaLocations] = useState({ cities: [], zones: [], districts: [], loadingCities: false, loadingZones: false, loadingDistricts: false });
  const editedCheckoutFieldsRef = useRef(new Set());
  const latestAddressLookupsRef = useRef(new Set());
  // The last-order address of this device is replayed once per visit to the page.
  const deviceAddressRestoredRef = useRef(false);
  const bostaCitiesProbedRef = useRef(false);
  const latestAddressRestoreTokenRef = useRef(0);
  const couponValidationKeyRef = useRef("");
  const metaCheckoutSentRef = useRef(false);
  const ga4ShippingSentRef = useRef(false);
  useEffect(() => {
    setStorefrontSalePricesEnabled(publicStoreSettings);
  }, [publicStoreSettings]);
  const pricedCart = useMemo(() => cart.map((item) => ({ ...item, price: displayCartItemPrice(item) })), [cart]);
  const subtotal = pricedCart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const couponDiscount = couponValidation?.valid ? Math.max(0, Number(couponValidation.discount_amount || 0)) : 0;
  // A free-shipping coupon's discount IS the shipping fee. The totals are already right; this flag
  // exists so the summary can say "شحن مجاني" instead of showing a fee and an equal discount beside it.
  const couponFreeShipping = Boolean(couponValidation?.valid && couponValidation?.free_shipping);
  // "Pairs well with" — the same calculation the server charges. An older backend
  // publishes no bundle settings, so this stays 0 until the server can honour it.
  const bundleDiscount = useMemo(
    () => computeBundleDiscount(pricedCart, storefrontBundleConfig(publicStoreSettings).percent).amount,
    [pricedCart, publicStoreSettings]
  );
  const discount = couponDiscount + bundleDiscount;
  const deliveryFee = form.governorate ? shippingQuote.price : 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);
  // Until a governorate is quoted only the store-wide threshold is known; after it, the
  // quote carries the zone's effective one (0 = that zone never ships free). A
  // free-shipping coupon already waived the fee, so there is nothing to count towards.
  const storeFreeShippingThreshold = usePublicFreeShippingThreshold();
  const freeShippingThreshold = couponFreeShipping
    ? 0
    : form.governorate && shippingQuote.match_level
      ? shippingQuote.free_shipping_threshold
      : storeFreeShippingThreshold;
  // The restricted closing system: outside the COD governorates the customer transfers
  // the shipping fee now and pays the rest on delivery. A waived fee leaves nothing to
  // prepay, so cash on delivery comes back — the server resolves it the same way.
  const shippingFeeAdvance = shippingQuote.advance === "shipping_fee";
  // Free shipping (the threshold or a coupon) swaps the fee for the order confirmation fee,
  // which comes off the total collected on delivery.
  const shippingIsFree = couponFreeShipping || !(deliveryFee > 0);
  const confirmationFeeDue = shippingFeeAdvance && shippingIsFree && shippingQuote.cod_allowed === false && Number(shippingQuote.confirmation_fee) > 0;
  const shippingAdvanceAmount = confirmationFeeDue ? Math.min(Number(shippingQuote.confirmation_fee), total) : couponFreeShipping ? 0 : Math.min(deliveryFee, total);
  const codAvailable = shippingQuote.cod_allowed !== false || (shippingFeeAdvance && shippingAdvanceAmount <= 0 && shippingQuote.store_cod_allowed);
  const normalizedFormPaymentMethod = paymentMode === "cod"
    ? "cod"
    : paymentMode === "online"
      ? "card"
      : "shipping_confirmation";
  const isOnlineGatewayPayment = paymentMode === "online";
  const isShippingConfirmation = paymentMode === "electronic";
  const shippingProofRequired = isShippingConfirmation;
  const amountDueNow = normalizedFormPaymentMethod === "cod" ? 0 : shippingFeeAdvance ? shippingAdvanceAmount : total;
  const codGovernorateNames = useMemo(() => {
    const { governorates } = normalizeCodPolicy({ governorates: publicStoreSettings?.["orders.cod_governorates"] });
    const isArabic = String(checkoutLanguage || "").startsWith("ar");
    return governorates
      .map((id) => governorateOptions.find((option) => option.value === id))
      .filter(Boolean)
      .map((option) => (isArabic ? option.ar : option.en))
      .join(isArabic ? " و" : ", ");
  }, [publicStoreSettings, checkoutLanguage]);
  const couponCode = String(form.coupon || "").trim().toUpperCase();
  // The proof upload is validated on submit (with a message pointing at it), so it
  // does not grey the button out: a disabled button explains nothing.
  const submitDisabled = submitting || couponLoading || shippingQuote.loading;
  const shippingQuoted = shippingQuoteSettled({ governorate: form.governorate, quote: shippingQuote });
  const checkoutActionLabel = isOnlineGatewayPayment
    ? t("storefront.checkout.onePage.payNow")
    : t("storefront.checkout.onePage.completeOrder");
  const storefrontPaymentSettings = useMemo(() => normalizeStorefrontPaymentSettings(publicStoreSettings), [publicStoreSettings]);
  // Declared after storefrontPaymentSettings on purpose — a const referenced
  // above its declaration is a render-time TDZ crash, not a lint error.
  const onlinePaymentAvailable = Boolean(storefrontPaymentSettings.online?.enabled);
  const applePayAvailable = Boolean(storefrontPaymentSettings.online?.applePay);
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
  useEffect(() => {
    if (pricedCart.length) trackGa4BeginCheckout(pricedCart, { value: subtotal });
  }, [pricedCart, subtotal]);

  // One page now, so there is no "reached the payment step" moment to hang Meta's
  // InitiateCheckout on. It fires once the customer has identified themselves (a
  // name and a valid phone), which is when the event can carry matching data;
  // submit() sends it too if the customer got there without that happening first.
  const initiateCheckoutReady = Boolean(form.full_name.trim()) && isEgyptMobile(form.primary_phone);
  const sendMetaInitiateCheckout = () => {
    if (metaCheckoutSentRef.current || !pricedCart.length) return;
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
  };
  const sendMetaInitiateCheckoutRef = useRef(sendMetaInitiateCheckout);
  sendMetaInitiateCheckoutRef.current = sendMetaInitiateCheckout;
  useEffect(() => {
    if (!initiateCheckoutReady || metaCheckoutSentRef.current) return undefined;
    // Wait for typing to settle so the event carries the whole name, not its first letter.
    const timer = window.setTimeout(() => sendMetaInitiateCheckoutRef.current(), 1500);
    return () => window.clearTimeout(timer);
  }, [initiateCheckoutReady, form.full_name, form.primary_phone]);

  useEffect(() => {
    let cancelled = false;
    getPublicSettingsResponse()
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
    // The page used to be a three-step wizard that remembered its step; a stale
    // value left in this tab's session would otherwise linger forever.
    try { window.sessionStorage.removeItem(CHECKOUT_STEP_STORAGE_KEY); } catch { /* storage unavailable */ }
  }, []);

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
        if (!cancelled) {
          setShippingQuote(quote);
          // The product page promises the same day for the same governorate next time.
          if (quote.match_level) rememberGovernorate({ id: form.governorate_id || quote.governorate_id, name: form.governorate });
        }
      })
      .catch(() => {
        // Keeping the previous quote showed the last governorate's fee (or a "free" 0) for this
        // address, and submitting it only met the server's 409. Mark it failed so the shipping line
        // offers a retry and submit asks for a fresh quote first.
        if (!cancelled) setShippingQuote({ ...normalizeShippingQuote(), failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [form.governorate, form.city_area, form.governorate_id, form.city_id, form.area_id, form.city, form.area, form.district_id, form.zone_id, subtotal, shippingRequoteToken]);

  // The delivery day is quoted on the Cairo clock; after the cut-off or midnight it names the wrong
  // day. Quote again when it goes stale, as the product page's countdown does.
  useEffect(() => {
    if (!form.governorate || shippingQuote.loading) return undefined;
    const delay = deliveryQuoteRefreshDelayMs(shippingQuote.delivery_estimate);
    if (delay === null) return undefined;
    const timer = window.setTimeout(() => setShippingRequoteToken((token) => token + 1), delay);
    return () => window.clearTimeout(timer);
  }, [form.governorate, shippingQuote.loading, shippingQuote.delivery_estimate]);

  useEffect(() => {
    const phone = normalizeEgyptMobile(form.primary_phone);
    if (!isEgyptMobile(phone)) {
      setWhatsappCheck({ phone: "", exists: null, checking: false });
      return undefined;
    }
    if (whatsappAnswersRef.current.has(phone)) {
      setWhatsappCheck({ phone, exists: whatsappAnswersRef.current.get(phone), checking: false });
      return undefined;
    }
    setWhatsappCheck({ phone, exists: null, checking: true });
    const controller = new AbortController();
    // Waits for the customer to stop typing, so a pasted or corrected number is asked about once.
    const timer = window.setTimeout(() => {
      api.get(`/storefront/checkout/whatsapp-check?phone=${encodeURIComponent(phone)}`, { signal: controller.signal })
        .then((data) => {
          const exists = data?.exists === true ? true : data?.exists === false ? false : null;
          if (exists !== null) whatsappAnswersRef.current.set(phone, exists);
          setWhatsappCheck({ phone, exists, checking: false });
        })
        .catch(() => {
          if (!controller.signal.aborted) setWhatsappCheck({ phone, exists: null, checking: false });
        });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.primary_phone]);

  const setField = (key, value, options = {}) => {
    if (options.markDirty !== false) editedCheckoutFieldsRef.current.add(key);
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
    if (key === "coupon") {
      setCouponValidation(null);
      couponValidationKeyRef.current = "";
      // A code the shopper types is theirs to apply; the QR auto-apply stops following the field.
      autoApplyCouponRef.current = false;
    }
  };

  useEffect(() => {
    if (!couponValidation) return;
    const validationKey = `${couponCode}::${Math.max(0, subtotal - bundleDiscount + deliveryFee).toFixed(2)}`;
    if (couponValidationKeyRef.current !== validationKey) {
      setCouponValidation(null);
      couponValidationKeyRef.current = "";
    }
  }, [couponValidation, couponCode, subtotal, bundleDiscount, deliveryFee]);

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
        // Goods only — the server folds shipping in only for campaigns with applies_to_shipping.
        // The bundle discount comes off first, exactly as checkout applies it.
        orderTotal: Math.max(0, subtotal - bundleDiscount),
        shippingAmount: Math.max(0, deliveryFee),
        appliedDiscounts: { invoice: bundleDiscount },
        items: pricedCart.map((item) => ({ product_id: item.product_id, variant_id: item.variant_id, price: item.price, quantity: item.quantity })),
        source: "website",
        customerId: profile?.customer_id || profile?.id || null,
      });
      if (!response?.valid) {
        setCouponValidation(null);
        if (!silent) toast.error(couponErrorText(response?.reason || response?.message));
        return null;
      }
      setCouponValidation(response);
      couponValidationKeyRef.current = `${trimmedCode}::${Math.max(0, subtotal - bundleDiscount + deliveryFee).toFixed(2)}`;
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

  // Printed coupons carry a QR to /checkout?coupon=CODE. Remember the code (the cart is usually
  // still empty when the QR is scanned), prefill the field, and validate it once there is a cart.
  const urlCoupon = String(checkoutSearchParams.get("coupon") || "").trim().toUpperCase();
  const autoApplyCouponRef = useRef(false);
  const autoApplyCouponKeyRef = useRef("");
  useEffect(() => {
    if (!urlCoupon) return;
    try { window.sessionStorage.setItem(PENDING_COUPON_STORAGE_KEY, urlCoupon); } catch { /* storage unavailable */ }
  }, [urlCoupon]);
  useEffect(() => {
    if (form.coupon) return;
    let pending = urlCoupon;
    if (!pending) {
      try { pending = String(window.sessionStorage.getItem(PENDING_COUPON_STORAGE_KEY) || "").trim().toUpperCase(); } catch { pending = ""; }
    }
    if (!pending) return;
    autoApplyCouponRef.current = true;
    setForm((prev) => ({ ...prev, coupon: pending }));
  }, [urlCoupon, form.coupon]);
  useEffect(() => {
    // Waits for the governorate's quote: a free-shipping code checked while the fee is still 0 is
    // refused, and any code applied before the fee arrives is dropped when it does. Stays armed
    // until it applies, trying each cart/fee state once.
    const step = couponAutoApplyStep({
      armed: autoApplyCouponRef.current,
      code: form.coupon,
      subtotal,
      couponLoading,
      quoted: shippingQuoted,
      deliveryFee,
      lastKey: autoApplyCouponKeyRef.current,
    });
    if (!step.run) return;
    // Only the first refusal is said out loud; a retry after the cart or fee changed stays quiet.
    const silent = Boolean(autoApplyCouponKeyRef.current);
    autoApplyCouponKeyRef.current = step.key;
    applyCoupon({ silent }).then((result) => {
      if (result?.valid) {
        autoApplyCouponRef.current = false;
        try { window.sessionStorage.removeItem(PENDING_COUPON_STORAGE_KEY); } catch { /* ignore */ }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.coupon, subtotal, couponLoading, shippingQuoted, deliveryFee]);

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
    setForm((prev) => ({ ...prev, ...bostaCityPatch(bostaLocations.cities, value) }));
    setErrors((prev) => ({ ...prev, governorate: "", city_area: "" }));
  }, [bostaLocations.cities]);

  const setBostaZone = useCallback((value, options = {}) => {
    if (options.markDirty !== false) {
      editedCheckoutFieldsRef.current.add("city_area");
    }
    setForm((prev) => ({ ...prev, ...bostaZonePatch(bostaLocations.zones, value) }));
    setErrors((prev) => ({ ...prev, city_area: "" }));
  }, [bostaLocations.zones]);

  const setBostaDistrict = useCallback((value, options = {}) => {
    if (options.markDirty !== false) {
      editedCheckoutFieldsRef.current.add("city_area");
    }
    setForm((prev) => ({ ...prev, ...bostaDistrictPatch(bostaDistrictOptions, value, prev.city_area) }));
    setErrors((prev) => ({ ...prev, city_area: "" }));
  }, [bostaDistrictOptions]);

  // Fill the delivery fields from one of the customer's past addresses. The Bosta
  // governorate → zone → district ids cannot be set in one go (each list loads
  // after the previous choice), so this seeds the form and hands the cascade to
  // the three staged effects below. `force` is an explicit pick from the saved
  // addresses list: it replaces whatever is typed; the automatic restore never does.
  const restoreAddressCandidate = (address, { force = false, lookupKey = "" } = {}) => {
    if (!address) return;
    if (force) {
      CHECKOUT_PLACE_FIELDS.forEach((key) => editedCheckoutFieldsRef.current.delete(key));
    } else if (CHECKOUT_PLACE_FIELDS.some((key) => editedCheckoutFieldsRef.current.has(key))) {
      console.info("[checkout:last-address-restore-skipped]", { reason: "manual_edit_detected", lookupKey });
      return;
    }

    const token = latestAddressRestoreTokenRef.current + 1;
    latestAddressRestoreTokenRef.current = token;
    setLatestAddressApplied(false);
    setLatestAddressRestore({ token, candidate: address, status: "restoring", stage: "governorate" });
    console.info("[checkout:last-address-restore-start]", { token, lookupKey, force });

    const restoredValues = {
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
    const customerName = String(address.customer_name || "").trim();

    setForm((prev) => {
      const next = { ...prev };
      Object.entries(restoredValues).forEach(([key, value]) => {
        // A picked address replaces every place field, empty ones included, so
        // the floor of the previous address does not survive into this one.
        if (force || String(value || "").trim()) next[key] = value;
      });
      // The phone is what the customer just typed, so it is never overwritten;
      // the name only fills an empty box.
      if (customerName && !String(prev.full_name || "").trim()) next.full_name = customerName;
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
  };

  useEffect(() => {
    const cleanPhone = normalizeEgyptMobile(form.primary_phone);
    const validPhone = isEgyptMobile(cleanPhone);
    const email = String(profile.email || profile.customer_email || "").trim().toLowerCase();
    if (!validPhone && !email) return undefined;

    const lookupKey = validPhone ? `phone:${cleanPhone}` : `email:${email}`;
    const lookups = latestAddressLookupsRef.current;
    if (lookups.has(lookupKey)) return undefined;
    lookups.add(lookupKey);

    const params = new URLSearchParams();
    if (validPhone) params.set("phone", cleanPhone);
    if (email) params.set("email", email);

    let cancelled = false;
    let settled = false;
    // Saved addresses belong to a signed-in customer: the server answers a guest with none, so a
    // typed phone number can never pull up a stranger's name and home address.
    storefrontCustomerRequest(`/storefront/customers/latest-shipping-address?${params.toString()}`)
      .then((data) => {
        settled = true;
        if (cancelled) return;
        const address = data.address || null;
        const addresses = Array.isArray(data.addresses) && data.addresses.length ? data.addresses : address ? [address] : [];
        setSavedAddresses(addresses);
        setSelectedSavedAddress(addresses.length ? "0" : "");
        if (!address) {
          console.info("[checkout:last-address-restore-skipped]", { reason: "no_address_found", lookupKey });
          return;
        }
        console.info("[checkout:last-address-found]", {
          lookupKey,
          saved: addresses.length,
          hasBosta: Boolean(address.shipping_city_id || address.shipping_zone_id || address.shipping_district_id),
          hasTextAddress: Boolean(address.detailed_address || address.street_address),
        });
        restoreAddressCandidate(address, { lookupKey });
      })
      .catch((error) => {
        settled = true;
        if (cancelled) return;
        // Let a later render retry this number instead of remembering a failure.
        latestAddressLookupsRef.current.delete(lookupKey);
        console.error("[checkout:last-address-restore-failed]", { lookupKey, message: error?.message || error?.responseBody?.message || "Unknown error" });
      });

    return () => {
      cancelled = true;
      // An answer that never arrived must not block asking again for the same number.
      if (!settled) lookups.delete(lookupKey);
    };
  }, [form.primary_phone, profile.email, profile.customer_email]);

  // Bosta's city list is fetched once on mount. Until that request has answered there is
  // nothing to select, so the device restore below waits for it rather than replaying an
  // id into an empty picker — which the staged cascade would read as "not ready" and drop.
  useEffect(() => {
    if (bostaLocations.loadingCities) bostaCitiesProbedRef.current = true;
  }, [bostaLocations.loadingCities]);

  // The address of the last order placed from this browser, filled in before the customer
  // types anything. It is never forced: a field they have already edited stays theirs, and
  // a signed-in customer's server-side saved address arrives through the same restore and
  // replaces this one, because nothing here counts as a manual edit.
  useEffect(() => {
    if (deviceAddressRestoredRef.current) return;
    const saved = deviceCheckoutDetails;
    if (!saved) return;
    const hasPlace = CHECKOUT_PLACE_FIELDS.some((key) => String(saved[key] || "").trim());
    if (!hasPlace) {
      deviceAddressRestoredRef.current = true;
      return;
    }
    // A signed-in customer's addresses come from the server and are the better source: they
    // follow them to any device. The device copy only fills the gap the server leaves a guest,
    // so it steps aside once those answer, and never interrupts a restore already in flight.
    if (savedAddresses.length) {
      deviceAddressRestoredRef.current = true;
      return;
    }
    if (latestAddressRestore.status === "restoring") return;
    // A Bosta address is only restorable once its governorate exists in the picker. A store
    // without Bosta (the request answered with no cities) restores the text address as it is.
    if (String(saved.shipping_city_id || "").trim() && !bostaCityOptions.length) {
      if (!bostaCitiesProbedRef.current || bostaLocations.loadingCities) return;
    }
    deviceAddressRestoredRef.current = true;
    restoreAddressCandidate(saved, { lookupKey: "device:last-order" });
  }, [bostaCityOptions, bostaLocations.loadingCities, deviceCheckoutDetails, latestAddressRestore.status, savedAddresses]);

  const chooseSavedAddress = (value) => {
    setSelectedSavedAddress(value);
    if (value === "new") {
      startNewAddress();
      return;
    }
    const address = savedAddresses[Number(value)];
    if (address) restoreAddressCandidate(address, { force: true, lookupKey: "saved-address" });
  };

  useEffect(() => {
    const candidate = latestAddressRestore.candidate;
    if (!candidate || latestAddressRestore.status !== "restoring" || latestAddressRestore.stage !== "governorate") return undefined;
    if (CHECKOUT_PLACE_FIELDS.some((key) => editedCheckoutFieldsRef.current.has(key))) {
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
  }, [bostaCityOptions, bostaLocations.loadingCities, latestAddressRestore, setBostaCity]);

  useEffect(() => {
    const candidate = latestAddressRestore.candidate;
    if (!candidate || latestAddressRestore.status !== "restoring" || latestAddressRestore.stage !== "zone") return undefined;
    if (CHECKOUT_PLACE_FIELDS.some((key) => editedCheckoutFieldsRef.current.has(key))) {
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
  }, [bostaLocations.loadingZones, bostaZoneOptions, latestAddressRestore, setBostaZone]);

  useEffect(() => {
    const candidate = latestAddressRestore.candidate;
    if (!candidate || latestAddressRestore.status !== "restoring" || latestAddressRestore.stage !== "district") return undefined;
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
  }, [bostaDistrictOptions, bostaLocations.loadingDistricts, latestAddressRestore, setBostaDistrict]);

  const startNewAddress = useCallback(() => {
    console.info("[checkout:last-address-restore-skipped]", { reason: "user_requested_new_address" });
    latestAddressRestoreTokenRef.current += 1;
    latestAddressLookupsRef.current.clear();
    // They said this is not where the order goes, so the device stops offering it —
    // the next order they place writes the new one in its place.
    deviceAddressRestoredRef.current = true;
    clearLastCheckoutDetails();
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
    if (normalizedPaymentMethod === "cod" && !codAvailable) {
      // Cash on delivery is the pre-selected default. With the store's COD switched off, leaving it
      // selected only ended in a refused submit — move the shopper to a method that is accepted.
      const nextMode = fallbackPaymentMode({ paymentMode: "cod", codAvailable, onlineAvailable: onlinePaymentAvailable });
      if (nextMode === "online") {
        setPaymentMode("online");
        setForm((current) => ({ ...current, payment_method: "card" }));
      } else {
        setPaymentMode("electronic");
        setShowElectronicPaymentMethods(true);
        // Already kept on an enabled transfer method by the effect above.
        setForm((current) => ({ ...current, payment_method: shippingTransferMethod || "instapay" }));
      }
    } else if (normalizedPaymentMethod === "cod") {
      if (paymentMode !== "cod") setPaymentMode("cod");
      if (showElectronicPaymentMethods) setShowElectronicPaymentMethods(false);
    } else if (normalizedPaymentMethod === "card") {
      // The gateway can disappear between page load and checkout (keys pulled,
      // Paymob disabled), so never strand the customer on an option the server
      // will now reject — drop them back to cash on delivery.
      if (!onlinePaymentAvailable) {
        setPaymentMode("cod");
        setForm((current) => ({ ...current, payment_method: "cod" }));
      } else if (paymentMode !== "online") {
        setPaymentMode("online");
        if (showElectronicPaymentMethods) setShowElectronicPaymentMethods(false);
      }
    } else if (paymentMode !== "electronic") {
      setPaymentMode("electronic");
    }
    return undefined;
  }, [codAvailable, form.payment_method, onlinePaymentAvailable, paymentMode, setForm, shippingTransferMethod, showElectronicPaymentMethods]);

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

  // The free-text address line is optional on the one-page form when the courier
  // fields are filled: the street, building, floor and apartment already are the
  // address, so it is composed from them instead of making the customer type it twice.
  const composeDetailedAddress = () => form.detailed_address.trim() || [
    form.street_address.trim(),
    form.building_number.trim() ? `${sfText("storefront.checkout.buildingNumber")} ${form.building_number.trim()}` : "",
    form.floor_number.trim() ? `${sfText("storefront.checkout.floorNumber")} ${form.floor_number.trim()}` : "",
    form.apartment_number.trim() ? `${sfText("storefront.checkout.apartmentNumber")} ${form.apartment_number.trim()}` : "",
    form.landmark.trim(),
  ].filter(Boolean).join("، ");

  const validateStep = (step, options = {}) => {
    const { showToast = true } = options;
    const next = {};
    const stepKeys = step === 1
      ? ["full_name", "primary_phone", "secondary_phone", "email"]
      : step === 2
        ? ["governorate", "city_area", "detailed_address", "street_address", "building_number"]
        : ["payment_method", "shipping_payment_screenshot"];
    // Folded to 01XXXXXXXXX first: autofill writes "+20 …", people type dashes, an Arabic keyboard types Arabic-Indic digits.
    const phone = normalizeEgyptMobile(form.primary_phone);
    const composedAddress = [
      form.street_address || form.detailed_address,
      form.building_number ? `Building ${form.building_number}` : "",
      form.floor_number ? `Floor ${form.floor_number}` : "",
      form.apartment_number ? `Apartment ${form.apartment_number}` : "",
      form.landmark ? `Near ${form.landmark}` : "",
    ].filter(Boolean).join(", ");

    if (step === 1) {
      if (!form.full_name.trim()) next.full_name = sfText("storefront.validation.fullNameRequired");
      if (!form.primary_phone.trim()) next.primary_phone = sfText("storefront.validation.phoneRequired");
      else if (!isEgyptMobile(phone)) next.primary_phone = sfText("storefront.validation.invalidEgyptPhone");
      else if (whatsappCheck.exists === false && whatsappCheck.phone === phone) next.primary_phone = sfText("storefront.validation.notOnWhatsapp");
      const secondPhone = String(form.secondary_phone || "").trim();
      if (secondPhone && !isEgyptMobile(secondPhone)) next.secondary_phone = sfText("storefront.validation.invalidSecondaryPhone");
      if (form.email.trim() && !isValidSurveyEmail(form.email)) {
        next.email = sfText("storefront.validation.invalidEmailOptional");
      }
    }

    if (step === 2) {
      if (!form.governorate) next.governorate = sfText("storefront.validation.governorateRequired");
      if (bostaMode && (!form.shipping_city_id || !form.shipping_zone_id || !form.shipping_district_id)) next.city_area = sfText("storefront.validation.cityAreaRequired");
      else if (!form.city_area.trim()) next.city_area = manualCityArea ? sfText("storefront.validation.cityAreaManualRequired") : sfText("storefront.validation.cityAreaRequired");
      const addressLine = composeDetailedAddress();
      // With the courier fields in play the street is the missing piece, and it already
      // carries its own message; flagging the optional details line too would point at the wrong box.
      if (!addressLine) { if (!bostaMode || form.street_address.trim()) next.detailed_address = sfText("storefront.validation.addressRequired"); }
      else if (bostaMode && composedAddress.trim().length < 12 && addressLine.length < 12) next.detailed_address = sfText("storefront.validation.addressRequired");
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
      toast.error(sfText("storefront.toasts.completeRequiredData"));
      if (firstInvalidStep === 3 && shippingProofRequired && !shippingPaymentFile) toast.error(sfText("storefront.toasts.uploadTransferProof"));
      scrollToFirstCheckoutError();
    }
    return valid;
  };

  // Everything is on one page, so a failed submit takes the customer to the first
  // field that needs them (after React has painted the error under it).
  const scrollToFirstCheckoutError = () => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const target = document.querySelector(".sfc .sfc-field--error, .sfc .sfc-upload.has-error");
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.querySelector("input, textarea, select, button")?.focus({ preventScroll: true });
    });
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
    if (submitting || !validate()) {
      setSubmitting(false);
      return;
    }
    if (form.governorate && shippingQuote.failed) {
      // No fee was quoted for this address, so the total on screen is not one the server will take.
      // Ask again and let the shopper see the fee before placing the order.
      setShippingRequoteToken((token) => token + 1);
      toast.error(sfText("storefront.checkout.shippingQuoteFailed"));
      document.getElementById("sfc-shipping")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    // The wizard reported these as the customer passed each step; on one page
    // both moments collapse into the submit, in the order GA4 and Meta expect.
    sendMetaInitiateCheckout();
    if (!ga4ShippingSentRef.current) {
      ga4ShippingSentRef.current = true;
      trackGa4ShippingInfo(pricedCart, {
        value: total,
        coupon: couponValidation?.valid ? couponCode : "",
        shipping: deliveryFee,
        shipping_tier: shippingQuote.provider || shippingQuote.provider_id || "standard",
      });
    }
    try {
      const activeCouponCode = String(form.coupon || "").trim().toUpperCase();
      const currentCouponKey = `${activeCouponCode}::${Math.max(0, subtotal - bundleDiscount + deliveryFee).toFixed(2)}`;
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
      // `total` belongs to this render, which may predate the re-validation above (picking a
      // governorate clears the coupon). The server charges subtotal - bundle - coupon + fee, so
      // the order is priced from the validation actually being sent, the same way `total` is.
      const orderTotal = Math.max(0, subtotal - (couponDiscountToSend + bundleDiscount) + deliveryFee);
      // A transfer was made for the amount on screen. If the fresh discount changed it, sending
      // now would be rejected (paid must equal total) after the customer already paid the old
      // figure — stop here so they see the new amount, which is now rendered, and transfer that.
      // Under the restricted system only the shipping fee is transferred, and the
      // re-validated coupon can change that figure too (a free-shipping code waives it).
      const couponFreeShippingToSend = Boolean(activeCouponValidation?.valid && activeCouponValidation?.free_shipping);
      // Free shipping transfers the order confirmation fee instead — the same rule the server applies.
      const confirmationFeeToSend = (couponFreeShippingToSend || !(deliveryFee > 0)) && shippingQuote.cod_allowed === false
        ? Math.min(Number(shippingQuote.confirmation_fee) || 0, orderTotal)
        : 0;
      const transferAmountToSend = shippingFeeAdvance
        ? (confirmationFeeToSend > 0 ? confirmationFeeToSend : couponFreeShippingToSend ? 0 : Math.min(deliveryFee, orderTotal))
        : orderTotal;
      if (shippingFeeAdvance && paymentMode === "cod" && !codAvailable && transferAmountToSend > 0) {
        toast.error(sfText("storefront.checkout.codUnavailableForGovernorate"));
        setSubmitting(false);
        return;
      }
      if (isShippingConfirmation && Math.abs(transferAmountToSend - amountDueNow) >= 0.01) {
        toast.error(sfText("storefront.checkout.couponTotalChanged", "", { amount: money(transferAmountToSend) }));
        setSubmitting(false);
        return;
      }
      const cleanPhone = normalizeEgyptMobile(form.primary_phone);
      const paymentMethod = paymentMode === "cod"
        ? "cod"
        : isOnlineGatewayPayment
          ? "card"
          : (visibleTransferMethods.some((method) => method.id === shippingTransferMethod) ? shippingTransferMethod : (visibleTransferMethods[0]?.id || "instapay"));
      const shippingPaymentMethod = paymentMode === "cod" || isOnlineGatewayPayment ? "" : paymentMethod;
      // A gateway order carries no money yet — the webhook is what records the
      // payment, so claiming an amount here would be rejected by the server.
      const paidAmount = isOnlineGatewayPayment || normalizedFormPaymentMethod === "cod" ? 0 : transferAmountToSend;
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
        detailed_address: composeDetailedAddress(),
        payment_method: paymentMethod,
        payment_type: paymentMethod,
        primary_phone: cleanPhone,
        secondary_phone: form.secondary_phone.trim() ? normalizeEgyptMobile(form.secondary_phone) : "",
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
        remaining_amount: Math.max(0, orderTotal - paidAmount),
        shipping_address: shippingProviderAddress,
        shipping_provider_address: shippingProviderAddress,
        shipping_payment_method: shippingPaymentMethod,
        coupon_code: couponCodeToSend,
        coupon_discount_amount: couponDiscountToSend,
      };
      trackGa4PaymentInfo(pricedCart, {
        value: orderTotal,
        coupon: couponCodeToSend,
        payment_type: paymentMethod,
      });
      // The Meta cookies are set on the storefront origin, so they never reach
      // the API host on their own. The checkout carries them so the sale the
      // server reports can be tied to the ad click that produced it.
      const metaIdentity = captureMetaBrowserIdentity();
      const metaIdentityPayload = {
        fbp: metaIdentity.fbp || "",
        fbc: metaIdentity.fbc || "",
        external_id: metaIdentity.externalId || "",
        source_url: typeof window !== "undefined" ? window.location.href : "",
      };
      const requestBody = shippingPaymentFile
        ? (() => {
            const formData = new FormData();
            formData.append("checkout", JSON.stringify(checkoutPayload));
            formData.append("items", JSON.stringify(pricedCart));
            formData.append("delivery_fee", String(deliveryFee));
            formData.append("discount", "0");
            formData.append("meta_identity", JSON.stringify(metaIdentityPayload));
            if (paymentMode !== "cod") formData.append("shipping_payment_screenshot", shippingPaymentFile);
            return formData;
          })()
        : {
            checkout: checkoutPayload,
            items: pricedCart,
            delivery_fee: deliveryFee,
            discount: 0,
            meta_identity: metaIdentityPayload,
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
        // The server's estimate is quoted when the order is placed; the page's may predate the cut-off.
        delivery_estimate: data.delivery_estimate || shippingQuote.delivery_estimate || null,
      };
      // The order is committed from here on: a tracking error must never reach the catch below,
      // which reads as a failed checkout and invites a second, duplicate order.
      try {
        trackMetaPurchase({
          order: data.order,
          items: data.items || pricedCart,
          value: data.order?.total_amount ?? data.order?.total ?? orderTotal,
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
          value: data.order?.total_amount ?? data.order?.total ?? orderTotal,
        });
      } catch (trackingError) {
        if (import.meta.env.DEV) console.warn("[storefront-checkout] purchase tracking failed", trackingError);
      }
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
      // Everything this order was delivered to, kept on this device so the next checkout
      // is already filled in — the ids included, or the pickers would have nothing to select.
      writeLastCheckoutDetails(form, { primary_phone: cleanPhone, email: form.email.trim().toLowerCase() });
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
      // The order is already committed and its stock reserved, so the cart is
      // cleared either way — leaving it filled would let a customer who bounces
      // off the payment page place the same order twice.
      clearCart();
      if (isOnlineGatewayPayment) {
        if (data.payment?.checkout_url) {
          // Full page navigation, not react-router: the hosted page is on
          // Paymob's origin and Apple Pay only renders in a top-level document.
          window.location.assign(data.payment.checkout_url);
          return;
        }
        toast.error(sfText("storefront.checkout.online.sessionFailed"));
        navigate(`/shop/confirm/${encodeURIComponent(data.track_token || "")}`, { state: successPayload });
        return;
      }
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
      if (isStaleCartCheckoutError(error) && typeof repriceCart === "function") {
        // The cart was priced (or shipping quoted) from numbers the server no longer charges. Toasting the
        // refusal left the shopper resubmitting the same stale total forever; instead bring the lines to
        // today's prices, quote shipping again for that subtotal, and let them review and place it again.
        await repriceCart({ checkoutRetry: true });
        setShippingRequoteToken((token) => token + 1);
        toast.error(sfText("storefront.cart.repriceCheckoutRetry"));
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (isCartLineCheckoutError(error) && typeof repriceCart === "function") {
        // "Selected variant is unavailable" named no line. A re-price flags the one that cannot be
        // bought (or is over stock) and the notice at the top names it.
        await repriceCart();
        toast.error(sfText("storefront.cart.lineCheckoutRefused"));
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const backendMessage = error?.responseBody?.message || error?.message;
      const couponReason = error?.responseBody?.details?.coupon?.reason || error?.responseBody?.coupon?.reason || backendMessage;
      const field = String(error?.responseBody?.field || "").toLowerCase();
      if (Number(error?.status || error?.response?.status || 0) === 403 && field === "payment_method" && String(error?.responseBody?.details?.payment_method || "").toLowerCase() === "cod") {
        // The store switched cash on delivery off after this page quoted it. Hide it (the payment
        // effect moves the shopper to an accepted method) and point at the payment section.
        setShippingQuote((prev) => ({ ...prev, cod_allowed: false }));
        toast.error(sfText("storefront.checkout.codUnavailableChooseAnother"));
        document.getElementById("sfc-payment")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const reason = String(error?.responseBody?.details?.reason || "");
      if (reason === "not_on_whatsapp" || reason === "invalid_secondary_phone") {
        // The submit's own check disagreed with (or ran before) the live field check: say it on
        // the field and take the customer there, in their language.
        const message = sfText(reason === "not_on_whatsapp" ? "storefront.validation.notOnWhatsapp" : "storefront.validation.invalidSecondaryPhone");
        if (reason === "not_on_whatsapp") {
          const phone = normalizeEgyptMobile(form.primary_phone);
          whatsappAnswersRef.current.set(phone, false);
          setWhatsappCheck({ phone, exists: false, checking: false });
        }
        setErrors((prev) => ({ ...prev, [reason === "not_on_whatsapp" ? "primary_phone" : "secondary_phone"]: message }));
        toast.error(message);
        scrollToFirstCheckoutError();
        return;
      }
      // The server's message is English staff text; the field and status pick the shopper's copy.
      const checkoutCopy = storefrontCheckoutErrorCopy(error);
      toast.error(field === "coupon_code" ? couponErrorText(couponReason) : sfText(checkoutCopy.key, undefined, checkoutCopy.options));
    } finally {
      setSubmitting(false);
    }
  };

  const onePage = (key, options) => t(`storefront.checkout.onePage.${key}`, options);

  if (!cart.length) {
    return (
      <section className="sfc" data-theme={themeMode}>
        <div className="sfx-wrap sfx-wrap--sm sfx-section">
          <div className="sfx-empty">
            <span className="sfx-empty__icon" aria-hidden="true"><ShoppingBag /></span>
            <h1 className="sfx-empty__title">{sfText("storefront.checkout.emptyCartTitle")}</h1>
            <p className="sfx-empty__text">{sfText("storefront.checkout.emptyCartText")}</p>
            <Link to="/products" className="sfx-btn sfx-btn--primary sfx-btn--lg">{t("storefront.common.continueShopping")}</Link>
          </div>
        </div>
      </section>
    );
  }

  const removeCoupon = () => {
    setForm((current) => ({ ...current, coupon: "" }));
    setCouponValidation(null);
    couponValidationKeyRef.current = "";
  };
  const couponBox = (
    <>
      <div className="sfc-coupon">
        <CheckoutInput
          label={onePage("discountCode")}
          name="coupon"
          value={form.coupon}
          onChange={(value) => setField("coupon", value)}
          autoComplete="off"
          onEnter={() => applyCoupon()}
        />
        {couponValidation?.valid ? (
          <button type="button" className="sfc-btn-secondary" onClick={removeCoupon}>{onePage("remove")}</button>
        ) : (
          <button type="button" className="sfc-btn-secondary" onClick={() => applyCoupon()} disabled={couponLoading || !couponCode}>
            {couponLoading ? <span className="sfc-spinner" aria-hidden="true" /> : null}
            {onePage("apply")}
          </button>
        )}
      </div>
      {couponValidation?.valid ? (
        <p className="sfc-coupon-state sfc-coupon-state--ok">
          {couponFreeShipping
            ? sfText("storefront.checkout.couponFreeShippingSummary", undefined, { code: couponValidation?.coupon?.code || couponCode })
            : sfText("storefront.checkout.couponAppliedSummary", undefined, { code: couponValidation?.coupon?.code || couponCode, discount: money(couponDiscount) })}
        </p>
      ) : couponCode ? (
        <p className="sfc-coupon-state sfc-coupon-state--pending">{sfText("storefront.checkout.couponNeedsApply")}</p>
      ) : null}
    </>
  );

  const selectOnlinePayment = () => {
    setPaymentMode("online");
    setShowElectronicPaymentMethods(false);
    // A gateway order never carries a transfer screenshot; a stale one left here
    // would be uploaded alongside it.
    setShippingPaymentFile(null);
    setPaymentProofUploaded(false);
    setForm((current) => ({ ...current, payment_method: "card" }));
  };
  const selectCodPayment = () => {
    setPaymentMode("cod");
    setShowElectronicPaymentMethods(false);
    setShippingPaymentFile(null);
    setPaymentProofUploaded(false);
    setForm((current) => ({ ...current, payment_method: "cod" }));
  };
  const selectTransferPayment = () => {
    setPaymentMode("electronic");
    setShowElectronicPaymentMethods(true);
    setForm((current) => ({ ...current, payment_method: visibleTransferMethods[0]?.id || shippingTransferMethod || "instapay" }));
    setShippingTransferMethod((current) => (visibleTransferMethods.some((method) => method.id === current) ? current : (visibleTransferMethods[0]?.id || "instapay")));
  };

  // A real day ("متوقع وصول طلبك الثلاثاء 15 سبتمبر") once the quote carries one;
  // the zone's own wording, then the generic notice, when it does not.
  const deliveryEstimate = deliveryEstimateText(t, shippingQuote.delivery_estimate, i18n.language)
    || shippingQuote.estimated_delivery_text
    || sfText("storefront.checkout.expectedDeliveryNotice");
  const savedAddressLabel = (address = {}) => [
    address.street_address || address.detailed_address,
    address.building_number ? `${sfText("storefront.checkout.buildingNumber")} ${address.building_number}` : "",
    address.city_area,
    address.governorate,
  ].map((part) => String(part || "").trim()).filter(Boolean).join("، ");
  const locationSelectCopy = {
    emptyText: sfText("storefront.common.noResults"),
    closeLabel: sfText("storefront.common.close"),
  };

  return (
    <section className="sfc" data-theme={themeMode}>
      <form id="storefront-checkout-form" noValidate onSubmit={submit} className="sfc-grid">
        <div className="sfc-main">
          <header className="sfx-page-head">
            <div className="sfx-page-head__text">
              <h1 className="sfx-title">{t("storefront.checkout.title")}</h1>
            </div>
          </header>
          <CartRepriceNotice notice={cartRepriceNotice} money={money} onDismiss={dismissCartRepriceNotice} />
          <CheckoutBlock id="sfc-contact" title={onePage("contact")}>
            <div className="sfc-stack">
              <CheckoutInput
                label={sfText("storefront.form.primaryPhone")}
                name="primary_phone"
                value={form.primary_phone}
                onChange={(value) => setField("primary_phone", value)}
                inputMode="tel"
                type="tel"
                autoComplete="tel"
                maxLength={16}
                required
                error={errors.primary_phone || (whatsappCheck.exists === false && whatsappCheck.phone === normalizeEgyptMobile(form.primary_phone) ? sfText("storefront.validation.notOnWhatsapp") : "")}
                hint={whatsappCheck.checking
                  ? onePage("phoneCheckingWhatsapp")
                  : whatsappCheck.exists === true ? `✓ ${onePage("phoneOnWhatsapp")}` : onePage("phoneHint")}
              />
              <div className="sfc-row sfc-row--2">
                <CheckoutInput
                  label={onePage("email")}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(value) => setField("email", value)}
                  error={errors.email}
                />
                <CheckoutInput
                  label={onePage("secondaryPhone")}
                  name="secondary_phone"
                  value={form.secondary_phone}
                  onChange={(value) => setField("secondary_phone", value)}
                  inputMode="tel"
                  type="tel"
                  autoComplete="off"
                  maxLength={16}
                  error={errors.secondary_phone}
                  hint={onePage("secondaryPhoneHint")}
                />
              </div>
            </div>
          </CheckoutBlock>

          <CheckoutBlock id="sfc-delivery" title={onePage("delivery")} note={onePage("deliveryNote")}>
            {savedAddresses.length > 1 ? (
              <div style={{ marginBottom: 12 }}>
                <CheckoutNativeSelect
                  label={onePage("savedAddresses")}
                  name="saved_address"
                  value={selectedSavedAddress}
                  onChange={chooseSavedAddress}
                  options={[
                    ...savedAddresses.map((address, index) => ({ value: String(index), label: savedAddressLabel(address) })),
                    { value: "new", label: onePage("newAddress") },
                  ]}
                />
              </div>
            ) : latestAddressApplied ? (
              <div className="sfc-notice">
                <span>{sfText("storefront.checkout.latestAddressApplied")}</span>
                <button type="button" className="sfc-link" onClick={startNewAddress}>{sfText("storefront.checkout.useNewAddress")}</button>
              </div>
            ) : null}
            <div className="sfc-stack">
              <CheckoutInput
                label={sfText("storefront.form.fullName")}
                name="full_name"
                autoComplete="name"
                value={form.full_name}
                onChange={(value) => setField("full_name", value)}
                required
                error={errors.full_name}
              />
              {bostaMode ? (
                <div className="sfc-row sfc-row--location">
                  <CheckoutLocationSelect
                    {...locationSelectCopy}
                    label={sfText("storefront.checkout.governorate")}
                    name="governorate"
                    value={form.shipping_city_id || ""}
                    onChange={setBostaCity}
                    options={bostaCityOptions}
                    loading={bostaLocations.loadingCities}
                    error={errors.governorate}
                    placeholder={sfText("storefront.checkout.governorate")}
                    searchPlaceholder={sfText("storefront.checkout.searchGovernoratePlaceholder")}
                    loadingText={sfText("storefront.checkout.loadingGovernorates")}
                  />
                  <CheckoutLocationSelect
                    {...locationSelectCopy}
                    label={onePage("zone")}
                    name="city_area"
                    value={form.shipping_zone_id || ""}
                    onChange={setBostaZone}
                    options={bostaZoneOptions}
                    loading={bostaLocations.loadingZones}
                    disabled={!form.shipping_city_id}
                    error={!form.shipping_zone_id && errors.city_area ? errors.city_area : ""}
                    placeholder={onePage("zone")}
                    searchPlaceholder={sfText("storefront.checkout.searchAreaPlaceholder")}
                    loadingText={sfText("storefront.checkout.loadingZones")}
                  />
                  <CheckoutLocationSelect
                    {...locationSelectCopy}
                    label={onePage("district")}
                    name="district"
                    value={form.shipping_district_id || ""}
                    onChange={setBostaDistrict}
                    options={bostaDistrictOptions}
                    loading={bostaLocations.loadingDistricts}
                    disabled={!form.shipping_zone_id}
                    error={form.shipping_zone_id && !form.shipping_district_id ? errors.city_area : ""}
                    placeholder={onePage("district")}
                    searchPlaceholder={sfText("storefront.checkout.searchDistrictPlaceholder")}
                    loadingText={sfText("storefront.checkout.loadingDistricts")}
                  />
                </div>
              ) : locationGovernorates.length ? (
                <div className="sfc-row sfc-row--3">
                  <CheckoutNativeSelect
                    label={sfText("storefront.checkout.governorate")}
                    name="governorate"
                    value={form.governorate_id || ""}
                    onChange={setGovernorate}
                    error={errors.governorate}
                    options={[{ value: "", label: sfText("storefront.common.choose") }, ...locationGovernorates.map((item) => ({ value: item.governorate_id, label: checkoutLocationName(item, i18n.language, "governorate") }))]}
                  />
                  <CheckoutNativeSelect
                    label={sfText("storefront.checkout.city")}
                    name="city_area"
                    value={form.city_id || ""}
                    onChange={setCityArea}
                    error={!form.city_id && errors.city_area ? errors.city_area : ""}
                    options={[{ value: "", label: sfText("storefront.common.choose") }, ...locationCities.map((item) => ({ value: item.city_id, label: checkoutLocationName(item, i18n.language, "city") }))]}
                  />
                  <CheckoutNativeSelect
                    label={sfText("storefront.checkout.area")}
                    name="area"
                    value={form.area_id || ""}
                    onChange={setCityArea}
                    error={form.city_id ? errors.city_area : ""}
                    options={[{ value: "", label: sfText("storefront.common.choose") }, ...locationAreas.map((item) => ({ value: item.area_id, label: checkoutLocationName(item, i18n.language, "area") }))]}
                  />
                </div>
              ) : (
                <div className="sfc-row sfc-row--2">
                  <CheckoutNativeSelect
                    label={sfText("storefront.checkout.governorate")}
                    name="governorate"
                    value={form.governorate || ""}
                    onChange={setGovernorate}
                    error={errors.governorate}
                    options={[{ value: "", label: sfText("storefront.common.choose") }, ...governorates.map((name) => ({ value: name, label: name }))]}
                  />
                  {manualCityArea ? (
                    <CheckoutInput
                      label={sfText("storefront.checkout.cityArea")}
                      name="city_area"
                      value={form.city_area}
                      onChange={(value) => setField("city_area", value)}
                      error={errors.city_area}
                    />
                  ) : (
                    <CheckoutNativeSelect
                      label={sfText("storefront.checkout.cityArea")}
                      name="city_area"
                      value={form.city_area || ""}
                      onChange={setCityArea}
                      error={errors.city_area}
                      options={[
                        { value: "", label: form.governorate ? sfText("storefront.common.choose") : sfText("storefront.checkout.chooseGovernorateFirst") },
                        ...cityAreaOptions.map((name) => ({ value: name, label: name })),
                        { value: MANUAL_CITY_AREA_LABEL, label: sfText("storefront.checkout.manualSelection") },
                      ]}
                    />
                  )}
                </div>
              )}
              <div className="sfc-row sfc-row--2">
                <CheckoutInput
                  label={sfText("storefront.checkout.streetAddress")}
                  name="street_address"
                  autoComplete="address-line1"
                  value={form.street_address}
                  onChange={(value) => setField("street_address", value)}
                  required={bostaMode}
                  error={errors.street_address}
                />
                <CheckoutInput
                  label={sfText("storefront.checkout.buildingNumber")}
                  name="building_number"
                  value={form.building_number}
                  onChange={(value) => setField("building_number", value)}
                  required={bostaMode}
                  error={errors.building_number}
                />
              </div>
              <div className="sfc-row sfc-row--2">
                <CheckoutInput
                  label={onePage("floorOptional")}
                  name="floor_number"
                  value={form.floor_number}
                  onChange={(value) => setField("floor_number", value)}
                />
                <CheckoutInput
                  label={onePage("apartmentOptional")}
                  name="apartment_number"
                  value={form.apartment_number}
                  onChange={(value) => setField("apartment_number", value)}
                />
              </div>
              <CheckoutInput
                label={bostaMode ? onePage("addressDetails") : sfText("storefront.checkout.fullAddress")}
                name="detailed_address"
                autoComplete="address-line2"
                value={form.detailed_address}
                onChange={(value) => setField("detailed_address", value)}
                error={errors.detailed_address}
                hint={bostaMode ? onePage("addressDetailsHint") : ""}
              />
              <CheckoutInput
                label={onePage("landmarkOptional")}
                name="landmark"
                value={form.landmark}
                onChange={(value) => setField("landmark", value)}
              />
            </div>
            <details className="sfc-details" open={Boolean(form.delivery_notes || form.order_notes) || undefined}>
              <summary>{onePage("addNotes")}</summary>
              <div className="sfc-stack">
                <CheckoutInput multiline label={sfText("storefront.checkout.deliveryNotes")} name="delivery_notes" value={form.delivery_notes} onChange={(value) => setField("delivery_notes", value)} />
                <CheckoutInput multiline label={sfText("storefront.checkout.orderNotes")} name="order_notes" value={form.order_notes} onChange={(value) => setField("order_notes", value)} />
              </div>
            </details>
          </CheckoutBlock>

          <CheckoutBlock id="sfc-shipping" title={onePage("shippingMethod")}>
            {form.governorate ? (
              <div className="sfc-choices">
                <CheckoutChoice
                  static
                  active
                  title={onePage("homeDelivery")}
                  subtitle={deliveryEstimate}
                  meta={(
                    <span className="sfc-choice__meta">
                      {shippingQuote.loading
                        ? <Loader2 size={16} className="animate-spin" aria-label={t("common.loading")} />
                        : shippingQuote.failed
                          ? (
                            <button type="button" className="sfc-link" onClick={() => setShippingRequoteToken((token) => token + 1)}>
                              {sfText("storefront.checkout.shippingQuoteRetry")}
                            </button>
                          )
                          : couponFreeShipping || deliveryFee <= 0
                            ? sfText("storefront.checkout.freeShipping")
                            : money(deliveryFee)}
                    </span>
                  )}
                />
              </div>
            ) : (
              <div className="sfc-pane">{onePage("shippingMethodPending")}</div>
            )}
          </CheckoutBlock>

          <CheckoutBlock id="sfc-payment" title={onePage("payment")} note={onePage("paymentNote")}>
            <div className="sfc-choices" role="radiogroup" aria-label={onePage("payment")}>
              {onlinePaymentAvailable ? (
                <CheckoutChoice
                  active={paymentMode === "online"}
                  onSelect={selectOnlinePayment}
                  title={sfText("storefront.checkout.payment.online.title")}
                  meta={(
                    <span className="sfc-choice__logos" aria-hidden="true">
                      <SiVisa size={28} />
                      <SiMastercard size={22} />
                      {applePayAvailable ? <SiApplepay size={32} /> : null}
                    </span>
                  )}
                >
                  <p>{applePayAvailable ? sfText("storefront.checkout.payment.online.textWithApplePay") : sfText("storefront.checkout.payment.online.text")}</p>
                  <p>{sfText("storefront.checkout.online.redirectHelper")}</p>
                  {applePayAvailable ? <p>{sfText("storefront.checkout.online.applePayNote")}</p> : null}
                </CheckoutChoice>
              ) : null}
              {codAvailable ? (
                <CheckoutChoice active={paymentMode === "cod"} onSelect={selectCodPayment} title={sfText("storefront.checkout.payment.cod.title")}>
                  <p>{sfText("storefront.checkout.payment.cod.text")}</p>
                </CheckoutChoice>
              ) : shippingFeeAdvance ? (
                <p className="sfc-pane">
                  {confirmationFeeDue
                    ? sfText("storefront.checkout.codOnlyConfirmationFee", "", { governorates: codGovernorateNames, amount: money(shippingAdvanceAmount), rest: money(Math.max(0, total - shippingAdvanceAmount)) })
                    : sfText("storefront.checkout.codOnlyForGovernorates", "", { governorates: codGovernorateNames })}
                </p>
              ) : null}
              <CheckoutChoice
                active={paymentMode === "electronic"}
                onSelect={selectTransferPayment}
                title={sfText("storefront.checkout.shippingConfirmationTitle")}
                subtitle={paymentMode === "electronic" ? "" : sfText("storefront.checkout.payment.shippingConfirmation.text")}
              >
                <p>{sfText("storefront.checkout.payment.shippingConfirmation.text")}</p>
                {showElectronicPaymentMethods && isShippingConfirmation ? (
                  <>
                    {storefrontPaymentSettings.shippingConfirmation.enabled ? (
                      <div className="sfc-amount">
                        <span className="sfc-amount__label">{storefrontPaymentSettings.shippingConfirmation.label || sfText("storefront.checkout.transfer.amountDueNow")}</span>
                        <span className="sfc-amount__value">{money(amountDueNow)}</span>
                      </div>
                    ) : null}
                    {visibleTransferMethods.length ? (
                      <div className="sfc-methods" role="radiogroup">
                        {visibleTransferMethods.map((method) => {
                          const active = shippingTransferMethod === method.id;
                          return (
                            <button
                              key={method.id}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              className={`sfc-method${active ? " is-active" : ""}`}
                              onClick={() => {
                                setShippingTransferMethod(method.id);
                                setForm((current) => ({ ...current, payment_method: method.id }));
                              }}
                            >
                              <PaymentBrandLogo method={method.id} size="copy" active={active} label={method.label} logoUrl={method.logoUrl} />
                              <span style={{ minWidth: 0 }}>
                                <span className="sfc-method__title">{method.label}</span>
                                <span className="sfc-method__sub">
                                  {method.helperText || (method.id === "instapay"
                                    ? sfText("storefront.checkout.transfer.instantBankTransfer")
                                    : sfText("storefront.checkout.transfer.vodafoneWallet"))}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {activeTransferMethod?.id === "instapay" && activeTransferPaymentUrl ? (
                      <div className="sfc-stack">
                        <button type="button" className="sfc-btn-secondary" onClick={() => window.open(activeTransferPaymentUrl, "_blank", "noopener,noreferrer")}>
                          {sfText("storefront.checkout.transfer.openInstapayLink")}
                        </button>
                        <p>{sfText("storefront.checkout.transfer.instantPayHelper")}</p>
                      </div>
                    ) : activeTransferMethod ? (
                      <div className="sfc-copy">
                        <div className="sfc-copy__value" dir="ltr">{activeTransferValue}</div>
                        <button
                          type="button"
                          className="sfc-btn-secondary sfc-btn-secondary--sm"
                          onClick={async () => {
                            await navigator.clipboard?.writeText(activeTransferValue);
                            toast.success(sfText("storefront.toasts.copied"));
                          }}
                        >
                          {sfText("storefront.checkout.transfer.copyShort")}
                        </button>
                      </div>
                    ) : (
                      <p>{sfText("storefront.checkout.transfer.noPaymentMethod")}</p>
                    )}
                    <label
                      className={`sfc-upload${shippingPaymentFile ? " has-file" : ""}${errors.shipping_payment_screenshot ? " has-error" : ""}${paymentProofDragActive ? " is-drag" : ""}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setPaymentProofDragActive(true);
                      }}
                      onDragLeave={() => setPaymentProofDragActive(false)}
                      onDrop={handlePaymentProofDrop}
                    >
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handlePaymentProofChange(event.target.files?.[0])} className="sr-only" />
                      <span className="sfc-upload__icon">{paymentProofUploaded ? <Check size={20} /> : <Upload size={20} />}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="sfc-upload__title">{shippingPaymentFile ? sfText("storefront.checkout.transfer.proofUploaded") : sfText("storefront.checkout.transfer.uploadPrompt")}</span>
                        <span className="sfc-upload__sub">{sfText("storefront.checkout.transfer.acceptedFormats")}</span>
                      </span>
                    </label>
                    {shippingPaymentFile ? (
                      <div className="sfc-file">
                        <span className="sfc-file__name">{shippingPaymentFile.name}</span>
                        <button type="button" className="sfc-link" onClick={removePaymentProof}>{sfText("storefront.checkout.transfer.removeProof")}</button>
                      </div>
                    ) : null}
                    {errors.shipping_payment_screenshot ? <span className="sfc-error" role="alert">{errors.shipping_payment_screenshot}</span> : null}
                  </>
                ) : null}
              </CheckoutChoice>
            </div>
          </CheckoutBlock>

          <div className="sfc-mobile-totals">
            {couponBox}
            <CheckoutTotals
              subtotal={subtotal}
              discount={discount}
              bundleDiscount={bundleDiscount}
              freeShipping={couponFreeShipping}
              deliveryFee={deliveryFee}
              total={total}
              governorate={form.governorate}
              shippingQuote={shippingQuote}
              freeShippingThreshold={freeShippingThreshold}
              money={money}
            />
          </div>

          <div className="sfc-submit">
            <CheckoutSubmit
              submitting={submitting}
              disabled={submitDisabled}
              label={checkoutActionLabel}
              busyLabel={sfText("storefront.checkout.actions.confirming")}
            />
            <div className="sfc-trust">
              <span><ShieldCheck size={15} aria-hidden="true" />{sfText("storefront.checkout.trust.safeData")}</span>
              <span><Truck size={15} aria-hidden="true" />{sfText("storefront.checkout.trust.fastShipping")}</span>
              <span><PackageCheck size={15} aria-hidden="true" />{sfText("storefront.checkout.trust.exchange")}</span>
            </div>
          </div>

          <nav className="sfc-legal" aria-label={onePage("policies")}>
            <Link to="/privacy">{onePage("privacy")}</Link>
            <Link to="/terms">{onePage("terms")}</Link>
          </nav>
        </div>

        <aside className="sfc-side" aria-label={sfText("storefront.checkout.orderSummary")}>
          <StorefrontCheckoutSummary
            cart={pricedCart}
            subtotal={subtotal}
            discount={discount}
            bundleDiscount={bundleDiscount}
            freeShipping={couponFreeShipping}
            deliveryFee={deliveryFee}
            total={total}
            governorate={form.governorate}
            shippingQuote={shippingQuote}
            freeShippingThreshold={freeShippingThreshold}
            open={summaryOpen}
            setOpen={setSummaryOpen}
            helpers={checkoutSummaryHelpers}
            couponSlot={<div className="sfc-coupon-desktop">{couponBox}</div>}
          />
        </aside>
      </form>
    </section>
  );
}

function OrderSuccess({ profile, brandName = "MONE", brandLogoUrl = "", whatsappHref = "" }) {
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
  const whatsAppHref = hasWhatsAppRecipient(whatsappHref)
    ? withWhatsAppText(whatsappHref, t("storefront.support.orderHelpMessage", { orderNumber: publicNumber }))
    : "";

  // One design with the rest of the shop: sfx-* primitives painted from the
  // --m1h-* tokens, so the page reads the same in light and dark and follows
  // Site Studio. The legacy `sf-storefront-card` / `sf-info-box` hooks are gone
  // on purpose: index.css repaints them with layered !important rules.
  const successRows = [
    { key: "number", label: t("storefront.orders.orderNumber"), value: <OrderNumberBadge value={publicNumber} /> },
    { key: "customer", label: t("storefront.customer.customer"), value: customerName },
    { key: "total", label: t("storefront.checkout.total"), value: total ? money(total) : t("storefront.success.orderRecorded") },
    { key: "payment", label: t("storefront.checkout.paymentMethod"), value: paymentLabel },
    { key: "status", label: t("storefront.orders.orderStatus"), value: successStatus },
    { key: "delivery", label: t("storefront.orders.expectedDelivery"), value: deliveryEstimateDays(loaded?.delivery_estimate, i18n.language) || t("storefront.orders.expectedDeliveryWindow") },
    { key: "address", label: t("storefront.checkout.deliveryAddress"), value: address || t("storefront.orders.addressSaved") },
  ];

  return (
    <section className="sfx-success-page sfx-wrap sfx-wrap--md sfx-section relative">
      {confetti ? <Confetti /> : null}
      <header className="grid justify-items-center gap-2 text-center">
        <span
          className="grid h-20 w-20 animate-[success-pop_650ms_ease-out] place-items-center rounded-full"
          style={{ background: "var(--sfx-success-soft)", color: "var(--sfx-success)" }}
        >
          <Check className="h-10 w-10" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="sfx-title mt-3" style={{ textAlign: "center" }}>{successTitle}</h1>
        <p className="sfx-subtitle" style={{ marginTop: 0 }}>{t("storefront.success.thanks")}</p>
        <p className="sfx-subtitle" style={{ marginTop: 0 }}>{successSubtitle}</p>
        <span className="sfx-badge sfx-badge--accent mt-2" style={{ whiteSpace: "normal" }}>{message}</span>
      </header>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-4">
          <div className="sfx-surface">
            <dl className="sfx-summary">
              {successRows.map((row) => (
                <div key={row.key} className="sfx-summary__row">
                  <dt>{row.label}</dt>
                  <dd className="m-0 min-w-0 break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="sfx-surface">
            <h2 className="sfx-h2">{t("storefront.orders.tracking")}</h2>
            <SuccessTimeline />
          </div>
          <Suspense fallback={<div className="sfx-surface sfx-muted">{sfText("storefront.orders.itemsLoading")}</div>}>
            <OrderInvoiceCard className="sf-order-invoice-card" order={{ ...brandedOrder, source: "Website" }} items={items} />
          </Suspense>
        </div>
        <aside className="sfx-surface h-max lg:sticky lg:top-24">
          <div className="grid gap-2">
            <Link to={`/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="sfx-btn sfx-btn--primary sfx-btn--lg sfx-btn--block">{t("storefront.orders.trackOrder")}</Link>
            <Link to="/products" className="sfx-btn sfx-btn--secondary sfx-btn--lg sfx-btn--block">{t("storefront.common.continueShopping")}</Link>
            {whatsAppHref ? (
              <a href={whatsAppHref} target="_blank" rel="noopener noreferrer" className="sfx-btn sfx-btn--whatsapp sfx-btn--lg sfx-btn--block">
                <FaWhatsapp aria-hidden="true" />
                {t("storefront.support.whatsapp")}
              </a>
            ) : (
              <button type="button" disabled className="sfx-btn sfx-btn--secondary sfx-btn--lg sfx-btn--block">{t("storefront.support.whatsappUnavailable")}</button>
            )}
          </div>
          <p className="sfx-notice mt-4 mb-0">{t("storefront.success.reviewNotice")}</p>
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
    return sfText("storefront.shipping.bosta");
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
  return buildWhatsAppHref(text);
};


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
  const whatsappHref = quickActionLinks.whatsappHref || whatsappUrl || toWhatsAppHref(whatsappPhone);
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
      title: sfText("storefront.contact.phone"),
      icon: Phone,
      value: phoneNumber,
      href: phoneHref,
      cta: sfText("storefront.contact.call"),
      tone: "phone",
    },
    {
      id: "instagram",
      title: sfText("storefront.contact.instagram"),
      icon: BrandInstagramIcon,
      value: instagramUsername || instagramHref,
      href: instagramHref,
      cta: sfText("storefront.contact.visitPage"),
      tone: "instagram",
    },
    {
      id: "facebook",
      title: sfText("storefront.contact.facebook"),
      icon: BrandFacebookIcon,
      value: facebookPage || facebookHref,
      href: facebookHref,
      cta: sfText("storefront.contact.visitPage"),
      tone: "facebook",
    },
    {
      id: "address",
      title: sfText("storefront.contact.address"),
      icon: MapPin,
      value: addressDisplay,
      href: mapHref,
      cta: sfText("storefront.contact.openMap"),
      tone: "map",
    },
    {
      id: "working_hours",
      title: sfText("storefront.contact.workingHours"),
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
    { icon: Footprints, label: sfText("storefront.contact.topics.size") },
    { icon: PackageSearch, label: sfText("storefront.contact.topics.track") },
    { icon: RefreshCcw, label: sfText("storefront.contact.topics.exchange") },
    { icon: PackageCheck, label: sfText("storefront.contact.topics.issue") },
  ];
  // The phone call is the one filled CTA; every other channel is a secondary
  // pill. Brand colours used to fill these (Instagram gradient, Facebook blue,
  // a gold map button) — one design means one button system.
  const actionButtonClass = (tone) => (tone === "phone" ? "sfx-btn--primary" : "sfx-btn--secondary");
  // The icon bubble: a panel-coloured disc with the accent ink, same on every card.
  const iconBubbleStyle = { background: "var(--sfx-panel)", color: "var(--m1h-accent)", borderRadius: "var(--m1h-r-md)" };
  const mutedTextStyle = { color: "var(--m1h-text-2)" };

  return (
    <section className="sfx-wrap sfx-wrap--sm pb-[calc(var(--mobile-bottom-nav-height,58px)+env(safe-area-inset-bottom)+1.5rem)] md:pb-12">
      <header className="sfx-page-head">
        <div className="sfx-page-head__text">
          <h1 className="sfx-title">{sfText("storefront.contact.title")}</h1>
          <p className="sfx-subtitle">{sfText("storefront.contact.subtitle")}</p>
        </div>
      </header>

      {whatsappHref ? (
        <div>
          <a
            href={whatsappHref}
            target={whatsappHref.startsWith("http") ? "_blank" : undefined}
            rel={whatsappHref.startsWith("http") ? "noreferrer" : undefined}
            className="sfx-btn sfx-btn--whatsapp sfx-btn--lg sfx-btn--block gap-2"
          >
            <FaWhatsapp className="h-5 w-5" aria-hidden="true" />
            {sfText("storefront.contact.chatOnWhatsapp")}
          </a>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {[
              [Clock3, sfText("storefront.contact.perks.fastReply")],
              [Footprints, sfText("storefront.contact.perks.sizeHelp")],
              [PackageSearch, sfText("storefront.contact.perks.trackOrders")],
              [RefreshCcw, sfText("storefront.contact.perks.exchange")],
            ].map(([Icon, label]) => (
              <span key={label} className="sfx-badge">
                <Icon className="h-3.5 w-3.5" style={{ color: "var(--m1h-accent)" }} aria-hidden="true" />
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 grid gap-3">
        {visibleContactRows.map((card) => {
          const Icon = card.icon;
          const hasLink = Boolean(card.href) && Boolean(card.cta);
          const valueText = String(card.value || "").trim();
          return (
            <article key={card.id} className="sfx-surface">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center" style={iconBubbleStyle}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="sfx-h3">{card.title}</h2>
                  {card.id === "working_hours" ? (
                    <div className="mt-2 grid gap-2">
                      {workingHoursLines.map((line, index) => (
                        <div key={`${card.id}-${index}`} className="sfx-notice whitespace-pre-line">
                          {localizeHoursLine(line, i18n.language)}
                        </div>
                      ))}
                    </div>
                  ) : card.id === "address" ? (
                    <p className="mt-1 mb-0 whitespace-pre-line break-words text-sm leading-7" style={mutedTextStyle}>{valueText}</p>
                  ) : card.id === "phone" && phoneHref ? (
                    <a href={phoneHref} className="mt-1 inline-flex break-words text-sm leading-7" style={mutedTextStyle} dir="ltr">
                      {valueText}
                    </a>
                  ) : (
                    <p className="mt-1 mb-0 break-words text-sm leading-7" style={mutedTextStyle}>{valueText}</p>
                  )}
                </div>
              </div>

              {hasLink ? (
                <div className="mt-4">
                  <a
                    href={card.href}
                    target={card.href.startsWith("http") ? "_blank" : undefined}
                    rel={card.href.startsWith("http") ? "noreferrer" : undefined}
                    className={`sfx-btn ${actionButtonClass(card.tone)} sfx-btn--block gap-2`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {card.cta}
                  </a>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <article className="sfx-surface mt-6">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center" style={iconBubbleStyle}>
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="sfx-h3">{sfText("storefront.contact.howCanWeHelp")}</h2>
            <p className="mt-1 mb-0 text-sm leading-7" style={mutedTextStyle}>{sfText("storefront.contact.howCanWeHelpText")}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {helpItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="sfx-surface sfx-surface--soft text-center">
                <div className="mx-auto grid h-11 w-11 place-items-center rounded-full" style={{ background: "var(--m1h-surface)", color: "var(--m1h-accent)" }}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="sfx-h3 mt-3" style={{ fontSize: "var(--m1h-t-base)" }}>{item.label}</div>
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}




// The order timeline on the success page: done = success, current = accent,
// later = muted, all from tokens (the old emerald/amber utilities are remapped
// globally and the `sf-order-step` hooks carry index.css !important repaints).
const SUCCESS_TIMELINE_TONES = [
  { border: "var(--sfx-success)", background: "var(--sfx-success-soft)", dot: "var(--sfx-success)", dotInk: "var(--sfx-success-fg)", ink: "var(--m1h-text)" },
  { border: "var(--m1h-accent)", background: "var(--m1h-accent-soft)", dot: "var(--m1h-accent)", dotInk: "var(--sfx-on-accent)", ink: "var(--m1h-text)" },
  { border: "var(--m1h-line)", background: "var(--m1h-surface)", dot: "var(--sfx-panel)", dotInk: "var(--m1h-text-3)", ink: "var(--m1h-text-3)" },
];

function SuccessTimeline() {
  const steps = getStatusLabels();
  return (
    <ol className="mt-4 grid list-none gap-2 p-0 sm:grid-cols-5">
      {steps.map((step, index) => {
        const tone = SUCCESS_TIMELINE_TONES[Math.min(index, 2)];
        return (
          <li
            key={step}
            className="p-3"
            style={{ border: `1px solid ${tone.border}`, borderRadius: "var(--m1h-r-md)", background: tone.background, color: tone.ink }}
            aria-current={index === 1 ? "step" : undefined}
          >
            <span
              className="mb-2 grid h-8 w-8 place-items-center rounded-full text-xs font-semibold"
              style={{ background: tone.dot, color: tone.dotInk }}
              aria-hidden="true"
            >
              {index === 0 ? <Check className="h-4 w-4" /> : index === 1 ? "..." : index + 1}
            </span>
            <span className="block text-xs font-semibold leading-5">{step}</span>
          </li>
        );
      })}
    </ol>
  );
}






function ProductCardSkeleton() {
  return (
    <div className="m1h-card" aria-hidden="true">
      <div className="sfx-skel" style={{ aspectRatio: "1 / 1" }} />
      <div className="m1h-card__body">
        <div className="sfx-skel" style={{ height: 10, width: "40%", borderRadius: 999 }} />
        <div className="sfx-skel" style={{ height: 13, width: "84%", marginTop: 8, borderRadius: 999 }} />
        <div className="sfx-skel" style={{ height: 15, width: "46%", marginTop: 10, borderRadius: 999 }} />
      </div>
    </div>
  );
}

function ProductSkeleton({ count, className = "sfx-product-grid grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4" }) {
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
    <section className="sfx-wrap sfx-section--tight" aria-busy="true">
      <div className="grid gap-4">
        <div className="sfx-skel h-28" style={{ borderRadius: "var(--m1h-r-lg)" }} />
        <div className="sfx-skel h-64" style={{ borderRadius: "var(--m1h-r-lg)" }} />
      </div>
    </section>
  );
}


function ProductGalleryFallback() {
  return (
    <div className="min-w-0">
      <div className="sfx-skel mx-auto h-[clamp(250px,42vh,340px)] w-full max-w-[92vw] md:h-[clamp(420px,58vh,540px)] md:max-w-none" style={{ borderRadius: "var(--m1h-r-lg)" }} />
      <div className="mt-3 flex gap-2">
        {[0, 1, 2, 3].map((item) => <div key={item} className="sfx-skel h-12 w-12 md:h-20 md:w-20" style={{ borderRadius: "var(--m1h-r-md)" }} />)}
      </div>
    </div>
  );
}

function EmptyState({ title, text, actionTo = "/products", actionLabel }) {
  return (
    <div className="sfx-empty mx-auto mt-6 mb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.5rem)] max-w-xl md:mb-6">
      <span className="sfx-empty__icon">
        <PackageSearch className="h-7 w-7" />
      </span>
      <h2 className="sfx-empty__title">{title}</h2>
      <p className="sfx-empty__text">{text}</p>
      <Link to={actionTo} className="sfx-btn sfx-btn--primary sfx-btn--lg">
        {actionLabel || sfText("storefront.common.shopNow")}
      </Link>
    </div>
  );
}

// The bag opens beside the page instead of replacing it: the header's bag icon
// and every add-to-cart slide this panel in from the side the icon sits on, so
// the shopper keeps their place. /cart still exists for the full review.
const CART_DRAWER_EXIT_MS = 280;
const CART_SUGGESTION_LIMIT = 8;
const CART_SUGGESTION_AUTOPLAY_MS = 5000;

// The bundle discount the bag shows is the one checkout charges: the total comes
// straight from computeBundleDiscount. Each line then gets its own part of it,
// cheapest units first inside every bundle, exactly the units that function
// discounted, so the lines add up to the total within rounding.
const cartDrawerBundleShares = (cart = [], percent = 0) => {
  const lines = cart.map((item) => ({ ...item, price: displayCartItemPrice(item) }));
  const { amount, bundles } = computeBundleDiscount(lines, percent);
  const byLine = new Map();
  if (!amount) return { amount: 0, byLine };
  const rate = normalizeBundleDiscountPercent(percent) / 100;
  for (const bundle of bundles) {
    for (const productId of bundle.product_ids) {
      let remaining = bundle.sets;
      const own = lines
        .filter((line) => String(line.bundle_id || "") === bundle.bundle_id && String(line.product_id ?? "") === productId && line.price > 0)
        .sort((a, b) => a.price - b.price);
      for (const line of own) {
        if (remaining <= 0) break;
        const units = Math.min(remaining, Math.max(0, Math.floor(Number(line.quantity) || 0)));
        remaining -= units;
        const share = Math.round(line.price * units * rate * 100) / 100;
        if (share > 0) byLine.set(line.lineId, (byLine.get(line.lineId) || 0) + share);
      }
    }
  }
  return { amount, byLine };
};

// The guide is a sheet over a page now, never a page of its own: an old /size-guide link (or the
// menu entry) opens the full charts over the home page.
function SizeGuideRoute() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const type = params.get("type") || "";
  useEffect(() => {
    navigate("/", { replace: true });
    openSizeGuide({ type });
  }, [navigate, type]);
  return null;
}

function CartDrawer({ open, onClose, cart, updateCart, removeFromCart }) {
  const { i18n } = useTranslation();
  const isRtl = normalizeLanguage(i18n.language || "ar") === "ar";
  const dark = useBodyStorefrontDark();
  const bundleConfig = usePublicBundleConfig();
  const bundlePercent = bundleConfig.enabled ? bundleConfig.percent : 0;
  const bundle = useMemo(() => cartDrawerBundleShares(cart, bundlePercent), [bundlePercent, cart]);
  const freeShippingThreshold = usePublicFreeShippingThreshold();
  // Kept mounted for the slide-out, then dropped so a closed bag costs nothing.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useBodyScrollLock(mounted);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => setShown(true)));
      return () => window.cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), CART_DRAWER_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (open && cart.length) trackGa4ViewCart(cart);
  }, [cart, open]);
  // aria-modal promises the page behind is inert: focus moves in, Tab stays in, Escape closes.
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);
  useDialogFocus(open, panelRef, { onClose, initialFocusRef: closeButtonRef });
  if (!mounted) return null;

  const itemCount = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const subtotal = cart.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  const compareTotal = cart.reduce((sum, item) => {
    const compare = displayCartItemComparePrice(item);
    const price = displayCartItemPrice(item);
    return sum + (compare > price ? compare : price) * item.quantity;
  }, 0);
  const bundleAmount = Math.min(subtotal, bundle.amount);
  const total = Math.max(0, subtotal - bundleAmount);
  const saved = Math.max(0, compareTotal - subtotal) + bundleAmount;

  return createPortal(
    <div
      className={`sf-bag${shown ? " is-open" : ""}`}
      data-theme={dark ? "dark" : "light"}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <button type="button" className="sf-bag__scrim" onClick={onClose} aria-label={sfText("storefront.common.close")} tabIndex={-1} />
      <aside ref={panelRef} className="sf-bag__panel" role="dialog" aria-modal="true" aria-labelledby="sf-bag-title">
        <header className="sf-bag__head">
          <h2 id="sf-bag-title" className="sf-bag__title">
            {sfText("storefront.cartDrawer.title")}
            {itemCount ? <span className="sf-bag__count">{itemCount}</span> : null}
          </h2>
          <button ref={closeButtonRef} type="button" className="sf-bag__close" onClick={onClose} aria-label={sfText("storefront.common.close")}>
            <X strokeWidth={1.6} />
          </button>
        </header>

        <div className="sf-bag__body">
          {!cart.length ? (
            <div className="sf-bag__empty">
              <span className="sf-bag__empty-icon"><ShoppingBag strokeWidth={1.4} /></span>
              <p className="sf-bag__empty-title">{sfText("storefront.cart.emptyTitle")}</p>
              <p className="sf-bag__empty-text">{sfText("storefront.cart.emptyText")}</p>
              <Link to="/products" onClick={onClose} className="sf-bag__btn sf-bag__btn--primary">{sfText("storefront.common.shopNow")}</Link>
            </div>
          ) : (
            <>
              <ul className="sf-bag__lines">
                {cart.map((item) => (
                  <CartDrawerLine key={item.lineId} item={item} bundleShare={bundle.byLine.get(item.lineId) || 0} bundlePercent={bundlePercent} updateCart={updateCart} removeFromCart={removeFromCart} onNavigate={onClose} />
                ))}
              </ul>
              <CartDrawerSuggestions cart={cart} isRtl={isRtl} onNavigate={onClose} />
            </>
          )}
        </div>

        {cart.length ? (
          <footer className="sf-bag__foot">
            {/* The server compares the goods subtotal before the bundle saving, so the bar does too. */}
            <FreeShippingProgress subtotal={subtotal} threshold={freeShippingThreshold} money={money} />
            <div className="sf-bag__subtotal">
              <span className="sf-bag__subtotal-label">{sfText("storefront.cartDrawer.subtotal")}</span>
              <span className="sf-bag__subtotal-values">
                {bundleAmount > 0 ? (
                  // The reference shop writes it as the sum it is: "4,800 - 240".
                  <span className="sf-bag__subtotal-calc">{money(subtotal)} - {money(bundleAmount)}</span>
                ) : saved > 0 ? (
                  <span className="sf-bag__subtotal-was">{money(compareTotal)}</span>
                ) : null}
                <strong className="sf-bag__subtotal-now">{money(total)}</strong>
              </span>
            </div>
            {saved > 0 ? <p className="sf-bag__saved">{sfText("storefront.cartDrawer.saved", undefined, { amount: money(saved) })}</p> : null}
            <p className="sf-bag__note">{sfText("storefront.checkout.finalShippingAtCheckout")}</p>
            <div className="sf-bag__actions">
              <Link to="/cart" onClick={onClose} className="sf-bag__btn sf-bag__btn--ghost">{sfText("storefront.cartDrawer.viewCart")}</Link>
              <Link to="/checkout" onClick={onClose} className="sf-bag__btn sf-bag__btn--primary">{sfText("storefront.cartDrawer.checkout")}</Link>
            </div>
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body
  );
}

function CartDrawerLine({ item, bundleShare = 0, bundlePercent = 0, updateCart, removeFromCart, onNavigate }) {
  const price = displayCartItemPrice(item);
  const compare = displayCartItemComparePrice(item);
  const hasDiscount = compare > price;
  const issue = cartLineIssue(item);
  const href = item.slug || item.product_id ? productUrl({ id: item.product_id, slug: item.slug, selected_variant_id: item.variant_id }) : "";
  const variantText = [localizeColorName(item.color, i18n.language), localizeSizeLabel(item.display_size || item.size, i18n.language)].filter(Boolean).join(" · ");
  const showBrand = Boolean(item.brand) && !String(item.name || "").toLowerCase().includes(String(item.brand).toLowerCase());
  const image = (
    <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" loading="lazy" decoding="async" width="96" height="96" />
  );
  return (
    <li className="sf-bag__line">
      {href ? <Link to={href} onClick={onNavigate} className="sf-bag__line-media">{image}</Link> : <span className="sf-bag__line-media">{image}</span>}
      <div className="sf-bag__line-info">
        {showBrand ? <p className="sf-bag__line-brand">{item.brand}</p> : null}
        {href ? (
          <Link to={href} onClick={onNavigate} className="sf-bag__line-name">{item.name}</Link>
        ) : (
          <p className="sf-bag__line-name">{item.name}</p>
        )}
        {variantText ? <p className="sf-bag__line-variant">{variantText}</p> : null}
        {issue ? <p className="sfx-error sf-bag__line-issue">{sfText(issue.key, undefined, { stock: issue.stock })}</p> : null}
        <p className="sf-bag__price">
          {hasDiscount ? <span className="sf-bag__price-was">{money(compare)}</span> : null}
          <span className={`sf-bag__price-now${hasDiscount ? " is-sale" : ""}`}>{money(price)}</span>
        </p>
        {bundleShare > 0 ? (
          <p className="sf-bag__bundle">
            <Tag strokeWidth={1.8} aria-hidden="true" />
            <span>
              {sfText("storefront.bundle.discountLabel", "Bundle discount")}: {bundlePercent}% <span className="sf-bag__bundle-amount">(-{money(bundleShare)})</span>
            </span>
          </p>
        ) : null}
        <div className="sf-bag__line-controls">
          <div className="sf-bag__stepper">
            <button
              type="button"
              onClick={() => (item.quantity > 1 ? updateCart(item.lineId, item.quantity - 1) : removeFromCart(item.lineId))}
              aria-label={item.quantity > 1 ? sfText("storefront.cart.decreaseQuantity") : sfText("storefront.cart.removeItem")}
            >
              {item.quantity > 1 ? <Minus strokeWidth={1.8} /> : <Trash2 strokeWidth={1.6} />}
            </button>
            <span className="sf-bag__qty" aria-live="polite">{item.quantity}</span>
            <button type="button" onClick={() => updateCart(item.lineId, item.quantity + 1)} disabled={!canIncreaseCartLine(item)} aria-label={sfText("storefront.cart.increaseQuantity")}>
              <Plus strokeWidth={1.8} />
            </button>
          </div>
          <button type="button" className="sf-bag__remove" onClick={() => removeFromCart(item.lineId)}>
            {sfText("storefront.cartDrawer.remove")}
          </button>
        </div>
      </div>
    </li>
  );
}

// "You may also like": the same family as the newest line in the bag, in stock,
// never something already in it. An unknown family falls back to the newest
// in-stock models so the block is never a lone empty frame.
function CartDrawerSuggestions({ cart, isRtl, onNavigate }) {
  const seed = cart[cart.length - 1] || {};
  const family = recommendationText(seed.category);
  const baseQuery = { limit: 16, in_stock: 1, grouping: "product" };
  const targeted = useProducts(family ? { ...baseQuery, product_type: family } : baseQuery);
  const general = useProducts(baseQuery);
  const { brands } = useStorefrontBrands();
  const knownBrandNames = useMemo(
    () => (Array.isArray(brands) ? brands : []).map((brand) => brand?.name).filter(Boolean),
    [brands]
  );
  const inCart = useMemo(() => new Set(cart.map((item) => String(item.product_id || ""))), [cart]);
  const cards = useMemo(() => {
    const ctx = {
      imageFor,
      responsiveImageProps,
      money,
      productUrl,
      pricing: featuredSlideProduct,
      knownBrands: knownBrandNames,
      fallbackEyebrow: (product) => getProductTypeLabel(product?.product_type || product?.productType || "", isRtl ? "ar" : "en"),
    };
    const pick = (products = []) => {
      const seen = new Set();
      return products.filter((product) => {
        const parentId = String(product.parent_product_id || product.id || "");
        if (!parentId || inCart.has(parentId) || seen.has(parentId)) return false;
        seen.add(parentId);
        return true;
      }).map((product) => {
        const card = buildHomeProductCard(product, ctx);
        // A catalogue title is often just the colour ("Black"), which says
        // nothing in a one-card slot, so the slide names the whole product and
        // drops the brand label when the name already carries it.
        const name = cleanDisplayText(product.name || product.title || "") || card.title;
        const showEyebrow = Boolean(card.eyebrow) && !name.toLowerCase().includes(String(card.eyebrow).toLowerCase());
        return { ...card, name, showEyebrow };
      }).filter((card) => card.image && card.priceText);
    };
    const own = pick(targeted.products);
    const list = own.length >= 3 ? own : pick([...(targeted.products || []), ...(general.products || [])]);
    return list.slice(0, CART_SUGGESTION_LIMIT);
  }, [general.products, inCart, isRtl, knownBrandNames, targeted.products]);

  const swipeRef = useRef(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const loading = targeted.loading && general.loading;

  const goTo = useCallback((index) => {
    if (!cards.length) return;
    setActive((index + cards.length) % cards.length);
  }, [cards.length]);

  // A list that shrinks (a suggestion just went into the bag) must not leave
  // the slider parked past its last slide.
  useEffect(() => {
    if (active >= cards.length && cards.length) setActive(0);
  }, [active, cards.length]);

  // Swipe reads the finger, not the scroll position: the row is moved with a
  // transform, so a drag that is mostly vertical still scrolls the bag.
  const onTouchStart = (event) => {
    const touch = event.touches[0];
    swipeRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    setPaused(true);
  };
  const onTouchEnd = (event) => {
    const start = swipeRef.current;
    const touch = event.changedTouches[0];
    swipeRef.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy)) return;
    const forward = isRtl ? dx > 0 : dx < 0;
    goTo(active + (forward ? 1 : -1));
  };

  useEffect(() => {
    if (paused || cards.length < 2) return undefined;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return undefined;
    const timer = window.setInterval(() => goTo(active + 1), CART_SUGGESTION_AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [active, cards.length, goTo, paused]);

  if (!loading && !cards.length) return null;
  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <section
      className="sf-bag__recs"
      aria-roledescription="carousel"
      aria-label={sfText("storefront.cartDrawer.youMayAlsoLike")}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
    >
      <div className="sf-bag__recs-head">
        <h3>{sfText("storefront.cartDrawer.youMayAlsoLike")}</h3>
      </div>
      {loading && !cards.length ? (
        <div className="sf-bag__rec sf-bag__rec--skeleton" aria-hidden="true">
          <span className="sf-bag__rec-media sf-skeleton-shimmer" />
          <span className="sf-bag__rec-info">
            <span className="sf-bag__skel sf-skeleton-shimmer" />
            <span className="sf-bag__skel sf-bag__skel--short sf-skeleton-shimmer" />
          </span>
        </div>
      ) : (
        <>
          <div className="sf-bag__recs-track" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div className="sf-bag__recs-row" style={{ transform: `translateX(${(isRtl ? 1 : -1) * active * 100}%)` }}>
            {cards.map((card, index) => (
              <Link
                key={`${card.key}-${index}`}
                to={card.href}
                onClick={onNavigate}
                className="sf-bag__rec"
                aria-roledescription="slide"
                aria-label={`${index + 1} / ${cards.length}`}
                aria-hidden={index === active ? undefined : "true"}
                tabIndex={index === active ? undefined : -1}
              >
                <span className="sf-bag__rec-media">
                  <img src={card.image} {...card.imageProps} alt={card.alt} loading="lazy" decoding="async" onError={fallbackProductImage} />
                  {card.discount ? <span className="sf-bag__rec-badge">-{card.discount}%</span> : null}
                </span>
                <span className="sf-bag__rec-info">
                  {card.showEyebrow ? <span className="sf-bag__rec-brand">{card.eyebrow}</span> : null}
                  <span className="sf-bag__rec-name">{card.name}</span>
                  <span className="sf-bag__price">
                    {card.compareText ? <span className="sf-bag__price-was">{card.compareText}</span> : null}
                    <span className={`sf-bag__price-now${card.compareText ? " is-sale" : ""}`}>{card.priceText}</span>
                  </span>
                  <span className="sf-bag__rec-cta">
                    {sfText("storefront.cartDrawer.chooseSize")}
                    <NextIcon strokeWidth={1.8} />
                  </span>
                </span>
              </Link>
            ))}
            </div>
          </div>
          {cards.length > 1 ? (
            <div className="sf-bag__recs-nav">
              <button type="button" onClick={() => goTo(active - 1)} aria-label={sfText("storefront.common.previous")}>
                <PrevIcon strokeWidth={1.6} />
              </button>
              <div className="sf-bag__dots">
                {cards.map((card, index) => (
                  <button
                    key={`dot-${card.key}-${index}`}
                    type="button"
                    className={index === active ? "is-active" : ""}
                    onClick={() => goTo(index)}
                    aria-label={`${index + 1}`}
                    aria-current={index === active ? "true" : undefined}
                  />
                ))}
              </div>
              <button type="button" onClick={() => goTo(active + 1)} aria-label={sfText("storefront.common.next")}>
                <NextIcon strokeWidth={1.6} />
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}




function PaymentBrandLogo({ method, size = "tab", active = false, label, logoUrl }) {
  const [failed, setFailed] = useState(false);
  const logo = paymentBrandLogos[method] || {};
  const fallbackLabel = label || (method === "vodafone_cash" ? "Vodafone Cash" : method === "instapay" ? "InstaPay" : "Payment");
  const isCopy = size === "copy";
  const containerClass = isCopy
    ? "sfc-method__logo"
    : `grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white shadow-[0_12px_30px_rgba(0,0,0,0.20)] transition duration-300 ${active ? "scale-105" : "opacity-80 group-hover:opacity-100"}`;
  const imageClass = isCopy ? "sfc-method__logo-img" : "h-8 w-8 object-contain";

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
    // The homepage card look (m1h-card) on tokens. The legacy
    // `sf-storefront-card` / `sf-small-product-card` hooks are gone: index.css
    // repaints them with layered !important rules, which is what kept this grid
    // an always-black block in light mode.
    <div className="sfx-product-grid mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {normalizedItems.map((item) => (
        <div key={item.id} className="m1h-card group flex min-w-0 flex-col">
          {item.unavailable ? (
            <div className="sfx-empty sfx-empty--compact flex-1">
              <span className="sfx-empty__icon">
                <Heart className="h-5 w-5" />
              </span>
              <div className="sfx-empty__title">{sfText("storefront.products.unavailableNow")}</div>
              <p className="sfx-empty__text">{sfText("storefront.products.openForDetails")}</p>
            </div>
          ) : (
            <Link to={`/product/${item.slug || item.id}`} className="flex min-h-0 flex-1 flex-col">
              <div className="m1h-card__plate">
                <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt={item.name || ""} className="m1h-card__img" loading="lazy" decoding="async" width="320" height="320" />
              </div>
              <div className="m1h-card__body">
                <div className="m1h-card__name break-words text-start">{item.name || sfText("storefront.products.savedProduct")}</div>
                <div className="m1h-card__price text-start">
                  {item.price ? <span className={`m1h-card__price-now${displayComparePrice(item) > Number(item.price || 0) ? " m1h-card__price-now--sale" : ""}`}>{money(item.price)}</span> : <span className="text-sm" style={{ color: "var(--m1h-text-3)" }}>{sfText("storefront.products.openForDetails")}</span>}
                  {displayComparePrice(item) > Number(item.price || 0) ? <span className="m1h-card__price-was">{money(displayComparePrice(item))}</span> : null}
                </div>
              </div>
            </Link>
          )}
          {(onAddToCart && !item.unavailable) || action ? (
            <div className="grid gap-2 p-3 pt-0">
              {onAddToCart && !item.unavailable ? <button type="button" onClick={() => addWishlistItemToCart(item)} className="sfx-btn sfx-btn--primary sfx-btn--block">{sfText("storefront.cart.addToCart")}</button> : null}
              {action ? <button type="button" onClick={() => action(item)} className="sfx-btn sfx-btn--ghost sfx-btn--sm sfx-btn--block">{item.unavailable ? sfText("storefront.wishlist.removeFromWishlist") : sfText("storefront.common.remove")}</button> : null}
            </div>
          ) : null}
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
  return <div className="pointer-events-none absolute inset-0 overflow-hidden">{CONFETTI_PARTICLES.map((particle) => <span key={particle.id} className="absolute h-2 w-2 animate-[confetti_1.8s_ease-out_forwards] rounded-full" style={{ right: particle.right, top: "0%", animationDelay: particle.animationDelay, background: particle.id % 2 ? "var(--m1h-accent)" : "var(--sfx-success)" }} />)}</div>;
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

const normalizeCartLine = (product = {}, variant = {}, quantity = 1, bundleId = "") => {
  const image = variantImage(variant) || displayImageForProduct(product, variant) || product.image_url || product.product_image_url || "";
  const price = displaySellingPrice(product, variant);
  const compareAtPrice = displayComparePrice(product, variant);
  const originalSize = String(variant.size || "").trim();
  const displaySize = isCrocsProduct(product) ? resolveCrocsEuSize(originalSize) : originalSize;
  const safeBundleId = String(bundleId || "").trim();
  return {
    // A bundle line is its own line: merging it into a plain line of the same
    // size would either lose the bundle or hand the discount to units bought alone.
    lineId: [
      product.id || product.slug || product.name || "product",
      variant.id || variant.sku || variant.size || variant.color || "variant",
      ...(safeBundleId ? [safeBundleId] : []),
    ].join(":"),
    ...(safeBundleId ? { bundle_id: safeBundleId } : {}),
    product_id: product.id || "",
    variant_id: variant.id || "",
    // Keep the exact catalog identifier with the order/cart line for Meta matching.
    sku: variant.sku || variant.SKU || variant.variant_sku || product.sku || "",
    // The feed's id for this size (SKU, or product-variant when the SKU is shared).
    ...(variant.meta_content_id ? { meta_content_id: variant.meta_content_id } : {}),
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

/*
 * One cart across a signed-in shopper's devices.
 *
 * The server row is the shared cart; each browser remembers the version it last
 * saw and that cart's lines (its "base"). Whatever changed since then is merged
 * three ways by line — base, this browser, the server — so an item removed on the
 * phone stays removed on the laptop, an item added on either survives, and a
 * quantity changed here beats the server's. The old merge was a union with this
 * browser first: removed and already-ordered items came back from every stale
 * device, and the abandoned-cart WhatsApp then offered them again.
 */
const CART_SYNC_KEY = "storefront.cart.sync";

const readCartSyncMarker = (phone = "") => {
  const marker = readStorefrontStorage(CART_SYNC_KEY, null);
  if (!marker || !phone || String(marker.phone || "") !== String(phone)) return { version: null, base: [] };
  return { version: Number.isFinite(Number(marker.version)) ? Number(marker.version) : null, base: Array.isArray(marker.base) ? marker.base : [] };
};

const writeCartSyncMarker = (phone = "", version = null, cart = []) => {
  if (!phone) return;
  writeStorefrontStorage(CART_SYNC_KEY, {
    phone: String(phone),
    version,
    base: normalizeCartCollection(cart).map((item) => ({ lineId: item.lineId, quantity: Number(item.quantity || 1) })),
  });
};

/**
 * Whose wishlist this browser holds. A guest's hearts carry no owner and are merged into
 * the account on first sign-in; once merged they belong to that phone. Signing out, or a
 * different phone signing in, drops them — otherwise the next account "merges" the
 * previous customer's wishlist (and its price-drop follows) as if it were a guest's.
 */
const WISHLIST_OWNER_KEY = "storefront.wishlist.owner";

/*
 * The models this browser last knew the server's wishlist to hold, per phone -- the wishlist's
 * counterpart of the cart's base. Without it a model removed on another device was re-saved (and
 * its price-drop follow reopened) from every browser still holding a local copy.
 */
const WISHLIST_SYNC_KEY = "storefront.wishlist.sync";

const readWishlistSyncBase = (phone = "") => {
  const marker = readStorefrontStorage(WISHLIST_SYNC_KEY, null);
  if (!marker || !phone || String(marker.phone || "") !== String(phone) || !Array.isArray(marker.ids)) return null;
  return marker.ids.map((id) => String(id));
};

const writeWishlistSyncBase = (phone = "", ids = []) => {
  if (!phone) return;
  writeStorefrontStorage(WISHLIST_SYNC_KEY, { phone: String(phone), ids: [...new Set(ids.map((id) => String(id || "")).filter(Boolean))] });
};

const cartLinesEqual = (left = [], right = []) => {
  const a = normalizeCartCollection(left);
  const b = normalizeCartCollection(right);
  if (a.length !== b.length) return false;
  const quantities = new Map(b.map((item) => [item.lineId, Number(item.quantity || 1)]));
  return a.every((item) => quantities.get(item.lineId) === Number(item.quantity || 1));
};

const mergeCartThreeWay = (baseItems = [], localItems = [], remoteItems = []) => {
  const base = new Map((Array.isArray(baseItems) ? baseItems : []).map((item) => [String(item.lineId), Number(item.quantity || 1)]));
  const local = normalizeCartCollection(localItems);
  const localById = new Map(local.map((item) => [item.lineId, item]));
  const merged = new Map(normalizeCartCollection(remoteItems).map((item) => [item.lineId, item]));
  // Removed here since the last sync: gone, even if the server still has it.
  base.forEach((_quantity, lineId) => {
    if (!localById.has(lineId)) merged.delete(lineId);
  });
  // Added here, or its quantity changed here: this browser's line wins.
  local.forEach((item) => {
    const baseQuantity = base.get(item.lineId);
    const changedHere = baseQuantity === undefined || baseQuantity !== Number(item.quantity || 1);
    if (changedHere) {
      merged.set(item.lineId, item);
    } else if (merged.has(item.lineId)) {
      // Untouched here: keep the server's quantity, but this browser's copy of the
      // line (it may carry fresher display fields). Untouched here and gone from the
      // server means removed on another device, so it is not put back.
      merged.set(item.lineId, { ...item, quantity: merged.get(item.lineId).quantity, total_amount: merged.get(item.lineId).total_amount });
    }
  });
  return normalizeCartCollection([...merged.values()]);
};

const OrderNumberBadge = ({ value, className = "" }) => {
  const text = displayPublicOrderNumber(value);
  return <span className={`sfx-badge sfx-badge--accent ${className}`.trim()} style={{ fontSize: "var(--m1h-t-sm)" }} dir="ltr">{text}</span>;
};

function Storefront() {
  usePageTitle("Storefront");
  const location = useLocation();
  const [cart, setCart] = useState(() => readStorefrontStorage(CART_KEY, []));
  const [wishlist, setWishlist] = useState(() => normalizeWishlistCollection(readStorefrontStorage(WISHLIST_KEY, [])));
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
  const cartSyncConflictsRef = useRef(0);
  const cartRef = useRef(cart);
  // The cart array last taken from another tab's save; see the storage listener below.
  const cartFromOtherTabRef = useRef(null);
  const wishlistRef = useRef(wishlist);
  const wishlistSyncedPhoneRef = useRef("");
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
    // The homepage and the product page release the boot loader themselves once
    // their data lands; every other storefront route has its first screen now.
    const path = String(location.pathname || "/");
    if (!isStorefrontHomePath(path) && !/^\/(?:shop\/)?product\//i.test(path)) releaseBootLoader();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // A cart taken from another tab is already what storage holds; writing it back is how two tabs
    // start echoing one change between them.
    if (cart === cartFromOtherTabRef.current) return;
    writeStorefrontStorage(CART_KEY, cart);
  }, [cart]);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // The cart was read from storage once, at load. A guest's second tab kept its old bag, and its next
  // change wrote that bag back over the item added (or the order placed) in the other tab. Follow the
  // other tab's saves instead. For a signed-in shopper the tab that made the change also saves it to the
  // server and moves the shared sync marker; this tab only mirrors the result and never PUTs it itself
  // (see the save effect), so the two tabs cannot race each other into a 409 three-way merge.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncCartFromOtherTab = (event) => {
      const items = cartFromStorageEvent(event, CART_KEY);
      if (!items) return;
      const next = normalizeCartCollection(items);
      cartFromOtherTabRef.current = next;
      cartRef.current = next;
      setCart(next);
    };
    window.addEventListener("storage", syncCartFromOtherTab);
    return () => window.removeEventListener("storage", syncCartFromOtherTab);
  }, []);

  useEffect(() => {
    writeStorefrontStorage(WISHLIST_KEY, wishlist);
    wishlistRef.current = wishlist;
    // Signed in and synced, every heart here goes straight to the server, so the base follows
    // the list: a model hearted here after the sync is not later read as removed elsewhere.
    const syncedPhone = wishlistSyncedPhoneRef.current;
    if (syncedPhone && String(readStorefrontCustomerAuth().phone || "") === syncedPhone) {
      writeWishlistSyncBase(syncedPhone, wishlist.map((item) => wishlistIdOf(item)));
    }
  }, [wishlist]);

  // Declared before the sign-in sync below on purpose: both run in the same commit, and the
  // sync must read the emptied ref, not the previous customer's list from its render closure.
  useEffect(() => {
    const owner = String(readStorefrontStorage(WISHLIST_OWNER_KEY, "") || "");
    if (!owner) return;
    if (customerAuth.token && String(customerAuth.phone || "") === owner) return;
    wishlistRef.current = [];
    writeStorefrontStorage(WISHLIST_KEY, []);
    writeStorefrontStorage(WISHLIST_OWNER_KEY, "");
    setWishlist([]);
  }, [customerAuth.token, customerAuth.phone]);

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
    const body = document.body;
    previousDocumentThemeRef.current = {
      bodyStorefrontDark: body.classList.contains("storefront-dark"),
    };
    body.classList.add("storefront-shell");
    // ThemeProvider writes the generic palette tokens INLINE on <body>, and an
    // inline declaration cannot be beaten from a stylesheet — so the site design
    // takes them over for exactly as long as this class is on the body, and hands
    // them back on the way out.
    attachSiteDesign();

    return () => {
      const previous = previousDocumentThemeRef.current;
      detachSiteDesign();
      body.classList.remove("storefront-shell");
      if (previous) body.classList.toggle("storefront-dark", previous.bodyStorefrontDark);
      // Hand the four root theme signals back to the ERP theme rather than
      // restoring the ones we captured: that snapshot is taken before
      // ThemeProvider's own effect has run, so replaying it reinstated a stale
      // value — and on the storefront host the boot script has always seeded a
      // dark one. The owner re-publishes the ERP's live theme instead.
      releaseStorefrontColorScheme();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const dark = themeMode === "dark";
    const body = document.body;
    // `storefront-dark` is the shop's own theme class and nothing else writes
    // it. The Tailwind `dark` class and `data-theme` are shared with the ERP
    // theme, so they are published through the owner module instead of being
    // written here — otherwise the last effect to run decided them, and a shop
    // in LIGHT could end up wearing the ERP's `dark` class (invisible white
    // footer text on the cream band). See src/theme/documentColorScheme.js.
    body.classList.toggle("storefront-dark", dark);
    // The storefront header is deliberately dark in BOTH themes (see the
    // gradient on `.storefront-shell:not(.storefront-dark) .sf-luxury-header`),
    // and theme-color paints the browser toolbar sitting right on top of it —
    // so the light theme does NOT hand over its cream canvas here.
    setStorefrontColorScheme(themeMode, dark ? "#050505" : "#111111");
  }, [themeMode]);

  // The palette, fonts and corners are decided in Site Studio and ride the same
  // /settings/public payload the effect below reads, so this costs no extra
  // request. It lives on the shell rather than the homepage because a visitor
  // who lands on a product page must get the store’s colours too.
  useEffect(() => {
    refreshSiteDesign();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPublicSettingsResponse()
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

  // Called once an order is placed. The empty cart is saved right away with
  // keepalive, not through the 750ms debounce: checkout goes straight on to the
  // payment page, and a cancelled timer left the ordered items in the saved cart —
  // for other devices to bring back and the abandoned-cart WhatsApp to offer again.
  const clearCart = useCallback(() => {
    setCart([]);
    const { token, phone } = readStorefrontCustomerAuth();
    if (!token || !phone) return;
    storefrontCustomerRequest("/storefront/customer/cart", {
      method: "PUT",
      body: { cart: [], base_version: null },
      keepalive: true,
    }).then((data) => {
      writeCartSyncMarker(phone, Number.isFinite(Number(data?.version)) ? Number(data.version) : null, []);
    }).catch(() => undefined);
  }, []);

  const updateCart = useCallback((lineId, quantity) => {
    setCart((prev) => {
      const nextQuantity = Number(quantity || 0);
      if (nextQuantity <= 0) return prev.filter((item) => item.lineId !== lineId);
      // Raising stops at the stock the last re-price saw, so the bag cannot promise what checkout refuses.
      return prev.map((item) => (item.lineId === lineId ? setCartLineQuantity(item, nextQuantity) : item));
    });
  }, []);

  const removeFromCart = useCallback((lineId) => {
    setCart((prev) => prev.filter((item) => item.lineId !== lineId));
  }, []);

  // A cart line keeps the price it was added at; checkout charges today's. Ask the server what the lines
  // cost now (the same pricing checkout uses) and fold it in, telling the shopper what moved. A failed
  // request changes nothing — checkout still re-prices on the server and refuses a stale total.
  const [cartRepriceNotice, setCartRepriceNotice] = useState(null);
  const dismissCartRepriceNotice = useCallback(() => setCartRepriceNotice(null), []);
  const repriceCart = useCallback(async ({ checkoutRetry = false } = {}) => {
    const variantIds = cartRepriceVariantIds(cartRef.current);
    if (!variantIds.length) return null;
    try {
      const data = await api.post(CART_REPRICE_ENDPOINT, { variant_ids: variantIds });
      const variants = Array.isArray(data?.variants) ? data.variants : [];
      const result = applyCartReprice(cartRef.current, variants, displayCartItemPrice);
      // Applied to the latest cart, not the snapshot above, so a quantity changed mid-request survives.
      setCart((prev) => applyCartReprice(prev, variants, displayCartItemPrice).cart);
      if (result.changed.length || result.unavailable.length || checkoutRetry) {
        setCartRepriceNotice({ changed: result.changed, unavailable: result.unavailable, checkoutRetry });
      } else {
        // Nothing wrong any more (say the unavailable line was removed): drop those warnings, but keep
        // telling a shopper who moved from the cart page to checkout which prices changed.
        setCartRepriceNotice((prev) => (prev?.changed?.length ? { changed: prev.changed, unavailable: [], checkoutRetry: false } : null));
      }
      return result;
    } catch {
      return null;
    }
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
    const bundleId = options && typeof options === "object" ? String(options.bundleId || "") : "";
    const nextLine = normalizeCartLine(product, variant, quantity, bundleId);
    // The bundle drawer opens once, from the bundle button, not once per product.
    const openDrawer = !(options && typeof options === "object" && options.openDrawer === false);
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) =>
        String(item.product_id) === String(nextLine.product_id) &&
        String(item.variant_id) === String(nextLine.variant_id) &&
        String(item.bundle_id || "") === String(nextLine.bundle_id || "")
      );
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
    if (openDrawer) setCartDrawerOpen(true);
    return "added";
  }, [profile]);

  const toggleWishlist = useCallback((product) => {
    const item = wishlistEntryOf(product);
    if (!item.id) return;
    const { token } = readStorefrontCustomerAuth();
    setWishlist((prev) => {
      // The server row is the model: it goes only when no colour of the model is left.
      const { next, serverChange } = toggleWishlistEntries(prev, product, item);
      if (token && serverChange) {
        const removing = serverChange === "remove";
        storefrontCustomerRequest("/storefront/wishlist", {
          method: removing ? "DELETE" : "POST",
          body: { product_id: item.id, remove: removing },
        }).then(() => {
          // The server follows (or unfollows) the price with the wishlist; the product page bell re-reads it.
          window.dispatchEvent(new Event("storefront-price-alerts-changed"));
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
        const backendWishlist = normalizeWishlistCollection(data?.wishlist_products);
        const backendRecent = Array.isArray(data?.recent_products) ? data.recent_products.map(normalizeStorefrontItem).filter((item) => item.id) : [];
        const cartPhone = readStorefrontCustomerAuth().phone;
        const backendCartVersion = Number.isFinite(Number(backendCartData?.version)) ? Number(backendCartData.version) : null;
        const cartMarker = readCartSyncMarker(cartPhone);
        const backendRecentIds = new Set(backendRecent.map((item) => String(item.id)));
        const guestWishlist = normalizeWishlistCollection(wishlistRef.current);
        const guestRecent = (Array.isArray(recent) ? recent : []).map(normalizeStorefrontItem).filter((item) => item.id);
        // A browser joining the account for the first time has no base, so its guest
        // cart is added to the saved one; a browser that synced before merges only
        // what changed on either side since.
        const mergedCart = mergeCartThreeWay(cartMarker.base, cartRef.current, backendCart);
        writeCartSyncMarker(cartPhone, backendCartVersion, backendCart);
        // The server keeps the model only; the colours the shopper hearted live in this browser,
        // so a server row stands in only for a model this browser has no colour of. A model gone
        // from the server that this browser had already synced was removed elsewhere: dropped.
        const wishlistSync = reconcileWishlistWithServer({
          local: guestWishlist,
          remote: backendWishlist,
          baseIds: readWishlistSyncBase(cartPhone),
        });
        const mergedWishlist = normalizeWishlistCollection(wishlistSync.merged);
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
        // From here the list is this account's: a later sign-out or another phone clears it.
        if (cartPhone) writeStorefrontStorage(WISHLIST_OWNER_KEY, cartPhone);
        setRecent(mergedRecent);

        const missingRecentItems = guestRecent.filter((item) => !backendRecentIds.has(String(item.id)));
        const settled = await Promise.allSettled([
          ...wishlistSync.toAdd.map((productId) =>
            storefrontCustomerRequest("/storefront/wishlist", {
              method: "POST",
              body: { product_id: productId },
            })
          ),
          ...missingRecentItems.map((item) =>
            storefrontCustomerRequest("/storefront/recently-viewed", {
              method: "POST",
              body: { product_id: item.id, session_id: getSessionId() },
            })
          ),
        ]);
        // The base is what the server now holds: its rows plus the adds that landed. An add that
        // failed stays out, so the next sync sends it again instead of reading it as a removal.
        // Keyed by phone, so it is right to write even if this run was cancelled meanwhile.
        const landed = wishlistSync.toAdd.filter((_id, index) => settled[index]?.status === "fulfilled");
        writeWishlistSyncBase(cartPhone, [...backendWishlist.map((item) => wishlistIdOf(item)), ...landed]);
        if (!cancelled) wishlistSyncedPhoneRef.current = cartPhone;
      } catch (error) {
        const status = Number(error?.status || error?.response?.status || 0);
        if (status === 401 || status === 403) {
          clearStorefrontCustomerAuth();
          setCustomerAuth(readStorefrontCustomerAuth());
        }
      } finally {
        // Enable saving even if this run was cancelled. The effect re-runs whenever `recent` or
        // `wishlist` change — which they do as the customer browses products — and a re-run with
        // the same token returns early WITHOUT restarting this sync. So guarding on `cancelled`
        // here meant a browse during a slow mobile sync cancelled the only run that would ever flip
        // the flag, leaving saving OFF forever: reads worked, every cart PUT was silently skipped.
        setCartSyncReady(true);
      }
    };

    void syncCustomerLists();
    return () => {
      cancelled = true;
    };
    // Intentionally token-only: recent/wishlist are read through their current closures for the
    // one-time merge, but must NOT re-trigger this sync — that churn is what stuck the flag off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerAuth.token]);

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
    // Mirrored from another tab: that tab saves it (it already holds everything this tab had).
    if (cart === cartFromOtherTabRef.current) return undefined;
    const phone = String(customerAuth.phone || readStorefrontCustomerAuth().phone || "");
    const snapshot = normalizeCartCollection(cart);
    const marker = readCartSyncMarker(phone);
    // Nothing this browser changed since the server's version it holds — including a
    // cart that was just taken from the server — so there is nothing to save.
    if (marker.version !== null && cartLinesEqual(snapshot, marker.base)) {
      cartSyncConflictsRef.current = 0;
      return undefined;
    }
    cartSyncSaveTimerRef.current = window.setTimeout(() => {
      cartSyncSaveTimerRef.current = null;
      storefrontCustomerRequest("/storefront/customer/cart", {
        method: "PUT",
        body: { cart: snapshot, base_version: marker.version },
      }).then((data) => {
        cartSyncConflictsRef.current = 0;
        writeCartSyncMarker(phone, Number.isFinite(Number(data?.version)) ? Number(data.version) : null, snapshot);
      }).catch((error) => {
        const status = Number(error?.status || error?.response?.status || 0);
        if (status === 401 || status === 403) {
          clearStorefrontCustomerAuth();
          setCustomerAuth(readStorefrontCustomerAuth());
          setCartSyncReady(false);
          return;
        }
        // Another device saved first. Take its cart as the new base, lay this
        // browser's own changes over it, and let this effect save the result. The
        // counter stops a server that keeps refusing from looping forever.
        if (status === 409 && cartSyncConflictsRef.current < 3) {
          cartSyncConflictsRef.current += 1;
          const body = error?.responseBody || {};
          const remote = normalizeCartCollection(body.cart || []);
          const latest = readCartSyncMarker(phone);
          const merged = mergeCartThreeWay(latest.base, cartRef.current, remote);
          writeCartSyncMarker(phone, Number.isFinite(Number(body.version)) ? Number(body.version) : null, remote);
          setCart(merged);
        }
      });
    }, 750);
    return () => {
      if (!cartSyncSaveTimerRef.current) return;
      window.clearTimeout(cartSyncSaveTimerRef.current);
      cartSyncSaveTimerRef.current = null;
    };
  }, [cart, cartSyncReady, customerAuth.phone, customerAuth.token]);

  // A tab left open on the laptop picks up what the shopper did on the phone the
  // moment it is looked at again, instead of only at the next sign-in.
  useEffect(() => {
    const token = String(customerAuth.token || "").trim();
    if (!token || !cartSyncReady || typeof document === "undefined") return undefined;
    let inflight = false;
    let lastRun = 0;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inflight || Date.now() - lastRun < 3000) return;
      // A save is about to go out; its version check covers anything newer.
      if (cartSyncSaveTimerRef.current) return;
      inflight = true;
      lastRun = Date.now();
      try {
        const phone = String(readStorefrontCustomerAuth().phone || "");
        const data = await storefrontCustomerRequest("/storefront/customer/cart");
        const version = Number.isFinite(Number(data?.version)) ? Number(data.version) : null;
        const marker = readCartSyncMarker(phone);
        if (version !== null && marker.version === version) return;
        const remote = normalizeCartCollection(data?.cart || []);
        const merged = mergeCartThreeWay(marker.base, cartRef.current, remote);
        writeCartSyncMarker(phone, version, remote);
        setCart(merged);
      } catch (error) {
        const status = Number(error?.status || error?.response?.status || 0);
        if (status === 401 || status === 403) {
          clearStorefrontCustomerAuth();
          setCustomerAuth(readStorefrontCustomerAuth());
        }
      } finally {
        inflight = false;
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [cartSyncReady, customerAuth.token]);

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
      if (/^(mailto:|tel:)/i.test(raw) || raw.startsWith("/")) return raw;
      return toWhatsAppHref(raw) || fallback;
    };
    const normalizeStoreHref = (value, fallback = "") => {
      const raw = String(value || "").trim();
      if (!raw) return fallback;
      if (/^(https?:|mailto:|tel:)/i.test(raw) || raw.startsWith("/")) return raw;
      return fallback;
    };

    const resolvedWhatsAppHref = normalizeWhatsAppHref(
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
      "",
    );
    // Publish the number the settings resolved to, so the module-level helpers
    // (footer, visual search, order support) stop linking to a bare wa.me.
    setStorefrontWhatsAppHref(resolvedWhatsAppHref);

    return {
      whatsappHref: resolvedWhatsAppHref || storefrontWhatsAppHref(),
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
      instagramHref: (() => {
        const url = normalizeStoreHref(firstValue("storefront.instagram_url", "storefront.instagram_link", "company.instagram_url", "social.instagram_url", "instagram_url"));
        const username = (firstValue("storefront.instagram_username", "storefront.instagram", "company.instagram_username", "social.instagram_username", "instagram_username")
          || (url.match(/instagram\.com\/([A-Za-z0-9._]+)/i) || [])[1] || "").replace(/^@/, "");
        // ig.me/m opens a Direct chat with the account; the profile URL is the fallback.
        return username ? `https://ig.me/m/${encodeURIComponent(username)}` : url;
      })(),
      messengerHref: (() => {
        const direct = normalizeStoreHref(firstValue("storefront.messenger_url", "storefront.messenger_link", "social.messenger_url", "messenger_url"));
        if (direct) return direct;
        const slug = facebookPageSlug(firstValue("storefront.facebook_url", "storefront.facebook_link", "company.facebook_url", "social.facebook_url", "facebook_url"));
        return slug ? `https://m.me/${encodeURIComponent(slug)}` : "";
      })(),
    };
  }, [publicStoreSettings]);
  const isCheckoutPage = isStorefrontCheckoutPath(location.pathname || "");
  const isOfferStoryPage = isStorefrontOfferPath(location.pathname || "");
  const hideFloatingWhatsApp = cartDrawerOpen || mobileMenuOpen || isCheckoutPage || isOfferStoryPage;
  const currentStorefrontPath = resolveStorefrontPathname(location.pathname || "");
  const cartVariantsKey = cartRepriceKey(cart);

  // Re-price when the cart page or checkout opens, and again whenever the set of variants changes while
  // there (an add, or another device's lines merged in). The price update itself never changes the key.
  // Declared after the cartRef sync above, so the request reads the cart this render committed.
  useEffect(() => {
    const onCartOrCheckout = currentStorefrontPath === ROOT_PATHS.cart || currentStorefrontPath === ROOT_PATHS.checkout;
    if (!onCartOrCheckout || !cartVariantsKey) return;
    repriceCart();
  }, [currentStorefrontPath, cartVariantsKey, repriceCart]);

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
    OrderNumberBadge,
    SmallProductGrid,
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
          recent={recent}
          wishlist={wishlist}
          toggleWishlist={toggleWishlist}
          onAddToCart={onAddToCart}
          saleModeEnabled={storefrontSalePricesEnabled}
          themeMode={themeMode}
          cartRepriceNotice={cartRepriceNotice}
          dismissCartRepriceNotice={dismissCartRepriceNotice}
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
          repriceCart={repriceCart}
          cartRepriceNotice={cartRepriceNotice}
          dismissCartRepriceNotice={dismissCartRepriceNotice}
        />
      );
    }

    if (currentStorefrontPath.startsWith(`${ROOT_PATHS.success}/`)) {
      return (
        <OrderSuccess
          whatsappHref={quickActionLinks.whatsappHref}
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
          toggleWishlist={toggleWishlist}
          saleModeEnabled={storefrontSalePricesEnabled}
          helpers={helpers}
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
          saleModeEnabled={storefrontSalePricesEnabled}
          recent={recent}
        />
      );
    }

    if (currentStorefrontPath === ROOT_PATHS.compare) {
      return <LazyStorefrontComparePage onAddToCart={onAddToCart} saleModeEnabled={storefrontSalePricesEnabled} />;
    }

    if (currentStorefrontPath === ROOT_PATHS.recentlyViewed) {
      return <LazyStorefrontRecentPage recent={recent} helpers={helpers} components={components} />;
    }

    if (currentStorefrontPath === ROOT_PATHS.faq) return <LazyStorefrontFaqPage publicStoreSettings={publicStoreSettings} whatsappHref={quickActionLinks.whatsappHref} />;

    if (currentStorefrontPath === ROOT_PATHS.contact) {
      return <PremiumContactPage publicStoreSettings={publicStoreSettings} quickActionLinks={quickActionLinks} />;
    }

    if (currentStorefrontPath === ROOT_PATHS.sizeGuide) return <SizeGuideRoute />;
    if (currentStorefrontPath === ROOT_PATHS.returns) return <LazyStorefrontReturnsPage publicStoreSettings={publicStoreSettings} whatsappHref={quickActionLinks.whatsappHref} />;

    // Only the home path is the homepage; any other path the shop does not know is a
    // not-found page, not a silent homepage (App's storefront catch-all lands here).
    if (!isStorefrontHomePath(currentStorefrontPath)) {
      return <LazyStorefrontNotFoundPage whatsappHref={quickActionLinks.whatsappHref} />;
    }

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
    cartRepriceNotice,
    clearCart,
    components,
    currentStorefrontPath,
    dismissCartRepriceNotice,
    repriceCart,
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
          customerAuth={customerAuth}
          onCart={() => setCartDrawerOpen(true)}
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
        <StorefrontContactFloat
          whatsappHref={quickActionLinks.whatsappHref}
          instagramHref={quickActionLinks.instagramHref}
          messengerHref={quickActionLinks.messengerHref}
          lang={i18n.language || "ar"}
        />
      ) : null}
      <SizeGuideHost whatsappHref={quickActionLinks.whatsappHref} lockScroll={lockBodyScroll} />
      <CompareTray hidden={isCheckoutPage || currentStorefrontPath === ROOT_PATHS.cart ||isOfferStoryPage || cartDrawerOpen || mobileMenuOpen || currentStorefrontPath === ROOT_PATHS.compare} />
      {/* The bottom nav is gone: every destination it carried is now in the
          header — menu, search, wishlist and bag — so it was a second navigation
          competing with the first, and it covered a row of the page on every
          screen. Its height variable is zeroed in the stylesheet so the padding
          that reserved space for it collapses with it. */}
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
  PairsWellWith,
  ProductSkeleton,
  RecentProductsSection,
  RelatedProducts,
  SectionIntro,
  StepPill,
  StorefrontPageFallback,
  buildAvailableSizeOptions,
  cartDrawerBundleShares,
  buildAvailableSizeOptionsFromFacets,
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
  productUrl,
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
  usePublicBundleConfig,
  useProducts,
  useStorefrontProductFacets,
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
    this.state = { hasError: false, recovering: false, offline: false };
    this.unmounted = false;
    this.handleOnline = () => {
      if (this.state.offline) window.location.reload();
    };
  }

  componentDidMount() {
    window.addEventListener("online", this.handleOnline);
  }

  componentWillUnmount() {
    this.unmounted = true;
    window.removeEventListener("online", this.handleOnline);
  }

  static getDerivedStateFromError(error) {
    // A chunk that failed to load is a deploy artefact, not a crash: the reload
    // in componentDidCatch fixes it on its own, and the customer lands on the
    // section they asked for. Showing them an error card for the second that
    // takes turns a recovery they never needed to know about into a visible
    // failure -- so while a reload is still possible they get the same skeleton
    // any slow route shows. The card is reserved for what a reload cannot fix.
    return {
      hasError: true,
      recovering: isChunkLoadError(error) && (isChunkRecoveryInFlight() || !hasChunkReloadAttempted()),
    };
  }

  componentDidCatch(error) {
    console.error("[storefront] render error", error);
    // A chunk that failed to load after a deploy is fixed by the reload alone; nothing
    // stored in this browser caused it, so nothing stored is cleared.
    if (isChunkLoadError(error)) {
      // No reload happens when the origin cannot be reached (or one was already used),
      // and the skeleton above would then stay forever. Leave it for the no-connection
      // card, or the error card, whichever applies.
      Promise.resolve(recoverFromChunkLoadError(error))
        .catch(() => false)
        .then((reloading) => {
          // A reload started elsewhere (the lazy import's own retry) is still on its way.
          if (reloading || this.unmounted || isChunkRecoveryInFlight()) return;
          this.setState({ recovering: false, offline: isChunkRecoveryBlockedOffline() });
        });
      return;
    }
    cleanupStorefrontStorage();
    recoverFromChunkLoadError(error);
  }

  render() {
    if (this.state.recovering) return <StorefrontPageFallback />;
    if (this.state.offline) {
      // The page's code never reached the device. Nothing was purged; the `online`
      // listener reloads on its own when the connection returns, the button sooner.
      return (
        <main className="sfx-scope" data-theme={readJson(STOREFRONT_THEME_KEY, "dark") === "light" ? "light" : "dark"}>
          <div className="sfx-wrap sfx-wrap--sm sfx-section">
          <div className="sfx-empty" role="alert">
            <span className="sfx-empty__icon">
              <WifiOff className="h-7 w-7" />
            </span>
            <h1 className="sfx-empty__title">{sfText("storefront.errors.offlineTitle")}</h1>
            <p className="sfx-empty__text">{sfText("storefront.errors.offlineText")}</p>
            <button type="button" onClick={() => window.location.reload()} className="sfx-btn sfx-btn--primary sfx-btn--lg">{sfText("storefront.common.retry")}</button>
          </div>
          </div>
        </main>
      );
    }
    if (this.state.hasError) {
      return (
        // The boundary can render before (or without) the shell body class, so
        // it carries its own `.sfx-scope`: inside the shell that is inert and
        // Site Studio still wins; outside it the same tokens and primitives apply.
        <main className="sfx-scope" data-theme={readJson(STOREFRONT_THEME_KEY, "dark") === "light" ? "light" : "dark"}>
          <div className="sfx-wrap sfx-wrap--sm sfx-section">
          <div className="sfx-empty">
            <span className="sfx-empty__icon">
              <Sparkles className="h-7 w-7" />
            </span>
            <h1 className="sfx-empty__title">{sfText("storefront.errors.simpleProblem")}</h1>
            <p className="sfx-empty__text">{sfText("storefront.errors.cleanedTemporaryData")}</p>
            <button type="button" onClick={() => forceCleanReload()} className="sfx-btn sfx-btn--primary sfx-btn--lg">{sfText("storefront.common.refreshPage")}</button>
          </div>
          </div>
        </main>
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

