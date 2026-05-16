import { Component, useEffect, useMemo, useRef, useState } from "react";
import { memo, useCallback } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import Select from "react-select";
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
  Menu,
  MessageCircle,
  Mic,
  Minus,
  PackageCheck,
  PackageSearch,
  Phone,
  QrCode,
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
  Trash2,
  Truck,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { api } from "../shared/api/api";
import { resolveProductImageUrl } from "../shared/lib/imageUrls";
import { formatCurrency } from "../shared/lib/currency";
import { useProductClassifications } from "../modules/products/hooks/useProductClassifications";
import { classificationGroupsToFieldOptions } from "../modules/products/lib/productClassifications";
import { isMirrorProduct, mirrorProductTitle } from "../shared/lib/mirrorProduct";
import { applyProductSocialMeta, productToSocialMeta } from "../shared/lib/socialMeta";
import OrderInvoiceCard from "../shared/components/invoices/OrderInvoiceCard";
import instaPayLogo from "../assets/payments/instapay-logo.svg";
import vodafoneCashLogo from "../assets/payments/vodafone-cash-logo.svg";

const CART_KEY = "storefront.cart";
const WISHLIST_KEY = "storefront.wishlist";
const RECENT_KEY = "storefront.recent";
const PROFILE_KEY = "storefront.profile";
const THEME_KEY = "storefront.theme";
const SUCCESS_MESSAGES = [
  "اختيار ممتاز",
  "طلبك بيتجهز حالا",
  "شكلك اخترت حاجة جامدة",
  "هنجهزهولك بأسرع وقت",
];

const stories = ["عروض اليوم", "وصل حديثا", "آخر المقاسات", "الأكثر مبيعا"];
const storyVisuals = [
  "from-[#6d28d9] via-[#9f7aea] to-[#f0abfc]",
  "from-stone-950 via-[#4c1d95] to-[#a78bfa]",
  "from-[#7c3aed] via-[#c4b5fd] to-[#f7f4ee]",
  "from-[#111827] via-[#6d28d9] to-[#d8b4fe]",
];
const conversionTrustPoints = ["دفع آمن", "تبديل سهل", "صور حقيقية", "شحن سريع"];
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
const legacyPaymentMethods = [
  { id: "cod", title: "الدفع عند الاستلام", text: "هتدفع عند الاستلام", enabled: true },
  { id: "deposit", title: "عربون", text: "ادفع عربون لتأكيد الطلب وكمل الباقي عند الاستلام", enabled: true },
  { id: "online", title: "دفع إلكتروني", text: "الدفع الإلكتروني قريبًا", enabled: false },
];
const paymentMethods = [
  { id: "cod", title: "الدفع عند الاستلام", text: "ادفع قيمة الطلب بالكامل عند الاستلام." },
  { id: "shipping_confirmation", title: "تأكيد الشحن", text: "يتم دفع رسوم الشحن مقدمًا لتأكيد الطلب، والباقي عند الاستلام." },
];
const SHIPPING_CONFIRMATION_METHODS = new Set(["shipping_confirmation", "instapay", "vodafone_cash"]);
const INSTA_PAY_HANDLE = import.meta.env.VITE_INSTAPAY_HANDLE || "01000000000@instapay";
const VODAFONE_CASH_NUMBER = import.meta.env.VITE_VODAFONE_CASH_NUMBER || "01000000000";
const paymentBrandLogos = {
  instapay: instaPayLogo,
  vodafone_cash: vodafoneCashLogo,
};
const paymentBrandLabels = {
  instapay: "InstaPay",
  vodafone_cash: "Vodafone Cash",
};
const whatsappPhone = String(import.meta.env.VITE_WHATSAPP_PHONE || import.meta.env.VITE_STORE_WHATSAPP || "").replace(/\D/g, "");
const statusLabels = [
  "تم استلام الطلب",
  "جاري المراجعة",
  "جاري التجهيز",
  "خرج للشحن",
  "تم التسليم",
];
const SEARCH_RECENT_KEY = "storefront.search.recent";
const SEARCH_PLACEHOLDERS = [
  "ابحث عن Jordan 4...",
  "ابحث عن Sneakers...",
  "ابحث بالمقاس 42...",
  "ابحث باسم البراند...",
  "ابحث بـ SKU...",
];
const TRENDING_SEARCHES = ["Jordan 4", "Sneakers", "مقاس 42", "Mirror Original", "Adidas", "رجالي أسود"];
const SEARCH_FALLBACK_SECTIONS = {
  categories: ["رجالي", "حريمي", "أطفال", "عروض", "آخر قطعة"],
  brands: ["Nike", "Adidas", "New Balance", "Air Jordan"],
  styles: ["Sneakers", "Running", "Lifestyle", "Mirror Original"],
};

const STORAGE_ARRAY_LIMITS = {
  [CART_KEY]: 50,
  [WISHLIST_KEY]: 200,
  [RECENT_KEY]: 20,
};
const STOREFRONT_CACHE_PREFIXES = ["storefront.cache", "storefront.products", "storefront.last-piece", "storefront.story", "storefront.stories"];
const isQuotaError = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014;

const safeRemoveStorageKey = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {}
};

const compactImageValue = (value = "") => {
  const text = String(value || "");
  if (!text || text.startsWith("data:") || text.length > 500) return "";
  return text;
};

const sanitizeCart = (items, limit = STORAGE_ARRAY_LIMITS[CART_KEY]) =>
  (Array.isArray(items) ? items : [])
    .map((item = {}) => ({
      lineId: item.lineId || `${item.product_id || item.productId || item.id || ""}:${item.variant_id || item.variantId || ""}`,
      product_id: item.product_id || item.productId || item.id || "",
      variant_id: item.variant_id || item.variantId || "",
      name: String(item.name || "").slice(0, 120),
      image_url: compactImageValue(item.image_url || item.image),
      size: String(item.size || "").slice(0, 40),
      color: String(item.color || "").slice(0, 60),
      price: Number(item.price || 0),
      stock: Number(item.stock || 0),
      quantity: Math.max(1, Number(item.quantity || item.qty || 1)),
    }))
    .filter((item) => item.product_id && item.variant_id)
    .slice(-limit);

const sanitizeWishlist = (items, limit = STORAGE_ARRAY_LIMITS[WISHLIST_KEY]) => {
  const ids = (Array.isArray(items) ? items : [])
    .map((item) => (typeof item === "object" ? item?.id || item?.product_id : item))
    .filter(Boolean)
    .map((id) => String(id));
  return [...new Set(ids)].slice(-limit).map((id) => ({ id }));
};

const sanitizeRecent = (items, limit = STORAGE_ARRAY_LIMITS[RECENT_KEY]) => {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item = {}) => ({
      id: item.id || item.product_id || "",
      name: String(item.name || "").slice(0, 120),
      image_url: compactImageValue(item.image_url || item.image),
      price: Number(item.price || item.sale_price || 0),
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
    localStorage.setItem(RECENT_KEY, JSON.stringify(sanitizeRecent(readJson(RECENT_KEY, []), aggressive ? 8 : 20)));
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(sanitizeWishlist(readJson(WISHLIST_KEY, []), aggressive ? 80 : 200)));
    localStorage.setItem(CART_KEY, JSON.stringify(sanitizeCart(readJson(CART_KEY, []), aggressive ? 20 : 50)));
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
const imageFor = (value) => {
  const key = String(value || "");
  if (imageUrlCache.has(key)) return imageUrlCache.get(key);
  const resolved = resolveProductImageUrl(value) || "/favicon.svg";
  if (imageUrlCache.size > 500) imageUrlCache.clear();
  imageUrlCache.set(key, resolved);
  return resolved;
};
const money = (value) => formatCurrency(Number(value || 0), "ar-EG");
const cleanDisplayText = (value = "") =>
  String(value || "")
    .replace(/\uFFFD/g, "")
    .replace(/âœ¨/g, "")
    .replace(/â€¦/g, "...")
    .replace(/طŒ/g, "،")
    .replace(/\s+/g, " ")
    .trim();
const productUrl = (product) => `/shop/product/${product.slug || product.id}`;
const productStock = (product = {}) => {
  const variantStock = Array.isArray(product.variants)
    ? product.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
    : 0;
  return Number(product.total_stock || variantStock || 0);
};
const isAvailableProduct = (product = {}) => productStock(product) > 0;
const stockScore = (product = {}) => Number(product.total_stock || 0) + (String(product.badge || "").includes("مبيع") ? 100 : 0);
const hasSale = (product = {}) => Number(product.old_price || 0) > Number(product.sale_price || product.price || 0) || String(product.badge || "").includes("عرض");
const newestScore = (product = {}) => new Date(product.created_at || 0).getTime() || Number(product.id || 0);
const lastPieceProductUrl = (product, variant = {}) => {
  const query = new URLSearchParams();
  if (variant.edition_slug) query.set("variant", variant.edition_slug);
  else if (variant.id) query.set("variant", variant.id);
  if (variant.size) query.set("size", variant.size);
  if (variant.color) query.set("color", variant.color);
  const suffix = query.toString();
  return `${productUrl(product)}${suffix ? `?${suffix}` : ""}`;
};
const lowStockText = (stock) => Number(stock || 0) <= 1 ? "باقي قطعة واحدة فقط" : "آخر قطعتين";
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
const productClassificationValue = (product = {}, field) => {
  if (field === "product_type") return product.product_type || product.productType || product.category;
  return product[field] || "";
};
const pickClassificationPreviewProduct = (products = [], field, value) => {
  if (!products.length) return null;
  const target = String(value || "").trim().toLowerCase();
  if (!target) return null;
  return (
    products.find((product) => {
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
  const queryKey = JSON.stringify(params);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    cachedStorefrontGet(`/storefront/products${query.toString() ? `?${query.toString()}` : ""}`)
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: "", products: data.products || [] });
      })
      .catch((error) => {
        if (!cancelled && error?.cause?.name !== "AbortError") {
          setState({ loading: false, error: error.message, products: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [queryKey]);

  return state;
};

const useStorefrontGenderClassifications = () => {
  const [state, setState] = useState({ loading: true, error: "", options: [] });

  useEffect(() => {
    let cancelled = false;
    cachedStorefrontGet("/storefront/classifications/gender", { ttlMs: 5 * 60 * 1000 })
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

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, value);
    });
    cachedStorefrontGet(`/storefront/last-piece${query.toString() ? `?${query.toString()}` : ""}`)
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
  }, [enabled, queryKey]);

  return state;
};

function Storefront() {
  const [cart, setCart] = useState(() => readJson(CART_KEY, []));
  const [wishlist, setWishlist] = useState(() => readJson(WISHLIST_KEY, []));
  const [recent, setRecent] = useState(() => readJson(RECENT_KEY, []));
  const [profile, setProfile] = useState(() => readJson(PROFILE_KEY, {}));
  const [themeMode, setThemeMode] = useState(() => readThemeMode());
  const [systemTheme, setSystemTheme] = useState(() => getSystemTheme());
  const [cartOpen, setCartOpen] = useState(false);
  const location = useLocation();
  const effectiveTheme = themeMode === "auto" ? systemTheme : themeMode;
  const wishlistRef = useRef(wishlist);
  const profileRef = useRef(profile);

  useEffect(() => {
    wishlistRef.current = wishlist;
  }, [wishlist]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  useEffect(() => {
    cleanupStorefrontStorage();
    setCart((items) => sanitizeCart(items));
    setWishlist((items) => sanitizeWishlist(items));
    setRecent((items) => sanitizeRecent(items));
    setProfile((value) => sanitizeProfile(value));
  }, []);

  useEffect(() => {
    const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (!media) return undefined;
    const update = (event) => setSystemTheme(event.matches ? "dark" : "light");
    setSystemTheme(media.matches ? "dark" : "light");
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
    } catch {}
  }, [themeMode]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("storefront-dark", effectiveTheme === "dark");
    document.documentElement.classList.toggle("dark", effectiveTheme === "dark");
  }, [effectiveTheme]);

  useEffect(() => {
    writeJson(CART_KEY, cart);
  }, [cart]);
  useEffect(() => {
    writeJson(WISHLIST_KEY, wishlist);
  }, [wishlist]);
  useEffect(() => {
    writeJson(RECENT_KEY, recent);
  }, [recent]);
  useEffect(() => {
    writeJson(PROFILE_KEY, profile);
  }, [profile]);

  const addToCart = useCallback((product, variant, quantity = 1) => {
    if (!variant || Number(variant.stock || 0) <= 0) {
      toast.error("المقاس أو اللون غير متاح حاليا");
      return;
    }
    const lineId = `${product.id}:${variant.id}`;
    const itemName = mirrorProductTitle(product, variant) || product.name;
    setCart((items) => {
      const current = items.find((item) => item.lineId === lineId);
      if (current) {
        return items.map((item) =>
          item.lineId === lineId
            ? { ...item, quantity: Math.min(Number(variant.stock || 1), item.quantity + quantity) }
            : item
        );
      }
      return [
        ...items,
        {
          lineId,
          product_id: product.id,
          variant_id: variant.id,
          name: itemName,
          image_url: variant.image_url || product.image_url,
          size: variant.size || "",
          color: variant.color || "",
          price: Number(variant.sale_price || variant.price || product.sale_price || product.price || 0),
          stock: Number(variant.stock || 0),
          quantity,
        },
      ];
    });
    toast.success("اختيار ممتاز، ضيفناها للسلة");
    setCartOpen(true);
    playSoftClick();
  }, []);

  const updateCart = useCallback((lineId, quantity) => {
    setCart((items) =>
      items
        .map((item) => (item.lineId === lineId ? { ...item, quantity: Math.max(1, Math.min(item.stock || 99, quantity)) } : item))
        .filter((item) => item.quantity > 0)
    );
  }, []);

  const removeFromCart = useCallback((lineId) => setCart((items) => items.filter((item) => item.lineId !== lineId)), []);
  const clearCart = useCallback(() => setCart([]), []);
  const openCart = useCallback(() => setCartOpen(true), []);
  const closeCart = useCallback(() => setCartOpen(false), []);

  const toggleWishlist = useCallback((product) => {
    setWishlist((items) => {
      const exists = items.some((item) => String(item.id) === String(product.id));
      return exists ? items.filter((item) => String(item.id) !== String(product.id)) : [{ id: product.id, name: product.name, image_url: product.image_url, price: product.sale_price || product.price }, ...items];
    });
    const currentProfile = profileRef.current || {};
    const currentWishlist = wishlistRef.current || [];
    const phone = currentProfile.primary_phone || currentProfile.phone || "";
    if (phone && product?.id) {
      const exists = currentWishlist.some((item) => String(item.id) === String(product.id));
      api.post("/storefront/wishlist", { phone, product_id: product.id, remove: exists }).catch(() => {});
    }
  }, []);

  const rememberProduct = useCallback((product) => {
    setRecent((items) => [{ id: product.id, name: product.name, image_url: product.image_url, price: product.sale_price || product.price, slug: product.slug, viewed_at: new Date().toISOString() }, ...items.filter((item) => String(item.id) !== String(product.id))].slice(0, 20));
  }, []);

  return (
    <div dir="rtl" data-theme={effectiveTheme} className={`storefront-shell min-h-screen ${effectiveTheme === "dark" ? "dark storefront-dark bg-[#070b16] text-stone-100" : "bg-[#f7f4ee] text-stone-950"}`}>
      <Header cart={cart} wishlist={wishlist} onCart={openCart} />
      <main className="pb-32 md:pb-0">
        <Routes>
          <Route index element={<HomePage wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />} />
          <Route path="products" element={<ProductsPage wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />} />
          <Route path="sale" element={<ProductsPage sale wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />} />
          <Route path="product/:id" element={<ProductDetails addToCart={addToCart} toggleWishlist={toggleWishlist} wishlist={wishlist} rememberProduct={rememberProduct} recent={recent} profile={profile} />} />
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
      <Footer />
      <MobileBottomNav count={cart.length} />
      <CartDrawer open={cartOpen} onClose={closeCart} cart={cart} updateCart={updateCart} removeFromCart={removeFromCart} />
    </div>
  );
}

function Header({ cart, wishlist, onCart }) {
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState(() => readJson(SEARCH_RECENT_KEY, []));
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [isCompact, setIsCompact] = useState(false);
  const navigate = useNavigate();
  const announcementItems = [
    { label: "شحن سريع داخل مصر", icon: <Truck className="h-3.5 w-3.5" /> },
    { label: "استبدال خلال 14 يوم", icon: <RefreshCcw className="h-3.5 w-3.5" /> },
    { label: "الدفع عند الاستلام", icon: <PackageCheck className="h-3.5 w-3.5" /> },
    { label: "منتجات Mirror Premium", icon: <Sparkles className="h-3.5 w-3.5" /> },
    { label: "خصومات اليوم", icon: <BadgePercent className="h-3.5 w-3.5" /> },
  ];
  const utilityItems = [
    { label: "WhatsApp", to: "https://wa.me/", icon: <MessageCircle className="h-3.5 w-3.5" />, external: true },
    { label: "Track Order", to: "/shop/track", icon: <PackageSearch className="h-3.5 w-3.5" /> },
    { label: "Wishlist", to: "/shop/wishlist", icon: <Heart className="h-3.5 w-3.5" /> },
    { label: "Account", to: "/shop/account", icon: <User className="h-3.5 w-3.5" /> },
  ];
  const navItems = [
    ["الأقسام", "/shop/products"],
    ["العروض", "/shop/sale"],
    ["جديد", "/shop/products?sort=new"],
    ["رجالي", "/shop/products?q=رجالي"],
    ["حريمي", "/shop/products?q=حريمي"],
    ["أطفال", "/shop/products?q=أطفال"],
  ];

  useEffect(() => {
    const updateCompact = () => setIsCompact(window.scrollY > 72);
    updateCompact();
    window.addEventListener("scroll", updateCompact, { passive: true });
    return () => window.removeEventListener("scroll", updateCompact);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPlaceholderIndex((current) => (current + 1) % SEARCH_PLACEHOLDERS.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (search.trim().length < 2) {
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setSearchLoading(true);
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
  }, [search]);

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

  const pickProduct = (product) => {
    if (!product?.id) return;
    rememberSearch(product.name || search);
    closeSearch();
    setSearch("");
    navigate(productUrl(product));
  };

  const handleVoiceSearch = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("البحث الصوتي غير مدعوم في هذا المتصفح");
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

  const handleImageSearch = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      setSearch(file.name.replace(/\.[^.]+$/, ""));
      toast.success("تم تجهيز البحث بالصورة");
      setSearchOpen(true);
      setMobileSearchOpen(window.innerWidth < 768);
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

  return (
    <header
      data-compact={isCompact ? "true" : "false"}
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
            <button type="button" className="rounded-full px-2.5 py-1 transition hover:bg-white hover:text-stone-950 dark:hover:bg-white/8 dark:hover:text-white">العربية</button>
            <span className="h-3 w-px bg-stone-300/80 dark:bg-white/12" />
            <button type="button" className="rounded-full px-2.5 py-1 transition hover:bg-white hover:text-stone-950 dark:hover:bg-white/8 dark:hover:text-white">EGP</button>
          </div>
        </div>
      </div>
      <div className="sf-main-row mx-auto grid max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 transition-all duration-300 md:grid-cols-[auto_auto_minmax(320px,520px)_auto] md:gap-5 md:py-3">
        <button className="grid h-11 w-11 place-items-center rounded-2xl border border-stone-200/80 bg-white/70 transition hover:border-stone-300 hover:bg-white active:scale-95 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 md:hidden" onClick={() => setMenuOpen((value) => !value)} aria-label="القائمة">
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
        <Link to="/shop" className="group inline-flex items-center gap-2 text-stone-950 transition hover:text-[#6d28d9] dark:text-white">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-stone-950 text-sm font-black tracking-[0.18em] text-white shadow-[0_12px_30px_rgba(28,25,23,0.16)] transition group-hover:scale-105 group-hover:bg-[#6d28d9] dark:bg-white dark:text-stone-950 dark:group-hover:text-white">MS</span>
          <span className="hidden leading-none sm:block">
            <span className="block text-xl font-black tracking-[0.18em]">MONÉ</span>
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.32em] text-stone-500 dark:text-stone-400">Premium Shoes</span>
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
          onChange={setSearch}
          onSubmit={submit}
          onOpen={() => setSearchOpen(true)}
          onClose={closeSearch}
          open={searchOpen}
          mobileOpen={mobileSearchOpen}
          setMobileOpen={setMobileSearchOpen}
          placeholder={SEARCH_PLACEHOLDERS[placeholderIndex]}
          suggestions={suggestions}
          loading={searchLoading}
          recentSearches={recentSearches}
          activeIndex={activeSearchIndex}
          setActiveIndex={setActiveSearchIndex}
          onPickTerm={pickSearchTerm}
          onPickProduct={pickProduct}
          onVoice={handleVoiceSearch}
          onImage={handleImageSearch}
          className="hidden md:block"
        />
        <div className="flex items-center justify-end gap-2">
          <HeaderAction to="/shop/wishlist" label="المفضلة" count={wishlist.length} icon={<Heart className="h-5 w-5" />} className="sf-secondary-action hidden md:grid" />
          <HeaderAction to="/shop/account" label="الحساب" icon={<User className="h-5 w-5" />} className="sf-secondary-action hidden md:grid" />
          <div className="sf-secondary-action relative hidden md:block">
            <button onClick={toggleNotifications} className="sf-header-action" aria-label="الإشعارات">
              <Bell className="h-5 w-5" />
            </button>
          {notificationsOpen ? (
            <div className="absolute left-0 top-12 z-50 w-80 rounded-3xl border border-stone-200 bg-white p-3 shadow-2xl dark:border-white/10 dark:bg-[#0b1020]">
              <div className="mb-2 px-2 text-sm font-black">الإشعارات</div>
              {notifications.length ? notifications.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-2xl bg-stone-50 p-3 dark:bg-white/5">
                  <div className="text-sm font-black">{item.title}</div>
                  <div className="mt-1 text-xs font-bold text-stone-500">{item.body}</div>
                </div>
              )) : <div className="rounded-2xl bg-stone-50 p-3 text-sm font-bold text-stone-500 dark:bg-white/5">لا توجد إشعارات حاليا</div>}
            </div>
          ) : null}
          </div>
          <button onClick={onCart} className="sf-header-action sf-cart-action" aria-label="السلة">
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
          <span>{SEARCH_PLACEHOLDERS[placeholderIndex]}</span>
        </button>
      </div>
      <PremiumSearch
        value={search}
        onChange={setSearch}
        onSubmit={submit}
        onOpen={() => setSearchOpen(true)}
        onClose={closeSearch}
        open={searchOpen}
        mobileOpen={mobileSearchOpen}
        setMobileOpen={setMobileSearchOpen}
        placeholder={SEARCH_PLACEHOLDERS[placeholderIndex]}
        suggestions={suggestions}
        loading={searchLoading}
        recentSearches={recentSearches}
        activeIndex={activeSearchIndex}
        setActiveIndex={setActiveSearchIndex}
        onPickTerm={pickSearchTerm}
        onPickProduct={pickProduct}
        onVoice={handleVoiceSearch}
        onImage={handleImageSearch}
        mobileOnly
      />
      {menuOpen ? (
        <div className="grid gap-2 border-t border-stone-200 bg-white/96 px-4 py-4 text-sm font-bold backdrop-blur dark:border-white/10 dark:bg-[#0b1020]/96 md:hidden">
          {["الصفحة الرئيسية", "الأقسام", "العروض", "جديد", "رجالي", "حريمي", "دليل المقاسات", "سياسة الاستبدال"].map((label, index) => (
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
  const chips = value.trim() ? [] : [...recentSearches, ...TRENDING_SEARCHES].filter(Boolean);
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

function SearchQuickSections({ value, loading, suggestions, chips, activeIndex, onPickTerm, onPickProduct }) {
  const query = value.trim();
  return (
    <div className="grid gap-3">
      {query ? (
        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-black text-stone-500 dark:text-stone-400">نتائج ذكية</span>
            {loading ? <span className="text-[11px] font-bold text-[#7c3aed]">جاري البحث...</span> : null}
          </div>
          <div className="grid gap-1.5">
            {suggestions.length ? suggestions.map((product, index) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onPickProduct(product)}
                className={`flex items-center gap-3 rounded-2xl p-2 text-right transition hover:bg-[#f7f4ee] active:scale-[0.99] dark:hover:bg-white/5 ${activeIndex === index ? "bg-[#f5f3ff] dark:bg-white/8" : ""}`}
              >
                <img src={imageFor(product.image_url)} alt="" className="h-14 w-14 rounded-2xl bg-stone-100 object-cover shadow-sm dark:bg-white/5" loading="lazy" decoding="async" width="56" height="56" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">{product.name}</div>
                  <div className="truncate text-xs font-bold text-stone-500 dark:text-stone-400">
                    {[product.category, product.brand, product.style, product.grade].filter(Boolean).join(" / ") || product.sizes?.slice(0, 4).join(" / ") || "مقاسات متاحة"}
                  </div>
                </div>
                <div className="rounded-full bg-stone-950 px-3 py-1 text-xs font-black text-white dark:bg-white dark:text-stone-950">{money(product.sale_price || product.price)}</div>
              </button>
            )) : (
              <button type="button" onClick={() => onPickTerm(query)} className="rounded-2xl border border-dashed border-stone-200 p-4 text-right text-sm font-black text-stone-600 dark:border-white/10 dark:text-stone-300">
                ابحث عن “{query}”
              </button>
            )}
          </div>
        </div>
      ) : null}

      {!query ? (
        <>
          <ChipSection title="الأكثر بحثًا" items={TRENDING_SEARCHES} onPick={onPickTerm} />
          {chips.length ? <ChipSection title="بحثت مؤخرًا" items={chips.slice(0, 6)} onPick={onPickTerm} /> : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniSearchGroup title="الأقسام" items={SEARCH_FALLBACK_SECTIONS.categories} onPick={onPickTerm} />
            <MiniSearchGroup title="البراندات" items={SEARCH_FALLBACK_SECTIONS.brands} onPick={onPickTerm} />
            <MiniSearchGroup title="ستايلات" items={SEARCH_FALLBACK_SECTIONS.styles} onPick={onPickTerm} />
          </div>
        </>
      ) : null}
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
  const { i18n } = useTranslation();
  const lang = i18n.language || "ar";
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [lastPieceOpen, setLastPieceOpen] = useState(false);
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
  const best = useMemo(
    () => [...railProducts].sort((a, b) => stockScore(b) - stockScore(a) || newestScore(b) - newestScore(a)).slice(0, 8),
    [railProducts]
  );
  const fresh = useMemo(
    () => [...railProducts].sort((a, b) => newestScore(b) - newestScore(a)).slice(0, 8),
    [railProducts]
  );
  const sale = useMemo(
    () => (saleRailProducts.length ? saleRailProducts : saleProducts.length ? saleProducts : saleFallback.length ? saleFallback : railProducts).slice(0, 8),
    [railProducts, saleFallback, saleProducts, saleRailProducts]
  );
  const bestIds = useMemo(() => new Set(best.map((product) => String(product.id))), [best]);
  const saleUnique = useMemo(() => sale.filter((product) => !bestIds.has(String(product.id))).slice(0, 8), [bestIds, sale]);
  const saleIds = useMemo(() => new Set(saleUnique.map((product) => String(product.id))), [saleUnique]);
  const freshUnique = useMemo(
    () => fresh.filter((product) => !bestIds.has(String(product.id)) && !saleIds.has(String(product.id))).slice(0, 8),
    [bestIds, fresh, saleIds]
  );
  const heroProducts = useMemo(() => {
    const seen = new Set();
    return [...best, ...fresh, ...railProducts].filter((product) => {
      const key = String(product?.id || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }, [best, fresh, railProducts]);
  const heroProduct = heroProducts[heroIndex] || heroProducts[0] || railProducts[0] || {};
  const heroVariant = firstDisplayVariant(heroProduct.variants || []);
  const heroImage = displayImageForProduct(heroProduct, heroVariant);
  const heroSizes = heroSizesForProduct(heroProduct);
  const heroTheme = heroThemeForProduct(heroProduct, heroVariant);
  const weekProduct = best[0] || fresh[0] || sale[0] || railProducts[0] || {};
  const weekVariant = firstDisplayVariant(weekProduct.variants || []);
  const weekSizes = useMemo(
    () => [...new Set((weekProduct.variants || []).filter((variant) => variantHasStock(variant) && variant.size).map((variant) => variant.size))].slice(0, 5),
    [weekProduct]
  );
  const heroPrice = heroVariant?.sale_price || heroProduct.sale_price || heroProduct.price;
  const heroSubtitle = heroProduct.description || heroProduct.model || heroProduct.sku || heroProduct.category || (isArabicLanguage(lang) ? "تصميم مختار من أحدث المنتجات المتاحة الآن." : "A selected drop from the latest available styles.");
  const heroStockText = heroProduct.low_stock
    ? (isArabicLanguage(lang) ? "الكمية محدودة" : "Limited stock")
    : productStock(heroProduct) > 0
      ? (isArabicLanguage(lang) ? "متاح الآن بمخزون حقيقي" : "Available now from live stock")
      : (isArabicLanguage(lang) ? "تحقق من التوفر" : "Check availability");
  const heroDetailsUrl = heroProduct?.id ? productUrl(heroProduct) : "/shop/products";
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
          groupLabel: isArabicLanguage(lang) ? "الجنس" : "Gender",
          color: classificationColor(option),
          icon: classificationIcon(option, lang),
          product,
          variant,
          image: product ? displayImageForProduct(product, variant) : "",
          productCount: Number(option.product_count ?? 0),
        };
      })
      .filter((card) => card.productCount > 0 || card.product);
  }, [classificationOptions.gender, storefrontGenderOptions, railProducts, lang]);

  useEffect(() => {
    if (!heroProducts.length || heroIndex < heroProducts.length) return;
    setHeroIndex(0);
  }, [heroIndex, heroProducts.length]);

  useEffect(() => {
    if (heroPaused || heroProducts.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroProducts.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [heroPaused, heroProducts.length]);

  return (
    <div className="sf-page">
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
              ) : (
                <div className="relative z-10 grid h-72 w-full max-w-lg place-items-center rounded-[2rem] border border-white/10 bg-white/8 text-3xl font-black text-white/60">
                  SHOES
                </div>
              )}
            </div>

            <div className="order-2 flex flex-col justify-center py-4 lg:[direction:rtl]">
              <div className="inline-flex w-max items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black text-white/86 backdrop-blur">
                <Sparkles className="h-4 w-4" style={{ color: heroTheme.accent }} />
                {isArabicLanguage(lang) ? "وصل حديثًا" : "New Arrival"}
              </div>
              <h1 key={`title-${heroProduct.id || heroIndex}`} className="mt-4 max-w-xl text-4xl font-black leading-[1.02] tracking-normal text-white animate-[sfFadeUp_420ms_ease-out_both] md:text-6xl xl:text-7xl">
                {heroProduct.name || (isArabicLanguage(lang) ? "اختيار مميز" : "Featured Style")}
              </h1>
              <p className="mt-4 line-clamp-2 max-w-lg text-sm font-semibold leading-7 text-white/72 md:text-base">
                {heroSubtitle}
              </p>
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
                    {isArabicLanguage(lang) ? "المقاسات تظهر داخل المنتج" : "Sizes inside product"}
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
                  {isArabicLanguage(lang) ? "تسوق الآن" : "Shop Now"}
                </Link>
                <Link to={heroDetailsUrl} className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/24 bg-white/8 px-7 py-3 text-sm font-black text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/14 active:scale-[0.98]">
                  {isArabicLanguage(lang) ? "شاهد المقاسات" : "View Sizes"}
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
                      <span className="mt-0.5 block text-[10px] font-bold text-white/54">{money(variant?.sale_price || product.sale_price || product.price)}</span>
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
      <section className="mx-auto max-w-[1200px] px-4 py-2">
        {categoryPreviewCards.length ? (
          <div>
            <div className="mb-2 flex items-end justify-between gap-3 text-right">
              <SectionIntro eyebrow="Categories" title="تسوق حسب القسم" subtitle="اختار بسرعة حسب الفئة أو النوع" compact />
              <Link to="/shop/products" className="shrink-0 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">عرض الكل</Link>
            </div>
            <div className="rounded-[1.5rem] border border-stone-200 bg-white p-3 shadow-[0_12px_30px_rgba(39,20,75,0.05)] dark:border-white/10 dark:bg-[#0b1020]">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {categoryPreviewCards.map((card) => (
                <Link
                  key={card.value}
                  to={classificationUrl(card.field, card.value)}
                  className="group overflow-hidden rounded-[1.35rem] border border-stone-200/80 bg-[#fbfaf7] text-right shadow-[0_12px_30px_rgba(39,20,75,0.05)] transition duration-300 hover:-translate-y-1 hover:border-[#7c3aed]/45 hover:shadow-[0_18px_40px_rgba(109,40,217,0.12)] active:scale-[0.99] dark:border-white/10 dark:bg-white/5"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-stone-100 dark:bg-white/5">
                    {card.image ? (
                      <img src={imageFor(card.image)} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.06]" loading="lazy" decoding="async" width="320" height="240" />
                    ) : (
                      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${card.color}, #111827)` }}>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_22%,rgba(255,255,255,0.22),transparent_28%),radial-gradient(circle_at_28%_78%,rgba(255,255,255,0.14),transparent_22%)]" />
                        <div className="absolute inset-0 grid place-items-center">
                          <div className="grid h-16 w-16 place-items-center rounded-full border border-white/20 bg-white/16 text-lg font-black text-white shadow-[0_18px_45px_rgba(0,0,0,0.20)] backdrop-blur">
                            {card.icon}
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/56 via-black/0 to-transparent" />
                    <div className="absolute right-3 top-3 rounded-full bg-white/92 px-3 py-1 text-[10px] font-black text-stone-950 shadow-sm backdrop-blur dark:bg-stone-950/85 dark:text-white">
                      تسوق الآن
                    </div>
                    <div className="absolute bottom-0 right-0 left-0 p-3 text-white">
                      <div className="text-lg font-black drop-shadow-sm">{card.label}</div>
                      <div className="mt-1 text-xs font-semibold text-white/80">{card.groupLabel}</div>
                    </div>
                  </div>
                </Link>
              ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>
      <ProductRail title="الأكثر مبيعًا" subtitle="الأكثر مبيعًا هذا الأسبوع" loading={loading} products={best} railType="bestseller" featuredFirst {...props} />
      <section className="mx-auto max-w-[1200px] px-4 py-2">
        <FeaturedProductSection product={weekProduct} variant={weekVariant} sizes={weekSizes} />
      </section>
      <ProductRail title="العروض" subtitle="خصومات مختارة لفترة محدودة" loading={saleLoading && !sale.length} products={saleUnique} railType="sale" {...props} />
      <ProductRail title="وصل حديثًا" subtitle="وصل حديثًا للمخزون" loading={loading} products={freshUnique} railType="new" {...props} />
      <Reviews />
      <LastPieceFinder open={lastPieceOpen} onClose={() => setLastPieceOpen(false)} />
    </div>
  );
}

function SocialProofStrip() {
  const trustItems = [
    { label: "دفع آمن", icon: <ShieldCheck className="h-5 w-5" />, tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
    { label: "تبديل سهل", icon: <RefreshCcw className="h-5 w-5" />, tone: "bg-[#f5f3ff] text-[#6d28d9] dark:bg-white/5 dark:text-[#d8b4fe]" },
    { label: "صور حقيقية", icon: <Camera className="h-5 w-5" />, tone: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" },
    { label: "شحن سريع", icon: <Truck className="h-5 w-5" />, tone: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  ];

  return (
    <div className="sf-reveal grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {trustItems.map((item) => (
        <div key={item.label} className="flex items-center gap-3 rounded-[1.25rem] border border-stone-200 bg-white px-4 py-3 shadow-[0_12px_30px_rgba(39,20,75,0.05)] dark:border-white/10 dark:bg-[#0b1020]">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${item.tone}`}>
            {item.icon}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-black text-stone-950 dark:text-stone-100">{item.label}</div>
            <div className="text-xs font-bold text-stone-500 dark:text-stone-400">ثقة مرئية قبل الشراء</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FeaturedProductSection({ product, variant, sizes }) {
  if (!product?.id) {
    return <LastPieceEmpty title="منتج الأسبوع" text="المنتج المميز هيظهر هنا أول ما المخزون يتحدث." light />;
  }
  return (
    <div className="grid gap-4 overflow-hidden rounded-[2rem] border border-stone-200 bg-white p-4 shadow-[0_20px_55px_rgba(39,20,75,0.08)] dark:border-white/10 dark:bg-[#0b1020] md:grid-cols-[1.05fr_0.95fr] md:p-6">
      <div className="relative overflow-hidden rounded-[1.65rem] bg-[radial-gradient(circle_at_50%_35%,rgba(167,139,250,0.16),transparent_30%),linear-gradient(180deg,#fbfaf7_0%,#f1ece4_100%)] p-4 dark:bg-[radial-gradient(circle_at_50%_35%,rgba(167,139,250,0.14),transparent_30%),linear-gradient(180deg,#111827_0%,#0b1020_100%)]">
        <img src={imageFor(displayImageForProduct(product, variant))} alt="" className="aspect-square w-full object-contain drop-shadow-[0_20px_28px_rgba(39,20,75,0.18)] transition duration-500 hover:scale-[1.04]" loading="lazy" decoding="async" width="640" height="640" />
        <div className="absolute left-4 top-4 rounded-full bg-stone-950 px-3 py-1.5 text-xs font-black text-white shadow-sm dark:bg-white dark:text-stone-950">
          منتج الأسبوع
        </div>
      </div>
      <div className="flex min-w-0 flex-col justify-center">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6d28d9] dark:text-[#d8b4fe]">featured</div>
        <h2 className="mt-1 text-3xl font-black leading-tight text-stone-950 dark:text-stone-100">{product.name}</h2>
        <p className="mt-3 max-w-xl text-sm font-semibold leading-7 text-stone-600 dark:text-stone-400">
          {product.description || "اختيار الأسبوع المميز يأتي بصور أوضح، مقاسات ظاهرة، وتجربة شراء أسرع."}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <span className="text-3xl font-black text-stone-950 dark:text-white">{money(variant?.sale_price || product.sale_price || product.price)}</span>
          {product.old_price ? <span className="text-sm font-bold text-stone-400 line-through dark:text-stone-500">{money(product.old_price)}</span> : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {sizes.length ? sizes.map((size) => (
            <span key={size} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-black text-stone-700 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
              {size}
            </span>
          )) : <span className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-black text-stone-500 dark:border-white/10 dark:bg-white/5 dark:text-stone-500">المقاسات ستظهر هنا</span>}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to={productUrl(product)} className="sf-shimmer-button inline-flex min-h-12 items-center gap-2 rounded-full bg-stone-950 px-6 py-3 text-sm font-black text-white shadow-[0_14px_35px_rgba(39,20,75,0.18)] transition hover:-translate-y-0.5 active:scale-[0.98] dark:bg-white dark:text-stone-950">
            اشتري الآن
          </Link>
          <Link to={productUrl(product)} className="inline-flex min-h-12 items-center gap-2 rounded-full border border-stone-200 bg-white px-6 py-3 text-sm font-black text-stone-700 transition hover:-translate-y-0.5 hover:border-[#7c3aed]/40 hover:text-[#6d28d9] active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
            تفاصيل المنتج
          </Link>
        </div>
      </div>
    </div>
  );
}

function MerchBannerGrid() {
  const banners = [
    ["شحن سريع لجميع المحافظات", "توصيل مرتب وتجربة استلام أسهل", <Truck className="h-5 w-5" />, "from-[#111827] via-[#334155] to-[#64748b]"],
    ["ادفع عربون فقط", "كمل عند الاستلام بدون تعقيد", <BadgePercent className="h-5 w-5" />, "from-[#6d28d9] via-[#7c3aed] to-[#c084fc]"],
    ["آخر المقاسات قبل النفاد", "لو مقاسك موجود الآن فانتبه", <Sparkles className="h-5 w-5" />, "from-[#1f2937] via-[#7c2d12] to-[#f59e0b]"],
  ];

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {banners.map(([title, text, icon, gradient]) => (
        <div key={title} className={`relative overflow-hidden rounded-[1.55rem] bg-gradient-to-br ${gradient} p-5 text-white shadow-[0_18px_55px_rgba(39,20,75,0.14)]`}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.18),transparent_34%)]" />
          <div className="relative flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/14 backdrop-blur">{icon}</div>
            <div>
              <div className="text-lg font-black">{title}</div>
              <div className="mt-1 text-sm font-semibold text-white/80">{text}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function StyleByStyle({ options = [] }) {
  if (!options.length) return null;

  return (
    <div>
      <SectionIntro eyebrow="Shop by Style" title="تسوق حسب الستايل" subtitle="واجهة سريعة لأكثر الستايلات طلبًا" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {options.map((option) => (
          <Link
            key={option.id || option.value}
            to={classificationUrl("style", option.value)}
            className="group relative overflow-hidden rounded-[1.45rem] p-4 text-white shadow-[0_18px_50px_rgba(39,20,75,0.16)] transition duration-300 hover:-translate-y-1 active:scale-[0.99]"
            style={{ background: `linear-gradient(135deg, ${classificationColor(option)}, #111827)` }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_24%,rgba(255,255,255,0.2),transparent_32%)] opacity-80" />
            <div className="relative flex h-full min-h-36 flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">style</div>
                  <div className="mt-1 text-2xl font-black">{classificationLabel(option)}</div>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white/14 backdrop-blur">
                  {option.icon ? <span className="text-xs font-black">{option.icon}</span> : <ChevronLeft className="h-5 w-5" />}
                </span>
              </div>
              <div className="mt-6 flex items-center justify-between text-xs font-black text-white/78">
                <span>مختارات دافئة</span>
                <span className="rounded-full bg-white/12 px-3 py-1">تسوق الآن</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function LastPiecePreviewSection({ products, loading, onOpen }) {
  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <SectionIntro eyebrow="Last Piece" title="آخر قطعة" subtitle="قطع قليلة جدًا ومقاسات محدودة" compact />
        <div className="flex shrink-0 gap-2">
          <button onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-stone-950 px-4 py-2 text-xs font-black text-white dark:bg-white dark:text-stone-950">
            افتح آخر قطعة
          </button>
          <button onClick={onOpen} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 dark:border-white/10 dark:bg-white/5 dark:text-stone-200">
            اختار مقاسك
          </button>
        </div>
      </div>
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-56 animate-pulse rounded-[1.5rem] bg-white dark:bg-white/5" />)}
        </div>
      ) : products?.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {products.slice(0, 4).map((product) => {
            const variant = firstDisplayVariant(product.variants || []);
            return (
              <Link key={product.id} to={productUrl(product)} className="group overflow-hidden rounded-[1.45rem] border border-stone-200 bg-white shadow-[0_14px_40px_rgba(39,20,75,0.08)] transition duration-300 hover:-translate-y-1 dark:border-white/10 dark:bg-[#0b1020]">
                <div className="relative bg-[radial-gradient(circle_at_50%_35%,rgba(167,139,250,0.14),transparent_30%),linear-gradient(180deg,#fbfaf7_0%,#f1ece4_100%)] p-4 dark:bg-[radial-gradient(circle_at_50%_35%,rgba(167,139,250,0.12),transparent_30%),linear-gradient(180deg,#111827_0%,#0b1020_100%)]">
                  <img src={imageFor(displayImageForProduct(product, variant))} alt="" className="aspect-square w-full object-contain transition duration-500 group-hover:scale-[1.04]" loading="lazy" decoding="async" width="320" height="320" />
                  <span className="absolute right-3 top-3 rounded-full bg-stone-950 px-3 py-1 text-[10px] font-black text-[#f8e7b3] dark:bg-white dark:text-stone-950">{lowStockText(variant?.stock)}</span>
                </div>
                <div className="p-4">
                  <div className="text-sm font-black text-stone-950 dark:text-stone-100">{product.name}</div>
                  <div className="mt-1 text-xs font-bold text-stone-500 dark:text-stone-400">{variant?.color || "لون متاح"} / {variant?.size || "مقاس"}</div>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="text-lg font-black text-stone-950 dark:text-white">{money(variant?.sale_price || product.sale_price || product.price)}</div>
                    <span className="rounded-full bg-[#f5f3ff] px-3 py-1 text-xs font-black text-[#6d28d9] dark:bg-white/5 dark:text-[#d8b4fe]">سريع النفاذ</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <LastPieceEmpty title="آخر قطعة" text="لا توجد قطع منخفضة المخزون الآن. ستظهر تلقائيًا عند توفرها." light />
      )}
    </div>
  );
}

function SectionIntro({ eyebrow, title, subtitle, compact = false }) {
  return (
    <div className={compact ? "max-w-2xl" : "max-w-3xl"}>
      <div className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#7c3aed] dark:text-[#d8b4fe]">{eyebrow}</div>
      <h2 className={`${compact ? "text-2xl md:text-3xl" : "text-[1.8rem] md:text-4xl"} font-black tracking-normal text-stone-950 dark:text-stone-100`}>{title}</h2>
      {subtitle ? <p className="mt-2 text-sm font-semibold leading-6 text-stone-500 dark:text-stone-400">{subtitle}</p> : null}
      <div className="mt-2 h-1 w-14 rounded-full bg-gradient-to-l from-[#7c3aed] to-[#d8b4fe]" />
    </div>
  );
}

function StoryStrip({ products = [], categories = [], loading = false, onLastPiece }) {
  const fallbackStories = [
    { label: "جديد", to: "/shop/products?sort=new", image: "", accent: "from-[#111827] to-[#7c3aed]" },
    { label: "رجالي", to: "/shop/products?q=رجالي", image: "", accent: "from-[#020617] to-[#334155]" },
    { label: "حريمي", to: "/shop/products?q=حريمي", image: "", accent: "from-[#3b0764] to-[#db2777]" },
    { label: "أطفال", to: "/shop/products?q=أطفال", image: "", accent: "from-[#0f172a] to-[#0ea5e9]" },
    { label: "الأكثر مبيعًا", to: "/shop/products", image: "", accent: "from-[#1c1917] to-[#a16207]" },
    { label: "عروض", to: "/shop/sale", image: "", accent: "from-[#581c87] to-[#ef4444]" },
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
    { label: "آخر قطعة", action: onLastPiece, image: "", icon: <Sparkles className="h-6 w-6" />, accent: "from-[#1c1917] via-[#78350f] to-[#f8e7b3]" },
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
    size: selectedSize,
    limit: 80,
  }, {
    enabled: open,
  });
  const step = selectedSize ? "products" : selectedCategory ? "sizes" : "categories";
  const title = step === "categories" ? "اختار القسم" : step === "sizes" ? "اختار المقاس" : `${selectedCategory} / ${selectedSize}`;

  useEffect(() => {
    if (!open) {
      setSelectedCategory("");
      setSelectedSize("");
      setIsNavigating(false);
    }
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
    document.body.style.overflow = previousBodyOverflow.current || "";
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
          <button onClick={selectedCategory ? goBack : onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/12 bg-white/10 text-white backdrop-blur transition active:scale-95" aria-label="رجوع">
            {selectedCategory ? <ChevronLeft className="h-5 w-5 rotate-180" /> : <X className="h-5 w-5" />}
          </button>
          <div className="min-w-0 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#f8e7b3]">LAST PIECE FINDER</p>
            <h2 className="mt-1 truncate text-2xl font-black">{title}</h2>
          </div>
          <button onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/12 bg-white/10 text-white backdrop-blur transition active:scale-95" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2">
          {loading && step !== "products" ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="mx-auto h-14 w-14 animate-pulse rounded-full border border-[#f8e7b3]/35 bg-[#f8e7b3]/10" />
                <p className="mt-4 text-sm font-black text-white/70">بنراجع المخزون الحقيقي...</p>
              </div>
            </div>
          ) : error ? (
            <div className="mt-10 rounded-[1.5rem] border border-rose-300/20 bg-rose-500/10 p-5 text-center font-black text-rose-100">{error}</div>
          ) : null}

          {!loading && !error && step === "categories" ? (
            <div className="grid gap-3 pt-5">
              {categories.map((category) => {
                const visual = { icon: <ShoppingBag className="h-6 w-6" />, text: "مقاسات محدودة متاحة الآن" };
                return (
                  <button
                    key={category.label}
                    onClick={() => setSelectedCategory(category.label)}
                    className="group relative min-h-32 overflow-hidden rounded-[1.65rem] border border-white/12 bg-white/[0.08] p-5 text-right shadow-[0_22px_60px_rgba(0,0,0,0.24)] backdrop-blur transition duration-300 active:scale-[0.98] sm:min-h-36"
                  >
                    <span className="absolute inset-y-0 left-0 w-1/2 bg-[radial-gradient(circle_at_30%_50%,rgba(248,231,179,0.16),transparent_48%)] opacity-80" />
                    <span className="relative flex items-center justify-between gap-4">
                      <span>
                        <span className="grid h-12 w-12 place-items-center rounded-full bg-[#f8e7b3] text-stone-950 shadow-[0_12px_34px_rgba(248,231,179,0.20)]">{visual.icon}</span>
                        <span className="mt-4 block text-3xl font-black">{category.label}</span>
                        <span className="mt-1 block text-sm font-bold text-white/58">{visual.text}</span>
                      </span>
                      <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1 text-xs font-black text-[#f8e7b3]">{category.count} فرصة</span>
                    </span>
                  </button>
                );
              })}
              {!categories.length ? <LastPieceEmpty text="لا توجد مقاسات بآخر قطعة حاليا." /> : null}
            </div>
          ) : null}

          {!loading && !error && step === "sizes" ? (
            <div className="pt-7">
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                {sizes.map((size) => (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    className="min-h-16 rounded-2xl border border-[#f8e7b3]/18 bg-white/[0.08] text-xl font-black text-white shadow-[0_14px_34px_rgba(0,0,0,0.18)] backdrop-blur transition hover:border-[#f8e7b3]/45 hover:bg-[#f8e7b3]/12 active:scale-95"
                  >
                    {size}
                  </button>
                ))}
              </div>
              {!sizes.length ? <LastPieceEmpty text="لا يوجد مقاس منخفض المخزون في هذا القسم." /> : null}
            </div>
          ) : null}

          {step === "products" ? (
            <div className="grid gap-3 pt-4">
              {loading ? <ProductSkeleton count={3} /> : products.map((product) => (
                product.variants.map((variant) => {
                  const hasDiscount = Number(product.old_price || 0) > Number(variant.sale_price || variant.price || product.sale_price || product.price || 0);
                  const discountPercent = hasDiscount
                    ? Math.max(1, Math.round(((Number(product.old_price) - Number(variant.sale_price || variant.price || product.sale_price || product.price)) / Number(product.old_price)) * 100))
                    : 0;
                  return (
                    <article key={`${product.id}-${variant.id}`} className="overflow-hidden rounded-[1.45rem] border border-white/12 bg-white/[0.08] shadow-[0_22px_60px_rgba(0,0,0,0.24)] backdrop-blur">
                      <button onClick={() => openProduct(product, variant)} className="grid w-full grid-cols-[8.5rem_1fr] gap-3 p-3 text-right sm:grid-cols-[11rem_1fr]">
                        <span className="relative aspect-[4/5] overflow-hidden rounded-[1.15rem] bg-white/8">
                          <img src={imageFor(variant.image_url || product.image_url)} alt={product.name} className="h-full w-full object-contain p-2" loading="lazy" decoding="async" width="176" height="220" />
                          <span className="absolute right-2 top-2 rounded-full bg-stone-950/86 px-2.5 py-1 text-[10px] font-black text-[#f8e7b3]">{lowStockText(variant.stock)}</span>
                        </span>
                        <span className="flex min-w-0 flex-col py-1">
                          <span className="line-clamp-2 text-lg font-black leading-6">{product.name}</span>
                          <span className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-black">
                            <span className="rounded-full bg-[#f8e7b3] px-2.5 py-1 text-stone-950">مقاس {variant.size}</span>
                            {variant.color ? <span className="rounded-full border border-white/12 bg-white/10 px-2.5 py-1 text-white/76">{variant.color}</span> : null}
                            <span className="rounded-full border border-amber-200/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">سريع النفاذ</span>
                          </span>
                          <span className="mt-auto pt-4">
                            <span className="flex flex-wrap items-end gap-2">
                              <span className="text-xl font-black">{money(variant.sale_price || variant.price || product.sale_price || product.price)}</span>
                              {product.old_price ? <span className="text-xs font-bold text-white/42 line-through">{money(product.old_price)}</span> : null}
                              {discountPercent ? <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-stone-950">-{discountPercent}%</span> : null}
                            </span>
                            <span className="mt-3 grid grid-cols-2 gap-2">
                              <span className="rounded-full border border-white/14 bg-white/10 px-3 py-2 text-center text-xs font-black">احجز المقاس</span>
                              <span className="sf-shimmer-button rounded-full bg-[#f8e7b3] px-3 py-2 text-center text-xs font-black text-stone-950">اطلب الآن</span>
                            </span>
                          </span>
                        </span>
                      </button>
                    </article>
                  );
                })
              ))}
              {!loading && !products.length ? <LastPieceEmpty text="المقاس ده خلص أو زاد مخزونه عن قطعتين." /> : null}
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

function QuickCategories({ options = [] }) {
  const { i18n } = useTranslation();
  const lang = i18n.language || "ar";
  return (
    <div className="mt-2 grid grid-cols-5 gap-2 md:gap-3">
      {options.map((option) => (
        <Link key={option.id || option.value} to={classificationUrl("gender", option.value)} className="group rounded-2xl border border-stone-200/90 bg-white px-2 py-3 text-center text-sm font-black shadow-[0_10px_25px_rgba(39,20,75,0.05)] transition duration-200 hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:shadow-[0_18px_40px_rgba(109,40,217,0.12)] active:scale-[0.98] md:py-4">
          <span className="mx-auto mb-1 grid h-7 w-7 place-items-center rounded-full bg-[#f5f3ff] text-[10px] text-[#6d28d9] transition group-hover:bg-[#6d28d9] group-hover:text-white">
            {classificationIcon(option, lang)}
          </span>
          {classificationLabel(option, lang)}
        </Link>
      ))}
    </div>
  );
}

function SmartBanner() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-4">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-[#7c3aed]/15 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.08)] md:p-6">
        <div className="absolute inset-y-0 left-0 w-1/2 bg-[radial-gradient(circle_at_30%_40%,rgba(167,139,250,0.24),transparent_48%)]" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f5f3ff] px-3 py-1 text-xs font-black text-[#6d28d9]">
              <BadgePercent className="h-4 w-4" />
              عرض ذكي
            </div>
            <h2 className="mt-3 text-2xl font-black md:text-3xl">ادفع عربون فقط وكمّل عند الاستلام</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">اختار المقاس واللون، وسيب الباقي علينا لحد باب البيت.</p>
          </div>
          <Link to="/shop/sale" className="inline-flex w-max items-center gap-2 rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white shadow-[0_14px_35px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:bg-[#6d28d9] active:scale-[0.98]">
            عروض لفترة محدودة <ChevronLeft className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

const ProductRail = memo(function ProductRail({ title, subtitle, products, loading, wishlist, toggleWishlist, addToCart, railType = "default", featuredFirst = false }) {
  const hasProducts = Array.isArray(products) && products.length > 0;
  if (!loading && !hasProducts) return null;
  return (
    <section className="sf-reveal mx-auto max-w-[1200px] px-4 py-2 md:py-3">
      <div className="mb-2 flex items-end justify-between gap-3 text-right">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] text-[#7c3aed] dark:text-[#d8b4fe]">SHOP NOW</div>
          <h2 className="text-[1.55rem] font-black tracking-normal md:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs font-bold text-stone-500 dark:text-stone-400 md:text-sm">{subtitle}</p> : null}
          <div className="mt-1.5 h-1 w-14 rounded-full bg-gradient-to-l from-[#7c3aed] to-[#d8b4fe]" />
        </div>
        <Link to="/shop/products" className="mb-1 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:text-stone-200">عرض الكل</Link>
      </div>
      <div className={`sf-product-rail sf-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2 md:grid md:gap-4 md:overflow-visible ${featuredFirst ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2 xl:grid-cols-4"}`}>
          {loading ? <ProductSkeleton count={4} /> : products.map((product, index) => (
          <div key={product.id} className="w-[84vw] shrink-0 snap-start sm:w-[46vw] md:w-auto">
            <ProductCard product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} railType={railType} rank={index + 1} featured={featuredFirst && index === 0} />
          </div>
          ))}
        </div>
    </section>
  );
});

function MiniRailEmpty() {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-[#7c3aed]/20 bg-white p-6 text-center shadow-[0_12px_30px_rgba(39,20,75,0.05)]">
      <Sparkles className="mx-auto h-7 w-7 text-[#7c3aed]" />
      <h3 className="mt-3 text-lg font-black">لسه بنجهز منتجات جامدة هنا</h3>
      <p className="mt-1 text-sm font-bold text-stone-500">وصل قريبًا</p>
    </div>
  );
}

function ProductsPage({ sale = false, wishlist, toggleWishlist, addToCart }) {
  const { i18n } = useTranslation();
  const lang = i18n.language || "ar";
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const category = params.get("category") || "";
  const gender = params.get("gender") || "";
  const productType = params.get("product_type") || "";
  const style = params.get("style") || "";
  const grade = params.get("grade") || "";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState({ gender, product_type: productType, style, grade });
  const { groups: classificationGroups } = useProductClassifications({ includeInactive: false });
  const classificationOptions = useMemo(
    () => classificationGroupsToFieldOptions(classificationGroups, {}, { includeInactive: false }),
    [classificationGroups]
  );
  const { products, loading, error } = useProducts({ q, category, sale: sale ? 1 : "", gender, product_type: productType, style, grade });
  const filterBasePath = sale ? "/shop/sale" : "/shop/products";
  const activeFilterCount = [gender, productType, style, grade].filter(Boolean).length;
  const filterSections = useMemo(
    () => [
      { key: "gender", label: isArabicLanguage(lang) ? "الجنس" : "Gender", eyebrow: "Gender", icon: Users, options: classificationOptions.gender, value: gender },
      { key: "product_type", label: isArabicLanguage(lang) ? "نوع المنتج" : "Product Type", eyebrow: "Type", icon: Footprints, options: classificationOptions.productType, value: productType },
      { key: "style", label: isArabicLanguage(lang) ? "الستايل" : "Style", eyebrow: "Style", icon: Sparkles, options: classificationOptions.style, value: style },
      { key: "grade", label: isArabicLanguage(lang) ? "الجريد" : "Grade", eyebrow: "Grade", icon: Gem, options: classificationOptions.grade, value: grade },
    ],
    [classificationOptions, gender, grade, lang, productType, style]
  );

  useEffect(() => {
    setDraftFilters({ gender, product_type: productType, style, grade });
  }, [gender, productType, style, grade]);

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
    ["gender", "product_type", "style", "grade"].forEach((field) => next.delete(field));
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
    ["gender", "product_type", "style", "grade"].forEach((field) => next.delete(field));
    setDraftFilters({ gender: "", product_type: "", style: "", grade: "" });
    setFiltersOpen(false);
    navigate(`${filterBasePath}${next.toString() ? `?${next.toString()}` : ""}`);
  };

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-7">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-bold text-stone-500">{sale ? "عروض لفترة محدودة" : "تسوق بسهولة"}</p>
          <h1 className="mt-1 text-3xl font-black">{q ? `نتائج البحث عن "${q}"` : category || (sale ? "العروض" : "كل المنتجات")}</h1>
        </div>
        <div className="text-sm font-bold text-stone-500">{products.length} منتج</div>
      </div>
      <PremiumFilterPanel
        sections={filterSections}
        lang={lang}
        buildFilterUrl={buildFilterUrl}
        clearUrl={clearClassificationFiltersUrl()}
        activeFilterCount={activeFilterCount}
      />
      <MobileFilterTrigger activeFilterCount={activeFilterCount} onOpen={() => setFiltersOpen(true)} />
      <MobileFilterDrawer
        open={filtersOpen}
        sections={filterSections}
        lang={lang}
        draftFilters={draftFilters}
        setDraftFilters={setDraftFilters}
        onClose={() => setFiltersOpen(false)}
        onApply={applyDraftFilters}
        onReset={resetDraftFilters}
      />
      {error ? <EmptyState title="حصلت مشكلة بسيطة" text="جرب تاني أو كلمنا على واتساب" /> : null}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-5">
        {loading ? <ProductSkeleton count={8} /> : products.map((product) => (
          <ProductCard key={product.id} product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} addToCart={addToCart} />
        ))}
      </div>
      {!loading && !products.length ? <EmptyState title="لا توجد منتجات" text="جرب بحث أو قسم مختلف" /> : null}
    </section>
  );
}

function PremiumFilterPanel({ sections, lang, buildFilterUrl, clearUrl, activeFilterCount = 0 }) {
  return (
    <div className="mb-5 hidden md:block">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-2xl border border-white/10 bg-stone-950 text-white shadow-[0_14px_36px_rgba(0,0,0,0.18)]">
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#7c3aed]">Curated Filters</p>
            <h2 className="text-sm font-black text-stone-950 dark:text-white">فلترة سريعة بتجربة Premium</h2>
          </div>
        </div>
        {activeFilterCount ? (
          <Link
            to={clearUrl}
            className="rounded-full border border-stone-200 bg-white/80 px-4 py-2 text-[11px] font-black text-stone-600 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-[#7c3aed]/35 hover:text-[#6d28d9] dark:border-white/10 dark:bg-white/5 dark:text-stone-200"
          >
            مسح الفلاتر
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
        <PremiumFilterChip to={buildFilterUrl(section.key, "")} active={!section.value} icon={Tag} label="الكل" />
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
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed right-4 z-30 inline-flex items-center gap-2 rounded-full border border-white/15 bg-stone-950/92 px-4 py-3 text-xs font-black text-white shadow-[0_18px_44px_rgba(0,0,0,0.28)] backdrop-blur-xl transition active:scale-95 md:hidden"
      style={{ bottom: "calc(var(--mobile-bottom-nav-height, 76px) + env(safe-area-inset-bottom) + 1rem)" }}
    >
      <SlidersHorizontal className="h-4 w-4" />
      <span>الفلاتر</span>
      {activeFilterCount ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#d8b4fe] px-1 text-[10px] text-stone-950">{activeFilterCount}</span> : null}
    </button>
  );
}

function MobileFilterDrawer({ open, sections, lang, draftFilters, setDraftFilters, onClose, onApply, onReset }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-stone-950/55 backdrop-blur-sm" onClick={onClose} aria-label="إغلاق الفلاتر" />
      <div className="absolute inset-x-0 bottom-0 max-h-[84dvh] overflow-hidden rounded-t-[2rem] border border-white/10 bg-[linear-gradient(180deg,#101426_0%,#070b16_100%)] text-white shadow-[0_-24px_70px_rgba(0,0,0,0.42)]">
        <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-white/20" />
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#d8b4fe]">Premium Filters</p>
            <h2 className="text-lg font-black">اختار اللي يناسبك</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/5 transition active:scale-95" aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="sf-scroll max-h-[calc(84dvh-140px)] space-y-3 overflow-y-auto px-4 py-4 pb-28">
          {sections.map((section) => (
            <MobileFilterSection key={section.key} section={section} lang={lang} draftValue={draftFilters[section.key] || ""} onSelect={(value) => setDraftFilters((current) => ({ ...current, [section.key]: value }))} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex gap-2 border-t border-white/10 bg-[#070b16]/92 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-xl">
          <button type="button" onClick={onApply} className="flex-1 rounded-2xl bg-gradient-to-l from-[#7c3aed] to-[#111827] px-4 py-3 text-sm font-black text-white shadow-[0_14px_34px_rgba(124,58,237,0.32)] active:scale-[0.98]">
            Apply Filters
          </button>
          <button type="button" onClick={onReset} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white/80 active:scale-[0.98]">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileFilterSection({ section, lang, draftValue, onSelect }) {
  const SectionIcon = section.icon || Sparkles;
  const options = uniqueClassificationOptions(section.options || []);
  return (
    <section className="rounded-[1.4rem] border border-white/10 bg-white/[0.055] p-3 shadow-[0_14px_38px_rgba(0,0,0,0.20)] backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-2xl bg-white/8 text-[#ddd6fe]">
          <SectionIcon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/35">{section.eyebrow}</p>
          <h3 className="text-sm font-black">{section.label}</h3>
        </div>
      </div>
      <div className="sf-scroll flex gap-2 overflow-x-auto pb-1">
        <MobileFilterChip active={!draftValue} label="الكل" icon={Tag} onClick={() => onSelect("")} />
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
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] font-black transition ${
        active
          ? "scale-[1.03] border-[#d8b4fe]/60 bg-[linear-gradient(135deg,rgba(124,58,237,0.95),rgba(17,24,39,0.92))] text-white shadow-[0_12px_30px_rgba(124,58,237,0.34)]"
          : "border-white/10 bg-white/6 text-white/65"
      }`}
      style={!active && color ? { borderColor: `${color}44` } : undefined}
    >
      {preview ? <span className="h-3 w-3 rounded-full border border-white/20" style={{ background: color || "#7c3aed" }} /> : <Icon className="h-3.5 w-3.5" />}
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

const ProductCard = memo(function ProductCard({ product, wishlist, toggleWishlist, addToCart, railType = "default", rank = null, featured = false }) {
  const variants = useMemo(() => (Array.isArray(product.variants) ? product.variants : []), [product]);
  const firstAvailableVariant = useMemo(() => firstDisplayVariant(variants), [variants]);
  const [selectedVariantId, setSelectedVariantId] = useState(firstAvailableVariant?.id || "");
  const availableVariant = useMemo(
    () => variants.find((variant) => String(variant.id) === String(selectedVariantId)) || firstAvailableVariant,
    [firstAvailableVariant, selectedVariantId, variants]
  );
  const inWishlist = useMemo(() => wishlist.some((item) => String(item.id) === String(product.id)), [product.id, wishlist]);
  const hasDiscount = Number(product.old_price || 0) > Number(product.sale_price || product.price || 0);
  const discountPercent = hasDiscount
    ? Math.max(1, Math.round(((Number(product.old_price) - Number(product.sale_price || product.price)) / Number(product.old_price)) * 100))
    : 0;
  const allSizes = useMemo(
    () => [...new Map(variants.filter((variant) => variant.size).map((variant) => [String(variant.size), variant])).values()],
    [variants]
  );
  const visibleSizes = useMemo(() => allSizes.slice(0, 4), [allSizes]);
  const extraSizeCount = Math.max(0, allSizes.length - visibleSizes.length);
  const displayImage = useMemo(() => displayImageForProduct(product, availableVariant), [availableVariant, product]);
  const editorialLabel =
    railType === "bestseller"
      ? rank === 1
        ? "اختيار العملاء المفضل"
        : "الأكثر مبيعا هذا الأسبوع"
      : railType === "sale"
        ? "عرض لفترة محدودة"
        : railType === "new"
          ? "وصل حديثا للمخزون"
          : product.low_stock
            ? "آخر المقاسات المتاحة"
            : "";

  useEffect(() => {
    setSelectedVariantId(firstAvailableVariant?.id || "");
  }, [firstAvailableVariant?.id, product.id]);

  const canQuickAdd = availableVariant && variantHasStock(availableVariant);
  const handleQuickAdd = useCallback(() => addToCart(product, availableVariant), [addToCart, availableVariant, product]);
  const handleWishlist = useCallback(() => {
    toggleWishlist(product);
    playSoftClick();
  }, [product, toggleWishlist]);

  return (
    <article className={`group/product relative flex h-full min-h-0 flex-col overflow-hidden rounded-[1.15rem] border border-stone-200 bg-white shadow-[0_12px_34px_rgba(39,20,75,0.07)] ring-1 ring-stone-200/60 transition duration-300 hover:-translate-y-1 hover:ring-[#7c3aed]/25 hover:shadow-[0_22px_64px_rgba(39,20,75,0.14)] md:min-h-[430px] md:rounded-[1.65rem] md:shadow-[0_18px_50px_rgba(39,20,75,0.08)] dark:border-white/10 dark:bg-[#0b1020] dark:ring-white/5 dark:shadow-[0_18px_50px_rgba(0,0,0,0.24)] ${featured ? "md:shadow-[0_24px_74px_rgba(109,40,217,0.16)]" : ""}`}>
      <div className="pointer-events-none absolute inset-x-8 top-8 h-20 rounded-full bg-[#a78bfa]/0 blur-2xl transition duration-500 group-hover/product:bg-[#a78bfa]/18" />
      <div className="relative aspect-[1/1.08] overflow-hidden bg-[radial-gradient(circle_at_50%_42%,rgba(167,139,250,0.16),transparent_34%),linear-gradient(180deg,#fbfaf7_0%,#f1ece4_100%)] p-1.5 md:aspect-[5/6] md:p-5 dark:bg-[radial-gradient(circle_at_50%_42%,rgba(167,139,250,0.12),transparent_34%),linear-gradient(180deg,#101426_0%,#0b1020_100%)]">
        <div className="absolute inset-x-8 top-[20%] h-32 rounded-full bg-white/55 blur-xl dark:bg-white/10" />
        <Link to={productUrl(product)} className="relative z-10 block h-full">
          {displayImage ? (
            <img src={imageFor(displayImage)} alt={product.name} className="h-full w-full rounded-[0.9rem] object-contain object-center p-0 opacity-0 transition duration-500 group-hover/product:-translate-y-1 group-hover/product:scale-[1.055] md:rounded-[1.35rem] md:p-1" loading="lazy" decoding="async" width="360" height="432" onLoad={(event) => event.currentTarget.classList.remove("opacity-0")} />
          ) : (
            <div className="grid h-full w-full place-items-center rounded-[1.1rem] bg-white/70 text-center text-xs font-black text-stone-400 dark:bg-white/5 dark:text-stone-500 md:rounded-[1.35rem]">
              SHOES
            </div>
          )}
        </Link>
        <div className="absolute right-2 top-2 z-20 flex flex-col items-start gap-1 md:right-3 md:top-3 md:gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-black shadow-sm backdrop-blur md:px-3 md:py-1 md:text-[10px] ${badgeTone(product.badge, hasDiscount)}`}>{product.badge}</span>
          {rank && railType === "bestseller" && rank <= 3 ? <span className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-black text-stone-950 shadow-sm dark:bg-white dark:text-stone-950">TOP {rank}</span> : null}
          {discountPercent ? <span className="rounded-full border border-[#7c3aed]/15 bg-white/95 px-2 py-0.5 text-[9px] font-black text-[#6d28d9] shadow-sm md:px-2.5 md:py-1 md:text-[10px] dark:border-white/10 dark:bg-[#0b1020] dark:text-[#d8b4fe]">-{discountPercent}%</span> : null}
        </div>
        <button onClick={handleWishlist} className="absolute left-2 top-2 z-20 rounded-full bg-white/95 p-1.5 shadow-sm ring-1 ring-stone-200/70 transition hover:scale-110 hover:text-rose-500 active:scale-95 md:left-3 md:top-3 md:p-2 dark:bg-white/5 dark:text-stone-100 dark:ring-white/10" aria-label="المفضلة">
          <Heart className={`h-4 w-4 transition md:h-5 md:w-5 ${inWishlist ? "animate-[wishlist-pop_320ms_ease-out] fill-rose-500 text-rose-500" : "text-stone-700 dark:text-stone-200"}`} />
        </button>
        <div className="absolute inset-x-3 bottom-3 translate-y-3 opacity-0 transition duration-300 group-hover/product:translate-y-0 group-hover/product:opacity-100 max-md:hidden">
          <button
            onClick={handleQuickAdd}
            disabled={!canQuickAdd}
            className="sf-shimmer-button w-full rounded-full bg-stone-950/94 px-3 py-3 text-xs font-black text-white shadow-xl backdrop-blur transition hover:bg-[#6d28d9] disabled:bg-stone-300 dark:bg-white dark:text-stone-950 dark:hover:bg-[#f5f3ff]"
          >
            {canQuickAdd ? "إضافة سريعة" : "غير متاح"}
          </button>
        </div>
          {product.low_stock ? <span className="absolute bottom-2 right-2 z-20 rounded-full border border-amber-200 bg-amber-50/95 px-2 py-0.5 text-[9px] font-black text-amber-800 shadow-sm md:bottom-auto md:top-3 md:right-auto md:left-14 md:px-3 md:py-1 md:text-[10px] dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">باقي {product.total_stock} فقط</span> : null}
      </div>
        <div className="flex flex-1 flex-col p-2.5 pt-2 md:p-5 md:pt-4">
          {editorialLabel ? <div className="mb-0.5 truncate text-[9px] font-black text-[#6d28d9] md:mb-1 md:text-[10px] dark:text-[#d8b4fe]">{editorialLabel}</div> : null}
        <Link to={productUrl(product)} className="line-clamp-2 min-h-8 text-[13px] font-black leading-4 tracking-normal transition hover:text-[#6d28d9] md:min-h-12 md:text-[15px] md:leading-5 dark:text-stone-100">{product.name}</Link>
        <div className="mt-1.5 flex min-h-5 flex-wrap items-end gap-x-1.5 gap-y-0.5 md:mt-2 md:min-h-6 md:gap-x-2">
          <span className="text-[16px] font-black leading-none text-stone-950 md:text-[1.15rem] dark:text-white">{money(product.sale_price || product.price)}</span>
          {product.old_price ? <span className="text-[11px] font-bold text-stone-400 dark:text-stone-500 md:text-xs">بدل <span className="line-through">{money(product.old_price)}</span></span> : null}
        </div>
        <div className="sf-scroll mt-2 flex min-h-7 flex-nowrap gap-1 overflow-x-auto pb-0.5 md:mt-3 md:min-h-16 md:flex-wrap md:content-start md:gap-1.5 md:overflow-hidden">
          {visibleSizes.map((variant) => {
            const inStock = Number(variant.stock || 0) > 0;
            const selected = String(availableVariant?.id) === String(variant.id);
            return (
              <button
                key={`${variant.id}-${variant.size}`}
                type="button"
                disabled={!inStock}
                onClick={() => setSelectedVariantId(variant.id)}
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black transition md:px-2.5 md:py-1 md:text-[10px] ${selected ? "border-[#7c3aed] bg-[#f5f3ff] text-[#6d28d9] dark:border-[#d8b4fe] dark:bg-[#d8b4fe]/10 dark:text-[#f5f3ff]" : "border-stone-200 bg-[#faf8f3] text-stone-700 hover:border-[#7c3aed]/50 hover:text-[#6d28d9] dark:border-white/10 dark:bg-white/5 dark:text-stone-300 dark:hover:border-[#d8b4fe]/50 dark:hover:text-white"} disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-300 disabled:line-through dark:disabled:bg-white/5 dark:disabled:text-stone-500`}
              >
                {variant.size}
              </button>
            );
          })}
          {extraSizeCount ? (
            <span className="shrink-0 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[9px] font-black text-stone-400 md:px-2.5 md:py-1 md:text-[10px] dark:border-white/10 dark:bg-white/5 dark:text-stone-500">+{extraSizeCount}</span>
          ) : null}
          {!visibleSizes.length ? (
            <span className="shrink-0 rounded-full border border-stone-200 bg-[#faf8f3] px-2 py-0.5 text-[9px] font-bold text-stone-400 md:px-2.5 md:py-1 md:text-[10px] dark:border-white/10 dark:bg-white/5 dark:text-stone-500">مقاس واحد</span>
          ) : null}
        </div>
        <button
          onClick={handleQuickAdd}
          disabled={!canQuickAdd}
          className="sf-shimmer-button mt-2 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#0c0a09,#3b0764)] px-3 text-xs font-black text-white shadow-[0_12px_28px_rgba(76,29,149,0.28)] transition hover:bg-[#6d28d9] active:scale-[0.98] disabled:bg-none disabled:bg-stone-300 disabled:text-stone-500 dark:from-white dark:to-[#d8b4fe] dark:text-stone-950 dark:hover:bg-[#f5f3ff] md:hidden"
        >
          <ShoppingCart className="h-4 w-4" />
          {canQuickAdd ? "أضف للسلة" : "غير متاح"}
        </button>
      </div>
    </article>
  );
}, (prev, next) => {
  const wasInWishlist = prev.wishlist.some((item) => String(item.id) === String(prev.product.id));
  const isInWishlist = next.wishlist.some((item) => String(item.id) === String(next.product.id));
  return (
    prev.product === next.product &&
    wasInWishlist === isInWishlist &&
    prev.toggleWishlist === next.toggleWishlist &&
    prev.addToCart === next.addToCart &&
    prev.railType === next.railType &&
    prev.rank === next.rank &&
    prev.featured === next.featured
  );
});

function badgeTone(badge = "", hasDiscount = false) {
  const value = String(badge || "").trim();
  if (hasDiscount || value.includes("عرض")) return "bg-[#6d28d9] text-white";
  if (value.includes("آخر")) return "bg-stone-950 text-white";
  if (value.includes("نفاذ")) return "border border-amber-200 bg-amber-50 text-amber-800";
  if (value.includes("مبيع")) return "bg-white/95 text-stone-950 ring-1 ring-stone-200";
  return "bg-stone-950 text-white";
}

function ProductDetails({ addToCart, toggleWishlist, wishlist, rememberProduct, recent, profile }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const productQueryKey = searchParams.toString();
  const [state, setState] = useState({ loading: true, product: null, error: "" });
  const [selected, setSelected] = useState({ variantId: "", size: "", colorKey: "", colorName: "", image: "" });
  const [qty, setQty] = useState(1);
  const [showMobileBuyBar, setShowMobileBuyBar] = useState(false);
  const mainCtaRef = useRef(null);
  const recentlyViewedSentRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    api.get(`/storefront/products/${id}`, { signal: controller.signal }).then((data) => {
      const product = data.product;
      const productVariants = Array.isArray(product?.variants) ? product.variants : [];
      const requestedVariantId = searchParams.get("variant") || "";
      const requestedSize = searchParams.get("size") || "";
      const requestedColor = searchParams.get("color") || "";
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
        if (product) {
          rememberProduct(product);
          const phone = profile?.primary_phone || profile?.phone || "";
          const recentlyViewedKey = `${product.id}:${phone || getSessionId()}`;
          if (recentlyViewedSentRef.current !== recentlyViewedKey) {
            recentlyViewedSentRef.current = recentlyViewedKey;
            api.post("/storefront/recently-viewed", { product_id: product.id, session_id: getSessionId(), phone }).catch(() => {});
          }
        }
      }
    }).catch((error) => {
      if (!cancelled && error?.cause?.name !== "AbortError") {
        setState({ loading: false, product: null, error: error.message });
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, productQueryKey]);

  const product = state.product;
  const variants = product?.variants || [];
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
  const galleryImages = galleryItems.map((item) => item.image);
  const mirrorProduct = product ? isMirrorProduct(product) : false;
  const displayTitle = cleanDisplayText(product ? mirrorProductTitle(product, variant) || product.name : "");
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
      setShowMobileBuyBar(false);
      return undefined;
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
    selectVariant(candidate, { preserveSize: true, image: variantImage(candidate) || group?.primaryImage?.image_url || group?.primaryImage?.preview || "" });
  };
  const selectSize = (size) => {
    const candidates = variants.filter((item) => String(item.size || "") === String(size) && (!selectedColorKey || variantColorKey(item) === selectedColorKey));
    const candidate = candidates.find(variantHasStock) || candidates[0];
    selectVariant(candidate);
  };
  const selectGalleryImage = (item) => {
    if (item?.variant) {
      selectVariant(item.variant, { image: item.image });
      return;
    }
    setSelected((prev) => ({ ...prev, image: item?.image || "" }));
  };
  const buyNow = () => {
    if (!product || !variant || Number(variant.stock || 0) <= 0) return;
    addToCart(product, variant, qty);
    navigate("/shop/checkout");
  };
  const addFromStickyBar = () => {
    if (!product || !variant || Number(variant.stock || 0) <= 0) return;
    addToCart(product, variant, qty);
    setShowMobileBuyBar(false);
  };
  const shareProduct = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: displayTitle, text: descriptionText, url });
        return;
      }
      await navigator.clipboard?.writeText(url);
      toast.success("تم نسخ رابط المنتج");
    } catch {
      // User cancelled native share.
    }
  };

  if (state.loading) return <section className="mx-auto max-w-7xl px-4 py-6"><ProductSkeleton count={2} /></section>;
  if (!product) return <EmptyState title="المنتج غير موجود" text="ارجع للمنتجات وجرب اختيار تاني" />;

  return (
    <section dir="rtl" className="mx-auto grid max-w-7xl gap-3 px-4 pb-36 pt-2 md:gap-5 md:pt-5 lg:grid-cols-[minmax(0,55fr)_minmax(360px,45fr)] lg:items-start lg:pb-8">
      <div className="min-w-0">
        <div className="relative mx-auto h-[clamp(280px,48vh,380px)] w-full max-w-[92vw] overflow-hidden rounded-[28px] border border-stone-200 bg-[linear-gradient(180deg,#fbfaf7_0%,#f1ece4_100%)] p-2 shadow-[0_14px_40px_rgba(39,20,75,0.10)] md:h-auto md:max-w-none md:rounded-[1.75rem] md:p-5 md:shadow-[0_20px_55px_rgba(39,20,75,0.10)]">
          <div className="absolute inset-x-10 bottom-5 h-12 rounded-full bg-white/80 blur-2xl md:inset-x-16 md:bottom-8 md:h-16" />
          <img src={imageFor(mainImage)} alt={displayTitle} className="relative z-10 mx-auto h-full w-full object-contain drop-shadow-[0_14px_18px_rgba(39,20,75,0.14)] md:aspect-[4/3] md:max-h-[540px] md:drop-shadow-[0_22px_26px_rgba(39,20,75,0.18)]" loading="eager" decoding="async" fetchPriority="high" width="900" height="675" />
        </div>
        {galleryItems.length > 1 ? (
          <div className="sf-scroll mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 md:mt-3">
            {galleryItems.map((item, imageIndex) => {
              const image = item.image;
              const active = mainImage === image || selected.image === image;
              return (
                <button
                  key={`${image}-${imageIndex}`}
                  type="button"
                  onClick={() => selectGalleryImage(item)}
                  className={`h-16 w-16 shrink-0 snap-start overflow-hidden rounded-2xl border bg-white p-1 transition hover:-translate-y-0.5 hover:border-stone-900 md:h-20 md:w-20 md:p-1.5 ${active ? "border-stone-950 shadow-[0_12px_28px_rgba(39,20,75,0.14)]" : "border-stone-200"}`}
                >
                  <img src={imageFor(image)} alt="" className="h-full w-full object-contain" loading="lazy" decoding="async" width="80" height="80" />
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-[1.35rem] border border-stone-200 bg-white p-4 shadow-[0_14px_38px_rgba(39,20,75,0.07)] md:rounded-[1.75rem] md:p-7 md:shadow-[0_18px_50px_rgba(39,20,75,0.08)]">
          <div className="mb-3 flex items-start justify-between gap-3 md:mb-4">
            <div className="min-w-0">
              <span className="inline-flex rounded-full bg-stone-100 px-2.5 py-0.5 text-[10px] font-black text-stone-700 md:px-3 md:py-1 md:text-xs">{cleanDisplayText(product.badge) || "جديد"}</span>
              <div className="mt-1.5 text-[11px] font-black text-[#6d28d9] md:mt-3 md:text-xs">تفاصيل منتج مختار بعناية</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => toggleWishlist(product)} className="grid h-11 w-11 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:border-rose-300 hover:text-rose-600">
                <Heart className={`h-5 w-5 ${inWishlist ? "fill-rose-500 text-rose-500" : ""}`} />
              </button>
              <button type="button" onClick={shareProduct} className="grid h-11 w-11 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:border-stone-900 hover:text-stone-950">
                <Share2 className="h-5 w-5" />
              </button>
            </div>
          </div>
          <h1 className="text-2xl font-black leading-tight tracking-normal text-stone-950 md:text-4xl">{displayTitle}</h1>
          {mirrorProduct && variant?.edition_name ? (
            <div className="mt-2 inline-flex rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-black text-stone-600">
              {cleanDisplayText(variant.edition_name)}
            </div>
          ) : null}
          <div className="mt-2 flex items-center gap-2 text-xs font-bold text-stone-600 md:mt-3 md:text-sm">
            <span className="flex gap-0.5 text-amber-400">{Array.from({ length: 5 }).map((_, index) => <Star key={index} className="h-4 w-4 fill-current" />)}</span>
            <span className="text-stone-800">4.8</span>
            <span className="text-stone-400">|</span>
            <span>تقييمات موثقة</span>
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-stone-700 md:mt-4 md:text-[15px] md:leading-[1.8]">{descriptionText}</p>
          <div className="mt-4 flex items-end gap-3 md:mt-5">
            <span className="text-2xl font-black leading-none text-stone-950 md:text-3xl">{money(variant?.sale_price || product.sale_price || product.price)}</span>
            {product.old_price ? <span className="font-bold text-stone-400 line-through">{money(product.old_price)}</span> : null}
          </div>
          <Selector
            title="المقاس"
            help={
              <Link
                to="/shop/size-guide"
                className="inline-flex items-center rounded-full border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-black text-stone-800 transition hover:border-stone-950 hover:bg-white"
              >
                دليل المقاسات
              </Link>
            }
          >
            {sizes.map((size) => {
              const hasStock = variantGroup.some((item) => item.size === size && variantHasStock(item));
              return <Choice key={size} active={selected.size === size} disabled={!hasStock} onClick={() => selectSize(size)}>{size}</Choice>;
            })}
          </Selector>
          <Selector title="اللون">
            {colors.map((group) => {
              const hasStock = group.variants.some((item) => variantHasStock(item));
              return <Choice key={group.key} active={selectedColorKey === group.key} disabled={!hasStock} onClick={() => selectColor(group)}>{group.colorName || group.color}</Choice>;
            })}
          </Selector>
          {variant && Number(variant.stock || 0) <= 0 ? <p className="mt-3 text-sm font-bold text-rose-600">المقاس أو اللون ده غير متاح حاليا</p> : null}
          {variant && Number(variant.stock || 0) > 0 && Number(variant.stock || 0) <= 3 ? <p className="mt-3 text-sm font-black text-amber-700">باقي {variant.stock} فقط</p> : null}
          <div className="mt-5 flex items-center gap-3">
            <button onClick={() => setQty(Math.max(1, qty - 1))} className="rounded-full border border-stone-200 p-3"><Minus className="h-4 w-4" /></button>
            <span className="w-8 text-center font-black">{qty}</span>
            <button onClick={() => setQty(Math.min(Number(variant?.stock || 1), qty + 1))} className="rounded-full border border-stone-200 p-3">+</button>
          </div>
          <div ref={mainCtaRef} className="mt-5 grid grid-cols-2 gap-3">
            <button onClick={() => addToCart(product, variant, qty)} disabled={!variant || Number(variant.stock || 0) <= 0} className="sf-shimmer-button rounded-full bg-stone-950 px-5 py-4 font-black text-white transition hover:bg-[#6d28d9] disabled:bg-stone-300">أضف للسلة</button>
            <button onClick={buyNow} disabled={!variant || Number(variant.stock || 0) <= 0} className="rounded-full bg-[#6d28d9] px-5 py-4 font-black text-white shadow-[0_16px_36px_rgba(109,40,217,0.20)] transition hover:-translate-y-0.5 disabled:bg-stone-300">اشتري الآن</button>
          </div>
          <a href="https://wa.me/" className="mt-4 inline-flex items-center gap-2 text-sm font-black text-stone-600"><Phone className="h-4 w-4" /> محتاج مساعدة في المقاس؟</a>
          <div className="mt-6 grid grid-cols-2 gap-2 text-sm font-bold text-stone-700">
            <InfoLine icon={<Truck className="h-4 w-4" />} text="شحن سريع" />
            <InfoLine icon={<PackageCheck className="h-4 w-4" />} text="استبدال خلال 14 يوم" />
            <InfoLine icon={<ShieldCheck className="h-4 w-4" />} text="دفع آمن" />
            <InfoLine icon={<Sparkles className="h-4 w-4" />} text="خامة Premium" />
          </div>
        </div>
        <RelatedProducts currentId={product.id} addToCart={addToCart} toggleWishlist={toggleWishlist} wishlist={wishlist} recent={recent} />
        <RecentProductsSection currentId={product.id} recent={recent} />
      </div>
      <MobileBuyBar product={product} variant={variant} visible={showMobileBuyBar} addToCart={addFromStickyBar} buyNow={buyNow} />
    </section>
  );
}

function Selector({ title, help, children }) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-black text-stone-950">{title}</h3>
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
      className={`relative min-w-12 overflow-hidden rounded-full border px-4 py-2.5 text-sm font-black transition ${
        active
          ? "border-stone-950 bg-stone-950 text-white shadow-[0_12px_24px_rgba(39,20,75,0.16)]"
          : disabled
            ? "cursor-not-allowed border-stone-200 bg-stone-100 text-stone-400 opacity-40"
            : "border-stone-200 bg-white text-stone-950 hover:border-stone-900"
      }`}
    >
      {disabled ? <span className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[120%] -translate-x-1/2 -translate-y-1/2 rotate-[-18deg] bg-stone-500/70" /> : null}
      <span className="relative z-10">{children}</span>
    </button>
  );
}

function RelatedProducts({ currentId, ...props }) {
  const { products } = useProducts({ limit: 4 });
  const filtered = useMemo(
    () => products.filter((product) => String(product.id) !== String(currentId)).slice(0, 4),
    [currentId, products]
  );
  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black">منتجات مشابهة</h2>
          <p className="mt-1 text-xs font-bold text-stone-500">ربما يعجبك أيضا</p>
        </div>
        <Link to="/shop/products" className="rounded-full bg-white px-3 py-2 text-xs font-black text-stone-600 shadow-sm">عرض الكل</Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {filtered.length ? filtered.map((product) => <ProductCard key={product.id} product={product} railType="similar" {...props} />) : <MiniRailEmpty />}
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
    <div className="mt-4 rounded-[1.5rem] border border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black">شوهد مؤخرًا</h2>
          <p className="mt-1 text-xs font-bold text-stone-500">آخر المنتجات اللي شوفتها هتظهر هنا</p>
        </div>
        <Link to="/shop/recently-viewed" className="rounded-full bg-stone-100 px-3 py-2 text-xs font-black text-stone-700">عرض الكل</Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <Link key={item.id} to={`/shop/product/${item.slug || item.id}`} className="min-w-0 rounded-2xl bg-stone-50 p-2">
            <img src={imageFor(item.image_url)} alt="" className="aspect-square w-full rounded-xl object-cover" loading="lazy" decoding="async" width="240" height="240" />
            <div className="mt-2 truncate text-sm font-black">{item.name}</div>
            <div className="mt-1 text-xs font-bold text-stone-500">{money(item.price)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CartPage({ cart, updateCart, removeFromCart }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="text-3xl font-black">السلة</h1>
      <CartContent cart={cart} updateCart={updateCart} removeFromCart={removeFromCart} />
    </section>
  );
}

function CartContent({ cart, updateCart, removeFromCart }) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (!cart.length) return <EmptyState title="السلة مستنياك تملاها بحاجات جامدة" text="ابدأ من المنتجات وشوف الجديد" />;
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {cart.map((item) => (
          <div key={item.lineId} className="flex gap-3 rounded-3xl border border-stone-200 bg-white p-3">
            <img src={imageFor(item.image_url)} alt="" className="h-24 w-24 rounded-2xl object-cover" loading="lazy" decoding="async" width="96" height="96" />
            <div className="min-w-0 flex-1">
              <div className="font-black">{item.name}</div>
              <div className="mt-1 text-xs font-bold text-stone-500">{item.color || "لون"} / {item.size || "مقاس"}</div>
              <div className="mt-2 font-black">{money(item.price)}</div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => updateCart(item.lineId, item.quantity - 1)} className="rounded-full border border-stone-200 p-2"><Minus className="h-4 w-4" /></button>
                <span className="w-7 text-center font-black">{item.quantity}</span>
                <button onClick={() => updateCart(item.lineId, item.quantity + 1)} className="rounded-full border border-stone-200 px-3 py-1.5">+</button>
                <button onClick={() => removeFromCart(item.lineId)} className="mr-auto rounded-full p-2 text-rose-600"><Trash2 className="h-5 w-5" /></button>
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
      <h2 className="text-xl font-black">ملخص الطلب</h2>
      <SummaryRow label="المنتجات" value={money(subtotal)} />
      <SummaryRow label="تقدير الشحن" value={money(delivery)} />
      <SummaryRow label="الإجمالي" value={money(subtotal + delivery)} strong />
      <Link to="/shop/checkout" className="mt-5 block rounded-full bg-stone-950 px-5 py-4 text-center font-black text-white">إتمام الشراء</Link>
      <p className="mt-3 text-xs font-bold text-stone-500">التكلفة النهائية تظهر في صفحة الدفع حسب المحافظة.</p>
    </aside>
  );
}

function CheckoutPage({ cart, clearCart, profile, setProfile }) {
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
  const [manualCityArea, setManualCityArea] = useState(false);
  const [shippingTransferMethod, setShippingTransferMethod] = useState("instapay");
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
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
  const isShippingConfirmation = SHIPPING_CONFIRMATION_METHODS.has(form.payment_method);
  const hasShippingPaymentProof = Boolean(shippingPaymentFile);
  const submitDisabled = submitting || (isShippingConfirmation && !hasShippingPaymentProof);
  const codAmount = form.payment_method === "cod" ? total : Math.max(0, total - deliveryFee);
  const paymentCopy = paymentMethods.find((method) => method.id === form.payment_method)?.text || "";
  const cityAreaOptions = governorateCityAreas[form.governorate] || [];

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const setGovernorate = (value) => {
    setManualCityArea(false);
    setForm((prev) => ({ ...prev, governorate: value, city_area: "" }));
    setErrors((prev) => ({ ...prev, governorate: "", city_area: "" }));
  };

  const setCityArea = (value) => {
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
      setCustomerTrust({ loading: false, customer: null });
      return;
    }
    let cancelled = false;
    setCustomerTrust((prev) => ({ ...prev, loading: true }));
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
    if (form.payment_method === "cod" && !codAvailable) {
      setForm((prev) => ({ ...prev, payment_method: "shipping_confirmation" }));
    }
  }, [codAvailable, form.payment_method]);

  useEffect(() => {
    if (!isShippingConfirmation) {
      setShippingPaymentFile(null);
      setErrors((prev) => ({ ...prev, shipping_payment_screenshot: "" }));
    }
  }, [isShippingConfirmation]);

  useEffect(() => {
    if (!shippingPaymentFile) {
      setShippingPaymentPreviewUrl("");
      return undefined;
    }

    const previewUrl = URL.createObjectURL(shippingPaymentFile);
    setShippingPaymentPreviewUrl(previewUrl);

    return () => URL.revokeObjectURL(previewUrl);
  }, [shippingPaymentFile]);

  const validate = () => {
    const next = {};
    const phone = form.primary_phone.replace(/\s/g, "");
    if (!form.full_name.trim()) next.full_name = "اكتب الاسم بالكامل";
    if (!phone) next.primary_phone = "رقم الموبايل مطلوب";
    else if (!/^01[0125][0-9]{8}$/.test(phone)) next.primary_phone = "اكتب رقم موبايل مصري صحيح، مثال 01012345678";
    if (!form.governorate) next.governorate = "اختار المحافظة";
    if (!form.city_area.trim()) next.city_area = "اكتب المدينة أو المنطقة";
    if (!form.detailed_address.trim()) next.detailed_address = "اكتب العنوان بالتفصيل عشان المندوب يوصلك بسرعة";
    if (!form.payment_method) next.payment_method = "اختار طريقة الدفع";
    if (!form.city_area.trim() && !manualCityArea) next.city_area = "اختار المدينة أو المنطقة";
    if (form.payment_method === "cod" && !codAvailable) next.payment_method = "الدفع عند الاستلام غير متاح لهذا العميل";
    if (SHIPPING_CONFIRMATION_METHODS.has(form.payment_method) && !shippingPaymentFile) {
      next.shipping_payment_screenshot = "يرجى رفع صورة إثبات التحويل لتأكيد الطلب";
    }
    setErrors(next);
    if (Object.keys(next).length) toast.error("راجع البيانات المطلوبة وكمل الطلب");
    if (next.shipping_payment_screenshot) toast.error("ارفع صورة التحويل أولًا");
    return !Object.keys(next).length;
  };

  const handlePaymentProofChange = (file) => {
    if (!file) {
      setShippingPaymentFile(null);
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("صورة إثبات التحويل غير صالحة");
      setShippingPaymentFile(null);
      return;
    }
    if (Number(file.size || 0) < 5 * 1024) {
      toast.error("صورة إثبات التحويل غير صالحة");
      setShippingPaymentFile(null);
      return;
    }
    setErrors((prev) => ({ ...prev, shipping_payment_screenshot: "" }));
    setShippingPaymentFile(file);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitting || !validate()) return;
    setSubmitting(true);
    try {
      const cleanPhone = form.primary_phone.replace(/\s/g, "");
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
        primary_phone: cleanPhone,
        delivery_fee: deliveryFee,
        shipping_fee: deliveryFee,
        shipping_address: shippingProviderAddress,
        shipping_provider_address: shippingProviderAddress,
        shipping_payment_method: shippingTransferMethod,
      };
      const requestBody = shippingPaymentFile
        ? (() => {
            const formData = new FormData();
            formData.append("checkout", JSON.stringify(checkoutPayload));
            formData.append("items", JSON.stringify(cart));
            formData.append("delivery_fee", String(deliveryFee));
            formData.append("discount", String(discount));
            formData.append("shipping_payment_screenshot", shippingPaymentFile);
            return formData;
          })()
        : {
            checkout: checkoutPayload,
            items: cart,
            delivery_fee: deliveryFee,
            discount,
          };
      const data = await api.post("/storefront/checkout", requestBody);
      const successPayload = { order: data.order, items: data.items || cart, customer: { full_name: form.full_name, phone: cleanPhone }, checkout: { ...form, shipping_payment_method: shippingTransferMethod } };
      sessionStorage.setItem(`storefront.order.${data.order.invoice_number}`, JSON.stringify(successPayload));
      setProfile({ full_name: form.full_name, primary_phone: cleanPhone });
      clearCart();
      playSuccess();
      navigate(`/shop/success/${encodeURIComponent(data.order.invoice_number)}?phone=${encodeURIComponent(cleanPhone)}`, { state: successPayload });
    } catch (error) {
      toast.error(error.message || "حصلت مشكلة بسيطة، جرب تاني أو كلمنا على واتساب");
    } finally {
      setSubmitting(false);
    }
  };

  if (!cart.length) return <EmptyState title="السلة فاضية" text="اختار منتج الأول وبعدها كمل الدفع" />;

  return (
    <section className="mx-auto max-w-7xl overflow-x-hidden px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-4 md:pb-8 md:pt-7">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">Checkout</p>
          <h1 className="text-3xl font-black md:text-4xl">إتمام الطلب</h1>
          <p className="mt-2 text-sm font-bold text-stone-500">خطوة واحدة، بيانات واضحة، والأوردر يدخل التجهيز فورًا.</p>
        </div>
        <TrustPills compact />
      </div>
      <CheckoutProgress />
      <form id="storefront-checkout-form" noValidate onSubmit={submit} className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-3">
          <CheckoutSection number="1" title="بيانات العميل">
            <div className="grid gap-2.5 md:grid-cols-2">
              <Field label="الاسم بالكامل" placeholder="اكتب اسمك بالكامل" value={form.full_name} onChange={(v) => setField("full_name", v)} required error={errors.full_name} />
              <Field label="رقم الموبايل الأساسي" placeholder="01012345678" value={form.primary_phone} onChange={(v) => setField("primary_phone", v)} required error={errors.primary_phone} inputMode="tel" />
              <Field label="رقم إضافي اختياري" placeholder="رقم بديل للتواصل" value={form.secondary_phone} onChange={(v) => setField("secondary_phone", v)} inputMode="tel" />
            </div>
          </CheckoutSection>
          <CheckoutSection number="2" title="عنوان التوصيل" note="اكتب العنوان بالتفصيل عشان المندوب يوصلك بسرعة">
            <div className="grid gap-2.5 md:grid-cols-2">
              <SelectField label="المحافظة" value={form.governorate} onChange={setGovernorate} options={governorates} required error={errors.governorate} />
              <CityAreaField governorate={form.governorate} options={cityAreaOptions} value={form.city_area} onChange={setCityArea} manual={manualCityArea} onManualChange={(value) => setField("city_area", value)} required error={errors.city_area} />
              <TextField label="العنوان التفصيلي" placeholder="الشارع، رقم العمارة، الدور، الشقة" value={form.detailed_address} onChange={(v) => setField("detailed_address", v)} required error={errors.detailed_address} />
              <Field label="علامة مميزة" placeholder="بجوار..." value={form.landmark} onChange={(v) => setField("landmark", v)} />
              <TextField label="ملاحظات التوصيل" placeholder="أي وقت مناسب أو ملاحظة للمندوب" value={form.delivery_notes} onChange={(v) => setField("delivery_notes", v)} />
            </div>
          </CheckoutSection>
          <CheckoutSection number="3" title="طريقة الدفع">
            <div className="grid gap-2.5 md:grid-cols-2">
              {paymentMethods.map((method) => {
                const methodEnabled = method.id !== "cod" || codAvailable;
                return (
                <button key={method.id} type="button" disabled={!methodEnabled} onClick={() => methodEnabled && setField("payment_method", method.id)} className={`group min-h-28 rounded-[1.35rem] border p-4 text-right transition duration-200 active:scale-[0.985] ${form.payment_method === method.id ? "border-[#7c3aed] bg-[#f5f3ff] shadow-[0_18px_46px_rgba(109,40,217,0.18)] ring-4 ring-[#7c3aed]/10" : "border-stone-200 bg-white shadow-[0_8px_24px_rgba(39,20,75,0.04)] hover:-translate-y-0.5 hover:border-[#7c3aed]/50 hover:shadow-[0_18px_42px_rgba(39,20,75,0.08)]"} disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 disabled:shadow-none`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black">{method.title}</span>
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition ${form.payment_method === method.id ? "border-[#7c3aed] bg-[#7c3aed] text-white" : "border-stone-300 bg-white text-transparent"}`}><Check className="h-3.5 w-3.5" /></span>
                  </span>
                  <span className={`mt-2 block text-xs font-bold leading-5 ${form.payment_method === method.id ? "text-stone-700" : "text-stone-500"}`}>{method.text}</span>
                  {method.id === "cod" && !codAvailable ? (
                    <span className="mt-2 block rounded-2xl bg-amber-50 px-3 py-2 text-xs font-black leading-5 text-amber-700">الدفع عند الاستلام متاح للعملاء الحاليين ومحافظة دمياط فقط</span>
                  ) : null}
                </button>
                );
              })}
            </div>
            {errors.payment_method ? <p className="mt-2 text-xs font-black text-rose-600">{errors.payment_method}</p> : null}
            {paymentCopy ? <p className="mt-2.5 rounded-2xl border border-stone-100 bg-stone-50/80 p-3 text-sm font-bold text-stone-600">{paymentCopy}</p> : null}
            {isShippingConfirmation ? (
              <div className="mt-4 overflow-hidden rounded-[1.7rem] bg-[#070812] p-4 text-white shadow-[0_24px_70px_rgba(16,8,38,0.34)] ring-1 ring-white/10 md:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-semibold text-[#c4b5fd]">تأكيد التحويل</div>
                    <div className="mt-1 text-2xl font-black tracking-tight text-white">{money(deliveryFee)}</div>
                    <p className="mt-1 max-w-md text-xs font-semibold leading-5 text-white/55">حوّل رسوم الشحن من اختيارك، ثم ارفع صورة الإيصال لتأكيد الطلب.</p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-xs font-bold text-white/70 ring-1 ring-white/10">
                    <ShieldCheck className="h-4 w-4 text-[#c4b5fd]" />
                    دفع آمن
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-[1.25rem] bg-white/[0.045] p-1.5 ring-1 ring-white/10">
                  <PaymentMethodTab method="instapay" active={shippingTransferMethod === "instapay"} onClick={() => setShippingTransferMethod("instapay")} />
                  <PaymentMethodTab method="vodafone_cash" active={shippingTransferMethod === "vodafone_cash"} onClick={() => setShippingTransferMethod("vodafone_cash")} />
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[0.92fr_1.08fr]">
                  <div className="rounded-[1.45rem] bg-white/[0.055] p-4 text-center ring-1 ring-white/10">
                    <div className="mx-auto grid h-32 w-32 place-items-center rounded-[1.35rem] bg-white/[0.075] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_40px_rgba(124,58,237,0.14)] ring-1 ring-white/10">
                      <QrCode className="h-11 w-11 text-[#c4b5fd]" strokeWidth={1.8} />
                    </div>
                    <div className="mt-3 text-sm font-bold text-white">QR الدفع غير متاح حاليا</div>
                    <p className="mt-1 text-xs font-medium leading-5 text-white/48">استخدم بيانات التحويل بالأسفل، وسنراجع الإيصال قبل تجهيز الطلب.</p>
                  </div>
                  <div className="grid content-start gap-3">
                    {shippingTransferMethod === "instapay" ? (
                      <PaymentCopyLine method="instapay" label="InstaPay" value={INSTA_PAY_HANDLE} />
                    ) : (
                      <PaymentCopyLine method="vodafone_cash" label="Vodafone Cash" value={VODAFONE_CASH_NUMBER} />
                    )}
                    <label className={`group block cursor-pointer rounded-[1.45rem] bg-white/[0.055] p-4 transition ring-1 ${errors.shipping_payment_screenshot ? "ring-rose-400/50" : "ring-white/10 hover:bg-white/[0.075] hover:ring-[#a78bfa]/30"}`}>
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handlePaymentProofChange(event.target.files?.[0])} className="sr-only" />
                      <span className="flex items-center gap-3 text-right">
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#7c3aed]/16 text-[#c4b5fd] ring-1 ring-[#a78bfa]/20 transition group-hover:scale-[1.03]">
                          <Upload className="h-5 w-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-white">{shippingPaymentFile ? "تم اختيار صورة التحويل" : "ارفع صورة التحويل"}</span>
                          <span className="mt-1 block text-xs font-medium leading-5 text-white/52">PNG أو JPG أو WEBP من إيصال InstaPay أو Vodafone Cash</span>
                        </span>
                      </span>
                      {shippingPaymentPreviewUrl ? (
                        <img src={shippingPaymentPreviewUrl} alt="Shipping payment proof preview" className="mt-4 max-h-48 w-full rounded-2xl bg-black/25 object-contain ring-1 ring-white/10" decoding="async" />
                      ) : null}
                    </label>
                    {errors.shipping_payment_screenshot ? <span className="text-xs font-bold text-rose-200">{errors.shipping_payment_screenshot}</span> : null}
                  </div>
                </div>
                <p className="mt-3 rounded-2xl bg-white/[0.055] px-3 py-2 text-xs font-semibold text-white/58 ring-1 ring-white/8">رسوم الشحن تُخصم من إجمالي الطلب.</p>
              </div>
            ) : null}
            <div className="mt-2.5 grid gap-2.5 md:grid-cols-2">
              <Field label="كوبون الخصم" placeholder="لو معاك كود خصم" value={form.coupon} onChange={(v) => setField("coupon", v)} />
              <TextField label="ملاحظات الطلب" placeholder="مقاس بديل أو ملاحظة خاصة" value={form.order_notes} onChange={(v) => setField("order_notes", v)} compact />
            </div>
          </CheckoutSection>
        </div>
        <CheckoutSummary cart={cart} subtotal={subtotal} discount={discount} deliveryFee={deliveryFee} total={total} codAmount={codAmount} governorate={form.governorate} paymentMethod={form.payment_method} open={summaryOpen} setOpen={setSummaryOpen} submitting={submitting} submitDisabled={submitDisabled} />
      </form>
      <div className="fixed bottom-[61px] left-0 right-0 z-30 border-t border-stone-200 bg-white/96 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-18px_50px_rgba(39,20,75,0.10)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <button type="button" onClick={() => setSummaryOpen((value) => !value)} className="min-h-13 flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-3 text-right text-sm font-black">الإجمالي: {money(total)}</button>
          <SubmitButton submitting={submitting} compact paymentMethod={form.payment_method} disabled={submitDisabled} />
        </div>
      </div>
    </section>
  );
}

function LegacyCheckoutPage({ cart, clearCart, profile, setProfile }) {
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
    payment_method: "cod",
    coupon: "",
    order_notes: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryFee = form.governorate ? 60 : 0;
  const total = subtotal + deliveryFee;

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!/^01[0-9]{9}$/.test(form.primary_phone.replace(/\s/g, ""))) {
      toast.error("اكتب رقم موبايل مصري صحيح");
      return;
    }
    setSubmitting(true);
    try {
      const data = await api.post("/storefront/checkout", {
        checkout: { ...form, delivery_fee: deliveryFee },
        items: cart,
        delivery_fee: deliveryFee,
      });
      setProfile({ full_name: form.full_name, primary_phone: form.primary_phone });
      clearCart();
      playSuccess();
      navigate(`/shop/success/${encodeURIComponent(data.order.invoice_number)}?phone=${encodeURIComponent(form.primary_phone)}`);
    } catch (error) {
      toast.error(error.message || "حصلت مشكلة بسيطة، جرب تاني أو كلمنا على واتساب");
    } finally {
      setSubmitting(false);
    }
  };

  if (!cart.length) return <EmptyState title="السلة فاضية" text="اختار منتج الأول وبعدها كمل الدفع" />;

  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-3xl font-black">إتمام الطلب</h1>
      <form onSubmit={submit} className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="rounded-3xl border border-stone-200 bg-white p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="الاسم بالكامل" value={form.full_name} onChange={(v) => setField("full_name", v)} required />
            <Field label="رقم الموبايل الأساسي" value={form.primary_phone} onChange={(v) => setField("primary_phone", v)} required />
            <Field label="رقم إضافي اختياري" value={form.secondary_phone} onChange={(v) => setField("secondary_phone", v)} />
            <SelectField label="المحافظة" value={form.governorate} onChange={(v) => setField("governorate", v)} options={["القاهرة", "الجيزة", "الإسكندرية", "الدقهلية", "الشرقية", "الغربية", "المنوفية", "القليوبية", "أسيوط", "سوهاج"]} required />
            <Field label="المدينة / المنطقة" value={form.city_area} onChange={(v) => setField("city_area", v)} required />
            <Field label="علامة مميزة" value={form.landmark} onChange={(v) => setField("landmark", v)} />
            <TextField label="العنوان بالتفصيل" value={form.detailed_address} onChange={(v) => setField("detailed_address", v)} required />
            <TextField label="ملاحظات التوصيل" value={form.delivery_notes} onChange={(v) => setField("delivery_notes", v)} />
            <SelectField label="طريقة الدفع" value={form.payment_method} onChange={(v) => setField("payment_method", v)} options={["cod", "cash"]} labels={{ cod: "الدفع عند الاستلام", cash: "كاش عند الاستلام" }} required />
            <Field label="كوبون" value={form.coupon} onChange={(v) => setField("coupon", v)} />
            <TextField label="ملاحظات الطلب" value={form.order_notes} onChange={(v) => setField("order_notes", v)} />
          </div>
        </div>
        <aside className="h-max rounded-3xl border border-stone-200 bg-white p-5">
          <h2 className="text-xl font-black">طلبك</h2>
          <div className="mt-4 space-y-3">
            {cart.map((item) => (
              <div key={item.lineId} className="flex items-center gap-3">
                <img src={imageFor(item.image_url)} alt="" className="h-14 w-14 rounded-2xl object-cover" loading="lazy" decoding="async" width="56" height="56" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black">{item.name}</div>
                  <div className="text-xs font-bold text-stone-500">{item.quantity} أ— {item.size}</div>
                </div>
                <div className="text-sm font-black">{money(item.price * item.quantity)}</div>
              </div>
            ))}
          </div>
          <SummaryRow label="المنتجات" value={money(subtotal)} />
          <SummaryRow label="الشحن" value={form.governorate ? money(deliveryFee) : "اختار المحافظة"} />
          <SummaryRow label="المطلوب عند الاستلام" value={money(total)} strong />
          <p className="mt-3 text-sm font-bold text-stone-500">التوصيل المتوقع من 2 إلى 5 أيام عمل حسب المحافظة.</p>
          <button disabled={submitting} className="mt-5 w-full rounded-full bg-stone-950 px-5 py-4 font-black text-white disabled:bg-stone-300">
            {submitting ? "جاري تأكيد الطلب..." : "تأكيد الطلب"}
          </button>
        </aside>
      </form>
    </section>
  );
}

function OrderSuccess({ profile }) {
  const { orderNumber } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const decodedOrderNumber = decodeURIComponent(orderNumber || "");
  const phone = params.get("phone") || profile.primary_phone || location.state?.customer?.phone || "";
  const message = useMemo(() => SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)], []);
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
      .catch(() => {});
  }, [decodedOrderNumber, phone, loaded?.order]);

  const order = loaded?.order || {};
  const items = loaded?.items || [];
  const customerName = order.customer_name || loaded?.customer?.full_name || profile.full_name || "عميلنا العزيز";
  const total = order.total_amount || order.total || order.total_price || 0;
  const address = [order.governorate, order.city_area, order.customer_address || loaded?.checkout?.detailed_address].filter(Boolean).join(" - ");
  const paymentLabel = paymentMethods.find((method) => method.id === (order.payment_method || loaded?.checkout?.payment_method))?.title || "الدفع عند الاستلام";
  const isShippingAwaitingVerification =
    (order.payment_method || loaded?.checkout?.payment_method) === "shipping_confirmation" ||
    order.payment_status === "awaiting_verification" ||
    order.status === "awaiting_verification";
  const successTitle = isShippingAwaitingVerification ? "تم استلام طلبك وإثبات التحويل" : "تم تأكيد طلبك بنجاح";
  const successSubtitle = isShippingAwaitingVerification
    ? "تم استلام طلبك وإثبات التحويل، سيتم مراجعته والتأكيد قريبًا"
    : "طلبك دخل مرحلة التجهيز الآن";
  const successStatus = isShippingAwaitingVerification ? "بانتظار مراجعة التحويل" : (order.status || "pending");
  const whatsAppHref = whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(`مرحبًا، أريد متابعة طلبي رقم ${decodedOrderNumber}`)}` : "";

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-6 md:py-10">
      {confetti ? <Confetti /> : null}
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto grid h-24 w-24 animate-[success-pop_650ms_ease-out] place-items-center rounded-full bg-emerald-100 text-emerald-700 shadow-[0_20px_45px_rgba(16,185,129,0.18)]">
          <Check className="h-12 w-12" />
        </div>
        <h1 className="mt-6 text-3xl font-black md:text-4xl">{successTitle}</h1>
        <p className="mt-2 text-lg font-bold text-stone-600">شكراً لثقتك فينا</p>
        <p className="mt-1 text-sm font-bold text-stone-500">{successSubtitle}</p>
        <div className="mt-5 inline-flex rounded-full bg-[#f5f3ff] px-4 py-2 text-sm font-black text-[#6d28d9]">{message}</div>
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoBox label="رقم الطلب" value={decodedOrderNumber} />
              <InfoBox label="العميل" value={customerName} />
              <InfoBox label="الإجمالي" value={total ? money(total) : "تم تسجيل الطلب"} />
              <InfoBox label="طريقة الدفع" value={paymentLabel} />
              <InfoBox label="حالة الطلب" value={successStatus} />
              <InfoBox label="التوصيل المتوقع" value="من 2 إلى 5 أيام عمل" />
            </div>
            <div className="mt-4 rounded-2xl bg-stone-50 p-4 text-right">
              <div className="text-xs font-black text-stone-500">عنوان التوصيل</div>
              <div className="mt-1 font-black">{address || "العنوان محفوظ مع الطلب"}</div>
            </div>
          </div>
          <div className="rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:p-6">
            <h2 className="text-xl font-black">متابعة الطلب</h2>
            <SuccessTimeline />
          </div>
          <OrderInvoiceCard order={{ ...order, source: "Website" }} items={items} />
        </div>
        <aside className="h-max rounded-[2rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] lg:sticky lg:top-24">
          <div className="grid gap-3">
            <Link to={`/shop/track?order=${encodeURIComponent(decodedOrderNumber)}&phone=${encodeURIComponent(phone)}`} className="rounded-full bg-stone-950 px-5 py-4 text-center font-black text-white transition hover:bg-[#6d28d9]">تتبع الطلب</Link>
            <Link to="/shop/products" className="rounded-full border border-stone-300 px-5 py-4 text-center font-black transition hover:border-[#7c3aed] hover:text-[#6d28d9]">كمل تسوق</Link>
            {whatsAppHref ? <a href={whatsAppHref} className="rounded-full border border-emerald-200 bg-emerald-50 px-5 py-4 text-center font-black text-emerald-700">كلمنا على واتساب</a> : <button disabled className="rounded-full border border-stone-200 bg-stone-100 px-5 py-4 font-black text-stone-400">واتساب غير متاح حاليًا</button>}
          </div>
          <div className="mt-5 rounded-2xl bg-[#f5f3ff] p-4 text-sm font-bold leading-6 text-stone-700">هنراجع الطلب ونجهزه، ولو محتاجين تأكيد بيانات هنتواصل معاك على رقم الموبايل.</div>
        </aside>
      </div>
      {products.length ? (
        <div className="mt-6">
          <ProductRail title="وصل حديثًا" subtitle="منتجات قد تعجبك" products={products} loading={false} railType="new" wishlist={[]} toggleWishlist={() => {}} addToCart={() => {}} />
        </div>
      ) : null}
    </section>
  );
}

function LegacyOrderSuccess({ profile }) {
  const { orderNumber } = useParams();
  const [params] = useSearchParams();
  const phone = params.get("phone") || profile.primary_phone || "";
  const message = useMemo(() => SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)], []);
  const [confetti, setConfetti] = useState(true);

  useEffect(() => {
    playSuccess();
    const timer = setTimeout(() => setConfetti(false), 2200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section className="relative mx-auto max-w-3xl px-4 py-10 text-center">
      {confetti ? <Confetti /> : null}
      <div className="rounded-[2rem] border border-stone-200 bg-white p-8 shadow-xl">
        <div className="mx-auto grid h-24 w-24 animate-[success-pop_650ms_ease-out] place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <Check className="h-12 w-12" />
        </div>
        <h1 className="mt-6 text-3xl font-black">تم تأكيد طلبك بنجاح</h1>
        <p className="mt-2 text-lg font-bold text-stone-600">شكرا لثقتك فينا</p>
        <p className="mt-1 text-sm font-bold text-stone-500">طلبك دخل مرحلة التجهيز الآن</p>
        <div className="mt-5 rounded-3xl bg-stone-100 p-4">
          <div className="text-sm font-bold text-stone-500">{message}</div>
          <div className="mt-2 text-2xl font-black">{decodeURIComponent(orderNumber)}</div>
          <div className="mt-2 text-sm font-bold text-stone-500">{profile.full_name || "Online Customer"}</div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Link to={`/shop/track?order_number=${encodeURIComponent(orderNumber)}&phone=${encodeURIComponent(phone)}`} className="rounded-full bg-stone-950 px-5 py-3 font-black text-white">تتبع الطلب</Link>
          <Link to="/shop/products" className="rounded-full border border-stone-300 px-5 py-3 font-black">كمل تسوق</Link>
          <a href="https://wa.me/" className="rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 font-black text-emerald-700">دعم واتساب</a>
        </div>
      </div>
    </section>
  );
}

const statusCopy = (value = "") => {
  const key = String(value || "pending").toLowerCase();
  const labels = {
    pending: "جاري المراجعة",
    confirmed: "تم التأكيد",
    processing: "جاري التجهيز",
    packed: "جاهز للشحن",
    shipped: "خرج للشحن",
    in_transit: "في الطريق",
    out_for_delivery: "خارج للتسليم",
    delivered: "تم التسليم",
    cancelled: "ملغي",
    canceled: "ملغي",
    unpaid: "غير مدفوع",
    paid: "مدفوع",
    awaiting_verification: "بانتظار مراجعة التحويل",
    shipping_confirmation: "تأكيد الشحن",
    shipping_paid: "تم دفع الشحن",
    manual: "توصيل يدوي",
  };
  return labels[key] || value || "قيد المراجعة";
};

const paymentCopy = (value = "") => paymentMethods.find((method) => method.id === value)?.title || statusCopy(value || "cod");
const shippingProviderCopy = (value = "") => ({ manual: "توصيل يدوي", bosta: "Bosta", mylerz: "Mylerz", aramex: "Aramex" }[String(value || "").toLowerCase()] || value || "قريبًا");
const formatDate = (value) => {
  if (!value) return "قريبًا";
  try {
    return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
};
const supportHref = (orderNumber = "") => {
  const text = orderNumber ? `مرحبًا، محتاج مساعدة في طلب رقم ${orderNumber}` : "مرحبًا، محتاج مساعدة في طلب من الموقع";
  return whatsappPhone ? `https://wa.me/${whatsappPhone}?text=${encodeURIComponent(text)}` : "https://wa.me/";
};

function OrderTimeline({ timeline = [] }) {
  const steps = timeline.length ? timeline : statusLabels.map((label, index) => ({ label, done: index === 0 }));
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step.key || step.label} className={`rounded-2xl border p-3 ${step.done ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-stone-50"}`}>
          <div className={`mb-2 grid h-9 w-9 place-items-center rounded-full ${step.done ? "bg-emerald-600 text-white" : "bg-stone-200 text-stone-500"}`}>
            {step.done ? <Check className="h-4 w-4" /> : index + 1}
          </div>
          <div className="text-xs font-black leading-5">{step.label}</div>
        </div>
      ))}
    </div>
  );
}

function OrderItemsSummary({ items = [] }) {
  if (!items.length) return <p className="mt-4 rounded-2xl bg-stone-50 p-4 font-bold text-stone-500">ملخص المنتجات هيظهر هنا بعد تحميل تفاصيل الطلب.</p>;
  return (
    <div className="mt-5 space-y-3">
      <h3 className="text-lg font-black">ملخص المنتجات</h3>
      {items.map((item) => (
        <div key={item.id || `${item.product_id}-${item.variant_id}`} className="flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3">
          <img src={imageFor(item.product_image || item.image_url)} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" loading="lazy" decoding="async" width="56" height="56" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-black">{item.product_name || item.name}</div>
            <div className="text-xs font-bold text-stone-500">{item.color || "لون"} / {item.size || "مقاس"} أ— {item.quantity}</div>
          </div>
          <div className="shrink-0 font-black">{money(item.total_amount || Number(item.price || item.sale_price || 0) * Number(item.quantity || 1))}</div>
        </div>
      ))}
    </div>
  );
}

function TrackOrder() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({ order_number: params.get("order_number") || params.get("order") || "", phone: params.get("phone") || "" });
  const [state, setState] = useState({ loading: false, data: null, error: "" });
  const hasOrderFromQuery = Boolean(params.get("order") || params.get("order_number"));

  const submit = async (event) => {
    event?.preventDefault();
    if (!form.order_number.trim()) {
      setState({ loading: false, data: null, error: "اكتب رقم الطلب الأول" });
      return;
    }
    setState({ loading: true, data: null, error: "" });
    try {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(form.order_number)}&phone=${encodeURIComponent(form.phone)}`);
      setState({ loading: false, data, error: "" });
    } catch (error) {
      setState({ loading: false, data: null, error: error.message });
    }
  };

  useEffect(() => {
    if (form.order_number && (form.phone || hasOrderFromQuery)) submit();
  }, []);

  return (
    <section className="mx-auto max-w-6xl px-4 py-5 md:py-8">
      <div className="rounded-[2rem] bg-stone-950 p-5 text-white shadow-[0_24px_70px_rgba(39,20,75,0.18)] md:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black text-emerald-200">طلبك في السكة</p>
            <h1 className="mt-2 text-3xl font-black md:text-5xl">تتبع الطلب</h1>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-stone-300">اكتب رقم الطلب والموبايل، أو افتح رابط التتبع المباشر من رسالة تأكيد الطلب.</p>
          </div>
          <a href={supportHref(form.order_number)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-black text-white">
            <MessageCircle className="h-5 w-5" />
            محتاج مساعدة؟ كلمنا على واتساب
          </a>
        </div>
      </div>
      <form onSubmit={submit} className="mt-5 grid gap-3 rounded-[1.7rem] border border-stone-200 bg-white p-4 shadow-[0_18px_50px_rgba(39,20,75,0.07)] md:grid-cols-[1fr_1fr_auto] md:p-5">
        <Field label="رقم الطلب" value={form.order_number} onChange={(v) => setForm((prev) => ({ ...prev, order_number: v }))} required />
        <Field label="رقم الموبايل" value={form.phone} onChange={(v) => setForm((prev) => ({ ...prev, phone: v }))} inputMode="tel" />
        <button disabled={state.loading} className="min-h-13 self-end rounded-full bg-stone-950 px-7 py-4 font-black text-white transition hover:bg-[#6d28d9] disabled:bg-stone-300">تتبع الطلب</button>
      </form>
      {state.loading ? <div className="mt-5 h-32 animate-pulse rounded-3xl bg-white" /> : null}
      {!state.loading && !state.data && !state.error ? <EmptyState title="جاهزين نطمنك" text="رقم الطلب وحالة الشحن هتظهر هنا بعد البحث." /> : null}
      {state.error ? <EmptyState title="مش لاقيين الطلب" text="راجع رقم الطلب والموبايل أو كلمنا على واتساب ونساعدك فورًا." /> : null}
      {state.data ? <TrackingResult data={state.data} /> : null}
    </section>
  );
}

function TrackingResult({ data }) {
  const order = data.order || {};
  const items = data.items || [];
  const timeline = data.timeline || statusLabels.map((label, index) => ({ label, done: index === 0 }));
  const total = order.total_amount || order.total || order.total_price || 0;
  const address = [order.governorate, order.city_area, order.customer_address, order.landmark].filter(Boolean).join(" - ");
  return (
    <div className="mt-5 overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-[0_18px_50px_rgba(39,20,75,0.07)]">
      <div className="border-b border-stone-100 p-5 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-stone-500">رقم الطلب</div>
            <div className="text-2xl font-black">{order.invoice_number}</div>
          </div>
          <span className="rounded-full bg-stone-950 px-4 py-2 text-sm font-black text-white">{statusCopy(order.status || order.shipping_status || "pending")}</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <InfoBox label="العميل" value={order.customer_name || "عميلنا العزيز"} />
          <InfoBox label="تاريخ الطلب" value={formatDate(order.created_at)} />
          <InfoBox label="الإجمالي" value={money(total)} />
          <InfoBox label="الدفع" value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status || "pending")}`} />
          <InfoBox label="شركة الشحن" value={shippingProviderCopy(order.shipping_provider)} />
          <InfoBox label="رقم التتبع" value={order.tracking_number || "قريبًا"} />
          <InfoBox label="حالة الشحن" value={statusCopy(order.shipping_status || "pending")} />
          <InfoBox label="العنوان" value={address || "العنوان محفوظ مع الطلب"} />
        </div>
      </div>
      <div className="p-5 md:p-6">
        <h2 className="text-xl font-black">متابعة الطلب</h2>
        <OrderTimeline timeline={timeline} />
        <OrderItemsSummary items={items} />
        <a href={supportHref(order.invoice_number)} className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-3 font-black text-white">
          <MessageCircle className="h-5 w-5" />
          محتاج مساعدة؟ كلمنا على واتساب
        </a>
      </div>
    </div>
  );
}

function AnimatedPoints({ value }) {
  const [display, setDisplay] = useState(Number(value || 0));

  useEffect(() => {
    const start = Number(display || 0);
    const end = Number(value || 0);
    if (start === end) return undefined;
    const startedAt = performance.now();
    const duration = 700;
    let frame = 0;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return Number(display || 0).toLocaleString("ar-EG-u-nu-latn");
}

function LoyaltyWidget({ loyalty, loading }) {
  if (loading && !loyalty) {
    return (
      <div className="mt-4 overflow-hidden rounded-[1.35rem] border border-stone-200 bg-stone-50 p-4">
        <div className="h-4 w-24 animate-pulse rounded-full bg-stone-200" />
        <div className="mt-4 h-10 w-36 animate-pulse rounded-xl bg-stone-200" />
        <div className="mt-4 h-2 w-full animate-pulse rounded-full bg-stone-200" />
      </div>
    );
  }

  const points = Number(loyalty?.points ?? loyalty?.available_points ?? 0);
  const tier = loyalty?.tier || "Bronze";
  const nextTier = loyalty?.next_tier || "Platinum";
  const remaining = Number(loyalty?.points_to_next_tier || 0);
  const progress = Math.max(0, Math.min(100, Number(loyalty?.progress || 0)));

  return (
    <div className="mt-4 overflow-hidden rounded-[1.35rem] border border-[#7c3aed]/20 bg-[#faf7ff] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#6d28d9] shadow-sm">
            <Gem className="h-5 w-5" />
          </span>
          <div>
            <div className="text-xs font-black text-stone-500">رصيد الولاء</div>
            <div className="text-2xl font-black text-stone-950"><AnimatedPoints value={points} /> نقطة</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-stone-950 px-3 py-1.5 text-xs font-black text-white">
          <Crown className="h-3.5 w-3.5 text-amber-300" />
          {tier}
        </span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-[#7c3aed] transition-all duration-700" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-black text-stone-600">
        <span>{remaining > 0 ? `${remaining.toLocaleString("ar-EG-u-nu-latn")} نقطة للترقية إلى ${nextTier}` : "وصلت لأعلى مستوى"}</span>
        <span>{Math.round(progress)}%</span>
      </div>
    </div>
  );
}

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
      toast.error(error.message || "مش قادرين نفتح الحساب دلوقتي");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!account || !phone) return undefined;
    const id = window.setInterval(() => {
      api.get(`/storefront/account?phone=${encodeURIComponent(phone)}`)
        .then((data) => setAccount(data))
        .catch(() => {});
    }, 10000);
    return () => window.clearInterval(id);
  }, [account, phone]);

  const openOrder = async (order) => {
    setSelectedOrder({ loading: true, order, items: [], timeline: [] });
    try {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(order.invoice_number)}&phone=${encodeURIComponent(phone)}`);
      setSelectedOrder(data);
    } catch {
      setSelectedOrder({ order, items: [], timeline: [] });
    }
  };

  const reorder = async (order) => {
    const sourceItems = order.items || selectedOrder?.items || [];
    let items = sourceItems;
    if (!items.length) {
      const data = await api.get(`/storefront/track?order_number=${encodeURIComponent(order.invoice_number)}&phone=${encodeURIComponent(phone)}`);
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
    if (added) toast.success(skipped ? "ضفنا المتاح للسلة، وفي اختيارات مش متاحة حاليًا" : "ضفنا الطلب للسلة تاني");
    else toast.error("المنتجات دي مش متاحة حاليًا، جرب اختيارات تانية");
  };

  const orders = account?.orders || [];
  const addresses = account?.addresses || [];
  const backendWishlist = account?.wishlist_products || [];
  const backendRecent = account?.recent_products || [];

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">حساب خفيف بالموبايل</p>
          <h1 className="text-3xl font-black md:text-5xl">حسابي</h1>
        </div>
        <Link to="/shop/track" className="inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 font-black">تتبع طلب</Link>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="h-max rounded-[1.7rem] border border-stone-200 bg-white p-5 shadow-[0_18px_50px_rgba(39,20,75,0.07)] lg:sticky lg:top-24">
          <Field label="رقم الموبايل" value={phone} onChange={setPhone} inputMode="tel" />
          <button onClick={load} disabled={loading} className="mt-3 min-h-12 w-full rounded-full bg-stone-950 px-5 py-3 font-black text-white disabled:bg-stone-300">{loading ? "جاري التحميل..." : "عرض بياناتي"}</button>
          <InfoBox label="بياناتي" value={account?.customer?.name || profile.full_name || "اكتب رقمك لعرض الحساب"} />
          <LoyaltyWidget loyalty={account?.loyalty} loading={loading} />
        </div>
        <div className="space-y-5">
          <Panel title="طلباتي">
            {orders.length ? orders.map((order) => (
              <div key={order.id} className="rounded-2xl bg-stone-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-black">{order.invoice_number}</div>
                    <div className="mt-1 text-xs font-bold text-stone-500">{formatDate(order.created_at)} - {statusCopy(order.status)}</div>
                  </div>
                  <div className="font-black">{money(order.total_amount || order.total || order.total_price)}</div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <button onClick={() => openOrder(order)} className="min-h-11 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-black">تفاصيل الطلب</button>
                  <Link to={`/shop/track?order=${encodeURIComponent(order.invoice_number)}&phone=${encodeURIComponent(phone)}`} className="min-h-11 rounded-full bg-stone-950 px-4 py-2 text-center text-sm font-black text-white">تتبع الطلب</Link>
                  <button onClick={() => reorder(order)} className="min-h-11 rounded-full border border-[#7c3aed]/30 bg-[#f5f3ff] px-4 py-2 text-sm font-black text-[#6d28d9]">إعادة الطلب</button>
                </div>
              </div>
            )) : <p className="font-bold text-stone-500">لسه مفيش طلبات هنا</p>}
          </Panel>
          {selectedOrder ? <CustomerOrderDetails data={selectedOrder} phone={phone} onReorder={reorder} /> : null}
          <Panel title="عناويني">
            {addresses.length ? addresses.map((address) => <div key={address} className="rounded-2xl bg-stone-50 p-3 font-bold text-stone-700">{address}</div>) : <p className="font-bold text-stone-500">العناوين اللي استخدمتها في الطلبات هتظهر هنا</p>}
          </Panel>
          <Panel title="المفضلة">
            <SmallProductList items={backendWishlist.length ? backendWishlist : wishlist} empty="احفظ المنتجات اللي عجبتك هنا" />
          </Panel>
          <Panel title="شوهد مؤخرًا">
            <SmallProductList items={backendRecent.length ? backendRecent : recent} empty="آخر المنتجات اللي شوفتها هتظهر هنا" />
          </Panel>
        </div>
      </div>
    </section>
  );
}

function CustomerOrderDetails({ data, phone, onReorder }) {
  const order = data.order || {};
  if (data.loading) return <div className="h-40 animate-pulse rounded-3xl bg-white" />;
  return (
    <Panel title="تفاصيل الطلب">
      <div className="grid gap-3 md:grid-cols-3">
        <InfoBox label="حالة الطلب" value={statusCopy(order.status)} />
        <InfoBox label="الدفع" value={`${paymentCopy(order.payment_method)} - ${statusCopy(order.payment_status)}`} />
        <InfoBox label="الشحن" value={`${shippingProviderCopy(order.shipping_provider)} - ${statusCopy(order.shipping_status)}`} />
      </div>
      <OrderTimeline timeline={data.timeline || []} />
      <OrderItemsSummary items={data.items || []} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Link to={`/shop/track?order=${encodeURIComponent(order.invoice_number)}&phone=${encodeURIComponent(phone)}`} className="min-h-12 rounded-full bg-stone-950 px-5 py-3 text-center font-black text-white">تتبع الطلب</Link>
        <button onClick={() => onReorder({ ...order, items: data.items || [] })} className="min-h-12 rounded-full border border-[#7c3aed]/30 bg-[#f5f3ff] px-5 py-3 font-black text-[#6d28d9]">إعادة الطلب</button>
        <a href={supportHref(order.invoice_number)} className="min-h-12 rounded-full border border-emerald-200 bg-emerald-50 px-5 py-3 text-center font-black text-emerald-700">واتساب</a>
      </div>
    </Panel>
  );
}

function WishlistPage({ wishlist, toggleWishlist, addToCart }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">اختياراتك المفضلة محفوظة هنا</p>
          <h1 className="text-3xl font-black md:text-5xl">المفضلة</h1>
        </div>
        <div className="rounded-full bg-white px-4 py-2 text-sm font-black text-stone-600">{wishlist.length} منتج</div>
      </div>
      {wishlist.length ? (
        <>
          <SmallProductGrid items={wishlist} action={toggleWishlist} addToCart={addToCart} />
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-stone-200 bg-white p-4">
              <div className="font-black">تنبيه انخفاض السعر</div>
              <p className="mt-1 text-sm font-bold text-stone-500">قريبًا هنبلغك لما سعر منتج في المفضلة ينزل.</p>
            </div>
            <div className="rounded-3xl border border-stone-200 bg-white p-4">
              <div className="font-black">تنبيه الرجوع للمخزون</div>
              <p className="mt-1 text-sm font-bold text-stone-500">قريبًا هنبلغك لما مقاسك يرجع تاني.</p>
            </div>
          </div>
        </>
      ) : <EmptyState title="المفضلة فاضية" text="احفظ المنتجات اللي عجبتك هنا" />}
    </section>
  );
}

function RecentPage({ recent }) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-black text-[#6d28d9]">آخر 20 منتج</p>
          <h1 className="text-3xl font-black md:text-5xl">شوهد مؤخرًا</h1>
        </div>
        <Link to="/shop/products" className="inline-flex min-h-12 items-center justify-center rounded-full bg-stone-950 px-5 py-3 font-black text-white">كمل تسوق</Link>
      </div>
      {recent.length ? <SmallProductGrid items={recent.slice(0, 20)} /> : <EmptyState title="لسه مفيش منتجات هنا" text="آخر المنتجات اللي شوفتها هتظهر هنا" />}
    </section>
  );
}

function FaqPage() {
  const items = [
    ["مدة التوصيل؟", "غالبا من 2 إلى 5 أيام عمل حسب المحافظة وشركة الشحن."],
    ["طرق الدفع؟", "الدفع عند الاستلام متاح، وبنية الدفع الإلكتروني جاهزة للإضافة."],
    ["الاستبدال والاسترجاع؟", "متاح خلال 14 يوم بالشروط المذكورة في السياسة."],
    ["مساعدة المقاس؟", "استخدم دليل المقاسات أو كلمنا على واتساب."],
    ["تتبع الطلب؟", "من صفحة تتبع الطلب برقم الطلب والموبايل."],
    ["شركات الشحن؟", "النظام جاهز لـ Bosta و Mylerz و Aramex والتوصيل اليدوي."],
  ];
  return <StaticPage title="الأسئلة الشائعة" items={items} />;
}

function ContactPage() {
  return (
    <StaticPage
      title="تواصل معنا"
      items={[
        ["الهاتف", "01000000000"],
        ["واتساب", "اضغط زر الدعم من أي صفحة طلب."],
        ["Instagram", "@store"],
        ["Facebook", "Store page"],
        ["العنوان", "مكان الفرع يظهر هنا."],
        ["مواعيد العمل", "يوميا من 12 ظهرا إلى 11 مساء."],
      ]}
    />
  );
}

function SizeGuide() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-3xl font-black">دليل المقاسات</h1>
      <div className="mt-5 overflow-hidden rounded-3xl border border-stone-200 bg-white">
        <table className="w-full text-center text-sm font-bold">
          <thead className="bg-stone-100"><tr><th className="p-3">EU</th><th>طول القدم</th><th>مناسب لـ</th></tr></thead>
          <tbody>{[39, 40, 41, 42, 43, 44, 45].map((size) => <tr key={size} className="border-t border-stone-200"><td className="p-3 font-black">{size}</td><td>{23 + (size - 36) * 0.6} سم</td><td>أحذية رجالي/حريمي حسب الموديل</td></tr>)}</tbody>
        </table>
      </div>
      <div className="mt-5 rounded-3xl bg-white p-5">
        <h2 className="text-xl font-black">طريقة القياس</h2>
        <p className="mt-2 font-bold leading-7 text-stone-600">قف على ورقة، علم بداية الكعب ونهاية أطول صابع، وقيس المسافة بالسنتيمتر. لو بين مقاسين اختار الأكبر.</p>
        <a href="https://wa.me/" className="mt-4 inline-flex rounded-full bg-emerald-600 px-5 py-3 font-black text-white">مساعدة واتساب</a>
      </div>
    </section>
  );
}

function ReturnsPolicy() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-3xl font-black">سياسة الاستبدال والاسترجاع</h1>
      <div className="mt-5 rounded-3xl border border-stone-200 bg-white p-6 text-lg font-bold leading-9 text-stone-700">
        <p>يسمح بالاستبدال والاسترجاع خلال 14 يوم بشرط عدم الاستخدام والحفاظ على الحالة الأصلية وتقديم أصل الفاتورة.</p>
        <p>لا يسمح باستبدال أو استرجاع الشنط.</p>
        <p>يجب أن يكون المنتج بنفس حالته الأصلية.</p>
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

function CheckoutProgress() {
  const steps = ["السلة", "العنوان", "الدفع", "التأكيد"];
  return (
    <div className="sf-reveal overflow-hidden rounded-[1.35rem] border border-stone-200 bg-white/90 p-2 shadow-[0_12px_34px_rgba(39,20,75,0.05)]">
      <div className="grid grid-cols-4 gap-1 text-center text-[11px] font-black text-stone-500 sm:text-xs">
        {steps.map((step, index) => (
          <div key={step} className={`flex min-h-10 items-center justify-center rounded-2xl px-1 transition ${index <= 2 ? "bg-[#f5f3ff] text-[#6d28d9]" : "bg-stone-950 text-white"}`}>
            <span className="truncate">{index === 3 ? "تم التأكيد" : step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrustPills({ compact = false }) {
  const items = [
    ["بياناتك آمنة", <Check className="h-4 w-4" />],
    ["شحن سريع", <Truck className="h-4 w-4" />],
    ["استبدال خلال 14 يوم", <PackageCheck className="h-4 w-4" />],
    ["دعم واتساب", <MessageCircle className="h-4 w-4" />],
  ];
  return (
    <div className={`grid grid-cols-2 gap-2 text-xs font-black text-stone-600 ${compact ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
      {items.map(([label, icon]) => (
        <span key={label} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-stone-200 bg-white/95 px-3 py-2 shadow-[0_8px_24px_rgba(39,20,75,0.05)]">
          <span className="text-[#6d28d9]">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
      ))}
    </div>
  );
}

function SubmitButton({ submitting, compact = false, paymentMethod = "cod", disabled = submitting }) {
  const label = paymentMethod === "cod" ? "تأكيد الطلب" : "رفع إثبات التحويل وتأكيد الطلب";
  return (
    <button
      form="storefront-checkout-form"
      type="submit"
      disabled={disabled}
      className={`sf-shimmer-button inline-flex items-center justify-center gap-2 rounded-full bg-stone-950 font-black text-white shadow-[0_18px_42px_rgba(39,20,75,0.26)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#6d28d9] hover:shadow-[0_22px_54px_rgba(109,40,217,0.28)] active:translate-y-0 active:scale-[0.985] disabled:translate-y-0 disabled:bg-stone-300 disabled:shadow-none ${compact ? "min-h-13 min-w-36 px-5 py-3 text-sm" : "min-h-14 w-full px-5 py-4"}`}
    >
      {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : null}
      <span>{submitting ? "جاري تأكيد طلبك..." : label}</span>
    </button>
  );
}

function CheckoutSection({ number, title, note, children }) {
  return (
    <section className="sf-reveal rounded-[1.6rem] border border-stone-200 bg-white p-4 shadow-[0_14px_38px_rgba(39,20,75,0.055)] md:p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-950 text-sm font-black text-white shadow-[0_10px_22px_rgba(39,20,75,0.18)]">{number}</span>
        <div>
          <h2 className="text-lg font-black md:text-xl">{title}</h2>
          {note ? <p className="mt-1 text-xs font-bold text-stone-500">{note}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function CheckoutSummary({ cart, subtotal, discount, deliveryFee, total, codAmount, governorate, paymentMethod, open, setOpen, submitting, submitDisabled }) {
  return (
    <aside className="h-max rounded-[1.7rem] border border-stone-200 bg-white p-4 shadow-[0_24px_70px_rgba(39,20,75,0.10)] ring-1 ring-white/80 lg:sticky lg:top-24 md:p-5">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-10 w-full items-center justify-between md:pointer-events-none">
        <span className="text-xl font-black">ملخص الطلب</span>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black md:hidden">{open ? "إخفاء" : "عرض"}</span>
      </button>
      <div className={`${open ? "block" : "hidden"} mt-3 space-y-2.5 md:block`}>
        {cart.map((item) => (
          <div key={item.lineId} className="sf-reveal flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-2.5 ring-1 ring-stone-100/80">
            <img src={imageFor(item.image_url)} alt="" className="h-18 w-18 shrink-0 rounded-2xl object-cover shadow-sm" loading="lazy" decoding="async" width="72" height="72" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black leading-5">{item.name}</div>
              <div className="mt-1 inline-flex rounded-full bg-white px-2 py-1 text-[11px] font-black text-stone-500 ring-1 ring-stone-200">{item.color || "لون"} / {item.size || "مقاس"} أ— {item.quantity}</div>
              <div className="mt-1 text-[11px] font-bold text-stone-400">سعر القطعة {money(item.price)}</div>
            </div>
            <div className="shrink-0 text-sm font-black text-stone-950">{money(item.price * item.quantity)}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-2xl bg-[#faf8f3] p-4 shadow-inner shadow-white">
        <SummaryRow label="المنتجات" value={money(subtotal)} />
        <SummaryRow label="الخصم" value={discount ? `-${money(discount)}` : money(0)} />
        <SummaryRow label="الشحن" value={governorate ? money(deliveryFee) : "اختار المحافظة"} />
        <SummaryRow label="الإجمالي" value={money(total)} strong />
        {codAmount ? <SummaryRow label={paymentMethod === "cod" ? "COD عند الاستلام" : "الباقي عند الاستلام"} value={money(codAmount)} /> : null}
      </div>
      <div className="mt-3 grid gap-2 text-xs font-bold text-stone-500">
        <span className="rounded-2xl bg-emerald-50 px-3 py-2 text-emerald-700">التوصيل المتوقع من 2 إلى 5 أيام عمل حسب المحافظة.</span>
        <span className="rounded-2xl bg-[#f5f3ff] px-3 py-2 text-[#6d28d9]">بيانات الشحن جاهزة لـ Bosta / Mylerz / Aramex عند تفعيل المزود.</span>
      </div>
      <div className="mt-4 hidden md:block">
        <SubmitButton submitting={submitting} paymentMethod={paymentMethod} disabled={submitDisabled} />
        <div className="mt-3">
          <TrustPills />
        </div>
      </div>
    </aside>
  );
}

function SuccessTimeline() {
  const steps = ["تم استلام الطلب", "جاري المراجعة", "جاري التجهيز", "خرج للشحن", "تم التسليم"];
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-5">
      {steps.map((step, index) => (
        <div key={step} className={`sf-reveal rounded-2xl border p-3 ${index === 0 ? "border-emerald-200 bg-emerald-50" : index === 1 ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-stone-50"}`}>
          <div className={`mb-2 grid h-8 w-8 place-items-center rounded-full ${index === 0 ? "bg-emerald-600 text-white" : index === 1 ? "bg-amber-400 text-white" : "bg-stone-200 text-stone-500"}`}>
            {index === 0 ? <Check className="h-4 w-4" /> : index === 1 ? "..." : index + 1}
          </div>
          <div className="text-xs font-black leading-5">{step}</div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, required, error, inputMode, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-black text-stone-800">{label}{required ? " *" : ""}</span>
      <input required={required} inputMode={inputMode} placeholder={placeholder || ""} value={value} onChange={(event) => onChange(event.target.value)} className={`min-h-14 w-full rounded-2xl border bg-white px-4 text-[15px] font-bold text-stone-950 shadow-[0_8px_24px_rgba(39,20,75,0.035)] outline-none transition duration-200 placeholder:text-stone-400 focus:-translate-y-0.5 focus:border-[#7c3aed] focus:shadow-[0_0_0_4px_rgba(124,58,237,0.12),0_16px_34px_rgba(39,20,75,0.08)] ${error ? "border-rose-300 focus:border-rose-400 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.10)]" : "border-stone-300/90"}`} />
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-600">{error}</span> : null}
    </label>
  );
}

function TextField({ label, value, onChange, required, error, compact, placeholder }) {
  return (
    <label className="block md:col-span-2">
      <span className="mb-1.5 block text-sm font-black text-stone-800">{label}{required ? " *" : ""}</span>
      <textarea required={required} placeholder={placeholder || ""} value={value} onChange={(event) => onChange(event.target.value)} rows={compact ? 2 : 3} className={`w-full rounded-2xl border bg-white p-4 text-[15px] font-bold text-stone-950 shadow-[0_8px_24px_rgba(39,20,75,0.035)] outline-none transition duration-200 placeholder:text-stone-400 focus:-translate-y-0.5 focus:border-[#7c3aed] focus:shadow-[0_0_0_4px_rgba(124,58,237,0.12),0_16px_34px_rgba(39,20,75,0.08)] ${error ? "border-rose-300 focus:border-rose-400 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.10)]" : "border-stone-300/90"}`} />
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-600">{error}</span> : null}
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
      <span className="mb-1.5 block text-sm font-black text-stone-800">المدينة / المنطقة{required ? " *" : ""}</span>
      <Select
        instanceId="checkout-city-area"
        inputId="checkout-city-area"
        isRtl
        isSearchable
        isDisabled={!governorate}
        options={selectOptions}
        value={selectedOption}
        placeholder={governorate ? "اختار أو ابحث عن المدينة / المنطقة" : "اختار المحافظة أولًا"}
        noOptionsMessage={() => "لا توجد نتائج"}
        onChange={(option) => onChange(option?.value || "")}
        menuPortalTarget={typeof document !== "undefined" ? document.body : null}
        styles={{
          control: (base, state) => ({
            ...base,
            minHeight: 56,
            borderRadius: 16,
            borderColor: error ? "#fda4af" : state.isFocused ? "#7c3aed" : "rgba(168, 162, 158, 0.9)",
            boxShadow: state.isFocused ? "0 0 0 4px rgba(124,58,237,0.12),0 16px 34px rgba(39,20,75,0.08)" : "0 8px 24px rgba(39,20,75,0.035)",
            direction: "rtl",
            paddingInline: 4,
            transition: "all 200ms ease",
            "&:hover": { borderColor: error ? "#fb7185" : "#7c3aed" },
          }),
          valueContainer: (base) => ({ ...base, paddingInline: 10 }),
          input: (base) => ({ ...base, color: "#0c0a09", fontSize: 15, fontWeight: 700 }),
          singleValue: (base) => ({ ...base, color: "#0c0a09", fontSize: 15, fontWeight: 700 }),
          placeholder: (base) => ({ ...base, color: "#a8a29e", fontSize: 15, fontWeight: 700 }),
          menu: (base) => ({ ...base, zIndex: 80, borderRadius: 16, overflow: "hidden", direction: "rtl" }),
          menuPortal: (base) => ({ ...base, zIndex: 9999 }),
          option: (base, state) => ({
            ...base,
            backgroundColor: state.isSelected ? "#7c3aed" : state.isFocused ? "#f5f3ff" : "#ffffff",
            color: state.isSelected ? "#ffffff" : "#1c1917",
            cursor: "pointer",
            fontSize: 15,
            fontWeight: 800,
            padding: "12px 14px",
            textAlign: "right",
          }),
        }}
      />
      {manual ? (
        <input
          required={required}
          placeholder="اكتب المدينة أو المنطقة"
          value={value}
          onChange={(event) => onManualChange(event.target.value)}
          className={`mt-2 min-h-14 w-full rounded-2xl border bg-white px-4 text-[15px] font-bold text-stone-950 shadow-[0_8px_24px_rgba(39,20,75,0.035)] outline-none transition duration-200 placeholder:text-stone-400 focus:-translate-y-0.5 focus:border-[#7c3aed] focus:shadow-[0_0_0_4px_rgba(124,58,237,0.12),0_16px_34px_rgba(39,20,75,0.08)] ${error ? "border-rose-300 focus:border-rose-400 focus:shadow-[0_0_0_4px_rgba(244,63,94,0.10)]" : "border-stone-300/90"}`}
        />
      ) : null}
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-600">{error}</span> : null}
    </div>
  );
}

function SelectField({ label, value, onChange, options, labels = {}, required, error }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-black text-stone-800">{label}{required ? " *" : ""}</span>
      <select required={required} value={value} onChange={(event) => onChange(event.target.value)} className={`min-h-14 w-full rounded-2xl border bg-white px-4 text-[15px] font-bold text-stone-950 shadow-[0_8px_24px_rgba(39,20,75,0.035)] outline-none transition duration-200 focus:-translate-y-0.5 focus:border-[#7c3aed] focus:shadow-[0_0_0_4px_rgba(124,58,237,0.12),0_16px_34px_rgba(39,20,75,0.08)] ${error ? "border-rose-300 focus:border-rose-400" : "border-stone-300/90"}`}>
        <option value="">اختار</option>
        {options.map((option) => <option key={option} value={option}>{labels[option] || option}</option>)}
      </select>
      {error ? <span className="mt-1.5 block text-xs font-black text-rose-600">{error}</span> : null}
    </label>
  );
}

function ProductSkeleton({ count }) {
  return Array.from({ length: count }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-[1.75rem] bg-white shadow-[0_12px_32px_rgba(39,20,75,0.06)]" />);
}

function EmptyState({ title, text }) {
  return (
    <div className="mx-auto my-6 max-w-xl rounded-[1.75rem] border border-dashed border-[#7c3aed]/25 bg-white p-7 text-center shadow-[0_18px_45px_rgba(39,20,75,0.06)]">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#f5f3ff] text-[#6d28d9]">
        <PackageSearch className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-2xl font-black">{title}</h2>
      <p className="mt-2 font-bold text-stone-500">{text}</p>
      <Link to="/shop/products" className="mt-5 inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white transition hover:bg-[#6d28d9]">
        تسوق الآن
      </Link>
    </div>
  );
}

function CartDrawer({ open, onClose, cart, updateCart, removeFromCart }) {
  if (!open) return null;
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal + 60;
  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} aria-label="إغلاق" />
      <aside dir="rtl" className="absolute inset-x-0 bottom-0 flex max-h-[94dvh] min-h-[72dvh] w-full min-w-0 flex-col overflow-hidden rounded-t-[2rem] bg-[#f7f4ee] shadow-[0_-24px_70px_rgba(39,20,75,0.22)] md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:min-h-0 md:w-[28rem] md:rounded-l-[2rem] md:rounded-tr-none">
        <div className="flex shrink-0 items-center justify-between border-b border-stone-200/80 px-4 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-black text-stone-500">{cart.length ? `${cart.length} منتج` : "جاهزة للتسوق"}</p>
            <h2 className="mt-1 truncate text-2xl font-black text-stone-950">السلة</h2>
          </div>
          <button onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-stone-950 shadow-sm ring-1 ring-stone-200 transition active:scale-95" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5">
          {!cart.length ? (
            <EmptyState title="السلة فاضية" text="اختار منتج الأول وبعدها كمل الدفع" />
          ) : (
            <div className="grid gap-3 pb-2">
              {cart.map((item) => (
                <MobileCartRow key={item.lineId} item={item} updateCart={updateCart} removeFromCart={removeFromCart} />
              ))}
            </div>
          )}
        </div>
        {cart.length ? (
          <div className="shrink-0 border-t border-stone-200/80 bg-white/90 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-18px_45px_rgba(39,20,75,0.12)] backdrop-blur sm:px-5">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black text-stone-500">الإجمالي</p>
                <p className="mt-1 text-2xl font-black leading-none text-stone-950">{money(total)}</p>
              </div>
              <p className="max-w-32 text-left text-[11px] font-bold leading-5 text-stone-500">الشحن النهائي في الدفع</p>
            </div>
            <Link to="/shop/checkout" onClick={onClose} className="sf-shimmer-button block min-h-14 rounded-full bg-stone-950 px-5 py-4 text-center text-base font-black text-white shadow-[0_16px_36px_rgba(39,20,75,0.22)] transition active:scale-[0.98]">
              إتمام الشراء
            </Link>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function MobileCartRow({ item, updateCart, removeFromCart }) {
  return (
    <article className="w-full min-w-0 rounded-[1.35rem] border border-stone-200 bg-white p-3 shadow-[0_12px_34px_rgba(39,20,75,0.07)]">
      <div className="flex min-w-0 items-start gap-3">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-stone-100 ring-1 ring-stone-200">
          <img src={imageFor(item.image_url)} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" width="80" height="80" />
        </div>
        <div className="min-w-0 flex-1 self-stretch">
          <h3 className="line-clamp-2 break-words text-sm font-black leading-5 text-stone-950">{item.name}</h3>
          <p className="mt-1 truncate text-xs font-bold text-stone-500">{item.color || "لون"} / {item.size || "مقاس"}</p>
          <p className="mt-2 text-sm font-black text-stone-950">{money(item.price)}</p>
        </div>
      </div>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-3">
        <QuantityStepper quantity={item.quantity} onMinus={() => updateCart(item.lineId, item.quantity - 1)} onPlus={() => updateCart(item.lineId, item.quantity + 1)} />
        <button onClick={() => removeFromCart(item.lineId)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-rose-100 transition active:scale-95" aria-label="حذف المنتج">
          <Trash2 className="h-5 w-5" />
        </button>
      </div>
    </article>
  );
}

function QuantityStepper({ quantity, onMinus, onPlus }) {
  return (
    <div className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-stone-50 p-1 shadow-inner">
      <button onClick={onMinus} className="grid h-9 w-9 place-items-center rounded-full bg-white text-stone-950 shadow-sm ring-1 ring-stone-200 transition active:scale-95" aria-label="تقليل الكمية">
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-9 px-1 text-center text-sm font-black tabular-nums text-stone-950">{quantity}</span>
      <button onClick={onPlus} className="grid h-9 w-9 place-items-center rounded-full bg-stone-950 text-white shadow-sm transition active:scale-95" aria-label="زيادة الكمية">
        +
      </button>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-8 border-t border-stone-200 bg-[#f0ebe2] px-4 py-8 md:py-10 dark:border-white/10 dark:bg-[#050816]">
      <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-[1.2fr_0.8fr_0.8fr_1fr]">
        <div><h3 className="text-2xl font-black tracking-normal">SHOES</h3><p className="mt-2 max-w-sm text-sm font-bold leading-6 text-stone-600 dark:text-stone-400">تجربة تسوق بسيطة وسريعة متصلة بالمخزون الحقيقي.</p></div>
        <FooterLinks title="روابط" links={[["سياسة الاستبدال", "/shop/returns"], ["دليل المقاسات", "/shop/size-guide"], ["الأسئلة الشائعة", "/shop/faq"]]} />
        <FooterLinks title="تواصل" links={[["Contact", "/shop/contact"], ["WhatsApp", "https://wa.me/"], ["Instagram", "/shop/contact"]]} />
        <div>
          <h4 className="font-black">تابعنا</h4>
          <div className="mt-3 flex gap-2">
            <a href="https://wa.me/" className="grid h-11 w-11 place-items-center rounded-full bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:text-emerald-600 dark:bg-white/5 dark:text-stone-100" aria-label="WhatsApp"><MessageCircle className="h-5 w-5" /></a>
            <Link to="/shop/contact" className="grid h-11 w-11 place-items-center rounded-full bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:text-[#6d28d9] dark:bg-white/5 dark:text-stone-100" aria-label="Instagram"><Camera className="h-5 w-5" /></Link>
            <Link to="/shop/contact" className="grid h-11 w-11 place-items-center rounded-full bg-white text-stone-950 shadow-sm transition hover:-translate-y-0.5 hover:text-[#6d28d9] dark:bg-white/5 dark:text-stone-100" aria-label="Facebook"><Send className="h-5 w-5" /></Link>
          </div>
          <a href="https://wa.me/" className="mt-4 inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white transition hover:bg-[#6d28d9] dark:bg-white dark:text-stone-950">كلمنا واتساب</a>
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
    { id: "home", to: "/shop", label: "الرئيسية", icon: Home },
    { id: "products", to: "/shop/products", label: "الأقسام", icon: Menu },
    { id: "search", to: "/shop/products?search=1", label: "بحث", icon: Search },
    { id: "wishlist", to: "/shop/wishlist", label: "المفضلة", icon: Heart },
    { id: "cart", to: "/shop/cart", label: "السلة", icon: ShoppingCart },
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
      className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-[27rem] rounded-full border border-white/10 bg-slate-950/[0.82] px-2 py-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.36),0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-2xl md:hidden"
      aria-label="Storefront mobile navigation"
    >
      <div className="grid grid-cols-5 items-center gap-1">
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
                "group relative flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[10.5px] font-semibold leading-none transition duration-300",
                active
                  ? "scale-[1.03] bg-white/12 text-white shadow-[0_0_24px_rgba(16,185,129,0.20)]"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-7 w-7 place-items-center rounded-full transition duration-300",
                  active ? "bg-emerald-400/16 text-emerald-200" : "text-slate-300 group-hover:text-white",
                ].join(" ")}
              >
                <Icon className="h-[19px] w-[19px]" strokeWidth={2.15} />
              </span>
              <span className={active ? "font-black text-white" : "font-semibold"}>{item.label}</span>
              {item.id === "cart" && badgeCount > 0 ? (
                <span className="absolute left-2 top-1.5 min-w-4 rounded-full border border-white/20 bg-rose-500 px-1.5 py-0.5 text-[9px] font-black leading-none text-white shadow-[0_0_14px_rgba(244,63,94,0.55)] animate-[pulse_1.8s_ease-in-out_infinite]">
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

function IconLink({ to, icon, count }) {
  return <Link to={to} className="relative hidden rounded-full border border-stone-300 bg-white p-2 shadow-sm transition hover:-translate-y-0.5 hover:border-[#7c3aed] hover:text-[#6d28d9] md:block">{icon}{count ? <span className="absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-stone-950 text-[10px] font-black text-white">{count}</span> : null}</Link>;
}

function SummaryRow({ label, value, strong }) {
  return <div className={`flex items-center justify-between gap-3 ${strong ? "mt-3 border-t border-stone-200 pt-3 text-xl font-black text-stone-950" : "mt-2 text-sm font-bold text-stone-600"}`}><span>{label}</span><span className={strong ? "rounded-full bg-white px-3 py-1 shadow-sm" : "font-black text-stone-800"}>{value}</span></div>;
}

function InfoLine({ icon, text }) {
  return <div className="flex items-center gap-2 rounded-2xl bg-stone-50 p-3">{icon}<span>{text}</span></div>;
}

function PaymentMethodTab({ method, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-[1rem] px-3 py-2 text-sm font-bold transition duration-200 ${
        active
          ? "bg-white text-[#2e1065] shadow-[0_14px_30px_rgba(124,58,237,0.22)] ring-1 ring-[#c4b5fd]/35"
          : "text-white/55 hover:bg-white/[0.055] hover:text-white"
      }`}
    >
      <span className={`grid h-7 w-7 place-items-center rounded-xl transition ${active ? "bg-[#f5f3ff]" : "bg-white/[0.07]"}`}>
        <img src={paymentBrandLogos[method]} alt="" className={`h-5 w-5 object-contain grayscale ${active ? "opacity-90" : "opacity-70 brightness-125"}`} decoding="async" width="20" height="20" />
      </span>
      <span>{paymentBrandLabels[method]}</span>
    </button>
  );
}

function PaymentCopyLine({ method, label, value }) {
  const copyValue = () => {
    navigator.clipboard?.writeText(value);
    toast.success("تم نسخ بيانات الدفع");
  };
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-[1.35rem] bg-white/[0.055] p-3 ring-1 ring-white/10">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/[0.075] ring-1 ring-white/10">
          <img src={paymentBrandLogos[method]} alt="" className="h-[22px] w-[22px] object-contain grayscale opacity-80 brightness-125" decoding="async" width="22" height="22" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-white/48">{label}</div>
          <div className="mt-1 truncate font-mono text-sm font-bold text-white" dir="ltr">{value}</div>
        </div>
      </div>
      <button type="button" onClick={copyValue} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#7c3aed] text-white shadow-[0_10px_24px_rgba(124,58,237,0.28)] transition hover:bg-[#6d28d9]" aria-label={`Copy ${label}`}>
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
}

function InfoBox({ label, value }) {
  return <div className="mt-3 rounded-2xl bg-stone-50 p-4"><div className="text-xs font-bold text-stone-500">{label}</div><div className="mt-1 font-black">{value}</div></div>;
}

function Panel({ title, children }) {
  return <div className="rounded-3xl border border-stone-200 bg-white p-5"><h2 className="mb-3 text-xl font-black">{title}</h2><div className="grid gap-2">{children}</div></div>;
}

function SmallProductList({ items, empty = "لا توجد منتجات." }) {
  if (!items.length) return <p className="font-bold text-stone-500">{empty}</p>;
  return items.slice(0, 6).map((item) => <Link key={item.id} to={`/shop/product/${item.slug || item.id}`} className="flex min-w-0 items-center gap-3 rounded-2xl bg-stone-50 p-3"><img src={imageFor(item.image_url)} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" loading="lazy" decoding="async" width="48" height="48" /><span className="truncate font-black">{item.name}</span></Link>);
}

function SmallProductGrid({ items, action, addToCart }) {
  const addWishlistItemToCart = async (item) => {
    if (!addToCart) return;
    try {
      const data = await api.get(`/storefront/products/${item.id}`);
      const product = data.product;
      const variant = product?.variants?.find((candidate) => Number(candidate.stock || 0) > 0);
      if (!product || !variant) {
        toast.error("المقاس ده مش متاح حاليًا");
        return;
      }
      addToCart(product, variant, 1);
    } catch {
      toast.error("مش قادرين نضيف المنتج للسلة دلوقتي");
    }
  };

  return (
    <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((item) => (
        <div key={item.id} className="min-w-0 rounded-3xl border border-stone-200 bg-white p-3 shadow-[0_12px_32px_rgba(39,20,75,0.05)]">
          <Link to={`/shop/product/${item.slug || item.id}`}>
            <img src={imageFor(item.image_url)} alt="" className="aspect-square w-full rounded-2xl object-cover" loading="lazy" decoding="async" width="240" height="240" />
            <div className="mt-3 line-clamp-2 min-h-10 font-black">{item.name || "منتج محفوظ"}</div>
            <div className="mt-1 font-bold text-stone-500">{item.price || item.sale_price ? money(item.price || item.sale_price) : "افتح المنتج للتفاصيل"}</div>
          </Link>
          <div className="mt-3 grid gap-2">
            {addToCart ? <button onClick={() => addWishlistItemToCart(item)} className="min-h-11 rounded-full bg-stone-950 px-4 py-2 text-sm font-black text-white">أضف للسلة</button> : null}
            {action ? <button onClick={() => action(item)} className="min-h-11 rounded-full border border-stone-300 px-4 py-2 text-sm font-black">إزالة</button> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Reviews() {
  const reviews = [
    ["M", "الخامة ممتازة والتوصيل سريع."],
    ["A", "المقاس مظبوط والدعم ساعدني."],
    ["S", "تجربة سهلة والطلب وصل مرتب."],
  ];

  return (
    <section className="mx-auto max-w-7xl px-4 py-5 md:py-7">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-2xl font-black">آراء العملاء</h2>
        <span className="rounded-full bg-[#f5f3ff] px-3 py-1 text-xs font-black text-[#6d28d9]">4.8 / 5</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {reviews.map(([avatar, review]) => (
          <div key={review} className="rounded-[1.5rem] border border-stone-200/90 bg-white p-4 font-bold text-stone-600 shadow-[0_10px_30px_rgba(39,20,75,0.06)]">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-stone-950 text-sm font-black text-white">{avatar}</span>
              <div>
                <div className="flex gap-0.5 text-[#7c3aed]">
                  {Array.from({ length: 5 }).map((_, index) => <Star key={index} className="h-3.5 w-3.5 fill-current" />)}
                </div>
                <div className="mt-1 text-xs text-stone-400">عميل موثق</div>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6">{review}</p>
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
      className="fixed inset-x-3 bottom-[calc(var(--mobile-bottom-nav-height,76px)+env(safe-area-inset-bottom)+1rem)] z-30 mx-auto max-w-md rounded-[1.35rem] border border-stone-200/90 bg-white/94 p-2.5 shadow-[0_18px_48px_rgba(39,20,75,0.18)] backdrop-blur-xl transition md:hidden"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-black">{cleanDisplayText(product.name)}</div>
          <div className="font-black">{money(variant?.sale_price || product.sale_price || product.price)}</div>
        </div>
        <button onClick={addToCart} disabled={disabled} className="rounded-full bg-stone-950 px-4 py-3 text-sm font-black text-white shadow-[0_10px_24px_rgba(28,25,23,0.18)] disabled:bg-stone-300">أضف</button>
        <button onClick={buyNow} disabled={disabled} className="rounded-full bg-[#6d28d9] px-4 py-3 text-sm font-black text-white shadow-[0_10px_24px_rgba(109,40,217,0.22)] disabled:bg-stone-300">اشتري</button>
      </div>
    </div>
  );
}

function Confetti() {
  return <div className="pointer-events-none absolute inset-0 overflow-hidden">{Array.from({ length: 24 }).map((_, index) => <span key={index} className="absolute h-2 w-2 animate-[confetti_1.8s_ease-out_forwards] rounded-full bg-emerald-500" style={{ right: `${Math.random() * 100}%`, top: "0%", animationDelay: `${index * 30}ms` }} />)}</div>;
}

const getSessionId = () => {
  const key = "storefront.session";
  let existing = "";
  try {
    existing = localStorage.getItem(key);
  } catch {}
  if (existing) return existing;
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  try {
    localStorage.setItem(key, id);
  } catch {}
  return id;
};

const playSoftClick = () => {
  try {
    const audio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=");
    audio.volume = 0.08;
    audio.play().catch(() => {});
  } catch {}
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
            <h1 className="mt-4 text-2xl font-black">حصلت مشكلة بسيطة</h1>
            <p className="mt-2 text-sm font-bold leading-6 text-stone-500">نضفنا بيانات التصفح المؤقتة. جرب تحديث الصفحة.</p>
            <button onClick={() => location.reload()} className="mt-5 rounded-full bg-stone-950 px-5 py-3 text-sm font-black text-white">تحديث الصفحة</button>
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




