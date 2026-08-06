import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeDollarSign,
  BarChart3,
  Copy,
  CalendarClock,
  Camera,
  Eye,
  Activity,
  History,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Package,
  Percent,
  RefreshCcw,
  Search,
  Send,
  ShoppingCart,
  Share2,
  ShieldAlert,
  Sparkles,
  Tag,
  Truck,
  Trash2,
  Repeat2,
  Upload,
  Video,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { resolveStorefrontPriceBreakdown } from "../../../shared/lib/storefrontPricing.js";
import { publicStorefrontUrl } from "../../../shared/lib/publicStorefront";

import {
  createSocialPublisherPost,
  getSocialPublisherMetaAccounts,
  getMetaIntegrationStatus,
  getSocialPublisherPosts,
  getSocialPublisherProducts,
  startMetaOAuth,
  publishSocialPublisherPost,
} from "../services/marketingApi";
import { generateSocialPublisherCaption, getProductsWithVariants } from "../../products/services/productsApi";
import { hasPermission } from "../../permissions/lib/rbacStore";
import MarketingStudioHeader from "../components/MarketingStudioHeader";
import { buildSuggestedFirstComment, collectFirstCommentAvailability } from "../lib/suggestedFirstComment";

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

const platformOptions = [
  { key: "facebook", labelKey: "marketing.social.platforms.facebook", icon: Share2, tone: "blue" },
  { key: "instagram", labelKey: "marketing.social.platforms.instagram", icon: Camera, tone: "pink" },
  {
    key: "tiktok",
    labelKey: "marketing.social.platforms.tiktok",
    icon: ShieldAlert,
    tone: "slate",
    disabled: true,
    subtitleKey: "marketing.socialPublisher.tiktokComingSoon",
    helperKey: "marketing.socialPublisher.connectTikTokLater",
  },
];

const statusStyles = {
  draft: "border-white/10 bg-white/5 text-slate-200",
  scheduled: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  published: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  partial_success: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  failed: "border-rose-400/20 bg-rose-400/10 text-rose-100",
};

const statusLabel = (value) => {
  const normalized = String(value || "draft").toLowerCase();
  if (normalized === "scheduled") return "Scheduled";
  if (normalized === "published") return "Published";
  if (normalized === "partial_success") return "Partial success";
  if (normalized === "failed") return "Failed";
  return "Draft";
};

const normalizeHistoryStatus = (value) => String(value || "").trim().toLowerCase();

const getHistoryStatusDetails = (status, errorMessage = "") => {
  const normalized = normalizeHistoryStatus(status);
  if (normalized === "published") {
    return {
      label: "Published ✓",
      toneClass: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
      detail: "",
    };
  }
  if (normalized === "failed") {
    return {
      label: "Failed",
      toneClass: "border-rose-400/20 bg-rose-400/10 text-rose-100",
      detail: String(errorMessage || "Unknown reason").trim(),
    };
  }
  if (normalized === "scheduled") {
    return {
      label: "Scheduled",
      toneClass: "border-amber-400/20 bg-amber-400/10 text-amber-100",
      detail: "",
    };
  }
  if (normalized === "skipped") {
    return {
      label: "Skipped",
      toneClass: "border-slate-400/20 bg-slate-400/10 text-slate-200",
      detail: String(errorMessage || "").trim(),
    };
  }
  return {
    label: statusLabel(normalized),
    toneClass: "border-white/10 bg-white/5 text-slate-200",
    detail: String(errorMessage || "").trim(),
  };
};

const HISTORY_TABLE_LIMIT = 20;
const ANALYTICS_DAYS = 30;
const HISTORY_CHART_HEIGHT = 96;

const formatRelativeDayLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
};

const formatChartDayLabel = (date) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);

const getPostTimestamp = (post = {}) => {
  const value = post.published_at || post.scheduled_at || post.created_at || post.updated_at || 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const getPrimaryPlatformLabel = (post = {}) => {
  const platforms = safeArray(post.platforms).map((platform) => String(platform || "").trim().toLowerCase()).filter(Boolean);
  if (platforms.includes("facebook") && platforms.includes("instagram")) return "Facebook + Instagram";
  if (platforms.includes("facebook")) return "Facebook";
  if (platforms.includes("instagram")) return "Instagram";
  if (platforms.length) return platforms.join(", ");
  return "-";
};

const deriveTemplateLabel = (post = {}) => {
  const explicit = normalizeTextValue(post.template_name || post.template_label || post.template || post.template_key);
  if (explicit) {
    const normalized = explicit.toLowerCase();
    if (normalized === "new_collection") return "New Collection";
    return explicit.replace(/_/g, " ");
  }
  const caption = normalizeTextValue(post.caption || "");
  if (/new collection/i.test(caption)) return "New Collection";
  if (/sale/i.test(caption) || /عرض/i.test(caption)) return "Sale";
  if (/last pieces/i.test(caption)) return "Last Pieces";
  if (/best seller/i.test(caption) || /bestseller/i.test(caption)) return "Best Seller";
  if (/story/i.test(caption)) return "Story";
  if (/reels?/i.test(caption)) return "Reels";
  return "Custom";
};

const buildPostCountsByDay = (posts = []) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (ANALYTICS_DAYS - 1));
  const days = Array.from({ length: ANALYTICS_DAYS }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      key: date.toISOString().slice(0, 10),
      label: formatChartDayLabel(date),
      published: 0,
      scheduled: 0,
      draft: 0,
      total: 0,
    };
  });
  const map = new Map(days.map((item) => [item.key, item]));
  posts.forEach((post) => {
    const timestamp = getPostTimestamp(post);
    if (!timestamp) return;
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    const key = date.toISOString().slice(0, 10);
    const bucket = map.get(key);
    if (!bucket) return;
    const status = String(post.status || "draft").toLowerCase();
    bucket.total += 1;
    if (status === "published") bucket.published += 1;
    else if (status === "scheduled") bucket.scheduled += 1;
    else bucket.draft += 1;
  });
  return days;
};

const safeArray = (value) => (Array.isArray(value) ? value : []);
const resolveFacebookPageDisplayLabel = (page = {}) => page?.facebook_page_name || page?.page_name || "Facebook Page";
const resolveInstagramAccountDisplayLabel = (account = {}) => account?.instagram_username || account?.instagram_account_name || "Instagram Business Account";
const formatCompactCurrency = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number);
};
const normalizeTextValue = (value) => String(value || "").trim();
const normalizeListValue = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(normalizeTextValue).filter(Boolean);
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(normalizeTextValue).filter(Boolean);
    } catch {
      // Fall through to split text.
    }
    return text
      .split(/[,\n|]+/)
      .map(normalizeTextValue)
      .filter(Boolean);
  }
  return [normalizeTextValue(value)].filter(Boolean);
};
const uniqueTextList = (...values) => Array.from(new Set(values.flatMap((value) => normalizeListValue(value)).filter(Boolean)));
const COLOR_NAME_MAP = {
  black: "أسود",
  white: "أبيض",
  gray: "رمادي",
  grey: "رمادي",
  silver: "فضي",
  gold: "ذهبي",
  red: "أحمر",
  blue: "أزرق",
  navy: "كحلي",
  green: "أخضر",
  olive: "زيتي",
  yellow: "أصفر",
  orange: "برتقالي",
  pink: "وردي",
  purple: "بنفسجي",
  brown: "بني",
  beige: "بيج",
  nude: "نود",
  tan: "تان",
  maroon: "خمري",
  burgundy: "عنابي",
  cream: "كريمي",
  charcoal: "فحمي",
  "off white": "أوف وايت",
  offwhite: "أوف وايت",
};
const localizeColorName = (value = "") => {
  const text = normalizeTextValue(value);
  if (!text) return "";
  const arabicMatch = text.match(/[\u0600-\u06ff]+/);
  if (arabicMatch) return arabicMatch[0];
  const normalized = text.toLowerCase().replace(/[(){}]|\[|\]/g, " ").replace(/[_/-]+/g, " ").replace(/\s+/g, " ").trim();
  const direct = COLOR_NAME_MAP[normalized] || COLOR_NAME_MAP[normalized.replace(/\s+/g, "")];
  if (direct) return direct;
  const firstToken = normalized.split(" ")[0];
  return COLOR_NAME_MAP[firstToken] || text;
};
const buildErpHashtags = ({ brand = "", category = "", gender = "", productType = "" } = {}) => {
  const values = [brand, category, gender, productType, "M1Store"];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeTextValue(value).replace(/[^\p{L}\p{N}]+/gu, ""))
        .filter(Boolean)
        .map((value) => `#${value}`)
    )
  ).slice(0, 5);
};
const formatPriceForCaption = (value) => {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number);
};
const computeDiscountPercent = (originalPrice, currentPrice) => {
  const original = Number(originalPrice || 0);
  const current = Number(currentPrice || 0);
  if (!Number.isFinite(original) || !Number.isFinite(current) || original <= 0 || current <= 0 || current >= original) return "";
  return `${Math.max(1, Math.round(((original - current) / original) * 100))}%`;
};
const buildFullProductUrl = (value = "") => {
  const text = normalizeTextValue(value);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return publicStorefrontUrl(text.startsWith("/") ? text : `/${text}`);
};
const buildCatalogCaption = (product = {}, options = {}) => {
  const name = String(product?.name || "").trim();
  const pricing = resolveStorefrontPriceBreakdown(product);
  const stockQuantity = Number(product?.stock_quantity ?? product?.available_stock ?? product?.stock ?? 0);
  const includeLocation = Boolean(options.includeLocation);
  const includeShipping = Boolean(options.includeShipping);
  const lines = [name].filter(Boolean);
  if (pricing.sale_active) {
    if (pricing.current_price > 0) lines.push(`السعر الآن: ${formatCompactCurrency(pricing.current_price)} ج.م`);
    if (pricing.old_crossed_price > pricing.current_price) lines.push(`بدلاً من: ${formatCompactCurrency(pricing.old_crossed_price)} ج.م`);
    lines.push("عرض لفترة محدودة");
  } else if (pricing.current_price > 0) {
    lines.push(`السعر: ${formatCompactCurrency(pricing.current_price)} ج.م`);
  }
  lines.push(stockQuantity > 0 ? "متوفر الآن" : "غير متوفر حالياً", "اطلب الآن");
  if (includeLocation) {
    lines.push("دمياط الجديدة، شارع البشبيشي، بجوار الفرنسية جروب");
  }
  if (includeShipping) {
    lines.push("شحن لجميع المحافظات");
  }
  return lines.filter(Boolean).join("\n");
};
const normalizeCatalogProductMetrics = (product = {}) => {
  const resolved = resolveStorefrontPriceBreakdown(product);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const stock = variants.reduce(
    (sum, variant) => sum + Math.max(0, Number(variant.stock_quantity ?? variant.stock ?? variant.quantity ?? variant.available_stock ?? 0)),
    0
  ) || Math.max(0, Number(product.available_stock ?? product.stock_quantity ?? product.stock ?? product.total_stock ?? 0));
  const currentPrice = Number(resolved.current_price || 0);
  const originalPrice = Number(resolved.old_crossed_price || 0) || currentPrice;
  const discountPercent = resolved.discount_percent || computeDiscountPercent(originalPrice, currentPrice);
  console.warn("[social-publisher-price-resolver]", {
    product_id: resolved.product_id ?? product.id ?? product.product_id ?? null,
    base_price: Number(resolved.base_price || 0),
    sale_price: Number(resolved.sale_price || 0),
    current_price: currentPrice,
    old_crossed_price: Number(resolved.old_crossed_price || 0),
    discount_percent: discountPercent,
    source: resolved.source || "",
  });
  return {
    ...product,
    price: Number(resolved.base_price || currentPrice || 0),
    sale_price: Number(resolved.sale_price || 0),
    current_price: currentPrice,
    original_price: originalPrice,
    discount_percent: discountPercent,
    stock_quantity: stock,
    available_stock: stock,
    base_price: Number(resolved.base_price || 0),
    old_crossed_price: Number(resolved.old_crossed_price || 0),
    sale_active: Boolean(resolved.sale_active),
    price_source: resolved.source || "",
  };
};
const buildAiCaptionProductContext = (product = {}) => {
  const resolved = normalizeCatalogProductMetrics(product);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const availableSizes = uniqueTextList(
    product.available_sizes,
    variants.map((variant) => variant.fixed_size_label || variant.size_label || variant.size_name || variant.size || ""),
    variants.map((variant) => variant.size || "")
  );
  const availableColors = uniqueTextList(
    product.available_colors,
    product.colors,
    product.color_names,
    variants.map((variant) => variant.color || variant.color_name || variant.name || ""),
    Array.isArray(product.color_images) ? product.color_images.map((item) => item?.color || item?.color_name || "").filter(Boolean) : []
  ).map((value) => localizeColorName(value)).filter(Boolean);
  const features = uniqueTextList(product.features, product.feature_list, product.highlights, product.benefits);
  const materials = uniqueTextList(product.materials, product.material, product.fabric, product.upper_material);
  const brand = normalizeTextValue(product.brand_name || product.brand || product.manufacturer_name || product.manufacturer || "");
  const category = normalizeTextValue(product.category_name || product.category || product.department || "");
  const productType = normalizeTextValue(product.product_type || product.productType || product.type || "");
  const gender = normalizeTextValue(product.gender || product.audience_gender || product.target_gender || "");
  const audience = normalizeTextValue(product.audience || product.target_audience || "");
  const description = normalizeTextValue(product.description || product.product_description || product.long_description || "");
  const shortDescription = normalizeTextValue(product.short_description || product.shortDescription || product.summary || product.meta_description || "");
  const productUrl = buildFullProductUrl(resolved.product_url || product.product_url || "");
  const currentPrice = Number(resolved.current_price || 0);
  const originalPrice = Number(resolved.old_crossed_price || 0) || currentPrice;
  const discountPercent = resolved.discount_percent || computeDiscountPercent(originalPrice, currentPrice);
  const stock = Number(resolved.stock_quantity ?? resolved.available_stock ?? product.stock_quantity ?? product.stock ?? product.quantity ?? 0);
  return {
    product_name: normalizeTextValue(product.name || product.product_name || ""),
    brand,
    category,
    product_type: productType,
    gender,
    audience,
    description,
    short_description: shortDescription,
    features,
    materials,
    available_colors: availableColors,
    available_sizes: availableSizes,
    base_price: Number(resolved.base_price || 0),
    sale_price: Number(resolved.sale_price || 0),
    current_price: currentPrice > 0 ? formatPriceForCaption(currentPrice) : "",
    original_price: originalPrice > 0 ? formatPriceForCaption(originalPrice) : "",
    discount_percent: discountPercent,
    stock_quantity: Number.isFinite(stock) ? String(stock) : "",
    product_url: productUrl,
    sale_active: Boolean(resolved.sale_active),
    price_source: resolved.price_source || "",
    old_crossed_price: Number(resolved.old_crossed_price || 0),
  };
};
const buildErpProductInfo = (product = {}) => {
  const resolved = normalizeCatalogProductMetrics(product);
  const features = uniqueTextList(product.features, product.feature_list, product.highlights, product.benefits).slice(0, 4);
  const sizes = uniqueTextList(resolved.available_sizes, product.available_sizes, product.sizes).slice(0, 10);
  const colors = uniqueTextList(resolved.available_colors, product.available_colors, product.colors).map((value) => localizeColorName(value)).filter(Boolean).slice(0, 5);
  const currentPrice = Number(resolved.current_price || 0);
  const originalPrice = Number(resolved.original_price || 0);
  const discountPercent = resolved.discount_percent || computeDiscountPercent(originalPrice, currentPrice);
  const stockQuantity = Number(resolved.stock_quantity ?? resolved.available_stock ?? resolved.stock ?? 0);
  const productUrl = buildFullProductUrl(resolved.product_url || product.product_url || "");
  return {
    product_name: normalizeTextValue(product.name || product.product_name || ""),
    brand: normalizeTextValue(product.brand_name || product.brand || product.manufacturer_name || product.manufacturer || ""),
    category: normalizeTextValue(product.category_name || product.category || product.department || ""),
    product_type: normalizeTextValue(product.product_type || product.productType || product.type || ""),
    gender: normalizeTextValue(product.gender || product.audience_gender || product.target_gender || ""),
    features,
    available_sizes: sizes,
    available_colors: colors,
    base_price: Number(resolved.base_price || 0),
    sale_price: Number(resolved.sale_price || 0),
    current_price: currentPrice,
    original_price: originalPrice,
    discount_percent: discountPercent,
    stock_quantity: stockQuantity,
    product_url: productUrl,
    price_source: resolved.price_source || "",
    sale_active: Boolean(resolved.sale_active),
    old_crossed_price: Number(resolved.old_crossed_price || 0),
    stock_line: stockQuantity > 0 ? "متوفر الآن" : "غير متوفر حالياً",
  };
};
const normalizeCatalogMediaUrl = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return normalizeTextValue(value);
  if (typeof value === "object") {
    return normalizeTextValue(
      value.image_url ||
        value.url ||
        value.src ||
        value.media_url ||
        value.primary_image_url ||
        value.variant_image_url ||
        value.color_image_url ||
        value.image ||
        value.photo_url ||
        value.thumbnail_url ||
        value.file_url ||
        ""
    );
  }
  return "";
};
const flattenCatalogMediaUrls = (...sources) => {
  const seen = new Set();
  const urls = [];

  const push = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "string") {
      const text = normalizeTextValue(value);
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          parsed.forEach(push);
          return;
        }
      } catch {
        // Fall through to plain string handling.
      }
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      urls.push(text);
      return;
    }
    if (typeof value === "object") {
      push(normalizeCatalogMediaUrl(value));
      push(value.images);
      push(value.gallery_images);
      push(value.media_urls);
    }
  };

  sources.forEach(push);
  return urls;
};
const isCatalogMediaVariantAvailable = (variant = {}) => {
  const quantity = Number(
    variant.quantity ??
      variant.stock ??
      variant.stock_quantity ??
      variant.available_quantity ??
      variant.inventory_quantity ??
      variant.current_stock ??
      0
  );
  const available = variant.available === true || variant.in_stock === true || variant.is_available === true;
  return quantity > 0 || available;
};
const isBagCatalogProduct = (product = {}) => {
  const signal = [
    product.product_type,
    product.productType,
    product.type,
    product.category,
    product.category_name,
    product.department,
    product.department_name,
    product.name,
  ]
    .map((value) => normalizeTextValue(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
  return /(^|\s)(bags?|backpacks?|handbags?|school\s*bags?)(\s|$)|شنط|شنطة|حقيبة|حقائب/i.test(signal);
};
const buildCatalogColorMediaItems = (product = {}) => {
  const items = [];
  const seen = new Set();
  const includeAllBagColors = isBagCatalogProduct(product);

  const addItem = (color, sourceValue, source = "") => {
    const colorText = normalizeTextValue(color);
    const mediaUrls = flattenCatalogMediaUrls(sourceValue);
    if (!colorText || !mediaUrls.length) return;
    const key = colorText.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      key,
      color: localizeColorName(colorText),
      url: mediaUrls[0],
      media_urls: mediaUrls,
      source,
    });
  };

  const variants = Array.isArray(product.variants)
    ? product.variants.filter((variant) => includeAllBagColors || isCatalogMediaVariantAvailable(variant))
    : [];
  variants.forEach((variant) => {
    addItem(
      variant.color || variant.color_name || variant.colour || variant.name || variant.label || "",
      [
        variant.primary_image_url,
        variant.variant_image_url,
        variant.color_image_url,
        variant.image_url,
        variant.image,
        variant.photo_url,
        variant.thumbnail_url,
        variant.images,
        variant.gallery_images,
        variant.media_urls,
      ],
      "variant"
    );
  });

  // A zero-stock bag color can exist in the saved color artwork even when it
  // has no active size variant. Merge those color-level sources for bags.
  if (items.length && !includeAllBagColors) {
    return items;
  }

  const colorImageSources = Array.isArray(product.color_images) ? product.color_images : [];
  colorImageSources.forEach((entry) => {
    addItem(entry?.color || entry?.color_name || entry?.name || entry?.label || "", entry, "color_images");
  });

  if (product.images_by_color && typeof product.images_by_color === "object" && !Array.isArray(product.images_by_color)) {
    Object.entries(product.images_by_color).forEach(([color, value]) => {
      addItem(color, value, "images_by_color");
    });
  }

  return items;
};
const buildCatalogFallbackMediaUrl = (product = {}) =>
  flattenCatalogMediaUrls(
    product.color_images,
    product.images_by_color,
    product.variants,
    product.gallery_images,
    product.images,
    product.media_urls,
    product.primary_media_url,
    product.image_url,
    product.cover_image_url,
    product.product_image_url,
    product.thumbnail_url,
    product.photo_url,
    product.image
  )[0] || "";
const normalizeAiCaptionSections = (result = {}) => {
  const hashtags = uniqueTextList(result.hashtags, result.tags, result.hash_tags, result.keywords).slice(0, 5);
  return {
    hook: normalizeTextValue(result.hook || result.opening_hook || result.opening || ""),
    body: normalizeTextValue(result.body || result.marketing_body || result.copy || ""),
    cta: normalizeTextValue(result.cta || result.call_to_action || ""),
    hashtags,
    caption: normalizeTextValue(result.caption || ""),
  };
};
const composeNewCollectionCaption = (aiSections = {}, erpInfo = {}, options = {}) => {
  const hook = normalizeTextValue(aiSections.hook);
  const body = normalizeTextValue(aiSections.body);
  const cta = normalizeTextValue(aiSections.cta);
  const hashtags = buildErpHashtags({
    brand: erpInfo.brand,
    category: erpInfo.category,
    gender: erpInfo.gender,
    productType: erpInfo.product_type,
  });
  const productSignal = [erpInfo.product_name, erpInfo.category, erpInfo.product_type].filter(Boolean).join(" ").toLowerCase();
  const isSchoolBag = /(bag|backpack|school\s*bag|شنط|شنطة|حقيبة|حقائب)/i.test(productSignal);
  const lines = [isSchoolBag ? "🎒 استعدوا لموسم العودة إلى المدارس 📚" : "NEW COLLECTION"];

  if (isSchoolBag) {
    lines.push("");
    lines.push(`${erpInfo.product_name || "شنط المدارس"} — عملية، مريحة، ومتاحة بألوان مميزة.`);
  }

  if (hook && !isSchoolBag) {
    lines.push("");
    lines.push(hook);
  }

  if (body && !isSchoolBag) {
    lines.push("");
    lines.push(body);
  }

  const priceLines = [];
  const currentPrice = Number(erpInfo.current_price || 0);
  const originalPrice = Number(erpInfo.old_crossed_price || 0);
  const saleActive = Boolean(erpInfo.sale_active);

  if (saleActive && currentPrice > 0) {
    priceLines.push(`السعر الآن: ${formatCompactCurrency(currentPrice)} ج.م`);
    if (originalPrice > currentPrice) {
      priceLines.push(`قبل الخصم: ${formatCompactCurrency(originalPrice)} ج.م`);
    }
    if (erpInfo.discount_percent) {
      priceLines.push(`وفر ${erpInfo.discount_percent}`);
    }
    priceLines.push("⏳ عرض لفترة محدودة حتى نفاد الكمية.");
  } else if (currentPrice > 0) {
    priceLines.push(`السعر: ${formatCompactCurrency(currentPrice)} ج.م`);
  }

  const sizesLine = Array.isArray(erpInfo.available_sizes) && erpInfo.available_sizes.length
    ? `المقاسات المتوفرة: ${erpInfo.available_sizes.join(" • ")}`
    : "";
  const colorsLine = Array.isArray(erpInfo.available_colors) && erpInfo.available_colors.length
    ? `الألوان المتوفرة: ${erpInfo.available_colors.join(" • ")}`
    : "";
  const stockLine = erpInfo.stock_line || "";
  const productUrl = normalizeTextValue(erpInfo.product_url || "");
  const includeLocation = Boolean(options.includeLocation);
  const includeShipping = Boolean(options.includeShipping);

  if (priceLines.length || sizesLine || colorsLine || stockLine || productUrl) {
    lines.push("");
    lines.push("━━━━━━━━━━━━");
    lines.push(...priceLines.filter(Boolean));
    if (sizesLine) {
      lines.push("");
      lines.push(sizesLine);
    }
    if (colorsLine) {
      lines.push("");
      lines.push(colorsLine);
    }
    if (stockLine) {
      lines.push("");
      lines.push(stockLine);
    }
    if (includeLocation) {
      lines.push("");
      lines.push("دمياط الجديدة، شارع البشبيشي، بجوار الفرنسية جروب");
    }
    if (includeShipping) {
      lines.push("");
      lines.push("شحن لجميع المحافظات");
    }
    if (productUrl) {
      lines.push("");
      lines.push("━━━━━━━━━━━━");
      lines.push(`اطلب الآن: ${productUrl}`);
    }
  }

  if (cta && !isSchoolBag) {
    lines.push("");
    lines.push(cta);
  }

  if (hashtags.length) {
    lines.push("");
    lines.push(hashtags.join(" "));
  }

  return lines
    .map((line) => String(line || "").trim())
    .filter((line, index, array) => line !== "" || array[index - 1] !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};
const renderAccountCardValue = (label, value) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white">
    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
    <div className="mt-1 font-semibold">{value}</div>
  </div>
);

const sharedBadgeClass =
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]";
const sharedButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass = `${sharedButtonClass} bg-amber-400 text-slate-950 hover:bg-amber-300`;
const secondaryButtonClass = `${sharedButtonClass} border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.1]`;
const ghostButtonClass = `${sharedButtonClass} border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]`;
const dangerButtonClass = `${sharedButtonClass} border border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15`;

export default function SocialMediaPublisher() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState(null);
  const [error, setError] = useState("");
  const [posts, setPosts] = useState([]);
  const [historyDetailPost, setHistoryDetailPost] = useState(null);
  const [caption, setCaption] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [firstCommentAccordionOpen, setFirstCommentAccordionOpen] = useState(false);
  const [firstCommentLoading, setFirstCommentLoading] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [platforms, setPlatforms] = useState({ facebook: true, instagram: false, tiktok: false });
  const [createSource, setCreateSource] = useState("device");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [metaAccountsLoading, setMetaAccountsLoading] = useState(true);
  const [metaIntegrationLoading, setMetaIntegrationLoading] = useState(true);
  const [metaIntegrationStatus, setMetaIntegrationStatus] = useState(null);
  const [facebookPages, setFacebookPages] = useState([]);
  const [instagramAccounts, setInstagramAccounts] = useState([]);
  const [selectedFacebookPageId, setSelectedFacebookPageId] = useState("");
  const [selectedInstagramAccountId, setSelectedInstagramAccountId] = useState("");
  const [selectedCatalogProduct, setSelectedCatalogProduct] = useState(null);
  const [selectedCatalogMediaUrl, setSelectedCatalogMediaUrl] = useState("");
  const [productCatalogOpen, setProductCatalogOpen] = useState(false);
  const [productCatalogLoading, setProductCatalogLoading] = useState(false);
  const [productCatalogQuery, setProductCatalogQuery] = useState("");
  const [productCatalogResults, setProductCatalogResults] = useState([]);
  const [aiTemplateOpen, setAiTemplateOpen] = useState(false);
  const [aiTemplateLoading, setAiTemplateLoading] = useState(false);
  const [aiTemplateCaption, setAiTemplateCaption] = useState("");
  const [aiTemplateError, setAiTemplateError] = useState("");
  const [aiTemplateSource, setAiTemplateSource] = useState("");
  const [aiTemplateFallbackReason, setAiTemplateFallbackReason] = useState("");
  const [includeLocation, setIncludeLocation] = useState(true);
  const [includeShipping, setIncludeShipping] = useState(true);
  const [metaConnectOpen, setMetaConnectOpen] = useState(false);
  const [metaConnectLoading, setMetaConnectLoading] = useState(false);
  const mediaInputRef = useRef(null);
  const productCatalogSearchRef = useRef(null);
  const metaConnectPopupRef = useRef(null);
  const metaConnectTimeoutRef = useRef(null);
  const metaConnectClosedIntervalRef = useRef(null);
  const canCreate = hasPermission("marketing.create");
  const canPublish = hasPermission("marketing.publish");
  const previewTitle = caption.trim() || "Your caption will appear here";
  const previewSubtitle = mediaFile ? `${mediaType.toUpperCase()} ready` : selectedCatalogProduct ? "Catalog product selected" : "No media selected";
  const firstCommentPreview = firstComment.trim() || "Select a product to generate the first comment.";

  const selectedPlatforms = useMemo(
    () => platformOptions.filter((platform) => platforms[platform.key] && platform.key !== "tiktok").map((platform) => platform.key),
    [platforms]
  );

  const hasDisabledTikTok = Boolean(platforms.tiktok);
  const hasCatalogProduct = Boolean(selectedCatalogProduct);
  const selectedFacebookPage = useMemo(
    () => facebookPages.find((page) => page.facebook_page_id === selectedFacebookPageId) || null,
    [facebookPages, selectedFacebookPageId]
  );
  const selectedInstagramAccount = useMemo(
    () => instagramAccounts.find((account) => account.instagram_account_id === selectedInstagramAccountId) || null,
    [instagramAccounts, selectedInstagramAccountId]
  );
  const metaIntegrationConnected = Boolean(
    metaIntegrationStatus?.overall_status &&
      ["connected", "fully_connected", "active", "saved", "partially_connected"].includes(String(metaIntegrationStatus.overall_status || "").toLowerCase())
  );
  const metaAccountsEmpty = !facebookPages.length && !instagramAccounts.length;
  const selectedCatalogMediaItems = useMemo(() => buildCatalogColorMediaItems(selectedCatalogProduct || {}), [selectedCatalogProduct]);
  const selectedCatalogPrimaryMediaUrl = useMemo(() => buildCatalogFallbackMediaUrl(selectedCatalogProduct || {}), [selectedCatalogProduct]);
  const selectedCatalogResolvedMediaUrl = selectedCatalogMediaUrl || selectedCatalogPrimaryMediaUrl || selectedCatalogProduct?.image_url || "";
  const resolvedMediaPreview = mediaFile ? mediaPreview : selectedCatalogResolvedMediaUrl || mediaPreview || "";
  const selectedCatalogProductAvailability = useMemo(() => collectFirstCommentAvailability(selectedCatalogProduct || {}), [selectedCatalogProduct]);
  const selectedCatalogProductDiscount = useMemo(() => {
    if (!selectedCatalogProduct) return "";
    const currentPrice = Number(selectedCatalogProduct.current_price || selectedCatalogProduct.price || 0);
    const originalPrice = Number(selectedCatalogProduct.original_price || selectedCatalogProduct.old_crossed_price || 0);
    if (!Number.isFinite(currentPrice) || !Number.isFinite(originalPrice) || currentPrice <= 0 || originalPrice <= 0 || originalPrice <= currentPrice) return "";
    const percent = Math.max(1, Math.round(((originalPrice - currentPrice) / originalPrice) * 100));
    return `-${percent}%`;
  }, [selectedCatalogProduct]);
  const hasFirstCommentText = Boolean(firstComment.trim());

  useEffect(() => {
    if (!hasFirstCommentText) {
      setFirstCommentAccordionOpen(false);
    }
  }, [hasFirstCommentText]);

  const historyPosts = useMemo(
    () =>
      [...posts].sort((a, b) => {
        const aTime = getPostTimestamp(a);
        const bTime = getPostTimestamp(b);
        return bTime - aTime;
      }),
    [posts]
  );
  const historyTablePosts = useMemo(() => historyPosts.slice(0, HISTORY_TABLE_LIMIT), [historyPosts]);
  const analyticsPosts = historyPosts;
  const analyticsCounts = useMemo(() => {
    const counts = {
      published: 0,
      scheduled: 0,
      drafts: 0,
      firstCommentPublished: 0,
      firstCommentFailed: 0,
      firstCommentSkipped: 0,
    };
    analyticsPosts.forEach((post) => {
      const status = String(post.status || "draft").toLowerCase();
      if (status === "published") counts.published += 1;
      else if (status === "scheduled") counts.scheduled += 1;
      else counts.drafts += 1;
      const firstCommentStatus = String(
        post.first_comment_status || (String(post.first_comment || "").trim() ? (status === "published" ? "published" : status) : "skipped")
      )
        .trim()
        .toLowerCase();
      if (firstCommentStatus === "published") counts.firstCommentPublished += 1;
      else if (firstCommentStatus === "failed") counts.firstCommentFailed += 1;
      else counts.firstCommentSkipped += 1;
    });
    return counts;
  }, [analyticsPosts]);
  const analyticsTimeline = useMemo(() => {
    return analyticsPosts
      .slice(0, 8)
      .map((post) => {
        const timestamp = getPostTimestamp(post);
        const platform = getPrimaryPlatformLabel(post);
        const status = getHistoryStatusDetails(post.status, post.error_message);
        const firstCommentStatus = getHistoryStatusDetails(
          post.first_comment_status || (String(post.first_comment || "").trim() ? post.status : "skipped"),
          post.first_comment_error || (String(post.first_comment || "").trim() && String(post.status || "").toLowerCase() === "failed" ? post.error_message : "")
        );
        return {
          id: post.id,
          timestamp,
          time: timestamp ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp) : "-",
          dayLabel: timestamp ? formatRelativeDayLabel(timestamp) : "-",
          platform,
          statusKey: String(post.status || "draft").toLowerCase(),
          statusLabel: status.label,
          firstCommentStatusKey: String(
            post.first_comment_status || (String(post.first_comment || "").trim() ? (String(post.status || "").toLowerCase() === "published" ? "published" : String(post.status || "draft").toLowerCase()) : "skipped")
          )
            .trim()
            .toLowerCase(),
          firstCommentStatusLabel: firstCommentStatus.label,
          publishedAt: post.published_at,
          scheduledAt: post.scheduled_at,
          hasFirstComment: Boolean(String(post.first_comment || "").trim()),
        };
      })
      .filter((item) => item.id);
  }, [analyticsPosts]);
  const postsByDay = useMemo(() => buildPostCountsByDay(analyticsPosts), [analyticsPosts]);
  const maxPostsPerDay = Math.max(1, ...postsByDay.map((item) => item.total));
  const historyActionButtonClass =
    "inline-flex h-9 items-center gap-2 rounded-2xl px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const historyNeutralButtonClass = `${historyActionButtonClass} border border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.08]`;
  const historyDangerButtonClass = `${historyActionButtonClass} border border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15`;
  const historyPrimaryButtonClass = `${historyActionButtonClass} bg-amber-400 font-black text-slate-950 hover:bg-amber-300`;

  const loadPosts = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await getSocialPublisherPosts({ limit: 50 });
      setPosts(safeArray(data));
    } catch (err) {
      const message = err?.message || "Failed to load social media publisher history";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, []);

  const applyMetaAccounts = (data = {}) => {
    const pages = safeArray(data.pages || data.facebook_pages || data.facebookPages);
    const accounts = safeArray(data.instagram_accounts || data.instagramBusinessAccounts || data.instagram_business_accounts);
    const selected = data.selected || {};
    const selectedPageId = String(selected.facebook_page_id || data.facebook_page_id || data.meta_config?.facebook_page_id || pages[0]?.facebook_page_id || "").trim();
    const selectedInstagramId = String(
      selected.instagram_account_id ||
        selected.instagram_business_account_id ||
        data.instagram_business_account_id ||
        data.meta_config?.instagram_business_account_id ||
        accounts.find((account) => account.facebook_page_id === selectedPageId)?.instagram_account_id ||
        accounts[0]?.instagram_account_id ||
        ""
    ).trim();
    const pageMatch = pages.find((page) => page.facebook_page_id === selectedPageId) || null;
    const instagramMatch = accounts.find((account) => account.instagram_account_id === selectedInstagramId) || null;
    const resolvedFacebook = pageMatch?.facebook_page_name || pageMatch?.page_name || data.facebook_page_name || data.meta_config?.facebook_page_name || selectedPageId || "";
    const resolvedInstagram = instagramMatch?.instagram_username || instagramMatch?.instagram_account_name || data.instagram_username || data.meta_config?.instagram_username || selectedInstagramId || "";
    console.log("[social-publisher-accounts-sync]", {
      meta_connected: Boolean(data.meta_connected || data.meta_integration_connected),
      selected,
      pages_count: pages.length,
      instagram_count: accounts.length,
      resolvedFacebook,
      resolvedInstagram,
      raw_response: data,
    });
    console.log("[social-publisher-accounts]", {
      stage: "apply",
      response_raw: data,
      pages_count: pages.length,
      instagram_accounts_count: accounts.length,
      selected: data.selected || null,
      has_facebook: Boolean(data.has_facebook),
      has_instagram: Boolean(data.has_instagram),
      meta_integration_connected: Boolean(data.meta_integration_connected),
      reason: !pages.length ? "no_facebook_pages" : !accounts.length ? "no_instagram_accounts" : "ok",
    });
    setFacebookPages(pages);
    setInstagramAccounts(accounts);
    setSelectedFacebookPageId(selectedPageId);
    setSelectedInstagramAccountId(selectedInstagramId);
  };

  const loadMetaAccounts = async () => {
    setMetaAccountsLoading(true);
    setMetaIntegrationLoading(true);
    try {
      const [accountsData, integrationData] = await Promise.all([
        getSocialPublisherMetaAccounts({ suppressErrorStatuses: [400, 403, 404, 409, 500] }),
        getMetaIntegrationStatus({ suppressErrorStatuses: [400, 403, 404, 409, 500] }).catch(() => null),
      ]);
      console.log("[social-publisher-accounts]", {
        stage: "load",
        response_raw: accountsData || null,
        integration_status: integrationData?.overall_status || integrationData?.config?.status || null,
        integration_connected: Boolean(integrationData?.overall_status && ["connected", "fully_connected", "active", "saved", "partially_connected"].includes(String(integrationData.overall_status || "").toLowerCase())),
        selected: accountsData?.selected || null,
      });
      applyMetaAccounts(accountsData || {});
      setMetaIntegrationStatus(integrationData || null);
    } catch {
      console.log("[social-publisher-accounts]", {
        stage: "load_failed",
        response_raw: null,
        integration_status: null,
        integration_connected: false,
      });
      applyMetaAccounts({});
      setMetaIntegrationStatus(null);
    } finally {
      setMetaAccountsLoading(false);
      setMetaIntegrationLoading(false);
    }
  };

  useEffect(() => {
    loadMetaAccounts();
  }, []);

  const loadCatalogProducts = async ({ query = "" } = {}) => {
    setProductCatalogLoading(true);
    try {
      const data = await getSocialPublisherProducts({ q: query, limit: 20 }, { suppressErrorStatuses: [400, 403, 404, 500] });
      setProductCatalogResults(safeArray(data));
    } catch (error) {
      console.error("[social-publisher-catalog] load failed", error);
      setProductCatalogResults([]);
    } finally {
      setProductCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (!productCatalogOpen) return undefined;
    const timeout = window.setTimeout(() => {
      void loadCatalogProducts({ query: productCatalogQuery });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [productCatalogOpen, productCatalogQuery]);

  useEffect(() => {
    if (!productCatalogOpen) return;
    if (productCatalogSearchRef.current) {
      productCatalogSearchRef.current.focus?.();
    }
  }, [productCatalogOpen]);

  const openProductCatalog = () => {
    setCreateSource("catalog");
    setProductCatalogOpen(true);
  };

  const closeProductCatalog = () => setProductCatalogOpen(false);

  const applyCatalogProduct = (product = {}) => {
    const nextProduct = normalizeCatalogProductMetrics({
      ...product,
      id: product.id || null,
      name: product.name || "",
      product_url: product.product_url || "",
    });
    const nextMediaUrl = buildCatalogColorMediaItems(nextProduct)[0]?.url || buildCatalogFallbackMediaUrl(nextProduct);
    setSelectedCatalogProduct(nextProduct);
    setSelectedCatalogMediaUrl(nextMediaUrl);
    setCreateSource("catalog");
    setCaption("");
    setFirstComment(buildSuggestedFirstComment(nextProduct, { includeLocation, includeShipping }));
    setAiTemplateCaption("");
    setAiTemplateError("");
    setAiTemplateSource("");
    if (!mediaFile) setMediaType("image");
    setProductCatalogOpen(false);
    void generateNewCollectionCaption({ product: nextProduct, applyToCaption: true, openPreview: false });
  };

  const clearCatalogProduct = () => {
    const wasAutoCaption = selectedCatalogProduct
      ? caption.trim() === buildCatalogCaption(selectedCatalogProduct, { includeLocation, includeShipping }).trim()
      : false;
    setSelectedCatalogProduct(null);
    setSelectedCatalogMediaUrl("");
    if (!mediaFile) {
      setMediaPreview("");
      setMediaType("image");
    }
    if (wasAutoCaption) {
      setCaption("");
    }
    setFirstComment("");
    setCreateSource("device");
    setAiTemplateCaption("");
    setAiTemplateError("");
    setAiTemplateSource("");
    setAiTemplateFallbackReason("");
    setIncludeLocation(true);
    setIncludeShipping(true);
    closeAiTemplateModal();
  };

  const closeAiTemplateModal = () => {
    setAiTemplateOpen(false);
    setAiTemplateLoading(false);
    setAiTemplateError("");
    setAiTemplateSource("");
    setAiTemplateFallbackReason("");
  };

  const loadSelectedCatalogProductDetails = async (catalogProduct = selectedCatalogProduct) => {
    if (!catalogProduct?.id) return null;
    const response = await getProductsWithVariants({
      params: {
        productId: catalogProduct.id,
        refresh: Date.now(),
      },
      timeoutMs: 30000,
    });
    console.warn("[ai-social-caption-products-with-variants-raw]", response);
    const products = safeArray(response);
    const resolved =
      products.find((item) => String(item?.id || item?.product_id || "") === String(catalogProduct.id)) ||
      products[0] ||
      {};
    const normalized = normalizeCatalogProductMetrics({
      ...catalogProduct,
      ...resolved,
      image_url: resolved.image_url || resolved.product_image_url || catalogProduct.image_url || "",
      product_url: resolved.product_url || catalogProduct.product_url || "",
    });
    console.warn("[ai-social-caption-products-with-variants-normalized]", normalized);
    return normalized;
  };

  const generateNewCollectionCaption = async ({ force = false, product = selectedCatalogProduct, applyToCaption = false, openPreview = true } = {}) => {
    if (!product?.id) {
      toast.error("Select a product first");
      return;
    }
    setAiTemplateOpen(openPreview);
    setAiTemplateLoading(true);
    setAiTemplateError("");
    setAiTemplateFallbackReason("");
    try {
      const productDetails = await loadSelectedCatalogProductDetails(product);
      if (productDetails?.id) {
        setSelectedCatalogProduct((current) =>
          String(current?.id || "") === String(product.id || "") ? productDetails : current
        );
      }
      console.warn("[ai-social-caption-product-source]", {
        selected_catalog_product: product,
        product_details: productDetails,
      });
      const aiContext = buildAiCaptionProductContext(productDetails || product);
      const aiPayload = {
        product_id: product.id,
        product_name: aiContext.product_name || "",
        base_price: aiContext.base_price || "",
        sale_price: aiContext.sale_price || "",
        current_price: aiContext.current_price || "",
        original_price: aiContext.original_price || "",
        discount_percent: aiContext.discount_percent || "",
        stock_quantity: aiContext.stock_quantity || "",
        available_sizes: aiContext.available_sizes || [],
        available_colors: aiContext.available_colors || [],
        features: aiContext.features || [],
        description: aiContext.description || "",
        product_url: aiContext.product_url || "",
        sale_active: aiContext.sale_active || false,
        price_source: aiContext.price_source || "",
        old_crossed_price: aiContext.old_crossed_price || 0,
      };
      console.warn("[ai-social-caption-product]", aiPayload);
      console.warn("[ai-social-caption-request]", {
        selectedCatalogProduct: product,
        selectedCatalogProductDetails: productDetails,
        aiContext,
        payload: {
          current: aiContext,
          product_id: product.id,
          template: "new_collection",
          force: Boolean(force),
        },
      });
      const payload = {
        current: aiContext,
        product_id: product.id,
        template: "new_collection",
        force: Boolean(force),
      };
      const result = await generateSocialPublisherCaption(payload, { timeoutMs: 45000 });
      const aiSections = normalizeAiCaptionSections(result || {});
      const erpInfo = buildErpProductInfo(productDetails || product);
      const nextCaption =
        composeNewCollectionCaption(aiSections, erpInfo, { includeLocation, includeShipping }) ||
        String(result?.caption || "").trim() ||
        buildCatalogCaption(product, { includeLocation, includeShipping });
      console.warn("[ai-social-caption-response]", {
        success: String(result?.source || "").toUpperCase() === "OPENAI",
        source: result?.source || "",
        error: result?.error || "",
        caption_length: nextCaption.length,
        sections: {
          hook: aiSections.hook || "",
          body: aiSections.body || "",
          cta: aiSections.cta || "",
          hashtags: aiSections.hashtags || [],
        },
      });
      setAiTemplateCaption(nextCaption);
      if (applyToCaption) setCaption(nextCaption);
      setAiTemplateSource(String(result?.source || "LOCAL_FALLBACK"));
      setFirstComment(buildSuggestedFirstComment(productDetails || product, { includeLocation, includeShipping }));
      if (String(result?.source || "").toUpperCase() !== "OPENAI") {
        const payloadMissing =
          !aiContext.product_name ||
          !aiContext.current_price ||
          !aiContext.stock_quantity ||
          !aiContext.product_url ||
          (!Array.isArray(aiContext.available_sizes) || aiContext.available_sizes.length === 0);
        const fallbackReason = !result?.source
          ? "unknown"
          : String(result.source).toUpperCase() === "LOCAL_FALLBACK" && payloadMissing
            ? "missing_product_data"
            : String(result.source).toUpperCase() === "LOCAL_FALLBACK"
              ? String(result?.error_reason || result?.error || "").trim().toUpperCase().replace(/\s+/g, "_") || "unknown"
              : "";
        setAiTemplateFallbackReason(fallbackReason);
        setAiTemplateError(result?.error || "AI caption generation used fallback text.");
      } else if (!nextCaption) {
        setAiTemplateFallbackReason("invalid_ai_json");
        setAiTemplateError("No caption returned.");
      } else {
        setAiTemplateFallbackReason("");
        setAiTemplateError("");
      }
    } catch (error) {
      const message = error?.message || "Failed to generate caption";
      if (applyToCaption) setCaption(buildCatalogCaption(product, { includeLocation, includeShipping }));
      setAiTemplateFallbackReason("ai_request_failed");
      setAiTemplateError(message);
      toast.error(message);
    } finally {
      setAiTemplateLoading(false);
    }
  };

  const useAiTemplateCaption = () => {
    if (!aiTemplateCaption.trim()) return;
    setCaption(aiTemplateCaption);
    setAiTemplateOpen(false);
  };
  const refreshSuggestedFirstComment = async () => {
    if (!selectedCatalogProduct?.id) {
      setFirstComment("");
      return "";
    }
    setFirstCommentLoading(true);
    try {
      const productDetails = await loadSelectedCatalogProductDetails();
      const nextComment = buildSuggestedFirstComment(productDetails || selectedCatalogProduct, {
        includeLocation,
        includeShipping,
      });
      setFirstComment(nextComment);
      return nextComment;
    } catch (error) {
      console.error("[social-publisher-first-comment] refresh failed", error);
      const fallbackComment = buildSuggestedFirstComment(selectedCatalogProduct, { includeLocation, includeShipping });
      setFirstComment(fallbackComment);
      return fallbackComment;
    } finally {
      setFirstCommentLoading(false);
    }
  };
  const useSuggestedFirstComment = () => {
    if (!firstComment.trim()) {
      void refreshSuggestedFirstComment();
      return;
    }
    toast.success("First comment saved to draft.");
  };
  const copyTextToClipboard = async (text) => {
    const normalized = String(text || "").trim();
    if (!normalized) return false;
    try {
      await navigator.clipboard.writeText(normalized);
      toast.success("Copied successfully.");
      return true;
    } catch {
      toast.error("Copy failed.");
      return false;
    }
  };
  const copySuggestedFirstComment = () => copyTextToClipboard(firstComment);
  const copyCaption = () => copyTextToClipboard(caption);
  const copyAll = () => copyTextToClipboard([caption.trim(), firstComment.trim()].filter(Boolean).join("\n\n"));

  useEffect(() => {
    if (!selectedCatalogProduct?.id) {
      setFirstComment("");
      return undefined;
    }
    void refreshSuggestedFirstComment();
    return undefined;
  }, [selectedCatalogProduct?.id, includeLocation, includeShipping]);

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (metaAccountsLoading || metaIntegrationLoading) return;
      loadMetaAccounts().catch(() => {});
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [metaAccountsLoading, metaIntegrationLoading]);

  useEffect(() => {
    return () => {
      if (metaConnectTimeoutRef.current) {
        window.clearTimeout(metaConnectTimeoutRef.current);
      }
      if (metaConnectClosedIntervalRef.current) {
        window.clearInterval(metaConnectClosedIntervalRef.current);
      }
      metaConnectPopupRef.current?.close?.();
    };
  }, []);

  const handleFacebookPageChange = (pageId) => {
    const nextPageId = String(pageId || "").trim();
    const nextPage = facebookPages.find((page) => page.facebook_page_id === nextPageId) || null;
    setSelectedFacebookPageId(nextPageId);
    if (nextPage?.instagram_business_account_id) {
      setSelectedInstagramAccountId(nextPage.instagram_business_account_id);
      return;
    }
    const matchedInstagram = instagramAccounts.find((account) => account.facebook_page_id === nextPageId);
    setSelectedInstagramAccountId(matchedInstagram?.instagram_account_id || "");
  };

  const handleInstagramAccountChange = (instagramAccountId) => {
    const nextInstagramId = String(instagramAccountId || "").trim();
    setSelectedInstagramAccountId(nextInstagramId);
    const matchedPage = facebookPages.find((page) => page.instagram_business_account_id === nextInstagramId);
    if (matchedPage) {
      setSelectedFacebookPageId(matchedPage.facebook_page_id);
    }
  };

  const hasFacebookAccount = Boolean(selectedFacebookPageId);
  const hasInstagramAccount = Boolean(selectedInstagramAccountId);
  const selectedFacebookPageLabel = selectedFacebookPage ? resolveFacebookPageDisplayLabel(selectedFacebookPage) : "Facebook Page";
  const selectedInstagramAccountLabel = selectedInstagramAccount ? resolveInstagramAccountDisplayLabel(selectedInstagramAccount) : "Instagram Business Account";
  const canPublishSelectedAccounts = Boolean(hasFacebookAccount && (!platforms.instagram || hasInstagramAccount));

  useEffect(() => {
    if (!mediaFile) {
      setMediaPreview("");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(mediaFile);
    setMediaPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [mediaFile]);

  useEffect(() => {
    if (!selectedCatalogProduct) {
      setSelectedCatalogMediaUrl("");
      return;
    }
    if (mediaFile) return;
    const nextDefaultUrl = selectedCatalogMediaItems[0]?.url || selectedCatalogPrimaryMediaUrl || selectedCatalogProduct?.image_url || "";
    setSelectedCatalogMediaUrl((current) => {
      if (current && selectedCatalogMediaItems.some((item) => item.url === current)) {
        return current;
      }
      return nextDefaultUrl;
    });
  }, [mediaFile, selectedCatalogMediaItems, selectedCatalogPrimaryMediaUrl, selectedCatalogProduct]);

  const resetComposer = () => {
    setCaption("");
    setFirstComment("");
    setScheduledAt("");
    setMediaFile(null);
    setSelectedCatalogProduct(null);
    setSelectedCatalogMediaUrl("");
    setAiTemplateCaption("");
    setAiTemplateError("");
    setAiTemplateSource("");
    closeAiTemplateModal();
    setMediaType("image");
    setPlatforms({ facebook: true, instagram: false, tiktok: false });
    setCreateSource("device");
    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  };

  const handleMediaChange = (event) => {
    const file = event.target.files?.[0] || null;
    setMediaFile(file);
    setMediaType(file?.type?.startsWith("video/") ? "video" : "image");
    if (file) setCreateSource("device");
  };

  const togglePlatform = (key) => {
    if (key === "tiktok") return;
    setPlatforms((current) => ({ ...current, [key]: !current[key] }));
  };

  const blockTikTokPayload = () => {
    if (!hasDisabledTikTok) return false;
    toast.error(t("marketing.socialPublisher.tiktokNotConnected"));
    return true;
  };

  const buildPayload = () => {
    const formData = new FormData();
    formData.append("caption", caption);
    if (firstComment.trim()) {
      formData.append("first_comment", firstComment);
    }
    formData.append("platforms", JSON.stringify(selectedPlatforms));
    formData.append("media_type", mediaType);
    if (selectedCatalogProduct?.id) {
      formData.append("product_id", String(selectedCatalogProduct.id));
    }
    if (!mediaFile && selectedCatalogResolvedMediaUrl) {
      formData.append("media_url", selectedCatalogResolvedMediaUrl);
      const carouselUrls = uniqueTextList(
        selectedCatalogResolvedMediaUrl,
        selectedCatalogMediaItems.map((item) => item.url)
      ).slice(0, 10);
      formData.append("media_urls", JSON.stringify(carouselUrls));
    }
    formData.append(
      "publish_settings",
      JSON.stringify({
        facebook_page_id: selectedFacebookPageId,
        facebook_page_name: selectedFacebookPageLabel,
        instagram_account_id: selectedInstagramAccountId,
        instagram_username: selectedInstagramAccountLabel,
      })
    );
    if (scheduledAt) {
      formData.append("scheduled_at", scheduledAt);
    }
    if (mediaFile) {
      formData.append("media", mediaFile);
    }
    return formData;
  };

  const handlePublishNow = async () => {
    if (!canCreate || !canPublish) {
      toast.error(t("marketing.common.permissionPublish"));
      return;
    }
    if (blockTikTokPayload()) return;
    if (!selectedPlatforms.length) {
      toast.error(t("marketing.socialPublisher.selectAtLeastOnePlatform"));
      return;
    }
    if (!hasFacebookAccount) {
      toast.error("Connect Facebook first");
      return;
    }
    if (selectedPlatforms.includes("instagram") && !hasInstagramAccount) {
      toast.error("Connect Instagram first");
      return;
    }

    setSaving(true);
    try {
      const created = await createSocialPublisherPost(buildPayload());
      const published = await publishSocialPublisherPost(created.id);
      toast.success(published?.message || t("marketing.socialPublisher.publishedSuccessfully"));
      resetComposer();
      await loadPosts();
    } catch (err) {
      toast.error(err?.message || t("marketing.socialPublisher.publishFailed"));
      await loadPosts();
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!canCreate) {
      toast.error(t("marketing.common.permissionCreate"));
      return;
    }
    if (blockTikTokPayload()) return;
    if (!selectedPlatforms.length) {
      toast.error(t("marketing.socialPublisher.selectAtLeastOnePlatform"));
      return;
    }
    if (!scheduledAt) {
      toast.error(t("marketing.socialPublisher.chooseScheduleTime"));
      return;
    }
    if (!hasFacebookAccount) {
      toast.error("Connect Facebook first");
      return;
    }
    if (selectedPlatforms.includes("instagram") && !hasInstagramAccount) {
      toast.error("Connect Instagram first");
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      payload.set("status", "scheduled");
      const saved = await createSocialPublisherPost(payload);
      toast.success(t("marketing.socialPublisher.postScheduled"));
      resetComposer();
      await loadPosts();
      return saved;
    } catch (err) {
      toast.error(err?.message || t("marketing.socialPublisher.scheduleFailed"));
    } finally {
      setSaving(false);
    }
  };

  const clearMetaConnectWatchers = () => {
    if (metaConnectTimeoutRef.current) {
      window.clearTimeout(metaConnectTimeoutRef.current);
      metaConnectTimeoutRef.current = null;
    }
    if (metaConnectClosedIntervalRef.current) {
      window.clearInterval(metaConnectClosedIntervalRef.current);
      metaConnectClosedIntervalRef.current = null;
    }
  };

  const openAdvancedMetaSettings = () => {
    setMetaConnectOpen(false);
    window.location.assign("/marketing/settings#marketing-settings-facebook");
  };

  const handlePublishFromHistory = async (post) => {
    if (!canPublish) {
      toast.error(t("marketing.common.permissionPublish"));
      return;
    }
    const platformsWithNoTiktok = safeArray(post.platforms).filter((platform) => String(platform || "").trim().toLowerCase() !== "tiktok");
    if (safeArray(post.platforms).length !== platformsWithNoTiktok.length) {
      toast.error(t("marketing.socialPublisher.tiktokNotConnected"));
      return;
    }
    setPublishingId(post.id);
    try {
      const result = await publishSocialPublisherPost(post.id);
      toast.success(result?.message || t("marketing.socialPublisher.publishedSuccessfully"));
      await loadPosts();
    } catch (err) {
      toast.error(err?.message || t("marketing.socialPublisher.publishFailed"));
    } finally {
      setPublishingId(null);
    }
  };

  const handleViewHistoryPost = (post) => {
    setHistoryDetailPost(post);
  };

  const handleDuplicateHistoryPost = (post) => {
    setCaption(String(post.caption || ""));
    setFirstComment(String(post.first_comment || ""));
    setScheduledAt("");
    setMediaType(String(post.media_type || "").toLowerCase() === "video" ? "video" : "image");
    setMediaFile(null);
    setMediaPreview(String(post.media_url || ""));
    setCreateSource("history");
    setSelectedCatalogMediaUrl("");
    setPlatforms({
      facebook: safeArray(post.platforms).includes("facebook"),
      instagram: safeArray(post.platforms).includes("instagram"),
      tiktok: safeArray(post.platforms).includes("tiktok"),
    });
    setSelectedCatalogProduct(null);
    toast.success("Draft duplicated.");
  };

  const handleDeleteHistoryPost = (post) => {
    const confirmDelete = window.confirm("Delete this post from the current history view?");
    if (!confirmDelete) return;
    setPosts((current) => current.filter((item) => String(item.id) !== String(post.id)));
    if (String(historyDetailPost?.id) === String(post.id)) {
      setHistoryDetailPost(null);
    }
    toast.success("Post removed from view.");
  };

  const renderPreviewCard = (platformName, accentClass, platformHint) => (
    <article className={`min-h-[680px] rounded-[2rem] border ${accentClass} bg-slate-950/70 p-5 shadow-xl shadow-black/20`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-black text-white">{platformName}</div>
          <div className="text-xs text-slate-400">{platformHint}</div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
          Preview
        </span>
      </div>
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/40">
        <div className="aspect-[4/5] bg-gradient-to-br from-slate-900 via-slate-950 to-black">
          {resolvedMediaPreview ? (
            mediaType === "video" ? (
              <video src={resolvedMediaPreview} controls className="h-full w-full object-cover bg-black" />
            ) : (
              <img src={resolvedMediaPreview} alt={`${platformName} preview media`} className="h-full w-full object-cover bg-black" />
            )
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-slate-500">
              <div className="space-y-2">
                <ImageIcon className="mx-auto h-10 w-10 text-slate-600" />
                <div className="text-sm font-semibold">Media preview will show here</div>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-4 border-t border-white/10 p-5">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-black text-white">{selectedFacebookPageLabel || "No Facebook page selected"}</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{selectedInstagramAccountLabel || "No Instagram account selected"}</div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">
              {platformName}
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-100">{previewTitle}</p>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-slate-300">
            <div className="flex items-center gap-4">
              <span className="font-semibold text-white">1.2K likes</span>
              <span>84 comments</span>
              <span>21 shares</span>
            </div>
            <span className="text-slate-500">{previewSubtitle}</span>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">Page: {selectedFacebookPageLabel || "Not selected"}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">Platforms: {selectedPlatforms.length ? selectedPlatforms.join(", ") : "none"}</span>
          </div>
        </div>
      </div>
    </article>
  );

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 pb-32 pt-5 md:px-6 md:pb-10 lg:px-7 lg:pb-12">
        <MarketingStudioHeader
          eyebrow="Marketing Studio"
          title="Campaign Studio"
          description="أنشئ حملاتك التسويقية، راجع المحتوى، ثم انشر أو جدوله من مكان واحد."
        />

        {error ? <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

        <div className="grid gap-5">
          <section className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-black/25">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-2 text-amber-100">
                <Upload className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black">{t("marketing.socialPublisher.uploadTitle")}</h2>
                <p className="text-sm text-slate-400">{t("marketing.socialPublisher.uploadHint")}</p>
              </div>
            </div>

            <div className="space-y-5 pb-28 md:pb-6">
              <section className="space-y-3 rounded-[1.9rem] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2">
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-2 text-amber-100">
                    <Upload className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-white">Create Post From</div>
                    <div className="text-xs text-slate-400">Choose how you want to start this post.</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setCreateSource("device")}
                    className={[
                      "rounded-[1.5rem] border p-4 text-start transition",
                      createSource === "device"
                        ? "border-amber-400/30 bg-amber-400/10 text-amber-100 shadow-lg shadow-amber-400/10"
                        : "border-white/10 bg-slate-950/60 text-slate-200 hover:border-white/20 hover:bg-white/[0.05]",
                    ].join(" ")}
                  >
                    <div className="text-sm font-black text-white">Upload From Device</div>
                    <div className="mt-2 text-xs text-slate-400">Active now</div>
                  </button>

                  <button
                    type="button"
                    onClick={openProductCatalog}
                    className="rounded-[1.5rem] border border-emerald-400/20 bg-emerald-400/10 p-4 text-start text-emerald-50 transition hover:border-emerald-300/35 hover:bg-emerald-400/15"
                  >
                    <div className="text-sm font-black">Product Catalog</div>
                    <div className="mt-2 text-xs text-emerald-100/80">Select from ERP products</div>
                  </button>

                  <button
                    type="button"
                    disabled
                    className="cursor-not-allowed rounded-[1.5rem] border border-white/5 bg-white/[0.03] p-4 text-start text-slate-500 opacity-70"
                  >
                    <div className="text-sm font-black">AI Marketing</div>
                    <div className="mt-2 text-xs text-slate-500">Coming Soon</div>
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={includeLocation}
                      onChange={(event) => setIncludeLocation(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-slate-950 text-amber-400 focus:ring-amber-400/20"
                    />
                    <span>إضافة الموقع</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={includeShipping}
                      onChange={(event) => setIncludeShipping(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-slate-950 text-amber-400 focus:ring-amber-400/20"
                    />
                    <span>إضافة الشحن</span>
                  </label>
                </div>

                {hasCatalogProduct ? (
                  <div className="rounded-[1.5rem] border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                        {selectedCatalogResolvedMediaUrl ? (
                          <img src={selectedCatalogResolvedMediaUrl} alt={selectedCatalogProduct.name || "Selected product"} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-500">
                            <ImageIcon className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-black text-white">{selectedCatalogProduct.name || "Selected product"}</div>
                          {selectedCatalogProductDiscount ? <span className={`${sharedBadgeClass} border-emerald-300/20 bg-emerald-300/15 text-emerald-100`}>{selectedCatalogProductDiscount}</span> : null}
                        </div>
                        <div className="grid gap-2 text-xs text-emerald-100/85 sm:grid-cols-2 xl:grid-cols-3">
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/60">اسم المنتج</div>
                            <div className="mt-1 line-clamp-2 text-sm font-semibold text-white">{selectedCatalogProduct.name || "Selected product"}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/60">السعر الحالي</div>
                            <div className="mt-1 text-sm font-semibold text-white">
                              {Number(selectedCatalogProduct.current_price || selectedCatalogProduct.price || 0) > 0
                                ? `${formatCompactCurrency(selectedCatalogProduct.current_price || selectedCatalogProduct.price)} EGP`
                                : "Price not available"}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/60">المخزون</div>
                            <div className="mt-1 text-sm font-semibold text-white">
                              {Number(selectedCatalogProductAvailability.stock || selectedCatalogProduct.stock_quantity || 0) > 0
                                ? `${selectedCatalogProductAvailability.stock || selectedCatalogProduct.stock_quantity} in stock`
                                : "Out of stock"}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/60">عدد المقاسات</div>
                            <div className="mt-1 text-sm font-semibold text-white">{selectedCatalogProductAvailability.sizes.length}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/60">عدد الألوان</div>
                            <div className="mt-1 text-sm font-semibold text-white">{selectedCatalogProductAvailability.colors.length}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/60">نسبة الخصم</div>
                            <div className="mt-1 text-sm font-semibold text-white">{selectedCatalogProductDiscount || "—"}</div>
                          </div>
                        </div>
                        {selectedCatalogMediaItems.length > 1 ? (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/60">صور الألوان المتاحة</div>
                            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5 xl:grid-cols-6">
                              {selectedCatalogMediaItems.map((item) => {
                                const isActive = item.url === selectedCatalogResolvedMediaUrl;
                                return (
                                  <button
                                    key={item.key || item.url}
                                    type="button"
                                    onClick={() => {
                                      setSelectedCatalogMediaUrl(item.url);
                                      setMediaType("image");
                                    }}
                                    className={[
                                      "group overflow-hidden rounded-2xl border p-1 text-left transition",
                                      isActive ? "border-emerald-300/60 bg-emerald-300/15" : "border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.04]",
                                    ].join(" ")}
                                    title={item.color || item.url}
                                  >
                                    <div className="aspect-square overflow-hidden rounded-xl bg-black/40">
                                      <img src={item.url} alt={item.color || "Color image"} className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]" />
                                    </div>
                                    <div className="mt-1 truncate px-1 text-[10px] font-semibold text-emerald-100/80">{item.color || "Color"}</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={openProductCatalog} className={secondaryButtonClass}>
                        Change product
                      </button>
                      <button type="button" onClick={clearCatalogProduct} className={ghostButtonClass}>
                        Clear product
                      </button>
                      <button type="button" onClick={() => setAiTemplateOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 text-xs font-black text-amber-100 transition hover:border-amber-300/35 hover:bg-amber-400/15">
                        ✨ Generate AI Caption
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <label
                className={[
                  "block cursor-pointer rounded-[2rem] border border-dashed border-amber-400/25 bg-black/20 transition hover:border-amber-400/45 hover:bg-black/25",
                  hasCatalogProduct || resolvedMediaPreview ? "p-4" : "p-5",
                ].join(" ")}
              >
                <input
                  ref={mediaInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleMediaChange}
                  className="hidden"
                />
                <div className={`flex items-center justify-center text-center ${hasCatalogProduct || resolvedMediaPreview ? "min-h-[190px] md:min-h-[220px]" : "min-h-[280px]"}`}>
                  {resolvedMediaPreview ? (
                    mediaType === "video" ? (
                      <video src={resolvedMediaPreview} controls className="max-h-[360px] w-full rounded-[1.75rem] bg-black object-contain shadow-2xl shadow-black/30" />
                    ) : (
                      <img src={resolvedMediaPreview} alt="Selected media preview" className="max-h-[360px] w-full rounded-[1.75rem] bg-black object-contain shadow-2xl shadow-black/30" />
                    )
                  ) : (
                    <div className="space-y-3 px-4">
                      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-amber-400/20 bg-amber-400/10 text-amber-100">
                        <ImageIcon className="h-9 w-9" />
                      </div>
                      <div>
                        <div className="text-lg font-bold text-white">{t("marketing.socialPublisher.uploadMediaTitle")}</div>
                        <div className="mt-1 text-sm text-slate-400">{t("marketing.socialPublisher.uploadMediaHint")}</div>
                      </div>
                    </div>
                  )}
                </div>
              </label>

              <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-200">{t("marketing.socialPublisher.caption")}</span>
                    <span className="text-xs text-slate-500">{caption.length} chars</span>
                  </div>
                  <textarea
                    value={caption}
                    onChange={(event) => setCaption(event.target.value)}
                    rows={9}
                    placeholder="Write your post caption..."
                    className="min-h-[170px] w-full rounded-[1.75rem] border border-white/10 bg-slate-950/70 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-400/40 focus:ring-2 focus:ring-amber-400/10"
                  />

                  <div className="flex flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-4">
                    <button
                      type="button"
                      onClick={() => setFirstCommentAccordionOpen((current) => !current)}
                      disabled={!hasFirstCommentText}
                      className={[
                        "flex w-full items-center justify-between gap-3 rounded-[1.35rem] border px-4 py-3 text-left transition",
                        hasFirstCommentText
                          ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                          : "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-80",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-black text-white">
                          <span>{firstCommentAccordionOpen ? "▼" : "▶"}</span>
                          <span>Suggested First Comment</span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-slate-400">
                          {hasFirstCommentText ? "Built from ERP data only. Caption stays unchanged." : "Generate a product first to build the comment."}
                        </div>
                      </div>
                      <span className={`${sharedBadgeClass} border-white/10 bg-white/[0.05] text-slate-300`}>ERP</span>
                    </button>

                    {hasFirstCommentText && firstCommentAccordionOpen ? (
                      <>
                        <div className="mt-3 rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-3">
                          <div className="max-h-[min(42vh,26rem)] overflow-y-auto pr-1">
                            <div className="space-y-3 text-sm leading-6 text-slate-100">
                              {firstCommentPreview.split("\n").map((line, index) => {
                            const text = String(line || "").trim();
                            if (!text) {
                              return <div key={`gap-${index}`} className="h-2" />;
                            }

                            const linkMatch = text.match(/^(https?:\/\/\S+)$/i);
                            if (linkMatch) {
                              return (
                                <a
                                  key={`link-${index}`}
                                  href={linkMatch[1]}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block rounded-[1.1rem] border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 font-semibold text-cyan-50 transition hover:border-cyan-300/40 hover:bg-cyan-400/15"
                                >
                                  {linkMatch[1]}
                                </a>
                              );
                            }

                            const lineIconMap = [
                              { match: "💰 السعر الآن:", icon: BadgeDollarSign },
                              { match: "💰 السعر:", icon: BadgeDollarSign },
                              { match: "🏷️ قبل الخصم:", icon: Tag },
                              { match: "💸 وفر", icon: Percent },
                              { match: "📏 المقاسات:", icon: Package },
                              { match: "🏷️ كود المنتج:", icon: Tag },
                              { match: "🎨 اللون:", icon: Sparkles },
                              { match: "🎨 الألوان:", icon: Sparkles },
                              { match: "⚠️ الحالة:", icon: ShieldAlert },
                              { match: "✅ الحالة:", icon: ShieldAlert },
                              { match: "❌ الحالة:", icon: ShieldAlert },
                              { match: "🚚 الشحن:", icon: Truck },
                              { match: "📍 الموقع:", icon: MapPin },
                              { match: "💬 للحجز:", icon: Send },
                              { match: "🛒 اطلب الآن:", icon: ShoppingCart },
                              { match: "⏳ عرض لفترة محدودة.", icon: Sparkles },
                            ];
                            const matchedLine = lineIconMap.find((entry) => text.startsWith(entry.match));
                            const Icon = matchedLine?.icon || Sparkles;

                            return (
                              <div
                                key={`line-${index}`}
                                className="flex items-start gap-3 rounded-[1.1rem] border border-white/5 bg-black/10 px-3 py-2.5"
                              >
                                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200">
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                                <span className="min-w-0 flex-1 break-words">{text}</span>
                              </div>
                              );
                            })}
                            </div>
                          </div>
                        </div>

                        <div className="sticky bottom-0 mt-3 flex flex-wrap gap-2 border-t border-white/10 bg-slate-950/90 pt-3 backdrop-blur">
                          <button
                            type="button"
                            onClick={copyCaption}
                            disabled={!caption.trim()}
                            className={`${secondaryButtonClass} px-3 py-2 text-xs`}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy Caption
                          </button>
                          <button
                            type="button"
                            onClick={copySuggestedFirstComment}
                            disabled={!firstComment.trim()}
                            className={`${secondaryButtonClass} px-3 py-2 text-xs`}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy First Comment
                          </button>
                          <button
                            type="button"
                            onClick={copyAll}
                            disabled={!caption.trim() && !firstComment.trim()}
                            className={`${secondaryButtonClass} px-3 py-2 text-xs`}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy All
                          </button>
                          <button
                            type="button"
                            onClick={useSuggestedFirstComment}
                            disabled={!firstComment.trim()}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Use Comment
                          </button>
                          <button
                            type="button"
                            onClick={() => void refreshSuggestedFirstComment()}
                            disabled={firstCommentLoading || !selectedCatalogProduct?.id}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {firstCommentLoading ? <Loader2 className="mr-1 inline-block h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 inline-block h-3.5 w-3.5" />}
                            Regenerate
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                      <Send className="h-4 w-4 text-amber-200" />
                      {t("marketing.socialPublisher.platforms")}
                    </div>
                    <div className="space-y-3">
                      {platformOptions.map((platform) => {
                        const Icon = platform.icon;
                        const checked = Boolean(platforms[platform.key]);
                        return (
                          <button
                            key={platform.key}
                            type="button"
                            disabled={Boolean(platform.disabled)}
                            onClick={() => togglePlatform(platform.key)}
                            className={[
                              "flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-start transition",
                              platform.disabled
                                ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-slate-500"
                                : checked
                                  ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                                  : "border-white/10 bg-white/[0.03] text-slate-200 hover:border-white/20 hover:bg-white/[0.06]",
                            ].join(" ")}
                          >
                              <span className="flex min-w-0 flex-1 items-start gap-2">
                              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                              <span className="min-w-0 space-y-0.5">
                                <span className="block text-sm font-semibold">{t(platform.labelKey)}</span>
                                {platform.disabled ? <span className="block text-xs text-slate-400">{t(platform.helperKey)}</span> : null}
                              </span>
                            </span>
                            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                              {platform.disabled ? t(platform.subtitleKey) : checked ? "Selected" : "Off"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                </div>

              </div>
              </div>

              <section className="space-y-3 rounded-[1.75rem] border border-white/10 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-white">Publishing Account</div>
                    <div className="text-xs text-slate-400">Choose the connected Facebook page and Instagram account.</div>
                  </div>
                  {metaAccountsLoading || metaIntegrationLoading ? (
                    <span className={`${sharedBadgeClass} border-white/10 bg-white/[0.05] text-slate-300`}>LOADING</span>
                  ) : hasFacebookAccount ? (
                    <span className={`${sharedBadgeClass} border-emerald-400/20 bg-emerald-400/10 text-emerald-100`}>CONNECTED</span>
                  ) : (
                    <span className={`${sharedBadgeClass} border-amber-400/20 bg-amber-400/10 text-amber-100`}>CONNECT</span>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Facebook</div>
                    {facebookPages.length === 1 ? (
                      <div className="space-y-2">
                        {renderAccountCardValue("Selected page", resolveFacebookPageDisplayLabel(facebookPages[0]))}
                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15">✓</span>
                          Connected page
                        </div>
                      </div>
                    ) : facebookPages.length > 1 ? (
                      <select
                        value={selectedFacebookPageId}
                        onChange={(event) => handleFacebookPageChange(event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                      >
                        {facebookPages.map((page) => (
                          <option key={page.facebook_page_id} value={page.facebook_page_id}>
                            {resolveFacebookPageDisplayLabel(page)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                        Facebook Page
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Instagram</div>
                    {instagramAccounts.length === 1 ? (
                      <div className="space-y-2">
                        {renderAccountCardValue("Selected account", resolveInstagramAccountDisplayLabel(instagramAccounts[0]))}
                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-200">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15">✓</span>
                          Connected account
                        </div>
                      </div>
                    ) : instagramAccounts.length > 1 ? (
                      <select
                        value={selectedInstagramAccountId}
                        onChange={(event) => handleInstagramAccountChange(event.target.value)}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                      >
                        {instagramAccounts.map((account) => (
                          <option key={account.instagram_account_id} value={account.instagram_account_id}>
                            {resolveInstagramAccountDisplayLabel(account)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                        Instagram Business Account
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Facebook: {selectedFacebookPageLabel || "Not selected"}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Instagram: {selectedInstagramAccountLabel || "Not selected"}</span>
                </div>

                {!metaAccountsEmpty && hasFacebookAccount && !hasInstagramAccount ? (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    Facebook connected, Instagram business account not found.
                  </div>
                ) : metaAccountsEmpty ? (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    Meta accounts are not selected yet. Manage the connection from Marketing Settings, then refresh accounts here.
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openAdvancedMetaSettings}
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                  >
                    Manage Meta Connection
                  </button>
                  <button
                    type="button"
                    onClick={() => loadMetaAccounts()}
                    className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-400/15"
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Refresh Accounts
                  </button>
                </div>
              </section>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-semibold text-slate-200">{t("marketing.socialPublisher.schedule")}</span>
                  <div className="relative">
                    <CalendarClock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(event) => setScheduledAt(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-amber-400/40"
                    />
                  </div>
                </label>

                <div className="space-y-2">
                  <span className="text-sm font-semibold text-slate-200">TikTok</span>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                    {t("marketing.socialPublisher.connectTikTokLater")}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-400/15"
                >
                  <ImageIcon className="h-4 w-4" />
                  {t("marketing.socialPublisher.preview")}
                </button>
                <button
                  type="button"
                  onClick={handleSchedule}
                  disabled={saving || !canCreate || !selectedPlatforms.length || !hasFacebookAccount || (selectedPlatforms.includes("instagram") && !hasInstagramAccount)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                  {t("marketing.socialPublisher.schedule")}
                </button>
                <button
                  type="button"
                  onClick={handlePublishNow}
                  disabled={saving || !canCreate || !canPublish || !selectedPlatforms.length || !hasFacebookAccount || (selectedPlatforms.includes("instagram") && !hasInstagramAccount)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("marketing.socialPublisher.publishNow")}
                </button>
              </div>

              <div className="sticky bottom-0 z-20 mt-2 grid grid-cols-2 gap-2 border-t border-[var(--border)] bg-[var(--card)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-4 md:hidden">
                <button
                  type="button"
                  onClick={handleSchedule}
                  disabled={saving || !canCreate || !selectedPlatforms.length || !hasFacebookAccount || (selectedPlatforms.includes("instagram") && !hasInstagramAccount)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                  {t("marketing.socialPublisher.schedule")}
                </button>
                <button
                  type="button"
                  onClick={handlePublishNow}
                  disabled={saving || !canCreate || !canPublish || !selectedPlatforms.length || !hasFacebookAccount || (selectedPlatforms.includes("instagram") && !hasInstagramAccount)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t("marketing.socialPublisher.publishNow")}
                </button>
              </div>
            </div>
          </section>

          
        </div>
      </div>

      {previewOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-4"
              role="presentation"
              onClick={() => setPreviewOpen(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Preview post"
                className="flex h-full w-full max-w-6xl flex-col overflow-hidden bg-[var(--card)] text-[var(--text)] shadow-2xl shadow-black/60 md:h-[92vh] md:rounded-[2rem] md:border md:border-[var(--border)]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 md:px-6">
                  <div className="min-w-0">
                    <div className="text-sm font-black uppercase tracking-[0.22em] text-amber-100">{t("marketing.socialPublisher.preview")}</div>
                    <div className="text-xs text-slate-400">{t("marketing.socialPublisher.previewSubtitle")}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                  >
                    Close
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                    <div className="space-y-3 rounded-[1.75rem] border border-white/10 bg-slate-950/60 p-4">
                      <div className="text-sm font-black text-white">Publishing Account</div>
                      <div className="space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                          <span className="text-slate-400">Facebook</span>
                          <span className="font-semibold text-white">{selectedFacebookPageLabel}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
                          <span className="text-slate-400">Instagram</span>
                          <span className="font-semibold text-white">{selectedInstagramAccountLabel}</span>
                        </div>
                      </div>

                      <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Post Details</div>
                        <div className="mt-3 space-y-2 text-sm text-slate-300">
                          <div className="flex items-center justify-between gap-3">
                            <span>Media</span>
                            <span className="font-semibold text-white">{mediaFile ? mediaType : "none"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Platforms</span>
                            <span className="font-semibold text-white">{selectedPlatforms.length ? selectedPlatforms.join(", ") : "-"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Status</span>
                            <span className="font-semibold text-white">Draft</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        {renderPreviewCard(
                          t("marketing.socialPublisher.facebookPreview"),
                          "border-[#1877F2]/20",
                          t("marketing.socialPublisher.facebookPreviewHint")
                        )}
                        {renderPreviewCard(
                          t("marketing.socialPublisher.instagramPreview"),
                          "border-fuchsia-400/20",
                          t("marketing.socialPublisher.instagramPreviewHint")
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--card)] px-4 py-4 md:px-6">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button
                      type="button"
                      onClick={handleSchedule}
                      disabled={saving || !canCreate || !selectedPlatforms.length || !hasFacebookAccount || (selectedPlatforms.includes("instagram") && !hasInstagramAccount)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                      {t("marketing.socialPublisher.schedule")}
                    </button>
                    <button
                      type="button"
                      onClick={handlePublishNow}
                      disabled={saving || !canCreate || !canPublish || !selectedPlatforms.length || !hasFacebookAccount || (selectedPlatforms.includes("instagram") && !hasInstagramAccount)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {t("marketing.socialPublisher.publishNow")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(false)}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>,
          document.body
        )
        : null}

      {aiTemplateOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-4"
              role="presentation"
              onClick={closeAiTemplateModal}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Templates"
                className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[2rem] border border-[var(--border)] bg-[var(--card)] text-[var(--text)] shadow-2xl shadow-black/60 md:h-[86vh] md:rounded-[2rem]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 md:px-6">
                  <div className="min-w-0">
                    <div className="text-sm font-black uppercase tracking-[0.22em] text-amber-100">Templates</div>
                    <div className="text-xs text-slate-400">Choose a caption template for the selected product.</div>
                  </div>
                  <button
                    type="button"
                    onClick={closeAiTemplateModal}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                  >
                    Close
                  </button>
                </div>

                <div className="grid flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[280px_minmax(0,1fr)] md:p-6">
                  <div className="space-y-3">
                    <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-400">Available templates</div>
                    <button
                      type="button"
                      onClick={() => void generateNewCollectionCaption()}
                      disabled={!selectedCatalogProduct || aiTemplateLoading}
                      className="w-full rounded-[1.6rem] border border-amber-400/25 bg-amber-400/10 p-4 text-start transition hover:border-amber-300/35 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.03] disabled:text-slate-500"
                    >
                      <span className={`${sharedBadgeClass} border-amber-400/25 bg-amber-400/10 font-black text-amber-100`}>
                        NEW COLLECTION
                      </span>
                      <div className="mt-2 text-base font-black text-white">New Collection</div>
                      <div className="mt-2 text-sm leading-6 text-slate-300">
                        Premium caption generated from the selected ERP product only.
                      </div>
                    </button>
                  </div>

                  <div className="flex min-h-0 flex-col rounded-[1.6rem] border border-white/10 bg-white/[0.03]">
                    <div className="border-b border-white/10 px-4 py-4 md:px-5">
                      <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-400">Preview</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {selectedCatalogProduct ? selectedCatalogProduct.name : "Select a product first"}
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5">
                      {aiTemplateLoading ? (
                        <div className="flex h-full min-h-[220px] items-center justify-center rounded-[1.25rem] border border-white/10 bg-black/20 text-sm text-slate-400">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating caption...
                        </div>
                      ) : aiTemplateCaption ? (
                        <pre className="whitespace-pre-wrap break-words rounded-[1.25rem] border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm leading-7 text-emerald-50">
                          {aiTemplateCaption}
                        </pre>
                      ) : (
                        <div className="rounded-[1.25rem] border border-white/10 bg-black/20 p-4 text-sm leading-7 text-slate-400">
                          Pick the template card to generate a caption from the selected product.
                        </div>
                      )}
                      {aiTemplateError ? <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{aiTemplateError}</div> : null}
                      {aiTemplateSource && String(aiTemplateSource).toUpperCase() === "LOCAL_FALLBACK" ? (
                        <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">
                          Fallback reason: {aiTemplateFallbackReason || "unknown"}
                        </div>
                      ) : null}
                      {aiTemplateSource ? <div className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">Source: {aiTemplateSource}</div> : null}
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-4 md:px-5">
                      <button
                        type="button"
                        onClick={useAiTemplateCaption}
                        disabled={!aiTemplateCaption.trim()}
                        className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                      >
                        Use Caption
                      </button>
                      <button
                        type="button"
                        onClick={() => void generateNewCollectionCaption({ force: true })}
                        disabled={!selectedCatalogProduct || aiTemplateLoading}
                        className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:text-slate-500"
                      >
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={closeAiTemplateModal}
                        className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {productCatalogOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm md:items-center md:p-4"
              role="presentation"
              onClick={closeProductCatalog}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Select Product"
                className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[2rem] border border-[var(--border)] bg-[var(--card)] text-[var(--text)] shadow-2xl shadow-black/60 md:h-[86vh] md:rounded-[2rem]"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 md:px-6">
                  <div className="min-w-0">
                    <div className="text-sm font-black uppercase tracking-[0.22em] text-emerald-100">Select Product</div>
                    <div className="text-xs text-slate-400">Choose a product from ERP and autofill the post draft.</div>
                  </div>
                  <button
                    type="button"
                    onClick={closeProductCatalog}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                  >
                    Close
                  </button>
                </div>

                <div className="border-b border-white/5 px-4 py-4 md:px-6">
                  <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      ref={productCatalogSearchRef}
                      value={productCatalogQuery}
                      onChange={(event) => setProductCatalogQuery(event.target.value)}
                      placeholder="Search products..."
                      className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
                  {productCatalogLoading ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
                      Loading products...
                    </div>
                  ) : productCatalogResults.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-400">
                      No products found.
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {productCatalogResults.map((product) => {
                        const isSelected = String(product.id || "") === String(selectedCatalogProduct?.id || "");
                        const productCurrentPrice = Number(product.current_price || product.price || 0);
                        const productOriginalPrice = Number(product.original_price || product.old_crossed_price || 0);
                        return (
                          <article
                            key={product.id}
                            className={[
                              "overflow-hidden rounded-[1.5rem] border p-3 transition",
                              isSelected ? "border-emerald-400/35 bg-emerald-400/10" : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]",
                            ].join(" ")}
                          >
                            <div className="flex gap-3">
                              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                                {product.primary_media_url || product.image_url ? (
                                  <img src={product.primary_media_url || product.image_url} alt={product.name || "Product"} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-slate-500">
                                    <ImageIcon className="h-6 w-6" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="line-clamp-2 text-sm font-black text-white">{product.name || "Unnamed product"}</div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">
                                    {productCurrentPrice > 0 ? `${formatCompactCurrency(productCurrentPrice)} EGP` : "Price N/A"}
                                  </span>
                                  {productOriginalPrice > 0 && productOriginalPrice > productCurrentPrice ? (
                                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-emerald-100">
                                      Before {formatCompactCurrency(productOriginalPrice)} EGP
                                    </span>
                                  ) : null}
                                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">
                                    {Number(product.stock_quantity || 0) > 0 ? `${product.stock_quantity} in stock` : "Out of stock"}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 break-all">{product.product_url || ""}</div>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{isSelected ? "Selected" : "Ready"}</span>
                              <button
                                type="button"
                                onClick={() => applyCatalogProduct(product)}
                                className="rounded-2xl bg-emerald-400 px-3 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300"
                              >
                                Select
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {metaConnectOpen ? null : null}
    </div>
  );
}


