import { Component, useEffect, useMemo, useRef, useState } from "react";
import { memo, useCallback } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { lazy, Suspense } from "react";
import i18n, { applyDocumentLanguage, normalizeLanguage, persistApplicationLanguage } from "../i18n/i18n";
import { logPagePerf } from "../shared/lib/perfDebug";
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
  LockKeyhole,
  Menu,
  MessageCircle,
  MessageCircleMore,
  Mic,
  Minus,
  PackageCheck,
  PackageSearch,
  Phone,
  QrCode,
  ReceiptText,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Send,
  ShieldCheck,
  Share2,
  Smartphone,
  Tag,
  RefreshCcw,
  Trash2,
  Truck,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { api } from "../shared/api/api";
import { API_BASE_URL } from "../shared/constants/app";
import { resolveProductImageUrl } from "../shared/lib/imageUrls";
import { formatCurrency, getCurrency } from "../shared/lib/currency";
import { useProductClassifications } from "../modules/products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../modules/products/lib/productClassifications";
import { isMirrorProduct, mirrorProductTitle } from "../shared/lib/mirrorProduct";
import { applyProductSocialMeta, productToSocialMeta } from "../shared/lib/socialMeta";
import { displayPublicOrderNumber } from "../shared/utils/publicOrderNumber";
import { VirtualGrid, VirtualList } from "../shared/components/VirtualList";
import instaPayLogo from "../assets/payments/instapay.png";
import instaPayLogoWebp from "../assets/payments/instapay.webp";
import vodafoneCashLogo from "../assets/payments/vodafone-cash.png";
import vodafoneCashLogoWebp from "../assets/payments/vodafone-cash.webp";

const OrderInvoiceCard = lazy(() => import("../shared/components/invoices/OrderInvoiceCard"));
const Select = lazy(() => import("react-select"));
const LazyFiltersDrawer = lazy(() => Promise.resolve({ default: MobileFilterDrawer }));
const LazyProductCardVariantSheet = lazy(() => Promise.resolve({ default: ProductCardVariantSheet }));
const LazyProductDetailsVariantSheet = lazy(() => Promise.resolve({ default: ProductDetailsVariantSheet }));

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
const getSuccessMessages = () => {
  const messages = i18n.t("storefront.toasts.successMessages", { returnObjects: true });
  return Array.isArray(messages) && messages.length ? messages : ["Great choice"];
};

const storyVisuals = [
  "from-[#6d28d9] via-[#9f7aea] to-[#f0abfc]",
  "from-stone-950 via-[#4c1d95] to-[#a78bfa]",
  "from-[#7c3aed] via-[#c4b5fd] to-[#f7f4ee]",
  "from-[#111827] via-[#6d28d9] to-[#d8b4fe]",
];
const getConversionTrustPoints = () => {
  const points = i18n.t("storefront.home.trustPoints", { returnObjects: true });
  return Array.isArray(points) && points.length ? points : ["Secure payment", "Real photos", "Fast shipping"];
};
const storefrontApi = {
  getProductDetails(identifier, options = {}) {
    const routeValue = String(identifier || "");
    const endpoint = `/storefront/products/resolve/${encodeURIComponent(routeValue)}`;
    const cacheBust = Date.now();
    const apiUrl = `${API_BASE_URL}${endpoint}${endpoint.includes("?") ? "&" : "?"}_qr_ts=${cacheBust}`;
    if (storefrontDebugEnabled()) console.log("[storefront-product] resolver request", {
      identifier: routeValue,
      routeIdentifier: routeValue,
      endpoint,
      resolverUrl: apiUrl,
      apiUrl,
      apiBaseUrl: API_BASE_URL,
    });
    return api.get(endpoint, {
      ...options,
      params: { ...(options.params || {}), _qr_ts: cacheBust },
      cache: "no-store",
      headers: {
        ...(options.headers || {}),
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
      debugLabel: "storefront-product-details",
    });
  },
};
const productFromDetailsResponse = (data = {}) => data?.product || data?.data?.product || (data?.id ? data : null);
const MANUAL_CITY_AREA = "منطقة أخرى / اكتب يدويًا";
const governorateCityAreas = {
  "القاهرة": ["مدينة نصر", "مصر الجديدة", "المعادي", "التجمع الخامس", "الشروق", "العبور", "شبرا", "حلوان", "وسط البلد", "الزمالك", "المقطم", "المرج", "عين شمس", "السلام", "دار السلام"],
  "الجيزة": ["الدقي", "المهندسين", "العجوزة", "الهرم", "فيصل", "6 أكتوبر", "الشيخ زايد", "حدائق الأهرام", "إمبابة", "الوراق", "البدرشين", "أوسيم", "كرداسة"],
  "الإسكندرية": ["سيدي جابر", "سموحة", "محرم بك", "العجمي", "العصافرة", "ميامي", "ستانلي", "لوران", "جليم", "المنتزه", "برج العرب", "العامرية"],
  "الدقهلية": ["المنصورة", "طلخا", "ميت غمر", "دكرنس", "أجا", "السنبلاوين", "منية النصر", "بلقاس", "شربين", "الجمالية", "المطرية"],
  "الشرقية": ["الزقازيق", "العاشر من رمضان", "بلبيس", "منيا القمح", "أبو حماد", "فاقوس", "ههيا", "كفر صقر", "أبو كبير", "الحسينية", "ديرب نجم"],
  "الغربية": ["طنطا", "المحلة الكبرى", "كفر الزيات", "زفتى", "السنطة", "بسيون", "قطور", "سمنود"],
  "المنوفية": ["شبين الكوم", "مدينة السادات", "منوف", "أشمون", "تلا", "قويسنا", "الباجور", "بركة السبع", "الشهداء"],
  "القليوبية": ["بنها", "شبرا الخيمة", "القناطر الخيرية", "الخانكة", "الخصوص", "قليوب", "طوخ", "كفر شكر", "شبين القناطر", "العبور"],
  "البحيرة": ["دمنهور", "كفر الدوار", "رشيد", "إدكو", "أبو حمص", "المحمودية", "حوش عيسى", "الدلنجات", "إيتاي البارود", "وادي النطرون"],
  "كفر الشيخ": ["كفر الشيخ", "دسوق", "فوه", "مطوبس", "بيلا", "الحامول", "سيدي سالم", "قلين", "بلطيم", "الرياض"],
  "دمياط": ["دمياط", "دمياط الجديدة", "رأس البر", "فارسكور", "الزرقا", "كفر سعد", "كفر البطيخ", "عزبة البرج"],
  "بورسعيد": ["حي الشرق", "حي العرب", "حي المناخ", "حي الضواحي", "حي الزهور", "بورفؤاد", "حي الجنوب", "حي غرب"],
  "الإسماعيلية": ["الإسماعيلية", "فايد", "القنطرة شرق", "القنطرة غرب", "التل الكبير", "أبو صوير", "القصاصين"],
  "السويس": ["حي السويس", "الأربعين", "عتاقة", "فيصل", "الجناين"],
  "شمال سيناء": ["العريش", "الشيخ زويد", "رفح", "بئر العبد", "الحسنة", "نخل"],
  "جنوب سيناء": ["طور سيناء", "شرم الشيخ", "دهب", "نويبع", "طابا", "سانت كاترين", "رأس سدر", "أبو رديس", "أبو زنيمة"],
  "الفيوم": ["الفيوم", "سنورس", "طامية", "إطسا", "أبشواي", "يوسف الصديق"],
  "بني سويف": ["بني سويف", "بني سويف الجديدة", "الواسطى", "ناصر", "إهناسيا", "ببا", "سمسطا", "الفشن"],
  "المنيا": ["المنيا", "المنيا الجديدة", "ملوي", "سمالوط", "مطاي", "بني مزار", "مغاغة", "دير مواس", "أبو قرقاص", "العدوة"],
  "أسيوط": ["أسيوط", "أسيوط الجديدة", "ديروط", "القوصية", "منفلوط", "أبنوب", "أبو تيج", "الغنايم", "ساحل سليم", "البداري", "صدفا"],
  "سوهاج": ["سوهاج", "سوهاج الجديدة", "أخميم", "جرجا", "طهطا", "طما", "المراغة", "البلينا", "المنشاة", "دار السلام", "جهينة"],
  "قنا": ["قنا", "قنا الجديدة", "نجع حمادي", "دشنا", "قفط", "قوص", "نقادة", "فرشوط", "أبو تشت", "الوقف"],
  "الأقصر": ["بندر الأقصر", "الزينية", "البياضية", "القرنة", "أرمنت", "إسنا", "الطود"],
  "أسوان": ["أسوان", "أسوان الجديدة", "دراو", "كوم أمبو", "نصر النوبة", "إدفو", "أبو سمبل"],
  "البحر الأحمر": ["الغردقة", "رأس غارب", "سفاجا", "القصير", "مرسى علم", "الشلاتين", "حلايب"],
  "الوادي الجديد": ["الخارجة", "الداخلة", "الفرافرة", "باريس", "بلاط"],
  "مطروح": ["مرسى مطروح", "الحمام", "العلمين", "الضبعة", "النجيلة", "سيدي براني", "السلوم", "سيوة"],
};
const governorates = Object.keys(governorateCityAreas);
const getPaymentMethods = () => [
  {
    id: "cod",
    title: sfText("storefront.checkout.payment.cod.title", "Cash on delivery"),
    text: sfText("storefront.checkout.payment.cod.text", "Pay the full order amount when you receive it."),
  },
  {
    id: "shipping_confirmation",
    title: sfText("storefront.checkout.payment.shippingConfirmation.title", "Shipping confirmation"),
    text: sfText("storefront.checkout.payment.shippingConfirmation.text", "Pay the shipping fee now to confirm the order, and the rest on delivery."),
  },
];
const SHIPPING_CONFIRMATION_METHODS = new Set(["shipping_confirmation", "instapay", "vodafone_cash"]);
const INSTA_PAY_HANDLE = import.meta.env.VITE_INSTAPAY_HANDLE || "01000000000@instapay";
const VODAFONE_CASH_NUMBER = import.meta.env.VITE_VODAFONE_CASH_NUMBER || "01000000000";
const INSTA_PAY_QR_URL = import.meta.env.VITE_INSTAPAY_QR_URL || "";
const VODAFONE_CASH_QR_URL = import.meta.env.VITE_VODAFONE_CASH_QR_URL || "";
const storefrontDebugEnabled = () => ["1", "true", "yes", "on"].includes(String(import.meta.env?.VITE_ERP_PERF_DEBUG || import.meta.env?.VITE_STOREFRONT_DEBUG || "").toLowerCase());
const paymentBrandLogos = {
  instapay: { webp: instaPayLogoWebp, png: instaPayLogo },
  vodafone_cash: { webp: vodafoneCashLogoWebp, png: vodafoneCashLogo },
};
const paymentBrandLabels = {
  instapay: "InstaPay",
  vodafone_cash: "Vodafone Cash",
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
const paymentLogoPreloadUrls = Object.values(paymentBrandLogos).flatMap((logo) => [logo.webp, logo.png].filter(Boolean));
const whatsappPhone = String(import.meta.env.VITE_WHATSAPP_PHONE || import.meta.env.VITE_STORE_WHATSAPP || "").replace(/\D/g, "");
const getStatusLabels = () => {
  const labels = i18n.t("storefront.orders.timelineLabels", { returnObjects: true });
  return Array.isArray(labels) && labels.length ? labels : ["Order received", "Preparing", "Shipped", "On the way", "Delivered"];
};
const SEARCH_RECENT_KEY = "storefront.search.recent";
const getSearchPlaceholders = () => {
  const values = i18n.t("storefront.search.placeholders", { returnObjects: true });
  return Array.isArray(values) && values.length ? values : ["Search Jordan 4...", "Search sneakers...", "Search size 42...", "Search by brand...", "Search by SKU..."];
};
const getTrendingSearches = () => {
  const values = i18n.t("storefront.search.trending", { returnObjects: true });
  return Array.isArray(values) && values.length ? values : ["Jordan 4", "Sneakers", "Size 42", "Mirror Original", "Adidas", "Black mens"];
};
const getSearchFallbackSections = () => {
  const sections = i18n.t("storefront.search.fallbackSections", { returnObjects: true });
  return sections && typeof sections === "object" && !Array.isArray(sections)
    ? sections
    : {
        categories: ["Men", "Women", "Kids", "Sale", "Last piece"],
        brands: ["Nike", "Adidas", "New Balance", "Air Jordan"],
        styles: ["Sneakers", "Running", "Lifestyle", "Mirror Original"],
      };
};
const AI_SUPPORT_SESSION_KEY = "storefront.ai_support.session_id";
const AI_SUPPORT_TENANT_KEY = "storefront.tenant_id";
const AI_SUPPORT_LAST_CLICK_KEY = "storefront.ai_support.last_clicked_product";
const AI_SUPPORT_HINT_DISMISSED_KEY = "storefront.ai_support.hint_dismissed";

const STORAGE_ARRAY_LIMITS = {
  [CART_KEY]: 50,
  [WISHLIST_KEY]: 200,
  [RECENT_KEY]: 20,
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

const displayOrderNumber = displayPublicOrderNumber;

function OrderNumberBadge({ value, prefix = "Order", className = "" }) {
  const number = displayOrderNumber(value);
  if (!number) return null;
  return (
    <span dir="ltr" className={`inline-flex w-fit items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${className}`}>
      {prefix ? `${prefix} ${number}` : number}
    </span>
  );
}

const CONFETTI_PARTICLES = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  right: `${(index * 37 + 11) % 100}%`,
  animationDelay: `${index * 30}ms`,
}));

const safeRemoveStorageKey = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage access errors.
  }
};

const removeStorageKeyEverywhere = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage access errors.
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore storage access errors.
  }
};

const compactImageValue = (value = "") => {
  const text = String(value || "");
  if (!text || text.startsWith("data:") || text.length > 500) return "";
  return text;
};

const sanitizeCart = (items, limit = STORAGE_ARRAY_LIMITS[CART_KEY]) => {
  const byLine = new Map();
  (Array.isArray(items) ? items : []).forEach((item = {}) => {
    const productId = item.product_id || item.productId || item.product?.id || item.id || "";
    const variantId = item.variant_id || item.variantId || item.variant?.id || "";
    const lineId = item.lineId || `${productId}:${variantId}`;
    const quantity = Number(item.quantity ?? item.qty ?? 1);
    if (!productId || !variantId || !lineId || !Number.isFinite(quantity) || quantity <= 0) return;
    const stock = Number(item.stock || 0);
    const next = {
      lineId,
      product_id: productId,
      variant_id: variantId,
      name: String(item.name || "").slice(0, 120),
      image_url: compactImageValue(item.image_url || item.image),
      size: String(item.size || "").slice(0, 40),
      color: String(item.color || "").slice(0, 60),
      price: Number(item.price || 0),
      selling_price: Number(item.selling_price || item.price || 0),
      regular_price: Number(item.regular_price || item.original_price || item.base_price || item.list_price || item.compare_base_price || 0),
      original_price: Number(item.original_price || item.base_price || item.list_price || item.compare_base_price || item.compare_at_price || item.regular_price || 0),
      base_price: Number(item.base_price || item.original_price || item.compare_base_price || item.regular_price || 0),
      list_price: Number(item.list_price || item.original_price || item.compare_base_price || item.regular_price || 0),
      compare_base_price: Number(item.compare_base_price || item.original_price || item.base_price || item.list_price || item.regular_price || 0),
      compare_at_price: Number(item.compare_at_price || item.original_price || item.base_price || item.list_price || item.compare_base_price || item.regular_price || 0),
      sale_price: Number(item.sale_price || 0),
      sale_prices_enabled: truthyFlag(item.sale_prices_enabled || item.global_sale_enabled || item.sale_mode_enabled),
      global_sale_enabled: truthyFlag(item.global_sale_enabled || item.sale_prices_enabled || item.sale_mode_enabled),
      sale_mode_enabled: truthyFlag(item.sale_mode_enabled || item.global_sale_enabled || item.sale_prices_enabled),
      stock,
      quantity: Math.max(1, stock > 0 ? Math.min(stock, quantity) : quantity),
    };
    const current = byLine.get(lineId);
    if (!current) {
      byLine.set(lineId, next);
      return;
    }
    byLine.set(lineId, {
      ...current,
      ...next,
      quantity: Math.max(1, Number(current.quantity || 0) + Number(next.quantity || 0)),
    });
  });
  return Array.from(byLine.values()).slice(-limit);
};

const readStorageJson = (storage, key) => {
  try {
    const raw = storage?.getItem?.(key);
    return raw === null || raw === undefined ? { exists: false, value: null } : { exists: true, value: JSON.parse(raw) };
  } catch {
    removeStorageKeyEverywhere(key);
    return { exists: false, value: null };
  }
};

const saveCartToStorage = (nextCart = []) => {
  const sanitized = sanitizeCart(nextCart);
  LEGACY_CART_KEYS.forEach(removeStorageKeyEverywhere);
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(sanitized));
    sessionStorage.removeItem(CART_KEY);
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[cart-save]", { count: sanitized.length, error });
    return sanitized;
  }
  if (import.meta.env.DEV) console.debug("[cart-save]", { count: sanitized.length });
  return sanitized;
};

const clearCartStorage = () => {
  try {
    localStorage.setItem(CART_KEY, "[]");
  } catch {
    // Ignore storage access errors.
  }
  [CART_KEY, ...LEGACY_CART_KEYS].forEach((key) => {
    if (key !== CART_KEY) removeStorageKeyEverywhere(key);
  });
  try {
    sessionStorage.removeItem(CART_KEY);
  } catch {
    // Ignore storage access errors.
  }
  if (import.meta.env.DEV) console.debug("[cart-clear]", { count: 0 });
};

const loadCartFromStorage = () => {
  const canonical = readStorageJson(localStorage, CART_KEY);
  let source = CART_KEY;
  let loaded = canonical.exists ? canonical.value : [];
  if (!canonical.exists) {
    for (const key of LEGACY_CART_KEYS) {
      const local = readStorageJson(localStorage, key);
      const session = local.exists ? local : readStorageJson(sessionStorage, key);
      const candidate = sanitizeCart(session.value || []);
      if (candidate.length > 0) {
        source = key;
        loaded = candidate;
        break;
      }
    }
  }
  const sanitized = saveCartToStorage(sanitizeCart(loaded));
  if (import.meta.env.DEV) console.debug("[cart-load]", { source, count: sanitized.length });
  return sanitized;
};

const mergeStorefrontCartItems = (baseItems = [], nextItems = []) => {
  const byLine = new Map();
  sanitizeCart([...(Array.isArray(baseItems) ? baseItems : []), ...(Array.isArray(nextItems) ? nextItems : [])]).forEach((item) => {
    const current = byLine.get(item.lineId);
    if (!current) {
      byLine.set(item.lineId, item);
      return;
    }
    byLine.set(item.lineId, {
      ...current,
      ...item,
      quantity: Math.min(Number(item.stock || current.stock || 99), Number(current.quantity || 1) + Number(item.quantity || 1)),
    });
  });
  return Array.from(byLine.values());
};

const sanitizeWishlist = (items, limit = STORAGE_ARRAY_LIMITS[WISHLIST_KEY]) => {
  const byId = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const source = item && typeof item === "object" ? item : { id: item };
    const product = normalizeWishlistProduct(source);
    if (!product.id) return;
    byId.set(String(product.id), {
      id: product.id,
      product_id: product.id,
      productId: product.id,
      name: product.name || "",
      title: product.title || product.name || "",
      slug: product.slug || product.id,
      image_url: compactImageValue(product.image_url || product.image),
      image: compactImageValue(product.image || product.image_url),
      price: Number(product.price || 0),
      selling_price: Number(product.selling_price || product.price || 0),
      regular_price: Number(product.regular_price || product.original_price || 0),
      original_price: Number(product.original_price || product.regular_price || 0),
      base_price: Number(product.base_price || product.original_price || product.regular_price || 0),
      list_price: Number(product.list_price || product.original_price || product.regular_price || 0),
      sale_price: Number(product.sale_price || 0),
      compare_at_price: Number(product.compare_at_price || 0),
      sale_prices_enabled: Boolean(product.sale_prices_enabled || product.global_sale_enabled || product.sale_mode_enabled),
      global_sale_enabled: Boolean(product.global_sale_enabled || product.sale_prices_enabled || product.sale_mode_enabled),
      sale_mode_enabled: Boolean(product.sale_mode_enabled || product.global_sale_enabled || product.sale_prices_enabled),
      stock: Number(product.stock || product.total_stock || 0),
      total_stock: Number(product.total_stock || product.stock || 0),
      variant: product.variant && typeof product.variant === "object" ? product.variant : undefined,
      product: source.product && typeof source.product === "object" ? source.product : undefined,
      unavailable: Boolean(product.unavailable),
    });
  });
  return Array.from(byId.values()).slice(-limit);
};

const sanitizeRecent = (items, limit = STORAGE_ARRAY_LIMITS[RECENT_KEY]) => {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item = {}) => ({
      id: item.id || item.product_id || "",
      name: String(item.name || "").slice(0, 120),
      image_url: compactImageValue(item.image_url || item.image),
      price: Number(item.price || item.sale_price || 0),
      selling_price: Number(item.selling_price || item.price || 0),
      regular_price: Number(item.regular_price || item.original_price || item.base_price || item.list_price || 0),
      original_price: Number(item.original_price || item.base_price || item.list_price || item.compare_at_price || item.regular_price || 0),
      base_price: Number(item.base_price || item.original_price || item.regular_price || 0),
      list_price: Number(item.list_price || item.original_price || item.regular_price || 0),
      sale_price: Number(item.sale_price || 0),
      compare_at_price: Number(item.compare_at_price || item.original_price || item.base_price || item.list_price || item.regular_price || 0),
      sale_prices_enabled: Boolean(item.sale_prices_enabled || item.global_sale_enabled || item.sale_mode_enabled),
      global_sale_enabled: Boolean(item.global_sale_enabled || item.sale_prices_enabled || item.sale_mode_enabled),
      sale_mode_enabled: Boolean(item.sale_mode_enabled || item.global_sale_enabled || item.sale_prices_enabled),
      slug: String(item.slug || "").slice(0, 180),
      viewed_at: item.viewed_at || new Date().toISOString(),
    }))
    .filter((item) => {
      if (!item.id || seen.has(String(item.id))) return false;
      seen.add(String(item.id));
      return true;
    })
    .slice(0, limit);
};

const sanitizeProfile = (profile = {}) => ({
  full_name: String(profile.full_name || "").slice(0, 120),
  email: String(profile.email || profile.customer_email || "").slice(0, 180),
  primary_phone: String(profile.primary_phone || profile.phone || "").slice(0, 40),
  phone: String(profile.phone || profile.primary_phone || "").slice(0, 40),
  governorate: String(profile.governorate || "").slice(0, 120),
  city_area: String(profile.city_area || "").slice(0, 160),
  detailed_address: String(profile.detailed_address || "").slice(0, 500),
  landmark: String(profile.landmark || "").slice(0, 180),
});

const readThemeMode = () => {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" || value === "auto" ? value : "auto";
  } catch {
    return "auto";
  }
};

const getSystemTheme = () => (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

const sanitizeStorageValue = (key, value, compact = false) => {
  const limit = compact ? Math.max(5, Math.floor((STORAGE_ARRAY_LIMITS[key] || 20) / 2)) : STORAGE_ARRAY_LIMITS[key];
  if (key === CART_KEY) return sanitizeCart(value, limit);
  if (key === WISHLIST_KEY) return sanitizeWishlist(value, limit);
  if (key === RECENT_KEY) return sanitizeRecent(value, limit);
  if (key === PROFILE_KEY) return sanitizeProfile(value || {});
  return value;
};

const cleanupStorefrontStorage = ({ aggressive = false } = {}) => {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean);
    keys.forEach((key) => {
      if (STOREFRONT_CACHE_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`) || key.startsWith(`${prefix}:`))) {
        safeRemoveStorageKey(key);
      }
    });
    const sessionKeys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index)).filter(Boolean);
    sessionKeys.forEach((key) => {
      if (STOREFRONT_CACHE_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}.`) || key.startsWith(`${prefix}:`))) {
        removeStorageKeyEverywhere(key);
      }
    });
    localStorage.setItem(RECENT_KEY, JSON.stringify(sanitizeRecent(readJson(RECENT_KEY, []), aggressive ? 8 : 20)));
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(sanitizeWishlist(readJson(WISHLIST_KEY, []), aggressive ? 80 : 200)));
    saveCartToStorage(sanitizeCart(readJson(CART_KEY, []), aggressive ? 20 : 50));
  } catch (error) {
    if (aggressive || isQuotaError(error)) {
      safeRemoveStorageKey(RECENT_KEY);
      safeRemoveStorageKey(WISHLIST_KEY);
    }
  }
};

const readJson = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? sanitizeStorageValue(key, JSON.parse(value)) : fallback;
  } catch {
    safeRemoveStorageKey(key);
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(sanitizeStorageValue(key, value)));
    return true;
  } catch (error) {
    if (!isQuotaError(error)) {
      console.warn("[storefront-storage] write skipped", { key, error });
      return false;
    }
    console.warn("[storefront-storage] quota exceeded, cleaning up", { key });
    cleanupStorefrontStorage({ aggressive: true });
    try {
      localStorage.setItem(key, JSON.stringify(sanitizeStorageValue(key, value, true)));
      return true;
    } catch (retryError) {
      console.warn("[storefront-storage] retry skipped", { key, error: retryError });
      return false;
    }
  }
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
const money = (value) => formatCurrency(Number(value || 0));
const sfText = (key, fallback, options = {}) => i18n.t(String(key || ""), { defaultValue: fallback, ...options });
const truthyFlag = (value) => value === true || value === 1 || String(value || "").toLowerCase() === "true";
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
const displayComparePrice = (product = {}, variant = {}) => {
  const activePrice = displaySellingPrice(product, variant);
  const comparePrice = storefrontOriginalPrice(product, variant);
  return comparePrice > activePrice ? comparePrice : 0;
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
    num(product?.list_price) ||
    num(product?.regular_price) ||
    num(product?.compare_at_price);
  const variantOriginal =
    num(variant?.custom_compare_price) ||
    num(variant?.compare_base_price) ||
    num(variant?.original_price) ||
    num(variant?.base_price) ||
    num(variant?.list_price) ||
    num(variant?.regular_price) ||
    num(variant?.compare_at_price);
  const saleModeOn = storefrontSaleModeOn(product, variant);
  const salePrice = num(variant?.sale_price ?? product?.sale_price);
  const activePrice = saleModeOn && salePrice > 0
    ? salePrice
    : num(variant?.selling_price ?? variant?.price ?? product?.selling_price ?? product?.price ?? product?.regular_price);
  const originalPrice = productOriginal || variantOriginal;
  const comparePrice = originalPrice && originalPrice > activePrice ? originalPrice : 0;
  return { originalPrice, activePrice, comparePrice, saleModeOn };
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
const displayDiscountPercent = (product = {}, variant = {}) => {
  const sellingPrice = displaySellingPrice(product, variant);
  const comparePrice = displayComparePrice(product, variant);
  return comparePrice > sellingPrice ? Math.max(1, Math.round(((comparePrice - sellingPrice) / comparePrice) * 100)) : 0;
};
const cleanDisplayText = (value = "") =>
  String(value || "")
    .replace(/\uFFFD/g, "")
    .replace(/\u00e2\u0153\u00a8/g, "")
    .replace(/\u00e2\u20ac\u00a6/g, "...")
    .replace(/\u0637\u0152/g, "،")
    .replace(/\s+/g, " ")
    .trim();
const productBaseUrl = (product = {}) => `/shop/product/${product.slug || product.id}`;
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
  return appendProductUrlParams(productBaseUrl(product), [
    ["variant", variantId],
    ["color", color],
  ]);
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
  const add = (product, index, respectExclude = true) => {
    const key = productIdentityKey(product, index);
    if (!key || pickedKeys.has(key)) return;
    if (respectExclude && exclude.has(key)) return;
    picked.push(product);
    pickedKeys.add(key);
  };
  [...preferred, ...fallback].forEach((product, index) => add(product, index, true));
  if (picked.length < Math.min(limit, preferred.length || fallback.length)) {
    [...preferred, ...fallback].forEach((product, index) => add(product, index, false));
  }
  return picked.slice(0, limit);
};
const STOREFRONT_COLOR_WORDS = new Set([
  "black", "white", "red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "beige", "grey", "gray", "silver", "gold", "navy", "burgundy", "maroon", "olive", "cream", "ivory", "tan", "camel", "mocha", "coffee", "charcoal", "volt", "cobalt", "aqua", "mint", "rose", " سلفر", "اسود", "أسود", "ابيض", "أبيض", "احمر", "أحمر", "ازرق", "أزرق", "اخضر", "أخضر", "اصفر", "أصفر", "برتقالي", "بنفسجي", "وردي", "بني", "بيج", "رمادي", "فضي", "ذهبي", "كحلي", "نبيتي", "زيتي", "كريمي", "اوف", "أوف", "جملي", "كافيه"
]);
const normalizeModelToken = (value = "") =>
  cleanDisplayText(value)
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const productVariantColorWords = (product = {}) => {
  const words = new Set(STOREFRONT_COLOR_WORDS);
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
    .replace(/\b(size|مقاس)\s*\d+(\.\d+)?\b/gi, "")
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
const generateAiSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};
const getAiSupportSessionId = () => {
  if (typeof window === "undefined") return generateAiSessionId();
  try {
    const current = localStorage.getItem(AI_SUPPORT_SESSION_KEY);
    if (current) return current;
    const next = generateAiSessionId();
    localStorage.setItem(AI_SUPPORT_SESSION_KEY, next);
    return next;
  } catch {
    return generateAiSessionId();
  }
};
const rememberAiSuggestedProductClick = ({ tenantId, sessionId, productId }) => {
  if (typeof window === "undefined" || !tenantId || !sessionId || !productId) return;
  try {
    localStorage.setItem(AI_SUPPORT_LAST_CLICK_KEY, JSON.stringify({
      tenant_id: tenantId,
      session_id: sessionId,
      product_id: productId,
      clicked_at: Date.now(),
    }));
  } catch {
    // Ignore storage access errors.
  }
};
const readRecentAiSuggestedProductClick = (productId) => {
  if (typeof window === "undefined" || !productId) return null;
  try {
    const payload = JSON.parse(localStorage.getItem(AI_SUPPORT_LAST_CLICK_KEY) || "null");
    if (!payload || String(payload.product_id) !== String(productId)) return null;
    if (Date.now() - Number(payload.clicked_at || 0) > 24 * 60 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
};
const storefrontCustomerToken = () => {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(CUSTOMER_SESSION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
};
const setStorefrontCustomerToken = (token = "") => {
  if (typeof window === "undefined" || !token) return;
  try {
    localStorage.setItem(CUSTOMER_SESSION_TOKEN_KEY, token);
  } catch {
    // Ignore storage access errors.
  }
};
const customerSessionHeaders = () => {
  const token = storefrontCustomerToken();
  return token ? { "x-storefront-customer-token": token } : {};
};
const normalizeStorefrontPhone = (value = "") => {
  const digits = String(value || "")
    .replace(/[٠-٩۰-۹]/g, (digit) => ({
      "٠": "0",
      "١": "1",
      "٢": "2",
      "٣": "3",
      "٤": "4",
      "٥": "5",
      "٦": "6",
      "٧": "7",
      "٨": "8",
      "٩": "9",
      "۰": "0",
      "۱": "1",
      "۲": "2",
      "۳": "3",
      "۴": "4",
      "۵": "5",
      "۶": "6",
      "۷": "7",
      "۸": "8",
      "۹": "9",
    }[digit] || digit))
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "");
  if (digits.startsWith("20") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith("1") && digits.length === 10) return `0${digits}`;
  return digits;
};
const isValidStorefrontPhone = (value = "") => /^01[0125]\d{8}$/.test(normalizeStorefrontPhone(value));
const captureSkipActive = () => {
  if (typeof window === "undefined") return false;
  try {
    return Date.now() < Number(localStorage.getItem(CUSTOMER_CAPTURE_SKIP_KEY) || 0);
  } catch {
    return false;
  }
};
const markCaptureSkipped = () => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CUSTOMER_CAPTURE_SKIP_KEY, String(Date.now() + CUSTOMER_CAPTURE_COOLDOWN_MS));
  } catch {
    // Ignore storage access errors.
  }
};
const trackStorefrontCaptureEvent = (eventType, metadata = {}) => {
  if (typeof window === "undefined") return;
  try {
    const key = "storefront.customer_capture_events";
    const current = JSON.parse(localStorage.getItem(key) || "[]");
    localStorage.setItem(key, JSON.stringify([{ event_type: eventType, at: Date.now(), metadata }, ...current].slice(0, 40)));
  } catch {
    // Ignore analytics storage errors.
  }
};
const trackAiSupportClick = ({ tenantId, sessionId, productId }) => {
  if (!tenantId || !sessionId || !productId) return;
  rememberAiSuggestedProductClick({ tenantId, sessionId, productId });
  api.post(
    "/ai-support/click",
    { tenant_id: tenantId, session_id: sessionId, product_id: productId, clicked_product_id: productId },
    { headers: { "x-tenant-id": tenantId }, suppressErrorStatuses: [400, 404, 500] }
  ).catch(() => undefined);
};
const trackAiSupportCartOutcome = ({ tenantId, sessionId, productId }) => {
  if (!tenantId || !sessionId) return;
  api.post(
    "/ai-support/cart-outcome",
    { tenant_id: tenantId, session_id: sessionId, product_id: productId, added_to_cart_after_chat: true },
    { headers: { "x-tenant-id": tenantId }, suppressErrorStatuses: [400, 404, 500] }
  ).catch(() => undefined);
};
const isAiGreetingOnlyResponse = (response = {}) =>
  response?.detected_intent === "greeting_only" || response?.greeting_only_mode === true;
const EXACT_VARIANT_RENDERED_ANSWER = "أيوه، الموديل ده متاح عندنا، ونفس اللون/النسخة المطابقة للصورة ظاهر في النتيجة.";
const REQUESTED_VARIANT_UNAVAILABLE_ANSWER = "الموديل موجود عندنا، لكن المقاس أو اللون المطلوب مش متاح في نفس الفاريانت حاليا. النتيجة المعروضة هي نفس الموديل مع حالة التوفر الحالية.";
const responseExactVariantProduct = (response = {}) => {
  if (!response?.exact_match_found) return null;
  const products = Array.isArray(response?.suggested_products) ? response.suggested_products : [];
  const exactVariantId = response?.exact_match_variant_id ?? response?.response_debug?.exact_match_variant_id ?? response?.image_ranking_debug?.exact_match_variant_id ?? null;
  return products.find((product) => {
    const variantId = product?.matched_variant_id ?? null;
    const variantImage = compactImageValue(product?.matched_variant_image || product?.matched_image_url || "");
    return variantId && variantImage && (!exactVariantId || String(variantId) === String(exactVariantId));
  }) || null;
};
const resolveRenderedAiImageAnswer = (response = {}) => {
  const exactVariantProduct = responseExactVariantProduct(response);
  if (!exactVariantProduct) return response?.answer || "حصلت مشكلة أثناء تحليل الصورة، حاول مرة تانية.";
  const unavailable =
    exactVariantProduct.exact_variant_available === false ||
    exactVariantProduct.requested_size_available === false ||
    Number(exactVariantProduct.requested_size_stock ?? 1) === 0 ||
    Number(exactVariantProduct.total_stock ?? exactVariantProduct.stock ?? 1) <= 0;
  return unavailable ? REQUESTED_VARIANT_UNAVAILABLE_ANSWER : EXACT_VARIANT_RENDERED_ANSWER;
};
const logImageSearchSuggestedProductRanking = (response = {}) => {
  const products = Array.isArray(response?.suggested_products) ? response.suggested_products : [];
  const rankingDebug = response?.image_ranking_debug || {};
  const responseDebug = response?.response_debug || {};
  console.debug("[storefront-ai] image-search ranking ids", {
    final_sorted_product_ids: response?.final_sorted_product_ids || responseDebug.final_sorted_product_ids || rankingDebug.final_sorted_product_ids || [],
    forced_rank_target_product_id: response?.forced_rank_target_product_id ?? responseDebug.forced_rank_target_product_id ?? rankingDebug.forced_rank_target_product_id ?? null,
    exact_match_product_id: response?.exact_match_product_id ?? responseDebug.exact_match_product_id ?? rankingDebug.exact_match_product_id ?? null,
  });
  console.table(
    products.map((product, index) => ({
      index,
      id: product?.id ?? null,
      name: product?.name || "",
      matched_variant_id: product?.matched_variant_id ?? null,
      matched_variant_image: product?.matched_variant_image || "",
      selected_card_image_url: product?.selected_card_image_url || "",
      image_url: product?.image_url || "",
      forced_exact_variant_rank: Boolean(product?.forced_exact_variant_rank),
      best_candidate_score: product?.best_candidate_score ?? product?.image_match_score ?? product?.visual_score ?? product?.final_score ?? null,
      top_rank_reason: product?.top_rank_reason || "",
    }))
  );
};
const countAiProductUiCards = (messages = []) =>
  (Array.isArray(messages) ? messages : []).reduce((count, message) => {
    if (message?.role !== "assistant") return count;
    const products = Array.isArray(message.suggested_products) ? message.suggested_products.length : 0;
    const attachments = Array.isArray(message.visual_attachments)
      ? message.visual_attachments.reduce((sum, attachment) => sum + (Array.isArray(attachment.items) ? attachment.items.length : attachment.sizes?.length ? 1 : 0), 0)
      : 0;
    const visualSections = message.detected_style_model || message.image_ranking_debug || message.response_debug || message.exact_match_found ? 1 : 0;
    return count + products + attachments + visualSections;
  }, 0);
const clearAiProductUiState = (messages = []) =>
  (Array.isArray(messages) ? messages : []).map((message) => {
    if (message?.role !== "assistant") return message;
    return {
      ...message,
      suggested_products: [],
      visual_attachments: [],
      detected_style_model: "",
      image_ranking_debug: null,
      response_debug: null,
      exact_match_found: false,
      exact_match_reason: "",
    };
  });
const resolveStorefrontTenantId = () => {
  const fallback = import.meta.env.VITE_STOREFRONT_TENANT_ID || import.meta.env.VITE_TENANT_ID || "1";
  if (typeof window === "undefined") return fallback;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("tenant_id") || params.get("tenantId");
    const fromStorage = localStorage.getItem(AI_SUPPORT_TENANT_KEY) || localStorage.getItem("tenant_id") || localStorage.getItem("tenantId");
    const resolved = fromUrl || fromStorage || fallback;
    if (resolved) localStorage.setItem(AI_SUPPORT_TENANT_KEY, resolved);
    return resolved;
  } catch {
    return fallback;
  }
};
const aiSuggestedProductUrl = (product = {}) => product?.product_url || (product?.id || product?.slug ? productUrl(product) : "/shop/products");
const aiSuggestedProductImage = (product = {}) => {
  const galleryImage = Array.isArray(product?.product_images)
    ? product.product_images.map((image) => image?.image_url || image?.url || image?.path || image).find(Boolean)
    : "";
  const raw = product?.matched_variant_image || product?.matched_image_url || product?.selected_card_image_url || product?.image_url || product?.image || product?.main_image || product?.thumbnail || galleryImage;
  const resolved = imageFor(raw);
  if (isAiSupportDebugEnabled()) {
    console.debug("[storefront-ai] suggested product image src", {
      id: product?.id,
      name: product?.name,
      matched_variant_id: product?.matched_variant_id,
      matched_variant_image: product?.matched_variant_image,
      selected_card_image_source: product?.selected_card_image_source,
      raw,
      resolved,
      page_host: typeof window !== "undefined" ? window.location.host : "",
    });
  }
  return resolved;
};
const fallbackProductImage = (event) => {
  if (event.currentTarget.dataset.fallbackApplied === "true") return;
  event.currentTarget.dataset.fallbackApplied = "true";
  if (isAiSupportDebugEnabled()) {
    console.warn("[storefront-ai] suggested product image failed", {
      src: event.currentTarget.currentSrc || event.currentTarget.src,
      alt: event.currentTarget.alt,
    });
  }
  event.currentTarget.src = "/favicon.svg";
};
const aiAvailabilityText = (product = {}) => {
  if (product.stock_status === "in_stock") return "متاح";
  if (product.stock_status === "out_of_stock") return "غير متاح حاليا";
  const availability = String(product.availability || "").trim().toLowerCase();
  if (availability === "available" || availability === "in_stock") return "متاح";
  if (availability === "out_of_stock" || availability === "unavailable") return "غير متاح حاليا";
  if (product.availability) return product.availability;
  if (Number(product.total_stock || product.stock || 0) > 0) return "متاح";
  return "غير متاح حاليا";
};
const aiSuggestedProductPriceText = (product = {}) => {
  const price = displaySellingPrice(product);
  return price > 0 ? money(price) : "السعر غير محدد";
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
const stockScore = (product = {}) => Number(product.total_stock || 0);
const hasSale = (product = {}) => displayComparePrice(product) > 0;
const newestScore = (product = {}) => new Date(product.created_at || 0).getTime() || Number(product.id || 0);
const lastPieceProductUrl = (product, variant = {}) => {
  return appendProductUrlParams(productBaseUrl(product), [
    ["variant", variant.edition_slug || variant.id || ""],
    ["size", variant.size || ""],
    ["color", variant.color || ""],
  ]);
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
  )[0] || firstDisplayVariant(variants);
};
const lowStockText = (stock) => {
  const remaining = Number(stock || 0);
  if (remaining <= 1) return "آخر قطعة في المنتج";
  if (remaining === 2) return "آخر قطعتين في المنتج";
  return "آخر 3 قطع في المنتج";
};
const lowStockLabel = (stock) => {
  const remaining = Number(stock || 0);
  if (remaining <= 1) return "Last Piece";
  if (remaining === 2) return "Almost Gone";
  return "Low Stock";
};
const lowStockUrgencyClass = (stock) => {
  const remaining = Number(stock || 0);
  if (remaining <= 1) return "border-rose-300/30 bg-rose-500/14 shadow-[0_0_42px_rgba(244,63,94,0.22)]";
  if (remaining === 2) return "border-amber-300/28 bg-amber-400/12 shadow-[0_0_34px_rgba(245,158,11,0.16)]";
  return "border-[#f8e7b3]/20 bg-white/[0.08] shadow-[0_20px_52px_rgba(248,231,179,0.10)]";
};
const lowStockPillClass = (stock) => {
  const remaining = Number(stock || 0);
  if (remaining <= 1) return "bg-rose-500 text-white";
  if (remaining === 2) return "bg-amber-300 text-stone-950";
  return "bg-[#f8e7b3] text-stone-950";
};
const variantSummaryText = (variant = {}) => [variant.color, variant.size].filter(Boolean).join(" / ");
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
  const displayedKey = displayedVariant ? variantColorKey(displayedVariant) : "";
  return groups.find((group) => String(group.key || "") === String(displayedKey)) || groups[0] || null;
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
const isArabicLanguage = (lang = "ar") => String(lang || "").toLowerCase().startsWith("ar");
const classificationLabel = (option = {}, lang = "ar") =>
  isArabicLanguage(lang)
    ? option.label_ar || option.name_ar || option.label || option.name || option.label_en || option.name_en || option.value || ""
    : option.label_en || option.name_en || option.english_name || option.label || option.name || option.label_ar || option.name_ar || option.value || "";
const classificationColor = (option = {}) => option.color || "#6d28d9";
const classificationIcon = (option = {}, lang = "ar") => option.icon || String(classificationLabel(option, lang)).slice(0, 2);
const classificationUrl = (field, value) => {
  const query = new URLSearchParams();
  query.set(field, value);
  return `/shop/products?${query.toString()}`;
};
const uniqueClassificationOptions = (options = []) => {
  const seen = new Set();
  return (Array.isArray(options) ? options : []).filter((option) => {
    const key = String(option.value || option.id || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const normalizeAudienceValue = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["men", "man", "male", "mens", "رجال", "رجالي"].includes(normalized)) return "men";
  if (["women", "woman", "female", "ladies", "lady", "نساء", "نسائي", "حريمي"].includes(normalized)) return "women";
  if (["kids", "kid", "children", "child", "boys", "girls", "اطفال", "أطفال", "طفل"].includes(normalized)) return "kids";
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
      .map(normalizeAudienceValue)
      .filter(Boolean)
      .forEach((audience) => seen.add(audience));
  };
  visit(product.audiences);
  visit(product.product_audiences);
  if (!seen.size) visit(product.gender);
  return ["men", "women", "kids"].filter((audience) => seen.has(audience));
};
const productMatchesAudience = (product = {}, value = "") => {
  const audience = normalizeAudienceValue(value);
  if (!audience) return true;
  return productAudienceValues(product).includes(audience);
};
const productClassificationValue = (product = {}, field) => {
  if (field === "gender") return productAudienceValues(product)[0] || product.gender || "";
  if (field === "product_type") return product.product_type || product.productType || product.category;
  return product[field] || "";
};
const pickClassificationPreviewProduct = (products = [], field, value) => {
  if (!products.length) return null;
  const target = String(value || "").trim().toLowerCase();
  if (!target) return null;
  return (
    products.find((product) => {
      if (field === "gender") return productMatchesAudience(product, value) && isAvailableProduct(product);
      const current = String(productClassificationValue(product, field) || "").trim().toLowerCase();
      return current === target && isAvailableProduct(product);
    }) || null
  );
};
const normalizeColorHint = (value = "") => String(value || "").trim().toLowerCase();
const heroThemeForProduct = (product = {}, variant = {}) => {
  const hint = normalizeColorHint(
    [
      variant?.color,
      product?.color,
      product?.primary_color,
      product?.product_type,
      product?.productType,
      product?.category,
      product?.name,
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (/(beige|brown|tan|camel|coffee|mocha|espresso|بني|بيج|جملي|كافيه|هافان)/.test(hint)) {
    return {
      gradient: "linear-gradient(135deg, #1c1917 0%, #3f2d21 42%, #9a6a43 100%)",
      glow: "rgba(217, 185, 145, 0.34)",
      accent: "#d9b991",
    };
  }
  if (/(white|silver|grey|gray|ice|ابيض|أبيض|فضي|رمادي|سلفر)/.test(hint)) {
    return {
      gradient: "linear-gradient(135deg, #0f172a 0%, #334155 48%, #e2e8f0 100%)",
      glow: "rgba(226, 232, 240, 0.34)",
      accent: "#e2e8f0",
    };
  }
  if (/(red|rose|pink|burgundy|احمر|أحمر|وردي|نبيتي)/.test(hint)) {
    return {
      gradient: "linear-gradient(135deg, #111827 0%, #7f1d1d 48%, #fb7185 100%)",
      glow: "rgba(251, 113, 133, 0.32)",
      accent: "#fb7185",
    };
  }
  if (/(blue|navy|sky|ازرق|أزرق|كحلي|سماوي)/.test(hint)) {
    return {
      gradient: "linear-gradient(135deg, #020617 0%, #1d4ed8 48%, #93c5fd 100%)",
      glow: "rgba(147, 197, 253, 0.34)",
      accent: "#93c5fd",
    };
  }
  if (/(green|olive|mint|اخضر|أخضر|زيتي)/.test(hint)) {
    return {
      gradient: "linear-gradient(135deg, #020617 0%, #166534 48%, #86efac 100%)",
      glow: "rgba(134, 239, 172, 0.30)",
      accent: "#86efac",
    };
  }
  if (/(black|charcoal|اسود|أسود)/.test(hint)) {
    return {
      gradient: "linear-gradient(135deg, #030712 0%, #111827 52%, #52525b 100%)",
      glow: "rgba(255, 255, 255, 0.20)",
      accent: "#d4d4d8",
    };
  }
  return {
    gradient: "linear-gradient(135deg, #070713 0%, #4c1d95 48%, #a78bfa 100%)",
    glow: "rgba(167, 139, 250, 0.34)",
    accent: "#c4b5fd",
  };
};
const heroSizesForProduct = (product = {}, limit = 5) => {
  const sizes = [
    ...new Set(
      (Array.isArray(product.variants) ? product.variants : [])
        .filter((variant) => variantHasStock(variant) && variant.size)
        .map((variant) => String(variant.size).trim())
        .filter(Boolean)
    ),
  ];
  return {
    visible: sizes.slice(0, limit),
    extra: Math.max(0, sizes.length - limit),
  };
};

const storefrontGetCache = new Map();
const storefrontGetInFlight = new Map();
const STOREFRONT_GET_CACHE_TTL_MS = 60 * 1000;

const cachedStorefrontGet = (url, { ttlMs = STOREFRONT_GET_CACHE_TTL_MS } = {}) => {
  if (ttlMs <= 0) {
    return api.get(url, { cache: "no-store", headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } });
  }
  const now = Date.now();
  const cached = storefrontGetCache.get(url);
  if (cached && now - cached.at < ttlMs) {
    return Promise.resolve(cached.data);
  }
  if (storefrontGetInFlight.has(url)) {
    return storefrontGetInFlight.get(url);
  }

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

const useProducts = (params = {}) => {
  const [state, setState] = useState({ loading: true, error: "", products: [] });
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

  useEffect(() => {
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) setState((prev) => ({ ...prev, loading: true, error: "" }));
    });
    if (import.meta.env.DEV) {
      const requestParams = new URLSearchParams(queryString);
      console.debug("[storefront-random-seed]", {
        seed: requestParams.get("random_seed") || "",
        sort: requestParams.get("sort") || "",
        url: `/storefront/products${queryString ? `?${queryString}` : ""}`,
      });
    }
    cachedStorefrontGet(`/storefront/products${queryString ? `?${queryString}` : ""}`, { ttlMs: 0 })
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
            price: product?.selling_price || product?.price,
          })));
        }
        if (!cancelled) setState({ loading: false, error: "", products });
      })
      .catch((error) => {
        if (!cancelled && error?.cause?.name !== "AbortError") {
          setState({ loading: false, error: error.message, products: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [queryString]);

  return state;
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

const normalizeHomeProduct = (product = {}) => {
  const link = storefrontPathFromLink(product.link || product.product_url || product.url);
  const nestedProduct = nestedProductFor(product);
  const nestedVariant = nestedVariantFor(product, nestedProduct);
  const image = resolveProductImage(product, nestedProduct, nestedVariant) || product.image_url || product.product_image_url || product.thumbnail_url || product.photo_url || product.image || product.gallery_images?.[0] || "";
  const price = Number(product.price || product.final_price || product.selling_price || product.regular_price || nestedVariant.price || nestedProduct.price || 0) || 0;
  const salePrice = Number(product.sale_price || 0) || 0;
  const sourceSellingPrice = Number(product.selling_price || product.price || price || 0) || 0;
  const id = firstTextValue(product.id, product.product_id, product.productId, product.card_id, nestedProduct.id, nestedProduct.product_id, nestedVariant.product_id);
  const name = firstTextValue(product.name, product.title, product.product_name, product.productName, nestedProduct.name, nestedProduct.title, nestedProduct.product_name);
  return {
    ...nestedProduct,
    ...product,
    id,
    product_id: product.product_id || product.productId || nestedProduct.product_id || nestedProduct.id || id,
    card_id: product.card_id || id,
    slug: product.slug || product.canonical_slug || nestedProduct.slug || nestedProduct.canonical_slug || id,
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

const normalizeHomeCollection = (collection = {}) => {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    return { key: String(collection || ""), title: String(collection || ""), subtitle: "", products: [] };
  }
  return {
    ...collection,
    key: collection.key || collection.id || collection.slug || collection.title || "",
    title: collection.title || collection.name || collection.label || "",
    subtitle: collection.subtitle || collection.description || "",
    products: (Array.isArray(collection.products) ? collection.products : []).map(normalizeHomeProduct).filter((product) => product.id && product.name),
  };
};

const useStorefrontHome = () => {
  const [state, setState] = useState({ loading: true, loaded: false, error: "", hero: null, collections: [], rawHome: null });

  useEffect(() => {
    let cancelled = false;
    cachedStorefrontGet("/storefront/home", { ttlMs: 0 })
      .then((data) => {
        const home = data?.home || {};
        const hero = home.hero ? normalizeHomeProduct(home.hero) : null;
        const collections = (Array.isArray(home.featured_collections) ? home.featured_collections : [])
          .map(normalizeHomeCollection)
          .filter((collection) => collection.products.length);
        if (!cancelled) setState({ loading: false, loaded: true, error: "", hero: hero?.id ? hero : null, collections, rawHome: home });
      })
      .catch((error) => {
        if (!cancelled && error?.cause?.name !== "AbortError") {
          setState({ loading: false, loaded: true, error: error?.message || "Failed to load storefront home", hero: null, collections: [], rawHome: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};

const useStorefrontGenderClassifications = () => {
  const [state, setState] = useState({ loading: true, error: "", options: [] });

  useEffect(() => {
    let cancelled = false;
    cachedStorefrontGet("/storefront/classifications/gender", { ttlMs: 0 })
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: "", options: uniqueClassificationOptions(data?.options || []) });
      })
      .catch((error) => {
        if (!cancelled && error?.cause?.name !== "AbortError") {
          setState({ loading: false, error: error?.message || "Failed to load gender classifications", options: [] });
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
  const [state, setState] = useState({ loading: false, error: "", categories: [], sizes: [], products: [], hooks: {} });
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
    cachedStorefrontGet(`/storefront/last-piece${queryString ? `?${queryString}` : ""}`, { ttlMs: 0 })
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

function AiVisualAttachments({ attachments = [], onOpenProduct }) {
  const visualAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
  if (!visualAttachments.length) return null;

  return (
    <div className="mt-3 space-y-2.5">
      {visualAttachments.map((attachment, sectionIndex) => {
        if (attachment.type === "size_guide") {
          const sizes = Array.isArray(attachment.sizes) ? attachment.sizes.filter(Boolean) : [];
          if (!sizes.length) return null;
          return (
            <div key={`${attachment.type}-${sectionIndex}`} className="rounded-2xl border border-stone-200 bg-white/75 p-3 dark:border-white/10 dark:bg-white/10">
              <div className="text-xs font-black text-stone-700 dark:text-stone-100">{attachment.title || "دليل المقاسات"}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sizes.slice(0, 14).map((size) => (
                  <span key={size} className="rounded-full bg-stone-950 px-2.5 py-1 text-[11px] font-black text-white dark:bg-white dark:text-stone-950">{size}</span>
                ))}
              </div>
              {attachment.note ? <p className="mt-2 text-[11px] font-bold leading-5 text-stone-500 dark:text-stone-300">{attachment.note}</p> : null}
            </div>
          );
        }

        const items = Array.isArray(attachment.items) ? attachment.items.filter((item) => item?.image_url) : [];
        if (!items.length) return null;
        return (
          <div key={`${attachment.type}-${sectionIndex}`} className="rounded-2xl border border-stone-200 bg-white/75 p-2.5 dark:border-white/10 dark:bg-white/10">
            <div className="mb-2 px-1 text-xs font-black text-stone-700 dark:text-stone-100">{attachment.title || "صور مقترحة"}</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {items.slice(0, 8).map((item, index) => (
                <button
                  key={`${item.id || item.product_id || index}`}
                  type="button"
                  onClick={() => onOpenProduct?.({ id: item.product_id || item.id, product_url: item.product_url, name: item.title })}
                  className="min-w-[8.5rem] max-w-[8.5rem] rounded-2xl border border-stone-200 bg-white p-2 text-right shadow-sm transition hover:-translate-y-0.5 active:scale-[0.99] dark:border-white/10 dark:bg-[#080d1a]"
                >
                  <img src={imageFor(item.image_url)} onError={fallbackProductImage} alt={item.title || "صورة المنتج"} className="aspect-square w-full rounded-xl object-cover" loading="lazy" decoding="async" />
                  <span className="mt-2 block truncate text-[11px] font-black text-stone-950 dark:text-white">{item.title || "منتج"}</span>
                  {item.subtitle ? <span className="mt-0.5 block truncate text-[10px] font-bold text-stone-500 dark:text-stone-300">{item.subtitle}</span> : null}
                  <span className="mt-1 flex items-center justify-between gap-1 text-[10px] font-black text-stone-600 dark:text-stone-300">
                    <span>{Number(item.price || 0) > 0 ? money(item.price) : "السعر غير محدد"}</span>
                    <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AiSupportChatWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => []);
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [showAssistantHint, setShowAssistantHint] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(AI_SUPPORT_HINT_DISMISSED_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const [hasUnreadResponse, setHasUnreadResponse] = useState(false);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const imagePreviewUrlsRef = useRef([]);
  const openRef = useRef(open);
  const sessionId = useMemo(() => getAiSupportSessionId(), []);
  const tenantId = useMemo(() => resolveStorefrontTenantId(), []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const dismissAssistantHint = useCallback(() => {
    setShowAssistantHint(false);
    try {
      localStorage.setItem(AI_SUPPORT_HINT_DISMISSED_KEY, "1");
    } catch {
      // Local storage can be unavailable in private browsing; the hint can still dismiss for this render.
    }
  }, []);

  useEffect(() => {
    if (!showAssistantHint) return undefined;
    const timeout = window.setTimeout(dismissAssistantHint, 4500);
    return () => window.clearTimeout(timeout);
  }, [dismissAssistantHint, showAssistantHint]);

  useEffect(() => () => {
    imagePreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    imagePreviewUrlsRef.current = [];
  }, []);

  const supportHref = useMemo(() => {
    const text = encodeURIComponent(`محتاج مساعدة من الدعم بخصوص محادثة رقم ${sessionId}`);
    return whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${text}` : "/shop/contact";
  }, [sessionId]);

  const submitQuestion = useCallback(async (questionText) => {
    const text = cleanDisplayText(questionText || input);
    if (!text || loading || imageLoading) return;
    setInput("");
    setError("");
    setLastQuestion(text);
    setMessages((items) => [...items, { id: `u_${Date.now()}`, role: "user", answer: text }]);
    setLoading(true);
    try {
      const response = await api.post(
        "/ai-support/chat",
        {
          message: text,
          customer_message: text,
          session_id: sessionId,
          tenant_id: tenantId,
          metadata: {
            channel: "storefront_chat",
            surface: "shop",
          },
        },
        { timeoutMs: 30000, headers: { "x-tenant-id": tenantId } }
      );
      if (isAiSupportDebugEnabled()) {
        console.debug("[storefront-ai] chat response suggested_products", {
          answer: response?.answer,
          detected_intent: response?.detected_intent,
          fallback_reason: response?.fallback_reason,
          suggested_products: response?.suggested_products,
        });
      }
      const isGreetingOnly = isAiGreetingOnlyResponse(response);
      setMessages((items) => {
        const clearedCount = isGreetingOnly ? countAiProductUiCards(items) : 0;
        if (isGreetingOnly) {
          console.debug("[storefront-ai] greeting_only_ui_reset", {
            cleared_product_cards_count: clearedCount,
            detected_intent: response?.detected_intent,
          });
          console.debug("[storefront-ai] cleared_product_cards_count", clearedCount);
        }
        const baseItems = isGreetingOnly ? clearAiProductUiState(items) : items;
        return [
          ...baseItems,
          {
            id: `a_${Date.now()}`,
            role: "assistant",
            answer: response?.answer || "مش قادر أأكد الإجابة من بيانات المتجر حاليا. تواصل مع الدعم لو سمحت.",
            confidence: Number(response?.confidence || 0),
            needs_human_support: Boolean(response?.needs_human_support),
            detected_intent: response?.detected_intent || "",
            greeting_only_mode: Boolean(response?.greeting_only_mode),
            suggested_products: isGreetingOnly ? [] : Array.isArray(response?.suggested_products) ? response.suggested_products : [],
            visual_attachments: isGreetingOnly ? [] : Array.isArray(response?.visual_attachments) ? response.visual_attachments : [],
          },
        ];
      });
      if (!openRef.current) setHasUnreadResponse(true);
    } catch {
      setError(sfText("storefront.toasts.aiReplyFailed", "There was a problem with the reply. Try again or contact support."));
    } finally {
      setLoading(false);
    }
  }, [imageLoading, input, loading, sessionId, tenantId]);

  const submitImage = useCallback(async (file) => {
    if (!file || loading || imageLoading) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(sfText("storefront.toasts.unsupportedImageType", "Unsupported image type. Use JPG, PNG, or WEBP."));
      toast.error(sfText("storefront.toasts.unsupportedImageType", "Unsupported image type. Use JPG, PNG, or WEBP."));
      return;
    }
    if (file.size <= 0) {
      setError(sfText("storefront.toasts.emptyImage", "The image is empty. Choose a clear image."));
      toast.error(sfText("storefront.toasts.emptyImage", "The image is empty. Choose a clear image."));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(sfText("storefront.toasts.imageTooLarge", "The image is too large. Upload a smaller image."));
      toast.error(sfText("storefront.toasts.imageTooLarge", "The image is too large. Upload a smaller image."));
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    imagePreviewUrlsRef.current.push(previewUrl);
    setError("");
    setLastQuestion("");
    setMessages((items) => [
      ...items,
      {
        id: `u_img_${Date.now()}`,
        role: "user",
        answer: "دي الصورة اللي بدور على شبهها",
        image_preview: previewUrl,
      },
    ]);
    setImageLoading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("tenant_id", tenantId);
      formData.append("session_id", sessionId);
      formData.append("metadata", JSON.stringify({ channel: "storefront_chat_image", surface: "shop" }));
      const response = await api.post(
        "/ai-support/image-search",
        formData,
        { timeoutMs: 45000, headers: { "x-tenant-id": tenantId } }
      );
      console.debug("[storefront-ai] image-search raw api response before render", response);
      logImageSearchSuggestedProductRanking(response);
      const renderedAnswer = resolveRenderedAiImageAnswer(response);
      console.debug("[storefront-ai] image-search render sync", {
        backend_answer: response?.answer,
        rendered_answer: renderedAnswer,
        exact_match_found: response?.exact_match_found,
        exact_match_variant_id: response?.exact_match_variant_id ?? response?.response_debug?.exact_match_variant_id ?? null,
        final_response_synced_with_variant: response?.final_response_synced_with_variant ?? response?.response_debug?.final_response_synced_with_variant ?? false,
      });
      if (isAiSupportDebugEnabled()) {
        console.debug("[storefront-ai] image-search response", {
          answer: response?.answer,
          fallback_reason: response?.fallback_reason,
          openai_error: response?.openai_error,
          openai_errors: response?.openai_errors,
          exact_match_found: response?.exact_match_found,
          exact_match_reason: response?.exact_match_reason,
          image_ranking_debug: response?.image_ranking_debug,
          response_debug: response?.response_debug,
          suggested_products: response?.suggested_products,
        });
      }
      setMessages((items) => [
        ...items,
        {
          id: `a_img_${Date.now()}`,
          role: "assistant",
          answer: renderedAnswer,
          confidence: Number(response?.confidence || 0),
          needs_human_support: Boolean(response?.needs_human_support),
          suggested_products: Array.isArray(response?.suggested_products) ? response.suggested_products : [],
          visual_attachments: Array.isArray(response?.visual_attachments) ? response.visual_attachments : [],
          detected_style_model: response?.detected_style_model || "",
          image_ranking_debug: response?.image_ranking_debug || null,
          response_debug: response?.response_debug || null,
          exact_match_found: Boolean(response?.exact_match_found),
          exact_match_reason: response?.exact_match_reason || "",
        },
      ]);
      if (!openRef.current) setHasUnreadResponse(true);
    } catch (requestError) {
      console.error("[storefront-ai] image-search request failed", {
        status: requestError?.status,
        message: requestError?.message,
        responseBody: requestError?.responseBody,
        openai_error: requestError?.responseBody?.openai_error,
        openai_errors: requestError?.responseBody?.openai_errors,
      });
      const message =
        requestError?.responseBody?.answer ||
        requestError?.responseBody?.message ||
        (requestError?.message && requestError.message !== "Request Failed" ? requestError.message : "") ||
        "حصلت مشكلة أثناء تحليل الصورة، حاول مرة تانية.";
      setError(message);
      toast.error(message);
    } finally {
      setImageLoading(false);
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }, [imageLoading, loading, sessionId, tenantId]);

  const handleImageInputChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) submitImage(file);
  }, [submitImage]);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type?.startsWith("image/"));
    if (file) submitImage(file);
  }, [submitImage]);

  const openProduct = useCallback((product) => {
    trackAiSupportClick({ tenantId, sessionId, productId: product?.id || product?.product_id });
    navigate(aiSuggestedProductUrl(product));
    setOpen(false);
  }, [navigate, sessionId, tenantId]);

  const openAssistant = useCallback(() => {
    dismissAssistantHint();
    setHasUnreadResponse(false);
    setOpen(true);
  }, [dismissAssistantHint]);

  return (
    <section
      dir="rtl"
      className={`sf-ai-chat ${open ? "sf-ai-chat--open" : "sf-ai-chat--collapsed"}`}
      aria-label={t("storefront.aiSupport.aria", "Smart store assistant")}
    >
      {open ? (
        <div
          className={`sf-ai-chat-panel flex flex-col overflow-hidden rounded-[1.55rem] border bg-white/96 text-stone-950 shadow-[0_24px_70px_rgba(39,20,75,0.24)] backdrop-blur-2xl dark:bg-[#080d1a]/96 dark:text-stone-100 ${dragActive ? "border-[#7c3aed] ring-4 ring-[#7c3aed]/20" : "border-white/70 dark:border-white/10"}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.currentTarget === event.target) setDragActive(false);
          }}
          onDrop={handleDrop}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200/70 bg-gradient-to-l from-stone-950 via-[#3b1d78] to-[#7c3aed] px-3.5 py-3 text-white dark:border-white/10">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/15 shadow-inner">
                <Sparkles className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black">{t("storefront.aiSupport.title", "Store assistant")}</p>
                <p className="truncate text-[11px] font-bold text-white/70">{t("storefront.aiSupport.subtitle", "Answers from store data only")}</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20 active:scale-95" aria-label={t("storefront.aiSupport.closeChat", "Close chat")}>
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-[#f7f4ee] px-3 py-3.5 dark:bg-[#070b16]">
            {messages.map((message) => (
              <div key={message.id} className={`sf-ai-chat-message-row flex ${message.role === "user" ? "sf-ai-chat-message-row--user justify-end" : "sf-ai-chat-message-row--assistant justify-start"}`}>
                <div className={`sf-ai-chat-bubble max-w-[82%] rounded-[1.35rem] px-3.5 py-2.5 text-[13px] font-bold leading-6 shadow-sm sm:max-w-[86%] ${message.role === "user" ? "sf-ai-chat-bubble--user rounded-tl-md" : "sf-ai-chat-bubble--assistant rounded-tr-md"}`}>
                  <p className="whitespace-pre-wrap break-words">{message.answer}</p>
                  {message.image_preview ? (
                    <img src={message.image_preview} alt={t("storefront.aiSupport.uploadedImageAlt", "Uploaded image")} className="mt-2 max-h-44 w-full rounded-2xl object-cover ring-1 ring-white/30" />
                  ) : null}
                  {message.role === "assistant" && message.detected_style_model ? (
                    <p className="mt-2 rounded-2xl bg-white/60 px-3 py-2 text-[11px] font-black text-stone-600 dark:bg-white/10 dark:text-stone-200">
                      {message.detected_style_model}
                    </p>
                  ) : null}
                  {message.role === "assistant" && Array.isArray(message.suggested_products) && message.suggested_products.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      {message.suggested_products.slice(0, 3).map((product, index) => (
                        <button key={`${product.id || product.sku || index}`} type="button" onClick={() => openProduct(product)} className="sf-ai-product-card flex min-w-0 items-center gap-2.5 rounded-2xl border p-2 text-right transition hover:-translate-y-0.5 active:scale-[0.99]">
                          <img src={aiSuggestedProductImage(product)} onError={fallbackProductImage} alt={product.name || t("storefront.aiSupport.suggestedProduct", "Suggested product")} className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-black">{product.name || t("storefront.aiSupport.suggestedProduct", "Suggested product")}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-stone-500 dark:text-stone-300">
                              <span>{aiSuggestedProductPriceText(product)}</span>
                              <span className={product.stock_status === "in_stock" || Number(product.total_stock || product.stock || 0) > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>{aiAvailabilityText(product)}</span>
                            </span>
                          </span>
                          <ChevronLeft className="h-4 w-4 text-stone-400" />
                        </button>
                      ))}
                    </div>
                  )}
                  {message.role === "assistant" && Array.isArray(message.visual_attachments) && message.visual_attachments.length > 0 ? (
                    <AiVisualAttachments attachments={message.visual_attachments} onOpenProduct={openProduct} />
                  ) : null}
                  {message.role === "assistant" && message.needs_human_support && (
                    <a href={supportHref} target={whatsappPhone ? "_blank" : undefined} rel={whatsappPhone ? "noreferrer" : undefined} className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-emerald-900/20 transition hover:-translate-y-0.5">
                      <MessageCircle className="h-4 w-4" />
                      {t("storefront.aiSupport.contactSupport", "Contact support")}
                    </a>
                  )}
                </div>
              </div>
            ))}
            {(loading || imageLoading) && (
              <div className="flex justify-end">
                <div className="inline-flex max-w-[82%] items-center gap-2 rounded-[1.35rem] border border-stone-200 bg-white px-3.5 py-2.5 text-[13px] font-bold text-stone-600 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
                  <RefreshCcw className="h-4 w-4 animate-spin" />
                  {imageLoading ? t("storefront.aiSupport.analyzingImage", "Analyzing image...") : t("storefront.aiSupport.checkingStore", "Checking store data...")}
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-3xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700 dark:border-rose-400/20 dark:bg-rose-950/30 dark:text-rose-200">
                <p>{error}</p>
                <button type="button" onClick={() => submitQuestion(lastQuestion)} className="mt-2 inline-flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-black text-white">
                  <RefreshCcw className="h-3.5 w-3.5" />
                  {t("common.retry", "Retry")}
                </button>
              </div>
            )}
          </div>

          <div className="sf-ai-chat-composer shrink-0 border-t border-stone-200 bg-white px-3 pb-[calc(0.8rem+env(safe-area-inset-bottom))] pt-3 dark:border-white/10 dark:bg-[#080d1a]">
            <form className="sf-ai-chat-composer-row grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); submitQuestion(input); }}>
              <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={loading || imageLoading} className="sf-ai-chat-attach-button inline-grid place-items-center rounded-full transition active:scale-95 disabled:cursor-not-allowed" aria-label={t("storefront.aiSupport.openCamera", "Open camera")}>
                <Camera className="h-4 w-4" />
                <span className="hidden md:inline">{t("storefront.aiSupport.camera", "Camera")}</span>
              </button>
              <button type="button" onClick={() => galleryInputRef.current?.click()} disabled={loading || imageLoading} className="sf-ai-chat-attach-button inline-grid place-items-center rounded-full transition active:scale-95 disabled:cursor-not-allowed" aria-label={t("storefront.aiSupport.chooseGalleryImage", "Choose image from gallery")}>
                <ImagePlus className="h-4 w-4" />
                <span className="hidden md:inline">{t("storefront.aiSupport.gallery", "Gallery")}</span>
              </button>
              <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={handleImageInputChange} />
              <input ref={galleryInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageInputChange} />
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t("storefront.aiSupport.inputPlaceholder", "Type your question here...")}
                disabled={imageLoading}
                className="sf-ai-chat-input h-12 min-w-0 rounded-full border px-4 text-sm font-bold outline-none transition"
              />
              <button type="submit" disabled={loading || imageLoading || !cleanDisplayText(input)} className="sf-ai-chat-send grid h-12 w-12 shrink-0 place-items-center rounded-full shadow-lg transition hover:-translate-y-0.5 active:scale-95 disabled:cursor-not-allowed" aria-label={t("common.send", "Send")}>
                <Send className="h-[18px] w-[18px]" />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <>
          {showAssistantHint ? (
            <button type="button" onClick={openAssistant} className="sf-ai-chat-hint" aria-label={t("storefront.aiSupport.openAssistant", "Open AI shopping assistant")}>
              {t("storefront.aiSupport.hint", "Ask about size or model")} ✨
            </button>
          ) : null}
          <button type="button" onClick={openAssistant} className="sf-ai-chat-launcher group" aria-label={t("storefront.aiSupport.openAssistant", "Open AI shopping assistant")}>
            <span className="sf-ai-chat-launcher__halo" aria-hidden="true" />
            <span className="sf-ai-chat-launcher__icon">
              <Sparkles className="sf-ai-chat-launcher__sparkle" aria-hidden="true" />
              <MessageCircleMore className="sf-ai-chat-launcher__message" aria-hidden="true" />
            </span>
            <span className="hidden text-right md:block">
              <span className="block text-sm font-black">{t("storefront.aiSupport.askAssistant", "Ask assistant")}</span>
              <span className="block text-[11px] font-bold opacity-70">{t("storefront.aiSupport.launcherSubtitle", "Prices, sizes, and policies")}</span>
            </span>
            {hasUnreadResponse ? <span className="sf-ai-chat-unread" aria-hidden="true" /> : null}
          </button>
        </>
      )}
    </section>
  );
}

function Storefront() {
  const pageStartedAtRef = useRef(performance.now());
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      logPagePerf("storefront", pageStartedAtRef.current, { page_mount_ms: Math.round(performance.now() - pageStartedAtRef.current) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const { i18n } = useTranslation();
  const [cart, setCartState] = useState(() => loadCartFromStorage());
  const [wishlist, setWishlist] = useState(() => sanitizeWishlist(readJson(WISHLIST_KEY, [])));
  const [recent, setRecent] = useState(() => sanitizeRecent(readJson(RECENT_KEY, [])));
  const [profile, setProfile] = useState(() => sanitizeProfile(readJson(PROFILE_KEY, {})));
  const [themeMode] = useState(() => readThemeMode());
  const [systemTheme, setSystemTheme] = useState(() => getSystemTheme());
  const [cartOpen, setCartOpen] = useState(false);
  const [customerSession, setCustomerSession] = useState(() => readJson("storefront.customer_session_public", null));
  const [customerCaptureOpen, setCustomerCaptureOpen] = useState(false);
  const [customerCaptureReason, setCustomerCaptureReason] = useState("add_to_cart");
  const [pendingCartItem, setPendingCartItem] = useState(null);
  const location = useLocation();
  const effectiveTheme = themeMode === "auto" ? systemTheme : themeMode;
  const dir = typeof i18n.dir === "function" ? i18n.dir(i18n.resolvedLanguage || i18n.language) : "ltr";
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const wishlistRef = useRef(wishlist);
  const profileRef = useRef(profile);
  const customerSessionRef = useRef(customerSession);
  const checkoutCapturePromptedRef = useRef(false);

  const setCart = useCallback((updater, action = "save") => {
    setCartState((current) => {
      const nextValue = typeof updater === "function" ? updater(sanitizeCart(current)) : updater;
      const nextCart = sanitizeCart(nextValue);
      if (action === "clear") {
        clearCartStorage();
        return [];
      }
      const saved = saveCartToStorage(nextCart);
      return saved;
    });
  }, []);

  useEffect(() => {
    wishlistRef.current = wishlist;
  }, [wishlist]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    customerSessionRef.current = customerSession;
    writeJson("storefront.customer_session_public", customerSession);
  }, [customerSession]);

  useEffect(() => {
    cleanupStorefrontStorage();
  }, []);

  useEffect(() => {
    paymentLogoPreloadUrls.forEach((logoUrl) => {
      const image = new Image();
      image.src = logoUrl;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tenantId = resolveStorefrontTenantId();
    api.get("/storefront/customer/me", { credentials: "include", headers: { ...customerSessionHeaders(), "x-tenant-id": tenantId }, suppressErrorStatuses: [400, 401, 404, 500] })
      .then((data) => {
        if (cancelled || !data?.identified) return;
        setCustomerSession(data.customer || null);
        trackStorefrontCaptureEvent("returning_customer_detected");
        return api.post(
          "/storefront/customer/restore-cart",
          { tenant_id: tenantId, cart_items: loadCartFromStorage(), wishlist_items: readJson(WISHLIST_KEY, []) },
          { credentials: "include", headers: { ...customerSessionHeaders(), "x-tenant-id": tenantId }, suppressErrorStatuses: [400, 401, 404, 500] }
        );
      })
      .then((data) => {
        if (cancelled || !data?.restored) return;
        if (Array.isArray(data.wishlist_items)) setWishlist(sanitizeWishlist(data.wishlist_items));
        trackStorefrontCaptureEvent("cart_restore_ignored", { count: Array.isArray(data.cart_items) ? data.cart_items.length : 0 });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (!media) return undefined;
    const update = (event) => setSystemTheme(event.matches ? "dark" : "light");
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    if (typeof media.addListener === "function") {
      media.addListener(update);
      return () => media.removeListener(update);
    }
    return undefined;
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, themeMode);
    } catch {
      // Ignore storage access errors.
    }
  }, [themeMode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("storefront-dark", effectiveTheme === "dark");
    document.documentElement.classList.toggle("dark", effectiveTheme === "dark");
  }, [effectiveTheme]);

  useEffect(() => {
    writeJson(WISHLIST_KEY, wishlist);
  }, [wishlist]);
  useEffect(() => {
    writeJson(RECENT_KEY, recent);
  }, [recent]);
  useEffect(() => {
    writeJson(PROFILE_KEY, profile);
  }, [profile]);

  const buildCartItem = useCallback((product, variant, quantity = 1) => {
    const lineId = `${product.id}:${variant.id}`;
    const itemName = mirrorProductTitle(product, variant) || product.name;
    return {
      lineId,
      product_id: product.id,
      variant_id: variant.id,
      name: itemName,
      image_url: variant.image_url || product.image_url,
      size: variant.size || "",
      color: variant.color || "",
      price: displaySellingPrice(product, variant),
      selling_price: storefrontSellingPrice(product, variant),
      regular_price: storefrontOriginalPrice(product, variant),
      original_price: storefrontOriginalPrice(product, variant),
      base_price: storefrontOriginalPrice(product, variant),
      list_price: storefrontOriginalPrice(product, variant),
      compare_base_price: storefrontOriginalPrice(product, variant),
      compare_at_price: displayComparePrice(product, variant),
      sale_price: Number(variant.sale_price ?? product.sale_price ?? 0),
      sale_prices_enabled: storefrontSaleModeOn(product, variant),
      global_sale_enabled: storefrontSaleModeOn(product, variant),
      sale_mode_enabled: storefrontSaleModeOn(product, variant),
      stock: Number(variant.stock || 0),
      quantity,
    };
  }, []);

  const commitCartItem = useCallback((cartItem) => {
    if (!cartItem) return;
    setCart((items) => {
      const current = items.find((item) => item.lineId === cartItem.lineId);
      if (current) {
        return items.map((item) =>
          item.lineId === cartItem.lineId
            ? { ...item, quantity: Math.min(Number(cartItem.stock || 1), item.quantity + cartItem.quantity) }
            : item
        );
      }
      return [...items, cartItem];
    });
    toast.success(sfText("storefront.toasts.addedToCart", "Great choice. Added to cart."));
    setCartOpen(true);
    playSoftClick();
    const aiClick = readRecentAiSuggestedProductClick(cartItem.product_id);
    if (aiClick) {
      trackAiSupportCartOutcome({
        tenantId: aiClick.tenant_id,
        sessionId: aiClick.session_id,
        productId: cartItem.product_id,
      });
    }
  }, [setCart]);

  const openCustomerCapture = useCallback((cartItem = null, reason = "add_to_cart") => {
    setPendingCartItem(cartItem);
    setCustomerCaptureReason(reason);
    setCustomerCaptureOpen(true);
    trackStorefrontCaptureEvent("modal_shown", { reason });
    try {
      localStorage.setItem(CUSTOMER_CAPTURE_SHOWN_KEY, "1");
    } catch {
      // Ignore storage access errors.
    }
  }, []);

  const closeCustomerCapture = useCallback(() => {
    setCustomerCaptureOpen(false);
  }, []);

  const completeCustomerCapture = useCallback(async ({ name, phone }) => {
    const fullName = String(name || "").trim();
    const normalizedPhone = normalizeStorefrontPhone(phone);
    if (fullName.length < 2) throw new Error("اكتب الاسم بالكامل");
    if (!isValidStorefrontPhone(normalizedPhone)) throw new Error("اكتب رقم موبايل مصري صحيح");

    const tenantId = resolveStorefrontTenantId();
    const cartForSession = mergeStorefrontCartItems(cart, pendingCartItem ? [pendingCartItem] : []);
    const data = await api.post(
      "/storefront/customer/session",
      {
        tenant_id: tenantId,
        name: fullName,
        phone: normalizedPhone,
        cart_items: cartForSession,
        wishlist_items: wishlist,
      },
      { credentials: "include", headers: { ...customerSessionHeaders(), "x-tenant-id": tenantId }, suppressErrorStatuses: [400, 409, 429, 500] }
    );
    if (!data?.success) throw new Error(data?.message || "تعذر حفظ بياناتك حاليا");

    setStorefrontCustomerToken(data.token || "");
    setCustomerSession(data.customer || null);
    customerSessionRef.current = data.customer || null;
    setProfile((current) => ({ ...current, full_name: fullName, primary_phone: normalizedPhone, phone: normalizedPhone }));
    setCart(cartForSession);
    if (Array.isArray(data.wishlist_items)) setWishlist(sanitizeWishlist(data.wishlist_items));
    setCustomerCaptureOpen(false);
    setPendingCartItem(null);
    trackStorefrontCaptureEvent("modal_completed", { reason: customerCaptureReason, created: Boolean(data.created) });
    if (pendingCartItem) {
      toast.success(sfText("storefront.toasts.profileSavedAndAdded", "Your details were saved and the item was added to cart."));
      setCartOpen(true);
      playSoftClick();
    } else {
      toast.success(sfText("storefront.toasts.profileSaved", "Your details were saved."));
    }
  }, [cart, customerCaptureReason, pendingCartItem, setCart, wishlist]);

  const skipCustomerCapture = useCallback(() => {
    markCaptureSkipped();
    trackStorefrontCaptureEvent("modal_skipped", { reason: customerCaptureReason });
    if (pendingCartItem) commitCartItem(pendingCartItem);
    setPendingCartItem(null);
    setCustomerCaptureOpen(false);
  }, [commitCartItem, customerCaptureReason, pendingCartItem]);

  useEffect(() => {
    if (location.pathname !== "/shop/checkout") {
      checkoutCapturePromptedRef.current = false;
      return;
    }
    if (!cart.length || customerSessionRef.current || customerCaptureOpen || checkoutCapturePromptedRef.current) return;
    checkoutCapturePromptedRef.current = true;
    openCustomerCapture(null, "checkout");
  }, [cart.length, customerCaptureOpen, location.pathname, openCustomerCapture]);

  const addToCart = useCallback((product, variant, quantity = 1) => {
    if (!variant || Number(variant.stock || 0) <= 0) {
      toast.error(sfText("storefront.toasts.variantUnavailable", "This size or color is currently unavailable."));
      return "unavailable";
    }
    if (!(displaySellingPrice(product, variant) > 0)) {
      toast.error(sfText("storefront.toasts.priceUnavailable", "The price is currently unavailable."));
      return "unavailable";
    }
    const cartItem = buildCartItem(product, variant, quantity);
    if (!customerSessionRef.current && !captureSkipActive()) {
      openCustomerCapture(cartItem, "add_to_cart");
      return "capture_required";
    }
    commitCartItem(cartItem);
    return "added";
  }, [buildCartItem, commitCartItem, openCustomerCapture]);

  const updateCart = useCallback((lineId, quantity) => {
    setCart((items) => {
      const requestedQuantity = Number(quantity || 0);
      return items
        .map((item) => {
          if (item.lineId !== lineId) return item;
          if (requestedQuantity <= 0) return { ...item, quantity: 0 };
          return { ...item, quantity: Math.min(item.stock || 99, requestedQuantity) };
        })
        .filter((item) => item.quantity > 0);
    });
  }, [setCart]);

  const removeFromCart = useCallback((lineId) => {
    setCart((items) => {
      const nextItems = items.filter((item) => item.lineId !== lineId);
      if (import.meta.env.DEV) console.debug("[cart-remove]", { lineId, before: items.length, after: nextItems.length });
      return nextItems;
    });
  }, [setCart]);
  const clearCart = useCallback(() => setCart([], "clear"), [setCart]);
  const openCart = useCallback(() => setCartOpen(true), []);
  const closeCart = useCallback(() => setCartOpen(false), []);

  const toggleWishlist = useCallback((product) => {
    const wishlistProduct = normalizeWishlistProduct(product);
    if (!wishlistProduct.id) return;
    setWishlist((items) => {
      const exists = items.some((item) => String(normalizeWishlistProduct(item).id) === String(wishlistProduct.id));
      return exists ? items.filter((item) => String(normalizeWishlistProduct(item).id) !== String(wishlistProduct.id)) : sanitizeWishlist([wishlistProduct, ...items]);
    });
    const currentProfile = profileRef.current || {};
    const currentWishlist = wishlistRef.current || [];
    const phone = currentProfile.primary_phone || currentProfile.phone || "";
    if (phone && wishlistProduct.id) {
      const exists = currentWishlist.some((item) => String(normalizeWishlistProduct(item).id) === String(wishlistProduct.id));
      api.post("/storefront/wishlist", { phone, product_id: wishlistProduct.id, remove: exists }).catch(() => undefined);
    }
  }, []);

  const rememberProduct = useCallback((product) => {
    setRecent((items) => [{
      id: product.id,
      name: product.name,
      image_url: product.image_url,
      price: displaySellingPrice(product),
      selling_price: storefrontSellingPrice(product),
      regular_price: storefrontOriginalPrice(product),
      original_price: storefrontOriginalPrice(product),
      base_price: storefrontOriginalPrice(product),
      list_price: storefrontOriginalPrice(product),
      compare_base_price: storefrontOriginalPrice(product),
      compare_at_price: displayComparePrice(product),
      sale_price: Number(product.sale_price || 0),
      sale_prices_enabled: storefrontSaleModeOn(product),
      global_sale_enabled: storefrontSaleModeOn(product),
      sale_mode_enabled: storefrontSaleModeOn(product),
      slug: product.slug,
      viewed_at: new Date().toISOString(),
    }, ...items.filter((item) => String(item.id) !== String(product.id))].slice(0, 20));
  }, []);
  const isProductDetailsRoute = /^\/shop\/product\/[^/]+/.test(location.pathname);

  return (
    <div dir={dir} data-language={language} data-theme={effectiveTheme} className={`storefront-shell min-h-dvh ${location.pathname === "/shop/checkout" ? "storefront-shell--checkout" : ""} ${isProductDetailsRoute ? "storefront-shell--product-detail" : ""} ${effectiveTheme === "dark" ? "dark storefront-dark bg-[#070b16] text-stone-100" : "bg-[#f7f4ee] text-stone-950"}`}>
      <Header cart={cart} wishlist={wishlist} onCart={openCart} addToCart={addToCart} />
      <main className="sf-storefront-main">
        <Routes>
          <Route index element={<HomePage wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />} />
          <Route path="products" element={<ProductsPage wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />} />
          <Route path="sale" element={<ProductsPage sale wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />} />
          <Route path="product/:identifier" element={<ProductDetails addToCart={addToCart} toggleWishlist={toggleWishlist} wishlist={wishlist} rememberProduct={rememberProduct} recent={recent} profile={profile} />} />
          <Route path="cart" element={<CartPage cart={cart} updateCart={updateCart} removeFromCart={removeFromCart} />} />
          <Route path="checkout" element={<CheckoutPage cart={cart} clearCart={clearCart} profile={profile} setProfile={setProfile} />} />
          <Route path="success/:orderNumber" element={<OrderSuccess profile={profile} />} />
          <Route path="track" element={<TrackOrder />} />
          <Route path="account" element={<AccountPage profile={profile} setProfile={setProfile} wishlist={wishlist} recent={recent} addToCart={addToCart} />} />
          <Route path="wishlist" element={<WishlistPage wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />} />
          <Route path="recently-viewed" element={<RecentPage recent={recent} />} />
          <Route path="faq" element={<FaqPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="size-guide" element={<SizeGuide />} />
          <Route path="returns" element={<ReturnsPolicy />} />
        </Routes>
      </main>
      <AiSupportChatWidget />
      <Footer />
      <MobileBottomNav count={cart.length} />
      <CustomerCaptureSheet
        open={customerCaptureOpen}
        reason={customerCaptureReason}
        initialName={profile.full_name || customerSession?.name || ""}
        initialPhone={profile.primary_phone || profile.phone || customerSession?.phone || ""}
        onSubmit={completeCustomerCapture}
        onSkip={skipCustomerCapture}
        onClose={closeCustomerCapture}
      />
      <CartDrawer open={cartOpen} onClose={closeCart} cart={cart} updateCart={updateCart} removeFromCart={removeFromCart} />
    </div>
  );
}

function CustomerCaptureSheet({ open, reason = "add_to_cart", initialName = "", initialPhone = "", onSubmit, onSkip, onClose }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    deferReactState(() => {
      if (cancelled) return;
      setName(initialName || "");
      setPhone(initialPhone || "");
      setError("");
    });
    return () => {
      cancelled = true;
    };
  }, [initialName, initialPhone, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const submit = async (event) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.({ name, phone, reason });
    } catch (submitError) {
      const message = submitError?.message && submitError.message !== "Request Failed"
        ? submitError.message
        : t("storefront.customerCapture.saveFailed", "We could not save your details right now. Check the phone number and try again.");
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="sf-customer-capture-backdrop" role="dialog" aria-modal="true" aria-labelledby="customer-capture-title" dir="rtl">
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" aria-label={t("common.close", "Close")} onClick={onClose} />
      <form onSubmit={submit} className="sf-customer-capture-sheet">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/18" aria-hidden="true" />
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-violet-300/20 bg-violet-400/12 text-violet-100 shadow-[0_0_26px_rgba(124,58,237,0.28)]">
            <Crown className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="customer-capture-title" className="text-xl font-black leading-tight text-white">{t("storefront.customerCapture.title", "Save your cart and enjoy a faster experience")}</h2>
            <p className="mt-1.5 text-sm font-semibold leading-6 text-white/64">{t("storefront.customerCapture.subtitle", "Register your phone to track orders and earn loyalty points")}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition hover:bg-white/10 active:scale-95" aria-label={t("common.close", "Close")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 rounded-3xl border border-violet-300/14 bg-violet-400/[0.07] px-4 py-3 text-sm font-black text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          {t("storefront.customerCapture.loyaltyHint", "Get gift points when you register")}
        </div>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="mb-2 block text-xs font-black text-white/58">{t("storefront.form.fullName", "Full name")}</span>
            <div className="flex min-h-[54px] items-center gap-3 rounded-2xl border border-white/12 bg-white/[0.075] px-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition focus-within:border-violet-300/40 focus-within:bg-white/[0.095]">
              <User className="h-4 w-4 shrink-0 text-violet-100/80" />
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="min-w-0 flex-1 bg-transparent text-base font-bold text-white outline-none placeholder:text-white/32" placeholder={t("storefront.form.fullNamePlaceholder", "Your full name")} />
            </div>
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-black text-white/58">{t("storefront.form.mobileNumber", "Mobile number")}</span>
            <div className="flex min-h-[54px] items-center gap-3 rounded-2xl border border-white/12 bg-white/[0.075] px-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition focus-within:border-violet-300/40 focus-within:bg-white/[0.095]">
              <Phone className="h-4 w-4 shrink-0 text-violet-100/80" />
              <input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" dir="ltr" className="min-w-0 flex-1 bg-transparent text-right text-base font-bold text-white outline-none placeholder:text-white/32" placeholder="01xxxxxxxxx" />
            </div>
          </label>
        </div>

        {error ? (
          <p className="mt-3 text-sm font-bold leading-6 text-rose-100" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 grid gap-3">
          <button type="submit" disabled={submitting} aria-busy={submitting} className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white px-5 text-base font-black text-stone-950 shadow-[0_18px_42px_rgba(255,255,255,0.14),0_0_22px_rgba(124,58,237,0.22)] transition hover:-translate-y-0.5 hover:bg-violet-50 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            <span>{submitting ? t("common.saving", "Saving...") : t("common.continue", "Continue")}</span>
          </button>
          <button type="button" onClick={onSkip} disabled={submitting} className="min-h-[48px] rounded-2xl border border-white/10 bg-white/[0.045] px-5 text-sm font-black text-white/72 transition hover:bg-white/[0.08] active:scale-[0.98] disabled:opacity-50">
            {t("storefront.customerCapture.skipNow", "Skip for now")}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function Header({ cart, wishlist, onCart, addToCart }) {
  const { i18n: storefrontI18n, t } = useTranslation();
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [visualSearch, setVisualSearch] = useState({ active: false, keywords: [], message: "", error: "", previewUrl: "", fileName: "" });
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
    { label: t("storefront.header.announcements.todayDeals", "Today deals"), icon: <BadgePercent className="h-3.5 w-3.5" /> },
  ];
  const utilityItems = [
    { label: "WhatsApp", to: "https://wa.me/", icon: <MessageCircle className="h-3.5 w-3.5" />, external: true },
    { label: t("storefront.header.trackOrder", "Track Order"), to: "/shop/track", icon: <PackageSearch className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.wishlist", "Wishlist"), to: "/shop/wishlist", icon: <Heart className="h-3.5 w-3.5" /> },
    { label: t("storefront.header.account", "Account"), to: "/shop/account", icon: <User className="h-3.5 w-3.5" /> },
  ];
  const navItems = [
    [t("storefront.nav.categories", "Categories"), "/shop/products"],
    [t("storefront.nav.sale", "Sale"), "/shop/sale"],
    [t("storefront.nav.new", "New"), "/shop/products?sort=new"],
    [t("storefront.nav.men", "Men"), "/shop/products?q=رجالي"],
    [t("storefront.nav.women", "Women"), "/shop/products?q=حريمي"],
    [t("storefront.nav.kids", "Kids"), "/shop/products?q=أطفال"],
  ];

  useEffect(() => {
    const updateCompact = () => setIsCompact(!compactDisabled && window.scrollY > 72);
    updateCompact();
    window.addEventListener("scroll", updateCompact, { passive: true });
    return () => window.removeEventListener("scroll", updateCompact);
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

  useEffect(() => {
    if (visualSearch.active) {
      return;
    }
    if (search.trim().length < 2) {
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
      api.get(`/storefront/products/search?q=${encodeURIComponent(search)}&limit=8`, { signal: controller.signal })
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
  }, [search, visualSearch.active]);

  const handleSearchChange = (value) => {
    setSearch(value);
    if (visualSearch.active) {
      if (visualPreviewUrlRef.current) {
        URL.revokeObjectURL(visualPreviewUrlRef.current);
        visualPreviewUrlRef.current = "";
      }
      setVisualSearch({ active: false, keywords: [], message: "", error: "", previewUrl: "", fileName: "" });
    }
  };

  const rememberSearch = (value) => {
    const term = String(value || "").trim();
    if (!term) return;
    setRecentSearches((current) => {
      const next = [term, ...current.filter((item) => item !== term)].slice(0, 8);
      writeJson(SEARCH_RECENT_KEY, next);
      return next;
    });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setMobileSearchOpen(false);
    setActiveSearchIndex(-1);
  };

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
    if (options.keepOpen) {
      setSearchOpen(true);
      setMobileSearchOpen(true);
    } else {
      closeSearch();
    }
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
      const label = file.name.replace(/\.[^.]+$/, "") || "بحث بالصورة";
      if (visualPreviewUrlRef.current) URL.revokeObjectURL(visualPreviewUrlRef.current);
      const previewUrl = URL.createObjectURL(file);
      visualPreviewUrlRef.current = previewUrl;
      setSearch(`بحث بالصورة: ${label}`);
      setSuggestions([]);
      setVisualSearch({ active: true, keywords: [], message: "", error: "", previewUrl, fileName: file.name });
      setSearchLoading(true);
      setSearchOpen(true);
      setMobileSearchOpen(true);
      const formData = new FormData();
      formData.append("image", selectedVisualImageRef.current);
      const tenantId = resolveStorefrontTenantId();
      formData.append("tenant_id", tenantId);
      const endpoint = "/storefront/products/visual-search";
      console.debug("[visual-search] request", {
        endpoint,
        tenant_id: tenantId,
        file_name: selectedVisualImageRef.current?.name || "",
        file_type: selectedVisualImageRef.current?.type || "",
        file_size: selectedVisualImageRef.current?.size || 0,
      });
      try {
        const data = await api.post(endpoint, formData, { timeoutMs: 45000, headers: { "x-tenant-id": tenantId } });
        const products = Array.isArray(data.products) ? data.products : [];
        console.debug("[visual-search] response", {
          endpoint,
          status: 200,
          result_count: products.length,
          source: data.source || "",
          keywords: Array.isArray(data.keywords) ? data.keywords : [],
        });
        setSuggestions(products);
        setVisualSearch({
          active: true,
          keywords: Array.isArray(data.keywords) ? data.keywords : [],
          message: products.length ? "" : data.message || "لم نجد منتج مطابق للصورة",
          error: "",
          previewUrl,
          fileName: file.name,
        });
      } catch (error) {
        console.error("[visual-search] failed", {
          endpoint,
          status: error?.status || 0,
          response_body: error?.responseBody || null,
          message: error?.message || "",
        });
        const message =
          error?.responseBody?.message ||
          error?.responseBody?.error ||
          (error?.message && error.message !== "Request Failed" ? error.message : "") ||
          "تعذر البحث بالصورة الآن";
        setSuggestions([]);
        setVisualSearch({ active: true, keywords: [], message: "", error: message, previewUrl, fileName: file.name });
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
      <div className="sf-announcement-row h-10 overflow-hidden bg-[linear-gradient(105deg,#09090b,#1c1917_42%,#312e81)] text-white/90 backdrop-blur transition-all duration-300">
        <div className="sf-announcement-track h-full">
          {[...announcementItems, ...announcementItems].map((item, index) => (
            <span key={`${item.label}-${index}`} className="inline-flex h-full items-center gap-2 px-7 text-[12px] font-medium tracking-wide text-stone-100/95">
              <span className="text-white/72">{item.icon}</span>
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
      <div className="sf-main-row mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 transition-all duration-300 md:grid-cols-[auto_auto_minmax(320px,520px)_auto] md:gap-5 md:py-3">
        <button className="grid h-11 w-11 place-items-center rounded-2xl border border-stone-200/80 bg-white/70 transition hover:border-stone-300 hover:bg-white active:scale-95 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 md:hidden" onClick={() => setMenuOpen((value) => !value)} aria-label={t("storefront.header.menu", "Menu")}>
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
        <Link to="/shop" className="group inline-flex items-center gap-2 text-stone-950 transition hover:text-[#6d28d9] dark:text-white">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-stone-950 text-sm font-black tracking-[0.18em] text-white shadow-[0_12px_30px_rgba(28,25,23,0.16)] transition group-hover:scale-105 group-hover:bg-[#6d28d9] dark:bg-white dark:text-stone-950 dark:group-hover:text-white">MS</span>
          <span className="hidden leading-none sm:block">
            <span className="block text-xl font-black tracking-[0.18em]">MONÉ</span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.32em] text-stone-500 dark:text-stone-400">{t("storefront.header.tagline", "Premium Shoes")}</span>
          </span>
        </Link>
        <nav className="sf-collapsible-nav hidden items-center gap-1 text-sm font-bold text-stone-700 dark:text-stone-300 md:flex">
          {navItems.map(([label, to]) => (
            <NavLink
              key={label}
              to={to}
              className={({ isActive }) => `sf-nav-link relative rounded-full px-3 py-2 transition ${isActive ? "text-stone-950 dark:text-white" : "hover:text-stone-950 dark:hover:text-white"}`}
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
          onQuickAdd={addToCart}
          onVoice={handleVoiceSearch}
          onImage={handleImageSearch}
          className="hidden md:block"
        />
        <div className="flex items-center justify-end gap-2">
          <HeaderAction to="/shop/wishlist" label={t("storefront.header.wishlist", "Wishlist")} count={wishlist.length} icon={<Heart className="h-5 w-5" />} className="sf-secondary-action hidden md:grid" />
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
            {cart.length ? <span className="sf-action-badge">{cart.length}</span> : null}
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
          className="flex h-12 w-full items-center gap-3 rounded-2xl border border-stone-200/90 bg-white/70 px-4 text-right text-sm font-bold text-stone-500 shadow-[0_12px_32px_rgba(39,20,75,0.055)] backdrop-blur dark:border-white/10 dark:bg-white/6 dark:text-stone-400"
        >
          <Search className="h-4.5 w-4.5 text-[#7c3aed]" />
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
        onQuickAdd={addToCart}
        onVoice={handleVoiceSearch}
        onImage={handleImageSearch}
        mobileOnly
      />
      {menuOpen ? (
        <div className="grid gap-2 border-t border-stone-200 bg-white/96 px-4 py-4 text-sm font-bold backdrop-blur dark:border-white/10 dark:bg-[#0b1020]/96 md:hidden">
          {[t("storefront.nav.home", "Home"), t("storefront.nav.categories", "Categories"), t("storefront.nav.sale", "Sale"), t("storefront.nav.new", "New"), t("storefront.nav.men", "Men"), t("storefront.nav.women", "Women"), t("storefront.nav.sizeGuide", "Size guide"), t("storefront.nav.returns", "Returns policy")].map((label, index) => (
            <Link key={label} to={["/shop", "/shop/products", "/shop/sale", "/shop/products?sort=new", "/shop/products?q=رجالي", "/shop/products?q=حريمي", "/shop/size-guide", "/shop/returns"][index]} onClick={() => setMenuOpen(false)} className="rounded-2xl px-3 py-3 transition hover:bg-stone-100 dark:hover:bg-white/5 active:scale-[0.98]">
              {label}
            </Link>
          ))}
        </div>
      ) : null}
    </header>
  );
}

function HeaderAction({ to, icon, count, label, className = "" }) {
  return (
    <Link to={to} className={`sf-header-action ${className}`} aria-label={label} title={label}>
      {icon}
      {count ? <span className="sf-action-badge">{count}</span> : null}
    </Link>
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
  visualSearch = { active: false, keywords: [], message: "", error: "" },
  recentSearches = [],
  activeIndex,
  setActiveIndex,
  onPickTerm,
  onPickProduct,
  onQuickAdd,
  onVoice,
  onImage,
  className = "",
  mobileOnly = false,
}) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const chips = value.trim() ? [] : [...recentSearches, ...getTrendingSearches()].filter(Boolean);
  const keyboardItems = [
    ...suggestions.map((item) => ({ type: "product", item })),
    ...chips.map((term) => ({ type: "term", term })),
  ];

  useEffect(() => {
    if (mobileOpen) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOnly || !mobileOpen) return undefined;
    document.documentElement.classList.add("sf-mobile-search-scroll-lock");
    document.body.classList.add("sf-mobile-search-scroll-lock");
    return () => {
      document.documentElement.classList.remove("sf-mobile-search-scroll-lock");
      document.body.classList.remove("sf-mobile-search-scroll-lock");
    };
  }, [mobileOnly, mobileOpen]);

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
        <Search className="pointer-events-none absolute end-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-[#7c3aed] dark:text-[#d8b4fe]" />
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
          className="relative z-10 h-13 w-full truncate bg-transparent pe-12 ps-24 text-sm font-bold text-stone-950 outline-none placeholder:text-stone-400 dark:text-white dark:placeholder:text-stone-500 md:h-12"
          aria-label={t("storefront.search.aria", "Search storefront")}
          role="combobox"
          aria-expanded={Boolean(open || mobileOpen)}
        />
        <div className="absolute start-2 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1.5">
          <button type="button" onClick={onVoice} className="grid h-8 w-8 place-items-center rounded-full bg-stone-950/5 text-stone-600 transition hover:bg-[#7c3aed] hover:text-white dark:bg-white/8 dark:text-stone-200" aria-label={t("storefront.search.voice", "Voice search")}>
            <Mic className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="grid h-8 w-8 place-items-center rounded-full bg-stone-950/5 text-stone-600 transition hover:bg-[#7c3aed] hover:text-white dark:bg-white/8 dark:text-stone-200" aria-label={t("storefront.search.image", "Image search")}>
            <ImagePlus className="h-4 w-4" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onImage} />
        </div>
      </div>
    </form>
  );

  const resultsPanel = (
    <div className="sf-search-results-panel overflow-visible rounded-[1.6rem] border border-white/60 bg-white/92 p-3 text-stone-950 shadow-[0_28px_90px_rgba(15,23,42,0.22)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#090d18]/96 dark:text-white sm:p-4">
      <SearchQuickSections
        value={value}
        loading={loading}
        suggestions={suggestions}
        visualSearch={visualSearch}
        chips={chips}
        activeIndex={activeIndex}
        onPickTerm={onPickTerm}
        onPickProduct={onPickProduct}
        onQuickAdd={onQuickAdd}
      />
    </div>
  );

  if (mobileOnly) {
    if (!mobileOpen) return null;
    return createPortal(
      <div className="sf-mobile-search-overlay fixed inset-0 z-[2147483000] overflow-hidden bg-[#030712] text-white md:hidden" dir="rtl" role="dialog" aria-modal="true">
        <div className="sf-mobile-search-backdrop absolute inset-0" aria-hidden="true" />
        <div className="sf-mobile-search-panel relative mx-auto flex h-dvh max-w-xl flex-col overflow-hidden px-4 pb-0 pt-[calc(1rem+env(safe-area-inset-top))]">
          <div className="sf-mobile-search-head sticky top-0 z-10 flex shrink-0 items-center gap-2 pb-4">
            <div className="min-w-0 flex-1">{searchInput}</div>
            <button type="button" onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/8 text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="sf-mobile-search-body min-h-0 flex-1 overflow-y-auto pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {resultsPanel}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className={`relative w-full max-w-[520px] justify-self-center transition-all duration-300 ${open ? "max-w-[640px]" : ""} ${className}`}>
      {open ? <button type="button" onClick={onClose} className="fixed inset-0 z-40 hidden bg-stone-950/24 backdrop-blur-[2px] md:block" aria-label={t("storefront.search.close", "Close search")} /> : null}
      <div className="relative z-50">
        {searchInput}
        {open ? <div className="absolute left-0 right-0 top-full mt-3 animate-[sfFadeUp_180ms_ease-out_both]">{resultsPanel}</div> : null}
      </div>
    </div>
  );
}

function SearchQuickSections({ value, loading, suggestions, visualSearch, chips, activeIndex, onPickTerm, onPickProduct, onQuickAdd }) {
  const { t } = useTranslation();
  const query = value.trim();
  const isVisualSearch = Boolean(visualSearch?.active);
  const fallbackSections = getSearchFallbackSections();
  return (
    <div className="grid gap-3">
      {query ? (
        <div>
          {isVisualSearch ? (
            <VisualSearchResults
              products={suggestions}
              loading={loading}
              visualSearch={visualSearch}
              onPickTerm={onPickTerm}
              onPickProduct={onPickProduct}
              onQuickAdd={onQuickAdd}
            />
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-black text-stone-500 dark:text-stone-400">{t("storefront.search.smartResults", "Smart results")}</span>
                {loading ? <span className="text-[11px] font-bold text-[#7c3aed]">{t("storefront.search.searching", "Searching...")}</span> : null}
              </div>
              <div className="grid gap-1.5">
                {suggestions.length ? suggestions.map((product, index) => (
                  <button
                    key={productCardKey(product, index)}
                    type="button"
                    onClick={() => onPickProduct(product)}
                    className={`flex items-center gap-3 rounded-2xl p-2 text-right transition hover:bg-[#f7f4ee] active:scale-[0.99] dark:hover:bg-white/5 ${activeIndex === index ? "bg-[#f5f3ff] dark:bg-white/8" : ""}`}
                  >
                    <img src={imageFor(product.image_url)} alt="" className="h-14 w-14 rounded-2xl bg-stone-100 object-cover shadow-sm dark:bg-white/5" loading="lazy" decoding="async" width="56" height="56" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black">{product.name}</div>
                      <div className="truncate text-xs font-bold text-stone-500 dark:text-stone-400">
                        {[product.category, product.brand, product.style, product.grade].filter(Boolean).join(" / ") || product.sizes?.slice(0, 4).join(" / ") || t("storefront.products.sizesAvailable", "Available sizes")}
                      </div>
                    </div>
                    <div className="rounded-full bg-stone-950 px-3 py-1 text-xs font-black text-white dark:bg-white dark:text-stone-950">{money(displaySellingPrice(product))}</div>
                  </button>
                )) : (
                  <button type="button" onClick={() => onPickTerm(query)} className="rounded-2xl border border-dashed border-stone-200 p-4 text-right text-sm font-black text-stone-600 dark:border-white/10 dark:text-stone-300">
                    {t("storefront.search.searchFor", "Search for")} “{query}”
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}

      {!query ? (
        <>
          <ChipSection title={t("storefront.search.trendingTitle", "Trending searches")} items={getTrendingSearches()} onPick={onPickTerm} />
          {chips.length ? <ChipSection title={t("storefront.search.recentTitle", "Recent searches")} items={chips.slice(0, 6)} onPick={onPickTerm} /> : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniSearchGroup title={t("storefront.search.categories", "Categories")} items={fallbackSections.categories || []} onPick={onPickTerm} />
            <MiniSearchGroup title={t("storefront.search.brands", "Brands")} items={fallbackSections.brands || []} onPick={onPickTerm} />
            <MiniSearchGroup title={t("storefront.search.styles", "Styles")} items={fallbackSections.styles || []} onPick={onPickTerm} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function VisualSearchResults({ products = [], loading, visualSearch, onPickTerm, onPickProduct, onQuickAdd }) {
  const { t } = useTranslation();
  const keywords = Array.isArray(visualSearch?.keywords) ? visualSearch.keywords.filter(Boolean).slice(0, 8) : [];
  const countLabel = loading ? "..." : products.length;
  return (
    <section className="sf-visual-results grid gap-3" aria-live="polite">
      {visualSearch?.previewUrl ? (
        <div className="sf-visual-preview">
          <img src={visualSearch.previewUrl} alt="" className="sf-visual-preview-image" />
          {visualSearch?.fileName ? <div className="sf-visual-preview-name" title={visualSearch.fileName}>{visualSearch.fileName}</div> : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-stone-950 dark:text-white">{t("storefront.visualSearch.similarProducts", "Similar products")}</h3>
          <p className="mt-0.5 truncate text-[11px] font-bold text-stone-500 dark:text-stone-400">
            {loading ? t("storefront.visualSearch.analyzing", "Analyzing the image and finding closest products...") : visualSearch?.error || visualSearch?.message || t("storefront.visualSearch.resultsFromImage", "Results based on the uploaded image")}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-stone-200 bg-stone-950 px-3 py-1 text-[11px] font-black text-white shadow-sm dark:border-white/10 dark:bg-white dark:text-stone-950">
          {t("storefront.search.resultCount", "{{count}} result", { count: countLabel })}
        </span>
      </div>

      {loading ? <VisualSearchSkeleton /> : products.length ? (
        <div className="sf-visual-card-list">
          {products.map((product, index) => (
            <VisualSearchCardBoundary key={product?.id || `visual-product-${index}`}>
              <VisualSearchProductCard
                product={product}
                index={index}
                onPickProduct={onPickProduct}
                onQuickAdd={onQuickAdd}
              />
            </VisualSearchCardBoundary>
          ))}
        </div>
      ) : (
        <VisualSearchEmpty
          message={visualSearch?.error || visualSearch?.message || t("storefront.visualSearch.noSimilarProduct", "No similar product found")}
          keywords={keywords}
          onPickTerm={onPickTerm}
        />
      )}
    </section>
  );
}

class VisualSearchCardBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.warn("[visual-search] skipped broken product card", error);
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function VisualSearchProductCard({ product, index, onPickProduct, onQuickAdd }) {
  const { t } = useTranslation();
  if (!product || typeof product !== "object") return null;
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variant = firstDisplayVariant(variants);
  const stock = productTotalStock(product);
  const variantStock = safeStockNumber(variant?.stock ?? variant?.quantity ?? variant?.inventory_stock ?? variant?.available_stock);
  const isAvailable = stock > 0 && (!variant || variantStock > 0);
  const activePrice = displaySellingPrice(product, variant);
  const comparePrice = displayComparePrice(product, variant);
  const meta = [product?.brand, product?.category, product?.gender, product?.style].filter(Boolean).join(" / ") || t("storefront.products.storeProduct", "Store product");

  const viewProduct = (event) => {
    event.stopPropagation();
    if (product?.id && onPickProduct) onPickProduct(product, { keepOpen: true, keepQuery: true });
  };

  const quickAdd = (event) => {
    event.stopPropagation();
    if (!onQuickAdd || !variant || variantStock <= 0) {
      toast.error(sfText("storefront.toasts.variantUnavailable", "This size or color is currently unavailable."));
      return;
    }
    onQuickAdd(product, variant, 1);
  };

  return (
    <article className="sf-visual-card" style={{ animationDelay: `${index * 45}ms` }}>
      <button type="button" onClick={viewProduct} className="sf-visual-card-main">
        <span className="sf-visual-card-image-wrap">
          <img src={imageFor(displayImageForProduct(product, variant))} alt={product?.name || ""} className="sf-visual-card-image" loading="lazy" decoding="async" />
        </span>
        <span className="min-w-0 flex-1 text-right">
          <span className="sf-visual-card-name">{product?.name}</span>
          <span className="sf-visual-card-meta">{meta}</span>
          <span className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-stone-950 dark:text-white">{money(activePrice)}</span>
            {comparePrice ? <span className="text-[11px] font-bold text-stone-400 line-through">{money(comparePrice)}</span> : null}
          </span>
          <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black ${isAvailable ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200" : "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-200"}`}>
            {isAvailable ? t("storefront.products.availableNow", "Available now") : t("storefront.products.unavailable", "Unavailable")}
          </span>
        </span>
      </button>
      <div className="sf-visual-actions">
        <button type="button" onClick={viewProduct} className="sf-visual-action-primary">{t("storefront.products.viewProduct", "View product")}</button>
        <button type="button" onClick={quickAdd} disabled={!isAvailable} className="sf-visual-action-soft">{t("storefront.cart.addToCart", "Add to cart")}</button>
        <button type="button" onClick={viewProduct} className="sf-visual-action-soft">{t("storefront.products.sizes", "Sizes")}</button>
      </div>
    </article>
  );
}

function VisualSearchSkeleton() {
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
          <div className="sf-visual-actions">
            <div className="h-9 rounded-full bg-stone-200 dark:bg-white/10" />
            <div className="h-9 rounded-full bg-stone-200 dark:bg-white/10" />
            <div className="h-9 rounded-full bg-stone-200 dark:bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

function VisualSearchEmpty({ message, keywords, onPickTerm }) {
  const { t } = useTranslation();
  return (
    <div className="sf-visual-empty">
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-[#8b5cf6]/20 bg-[#7c3aed]/14 text-[#c4b5fd] shadow-[0_14px_34px_rgba(124,58,237,0.16)]">
        <PackageSearch className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-black text-stone-50">{t("storefront.visualSearch.noSimilarProduct", "No similar product found")}</div>
        <div className="mt-1 text-xs font-bold leading-5 text-stone-400">{message || t("storefront.visualSearch.emptyHint", "Try a clearer image or use the suggested keywords.")}</div>
        {keywords.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {keywords.map((keyword) => (
              <button key={keyword} type="button" onClick={() => onPickTerm(keyword)} className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5 text-xs font-black text-stone-200 transition hover:border-[#a78bfa]/40 hover:bg-[#7c3aed]/18 hover:text-white active:scale-95">
                {keyword}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChipSection({ title, items, onPick }) {
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

function MiniSearchGroup({ title, items, onPick }) {
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

function HomePage(props) {
  const { i18n, t } = useTranslation();
  const lang = i18n.language || "ar";
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [lastPieceOpen, setLastPieceOpen] = useState(false);
  const storefrontHome = useStorefrontHome();
  const { products, loading } = useProducts({ limit: 24 });
  const { products: saleProducts, loading: saleLoading } = useProducts({ sale: 1, limit: 12 });
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const { options: storefrontGenderOptions } = useStorefrontGenderClassifications();
  const classificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false }),
    [classificationGroups]
  );
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
    () => uniqueProductsByIdentity(saleRailProducts.length ? saleRailProducts : saleProducts.length ? saleProducts : saleFallback.length ? saleFallback : railProducts),
    [railProducts, saleFallback, saleProducts, saleRailProducts]
  );
  const homeHero = storefrontHome.hero;
  const allowLegacyHomeFallback = Boolean(storefrontHome.error && !homeHero && !storefrontHome.collections.length);
  const heroProducts = useMemo(() => {
    if (homeHero) return [homeHero];
    if (!allowLegacyHomeFallback) return [];
    return uniqueProductsByIdentity([...bestBase, ...freshBase, ...saleBase, ...railProducts]).slice(0, 6);
  }, [allowLegacyHomeFallback, bestBase, freshBase, homeHero, railProducts, saleBase]);
  const safeHeroIndex = heroProducts.length ? Math.min(heroIndex, heroProducts.length - 1) : 0;
  const heroProduct = heroProducts[safeHeroIndex] || heroProducts[0] || {};
  const heroKey = productIdentityKey(heroProduct);
  const heroExcluded = useMemo(() => new Set(heroKey ? [heroKey] : []), [heroKey]);
  const saleUnique = useMemo(() => pickHomeProducts({ preferred: saleBase, fallback: railProducts, exclude: heroExcluded, limit: 8 }), [heroExcluded, railProducts, saleBase]);
  const saleIds = useMemo(() => new Set(saleUnique.map((product, index) => productIdentityKey(product, index))), [saleUnique]);
  const freshUnique = useMemo(() => {
    const exclude = new Set([...heroExcluded, ...saleIds]);
    return pickHomeProducts({ preferred: freshBase, fallback: railProducts, exclude, limit: 8 });
  }, [freshBase, heroExcluded, railProducts, saleIds]);
  const freshIds = useMemo(() => new Set(freshUnique.map((product, index) => productIdentityKey(product, index))), [freshUnique]);
  const best = useMemo(() => {
    const exclude = new Set([...heroExcluded, ...saleIds, ...freshIds]);
    return pickHomeProducts({ preferred: bestBase, fallback: railProducts, exclude, limit: 8 });
  }, [bestBase, freshIds, heroExcluded, railProducts, saleIds]);
  const heroVariant = firstDisplayVariant(heroProduct.variants || []);
  const heroImage = homeHero ? homeHero.image_url : displayImageForProduct(heroProduct, heroVariant);
  const heroSizes = heroSizesForProduct(heroProduct);
  const heroTheme = heroThemeForProduct(heroProduct, heroVariant);
  const heroPrice = homeHero ? Number(homeHero.price || homeHero.final_price || homeHero.selling_price || 0) || 0 : displaySellingPrice(heroProduct, heroVariant);
  const conversionTrustPoints = getConversionTrustPoints();
  const heroSubtitle = heroProduct.description || heroProduct.model || heroProduct.sku || heroProduct.category || "";
  const heroStockText = heroProduct.low_stock
    ? t("storefront.products.limitedStock", "Limited stock")
    : productStock(heroProduct) > 0
      ? t("storefront.products.availableLiveStock", "Available now from live stock")
      : t("storefront.products.checkAvailability", "Check availability");
  const heroDetailsUrl = heroProduct?.link || (allowLegacyHomeFallback && heroProduct?.id ? productUrl(heroProduct) : "/shop/products");
  const homeCollections = storefrontHome.collections;
  const hasHomeCollections = homeCollections.length > 0;
  const rawHomeCollections = Array.isArray(storefrontHome.rawHome?.featured_collections) ? storefrontHome.rawHome.featured_collections : [];
  const rawHomeProducts = useMemo(
    () => rawHomeCollections.flatMap((collection) => Array.isArray(collection?.products) ? collection.products : []).map(normalizeHomeProduct).filter((product) => product.id && product.name),
    [rawHomeCollections]
  );
  const stableHomeProducts = useMemo(() => {
    const fromCollections = homeCollections.flatMap((collection) => Array.isArray(collection.products) ? collection.products : []);
    return uniqueProductsByIdentity([
      ...rawHomeProducts,
      ...fromCollections,
      ...railProducts,
    ]).slice(0, 8);
  }, [homeCollections, railProducts, rawHomeProducts]);
  const categoryPreviewCards = useMemo(() => {
    const genderOptions = storefrontGenderOptions.length ? storefrontGenderOptions : classificationOptions.gender;
    return uniqueClassificationOptions(genderOptions)
      .map((option) => {
        const field = "gender";
        const label = classificationLabel(option, lang);
        const product = pickClassificationPreviewProduct(railProducts, field, option.value);
        const variant = product ? firstDisplayVariant(product.variants || []) : null;
        return {
          field,
          label,
          value: option.value,
          groupLabel: t("storefront.filters.gender", "Gender"),
          color: classificationColor(option),
          icon: classificationIcon(option, lang),
          product,
          variant,
          image: product ? displayImageForProduct(product, variant) : "",
          productCount: Number(option.product_count ?? 0),
        };
      })
      .filter((card) => card.productCount > 0 || card.product);
  }, [classificationOptions.gender, storefrontGenderOptions, railProducts, lang, t]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia?.("(max-width: 767px)")?.matches) return;
    console.info("[storefront-mobile-debug]", {
      route: "home",
      productsLength: products.length,
      visibleSections: ["hero", "trustPoints", "storyStrip", "categoryPreview", "productRails"],
      activeFilters: {},
      loading,
      error: "",
      railProductsLength: railProducts.length,
      saleProductsLength: saleProducts.length,
    });
  }, [loading, products.length, railProducts.length, saleProducts.length]);

  useEffect(() => {
    if (heroPaused || heroProducts.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroProducts.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [heroPaused, heroProducts.length]);

  return (
    <div className="sf-page pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.5rem)] md:pb-0">
      <section className="mx-auto max-w-[1200px] px-4 pb-2 pt-3 md:pt-4">
        <div
          className="relative overflow-hidden rounded-[2rem] text-white shadow-[0_32px_100px_rgba(15,23,42,0.32)] md:rounded-[2.6rem]"
          style={{ background: heroTheme.gradient }}
          onMouseEnter={() => setHeroPaused(true)}
          onMouseLeave={() => setHeroPaused(false)}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,255,255,0.18),transparent_30%),linear-gradient(120deg,rgba(255,255,255,0.08),transparent_46%,rgba(0,0,0,0.24))]" />
          <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full blur-3xl md:h-[30rem] md:w-[30rem]" style={{ backgroundColor: heroTheme.glow }} />
          <div className="pointer-events-none absolute bottom-0 right-0 h-40 w-40 rounded-full bg-black/20 blur-3xl md:h-80 md:w-80" />

          <div className="relative grid min-h-[520px] gap-2 p-4 sm:p-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:[direction:ltr] lg:p-9 xl:p-10">
            <div className="relative order-1 flex min-h-[310px] items-center justify-center lg:min-h-[520px] lg:[direction:rtl]">
              <div className="absolute left-1/2 top-1/2 h-52 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/14 blur-3xl md:h-72 md:w-[30rem]" />
              <div className="absolute bottom-10 left-1/2 h-7 w-64 -translate-x-1/2 rounded-[100%] bg-black/36 blur-xl md:w-96" />
              {heroImage ? (
                <Link to={heroDetailsUrl} className="group/hero relative z-10 block w-full max-w-[620px] transition duration-500 hover:scale-[1.025]" aria-label={heroProduct.name || "Hero product"}>
                  <img
                    key={heroProduct.id || heroImage}
                    src={imageFor(heroImage)}
                    alt={heroProduct.name || ""}
                    className="mx-auto max-h-[360px] w-full object-contain drop-shadow-[0_42px_38px_rgba(0,0,0,0.42)] transition duration-700 ease-out animate-[sfFloat_7s_ease-in-out_infinite] group-hover/hero:-rotate-2 group-hover/hero:scale-[1.04] md:max-h-[520px]"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    width="620"
                    height="520"
                  />
                </Link>
              ) : storefrontHome.loading ? (
                <div className="relative z-10 h-72 w-full max-w-lg animate-pulse rounded-[2rem] border border-white/10 bg-white/8 md:h-[30rem]" />
              ) : null}
            </div>

            <div className="order-2 flex flex-col justify-center py-4 lg:[direction:rtl]">
              <div className="inline-flex w-max items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black text-white/86 backdrop-blur">
                <Sparkles className="h-4 w-4" style={{ color: heroTheme.accent }} />
                {t("storefront.home.newArrival", "New Arrival")}
              </div>
              <h1 key={`title-${heroProduct.id || heroIndex}`} className="mt-4 max-w-xl text-4xl font-black leading-[1.02] tracking-normal text-white animate-[sfFadeUp_420ms_ease-out_both] md:text-6xl xl:text-7xl">
                {heroProduct.name || ""}
              </h1>
              {heroSubtitle ? (
                <p className="mt-4 line-clamp-2 max-w-lg text-sm font-semibold leading-7 text-white/72 md:text-base">
                  {heroSubtitle}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap items-end gap-3">
                <div className="text-3xl font-black leading-none md:text-4xl">{heroPrice ? money(heroPrice) : "—"}</div>
                <div className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-[11px] font-black text-white/74 backdrop-blur">
                  {heroStockText}
                </div>
              </div>

              <div key={`sizes-${heroProduct.id || heroIndex}`} className="mt-5 flex min-h-9 flex-wrap gap-2">
                {heroSizes.visible.length ? heroSizes.visible.map((size, index) => (
                  <span
                    key={size}
                    className="rounded-full border border-white/14 bg-white/10 px-3.5 py-2 text-xs font-black text-white/88 shadow-sm backdrop-blur animate-[sfFadeUp_420ms_ease-out_both]"
                    style={{ animationDelay: `${index * 55}ms` }}
                  >
                    {size}
                  </span>
                )) : (
                  <span className="rounded-full border border-white/14 bg-white/10 px-3.5 py-2 text-xs font-black text-white/68 backdrop-blur">
                    {t("storefront.products.sizesInsideProduct", "Sizes inside product")}
                  </span>
                )}
                {heroSizes.extra ? (
                  <span className="rounded-full border border-white/14 bg-white/10 px-3.5 py-2 text-xs font-black text-white/88 backdrop-blur">
                    +{heroSizes.extra}
                  </span>
                ) : null}
              </div>

              <div className="mt-7 flex flex-wrap gap-3">
                <Link to={heroDetailsUrl} className="sf-primary-cta inline-flex min-h-12 items-center justify-center rounded-full bg-white px-7 py-3 text-sm font-black text-stone-950 shadow-[0_18px_45px_rgba(255,255,255,0.18)] transition hover:-translate-y-0.5 hover:bg-[#f8fafc] active:scale-[0.98]">
                  {t("storefront.common.shopNow", "Shop Now")}
                </Link>
                <Link to={heroDetailsUrl} className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/24 bg-white/8 px-7 py-3 text-sm font-black text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/14 active:scale-[0.98]">
                  {t("storefront.products.viewSizes", "View Sizes")}
                </Link>
              </div>
            </div>
          </div>

          {heroProducts.length > 1 ? (
            <div className="relative flex items-stretch gap-2 overflow-x-auto px-4 pb-4 sm:px-6 lg:px-9 xl:px-10">
              {heroProducts.map((product, index) => {
                const variant = firstDisplayVariant(product.variants || []);
                const active = index === heroIndex;
                return (
                  <button
                    key={product.id || index}
                    type="button"
                    onClick={() => setHeroIndex(index)}
                    className={`group flex h-[68px] min-w-[76px] shrink-0 items-center gap-3 rounded-2xl border px-2.5 text-start backdrop-blur transition hover:-translate-y-0.5 active:scale-[0.98] sm:min-w-[190px] ${
                      active ? "border-white/40 bg-white/18 text-white" : "border-white/10 bg-white/7 text-white/68 hover:bg-white/12"
                    }`}
                    aria-label={product.name || `Hero ${index + 1}`}
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/12">
                      <img src={imageFor(displayImageForProduct(product, variant))} alt="" className="h-full w-full object-contain p-1.5" loading="lazy" decoding="async" width="44" height="44" />
                    </span>
                    <span className="hidden max-w-[9rem] min-w-0 sm:block">
                      <span className="block truncate text-xs font-black">{product.name}</span>
                      <span className="mt-0.5 block text-[10px] font-bold text-white/54">{money(displaySellingPrice(product, variant))}</span>
                    </span>
                    <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white" : "bg-white/32"}`} />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>
      <section className="mx-auto max-w-[1200px] px-4 pb-1">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {conversionTrustPoints.map((point) => (
            <div key={point} className="rounded-full border border-stone-200 bg-white px-4 py-2 text-center text-xs font-black text-stone-700 shadow-[0_10px_25px_rgba(39,20,75,0.04)] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
              {point}
            </div>
          ))}
        </div>
      </section>
      <section className="relative z-10 mx-auto min-h-[84px] max-w-[1200px] px-4 py-1.5 md:min-h-[120px] md:py-2">
        <StoryStrip products={railProducts} categories={categoryPreviewCards} loading={loading} onLastPiece={() => setLastPieceOpen(true)} />
      </section>
      <SimpleHomeProductGrid
        title={t("storefront.home.featuredProducts", "Featured products")}
        subtitle={t("storefront.home.featuredProductsSubtitle", "Selected products ready to shop")}
        products={stableHomeProducts}
        loading={storefrontHome.loading || loading}
      />
      <section className="mx-auto max-w-[1200px] px-4 py-1.5 md:py-2">
        {categoryPreviewCards.length ? (
          <div>
            <div className="mb-2 flex items-end justify-between gap-3 text-right">
              <SectionIntro eyebrow={t("storefront.search.categories", "Categories")} title={t("storefront.home.shopByCategory", "Shop by category")} subtitle={t("storefront.home.shopByCategorySubtitle", "Choose quickly by category or type")} compact />
              <Link to="/shop/products" className="shrink-0 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] active:scale-[0.98] md:px-4 md:py-2 md:text-xs dark:border-white/10 dark:bg-white/5 dark:text-stone-200">{t("common.viewAll", "View all")}</Link>
            </div>
            <div className="rounded-[1rem] border border-stone-200 bg-white p-1.5 shadow-[0_12px_30px_rgba(39,20,75,0.05)] dark:border-white/10 dark:bg-[#0b1020] md:rounded-[1.5rem] md:p-3">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:gap-2 lg:grid-cols-5">
              {categoryPreviewCards.map((card) => (
                <Link
                  key={card.value}
                  to={classificationUrl(card.field, card.value)}
                  className="group min-w-0 overflow-hidden rounded-[0.9rem] border border-stone-200/80 bg-[#fbfaf7] text-right shadow-[0_12px_30px_rgba(39,20,75,0.05)] transition duration-300 hover:-translate-y-1 hover:border-[#7c3aed]/45 hover:shadow-[0_18px_40px_rgba(109,40,217,0.12)] active:scale-[0.99] dark:border-white/10 dark:bg-white/5 md:rounded-[1.35rem]"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-stone-100 dark:bg-white/5">
                    {card.image ? (
                      <img src={imageFor(card.image)} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.06]" loading="lazy" decoding="async" width="320" height="240" />
                    ) : (
                      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${card.color}, #111827)` }}>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_22%,rgba(255,255,255,0.22),transparent_28%),radial-gradient(circle_at_28%_78%,rgba(255,255,255,0.14),transparent_22%)]" />
                        <div className="absolute inset-0 grid place-items-center">
                          <div className="grid h-9 w-9 place-items-center rounded-full border border-white/20 bg-white/16 text-xs font-black text-white shadow-[0_18px_45px_rgba(0,0,0,0.20)] backdrop-blur md:h-16 md:w-16 md:text-lg">
                            {card.icon}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/22 to-black/12" />
                    <div className="absolute right-2 top-2 rounded-full bg-white/92 px-2 py-0.5 text-[9px] font-black text-stone-950 shadow-sm backdrop-blur dark:bg-stone-950/85 dark:text-white md:right-3 md:top-3 md:px-3 md:py-1 md:text-[10px]">
                      {t("storefront.common.shopNow", "Shop Now")}
                    </div>
                    <div className="absolute bottom-0 right-0 left-0 p-2 text-white md:p-3">
                      <div className="text-[13px] font-black leading-4 drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] md:text-lg md:leading-6">{card.label}</div>
                      <div className="mt-0.5 text-[9px] font-bold leading-3 text-white/90 drop-shadow-[0_2px_6px_rgba(0,0,0,0.65)] md:mt-1 md:text-xs md:leading-4">{card.groupLabel}</div>
                    </div>
                  </div>
                </Link>
              ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>
      {hasHomeCollections ? homeCollections.map((collection) => (
        <HomeCollectionRail
          key={collection.key || collection.title}
          collection={collection}
        />
      )) : (
        <ProductRail title={t("storefront.home.bestsellers", "Best sellers")} subtitle={t("storefront.home.bestsellersSubtitle", "Best sellers this week")} loading={loading || storefrontHome.loading} products={best} railType="bestseller" featuredFirst {...props} />
      )}
      {allowLegacyHomeFallback ? (
        <>
          <ProductRail title={t("storefront.nav.sale", "Sale")} subtitle={t("storefront.home.saleSubtitle", "Selected discounts for a limited time")} loading={saleLoading && !saleUnique.length} products={saleUnique} railType="sale" {...props} />
          <ProductRail title={t("storefront.nav.new", "New")} subtitle={t("storefront.home.newSubtitle", "Recently added to stock")} loading={loading} products={freshUnique} railType="new" {...props} />
        </>
      ) : null}
      <Reviews />
      <LastPieceFinder open={lastPieceOpen} onClose={() => setLastPieceOpen(false)} />
    </div>
  );
}

function HomeCollectionRail({ collection = {} }) {
  const { t } = useTranslation();
  const products = Array.isArray(collection.products) ? collection.products.filter((product) => product?.id && product?.image_url) : [];
  if (!products.length) return null;

  return (
    <section className="mx-auto max-w-[1200px] px-4 py-2 md:py-4">
      <div className="mb-2 flex items-end justify-between gap-3 text-right md:mb-4 md:gap-4">
        <div className="min-w-0">
          <div className="mb-0.5 text-[9.5px] font-black uppercase tracking-[0.15em] text-[#7c3aed] dark:text-[#d8b4fe] md:mb-1 md:text-[11px] md:tracking-[0.18em]">{t("storefront.common.shopNow", "Shop Now")}</div>
          <h2 className="text-[1.25rem] font-black tracking-normal text-stone-950 dark:text-stone-100 md:text-3xl">{collection.title}</h2>
          {collection.subtitle ? <p className="mt-0.5 text-[11px] font-bold text-stone-500 dark:text-stone-400 md:mt-1 md:text-sm">{collection.subtitle}</p> : null}
          <div className="mt-1 h-0.5 w-10 rounded-full bg-gradient-to-l from-[#7c3aed] to-[#d8b4fe] md:mt-1.5 md:h-1 md:w-14" />
        </div>
        <Link to="/shop/products" className="mb-0.5 inline-flex min-h-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-black text-stone-700 shadow-[0_10px_26px_rgba(39,20,75,0.07)] transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] active:scale-[0.98] md:mb-1 md:min-h-10 md:px-5 md:py-2 md:text-xs dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
          {t("common.viewAll", "View all")}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {products.slice(0, 10).map((product, index) => (
          <Link
            key={product.card_id || product.id || index}
            to={product.link || productUrl(product)}
            className="group/product min-w-0 overflow-hidden rounded-[1.1rem] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(250,248,244,0.9)_48%,rgba(245,241,234,0.78))] shadow-[0_10px_28px_rgba(39,20,75,0.06),inset_0_1px_0_rgba(255,255,255,0.82)] ring-1 ring-stone-200/60 transition duration-300 hover:-translate-y-1.5 hover:border-[#a78bfa]/40 hover:ring-[#7c3aed]/30 hover:shadow-[0_20px_58px_rgba(39,20,75,0.15)] dark:border-white/[0.08] dark:bg-[linear-gradient(145deg,rgba(17,24,39,0.92),rgba(11,16,32,0.9)_52%,rgba(8,13,25,0.96))] dark:ring-white/[0.05]"
          >
            <div className="relative aspect-[1.14/1] overflow-hidden bg-[radial-gradient(circle_at_50%_42%,rgba(167,139,250,0.16),transparent_30%),linear-gradient(180deg,#fbfaf7_0%,#f1ece4_100%)] p-2 dark:bg-[radial-gradient(circle_at_50%_42%,rgba(167,139,250,0.12),transparent_30%),linear-gradient(180deg,#101426_0%,#0b1020_100%)]">
              <img src={imageFor(product.image_url)} alt={product.name || ""} className="h-full w-full rounded-[0.9rem] object-contain transition duration-500 group-hover/product:-translate-y-1 group-hover/product:scale-[1.07]" loading="lazy" decoding="async" width="360" height="360" />
              {product.sale_price_enabled ? (
                <span className="absolute right-2 top-2 rounded-full border border-[#7c3aed]/15 bg-white/95 px-2 py-1 text-[9px] font-black leading-none text-[#6d28d9] shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#0b1020] dark:text-[#d8b4fe]">
                  {t("storefront.nav.sale", "Sale")}
                </span>
              ) : null}
            </div>
            <div className="p-2 pt-1.5 text-right">
              <h3 className="line-clamp-2 min-h-8 text-[11.5px] font-black leading-4 text-stone-950 dark:text-stone-100">{product.name}</h3>
              <div className="mt-1.5 text-[15px] font-black text-stone-950 dark:text-white">{money(product.price || product.selling_price || 0)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function SimpleHomeProductGrid({ title, subtitle, products = [], loading = false }) {
  const visibleProducts = (Array.isArray(products) ? products : []).filter((product) => product?.id && product?.name).slice(0, 8);
  if (!visibleProducts.length && !loading) return null;

  return (
    <section className="mx-auto max-w-[1200px] px-4 py-3 md:py-5">
      <div className="mb-3 flex items-end justify-between gap-3 text-right">
        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] text-[#7c3aed] dark:text-[#d8b4fe]">{sfText("storefront.common.shopNow", "Shop Now")}</div>
          <h2 className="text-2xl font-black tracking-normal text-stone-950 dark:text-stone-100 md:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs font-bold text-stone-500 dark:text-stone-400 md:text-sm">{subtitle}</p> : null}
        </div>
        <Link to="/shop/products" className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
          {sfText("common.viewAll", "View all")}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {loading && !visibleProducts.length ? (
          <ProductSkeleton count={4} />
        ) : visibleProducts.map((product, index) => {
          const price = Number(product.price || product.final_price || product.selling_price || product.regular_price || 0) || 0;
          const image = product.image_url || product.product_image_url || product.gallery_images?.[0] || "";
          return (
            <Link
              key={product.card_id || product.id || index}
              to={product.link || productUrl(product)}
              className="group min-w-0 overflow-hidden rounded-[1.15rem] border border-stone-200 bg-white text-right shadow-[0_12px_30px_rgba(39,20,75,0.07)] transition duration-300 hover:-translate-y-1 hover:border-[#a78bfa]/45 hover:shadow-[0_20px_50px_rgba(39,20,75,0.14)] active:scale-[0.99] dark:border-white/10 dark:bg-[#0b1020]"
            >
              <div className="aspect-[1.05/1] overflow-hidden bg-stone-100 p-2 dark:bg-white/5">
                <img
                  src={imageFor(image)}
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

function StoryStrip({ products = [], categories = [], loading = false, onLastPiece }) {
  const { t } = useTranslation();
  const fallbackStories = [
    { label: t("storefront.nav.new", "New"), to: "/shop/products?sort=new", image: "", accent: "from-[#111827] to-[#7c3aed]" },
    { label: t("storefront.nav.men", "Men"), to: "/shop/products?q=رجالي", image: "", accent: "from-[#020617] to-[#334155]" },
    { label: t("storefront.nav.women", "Women"), to: "/shop/products?q=حريمي", image: "", accent: "from-[#3b0764] to-[#db2777]" },
    { label: t("storefront.nav.kids", "Kids"), to: "/shop/products?q=أطفال", image: "", accent: "from-[#0f172a] to-[#0ea5e9]" },
    { label: t("storefront.home.bestsellers", "Best sellers"), to: "/shop/products", image: "", accent: "from-[#1c1917] to-[#a16207]" },
    { label: t("storefront.nav.sale", "Sale"), to: "/shop/sale", image: "", accent: "from-[#581c87] to-[#ef4444]" },
  ];
  const categoryStories = categories.slice(0, 6).map((category) => ({
    label: category.label,
    to: classificationUrl(category.field, category.value),
    image: category.image,
    icon: category.icon,
    accent: "",
  }));
  const productStories = products.slice(0, 8).map((product) => {
    const variant = firstDisplayVariant(product.variants || []);
    return {
      label: product.name,
      to: productUrl(product),
      image: displayImageForProduct(product, variant),
      accent: "",
    };
  });
  const storyItems = [
    { label: t("storefront.lastPiece.title", "Last piece"), action: onLastPiece, image: "", icon: <Sparkles className="h-6 w-6" />, accent: "from-[#1c1917] via-[#78350f] to-[#f8e7b3]" },
    ...(categoryStories.length ? categoryStories : productStories.length ? productStories : fallbackStories),
  ].slice(0, 10);
  const showSkeleton = loading && !categories.length && !products.length;

  return (
    <div className="relative z-10 min-h-[80px] overflow-visible rounded-[1.45rem] border border-stone-200/80 bg-white/82 px-2.5 py-2.5 opacity-100 shadow-[0_16px_44px_rgba(39,20,75,0.07)] backdrop-blur dark:border-white/10 dark:bg-[#0b1020]/88 md:min-h-[112px] md:px-3 md:py-3">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(124,58,237,0.10),transparent_28%),radial-gradient(circle_at_85%_20%,rgba(248,231,179,0.10),transparent_24%)]" />
      <div className="sf-scroll relative flex min-h-[72px] gap-3 overflow-x-auto pb-1 opacity-100 md:min-h-[96px] md:gap-4">
        {showSkeleton ? Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="shrink-0 text-center">
            <div className="h-[62px] w-[62px] animate-pulse rounded-full bg-stone-200 dark:bg-white/10 md:h-[72px] md:w-[72px]" />
            <div className="mx-auto mt-1.5 h-2.5 w-12 animate-pulse rounded-full bg-stone-200 dark:bg-white/10 md:mt-2 md:h-3 md:w-14" />
          </div>
        )) : null}
        {!showSkeleton && storyItems.map((story, index) => {
          const content = (
            <>
              <span className="relative grid h-[62px] w-[62px] place-items-center rounded-full bg-gradient-to-br from-[#7c3aed] via-[#f8e7b3] to-[#111827] p-[2px] shadow-[0_14px_32px_rgba(39,20,75,0.14)] transition group-hover:-translate-y-0.5 group-hover:scale-[1.03] md:h-[72px] md:w-[72px]">
                <span className="grid h-full w-full place-items-center overflow-hidden rounded-full border-[3px] border-white bg-[#0b1020] dark:border-[#0b1020]">
                  {story.image ? (
                    <img src={imageFor(story.image)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" width="72" height="72" />
                  ) : (
                    <span className={`grid h-full w-full place-items-center bg-gradient-to-br ${story.accent || storyVisuals[index % storyVisuals.length]} text-white`}>
                      {story.icon || <Sparkles className="h-6 w-6" />}
                    </span>
                  )}
                </span>
                <span className="absolute -left-0.5 bottom-0.5 grid h-4 min-w-4 place-items-center rounded-full border border-white bg-stone-950 px-1 text-[7.5px] font-black text-white shadow-sm md:bottom-1 md:h-5 md:min-w-5 md:text-[9px]">
                  {index === 0 ? "LIVE" : "NEW"}
                </span>
              </span>
              <span className="mt-1 block max-w-[72px] truncate text-center text-[10px] font-black text-stone-700 dark:text-stone-200 md:mt-1.5 md:max-w-[78px] md:text-[11px]">
                {story.label}
              </span>
            </>
          );

          return story.action ? (
            <button key={story.label} type="button" onClick={story.action} className="group shrink-0 text-center">
              {content}
            </button>
          ) : (
            <Link key={`${story.label}-${story.to}`} to={story.to} className="group shrink-0 text-center">
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function LastPieceFinder({ open, onClose }) {
  const navigate = useNavigate();
  const previousBodyOverflow = useRef("");
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
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
  const title = step === "categories" ? "اختار القسم" : step === "sizes" ? "اختار المقاس" : `${selectedCategory} / ${selectedSize}`;

  useEffect(() => {
    if (!open) return;
    const rawCategories = Array.isArray(categories) ? categories : [];
    const debugCategories = step === "categories" ? displayedCategories : [{ label: selectedCategory, count: criticalProducts.length }];
    debugCategories.forEach((category) => {
      console.log("[last-piece-debug]", {
        rawCategories,
        categoryName: category.label,
        displayedCount: category.count,
        productsCount: criticalProducts.filter((product) => !category.label || product.category === category.label).length,
        products: criticalProducts
          .filter((product) => !category.label || product.category === category.label)
          .map((product) => ({
            id: product.id,
            name: product.name,
            totalProductStock: product.totalProductStock || product.total_stock || product.metadata?.totalProductStock,
            variants: product.variants?.map((variant) => ({
              size: variant.size,
              color: variant.color,
              qty: Number(variant.qty ?? variant.stock ?? variant.stock_quantity ?? 0),
            })),
          })),
      });
    });
  }, [categories, criticalProducts, displayedCategories, open, selectedCategory, step]);

  useEffect(() => {
    if (!open || !selectedCategory || step !== "sizes") return;
    console.log("[last-piece-size-step-debug]", {
      selectedCategory,
      eligibleProductCount: eligibleLastPieceProducts.length,
      sizeOptions,
      eligibleProducts: eligibleLastPieceProducts.map((product) => ({
        id: product.id,
        name: product.name,
        totalProductStock: product.totalProductStock || product.total_stock || product.metadata?.totalProductStock,
        sizes: (product.variants || []).map((variant) => ({
          size: variant.size,
          qty: Number(variant.qty ?? variant.stock ?? variant.stock_quantity ?? variant.quantity ?? 0),
        })),
      })),
    });
  }, [eligibleLastPieceProducts, open, selectedCategory, sizeOptions, step]);

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
    previousBodyOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow.current || "";
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
          <button onClick={selectedCategory ? goBack : onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/12 bg-white/10 text-white backdrop-blur transition active:scale-95" aria-label={sfText("storefront.common.back", "Back")}>
            {selectedCategory ? <ChevronLeft className="h-5 w-5 rotate-180" /> : <X className="h-5 w-5" />}
          </button>
          <div className="min-w-0 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f8e7b3]">LAST PIECE FINDER</p>
            <h2 className="mt-1 truncate text-2xl font-black">{title}</h2>
          </div>
          <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/12 bg-white/10 text-white backdrop-blur transition active:scale-95" aria-label={sfText("storefront.common.close", "Close")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2">
          {loading && step !== "products" ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="mx-auto h-14 w-14 animate-pulse rounded-full border border-[#f8e7b3]/35 bg-[#f8e7b3]/10" />
                <p className="mt-4 text-sm font-black text-white/70">{sfText("storefront.products.checkingLiveStock", "Checking live stock...")}</p>
              </div>
            </div>
          ) : error ? (
            <div className="mt-10 rounded-[1.5rem] border border-rose-300/20 bg-rose-500/10 p-5 text-center font-black text-rose-100">{error}</div>
          ) : null}

          {!loading && !error && step === "categories" ? (
            <div className="grid grid-cols-2 gap-2 pt-3 sm:gap-3 sm:pt-5">
              {displayedCategories.map((category) => {
                const visual = { icon: <ShoppingBag className="h-4 w-4 sm:h-6 sm:w-6" />, text: "مقاسات محدودة متاحة الآن" };
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
                        <span className="mt-0.5 block text-[10.5px] font-bold leading-4 text-white/58 sm:mt-1 sm:text-sm sm:leading-5">{visual.text}</span>
                      </span>
                      <span className="w-fit rounded-full border border-white/12 bg-white/10 px-2 py-1 text-[10px] font-black text-[#f8e7b3] sm:px-3 sm:text-xs">{category.count} فرصة</span>
                    </span>
                  </button>
                );
              })}
              {!displayedCategories.length ? <LastPieceEmpty text="No critical low-stock products right now" /> : null}
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
              {!sizeOptions.length ? <LastPieceEmpty text="No critical low-stock products right now" /> : null}
            </div>
          ) : null}

          {step === "products" ? (
            <div className="grid gap-3 pt-4">
              {loading ? <ProductSkeleton count={3} /> : displayedProducts.map((product, index) => (
                (() => {
                  const remainingStock = productTotalStock(product);
                  const variant = lastPieceMatchingVariant(product, selectedSize);
                  const normalResolvedPrice = displaySellingPrice(product, variant);
                  const purchaseInvoiceSalePrice = Number(
                    variant?.last_piece_sale_price ||
                      variant?.purchase_invoice_sale_price ||
                      variant?.purchase_sale_price ||
                      0
                  );
                  const sellingPrice = displayLastPieceSellingPrice(product, variant);
                  const rawComparePrice = displayComparePrice(product, variant);
                  const comparePrice = rawComparePrice > sellingPrice ? rawComparePrice : 0;
                  const discountPercent = comparePrice > sellingPrice ? Math.max(1, Math.round(((comparePrice - sellingPrice) / comparePrice) * 100)) : 0;
                  console.log("[last-piece-price-compare-debug]", {
                    productId: product.id,
                    productName: product.name,
                    selectedLastPieceSize: selectedSize,
                    matchingVariant: variant,
                    normalStorefrontResolvedPrice: normalResolvedPrice,
                    purchaseInvoiceSalePrice,
                    lastPieceResolvedPrice: sellingPrice,
                    resolvedComparePrice: comparePrice,
                    productKeys: Object.keys(product || {}),
                    variantKeys: Object.keys(variant || {}),
                    productPriceFields: {
                      price: product.price,
                      regular_price: product.regular_price,
                      selling_price: product.selling_price,
                      sale_price: product.sale_price,
                      storefront_price: product.storefront_price,
                      storefront_adjusted_price: product.storefront_adjusted_price,
                      adjusted_price: product.adjusted_price,
                      final_price: product.final_price,
                      min_price: product.min_price,
                      max_price: product.max_price,
                    },
                    variantPriceFields: variant ? {
                      price: variant.price,
                      regular_price: variant.regular_price,
                      selling_price: variant.selling_price,
                      sale_price: variant.sale_price,
                      purchase_sale_price: variant.purchase_sale_price,
                      purchase_invoice_sale_price: variant.purchase_invoice_sale_price,
                      purchase_invoice_selling_price: variant.purchase_invoice_selling_price,
                      last_piece_sale_price: variant.last_piece_sale_price,
                      storefront_price: variant.storefront_price,
                      storefront_adjusted_price: variant.storefront_adjusted_price,
                      adjusted_price: variant.adjusted_price,
                      final_price: variant.final_price,
                    } : null,
                  });
                  return (
                    <article key={productCardKey(product, index)} className={`overflow-hidden rounded-[1.45rem] border backdrop-blur ${lowStockUrgencyClass(remainingStock)}`}>
                      <button onClick={() => openProduct(product, variant)} className="grid w-full grid-cols-[8.5rem_1fr] gap-3 p-3 text-right sm:grid-cols-[11rem_1fr]">
                        <span className="relative aspect-[4/5] overflow-hidden rounded-[1.15rem] bg-white/8">
                          <img src={imageFor(variant?.image_url || product.image_url)} alt={product.name} className="h-full w-full object-contain p-2" loading="lazy" decoding="async" width="176" height="220" />
                          <span className={`absolute right-2 top-2 rounded-full px-2.5 py-1 text-[10px] font-black ${lowStockPillClass(remainingStock)}`}>{lowStockLabel(remainingStock)}</span>
                        </span>
                        <span className="flex min-w-0 flex-col py-1">
                          <span className="line-clamp-2 text-lg font-black leading-6">{product.name}</span>
                          <span className="mt-1 text-xs font-black text-[#f8e7b3]">{lowStockText(remainingStock)}</span>
                          <span className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-black">
                            {product.variants.map((item) => {
                              const stock = sellableVariantStock(item);
                              const summary = [item.color, item.size ? `مقاس ${item.size}` : ""].filter(Boolean).join(" / ");
                              return (
                                <span key={item.id || `${item.color}-${item.size}`} className="rounded-full border border-amber-200/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">
                                  {summary || "متاح"} × {stock}
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
                              <span className="rounded-full border border-white/14 bg-white/10 px-3 py-2 text-center text-xs font-black">{sfText("storefront.cart.reserveProduct", "Reserve product")}</span>
                              <span className="sf-shimmer-button rounded-full bg-[#f8e7b3] px-3 py-2 text-center text-xs font-black text-stone-950">{sfText("storefront.cart.orderNow", "Order now")}</span>
                            </span>
                          </span>
                        </span>
                      </button>
                    </article>
                  );
                })()
              ))}
              {!loading && !displayedProducts.length ? <LastPieceEmpty text="No critical low-stock products right now" /> : null}
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

const ProductRail = memo(function ProductRail({ title, subtitle, products, loading, wishlist, toggleWishlist, addToCart, railType = "default", featuredFirst = false }) {
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
          <div className="mb-0.5 text-[9.5px] font-black uppercase tracking-[0.15em] text-[#7c3aed] dark:text-[#d8b4fe] md:mb-1 md:text-[11px] md:tracking-[0.18em]">{t("storefront.common.shopNow", "Shop Now")}</div>
          <h2 className="text-[1.25rem] font-black tracking-normal md:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[11px] font-bold text-stone-500 dark:text-stone-400 md:mt-1 md:text-sm">{subtitle}</p> : null}
          <div className="mt-1 h-0.5 w-10 rounded-full bg-gradient-to-l from-[#7c3aed] to-[#d8b4fe] md:mt-1.5 md:h-1 md:w-14" />
        </div>
        <Link to="/shop/products" className="mb-0.5 inline-flex min-h-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-black text-stone-700 shadow-[0_10px_26px_rgba(39,20,75,0.07)] transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] active:scale-[0.98] md:mb-1 md:min-h-10 md:px-5 md:py-2 md:text-xs dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
          {t("common.viewAll", "View all")}
        </Link>
      </div>
      <div className="sf-product-rail sf-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1.5 md:flex-nowrap md:gap-4 md:overflow-hidden md:pb-1">
        {loading ? skeletonItems.map((_, index) => (
          <div key={index} className={`w-[82vw] max-w-[22rem] shrink-0 snap-start sm:w-[43vw] md:w-auto md:max-w-none md:basis-[calc((100%_-_2rem)/3)] xl:basis-[calc((100%_-_4rem)/5)] ${index >= 3 ? "md:hidden xl:block" : ""}`}>
            <div className="h-56 animate-pulse rounded-[1.35rem] bg-white shadow-[0_12px_32px_rgba(39,20,75,0.06)] md:h-72 md:rounded-[1.75rem] dark:bg-white/5" />
          </div>
        )) : visibleProducts.map((product, index) => (
          <div key={productCardKey(product, index)} className={`w-[82vw] max-w-[22rem] shrink-0 snap-start sm:w-[43vw] md:w-auto md:max-w-none md:basis-[calc((100%_-_2rem)/3)] xl:basis-[calc((100%_-_4rem)/5)] ${index >= 3 ? "md:hidden xl:block" : ""}`}>
            <ProductCard product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} railType={railType} rank={index + 1} featured={featuredFirst && index === 0} density={cardDensity} />
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
      <h3 className="mt-3 text-lg font-black text-stone-50">{t("storefront.products.emptyRailTitle", "We are preparing products here")}</h3>
      <p className="mt-1 text-sm font-bold text-stone-400">{t("storefront.products.comingSoon", "Coming soon")}</p>
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

const ProductGrid = memo(function ProductGrid({ products = [], loading, wishlist, toggleWishlist, addToCart }) {
  const columns = useStorefrontProductGridColumns();
  const renderProduct = useCallback((product, index, key) => (
    <ProductCard
      key={key}
      product={product}
      wishlist={wishlist}
      toggleWishlist={toggleWishlist}
      addToCart={addToCart}
      sizeLimit={6}
    />
  ), [addToCart, toggleWishlist, wishlist]);

  if (loading) return <ProductSkeleton count={8} />;

  if (products.length > 32) {
    return (
      <VirtualGrid
        items={products}
        columns={columns}
        estimateRowHeight={380}
        className="max-h-[calc(100vh-12rem)] min-h-[36rem] overflow-auto pr-1"
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

function ProductsPage({ sale = false, wishlist, toggleWishlist, addToCart }) {
  const { i18n, t } = useTranslation();
  const lang = i18n.language || "ar";
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const gender = params.get("gender") || "";
  const size = params.get("size") || "";
  const inStock = params.get("inStock") || "";
  const quality = params.get("quality") || "";
  const productType = params.get("product_type") || "";
  const style = params.get("style") || "";
  const grade = params.get("grade") || "";
  const sort = params.get("sort") || "";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedGender, setSelectedGender] = useState(gender);
  const [selectedProductType, setSelectedProductType] = useState(productType);
  const [selectedSize, setSelectedSize] = useState(size);
  const [currentStep, setCurrentStep] = useState(gender ? (productType ? "grid" : "productType") : "gender");
  const productTypeStepRef = useRef(null);
  const gridStepRef = useRef(null);
  const [draftFilters, setDraftFilters] = useState({ gender, product_type: productType, style, grade });
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const { options: storefrontGenderOptions } = useStorefrontGenderClassifications();
  const classificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false }),
    [classificationGroups]
  );
  const isGuidedCategoryFlow = !q && !category && !sale && !gender && !size && !inStock && !quality && !productType && !style && !grade && !sort;
  const { products, loading, error } = useProducts({ q, category, sale: sale ? 1 : "", gender, size, inStock, quality, product_type: productType, style, grade, sort });
  const {
    products: genderProducts,
    loading: genderProductsLoading,
  } = useProducts({ limit: 160, gender: selectedGender, sale: "", product_type: "", q: "", category: "", style: "", grade: "" });
  const {
    products: gridProducts,
    loading: gridProductsLoading,
    error: gridProductsError,
  } = useProducts({ limit: 160, gender: selectedGender, product_type: selectedProductType, sale: "", q: "", category: "", style: "", grade: "" });
  const filterBasePath = sale ? "/shop/sale" : "/shop/products";
  const activeFilterCount = [gender, size, inStock, quality, productType, style, grade].filter(Boolean).length;
  const filterSections = useMemo(
    () => [
      { key: "gender", label: t("storefront.filters.gender", "Gender"), eyebrow: t("storefront.filters.gender", "Gender"), icon: Users, options: classificationOptions.gender, value: gender },
      { key: "product_type", label: t("storefront.filters.productType", "Product Type"), eyebrow: t("storefront.filters.type", "Type"), icon: Footprints, options: classificationOptions.productType, value: productType },
      { key: "style", label: t("storefront.filters.style", "Style"), eyebrow: t("storefront.filters.style", "Style"), icon: Sparkles, options: classificationOptions.style, value: style },
      { key: "grade", label: t("storefront.filters.grade", "Grade"), eyebrow: t("storefront.filters.grade", "Grade"), icon: Gem, options: classificationOptions.grade, value: grade },
    ],
    [classificationOptions, gender, grade, productType, style, t]
  );

  useEffect(() => {
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) setDraftFilters({ gender, product_type: productType, style, grade });
    });
    return () => {
      cancelled = true;
    };
  }, [gender, productType, style, grade]);

  useEffect(() => {
    let cancelled = false;
    deferReactState(() => {
      if (cancelled) return;
      setSelectedGender(gender);
      setSelectedProductType(productType);
      setSelectedSize(size || "");
      if (isGuidedCategoryFlow) setCurrentStep(gender ? (productType ? "grid" : "productType") : "gender");
    });
    return () => {
      cancelled = true;
    };
  }, [gender, isGuidedCategoryFlow, productType, size]);

  useEffect(() => {
    if (!filtersOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [filtersOpen]);

  const buildFilterUrl = (field, value) => {
    const next = new URLSearchParams(params);
    if (value && value !== "all") next.set(field, value);
    else next.delete(field);
    return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
  };
  const clearClassificationFiltersUrl = () => {
    const next = new URLSearchParams(params);
    ["gender", "product_type", "style", "grade", "quality"].forEach((field) => next.delete(field));
    return `${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`;
  };
  const applyDraftFilters = () => {
    const next = new URLSearchParams(params);
    ["gender", "product_type", "style", "grade"].forEach((field) => {
      if (draftFilters[field]) next.set(field, draftFilters[field]);
      else next.delete(field);
    });
    setFiltersOpen(false);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
  };
  const resetDraftFilters = () => {
    const next = new URLSearchParams(params);
    ["gender", "product_type", "style", "grade", "quality"].forEach((field) => next.delete(field));
    setDraftFilters({ gender: "", product_type: "", style: "", grade: "" });
    setFiltersOpen(false);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
  };

  const scrollToStep = (step) => {
    const target = step === "grid" ? gridStepRef.current : step === "productType" ? productTypeStepRef.current : null;
    if (!target) return;
    window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const selectGender = (value) => {
    setSelectedGender(value);
    setSelectedProductType("");
    setSelectedSize("");
    setCurrentStep("productType");
    const next = new URLSearchParams();
    if (value) next.set("gender", value);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
    scrollToStep("productType");
  };

  const selectProductType = (value) => {
    setSelectedProductType(value);
    setSelectedSize("");
    setCurrentStep("grid");
    const next = new URLSearchParams();
    if (selectedGender) next.set("gender", selectedGender);
    if (value) next.set("product_type", value);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
    scrollToStep("grid");
  };

  const changeGender = () => {
    setSelectedProductType("");
    setSelectedSize("");
    setCurrentStep("gender");
    navigate(filterBasePath);
  };

  const changeProductType = () => {
    setSelectedProductType("");
    setSelectedSize("");
    setCurrentStep("productType");
    const next = new URLSearchParams();
    if (selectedGender) next.set("gender", selectedGender);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
    scrollToStep("productType");
  };

  const genderOptions = useMemo(
    () => uniqueClassificationOptions((storefrontGenderOptions.length ? storefrontGenderOptions : classificationOptions.gender) || []),
    [classificationOptions.gender, storefrontGenderOptions]
  );
  const productTypeOptions = useMemo(() => {
    const options = uniqueClassificationOptions(classificationOptions.productType || []);
    if (!selectedGender || !genderProducts.length) return options;
    const availableTypeValues = new Set(
      genderProducts
        .map((product) => String(product.product_type || product.productType || product.category || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const filtered = options.filter((option) => availableTypeValues.has(String(option.value || "").trim().toLowerCase()));
    return filtered.length ? filtered : options;
  }, [classificationOptions.productType, genderProducts, selectedGender]);
  const filteredProductsBeforeSize = useMemo(() => {
    const genderValue = normalizeAudienceValue(selectedGender);
    const typeValue = String(selectedProductType || "").trim().toLowerCase();
    return (Array.isArray(gridProducts) ? gridProducts : []).filter((product) => {
      const productTypeValue = String(product.product_type || product.productType || product.category || "").trim().toLowerCase();
      const genderOk = !genderValue || productAudienceValues(product).includes(genderValue);
      const typeOk = !typeValue || productTypeValue === typeValue;
      return genderOk && typeOk;
    });
  }, [gridProducts, selectedGender, selectedProductType]);
  const availableSizes = useMemo(() => buildAvailableSizeOptions(filteredProductsBeforeSize), [filteredProductsBeforeSize]);
  const filteredProducts = useMemo(
    () => selectedSize ? filteredProductsBeforeSize.filter((product) => productHasAvailableSize(product, selectedSize)) : filteredProductsBeforeSize,
    [filteredProductsBeforeSize, selectedSize]
  );
  const orderedFilteredProducts = useMemo(
    () => sortStorefrontColorCardsByModel(filteredProducts),
    [filteredProducts]
  );
  const orderedProducts = useMemo(
    () => sortStorefrontColorCardsByModel(products),
    [products]
  );
  const displayedProducts = useMemo(
    () => orderedProducts.filter((product) => productHasAvailableSize(product, size)),
    [orderedProducts, size]
  );
  const activeFilters = useMemo(
    () => ({ q, category, gender, size, inStock, quality, productType, style, grade, sort, sale: sale ? 1 : "" }),
    [category, gender, grade, inStock, productType, q, quality, sale, size, sort, style]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia?.("(max-width: 767px)")?.matches) return;
    console.info("[storefront-mobile-debug]", {
      route: "products",
      productsLength: products.length,
      visibleSections: isGuidedCategoryFlow ? ["guidedGender", "guidedProductType", "guidedGrid"] : ["filters", "productGrid"],
      activeFilters,
      loading,
      error: error || "",
      displayedProductsLength: displayedProducts.length,
      gridProductsLength: gridProducts.length,
      orderedFilteredProductsLength: orderedFilteredProducts.length,
      gridProductsLoading,
      gridProductsError: gridProductsError || "",
    });
  }, [
    activeFilters,
    displayedProducts.length,
    error,
    gridProducts.length,
    gridProductsError,
    gridProductsLoading,
    isGuidedCategoryFlow,
    loading,
    orderedFilteredProducts.length,
    products.length,
  ]);

  if (isGuidedCategoryFlow) {
    const selectedGenderOption = genderOptions.find((option) => String(option.value) === String(selectedGender));
    const selectedProductTypeOption = productTypeOptions.find((option) => String(option.value) === String(selectedProductType));
    return (
      <section className="mx-auto max-w-7xl px-3 pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.75rem)] pt-3 md:px-4 md:py-5">
        <div className="mb-3 flex flex-col gap-2 md:mb-4 md:gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold text-stone-500 md:text-sm">{t("storefront.products.guidedIntro", "Choose your way")}</p>
            <h1 className="mt-0.5 text-2xl font-black md:mt-1 md:text-3xl">{t("storefront.nav.categories", "Categories")}</h1>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <StepPill active={currentStep === "gender"} done={Boolean(selectedGender)} label={t("storefront.products.steps.gender", "1. Type")} />
            <StepPill active={currentStep === "productType"} done={Boolean(selectedProductType)} label={t("storefront.products.steps.product", "2. Product")} />
            <StepPill active={currentStep === "grid"} done={Boolean(selectedProductType)} label={t("storefront.products.steps.sizes", "3. Sizes")} />
          </div>
        </div>

        <GuidedGenderStep
          options={genderOptions}
          selectedGender={selectedGender}
          lang={lang}
          onSelect={selectGender}
        />

        <section ref={productTypeStepRef} className={`mt-3 scroll-mt-28 transition md:mt-5 ${currentStep === "gender" && !selectedGender ? "opacity-60" : ""}`}>
          <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2 md:mb-3 md:gap-3">
            <SectionIntro eyebrow={t("storefront.filters.productType", "Product Type")} title={t("storefront.products.chooseProductType", "Choose product type")} subtitle={selectedGenderOption ? t("storefront.products.suitableFor", "Suitable choices for {{label}}", { label: classificationLabel(selectedGenderOption, lang) }) : t("storefront.products.chooseGenderFirst", "Choose type first")} compact />
            {selectedGender ? (
              <button type="button" onClick={changeGender} className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
                {t("storefront.products.changeType", "Change type")}
              </button>
            ) : null}
          </div>
          <GuidedProductTypeStep
            options={productTypeOptions}
            selectedProductType={selectedProductType}
            lang={lang}
            disabled={!selectedGender}
            loading={genderProductsLoading}
            products={genderProducts}
            onSelect={selectProductType}
          />
        </section>

        <section ref={gridStepRef} className="mt-3 scroll-mt-28 md:mt-6">
          <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2 md:mb-3 md:gap-3">
            <SectionIntro
              eyebrow={t("storefront.products.products", "Products")}
              title={selectedProductTypeOption ? classificationLabel(selectedProductTypeOption, lang) : t("storefront.products.products", "Products")}
              subtitle={selectedGenderOption ? `${classificationLabel(selectedGenderOption, lang)}${selectedSize ? ` / ${t("storefront.products.sizeWithValue", "Size {{size}}", { size: selectedSize })}` : ""}` : t("storefront.products.chooseTypeAndProductFirst", "Choose type and product type first")}
              compact
            />
            {selectedProductType ? (
              <button type="button" onClick={changeProductType} className="rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
                {t("storefront.products.changeProductType", "Change product type")}
              </button>
            ) : null}
          </div>
          <GuidedSizeFilter sizes={availableSizes} selectedSize={selectedSize} onSelect={setSelectedSize} disabled={!selectedProductType} />
          {gridProductsError ? <EmptyState title={t("storefront.errors.simpleProblem", "Something went wrong")} text={t("storefront.errors.tryAgainOrWhatsapp", "Try again or contact us on WhatsApp")} /> : null}
          <ProductGrid
            products={orderedFilteredProducts}
            loading={gridProductsLoading}
            wishlist={wishlist}
            toggleWishlist={toggleWishlist}
            addToCart={addToCart}
          />
          {!gridProductsLoading && selectedProductType && !orderedFilteredProducts.length ? (
            <EmptyState title={t("storefront.products.noProductsForSize", "No products for this size right now. Try another size.")} text={selectedSize ? t("storefront.products.pickDifferentSize", "Pick a different size above") : t("storefront.products.tryDifferentProductType", "Try another product type")} />
          ) : null}
        </section>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl px-4 pb-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1.75rem)] pt-5 md:py-5">
      <div className="mb-3 flex flex-col gap-2 md:mb-4 md:gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-bold text-stone-500">{sale ? t("storefront.products.limitedOffers", "Limited-time offers") : t("storefront.products.shopEasily", "Shop easily")}</p>
          <h1 className="mt-1 text-3xl font-black">{q ? t("storefront.search.resultsFor", "Search results for \"{{query}}\"", { query: q }) : category || (sale ? t("storefront.nav.sale", "Sale") : t("storefront.products.allProducts", "All products"))}</h1>
        </div>
        <div className="text-sm font-bold text-stone-500">{t("storefront.products.productCount", "{{count}} product", { count: orderedProducts.length })}</div>
      </div>
      <PremiumFilterPanel
        sections={filterSections}
        lang={lang}
        buildFilterUrl={buildFilterUrl}
        clearUrl={clearClassificationFiltersUrl()}
        activeFilterCount={activeFilterCount}
      />
      <MobileFilterTrigger activeFilterCount={activeFilterCount} onOpen={() => setFiltersOpen(true)} />
      {filtersOpen ? (
        <Suspense fallback={null}>
          <LazyFiltersDrawer
            open={filtersOpen}
            sections={filterSections}
            lang={lang}
            draftFilters={draftFilters}
            setDraftFilters={setDraftFilters}
            onClose={() => setFiltersOpen(false)}
            onApply={applyDraftFilters}
            onReset={resetDraftFilters}
          />
        </Suspense>
      ) : null}
      {error ? <EmptyState title={t("storefront.errors.simpleProblem", "Something went wrong")} text={t("storefront.errors.tryAgainOrWhatsapp", "Try again or contact us on WhatsApp")} /> : null}
      <ProductGrid
        products={displayedProducts}
        loading={loading}
        wishlist={wishlist}
        toggleWishlist={toggleWishlist}
        addToCart={addToCart}
      />
      {!loading && !displayedProducts.length ? (
        <EmptyState
          title={t("storefront.products.emptyTitle", "No products found")}
          text={t("storefront.products.emptyText", "Try another search or category")}
          actionTo={filterBasePath}
          actionLabel={t("storefront.filters.resetFilters", "Reset filters")}
        />
      ) : null}
    </section>
  );
}

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
        <SectionIntro eyebrow={t("storefront.filters.gender", "Gender")} title={t("storefront.products.chooseWearer", "Choose who will wear it")} subtitle={t("storefront.products.chooseWearerSubtitle", "After choosing, we will take you to product type")} compact />
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
              {Number.isFinite(Number(count)) ? <span className="mt-0.5 block text-[9.5px] font-bold leading-3 text-stone-500 dark:text-stone-400 md:mt-1 md:text-[11px] md:leading-4">{t("storefront.products.productCount", "{{count}} product", { count })}</span> : null}
            </button>
          );
        })}
      </div>
      {!loading && !options.length ? <EmptyState title={t("storefront.products.noTypesForCategory", "No types available for this category")} text={t("storefront.products.goBackChooseAnother", "Go back and choose another type")} /> : null}
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
          <p className="text-[8.5px] font-black uppercase tracking-[0.14em] text-[#7c3aed] md:text-[10px] md:tracking-[0.18em]">{t("storefront.filters.sizeFilter", "Size Filter")}</p>
          <h3 className="text-xs font-black md:text-sm">{t("storefront.filters.availableSize", "Available size filter")}</h3>
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
        {!sizes.length ? <span className="rounded-full border border-dashed border-stone-200 px-2.5 py-1.5 text-[10.5px] font-bold text-stone-400 dark:border-white/10 md:px-4 md:py-2 md:text-xs">{t("storefront.filters.sizesAppearAfterType", "Sizes will appear after choosing product type")}</span> : null}
      </div>
    </div>
  );
}

function PremiumFilterPanel({ sections, lang, buildFilterUrl, clearUrl, activeFilterCount = 0 }) {
  const { t } = useTranslation();
  return (
    <div className="mb-5 hidden md:block">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-2xl border border-white/10 bg-stone-950 text-white shadow-[0_14px_36px_rgba(0,0,0,0.18)]">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7c3aed]">{t("storefront.filters.curatedFilters", "Curated Filters")}</p>
            <h2 className="text-sm font-black text-stone-950 dark:text-white">{t("storefront.filters.quickPremium", "Quick filters with a premium experience")}</h2>
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
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => (
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
      className="fixed right-4 z-30 inline-flex items-center gap-2 rounded-full border border-white/15 bg-stone-950/92 px-4 py-3 text-xs font-black text-white shadow-[0_18px_44px_rgba(0,0,0,0.28)] backdrop-blur-xl transition active:scale-95 md:hidden"
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-stone-950/55 backdrop-blur-sm" onClick={onClose} aria-label={t("storefront.filters.closeFilters", "Close filters")} />
      <div className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-hidden rounded-t-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,#101426_0%,#070b16_100%)] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.42)]">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-white/20" />
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3.5 py-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#d8b4fe]">{t("storefront.filters.premiumFilters", "Premium Filters")}</p>
            <h2 className="text-base font-black">{t("storefront.filters.chooseWhatFits", "Choose what fits you")}</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 transition active:scale-95" aria-label={t("common.close", "Close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scroll max-h-[calc(82dvh-124px)] space-y-1.5 overflow-y-auto px-2.5 py-2.5 pb-24">
          {sections.map((section) => (
            <MobileFilterSection key={section.key} section={section} lang={lang} draftValue={draftFilters[section.key] || ""} onSelect={(value) => setDraftFilters((current) => ({ ...current, [section.key]: value }))} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-white/10 bg-[#070b16]/92 px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] backdrop-blur-xl">
          <button type="button" onClick={onApply} className="flex-1 rounded-xl bg-gradient-to-l from-[#7c3aed] to-[#111827] px-4 py-2.5 text-sm font-black text-white shadow-[0_14px_34px_rgba(124,58,237,0.32)] active:scale-[0.98]">
            {t("storefront.filters.applyFilters", "Apply Filters")}
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
    if (label.includes("kid") || label.includes("child") || label.includes("أطفال") || label.includes("اطفال")) return Baby;
    if (label.includes("women") || label.includes("woman") || label.includes("حريمي") || label.includes("نسائي")) return Heart;
    return Users;
  }
  if (sectionKey === "product_type") {
    if (label.includes("bag") || label.includes("شنط") || label.includes("حقيبة")) return Briefcase;
    if (label.includes("sneaker") || label.includes("shoe") || label.includes("كوتشي") || label.includes("حذاء")) return Footprints;
    return ShoppingBag;
  }
  if (sectionKey === "grade") {
    if (label.includes("mirror") || label.includes("original") || label.includes("اورجينال")) return Crown;
    if (label.includes("import") || label.includes("vietnam") || label.includes("فيتنام")) return Gem;
    return ShieldCheck;
  }
  return Sparkles;
}

const swatchColorStyle = (label = "") => {
  const value = String(label || "").toLowerCase();
  const color =
    /(black|اسود|أسود|charcoal)/.test(value) ? "#111827" :
    /(white|ابيض|أبيض|ivory|cream|اوف|أوف|كريمي)/.test(value) ? "#f8fafc" :
    /(burgundy|maroon|نبيتي)/.test(value) ? "#7f1d1d" :
    /(red|احمر|أحمر)/.test(value) ? "#dc2626" :
    /(blue|navy|ازرق|أزرق|كحلي)/.test(value) ? "#2563eb" :
    /(green|olive|اخضر|أخضر|زيتي)/.test(value) ? "#16a34a" :
    /(brown|mocha|coffee|بني|كافيه)/.test(value) ? "#7c4a2d" :
    /(beige|tan|camel|بيج|جملي)/.test(value) ? "#d6b88f" :
    /(grey|gray|silver|رمادي|فضي|سلفر)/.test(value) ? "#a1a1aa" :
    /(pink|rose|وردي)/.test(value) ? "#fb7185" :
    /(purple|بنفسجي)/.test(value) ? "#7c3aed" :
    /(yellow|gold|اصفر|أصفر|ذهبي)/.test(value) ? "#facc15" :
    "#8b5cf6";
  return { background: color };
};

const ProductCard = memo(function ProductCard({ product: rawProduct, groupedProduct = null, colorOptions: providedColorOptions = null, selectedColor: providedSelectedColor = "", selectedVariant: providedSelectedVariant = null, availableSizes: providedAvailableSizes = null, wishlist, toggleWishlist, addToCart, railType = "default", rank = null, featured = false, density = "standard", sizeLimit = 4 }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const product = groupedProduct || rawProduct || {};
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
  const handleQuickAdd = useCallback(() => addToCart(product, availableVariant), [addToCart, availableVariant, product]);
  const directAddVariant = useMemo(() => {
    const colors = new Set(sellableVariants.map((variant) => variantColorKey(variant)).filter(Boolean));
    const sizes = new Set(sellableVariants.map((variant) => String(variant.size || "").trim() || "one-size"));
    return sellableVariants.length === 1 || (colors.size <= 1 && sizes.size <= 1)
      ? sellableVariants[0] || availableVariant
      : null;
  }, [availableVariant, sellableVariants]);
  const openVariantSheet = useCallback(() => {
    const first = availableVariant && variantHasStock(availableVariant) ? availableVariant : sellableVariants[0] || null;
    setSheetColorKey(first ? variantColorKey(first) : colorGroups[0]?.key || "");
    setSheetVariantId(first?.id || "");
    setSheetQty(1);
    setVariantSheetOpen(true);
  }, [availableVariant, colorGroups, sellableVariants]);
  const handleMobileCart = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (directAddVariant && variantHasStock(directAddVariant)) {
      addToCart(product, directAddVariant, 1);
      return;
    }
    openVariantSheet();
  }, [addToCart, directAddVariant, openVariantSheet, product]);
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
  const chooseColor = useCallback((event, group) => {
    event.preventDefault();
    event.stopPropagation();
    const next = firstDisplayVariant(group?.variants || []);
    setSelectedColorKeyState(group?.key || "");
    setSelectedVariantId(next?.id || "");
  }, []);
  const cardDensityClasses = {
    hero: {
      image: "aspect-[1.02/1] p-1.5",
      body: "p-2.5 pt-2",
      title: "h-9 text-[12.5px] leading-[1.25rem]",
      price: "text-[17px]",
      sizes: "mt-2 min-h-7 gap-1",
      chip: "h-6 px-2 text-[9px]",
      color: "h-6 w-6",
      swatch: "h-3.5 w-3.5",
    },
    standard: {
      image: "aspect-[1.14/1] p-1",
      body: "p-2 pt-1.5",
      title: "h-8 text-[11.5px] leading-4",
      price: "text-[15px]",
      sizes: "mt-1.5 min-h-6 gap-1",
      chip: "h-5 px-1.5 text-[8.5px]",
      color: "h-[22px] w-[22px]",
      swatch: "h-3 w-3",
    },
    compact: {
      image: "aspect-[1.24/1] p-1",
      body: "p-2 pt-1.5",
      title: "h-8 text-[11.25px] leading-4",
      price: "text-[14.5px]",
      sizes: "mt-1.5 min-h-6 gap-1",
      chip: "h-5 px-1.5 text-[8.5px]",
      color: "h-[22px] w-[22px]",
      swatch: "h-3 w-3",
    },
  };
  const densityClasses = cardDensityClasses[density] || cardDensityClasses.standard;

  return (
    <article style={{ contentVisibility: "auto", containIntrinsicSize: "220px 360px" }} onClick={openDetails} className={`group/product relative flex h-full min-h-0 transform-gpu cursor-pointer flex-col overflow-hidden rounded-[1.1rem] border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(250,248,244,0.9)_48%,rgba(245,241,234,0.78))] shadow-[0_10px_28px_rgba(39,20,75,0.06),inset_0_1px_0_rgba(255,255,255,0.82)] ring-1 ring-stone-200/60 transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out hover:-translate-y-1.5 hover:border-[#a78bfa]/40 hover:ring-[#7c3aed]/30 hover:shadow-[0_20px_58px_rgba(39,20,75,0.15),0_0_0_1px_rgba(124,58,237,0.08)_inset] md:rounded-[1.4rem] dark:border-white/[0.08] dark:bg-[linear-gradient(145deg,rgba(17,24,39,0.92),rgba(11,16,32,0.9)_52%,rgba(8,13,25,0.96))] dark:ring-white/[0.05] dark:shadow-[0_16px_46px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.055)] dark:hover:border-[#a78bfa]/30 dark:hover:shadow-[0_24px_64px_rgba(0,0,0,0.34),0_0_34px_rgba(124,58,237,0.12)] ${featured ? "md:shadow-[0_22px_66px_rgba(109,40,217,0.15)]" : ""}`}>
      <div className="pointer-events-none absolute inset-x-7 top-7 h-16 rounded-full bg-[#a78bfa]/0 blur-2xl transition duration-500 group-hover/product:bg-[#a78bfa]/16" />
      <div className={`relative overflow-visible bg-[radial-gradient(circle_at_50%_42%,rgba(167,139,250,0.16),transparent_30%),linear-gradient(180deg,#fbfaf7_0%,#f1ece4_100%)] md:aspect-[1/1.04] md:p-2.5 dark:bg-[radial-gradient(circle_at_50%_42%,rgba(167,139,250,0.12),transparent_30%),linear-gradient(180deg,#101426_0%,#0b1020_100%)] ${densityClasses.image}`}>
        <div className="absolute inset-x-7 top-[18%] h-28 rounded-full bg-white/50 blur-xl dark:bg-white/[0.09]" />
        <Link to={detailsUrl} className="relative z-10 block h-full">
          {displayImage ? (
            <img src={imageFor(displayImage)} alt={product.name} className="h-full w-full transform-gpu rounded-[0.85rem] object-contain object-center p-0 opacity-0 transition-[opacity,transform] duration-500 ease-out will-change-transform group-hover/product:-translate-y-1 group-hover/product:scale-[1.075] md:rounded-[1.15rem] md:scale-[1.03] md:group-hover/product:scale-[1.11]" loading="lazy" decoding="async" width="360" height="432" onLoad={(event) => event.currentTarget.classList.remove("opacity-0")} />
          ) : (
            <div className="grid h-full w-full place-items-center rounded-[1rem] bg-white/70 text-center text-xs font-black text-stone-400 dark:bg-white/5 dark:text-stone-500 md:rounded-[1.15rem]">
              <Sparkles className="h-6 w-6 opacity-50" />
            </div>
          )}
        </Link>
        <div className="absolute right-2 top-2 z-20 flex flex-col items-start gap-1 md:right-2.5 md:top-2.5">
          {rank && railType === "bestseller" && rank <= 3 ? <span className="inline-flex h-5 items-center rounded-full bg-white/95 px-2 text-[9px] font-black leading-none text-stone-950 shadow-sm backdrop-blur md:h-6 md:px-2.5 md:text-[10px] dark:bg-white dark:text-stone-950">TOP {rank}</span> : null}
          {discountPercent ? <span className="inline-flex h-5 items-center rounded-full border border-[#7c3aed]/15 bg-white/95 px-2 text-[9px] font-black leading-none text-[#6d28d9] shadow-sm backdrop-blur md:h-6 md:px-2.5 md:text-[10px] dark:border-white/10 dark:bg-[#0b1020] dark:text-[#d8b4fe]">-{discountPercent}%</span> : null}
        </div>
        <button onClick={(event) => { event.stopPropagation(); handleWishlist(); }} className="absolute left-2 top-2 z-20 rounded-full bg-white/95 p-1.5 shadow-sm ring-1 ring-stone-200/70 transition duration-200 hover:scale-110 hover:text-rose-500 active:scale-95 md:left-2.5 md:top-2.5 md:p-1.5 dark:bg-white/5 dark:text-stone-100 dark:ring-white/10" aria-label={t("storefront.header.wishlist", "Wishlist")}>
          <Heart className={`h-3.5 w-3.5 transition md:h-5 md:w-5 ${inWishlist ? "animate-[wishlist-pop_320ms_ease-out] fill-rose-500 text-rose-500" : "text-stone-700 dark:text-stone-200"}`} />
        </button>
        <button
          type="button"
          onClick={handleMobileCart}
          disabled={!sellableVariants.length && !canQuickAdd}
          className="absolute bottom-2 left-2 z-30 grid h-8 w-8 place-items-center rounded-full border border-white/25 bg-stone-950/88 text-white shadow-[0_10px_24px_rgba(0,0,0,0.24)] backdrop-blur transition active:scale-95 disabled:opacity-45 md:hidden"
          aria-label={directAddVariant ? t("storefront.cart.addToCart", "Add to cart") : t("storefront.products.chooseSize", "Choose size")}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
        </button>
        <div className="absolute bottom-2.5 left-1/2 z-40 -translate-x-1/2 md:bottom-3">
          <button
            onClick={handleQuickAdd}
            disabled={!canQuickAdd}
            className="sf-shimmer-button hidden min-h-10 min-w-[8.75rem] transform-gpu items-center justify-center gap-1.5 rounded-full border border-white/20 bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 px-4 py-2.5 text-[11px] font-black text-white shadow-[0_10px_28px_rgba(124,58,237,0.38)] backdrop-blur transition-[transform,box-shadow,filter] duration-300 ease-out hover:scale-[1.045] hover:brightness-110 hover:shadow-[0_16px_42px_rgba(124,58,237,0.58)] active:scale-[0.96] disabled:cursor-not-allowed disabled:border-white/10 disabled:from-stone-500/70 disabled:via-stone-500/70 disabled:to-stone-600/70 disabled:text-white/60 disabled:shadow-none disabled:hover:scale-100 md:inline-flex md:min-h-11 md:min-w-[9.25rem] md:px-4"
          >
            <ShoppingCart className="h-4 w-4" />
            {canQuickAdd ? t("storefront.cart.quickAdd", "Quick add") : t("storefront.products.unavailable", "Unavailable")}
          </button>
        </div>
          {product.low_stock ? <span className="absolute bottom-2 right-2 z-20 inline-flex h-5 items-center rounded-full border border-amber-200 bg-amber-50/95 px-2 text-[9px] font-black leading-none text-amber-800 shadow-sm backdrop-blur md:bottom-auto md:left-12 md:right-auto md:top-2.5 md:h-6 md:px-2.5 md:text-[10px] dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">{t("storefront.products.onlyLeft", "{{count}} left", { count: product.total_stock })}</span> : null}
      </div>
        <div className={`flex flex-1 flex-col md:p-3.5 md:pt-3 ${densityClasses.body}`}>
        <Link to={detailsUrl} className={`line-clamp-2 font-extrabold tracking-normal text-stone-900 transition hover:text-[#6d28d9] md:h-10 md:text-[13.5px] md:leading-5 dark:text-stone-100 ${densityClasses.title}`}>{product.name}</Link>
        <div className="mt-1 flex min-h-5 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 md:mt-2 md:min-h-6 md:gap-x-2">
          <span className={`font-black leading-none text-stone-950 md:text-[1.22rem] dark:text-white ${densityClasses.price}`}>{money(sellingPrice)}</span>
          {comparePrice ? <span className="text-[10.5px] font-semibold leading-none text-stone-400 line-through dark:text-stone-500 md:text-[11px]">{money(comparePrice)}</span> : null}
          {discountPercent ? <span className="rounded-full bg-[#7c3aed]/10 px-1.5 py-0.5 text-[9px] font-black leading-none text-[#6d28d9] dark:bg-[#d8b4fe]/10 dark:text-[#d8b4fe]">-{discountPercent}%</span> : null}
        </div>
        {colorGroups.length > 1 ? (
          <div className="mt-1.5 flex min-h-6 items-center gap-1 overflow-hidden md:mt-2 md:min-h-7 md:gap-1.5">
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
        <div className={`sf-scroll flex flex-nowrap overflow-x-auto pb-0.5 md:mt-2.5 md:min-h-12 md:flex-wrap md:content-start md:gap-1 md:overflow-hidden ${densityClasses.sizes}`}>
          {visibleSizes.map(({ size, variant }) => {
            const selected = String(availableVariant?.id) === String(variant?.id);
            return (
              <button
                key={`${activeColorGroup?.key || "default"}-${size}`}
                type="button"
                onClick={(event) => { event.stopPropagation(); setSelectedVariantId(variant.id); setSelectedColorKeyState(variantColorKey(variant)); }}
                className={`inline-flex shrink-0 items-center justify-center rounded-full border font-black leading-none transition duration-200 md:h-6 md:px-2 md:text-[10px] ${densityClasses.chip} ${selected ? "border-[#7c3aed] bg-[#6d28d9] text-white shadow-[0_8px_18px_rgba(124,58,237,0.22)] dark:border-[#d8b4fe] dark:bg-[#d8b4fe] dark:text-stone-950" : "border-stone-200/80 bg-white/[0.62] text-stone-600 opacity-75 hover:border-[#7c3aed]/45 hover:text-[#6d28d9] hover:opacity-100 dark:border-white/10 dark:bg-white/[0.045] dark:text-stone-300 dark:opacity-70 dark:hover:border-[#d8b4fe]/50 dark:hover:text-white dark:hover:opacity-100"} disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-300 disabled:line-through disabled:opacity-45 dark:disabled:bg-white/5 dark:disabled:text-stone-500`}
              >
                {size}
              </button>
            );
          })}
          {extraSizeCount ? (
            <span dir="ltr" className="inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-stone-200/80 bg-white/[0.58] px-2 text-[9px] font-black leading-none text-stone-400 opacity-80 md:text-[10px] dark:border-white/10 dark:bg-white/[0.045] dark:text-stone-500">+{extraSizeCount}</span>
          ) : null}
          {!visibleSizes.length ? (
            <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-stone-200 bg-white/[0.58] px-2 text-[9px] font-bold leading-none text-stone-400 md:text-[10px] dark:border-white/10 dark:bg-white/5 dark:text-stone-500">{t("storefront.products.oneSize", "One size")}</span>
          ) : null}
        </div>
      </div>
      {variantSheetOpen ? (
        <Suspense fallback={null}>
          <LazyProductCardVariantSheet
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
            onClose={() => setVariantSheetOpen(false)}
            onAdd={(variant, quantity) => {
              addToCart(product, variant, quantity);
              setVariantSheetOpen(false);
            }}
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
    prev.addToCart === next.addToCart &&
    prev.railType === next.railType &&
    prev.rank === next.rank &&
    prev.featured === next.featured &&
    prev.density === next.density &&
    prev.sizeLimit === next.sizeLimit
  );
});

function ProductCardVariantSheet({
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
  const activeGroup = colorGroups.find((group) => String(group.key) === String(selectedColorKey)) || colorGroups[0] || null;
  const sizeOptions = getSizesForColorGroup(activeGroup);
  const selectedVariant = sizeOptions.find((item) => String(item.variant?.id) === String(selectedVariantId))?.variant
    || firstDisplayVariant(activeGroup?.variants || [])
    || null;
  const maxQty = Math.max(1, Number(selectedVariant?.stock || 1));
  const safeQty = Math.min(Math.max(1, Number(quantity || 1)), maxQty);

  return createPortal(
    <div className="fixed inset-0 z-[80] md:hidden" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="absolute inset-0 bg-stone-950/62 backdrop-blur-sm" onClick={onClose} aria-label={t("common.close", "Close")} />
      <section className="absolute inset-x-0 bottom-0 rounded-t-[1.55rem] border border-white/10 bg-[linear-gradient(180deg,#101426_0%,#070b16_100%)] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.42)]">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#d8b4fe]">{t("storefront.products.chooseSize", "Choose size")}</p>
            <h3 className="mt-1 line-clamp-2 text-base font-black leading-5">{product?.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/75">
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

function ProductDetails({ addToCart, toggleWishlist, wishlist, rememberProduct, recent, profile }) {
  const { identifier } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const productQueryKey = searchParams.toString();
  const profilePhone = profile?.primary_phone || profile?.phone || "";
  const [state, setState] = useState({ loading: true, product: null, error: "" });
  const [selected, setSelected] = useState({ variantId: "", size: "", colorKey: "", colorName: "", image: "" });
  const [qty, setQty] = useState(1);
  const [showMobileBuyBar, setShowMobileBuyBar] = useState(false);
  const [variantSheetAction, setVariantSheetAction] = useState("");
  const [touchedOptions, setTouchedOptions] = useState({ color: false, size: false });
  const mainCtaRef = useRef(null);
  const recentlyViewedSentRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const routeValue = String(identifier || "");
    const decodedRouteValue = (() => {
      try {
        return decodeURIComponent(routeValue);
      } catch {
        return routeValue;
      }
    })();
    const unresolvedSearchUrl = `/shop/products?q=${encodeURIComponent(decodedRouteValue.replace(/-/g, " "))}`;
    if (storefrontDebugEnabled()) console.log("[storefront-product] useParams identifier", { identifier: routeValue });
    try {
      sessionStorage.removeItem(`storefront.product.${routeValue}`);
      localStorage.removeItem(`storefront.product.${routeValue}`);
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }
    storefrontApi.getProductDetails(routeValue, { signal: controller.signal }).then((data) => {
      const product = productFromDetailsResponse(data);
      if (storefrontDebugEnabled()) console.log("[storefront-product] resolver response", {
        routeIdentifier: routeValue,
        resolverStatus: data?.success === true ? "resolved" : "unresolved",
        resolvable: data?.resolvable,
        productIdLoaded: product?.id || null,
        notFoundReason: product ? "" : data?.message || "empty_product_payload",
      });
      if (storefrontDebugEnabled()) console.log("[storefront-product] final product object", product);
      if (!product) {
        if (!cancelled) {
          console.warn("[storefront-product] redirecting unresolved product", {
            routeIdentifier: routeValue,
            resolverStatus: data?.success === true ? "resolved_without_product" : "not_found",
            notFoundReason: data?.message || "empty_product_payload",
            redirectTo: unresolvedSearchUrl,
          });
          navigate(unresolvedSearchUrl, { replace: true });
        }
        return;
      }
      const productVariants = Array.isArray(product?.variants) ? product.variants : [];
      const routeSearchParams = new URLSearchParams(productQueryKey);
      const requestedVariantId = routeSearchParams.get("variant") || routeSearchParams.get("variantId") || "";
      const requestedSize = routeSearchParams.get("size") || "";
      const requestedColor = routeSearchParams.get("color") || "";
      const requestedColorKey = String(requestedColor || "").trim().toLowerCase();
      const requested = productVariants.find((variant) => requestedVariantId && String(variant.id) === String(requestedVariantId) && variantHasStock(variant))
        || productVariants.find((variant) => requestedVariantId && String(variant.edition_slug || "") === String(requestedVariantId) && variantHasStock(variant))
        || productVariants.find((variant) => requestedSize && String(variant.size) === requestedSize && (!requestedColor || variantColorKey(variant) === requestedColorKey || variantColorName(variant).toLowerCase() === requestedColorKey) && variantHasStock(variant))
        || productVariants.find((variant) => requestedSize && String(variant.size) === requestedSize && variantHasStock(variant));
      const first = requested || firstDisplayVariant(productVariants);
      if (!cancelled) {
        setState({ loading: false, product, error: "" });
        setSelected({
          variantId: first?.id || "",
          size: first?.size || "",
          colorKey: first ? variantColorKey(first) : "",
          colorName: first ? variantColorName(first) : "",
          image: variantImage(first) || displayImageForProduct(product, first) || "",
        });
        setTouchedOptions({ color: false, size: false });
        try {
          rememberProduct(product);
          const phone = profilePhone;
          const recentlyViewedKey = `${product.id}:${phone || getSessionId()}`;
          if (recentlyViewedSentRef.current !== recentlyViewedKey) {
            recentlyViewedSentRef.current = recentlyViewedKey;
            api.post("/storefront/recently-viewed", { product_id: product.id, session_id: getSessionId(), phone }).catch(() => undefined);
          }
        } catch (sideEffectError) {
          console.warn("[storefront-product] post-load side effect skipped", sideEffectError);
        }
      }
    }).catch((error) => {
      if (!cancelled && error?.cause?.name !== "AbortError") {
        console.warn("[storefront-product] resolver failed", {
          routeIdentifier: routeValue,
          resolverUrl: error?.url || "",
          resolverStatus: error?.status || "network_error",
          productIdLoaded: null,
          notFoundReason: error?.responseBody?.message || error.message || "resolver_failed",
          redirectTo: unresolvedSearchUrl,
        });
        if (error?.status === 404) {
          navigate(unresolvedSearchUrl, { replace: true });
          return;
        }
        setState({ loading: false, product: null, error: error.message });
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [identifier, navigate, productQueryKey, profilePhone, rememberProduct]);

  const product = state.product;
  const variants = useMemo(() => product?.variants || [], [product]);
  const colorGroups = useMemo(() => {
    const groups = new Map();
    variants.forEach((item) => {
      const color = variantColorName(item);
      const key = variantColorKey(item);
      if (!groups.has(key)) {
        groups.set(key, { key, color, colorName: color, image_url: variantPrimaryImage(item), images: [], variants: [] });
      }
      const group = groups.get(key);
      const images = Array.isArray(item.images) ? item.images : Array.isArray(item.color_images) ? item.color_images : [];
      const sourceImages = images.length
        ? images
        : variantPrimaryImage(item)
          ? [{ image_url: variantPrimaryImage(item), preview: variantPrimaryImage(item), is_primary: true }]
          : [];
      group.images = [...group.images, ...sourceImages].reduce((acc, image) => {
        const keyImage = String(image?.image_url || image?.preview || "");
        if (!keyImage || acc.some((entry) => String(entry?.image_url || entry?.preview || "") === keyImage)) return acc;
        acc.push(image);
        return acc;
      }, []);
      if (!group.image_url) {
        group.image_url = variantPrimaryImage(item);
      }
      group.variants.push(item);
    });
    return Array.from(groups.values()).map((group) => ({
      ...group,
      primaryImage: group.images.find((image) => image?.is_primary) || group.images[0] || null,
    }));
  }, [variants]);
  const selectedVariant = variants.find((item) => String(item.id) === String(selected.variantId));
  const selectedColorKey = selected.colorKey || (selectedVariant ? variantColorKey(selectedVariant) : "");
  const selectedColorGroup = colorGroups.find((group) => String(group.key || "") === String(selectedColorKey)) || colorGroups[0] || null;
  const variantGroup = selectedColorKey ? variants.filter((item) => variantColorKey(item) === selectedColorKey) : variants;
  const sizes = [...new Set(variantGroup.map((variant) => variant.size).filter(Boolean))];
  const colors = colorGroups;
  const variant = variants.find((item) => String(item.id) === String(selected.variantId))
    || variants.find((item) => item.size === selected.size && (!selectedColorKey || variantColorKey(item) === selectedColorKey) && variantHasStock(item))
    || firstDisplayVariant(variants);
  const colorGalleryImages = (selectedColorGroup?.images || []).filter(Boolean);
  const thumbnailVariants = [...new Map(
    variants
      .filter((item) => variantImage(item))
      .sort((a, b) => Number(variantHasStock(b)) - Number(variantHasStock(a)))
      .map((item) => [`${variantImage(item)}:${item.color || ""}`, item])
  ).values()];
  const fallbackProductImage = !thumbnailVariants.length && product?.image_url ? [product.image_url] : [];
  const mainImage = selected.image || variantImage(variant) || selectedColorGroup?.primaryImage?.image_url || selectedColorGroup?.primaryImage?.preview || firstVariantImage(variants) || product?.image_url || "";
  const galleryItems = [
    ...colorGalleryImages.map((image) => ({
      image: compactImageValue(image?.image_url || image?.preview || ""),
      variant: selectedColorGroup?.variants?.find((item) => variantImages(item).includes(compactImageValue(image?.image_url || image?.preview || ""))) || null,
    })),
    ...thumbnailVariants.flatMap((item) => variantImages(item).map((image) => ({ image, variant: item }))),
    ...fallbackProductImage.map((image) => ({ image, variant: null })),
  ].filter((item) => item.image).reduce((acc, item) => (acc.some((entry) => entry.image === item.image) ? acc : [...acc, item]), []);
  const mirrorProduct = product ? isMirrorProduct(product) : false;
  const displayTitle = cleanDisplayText(product ? mirrorProductTitle(product, variant) || product.name : "");
  const selectedPrice = resolveStorefrontPrice(product, variant);
  const selectedSellingPrice = selectedPrice.activePrice || displaySellingPrice(product, variant);
  const selectedComparePrice = selectedPrice.comparePrice || displayComparePrice(product, variant);
  const selectedDiscountPercent = selectedComparePrice > selectedSellingPrice ? Math.max(1, Math.round(((selectedComparePrice - selectedSellingPrice) / selectedComparePrice) * 100)) : 0;
  const descriptionText = cleanDisplayText(product?.seo_description || product?.description_ar || product?.description_en || product?.description)
    || "تصميم عملي بخامة Premium مناسب للخروج اليومي وسهل التنسيق مع ستايلات مختلفة.";
  const inWishlist = product && wishlist.some((item) => String(item.id) === String(product.id));
  useEffect(() => {
    if (!product) return;
    document.title = mirrorProduct ? displayTitle : cleanDisplayText(product.name) || document.title;
    applyProductSocialMeta(productToSocialMeta(product));
  }, [product, mirrorProduct, displayTitle]);
  useEffect(() => {
    const node = mainCtaRef.current;
    if (!node || typeof window === "undefined") return undefined;
    if (!("IntersectionObserver" in window)) {
      let cancelled = false;
      deferReactState(() => {
        if (!cancelled) setShowMobileBuyBar(false);
      });
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowMobileBuyBar(!entry.isIntersecting);
      },
      {
        threshold: 0.2,
        rootMargin: "0px 0px -112px 0px",
      }
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      setShowMobileBuyBar(false);
    };
  }, [product?.id]);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.style.setProperty("--product-sticky-actions-height", showMobileBuyBar ? "74px" : "0px");
    return () => {
      document.documentElement.style.setProperty("--product-sticky-actions-height", "0px");
    };
  }, [showMobileBuyBar]);
  const selectVariant = (candidate, options = {}) => {
    if (!candidate) return;
    const candidateColorKey = variantColorKey(candidate);
    let nextVariant = candidate;
    if (options.preserveSize && selected.size) {
      const sameSize = variants.find((item) => variantColorKey(item) === candidateColorKey && String(item.size || "") === String(selected.size) && variantHasStock(item))
        || variants.find((item) => variantColorKey(item) === candidateColorKey && String(item.size || "") === String(selected.size));
      if (sameSize) nextVariant = sameSize;
    }
    const nextColorGroup = colorGroups.find((group) => group.key === candidateColorKey) || null;
    const nextImage = options.image || variantImage(nextVariant) || nextColorGroup?.primaryImage?.image_url || nextColorGroup?.primaryImage?.preview || displayImageForProduct(product, nextVariant) || "";
    setQty(1);
    setSelected({
      variantId: nextVariant.id || "",
      size: nextVariant.size || "",
      colorKey: variantColorKey(nextVariant),
      colorName: variantColorName(nextVariant),
      image: nextImage,
    });
  };
  const selectColor = (group) => {
    const colorKey = group?.key || "";
    const candidates = variants.filter((item) => variantColorKey(item) === colorKey);
    const candidate = candidates.find((item) => item.size === selected.size && variantHasStock(item))
      || candidates.find(variantHasStock)
      || candidates[0];
    if (!candidate) return;
    setTouchedOptions((prev) => ({ ...prev, color: true }));
    selectVariant(candidate, { preserveSize: true, image: variantImage(candidate) || group?.primaryImage?.image_url || group?.primaryImage?.preview || "" });
  };
  const selectSize = (size) => {
    const candidates = variants.filter((item) => String(item.size || "") === String(size) && (!selectedColorKey || variantColorKey(item) === selectedColorKey));
    const candidate = candidates.find(variantHasStock) || candidates[0];
    setTouchedOptions((prev) => ({ ...prev, size: true }));
    selectVariant(candidate);
  };
  const selectGalleryImage = (item) => {
    if (item?.variant) {
      selectVariant(item.variant, { image: item.image });
      return;
    }
    setSelected((prev) => ({ ...prev, image: item?.image || "" }));
  };
  const submitVariant = (candidate = variant, quantity = qty, action = "cart") => {
    if (!product || !candidate || Number(candidate.stock || 0) <= 0) return;
    const result = addToCart(product, candidate, quantity);
    if (result === "capture_required") return;
    setVariantSheetAction("");
    if (action === "buy") navigate("/shop/checkout");
  };
  const buyNow = () => {
    submitVariant(variant, qty, "buy");
  };
  const hasMultipleVariantOptions = colors.length > 1 || sizes.length > 1 || variants.length > 1;
  const colorSelectionReady = colors.length <= 1 || touchedOptions.color;
  const sizeSelectionReady = sizes.length <= 1 || touchedOptions.size;
  const canSubmitDirectly = !hasMultipleVariantOptions || (colorSelectionReady && sizeSelectionReady);
  const requestMobilePurchase = (action) => {
    if (!product || !variant || Number(variant.stock || 0) <= 0) return;
    if (hasMultipleVariantOptions && !canSubmitDirectly) {
      setVariantSheetAction(action);
      return;
    }
    submitVariant(variant, qty, action);
  };
  const addFromStickyBar = () => {
    requestMobilePurchase("cart");
    setShowMobileBuyBar(false);
  };
  const buyFromStickyBar = () => {
    requestMobilePurchase("buy");
  };
  const shareProduct = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: displayTitle, text: descriptionText, url });
        return;
      }
      await navigator.clipboard?.writeText(url);
      toast.success(sfText("storefront.toasts.productLinkCopied", "Product link copied."));
    } catch {
      // User cancelled native share.
    }
  };

  if (state.loading) return <section className="mx-auto max-w-7xl px-4 py-6"><ProductSkeleton count={2} /></section>;
  if (!product) return <EmptyState title={sfText("storefront.products.notFoundTitle", "Product not found")} text={sfText("storefront.products.notFoundText", "Go back to products and try another choice")} />;

  return (
    <section dir="rtl" className="sf-product-details-page mx-auto grid max-w-7xl gap-2 px-3 pb-28 pt-1 md:gap-5 md:px-4 md:pb-36 md:pt-5 lg:grid-cols-[minmax(0,55fr)_minmax(360px,45fr)] lg:items-start lg:pb-8">
      <div className="min-w-0">
        <div className="sf-product-gallery-frame relative mx-auto h-[clamp(250px,42vh,340px)] w-full max-w-[92vw] overflow-hidden rounded-[24px] border border-stone-200 bg-[linear-gradient(180deg,#fbfaf7_0%,#f1ece4_100%)] p-2 shadow-[0_14px_40px_rgba(39,20,75,0.10)] md:h-[clamp(420px,58vh,540px)] md:max-w-none md:rounded-[1.75rem] md:p-5 md:shadow-[0_20px_55px_rgba(39,20,75,0.10)]">
          <div className="absolute inset-x-10 bottom-5 h-12 rounded-full bg-white/80 blur-2xl md:inset-x-16 md:bottom-8 md:h-16" />
          <img src={imageFor(mainImage)} alt={displayTitle} className="sf-product-main-image relative z-10 mx-auto h-full w-full object-contain drop-shadow-[0_14px_18px_rgba(39,20,75,0.14)] md:max-h-full md:drop-shadow-[0_22px_26px_rgba(39,20,75,0.18)]" loading="eager" decoding="async" fetchPriority="high" width="900" height="675" />
        </div>
        {galleryItems.length > 1 ? (
          <div className="sf-product-thumbnails sf-scroll mt-1.5 flex snap-x snap-mandatory gap-1.5 overflow-x-auto pb-1 md:mt-3 md:gap-2">
            {galleryItems.map((item, imageIndex) => {
              const image = item.image;
              const active = mainImage === image || selected.image === image;
              return (
                <button
                  key={`${image}-${imageIndex}`}
                  type="button"
                  onClick={() => selectGalleryImage(item)}
                  className={`sf-product-thumb h-12 w-12 shrink-0 snap-start overflow-hidden rounded-xl border bg-white p-1 transition hover:-translate-y-0.5 hover:border-stone-900 md:h-20 md:w-20 md:rounded-2xl md:p-1.5 ${active ? "border-stone-950 shadow-[0_12px_28px_rgba(39,20,75,0.14)]" : "border-stone-200"}`}
                >
                  <img src={imageFor(image)} alt="" className="h-full w-full object-contain" loading="lazy" decoding="async" width="80" height="80" />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="sf-product-info-sticky min-w-0 lg:sticky lg:self-start">
        <div className="overflow-hidden rounded-[1rem] border border-white/[0.08] bg-[linear-gradient(180deg,#07111f_0%,#050b16_100%)] p-3.5 text-white shadow-[0_24px_70px_rgba(0,0,0,0.35)] md:rounded-[1.45rem] md:p-6">
          <div className="mb-2 flex items-start justify-between gap-3 md:mb-4">
            <div className="min-w-0">
              <div className="mt-1.5 hidden text-[11px] font-black text-[#c4b5fd] md:mt-3 md:block md:text-xs">{sfText("storefront.products.curatedDetails", "Carefully selected product details")}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => toggleWishlist(product)} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 transition hover:border-rose-300/50 hover:bg-rose-500/10 hover:text-rose-300 md:h-11 md:w-11">
                <Heart className={`h-5 w-5 ${inWishlist ? "fill-rose-500 text-rose-500" : ""}`} />
              </button>
              <button type="button" onClick={shareProduct} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/75 transition hover:border-white/25 hover:bg-white/[0.09] hover:text-white md:h-11 md:w-11">
                <Share2 className="h-5 w-5" />
              </button>
            </div>
          </div>
          <h1 className="text-[1.45rem] font-black leading-tight tracking-normal text-white md:text-4xl">{displayTitle}</h1>
          {mirrorProduct && variant?.edition_name ? (
            <div className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-xs font-black text-white/65">
              {cleanDisplayText(variant.edition_name)}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-2 text-xs font-bold text-white/60 md:mt-3 md:text-sm">
            <span className="flex gap-0.5 text-amber-400">{Array.from({ length: 5 }).map((_, index) => <Star key={index} className="h-4 w-4 fill-current" />)}</span>
            <span className="text-white">4.8</span>
            <span className="text-white/25">|</span>
            <span>{sfText("storefront.products.verifiedReviews", "Verified reviews")}</span>
          </div>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/65 md:mt-4 md:text-[15px] md:leading-[1.8]">{descriptionText}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 md:mt-5 md:items-end md:gap-3">
            <span className="text-3xl font-black leading-none text-white md:text-3xl">{money(selectedSellingPrice)}</span>
            {selectedComparePrice ? <span className="text-sm font-bold text-white/35 line-through md:text-base">{money(selectedComparePrice)}</span> : null}
            {selectedDiscountPercent ? <span className="rounded-full border border-emerald-300/20 bg-emerald-400/12 px-2 py-1 text-[10px] font-black text-emerald-100">{sfText("storefront.products.discountBadge", "-{{percent}}%", { percent: selectedDiscountPercent })}</span> : null}
          </div>
          <Selector title={sfText("storefront.products.chooseColor", "Choose color")}>
            {colors.map((group) => {
              const hasStock = group.variants.some((item) => variantHasStock(item));
              return <Choice key={group.key} active={selectedColorKey === group.key} disabled={!hasStock} onClick={() => selectColor(group)}>{group.colorName || group.color}</Choice>;
            })}
          </Selector>
          <Selector
            title={sfText("storefront.products.chooseSize", "Choose size")}
            help={
              <Link
                to="/shop/size-guide"
                className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-black text-white/70 transition hover:border-white/25 hover:bg-white/[0.09] hover:text-white"
              >
                {sfText("storefront.nav.sizeGuide", "Size guide")}
              </Link>
            }
          >
            {sizes.map((size) => {
              const hasStock = variantGroup.some((item) => item.size === size && variantHasStock(item));
              return <Choice key={size} active={selected.size === size} disabled={!hasStock} onClick={() => selectSize(size)}>{size}</Choice>;
            })}
          </Selector>
          {variant && Number(variant.stock || 0) <= 0 ? <p className="mt-3 text-sm font-bold text-rose-600">{sfText("storefront.products.variantUnavailable", "This size or color is currently unavailable")}</p> : null}
          {variant && Number(variant.stock || 0) > 0 && Number(variant.stock || 0) <= 3 ? <div className="mt-3 inline-flex rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1.5 text-xs font-black text-amber-100">{sfText("storefront.products.onlyLeft", "Only {{count}} left", { count: variant.stock })}</div> : null}
          <div className="mt-4 hidden items-center gap-3 md:flex">
            <button onClick={() => setQty(Math.max(1, qty - 1))} className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.055] text-white/80 transition hover:border-white/25 hover:bg-white/[0.09]"><Minus className="h-4 w-4" /></button>
            <span className="grid h-11 min-w-12 place-items-center rounded-full border border-white/10 bg-black/20 px-4 text-center font-black text-white">{qty}</span>
            <button onClick={() => setQty(Math.min(Number(variant?.stock || 1), qty + 1))} className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.055] text-white/80 transition hover:border-white/25 hover:bg-white/[0.09]">+</button>
          </div>
          <div ref={mainCtaRef} className="mt-5 hidden grid-cols-2 gap-3 md:grid">
            <button onClick={() => addToCart(product, variant, qty)} disabled={!variant || Number(variant.stock || 0) <= 0} className="rounded-full border border-white/14 bg-white/[0.045] px-5 py-4 font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.035] disabled:text-white/30 disabled:shadow-none">{sfText("storefront.cart.addToCart", "Add to cart")}</button>
            <button onClick={buyNow} disabled={!variant || Number(variant.stock || 0) <= 0} className="rounded-full bg-white px-5 py-4 font-black text-stone-950 shadow-[0_18px_38px_rgba(255,255,255,0.16)] transition hover:-translate-y-0.5 hover:bg-[#f5f3ff] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 disabled:shadow-none">{sfText("storefront.cart.buyNow", "Buy now")}</button>
          </div>
          <a href="https://wa.me/" className="mt-4 inline-flex items-center gap-2 text-sm font-black text-white/62 transition hover:text-white"><Phone className="h-4 w-4" /> {sfText("storefront.support.sizeHelp", "Need help with sizing?")}</a>
          <div className="mt-6 grid grid-cols-2 gap-2 text-sm font-bold text-white/75">
            <InfoLine icon={<Truck className="h-4 w-4" />} text={sfText("storefront.checkout.trust.fastShipping", "Fast shipping")} />
            <InfoLine icon={<PackageCheck className="h-4 w-4" />} text={sfText("storefront.checkout.trust.exchange", "Exchange within 14 days")} />
            <InfoLine icon={<ShieldCheck className="h-4 w-4" />} text={sfText("storefront.checkout.trust.safeData", "Secure payment")} />
            <InfoLine icon={<Sparkles className="h-4 w-4" />} text={sfText("storefront.products.premiumMaterial", "Premium material")} />
          </div>
        </div>
        <RelatedProducts currentId={product.id} addToCart={addToCart} toggleWishlist={toggleWishlist} wishlist={wishlist} recent={recent} />
        <RecentProductsSection currentId={product.id} recent={recent} />
      </div>
      <MobileBuyBar product={product} variant={variant} visible={showMobileBuyBar} addToCart={addFromStickyBar} buyNow={buyFromStickyBar} />
      {variantSheetAction ? (
        <Suspense fallback={null}>
          <LazyProductDetailsVariantSheet
            product={product}
            variant={variant}
            colors={colors}
            sizes={sizes}
            selectedColorKey={selectedColorKey}
            selectedSize={selected.size}
            quantity={qty}
            action={variantSheetAction}
            onClose={() => setVariantSheetAction("")}
            onColorSelect={selectColor}
            onSizeSelect={selectSize}
            onQuantityChange={setQty}
            onSubmit={(candidate, quantity) => submitVariant(candidate, quantity, variantSheetAction)}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

function Selector({ title, help, children }) {
  return (
    <div className="mt-5 border-t border-white/[0.06] pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-black text-white">{title}</h3>
        {help}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Choice({ active, disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative min-w-10 overflow-hidden rounded-full border px-3 py-1.5 text-xs font-black transition md:min-w-12 md:px-4 md:py-2.5 md:text-sm ${
        active
          ? "border-white bg-white text-stone-950 shadow-[0_12px_28px_rgba(255,255,255,0.12)]"
          : disabled
            ? "cursor-not-allowed border-white/[0.07] bg-white/[0.035] text-white/25 opacity-60"
            : "border-white/10 bg-white/[0.055] text-white/78 hover:border-white/25 hover:bg-white/[0.09] hover:text-white"
      }`}
    >
      {disabled ? <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[120%] -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] bg-white/35" /> : null}
      <span className="relative z-10">{children}</span>
    </button>
  );
}

function ProductDetailsVariantSheet({
  product,
  variant,
  colors = [],
  sizes = [],
  selectedColorKey = "",
  selectedSize = "",
  quantity = 1,
  action = "cart",
  onClose,
  onColorSelect,
  onSizeSelect,
  onQuantityChange,
  onSubmit,
}) {
  const activeColor = colors.find((group) => String(group.key) === String(selectedColorKey)) || colors[0] || null;
  const activeVariants = activeColor?.variants || [];
  const activeVariant = activeVariants.find((item) => String(item.size || "") === String(selectedSize) && variantHasStock(item))
    || activeVariants.find((item) => String(item.id) === String(variant?.id) && variantHasStock(item))
    || variant;
  const maxQty = Math.max(1, Number(activeVariant?.stock || 1));
  const safeQty = Math.min(Math.max(1, Number(quantity || 1)), maxQty);
  const price = displaySellingPrice(product, activeVariant);
  const finalLabel = action === "buy" ? sfText("storefront.cart.buyNow", "Buy now") : sfText("storefront.cart.addToCart", "Add to cart");

  return createPortal(
    <div className="fixed inset-0 z-[85] md:hidden" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-stone-950/62 backdrop-blur-sm" onClick={onClose} aria-label={sfText("storefront.common.close", "Close")} />
      <section className="absolute inset-x-0 bottom-0 rounded-t-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,#101426_0%,#070b16_100%)] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.42)]">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <div className="flex items-start gap-3">
          <img src={imageFor(displayImageForProduct(product, activeVariant))} alt="" className="h-16 w-16 shrink-0 rounded-2xl bg-white/8 object-contain p-1.5" loading="lazy" decoding="async" width="64" height="64" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#d8b4fe]">{sfText("storefront.products.selectOptions", "Select options")}</p>
            <h3 className="mt-1 line-clamp-2 text-base font-black leading-5">{cleanDisplayText(product?.name)}</h3>
            <div className="mt-1 text-lg font-black">{money(price)}</div>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/75" aria-label={sfText("storefront.common.close", "Close")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {colors.length > 1 ? (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-black text-white/50">{sfText("storefront.products.chooseColor", "Choose color")}</div>
            <div className="sf-scroll flex gap-2 overflow-x-auto pb-1">
              {colors.map((group) => {
                const active = String(group.key) === String(activeColor?.key);
                const hasStock = group.variants.some((item) => variantHasStock(item));
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => onColorSelect(group)}
                    disabled={!hasStock}
                    className={`min-h-9 shrink-0 rounded-full border px-3 py-2 text-xs font-black transition ${active ? "border-[#d8b4fe]/70 bg-[#7c3aed] text-white shadow-[0_12px_28px_rgba(124,58,237,0.32)]" : "border-white/10 bg-white/6 text-white/70"} disabled:cursor-not-allowed disabled:opacity-35`}
                  >
                    {group.colorName || group.color}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-4">
          <div className="mb-2 text-[11px] font-black text-white/50">{sfText("storefront.products.chooseSize", "Choose size")}</div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const hasStock = activeVariants.some((item) => String(item.size || "") === String(size) && variantHasStock(item));
              const active = String(selectedSize) === String(size);
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => onSizeSelect(size)}
                  disabled={!hasStock}
                  className={`relative min-w-11 overflow-hidden rounded-full border px-3 py-1.5 text-xs font-black transition ${active ? "border-white bg-white text-stone-950" : hasStock ? "border-white/10 bg-white/6 text-white/75" : "cursor-not-allowed border-white/[0.07] bg-white/[0.035] text-white/25 opacity-60"}`}
                >
                  {!hasStock ? <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[120%] -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] bg-white/35" /> : null}
                  <span className="relative z-10">{size || sfText("storefront.products.oneSize", "One size")}</span>
                </button>
              );
            })}
          </div>
        </div>

        {activeVariant && Number(activeVariant.stock || 0) > 0 && Number(activeVariant.stock || 0) <= 3 ? (
          <div className="mt-3 inline-flex rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1.5 text-xs font-black text-amber-100">
            {sfText("storefront.products.onlyLeft", "Only {{count}} left", { count: activeVariant.stock })}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.045] p-2">
          <button type="button" onClick={() => onQuantityChange(Math.max(1, safeQty - 1))} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-lg font-black">-</button>
          <div className="text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/35">{sfText("storefront.cart.quantity", "Quantity")}</div>
            <div className="text-lg font-black">{safeQty}</div>
          </div>
          <button type="button" onClick={() => onQuantityChange(Math.min(maxQty, safeQty + 1))} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-lg font-black">+</button>
        </div>

        <button
          type="button"
          onClick={() => activeVariant && onSubmit(activeVariant, safeQty)}
          disabled={!activeVariant || !variantHasStock(activeVariant)}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-black text-stone-950 shadow-[0_14px_34px_rgba(255,255,255,0.16)] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
        >
          <ShoppingCart className="h-4 w-4" />
          {finalLabel}
        </button>
      </section>
    </div>,
    document.body
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
          <h2 className="text-xl font-black text-stone-950 dark:text-white">{sfText("storefront.products.similarProducts", "Similar products")}</h2>
          <p className="mt-1 text-xs font-bold text-stone-500 dark:text-white/55">{sfText("storefront.products.youMayAlsoLike", "You may also like")}</p>
        </div>
        <Link to="/shop/products" className="rounded-full border border-stone-200 bg-white/70 px-3 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:border-stone-950 dark:border-white/10 dark:bg-white/[0.055] dark:text-white/70 dark:hover:border-white/25 dark:hover:text-white">{sfText("storefront.common.viewAll", "View all")}</Link>
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
          <h2 className="text-xl font-black text-stone-950 dark:text-white">{sfText("storefront.account.recentlyViewed", "Recently viewed")}</h2>
          <p className="mt-1 text-xs font-bold text-stone-500 dark:text-white/55">{sfText("storefront.account.recentEmpty", "Recently viewed products will appear here")}</p>
        </div>
        <Link to="/shop/recently-viewed" className="rounded-full border border-stone-200 bg-stone-100 px-3 py-2 text-xs font-black text-stone-700 dark:border-white/10 dark:bg-white/[0.055] dark:text-white/70">{sfText("storefront.common.viewAll", "View all")}</Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <Link key={item.id} to={`/shop/product/${item.slug || item.id}`} className="min-w-0 rounded-2xl bg-stone-50 p-2 transition hover:-translate-y-0.5 dark:bg-white/[0.055]">
            <img src={imageFor(item.image_url)} alt="" className="aspect-square w-full rounded-xl object-cover" loading="lazy" decoding="async" width="240" height="240" />
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

function CartPage({ cart, updateCart, removeFromCart }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-3xl font-black">{sfText("storefront.cart.title", "Cart")}</h1>
      <CartContent cart={cart} updateCart={updateCart} removeFromCart={removeFromCart} />
    </section>
  );
}

function CartContent({ cart, updateCart, removeFromCart }) {
  const subtotal = cart.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  if (!cart.length) return <EmptyState title={sfText("storefront.cart.emptyTitle", "Your cart is waiting")} text={sfText("storefront.cart.emptyText", "Start from products and check the latest drops")} />;
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {cart.map((item) => (
          <div key={item.lineId} className="flex gap-3 rounded-3xl border border-stone-200 bg-white p-3">
            <img src={imageFor(item.image_url)} alt="" className="h-24 w-24 rounded-2xl object-cover" loading="lazy" decoding="async" width="96" height="96" />
            <div className="min-w-0 flex-1">
              <div className="font-black">{item.name}</div>
              <div className="mt-1 text-xs font-bold text-stone-500">{item.color || sfText("storefront.products.color", "Color")} / {item.size || sfText("storefront.products.size", "Size")}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-black">
                {displayCartItemComparePrice(item) ? <span className="text-sm text-stone-400 line-through">{money(displayCartItemComparePrice(item))}</span> : null}
                <span>{money(displayCartItemPrice(item))}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => updateCart(item.lineId, item.quantity - 1)} className="rounded-full border border-stone-200 p-2"><Minus className="h-4 w-4" /></button>
                <span className="w-7 text-center font-black">{item.quantity}</span>
                <button onClick={() => updateCart(item.lineId, item.quantity + 1)} className="rounded-full border border-stone-200 px-3 py-1.5">+</button>
                <button onClick={() => removeFromCart(item.lineId)} className="ms-auto rounded-full p-2 text-rose-600" aria-label={sfText("storefront.cart.removeItem", "Remove item")}><Trash2 className="h-5 w-5" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <OrderSummary subtotal={subtotal} />
    </div>
  );
}

function OrderSummary({ subtotal, delivery = 60 }) {
  return (
    <aside className="h-max rounded-3xl border border-stone-200 bg-white p-5">
      <h2 className="text-xl font-black">{sfText("storefront.checkout.orderSummary", "Order summary")}</h2>
      <SummaryRow label={sfText("storefront.checkout.products", "Products")} value={money(subtotal)} />
      <SummaryRow label={sfText("storefront.checkout.estimatedShipping", "Estimated shipping")} value={money(delivery)} />
      <SummaryRow label={sfText("storefront.checkout.total", "Total")} value={money(subtotal + delivery)} strong />
      <Link to="/shop/checkout" className="mt-5 block rounded-full bg-stone-950 px-5 py-4 text-center font-black text-white">{sfText("storefront.checkout.actions.completePurchase", "Complete purchase")}</Link>
      <p className="mt-3 text-xs font-bold text-stone-500">{sfText("storefront.checkout.finalCostNote", "The final cost appears on the checkout page based on governorate.")}</p>
    </aside>
  );
}

function CheckoutPage({ cart, clearCart, profile, setProfile }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: profile.full_name || "",
    primary_phone: profile.primary_phone || "",
    secondary_phone: "",
    governorate: "",
    city_area: "",
    detailed_address: "",
    landmark: "",
    delivery_notes: "",
    payment_method: "shipping_confirmation",
    coupon: "",
    order_notes: "",
  });
  const [shippingPaymentFile, setShippingPaymentFile] = useState(null);
  const [shippingPaymentPreviewUrl, setShippingPaymentPreviewUrl] = useState("");
  const [errors, setErrors] = useState({});
  const [customerTrust, setCustomerTrust] = useState({ loading: false, customer: null });
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState(1);
  const [manualCityArea, setManualCityArea] = useState(false);
  const [shippingTransferMethod, setShippingTransferMethod] = useState("instapay");
  const [paymentProofDragActive, setPaymentProofDragActive] = useState(false);
  const [paymentProofUploaded, setPaymentProofUploaded] = useState(false);
  const [latestAddressApplied, setLatestAddressApplied] = useState(false);
  const editedCheckoutFieldsRef = useRef(new Set());
  const latestAddressLookupsRef = useRef(new Set());
  const pricedCart = useMemo(() => cart.map((item) => ({ ...item, price: displayCartItemPrice(item) })), [cart]);
  const subtotal = pricedCart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = 0;
  const deliveryFee = form.governorate ? 60 : 0;
  const total = Math.max(0, subtotal - discount + deliveryFee);
  const isDamietta = ["دمياط", "دمياط"].some((name) => String(form.governorate || "").includes(name));
  const trustedCustomer = customerTrust.customer || {};
  const codAvailable =
    isDamietta ||
    Number(trustedCustomer.completed_orders || 0) >= 1 ||
    trustedCustomer.is_trusted === true ||
    trustedCustomer.cod_enabled === true;
  const normalizedFormPaymentMethod = normalizeCheckoutPaymentMethod(form.payment_method);
  const isShippingConfirmation = SHIPPING_CONFIRMATION_METHODS.has(normalizedFormPaymentMethod);
  const hasShippingPaymentProof = Boolean(shippingPaymentFile);
  const isFinalCheckoutStep = checkoutStep === 3;
  const submitDisabled = isFinalCheckoutStep && (submitting || (isShippingConfirmation && !hasShippingPaymentProof));
  const checkoutActionLabel = checkoutStep === 1
    ? t("storefront.checkout.actions.continueToAddress", "Continue to address")
    : checkoutStep === 2
      ? t("storefront.checkout.actions.continueToPayment", "Continue to payment")
      : normalizedFormPaymentMethod === "cod"
        ? t("storefront.checkout.actions.confirmOrder", "Confirm order")
        : t("storefront.checkout.actions.uploadProofAndConfirm", "Upload transfer proof and confirm order");
  const codAmount = normalizedFormPaymentMethod === "cod" ? total : Math.max(0, total - deliveryFee);
  const paymentMethods = getPaymentMethods();
  const paymentCopy = paymentMethods.find((method) => method.id === normalizedFormPaymentMethod)?.text || "";
  const cityAreaOptions = governorateCityAreas[form.governorate] || [];
  const activeTransferValue = shippingTransferMethod === "instapay" ? INSTA_PAY_HANDLE : VODAFONE_CASH_NUMBER;
  const activePaymentDeepLink = shippingTransferMethod === "instapay" ? "instapay://" : "tel:*9%23";
  const activePaymentQrUrl = shippingTransferMethod === "instapay" ? INSTA_PAY_QR_URL : VODAFONE_CASH_QR_URL;

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.style.setProperty("--checkout-sticky-actions-height", "88px");
    return () => {
      document.documentElement.style.setProperty("--checkout-sticky-actions-height", "0px");
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) setSubmitting(false);
    });
    return () => {
      cancelled = true;
    };
  }, [checkoutStep]);

  const setField = (key, value, options = {}) => {
    if (options.markDirty !== false) editedCheckoutFieldsRef.current.add(key);
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const setGovernorate = (value, options = {}) => {
    if (options.markDirty !== false) {
      editedCheckoutFieldsRef.current.add("governorate");
      editedCheckoutFieldsRef.current.add("city_area");
    }
    setManualCityArea(false);
    setForm((prev) => ({ ...prev, governorate: value, city_area: "" }));
    setErrors((prev) => ({ ...prev, governorate: "", city_area: "" }));
  };

  const setCityArea = (value, options = {}) => {
    if (options.markDirty !== false) editedCheckoutFieldsRef.current.add("city_area");
    if (value === MANUAL_CITY_AREA) {
      setManualCityArea(true);
      setField("city_area", "");
      return;
    }
    setManualCityArea(false);
    setField("city_area", value);
  };

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
    const fieldsSnapshot = {
      full_name: form.full_name,
      primary_phone: form.primary_phone,
      governorate: form.governorate,
      city_area: form.city_area,
      detailed_address: form.detailed_address,
      landmark: form.landmark,
      delivery_notes: form.delivery_notes,
    };

    let cancelled = false;
    api
      .get(`/storefront/customers/latest-shipping-address?${params.toString()}`)
      .then((data) => {
        if (cancelled) return;
        const address = data.address || null;
        if (!address) return;
        const dirty = editedCheckoutFieldsRef.current;
        const nextValues = {};
        const applyIfUntouched = (key, value) => {
          const text = String(value || "").trim();
          if (!text || dirty.has(key) || String(fieldsSnapshot[key] || "").trim()) return;
          nextValues[key] = text;
        };

        applyIfUntouched("full_name", address.customer_name);
        applyIfUntouched("primary_phone", address.phone);
        applyIfUntouched("governorate", address.governorate || address.province);
        const effectiveGovernorate = nextValues.governorate || fieldsSnapshot.governorate;
        applyIfUntouched("city_area", address.city_area || address.city || address.area);
        applyIfUntouched("detailed_address", address.detailed_address || address.address);
        applyIfUntouched("landmark", address.landmark);
        applyIfUntouched("delivery_notes", address.delivery_notes);

        if (!Object.keys(nextValues).length) return;
        const nextCity = nextValues.city_area || fieldsSnapshot.city_area;
        const knownCityOptions = governorateCityAreas[effectiveGovernorate] || [];
        if (nextValues.city_area) setManualCityArea(Boolean(effectiveGovernorate && !knownCityOptions.includes(nextCity)));
        setForm((prev) => ({ ...prev, ...nextValues }));
        setErrors((prev) => {
          const next = { ...prev };
          Object.keys(nextValues).forEach((key) => {
            delete next[key];
          });
          return next;
        });
        setLatestAddressApplied(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    checkoutStep,
    form.city_area,
    form.delivery_notes,
    form.detailed_address,
    form.full_name,
    form.governorate,
    form.landmark,
    form.primary_phone,
    profile.email,
    profile.customer_email,
  ]);

  useEffect(() => {
    if (normalizeCheckoutPaymentMethod(form.payment_method) === "cod" && !codAvailable) {
      let cancelled = false;
      deferReactState(() => {
        if (!cancelled) setForm((prev) => ({ ...prev, payment_method: "shipping_confirmation" }));
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [codAvailable, form.payment_method]);

  useEffect(() => {
    if (!isShippingConfirmation) {
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
  }, [isShippingConfirmation]);

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
        ? ["governorate", "city_area", "detailed_address"]
        : ["payment_method", "shipping_payment_screenshot"];
    const phone = form.primary_phone.replace(/\s/g, "");

    if (step === 1) {
      if (!form.full_name.trim()) next.full_name = sfText("storefront.validation.fullNameRequired", "Enter your full name");
      if (!phone) next.primary_phone = sfText("storefront.validation.phoneRequired", "Mobile number is required");
      else if (!/^01[0125][0-9]{8}$/.test(phone)) next.primary_phone = sfText("storefront.validation.invalidEgyptPhone", "Enter a valid Egyptian mobile number, example 01012345678");
    }

    if (step === 2) {
      if (!form.governorate) next.governorate = sfText("storefront.validation.governorateRequired", "Choose the governorate");
      if (!form.city_area.trim()) next.city_area = manualCityArea ? sfText("storefront.validation.cityAreaManualRequired", "Enter the city or area") : sfText("storefront.validation.cityAreaRequired", "Choose the city or area");
      if (!form.detailed_address.trim()) next.detailed_address = sfText("storefront.validation.addressRequired", "Enter the full address so the courier can reach you quickly");
    }

    if (step === 3) {
      if (!form.payment_method) next.payment_method = sfText("storefront.validation.paymentMethodRequired", "Choose a payment method");
      if (normalizeCheckoutPaymentMethod(form.payment_method) === "cod" && !codAvailable) next.payment_method = sfText("storefront.validation.codUnavailable", "Cash on delivery is not available for this customer");
      if (SHIPPING_CONFIRMATION_METHODS.has(normalizeCheckoutPaymentMethod(form.payment_method)) && !shippingPaymentFile) {
        next.shipping_payment_screenshot = sfText("storefront.validation.transferProofRequired", "Upload the transfer proof image to confirm the order");
      }
    }

    setErrors((prev) => {
      const cleared = { ...prev };
      stepKeys.forEach((key) => {
        delete cleared[key];
      });
      return { ...cleared, ...next };
    });
    if (showToast && Object.keys(next).length) toast.error(sfText("storefront.toasts.completeRequiredData", "Review the required details to complete the order."));
    if (showToast && next.shipping_payment_screenshot) toast.error(sfText("storefront.toasts.uploadTransferProof", "Upload the transfer proof image first."));
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
      toast.error(sfText("storefront.toasts.completeRequiredData", "Review the required details to complete the order."));
      if (firstInvalidStep === 3 && isShippingConfirmation && !shippingPaymentFile) toast.error(sfText("storefront.toasts.uploadTransferProof", "Upload the transfer proof image first."));
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
      toast.error(sfText("storefront.toasts.invalidTransferProof", "The transfer proof image is invalid."));
      setShippingPaymentFile(null);
      setPaymentProofUploaded(false);
      return;
    }
    if (Number(file.size || 0) < 5 * 1024) {
      toast.error(sfText("storefront.toasts.invalidTransferProof", "The transfer proof image is invalid."));
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
    let requestDebugPayload = null;
    try {
      const cleanPhone = form.primary_phone.replace(/\s/g, "");
      const paymentMethod = normalizeCheckoutPaymentMethod(form.payment_method);
      const shippingPaymentMethod = normalizeShippingPaymentMethod(shippingTransferMethod);
      const paidAmount = paymentMethod === "shipping_confirmation" ? deliveryFee : 0;
      const shippingProviderAddress = {
        country: "EG",
        country_code: "EG",
        governorate: form.governorate,
        city: form.city_area,
        area: form.city_area,
        street_address: form.detailed_address,
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
        paid_amount: paidAmount,
        shipping_address: shippingProviderAddress,
        shipping_provider_address: shippingProviderAddress,
        shipping_payment_method: shippingPaymentMethod,
      };
      requestDebugPayload = {
        checkout: checkoutPayload,
        items: pricedCart.map((item) => ({
          product_id: item.product_id,
          productId: item.productId,
          variant_id: item.variant_id,
          variantId: item.variantId,
          quantity: item.quantity,
          price: item.price,
          lineId: item.lineId,
        })),
        delivery_fee: deliveryFee,
        discount,
        has_shipping_payment_screenshot: Boolean(shippingPaymentFile),
        shipping_payment_screenshot: shippingPaymentFile
          ? { name: shippingPaymentFile.name, type: shippingPaymentFile.type, size: shippingPaymentFile.size }
          : null,
      };
      const requestBody = shippingPaymentFile
        ? (() => {
            const formData = new FormData();
            formData.append("checkout", JSON.stringify(checkoutPayload));
            formData.append("items", JSON.stringify(pricedCart));
            formData.append("delivery_fee", String(deliveryFee));
            formData.append("discount", String(discount));
            formData.append("shipping_payment_screenshot", shippingPaymentFile);
            return formData;
          })()
        : {
            checkout: checkoutPayload,
            items: pricedCart,
            delivery_fee: deliveryFee,
            discount,
      };
      if (storefrontDebugEnabled()) {
        console.log("[storefront-checkout-submit-debug]", JSON.stringify(requestDebugPayload, null, 2));
      }
      const data = await api.post("/storefront/checkout", requestBody);
      const successPayload = { order: data.order, items: data.items || pricedCart, customer: { full_name: form.full_name, phone: cleanPhone }, checkout: { ...checkoutPayload, shipping_payment_method: shippingPaymentMethod } };
      const publicNumber = displayOrderNumber(data.order);
      sessionStorage.setItem(`storefront.order.${publicNumber}`, JSON.stringify(successPayload));
      if (data.order?.invoice_number && data.order.invoice_number !== publicNumber) {
        sessionStorage.setItem(`storefront.order.${data.order.invoice_number}`, JSON.stringify(successPayload));
      }
      setProfile({ full_name: form.full_name, primary_phone: cleanPhone });
      clearCart();
      playSuccess();
      navigate(`/shop/success/${encodeURIComponent(publicNumber)}?phone=${encodeURIComponent(cleanPhone)}`, { state: successPayload });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("[storefront-checkout-error]", JSON.stringify({
          message: error?.responseBody?.message || error?.message,
          field: error?.responseBody?.field || null,
          details: error?.responseBody?.details || null,
          status: error?.status,
          responseData: error?.responseBody || null,
          payload: requestDebugPayload,
        }, null, 2));
      }
      const backendMessage = error?.responseBody?.message || error?.message;
      toast.error(backendMessage || sfText("storefront.toasts.checkoutFailed", "Something went wrong. Try again or contact us on WhatsApp."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!cart.length) return <EmptyState title={sfText("storefront.checkout.emptyCartTitle", "Your cart is empty")} text={sfText("storefront.checkout.emptyCartText", "Choose a product first, then continue checkout")} />;

  return (
    <section className="sf-checkout-page mx-auto max-w-7xl overflow-x-hidden px-4 pt-4 md:pt-7">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#c4b5fd]">{sfText("storefront.checkout.eyebrow", "Checkout")}</p>
          <h1 className="text-3xl font-black text-white md:text-4xl">{sfText("storefront.checkout.title", "Complete order")}</h1>
          <p className="mt-2 text-sm font-bold text-white/62">{sfText("storefront.checkout.subtitle", "Clear details, fast confirmation, and your order moves straight to preparation.")}</p>
        </div>
        <TrustPills compact />
      </div>
      <CheckoutProgress currentStep={checkoutStep} onStepChange={goToCheckoutStep} />
      <form id="storefront-checkout-form" noValidate onSubmit={submit} className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-3">
          {checkoutStep === 1 ? <CheckoutSection number="1" title={sfText("storefront.checkout.sections.customer", "Customer details")}>
            <div className="grid gap-2.5 md:grid-cols-2">
              <Field label={sfText("storefront.form.fullName", "Full name")} placeholder={sfText("storefront.form.fullNamePlaceholder", "Enter your full name")} value={form.full_name} onChange={(v) => setField("full_name", v)} required error={errors.full_name} />
              <Field label={sfText("storefront.form.primaryPhone", "Primary mobile number")} placeholder="01012345678" value={form.primary_phone} onChange={(v) => setField("primary_phone", v)} required error={errors.primary_phone} inputMode="tel" />
              <Field label={sfText("storefront.form.secondaryPhone", "Optional alternate number")} placeholder={sfText("storefront.form.secondaryPhonePlaceholder", "Alternative contact number")} value={form.secondary_phone} onChange={(v) => setField("secondary_phone", v)} inputMode="tel" />
            </div>
          </CheckoutSection> : null}
          {checkoutStep === 2 ? <CheckoutSection number="2" title={sfText("storefront.checkout.sections.address", "Delivery address")} note={sfText("storefront.checkout.addressNote", "Write the full address so the courier can reach you quickly")}>
            {latestAddressApplied ? (
              <p className="mb-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-black leading-5 text-emerald-100">
                {sfText("storefront.checkout.latestAddressApplied", "We used your latest saved shipping address. You can edit it.")}
              </p>
            ) : null}
            <div className="grid gap-2.5 md:grid-cols-2">
              <SelectField label={sfText("storefront.checkout.governorate", "Governorate")} value={form.governorate} onChange={setGovernorate} options={governorates} required error={errors.governorate} />
              <CityAreaField governorate={form.governorate} options={cityAreaOptions} value={form.city_area} onChange={setCityArea} manual={manualCityArea} onManualChange={(value) => setField("city_area", value)} required error={errors.city_area} />
              <TextField label={sfText("storefront.checkout.fullAddress", "Full address")} placeholder={sfText("storefront.checkout.fullAddressPlaceholder", "Street, building number, floor, apartment")} value={form.detailed_address} onChange={(v) => setField("detailed_address", v)} required error={errors.detailed_address} />
              <Field label={sfText("storefront.checkout.landmark", "Landmark")} placeholder={sfText("storefront.checkout.landmarkPlaceholder", "Near...")} value={form.landmark} onChange={(v) => setField("landmark", v)} />
              <TextField label={sfText("storefront.checkout.deliveryNotes", "Delivery notes")} placeholder={sfText("storefront.checkout.deliveryNotesPlaceholder", "Preferred time or courier note")} value={form.delivery_notes} onChange={(v) => setField("delivery_notes", v)} />
            </div>
          </CheckoutSection> : null}
          {checkoutStep === 3 ? <CheckoutSection number="3" title={sfText("storefront.checkout.sections.payment", "Payment method")}>
            <div className="grid gap-2.5 md:grid-cols-2">
              {paymentMethods.map((method) => {
                const methodEnabled = method.id !== "cod" || codAvailable;
                return (
                <button key={method.id} type="button" disabled={!methodEnabled} onClick={() => methodEnabled && setField("payment_method", method.id)} className={`group min-h-28 rounded-[1.35rem] border p-4 text-right text-white transition duration-200 active:scale-[0.985] ${normalizedFormPaymentMethod === method.id ? "border-[#a78bfa]/70 bg-[#7c3aed]/18 shadow-[0_18px_46px_rgba(124,58,237,0.24)] ring-4 ring-[#7c3aed]/15" : "border-white/10 bg-white/[0.055] shadow-[0_12px_34px_rgba(0,0,0,0.18)] hover:-translate-y-0.5 hover:border-[#a78bfa]/45 hover:bg-white/[0.075] hover:shadow-[0_18px_42px_rgba(124,58,237,0.14)]"} disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.025] disabled:text-white/35 disabled:shadow-none`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black">{method.title}</span>
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition ${normalizedFormPaymentMethod === method.id ? "border-[#a78bfa] bg-[#7c3aed] text-white" : "border-white/20 bg-white/[0.045] text-transparent"}`}><Check className="h-3.5 w-3.5" /></span>
                  </span>
                  <span className={`mt-2 block text-xs font-bold leading-5 ${normalizedFormPaymentMethod === method.id ? "text-white/78" : "text-white/54"}`}>{method.text}</span>
                  {method.id === "cod" && !codAvailable ? (
                    <span className="mt-2 block rounded-2xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-black leading-5 text-amber-100">{sfText("storefront.checkout.codEligibilityNote", "Cash on delivery is available only for returning customers and Damietta addresses.")}</span>
                  ) : null}
                </button>
                );
              })}
            </div>
            {errors.payment_method ? <p className="mt-2 text-xs font-black text-rose-200">{errors.payment_method}</p> : null}
            {paymentCopy ? <p className="mt-2.5 rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-sm font-bold text-white/64 shadow-inner shadow-white/[0.02]">{paymentCopy}</p> : null}
            {isShippingConfirmation ? (
              <div className="mt-4 overflow-hidden rounded-[1.8rem] border border-[#a78bfa]/18 bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.34),transparent_32%),linear-gradient(145deg,rgba(11,12,26,0.98),rgba(6,7,18,0.96))] p-4 text-white shadow-[0_26px_80px_rgba(13,8,34,0.45),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-white/10 md:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#a78bfa]/20 bg-[#7c3aed]/14 px-3 py-1.5 text-xs font-black text-[#ddd6fe]">
                      <LockKeyhole className="h-3.5 w-3.5" />
                      {sfText("storefront.checkout.transfer.safeBankPayment", "Secure bank payment")}
                    </div>
                    <div className="mt-3 text-xs font-semibold text-white/54">{sfText("storefront.checkout.transfer.amountDueNow", "Amount to transfer now")}</div>
                    <div className="mt-1 text-4xl font-black tracking-tight text-white md:text-5xl">{money(deliveryFee)}</div>
                    <p className="mt-2 max-w-lg text-sm font-semibold leading-6 text-white/62">{sfText("storefront.checkout.transfer.instructions", "Transfer only the shipping fee using InstaPay or Vodafone Cash, then upload the receipt so we can review your order before preparation.")}</p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-100 ring-1 ring-emerald-300/10">
                    <ShieldCheck className="h-4 w-4 text-[#c4b5fd]" />
                    {sfText("storefront.checkout.transfer.manualReview", "Transfer is reviewed manually")}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-2 rounded-[1.45rem] border border-white/10 bg-white/[0.045] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
                  <PaymentMethodTab method="instapay" active={shippingTransferMethod === "instapay"} onClick={() => setShippingTransferMethod("instapay")} />
                  <PaymentMethodTab method="vodafone_cash" active={shippingTransferMethod === "vodafone_cash"} onClick={() => setShippingTransferMethod("vodafone_cash")} />
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[0.78fr_1.22fr]">
                  <div className="grid content-start gap-3">
                    <div className="rounded-[1.45rem] border border-white/10 bg-white/[0.055] p-4 text-center shadow-[0_18px_42px_rgba(0,0,0,0.22)]">
                      {activePaymentQrUrl ? (
                        <>
                          <img src={activePaymentQrUrl} alt={`${paymentBrandLabels[shippingTransferMethod]} QR`} className="mx-auto h-36 w-36 rounded-[1.2rem] bg-white object-contain p-2" decoding="async" />
                          <div className="mt-3 text-sm font-black text-white">{sfText("storefront.checkout.transfer.scanQr", "Scan QR to pay")}</div>
                          <p className="mt-1 text-xs font-semibold leading-5 text-white/52">{sfText("storefront.checkout.transfer.scanQrHint", "Open your payment app, scan the code, then upload the receipt.")}</p>
                        </>
                      ) : (
                        <div className="flex items-center gap-3 text-right">
                          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[#a78bfa]/20 bg-[#7c3aed]/14 text-[#ddd6fe]">
                            <QrCode className="h-6 w-6" strokeWidth={1.8} />
                          </span>
                          <span>
                            <span className="block text-sm font-black text-white">{sfText("storefront.checkout.transfer.qrComingSoon", "QR coming soon")}</span>
                            <span className="mt-1 block text-xs font-semibold leading-5 text-white/50">{sfText("storefront.checkout.transfer.useDirectDetails", "Use the direct transfer details without waiting.")}</span>
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
                      {[
                        [sfText("storefront.checkout.transfer.steps.transfer", "Transfer the required amount"), <Smartphone className="h-4 w-4" />],
                        [sfText("storefront.checkout.transfer.steps.upload", "Upload receipt image"), <ReceiptText className="h-4 w-4" />],
                        [sfText("storefront.checkout.transfer.steps.review", "We review and confirm"), <ShieldCheck className="h-4 w-4" />],
                      ].map(([label, icon], index) => (
                        <div key={label} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-black text-white/72">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-[#7c3aed]/16 text-[#ddd6fe]">{icon}</span>
                          <span className="text-white/40">{index + 1}</span>
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid content-start gap-3">
                    <PaymentCopyLine method={shippingTransferMethod} label={paymentBrandLabels[shippingTransferMethod]} value={activeTransferValue} amount={deliveryFee} deepLink={activePaymentDeepLink} />
                    <div
                      onDragOver={(event) => {
                        event.preventDefault();
                        setPaymentProofDragActive(true);
                      }}
                      onDragLeave={() => setPaymentProofDragActive(false)}
                      onDrop={handlePaymentProofDrop}
                      className={`rounded-[1.55rem] border border-dashed p-3 transition duration-200 ${
                        errors.shipping_payment_screenshot
                          ? "border-rose-300/55 bg-rose-500/8"
                          : paymentProofDragActive
                            ? "border-[#c4b5fd]/80 bg-[#7c3aed]/18 shadow-[0_0_0_4px_rgba(167,139,250,0.12),0_24px_58px_rgba(124,58,237,0.22)]"
                            : paymentProofUploaded
                              ? "border-emerald-300/45 bg-emerald-400/10 shadow-[0_18px_48px_rgba(16,185,129,0.12)]"
                              : "border-white/14 bg-white/[0.055] hover:border-[#a78bfa]/45 hover:bg-white/[0.075] hover:shadow-[0_22px_52px_rgba(124,58,237,0.14)]"
                      }`}
                    >
                      <label className="group block cursor-pointer">
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handlePaymentProofChange(event.target.files?.[0])} className="sr-only" />
                        <span className="flex items-center gap-3 text-right">
                          <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl transition group-hover:scale-[1.03] ${paymentProofUploaded ? "bg-emerald-400/16 text-emerald-100 ring-1 ring-emerald-300/25" : "bg-[#7c3aed]/16 text-[#c4b5fd] ring-1 ring-[#a78bfa]/20"}`}>
                            {paymentProofUploaded ? <Check className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-base font-black text-white">{shippingPaymentFile ? sfText("storefront.checkout.transfer.proofUploaded", "Receipt image uploaded") : sfText("storefront.checkout.transfer.uploadPrompt", "Drag the receipt here or click to upload")}</span>
                            <span className="mt-1 block text-xs font-semibold leading-5 text-white/52">{sfText("storefront.checkout.transfer.acceptedFormats", "PNG, JPG, or WEBP from an InstaPay or Vodafone Cash receipt")}</span>
                          </span>
                        </span>
                      </label>

                      {shippingPaymentFile ? (
                        <div className="mt-4 flex items-center gap-3 rounded-[1.2rem] border border-white/10 bg-black/25 p-2.5">
                          {shippingPaymentPreviewUrl ? (
                            <img src={shippingPaymentPreviewUrl} alt={sfText("storefront.checkout.transfer.proofPreviewAlt", "Shipping payment proof preview")} className="h-18 w-18 shrink-0 rounded-2xl object-cover ring-1 ring-white/10" decoding="async" />
                          ) : (
                            <span className="grid h-18 w-18 shrink-0 place-items-center rounded-2xl bg-white/[0.06] text-white/50"><Loader2 className="h-5 w-5 animate-spin" /></span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black text-white">{shippingPaymentFile.name}</div>
                            <div className="mt-1 flex items-center gap-1.5 text-xs font-bold text-emerald-100">
                              <Check className="h-3.5 w-3.5" />
                              {sfText("storefront.checkout.transfer.readyToSend", "Ready to send")}
                            </div>
                          </div>
                          <label className="shrink-0 cursor-pointer rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-black text-white transition hover:bg-white/[0.09]">
                            {sfText("storefront.checkout.transfer.replace", "Replace")}
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handlePaymentProofChange(event.target.files?.[0])} className="sr-only" />
                          </label>
                          <button type="button" onClick={removePaymentProof} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-rose-300/20 bg-rose-500/10 text-rose-100 transition hover:bg-rose-500/18" aria-label={sfText("storefront.checkout.transfer.removeProof", "Remove payment proof")}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {errors.shipping_payment_screenshot ? <span className="text-xs font-bold text-rose-200">{errors.shipping_payment_screenshot}</span> : null}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <p className="rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2 text-xs font-semibold leading-5 text-white/62">{sfText("storefront.checkout.transfer.shippingDeducted", "The shipping fee is deducted from the order total.")}</p>
                  <p className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-semibold leading-5 text-emerald-100">{sfText("storefront.checkout.transfer.protectiveReview", "Transfers are manually reviewed to protect orders.")}</p>
                </div>
              </div>
            ) : null}
            <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
              <Field label={sfText("storefront.checkout.coupon", "Discount coupon")} placeholder={sfText("storefront.checkout.couponPlaceholder", "If you have a discount code")} value={form.coupon} onChange={(v) => setField("coupon", v)} />
              <TextField label={sfText("storefront.checkout.orderNotes", "Order notes")} placeholder={sfText("storefront.checkout.orderNotesPlaceholder", "Alternative size or special note")} value={form.order_notes} onChange={(v) => setField("order_notes", v)} compact />
            </div>
          </CheckoutSection> : null}
        </div>
        <CheckoutSummary cart={pricedCart} subtotal={subtotal} discount={discount} deliveryFee={deliveryFee} total={total} codAmount={codAmount} governorate={form.governorate} paymentMethod={normalizedFormPaymentMethod} open={summaryOpen} setOpen={setSummaryOpen} submitting={isFinalCheckoutStep && submitting} submitDisabled={submitDisabled} actionLabel={checkoutActionLabel} />
      </form>
      <div className="sf-checkout-sticky-actions fixed left-0 right-0 p-3 md:hidden">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <button type="button" onClick={() => setSummaryOpen((value) => !value)} className="sf-checkout-total-chip min-h-13 flex-1 rounded-full px-4 py-3 text-right text-sm font-black">{isFinalCheckoutStep ? sfText("storefront.checkout.total", "Total") : sfText("storefront.checkout.orderSummary", "Order summary")}: {money(total)}</button>
          <SubmitButton submitting={isFinalCheckoutStep && submitting} compact disabled={submitDisabled} label={checkoutActionLabel} />
        </div>
      </div>
    </section>
  );
}

function OrderSuccess({ profile }) {
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

  const order = loaded?.order || {};
  const publicNumber = displayOrderNumber(order) || displayOrderNumber(decodedOrderNumber);
  const items = loaded?.items || [];
  const customerName = order.customer_name || loaded?.customer?.full_name || profile.full_name || t("storefront.customer.dearCustomer", "Dear customer");
  const total = order.total_amount || order.total || order.total_price || 0;
  const address = [order.governorate, order.city_area, order.customer_address || loaded?.checkout?.detailed_address].filter(Boolean).join(" - ");
  const paymentLabel = paymentCopy(order.payment_method || loaded?.checkout?.payment_method || "cod");
  const isShippingAwaitingVerification =
    (order.payment_method || loaded?.checkout?.payment_method) === "shipping_confirmation" ||
    order.payment_status === "awaiting_verification" ||
    order.status === "awaiting_verification";
  const successTitle = isShippingAwaitingVerification ? t("storefront.success.awaitingVerificationTitle", "We received your order and transfer proof") : t("storefront.success.confirmedTitle", "Your order was confirmed successfully");
  const successSubtitle = isShippingAwaitingVerification
    ? t("storefront.success.awaitingVerificationSubtitle", "We received your order and transfer proof. It will be reviewed and confirmed soon.")
    : t("storefront.success.confirmedSubtitle", "Your order is now being prepared.");
  const successStatus = isShippingAwaitingVerification ? t("storefront.status.awaiting_verification", "Awaiting transfer review") : statusCopy(order.status || "pending");
  const whatsAppHref = whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(`مرحبًا، أريد متابعة طلبي رقم ${publicNumber}`)}` : "";

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-6 md:py-10">
      {confetti ? <Confetti /> : null}
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto grid h-24 w-24 animate-[success-pop_650ms_ease-out] place-items-center rounded-full bg-emerald-100 text-emerald-700 shadow-[0_20px_45px_rgba(16,185,129,0.18)]">
          <Check className="h-12 w-12" />
        </div>
        <h1 className="mt-6 text-3xl font-black md:text-4xl">{successTitle}</h1>
        <p className="mt-2 text-lg font-bold text-stone-600">{t("storefront.success.thanks", "Thank you for trusting us")}</p>
        <p className="mt-1 text-sm font-bold text-stone-500">{successSubtitle}</p>
        <div className="mt-5 inline-flex rounded-full bg-[#f5f3ff] px-4 py-2 text-sm font-black text-[#6d28d9]">{message}</div>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="sf-storefront-card rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoBox label={t("storefront.orders.orderNumber", "Order number")} value={<OrderNumberBadge value={publicNumber} className="border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />} />
              <InfoBox label={t("storefront.customer.customer", "Customer")} value={customerName} />
              <InfoBox label={t("storefront.checkout.total", "Total")} value={total ? money(total) : t("storefront.success.orderRecorded", "Order recorded")} />
              <InfoBox label={t("storefront.checkout.paymentMethod", "Payment method")} value={paymentLabel} />
              <InfoBox label={t("storefront.orders.orderStatus", "Order status")} value={successStatus} />
              <InfoBox label={t("storefront.orders.expectedDelivery", "Expected delivery")} value={t("storefront.orders.expectedDeliveryWindow", "2 to 5 business days")} />
            </div>
            <div className="sf-info-box mt-4 rounded-2xl bg-stone-50 p-4 text-right">
              <div className="sf-info-label text-xs font-black text-stone-500">{t("storefront.checkout.deliveryAddress", "Delivery address")}</div>
              <div className="sf-info-value mt-1 font-black">{address || t("storefront.orders.addressSaved", "Address saved with order")}</div>
            </div>
          </div>
          <div className="sf-storefront-card rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:p-6">
            <h2 className="sf-section-heading text-xl font-black">{t("storefront.orders.tracking", "Order tracking")}</h2>
            <SuccessTimeline />
          </div>
          <Suspense fallback={<div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm font-bold text-white/60">{sfText("storefront.orders.itemsLoading", "Product summary will appear here after loading order details.")}</div>}>
            <OrderInvoiceCard className="sf-order-invoice-card" order={{ ...order, source: "Website" }} items={items} />
          </Suspense>
        </div>
        <aside className="sf-storefront-card h-max rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] lg:sticky lg:top-24">
          <div className="grid gap-3">
            <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="rounded-full bg-stone-950 px-5 py-4 text-center font-black text-white transition hover:bg-[#6d28d9]">{t("storefront.orders.trackOrder", "Track order")}</Link>
            <Link to="/shop/products" className="sf-soft-pill rounded-full border border-stone-300 px-5 py-4 text-center font-black transition hover:border-[#7c3aed] hover:text-[#6d28d9]">{t("storefront.common.continueShopping", "Continue shopping")}</Link>
            {whatsAppHref ? <a href={whatsAppHref} className="rounded-full border border-emerald-200 bg-emerald-50 px-5 py-4 text-center font-black text-emerald-700">{t("storefront.support.whatsapp", "Contact us on WhatsApp")}</a> : <button disabled className="rounded-full border border-stone-200 bg-stone-100 px-5 py-4 font-black text-stone-400">{t("storefront.support.whatsappUnavailable", "WhatsApp is currently unavailable")}</button>}
          </div>
          <div className="sf-info-box mt-5 rounded-2xl bg-[#f5f3ff] p-4 text-sm font-bold leading-6 text-stone-700">{t("storefront.success.reviewNotice", "We will review and prepare the order. If we need to confirm details, we will contact your phone number.")}</div>
        </aside>
      </div>
      {products.length ? (
        <div className="mt-6">
          <ProductRail title={t("storefront.nav.new", "New")} subtitle={t("storefront.success.recommendedProducts", "Products you may like")} products={products} loading={false} railType="new" wishlist={[]} toggleWishlist={() => undefined} addToCart={() => undefined} />
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
  return { manual: sfText("storefront.shipping.manual", "Manual delivery"), bosta: "Bosta", mylerz: "Mylerz", aramex: "Aramex" }[raw.toLowerCase()] || raw || sfText("storefront.common.soon", "Soon");
};
const formatDate = (value) => {
  if (!value) return sfText("storefront.common.soon", "Soon");
  try {
    return new Intl.DateTimeFormat(i18n.language || "en", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
};
const supportHref = (orderNumber = "") => {
  const text = orderNumber ? sfText("storefront.support.orderHelpMessage", "Hello, I need help with order {{orderNumber}}", { orderNumber }) : sfText("storefront.support.generalHelpMessage", "Hello, I need help with a website order");
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

function OrderItemsSummary({ items = [] }) {
  if (!items.length) return <p className="sf-muted-empty mt-4 rounded-2xl bg-stone-50 p-4 font-bold text-stone-500">{sfText("storefront.orders.itemsLoading", "Product summary will appear here after loading order details.")}</p>;
  return (
    <div className="sf-order-items mt-5 space-y-3">
      <h3 className="sf-section-heading text-lg font-black">{sfText("storefront.orders.itemsSummary", "Product summary")}</h3>
      {items.map((item) => (
        <div key={item.id || `${item.product_id}-${item.variant_id}`} className="sf-order-item-row flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3">
          <img src={imageFor(item.product_image || item.image_url)} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" loading="lazy" decoding="async" width="56" height="56" />
          <div className="min-w-0 flex-1">
            <div className="sf-order-item-name truncate font-black">{item.product_name || item.name}</div>
            <div className="sf-order-item-meta text-xs font-bold text-stone-500">{item.color || sfText("storefront.products.color", "Color")} / {item.size || sfText("storefront.products.size", "Size")} - {item.quantity}</div>
          </div>
          <div className="sf-order-item-price shrink-0 font-black">{money(item.total_amount || Number(item.price || item.sale_price || 0) * Number(item.quantity || 1))}</div>
        </div>
      ))}
    </div>
  );
}

function TrackOrder() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({ order_number: displayOrderNumber(params.get("order_number") || params.get("order") || ""), phone: params.get("phone") || "" });
  const [state, setState] = useState({ loading: false, data: null, error: "" });
  const hasOrderFromQuery = Boolean(params.get("order") || params.get("order_number"));

  const submit = useCallback(async (event) => {
    event?.preventDefault();
    if (!form.order_number.trim()) {
      setState({ loading: false, data: null, error: sfText("storefront.tracking.validation.orderNumberRequired", "Enter the order number first") });
      return;
    }
    setState({ loading: true, data: null, error: "" });
    try {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(form.order_number)}&phone=${encodeURIComponent(form.phone)}`);
      setState({ loading: false, data, error: "" });
    } catch (error) {
      setState({ loading: false, data: null, error: error.message });
    }
  }, [form.order_number, form.phone]);

  useEffect(() => {
    if (!form.order_number || (!form.phone && !hasOrderFromQuery)) return undefined;
    let cancelled = false;
    deferReactState(() => {
      if (!cancelled) submit();
    });
    return () => {
      cancelled = true;
    };
  }, [form.order_number, form.phone, hasOrderFromQuery, submit]);

  return (
    <section className="mx-auto max-w-6xl px-4 py-5 md:py-8">
      <div className="rounded-[2rem] bg-stone-950 p-5 text-white shadow-[0_24px_70px_rgba(39,20,75,0.18)] md:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black text-emerald-200">{sfText("storefront.tracking.eyebrow", "Your order is on the way")}</p>
            <h1 className="mt-2 text-3xl font-black md:text-5xl">{sfText("storefront.tracking.title", "Track order")}</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-stone-300">{sfText("storefront.tracking.subtitle", "Enter your order number and mobile number, or open the direct tracking link from your confirmation message.")}</p>
          </div>
          <a href={supportHref(form.order_number)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-black text-white">
            <MessageCircle className="h-5 w-5" />
            {sfText("storefront.support.needHelpWhatsapp", "Need help? Contact us on WhatsApp")}
          </a>
        </div>
      </div>
      <form onSubmit={submit} className="sf-storefront-card sf-track-search-form mt-5 grid gap-3 rounded-[1.7rem] border border-stone-200 bg-white p-4 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:grid-cols-[1fr_1fr_auto] md:p-5">
        <Field label={sfText("storefront.orders.orderNumber", "Order number")} value={form.order_number} onChange={(v) => setForm((prev) => ({ ...prev, order_number: v }))} required />
        <Field label={sfText("storefront.form.mobileNumber", "Mobile number")} value={form.phone} onChange={(v) => setForm((prev) => ({ ...prev, phone: v }))} inputMode="tel" />
        <button disabled={state.loading} className="min-h-13 self-end rounded-full bg-stone-950 px-7 py-4 font-black text-white transition hover:bg-[#6d28d9] disabled:bg-stone-300">{sfText("storefront.orders.trackOrder", "Track order")}</button>
      </form>
      {state.loading ? <div className="sf-storefront-card mt-5 h-32 animate-pulse rounded-3xl bg-white" /> : null}
      {!state.loading && !state.data && !state.error ? <EmptyState title={sfText("storefront.tracking.readyTitle", "Ready to check")} text={sfText("storefront.tracking.readyText", "Order number and shipping status will appear here after searching.")} /> : null}
      {state.error ? <EmptyState title={sfText("storefront.tracking.notFoundTitle", "We could not find the order")} text={state.error || sfText("storefront.tracking.notFoundText", "Check the order number and mobile number, or contact us on WhatsApp.")} /> : null}
      {state.data ? <TrackingResult data={state.data} /> : null}
    </section>
  );
}

function TrackingResult({ data }) {
  const order = data.order || {};
  const items = data.items || [];
  const timeline = data.timeline || getStatusLabels().map((label, index) => ({ label, done: index === 0 }));
  const total = order.total_amount || order.total || order.total_price || 0;
  const address = [order.governorate, order.city_area, order.customer_address, order.landmark].filter(Boolean).join(" - ");
  const publicNumber = displayOrderNumber(order);
  return (
    <div className="sf-storefront-card sf-tracking-result mt-5 overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-[0_18px_50px_rgba(39,20,75,0.07)]">
      <div className="sf-card-section border-b border-stone-100 p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="sf-muted-text text-sm font-bold text-stone-500">{sfText("storefront.orders.orderNumber", "Order number")}</div>
            <OrderNumberBadge value={publicNumber} className="mt-2 border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />
          </div>
          <span className="rounded-full bg-stone-950 px-4 py-2 text-sm font-black text-white">{statusCopy(order.status || order.shipping_status || "pending")}</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoBox label={sfText("storefront.customer.customer", "Customer")} value={order.customer_name || sfText("storefront.customer.dearCustomer", "Dear customer")} />
          <InfoBox label={sfText("storefront.orders.orderDate", "Order date")} value={formatDate(order.created_at)} />
          <InfoBox label={sfText("storefront.checkout.total", "Total")} value={money(total)} />
          <InfoBox label={sfText("storefront.checkout.paymentMethod", "Payment")} value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status || "pending")}`} />
          <InfoBox label={sfText("storefront.shipping.provider", "Shipping provider")} value={shippingProviderCopy(order.shipping_provider)} />
          <InfoBox label={sfText("storefront.shipping.trackingNumber", "Tracking number")} value={order.tracking_number || sfText("storefront.common.soon", "Soon")} />
          <InfoBox label={sfText("storefront.shipping.status", "Shipping status")} value={statusCopy(order.shipping_status || "pending")} />
          <InfoBox label={sfText("storefront.checkout.deliveryAddress", "Address")} value={address || sfText("storefront.orders.addressSaved", "Address saved with order")} />
        </div>
      </div>
      <div className="p-5 md:p-6">
        <h2 className="sf-section-heading text-xl font-black">{sfText("storefront.orders.tracking", "Order tracking")}</h2>
        <OrderTimeline timeline={timeline} />
        <OrderItemsSummary items={items} />
        <a href={supportHref(publicNumber)} className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-3 font-black text-white">
          <MessageCircle className="h-5 w-5" />
          {sfText("storefront.support.needHelpWhatsapp", "Need help? Contact us on WhatsApp")}
        </a>
      </div>
    </div>
  );
}

function AnimatedPoints({ value }) {
  const [display, setDisplay] = useState(Number(value || 0));
  const displayRef = useRef(Number(value || 0));

  useEffect(() => {
    const start = Number(displayRef.current || 0);
    const end = Number(value || 0);
    if (start === end) return undefined;
    const startedAt = performance.now();
    const duration = 700;
    let frame = 0;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextDisplay = Math.round(start + (end - start) * eased);
      displayRef.current = nextDisplay;
      setDisplay(nextDisplay);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return Number(display || 0).toLocaleString(i18n.language || "en");
}

function LoyaltyWidget({ loyalty, loading }) {
  if (loading && !loyalty) {
    return (
      <div className="sf-loyalty-card mt-4 overflow-hidden rounded-[1.35rem] border border-stone-200 bg-stone-50 p-4">
        <div className="sf-skeleton h-4 w-24 animate-pulse rounded-full bg-stone-200" />
        <div className="sf-skeleton mt-4 h-10 w-36 animate-pulse rounded-xl bg-stone-200" />
        <div className="sf-skeleton mt-4 h-2 w-full animate-pulse rounded-full bg-stone-200" />
      </div>
    );
  }

  const points = Number(loyalty?.points ?? loyalty?.available_points ?? 0);
  const tier = loyalty?.tier || "Bronze";
  const nextTier = loyalty?.next_tier || "Platinum";
  const remaining = Number(loyalty?.points_to_next_tier || 0);
  const progress = Math.max(0, Math.min(100, Number(loyalty?.progress || 0)));

  return (
    <div className="sf-loyalty-card mt-4 overflow-hidden rounded-[1.35rem] border border-[#7c3aed]/20 bg-[#faf7ff] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="sf-loyalty-icon grid h-10 w-10 place-items-center rounded-full bg-white text-[#6d28d9] shadow-sm">
            <Gem className="h-5 w-5" />
          </span>
          <div>
            <div className="sf-muted-text text-xs font-black text-stone-500">{sfText("storefront.account.loyaltyBalance", "Loyalty balance")}</div>
            <div className="sf-primary-text text-2xl font-black text-stone-950">
              <AnimatedPoints value={points} /> {sfText("storefront.account.points", "points")}
            </div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-stone-950 px-3 py-1.5 text-xs font-black text-white">
          <Crown className="h-3.5 w-3.5 text-amber-300" />
          {tier}
        </span>
      </div>
      <div className="sf-loyalty-progress mt-4 h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-[#7c3aed] transition-all duration-700" style={{ width: `${progress}%` }} />
      </div>
      <div className="sf-secondary-text mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-black text-stone-600">
        <span>
          {remaining > 0
            ? sfText("storefront.account.pointsToNextTier", "{{count}} points to reach {{tier}}", {
                count: remaining.toLocaleString(i18n.language || "en"),
                tier: nextTier,
              })
            : sfText("storefront.account.topTierReached", "You reached the top tier")}
        </span>
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

const AccountOrderRow = memo(function AccountOrderRow({ order, phone, onOpen, onReorder }) {
  const open = useCallback(() => onOpen(order), [onOpen, order]);
  const reorderOrder = useCallback(() => onReorder(order), [onReorder, order]);
  const publicNumber = displayOrderNumber(order);
  return (
    <div className="sf-account-order-row rounded-2xl bg-stone-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <OrderNumberBadge value={order} className="border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />
          <div className="sf-muted-text mt-1 text-xs font-bold text-stone-500">{formatDate(order.created_at)} - {statusCopy(order.status)}</div>
        </div>
        <div className="sf-primary-text font-black">{money(order.total_amount || order.total || order.total_price)}</div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button onClick={open} className="sf-soft-pill min-h-11 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-black">{sfText("storefront.orders.orderDetails", "Order details")}</button>
        <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-11 rounded-full bg-stone-950 px-4 py-2 text-center text-sm font-black text-white">{sfText("storefront.orders.trackOrder", "Track order")}</Link>
        <button onClick={reorderOrder} className="min-h-11 rounded-full border border-[#7c3aed]/30 bg-[#f5f3ff] px-4 py-2 text-sm font-black text-[#6d28d9]">{sfText("storefront.orders.reorder", "Reorder")}</button>
      </div>
    </div>
  );
});

function AccountPage({ profile, setProfile, wishlist, recent, addToCart }) {
  const [phone, setPhone] = useState(profile.primary_phone || "");
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const load = async () => {
    if (!phone) return;
    setLoading(true);
    try {
      const data = await api.get(`/storefront/account?phone=${encodeURIComponent(phone)}`);
      setAccount(data);
      setProfile((prev) => ({ ...prev, primary_phone: phone, full_name: data.customer?.name || prev.full_name || "" }));
    } catch (error) {
      toast.error(error.message || sfText("storefront.toasts.accountUnavailable", "We cannot open the account right now."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!account || !phone) return undefined;
    const id = window.setInterval(() => {
      api.get(`/storefront/account?phone=${encodeURIComponent(phone)}`)
        .then((data) => setAccount(data))
        .catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(id);
  }, [account, phone]);

  const openOrder = async (order) => {
    setSelectedOrder({ loading: true, order, items: [], timeline: [] });
    try {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(displayOrderNumber(order))}&phone=${encodeURIComponent(phone)}`);
      setSelectedOrder(data);
    } catch {
      setSelectedOrder({ order, items: [], timeline: [] });
    }
  };

  const reorder = async (order) => {
    const sourceItems = order.items || selectedOrder?.items || [];
    let items = sourceItems;
    if (!items.length) {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(displayOrderNumber(order))}&phone=${encodeURIComponent(phone)}`);
      items = data.items || [];
    }
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      try {
        const productData = await api.get(`/storefront/products/${item.product_id}`);
        const product = productData.product;
        const variant = (product?.variants || []).find((candidate) => String(candidate.id) === String(item.variant_id) && Number(candidate.stock || 0) > 0);
        if (!product || !variant) {
          skipped += 1;
          continue;
        }
        addToCart(product, variant, Math.min(Number(item.quantity || 1), Number(variant.stock || 1)));
        added += 1;
      } catch {
        skipped += 1;
      }
    }
    if (added) toast.success(skipped ? sfText("storefront.toasts.reorderPartial", "Available items were added to cart. Some choices are currently unavailable.") : sfText("storefront.toasts.reorderAdded", "The order was added to cart again."));
    else toast.error(sfText("storefront.toasts.reorderUnavailable", "These products are currently unavailable. Try different choices."));
  };

  const orders = account?.orders || [];
  const addresses = account?.addresses || [];
  const backendWishlist = account?.wishlist_products || [];
  const backendRecent = account?.recent_products || [];

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">{sfText("storefront.account.eyebrow", "Light account by mobile")}</p>
          <h1 className="text-3xl font-black md:text-5xl">{sfText("storefront.account.title", "My account")}</h1>
        </div>
        <Link to="/shop/track" className="sf-soft-pill inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 font-black">{sfText("storefront.orders.trackOrder", "Track order")}</Link>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="sf-storefront-card h-max rounded-[1.7rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] lg:sticky lg:top-24">
          <Field label={sfText("storefront.form.mobileNumber", "Mobile number")} value={phone} onChange={setPhone} inputMode="tel" />
          <button onClick={load} disabled={loading} className="mt-3 min-h-12 w-full rounded-full bg-stone-950 px-5 py-3 font-black text-white disabled:bg-stone-300">{loading ? sfText("storefront.common.loading", "Loading...") : sfText("storefront.account.showMyData", "Show my details")}</button>
          <InfoBox label={sfText("storefront.account.myData", "My details")} value={account?.customer?.name || profile.full_name || sfText("storefront.account.enterPhoneHint", "Enter your phone to view the account")} />
          <LoyaltyWidget loyalty={account?.loyalty} loading={loading} />
        </div>
        <div className="space-y-5">
          <Panel title={sfText("storefront.account.myOrders", "My orders")}>
            {orders.length ? (
              <VirtualList
                items={orders}
                estimateSize={152}
                className="max-h-[28rem] overflow-auto pr-1"
                itemKey={(order) => order.id || displayOrderNumber(order)}
                renderItem={(order) => <AccountOrderRow order={order} phone={phone} onOpen={openOrder} onReorder={reorder} />}
              />
            ) : <p className="sf-muted-empty font-bold text-stone-500">{sfText("storefront.account.noOrders", "No orders yet")}</p>}
          </Panel>
          {selectedOrder ? <CustomerOrderDetails data={selectedOrder} phone={phone} onReorder={reorder} /> : null}
          <Panel title={sfText("storefront.account.myAddresses", "My addresses")}>
            {addresses.length ? addresses.map((address) => <div key={address} className="sf-account-address-row rounded-2xl bg-stone-50 p-3 font-bold text-stone-700">{address}</div>) : <p className="sf-muted-empty font-bold text-stone-500">{sfText("storefront.account.addressesEmpty", "Addresses used in orders will appear here")}</p>}
          </Panel>
          <Panel title={sfText("storefront.header.wishlist", "Wishlist")}>
            <SmallProductList items={backendWishlist.length ? backendWishlist : wishlist} empty={sfText("storefront.account.wishlistEmpty", "Save products you like here")} />
          </Panel>
          <Panel title={sfText("storefront.account.recentlyViewed", "Recently viewed")}>
            <SmallProductList items={backendRecent.length ? backendRecent : recent} empty={sfText("storefront.account.recentEmpty", "Recently viewed products will appear here")} />
          </Panel>
        </div>
      </div>
    </section>
  );
}

function CustomerOrderDetails({ data, phone, onReorder }) {
  const order = data.order || {};
  const publicNumber = displayOrderNumber(order);
  if (data.loading) return <div className="sf-storefront-card h-40 animate-pulse rounded-3xl bg-white" />;
  return (
    <Panel title={sfText("storefront.orders.orderDetails", "Order details")}>
      <OrderNumberBadge value={publicNumber} className="mb-1 border-[#7c3aed]/20 bg-[#7c3aed]/10 text-[#5b21b6]" />
      <div className="grid gap-3 md:grid-cols-3">
        <InfoBox label={sfText("storefront.orders.orderStatus", "Order status")} value={statusCopy(order.status)} />
        <InfoBox label={sfText("storefront.checkout.paymentMethod", "Payment")} value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status)}`} />
        <InfoBox label={sfText("storefront.checkout.shipping", "Shipping")} value={`${shippingProviderCopy(order.shipping_provider)} - ${statusCopy(order.shipping_status)}`} />
      </div>
      <OrderTimeline timeline={data.timeline || []} />
      <OrderItemsSummary items={data.items || []} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Link to={`/shop/track?order=${encodeURIComponent(publicNumber)}&phone=${encodeURIComponent(phone)}`} className="min-h-12 rounded-full bg-stone-950 px-5 py-3 text-center font-black text-white">{sfText("storefront.orders.trackOrder", "Track order")}</Link>
        <button onClick={() => onReorder({ ...order, items: data.items || [] })} className="min-h-12 rounded-full border border-[#7c3aed]/30 bg-[#f5f3ff] px-5 py-3 font-black text-[#6d28d9]">{sfText("storefront.orders.reorder", "Reorder")}</button>
        <a href={supportHref(publicNumber)} className="min-h-12 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 text-center font-black text-emerald-700">{sfText("storefront.support.whatsapp", "WhatsApp")}</a>
      </div>
    </Panel>
  );
}

function WishlistPage({ wishlist, toggleWishlist, addToCart }) {
  const wishlistCount = Array.isArray(wishlist) ? wishlist.length : 0;
  return (
    <section className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-4 md:px-6 md:py-10">
      <div className="rounded-[2rem] border border-white/[0.08] bg-[linear-gradient(145deg,rgba(15,23,42,0.82),rgba(3,7,18,0.94))] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.34)] backdrop-blur-xl md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-black text-[#a78bfa]">{sfText("storefront.wishlist.subtitle", "Your favorite picks are saved here")}</p>
            <h1 className="mt-1 text-3xl font-black text-white md:text-5xl">{sfText("storefront.header.wishlist", "Wishlist")}</h1>
          </div>
          <div className="w-fit rounded-full border border-white/[0.1] bg-white/[0.07] px-4 py-2 text-sm font-black text-white/80 shadow-[0_12px_32px_rgba(0,0,0,0.2)]">
            {sfText("storefront.products.productCount", "{{count}} product", { count: wishlistCount })}
          </div>
        </div>

        {wishlistCount ? (
          <>
          <SmallProductGrid items={wishlist} action={toggleWishlist} addToCart={addToCart} />
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="flex items-start gap-4 rounded-[1.5rem] border border-white/[0.08] bg-white/[0.055] p-5 text-start shadow-[0_18px_50px_rgba(0,0,0,0.22)] ring-1 ring-white/[0.025] backdrop-blur-xl">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#a78bfa]/20 bg-[#7c3aed]/15 text-[#c4b5fd]">
                <Bell className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="font-black text-white">{sfText("storefront.wishlist.priceDropAlert", "Price drop alert")}</div>
                <p className="mt-1 text-sm font-bold leading-6 text-white/60">{sfText("storefront.wishlist.priceDropSoon", "Soon we will notify you when a wishlist product price drops.")}</p>
              </div>
            </div>
            <div className="flex items-start gap-4 rounded-[1.5rem] border border-white/[0.08] bg-white/[0.055] p-5 text-start shadow-[0_18px_50px_rgba(0,0,0,0.22)] ring-1 ring-white/[0.025] backdrop-blur-xl">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-200">
                <PackageSearch className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="font-black text-white">{sfText("storefront.wishlist.backInStockAlert", "Back in stock alert")}</div>
                <p className="mt-1 text-sm font-bold leading-6 text-white/60">{sfText("storefront.wishlist.backInStockSoon", "Soon we will notify you when your size returns.")}</p>
              </div>
            </div>
          </div>
          </>
        ) : <EmptyState title={sfText("storefront.wishlist.emptyTitle", "Your wishlist is empty")} text={sfText("storefront.wishlist.emptyText", "Save products you like here")} />}
      </div>
    </section>
  );
}

function RecentPage({ recent }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">{sfText("storefront.recent.lastTwenty", "Last 20 products")}</p>
          <h1 className="text-3xl font-black md:text-5xl">{sfText("storefront.account.recentlyViewed", "Recently viewed")}</h1>
        </div>
        <Link to="/shop/products" className="inline-flex min-h-12 items-center justify-center rounded-full bg-stone-950 px-5 py-3 font-black text-white">{sfText("storefront.common.continueShopping", "Continue shopping")}</Link>
      </div>
      {recent.length ? <SmallProductGrid items={recent.slice(0, 20)} /> : <EmptyState title={sfText("storefront.recent.emptyTitle", "No products here yet")} text={sfText("storefront.account.recentEmpty", "Recently viewed products will appear here")} />}
    </section>
  );
}

function FaqPage() {
  const items = [
    [sfText("storefront.faq.deliveryTime.question", "Delivery time?"), sfText("storefront.faq.deliveryTime.answer", "Usually 2 to 5 business days depending on governorate and shipping provider.")],
    [sfText("storefront.faq.paymentMethods.question", "Payment methods?"), sfText("storefront.faq.paymentMethods.answer", "Cash on delivery is available, and electronic payment support is ready to add.")],
    [sfText("storefront.faq.exchangeReturns.question", "Exchange and return?"), sfText("storefront.faq.exchangeReturns.answer", "Available within 14 days under the policy conditions.")],
    [sfText("storefront.faq.sizeHelp.question", "Size help?"), sfText("storefront.faq.sizeHelp.answer", "Use the size guide or contact us on WhatsApp.")],
    [sfText("storefront.faq.trackOrder.question", "Track order?"), sfText("storefront.faq.trackOrder.answer", "Use the tracking page with order number and phone.")],
    [sfText("storefront.faq.shippingProviders.question", "Shipping providers?"), sfText("storefront.faq.shippingProviders.answer", "The system is ready for Bosta, Mylerz, Aramex, and manual delivery.")],
  ];
  return <StaticPage title={sfText("storefront.faq.title", "FAQ")} items={items} />;
}

function ContactPage() {
  return (
    <StaticPage
      title={sfText("storefront.contact.title", "Contact us")}
      items={[
        [sfText("storefront.contact.phone", "Phone"), "01000000000"],
        [sfText("storefront.support.whatsapp", "WhatsApp"), sfText("storefront.contact.whatsappHint", "Tap the support button from any order page.")],
        ["Instagram", "@store"],
        ["Facebook", "Store page"],
        [sfText("storefront.contact.address", "Address"), sfText("storefront.contact.addressPlaceholder", "Branch location appears here.")],
        [sfText("storefront.contact.workingHours", "Working hours"), sfText("storefront.contact.workingHoursValue", "Daily from 12 PM to 11 PM.")],
      ]}
    />
  );
}

function SizeGuide() {
  const sizeRows = [
    { eu: 39, foot: "24.8 cm", usMen: "6.5", usWomen: "8", uk: "6", note: sfText("storefront.sizeGuide.notes.39", "Good for relatively small feet") },
    { eu: 40, foot: "25.4 cm", usMen: "7", usWomen: "8.5", uk: "6.5", note: sfText("storefront.sizeGuide.notes.40", "A common daily casual choice") },
    { eu: 41, foot: "26.0 cm", usMen: "8", usWomen: "9.5", uk: "7.5", note: sfText("storefront.sizeGuide.notes.41", "If your foot is wide, choose half a size up when available") },
    { eu: 42, foot: "26.6 cm", usMen: "8.5", usWomen: "10", uk: "8", note: sfText("storefront.sizeGuide.notes.42", "Most requested in men's models") },
    { eu: 43, foot: "27.2 cm", usMen: "9.5", usWomen: "11", uk: "9", note: sfText("storefront.sizeGuide.notes.43", "Suitable for medium to wide feet") },
    { eu: 44, foot: "27.8 cm", usMen: "10", usWomen: "11.5", uk: "9.5", note: sfText("storefront.sizeGuide.notes.44", "Check the model shape if it is Slim Fit") },
    { eu: 45, foot: "28.4 cm", usMen: "11", usWomen: "12.5", uk: "10.5", note: sfText("storefront.sizeGuide.notes.45", "Better if you are between 44 and 45") },
  ];
  const measureSteps = [
    ["1", sfText("storefront.sizeGuide.steps.paper.title", "Stand on paper"), sfText("storefront.sizeGuide.steps.paper.text", "Place your foot on paper over a flat floor while standing with your full weight.")],
    ["2", sfText("storefront.sizeGuide.steps.mark.title", "Mark the edges"), sfText("storefront.sizeGuide.steps.mark.text", "Mark the heel start and longest toe end without tilting the foot.")],
    ["3", sfText("storefront.sizeGuide.steps.measure.title", "Measure in centimeters"), sfText("storefront.sizeGuide.steps.measure.text", "Use a ruler or tape and measure the distance between marks accurately.")],
    ["4", sfText("storefront.sizeGuide.steps.larger.title", "Choose the larger"), sfText("storefront.sizeGuide.steps.larger.text", "Repeat for both feet and choose based on the larger foot.")],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 text-stone-950 dark:text-white md:py-12" dir="rtl">
      <div className="mb-6 flex flex-col gap-3 md:mb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#7c3aed] dark:text-[#c4b5fd]">{sfText("storefront.sizeGuide.eyebrow", "Shoe Fit Guide")}</p>
          <h1 className="mt-1 text-3xl font-black tracking-normal md:text-5xl">{sfText("storefront.sizeGuide.title", "Size guide")}</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-stone-600 dark:text-slate-300 md:text-base">
            {sfText("storefront.sizeGuide.subtitle", "Measurements are approximate and may vary slightly by foot shape, shoe material, and model design. If your foot is wide or between sizes, choose the larger size.")}
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200">
          <Footprints className="h-4 w-4 text-[#7c3aed] dark:text-[#c4b5fd]" />
          {sfText("storefront.sizeGuide.centimeterMeasurement", "Foot measurement in centimeters")}
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_22px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(2,6,23,0.98),rgba(15,23,42,0.94)_45%,rgba(12,10,28,0.96))] dark:shadow-[0_24px_80px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="border-b border-slate-200 px-4 py-4 dark:border-white/10 sm:px-6">
          <h2 className="text-xl font-black text-stone-950 dark:text-white">{sfText("storefront.sizeGuide.tableTitle", "Shoe size table")}</h2>
          <p className="mt-1 text-sm font-bold text-stone-500 dark:text-slate-400">{sfText("storefront.sizeGuide.mobileScrollHint", "Scroll the table horizontally on mobile to view all columns.")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-right text-sm font-bold">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-black text-stone-600 dark:border-white/10 dark:bg-white/[0.045] dark:text-slate-300">
                <th className="whitespace-nowrap px-5 py-4">{sfText("storefront.sizeGuide.euSize", "EU size")}</th>
                <th className="whitespace-nowrap px-5 py-4">{sfText("storefront.sizeGuide.footLength", "Foot length")}</th>
                <th className="whitespace-nowrap px-5 py-4">US Men</th>
                <th className="whitespace-nowrap px-5 py-4">US Women</th>
                <th className="whitespace-nowrap px-5 py-4">UK</th>
                <th className="whitespace-nowrap px-5 py-4">{sfText("storefront.sizeGuide.notesLabel", "Notes")}</th>
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
            <h2 className="text-2xl font-black text-stone-950 dark:text-white">{sfText("storefront.sizeGuide.measurementMethod", "Measurement method")}</h2>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-stone-600 dark:text-slate-300">
              {sfText("storefront.sizeGuide.measurementIntro", "Correct measurement helps you choose the closest size from the first time. Stand while measuring because foot length increases slightly with weight.")}
            </p>
          </div>
          <a href="https://wa.me/" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-500 px-5 py-3 text-sm font-black text-white shadow-[0_14px_34px_rgba(16,185,129,0.28)] transition hover:-translate-y-0.5 hover:bg-emerald-400 dark:border-emerald-300/25 dark:bg-emerald-500/95 dark:text-white">
            <MessageCircle className="h-4 w-4" />
            {sfText("storefront.support.whatsappHelp", "WhatsApp help")}
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
              aria-label={sfText("storefront.sizeGuide.illustrationAria", "Illustration for measuring foot length from heel to longest toe")}
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
                <text x="185" y="228" textAnchor="middle" fill="#d1fae5" fontSize="18" fontWeight="900">{sfText("storefront.sizeGuide.heel", "Heel")}</text>
              </g>

              <g>
                <line x1="622" y1="166" x2="622" y2="324" stroke="#f59e0b" strokeWidth="3" strokeDasharray="8 8" />
                <circle cx="622" cy="166" r="8" fill="#f59e0b" />
                <rect x="552" y="118" width="142" height="38" rx="19" fill="#78350f" opacity="0.95" />
                <text x="623" y="142" textAnchor="middle" fill="#fef3c7" fontSize="17" fontWeight="900">{sfText("storefront.sizeGuide.longestToe", "Longest toe")}</text>
              </g>

              <rect x="315" y="276" width="190" height="42" rx="21" fill="#111827" opacity="0.96" />
              <text x="410" y="303" textAnchor="middle" fill="#ffffff" fontSize="18" fontWeight="900">{sfText("storefront.sizeGuide.lengthCm", "Length in centimeters")}</text>
            </svg>
          </div>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm font-black leading-7 text-stone-600 dark:text-slate-300">
              {sfText("storefront.sizeGuide.measurementCaption", "Measure foot length from heel to longest toe for the most accurate size.")}
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
      <h1 className="text-3xl font-black">{sfText("storefront.returns.title", "Exchange and return policy")}</h1>
      <div className="mt-5 rounded-3xl border border-stone-200 bg-white p-6 text-lg font-bold leading-9 text-stone-700">
        <p>{returnPolicy}</p>
        <p>{sfText("storefront.returns.noBags", "Bags cannot be exchanged or returned.")}</p>
        <p>{sfText("storefront.returns.originalCondition", "The product must be in its original condition.")}</p>
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
    sfText("storefront.checkout.progress.customer", "Your details"),
    sfText("storefront.checkout.progress.address", "Address"),
    sfText("storefront.checkout.progress.payment", "Payment"),
    sfText("storefront.checkout.progress.confirmation", "Confirmation"),
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
            className={`flex min-h-10 items-center justify-center rounded-2xl px-1 transition disabled:cursor-default ${index + 1 < activeIndex ? "border border-[#a78bfa]/20 bg-[#7c3aed]/18 text-[#ddd6fe]" : index + 1 === activeIndex ? "border border-[#a78bfa]/35 bg-[#7c3aed] text-white shadow-[0_10px_24px_rgba(124,58,237,0.24)]" : "border border-white/8 bg-white/[0.035] text-white/38"}`}
          >
            <span className="truncate">{step}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TrustPills({ compact = false }) {
  const items = [
    [sfText("storefront.checkout.trust.safeData", "Your data is safe"), <Check className="h-4 w-4" />],
    [sfText("storefront.checkout.trust.fastShipping", "Fast shipping"), <Truck className="h-4 w-4" />],
    [sfText("storefront.checkout.trust.exchange", "Exchange within 14 days"), <PackageCheck className="h-4 w-4" />],
    [sfText("storefront.checkout.trust.whatsapp", "WhatsApp support"), <MessageCircle className="h-4 w-4" />],
  ];
  return (
    <div className={`grid grid-cols-2 gap-2 text-xs font-black text-white/70 ${compact ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
      {items.map(([label, icon]) => (
        <span key={label} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/[0.055] px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.18)] backdrop-blur-xl">
          <span className="text-[#c4b5fd]">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
      ))}
    </div>
  );
}

function SubmitButton({ submitting, compact = false, paymentMethod = "cod", disabled = submitting, label }) {
  const fallbackLabel = paymentMethod === "cod" ? sfText("storefront.checkout.actions.confirmOrder", "Confirm order") : sfText("storefront.checkout.actions.uploadProofAndConfirm", "Upload transfer proof and confirm order");
  return (
    <button
      form="storefront-checkout-form"
      type="submit"
      disabled={disabled}
      className={`sf-checkout-submit-button sf-shimmer-button inline-flex items-center justify-center gap-2 rounded-full border border-[#a78bfa]/20 bg-[linear-gradient(135deg,rgba(124,58,237,0.96),rgba(17,24,39,0.98))] font-black text-white shadow-[0_18px_42px_rgba(124,58,237,0.24)] transition duration-200 hover:-translate-y-0.5 hover:border-[#c4b5fd]/40 hover:bg-[#6d28d9] hover:shadow-[0_22px_54px_rgba(109,40,217,0.34)] active:translate-y-0 active:scale-[0.985] disabled:translate-y-0 disabled:border-white/10 disabled:bg-slate-700 disabled:text-white/55 disabled:shadow-none ${compact ? "sf-checkout-submit-button--compact min-h-13 min-w-36 px-5 py-3 text-sm" : "min-h-14 w-full px-5 py-4"}`}
    >
      {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
      <span>{submitting ? sfText("storefront.checkout.actions.confirming", "Confirming your order...") : label || fallbackLabel}</span>
    </button>
  );
}

function CheckoutSection({ number, title, note, children }) {
  return (
    <section className="sf-reveal rounded-[1.6rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035)_42%,rgba(7,10,20,0.86))] p-4 text-white shadow-[0_22px_60px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl md:p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#a78bfa]/25 bg-[#7c3aed]/24 text-sm font-black text-white shadow-[0_12px_28px_rgba(124,58,237,0.20)]">{number}</span>
        <div>
          <h2 className="text-lg font-black text-white md:text-xl">{title}</h2>
          {note ? <p className="mt-1 text-xs font-bold text-white/56">{note}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function CheckoutSummary({ cart, subtotal, discount, deliveryFee, total, codAmount, governorate, paymentMethod, open, setOpen, submitting, submitDisabled, actionLabel }) {
  const { t } = useTranslation();
  return (
    <aside className="h-max rounded-[1.7rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035)_42%,rgba(7,10,20,0.9))] p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.06)] ring-1 ring-white/[0.04] backdrop-blur-2xl lg:sticky lg:top-24 md:p-5">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-10 w-full items-center justify-between md:pointer-events-none">
        <span className="text-xl font-black text-white">{t("storefront.checkout.orderSummary", "Order summary")}</span>
        <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1 text-xs font-black text-white/70 md:hidden">{open ? t("common.hide", "Hide") : t("common.show", "Show")}</span>
      </button>
      <div className={`${open ? "block" : "hidden"} mt-3 space-y-2.5 md:block`}>
        {cart.map((item) => {
          const comparePrice = displayCartItemComparePrice(item);
          return (
            <div key={item.lineId} className="sf-reveal flex min-w-0 items-center gap-3 rounded-2xl bg-white/[0.045] p-2.5 ring-1 ring-white/10">
              <img src={imageFor(item.image_url)} alt="" className="h-18 w-18 shrink-0 rounded-2xl object-cover shadow-sm" loading="lazy" decoding="async" width="72" height="72" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black leading-5 text-white">{item.name}</div>
                <div className="mt-1 inline-flex rounded-full bg-white/[0.055] px-2 py-1 text-[11px] font-black text-white/60 ring-1 ring-white/10">{item.color || t("storefront.products.color", "Color")} / {item.size || t("storefront.products.size", "Size")} × {item.quantity}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-white/42">
                  <span>{t("storefront.checkout.unitPrice", "Unit price")} {money(item.price)}</span>
                  {comparePrice ? <span className="line-through">{money(comparePrice)}</span> : null}
                </div>
              </div>
              <div className="shrink-0 text-sm font-black text-white">{money(item.price * item.quantity)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 shadow-inner shadow-black/30">
        <SummaryRow dark label={t("storefront.checkout.products", "Products")} value={money(subtotal)} />
        <SummaryRow dark label={t("storefront.checkout.discount", "Discount")} value={discount ? `-${money(discount)}` : money(0)} />
        <SummaryRow dark label={t("storefront.checkout.shipping", "Shipping")} value={governorate ? money(deliveryFee) : t("storefront.checkout.chooseGovernorate", "Choose governorate")} />
        <SummaryRow dark label={t("storefront.checkout.total", "Total")} value={money(total)} strong />
        {codAmount ? <SummaryRow dark label={paymentMethod === "cod" ? t("storefront.checkout.codOnDelivery", "COD on delivery") : t("storefront.checkout.remainingOnDelivery", "Remaining on delivery")} value={money(codAmount)} /> : null}
      </div>
      <div className="mt-3 grid gap-2 text-xs font-bold text-white/58">
        <span className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-emerald-100">{t("storefront.checkout.expectedDeliveryNotice", "Expected delivery is 2 to 5 business days depending on governorate.")}</span>
        <span className="rounded-2xl border border-[#a78bfa]/20 bg-[#7c3aed]/12 px-3 py-2 text-[#ddd6fe]">{t("storefront.checkout.shippingProvidersReady", "Shipping data is ready for Bosta / Mylerz / Aramex when the provider is enabled.")}</span>
      </div>
      <div className="mt-4 hidden md:block">
        <SubmitButton submitting={submitting} paymentMethod={paymentMethod} disabled={submitDisabled} label={actionLabel} />
        <div className="mt-3">
          <TrustPills />
        </div>
      </div>
    </aside>
  );
}

function SuccessTimeline() {
  const steps = getStatusLabels();
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step} className={`sf-order-step sf-reveal rounded-2xl border p-3 ${index === 0 ? "sf-order-step--done border-emerald-200 bg-emerald-50" : index === 1 ? "sf-order-step--active border-amber-200 bg-amber-50" : "sf-order-step--pending border-stone-200 bg-stone-50"}`}>
          <div className={`sf-order-step-icon mb-2 grid h-8 w-8 place-items-center rounded-full ${index === 0 ? "bg-emerald-600 text-white" : index === 1 ? "bg-amber-400 text-white" : "bg-stone-200 text-stone-500"}`}>
            {index === 0 ? <Check className="h-4 w-4" /> : index === 1 ? "..." : index + 1}
          </div>
          <div className="sf-order-step-label text-xs font-black leading-5">{step}</div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, required, error, inputMode, placeholder }) {
  return (
    <label className="sf-field block">
      <span className="sf-field-label mb-1.5 block text-sm font-black text-white/82">{label}{required ? " *" : ""}</span>
      <input required={required} inputMode={inputMode} placeholder={placeholder || ""} value={value} onChange={(event) => onChange(event.target.value)} className={`sf-field-input min-h-14 w-full rounded-2xl border bg-white/[0.055] px-4 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:border-[#a78bfa] focus:bg-white/[0.075] focus:shadow-[0_0_0_4px_rgba(167,139,250,0.16),0_18px_38px_rgba(124,58,237,0.16)] ${error ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" : "border-white/12"}`} />
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-200">{error}</span> : null}
    </label>
  );
}

function TextField({ label, value, onChange, required, error, compact, placeholder }) {
  return (
    <label className="block md:col-span-2">
      <span className="mb-1.5 block text-sm font-black text-white/82">{label}{required ? " *" : ""}</span>
      <textarea required={required} placeholder={placeholder || ""} value={value} onChange={(event) => onChange(event.target.value)} rows={compact ? 2 : 3} className={`w-full rounded-2xl border bg-white/[0.055] p-4 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:border-[#a78bfa] focus:bg-white/[0.075] focus:shadow-[0_0_0_4px_rgba(167,139,250,0.16),0_18px_38px_rgba(124,58,237,0.16)] ${error ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" : "border-white/12"}`} />
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-200">{error}</span> : null}
    </label>
  );
}

function CityAreaField({ governorate, options, value, onChange, manual, onManualChange, required, error }) {
  const selectOptions = [
    ...options.map((option) => ({ value: option, label: option })),
    { value: MANUAL_CITY_AREA, label: MANUAL_CITY_AREA },
  ];
  const selectedOption = manual
    ? selectOptions[selectOptions.length - 1]
    : selectOptions.find((option) => option.value === value) || null;

  return (
    <div className="block">
      <span className="mb-1.5 block text-sm font-black text-white/82">المدينة / المنطقة{required ? " *" : ""}</span>
      <Suspense fallback={<CityAreaNativeSelect governorate={governorate} options={selectOptions} value={manual ? MANUAL_CITY_AREA : value} onChange={onChange} required={required} error={error} />}>
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
              ? sfText("storefront.checkout.cityAreaPlaceholder", "Choose or search city / area")
              : sfText("storefront.checkout.chooseGovernorateFirst", "Choose governorate first")
          }
          noOptionsMessage={() => sfText("storefront.common.noResults", "No results")}
          onChange={(option) => onChange(option?.value || "")}
          menuPortalTarget={typeof document !== "undefined" ? document.body : null}
          styles={{
            control: (base, state) => ({
              ...base,
              minHeight: 56,
              borderRadius: 16,
              backgroundColor: state.isFocused ? "rgba(255,255,255,0.075)" : "rgba(255,255,255,0.055)",
              borderColor: error ? "rgba(253,164,175,0.78)" : state.isFocused ? "#a78bfa" : "rgba(255,255,255,0.12)",
              boxShadow: state.isFocused ? "0 0 0 4px rgba(167,139,250,0.16),0 18px 38px rgba(124,58,237,0.16)" : "0 12px 28px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
              direction: "rtl",
              paddingInline: 4,
              transition: "all 200ms ease",
              "&:hover": { borderColor: error ? "#fb7185" : "#a78bfa" },
            }),
            valueContainer: (base) => ({ ...base, paddingInline: 10 }),
            input: (base) => ({ ...base, color: "#ffffff", fontSize: 15, fontWeight: 700 }),
            singleValue: (base) => ({ ...base, color: "#ffffff", fontSize: 15, fontWeight: 700 }),
            placeholder: (base) => ({ ...base, color: "rgba(255,255,255,0.38)", fontSize: 15, fontWeight: 700 }),
            dropdownIndicator: (base) => ({ ...base, color: "rgba(255,255,255,0.58)" }),
            indicatorSeparator: (base) => ({ ...base, backgroundColor: "rgba(255,255,255,0.12)" }),
            menu: (base) => ({ ...base, zIndex: 80, borderRadius: 16, overflow: "hidden", direction: "rtl", backgroundColor: "#0b1020", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 24px 60px rgba(0,0,0,0.42)" }),
            menuPortal: (base) => ({ ...base, zIndex: 9999 }),
            option: (base, state) => ({
              ...base,
              backgroundColor: state.isSelected ? "#7c3aed" : state.isFocused ? "rgba(124,58,237,0.18)" : "#0b1020",
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
          placeholder={sfText("storefront.checkout.cityAreaManualPlaceholder", "Write city or area")}
          value={value}
          onChange={(event) => onManualChange(event.target.value)}
          className={`mt-2 min-h-14 w-full rounded-2xl border bg-white/[0.055] px-4 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 placeholder:text-white/34 focus:-translate-y-0.5 focus:border-[#a78bfa] focus:bg-white/[0.075] focus:shadow-[0_0_0_4px_rgba(167,139,250,0.16),0_18px_38px_rgba(124,58,237,0.16)] ${error ? "border-rose-300/70 focus:border-rose-300 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.14)]" : "border-white/12"}`}
        />
      ) : null}
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-200">{error}</span> : null}
    </div>
  );
}

function CityAreaNativeSelect({ governorate, options, value, onChange, required, error }) {
  return (
    <select
      required={required}
      disabled={!governorate}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      className={`min-h-14 w-full rounded-2xl border bg-white/[0.055] px-4 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 focus:-translate-y-0.5 focus:border-[#a78bfa] focus:bg-white/[0.075] focus:shadow-[0_0_0_4px_rgba(167,139,250,0.16),0_18px_38px_rgba(124,58,237,0.16)] disabled:opacity-60 ${error ? "border-rose-300/70 focus:border-rose-300" : "border-white/12"}`}
    >
      <option value="" className="bg-[#0b1020] text-white">
        {governorate ? sfText("storefront.checkout.cityAreaPlaceholder", "Choose or search city / area") : sfText("storefront.checkout.chooseGovernorateFirst", "Choose governorate first")}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-[#0b1020] text-white">
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SelectField({ label, value, onChange, options, labels = {}, required, error }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-black text-white/82">{label}{required ? " *" : ""}</span>
      <select required={required} value={value} onChange={(event) => onChange(event.target.value)} className={`min-h-14 w-full rounded-2xl border bg-white/[0.055] px-4 text-[15px] font-bold text-white shadow-[0_12px_28px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur transition duration-200 focus:-translate-y-0.5 focus:border-[#a78bfa] focus:bg-white/[0.075] focus:shadow-[0_0_0_4px_rgba(167,139,250,0.16),0_18px_38px_rgba(124,58,237,0.16)] ${error ? "border-rose-300/70 focus:border-rose-300" : "border-white/12"}`}>
        <option value="" className="bg-[#0b1020] text-white">{sfText("storefront.common.choose", "Choose")}</option>
        {options.map((option) => <option key={option} value={option} className="bg-[#0b1020] text-white">{labels[option] || option}</option>)}
      </select>
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-200">{error}</span> : null}
    </label>
  );
}

function ProductSkeleton({ count }) {
  return Array.from({ length: count }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-[1.75rem] bg-white shadow-[0_12px_32px_rgba(39,20,75,0.06)]" />);
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
        {actionLabel || sfText("storefront.common.shopNow", "Shop now")}
      </Link>
    </div>
  );
}

function CartDrawer({ open, onClose, cart, updateCart, removeFromCart }) {
  if (!open) return null;
  const subtotal = cart.reduce((sum, item) => sum + displayCartItemPrice(item) * item.quantity, 0);
  const total = subtotal + 60;
  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} aria-label={sfText("storefront.common.close", "Close")} />
      <aside className="absolute inset-x-0 bottom-0 flex max-h-[94dvh] min-h-[72dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,18,33,0.98),rgba(7,10,20,0.98))] text-white shadow-[0_-28px_80px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:min-h-0 md:w-[28rem] md:rounded-s-[2rem] md:rounded-tr-none">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.035] px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-black text-[#c4b5fd]">{cart.length ? sfText("storefront.products.productCount", "{{count}} product", { count: cart.length }) : sfText("storefront.cart.readyToShop", "Ready to shop")}</p>
            <h2 className="mt-1 truncate text-2xl font-black text-white">{sfText("storefront.cart.title", "Cart")}</h2>
          </div>
          <button onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.065] text-white/74 shadow-[0_12px_28px_rgba(0,0,0,0.24)] transition hover:bg-white/[0.10] hover:text-white active:scale-95" aria-label={sfText("storefront.common.close", "Close")}><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">
          {!cart.length ? (
            <EmptyState title={sfText("storefront.cart.emptyTitle", "Your cart is empty")} text={sfText("storefront.cart.emptyCheckoutText", "Choose a product first, then complete checkout")} />
          ) : (
            <div className="grid gap-3 pb-2">
              {cart.map((item) => (
                <MobileCartRow key={item.lineId} item={item} updateCart={updateCart} removeFromCart={removeFromCart} />
              ))}
            </div>
          )}
        </div>
        {cart.length ? (
          <div className="shrink-0 border-t border-white/10 bg-[#070b16]/92 px-4 pb-[calc(1.35rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-24px_60px_rgba(0,0,0,0.34)] backdrop-blur-2xl sm:px-5">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black text-white/54">{sfText("storefront.checkout.total", "Total")}</p>
                <p className="mt-1 text-2xl font-black leading-none text-white">{money(total)}</p>
              </div>
              <p className="max-w-32 text-start text-[11px] font-bold leading-5 text-white/46">{sfText("storefront.checkout.finalShippingAtCheckout", "Final shipping at checkout")}</p>
            </div>
            <Link to="/shop/checkout" onClick={onClose} className="sf-shimmer-button block min-h-14 rounded-full border border-[#a78bfa]/20 bg-[linear-gradient(135deg,rgba(124,58,237,0.96),rgba(17,24,39,0.98))] px-5 py-4 text-center text-base font-black text-white shadow-[0_18px_42px_rgba(124,58,237,0.26)] transition hover:-translate-y-0.5 hover:border-[#c4b5fd]/40 hover:shadow-[0_22px_54px_rgba(109,40,217,0.34)] active:translate-y-0 active:scale-[0.98]">
              {sfText("storefront.checkout.actions.completePurchase", "Complete purchase")}
            </Link>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function MobileCartRow({ item, updateCart, removeFromCart }) {
  return (
    <article className="w-full min-w-0 rounded-[1.35rem] border border-white/10 bg-white/[0.055] p-3 text-white shadow-[0_16px_42px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl">
      <div className="flex min-w-0 items-start gap-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/[0.065] ring-1 ring-white/10">
          <img src={imageFor(item.image_url)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" width="80" height="80" />
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
        <button onClick={() => removeFromCart(item.lineId)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-rose-300/20 bg-rose-500/10 text-rose-200 shadow-[0_10px_24px_rgba(244,63,94,0.10)] transition hover:bg-rose-500/16 hover:text-rose-100 active:scale-95" aria-label={sfText("storefront.cart.removeItem", "Remove item")}>
          <Trash2 className="h-5 w-5" />
        </button>
      </div>
    </article>
  );
}

function QuantityStepper({ quantity, onMinus, onPlus }) {
  return (
    <div className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-white/10 bg-black/20 p-1 shadow-inner shadow-black/30">
      <button onClick={onMinus} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.065] text-white/78 shadow-sm transition hover:bg-white/[0.10] hover:text-white active:scale-95" aria-label={sfText("storefront.cart.decreaseQuantity", "Decrease quantity")}>
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-9 px-1 text-center text-sm font-black tabular-nums text-white">{quantity}</span>
      <button onClick={onPlus} className="grid h-9 w-9 place-items-center rounded-full border border-[#a78bfa]/30 bg-[#7c3aed]/24 text-white shadow-[0_10px_22px_rgba(124,58,237,0.16)] transition hover:bg-[#7c3aed]/34 active:scale-95" aria-label={sfText("storefront.cart.increaseQuantity", "Increase quantity")}>
        +
      </button>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-4 border-t border-stone-200 bg-[#f0ebe2] px-4 py-6 md:mt-8 md:py-10 dark:border-white/10 dark:bg-[linear-gradient(180deg,#050816,#020617)] dark:text-white">
      <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-[1.2fr_0.8fr_0.8fr_1fr]">
        <div><h3 className="text-2xl font-black tracking-normal">{sfText("storefront.footer.brand", "Storefront")}</h3><p className="mt-2 max-w-sm text-sm font-bold leading-6 text-stone-600 dark:text-stone-400">{sfText("storefront.footer.tagline", "A simple and fast shopping experience connected to real inventory.")}</p></div>
        <FooterLinks title={sfText("storefront.footer.links", "Links")} links={[[sfText("storefront.returns.title", "Exchange policy"), "/shop/returns"], [sfText("storefront.nav.sizeGuide", "Size guide"), "/shop/size-guide"], [sfText("storefront.faq.title", "FAQ"), "/shop/faq"]]} />
        <FooterLinks title={sfText("storefront.footer.contact", "Contact")} links={[[sfText("storefront.contact.title", "Contact"), "/shop/contact"], [sfText("storefront.support.whatsapp", "WhatsApp"), "https://wa.me/"], ["Instagram", "/shop/contact"]]} />
        <div>
          <h4 className="font-black">{sfText("storefront.footer.followUs", "Follow us")}</h4>
          <div className="mt-3 flex gap-2">
            <a href="https://wa.me/" className="grid h-11 w-11 place-items-center rounded-full border border-stone-200 bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:text-emerald-600 dark:border-white/12 dark:bg-white/[0.075] dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:border-emerald-300/40 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-300" aria-label="WhatsApp"><MessageCircle className="h-5 w-5" /></a>
            <Link to="/shop/contact" className="grid h-11 w-11 place-items-center rounded-full border border-stone-200 bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c4b5fd] hover:text-[#6d28d9] dark:border-white/12 dark:bg-white/[0.075] dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:border-[#c4b5fd]/40 dark:hover:bg-[#7c3aed]/12 dark:hover:text-[#d8b4fe]" aria-label="Instagram"><Camera className="h-5 w-5" /></Link>
            <Link to="/shop/contact" className="grid h-11 w-11 place-items-center rounded-full border border-stone-200 bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:border-[#c4b5fd] hover:text-[#6d28d9] dark:border-white/12 dark:bg-white/[0.075] dark:text-slate-100 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:border-[#c4b5fd]/40 dark:hover:bg-[#7c3aed]/12 dark:hover:text-[#d8b4fe]" aria-label="Facebook"><Send className="h-5 w-5" /></Link>
          </div>
          <a href="https://wa.me/" className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-emerald-300/30 bg-stone-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-[#6d28d9] dark:bg-emerald-500 dark:text-white dark:shadow-[0_14px_34px_rgba(16,185,129,0.22)] dark:hover:bg-emerald-400">
            <MessageCircle className="h-4 w-4" />
            {sfText("storefront.support.whatsappHelp", "WhatsApp help")}
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
    { id: "home", to: "/shop", label: sfText("storefront.nav.home", "Home"), icon: Home },
    { id: "products", to: "/shop/products", label: sfText("storefront.nav.categories", "Categories"), icon: Menu },
    { id: "search", to: "/shop/products?search=1", label: sfText("storefront.common.search", "Search"), icon: Search },
    { id: "wishlist", to: "/shop/wishlist", label: sfText("storefront.header.wishlist", "Wishlist"), icon: Heart },
    { id: "cart", to: "/shop/cart", label: sfText("storefront.cart.title", "Cart"), icon: ShoppingCart },
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
      className="fixed inset-x-0 bottom-0 z-40 h-[calc(var(--mobile-bottom-nav-height)+var(--safe-bottom))] border-t border-white/10 bg-slate-950/[0.88] px-3 pb-[var(--safe-bottom)] pt-1.5 shadow-[0_-18px_46px_rgba(0,0,0,0.32),0_1px_0_rgba(255,255,255,0.05)_inset] backdrop-blur-2xl md:hidden"
      aria-label={sfText("storefront.nav.mobileNavigation", "Storefront mobile navigation")}
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
                  ? "scale-[1.03] bg-white/12 text-white shadow-[0_0_24px_rgba(16,185,129,0.20)]"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-6 w-6 place-items-center rounded-full transition duration-300",
                  active ? "bg-emerald-400/16 text-emerald-200" : "text-slate-300 group-hover:text-white",
                ].join(" ")}
              >
                <Icon className="h-[17px] w-[17px]" strokeWidth={2.15} />
              </span>
              <span className={`max-w-full truncate ${active ? "font-black text-white" : "font-semibold"}`}>{item.label}</span>
              {item.id === "cart" && badgeCount > 0 ? (
                <span className="absolute left-2 top-1 min-w-4 rounded-full border border-white/20 bg-rose-500 px-1.5 py-0.5 text-[8.5px] font-black leading-none text-white shadow-[0_0_14px_rgba(244,63,94,0.55)] animate-[pulse_1.8s_ease-in-out_infinite]">
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

function SummaryRow({ label, value, strong, dark = false }) {
  if (dark) {
    return <div className={`flex items-center justify-between gap-3 ${strong ? "mt-3 border-t border-white/10 pt-3 text-xl font-black text-white" : "mt-2 text-sm font-bold text-white/58"}`}><span>{label}</span><span className={strong ? "rounded-full border border-[#a78bfa]/20 bg-[#7c3aed]/18 px-3 py-1 text-white shadow-[0_10px_24px_rgba(124,58,237,0.18)]" : "font-black text-white"}>{value}</span></div>;
  }
  return <div className={`flex items-center justify-between gap-3 ${strong ? "mt-3 border-t border-stone-200 pt-3 text-xl font-black text-stone-950" : "mt-2 text-sm font-bold text-stone-600"}`}><span>{label}</span><span className={strong ? "rounded-full bg-white px-3 py-1 shadow-sm" : "font-black text-stone-800"}>{value}</span></div>;
}

function InfoLine({ icon, text }) {
  return (
    <div className="flex min-h-14 items-center gap-2 rounded-[1rem] border border-white/[0.08] bg-white/[0.055] p-3 text-white/74 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur transition hover:border-white/16 hover:bg-white/[0.075]">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-[#c4b5fd]">{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function PaymentMethodTab({ method, active, onClick }) {
  const isVodafone = method === "vodafone_cash";
  const subtitle = isVodafone
    ? sfText("storefront.checkout.transfer.vodafoneWallet", "Vodafone wallet")
    : sfText("storefront.checkout.transfer.instantBankTransfer", "Instant bank transfer");
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden rounded-[1.2rem] px-3 py-3 text-right transition duration-300 active:scale-[0.985] ${
        active
          ? isVodafone
            ? "border border-red-300/35 bg-[linear-gradient(135deg,rgba(230,0,0,0.28),rgba(255,255,255,0.08))] text-white shadow-[0_18px_42px_rgba(230,0,0,0.20)] ring-2 ring-red-400/12"
            : "border border-[#c4b5fd]/45 bg-[linear-gradient(135deg,rgba(124,58,237,0.34),rgba(255,255,255,0.10))] text-white shadow-[0_18px_46px_rgba(124,58,237,0.28)] ring-2 ring-[#a78bfa]/16"
          : "border border-transparent text-white/58 hover:border-white/10 hover:bg-white/[0.065] hover:text-white hover:shadow-[0_16px_36px_rgba(124,58,237,0.12)]"
      }`}
    >
      <span className={`absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100 ${isVodafone ? "bg-[radial-gradient(circle_at_top_left,rgba(230,0,0,0.22),transparent_42%)]" : "bg-[radial-gradient(circle_at_top_left,rgba(196,181,253,0.22),transparent_42%)]"}`} />
      <span className="relative flex items-center gap-3">
        <PaymentBrandLogo method={method} size="tab" active={active} />
        <span className="min-w-0">
          <span className="block text-sm font-black">{paymentBrandLabels[method]}</span>
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

function PaymentBrandLogo({ method, size = "tab", active = false }) {
  const [failed, setFailed] = useState(false);
  const label = paymentBrandLabels[method] || "Payment";
  const logo = paymentBrandLogos[method] || {};
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
          {logo.webp ? <source srcSet={logo.webp} type="image/webp" /> : null}
          <img
            src={logo.png}
            alt={label}
            className={imageClass}
            decoding="async"
            width="32"
            height="32"
            onError={() => setFailed(true)}
          />
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
    toast.success(sfText("storefront.toasts.copied", "Copied."));
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className={`rounded-[1.55rem] border p-4 shadow-[0_22px_54px_rgba(0,0,0,0.26)] ${isVodafone ? "border-red-300/18 bg-[linear-gradient(145deg,rgba(230,0,0,0.16),rgba(255,255,255,0.055))]" : "border-[#a78bfa]/18 bg-[linear-gradient(145deg,rgba(124,58,237,0.18),rgba(255,255,255,0.055))]"}`}>
      <div className="flex min-w-0 items-start gap-3">
        <PaymentBrandLogo method={method} size="copy" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black text-white/48">{sfText("storefront.checkout.transfer.transferDetailsVia", "Transfer details via {{label}}", { label })}</div>
          <div className="mt-2 rounded-2xl border border-white/10 bg-black/24 px-3 py-3 font-mono text-xl font-black tracking-wide text-white shadow-inner shadow-black/20" dir="ltr">{value}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-white/54">
            <span className="rounded-full border border-white/10 bg-white/[0.055] px-3 py-1">{sfText("storefront.checkout.transfer.amount", "Amount")}: {money(amount)}</span>
            <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-emerald-100">{sfText("storefront.checkout.transfer.noCardSharing", "No card details shared")}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={copyValue} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-black transition duration-200 ${copied ? "bg-emerald-400 text-emerald-950 shadow-[0_14px_32px_rgba(16,185,129,0.25)]" : "bg-[#7c3aed] text-white shadow-[0_14px_32px_rgba(124,58,237,0.28)] hover:-translate-y-0.5 hover:bg-[#6d28d9]"}`} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? sfText("storefront.toasts.copied", "Copied.") : sfText("storefront.checkout.transfer.copyPaymentDetails", "Copy payment details")}
        </button>
        <button type="button" onClick={() => { window.location.href = deepLink; }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.055] px-4 py-2 text-sm font-black text-white transition hover:-translate-y-0.5 hover:bg-white/[0.09] md:hidden">
          <Smartphone className="h-4 w-4" />
          {sfText("storefront.checkout.transfer.openApp", "Open app")}
        </button>
      </div>
    </div>
  );
}

function InfoBox({ label, value }) {
  return <div className="sf-info-box mt-3 rounded-2xl bg-stone-50 p-4"><div className="sf-info-label text-xs font-bold text-stone-500">{label}</div><div className="sf-info-value mt-1 font-black">{value}</div></div>;
}

function Panel({ title, children }) {
  return <div className="sf-panel rounded-3xl border border-stone-200 bg-white p-5"><h2 className="sf-section-heading mb-3 text-xl font-black">{title}</h2><div className="grid gap-2">{children}</div></div>;
}

function SmallProductList({ items, empty = "لا توجد منتجات." }) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return <p className="sf-muted-empty font-bold text-stone-500">{empty}</p>;
  return safeItems.slice(0, 6).map((item) => {
    const product = normalizeWishlistProduct(item);
    return (
      <Link key={product.id || product.slug} to={`/shop/product/${product.slug || product.id}`} className="sf-small-product-row flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3">
        <img src={imageFor(product.image_url)} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" decoding="async" width="48" height="48" />
        <span className="sf-small-product-name truncate font-black">{product.name || sfText("storefront.products.savedProduct", "Saved product")}</span>
      </Link>
    );
  });
}

function SmallProductGrid({ items, action, addToCart }) {
  const normalizedItems = (Array.isArray(items) ? items : []).map(normalizeWishlistProduct).filter((item) => item.id);
  const addWishlistItemToCart = async (item) => {
    if (!addToCart) return;
    try {
      const data = await api.get(`/storefront/products/${item.id}`);
      const product = productFromDetailsResponse(data);
      const variant = product?.variants?.find((candidate) => Number(candidate.stock || 0) > 0);
      if (!product || !variant) {
        toast.error(sfText("storefront.toasts.sizeUnavailable", "This size is currently unavailable."));
        return;
      }
      addToCart(product, variant, 1);
    } catch {
      toast.error(sfText("storefront.toasts.addFailed", "We cannot add the item to cart right now."));
    }
  };

  return (
    <div className="mt-6 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {normalizedItems.map((item) => (
        <div key={item.id} className={`group min-w-0 overflow-hidden rounded-[1.6rem] border border-white/[0.08] bg-[linear-gradient(160deg,rgba(15,23,42,0.86),rgba(3,7,18,0.94))] shadow-[0_20px_58px_rgba(0,0,0,0.34)] ring-1 ring-white/[0.025] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-[#a78bfa]/25 hover:shadow-[0_28px_74px_rgba(0,0,0,0.42)] ${item.unavailable ? "flex min-h-[430px] flex-col p-4" : "flex min-h-[460px] flex-col p-3.5"}`}>
          {item.unavailable ? (
            <div className="flex flex-1 flex-col justify-center rounded-[1.25rem] border border-rose-300/15 bg-gradient-to-br from-rose-500/10 to-white/[0.04] p-4 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-rose-300/20 bg-rose-400/10 text-rose-300 shadow-[0_12px_30px_rgba(244,63,94,0.12)]">
                <Heart className="h-5 w-5" />
              </span>
              <div className="mt-3 text-base font-black text-white">{sfText("storefront.products.unavailableNow", "المنتج غير متاح حالياً")}</div>
              <p className="mt-1 text-xs font-bold leading-5 text-white/50">{sfText("storefront.products.openForDetails", "Open product for details")}</p>
            </div>
          ) : (
            <Link to={`/shop/product/${item.slug || item.id}`} className="flex min-h-0 flex-1 flex-col">
              <div className="aspect-[4/5] w-full overflow-hidden rounded-xl border border-white/70 bg-gradient-to-br from-stone-50 via-white to-stone-100 p-3 shadow-inner shadow-stone-200/70">
                <img src={imageFor(item.image_url)} alt={item.name || ""} className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.035]" loading="lazy" decoding="async" width="320" height="400" />
              </div>
              <div className="mt-4 line-clamp-2 min-h-12 break-words text-start text-base font-black leading-6 text-white">{item.name || sfText("storefront.products.savedProduct", "Saved product")}</div>
              <div className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-start text-sm font-black text-white">
                {item.price ? <span className="text-lg text-white">{money(item.price)}</span> : <span className="text-sm font-bold text-white/50">{sfText("storefront.products.openForDetails", "Open product for details")}</span>}
                {item.compare_at_price && item.compare_at_price > item.price ? <span className="text-xs font-bold text-white/40 line-through">{money(item.compare_at_price)}</span> : null}
              </div>
            </Link>
          )}
          <div className="mt-3 grid gap-2">
            {addToCart && !item.unavailable ? <button type="button" onClick={() => addWishlistItemToCart(item)} className="min-h-12 rounded-full bg-gradient-to-l from-[#4c1d95] via-[#6d28d9] to-[#111827] px-4 py-3 text-sm font-black text-white shadow-[0_14px_34px_rgba(109,40,217,0.3)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(109,40,217,0.38)]">{sfText("storefront.cart.addToCart", "Add to cart")}</button> : null}
            {action ? <button type="button" onClick={() => action(item)} className="min-h-11 rounded-full border border-white/[0.1] bg-white/[0.045] px-4 py-2 text-sm font-black text-rose-200 transition hover:border-rose-400/70 hover:bg-rose-500 hover:text-white">{item.unavailable ? sfText("storefront.wishlist.removeFromWishlist", "إزالة من المفضلة") : sfText("storefront.common.remove", "Remove")}</button> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Reviews() {
  const reviews = [
    ["M", sfText("storefront.reviews.items.quality", "The material is excellent and delivery was fast.")],
    ["A", sfText("storefront.reviews.items.size", "The size was accurate and support helped me.")],
    ["S", sfText("storefront.reviews.items.experience", "Easy experience and the order arrived neatly.")],
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-3 text-white md:py-7">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-black text-white">{sfText("storefront.reviews.title", "Customer reviews")}</h2>
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
                <div className="mt-1 inline-flex rounded-full border border-white/[0.08] bg-white/[0.045] px-2 py-0.5 text-[11px] font-black text-white/65">{sfText("storefront.reviews.verifiedCustomer", "Verified customer")}</div>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/90">{review}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MobileBuyBar({ product, variant, visible, addToCart, buyNow }) {
  const disabled = !variant || Number(variant.stock || 0) <= 0;
  if (!visible) return null;
  return (
    <div
      dir="rtl"
      className="sf-mobile-buy-bar fixed inset-x-3 z-30 mx-auto max-w-md rounded-[1rem] border border-white/[0.08] bg-[linear-gradient(180deg,#07111f_0%,#050b16_100%)] p-2 text-white shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-xl transition md:hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-black text-white">{cleanDisplayText(product.name)}</div>
          <div className="text-sm font-black text-white/86">{money(displaySellingPrice(product, variant))}</div>
        </div>
        <button onClick={addToCart} disabled={disabled} className="rounded-full bg-white px-3 py-2.5 text-xs font-black text-stone-950 shadow-[0_10px_24px_rgba(255,255,255,0.15)] disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 disabled:shadow-none">{sfText("storefront.cart.addToCart", "Add to cart")}</button>
        <button onClick={buyNow} disabled={disabled} className="rounded-full border border-white/14 bg-white/[0.055] px-3 py-2.5 text-xs font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.035] disabled:text-white/30">{sfText("storefront.cart.buyNow", "Buy now")}</button>
      </div>
    </div>
  );
}

function Confetti() {
  return <div className="pointer-events-none absolute inset-0 overflow-hidden">{CONFETTI_PARTICLES.map((particle) => <span key={particle.id} className="absolute h-2 w-2 animate-[confetti_1.8s_ease-out_forwards] rounded-full bg-emerald-500" style={{ right: particle.right, top: "0%", animationDelay: particle.animationDelay }} />)}</div>;
}

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
            <h1 className="mt-4 text-2xl font-black">{sfText("storefront.errors.simpleProblem", "Something went wrong")}</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-stone-500">{sfText("storefront.errors.cleanedTemporaryData", "We cleaned temporary browsing data. Try refreshing the page.")}</p>
            <button onClick={() => location.reload()} className="mt-5 rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white">{sfText("storefront.common.refreshPage", "Refresh page")}</button>
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




