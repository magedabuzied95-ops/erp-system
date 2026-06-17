import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { memo, useCallback } from "react";
import { useDeferredValue } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { lazy, Suspense } from "react";
import i18n, { applyDocumentLanguage, normalizeLanguage, persistApplicationLanguage } from "../i18n/i18n";
import { logPagePerf } from "../shared/lib/perfDebug";
import { safeSetSessionStorage } from "../utils/safeStorage";
import {
  Bell,
  BadgePercent,
  Baby,
  Briefcase,
  Camera,
  Check,
  ChevronLeft,
  Copy,
  Crown,
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
  PackageCheck,
  PackageSearch,
  Phone,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Send,
  ShieldCheck,
  Share2,
  Tag,
  RefreshCcw,
  Moon,
  Trash2,
  Truck,
  Upload,
  User,
  Users,
  Sun,
  X,
} from "lucide-react";
import { api } from "../shared/api/api";
import { API_BASE_URL } from "../shared/constants/app";
import { resolveProductImageUrl } from "../shared/lib/imageUrls";
import { formatCurrency, getCurrency } from "../shared/lib/currency";
import { useProductClassifications } from "../modules/products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../modules/products/lib/productClassifications";
import useDismissableLayer from "../shared/hooks/useDismissableLayer";
import { isMirrorProduct, mirrorProductTitle } from "../shared/lib/mirrorProduct";
import { applyProductSocialMeta, productToSocialMeta } from "../shared/lib/socialMeta";
import { displayPublicOrderNumber } from "../shared/utils/publicOrderNumber";
import { defaultEgyptShippingLocations } from "../../shared/egyptShippingLocations.js";
import { VirtualGrid, VirtualList } from "../shared/components/VirtualList";
import { MobileBottomSheet } from "../shared/components/mobile/ResponsiveMobile";
import { getStorefrontResponsiveImageProps } from "../shared/lib/storefrontImage";
import instaPayLogo from "../assets/payments/instapay.png";
import instaPayLogoWebp from "../assets/payments/instapay.webp";
import vodafoneCashLogo from "../assets/payments/vodafone-cash.png";
import vodafoneCashLogoWebp from "../assets/payments/vodafone-cash.webp";

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const MOJIBAKE_BYTE_MARKER_RE = /[?U?A]/;
const MOJIBAKE_SYMBOL_RE = /[…›™ƒ‚]/;
const SUSPICIOUS_ARABIC_GLYPH_RE = /[\uFFFD]/;

const countMatches = (value, pattern) => String(value || "").match(pattern)?.length || 0;

const getArabicTextMetrics = (value = "") => {
  const text = String(value ?? "");
  const compactText = text.replace(/\s+/g, "");
  return {
    text,
    compactText,
    arabicCount: countMatches(text, ARABIC_RE),
    suspiciousGlyphCount: countMatches(text, SUSPICIOUS_ARABIC_GLYPH_RE),
    mojibakeByteCount: countMatches(text, MOJIBAKE_BYTE_MARKER_RE),
    mojibakeSymbolCount: countMatches(text, MOJIBAKE_SYMBOL_RE),
  };
};

const isLikelyArabicMojibake = (value) => {
  const { compactText, arabicCount, suspiciousGlyphCount, mojibakeByteCount, mojibakeSymbolCount } = getArabicTextMetrics(value);
  if (!compactText) return false;

  if (mojibakeByteCount > 0 || mojibakeSymbolCount > 0) return true;
  if (arabicCount < 4) return false;

  const suspiciousCount = suspiciousGlyphCount;
  if (suspiciousCount < 4) return false;

  const suspiciousDensity = suspiciousCount / Math.max(1, compactText.length);
  const suspiciousToArabicRatio = suspiciousCount / Math.max(1, arabicCount);

  return suspiciousDensity >= 0.28 || suspiciousToArabicRatio >= 0.35;
};

const getWindows1256ReverseMap = (() => {
  let reverseMap = null;
  return () => {
    if (reverseMap) return reverseMap;
    if (typeof TextDecoder === "undefined") return null;

    try {
      const decoder = new TextDecoder("windows-1256");
      const map = new Map();
      for (let byte = 0; byte < 256; byte += 1) {
        const char = decoder.decode(Uint8Array.of(byte));
        if (char && !map.has(char)) map.set(char, byte);
      }
      reverseMap = map;
      return reverseMap;
    } catch {
      return null;
    }
  };
})();

const repairArabicMojibakeText = (value) => {
  if (typeof value !== "string") return value;
  if (!value || !isLikelyArabicMojibake(value)) return value;

  const reverseMap = getWindows1256ReverseMap();
  if (!reverseMap || typeof TextDecoder === "undefined") return value;

  try {
    const bytes = [];
    for (const char of value) {
      const byte = reverseMap.get(char);
      if (byte === undefined) return value;
      bytes.push(byte);
    }

    const repaired = new TextDecoder("utf-8").decode(Uint8Array.from(bytes));
    return repaired && repaired !== value ? repaired : value;
  } catch {
    return value;
  }
};

const repairArabicMojibakeDeep = (value) => {
  if (typeof value === "string") return repairArabicMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairArabicMojibakeDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, repairArabicMojibakeDeep(entry)]));
  }
  return value;
};

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
  return identifier ? `/shop/product/${encodeURIComponent(identifier)}` : "/shop/products";
};
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
  const linkedProductPath = linkedPath.startsWith("/shop/product/") ? linkedPath : "";
  return appendProductUrlParams(linkedProductPath || productBaseUrl(product), [
    ["variant", variantId],
    ["color", color],
  ]);
};

const compactStorefrontReceipt = (payload = {}, meta = {}) => ({
  order: payload.order || {},
  items: Array.isArray(payload.items) ? payload.items : [],
  customer: payload.customer || {},
  checkout: payload.checkout || {},
  ...meta,
});

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
const money = (value) => formatCurrency(Number(value || 0));
const sfText = (key, fallback, options = {}) => repairArabicMojibakeText(i18n.t(String(key || ""), { defaultValue: fallback, ...options }));
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
  return sfText(key, String(reason || "").trim() || "كود الخصم غير صالح");
};
const truthyFlag = (value) => value === true || value === 1 || String(value || "").toLowerCase() === "true";
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
const useProducts = (params = {}) => {
  const randomSeedRef = useRef(`${Date.now()}-${Math.random()}`);
  const queryKey = JSON.stringify(params);
  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    const queryParams = JSON.parse(queryKey || "{}");
    Object.entries(queryParams).forEach(([key, value]) => {
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
    if (!queryParams.sort) query.set("random_seed", randomSeedRef.current);
    query.set("_last_piece_scope", "product");
    return query.toString();
  }, [queryKey]);
  const requestUrl = `/storefront/products${queryString ? `?${queryString}` : ""}`;
  const cachedProductsData = getCachedStorefrontGetData(requestUrl, { ttlMs: STOREFRONT_PRODUCTS_CACHE_TTL_MS });
  const [state, setState] = useState(() => {
    const initialProducts = Array.isArray(cachedProductsData?.products) ? cachedProductsData.products : [];
    return cachedProductsData ? { loading: false, error: "", products: initialProducts } : { loading: true, error: "", products: [] };
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
      });
    }
    cachedStorefrontGet(requestUrl, { ttlMs: STOREFRONT_PRODUCTS_CACHE_TTL_MS })
      .then((data) => {
        const products = Array.isArray(data.products) ? data.products : [];
        if (import.meta.env.DEV) {
          console.debug("[storefront-color-card-response]", products.map((product) => ({
            card_id: product?.card_id,
            parent_product_id: product?.parent_product_id,
            color: product?.color || product?.display_color,
            selected_variant_id: product?.selected_variant_id || product?.display_variant_id,
            image_url: product?.image_url,
            sizes: product?.sizes,
          })));
        }
        if (!cancelled) setState({ loading: false, error: "", products });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error || "Failed to load products");
        setState({ loading: false, error: message, products: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [queryString, requestUrl]);

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

const useStorefrontHome = () => {
  const [state, setState] = useState({ loading: true, error: "", hero: null, collections: [] });

  useEffect(() => {
    let cancelled = false;
    cachedStorefrontGet("/storefront/home", { ttlMs: STOREFRONT_HOME_CACHE_TTL_MS })
      .then((json) => {
        const home = getStorefrontHomeFromResponse(json);
        const hero = home.hero ? normalizeHomeProduct(home.hero) : null;
        const collections = (Array.isArray(home.featured_collections) ? home.featured_collections : [])
          .map(normalizeHomeCollection)
          .filter((collection) => collection.products.length);
        if (!cancelled) setState({ loading: false, error: "", hero: hero?.id ? hero : null, collections });
      })
      .catch((error) => {
        if (!cancelled && error?.cause?.name !== "AbortError") {
          setState({ loading: false, error: error?.message || "Failed to load storefront home", hero: null, collections: [] });
        }
      });
    return () => {
      cancelled = true;
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

const useLastPiece = (params = {}, options = {}) => {
  const enabled = options.enabled !== false;
  const [state, setState] = useState({ loading: true, error: "", categories: [], sizes: [], products: [], hooks: {} });
  const queryKey = JSON.stringify(params);
  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    const queryParams = JSON.parse(queryKey || "{}");
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    return query.toString();
  }, [queryKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) setState((prev) => ({ ...prev, loading: true, error: "" }));
    });
    cachedStorefrontGet(`/storefront/last-piece${queryString ? `?${queryString}` : ""}`, { ttlMs: STOREFRONT_LAST_PIECE_CACHE_TTL_MS })
      .then((data) => {
        if (!cancelled) {
          setState({
            loading: false,
            error: "",
            categories: data.categories || [],
            sizes: data.sizes || [],
            products: data.products || [],
            hooks: data.hooks || {},
          });
        }
      })
      .catch((error) => {
        if (!cancelled && error?.cause?.name !== "AbortError") {
          setState({ loading: false, error: error.message, categories: [], sizes: [], products: [], hooks: {} });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, queryString]);

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
          setState({ loading: false, error: error?.message || "تعذر تحميل تصنيفات المنتجات", options: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cachedGenderData]);

  return state;
};
const storefrontSaleModeOn = (product = {}, variant = {}) =>
  truthyFlag(variant?.global_sale_enabled) ||
  truthyFlag(variant?.sale_prices_enabled) ||
  truthyFlag(variant?.sale_mode_enabled) ||
  truthyFlag(product?.global_sale_enabled) ||
  truthyFlag(product?.sale_prices_enabled) ||
  truthyFlag(product?.sale_mode_enabled);
const storefrontOriginalPriceCandidates = (product = {}, variant = {}) =>
  [
    product?.custom_compare_price,
    product?.compare_base_price,
    product?.original_price,
    product?.base_price,
    product?.list_price,
    variant?.custom_compare_price,
    variant?.compare_base_price,
    variant?.original_price,
    variant?.base_price,
    variant?.list_price,
    product?.regular_price,
    variant?.regular_price,
    variant?.compare_at_price,
    product?.compare_at_price,
  ].map(Number).filter((value) => Number.isFinite(value) && value > 0);
const storefrontOriginalPrice = (product = {}, variant = {}) => {
  const activePrice = storefrontSaleModeOn(product, variant) && Number(variant?.sale_price ?? product?.sale_price ?? 0) > 0
    ? Number(variant?.sale_price ?? product?.sale_price ?? 0)
    : storefrontSellingPrice(product, variant);
  const candidates = storefrontOriginalPriceCandidates(product, variant);
  return candidates.find((value) => value > activePrice) || candidates[0] || 0;
};
const storefrontSellingPrice = (product = {}, variant = {}) =>
  Number(variant?.selling_price || variant?.price || product?.selling_price || product?.price || product?.regular_price || 0);
const saleActive = (product = {}, variant = {}) => {
  const source = variant && Object.keys(variant || {}).length ? variant : product;
  const sale = Number(source?.sale_price ?? source?.offer_price ?? 0);
  return storefrontSaleModeOn(product, variant) && sale > 0;
};
const displaySellingPrice = (product = {}, variant = {}) => {
  if (saleActive(product, variant)) return Number((variant?.sale_price ?? product?.sale_price) || 0);
  return storefrontSellingPrice(product, variant);
};
const displayLastPieceSellingPrice = (product = {}, variant = {}) => {
  const purchaseSalePrice = Number(
    variant?.last_piece_sale_price ||
      variant?.purchase_invoice_sale_price ||
      variant?.purchase_sale_price ||
      0
  );
  const regular = storefrontSellingPrice(product, variant);
  if (storefrontSaleModeOn(product, variant) && purchaseSalePrice > 0 && regular > 0 && purchaseSalePrice < regular) return purchaseSalePrice;
  return displaySellingPrice(product, variant);
};
const resolveStorefrontPrice = (product = {}, variant = {}) => {
  const num = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const productOriginal =
    num(product?.custom_compare_price) ||
    num(product?.compare_base_price) ||
    num(product?.original_price) ||
    num(product?.base_price) ||
    num(product?.list_price);
  const variantOriginal =
    num(variant?.custom_compare_price) ||
    num(variant?.compare_base_price) ||
    num(variant?.original_price) ||
    num(variant?.base_price) ||
    num(variant?.list_price);
  const activePrice = displaySellingPrice(product, variant);
  const saleModeOn = storefrontSaleModeOn(product, variant);
  const original = [variantOriginal, productOriginal].find((value) => value > activePrice) || 0;
  return {
    sellingPrice: activePrice,
    originalPrice: original,
    saleModeOn,
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
const variantHasStock = (variant = {}) => Number(variant.stock || 0) > 0;
const variantPrimaryImage = (variant = {}) => {
  const images = Array.isArray(variant.images) ? variant.images : Array.isArray(variant.color_images) ? variant.color_images : [];
  const primary = images.find((image) => image?.is_primary) || images[0] || null;
  return compactImageValue(primary?.image_url || primary?.preview || variant.image_url || variant.image || variant.photo_url || variant.thumbnail_url);
};
const variantImage = (variant = {}) => variantPrimaryImage(variant);
const variantImages = (variant = {}) => {
  const images = Array.isArray(variant.images) ? variant.images : Array.isArray(variant.color_images) ? variant.color_images : [];
  return [
    ...images.map((image) => compactImageValue(image?.image_url || image?.preview || image?.url || "")),
    variantImage(variant),
  ].filter(Boolean).reduce((acc, image) => (acc.includes(image) ? acc : [...acc, image]), []);
};
const variantColorName = (variant = {}) =>
  cleanDisplayText(variant.color_name || variant.edition_name || variant.color || variant.color_slug || "Default") || "Default";
const variantColorKey = (variant = {}) => {
  const stable = variant.color_id || variant.color_slug || variant.edition_slug || variantColorName(variant);
  return String(stable || "Default").trim().toLowerCase();
};
const firstVariantImage = (variants = []) => variantImage(variants.find((variant) => variantHasStock(variant) && variantImage(variant))) || variantImage(variants.find((variant) => variantImage(variant)));
const firstDisplayVariant = (variants = []) =>
  variants.find((variant) => variantHasStock(variant) && variantImage(variant)) ||
  variants.find((variant) => variantHasStock(variant)) ||
  variants.find((variant) => variantImage(variant)) ||
  variants[0];
const displayImageForProduct = (product = {}, variant = null) => variantImage(variant || {}) || firstVariantImage(product.variants || []) || product.image_url || product.gallery_images?.[0];
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
const hasSale = (product = {}) => {
  const sale = Number(product?.sale_price ?? product?.offer_price ?? 0);
  const regular = storefrontSellingPrice(product);
  return storefrontSaleModeOn(product) && sale > 0 && regular > 0 && sale < regular;
};
const LAST_PIECE_MAX_STOCK = 3;
const sellableVariantStock = (variant = {}) => {
  const stock = Number(variant.stock);
  return Number.isFinite(stock) && stock > 0 ? Math.floor(stock) : 0;
};
const isCriticalLowStockVariant = (variant = {}) => {
  const stock = sellableVariantStock(variant);
  return stock >= 1 && stock <= LAST_PIECE_MAX_STOCK;
};
const isLastPieceProduct = (product = {}) => {
  const totalStock = productTotalStock(product);
  return totalStock > 0 && totalStock <= LAST_PIECE_MAX_STOCK;
};
const lastPieceProductUrl = (product, variant = {}) => {
  return appendProductUrlParams(productBaseUrl(product), [
    ["variant", variant.edition_slug || variant.id || ""],
    ["size", variant.size || ""],
    ["color", variant.color || ""],
  ]);
};
const lastPieceProductVariants = (product = {}, limit = 3) => (
  (Array.isArray(product?.variants) ? product.variants : [])
    .filter((variant) => sellableVariantStock(variant) > 0)
    .sort((a, b) =>
      sellableVariantStock(a) - sellableVariantStock(b) ||
      String(a.size || "").localeCompare(String(b.size || ""), "ar", { numeric: true }) ||
      String(a.color || "").localeCompare(String(b.color || ""), "ar", { numeric: true })
    )
    .slice(0, limit)
);
const lastPieceMatchingVariant = (product = {}, selectedSize = "") => {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const targetSize = String(selectedSize || "").trim().toLowerCase();
  const candidates = targetSize
    ? variants.filter((variant) => String(variant?.size || "").trim().toLowerCase() === targetSize && sellableVariantStock(variant) > 0)
    : variants.filter((variant) => sellableVariantStock(variant) > 0);
  return candidates.sort((a, b) =>
    sellableVariantStock(a) - sellableVariantStock(b) ||
    String(a.size || "").localeCompare(String(b.size || ""), "ar", { numeric: true }) ||
    String(a.color || "").localeCompare(String(b.color || ""), "ar", { numeric: true })
  )[0] || null;
};
const normalizeAudienceValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["men", "man", "male", "mens", "رجالي", "رجال"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies", "lady", "نسائي", "نساء", "حريمي"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls", "أطفال", "أولاد"].includes(normalized)) return "kids";
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
  visit(product.audience);
  visit(product.audiences);
  visit(product.gender);
  visit(product.genders);
  visit(product.product_audience);
  visit(product.product_audiences);
  visit(product.target_audience);
  return Array.from(seen);
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
  return Array.from(groups.values());
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
const getSizesForColorGroup = (activeColorGroup = {}) => {
  const sizes = new Map();
  (Array.isArray(activeColorGroup?.variants) ? activeColorGroup.variants : []).forEach((variant) => {
    const size = String(variant?.size || "").trim();
    if (!size || !variantHasStock(variant) || sizes.has(size)) return;
    sizes.set(size, { size, variant });
  });
  return Array.from(sizes.values());
};

const repairedDefaultEgyptShippingLocations = repairArabicMojibakeDeep(defaultEgyptShippingLocations);

const OrderInvoiceCard = lazy(() => import("../shared/components/invoices/OrderInvoiceCard"));
const Select = lazy(() => import("react-select"));
const LazyFiltersDrawer = lazy(() => Promise.resolve({ default: MobileFilterDrawer }));
const LazyStorefrontProductListingPage = lazy(() => import("./pages/StorefrontProductListingPage.jsx").then((module) => ({ default: module.StorefrontProductListingPage })));
const LazyStorefrontProductDetailPage = lazy(() => import("./pages/StorefrontProductDetailPage.jsx").then((module) => ({ default: module.StorefrontProductDetailPage })));
const LazyProductCardVariantSheet = lazy(() => Promise.resolve({ default: ProductCardVariantSheet }));
const LazyProductDetailsVariantSheet = lazy(() => Promise.resolve({ default: ProductDetailsVariantSheet }));
const LazyStorefrontAiSupportWidget = lazy(() => import("./components/StorefrontAiSupportWidget"));
const LazyStorefrontCheckoutSummary = lazy(() => import("./components/StorefrontCheckoutSummary"));
const LazyStorefrontVisualSearchResults = lazy(() => import("./components/StorefrontVisualSearchResults"));
const LazyStorefrontProductGallery = lazy(() => import("./components/StorefrontProductGallery"));
const LazyStorefrontCartPage = lazy(() => import("./pages/StorefrontAsyncPages").then((module) => ({ default: module.CartPageRoute })));
const LazyStorefrontTrackOrderPage = lazy(() => import("./pages/StorefrontAsyncPages").then((module) => ({ default: module.TrackOrderPage })));
const LazyStorefrontAccountPage = lazy(() => import("./pages/StorefrontAccountPage.jsx").then((module) => ({ default: module.StorefrontAccountPage })));
const LazyStorefrontWishlistPage = lazy(() => import("./pages/StorefrontAsyncPages").then((module) => ({ default: module.WishlistPageRoute })));
const LazyStorefrontRecentPage = lazy(() => import("./pages/StorefrontAsyncPages").then((module) => ({ default: module.RecentPageRoute })));

const CART_KEY = "storefront.cart";
const LEGACY_CART_KEYS = [
  "cart",
  "storefrontCart",
  "storefront_cart",
  "storefrontCartItems",
  "storefront.cart.items",
  "tiger_cart",
  "posCart",
];
const WISHLIST_KEY = "storefront.wishlist";
const RECENT_KEY = "storefront.recent";
const PROFILE_KEY = "storefront.profile";
const THEME_KEY = "storefront.theme";
const CUSTOMER_SESSION_TOKEN_KEY = "storefront.customer_session_token";
const CUSTOMER_CAPTURE_SKIP_KEY = "storefront.customer_capture_skip_until";
const CUSTOMER_CAPTURE_SHOWN_KEY = "storefront.customer_capture_shown";
const CUSTOMER_CAPTURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const STOREFRONT_SPLASH_SEEN_KEY = "m1_store_splash_seen";
const STOREFRONT_SPLASH_DURATION_MS = 1100;
const storefrontGetCache = new Map();
const storefrontGetInFlight = new Map();
const storefrontProductDetailsCache = new Map();
const storefrontProductDetailsInFlight = new Map();
const storefrontPrefetchedDetails = new Set();
const STOREFRONT_GET_CACHE_TTL_MS = 60 * 1000;
const STOREFRONT_PRODUCTS_CACHE_TTL_MS = 30 * 1000;
const STOREFRONT_HOME_CACHE_TTL_MS = 60 * 1000;
const STOREFRONT_BRANDS_CACHE_TTL_MS = 10 * 60 * 1000;
const STOREFRONT_GENDER_CACHE_TTL_MS = 10 * 60 * 1000;
const STOREFRONT_LAST_PIECE_CACHE_TTL_MS = 20 * 1000;
const STOREFRONT_PRODUCT_DETAILS_CACHE_TTL_MS = 60 * 1000;
const STOREFRONT_PREFETCH_LIMIT = 12;
const storefrontDebugLog = (label, payload = {}) => {
  if (!import.meta.env.DEV) return;
  console.log(label, payload);
};
const cachedStorefrontGet = (url, { ttlMs = STOREFRONT_GET_CACHE_TTL_MS } = {}) => {
  if (ttlMs <= 0) {
    storefrontDebugLog("[storefront-cache-miss]", { url, ttlMs, strategy: "no-store" });
    return api.get(url, { cache: "no-store", headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  }
  const now = Date.now();
  const cached = storefrontGetCache.get(url);
  if (cached && now - cached.at < ttlMs) {
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
      return data;
    })
    .finally(() => {
      storefrontGetInFlight.delete(url);
    });
  storefrontGetInFlight.set(url, request);
  return request;
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
      THEME_KEY,
    ].forEach((key) => window.localStorage.removeItem(key));
    Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter(Boolean).forEach((key) => {
      if (STOREFRONT_CACHE_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`) || key.startsWith(`${prefix}:`))) {
        window.localStorage.removeItem(key);
      }
    });
  } catch {}
};
const getSuccessMessages = () => {
  const messages = i18n.t("storefront.toasts.successMessages", { returnObjects: true });
  return Array.isArray(messages) && messages.length ? messages : ["اختيار ممتاز", "طلبك يتم تجهيزه الآن", "اختيار قوي", "سنجهزه لك بأسرع وقت"];
};

const getConversionTrustPoints = () => {
  const points = i18n.t("storefront.home.trustPoints", { returnObjects: true });
  return Array.isArray(points) && points.length ? points : ["دفع آمن", "تبديل سهل", "صور حقيقية", "شحن سريع"];
};

const homeSellingBadges = [
  { labelAr: "شحن سريع", labelEn: "Fast shipping", icon: Truck },
  { labelAr: "استبدال خلال 14 يومًا", labelEn: "14-day exchange", icon: RefreshCcw },
  { labelAr: "دفع آمن", labelEn: "Secure payment", icon: ShieldCheck },
  { labelAr: "صور حقيقية", labelEn: "Real photos", icon: Camera },
];

const storefrontApi = {
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
  if (!key) return;
  if (storefrontPrefetchedDetails.has(key)) return;
  if (storefrontPrefetchedDetails.size >= STOREFRONT_PREFETCH_LIMIT) return;
  storefrontPrefetchedDetails.add(key);
  storefrontDebugLog("[storefront-prefetch-count]", {
    count: storefrontPrefetchedDetails.size,
    identifier: key,
  });
  void storefrontApi.getProductDetails(key, { ttlMs: STOREFRONT_PRODUCT_DETAILS_CACHE_TTL_MS }).catch(() => {
    storefrontPrefetchedDetails.delete(key);
  });
};
const productFromDetailsResponse = (data = {}) => data?.product || data?.data?.product || (data?.id ? data : null);
const MANUAL_CITY_AREA = "الاختيار اليدوي";
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
const DEFAULT_STOREFRONT_PAYMENT_SETTINGS = repairArabicMojibakeDeep({
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
});
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
];
const SHIPPING_CONFIRMATION_METHODS = new Set(["shipping_confirmation", "instapay", "vodafone_cash"]);
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
const normalizeShippingPaymentMethod = (value) => {
  const raw = rawOptionValue(value).toLowerCase();
  return raw === "vodafone_cash" ? "vodafone_cash" : "instapay";
};
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

const buildLatestCheckoutAddress = (customer = null, order = null) => {
  if (!order) return null;
  const text = (value) => String(value || "").trim();
  const shippingCityId = text(order.shipping_city_id);
  const shippingZoneId = text(order.shipping_zone_id);
  const shippingDistrictId = text(order.shipping_district_id);
  const governorate = text(order.governorate || order.shipping_city_name_ar || order.shipping_city_name_en);
  const cityArea = text(order.city_area || order.shipping_district_name_ar || order.shipping_district_name_en || order.shipping_zone_name_ar || order.shipping_zone_name_en);
  const detailedAddress = text(order.customer_address || order.shipping_address_line || "");
  const streetAddress = text(order.street_address || order.shipping_address?.street_address || order.shipping_provider_address?.street_address || detailedAddress);
  const buildingNumber = text(order.building_number || order.shipping_address?.building_number || order.shipping_provider_address?.building_number);
  const floorNumber = text(order.floor_number || order.shipping_address?.floor_number || order.shipping_provider_address?.floor_number);
  const apartmentNumber = text(order.apartment_number || order.shipping_address?.apartment_number || order.shipping_provider_address?.apartment_number);
  const landmark = text(order.landmark || order.shipping_address?.landmark || order.shipping_provider_address?.landmark);
  const deliveryNotes = text(order.delivery_notes || order.shipping_address?.delivery_notes || order.shipping_provider_address?.notes);
  const fullName = text(order.customer_name || customer?.name);
  const primaryPhone = text(order.customer_phone || customer?.phone);

  const candidate = {
    full_name: fullName,
    primary_phone: primaryPhone,
    governorate,
    city_area: cityArea,
    detailed_address: detailedAddress,
    street_address: streetAddress,
    building_number: buildingNumber,
    floor_number: floorNumber,
    apartment_number: apartmentNumber,
    landmark,
    delivery_notes: deliveryNotes,
    governorate_id: text(order.governorate_id || order.shipping_city_id || ""),
    city_id: text(order.city_id || order.shipping_city_id || ""),
    area_id: text(order.area_id || order.shipping_district_id || order.district_id || ""),
    zone_id: text(order.zone_id || order.shipping_zone_id || ""),
    district_id: text(order.district_id || order.shipping_district_id || ""),
    shipping_city_id: shippingCityId,
    shipping_zone_id: shippingZoneId,
    shipping_district_id: shippingDistrictId,
  };

  return Object.values(candidate).some(Boolean) ? candidate : null;
};
const paymentLogoPreloadUrls = Object.values(paymentBrandLogos).flatMap((logo) => [logo.webp, logo.png].filter(Boolean));
const whatsappPhone = String(import.meta.env.VITE_WHATSAPP_PHONE || import.meta.env.VITE_STORE_WHATSAPP || "").replace(/\D/g, "");
const getStatusLabels = () => {
  const labels = i18n.t("storefront.orders.timelineLabels", { returnObjects: true });
  return Array.isArray(labels) && labels.length ? labels : ["Order received", "Preparing", "Shipped", "On the way", "Delivered"];
};
const SEARCH_RECENT_KEY = "storefront.search.recent";
const reason = "";
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
const isQuotaError = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014;

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

const featuredCategoryDefinitions = [
  {
    id: "men",
    labelEn: "Men",
    labelAr: "رجالي",
    headlineEn: "Latest Men's Shoes",
    headlineAr: "أحدث أحذية الرجال",
    subtitleEn: "Fresh sneakers, daily picks, and standout sizes for every look.",
    subtitleAr: "سنيكرز جديدة، اختيارات يومية، ومقاسات مميزة لكل إطلالة.",
    query: "Jordan 4 Nike Shox Air Force Adidas Campus رجالي",
    href: "/shop/products?gender=men",
    examples: ["Jordan 4", "Nike Shox", "Air Force", "Adidas Campus"],
    test: (product, text) => productAudienceValues(product).includes("men") || /men|mens|male|.{3,5}/i.test(text),
    icon: Briefcase,
  },
  {
    id: "women",
    labelEn: "Women",
    labelAr: "حريمي",
    headlineEn: "New Women's Collection",
    headlineAr: "مجموعة الحريمي الجديدة",
    subtitleEn: "Soft colors, bold silhouettes, and everyday favorites in one edit.",
    subtitleAr: "ألوان ناعمة، قصات جريئة، ومفضلات يومية في اختيار واحد.",
    query: "Nike Adidas Jordan حريمي",
    href: "/shop/products?gender=women",
    examples: ["Nike", "Adidas", "Jordan"],
    test: (product, text) => productAudienceValues(product).includes("women") || /women|womens|female|ladies|.{3,5}/i.test(text),
    icon: Users,
  },
  {
    id: "kids",
    labelEn: "Kids",
    labelAr: "أطفال",
    headlineEn: "Kids Essentials",
    headlineAr: "أساسيات الأطفال",
    subtitleEn: "Built for school, play and movement.",
    subtitleAr: "مصممة للمدرسة، اللعب والحركة.",
    query: "kids children school play أطفال",
    href: "/shop/products?gender=kids",
    examples: ["kids", "children", "school", "play"],
    test: (product, text) => productAudienceValues(product).includes("kids") || /kids?|children|child|.{3,5}/i.test(text),
    icon: Baby,
  },
  {
    id: "offers",
    labelEn: "Offers",
    labelAr: "عروض",
    headlineEn: "Season Offers",
    headlineAr: "عروض الموسم",
    subtitleEn: "Selected discounts and high-value picks for a limited time.",
    subtitleAr: "خصومات مختارة وقطع عالية القيمة لفترة محدودة.",
    query: "offers sale discount عروض",
    href: "/shop/products?sale=true",
    examples: ["Sale", "Discount", "Offers", "Best Price"],
    test: (product, text) => hasSale(product) || /offer|offers|sale|discount|.{3,5}/i.test(text),
    icon: BadgePercent,
  },
  {
    id: "crocs",
    labelEn: "Crocs",
    labelAr: "كروكس",
    headlineEn: "Crocs Picks",
    headlineAr: "اختيارات كروكس",
    subtitleEn: "Easy comfort, summer colors, and quick everyday pairs.",
    subtitleAr: "راحة سهلة، ألوان صيفية، وقطع يومية خفيفة.",
    query: "crocs crocband classic clog slides كروكس",
    href: "/shop/products?category=crocs",
    examples: ["Crocs", "Crocband", "Classic Clog", "Slides"],
    test: (_product, text) => /crocs?|crocband|classics*clog|slides|.{3,5}/i.test(text),
    icon: Footprints,
  },
  {
    id: "last-sizes",
    labelEn: "Last Sizes",
    labelAr: "آخر المقاسات",
    headlineEn: "Last Sizes",
    headlineAr: "آخر المقاسات",
    subtitleEn: "Limited pairs with final sizes before they disappear.",
    subtitleAr: "أزواج محدودة بالمقاسات الأخيرة قبل نفادها.",
    query: "last sizes final size آخر المقاسات",
    href: "/shop/products?stock=last",
    examples: ["Last Sizes", "Final Size", "Limited Stock"],
    test: (_product, text) => /lasts*sizes|finals*size|.{3,5} .{3,5}|.{3,5} .{3,5} .{3,5}/i.test(text),
    icon: PackageSearch,
  },
];

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
  const price = displaySellingPrice(product, variant);
  const comparePrice = displayComparePrice(product, variant);
  return { product, variant, image, price, comparePrice };
};

const displayCartItemPrice = (item = {}) => {
  const regular = Number(item.selling_price || item.price || 0);
  const sale = Number(item.sale_price || 0);
  const saleModeOn = truthyFlag(item.global_sale_enabled) || truthyFlag(item.sale_prices_enabled) || truthyFlag(item.sale_mode_enabled);
  return saleModeOn && sale > 0 ? sale : regular;
};

const displayCartItemComparePrice = (item = {}) => {
  const activePrice = displayCartItemPrice(item);
  const original = Number(item.original_price || item.base_price || item.list_price || item.compare_at_price || item.regular_price || 0);
  return original > activePrice ? original : 0;
};

const displayDiscountPercent = (product = {}, variant = {}) => {
  const sellingPrice = displaySellingPrice(product, variant);
  const comparePrice = displayComparePrice(product, variant);
  return comparePrice > sellingPrice ? Math.max(1, Math.round(((comparePrice - sellingPrice) / comparePrice) * 100)) : 0;
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
const storefrontPathFromLink = (value = "") => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, typeof window !== "undefined" ? window.location.origin : "https://storefront.local");
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return raw.startsWith("/") ? raw : "";
  }
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
  const itemFirstImage = firstArrayItem(item.images);
  const productFirstImage = firstArrayItem(product.images) || firstArrayItem(product.gallery_images);
  return compactImageValue(
    variant.image_url ||
      variant.image ||
      variant.primary_image ||
      item.image_url ||
      item.image ||
      item.primary_image ||
      item.thumbnail ||
      item.thumbnail_url ||
      itemFirstImage?.image_url ||
      itemFirstImage?.url ||
      itemFirstImage ||
      product.image_url ||
      product.image ||
      product.primary_image ||
      product.thumbnail ||
      product.thumbnail_url ||
      productFirstImage?.image_url ||
      productFirstImage?.url ||
      productFirstImage ||
      ""
  );
};

const displayComparePrice = (product = {}, variant = {}) => {
  const activePrice = displaySellingPrice(product, variant);
  const comparePrice = storefrontOriginalPrice(product, variant);
  return comparePrice > activePrice ? comparePrice : 0;
};

const cleanDisplayText = (value = "") =>
  String(value || "")
    .replace(/\uFFFD/g, "")
    .replace(/\u00e2\u0153\u00a8/g, "")
    .replace(/\u00e2\u20ac\u00a6/g, "...")
    .replace(/\u0637\u0152/g, "ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¥ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط£آ¢أ¢â‚¬â€چط¢آ¢")
    .replace(/\s+/g, " ")
    .trim();
const classificationColor = (option = {}) => option.color || "#6d28d9";
const classificationLabel = (option = {}, lang = "ar") =>
  cleanDisplayText(
    option?.label ||
      option?.name ||
      option?.title ||
      option?.display_name ||
      option?.displayName ||
      option?.slug ||
      option?.value ||
      option?.id ||
      option?.key ||
      (lang === "ar" ? option?.label_ar || option?.name_ar || option?.title_ar : option?.label_en || option?.name_en || option?.title_en) ||
      "",
  ) || "";
const uniqueClassificationOptions = (options = []) => {
  const seen = new Set();
  return (Array.isArray(options) ? options : []).filter((option) => {
    const key = String(option.value || option.id || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function FeaturedCategoriesHeroSkeleton({ lang = "ar", themeMode = "light" }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const darkMode = themeMode === "dark" || (typeof document !== "undefined" && document.body.classList.contains("storefront-dark"));
  return (
    <section className="mx-auto max-w-[1320px] px-4 py-4 md:py-7" dir={isRtl ? "rtl" : "ltr"}>
      <div className={`overflow-hidden rounded-[1.85rem] border shadow-[0_34px_100px_rgba(15,23,42,0.30)] md:rounded-[2.35rem] ${darkMode ? "border-white/10 bg-[#050711]" : "border-slate-200 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.10)]"}`}>
        <div className="grid min-h-[510px] lg:grid-cols-[minmax(0,0.72fr)_minmax(18rem,0.28fr)]">
          <div className="relative min-h-[500px] p-5 md:p-8 lg:min-h-[560px] lg:p-10">
            <div className={`sf-skeleton-shimmer h-8 w-36 rounded-full ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
            <div className={`mt-6 sf-skeleton-shimmer h-16 max-w-2xl rounded-[1.5rem] md:h-28 ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
            <div className={`mt-4 sf-skeleton-shimmer h-4 w-2/3 rounded-full ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
            <div className={`mt-7 sf-skeleton-shimmer h-11 w-36 rounded-full ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
            <div className="mt-10 grid min-h-[220px] grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className={`sf-skeleton-shimmer rounded-[1.5rem] ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
              ))}
            </div>
          </div>
          <aside className={`hidden border-s p-5 shadow-[inset_1px_0_0_rgba(255,255,255,0.06)] lg:block ${darkMode ? "border-white/10 bg-white/[0.045]" : "border-slate-200 bg-slate-50 shadow-[inset_1px_0_0_rgba(15,23,42,0.04)]"}`}>
            <div className={`mb-4 sf-skeleton-shimmer h-5 w-40 rounded-full ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
            <div className="grid gap-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className={`sf-skeleton-shimmer h-12 rounded-xl ${darkMode ? "bg-white/[0.06]" : "bg-slate-200/90"}`} />
              ))}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function ShopByMainCategoriesSkeleton({ lang = "ar", themeMode = "light" }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const darkMode = themeMode === "dark" || (typeof document !== "undefined" && document.body.classList.contains("storefront-dark"));
  return (
    <section className="mx-auto max-w-[1360px] px-4 py-10 md:py-16" dir={isRtl ? "rtl" : "ltr"}>
      <div className="mb-8 flex items-end justify-between gap-3 md:mb-11">
        <div className="min-w-0">
          <div className={`sf-skeleton-shimmer h-3 w-32 rounded-full ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
          <div className={`mt-3 sf-skeleton-shimmer h-12 w-[min(28rem,74vw)] rounded-[1.5rem] md:h-20 ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
        </div>
        <div className={`hidden h-11 w-28 rounded-full sm:block ${darkMode ? "bg-white/5" : "bg-slate-200/90"}`} />
      </div>
      <div className="grid gap-7 md:gap-10">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className={`overflow-hidden rounded-[2.35rem] border shadow-[0_34px_110px_rgba(15,23,42,0.28)] ${darkMode ? "border-white/10 bg-[#050711]" : "border-slate-200 bg-white shadow-[0_34px_110px_rgba(15,23,42,0.10)]"}`}>
            <div className="grid min-h-[300px] gap-4 p-5 md:min-h-[360px] md:grid-cols-[0.45fr_0.55fr] md:p-8 lg:min-h-[400px]">
              <div className="flex flex-col justify-end gap-3">
                <div className={`sf-skeleton-shimmer h-5 w-28 rounded-full ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
                <div className={`sf-skeleton-shimmer h-12 w-[min(22rem,70vw)] rounded-[1.5rem] md:h-20 ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
                <div className={`sf-skeleton-shimmer h-4 w-2/3 rounded-full ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
                <div className={`sf-skeleton-shimmer h-11 w-32 rounded-full ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
              </div>
              <div className={`sf-skeleton-shimmer min-h-[210px] rounded-[1.85rem] md:min-h-[280px] ${darkMode ? "bg-white/10" : "bg-slate-200/90"}`} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeaturedCategoriesHero({ products = [], lang = "ar", loading = false, themeMode = "light" }) {
  const { t } = useTranslation();
  const isRtl = normalizeLanguage(lang) === "ar";
  const darkMode = themeMode === "dark" || (typeof document !== "undefined" && document.body.classList.contains("storefront-dark"));
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [slideIndex, setSlideIndex] = useState(0);
  const [manualTick, setManualTick] = useState(0);

  const categories = useMemo(() => {
    const sourceProducts = uniqueProductsByIdentity(products)
      .filter((product) => product?.id && product?.name && isAvailableProduct(product))
      .map(featuredSlideProduct)
      .filter((item) => item.image);

    return featuredCategoryDefinitions
      .map((definition) => {
        const keywordPattern = new RegExp(definition.examples.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
        const exactSlides = sourceProducts.filter(({ product }) => keywordPattern.test(productSearchText(product)));
        const matchedSlides = sourceProducts.filter(({ product }) => definition.test(product, productSearchText(product)));
        const slides = uniqueProductsByIdentity([...exactSlides, ...matchedSlides, ...sourceProducts].map((item) => item.product))
          .map(featuredSlideProduct)
          .filter((item) => item.image)
          .slice(0, 6);
        return {
          ...definition,
          label: isRtl ? definition.labelAr : definition.labelEn,
          slides,
        };
      })
      .filter((category) => category.slides.length);
  }, [isRtl, products]);

  useEffect(() => {
    if (!categories.length) return;
    if (!categories.some((category) => category.id === activeCategoryId)) {
      setActiveCategoryId(categories[0].id);
      setSlideIndex(0);
    }
  }, [activeCategoryId, categories]);

  const activeCategory = categories.find((category) => category.id === activeCategoryId) || categories[0];
  const slides = activeCategory?.slides || [];
  const activeSlide = slides[slideIndex % Math.max(slides.length, 1)] || slides[0];

  useEffect(() => {
    if (slides.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setSlideIndex((current) => (current + 1) % slides.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeCategory?.id, manualTick, slides.length]);

  const pickCategory = (categoryId) => {
    setActiveCategoryId(categoryId);
    setSlideIndex(0);
    setManualTick((current) => current + 1);
  };
  const moveSlide = (direction) => {
    if (!slides.length) return;
    setSlideIndex((current) => (current + direction + slides.length) % slides.length);
    setManualTick((current) => current + 1);
  };

  if (!activeCategory || !activeSlide) return loading ? <FeaturedCategoriesHeroSkeleton lang={lang} /> : null;

  const { product, image } = activeSlide;
  const ActiveIcon = activeCategory.icon;
  const cta = isRtl ? "تسوّق الفئة" : t("storefront.common.shopCategory", "Shop category");
  const headline = isRtl ? activeCategory.headlineAr : activeCategory.headlineEn;
  const subtitle = isRtl ? activeCategory.subtitleAr : activeCategory.subtitleEn;
  const categoryHref = activeCategory.href || `/shop/products?q=${encodeURIComponent(activeCategory.query || activeCategory.label)}`;
  const supportingSlides = [activeSlide, ...slides.filter((slide) => slide.product?.id !== activeSlide.product?.id)].slice(0, 5);

  return (
    <section className="mx-auto max-w-[1320px] px-4 pb-4 pt-4 md:pb-7 md:pt-7" dir={isRtl ? "rtl" : "ltr"}>
      <div className={`overflow-hidden rounded-[1.85rem] border shadow-[0_34px_100px_rgba(15,23,42,0.30)] md:rounded-[2.35rem] ${darkMode ? "border-white/10 bg-[#050711]" : "border-slate-200 bg-white shadow-[0_34px_100px_rgba(15,23,42,0.10)]"}`}>
        <div className={`sf-scroll flex gap-2 overflow-x-auto border-b p-2 lg:hidden ${darkMode ? "border-white/10 bg-white/[0.045]" : "border-slate-200 bg-slate-50"}`}>
          {categories.map((category) => {
            const active = category.id === activeCategory.id;
            return (
              <Link key={category.id} to={category.href} onMouseEnter={() => pickCategory(category.id)} onFocus={() => pickCategory(category.id)} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-xs font-black transition active:scale-[0.98] ${darkMode ? (active ? "border-white bg-white text-stone-950" : "border-white/10 bg-white/[0.06] text-white/76 hover:border-[#f8e7b3]/45 hover:text-white") : (active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-[#7c3aed]/30 hover:text-slate-950")}`}>
                {category.label}
                <ChevronLeft className={`h-3.5 w-3.5 shrink-0 ${isRtl ? "" : "rotate-180"}`} />
              </Link>
            );
          })}
        </div>
        <div className="grid min-h-[510px] lg:grid-cols-[minmax(0,0.72fr)_minmax(18rem,0.28fr)] lg:[direction:ltr]">
          <Link
            to={categoryHref}
            className={`group relative flex min-h-[500px] overflow-hidden lg:min-h-[560px] lg:[direction:rtl] ${darkMode ? "bg-[radial-gradient(circle_at_74%_36%,rgba(248,231,179,0.23),transparent_24%),radial-gradient(circle_at_18%_18%,rgba(124,58,237,0.22),transparent_32%),linear-gradient(135deg,#090b16_0%,#111827_54%,#020617_100%)]" : "bg-[radial-gradient(circle_at_74%_36%,rgba(124,58,237,0.10),transparent_26%),radial-gradient(circle_at_18%_18%,rgba(248,231,179,0.28),transparent_30%),linear-gradient(135deg,#ffffff_0%,#f8fafc_56%,#eef2ff_100%)]"}`}
          >
            <div className={`pointer-events-none absolute inset-0 ${darkMode ? "bg-[linear-gradient(120deg,rgba(255,255,255,0.08),transparent_34%,rgba(0,0,0,0.42))]" : "bg-[linear-gradient(120deg,rgba(255,255,255,0.54),transparent_34%,rgba(255,255,255,0.06))]"}`} />
            <div className={`pointer-events-none absolute inset-x-0 bottom-0 h-1/2 ${darkMode ? "bg-gradient-to-t from-black/52 to-transparent" : "bg-gradient-to-t from-white/90 to-transparent"}`} />
            <div className={`absolute end-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-black shadow-sm backdrop-blur ${darkMode ? "border-white/12 bg-white/10 text-white" : "border-slate-200 bg-white/85 text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"}`}>
              <ActiveIcon className="h-4 w-4" />
              {activeCategory.label}
            </div>
            <div className="absolute start-4 top-4 z-20 flex gap-2">
              <button type="button" onClick={(event) => { event.preventDefault(); moveSlide(isRtl ? 1 : -1); }} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border shadow-sm backdrop-blur transition-[background-color,color,opacity,transform] duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 ${darkMode ? "border-transparent bg-white/10 text-white hover:bg-white/16 hover:text-white focus-visible:ring-white/35" : "border-slate-200 bg-white/90 text-slate-700 hover:bg-white hover:text-slate-950 focus-visible:ring-slate-300"}`} aria-label="ظˆط§طھط³ط§ط¨">
                <ChevronLeft className={`h-4 w-4 ${isRtl ? "rotate-180" : ""}`} />
              </button>
              <button type="button" onClick={(event) => { event.preventDefault(); moveSlide(isRtl ? -1 : 1); }} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border shadow-sm backdrop-blur transition-[background-color,color,opacity,transform] duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 ${darkMode ? "border-transparent bg-white/10 text-white hover:bg-white/16 hover:text-white focus-visible:ring-white/35" : "border-slate-200 bg-white/90 text-slate-700 hover:bg-white hover:text-slate-950 focus-visible:ring-slate-300"}`} aria-label="Next slide">
                <ChevronLeft className={`h-4 w-4 ${isRtl ? "" : "rotate-180"}`} />
              </button>
            </div>
            <div className="relative z-10 grid w-full gap-5 p-5 md:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] md:p-8 lg:p-10">
              <div key={`category-copy-${activeCategory.id}`} className="relative z-20 flex min-h-[12rem] flex-col justify-end self-end pb-2 animate-[sfFadeUp_420ms_ease-out_both] md:min-h-0 md:justify-center md:pb-0">
                <div className={`mb-4 inline-flex w-fit items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-black uppercase tracking-[0.14em] shadow-sm backdrop-blur ${darkMode ? "border-white/12 bg-white/10 text-[#f8e7b3]" : "border-slate-200 bg-white/85 text-[#7c3aed] shadow-[0_10px_24px_rgba(15,23,42,0.08)]"}`}>
                  <ActiveIcon className="h-4 w-4" />
                  {activeCategory.label}
                </div>
                <h1 className={`line-clamp-2 max-w-lg text-4xl font-black leading-[0.98] md:text-6xl lg:text-7xl ${darkMode ? "text-white" : "text-slate-900"}`}>
                  {headline}
                </h1>
                <p className={`mt-4 line-clamp-2 max-w-md text-sm font-bold leading-6 md:text-lg md:leading-8 ${darkMode ? "text-white/68" : "text-slate-600"}`}>
                  {subtitle}
                </p>
                <span className={`mt-7 inline-flex min-h-12 w-fit items-center justify-center rounded-full px-7 text-sm font-black transition group-hover:-translate-y-0.5 ${darkMode ? "bg-[#f8e7b3] text-stone-950 shadow-[0_18px_40px_rgba(248,231,179,0.26)] ring-1 ring-white/10 group-hover:bg-white" : "bg-slate-900 text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] ring-1 ring-slate-200 group-hover:bg-[#7c3aed] group-hover:text-white"}`}>
                  {cta}
                </span>
              </div>
              <div className="relative flex min-h-[290px] items-center justify-center md:min-h-[430px]">
                <div className={`absolute bottom-10 left-1/2 h-10 w-[72%] -translate-x-1/2 rounded-[100%] blur-2xl ${darkMode ? "bg-black/70" : "bg-slate-300/80"}`} />
                {supportingSlides.map((slide, index) => {
                  const active = slide.product?.id === product?.id;
                  return (
                    <img
                      key={`${activeCategory.id}-${productIdentityKey(slide.product, index)}-${slide.image}`}
                      src={imageFor(slide.image)}
                      {...responsiveImageProps(slide.image, "hero")}
                      alt=""
                      onError={fallbackProductImage}
                      className={`absolute object-contain drop-shadow-[0_34px_34px_rgba(0,0,0,0.38)] transition-all duration-700 ease-out ${active ? "z-30 max-h-[310px] w-[88%] opacity-100 animate-[sfFadeUp_420ms_ease-out_both] md:max-h-[455px]" : index === 1 ? "z-20 max-h-[155px] w-[33%] -translate-x-[112%] translate-y-[36%] -rotate-12 opacity-56 md:max-h-[210px]" : index === 2 ? "z-20 max-h-[150px] w-[32%] translate-x-[112%] -translate-y-[34%] rotate-12 opacity-54 md:max-h-[205px]" : index === 3 ? "z-10 max-h-[130px] w-[27%] -translate-x-[132%] -translate-y-[34%] rotate-6 opacity-34 blur-[0.3px] md:max-h-[170px]" : "z-10 max-h-[130px] w-[27%] translate-x-[132%] translate-y-[36%] -rotate-6 opacity-34 blur-[0.3px] md:max-h-[170px]"}`}
                      loading={active ? "eager" : "lazy"}
                      decoding="async"
                      width="760"
                      height="620"
                    />
                  );
                })}
              </div>
              {slides.length > 1 ? (
                <div className="absolute bottom-3 end-3 z-20 flex gap-1.5">
                  {slides.map((slide, index) => (
                    <button key={productIdentityKey(slide.product, index)} type="button" onClick={(event) => { event.preventDefault(); setSlideIndex(index); setManualTick((current) => current + 1); }} className={`h-1.5 rounded-full transition ${index === slideIndex ? "w-8 bg-stone-950 dark:bg-white" : "w-2 bg-stone-950/24 dark:bg-white/30"}`} aria-label={`Slide ${index + 1}`} />
                  ))}
                </div>
              ) : null}
            </div>
          </Link>

          <aside className={`hidden border-s p-5 shadow-[inset_1px_0_0_rgba(255,255,255,0.06)] lg:block lg:[direction:rtl] ${darkMode ? "border-white/10 bg-white/[0.045]" : "border-slate-200 bg-slate-50 shadow-[inset_1px_0_0_rgba(15,23,42,0.04)]"}`}>
            <div className={`mb-4 border-b pb-3 text-sm font-black ${darkMode ? "border-white/10 text-white" : "border-slate-200 text-slate-900"}`}>
              تسوق حسب القسم
            </div>
            <nav className="grid gap-1" aria-label="ط§ظ„ظپط¦ط§طھ ط§ظ„ط±ط¦ظٹط³ظٹط©">
              {categories.map((category) => {
                const active = category.id === activeCategory.id;
                return (
                  <Link
                    key={category.id}
                    to={category.href}
                    onMouseEnter={() => pickCategory(category.id)}
                    onFocus={() => pickCategory(category.id)}
                    className={`group flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-start transition ${darkMode ? (active ? "bg-white text-stone-950 ring-1 ring-white/25" : "text-white/66 hover:bg-white/[0.07] hover:text-white") : (active ? "bg-slate-900 text-white ring-1 ring-slate-200" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950")}`}
                  >
                    <span className="min-w-0 truncate text-base font-black">
                      {category.label}
                    </span>
                    <ChevronLeft className={`h-4 w-4 shrink-0 transition ${isRtl ? "" : "rotate-180"} ${active ? "opacity-80" : "opacity-35 group-hover:opacity-70"}`} />
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      </div>
    </section>
  );
}

const mainHomeCategoryCards = [
  {
    id: "men",
    titleAr: "رجالي",
    titleEn: "Men",
    subtitleAr: "أحدث Nike و Adidas و Jordan",
    subtitleEn: "Latest Nike, Adidas & Jordan",
    href: "/shop/products?gender=men",
    test: (product, text) => productAudienceValues(product).includes("men") || /men|mens|male|.{3,5}/i.test(text),
    icon: Briefcase,
  },
  {
    id: "women",
    titleAr: "حريمي",
    titleEn: "Women",
    subtitleAr: "راحة وأناقة لكل يوم",
    subtitleEn: "Comfort and style for every day",
    href: "/shop/products?gender=women",
    test: (product, text) => productAudienceValues(product).includes("women") || /women|womens|female|ladies|.{3,5}/i.test(text),
    icon: Users,
  },
  {
    id: "kids",
    titleAr: "أطفال",
    titleEn: "Kids",
    subtitleAr: "مناسب للمدرسة واللعب والحركة",
    subtitleEn: "Built for school, play and movement",
    href: "/shop/products?gender=kids",
    test: (product, text) => productAudienceValues(product).includes("kids") || /kids?|children|child|.{3,5}/i.test(text),
    icon: Baby,
  },
  {
    id: "offers",
    titleAr: "عروض",
    titleEn: "Offers",
    subtitleAr: "عروض الموسم",
    subtitleEn: "Season offers",
    href: "/shop/products?sale=true",
    test: (product, text) => hasSale(product) || /offer|offers|sale|discount|.{3,5}/i.test(text),
    icon: BadgePercent,
  },
  {
    id: "crocs",
    titleAr: "كروكس",
    titleEn: "Crocs",
    subtitleAr: "راحة سهلة لكل يوم",
    subtitleEn: "Easy comfort for every day",
    href: "/shop/products?category=crocs",
    test: (_product, text) => /crocs?|crocband|classics*clog|slides|.{3,5}/i.test(text),
    icon: Footprints,
  },
  {
    id: "last-sizes",
    titleAr: "آخر المقاسات",
    titleEn: "Last Sizes",
    subtitleAr: "قطع محدودة قبل ما تختفي",
    subtitleEn: "Limited pairs before they disappear",
    href: "/shop/products?stock=last",
    test: (_product, text) => /lasts*sizes|finals*size|.{3,5} .{3,5}|.{3,5} .{3,5} .{3,5}/i.test(text),
    icon: PackageSearch,
  },
];

const homeProductWithImage = (product = {}) => {
  const slide = featuredSlideProduct(product);
  return slide.image ? { ...slide, product } : null;
};

function ShopByMainCategories({ products = [], lang = "ar", loading = false, themeMode = "light" }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  const darkMode = themeMode === "dark" || (typeof document !== "undefined" && document.body.classList.contains("storefront-dark"));
  const sourceProducts = useMemo(
    () => uniqueProductsByIdentity(products)
      .filter((product) => product?.id && product?.name && isAvailableProduct(product))
      .map(homeProductWithImage)
      .filter(Boolean),
    [products]
  );

  const cards = useMemo(() => mainHomeCategoryCards.map((definition) => {
    const matched = sourceProducts.filter(({ product }) => definition.test(product, productSearchText(product)));
    const images = uniqueProductsByIdentity([...matched, ...sourceProducts].map((item) => item.product))
      .map(homeProductWithImage)
      .filter(Boolean)
      .slice(0, 4);
    return { ...definition, images };
  }), [sourceProducts]);

  if (!cards.length) return loading ? <ShopByMainCategoriesSkeleton lang={lang} /> : null;

  return (
    <section className="mx-auto max-w-[1360px] px-4 py-10 md:py-16" dir={isRtl ? "rtl" : "ltr"}>
      <div className={`mb-8 flex items-end justify-between gap-3 md:mb-11 ${isRtl ? "text-right" : "text-left"}`}>
        <div>
          <div className={`mb-2 text-[10px] font-black uppercase tracking-[0.18em] ${darkMode ? "text-[#f8e7b3]" : "text-[#7c3aed]"}`}>
            {sfText("storefront.home.shopByCategory", "الفئات الرئيسية")}
          </div>
          <h2 className={`text-3xl font-black tracking-normal md:text-6xl ${darkMode ? "text-white/90" : "text-[#0f172a]"}`}>
            الفئات الرئيسية
          </h2>
        </div>
        <Link to="/shop/products" className={`hidden min-h-11 items-center justify-center rounded-full border px-6 text-xs font-black shadow-[0_14px_34px_rgba(39,20,75,0.08)] transition hover:-translate-y-0.5 active:scale-[0.98] sm:inline-flex ${darkMode ? "border-white/10 bg-white/5 text-stone-200 hover:bg-white hover:text-stone-950 dark:hover:bg-white dark:hover:text-stone-950" : "border-slate-300 bg-white text-[#0f172a] hover:border-[#7c3aed]/50 hover:bg-white hover:text-[#0f172a]"}`}>
          {sfText("common.viewAll")}
        </Link>
      </div>
      <div className="grid gap-7 md:gap-10">
        {cards.map((card, cardIndex) => {
          const title = isRtl ? card.titleAr : card.titleEn;
          const subtitle = isRtl ? card.subtitleAr : card.subtitleEn;
          const collage = card.images;
          const reverse = cardIndex % 2 === 1;
          return (
            <Link
              key={card.id}
              to={card.href}
            className={`group relative grid min-h-[300px] overflow-hidden rounded-[2.35rem] border transition duration-500 hover:-translate-y-2 active:scale-[0.99] md:min-h-[360px] lg:min-h-[400px] ${darkMode ? "border-white/10 bg-stone-950 text-white shadow-[0_34px_110px_rgba(15,23,42,0.28)] hover:border-[#f8e7b3]/50 hover:shadow-[0_48px_130px_rgba(15,23,42,0.42)]" : "border-slate-200 bg-white text-[#0f172a] shadow-[0_34px_110px_rgba(15,23,42,0.10)] hover:border-[#7c3aed]/30 hover:shadow-[0_48px_130px_rgba(15,23,42,0.16)]"} ${reverse ? "md:grid-cols-[0.58fr_0.42fr]" : "md:grid-cols-[0.42fr_0.58fr]"}`}
            >
              <div className={`absolute inset-0 ${darkMode ? "bg-[radial-gradient(circle_at_76%_24%,rgba(248,231,179,0.24),transparent_31%),linear-gradient(135deg,#1c1917_0%,#0f172a_52%,#030712_100%)]" : "bg-[radial-gradient(circle_at_76%_24%,rgba(124,58,237,0.10),transparent_31%),linear-gradient(135deg,#ffffff_0%,#f8fafc_52%,#eef2ff_100%)]"}`} />
              <div className={`absolute inset-0 ${darkMode ? "bg-gradient-to-l from-black/80 via-black/35 to-black/12" : "bg-gradient-to-l from-white/78 via-white/40 to-white/8"}`} />
              <div className={`relative z-10 flex min-h-[300px] flex-col justify-end p-7 md:min-h-0 md:p-10 lg:p-12 ${isRtl ? "text-right" : "text-left"} ${reverse ? "md:order-2" : ""}`}>
                <div className={`mb-4 w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] backdrop-blur ${darkMode ? "border-white/15 bg-white/10 text-[#f8e7b3]" : "border-slate-200 bg-white/85 text-[#7c3aed] shadow-[0_10px_24px_rgba(15,23,42,0.08)]"}`}>
                  {isRtl ? "\u0627\u062e\u062a\u064a\u0627\u0631\u0627\u062a \u0645\u0646\u062a\u0642\u0627\u0629" : "Curated edit"}
                </div>
                <h3 className={`text-[3.3rem] font-black leading-none tracking-normal md:text-7xl lg:text-8xl ${darkMode ? "text-white" : "text-slate-900"}`}>{title}</h3>
                <p className={`mt-4 max-w-[28rem] text-base font-bold leading-7 md:text-xl md:leading-8 ${darkMode ? "text-white/84" : "text-slate-600"}`}>{subtitle}</p>
                <span className={`mt-7 inline-flex min-h-12 w-fit items-center justify-center gap-2 rounded-full px-6 text-sm font-black transition md:min-h-14 md:px-8 ${darkMode ? "bg-white text-stone-950 shadow-[0_16px_34px_rgba(0,0,0,0.26)] group-hover:bg-[#f8e7b3] group-hover:shadow-[0_18px_42px_rgba(248,231,179,0.26)]" : "bg-slate-900 text-white shadow-[0_16px_34px_rgba(15,23,42,0.16)] group-hover:bg-[#7c3aed] group-hover:shadow-[0_18px_42px_rgba(124,58,237,0.16)]"}`}>
                  {isRtl ? "تسوق الآن" : sfText("storefront.common.shopNow")}
                  <ChevronLeft className={`h-4 w-4 transition group-hover:-translate-x-1 ${isRtl ? "" : "rotate-180 group-hover:translate-x-1 group-hover:-translate-y-0"}`} />
                </span>
              </div>
              <div className="relative z-10 min-h-[260px] overflow-hidden p-4 md:min-h-0 md:p-7 lg:p-9">
                <div className={`absolute bottom-8 left-1/2 h-12 w-[76%] -translate-x-1/2 rounded-full blur-2xl ${darkMode ? "bg-black/45" : "bg-slate-300/70"}`} />
                {collage.length ? collage.map(({ product, image }, index) => (
                  <div
                    key={`${card.id}-${productIdentityKey(product, index)}`}
                    className={`absolute overflow-hidden rounded-[1.8rem] backdrop-blur transition duration-700 group-hover:scale-[1.06] ${darkMode ? "bg-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_28px_60px_rgba(0,0,0,0.24)]" : "bg-slate-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_20px_50px_rgba(15,23,42,0.10)]"} ${
                      index === 0
                        ? "bottom-8 left-1/2 z-30 h-[60%] w-[68%] -translate-x-1/2 md:h-[74%]"
                        : index === 1
                          ? "left-5 top-7 z-20 h-[34%] w-[32%] -rotate-6 opacity-78"
                          : index === 2
                            ? "right-5 top-9 z-20 h-[32%] w-[30%] rotate-6 opacity-76"
                            : "bottom-8 right-8 z-10 h-[27%] w-[26%] opacity-50"
                    }`}
                  >
                    <img
                      src={imageFor(image)}
                      {...responsiveImageProps(image, "hero")}
                      alt=""
                      onError={fallbackProductImage}
                      className="h-full w-full scale-125 object-contain p-1 transition duration-700 group-hover:scale-[1.32]"
                      loading="lazy"
                      decoding="async"
                      width="420"
                      height="320"
                    />
                  </div>
                )) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function HomeProductSection({ title, subtitle, viewAllTo = "/shop/products", products = [], loading = false, railType = "default", tone = "default", wishlist, toggleWishlist, onAddToCart, themeMode = "light" }) {
  const isRtl = normalizeLanguage(i18n.language) === "ar";
  const darkMode = themeMode === "dark";
  const railViewportRef = useRef(null);
  const railTrackRef = useRef(null);
  const railCardRefs = useRef([]);
  const autoplayIndexRef = useRef(0);
  const translateXRef = useRef(0);
  const dragStateRef = useRef({ active: false, moved: false, startX: 0, startTranslateX: 0, pointerId: null });
  const autoplayTimersRef = useRef({ wait: null, settle: null, reset: null });
  const railPausedRef = useRef(false);
  const [railPaused, setRailPaused] = useState(false);
  const [trackMotion, setTrackMotion] = useState({ x: 0, transition: "none" });
  const [activeDotIndex, setActiveDotIndex] = useState(0);
  const visibleProducts = useMemo(
    () => sortStorefrontColorCardsByModel(uniqueProductsByIdentity(products).filter((product) => product?.id && product?.name && isAvailableProduct(product)).slice(0, 8)),
    [products]
  );
  const repeatedProducts = useMemo(() => {
    if (!visibleProducts.length) return [];
    return Array.from({ length: 3 }, (_, repeatIndex) =>
      visibleProducts.map((product, index) => ({
        product,
        repeatIndex,
        index,
        key: `${productCardKey(product, index)}-${repeatIndex}`,
      }))
    ).flat();
  }, [visibleProducts]);
  const skeletonItems = Array.from({ length: 8 });
  const toneConfig = {
    default: {
      shell: "bg-transparent",
      eyebrow: "text-[#7c3aed] dark:text-[#f8e7b3]",
      line: "from-[#7c3aed] to-[#f8e7b3]",
      button: "hover:border-[#7c3aed]/50",
    },
    popular: {
      shell: "rounded-[2.25rem] border border-amber-200/55 bg-[radial-gradient(circle_at_86%_0%,rgba(248,231,179,0.44),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.88),rgba(255,247,221,0.42))] px-4 py-6 shadow-[0_24px_80px_rgba(180,83,9,0.10),inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-amber-300/15 dark:bg-[radial-gradient(circle_at_86%_0%,rgba(248,231,179,0.16),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(248,231,179,0.06))]",
      eyebrow: "text-amber-600 dark:text-[#f8e7b3]",
      line: "from-amber-500 to-[#f8e7b3]",
      button: "hover:border-amber-400/60",
    },
    new: {
      shell: "rounded-[2.25rem] border border-emerald-200/55 bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,0.22),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.82),rgba(236,253,245,0.42))] px-4 py-6 shadow-[0_24px_80px_rgba(16,185,129,0.10),inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-emerald-300/15 dark:bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,0.15),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(16,185,129,0.06))]",
      eyebrow: "text-emerald-600 dark:text-emerald-300",
      line: "from-emerald-500 to-teal-300",
      button: "hover:border-emerald-400/60",
    },
    last: {
      shell: "rounded-[2.25rem] border border-orange-200/60 bg-[radial-gradient(circle_at_90%_10%,rgba(251,146,60,0.25),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.84),rgba(255,237,213,0.44))] px-4 py-6 shadow-[0_24px_80px_rgba(234,88,12,0.10),inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-orange-300/15 dark:bg-[radial-gradient(circle_at_90%_10%,rgba(251,146,60,0.16),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(251,146,60,0.06))]",
      eyebrow: "text-orange-600 dark:text-orange-300",
      line: "from-orange-500 to-amber-300",
      button: "hover:border-orange-400/60",
    },
    sale: {
      shell: "rounded-[2.25rem] border border-red-200/60 bg-[radial-gradient(circle_at_12%_0%,rgba(239,68,68,0.22),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.84),rgba(254,226,226,0.42))] px-4 py-6 shadow-[0_24px_80px_rgba(220,38,38,0.10),inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-red-300/15 dark:bg-[radial-gradient(circle_at_12%_0%,rgba(239,68,68,0.16),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(239,68,68,0.06))]",
      eyebrow: "text-red-600 dark:text-red-300",
      line: "from-red-500 to-rose-300",
      button: "hover:border-red-400/60",
    },
    trending: {
      shell: "rounded-[2.25rem] border border-violet-200/60 bg-[radial-gradient(circle_at_86%_0%,rgba(124,58,237,0.22),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.84),rgba(245,243,255,0.44))] px-4 py-6 shadow-[0_24px_80px_rgba(124,58,237,0.10),inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-violet-300/15 dark:bg-[radial-gradient(circle_at_86%_0%,rgba(124,58,237,0.18),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.06),rgba(124,58,237,0.08))]",
      eyebrow: "text-violet-600 dark:text-violet-300",
      line: "from-violet-600 to-fuchsia-300",
      button: "hover:border-violet-400/60",
    },
  }[tone] || {};
  const sectionTone = toneConfig.shell || "bg-transparent";
  const eyebrowClass = darkMode
    ? (toneConfig.eyebrow || "text-[#7c3aed] dark:text-[#f8e7b3]")
    : (tone === "popular" ? "text-[#334155]" : "text-[#7c3aed]");
  const railItems = loading && !visibleProducts.length
    ? Array.from({ length: 3 }, (_, repeatIndex) =>
        skeletonItems.map((_, index) => ({
          key: `skeleton-${repeatIndex}-${index}`,
          repeatIndex,
          index,
          product: null,
          skeleton: true,
        }))
      ).flat()
    : repeatedProducts;
  const transitionMs = 500;
  const autoplayDelay = 3000;
  const loopStartIndex = visibleProducts.length;
  const loopEndIndex = visibleProducts.length * 2;
  const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const clearTimers = useCallback(() => {
    if (typeof window === "undefined") return;
    if (autoplayTimersRef.current.wait) window.clearTimeout(autoplayTimersRef.current.wait);
    if (autoplayTimersRef.current.settle) window.clearTimeout(autoplayTimersRef.current.settle);
    if (autoplayTimersRef.current.reset) window.clearTimeout(autoplayTimersRef.current.reset);
    autoplayTimersRef.current = { wait: null, settle: null, reset: null };
  }, []);

  const setRailPausedState = useCallback((nextPaused) => {
    railPausedRef.current = nextPaused;
    setRailPaused(nextPaused);
  }, []);

  const setTrackPosition = useCallback((nextX, animate) => {
    translateXRef.current = nextX;
    setTrackMotion({
      x: nextX,
      transition: animate ? `transform ${transitionMs}ms ease` : "none",
    });
  }, []);

  const setCenteredIndex = useCallback((index, animate = true) => {
    const viewport = railViewportRef.current;
    const node = railCardRefs.current[index];
    if (!viewport || !node) return false;
    const viewportRect = viewport.getBoundingClientRect();
    const cardRect = node.getBoundingClientRect();
    const viewportCenter = viewportRect.left + viewportRect.width / 2;
    const cardCenter = cardRect.left + cardRect.width / 2;
    const nextX = translateXRef.current + (viewportCenter - cardCenter);
    autoplayIndexRef.current = index;
    setActiveDotIndex(visibleProducts.length ? index % visibleProducts.length : 0);
    setTrackPosition(nextX, animate);
    return true;
  }, [setTrackPosition, visibleProducts.length]);

  const normalizeToMiddleCopy = useCallback((index) => {
    if (!visibleProducts.length) return index;
    const offset = ((index % visibleProducts.length) + visibleProducts.length) % visibleProducts.length;
    return loopStartIndex + offset;
  }, [loopStartIndex, visibleProducts.length]);

  const syncToCurrentCopy = useCallback(() => {
    if (!visibleProducts.length) return;
    const normalized = normalizeToMiddleCopy(autoplayIndexRef.current);
    if (normalized !== autoplayIndexRef.current) {
      setCenteredIndex(normalized, false);
    }
  }, [normalizeToMiddleCopy, setCenteredIndex, visibleProducts.length]);

  const findClosestIndex = useCallback(() => {
    const viewport = railViewportRef.current;
    if (!viewport || !visibleProducts.length) return autoplayIndexRef.current;
    const viewportRect = viewport.getBoundingClientRect();
    const viewportCenter = viewportRect.left + viewportRect.width / 2;
    let bestIndex = autoplayIndexRef.current;
    let bestDistance = Number.POSITIVE_INFINITY;
    railCardRefs.current.forEach((node, index) => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(center - viewportCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, [visibleProducts.length]);

  const queueNextStep = useCallback((delay = autoplayDelay) => {
    if (typeof window === "undefined") return;
    if (!visibleProducts.length || railPausedRef.current || reducedMotion || dragStateRef.current.active) return;
    if (autoplayTimersRef.current.wait) window.clearTimeout(autoplayTimersRef.current.wait);
    autoplayTimersRef.current.wait = window.setTimeout(() => {
      if (railPausedRef.current || reducedMotion || dragStateRef.current.active || !visibleProducts.length) return;
      let nextIndex = autoplayIndexRef.current + 1;
      if (nextIndex >= loopEndIndex) {
        nextIndex = loopEndIndex;
      }
      const moved = setCenteredIndex(nextIndex, true);
      if (!moved) return;
      if (autoplayTimersRef.current.settle) window.clearTimeout(autoplayTimersRef.current.settle);
      autoplayTimersRef.current.settle = window.setTimeout(() => {
        if (nextIndex >= loopEndIndex) {
          autoplayIndexRef.current = loopStartIndex;
          setCenteredIndex(loopStartIndex, false);
        }
        queueNextStep(autoplayDelay);
      }, transitionMs);
    }, delay);
  }, [autoplayDelay, loopEndIndex, loopStartIndex, reducedMotion, setCenteredIndex, visibleProducts.length]);

  useEffect(() => {
    railCardRefs.current = [];
  }, [visibleProducts.length, railItems.length]);

  useEffect(() => {
    if (typeof window === "undefined" || !visibleProducts.length) return undefined;
    autoplayIndexRef.current = loopStartIndex;
    setActiveDotIndex(0);
    setTrackPosition(0, false);
    const raf = window.requestAnimationFrame(() => {
      setCenteredIndex(loopStartIndex, false);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [loopStartIndex, setCenteredIndex, setTrackPosition, visibleProducts.length]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => {
      if (!visibleProducts.length) return;
      setCenteredIndex(autoplayIndexRef.current, false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setCenteredIndex, visibleProducts.length]);

  useEffect(() => {
    clearTimers();
    if (!visibleProducts.length || railPaused || reducedMotion) return undefined;
    queueNextStep(autoplayDelay);
    return clearTimers;
  }, [autoplayDelay, clearTimers, queueNextStep, railPaused, reducedMotion, visibleProducts.length]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const handlePointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("a,button,input,textarea,select,[role='button']")) return;
    const viewport = railViewportRef.current;
    if (!viewport || !visibleProducts.length) return;
    dragStateRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startTranslateX: translateXRef.current,
      pointerId: event.pointerId,
    };
    try {
      viewport.setPointerCapture(event.pointerId);
    } catch {
      // noop
    }
    setRailPausedState(true);
    clearTimers();
  };

  const handlePointerMove = (event) => {
    if (!dragStateRef.current.active) return;
    const delta = event.clientX - dragStateRef.current.startX;
    if (Math.abs(delta) > 3) dragStateRef.current.moved = true;
    setTrackPosition(dragStateRef.current.startTranslateX + delta, false);
  };

  const endPointerInteraction = (event) => {
    if (!dragStateRef.current.active) return;
    const viewport = railViewportRef.current;
    if (viewport && dragStateRef.current.pointerId != null) {
      try {
        viewport.releasePointerCapture(dragStateRef.current.pointerId);
      } catch {
        // noop
      }
    }
    if (dragStateRef.current.moved) {
      const closestIndex = findClosestIndex();
      const normalized = normalizeToMiddleCopy(closestIndex);
      setCenteredIndex(normalized, true);
    }
    dragStateRef.current = { active: false, moved: false, startX: 0, startTranslateX: translateXRef.current, pointerId: null };
    setRailPausedState(false);
    clearTimers();
    queueNextStep(autoplayDelay);
  };

  const handleClickCapture = (event) => {
    if (!dragStateRef.current.moved) return;
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current.moved = false;
  };

  const handleDotClick = (index) => {
    if (!visibleProducts.length) return;
    setRailPausedState(true);
    clearTimers();
    setCenteredIndex(loopStartIndex + index, true);
    autoplayIndexRef.current = loopStartIndex + index;
    setRailPausedState(false);
    queueNextStep(autoplayDelay);
  };

  if (!loading && !visibleProducts.length) return null;

  return (
    <section className="sf-reveal mx-auto max-w-[1240px] px-4 py-6 md:py-9">
      <div className={sectionTone}>
        <div className="mb-4 flex items-end justify-between gap-3 text-right md:mb-6">
          <div className="min-w-0">
            <div className={`mb-1 text-[10px] font-black uppercase tracking-[0.18em] md:text-[11px] ${eyebrowClass}`}>{sfText("storefront.common.shopNow", "تسوق الآن")}</div>
            <h2 className={`text-[1.75rem] font-black tracking-normal md:text-4xl ${darkMode ? "text-stone-100" : "text-[#0f172a]"}`}>{title}</h2>
            {subtitle ? <p className={`mt-1 text-xs font-bold leading-5 md:text-base md:leading-6 ${darkMode ? "text-stone-400" : "text-[#475569]"}`}>{subtitle}</p> : null}
            <div className={`mt-2 h-1 w-16 rounded-full bg-gradient-to-l ${toneConfig.line || "from-[#7c3aed] to-[#f8e7b3]"}`} />
          </div>
          <Link to={viewAllTo} className={`mb-0.5 inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-black shadow-[0_14px_34px_rgba(39,20,75,0.09)] transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-12 md:px-6 ${darkMode ? "border-white/10 bg-white/5 text-stone-200 hover:bg-white hover:text-stone-950 dark:hover:bg-white dark:hover:text-stone-950" : "border-slate-300 bg-white text-[#0f172a] hover:border-[#7c3aed]/50 hover:bg-white hover:text-[#0f172a]"} ${toneConfig.button || "hover:border-[#7c3aed]/50"}`}>
            {sfText("common.viewAll")}
            <ChevronLeft className={`h-4 w-4 ${isRtl ? "" : "rotate-180"}`} />
          </Link>
        </div>

        <div
          ref={railViewportRef}
          dir={isRtl ? "rtl" : "ltr"}
          className="relative w-full min-w-0 overflow-hidden pb-2 [touch-action:pan-y]"
          onPointerEnter={() => setRailPausedState(true)}
          onPointerLeave={() => {
            setRailPausedState(false);
            queueNextStep(autoplayDelay);
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerInteraction}
          onPointerCancel={endPointerInteraction}
          onClickCapture={handleClickCapture}
        >
          <div
            ref={railTrackRef}
            className="flex w-max min-w-full gap-3.5 will-change-transform"
            style={{
              transform: `translate3d(${trackMotion.x}px, 0, 0)`,
              transition: trackMotion.transition,
            }}
          >
            {railItems.map(({ product, skeleton, key, index, repeatIndex }) => (
              <div
                key={key}
                ref={(node) => {
                  railCardRefs.current[index + repeatIndex * visibleProducts.length] = node;
                }}
                data-home-rail-card="true"
                className="w-[82vw] max-w-[22rem] shrink-0 sm:w-[43vw] md:w-[19rem] xl:w-[20rem]"
              >
                {skeleton ? (
                  <div className="h-56 animate-pulse rounded-[1.35rem] bg-white shadow-[0_12px_32px_rgba(39,20,75,0.06)] md:h-72 md:rounded-[1.75rem] dark:bg-white/5" />
                ) : (
                  <ProductCard
                    product={product}
                    wishlist={wishlist}
                    toggleWishlist={toggleWishlist}
                    onAddToCart={onAddToCart}
                    railType={railType}
                    rank={index + 1}
                    density="compact"
                    eagerImage
                    imagePreset="small"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {visibleProducts.length ? (
          <div className="mt-4 flex items-center justify-center gap-2 md:hidden">
            {visibleProducts.map((product, index) => {
              const active = activeDotIndex === index;
              return (
                <button
                  key={productIdentityKey(product, index)}
                  type="button"
                  aria-label={`Go to product ${index + 1}`}
                  onClick={() => handleDotClick(index)}
                  className={`h-2.5 rounded-full transition-all duration-300 ${active ? "w-8 bg-stone-950 dark:bg-white" : "w-2.5 bg-stone-300 dark:bg-white/30"}`}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HomeBrandsSection() {
  const { i18n } = useTranslation();
  const lang = i18n.language || "ar";
  const { brands, loading } = useStorefrontBrands();
  const visibleBrands = useMemo(() => (Array.isArray(brands) ? brands : []).filter((brand) => brand?.id && brand?.name && brand?.logo_url), [brands]);
  const brandCount = visibleBrands.length;
  const isSingleBrand = brandCount === 1;
  const isDualBrand = brandCount === 2;
  const sectionClassName = isSingleBrand
    ? "mx-auto mt-8 max-w-3xl px-4 py-8 md:mb-8 md:py-8"
    : "mx-auto mt-8 max-w-7xl px-4 py-3 md:mb-8 md:py-6";
  const gridClassName = isDualBrand
    ? "mx-auto grid max-w-5xl grid-cols-2 gap-5 md:gap-6"
    : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";
  const cardClassName = isDualBrand
    ? "flex h-36 items-center justify-center rounded-3xl border border-stone-200 bg-white px-6 py-5 shadow-[0_10px_24px_rgba(39,20,75,0.05)] transition duration-200 group-hover:-translate-y-0.5 group-hover:border-[#a78bfa]/40 group-hover:shadow-[0_16px_36px_rgba(124,58,237,0.08)] md:h-44 dark:border-white/10 dark:bg-white/[0.04]"
    : isSingleBrand
      ? "inline-flex w-fit max-w-none flex-col items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.04] px-6 py-5 text-center shadow-sm transition duration-200 group-hover:-translate-y-0.5 group-hover:border-[#a78bfa]/40 group-hover:shadow-[0_16px_36px_rgba(124,58,237,0.08)] dark:bg-white/[0.04]"
      : "flex h-28 items-center justify-center rounded-2xl border border-stone-200 bg-white px-6 py-4 shadow-[0_10px_24px_rgba(39,20,75,0.05)] transition duration-200 group-hover:-translate-y-0.5 group-hover:border-[#a78bfa]/40 group-hover:shadow-[0_16px_36px_rgba(124,58,237,0.08)] md:h-32 dark:border-white/10 dark:bg-white/[0.04]";
  const logoClassName = isDualBrand
    ? "max-h-24 max-w-[210px] object-contain md:max-h-[140px] md:max-w-[240px]"
    : isSingleBrand
      ? "max-w-full max-h-full object-contain"
      : "max-h-24 md:max-h-28 object-contain";

  if (loading && !visibleBrands.length) {
    return (
      <section className={sectionClassName} dir={normalizeLanguage(lang) === "ar" ? "rtl" : "ltr"}>
        <div className="rounded-[2.15rem] border border-stone-200 bg-white px-4 py-5 shadow-[0_18px_54px_rgba(39,20,75,0.07)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(7,11,22,0.98),rgba(7,11,22,0.92))] dark:shadow-[0_24px_80px_rgba(0,0,0,0.28)] md:px-5 md:py-6">
          <div className="mb-4 text-center">
            <div className="mx-auto sf-skeleton-shimmer h-3 w-28 rounded-full bg-stone-200/80 dark:bg-white/[0.08]" />
            <div className="mx-auto mt-3 sf-skeleton-shimmer h-8 w-44 rounded-[1rem] bg-stone-200/80 dark:bg-white/[0.08]" />
          </div>
          <div className={isSingleBrand ? "mx-auto flex max-w-[260px] justify-center" : gridClassName}>
            {Array.from({ length: isSingleBrand ? 1 : isDualBrand ? 2 : 5 }).map((_, index) => (
              <div
                key={index}
                className={`sf-skeleton-shimmer ${isSingleBrand ? "h-28 w-full rounded-[1.5rem]" : isDualBrand ? "h-36 rounded-3xl md:h-44" : "h-28 rounded-2xl md:h-32"} bg-stone-200/80 dark:bg-white/[0.08]`}
              />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (!visibleBrands.length) return null;

  return (
    <section className={sectionClassName} dir={normalizeLanguage(lang) === "ar" ? "rtl" : "ltr"}>
      <div className="rounded-[2.15rem] border border-stone-200 bg-white px-4 py-5 shadow-[0_18px_54px_rgba(39,20,75,0.07)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(7,11,22,0.98),rgba(7,11,22,0.92))] dark:shadow-[0_24px_80px_rgba(0,0,0,0.28)] md:px-5 md:py-6">
        <div className="mb-4 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#7c3aed] dark:text-[#d8b4fe]">{sfText("storefront.home.brandsEyebrow", "البراندات")}</p>
          <h2 className="mt-1 text-2xl font-black tracking-normal text-stone-950 dark:text-white md:text-3xl">الفئات الرئيسية</h2>
        </div>
        {isSingleBrand ? (
          <div className="mx-auto flex w-fit justify-center">
            {visibleBrands.map((brand) => {
              const brandHref = `/shop?brand=${encodeURIComponent(brand.id || brand.slug)}`;
              const brandName = brand.name || "";
              return (
                <Link
                  key={brand.id || brand.slug || brand.name}
                  to={brandHref}
                  aria-label={brand.name}
                  className="group mx-auto inline-flex w-fit max-w-none min-w-0"
                >
                  <span className={cardClassName}>
                    <span className="flex h-[150px] w-[150px] items-center justify-center overflow-hidden rounded-[20px] bg-white sm:h-[170px] sm:w-[170px]">
                      <img
                        src={resolveProductImageUrl(brand.logo_url)}
                        alt={brandName}
                        className={logoClassName}
                        loading="lazy"
                        decoding="async"
                        width="170"
                        height="170"
                      />
                    </span>
                    <div className="mt-4 text-lg font-black text-white">{brandName}</div>
                    <div className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-black text-white/80">البراندات المختارة</div>
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className={gridClassName}>
            {visibleBrands.map((brand) => {
              const brandHref = `/shop?brand=${encodeURIComponent(brand.id || brand.slug)}`;
              const brandName = brand.name || "";
              return (
                <Link
                  key={brand.id || brand.slug || brand.name}
                  to={brandHref}
                  aria-label={brand.name}
                  className="group min-w-0"
                >
                  <span className={cardClassName}>
                    <img
                      src={resolveProductImageUrl(brand.logo_url)}
                      alt={brandName}
                      className={logoClassName}
                      loading="lazy"
                      decoding="async"
                      width="220"
                      height="112"
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function QuickSellingStrips({ lang = "ar" }) {
  const isRtl = normalizeLanguage(lang) === "ar";
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-2" dir={isRtl ? "rtl" : "ltr"}>
      <div className="sf-scroll flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0">
        {homeSellingBadges.map((badge) => {
          const Icon = badge.icon;
          return (
            <div key={badge.labelAr} className="flex min-h-12 min-w-[11rem] snap-start items-center justify-center gap-2 rounded-full border border-stone-200 bg-white/85 px-4 text-sm font-black text-stone-800 shadow-[0_10px_26px_rgba(39,20,75,0.05)] backdrop-blur dark:border-white/10 dark:bg-white/[0.055] dark:text-stone-100">
              <Icon className="h-4 w-4 text-[#7c3aed] dark:text-[#f8e7b3]" />
              <span>{isRtl ? badge.labelAr : badge.labelEn}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HomePage(props) {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const lang = i18n.language || "ar";
  const [lastPieceOpen, setLastPieceOpen] = useState(false);
  const brandFilter = params.get("brand") || "";
  const storefrontHome = useStorefrontHome();
  const { products, loading } = useProducts({ limit: 24 });
  const { products: saleProducts, loading: saleLoading } = useProducts({ sale: 1, limit: 12 });

  useEffect(() => {
    if (!brandFilter || location.pathname.replace(/\/+$/, "") !== "/shop") return;
    navigate(`/shop/products?brand=${encodeURIComponent(brandFilter)}`, { replace: true });
  }, [brandFilter, location.pathname, navigate]);

  const merchProducts = useMemo(() => products.filter(isAvailableProduct), [products]);
  const railProducts = useMemo(() => (merchProducts.length ? merchProducts : products), [merchProducts, products]);
  const saleRailProducts = useMemo(() => saleProducts.filter(isAvailableProduct), [saleProducts]);
  const saleFallback = useMemo(() => railProducts.filter(hasSale), [railProducts]);
  const bestBase = useMemo(
    () => uniqueProductsByIdentity([...railProducts].sort((a, b) => stockScore(b) - stockScore(a) || newestScore(b) - newestScore(a))),
    [railProducts]
  );
  const freshBase = useMemo(
    () => uniqueProductsByIdentity([...railProducts].sort((a, b) => newestScore(b) - newestScore(a))),
    [railProducts]
  );
  const saleBase = useMemo(
    () => uniqueProductsByIdentity([...(saleRailProducts.length ? saleRailProducts : saleProducts), ...saleFallback].filter(hasSale)),
    [saleFallback, saleProducts, saleRailProducts]
  );
  const storefrontHomeProducts = useMemo(
    () => uniqueProductsByIdentity((storefrontHome.collections || []).flatMap((collection) => collection.products || [])),
    [storefrontHome.collections]
  );
  const homepageProductPool = useMemo(
    () => uniqueProductsByIdentity([...railProducts, ...storefrontHomeProducts, ...saleBase, ...saleProducts, ...freshBase, ...bestBase]),
    [bestBase, freshBase, railProducts, saleBase, saleProducts, storefrontHomeProducts]
  );
  const homepageProductsWithImages = useMemo(
    () => homepageProductPool.filter((product) => isAvailableProduct(product) && homeProductWithImage(product)),
    [homepageProductPool]
  );
  const featuredCategoryProducts = useMemo(
    () => homepageProductPool,
    [homepageProductPool]
  );
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
    const salePreferred = saleBase.filter((product) => hasSale(product) && homeProductWithImage(product));
    const lastSizePreferred = homepageProductPool.filter((product) => isLastPieceProduct(product) && homeProductWithImage(product));
    const trendingPreferred = bestBase.filter((product) => homeProductWithImage(product));

    return {
      mostPopular: pick({ preferred: popularPreferred, fallback: homepageProductsWithImages, limit: 8 }),
      newArrivals: pick({ preferred: newestPreferred, fallback: [], limit: 8, allowRepeatIfEmpty: true }),
      sale: pick({ preferred: salePreferred, fallback: [], limit: 8, allowRepeatIfEmpty: true }),
      lastSizes: pick({ preferred: lastSizePreferred, fallback: [], limit: 8, allowRepeatIfEmpty: true }),
      trending: pick({ preferred: trendingPreferred, fallback: homepageProductsWithImages, limit: 8, allowRepeatIfEmpty: true }),
    };
  }, [bestBase, freshBase, homepageProductPool, homepageProductsWithImages, saleBase]);

  return (
    <div className="sf-page pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.5rem)] md:pb-0">
      <FeaturedCategoriesHero products={featuredCategoryProducts} lang={lang} loading={loading || storefrontHome.loading} />
      <QuickSellingStrips lang={lang} />
      <ShopByMainCategories products={featuredCategoryProducts} lang={lang} loading={loading || storefrontHome.loading} />
      <HomeProductSection title={sfText("storefront.nav.new", "جديد")} subtitle={sfText("storefront.home.newSubtitle")} viewAllTo="/shop/products?sort=newest" loading={loading || storefrontHome.loading} products={homeSections.newArrivals} railType="new" tone="new" {...props} />
      <HomeProductSection title={sfText("storefront.nav.sale")} subtitle={sfText("storefront.home.saleSubtitle")} viewAllTo="/shop/products?sale=true" loading={saleLoading && !homeSections.sale.length} products={homeSections.sale} railType="sale" tone="sale" {...props} />
      <HomeProductSection title={sfText("storefront.home.lastSizes", "آخر المقاسات")} subtitle={sfText("storefront.home.productOfWeekEmpty")} viewAllTo="/shop/products?lastSizes=true" loading={loading || storefrontHome.loading} products={homeSections.lastSizes} railType="last-size" tone="last" {...props} />
      <HomeProductSection title={normalizeLanguage(lang) === "ar" ? "الأكثر طلبًا" : "Trending"} subtitle={normalizeLanguage(lang) === "ar" ? "اختيارات رائجة مع أحدث المنتجات كخيار بديل." : "Popular picks, with newest products as fallback."} viewAllTo="/shop/products?sort=trending" loading={loading || storefrontHome.loading} products={homeSections.trending} railType="trending" tone="trending" {...props} />
      <Reviews />
      <HomeBrandsSection />
      <LastPieceFinder open={lastPieceOpen} onClose={() => setLastPieceOpen(false)} />
    </div>
  );
}

function SimpleHomeProductGrid({ title, subtitle, products = [], loading = false }) {
  const visibleProducts = (Array.isArray(products) ? products : []).filter((product) => product?.id && product?.name).slice(0, 8);
  if (!visibleProducts.length && !loading) return null;

  return (
    <section className="mx-auto max-w-[1200px] px-4 py-3 md:py-5">
      <div className="mb-3 flex items-end justify-between gap-3 text-right">
        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#7c3aed] dark:text-[#d8b4fe]">{sfText("storefront.common.shopNow")}</div>
          <h2 className="text-2xl font-black tracking-normal text-stone-950 dark:text-stone-100 md:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs font-bold text-stone-500 dark:text-stone-400 md:text-sm">{subtitle}</p> : null}
        </div>
        <Link to="/shop/products" className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
          {sfText("common.viewAll")}
        </Link>
      </div>
      {loading && !visibleProducts.length ? (
        <ProductSkeleton count={4} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visibleProducts.map((product, index) => {
          const price = Number(product.price || product.final_price || product.selling_price || product.regular_price || 0) || 0;
          const image = product.image_url || product.product_image_url || product.gallery_images?.[0] || "";
          return (
            <Link
              key={product.card_id || product.id || index}
              to={productUrl(product)}
              className="group min-w-0 overflow-hidden rounded-[1.15rem] border border-stone-200 bg-white text-right shadow-[0_12px_30px_rgba(39,20,75,0.07)] transition duration-300 hover:-translate-y-1 hover:border-[#a78bfa]/45 hover:shadow-[0_20px_50px_rgba(39,20,75,0.14)] active:scale-[0.99] dark:border-white/10 dark:bg-[#0b1020]"
            >
              <div className="aspect-[1.05/1] overflow-hidden bg-stone-100 p-2 dark:bg-white/5">
                <img
                  src={imageFor(image)}
                  {...responsiveImageProps(image, "grid")}
                  alt={product.name || ""}
                  onError={fallbackProductImage}
                  className="h-full w-full rounded-[0.9rem] object-contain transition duration-500 group-hover:scale-[1.05]"
                  loading="lazy"
                  decoding="async"
                  width="360"
                  height="360"
                />
              </div>
              <div className="p-3">
                <h3 className="line-clamp-2 min-h-10 text-sm font-black leading-5 text-stone-950 dark:text-stone-100">{product.name}</h3>
                <div className="mt-2 text-base font-black text-stone-950 dark:text-white">{money(price)}</div>
              </div>
            </Link>
          );
          })}
        </div>
      )}
    </section>
  );
}

function SectionIntro({ eyebrow, title, subtitle, compact = false }) {
  return (
    <div className={compact ? "max-w-2xl" : "max-w-3xl"}>
      <div className="mb-0.5 text-[9.5px] font-black uppercase tracking-[0.15em] text-[#7c3aed] dark:text-[#d8b4fe] md:mb-1 md:text-[11px] md:tracking-[0.18em]">{eyebrow}</div>
      <h2 className={`${compact ? "text-xl md:text-3xl" : "text-2xl md:text-4xl"} font-black tracking-normal text-stone-950 dark:text-stone-100`}>{title}</h2>
      {subtitle ? <p className="mt-1 text-xs font-semibold leading-5 text-stone-500 dark:text-stone-400 md:mt-2 md:text-sm md:leading-6">{subtitle}</p> : null}
      <div className="mt-1.5 h-0.5 w-10 rounded-full bg-gradient-to-l from-[#7c3aed] to-[#d8b4fe] md:mt-2 md:h-1 md:w-14" />
    </div>
  );
}

function LastPieceFinder({ open, onClose }) {
  const navigate = useNavigate();
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  useBodyScrollLock(open);
  const { loading, error, categories, sizes, products } = useLastPiece({
    category: selectedCategory,
    limit: 80,
  }, {
    enabled: open,
  });
  const criticalProducts = useMemo(() => (
    (Array.isArray(products) ? products : [])
      .map((product) => ({
        ...product,
        total_stock: productTotalStock(product),
        variants: lastPieceProductVariants(product, 3),
      }))
      .filter((product) => isLastPieceProduct(product) && product.variants.length)
      .sort((a, b) =>
        productTotalStock(a) - productTotalStock(b) ||
        sellableVariantStock(a.variants[0]) - sellableVariantStock(b.variants[0])
      )
  ), [products]);
  const selectedCategoryProducts = useMemo(
    () => selectedCategory ? criticalProducts.filter((product) => product.category === selectedCategory) : criticalProducts,
    [criticalProducts, selectedCategory]
  );
  const eligibleLastPieceProducts = useMemo(
    () => selectedCategoryProducts.filter(isLastPieceProduct),
    [selectedCategoryProducts]
  );
  const sizeOptions = useMemo(() => {
    const bySize = new Map();
    eligibleLastPieceProducts.forEach((product) => {
      (Array.isArray(product.variants) ? product.variants : []).forEach((variant) => {
        const size = String(variant?.size || "").trim();
        if (!size || sellableVariantStock(variant) <= 0) return;
        bySize.set(size, size);
      });
    });
    return Array.from(bySize.values()).sort((a, b) => {
      const numericA = Number(a);
      const numericB = Number(b);
      const bothNumeric = Number.isFinite(numericA) && Number.isFinite(numericB);
      return bothNumeric ? numericA - numericB : String(a).localeCompare(String(b), "ar", { numeric: true });
    });
  }, [eligibleLastPieceProducts]);
  const displayedProducts = useMemo(() => {
    const selectedCategoryEligibleProducts = selectedCategory
      ? eligibleLastPieceProducts.filter((product) => product.category === selectedCategory)
      : eligibleLastPieceProducts;
    if (!selectedSize) return selectedCategoryEligibleProducts;
    const targetSize = String(selectedSize || "").trim().toLowerCase();
    return selectedCategoryEligibleProducts.filter((product) =>
      (Array.isArray(product.variants) ? product.variants : []).some(
        (variant) => String(variant?.size || "").trim().toLowerCase() === targetSize && sellableVariantStock(variant) > 0
      )
    );
  }, [eligibleLastPieceProducts, selectedCategory, selectedSize]);
  const displayedCategories = useMemo(() => {
    const byCategory = new Map();
    criticalProducts.forEach((product) => {
      const label = product.category || product.category_name || product.product_type || "";
      if (!label) return;
      const current = byCategory.get(label) || { label, count: 0, products: [] };
      current.count += 1;
      current.products.push(product);
      byCategory.set(label, current);
    });
    const rawOrder = (Array.isArray(categories) ? categories : []).map((category) => category.label).filter(Boolean);
    return Array.from(byCategory.values()).sort((a, b) => {
      const orderA = rawOrder.indexOf(a.label);
      const orderB = rawOrder.indexOf(b.label);
      if (orderA !== -1 || orderB !== -1) return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB);
      return String(a.label).localeCompare(String(b.label), "ar");
    });
  }, [categories, criticalProducts]);
  const step = selectedSize ? "products" : selectedCategory ? "sizes" : "categories";
  const title = step === "categories" ? "آخر قطعة" : step === "sizes" ? "اختر المقاس" : `${selectedCategory} / ${selectedSize}`;

  useEffect(() => {
    if (!open) {
      let cancelled = false;
      deferReactState(() => {
        if (cancelled) return;
        setSelectedCategory("");
        setSelectedSize("");
        setIsNavigating(false);
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || isNavigating) return null;

  const openProduct = (product, variant) => {
    const url = lastPieceProductUrl(product, variant);
    setIsNavigating(true);
    setSelectedCategory("");
    setSelectedSize("");
    onClose();
    requestAnimationFrame(() => navigate(url));
  };

  const goBack = () => {
    if (selectedSize) {
      setSelectedSize("");
      return;
    }
    if (selectedCategory) setSelectedCategory("");
  };

  return (
    <div className="fixed inset-0 z-[70] bg-stone-950 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgba(245,158,11,0.20),transparent_30%),radial-gradient(circle_at_82%_22%,rgba(168,85,247,0.18),transparent_34%),linear-gradient(180deg,#11100d_0%,#1c1917_48%,#050505_100%)]" />
      <div className="pointer-events-none absolute inset-x-4 top-3 z-10 flex gap-1.5">
        {["categories", "sizes", "products"].map((item) => (
          <span key={item} className={`h-1 flex-1 overflow-hidden rounded-full bg-white/18 ${step === item ? "after:block after:h-full after:animate-[sfStoryProgress_5.5s_linear_forwards] after:rounded-full after:bg-[#f8e7b3]" : ""}`} />
        ))}
      </div>
      <div dir="rtl" className="relative z-10 mx-auto flex h-dvh max-w-2xl flex-col overflow-hidden px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1.35rem+env(safe-area-inset-top))]">
        <div className="flex shrink-0 items-center justify-between gap-3 py-3">
          <button onClick={selectedCategory ? goBack : onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/12 bg-white/10 text-white backdrop-blur transition active:scale-95" aria-label={sfText("storefront.common.back")}>
            {selectedCategory ? <ChevronLeft className="h-5 w-5 rotate-180" /> : <X className="h-5 w-5" />}
          </button>
          <div className="min-w-0 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f8e7b3]">ظ…ظ†طھط¬ط§طھ ظ…ط­ط¯ظˆط¯ط©</p>
            <h2 className="mt-1 truncate text-2xl font-black">{title}</h2>
          </div>
          <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/12 bg-white/10 text-white backdrop-blur transition active:scale-95" aria-label={sfText("storefront.common.close")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2">
          {loading && step !== "products" ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="mx-auto h-14 w-14 animate-pulse rounded-full border border-[#f8e7b3]/35 bg-[#f8e7b3]/10" />
                <p className="mt-4 text-sm font-black text-white/70">{sfText("storefront.products.checkingLiveStock")}</p>
              </div>
            </div>
          ) : error ? (
            <div className="mt-10 rounded-[1.5rem] border border-rose-300/20 bg-rose-500/10 p-5 text-center font-black text-rose-100">{error}</div>
          ) : null}

          {!loading && !error && step === "categories" ? (
            <div className="grid grid-cols-2 gap-2 pt-3 sm:gap-3 sm:pt-5">
              {displayedCategories.map((category) => {
                const visual = { icon: <ShoppingBag className="h-4 w-4 sm:h-6 sm:w-6" />, text: "ظ…ظ†طھط¬ط§طھ ظ…ط­ط¯ظˆط¯ط©" };
                return (
                  <button
                    key={category.label}
                    onClick={() => setSelectedCategory(category.label)}
                    className="group relative min-h-[112px] overflow-hidden rounded-[1rem] border border-white/12 bg-white/[0.08] p-3 text-right shadow-[0_16px_42px_rgba(0,0,0,0.22)] backdrop-blur transition duration-300 active:scale-[0.98] sm:min-h-36 sm:rounded-[1.65rem] sm:p-5"
                  >
                    <span className="absolute inset-y-0 left-0 w-1/2 bg-[radial-gradient(circle_at_30%_50%,rgba(248,231,179,0.16),transparent_48%)] opacity-80" />
                    <span className="relative flex h-full flex-col justify-between gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <span>
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f8e7b3] text-stone-950 shadow-[0_10px_26px_rgba(248,231,179,0.18)] sm:h-12 sm:w-12">{visual.icon}</span>
                        <span className="mt-2 block text-lg font-black leading-5 sm:mt-4 sm:text-3xl">{category.label}</span>
                        <span className="mt-0.5 block text-[10.5px] font-bold leading-4 text-white/58 sm:mt-1 sm:text-sm sm:leading-5">ظ…ظ†طھط¬ط§طھ ظ…ط­ط¯ظˆط¯ط©</span>
                      </span>
                      <span className="w-fit rounded-full border border-white/12 bg-white/10 px-2 py-1 text-[10px] font-black text-[#f8e7b3] sm:px-3 sm:text-xs">{category.count} ظ…ظ†طھط¬</span>
                    </span>
                  </button>
                );
              })}
              {!displayedCategories.length ? <LastPieceEmpty text="ظ„ط§ طھظˆط¬ط¯ ظ…ظ†طھط¬ط§طھ ظ…ظ†ط®ظپط¶ط© ط§ظ„ظ…ط®ط²ظˆظ† ط­ط§ظ„ظٹظ‹ط§" /> : null}
            </div>
          ) : null}

          {!loading && !error && step === "sizes" ? (
            <div className="pt-7">
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                {sizeOptions.map((size) => (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    className="min-h-16 rounded-2xl border border-[#f8e7b3]/18 bg-white/[0.08] text-xl font-black text-white shadow-[0_14px_34px_rgba(0,0,0,0.18)] backdrop-blur transition hover:border-[#f8e7b3]/45 hover:bg-[#f8e7b3]/12 active:scale-95"
                  >
                    {size}
                  </button>
                ))}
              </div>
              {!sizeOptions.length ? <LastPieceEmpty text="ظ„ط§ طھظˆط¬ط¯ ظ…ظ†طھط¬ط§طھ ظ…ظ†ط®ظپط¶ط© ط§ظ„ظ…ط®ط²ظˆظ† ط­ط§ظ„ظٹظ‹ط§" /> : null}
            </div>
          ) : null}

          {step === "products" ? (
            <div className="grid gap-3 pt-4">
              {loading ? <ProductSkeleton count={3} /> : displayedProducts.map((product, index) => (
                (() => {
                  const remainingStock = productTotalStock(product);
                  const variant = lastPieceMatchingVariant(product, selectedSize);
                  const sellingPrice = displayLastPieceSellingPrice(product, variant);
                  const rawComparePrice = displayComparePrice(product, variant);
                  const comparePrice = rawComparePrice > sellingPrice ? rawComparePrice : 0;
                  const discountPercent = comparePrice > sellingPrice ? Math.max(1, Math.round(((comparePrice - sellingPrice) / comparePrice) * 100)) : 0;
                  return (
                    <article key={productCardKey(product, index)} className={`overflow-hidden rounded-[1.45rem] border backdrop-blur ${lowStockUrgencyClass(remainingStock)}`}>
                      <button onClick={() => openProduct(product, variant)} className="grid w-full grid-cols-[8.5rem_1fr] gap-3 p-3 text-right sm:grid-cols-[11rem_1fr]">
                        <span className="relative aspect-[4/5] overflow-hidden rounded-[1.15rem] bg-white/8">
                          <img src={imageFor(variant?.image_url || product.image_url)} onError={fallbackProductImage} alt={product.name} className="h-full w-full object-contain p-2" loading="lazy" decoding="async" width="176" height="220" />
                          <span className={`absolute right-2 top-2 rounded-full px-2.5 py-1 text-[10px] font-black ${lowStockPillClass(remainingStock)}`}>{lowStockLabel(remainingStock)}</span>
                        </span>
                        <span className="flex min-w-0 flex-col py-1">
                          <span className="line-clamp-2 text-lg font-black leading-6">{product.name}</span>
                          <span className="mt-1 text-xs font-black text-[#f8e7b3]">{lowStockText(remainingStock)}</span>
                          <span className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-black">
                            {product.variants.map((item) => {
                              const stock = sellableVariantStock(item);
                              const summary = [item.color, item.size ? `Size ${item.size}` : ""].filter(Boolean).join(" / ");
                              return (
                                <span key={item.id || `${item.color}-${item.size}`} className="rounded-full border border-amber-200/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">
                                  {summary || "Unspecified"} / {stock > 0 ? `${stock} in stock` : "Out of stock"}
                                </span>
                              );
                            })}
                          </span>
                          <span className="mt-auto pt-4">
                            <span className="flex flex-wrap items-end gap-2">
                              <span className="text-xl font-black">{money(sellingPrice)}</span>
                              {comparePrice ? <span className="text-xs font-bold text-white/42 line-through">{money(comparePrice)}</span> : null}
                              {discountPercent ? <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-stone-950">-{discountPercent}%</span> : null}
                            </span>
                            <span className="mt-3 grid grid-cols-2 gap-2">
                              <span className="rounded-full border border-white/14 bg-white/10 px-3 py-2 text-center text-xs font-black">{sfText("storefront.cart.reserveProduct")}</span>
                              <span className="sf-shimmer-button rounded-full bg-[#f8e7b3] px-3 py-2 text-center text-xs font-black text-stone-950">{sfText("storefront.cart.orderNow")}</span>
                            </span>
                          </span>
                        </span>
                      </button>
                    </article>
                  );
                })()
              ))}
              {!loading && !displayedProducts.length ? <LastPieceEmpty text="No products found. Try another filter." /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LastPieceEmpty({ text }) {
  return (
    <div className="mt-8 rounded-[1.5rem] border border-white/12 bg-white/[0.08] p-6 text-center backdrop-blur">
      <Sparkles className="mx-auto h-7 w-7 text-[#f8e7b3]" />
      <p className="mt-3 text-sm font-black text-white/70">{text}</p>
    </div>
  );
}

const ProductRail = memo(function ProductRail({ title, subtitle, products, loading, wishlist, toggleWishlist, onAddToCart, railType = "default", featuredFirst = false }) {
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
          <div className="mb-0.5 text-[9.5px] font-black uppercase tracking-[0.15em] text-[#7c3aed] dark:text-[#d8b4fe] md:mb-1 md:text-[11px] md:tracking-[0.18em]">{t("storefront.common.shopNow", "تسوق الآن")}</div>
          <h2 className="text-[1.25rem] font-black tracking-normal md:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[11px] font-bold text-stone-500 dark:text-stone-400 md:mt-1 md:text-sm">{subtitle}</p> : null}
          <div className="mt-1 h-0.5 w-10 rounded-full bg-gradient-to-l from-[#7c3aed] to-[#d8b4fe] md:mt-1.5 md:h-1 md:w-14" />
        </div>
        <Link to="/shop/products" className="mb-0.5 inline-flex min-h-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-black text-stone-700 shadow-[0_10px_26px_rgba(39,20,75,0.07)] transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] active:scale-[0.98] md:mb-1 md:min-h-10 md:px-5 md:py-2 md:text-xs dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
          {t("common.viewAll", "عرض الكل")}
        </Link>
      </div>
      <div className="sf-product-rail sf-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1.5 md:flex-nowrap md:gap-4 md:overflow-hidden md:pb-1">
        {loading ? skeletonItems.map((_, index) => (
          <div key={index} className={`w-[82vw] max-w-[22rem] shrink-0 snap-start sm:w-[43vw] md:w-auto md:max-w-none md:basis-[calc((100%_-_2rem)/3)] xl:basis-[calc((100%_-_4rem)/5)] ${index >= 3 ? "md:hidden xl:block" : ""}`}>
            <div className="h-56 animate-pulse rounded-[1.35rem] bg-white shadow-[0_12px_32px_rgba(39,20,75,0.06)] md:h-72 md:rounded-[1.75rem] dark:bg-white/5" />
          </div>
        )) : visibleProducts.map((product, index) => (
          <div key={productCardKey(product, index)} className={`w-[82vw] max-w-[22rem] shrink-0 snap-start sm:w-[43vw] md:w-auto md:max-w-none md:basis-[calc((100%_-_2rem)/3)] xl:basis-[calc((100%_-_4rem)/5)] ${index >= 3 ? "md:hidden xl:block" : ""}`}>
            <ProductCard product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} railType={railType} rank={index + 1} featured={featuredFirst && index === 0} density={cardDensity} imagePreset="grid" />
          </div>
        ))}
      </div>
    </section>
  );
});

function MiniRailEmpty() {
  const { t } = useTranslation();
  return (
    <div className="rounded-[1.5rem] border border-[#8b5cf6]/18 bg-[linear-gradient(180deg,rgba(18,18,28,0.96),rgba(7,10,20,0.94))] p-6 text-center text-stone-50 shadow-[0_18px_45px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-[#8b5cf6]/20 bg-[#7c3aed]/14 text-[#c4b5fd]">
        <Sparkles className="h-6 w-6" />
      </span>
      <h3 className="mt-3 text-lg font-black text-stone-50">{t("storefront.products.emptyRailTitle", "لا توجد منتجات بعد")}</h3>
      <p className="mt-1 text-sm font-bold text-stone-400">{t("storefront.products.comingSoon", "ظ‚ط±ظٹط¨ظ‹ط§")}</p>
    </div>
  );
}

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

const ProductGrid = memo(function ProductGrid({ products = [], loading, wishlist, toggleWishlist, onAddToCart }) {
  const columns = useStorefrontProductGridColumns();
  const shouldVirtualize = columns >= 4 && products.length > 40;
  const renderProduct = useCallback((product, index, key) => (
    <ProductCard
      key={key}
      product={product}
      wishlist={wishlist}
      toggleWishlist={toggleWishlist}
      onAddToCart={onAddToCart}
      sizeLimit={6}
    />
  ), [onAddToCart, toggleWishlist, wishlist]);

  if (loading) return <ProductSkeleton count={8} />;

  if (shouldVirtualize) {
    return (
      <VirtualGrid
        items={products}
        columns={columns}
        estimateRowHeight={380}
        className="max-h-[calc(100vh-10rem)] min-h-[36rem] overflow-y-auto overflow-x-hidden pr-1"
        gridClassName="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-5"
        itemKey={(product, index) => productCardKey(product, index)}
        renderItem={renderProduct}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-5">
      {products.map((product, index) => renderProduct(product, index, productCardKey(product, index)))}
    </div>
  );
});

const productHasAvailableSize = (product = {}, size = "") => {
  const target = String(size || "").trim().toLowerCase();
  if (!target) return true;
  return (Array.isArray(product.variants) ? product.variants : []).some((variant) =>
    String(variant?.size || "").trim().toLowerCase() === target && variantHasStock(variant)
  );
};

const buildAvailableSizeOptions = (products = []) => {
  const sizes = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
      const size = String(variant?.size || "").trim();
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
    const numericA = Number(a.size);
    const numericB = Number(b.size);
    if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
    return String(a.size).localeCompare(String(b.size), "ar", { numeric: true });
  });
};

function StepPill({ active, done, label }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] md:px-3 md:py-1.5 md:text-xs ${active ? "border-[#7c3aed] bg-[#f5f3ff] text-[#6d28d9]" : done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200 bg-white text-stone-500"} dark:border-white/10 dark:bg-white/5 dark:text-stone-200`}>
      {label}
    </span>
  );
}

function GuidedGenderStep({ options = [], selectedGender, lang, onSelect }) {
  const { t } = useTranslation();
  return (
    <section className="scroll-mt-28">
      <div className="mb-2.5 flex items-end justify-between gap-2 md:mb-3 md:gap-3">
        <SectionIntro eyebrow={t("storefront.filters.gender", "Gender")} title={t("storefront.products.chooseWearer", "Choose wearer")} subtitle={t("storefront.products.chooseWearerSubtitle", "Pick a wearer to see the right styles.")} compact />
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 md:gap-2.5">
        {options.map((option) => {
          const active = String(selectedGender || "") === String(option.value || "");
          const Icon = filterOptionIcon("gender", option, lang);
          return (
            <button
              key={option.id || option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`group min-h-[88px] rounded-[0.8rem] border p-2 text-right shadow-[0_10px_24px_rgba(39,20,75,0.055)] transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-[150px] md:rounded-[1.35rem] md:p-4 ${
                active
                  ? "border-[#7c3aed] bg-[#f5f3ff] text-[#5b21b6] ring-2 ring-[#7c3aed]/15"
                  : "border-stone-200 bg-white text-stone-900 hover:border-[#7c3aed]/45 dark:border-white/10 dark:bg-[#0b1020] dark:text-white"
              }`}
            >
              <span className={`grid h-8 w-8 place-items-center rounded-lg md:rounded-2xl ${active ? "bg-[#7c3aed] text-white" : "bg-stone-100 text-[#6d28d9] dark:bg-white/8"} md:h-11 md:w-11`}>
                <Icon className="h-3.5 w-3.5 md:h-5 md:w-5" />
              </span>
              <span className="mt-1.5 block text-[13px] font-black leading-4 md:mt-3 md:text-lg md:leading-6">{classificationLabel(option, lang)}</span>
              <span className="mt-0.5 block text-[9.5px] font-bold leading-3 text-stone-500 dark:text-stone-400 md:mt-1 md:text-xs md:leading-5">{t("storefront.products.chooseAndViewTypes", "Choose and view types")}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GuidedProductTypeStep({ options = [], selectedProductType, lang, disabled, loading, products = [], onSelect }) {
  const { t } = useTranslation();
  const productCountByType = useMemo(() => {
    const counts = new Map();
    for (const product of Array.isArray(products) ? products : []) {
      const key = String(product?.product_type || product?.productType || product?.category || "").trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [products]);
  return (
    <div className={`rounded-[0.9rem] border border-stone-200 bg-white p-1 shadow-[0_10px_24px_rgba(39,20,75,0.05)] dark:border-white/10 dark:bg-[#0b1020] md:rounded-[1.5rem] md:p-3 ${disabled ? "pointer-events-none opacity-55" : ""}`}>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:gap-2 lg:grid-cols-5">
        {loading ? <ProductTypeSkeleton /> : options.map((option) => {
          const active = String(selectedProductType || "") === String(option.value || "");
          const Icon = filterOptionIcon("product_type", option, lang);
          const count = productCountByType.get(String(option.value || "").trim().toLowerCase()) ?? filterOptionCount(option);
          return (
            <button
              key={option.id || option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`group min-h-[82px] rounded-[0.75rem] border p-1.5 text-right transition hover:-translate-y-0.5 active:scale-[0.98] md:min-h-[128px] md:rounded-[1.25rem] md:p-3 ${
                active
                  ? "border-[#7c3aed] bg-[#f5f3ff] text-[#5b21b6] ring-2 ring-[#7c3aed]/15"
                  : "border-stone-200 bg-[#fbfaf7] text-stone-900 hover:border-[#7c3aed]/45 dark:border-white/10 dark:bg-white/5 dark:text-white"
              }`}
            >
              <span className={`grid h-7 w-7 place-items-center rounded-lg md:rounded-2xl ${active ? "bg-[#7c3aed] text-white" : "bg-white text-[#6d28d9] shadow-sm dark:bg-white/8"} md:h-10 md:w-10`}>
                <Icon className="h-3.5 w-3.5 md:h-5 md:w-5" />
              </span>
              <span className="mt-1.5 block truncate text-[12px] font-black leading-4 md:mt-3 md:text-sm md:leading-5">{classificationLabel(option, lang)}</span>
              {Number.isFinite(Number(count)) ? <span className="mt-0.5 block text-[9.5px] font-bold leading-3 text-stone-500 dark:text-stone-400 md:mt-1 md:text-[11px] md:leading-4">{t("storefront.products.productCount", "{{count}} items", { count })}</span> : null}
            </button>
          );
        })}
      </div>
      {!loading && !options.length ? <EmptyState title={t("storefront.products.noTypesForCategory", "No types available for this category")} text={t("storefront.products.goBackChooseAnother", "Go back and choose another category.")} /> : null}
    </div>
  );
}

function ProductTypeSkeleton() {
  return Array.from({ length: 5 }).map((_, index) => (
    <div key={index} className="h-[82px] animate-pulse rounded-[0.75rem] bg-stone-100 dark:bg-white/5 md:h-28 md:rounded-[1.25rem]" />
  ));
}

function GuidedSizeFilter({ sizes = [], selectedSize, onSelect, disabled }) {
  const { t } = useTranslation();
  return (
    <div className={`mb-2.5 rounded-[0.9rem] border border-stone-200 bg-white p-2 shadow-[0_10px_24px_rgba(39,20,75,0.05)] dark:border-white/10 dark:bg-[#0b1020] md:mb-4 md:rounded-[1.35rem] md:p-3 ${disabled ? "opacity-55" : ""}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2 md:mb-2 md:gap-3">
        <div>
          <p className="text-[8.5px] font-black uppercase tracking-[0.14em] text-[#7c3aed] md:text-[10px] md:tracking-[0.18em]">{t("storefront.filters.sizeFilter", "Size filter")}</p>
          <h3 className="text-xs font-black md:text-sm">{t("storefront.filters.availableSize", "Available sizes")}</h3>
        </div>
        {selectedSize ? (
          <button type="button" onClick={() => onSelect("")} className="rounded-full bg-stone-100 px-2 py-1 text-[10.5px] font-black text-stone-600 transition hover:bg-stone-950 hover:text-white dark:bg-white/8 dark:text-stone-200 md:px-3 md:py-1.5 md:text-xs">
            {t("storefront.filters.showAllSizes", "Show all sizes")}
          </button>
        ) : null}
      </div>
      <div className="sf-scroll flex gap-1.5 overflow-x-auto pb-0.5 md:gap-2 md:pb-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect("")}
          className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[10.5px] font-black transition md:px-4 md:py-2 md:text-xs ${!selectedSize ? "border-[#7c3aed] bg-[#f5f3ff] text-[#6d28d9]" : "border-stone-200 bg-stone-50 text-stone-700 hover:border-[#7c3aed]/50 dark:border-white/10 dark:bg-white/5 dark:text-stone-200"}`}
        >
          {t("common.all", "All")}
        </button>
        {sizes.map((item) => {
          const active = String(selectedSize) === String(item.size);
          return (
            <button
              key={item.size}
              type="button"
              disabled={disabled || !item.available}
              onClick={() => onSelect(item.size)}
              className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[10.5px] font-black transition md:px-4 md:py-2 md:text-xs ${
                active
                  ? "border-[#7c3aed] bg-[#7c3aed] text-white shadow-[0_10px_24px_rgba(124,58,237,0.24)]"
                  : "border-stone-200 bg-stone-50 text-stone-700 hover:border-[#7c3aed]/50 dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
              } disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-300 disabled:line-through dark:disabled:bg-white/5 dark:disabled:text-stone-500`}
            >
              {item.size}
              {item.available ? <span className="mr-1 opacity-60">({item.productCount})</span> : null}
            </button>
          );
        })}
        {!sizes.length ? <span className="rounded-full border border-dashed border-stone-200 px-2.5 py-1.5 text-[10.5px] font-bold text-stone-400 dark:border-white/10 md:px-4 md:py-2 md:text-xs">{t("storefront.filters.sizesAppearAfterType", "Sizes appear after selecting a type")}</span> : null}
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
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7c3aed]">{t("storefront.filters.curatedFilters", "Curated filters")}</p>
            <h2 className="text-sm font-black text-stone-950 dark:text-white">{t("storefront.filters.quickPremium", "Quick premium filters")}</h2>
          </div>
        </div>
        {activeFilterCount ? (
          <Link
            to={clearUrl}
            className="rounded-full border border-stone-200 bg-white/80 px-4 py-2 text-[11px] font-black text-stone-600 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-[#7c3aed]/35 hover:text-[#6d28d9] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
          >
            {t("storefront.filters.clearFilters", "Clear filters")}
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
      <div className="pointer-events-none absolute -left-10 -top-10 h-28 w-28 rounded-full bg-[#7c3aed]/18 blur-3xl transition group-hover/filter:bg-[#7c3aed]/28" />
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
        {section.value ? <span className="h-2 w-2 rounded-full bg-[#d8b4fe] shadow-[0_0_18px_rgba(216,180,254,0.85)]" /> : null}
      </div>
      <div className="relative flex flex-wrap gap-2">
        <PremiumFilterChip to={buildFilterUrl(section.key, "")} active={!section.value} icon={Tag} label={t("common.all", "All")} />
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
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] font-black transition duration-200 ${
        active
          ? "scale-[1.03] border-[#d8b4fe]/55 bg-[linear-gradient(135deg,rgba(124,58,237,0.95),rgba(17,24,39,0.92))] text-white shadow-[0_12px_30px_rgba(124,58,237,0.32)]"
          : "border-white/10 bg-white/6 text-white/70 hover:-translate-y-0.5 hover:border-[#a78bfa]/40 hover:bg-white/10 hover:text-white"
      }`}
      style={!active && color ? { borderColor: `${color}44` } : undefined}
    >
      {preview ? <span className="h-3 w-3 rounded-full border border-white/20" style={{ background: color || "#7c3aed" }} /> : <Icon className="h-3.5 w-3.5" />}
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
      <span>{t("storefront.filters.filters", "Filters")}</span>
      {activeFilterCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#d8b4fe] px-1 text-[10px] text-stone-950">{activeFilterCount}</span> : null}
    </button>
  );
}

function MobileFilterDrawer({ open, sections, lang, draftFilters, setDraftFilters, onClose, onApply, onReset }) {
  const { t } = useTranslation();
  const visibleSections = renderableFilterSections(sections);
  if (!open) return null;
  return (
    <div className="sf-mobile-filter-drawer fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-stone-950/55 backdrop-blur-sm" onClick={onClose} aria-label={t("storefront.filters.closeFilters", "Close filters")} />
      <div className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-hidden rounded-t-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,#101426_0%,#070b16_100%)] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.42)]">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-white/20" />
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3.5 py-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#d8b4fe]">{t("storefront.filters.premiumFilters", "Premium filters")}</p>
            <h2 className="text-base font-black">{t("storefront.filters.chooseWhatFits", "Choose what fits")}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 transition active:scale-95" aria-label={t("common.close", "Close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scroll max-h-[calc(82dvh-124px)] space-y-1.5 overflow-y-auto px-2.5 py-2.5 pb-24">
          {visibleSections.map((section) => (
            <MobileFilterSection key={section.key} section={section} lang={lang} draftValue={draftFilters[section.key] || ""} onSelect={(value) => setDraftFilters((current) => ({ ...current, [section.key]: value }))} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-white/10 bg-[#070b16]/92 px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] backdrop-blur-xl">
          <button type="button" onClick={onApply} className="flex-1 rounded-xl bg-gradient-to-l from-[#7c3aed] to-[#111827] px-4 py-2.5 text-sm font-black text-white shadow-[0_14px_34px_rgba(124,58,237,0.32)] active:scale-[0.98]">
            {t("storefront.filters.applyFilters", "Apply filters")}
          </button>
          <button type="button" onClick={onReset} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-black text-white/80 active:scale-[0.98]">
            {t("common.reset", "Reset")}
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
        <MobileFilterChip active={!draftValue} label={t("common.all", "All")} icon={Tag} onClick={() => onSelect("")} />
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
      className={`inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9.5px] font-black transition ${
        active
          ? "scale-[1.03] border-[#d8b4fe]/60 bg-[linear-gradient(135deg,rgba(124,58,237,0.95),rgba(17,24,39,0.92))] text-white shadow-[0_12px_30px_rgba(124,58,237,0.34)]"
          : "border-white/10 bg-white/6 text-white/65"
      }`}
      style={!active && color ? { borderColor: `${color}44` } : undefined}
    >
      {preview ? <span className="h-2.5 w-2.5 rounded-full border border-white/20" style={{ background: color || "#7c3aed" }} /> : <Icon className="h-3 w-3" />}
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
    if (label.includes("kid") || label.includes("child") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ")) return Baby;
    if (label.includes("women") || label.includes("woman") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ³ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹")) return Heart;
    return Users;
  }
  if (sectionKey === "product_type") {
    if (label.includes("bag") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ´ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ·") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¹ط£آ¢أ¢â€ڑآ¬ط¹آ©ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ©")) return Briefcase;
    if (label.includes("sneaker") || label.includes("shoe") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¦ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط£آ¢أ¢â‚¬â€چط¢آ¢ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ«ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¹ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ´ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ°ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¥ط£آ¢أ¢â€ڑآ¬أ¢â€‍آ¢")) return Footprints;
    return ShoppingBag;
  }
  if (sectionKey === "grade") {
    if (label.includes("mirror") || label.includes("original") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ«ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¬ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ")) return Crown;
    if (label.includes("import") || label.includes("vietnam") || label.includes("ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¹ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦")) return Gem;
    return ShieldCheck;
  }
  return Sparkles;
}

const swatchColorStyle = (label = "") => {
  const value = String(label || "").toLowerCase();
  const color =
    /(black|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ³ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ«ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¯|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ³ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ«ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¯|charcoal)/.test(value) ? "#111827" :
    /(white|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¶|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¶|ivory|cream|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ«ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ«ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¦ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط£آ¢أ¢â‚¬â€چط¢آ¢ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹)/.test(value) ? "#f8fafc" :
    /(burgundy|maroon|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¹ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹)/.test(value) ? "#7f1d1d" :
    /(red|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±)/.test(value) ? "#dc2626" :
    /(blue|navy|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ²ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¹ط£آ¢أ¢â€ڑآ¬ط¹آ©|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ²ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¹ط£آ¢أ¢â€ڑآ¬ط¹آ©|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¦ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط£آ¢أ¢â‚¬â€چط¢آ¢ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹)/.test(value) ? "#2563eb" :
    /(green|olive|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ®ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¶ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ®ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¶ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ²ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¹ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹)/.test(value) ? "#16a34a" :
    /(brown|mocha|coffee|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¦ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط£آ¢أ¢â‚¬â€چط¢آ¢ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ·ط·آ¥أ¢â‚¬â„¢)/.test(value) ? "#7c4a2d" :
    /(beige|tan|camel|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¬|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¬ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹)/.test(value) ? "#d6b88f" :
    /(grey|gray|silver|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¯ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¶ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ³ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±)/.test(value) ? "#a1a1aa" :
    /(pink|rose|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ«ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¯ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹)/.test(value) ? "#fb7185" :
    /(purple|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ³ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¬ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹)/.test(value) ? "#7c3aed" :
    /(yellow|gold|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آµط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آµط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±|ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ°ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ·ط·آ¥أ¢â‚¬â„¢ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹)/.test(value) ? "#facc15" :
    "#8b5cf6";
  return { background: color };
};

function HeaderAction({ to, icon, count, label, className = "" }) {
  return (
    <Link to={to} className={`sf-header-action ${className}`} aria-label={label} title={label}>
      {icon}
      {count ? <span className="sf-action-badge">{count}</span> : null}
    </Link>
  );
}

function Header({ cartCount, wishlistCount, onCart, onAddToCart, effectiveTheme, onToggleTheme, brandName = "MONE", brandTagline = "", brandLogoUrl = "" }) {
  const { i18n: storefrontI18n, t } = useTranslation();
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [visualSearch, setVisualSearch] = useState({ active: false, keywords: [], message: "", error: "", previewUrl: "", fileName: "" });
  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const imageSearchResults = visualSearch;
  const setImageSearchResults = setVisualSearch;
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState(() => readJson(SEARCH_RECENT_KEY, []));
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [isCompact, setIsCompact] = useState(false);
  const visualPreviewUrlRef = useRef("");
  const selectedVisualImageRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const deferredSearch = useDeferredValue(search);
  const compactDisabled = /^\/shop\/product\/[^/]+/.test(location.pathname);
  const currentLanguage = normalizeLanguage(storefrontI18n.resolvedLanguage || storefrontI18n.language || "en");
  const nextLanguage = currentLanguage === "ar" ? "en" : "ar";
  const languageLabel =
    nextLanguage === "ar"
      ? t("storefront.header.languageArabic", "Arabic")
      : t("storefront.header.languageEnglish", "English");
  const searchPlaceholders = getSearchPlaceholders();
  const announcementItems = [
    { label: t("storefront.header.announcements.fastShipping", "Fast shipping in Egypt"), icon: <Truck className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.announcements.exchange", "14-day exchange"), icon: <RefreshCcw className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.announcements.cod", "Cash on delivery"), icon: <PackageCheck className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.announcements.premium", "Mirror Premium products"), icon: <Sparkles className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.announcements.todayDeals", "Today's deals"), icon: <BadgePercent className="h-3.5 w-3.5" /> },
  ];
  const utilityItems = [
    { label: "WhatsApp", to: "https://wa.me/", icon: <MessageCircle className="h-3.5 w-3.5" />, external: true },
    { label: t("storefront.header.trackOrder", "Track order"), to: "/shop/track", icon: <PackageSearch className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.wishlist", "Wishlist"), to: "/shop/wishlist", icon: <Heart className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.account", "Account"), to: "/shop/account", icon: <User className="h-3.5 w-3.5" /> },
  ];
  const navItems = [
    [t("storefront.nav.categories", "Categories"), "/shop/products"],
    [t("storefront.nav.sale", "Sale"), "/shop/sale"],
    [t("storefront.nav.new", "New"), "/shop/products?sort=new"],
    [t("storefront.nav.men", "Men"), "/shop/products?q=men"],
    [t("storefront.nav.women", "Women"), "/shop/products?q=women"],
    [t("storefront.nav.kids", "Kids"), "/shop/products?q=kids"],
  ];
  const themeIsDark = effectiveTheme === "dark";
  const themeToggleLabel = themeIsDark
    ? t("storefront.header.lightMode", "Switch to light mode")
    : t("storefront.header.darkMode", "Switch to dark mode");
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
    setVisualSearch({ active: false, keywords: [], message: "", error: "", previewUrl: "", fileName: "" });
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
    navigate(`/shop/products?q=${encodeURIComponent(term)}`);
  };

  const pickSearchTerm = (term) => {
    const value = String(term || "").trim();
    if (!value) return;
    setSearch(value);
    rememberSearch(value);
    closeSearch();
    navigate(`/shop/products?q=${encodeURIComponent(value)}`);
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
      toast.error(sfText("storefront.toasts.voiceUnsupported", "Voice search is not supported in this browser."));
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
        toast.error(sfText("storefront.toasts.unsupportedImageType", "Unsupported image type. Use JPG, PNG, or WEBP."));
        selectedVisualImageRef.current = null;
        event.target.value = "";
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error(sfText("storefront.toasts.imageTooLarge", "The image is too large. Upload a smaller image."));
        selectedVisualImageRef.current = null;
        event.target.value = "";
        return;
      }
      const label = file.name.replace(/\.[^.]+$/, "") || "Untitled";
      if (visualPreviewUrlRef.current) URL.revokeObjectURL(visualPreviewUrlRef.current);
      const previewUrl = URL.createObjectURL(file);
      visualPreviewUrlRef.current = previewUrl;
      setSearch(`Image: ${label}`);
      setSuggestions([]);
      setImageSearchOpen(true);
      setVisualSearch({ active: true, keywords: [], message: "", error: "", previewUrl, fileName: file.name });
      setSearchLoading(true);
      setSearchOpen(true);
      setMobileSearchOpen(true);
      const formData = new FormData();
      formData.append("image", selectedVisualImageRef.current);
      const tenantId = resolveStorefrontTenantId();
      formData.append("tenant_id", tenantId);
      const endpoint = "/storefront/products/visual-search";
      try {
        const data = await api.post(endpoint, formData, { timeoutMs: 45000, headers: { "x-tenant-id": tenantId } });
        const products = Array.isArray(data.products) ? data.products : [];
        setSuggestions(products);
        setVisualSearch({
          active: true,
          keywords: Array.isArray(data.keywords) ? data.keywords : [],
          message: products.length ? "" : data.message || "No matches found for this image.",
          error: "",
          previewUrl,
          fileName: file.name,
        });
        setImageSearchOpen(true);
      } catch (error) {
        const message =
          error?.responseBody?.message ||
          error?.responseBody?.error ||
          (error?.message && error.message !== "Request Failed" ? error.message : "") ||
          "Image search failed. Please try again.";
        setSuggestions([]);
        setVisualSearch({ active: true, keywords: [], message: "", error: message, previewUrl, fileName: file.name });
        setImageSearchOpen(true);
        toast.error(message);
      } finally {
        setSearchLoading(false);
        selectedVisualImageRef.current = null;
      }
    }
    event.target.value = "";
  };

  const toggleNotifications = () => {
    setNotificationsOpen((value) => {
      const next = !value;
      if (next && notifications.length === 0) {
        cachedStorefrontGet("/storefront/notifications", { ttlMs: 30 * 1000 })
          .then((data) => setNotifications(data.notifications || []))
          .catch(() => setNotifications([]));
      }
      return next;
    });
  };

  const switchLanguage = async () => {
    persistApplicationLanguage(nextLanguage);
    await storefrontI18n.changeLanguage(nextLanguage);
    applyDocumentLanguage(nextLanguage);
  };

  return (
    <header
      data-compact={!compactDisabled && isCompact ? "true" : "false"}
      className="sf-luxury-header sticky top-0 z-40 border-b border-stone-200/70 bg-[#fcfaf6]/88 shadow-[0_16px_48px_rgba(39,20,75,0.07)] backdrop-blur-2xl transition-all duration-300 dark:border-white/10 dark:bg-[#090d18]/92 dark:shadow-[0_16px_48px_rgba(0,0,0,0.28)]"
    >
      <div className="sf-announcement-row sf-header-announcement h-10 overflow-hidden bg-[linear-gradient(105deg,#09090b,#1c1917_42%,#312e81)] text-white/90 backdrop-blur transition-all duration-300">
        <div className="sf-announcement-track h-full">
          {[...announcementItems, ...announcementItems].map((item, index) => (
            <span key={`${item.label}-${index}`} className="inline-flex h-full items-center gap-2 px-7 text-[12px] font-medium tracking-wide text-stone-100/95">
              <span className="sf-header-announcement-icon text-white/72">{item.icon}</span>
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="sf-utility-row hidden border-b border-stone-200/70 bg-white/45 px-4 text-xs font-semibold text-stone-500 transition-all duration-300 dark:border-white/10 dark:bg-white/[0.035] dark:text-stone-400 sm:block">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            {utilityItems.map((item) => {
              const className = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:bg-white hover:text-stone-950 dark:hover:bg-white/8 dark:hover:text-white";
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
            <button type="button" onClick={switchLanguage} className="rounded-full px-2.5 py-1 transition hover:bg-white hover:text-stone-950 dark:hover:bg-white/8 dark:hover:text-white">{languageLabel}</button>
            <span className="h-3 w-px bg-stone-300/80 dark:bg-white/12" />
            <button type="button" className="rounded-full px-2.5 py-1 transition hover:bg-white hover:text-stone-950 dark:hover:bg-white/8 dark:hover:text-white">{getCurrency().code}</button>
          </div>
        </div>
      </div>
      <div className="sf-main-row sf-header-main mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 transition-all duration-300 md:grid-cols-[auto_auto_minmax(320px,520px)_auto] md:gap-5 md:py-3">
        <button className="grid h-11 w-11 place-items-center rounded-2xl border border-stone-200/80 bg-white/70 transition hover:border-stone-300 hover:bg-white active:scale-95 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 md:hidden" onClick={() => setMenuOpen((value) => !value)} aria-label={t("storefront.header.menu", "Menu")}>
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
        <Link to="/shop" className="sf-header-logo group inline-flex items-center gap-2 text-stone-950 transition hover:text-[#6d28d9] dark:text-white">
          <span className="sf-header-logo-chip grid h-10 w-10 place-items-center overflow-hidden rounded-2xl bg-stone-950 text-sm font-black tracking-[0.18em] text-white shadow-[0_12px_30px_rgba(28,25,23,0.16)] transition group-hover:scale-105 group-hover:bg-[#6d28d9] dark:bg-white dark:text-stone-950 dark:group-hover:text-white">
            {brandLogoUrl ? <img src={resolveProductImageUrl(brandLogoUrl)} alt={brandName} className="h-full w-full object-contain p-1.5" loading="lazy" decoding="async" width="40" height="40" /> : "MS"}
          </span>
          <span className="hidden leading-none sm:block">
            <span className="sf-header-logo-title block text-xl font-black tracking-[0.18em]">{brandName || "MONE"}</span>
            <span className="sf-header-logo-subtitle mt-1 block text-[10px] font-semibold uppercase tracking-[0.32em] text-stone-500 dark:text-stone-400">{brandTagline || t("storefront.header.tagline", "Premium Shoes")}</span>
          </span>
        </Link>
        <nav className="sf-collapsible-nav hidden items-center gap-1 text-sm font-bold text-stone-700 dark:text-stone-300 md:flex">
          {navItems.map(([label, to]) => (
            <NavLink
              key={label}
              to={to}
              className={({ isActive }) => `sf-nav-link sf-header-nav-link relative rounded-full px-3 py-2 transition ${isActive ? "text-stone-950 dark:text-white" : "hover:text-stone-950 dark:hover:text-white"}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
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
          className="hidden md:block"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            className="sf-header-action"
            aria-label={themeToggleLabel}
            title={themeToggleLabel}
          >
            {themeIsDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <HeaderAction to="/shop/wishlist" label={t("storefront.header.wishlist", "Wishlist")} count={wishlistCount} icon={<Heart className="h-5 w-5" />} className="sf-secondary-action hidden md:grid" />
          <HeaderAction to="/shop/account" label={t("storefront.header.account", "Account")} icon={<User className="h-5 w-5" />} className="sf-secondary-action hidden md:grid" />
          <div className="sf-secondary-action relative hidden md:block">
            <button onClick={toggleNotifications} className="sf-header-action" aria-label={t("storefront.header.notifications", "Notifications")}> 
              <Bell className="h-5 w-5" />
            </button>
          {notificationsOpen ? (
            <div className="absolute left-0 top-12 z-50 w-80 rounded-3xl border border-stone-200 bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-[#0b1020]">
              <div className="mb-2 px-2 text-sm font-black">{t("storefront.header.notifications", "Notifications")}</div>
              {notifications.length ? notifications.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-2xl bg-stone-50 p-3 dark:bg-white/5">
                  <div className="text-sm font-black">{item.title}</div>
                  <div className="mt-1 text-xs font-bold text-stone-500">{item.body}</div>
                </div>
              )) : <div className="rounded-2xl bg-stone-50 p-3 text-sm font-bold text-stone-500 dark:bg-white/5">{t("storefront.header.noNotifications", "No notifications right now")}</div>}
            </div>
          ) : null}
          </div>
          <button onClick={onCart} className="sf-header-action sf-cart-action" aria-label={t("storefront.cart.title", "Cart")}>
            <ShoppingCart className="h-5 w-5" />
            {cartCount ? <span className="sf-action-badge">{cartCount}</span> : null}
          </button>
        </div>
      </div>
      <div className="sf-mobile-search bg-[#fcfaf6]/94 px-4 pb-3 pt-1 backdrop-blur transition-all duration-300 dark:bg-[#090d18]/96 md:hidden">
        <button
          type="button"
          onClick={() => {
            setSearchOpen(true);
            setMobileSearchOpen(true);
          }}
          className="sf-mobile-search-trigger flex h-12 w-full items-center gap-3 rounded-2xl border border-stone-200/90 bg-white/70 px-4 text-right text-sm font-bold text-stone-500 shadow-[0_12px_32px_rgba(39,20,75,0.055)] backdrop-blur dark:border-white/10 dark:bg-white/6 dark:text-stone-400"
        >
          <Search className="sf-mobile-search-trigger-icon h-4.5 w-4.5 text-[#7c3aed]" />
          <span>{searchPlaceholders[placeholderIndex] || searchPlaceholders[0]}</span>
        </button>
      </div>
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
        mobileOnly
      />
      {menuOpen ? (
        <div className="grid gap-2 border-t border-stone-200 bg-white/96 px-4 py-4 text-sm font-bold backdrop-blur dark:border-white/10 dark:bg-[#0b1020]/96 md:hidden">
          {[t("storefront.nav.home", "Home"), t("storefront.nav.categories", "Categories"), t("storefront.nav.sale", "Sale"), t("storefront.nav.new", "New"), t("storefront.nav.men", "Men"), t("storefront.nav.women", "Women"), t("storefront.nav.sizeGuide", "Size Guide"), t("storefront.nav.returns", "Returns")].map((label, index) => (
            <Link key={label} to={["/shop", "/shop/products", "/shop/sale", "/shop/products?sort=new", "/shop/products?q=men", "/shop/products?q=women", "/shop/size-guide", "/shop/returns"][index]} onClick={() => setMenuOpen(false)} className="rounded-2xl px-3 py-3 transition hover:bg-stone-100 dark:hover:bg-white/5 active:scale-[0.98]">
              {label}
            </Link>
          ))}
        </div>
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
  setMobileOpen,
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
  className = "",
  mobileOnly = false,
}) {
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const trendingSearches = getTrendingSearches();
  const searchFallbackSections = getSearchFallbackSections();
  const chips = value.trim() ? [] : [...recentSearches, ...trendingSearches].filter(Boolean);
  const keyboardItems = [...suggestions.map((item) => ({ type: "product", item })), ...chips.map((term) => ({ type: "term", term }))];

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
      <div className="group relative overflow-hidden rounded-[1.35rem] border border-white/50 bg-white/72 shadow-[0_18px_50px_rgba(39,20,75,0.10)] backdrop-blur-2xl transition duration-300 focus-within:border-[#a78bfa]/70 focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(124,58,237,0.10),0_24px_70px_rgba(109,40,217,0.18)] dark:border-white/10 dark:bg-white/[0.075] dark:focus-within:bg-white/[0.10]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_20%,rgba(216,180,254,0.22),transparent_28%)] opacity-0 transition group-focus-within:opacity-100" />
        <Search className="pointer-events-none absolute right-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#7c3aed] dark:text-[#d8b4fe]" />
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
          className="relative z-10 h-13 w-full bg-transparent pr-12 pl-24 text-sm font-bold text-stone-950 outline-none placeholder:text-stone-400 dark:text-white dark:placeholder:text-stone-500 md:h-12"
          aria-label="Search storefront"
          role="combobox"
          aria-expanded={Boolean(open || mobileOpen)}
        />
        <div className="absolute left-2 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1.5">
          <button type="button" onClick={onVoice} className="grid h-8 w-8 place-items-center rounded-full bg-stone-950/5 text-stone-600 transition hover:bg-[#7c3aed] hover:text-white dark:bg-white/8 dark:text-stone-200" aria-label="Voice search">
            <Mic className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="grid h-8 w-8 place-items-center rounded-full bg-stone-950/5 text-stone-600 transition hover:bg-[#7c3aed] hover:text-white dark:bg-white/8 dark:text-stone-200" aria-label="Image search">
            <ImagePlus className="h-4 w-4" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onImage} />
        </div>
      </div>
    </form>
  );

  const resultsPanel = (
    <div className="rounded-[1.6rem] border border-white/60 bg-white/92 p-3 text-stone-950 shadow-[0_28px_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#090d18]/96 dark:text-white">
      <SearchQuickSections
        value={value}
        loading={loading}
        suggestions={suggestions}
        chips={chips}
        activeIndex={activeIndex}
        onPickTerm={onPickTerm}
        onPickProduct={onPickProduct}
        trendingSearches={trendingSearches}
        searchFallbackSections={searchFallbackSections}
      />
    </div>
  );

  if (mobileOnly) {
    if (!mobileOpen) return null;
    return (
      <div className="fixed inset-0 z-[100] bg-[#070b16]/88 p-4 pt-[calc(1rem+env(safe-area-inset-top))] text-white backdrop-blur-2xl md:hidden" dir="rtl">
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

function SearchQuickSections({ value, loading, suggestions, chips, activeIndex, onPickTerm, onPickProduct, trendingSearches = [], searchFallbackSections = {} }) {
  const query = value.trim();
  return (
    <div className="grid gap-3">
      {query ? (
        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-black text-stone-500 dark:text-stone-400">Search results</span>
            {loading ? <span className="text-[11px] font-bold text-[#7c3aed]">Searching...</span> : null}
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
                Search for "{query}"
              </button>
            )}
          </div>
        </div>
      ) : null}

      {!query ? (
        <>
          <SearchChips title="Trending searches" items={trendingSearches} onPick={onPickTerm} />
          {chips.length ? <SearchChips title="Popular searches" items={chips.slice(0, 6)} onPick={onPickTerm} /> : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <SearchQuickCard title="Categories" items={searchFallbackSections.categories || []} onPick={onPickTerm} />
            <SearchQuickCard title="Brands" items={searchFallbackSections.brands || []} onPick={onPickTerm} />
            <SearchQuickCard title="Styles" items={searchFallbackSections.styles || []} onPick={onPickTerm} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function SearchChips({ title, items, onPick }) {
  return (
    <div>
      <div className="mb-2 px-1 text-xs font-black text-stone-500 dark:text-stone-400">{title}</div>
      <div className="flex flex-wrap gap-2">
        {[...new Set(items)].slice(0, 8).map((item) => (
          <button key={item} type="button" onClick={() => onPick(item)} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-black text-stone-700 transition hover:border-[#7c3aed]/40 hover:text-[#6d28d9] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchQuickCard({ title, items, onPick }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="mb-2 text-xs font-black text-stone-500 dark:text-stone-400">{title}</div>
      <div className="grid gap-1">
        {items.map((item) => (
          <button key={item} type="button" onClick={() => onPick(item)} className="rounded-xl px-2 py-1.5 text-right text-xs font-bold text-stone-700 transition hover:bg-white dark:text-stone-200 dark:hover:bg-white/8">
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
      className={`flex items-center gap-3 rounded-2xl p-2 text-right transition hover:bg-[#f7f4ee] active:scale-[0.99] dark:hover:bg-white/5 ${active ? "bg-[#f5f3ff] dark:bg-white/8" : ""}`}
    >
      <img src={imageFor(product.image_url)} alt="" className="h-14 w-14 rounded-2xl bg-stone-100 object-cover shadow-sm dark:bg-white/5" loading="lazy" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black">{product.name}</div>
        <div className="truncate text-xs font-bold text-stone-500 dark:text-stone-400">
          {[product.category, product.brand, product.style, product.grade].filter(Boolean).join(" / ") || product.sizes?.slice(0, 4).join(" / ") || "Browse items"}
        </div>
      </div>
      <div className="rounded-full bg-stone-950 px-3 py-1 text-xs font-black text-white dark:bg-white dark:text-stone-950">{money(product.sale_price || product.price)}</div>
    </button>
  );
}

const ProductCard = memo(function ProductCard({ product: rawProduct, groupedProduct = null, colorOptions: providedColorOptions = null, selectedColor: providedSelectedColor = "", selectedVariant: providedSelectedVariant = null, availableSizes: providedAvailableSizes = null, wishlist, toggleWishlist, onAddToCart, railType = "default", rank = null, featured = false, density = "standard", sizeLimit = 4, eagerImage = false, imagePreset = "grid" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const product = groupedProduct || rawProduct || {};
  const cardRef = useRef(null);
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
  const selectedVariant = useMemo(
    () => variants.find((variant) => String(variant.id) === String(selectedVariantId)) || null,
    [selectedVariantId, variants]
  );
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
    () => selectedVariant || activeColorVariant || firstAvailableVariant,
    [activeColorVariant, firstAvailableVariant, selectedVariant]
  );
  const inWishlist = useMemo(() => wishlist.some((item) => String(item.id) === String(product.id)), [product.id, wishlist]);
  const sellingPrice = displaySellingPrice(product, availableVariant);
  const comparePrice = displayComparePrice(product, availableVariant);
  const hasDiscount = comparePrice > sellingPrice;
  const discountPercent = displayDiscountPercent(product, availableVariant);
  const activeSizes = useMemo(
    () => providedAvailableSizes || getSizesForColorGroup(activeColorGroup),
    [activeColorGroup, providedAvailableSizes]
  );
  const visibleSizes = useMemo(() => activeSizes.slice(0, sizeLimit), [activeSizes, sizeLimit]);
  const extraSizeCount = Math.max(0, activeSizes.length - visibleSizes.length);
  const displayImage = useMemo(() => displayImageForProduct(product, availableVariant), [availableVariant, product]);
  const [variantSheetOpen, setVariantSheetOpen] = useState(false);
  const [sheetColorKey, setSheetColorKey] = useState("");
  const [sheetVariantId, setSheetVariantId] = useState("");
  const [sheetQty, setSheetQty] = useState(1);
  const sheetDismissedRef = useRef(false);
  useEffect(() => {
    console.log("variantSheetOpen changed:", variantSheetOpen);
  }, [variantSheetOpen]);
  useEffect(() => {
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) {
        const next = providedSelectedVariant || firstAvailableVariant;
        setSelectedVariantId(next?.id || "");
        setSelectedColorKeyState(providedSelectedColor || (next ? variantColorKey(next) : ""));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [firstAvailableVariant?.id, product.id, providedSelectedColor, providedSelectedVariant]);

  useEffect(() => {
    if (!selectedVariantId || !activeSizes.length) return;
    if (activeSizes.some((item) => String(item.variant?.id) === String(selectedVariantId))) return;
    const nextVariant = activeSizes.find((item) => String(item.size) === String(selectedVariant?.size))?.variant || activeSizes[0]?.variant;
    if (nextVariant?.id) setSelectedVariantId(nextVariant.id);
  }, [activeSizes, selectedVariant?.size, selectedVariantId]);

  const canQuickAdd = availableVariant && variantHasStock(availableVariant);
  const handleQuickAdd = useCallback(() => onAddToCart(product, availableVariant), [availableVariant, onAddToCart, product]);
  const openVariantSheet = useCallback(() => {
    console.log("SHEET_OPEN_FROM", "openVariantSheet");
    sheetDismissedRef.current = false;
    const first = availableVariant && variantHasStock(availableVariant) ? availableVariant : sellableVariants[0] || null;
    setSheetColorKey(first ? variantColorKey(first) : colorGroups[0]?.key || "");
    setSheetVariantId(first?.id || "");
    setSheetQty(1);
    setVariantSheetOpen(true);
  }, [availableVariant, colorGroups, sellableVariants]);
  const closeVariantSheet = useCallback(() => {
    console.log("CLOSE_TAPPED");
    console.log("closeVariantSheet CALLED");
    console.log("closeVariantSheet: before setVariantSheetOpen(false)");
    sheetDismissedRef.current = true;
    setVariantSheetOpen(false);
    setTimeout(() => console.log("variantSheetOpen after close tick", variantSheetOpen), 0);
    setSheetColorKey("");
    setSheetVariantId("");
    setSheetQty(1);
  }, [variantSheetOpen]);
  const handleVariantSheetAdd = useCallback((variant, quantity) => {
    onAddToCart(product, variant, quantity);
    closeVariantSheet();
  }, [closeVariantSheet, onAddToCart, product]);
  const handleMobileCart = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    openVariantSheet();
  }, [openVariantSheet]);
  const openDetails = useCallback((event) => {
    if (event.defaultPrevented) return;
    if (event.target?.closest?.("button,a,input,select,textarea")) return;
    navigate(productUrl({ ...product, selected_variant_id: availableVariant?.id || product.selected_variant_id, color_key: selectedColorKey || product.color_key }));
  }, [availableVariant?.id, navigate, product, selectedColorKey]);
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
    prefetchStorefrontProductDetails(productIdentifier);
  }, [productIdentifier]);
  const chooseColor = useCallback((event, group) => {
    event.preventDefault();
    event.stopPropagation();
    const next = firstDisplayVariant(group?.variants || []);
    setSelectedColorKeyState(group?.key || "");
    setSelectedVariantId(next?.id || "");
  }, []);
  if (variantSheetOpen) {
    console.log("SHEET_STATE variantSheetOpen", {
      productId: product.id,
      sheetColorKey,
      sheetVariantId,
      sheetQty,
      sheetDismissed: sheetDismissedRef.current,
    });
  }
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
      image: "aspect-[1.02/1] p-1.5",
      body: "p-3 pt-2.5",
      title: "min-h-11 text-[13px] leading-[1.35rem]",
      price: "text-[17px]",
      sizes: "mt-3 min-h-8 gap-1.5",
      chip: "h-6 px-2 text-[9px]",
      color: "h-6 w-6",
      swatch: "h-3.5 w-3.5",
    },
    standard: {
      image: "aspect-[0.96/1] p-1.5",
      body: "p-3 pt-2.5",
      title: "min-h-11 text-[13.25px] leading-[1.35rem]",
      price: "text-[16px]",
      sizes: "mt-3 min-h-8 gap-1.5",
      chip: "h-6 px-2 text-[9px]",
      color: "h-[22px] w-[22px]",
      swatch: "h-3 w-3",
    },
    compact: {
      image: "aspect-[0.98/1] p-1.5",
      body: "p-3 pt-2.5",
      title: "min-h-10 text-[12.75px] leading-[1.3rem]",
      price: "text-[15.5px]",
      sizes: "mt-3 min-h-8 gap-1.5",
      chip: "h-6 px-2 text-[9px]",
      color: "h-6 w-6",
      swatch: "h-3 w-3",
    },
  };
  const densityClasses = cardDensityClasses[density] || cardDensityClasses.standard;

  return (
    <article ref={cardRef} style={eagerImage ? undefined : { contentVisibility: "auto", containIntrinsicSize: "240px 400px" }} onClick={openDetails} onMouseEnter={requestDetailPrefetch} onTouchStart={requestDetailPrefetch} className={`sf-product-card group/product relative flex h-full min-h-0 transform-gpu cursor-pointer flex-col overflow-hidden rounded-[1.2rem] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(250,248,244,0.94)_48%,rgba(245,241,234,0.84))] shadow-[0_10px_26px_rgba(39,20,75,0.07),inset_0_1px_0_rgba(255,255,255,0.8)] ring-1 ring-stone-200/55 transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out hover:-translate-y-1 hover:border-[#a78bfa]/38 hover:ring-[#7c3aed]/22 hover:shadow-[0_18px_44px_rgba(39,20,75,0.12),0_0_0_1px_rgba(124,58,237,0.08)_inset] md:rounded-[1.55rem] dark:border-white/[0.08] dark:bg-[linear-gradient(145deg,rgba(17,24,39,0.95),rgba(11,16,32,0.93)_52%,rgba(8,13,25,0.98))] dark:ring-white/[0.05] dark:shadow-[0_14px_34px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.05)] dark:hover:border-[#a78bfa]/24 dark:hover:shadow-[0_20px_54px_rgba(0,0,0,0.32),0_0_24px_rgba(124,58,237,0.10)] ${featured ? "md:shadow-[0_18px_52px_rgba(109,40,217,0.12)]" : ""}`}>
      <div className="pointer-events-none absolute inset-x-8 top-8 h-14 rounded-full bg-[#a78bfa]/0 blur-xl transition duration-300 group-hover/product:bg-[#a78bfa]/10" />
      <div className={`relative overflow-visible bg-[radial-gradient(circle_at_50%_42%,rgba(167,139,250,0.12),transparent_28%),linear-gradient(180deg,#fbfaf7_0%,#eee7dc_100%)] md:p-3 dark:bg-[radial-gradient(circle_at_50%_42%,rgba(167,139,250,0.10),transparent_28%),linear-gradient(180deg,#101426_0%,#0b1020_100%)] ${densityClasses.image}`}>
        <div className="absolute inset-x-8 top-[18%] h-24 rounded-full bg-white/40 blur-lg dark:bg-white/[0.07]" />
        <Link to={detailsUrl} className="relative z-10 block h-full">
          {displayImage ? (
            <img
              src={imageFor(displayImage)}
              {...responsiveImageProps(displayImage, imagePreset)}
              alt={product.name}
              onError={fallbackProductImage}
              className="h-full w-full transform-gpu rounded-[0.85rem] object-contain object-center p-0 transition-transform duration-300 ease-out will-change-transform group-hover/product:-translate-y-0.5 group-hover/product:scale-[1.035] md:rounded-[1.15rem] md:scale-[1.01] md:group-hover/product:scale-[1.05]"
              loading={eagerImage ? "eager" : "lazy"}
              decoding="async"
              width="360"
              height="432"
            />
          ) : (
            <div className="grid h-full w-full place-items-center rounded-[1rem] bg-white/70 text-center text-xs font-black text-stone-400 dark:bg-white/5 dark:text-stone-500 md:rounded-[1.15rem]">
              <Sparkles className="h-6 w-6 opacity-50" />
            </div>
          )}
        </Link>
        <div className="absolute right-3.5 top-3.5 z-20 flex flex-col items-start gap-1.5 md:right-4 md:top-4">
          {rank && railType === "bestseller" && rank <= 3 ? <span className="inline-flex min-h-7 items-center rounded-full bg-stone-950/92 px-3 py-1 text-[9px] font-black leading-none text-white shadow-[0_10px_22px_rgba(0,0,0,0.20)] backdrop-blur md:min-h-8 md:px-3.5 md:text-[10px] dark:bg-white dark:text-stone-950">TOP {rank}</span> : null}
          {discountPercent ? <span className="inline-flex min-h-8 items-center rounded-full border border-[#a78bfa]/40 bg-[linear-gradient(135deg,#7c3aed,#6d28d9_55%,#4c1d95)] px-3 py-1 text-[10px] font-extrabold leading-none tracking-[0.02em] text-white shadow-[0_10px_24px_rgba(124,58,237,0.28),0_0_0_1px_rgba(196,181,253,0.18)_inset] backdrop-blur md:min-h-9 md:px-3.5 md:text-[11px] dark:border-white/10 dark:bg-[linear-gradient(135deg,#7c3aed,#4c1d95)] dark:text-[#ffffff]">-{discountPercent}%</span> : null}
        </div>
        <button
          onClick={(event) => { event.stopPropagation(); handleWishlist(); }}
          className="absolute left-3.5 top-3.5 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/55 bg-white/92 text-stone-700 shadow-[0_12px_28px_rgba(15,23,42,0.18),0_0_0_1px_rgba(255,255,255,0.7)_inset] backdrop-blur-md transition duration-200 hover:-translate-y-0.5 hover:scale-[1.03] hover:border-white/75 hover:bg-white active:scale-95 active:translate-y-0 md:h-12 md:w-12 dark:border-white/10 dark:bg-white/5 dark:text-stone-100 dark:shadow-[0_12px_28px_rgba(0,0,0,0.18),0_0_0_1px_rgba(255,255,255,0.05)_inset] dark:hover:bg-white/10"
          aria-label={t("storefront.header.wishlist", "Wishlist")}
        >
          <Heart className={`h-5 w-5 transition duration-200 md:h-[22px] md:w-[22px] ${inWishlist ? "animate-[wishlist-pop_320ms_ease-out] fill-rose-500 text-rose-500" : "text-slate-600 dark:text-stone-200"}`} />
        </button>
          {product.low_stock ? <span className="absolute bottom-2 right-2 z-20 inline-flex h-5 items-center rounded-full border border-amber-200 bg-amber-50/95 px-2 text-[9px] font-black leading-none text-amber-800 shadow-sm backdrop-blur md:bottom-auto md:left-12 md:right-auto md:top-2.5 md:h-6 md:px-2.5 md:text-[10px] dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">{t("storefront.products.onlyLeft", "Only {{count}} left", { count: product.total_stock })}</span> : null}
      </div>
        <div className={`flex flex-1 flex-col md:p-3.5 md:pt-3 ${densityClasses.body}`}>
        <Link to={detailsUrl} className={`line-clamp-2 font-black tracking-[-0.01em] text-stone-900 transition hover:text-[#6d28d9] md:text-[13.75px] md:leading-5 dark:text-stone-100 ${densityClasses.title}`}>{product.name}</Link>
        <div className="mt-2 flex min-h-6 flex-wrap items-baseline gap-x-2 gap-y-0.5 md:mt-2.5 md:min-h-7 md:gap-x-2">
          <span className={`font-black leading-none text-stone-950 md:text-[1.28rem] dark:text-white ${densityClasses.price}`}>{money(sellingPrice)}</span>
          {comparePrice ? <span className="text-[9.5px] font-semibold leading-none text-stone-400 line-through opacity-70 dark:text-stone-500 md:text-[10px]">{money(comparePrice)}</span> : null}
        </div>
        {colorGroups.length > 1 ? (
          <div className="mt-2 flex min-h-6 items-center gap-1 overflow-hidden md:mt-2.5 md:min-h-7 md:gap-1.5">
            {visibleColorOptions.map((group) => {
              const active = String(group.key) === String(selectedColorKey);
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={(event) => chooseColor(event, group)}
                  title={group.colorName || group.color}
                  aria-label={group.colorName || group.color}
                  className={`grid shrink-0 place-items-center rounded-full border transition active:scale-95 md:h-7 md:w-7 ${densityClasses.color} ${active ? "border-[#7c3aed] bg-white shadow-[0_0_0_2px_rgba(124,58,237,0.18)] dark:border-[#d8b4fe] dark:bg-white/10" : "border-stone-200 bg-white/70 hover:border-[#7c3aed]/45 dark:border-white/10 dark:bg-white/[0.055]"}`}
                >
                  <span className={`rounded-full border border-black/10 shadow-inner md:h-4 md:w-4 ${densityClasses.swatch}`} style={swatchColorStyle(group.colorName || group.color)} />
                </button>
              );
            })}
            {extraColorCount ? <span dir="ltr" className="inline-flex h-6 shrink-0 items-center rounded-full border border-stone-200/80 bg-white/[0.58] px-2 text-[9px] font-black leading-none text-stone-500 dark:border-white/10 dark:bg-white/[0.045] dark:text-stone-400">+{extraColorCount}</span> : null}
          </div>
        ) : null}
        <div className={`sf-scroll flex flex-nowrap overflow-x-auto pb-0.5 md:mt-3 md:min-h-12 md:flex-wrap md:content-start md:gap-1.5 md:overflow-hidden ${densityClasses.sizes}`}>
          {visibleSizes.map(({ size, variant }) => {
            const selected = String(availableVariant?.id) === String(variant?.id);
            return (
              <button
                key={`${activeColorGroup?.key || "default"}-${size}`}
                type="button"
                onClick={(event) => { event.stopPropagation(); setSelectedVariantId(variant.id); setSelectedColorKeyState(variantColorKey(variant)); }}
                className={`inline-flex shrink-0 items-center justify-center rounded-full border font-black leading-none transition duration-200 md:h-6 md:px-2 md:text-[10px] ${densityClasses.chip} ${selected ? "border-[#7c3aed] bg-[#6d28d9] text-white shadow-[0_10px_22px_rgba(124,58,237,0.28)] ring-2 ring-[#c4b5fd]/25 dark:border-[#d8b4fe] dark:bg-[#d8b4fe] dark:text-stone-950" : "border-stone-300/90 bg-white text-stone-700 hover:border-[#7c3aed]/45 hover:text-[#6d28d9] dark:border-white/12 dark:bg-white/[0.055] dark:text-stone-300 dark:hover:border-[#d8b4fe]/50 dark:hover:text-white"} disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-300 disabled:line-through disabled:opacity-45 dark:disabled:bg-white/5 dark:disabled:text-stone-500`}
              >
                {size}
              </button>
            );
          })}
          {extraSizeCount ? (
            <span dir="ltr" className="inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-stone-300/90 bg-white px-2 text-[9px] font-black leading-none text-stone-500 shadow-sm md:text-[10px] dark:border-white/10 dark:bg-white/[0.045] dark:text-stone-500">+{extraSizeCount}</span>
          ) : null}
          {!visibleSizes.length ? (
            <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-stone-300/90 bg-white px-2 text-[9px] font-bold leading-none text-stone-500 shadow-sm md:text-[10px] dark:border-white/10 dark:bg-white/5 dark:text-stone-500">{t("storefront.products.oneSize", "One size")}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleQuickAdd}
          disabled={!canQuickAdd}
          className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-[#c4b5fd]/45 bg-[linear-gradient(135deg,#7c3aed,#6d28d9_55%,#4c1d95)] px-4 py-3 text-[12px] font-black text-white shadow-[0_14px_34px_rgba(124,58,237,0.32),0_0_0_1px_rgba(196,181,253,0.16)_inset] backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-[#ddd6fe]/60 hover:shadow-[0_18px_42px_rgba(124,58,237,0.42)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-white/10 disabled:from-stone-500/70 disabled:via-stone-500/70 disabled:to-stone-600/70 disabled:text-white/60 disabled:shadow-none disabled:hover:scale-100"
          aria-label={canQuickAdd ? t("storefront.cart.addToCart", "Add to cart") : t("storefront.products.unavailable", "Unavailable")}
        >
          <ShoppingCart className="h-[18px] w-[18px] text-white" />
          {canQuickAdd ? t("storefront.cart.addToCart", "Add to cart") : t("storefront.products.unavailable", "Unavailable")}
        </button>
      </div>
      {variantSheetOpen ? (
        <Suspense fallback={null}>
          <LazyProductCardVariantSheet
            open={variantSheetOpen}
            product={product}
            colorGroups={colorGroups}
            selectedColorKey={sheetColorKey}
            selectedVariantId={sheetVariantId}
            quantity={sheetQty}
            onColorChange={(colorKey) => {
              const group = colorGroups.find((item) => item.key === colorKey);
              const next = firstDisplayVariant(group?.variants || []);
              setSheetColorKey(colorKey);
              setSheetVariantId(next?.id || "");
              setSheetQty(1);
            }}
            onVariantChange={(variantId) => {
              setSheetVariantId(variantId);
              setSheetQty(1);
            }}
            onQuantityChange={setSheetQty}
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
  if (!open) return null;
  const activeGroup = colorGroups.find((group) => String(group.key) === String(selectedColorKey)) || colorGroups[0] || null;
  const sizeOptions = getSizesForColorGroup(activeGroup);
  const selectedVariant = sizeOptions.find((item) => String(item.variant?.id) === String(selectedVariantId))?.variant
    || firstDisplayVariant(activeGroup?.variants || [])
    || null;
  const maxQty = Math.max(1, Number(selectedVariant?.stock || 1));
  const safeQty = Math.min(Math.max(1, Number(quantity || 1)), maxQty);
  const handleCloseRequest = useCallback((event) => {
    if (event) {
      event.stopPropagation();
    }
    console.log("CLOSE_HANDLER_EXISTS", typeof onClose);
    if (typeof onClose === "function") {
      onClose();
    }
  }, [onClose]);

  return createPortal(
    <div className="sf-product-variant-sheet fixed inset-0 z-[90] pointer-events-auto md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 z-0 bg-stone-950/62 backdrop-blur-sm"
        onClick={handleCloseRequest}
        aria-label={t("common.close", "Close")}
      />
      <section
        className="sf-product-variant-sheet-panel absolute inset-x-0 bottom-0 z-10 rounded-t-[1.55rem] border border-white/10 bg-[linear-gradient(180deg,#101426_0%,#070b16_100%)] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.42)]"
        onClick={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#d8b4fe]">{t("storefront.products.chooseSize", "Choose size")}</p>
            <h3 className="mt-1 line-clamp-2 text-base font-black leading-5">{product?.name}</h3>
          </div>
          <button
            type="button"
            onPointerUp={(event) => {
              event.stopPropagation();
              console.log("CLOSE_HANDLER_EXISTS", typeof onClose);
              if (typeof onClose === "function") {
                onClose();
              }
            }}
            onClick={(event) => {
              event.stopPropagation();
              console.log("CLOSE_HANDLER_EXISTS", typeof onClose);
              if (typeof onClose === "function") {
                onClose();
              }
            }}
            className="relative z-20 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/75"
            title="Close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {colorGroups.length > 1 ? (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-black text-white/50">{t("storefront.products.color", "Color")}</div>
            <div className="sf-scroll flex gap-2 overflow-x-auto pb-1">
              {colorGroups.map((group) => {
                const active = String(group.key) === String(activeGroup?.key);
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => onColorChange(group.key)}
                    className={`min-h-9 shrink-0 rounded-full border px-3 py-2 text-xs font-black transition ${active ? "border-[#d8b4fe]/70 bg-[#7c3aed] text-white shadow-[0_12px_28px_rgba(124,58,237,0.32)]" : "border-white/10 bg-white/6 text-white/70"}`}
                  >
                    {group.color}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          <div className="mb-2 text-[11px] font-black text-white/50">{t("storefront.products.size", "Size")}</div>
          <div className="grid grid-cols-4 gap-2">
            {sizeOptions.map(({ size, variant }) => {
              const active = String(variant?.id) === String(selectedVariant?.id);
              return (
                <button
                  key={variant?.id || size}
                  type="button"
                  onClick={() => onVariantChange(variant.id)}
                  disabled={!variantHasStock(variant)}
                  className={`h-10 rounded-xl border text-xs font-black transition ${active ? "border-[#d8b4fe]/70 bg-white text-stone-950" : "border-white/10 bg-white/6 text-white/75"} disabled:cursor-not-allowed disabled:opacity-35 disabled:line-through`}
                >
                  {size || t("storefront.products.oneSize", "One size")}
                </button>
              );
            })}
            {!sizeOptions.length ? (
              <div className="col-span-4 rounded-xl border border-white/10 bg-white/5 p-3 text-center text-xs font-bold text-white/45">
                {t("storefront.products.unavailable", "Unavailable")}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-2">
          <button type="button" onClick={() => onQuantityChange(Math.max(1, safeQty - 1))} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-lg font-black">-</button>
          <div className="text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{t("storefront.cart.quantity", "Quantity")}</div>
            <div className="text-lg font-black">{safeQty}</div>
          </div>
          <button type="button" onClick={() => onQuantityChange(Math.min(maxQty, safeQty + 1))} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-lg font-black">+</button>
        </div>

        <button
          type="button"
          onClick={() => selectedVariant && onAdd(selectedVariant, safeQty)}
          disabled={!selectedVariant || !variantHasStock(selectedVariant)}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-[#7c3aed] to-[#111827] text-sm font-black text-white shadow-[0_14px_34px_rgba(124,58,237,0.32)] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <ShoppingCart className="h-4 w-4" />
          {t("storefront.cart.addToCart", "Add to cart")}
        </button>
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
  selectedSize,
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

function RelatedProducts({ currentId, ...props }) {
  const { products } = useProducts({ limit: 8 });
  const filtered = useMemo(
    () => sortStorefrontColorCardsByModel(products.filter((product) => String(product.parent_product_id || product.id) !== String(currentId))).slice(0, 4),
    [currentId, products]
  );
  return (
    <div className="mt-5 border-t border-white/[0.06] pt-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-stone-950 dark:text-white">{sfText("storefront.products.similarProducts")}</h2>
          <p className="mt-1 text-xs font-bold text-stone-500 dark:text-white/55">{sfText("storefront.products.youMayAlsoLike")}</p>
        </div>
        <Link to="/shop/products" className="rounded-full border border-stone-200 bg-white/70 px-3 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:border-stone-950 dark:border-white/10 dark:bg-white/[0.055] dark:text-white/70 dark:hover:border-white/25 dark:hover:text-white">{sfText("storefront.common.viewAll")}</Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {filtered.length ? filtered.map((product, index) => <ProductCard key={productCardKey(product, index)} product={product} railType="similar" {...props} />) : <MiniRailEmpty />}
      </div>
    </div>
  );
}

function RecentProductsSection({ currentId, recent = [] }) {
  const items = useMemo(
    () => recent.filter((item) => String(item.id) !== String(currentId)).slice(0, 4),
    [currentId, recent]
  );
  if (!items.length) return null;
  return (
    <div className="mt-5 rounded-[1.25rem] border border-stone-200 bg-white/70 p-4 shadow-[0_14px_38px_rgba(39,20,75,0.05)] dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-[0_20px_50px_rgba(0,0,0,0.20)]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-stone-950 dark:text-white">{sfText("storefront.account.recentlyViewed")}</h2>
          <p className="mt-1 text-xs font-bold text-stone-500 dark:text-white/55">{sfText("storefront.account.recentEmpty")}</p>
        </div>
        <Link to="/shop/recently-viewed" className="rounded-full border border-stone-200 bg-stone-100 px-3 py-2 text-xs font-black text-stone-700 dark:border-white/10 dark:bg-white/[0.055] dark:text-white/70">{sfText("storefront.common.viewAll")}</Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <Link key={item.id} to={`/shop/product/${item.slug || item.id}`} className="min-w-0 rounded-2xl bg-stone-50 p-2 transition hover:-translate-y-0.5 dark:bg-white/[0.055]">
            <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" className="aspect-square w-full rounded-xl object-cover" loading="lazy" decoding="async" width="240" height="240" />
            <div className="mt-2 truncate text-sm font-black text-stone-950 dark:text-white">{item.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold text-stone-500 dark:text-white/55">
              {displayCartItemComparePrice(item) ? <span className="line-through">{money(displayCartItemComparePrice(item))}</span> : null}
              <span>{money(displayCartItemPrice(item))}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CheckoutPage({ cart, clearCart, profile, setProfile, themeMode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const checkoutLanguage = normalizeLanguage(i18n.language);
  const [form, setForm] = useState({
    full_name: profile.full_name || "",
    primary_phone: profile.primary_phone || "",
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
  const [shippingPaymentPreviewUrl, setShippingPaymentPreviewUrl] = useState("");
  const [errors, setErrors] = useState({});
  const [customerTrust, setCustomerTrust] = useState({ loading: false, customer: null });
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
  const pricedCart = useMemo(() => cart.map((item) => ({ ...item, price: displayCartItemPrice(item) })), [cart]);
  const subtotal = pricedCart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const couponDiscount = couponValidation?.valid ? Math.max(0, Number(couponValidation.discount_amount || 0)) : 0;
  const discount = couponDiscount;
  const deliveryFee = form.governorate ? shippingQuote.price : 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);
  const isDamietta = ["ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¯ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ·", "ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¯ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ·"].some((name) => String(form.governorate || "").includes(name));
  const trustedCustomer = customerTrust.customer || {};
  const codAvailable = shippingQuote.cod_allowed !== false;
  const normalizedFormPaymentMethod = paymentMode === "cod" ? "cod" : "shipping_confirmation";
  const isShippingConfirmation = paymentMode === "electronic";
  const shippingProofRequired = isShippingConfirmation;
  const hasShippingPaymentProof = Boolean(shippingPaymentFile);
  const isFinalCheckoutStep = checkoutStep === 3;
  const couponCode = String(form.coupon || "").trim().toUpperCase();
  const submitDisabled = isFinalCheckoutStep && (submitting || couponLoading || shippingQuote.loading || (shippingProofRequired && !hasShippingPaymentProof));
  const checkoutActionLabel = checkoutStep === 1
  ? t("storefront.checkout.actions.continueToAddress", "متابعة إلى العنوان")
  : checkoutStep === 2
    ? t("storefront.checkout.actions.continueToPayment", "متابعة إلى الدفع")
    : normalizedFormPaymentMethod === "cod"
      ? t("storefront.checkout.actions.confirmOrder", "تأكيد الطلب")
      : shippingProofRequired
        ? t("storefront.checkout.actions.uploadProofAndConfirm", "ارفع الإيصال ثم أكد الطلب")
        : t("storefront.checkout.actions.confirmOrder", "تأكيد الطلب");
  const codAmount = normalizedFormPaymentMethod === "cod" ? total : Math.max(0, total - deliveryFee);
  const storefrontPaymentSettings = useMemo(() => normalizeStorefrontPaymentSettings(publicStoreSettings), [publicStoreSettings]);
  const storefrontBrandSettings = useMemo(() => ({
    brandName: String(publicStoreSettings["storefront.store_name"] || publicStoreSettings["general.company_name"] || "MONE").trim(),
    brandTagline: String(publicStoreSettings["storefront.store_tagline"] || "").trim(),
    brandLogoUrl: String(publicStoreSettings["storefront.store_logo_url"] || publicStoreSettings["general.company_logo_url"] || "").trim(),
  }), [publicStoreSettings]);
  const paymentMethods = useMemo(() => getPaymentMethods(storefrontPaymentSettings), [storefrontPaymentSettings]);
  const paymentCopy = paymentMethods.find((method) => method.id === normalizedFormPaymentMethod)?.text || "";
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
    if (typeof document === "undefined") return undefined;
    document.documentElement.style.setProperty("--checkout-sticky-actions-height", "88px");
    return () => {
      document.documentElement.style.setProperty("--checkout-sticky-actions-height", "0px");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get("/settings/public", { suppressErrorStatuses: [404, 500] })
      .then((data) => {
        if (cancelled) return;
        const settings = data?.settings || {};
        setShippingLocations(normalizeCheckoutLocations(settings["storefront.shipping_locations"]));
        setPublicStoreSettings(settings);
        console.debug("[payment-settings:loaded]", {
          instapay_enabled: Boolean(settings["storefront.payment_methods.instapay_enabled"] ?? settings["payments.instapay_enabled"]),
          vodafone_cash_enabled: Boolean(settings["storefront.payment_methods.vodafone_cash_enabled"] ?? settings["payments.vodafone_cash_enabled"]),
          shipping_confirmation_enabled: Boolean(settings["storefront.payment_methods.shipping_confirmation_enabled"] ?? true),
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
    api
      .get(`/storefront/account?phone=${encodeURIComponent(phone)}`)
      .then((data) => {
        if (!cancelled) setCustomerTrust({ loading: false, customer: data.customer || null });
      })
      .catch(() => {
        if (!cancelled) setCustomerTrust({ loading: false, customer: null });
      });
    return () => {
      cancelled = true;
    };
  }, [form.primary_phone]);

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
      ? ["full_name", "primary_phone"]
      : step === 2
        ? ["governorate", "city_area", "detailed_address", "street_address", "building_number"]
        : ["payment_method", "shipping_payment_screenshot"];
    const phone = form.primary_phone.replace(/\s/g, "");
    const composedAddress = [
      form.street_address || form.detailed_address,
      form.building_number ? `Building ${form.building_number}` : "",
      form.floor_number ? `ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¯ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ«ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¢ط¢آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ± ${form.floor_number}` : "",
      form.apartment_number ? `ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ´ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¹ط£آ¢أ¢â€ڑآ¬ط¹آ©ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ© ${form.apartment_number}` : "",
      form.landmark ? `Near ${form.landmark}` : "",
    ].filter(Boolean).join(", ");

    if (step === 1) {
      if (!form.full_name.trim()) next.full_name = sfText("storefront.validation.fullNameRequired");
      if (!phone) next.primary_phone = sfText("storefront.validation.phoneRequired");
      else if (!/^01[0125][0-9]{8}$/.test(phone)) next.primary_phone = sfText("storefront.validation.invalidEgyptPhone");
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
      if (validateStep(checkoutStep)) goToCheckoutStep(Math.min(3, checkoutStep + 1));
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
      const paymentMethod = paymentMode === "cod" ? "cod" : "shipping_confirmation";
      const shippingPaymentMethod = paymentMode === "cod" ? "" : normalizeShippingPaymentMethod(shippingTransferMethod);
      const paidAmount = paymentMode === "cod" ? 0 : deliveryFee;
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
        shipping_address: shippingProviderAddress,
        shipping_provider_address: shippingProviderAddress,
        shipping_payment_method: shippingPaymentMethod,
        coupon_code: couponCodeToSend,
        coupon_discount_amount: couponDiscountToSend,
      };
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
        customer: { full_name: form.full_name, phone: cleanPhone },
        checkout: { ...checkoutPayload, shipping_payment_method: shippingPaymentMethod, coupon_code: couponCodeToSend, coupon_discount_amount: couponDiscountToSend },
      };
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
        street_address: form.street_address,
        building_number: form.building_number,
        floor_number: form.floor_number,
        apartment_number: form.apartment_number,
        detailed_address: form.detailed_address,
        landmark: form.landmark,
      });
      clearCart();
      playSuccess();
      navigate(`/shop/success/${encodeURIComponent(publicNumber)}?phone=${encodeURIComponent(cleanPhone)}`, { state: successPayload });
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
          <p className="sf-checkout-eyebrow text-sm font-black text-[#c4b5fd]">{sfText("storefront.checkout.eyebrow")}</p>
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
            </div>
          </CheckoutSection> : null}
          {checkoutStep === 2 ? <CheckoutSection number="2" title={sfText("storefront.checkout.sections.address")} note={sfText("storefront.checkout.addressNote")} className="checkout-address-section" dir="rtl">
            {latestAddressApplied ? (
              <div className="sf-checkout-address-success mb-3 flex items-center justify-between gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-black leading-5 text-emerald-100">
                <span className="sf-checkout-address-success-text">{sfText("storefront.checkout.latestAddressApplied")}</span>
                <button type="button" onClick={useNewAddress} className="shrink-0 rounded-full border border-emerald-200/20 bg-white/10 px-3 py-1 text-[10px] font-black text-white transition hover:bg-white/15">
                  استخدام عنوان جديد
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
                    searchPlaceholder="ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ« ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ  ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ©"
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
                    searchPlaceholder={sfText("storefront.checkout.searchZones")}
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
                    searchPlaceholder={sfText("storefront.checkout.searchDistricts")}
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
                      setForm((current) => ({ ...current, payment_method: "shipping_confirmation" }));
                      setShippingTransferMethod((current) => (visibleTransferMethods.some((method) => method.id === current) ? current : (visibleTransferMethods[0]?.id || "instapay")));
                    }}
                    className={`checkout-payment-choice flex min-h-[4.75rem] flex-col items-start justify-center rounded-[1.35rem] border px-4 py-3 text-right transition ${paymentMode === "electronic" ? "border-[#a78bfa]/35 bg-[#7c3aed]/14 shadow-[0_16px_34px_rgba(124,58,237,0.12)]" : "border-white/10 bg-white/[0.045] hover:border-white/18 hover:bg-white/[0.07]"}`}
                  >
                    <span className="text-sm font-black text-white">الدفع الإلكتروني</span>
                    <span className="mt-1 text-xs font-semibold leading-5 text-white/56">{sfText("storefront.checkout.payment.shippingConfirmation.text")}</span>
                  </button>
                </div>
                {showElectronicPaymentMethods && isShippingConfirmation ? (
                  <div className="grid gap-3">
                    {storefrontPaymentSettings.shippingConfirmation.enabled ? (
                      <div className="checkout-payment-amount">
                        <div className="text-sm font-black text-white/66">{storefrontPaymentSettings.shippingConfirmation.label || sfText("storefront.checkout.transfer.amountDueNow")}</div>
                        <div className="mt-2 flex items-end justify-between gap-3">
                          <div className="text-3xl font-black tracking-tight text-white">{money(storefrontPaymentSettings.shippingConfirmation.amount)}</div>
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
                            onClick={() => setShippingTransferMethod(method.id)}
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
                            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? "border-[#a78bfa] bg-[#7c3aed] text-white" : "border-white/18 bg-white/[0.04] text-transparent"}`}>
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
                          <div className="rounded-[1rem] border border-[#a78bfa]/12 bg-white/[0.045] px-3 py-2.5 text-sm font-black text-white/80">
                            {sfText("storefront.checkout.transfer.directPaymentAvailable")}
                          </div>
                          <button
                            type="button"
                            onClick={() => window.open(activeTransferPaymentUrl, "_blank", "noopener,noreferrer")}
                            className="sf-checkout-instapay-button inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-[#a78bfa]/20 bg-[linear-gradient(135deg,rgba(124,58,237,0.98),rgba(17,24,39,0.98))] px-4 py-3 text-sm font-black text-white shadow-[0_16px_36px_rgba(124,58,237,0.24)] transition hover:-translate-y-0.5 hover:border-[#c4b5fd]/36 hover:bg-[#6d28d9]"
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
                      className={`checkout-payment-upload ${shippingPaymentFile ? "checkout-payment-upload--has-file" : ""} ${
                        errors.shipping_payment_screenshot
                          ? "checkout-payment-upload--error"
                          : paymentProofDragActive
                            ? "checkout-payment-upload--active"
                            : ""
                      }`}
                    >
                      <label className="block cursor-pointer">
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handlePaymentProofChange(event.target.files?.[0])} className="sr-only" />
                        <div className="flex items-center gap-3">
                          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${paymentProofUploaded ? "bg-emerald-400/16 text-emerald-100" : "bg-[#7c3aed]/14 text-[#c4b5fd]"}`}>
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
                            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#a78bfa]/25 bg-[#7c3aed] px-4 text-sm font-black text-white transition hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:opacity-60"
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
                            {sfText("storefront.checkout.couponAppliedSummary", "ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½: {{code}} - {{discount}}", {
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

function OrderSuccess({ profile, themeMode }) {
  const { t } = useTranslation();
  const { orderNumber } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const darkMode = themeMode === "dark";
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

  const order = loaded?.order || {};
  const publicNumber = displayPublicOrderNumber(order) || displayPublicOrderNumber(decodedOrderNumber);
  const items = loaded?.items || [];
  const customerName = order.customer_name || loaded?.customer?.full_name || profile.full_name || t("storefront.customer.dearCustomer", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½");
  const total = order.total_amount || order.total || order.total_price || 0;
  const address = [order.governorate, order.city_area, order.customer_address || loaded?.checkout?.detailed_address].filter(Boolean).join(" - ");
  const paymentLabel = paymentCopy(order.payment_method || loaded?.checkout?.payment_method || "cod");
  const isShippingAwaitingVerification =
    (order.payment_method || loaded?.checkout?.payment_method) === "shipping_confirmation" ||
    order.payment_status === "awaiting_verification" ||
    order.status === "awaiting_verification";
  const successTitle = isShippingAwaitingVerification ? t("storefront.success.awaitingVerificationTitle", "ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½") : t("storefront.success.confirmedTitle", "ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½");
  const successSubtitle = isShippingAwaitingVerification
    ? t("storefront.success.awaitingVerificationSubtitle", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½.")
    : t("storefront.success.confirmedSubtitle", "ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½.");
  const successStatus = isShippingAwaitingVerification ? t("storefront.status.awaiting_verification", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½") : statusCopy(order.status || "pending");
  const whatsAppHref = whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(`ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ­ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¥ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط£آ¢أ¢â‚¬â€چط¢آ¢ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ£ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¯ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¹ط·آ·ط¢آ¢ط·آ¢ط¢آ¾ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ§ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ© ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ£ط¢آ¢ط£آ¢أ¢â‚¬ع‘ط¢آ¬ط·آ¹أ¢â‚¬آ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ¨ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ·ط·آ¢ط¢آ¸ط·آ·ط¢آ¢ط·آ¢ط¢آ¹ ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ·ط·آ·ط¢آ·ط·آ¢ط¢آ¢ط·آ·ط¢آ¢ط·آ¢ط¢آ±ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¹ط£آ¢أ¢â€ڑآ¬ط¹آ©ط·آ·ط¢آ·ط·آ¢ط¢آ·ط·آ·ط¢آ¢ط·آ¢ط¢آ¸ط·آ·ط¢آ£ط·آ¢ط¢آ¢ط·آ£ط¢آ¢ط£آ¢أ¢â€ڑآ¬ط¹â€کط·آ¢ط¢آ¬ط·آ·ط¢آ¢ط·آ¢ط¢آ¦ ${publicNumber}`)}` : "";

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-6 md:py-10">
      {confetti ? <Confetti /> : null}
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto grid h-24 w-24 animate-[success-pop_650ms_ease-out] place-items-center rounded-full bg-emerald-100 text-emerald-700 shadow-[0_20px_45px_rgba(16,185,129,0.18)]">
          <Check className="h-12 w-12" />
        </div>
        <h1 className="mt-6 text-3xl font-black md:text-4xl">{successTitle}</h1>
        <p className="mt-2 text-lg font-bold text-stone-600">{t("storefront.success.thanks", "ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½")}</p>
        <p className="mt-1 text-sm font-bold text-stone-500">{successSubtitle}</p>
        <div className="mt-5 inline-flex rounded-full bg-[#f5f3ff] px-4 py-2 text-sm font-black text-[#6d28d9]">{message}</div>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className={`sf-storefront-card rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:p-6 ${darkMode ? "text-slate-900" : ""}`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoBox label={t("storefront.orders.orderNumber", "ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½")} value={<OrderNumberBadge value={publicNumber} className="border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />} />
              <InfoBox label={t("storefront.customer.customer", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½")} value={customerName} />
              <InfoBox label={t("storefront.checkout.total", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½")} value={total ? money(total) : t("storefront.success.orderRecorded", "ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½")} />
              <InfoBox label={t("storefront.checkout.paymentMethod", "ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½")} value={paymentLabel} />
              <InfoBox label={t("storefront.orders.orderStatus", "ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½")} value={successStatus} />
              <InfoBox label={t("storefront.orders.expectedDelivery", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½")} value={t("storefront.orders.expectedDeliveryWindow", "ï؟½ï؟½ 2 ï؟½ï؟½ï؟½ 5 ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½")} />
            </div>
            <div className="sf-info-box mt-4 rounded-2xl bg-stone-50 p-4 text-right">
              <div className="sf-info-label text-xs font-black text-stone-500">{t("storefront.checkout.deliveryAddress", "ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½")}</div>
              <div className="sf-info-value mt-1 font-black">{address || t("storefront.orders.addressSaved", "ï؟½ï؟½ ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½")}</div>
            </div>
          </div>
          <div className={`sf-storefront-card rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:p-6 ${darkMode ? "text-slate-900" : ""}`}>
            <h2 className="sf-section-heading text-xl font-black">{t("storefront.orders.tracking", "ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½")}</h2>
            <SuccessTimeline />
          </div>
          <Suspense fallback={<div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm font-bold text-white/60">{sfText("storefront.orders.itemsLoading")}</div>}>
            <OrderInvoiceCard className="sf-order-invoice-card" order={{ ...order, source: "Website" }} items={items} />
          </Suspense>
        </div>
        <aside className={`sf-storefront-card h-max rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] lg:sticky lg:top-24 ${darkMode ? "text-slate-900" : ""}`}>
          <div className="grid gap-3">
            <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="rounded-full bg-stone-950 px-5 py-4 text-center font-black text-white transition hover:bg-[#6d28d9]">{t("storefront.orders.trackOrder", "ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½")}</Link>
            <Link to="/shop/products" className="sf-soft-pill rounded-full border border-stone-300 px-5 py-4 text-center font-black transition hover:border-[#7c3aed] hover:text-[#6d28d9]">{t("storefront.common.continueShopping", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½")}</Link>
            {whatsAppHref ? <a href={whatsAppHref} className="rounded-full border border-emerald-200 bg-emerald-50 px-5 py-4 text-center font-black text-emerald-700">{t("storefront.support.whatsapp", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½")}</a> : <button disabled className="rounded-full border border-stone-200 bg-stone-100 px-5 py-4 font-black text-stone-400">{t("storefront.support.whatsappUnavailable", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½")}</button>}
          </div>
          <div className="sf-info-box mt-5 rounded-2xl bg-[#f5f3ff] p-4 text-sm font-bold leading-6 text-stone-700">{t("storefront.success.reviewNotice", "ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½.")}</div>
        </aside>
      </div>
      {products.length ? (
        <div className="mt-6">
          <ProductRail title={t("storefront.nav.new", "ï؟½ï؟½ï؟½ï؟½")} subtitle={t("storefront.success.recommendedProducts", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½")} products={products} loading={false} railType="new" wishlist={[]} toggleWishlist={() => undefined} onAddToCart={() => undefined} />
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
  const raw = rawOptionValue(value);
  return {
    manual: sfText("storefront.shipping.inStoreDelivery"),
    store_pickup: sfText("storefront.shipping.inStoreDelivery"),
    in_store_delivery: sfText("storefront.shipping.inStoreDelivery"),
    bosta: "Bosta",
    mylerz: "Mylerz",
    shipblu: "ShipBlu",
  }[raw.toLowerCase()] || raw || sfText("storefront.common.soon");
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
  const text = orderNumber ? sfText("storefront.support.orderHelpMessage", "إذا احتجت مساعدة بخصوص الطلب {{orderNumber}}", { orderNumber }) : sfText("storefront.support.generalHelpMessage");
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

function ContactPage() {
  return (
    <StaticPage
      title={sfText("storefront.contact.title")}
      items={[
        [sfText("storefront.contact.phone"), "01000000000"],
        [sfText("storefront.support.whatsapp"), sfText("storefront.contact.whatsappHint")],
        ["Instagram", "@store"],
        ["Facebook", "Store page"],
        [sfText("storefront.contact.address"), sfText("storefront.contact.addressPlaceholder")],
        [sfText("storefront.contact.workingHours"), sfText("storefront.contact.workingHoursValue")],
      ]}
    />
  );
}

function SizeGuide() {
  const darkMode = typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || document.body.classList.contains("storefront-dark"));
  const sizeRows = [
    { eu: 39, foot: "24.8 cm", usMen: "6.5", usWomen: "8", uk: "6", note: sfText("storefront.sizeGuide.notes.39") },
    { eu: 40, foot: "25.4 cm", usMen: "7", usWomen: "8.5", uk: "6.5", note: sfText("storefront.sizeGuide.notes.40") },
    { eu: 41, foot: "26.0 cm", usMen: "8", usWomen: "9.5", uk: "7.5", note: sfText("storefront.sizeGuide.notes.41") },
    { eu: 42, foot: "26.6 cm", usMen: "8.5", usWomen: "10", uk: "8", note: sfText("storefront.sizeGuide.notes.42") },
    { eu: 43, foot: "27.2 cm", usMen: "9.5", usWomen: "11", uk: "9", note: sfText("storefront.sizeGuide.notes.43") },
    { eu: 44, foot: "27.8 cm", usMen: "10", usWomen: "11.5", uk: "9.5", note: sfText("storefront.sizeGuide.notes.44") },
    { eu: 45, foot: "28.4 cm", usMen: "11", usWomen: "12.5", uk: "10.5", note: sfText("storefront.sizeGuide.notes.45") },
  ];
  const measureSteps = [
    ["1", sfText("storefront.sizeGuide.steps.paper.title"), sfText("storefront.sizeGuide.steps.paper.text")],
    ["2", sfText("storefront.sizeGuide.steps.mark.title"), sfText("storefront.sizeGuide.steps.mark.text")],
    ["3", sfText("storefront.sizeGuide.steps.measure.title"), sfText("storefront.sizeGuide.steps.measure.text")],
    ["4", sfText("storefront.sizeGuide.steps.larger.title"), sfText("storefront.sizeGuide.steps.larger.text")],
  ];
  return (
    <section className={`sf-size-guide-page mx-auto max-w-6xl px-4 py-8 md:py-12 ${darkMode ? "text-white" : "text-[#0f172a]"}`} dir="rtl">
      <div className="mb-6 flex flex-col gap-3 md:mb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className={`text-sm font-black ${darkMode ? "text-[#c4b5fd]" : "text-[#7c3aed]"}`}>{sfText("storefront.sizeGuide.eyebrow")}</p>
          <h1 className={`mt-1 text-3xl font-black tracking-normal md:text-5xl ${darkMode ? "text-white" : "text-[#0f172a]"}`}>{sfText("storefront.sizeGuide.title")}</h1>
          <p className={`mt-3 max-w-2xl text-sm font-bold leading-7 md:text-base ${darkMode ? "text-slate-300" : "text-[#475569]"}`}>
            {sfText("storefront.sizeGuide.subtitle")}
          </p>
        </div>
        <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-xs font-black shadow-sm ${darkMode ? "border-white/10 bg-white/[0.06] text-slate-200" : "border-slate-300 bg-white text-[#0f172a]"}`}>
          <Footprints className={`h-4 w-4 ${darkMode ? "text-[#c4b5fd]" : "text-[#7c3aed]"}`} />
          {sfText("storefront.sizeGuide.centimeterMeasurement")}
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_22px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(2,6,23,0.98),rgba(15,23,42,0.94)_45%,rgba(12,10,28,0.96))] dark:shadow-[0_24px_80px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-white/10 sm:px-6">
          <h2 className="text-xl font-black text-stone-950 dark:text-white">{sfText("storefront.sizeGuide.tableTitle")}</h2>
          <p className="mt-1 text-sm font-bold text-stone-500 dark:text-slate-400">{sfText("storefront.sizeGuide.mobileScrollHint")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-right text-sm font-bold">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-black text-stone-600 dark:border-white/10 dark:bg-white/[0.045] dark:text-slate-300">
                <th className="whitespace-nowrap px-5 py-4">{sfText("storefront.sizeGuide.euSize")}</th>
                <th className="whitespace-nowrap px-5 py-4">{sfText("storefront.sizeGuide.footLength")}</th>
                <th className="whitespace-nowrap px-5 py-4">US Men</th>
                <th className="whitespace-nowrap px-5 py-4">US Women</th>
                <th className="whitespace-nowrap px-5 py-4">UK</th>
                <th className="whitespace-nowrap px-5 py-4">{sfText("storefront.sizeGuide.notesLabel")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/10">
              {sizeRows.map((row) => (
                <tr key={row.eu} className="text-stone-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.06]">
                  <td className="px-5 py-4 text-lg font-black text-stone-950 dark:text-white">{row.eu}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-stone-800 dark:text-slate-100">{row.foot}</td>
                  <td className="px-5 py-4 tabular-nums">{row.usMen}</td>
                  <td className="px-5 py-4 tabular-nums">{row.usWomen}</td>
                  <td className="px-5 py-4 tabular-nums">{row.uk}</td>
                  <td className="min-w-56 px-5 py-4 text-stone-600 dark:text-slate-300">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-5 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.07)] dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(2,6,23,0.94),rgba(15,23,42,0.88))] dark:shadow-[0_20px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-stone-950 dark:text-white">{sfText("storefront.sizeGuide.measurementMethod")}</h2>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-stone-600 dark:text-slate-300">
              {sfText("storefront.sizeGuide.measurementIntro")}
            </p>
          </div>
          <a href="https://wa.me/" className={`inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full border px-5 py-3 text-sm font-black shadow-[0_14px_34px_rgba(16,185,129,0.28)] transition hover:-translate-y-0.5 ${darkMode ? "border-emerald-300/25 bg-emerald-500/95 text-white hover:bg-emerald-400" : "border-slate-300 bg-white text-[#0f172a] hover:border-[#cbd5e1] hover:bg-[#f8fafc]"}`}>
            <MessageCircle className={`h-4 w-4 ${darkMode ? "text-white" : "text-[#7c3aed]"}`} />
            {sfText("storefront.support.whatsappHelp")}
          </a>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {measureSteps.map(([number, title, text]) => (
            <div key={number} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/[0.045]">
              <span className="grid h-9 w-9 place-items-center rounded-full border border-[#7c3aed]/20 bg-[#7c3aed]/10 text-sm font-black text-[#6d28d9] dark:border-[#c4b5fd]/25 dark:bg-[#7c3aed]/25 dark:text-[#ddd6fe]">{number}</span>
              <h3 className="mt-3 font-black text-stone-950 dark:text-white">{title}</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-stone-600 dark:text-slate-300">{text}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(145deg,#f8fafc,#ffffff)] p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(3,7,18,0.88),rgba(15,23,42,0.74))] dark:shadow-[0_20px_70px_rgba(0,0,0,0.36),inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-6">
          <div className="mx-auto w-full max-w-3xl">
            <svg
              className="h-auto w-full"
              viewBox="0 0 760 360"
              role="img"
              aria-label={sfText("storefront.sizeGuide.illustrationAria")}
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <linearGradient id="sizeGuidePaper" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="100%" stopColor="#dbeafe" />
                </linearGradient>
                <linearGradient id="sizeGuideFoot" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0%" stopColor="#fef3c7" />
                  <stop offset="100%" stopColor="#f3c7a6" />
                </linearGradient>
                <filter id="sizeGuideGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="10" result="blur" />
                  <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.49 0 0 0 0 0.23 0 0 0 0 0.93 0 0 0 0.45 0" />
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <rect x="20" y="20" width="720" height="320" rx="30" fill="#020617" opacity="0.04" />
              <rect x="82" y="44" width="596" height="250" rx="24" fill="url(#sizeGuidePaper)" opacity="0.96" />
              <path d="M126 86 H634 M126 130 H634 M126 174 H634 M126 218 H634 M126 262 H634" stroke="#94a3b8" strokeOpacity="0.28" strokeWidth="2" />
              <path d="M154 66 V276 M242 66 V276 M330 66 V276 M418 66 V276 M506 66 V276 M594 66 V276" stroke="#94a3b8" strokeOpacity="0.18" strokeWidth="2" />

              <path
                d="M266 244 C220 226 193 184 200 138 C206 96 235 73 270 75 C297 77 314 94 328 119 C337 90 354 65 379 58 C405 51 424 64 431 91 C439 66 457 49 481 51 C507 54 520 74 516 103 C528 85 546 76 565 82 C589 90 595 116 578 139 C598 136 616 147 622 166 C631 194 607 221 566 225 C502 231 450 254 392 267 C346 278 302 258 266 244 Z"
                fill="url(#sizeGuideFoot)"
                stroke="#92400e"
                strokeOpacity="0.34"
                strokeWidth="3"
              />
              <path d="M236 232 C276 252 329 263 383 252 C445 239 498 216 562 211" fill="none" stroke="#7c2d12" strokeOpacity="0.22" strokeWidth="5" strokeLinecap="round" />

              <g filter="url(#sizeGuideGlow)">
                <path d="M198 302 H622" stroke="#7c3aed" strokeWidth="5" strokeLinecap="round" />
                <path d="M198 288 V316 M622 288 V316" stroke="#7c3aed" strokeWidth="5" strokeLinecap="round" />
                <path d="M215 302 l18 -14 M215 302 l18 14 M605 302 l-18 -14 M605 302 l-18 14" stroke="#c4b5fd" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              </g>

              <g>
                <line x1="198" y1="238" x2="198" y2="324" stroke="#10b981" strokeWidth="3" strokeDasharray="8 8" />
                <circle cx="198" cy="238" r="8" fill="#10b981" />
                <rect x="126" y="204" width="118" height="38" rx="19" fill="#064e3b" opacity="0.95" />
                <text x="185" y="228" textAnchor="middle" fill="#d1fae5" fontSize="18" fontWeight="900">{sfText("storefront.sizeGuide.heel")}</text>
              </g>

              <g>
                <line x1="622" y1="166" x2="622" y2="324" stroke="#f59e0b" strokeWidth="3" strokeDasharray="8 8" />
                <circle cx="622" cy="166" r="8" fill="#f59e0b" />
                <rect x="552" y="118" width="142" height="38" rx="19" fill="#78350f" opacity="0.95" />
                <text x="623" y="142" textAnchor="middle" fill="#fef3c7" fontSize="17" fontWeight="900">{sfText("storefront.sizeGuide.longestToe")}</text>
              </g>

              <rect x="315" y="276" width="190" height="42" rx="21" fill="#111827" opacity="0.96" />
              <text x="410" y="303" textAnchor="middle" fill="#ffffff" fontSize="18" fontWeight="900">{sfText("storefront.sizeGuide.lengthCm")}</text>
            </svg>
          </div>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm font-black leading-7 text-stone-600 dark:text-slate-300">
              {sfText("storefront.sizeGuide.measurementCaption")}
          </p>
        </div>
      </div>
    </section>
  );
}

function ReturnsPolicy() {
  const returnPolicy = i18n.t("print.invoice.returnPolicy", {
    defaultValue: "Exchange and return are allowed within 14 days if the item is unused and the invoice is kept.",
  });
  return (
    <section className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-3xl font-black">{sfText("storefront.returns.title")}</h1>
      <div className="mt-5 rounded-3xl border border-stone-200 bg-white p-6 text-lg font-bold leading-9 text-stone-700">
        <p>{returnPolicy}</p>
        <p>{sfText("storefront.returns.noBags")}</p>
        <p>{sfText("storefront.returns.originalCondition")}</p>
      </div>
    </section>
  );
}

function StaticPage({ title, items }) {
  return (
    <section className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-3xl font-black">{title}</h1>
      <div className="mt-5 grid gap-3">
        {items.map(([question, answer]) => (
          <div key={question} className="rounded-3xl border border-stone-200 bg-white p-5">
            <h2 className="font-black">{question}</h2>
            <p className="mt-2 font-bold leading-7 text-stone-600">{answer}</p>
          </div>
        ))}
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
    <div className="sf-reveal overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.045] p-2 shadow-[0_16px_42px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-2xl">
      <div className="grid grid-cols-4 gap-1 text-center text-[11px] font-black text-white/48 sm:text-xs">
        {steps.map((step, index) => (
          <button
            key={step}
            type="button"
            disabled={index === 3 || index + 1 > currentStep}
            onClick={() => index < 3 && onStepChange?.(index + 1)}
            className={`sf-checkout-progress-step flex min-h-10 items-center justify-center rounded-2xl px-1 transition disabled:cursor-default ${index + 1 < activeIndex ? "sf-checkout-progress-step--done border border-[#a78bfa]/20 bg-[#7c3aed]/18 text-[#ddd6fe]" : index + 1 === activeIndex ? "sf-checkout-progress-step--active border border-[#a78bfa]/35 bg-[#7c3aed] text-white shadow-[0_10px_24px_rgba(124,58,237,0.24)]" : "sf-checkout-progress-step--pending border border-white/8 bg-white/[0.035] text-white/38"}`}
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
    [sfText("storefront.checkout.trust.whatsapp"), <MessageCircle className={`h-4 w-4 ${darkMode ? "text-white" : "text-[#7c3aed]"}`} />],
  ];
  return (
    <div className={`sf-checkout-trust-pills grid grid-cols-2 gap-2 text-xs font-black text-white/70 ${compact ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
      {items.map(([label, icon]) => (
        <span key={label} className="sf-checkout-trust-pill inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.18)] backdrop-blur-xl">
          <span className="sf-checkout-trust-pill-icon text-[#c4b5fd]">{icon}</span>
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
      className={`sf-checkout-submit-button ${isSuccess ? "sf-checkout-submit-button--success checkout-payment-confirm" : ""} sf-shimmer-button inline-flex items-center justify-center gap-2 rounded-full border font-black text-white shadow-[0_18px_42px_rgba(124,58,237,0.24)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_54px_rgba(109,40,217,0.34)] active:translate-y-0 active:scale-[0.985] disabled:translate-y-0 disabled:text-white/55 disabled:shadow-none ${isSuccess ? "border-emerald-300/25 bg-[linear-gradient(135deg,rgba(22,163,74,0.96),rgba(5,46,22,0.98))] hover:border-emerald-200/40 hover:bg-[linear-gradient(135deg,rgba(34,197,94,0.98),rgba(4,120,87,0.98))]" : "border-[#a78bfa]/20 bg-[linear-gradient(135deg,rgba(124,58,237,0.96),rgba(17,24,39,0.98))] hover:border-[#c4b5fd]/40 hover:bg-[#6d28d9]"} ${compact ? "sf-checkout-submit-button--compact min-h-13 min-w-36 px-5 py-3 text-sm" : "min-h-14 w-full px-5 py-4"} ${disabled ? "border-white/10 bg-slate-700" : ""}`}
    >
      {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
      <span>{submitting ? sfText("storefront.checkout.actions.confirming") : label || fallbackLabel}</span>
    </button>
  );
}

function CheckoutSection({ number, title, note, children, className = "", dir }) {
  return (
    <section dir={dir} className={`sf-reveal sf-checkout-section ${className} rounded-[1.6rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035)_42%,rgba(7,10,20,0.86))] p-4 text-white shadow-[0_22px_60px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl md:p-5`}>
      <div className="mb-3 flex items-start gap-3">
        <span className="sf-checkout-step-badge grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#a78bfa]/25 bg-[#7c3aed]/24 text-sm font-black text-white shadow-[0_12px_28px_rgba(124,58,237,0.20)]">{number}</span>
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

function Field({ label, value, onChange, required, error, inputMode, placeholder, inputClassName = "" }) {
  return (
    <label className="sf-field sf-checkout-field block">
      <span className="sf-field-label sf-checkout-field-label mb-1.5 block text-sm font-black text-white/82">{label}{required ? " *" : ""}</span>
      <input required={required} inputMode={inputMode} placeholder={placeholder || ""} value={value} onChange={(event) => onChange(event.target.value)} className={`sf-field-input sf-checkout-field-input ${inputClassName} min-h-14 w-full rounded-2xl border bg-white/[0.055] px-4 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:border-[#a78bfa] focus:bg-white/[0.075] focus:shadow-[0_0_0_4px_rgba(167,139,250,0.16),0_18px_38px_rgba(124,58,237,0.16)] ${error ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" : "border-white/12"}`} />
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-200">{error}</span> : null}
    </label>
  );
}

function TextField({ label, value, onChange, required, error, compact, placeholder, inputClassName = "" }) {
  return (
    <label className="sf-checkout-field block md:col-span-2">
      <span className="sf-checkout-field-label mb-1.5 block text-sm font-black text-white/82">{label}{required ? " *" : ""}</span>
      <textarea required={required} placeholder={placeholder || ""} value={value} onChange={(event) => onChange(event.target.value)} rows={compact ? 2 : 3} className={`sf-field-input sf-checkout-field-input ${inputClassName} ${compact ? "sf-checkout-notes-textarea max-h-[90px]" : ""} w-full resize-y rounded-2xl border bg-white/[0.055] p-4 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:border-[#a78bfa] focus:bg-white/[0.075] focus:shadow-[0_0_0_4px_rgba(167,139,250,0.16),0_18px_38px_rgba(124,58,237,0.16)] ${error ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" : "border-white/12"}`} />
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
      <span className={`sf-checkout-field-label mb-1.5 block text-sm font-black ${darkMode ? "text-white/82" : "text-slate-800"}`}>ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ / ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½</span>
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
                  ? "rgba(255,255,255,0.075)"
                  : "rgba(255,255,255,0.055)"
                : state.isFocused
                  ? "rgba(124,58,237,0.04)"
                  : "rgba(255,255,255,0.95)",
              borderColor: error
                ? "rgba(253,164,175,0.78)"
                : state.isFocused
                  ? "#7c3aed"
                  : darkMode
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(148,163,184,0.28)",
              boxShadow: state.isFocused
                ? "0 0 0 4px rgba(167,139,250,0.16),0 18px 38px rgba(124,58,237,0.16)"
                : darkMode
                  ? "0 12px 28px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)"
                  : "0 12px 28px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
              direction: "rtl",
              paddingInline: 4,
              transition: "all 200ms ease",
              "&:hover": { borderColor: error ? "#fb7185" : "#a78bfa" },
            }),
            valueContainer: (base) => ({ ...base, paddingInline: 10 }),
            input: (base) => ({ ...base, color: darkMode ? "#ffffff" : "#0f172a", fontSize: 15, fontWeight: 700 }),
            singleValue: (base) => ({ ...base, color: darkMode ? "#ffffff" : "#0f172a", fontSize: 15, fontWeight: 700 }),
            placeholder: (base) => ({ ...base, color: darkMode ? "rgba(255,255,255,0.38)" : "#64748b", opacity: 1, fontSize: 15, fontWeight: 700 }),
            dropdownIndicator: (base) => ({ ...base, color: darkMode ? "rgba(255,255,255,0.58)" : "rgba(71,85,105,0.9)" }),
            indicatorSeparator: (base) => ({ ...base, backgroundColor: darkMode ? "rgba(255,255,255,0.12)" : "rgba(148,163,184,0.32)" }),
            menu: (base) => ({ ...base, zIndex: 80, borderRadius: 16, overflow: "hidden", direction: "rtl", backgroundColor: darkMode ? "#0b1020" : "#ffffff", border: darkMode ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(226,232,240,0.92)", boxShadow: darkMode ? "0 24px 60px rgba(0,0,0,0.42)" : "0 24px 60px rgba(15,23,42,0.16)" }),
            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
            option: (base, state) => ({
              ...base,
              backgroundColor: darkMode
                ? (state.isSelected ? "#7c3aed" : state.isFocused ? "rgba(124,58,237,0.18)" : "#0b1020")
                : (state.isSelected ? "#7c3aed" : state.isFocused ? "rgba(124,58,237,0.08)" : "#ffffff"),
              color: darkMode ? "#ffffff" : (state.isSelected ? "#ffffff" : "#0f172a"),
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
          className={`sf-field-input sf-checkout-field-input mt-2 min-h-14 w-full rounded-2xl border bg-white/[0.055] px-4 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:border-[#a78bfa] focus:bg-white/[0.075] focus:shadow-[0_0_0_4px_rgba(167,139,250,0.16),0_18px_38px_rgba(124,58,237,0.16)] ${error ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" : "border-white/12"}`}
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
      className={`sf-field-input sf-checkout-field-input min-h-14 w-full rounded-2xl border px-4 text-[15px] font-bold shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 focus:-translate-y-0.5 focus:border-[#7c3aed] focus:shadow-[0_0_0_4px_rgba(124,58,237,0.12),0_18px_38px_rgba(124,58,237,0.16)] disabled:opacity-60 ${darkMode ? "bg-white/[0.055] text-white placeholder:text-white/34 border-white/12 focus:bg-white/[0.075]" : "bg-white text-[#0f172a] placeholder:text-[#64748b] border-slate-300 focus:bg-white" } ${error ? (darkMode ? "border-rose-300/70 focus:border-rose-300" : "border-rose-300/80 focus:border-rose-400") : ""}`}
    >
      <option value="" className={darkMode ? "bg-[#0b1020] text-white" : "bg-white text-[#0f172a]"}>
        {governorate ? sfText("storefront.checkout.cityAreaPlaceholder") : sfText("storefront.checkout.chooseGovernorateFirst")}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value} className={darkMode ? "bg-[#0b1020] text-white" : "bg-white text-[#0f172a]"}>
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
      <select required={required} value={value} onChange={(event) => onChange(event.target.value)} className={`sf-field-input sf-checkout-field-input min-h-14 w-full rounded-2xl border px-4 text-[15px] font-bold shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 focus:-translate-y-0.5 focus:border-[#7c3aed] focus:shadow-[0_0_0_4px_rgba(124,58,237,0.12),0_18px_38px_rgba(124,58,237,0.16)] ${darkMode ? "bg-white/[0.055] text-white placeholder:text-white/34 border-white/12 focus:bg-white/[0.075]" : "bg-white text-[#0f172a] placeholder:text-[#64748b] border-slate-300 focus:bg-white"} ${error ? (darkMode ? "border-rose-300/70 focus:border-rose-300" : "border-rose-300/80 focus:border-rose-400") : ""}`}>
        <option value="" className={darkMode ? "bg-[#0b1020] text-white" : "bg-white text-[#0f172a]"}>{sfText("storefront.common.choose")}</option>
        {options.map((option) => <option key={option} value={option} className={darkMode ? "bg-[#0b1020] text-white" : "bg-white text-[#0f172a]"}>{labels[option] || option}</option>)}
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

  const panelBody = (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="checkout-picker-search-wrap">
        <label className={`checkout-picker-search flex items-center gap-2 ${darkMode ? "" : "border border-slate-300 bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"}`}>
          <Search className={`h-4 w-4 shrink-0 ${darkMode ? "text-white/42" : "text-slate-600"}`} />
          <input
            ref={inputRef}
            dir="auto"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchHint}
            className={`min-w-0 flex-1 bg-transparent text-sm font-bold outline-none ${darkMode ? "text-white placeholder:text-white/34" : "text-slate-900 placeholder:text-slate-500"}`}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border transition ${darkMode ? "border-white/10 bg-white/[0.04] text-white/52 hover:bg-white/[0.08] hover:text-white" : "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`} aria-label={sfText("storefront.common.clear")}>
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </label>
      </div>

      {loading ? (
        <div className={`flex min-h-24 items-center justify-center rounded-[1rem] border px-4 py-4 text-sm font-bold ${darkMode ? "border-white/10 bg-white/[0.03] text-white/62" : "border-slate-300 bg-white text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"}`}>
          <Loader2 className={`mr-2 h-4 w-4 animate-spin ${darkMode ? "text-[#c4b5fd]" : "text-[#7c3aed]"}`} />
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
                className={`group mb-1.5 flex w-full items-center gap-2.5 rounded-[14px] border px-3 py-2.5 text-right transition duration-150 ${
                  selected
                    ? darkMode
                      ? "border-[#a78bfa]/30 bg-[#7c3aed]/10"
                      : "border-[#c4b5fd] bg-[#f5f3ff]"
                    : darkMode
                      ? "border-white/10 bg-white/[0.025] hover:border-[#a78bfa]/22 hover:bg-white/[0.045]"
                      : "border-slate-300 bg-white hover:border-[#a78bfa]/30 hover:bg-[#faf5ff]"
                }`}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition ${selected ? (darkMode ? "border-[#c4b5fd] bg-[#7c3aed]/90 text-white" : "border-[#7c3aed] bg-[#7c3aed] text-white") : (darkMode ? "border-white/14 bg-white/[0.03] text-transparent group-hover:border-[#a78bfa]/45" : "border-slate-300 bg-white text-transparent group-hover:border-[#7c3aed]/35")}`}>
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
        className={`flex min-h-[48px] w-full items-center gap-3 rounded-[16px] border px-3.5 text-right text-sm font-bold outline-none backdrop-blur transition duration-150 focus:border-[#7c3aed] focus:shadow-[0_0_0_3px_rgba(124,58,237,0.12),0_12px_28px_rgba(124,58,237,0.10)] disabled:cursor-not-allowed disabled:opacity-65 ${darkMode ? `bg-white/[0.045] text-white shadow-[0_10px_22px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.03)] focus:bg-white/[0.065] ${error ? "border-rose-300/70 focus:border-rose-300" : "border-white/10"}` : `bg-white text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.92)] focus:bg-white ${error ? "border-rose-300/80 focus:border-rose-400" : "border-slate-300"}`}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-start">{triggerLabel}</span>
        {loading ? <Loader2 className={`h-4 w-4 shrink-0 animate-spin ${darkMode ? "text-[#c4b5fd]" : "text-[#7c3aed]"}`} /> : <ChevronLeft className={`h-4 w-4 shrink-0 transition ${darkMode ? "text-white/60" : "text-slate-600"} ${open ? "rotate-[-90deg]" : ""}`} />}
      </button>
      {helperText ? <p className={`sf-checkout-picker-text mt-1.5 text-xs font-bold ${darkMode ? "text-white/46" : "text-slate-500"}`}>{helperText}</p> : null}
      {error ? <span className={`mt-1.5 block text-xs font-black ${darkMode ? "text-rose-200" : "text-rose-600"}`}>{error}</span> : null}

      {open ? (
        isMobile ? (
          <MobileBottomSheet open={open} title={panelTitle} onClose={close} className={darkMode ? "checkout-picker-sheet bg-[#050816] text-white" : "checkout-picker-sheet bg-[#f8fafc] text-slate-900"} titleClassName="text-sm">
            {panelBody}
          </MobileBottomSheet>
        ) : (
          <div className={`absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-[16px] border p-2.5 backdrop-blur-2xl ${darkMode ? "border-white/10 bg-[linear-gradient(180deg,rgba(8,12,26,0.98),rgba(5,8,18,0.98))] text-white shadow-[0_18px_46px_rgba(0,0,0,0.28)]" : "border-slate-300 bg-white text-slate-900 shadow-[0_18px_46px_rgba(15,23,42,0.14)]"}`}>
            {panelBody}
          </div>
        )
      ) : null}
    </div>
  );
});

function ProductCardSkeleton() {
  return (
    <article className="overflow-hidden rounded-[1.2rem] border border-white/70 bg-white shadow-[0_10px_26px_rgba(39,20,75,0.07)] ring-1 ring-stone-200/55 dark:border-white/[0.08] dark:bg-[linear-gradient(145deg,rgba(17,24,39,0.95),rgba(11,16,32,0.93)_52%,rgba(8,13,25,0.98))] dark:ring-white/[0.05]">
      <div className="relative aspect-[0.96/1] p-1.5">
        <div className="sf-skeleton-shimmer h-full rounded-[1rem] bg-stone-200/80 dark:bg-white/[0.06]" />
      </div>
      <div className="space-y-2 p-2.5 pt-2">
        <div className="sf-skeleton-shimmer h-5 w-[88%] rounded-full bg-stone-200/80 dark:bg-white/[0.08]" />
        <div className="sf-skeleton-shimmer h-4 w-2/3 rounded-full bg-stone-200/80 dark:bg-white/[0.08]" />
        <div className="flex gap-1.5 overflow-hidden">
          <div className="sf-skeleton-shimmer h-6 w-10 rounded-full bg-stone-200/80 dark:bg-white/[0.08]" />
          <div className="sf-skeleton-shimmer h-6 w-10 rounded-full bg-stone-200/80 dark:bg-white/[0.08]" />
          <div className="sf-skeleton-shimmer h-6 w-10 rounded-full bg-stone-200/80 dark:bg-white/[0.08]" />
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
        <div className="sf-skeleton-shimmer h-28 rounded-[1.75rem] bg-white/80 shadow-[0_12px_32px_rgba(39,20,75,0.05)] dark:bg-white/5" />
        <div className="sf-skeleton-shimmer h-64 rounded-[1.75rem] bg-white/80 shadow-[0_12px_32px_rgba(39,20,75,0.05)] dark:bg-white/5" />
      </div>
    </section>
  );
}

function VisualSearchResultsFallback() {
  return (
    <div className="sf-visual-card-list">
      {[0, 1].map((item) => (
        <div key={item} className="sf-visual-card animate-pulse">
          <div className="sf-visual-card-main">
            <div className="h-24 w-24 shrink-0 rounded-2xl bg-stone-200/80 dark:bg-white/10" />
            <div className="min-w-0 flex-1">
              <div className="h-4 w-4/5 rounded-full bg-stone-200 dark:bg-white/10" />
              <div className="mt-3 h-3 w-3/5 rounded-full bg-stone-200 dark:bg-white/10" />
              <div className="mt-4 h-4 w-24 rounded-full bg-stone-200 dark:bg-white/10" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductGalleryFallback() {
  return (
    <div className="min-w-0">
      <div className="mx-auto h-[clamp(250px,42vh,340px)] w-full max-w-[92vw] animate-pulse rounded-[24px] bg-white/80 shadow-[0_14px_40px_rgba(39,20,75,0.10)] md:h-[clamp(420px,58vh,540px)] md:max-w-none md:rounded-[1.75rem] dark:bg-white/5" />
      <div className="mt-3 flex gap-2">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-12 w-12 animate-pulse rounded-xl bg-white/80 dark:bg-white/5 md:h-20 md:w-20 md:rounded-2xl" />)}
      </div>
    </div>
  );
}

function EmptyState({ title, text, actionTo = "/shop/products", actionLabel }) {
  return (
    <div className="sf-empty-state mx-auto mt-6 mb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.5rem)] max-w-xl rounded-[1.75rem] border border-[#8b5cf6]/18 bg-[linear-gradient(180deg,rgba(18,18,28,0.96),rgba(7,10,20,0.94))] p-6 text-center text-stone-50 shadow-[0_18px_45px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl md:mb-6 md:p-7">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-[#8b5cf6]/20 bg-[#7c3aed]/14 text-[#c4b5fd] shadow-[0_14px_34px_rgba(124,58,237,0.16)]">
        <PackageSearch className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-2xl font-black text-stone-50">{title}</h2>
      <p className="mx-auto mt-2 max-w-md font-bold leading-7 text-stone-400">{text}</p>
      <Link to={actionTo} className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full border border-[#a78bfa]/24 bg-[linear-gradient(135deg,rgba(124,58,237,0.95),rgba(17,24,39,0.92))] px-5 py-3 text-sm font-black text-white shadow-[0_14px_34px_rgba(124,58,237,0.25)] transition hover:-translate-y-0.5 hover:border-[#c4b5fd]/45 hover:shadow-[0_18px_42px_rgba(124,58,237,0.34)] active:scale-[0.98]">
        {actionLabel || sfText("storefront.common.shopNow")}
      </Link>
    </div>
  );
}

function CartDrawer({ open, onClose, cart, updateCart, removeFromCart }) {
  useBodyScrollLock(open);
  if (!open) return null;
  const subtotal = cart.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  const total = subtotal;
  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} aria-label={sfText("storefront.common.close")} />
      <aside dir="rtl" className="sf-cart-drawer absolute inset-x-0 bottom-0 flex max-h-[94dvh] min-h-[72dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,18,33,0.98),rgba(7,10,20,0.98))] text-white shadow-[0_-28px_80px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:min-h-0 md:w-[28rem] md:rounded-s-[2rem] md:rounded-tr-none">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.035] px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-black text-[#c4b5fd]">{cart.length ? sfText("storefront.products.productCount", "{{count}} items", { count: cart.length }) : "Your cart is empty"}</p>
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
          <div dir="rtl" className="sf-cart-drawer-footer shrink-0 border-t border-white/10 bg-[#070b16]/92 px-4 pb-[calc(1.35rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-24px_60px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:px-5">
            <div className="mb-3 flex items-end justify-between gap-3 text-right">
              <div className="sf-cart-drawer-total">
                <p className="text-xs font-black text-white/54">{sfText("storefront.checkout.total")}</p>
                <p className="mt-1 text-2xl font-black leading-none text-white">{money(total)}</p>
              </div>
              <p className="max-w-32 text-start text-[11px] font-bold leading-5 text-white/46">{sfText("storefront.checkout.finalShippingAtCheckout")}</p>
            </div>
            <Link to="/shop/checkout" onClick={onClose} className="sf-cart-drawer-checkout-button sf-shimmer-button block min-h-14 rounded-full border border-[#a78bfa]/20 bg-[linear-gradient(135deg,rgba(124,58,237,0.96),rgba(17,24,39,0.98))] px-5 py-4 text-center text-base font-black text-white shadow-[0_18px_42px_rgba(124,58,237,0.26)] transition hover:-translate-y-0.5 hover:border-[#c4b5fd]/40 hover:shadow-[0_22px_54px_rgba(109,40,217,0.34)] active:translate-y-0 active:scale-[0.98]">
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
    <article dir="rtl" className="sf-cart-row w-full min-w-0 rounded-[1.35rem] border border-white/10 bg-white/[0.055] p-3 text-right text-white shadow-[0_16px_42px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl">
      <div className="flex min-w-0 items-start gap-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/[0.065] ring-1 ring-white/10">
          <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" width="80" height="80" />
        </div>
        <div className="min-w-0 flex-1 self-stretch">
          <h3 className="line-clamp-2 break-words text-sm font-black leading-5 text-white">{item.name}</h3>
          <p className="mt-1 inline-flex max-w-full rounded-full border border-white/10 bg-white/[0.055] px-2 py-1 text-xs font-bold text-white/58">{item.color || sfText("storefront.products.color", "Color")} / {item.size || sfText("storefront.products.size", "Size")}</p>
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
      <button onClick={onPlus} className="sf-cart-quantity-button grid h-9 w-9 place-items-center rounded-full border border-[#a78bfa]/30 bg-[#7c3aed]/24 text-white shadow-[0_10px_22px_rgba(124,58,237,0.16)] transition hover:bg-[#7c3aed]/34 active:scale-95" aria-label={sfText("storefront.cart.increaseQuantity")}>
        +
      </button>
    </div>
  );
}

function Footer() {
  const darkMode = typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || document.body.classList.contains("storefront-dark"));
  return (
    <footer className="mt-4 border-t border-stone-200 bg-[#f0ebe2] px-4 py-6 md:mt-8 md:py-10 dark:border-white/10 dark:bg-[linear-gradient(180deg,#050816,#020617)] dark:text-white">
      <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-[1.2fr_0.8fr_0.8fr_1fr]">
        <div><h3 className="text-2xl font-black tracking-normal">{sfText("storefront.footer.brand")}</h3><p className="mt-2 max-w-sm text-sm font-bold leading-6 text-stone-600 dark:text-stone-400">{sfText("storefront.footer.tagline")}</p></div>
        <FooterLinks title={sfText("storefront.footer.links")} links={[[sfText("storefront.returns.title"), "/shop/returns"], [sfText("storefront.nav.sizeGuide"), "/shop/size-guide"], [sfText("storefront.faq.title"), "/shop/faq"]]} />
        <FooterLinks title={sfText("storefront.footer.contact")} links={[[sfText("storefront.contact.title"), "/shop/contact"], [sfText("storefront.support.whatsapp"), "https://wa.me/"], ["Instagram", "/shop/contact"]]} />
        <div>
          <h4 className="font-black">{sfText("storefront.footer.followUs")}</h4>
          <div className="mt-3 flex gap-2">
            <a href="https://wa.me/" className="grid h-11 w-11 place-items-center rounded-full border border-stone-200 bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:text-emerald-600 dark:border-white/12 dark:bg-white/[0.075] dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:border-emerald-300/40 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-300" aria-label="WhatsApp"><MessageCircle className="h-5 w-5" /></a>
            <Link to="/shop/contact" className="grid h-11 w-11 place-items-center rounded-full border border-stone-200 bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c4b5fd] hover:text-[#6d28d9] dark:border-white/12 dark:bg-white/[0.075] dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:border-[#c4b5fd]/40 dark:hover:bg-[#7c3aed]/12 dark:hover:text-[#d8b4fe]" aria-label="Instagram"><Camera className="h-5 w-5" /></Link>
            <Link to="/shop/contact" className="grid h-11 w-11 place-items-center rounded-full border border-stone-200 bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c4b5fd] hover:text-[#6d28d9] dark:border-white/12 dark:bg-white/[0.075] dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:border-[#c4b5fd]/40 dark:hover:bg-[#7c3aed]/12 dark:hover:text-[#d8b4fe]" aria-label="Facebook"><Send className="h-5 w-5" /></Link>
          </div>
          <a href="https://wa.me/" className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/30 bg-stone-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-[#6d28d9] dark:bg-emerald-500 dark:text-white dark:shadow-[0_14px_34px_rgba(16,185,129,0.22)] dark:hover:bg-emerald-400">
            <MessageCircle className={`h-4 w-4 ${darkMode ? "text-white" : "text-[#7c3aed]"}`} />
            {sfText("storefront.support.whatsappHelp")}
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterLinks({ title, links }) {
  return <div><h4 className="font-black">{title}</h4><div className="mt-3 grid gap-2 text-sm font-bold text-stone-600 dark:text-stone-400">{links.map(([label, href]) => <Link className="transition hover:text-[#6d28d9] dark:hover:text-[#d8b4fe]" key={label} to={href}>{label}</Link>)}</div></div>;
}

function MobileBottomNav({ count }) {
  const location = useLocation();
  const links = [
    { id: "home", to: "/shop", label: sfText("storefront.nav.home"), icon: Home },
    { id: "products", to: "/shop/products", label: sfText("storefront.nav.categories"), icon: Menu },
    { id: "search", to: "/shop/products?search=1", label: sfText("storefront.common.search"), icon: Search },
    { id: "wishlist", to: "/shop/wishlist", label: sfText("storefront.header.wishlist"), icon: Heart },
    { id: "cart", to: "/shop/cart", label: sfText("storefront.cart.title"), icon: ShoppingCart },
  ];
  const isActive = (item) => {
    const path = location.pathname;
    const search = location.search || "";
    if (item.id === "home") return path === "/shop";
    if (item.id === "products") return path === "/shop/products" && !search.includes("search=1");
    if (item.id === "search") return path === "/shop/products" && search.includes("search=1");
    if (item.id === "wishlist") return path === "/shop/wishlist";
    if (item.id === "cart") return path === "/shop/cart";
    return false;
  };

  return (
    <nav
      dir="rtl"
      className="sf-mobile-bottom-nav fixed inset-x-0 bottom-0 z-[48] h-[calc(var(--mobile-bottom-nav-height)+var(--safe-bottom))] border-t border-white/10 bg-slate-950/[0.88] px-3 pb-[var(--safe-bottom)] pt-1.5 shadow-[0_-18px_46px_rgba(0,0,0,0.32),0_1px_0_rgba(255,255,255,0.05)_inset] backdrop-blur-2xl md:hidden"
      aria-label={sfText("storefront.nav.mobileNavigation")}
    >
      <div className="mx-auto grid h-full w-full max-w-[25.5rem] min-w-0 grid-cols-5 items-center gap-0.5 overflow-hidden">
        {links.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          const badgeCount = Number(count || 0);
          return (
            <Link
              key={item.id}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={[
                "group relative flex min-h-[2.75rem] min-w-0 flex-col items-center justify-center gap-0 rounded-2xl px-0.5 text-[9.5px] font-semibold leading-none transition duration-300",
                active
                  ? "scale-[1.03] bg-white/14 text-white shadow-[0_0_24px_rgba(124,58,237,0.22)]"
                  : "text-slate-200/92 hover:bg-white/[0.08] hover:text-white",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-6 w-6 place-items-center rounded-full transition duration-300",
                  active ? "bg-[#7c3aed]/18 text-white" : "text-slate-100/90 group-hover:text-white",
                ].join(" ")}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={2.15} />
              </span>
              <span className={`max-w-full truncate ${active ? "font-black text-white" : "font-semibold text-slate-100/92"}`}>{item.label}</span>
              {item.id === "cart" && badgeCount > 0 ? (
                <span className="absolute left-2 top-1 min-w-4 rounded-full border border-white/25 bg-rose-500 px-1.5 py-0.5 text-[8.5px] font-black leading-none text-white shadow-[0_0_14px_rgba(244,63,94,0.55)] animate-[pulse_1.8s_ease-in-out_infinite]">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function SummaryRow({ label, value, strong, dark = false, rtl = false }) {
  if (dark) {
    return <div className={`sf-summary-row flex items-center justify-between gap-3 ${rtl ? "flex-row-reverse text-right" : ""} ${strong ? "mt-3 border-t border-white/10 pt-3 text-xl font-black text-white" : "mt-2 text-sm font-bold text-white/58"}`}><span className="sf-summary-row-label">{label}</span><span className={`sf-summary-row-value ${strong ? "rounded-full border border-[#a78bfa]/20 bg-[#7c3aed]/18 px-3 py-1 text-white shadow-[0_10px_24px_rgba(124,58,237,0.18)]" : "font-black text-white"}`}>{value}</span></div>;
  }
  return <div className={`sf-summary-row flex items-center justify-between gap-3 ${rtl ? "flex-row-reverse text-right" : ""} ${strong ? "mt-3 border-t border-stone-200 pt-3 text-xl font-black text-stone-950" : "mt-2 text-sm font-bold text-stone-600"}`}><span className="sf-summary-row-label">{label}</span><span className={`sf-summary-row-value ${strong ? "rounded-full bg-white px-3 py-1 shadow-sm" : "font-black text-stone-800"}`}>{value}</span></div>;
}

function InfoLine({ icon, text }) {
  return (
    <div className="sf-checkout-info-line flex min-h-14 items-center gap-2 rounded-[1rem] border border-white/[0.08] bg-white/[0.055] p-3 text-white/74 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur transition hover:border-white/16 hover:bg-white/[0.075]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-[#c4b5fd]">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function PaymentMethodTab({ method, active, onClick, label, helperText, logoUrl }) {
  const isVodafone = method === "vodafone_cash";
  const subtitle = helperText || (isVodafone
    ? sfText("storefront.checkout.transfer.vodafoneWallet")
    : sfText("storefront.checkout.transfer.instantBankTransfer"));
  const methodLabel = label || (isVodafone ? "Vodafone Cash" : "InstaPay");
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sf-checkout-payment-tab ${active ? "sf-checkout-payment-tab--active" : "sf-checkout-payment-tab--inactive"} ${isVodafone ? "sf-checkout-payment-tab--vodafone" : "sf-checkout-payment-tab--instapay"} group relative overflow-hidden rounded-[1.2rem] px-3 py-3 text-right transition duration-300 active:scale-[0.985] ${
        active
          ? isVodafone
            ? "border border-red-300/35 bg-[linear-gradient(135deg,rgba(230,0,0,0.28),rgba(255,255,255,0.08))] text-white shadow-[0_18px_42px_rgba(230,0,0,0.20)] ring-2 ring-red-400/12"
            : "border border-[#c4b5fd]/45 bg-[linear-gradient(135deg,rgba(124,58,237,0.34),rgba(255,255,255,0.10))] text-white shadow-[0_18px_46px_rgba(124,58,237,0.28)] ring-2 ring-[#a78bfa]/16"
          : "border border-transparent text-white/58 hover:border-white/10 hover:bg-white/[0.065] hover:text-white hover:shadow-[0_16px_36px_rgba(124,58,237,0.12)]"
      }`}
    >
      <span className={`absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100 ${isVodafone ? "bg-[radial-gradient(circle_at_top_left,rgba(230,0,0,0.22),transparent_42%)]" : "bg-[radial-gradient(circle_at_top_left,rgba(196,181,253,0.22),transparent_42%)]"}`} />
      <span className="relative flex items-center gap-3">
        <PaymentBrandLogo method={method} size="tab" active={active} label={methodLabel} logoUrl={logoUrl} />
        <span className="min-w-0">
          <span className="block text-sm font-black">{methodLabel}</span>
          <span className={`mt-0.5 block text-[11px] font-bold ${active ? "text-white/74" : "text-white/42"}`}>
            {subtitle}
          </span>
        </span>
        <span className={`mr-auto grid h-6 w-6 shrink-0 place-items-center rounded-full border transition ${active ? "border-white/40 bg-white/16 text-white" : "border-white/14 bg-white/[0.04] text-transparent"}`}>
          <Check className="h-3.5 w-3.5" />
        </span>
      </span>
    </button>
  );
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
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#111827] text-xs font-black text-white">
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

function PaymentCopyLine({ method, label, value, amount, deepLink }) {
  const [copied, setCopied] = useState(false);
  const isVodafone = method === "vodafone_cash";
  const copyValue = async () => {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    toast.success(sfText("storefront.toasts.copied"));
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={`sf-checkout-payment-copy rounded-[1.55rem] border p-4 shadow-[0_22px_54px_rgba(0,0,0,0.26)] ${isVodafone ? "border-red-300/18 bg-[linear-gradient(145deg,rgba(230,0,0,0.16),rgba(255,255,255,0.055))]" : "border-[#a78bfa]/18 bg-[linear-gradient(145deg,rgba(124,58,237,0.18),rgba(255,255,255,0.055))]"}`}>
      <div className="flex min-w-0 items-start gap-3">
        <PaymentBrandLogo method={method} size="copy" label={label} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black text-white/48">{sfText("storefront.checkout.transfer.transferDetailsVia", "ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ï؟½ ï؟½ï؟½ï؟½ {{label}}", { label })}</div>
          <div className="sf-checkout-payment-value mt-2 rounded-2xl border border-white/10 bg-black/24 px-3 py-3 font-mono text-xl font-black tracking-wide text-white shadow-inner shadow-black/20" dir="ltr">{value}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-white/54">
            <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1">{sfText("storefront.checkout.transfer.amount")}: {money(amount)}</span>
            <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-emerald-100">{sfText("storefront.checkout.transfer.noCardSharing")}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={copyValue} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-black transition duration-200 ${copied ? "bg-emerald-400 text-emerald-950 shadow-[0_14px_32px_rgba(16,185,129,0.25)]" : "bg-[#7c3aed] text-white shadow-[0_14px_32px_rgba(124,58,237,0.28)] hover:-translate-y-0.5 hover:bg-[#6d28d9]"}`} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? sfText("storefront.toasts.copied") : sfText("storefront.checkout.transfer.copyPaymentDetails")}
        </button>
        <button type="button" onClick={() => { window.location.href = deepLink; }} className="sf-checkout-copy-link inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white/[0.09] md:hidden">
          <Smartphone className="h-4 w-4" />
          {sfText("storefront.checkout.transfer.openApp")}
        </button>
      </div>
    </div>
  );
}

function InfoBox({ label, value, darkMode: darkModeProp } = {}) {
  const darkMode = typeof darkModeProp === "boolean"
    ? darkModeProp
    : typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || document.body.classList.contains("storefront-dark"));
  return <div className="sf-info-box sf-checkout-info-box mt-3 rounded-2xl bg-stone-50 p-4"><div className={`sf-info-label text-xs font-bold ${darkMode ? "text-slate-700" : "text-stone-500"}`}>{label}</div><div className={`sf-info-value mt-1 font-black ${darkMode ? "text-slate-900" : ""}`}>{value}</div></div>;
}

function Panel({ title, children }) {
  return <div className="sf-panel sf-checkout-panel rounded-3xl border border-stone-200 bg-white p-5"><h2 className="sf-section-heading mb-3 text-xl font-black">{title}</h2><div className="grid gap-2">{children}</div></div>;
}

function SmallProductList({ items, empty = sfText("storefront.common.noResults") }) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return <p className="sf-muted-empty font-bold text-stone-500">{empty}</p>;
  return safeItems.slice(0, 6).map((item) => {
    const product = normalizeWishlistProduct(item);
    return (
      <Link key={product.id || product.slug} to={`/shop/product/${product.slug || product.id}`} className="sf-small-product-row sf-storefront-card flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3">
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
        <div key={item.id} className={`sf-storefront-card sf-small-product-card group min-w-0 overflow-hidden rounded-[1.6rem] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(15,23,42,0.86),rgba(3,7,18,0.94))] shadow-[0_20px_58px_rgba(0,0,0,0.34)] ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-[#a78bfa]/25 hover:shadow-[0_28px_74px_rgba(0,0,0,0.42)] ${item.unavailable ? "flex min-h-[430px] flex-col p-4" : "flex min-h-[460px] flex-col p-3.5"}`}>
          {item.unavailable ? (
            <div className="flex flex-1 flex-col justify-center rounded-[1.25rem] border border-rose-300/15 bg-gradient-to-br from-rose-500/10 to-white/[0.04] p-4 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-rose-300/20 bg-rose-400/10 text-rose-300 shadow-[0_12px_30px_rgba(244,63,94,0.12)]">
                <Heart className="h-5 w-5" />
              </span>
              <div className="mt-3 text-base font-black text-white">{sfText("storefront.products.unavailableNow")}</div>
              <p className="mt-1 text-xs font-bold leading-5 text-white/50">{sfText("storefront.products.openForDetails")}</p>
            </div>
          ) : (
            <Link to={`/shop/product/${item.slug || item.id}`} className="flex min-h-0 flex-1 flex-col">
              <div className="aspect-[4/5] w-full overflow-hidden rounded-xl border border-white/70 bg-gradient-to-br from-stone-50 via-white to-stone-100 p-3 shadow-inner shadow-stone-200/70">
                <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt={item.name || ""} className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.035]" loading="lazy" decoding="async" width="320" height="400" />
              </div>
              <div className="mt-4 line-clamp-2 min-h-12 break-words text-start text-base font-black leading-6 text-white">{item.name || sfText("storefront.products.savedProduct")}</div>
              <div className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-start text-sm font-black text-white">
                {item.price ? <span className="text-lg text-white">{money(item.price)}</span> : <span className="text-sm font-bold text-white/50">{sfText("storefront.products.openForDetails")}</span>}
                {item.compare_at_price && item.compare_at_price > item.price ? <span className="text-xs font-bold text-white/40 line-through">{money(item.compare_at_price)}</span> : null}
              </div>
            </Link>
          )}
          <div className="mt-3 grid gap-2">
            {onAddToCart && !item.unavailable ? <button type="button" onClick={() => addWishlistItemToCart(item)} className="sf-wishlist-add-button min-h-12 rounded-full bg-gradient-to-l from-[#4c1d95] via-[#6d28d9] to-[#111827] px-4 py-3 text-sm font-black text-white shadow-[0_14px_34px_rgba(109,40,217,0.3)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(109,40,217,0.38)]">{sfText("storefront.cart.addToCart")}</button> : null}
            {action ? <button type="button" onClick={() => action(item)} className="sf-wishlist-remove-button min-h-11 rounded-full border border-white/[0.1] bg-white/[0.045] px-4 py-2 text-sm font-black text-rose-200 transition hover:border-rose-400/70 hover:bg-rose-500 hover:text-white">{item.unavailable ? sfText("storefront.wishlist.removeFromWishlist") : sfText("storefront.common.remove")}</button> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Reviews() {
  const reviews = [
    ["M", sfText("storefront.reviews.items.quality")],
    ["A", sfText("storefront.reviews.items.size")],
    ["S", sfText("storefront.reviews.items.experience")],
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-3 text-white md:py-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-black text-white">{sfText("storefront.reviews.title")}</h2>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.055] px-3 py-1.5 text-xs font-black text-[#c4b5fd] shadow-[0_0_28px_rgba(124,58,237,0.18)] backdrop-blur-xl">4.8 / 5</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {reviews.map(([avatar, review]) => (
          <div key={review} className="rounded-[1.35rem] border border-white/[0.08] bg-[linear-gradient(180deg,#07111f_0%,#050b16_100%)] p-3.5 font-bold text-white shadow-[0_16px_42px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.025] backdrop-blur-xl md:p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.06] text-sm font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">{avatar}</span>
              <div className="min-w-0">
                <div className="flex gap-0.5 text-[#8b5cf6]">
                  {Array.from({ length: 5 }).map((_, index) => <Star key={index} className="h-3.5 w-3.5 fill-current" />)}
                </div>
                <div className="mt-1 inline-flex rounded-full border border-white/[0.08] bg-white/[0.045] px-2 py-0.5 text-[11px] font-black text-white/65">{sfText("storefront.reviews.verifiedCustomer")}</div>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/90">{review}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MobileBuyBar({ product, variant, visible, onAddToCart, buyNow }) {
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
        <button onClick={onAddToCart} disabled={disabled} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-l from-[#7c3aed] to-[#111827] px-4 py-3 text-sm font-black text-white shadow-[0_18px_42px_rgba(124,58,237,0.34)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#7c3aed]/35 disabled:text-white/60 disabled:shadow-none">
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
  const compareAtPrice = Number(variant.compare_at_price ?? product.compare_at_price ?? product.original_price ?? 0) || 0;
  return {
    lineId: [
      product.id || product.slug || product.name || "product",
      variant.id || variant.sku || variant.size || variant.color || "variant",
    ].join(":"),
    product_id: product.id || "",
    variant_id: variant.id || "",
    name: cleanDisplayText(mirrorProductTitle(product, variant) || product.name || product.title || ""),
    slug: product.slug || "",
    image_url: image,
    product_image: image,
    color: variantColorName(variant) || variant.color || "",
    size: variant.size || "",
    quantity: Math.max(1, Number(quantity || 1)),
    price,
    sale_price: price,
    compare_at_price: compareAtPrice,
    total_amount: price * Math.max(1, Number(quantity || 1)),
  };
};

const OrderNumberBadge = ({ value, className = "" }) => {
  const text = displayPublicOrderNumber(value);
  return <span className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3 py-1.5 text-sm font-black ${className}`.trim()} dir="ltr">{text}</span>;
};

function Storefront() {
  const location = useLocation();
  const navigate = useNavigate();
  const [cart, setCart] = useState(() => readStorefrontStorage(CART_KEY, []));
  const [wishlist, setWishlist] = useState(() => readStorefrontStorage(WISHLIST_KEY, []));
  const [recent, setRecent] = useState(() => readStorefrontStorage(RECENT_KEY, []));
  const [profile, setProfile] = useState(() => readStorefrontStorage(PROFILE_KEY, { full_name: "", primary_phone: "", phone: "" }));
  const [themeMode, setThemeMode] = useState(() => readStorefrontStorage(THEME_KEY, "light"));
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const cartCount = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const wishlistCount = wishlist.length;
  const toggleThemeMode = useCallback(() => {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    setRouteReady(true);
  }, []);

  useEffect(() => {
    writeStorefrontStorage(CART_KEY, cart);
  }, [cart]);

  useEffect(() => {
    writeStorefrontStorage(WISHLIST_KEY, wishlist);
  }, [wishlist]);

  useEffect(() => {
    writeStorefrontStorage(RECENT_KEY, recent);
  }, [recent]);

  useEffect(() => {
    writeStorefrontStorage(PROFILE_KEY, profile);
  }, [profile]);

  useEffect(() => {
    writeStorefrontStorage(THEME_KEY, themeMode);
    if (typeof document === "undefined") return;
    document.body.classList.toggle("storefront-dark", themeMode === "dark");
  }, [themeMode]);

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

  const onAddToCart = useCallback((product, variant, quantity = 1) => {
    if (!product || !variant) return;
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
    setCartDrawerOpen(true);
    return "added";
  }, []);

  const toggleWishlist = useCallback((product) => {
    const item = normalizeStorefrontItem(product);
    if (!item.id) return;
    setWishlist((prev) => {
      const exists = prev.some((entry) => String(entry.id) === String(item.id));
      return exists ? prev.filter((entry) => String(entry.id) !== String(item.id)) : [item, ...prev];
    });
  }, []);

  const rememberProduct = useCallback((product) => {
    const item = normalizeStorefrontItem(product);
    if (!item.id) return;
    setRecent((prev) => {
      const next = [item, ...prev.filter((entry) => String(entry.id) !== String(item.id))];
      return next.slice(0, 20);
    });
  }, []);

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
  }), []);

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

  if (!routeReady) return <StorefrontPageFallback />;

  return (
    <>
      <Header
        cartCount={cartCount}
        wishlistCount={wishlistCount}
        onCart={() => navigate("/shop/cart")}
        effectiveTheme={themeMode}
        onToggleTheme={toggleThemeMode}
        brandName={storefrontBrandSettings.brandName}
        brandTagline={storefrontBrandSettings.brandTagline}
        brandLogoUrl={storefrontBrandSettings.brandLogoUrl}
      />
      <Routes>
      <Route
        index
        element={<HomePage wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} themeMode={themeMode} />}
      />
      <Route
        path="products"
        element={<LazyStorefrontProductListingPage wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} />}
      />
      <Route
        path="sale"
        element={<LazyStorefrontProductListingPage sale wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} />}
      />
      <Route
        path="product/:identifier"
        element={<LazyStorefrontProductDetailPage onAddToCart={onAddToCart} toggleWishlist={toggleWishlist} wishlist={wishlist} rememberProduct={rememberProduct} recent={recent} profile={profile} />}
      />
      <Route
        path="cart"
        element={<LazyStorefrontCartPage cart={cart} updateCart={updateCart} removeFromCart={removeFromCart} helpers={helpers} components={components} />}
      />
      <Route
        path="checkout"
        element={<CheckoutPage cart={cart} clearCart={clearCart} profile={profile} setProfile={setProfile} themeMode={themeMode} />}
      />
      <Route
        path="success/:orderNumber"
        element={<OrderSuccess profile={profile} themeMode={themeMode} />}
      />
      <Route
        path="track"
        element={<LazyStorefrontTrackOrderPage helpers={helpers} components={components} />}
      />
      <Route
        path="account"
        element={<LazyStorefrontAccountPage profile={profile} setProfile={setProfile} wishlist={wishlist} recent={recent} onAddToCart={onAddToCart} helpers={helpers} components={components} />}
      />
      <Route
        path="wishlist"
        element={<LazyStorefrontWishlistPage wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} helpers={helpers} components={components} />}
      />
      <Route
        path="recently-viewed"
        element={<LazyStorefrontRecentPage recent={recent} helpers={helpers} components={components} />}
      />
      <Route
        path="faq"
        element={<FaqPage />}
      />
      <Route
        path="contact"
        element={<ContactPage />}
      />
      <Route
        path="size-guide"
        element={<SizeGuide />}
      />
      <Route
        path="returns"
        element={<ReturnsPolicy />}
      />
      <Route
        path="*"
        element={<HomePage wishlist={wishlist} toggleWishlist={toggleWishlist} onAddToCart={onAddToCart} themeMode={themeMode} />}
      />
      </Routes>
      <CartDrawer
        open={cartDrawerOpen}
        onClose={() => setCartDrawerOpen(false)}
        cart={cart}
        updateCart={updateCart}
        removeFromCart={removeFromCart}
      />
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
  getSessionId,
  imageFor,
  isLastPieceProduct,
  isMirrorProduct,
  money,
  normalizeAudienceValue,
  mirrorProductTitle,
  productAudienceValues,
  productCardKey,
  productFromDetailsResponse,
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
  }

  render() {
    if (this.state.hasError) {
      return (
        <div dir="rtl" className="min-h-screen bg-[#f7f4ee] px-4 py-10 text-center text-stone-950">
          <div className="mx-auto max-w-md rounded-[1.5rem] border border-stone-200 bg-white p-6 shadow-[0_18px_50px_rgba(39,20,75,0.08)]">
            <Sparkles className="mx-auto h-8 w-8 text-[#6d28d9]" />
            <h1 className="mt-4 text-2xl font-black">{sfText("storefront.errors.simpleProblem")}</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-stone-500">{sfText("storefront.errors.cleanedTemporaryData")}</p>
            <button onClick={() => location.reload()} className="mt-5 rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white">{sfText("storefront.common.refreshPage")}</button>
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
